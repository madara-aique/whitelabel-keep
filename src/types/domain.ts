/**
 * Domain vocabulary for the kiosk.
 *
 * These names are intentionally generic: a locker has doors, a booking
 * moves through a payment lifecycle, and a payment is settled either in
 * cash at the bill acceptor or through the e-wallet gateway.
 */

/** Physical state of a door. 0 = free, 1 = occupied. */
export type DoorStatus = 0 | 1;

export type DoorSize = 'S' | 'M' | 'L';

/** How a booking was settled. */
export type PayType = 'CASH' | 'EWALLET' | 'PROMO';

/**
 * Booking lifecycle.
 *
 * payment-pending → ready-for-pickup → completed
 *                 ↘ canceled
 * ready-for-pickup/completed → cleared (operator emptied the door)
 */
export type BookingStatus =
  | 'payment-pending'
  | 'ready-for-pickup'
  | 'completed'
  | 'canceled'
  | 'cleared';

export const BOOKING_STATUSES: readonly BookingStatus[] = [
  'payment-pending',
  'ready-for-pickup',
  'completed',
  'canceled',
  'cleared',
];

/** Statuses that no longer block a door from being re-booked. */
export const CLOSED_BOOKING_STATUSES: readonly BookingStatus[] = [
  'completed',
  'canceled',
  'cleared',
];

export type PaymentMethod = 'cash' | 'ewallet';

/** One denomination and how many notes of it were accepted. */
export interface BillCount {
  denomination: number;
  count: number;
}

/** A door as presented to the kiosk UI. */
export interface DoorView {
  doorNumber: string;
  lockerLocation: string;
  doorSize: DoorSize;
  doorStatus: DoorStatus;
  alias: string;
  payType: PayType | '';
  timeIn: string | null;
  openCount: number;
}

/** Public kiosk configuration handed from a Server Component to the UI. */
export interface KioskConfig {
  appName: string;
  operatorName: string;
  currencySymbol: string;
  locale: string;
  supportEmail: string;
  supportPhone: string;
  doorRate: number;
  effectiveRate: number;
  promoActive: boolean;
  promoRate: number;
  billAcceptorEnabled: boolean;
  eWalletEnabled: boolean;
  idleTimeoutSeconds: number;
  maxAliasLength: number;
  pinLength: number;
  acceptedBills: number[];
  hardwareEnabled: boolean;
  /** Port the hardware gateway listens on; the browser pairs it with its own hostname. */
  hardwareGatewayPort: number;
}

/** A booking as returned by the API/actions. */
export interface TransactionView {
  transId: string;
  doorNumber: string;
  lockerLocation: string;
  payType: PayType | '';
  amount: number;
  bookingStatus: BookingStatus;
  timeIn: string | null;
  timeOut: string | null;
  refNumber: string;
  bills: BillCount[];
  createdAt: string;
}

export function isBookingStatus(value: unknown): value is BookingStatus {
  return typeof value === 'string' && (BOOKING_STATUSES as readonly string[]).includes(value);
}

export function isPayType(value: unknown): value is PayType {
  return value === 'CASH' || value === 'EWALLET' || value === 'PROMO';
}

/** True when the promo window is open right now. */
export function isWithinPromoWindow(
  now: Date,
  start: Date | null,
  end: Date | null,
  enabled: boolean,
): boolean {
  if (!enabled) return false;
  const time = now.getTime();
  if (start && time < start.getTime()) return false;
  if (end && time > end.getTime()) return false;
  // An enabled promo with no window means "always on".
  return true;
}
