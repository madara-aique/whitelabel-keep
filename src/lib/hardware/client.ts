'use client';

import { io, type Socket } from 'socket.io-client';
import {
  HARDWARE_ERROR_CODES,
  HARDWARE_EVENTS,
  hardwareFailure,
  type BillAcceptorStatus,
  type BillInsertEvent,
  type DoorCloseEvent,
  type HardwareAck,
} from './protocol';

/**
 * Browser-side hardware client.
 *
 * Connects to the local gateway, never to the device directly. The
 * device credential stays on the server; this client authenticates with
 * a short-lived token fetched from `/api/hardware/token`.
 */
export interface HardwareClientHandlers {
  onInsert?: (event: BillInsertEvent) => void;
  onDoorClose?: (event: DoorCloseEvent) => void;
  onConnectionChange?: (connected: boolean) => void;
}

export class HardwareClient {
  private socket: Socket | null = null;
  private connecting: Promise<void> | null = null;

  constructor(
    private readonly gatewayUrl: string,
    private readonly handlers: HardwareClientHandlers = {},
  ) {}

  get isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  async connect(): Promise<void> {
    if (this.socket?.connected) return;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const response = await fetch('/api/hardware/token', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Could not obtain a hardware session token');
      }
      const { token } = (await response.json()) as { token: string };

      const socket = io(this.gatewayUrl, {
        transports: ['websocket'],
        auth: { token },
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1_000,
        timeout: 10_000,
      });

      socket.on('connect', () => this.handlers.onConnectionChange?.(true));
      socket.on('disconnect', () => this.handlers.onConnectionChange?.(false));
      socket.on('connect_error', () => this.handlers.onConnectionChange?.(false));
      socket.on(HARDWARE_EVENTS.billOnInsert, (event: BillInsertEvent) =>
        this.handlers.onInsert?.(event),
      );
      socket.on(HARDWARE_EVENTS.doorOnClose, (event: DoorCloseEvent) =>
        this.handlers.onDoorClose?.(event),
      );

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          socket.close();
          reject(new Error('Hardware gateway connection timed out'));
        }, 10_000);
        socket.once('connect', () => {
          clearTimeout(timer);
          resolve();
        });
        socket.once('connect_error', (error: Error) => {
          clearTimeout(timer);
          reject(error);
        });
      });

      this.socket = socket;
    })();

    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  disconnect(): void {
    this.socket?.removeAllListeners();
    this.socket?.close();
    this.socket = null;
  }

  startBillSession(payload: {
    total: number;
    transactionId: string;
    acceptedBills: number[];
  }): Promise<HardwareAck> {
    return this.command(HARDWARE_EVENTS.billStartSession, payload);
  }

  endBillSession(): Promise<HardwareAck> {
    return this.command(HARDWARE_EVENTS.billEndSession);
  }

  rejectBill(): Promise<HardwareAck> {
    return this.command(HARDWARE_EVENTS.billReject);
  }

  approveBill(): Promise<HardwareAck> {
    return this.command(HARDWARE_EVENTS.billApprove);
  }

  getBillAcceptorStatus(): Promise<HardwareAck<BillAcceptorStatus>> {
    return this.command<BillAcceptorStatus>(HARDWARE_EVENTS.billGetStatus);
  }

  openDoors(doorNumbers: string[]): Promise<HardwareAck> {
    return this.command(HARDWARE_EVENTS.doorOpen, { doorNumbers });
  }

  /** Emulator only: the gateway rejects this when a real driver is attached. */
  feedNote(denomination: number): Promise<HardwareAck> {
    return this.command(HARDWARE_EVENTS.mockInsertBill, { denomination });
  }

  private command<T = unknown>(event: string, payload?: unknown): Promise<HardwareAck<T>> {
    const socket = this.socket;
    if (!socket?.connected) {
      return Promise.resolve(hardwareFailure(HARDWARE_ERROR_CODES.socket, 'Not connected to hardware'));
    }

    return new Promise((resolve) => {
      socket.emit(event, payload, (ack: HardwareAck<T>) => {
        resolve(ack ?? hardwareFailure(HARDWARE_ERROR_CODES.socket, 'No acknowledgement'));
      });
    });
  }
}
