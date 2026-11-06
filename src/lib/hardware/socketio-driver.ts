import { io, type Socket } from 'socket.io-client';
import { HardwareDriver, HardwareDriverError } from './driver';

/**
 * Driver for a real bill acceptor / lock controller that speaks the
 * controller socket contract (the same event vocabulary the legacy
 * `hardware-controller-sdk` used, so existing gateways keep working).
 *
 * Nothing here runs in the browser: this is instantiated by the gateway
 * process, which is the only component holding the device credential.
 */
export interface SocketIoDriverOptions {
  url: string;
  accessKey: string;
  connectTimeoutMs?: number;
  doorCloseEvent?: string;
  onDoorClose?: (doorNumber: string) => void;
}

const EVENTS = {
  startSession: 'billAcceptor:startSession',
  onInsert: 'billAcceptor:onInsert',
  endSession: 'billAcceptor:endSession',
  approveBill: 'billAcceptor:approveBill',
  rejectBill: 'billAcceptor:rejectBill',
  openDoor: 'locker:openDoor',
  onClose: 'locker:onClose',
} as const;

interface Ack<T> {
  completed: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

export class SocketIoHardwareDriver implements HardwareDriver {
  readonly kind = 'socketio';

  private socket: Socket | null = null;
  private connected = false;
  private intake: ((denomination: number) => void) | null = null;

  constructor(private readonly options: SocketIoDriverOptions) {}

  async connect(): Promise<void> {
    if (this.socket?.connected) return;

    const socket = io(this.options.url, {
      autoConnect: false,
      transports: ['websocket'],
      auth: this.options.accessKey ? { token: this.options.accessKey } : undefined,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1_000,
      timeout: this.options.connectTimeoutMs ?? 10_000,
    });

    socket.on('connect', () => {
      this.connected = true;
    });
    socket.on('disconnect', () => {
      this.connected = false;
    });
    socket.on('connect_error', () => {
      this.connected = false;
    });
    socket.on(this.options.doorCloseEvent ?? EVENTS.onClose, (payload: { doorNumber?: string }) => {
      if (payload?.doorNumber) this.options.onDoorClose?.(payload.doorNumber);
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.close();
        reject(new HardwareDriverError('TIMEOUT', 'Hardware gateway did not accept the connection'));
      }, this.options.connectTimeoutMs ?? 10_000);

      socket.once('connect', () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.once('connect_error', (error: Error) => {
        clearTimeout(timeout);
        reject(new HardwareDriverError('SOCKET_ERROR', error.message));
      });

      socket.connect();
    });

    this.socket = socket;
  }

  async dispose(): Promise<void> {
    this.socket?.removeAllListeners();
    this.socket?.close();
    this.socket = null;
    this.connected = false;
    this.intake = null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async startNoteIntake(onNote: (denomination: number) => void): Promise<void> {
    const socket = this.requireSocket();
    this.intake = onNote;

    socket.off(EVENTS.onInsert);
    socket.on(EVENTS.onInsert, (event: { status?: string; data?: { insertedAmount?: number } }) => {
      // The gateway reports repeat/edge events too; only real notes count.
      if (!this.intake) return;
      if (event?.status === 'accepted' || event?.status === 'hold' || event?.status === 'rejected') {
        const value = Number(event.data?.insertedAmount ?? 0);
        if (value > 0) this.intake(value);
      }
    });

    // The device-side session target is authoritative for it; our own
    // BillSession still tracks the totals the UI shows.
    await this.emit(EVENTS.startSession, { total: Number.MAX_SAFE_INTEGER });
  }

  async stopNoteIntake(): Promise<void> {
    this.intake = null;
    if (!this.socket?.connected) return;
    this.socket.off(EVENTS.onInsert);
    await this.emit(EVENTS.endSession, undefined).catch(() => undefined);
  }

  async returnNote(): Promise<void> {
    if (!this.socket?.connected) return;
    await this.emit(EVENTS.rejectBill, undefined).catch(() => undefined);
  }

  async keepNote(): Promise<void> {
    if (!this.socket?.connected) return;
    await this.emit(EVENTS.approveBill, undefined).catch(() => undefined);
  }

  async openDoors(doorNumbers: string[]): Promise<void> {
    if (doorNumbers.length === 0) return;
    await this.emit(EVENTS.openDoor, { doorIds: doorNumbers });
  }

  private requireSocket(): Socket {
    if (!this.socket?.connected) {
      throw new HardwareDriverError('SOCKET_ERROR', 'Hardware gateway is not connected');
    }
    return this.socket;
  }

  private emit<T>(event: string, payload: unknown): Promise<Ack<T>> {
    return new Promise((resolve, reject) => {
      const socket = this.requireSocket();
      const timeout = setTimeout(
        () => reject(new HardwareDriverError('TIMEOUT', `No reply to ${event}`)),
        this.options.connectTimeoutMs ?? 10_000,
      );
      socket.emit(event, payload, (ack: Ack<T>) => {
        clearTimeout(timeout);
        if (ack?.completed) resolve(ack);
        else reject(new HardwareDriverError(ack?.error?.code ?? 'DRIVER_ERROR', ack?.error?.message ?? 'Command failed'));
      });
    });
  }
}
