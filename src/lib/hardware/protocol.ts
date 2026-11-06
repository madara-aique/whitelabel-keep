/**
 * Hardware wire protocol.
 *
 * Shared verbatim by the browser client, the gateway process and the
 * device drivers, so the event names and payloads cannot drift apart.
 * The names mirror the legacy controller contract, which lets a site
 * swap in a real controller without touching the UI.
 */

export const HARDWARE_EVENTS = {
  /** Browser → gateway: open a bill-acceptor session for a target amount. */
  billStartSession: 'billAcceptor:startSession',
  /** Gateway → browser: a note was inserted / the session progressed. */
  billOnInsert: 'billAcceptor:onInsert',
  /** Either direction: abandon the session and stop accepting notes. */
  billEndSession: 'billAcceptor:endSession',
  /** Browser → gateway: keep the held note (only when change is possible). */
  billApprove: 'billAcceptor:approveBill',
  /** Browser → gateway: return the held note. */
  billReject: 'billAcceptor:rejectBill',
  /** Browser → gateway: current session snapshot. */
  billGetStatus: 'billAcceptor:getStatus',
  /** Mock driver only: pretend a note was fed into the acceptor. */
  mockInsertBill: 'mock:insertBill',

  /** Browser → gateway: energise a door's lock. */
  doorOpen: 'locker:openDoor',
  /** Gateway → browser: a door reported closed again. */
  doorOnClose: 'locker:onClose',
  /** Browser → gateway: current state of the given doors. */
  doorStates: 'locker:getDoorStates',
} as const;

export type HardwareEvent = (typeof HARDWARE_EVENTS)[keyof typeof HARDWARE_EVENTS];

export interface HardwareError {
  code: string;
  message: string;
}

/** Uniform acknowledgement returned by every gateway command. */
export interface HardwareAck<TData = unknown> {
  completed: boolean;
  data?: TData;
  error?: HardwareError;
}

export type BillInsertStatus = 'accepted' | 'rejected' | 'hold';

export interface BillInsertData {
  /** Face value of the note that was just handled. */
  insertedAmount: number;
  /** Running total accepted so far in this session. */
  totalInsertedAmount: number;
  /** The session target. */
  totalAmount: number;
  /** How much is still owed. Never negative. */
  remainingAmount: number;
  /** Present only when the note would overshoot the target. */
  overAmount?: number;
}

export interface BillInsertEvent {
  status: BillInsertStatus;
  accepted?: boolean;
  data?: BillInsertData;
  error?: HardwareError;
}

export interface BillSessionData {
  totalAmountInserted: number;
  /** Denomination counts, ascending. */
  denominations: { denomination: number; count: number }[];
}

export interface BillAcceptorStatus {
  connected: boolean;
  sessionActive: boolean;
  driver: string;
  target: number;
  totalInserted: number;
  remaining: number;
  acceptedBills: number[];
}

export interface StartBillSessionPayload {
  total: number;
  transactionId: string;
  acceptedBills?: number[];
}

export interface DoorOpenPayload {
  doorNumbers: string[];
}

export interface DoorCloseEvent {
  doorNumber: string;
  closedAt: string;
}

export interface DoorStatePayload {
  doorNumber: string;
  open: boolean;
}

export const HARDWARE_ERROR_CODES = {
  socket: 'SOCKET_ERROR',
  timeout: 'TIMEOUT',
  sessionActive: 'SESSION_ACTIVE',
  noSession: 'NO_SESSION',
  unauthorized: 'UNAUTHORIZED',
  unsupported: 'UNSUPPORTED',
  driver: 'DRIVER_ERROR',
} as const;

/** Default acknowledgement used whenever a handler throws unexpectedly. */
export function hardwareFailure(
  code: string = HARDWARE_ERROR_CODES.socket,
  message = 'Unknown error',
): HardwareAck<never> {
  return { completed: false, error: { code, message } };
}
