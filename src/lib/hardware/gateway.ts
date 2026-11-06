import type { Server, Socket } from 'socket.io';
import { HARDWARE_ERROR_CODES, HARDWARE_EVENTS, hardwareFailure, type HardwareAck } from './protocol';
import { BillSession } from './session';
import type { HardwareDriver } from './driver';
import { verifyHardwareToken } from './token';
import { serverEnv } from '@/lib/env';

/**
 * Hardware gateway core.
 *
 * Sits between the browser and the device driver:
 *   browser  ──socket.io──▶  gateway  ──driver──▶  bill acceptor / locks
 *
 * The browser never sees the device credential; it presents a
 * short-lived token minted by `/api/hardware/token`.
 */
export class HardwareGateway {
  private session: BillSession | null = null;
  private attached = false;

  constructor(private readonly driver: HardwareDriver) {}

  attach(io: Server): void {
    if (this.attached) return;
    this.attached = true;

    io.use((socket, next) => {
      if (!serverEnv.hardware.enabled) {
        next(new Error('Hardware is disabled'));
        return;
      }
      const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
      const payload = verifyHardwareToken(token);
      if (!payload) {
        next(new Error('Unauthorized'));
        return;
      }
      next();
    });

    io.on('connection', (socket) => {
      void this.onConnection(socket);
    });
  }

  private async onConnection(socket: Socket): Promise<void> {
    await this.driver.connect().catch(() => undefined);

    socket.on(
      HARDWARE_EVENTS.billStartSession,
      (
        payload: { total?: number; transactionId?: string; acceptedBills?: number[] },
        ack?: (response: HardwareAck) => void,
      ) => {
        void this.startSession(payload, socket).then(
          (result) => ack?.(result),
          (error: Error) => ack?.(hardwareFailure(HARDWARE_ERROR_CODES.driver, error.message)),
        );
      },
    );

    socket.on(
      HARDWARE_EVENTS.billEndSession,
      (_payload: unknown, ack?: (response: HardwareAck) => void) => {
        void this.endSession().then(
          () => ack?.({ completed: true }),
          (error: Error) => ack?.(hardwareFailure(HARDWARE_ERROR_CODES.driver, error.message)),
        );
      },
    );

    socket.on(
      HARDWARE_EVENTS.billApprove,
      (_payload: unknown, ack?: (response: HardwareAck) => void) => {
        void this.driver.keepNote().then(
          () => ack?.({ completed: true }),
          (error: Error) => ack?.(hardwareFailure(HARDWARE_ERROR_CODES.driver, error.message)),
        );
      },
    );

    socket.on(
      HARDWARE_EVENTS.billReject,
      (_payload: unknown, ack?: (response: HardwareAck) => void) => {
        void this.driver.returnNote().then(
          () => ack?.({ completed: true }),
          (error: Error) => ack?.(hardwareFailure(HARDWARE_ERROR_CODES.driver, error.message)),
        );
      },
    );

    socket.on(
      HARDWARE_EVENTS.billGetStatus,
      (_payload: unknown, ack?: (response: HardwareAck) => void) => {
        ack?.({
          completed: true,
          data: this.session
            ? this.session.status(this.driver.kind, this.driver.isConnected(), true)
            : {
                connected: this.driver.isConnected(),
                driver: this.driver.kind,
                sessionActive: false,
                target: 0,
                totalInserted: 0,
                remaining: 0,
                acceptedBills: serverEnv.kiosk.acceptedBills,
              },
        });
      },
    );

    socket.on(
      HARDWARE_EVENTS.doorOpen,
      (payload: { doorNumbers?: string[] }, ack?: (response: HardwareAck) => void) => {
        void this.driver
          .openDoors(payload?.doorNumbers ?? [])
          .then(
            () => ack?.({ completed: true }),
            (error: Error) => ack?.(hardwareFailure(HARDWARE_ERROR_CODES.driver, error.message)),
          );
      },
    );

    socket.on(
      HARDWARE_EVENTS.mockInsertBill,
      async (payload: { denomination?: number }, ack?: (response: HardwareAck) => void) => {
        if (!this.driver.feedNote) {
          ack?.(hardwareFailure(HARDWARE_ERROR_CODES.unsupported, 'This driver has no note emulator'));
          return;
        }
        try {
          await this.driver.feedNote(Number(payload?.denomination ?? 0));
          ack?.({ completed: true });
        } catch (error) {
          ack?.(hardwareFailure(HARDWARE_ERROR_CODES.driver, (error as Error).message));
        }
      },
    );

    socket.on('disconnect', () => {
      // A dropped kiosk must not leave the acceptor armed.
      void this.endSession().catch(() => undefined);
    });
  }

  private async startSession(
    payload: {
      total?: number;
      transactionId?: string;
      acceptedBills?: number[];
    },
    socket: Socket,
  ): Promise<HardwareAck> {
    if (this.session && !this.session.isClosed) {
      return hardwareFailure(HARDWARE_ERROR_CODES.sessionActive, 'A session is already running');
    }

    const total = Math.max(0, Math.trunc(Number(payload?.total ?? 0)));
    if (!payload?.transactionId) {
      return hardwareFailure(HARDWARE_ERROR_CODES.driver, 'transactionId is required');
    }

    const session = new BillSession({
      transactionId: payload.transactionId,
      targetAmount: total,
      acceptedBills: payload.acceptedBills ?? serverEnv.kiosk.acceptedBills,
    });
    this.session = session;

    await this.driver.startNoteIntake((denomination) => {
      const result = session.handleNote(denomination);
      // The machine never gives change, so a held note goes straight back.
      if (result.status === 'hold') {
        void this.driver.returnNote().catch(() => undefined);
      }
      // Only the kiosk that opened the session is told about its notes.
      if (socket.connected) {
        socket.emit(HARDWARE_EVENTS.billOnInsert, result);
      }
    });

    return { completed: true, data: { transactionId: session.transactionId, target: total } };
  }

  private async endSession(): Promise<void> {
    this.session?.close();
    this.session = null;
    await this.driver.stopNoteIntake().catch(() => undefined);
  }
}
