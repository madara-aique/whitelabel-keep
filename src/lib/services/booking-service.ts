import { randomInt } from 'node:crypto';
import { connectToDatabase } from '@/lib/mongodb';
import { AuditLog } from '@/lib/models/audit-log';
import { Door, FREE_DOOR_STATE } from '@/lib/models/door';
import { Transaction, isOpenBooking } from '@/lib/models/transaction';
import { SyncQueue } from '@/lib/models/sync-queue';
import { isCommonPin } from '@/lib/config/kiosk-config';
import { openDoor as controllerOpenDoor } from '@/lib/locker-controller';
import { serverEnv } from '@/lib/env';
import type { BillCount, BookingStatus, DoorView, PayType, TransactionView } from '@/types/domain';

/**
 * Booking and door domain service.
 *
 * Every state change in the kiosk funnels through here, so the rules
 * live in one auditable place instead of being spread across a dozen
 * client-side axios chains as they were in the legacy app.
 */

export class ServiceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = 'SERVICE_ERROR',
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

function reference(prefix: string, doorNumber: string): string {
  return `${prefix}-${doorNumber}-${Date.now()}-${randomInt(1000, 9999)}`;
}

export function toDoorView(door: {
  doorNumber: string;
  lockerLocation: string;
  doorSize: string;
  doorStatus: number;
  alias?: string;
  payType?: string;
  timeIn?: Date | null;
  openCount?: number;
}): DoorView {
  return {
    doorNumber: door.doorNumber,
    lockerLocation: door.lockerLocation,
    doorSize: (door.doorSize as DoorView['doorSize']) ?? 'L',
    doorStatus: door.doorStatus === 1 ? 1 : 0,
    alias: door.alias ?? '',
    payType: (door.payType as PayType | '') ?? '',
    timeIn: door.timeIn ? door.timeIn.toISOString() : null,
    openCount: door.openCount ?? 0,
  };
}

export function toTransactionView(transaction: {
  transId: string;
  doorNumber: string;
  lockerLocation?: string;
  payType?: string;
  amount?: number;
  bookingStatus: string;
  timeIn?: Date | null;
  timeOut?: Date | null;
  refNumber?: string;
  bills?: { denomination: number; count: number }[];
  createdAt?: Date;
}): TransactionView {
  return {
    transId: transaction.transId,
    doorNumber: transaction.doorNumber,
    lockerLocation: transaction.lockerLocation ?? '',
    payType: (transaction.payType as PayType | '') ?? '',
    amount: transaction.amount ?? 0,
    bookingStatus: transaction.bookingStatus as BookingStatus,
    timeIn: transaction.timeIn ? transaction.timeIn.toISOString() : null,
    timeOut: transaction.timeOut ? transaction.timeOut.toISOString() : null,
    refNumber: transaction.refNumber ?? '',
    bills: (transaction.bills ?? []) as BillCount[],
    createdAt: (transaction.createdAt ?? new Date()).toISOString(),
  };
}

async function record(
  action: string,
  targetType: 'door' | 'transaction' | 'user' | 'system',
  targetId: string,
  actorEmail: string,
  metadata: Record<string, unknown> = {},
  succeeded = true,
  errorMessage = '',
): Promise<void> {
  // Auditing must never break the operation it is describing.
  await AuditLog.create({
    action,
    targetType,
    targetId,
    actorEmail,
    metadata,
    succeeded,
    errorMessage,
  }).catch(() => undefined);
}

/** Mirror a transaction write into the offline sync queue. */
async function enqueueSync(
  changeType: 'insert' | 'update',
  document: Record<string, unknown>,
  documentId: string,
): Promise<void> {
  await SyncQueue.create({
    changeType,
    sourceCollection: 'transactions',
    documentId,
    document,
    status: 'pending',
  }).catch(() => undefined);
}

// ── Doors ────────────────────────────────────────────────────────────

export async function listDoors(): Promise<DoorView[]> {
  await connectToDatabase();
  const doors = await Door.find({ isActive: true }).sort({ doorNumber: 1 }).lean();
  return doors.map(toDoorView);
}

export async function getDoor(doorNumber: string): Promise<DoorView | null> {
  await connectToDatabase();
  const door = await Door.findOne({ doorNumber }).lean();
  return door ? toDoorView(door) : null;
}

/**
 * Ensure a record exists for every door the controller reports.
 *
 * The legacy home screen did this on every mount from the browser; it is
 * now an explicit, idempotent operation.
 */
export async function seedDoorsFromController(
  controllerDoors: string[],
  lockerLocation: string,
  payType: PayType | '' = '',
): Promise<number> {
  if (controllerDoors.length === 0) return 0;

  await connectToDatabase();
  const existing = await Door.find({ doorNumber: { $in: controllerDoors } })
    .select('doorNumber')
    .lean();
  const known = new Set(existing.map((door) => door.doorNumber));
  const missing = controllerDoors.filter((doorNumber) => !known.has(doorNumber));

  if (missing.length === 0) return 0;

  await Door.insertMany(
    missing.map((doorNumber) => ({
      doorNumber,
      lockerLocation,
      doorSize: 'L',
      doorStatus: 0,
      payType,
    })),
    { ordered: false },
  ).catch(() => undefined);

  return missing.length;
}

/**
 * Book a door: create the transaction and reserve the door.
 *
 * Reservation happens once payment succeeds, so the customer is not
 * charged for a door that was taken in the meantime.
 */
export async function startBooking(input: {
  doorNumber: string;
  lockerLocation?: string;
  alias?: string;
  pin?: string;
}): Promise<TransactionView> {
  await connectToDatabase();

  const door = await Door.findOne({ doorNumber: input.doorNumber }).lean();
  if (!door) throw new ServiceError('Unknown door', 404, 'DOOR_NOT_FOUND');
  if (door.doorStatus === 1) throw new ServiceError('Door is already occupied', 409, 'DOOR_OCCUPIED');

  // Enforced here, not only in the UI: a Server Action is a public entry
  // point, so the guessable-PIN rule has to live on the server.
  if (input.pin && isCommonPin(input.pin)) {
    throw new ServiceError('That PIN is too easy to guess', 422, 'COMMON_PIN');
  }

  const open = await Transaction.findOne({
    doorNumber: input.doorNumber,
    bookingStatus: 'payment-pending',
  }).sort({ createdAt: -1 });

  if (open) {
    // The customer came back to an unpaid booking (for example they left
    // the payment screen and returned). Reuse it rather than stranding
    // the door behind a booking nobody will finish.
    let changed = false;
    if (input.alias && input.alias !== open.alias) {
      open.alias = input.alias;
      changed = true;
    }
    if (input.pin && input.pin !== open.qpin) {
      open.qpin = input.pin;
      changed = true;
    }
    if (changed) await open.save();
    return toTransactionView(open.toObject());
  }

  const transId = reference(serverEnv.app.referencePrefix, input.doorNumber);

  const transaction = await Transaction.create({
    transId,
    doorNumber: input.doorNumber,
    lockerLocation: input.lockerLocation || door.lockerLocation,
    doorSize: door.doorSize,
    alias: input.alias ?? '',
    qpin: input.pin ?? '',
    bookingStatus: 'payment-pending',
    transStatus: 'Active',
  });

  await enqueueSync('insert', transaction.toObject() as Record<string, unknown>, transId);

  return toTransactionView(transaction.toObject());
}

export async function getBookingByTransId(transId: string): Promise<TransactionView | null> {
  await connectToDatabase();
  const transaction = await Transaction.findOne({ transId }).lean();
  return transaction ? toTransactionView(transaction) : null;
}

export async function getActiveBookingForDoor(
  doorNumber: string,
): Promise<TransactionView | null> {
  await connectToDatabase();
  const transaction = await Transaction.findOne({
    doorNumber,
    bookingStatus: { $nin: ['completed', 'canceled', 'cleared'] },
  })
    .sort({ createdAt: -1 })
    .lean();
  return transaction ? toTransactionView(transaction) : null;
}

/**
 * Settle a booking and take the door.
 *
 * Used by both payment paths: cash once the acceptor reaches the target,
 * e-wallet once the gateway confirms. Marking the door occupied and the
 * booking paid happen together so a partially paid door cannot exist.
 */
export async function settleBooking(
  transId: string,
  input: {
    payType: PayType;
    amount: number;
    bills?: BillCount[];
    refNumber?: string;
    paymentId?: string;
  },
): Promise<{ transaction: TransactionView; doorNumber: string }> {
  await connectToDatabase();

  const transaction = await Transaction.findOne({ transId });
  if (!transaction) throw new ServiceError('Booking not found', 404, 'BOOKING_NOT_FOUND');
  // Only an unpaid booking may be settled. `ready-for-pickup` means the
  // payment already succeeded, so a retried settle must not charge again
  // or re-open an occupied door.
  if (transaction.bookingStatus !== 'payment-pending') {
    throw new ServiceError('Booking is already settled', 409, 'BOOKING_CLOSED');
  }

  const now = new Date();
  const method = input.payType === 'CASH' ? 'cash' : input.payType === 'PROMO' ? 'promo' : 'ewallet';

  transaction.payType = input.payType;
  transaction.paymentMethod = method;
  transaction.amount = Math.max(0, Math.trunc(input.amount));
  transaction.bills = (input.bills ?? []) as typeof transaction.bills;
  transaction.refNumber = input.refNumber ?? transaction.refNumber;
  transaction.paymentId = input.paymentId ?? transaction.paymentId;
  transaction.bookingStatus = 'ready-for-pickup';
  transaction.transStatus = 'Active';
  transaction.timeIn = transaction.timeIn ?? now;
  await transaction.save();

  await Door.updateOne(
    { doorNumber: transaction.doorNumber },
    {
      $set: {
        doorStatus: 1,
        alias: transaction.alias ?? '',
        payType: input.payType,
        mpin: transaction.qpin ?? '',
        currentTransactionId: transId,
        amount: transaction.amount,
        timeIn: transaction.timeIn,
        timeOut: null,
        openCount: 1,
      },
    },
  );

  await enqueueSync('update', transaction.toObject() as Record<string, unknown>, transId);

  return { transaction: toTransactionView(transaction.toObject()), doorNumber: transaction.doorNumber };
}

/** End a stay: release the door once the customer has collected their items. */
export async function completeBooking(
  transId: string,
  actorEmail = 'kiosk',
): Promise<{ doorNumber: string }> {
  await connectToDatabase();

  const transaction = await Transaction.findOne({ transId });
  if (!transaction) throw new ServiceError('Booking not found', 404, 'BOOKING_NOT_FOUND');

  transaction.bookingStatus = 'completed';
  transaction.transStatus = 'Completed';
  transaction.timeOut = new Date();
  await transaction.save();

  await Door.updateOne(
    { doorNumber: transaction.doorNumber },
    { $set: { ...FREE_DOOR_STATE, timeOut: transaction.timeOut } },
  );

  await enqueueSync('update', transaction.toObject() as Record<string, unknown>, transId);
  await record('booking.complete', 'transaction', transId, actorEmail, {
    doorNumber: transaction.doorNumber,
  });

  return { doorNumber: transaction.doorNumber };
}

/** Cancel a booking the customer abandoned before paying. */
export async function cancelBooking(transId: string): Promise<void> {
  await connectToDatabase();
  const transaction = await Transaction.findOne({ transId });
  if (!transaction || !isOpenBooking(transaction.bookingStatus)) return;

  transaction.bookingStatus = 'canceled';
  transaction.timeOut = new Date();
  await transaction.save();
  await enqueueSync('update', transaction.toObject() as Record<string, unknown>, transId);
}

/** Operator: empty and archive a door that a customer left behind. */
export async function clearDoor(doorNumber: string, actorEmail: string): Promise<void> {
  await connectToDatabase();

  const door = await Door.findOne({ doorNumber });
  if (!door) throw new ServiceError('Unknown door', 404, 'DOOR_NOT_FOUND');
  if (door.doorStatus !== 1) throw new ServiceError('Door is not occupied', 409, 'DOOR_FREE');

  const open = await Transaction.findOne({
    doorNumber,
    bookingStatus: { $nin: ['completed', 'canceled', 'cleared'] },
  }).sort({ createdAt: -1 });

  if (open) {
    open.bookingStatus = 'cleared';
    open.transStatus = 'Cleared';
    open.timeOut = open.timeOut ?? new Date();
    await open.save();
    await enqueueSync('update', open.toObject() as Record<string, unknown>, open.transId);
  }

  const opened = await controllerOpenDoor(doorNumber);
  if (!opened.ok) {
    throw new ServiceError(
      opened.error ?? 'Controller refused to open the door',
      502,
      'CONTROLLER_ERROR',
    );
  }

  await Door.updateOne({ doorNumber }, { $set: { ...FREE_DOOR_STATE } });
  await record('door.clear', 'door', doorNumber, actorEmail, { transactionId: open?.transId ?? '' });
}

/** Operator: put a closed door back into service without a new payment. */
export async function rebookDoor(doorNumber: string, actorEmail: string): Promise<void> {
  await connectToDatabase();

  const door = await Door.findOne({ doorNumber });
  if (!door) throw new ServiceError('Unknown door', 404, 'DOOR_NOT_FOUND');
  if (door.doorStatus === 1 && door.currentTransactionId) {
    throw new ServiceError(
      'Door is still occupied; clear it before rebooking',
      409,
      'DOOR_OCCUPIED',
    );
  }

  await Door.updateOne(
    { doorNumber },
    { $set: { ...FREE_DOOR_STATE, payType: serverEnv.promo.enabled ? 'PROMO' : '' } },
  );
  await record('door.rebook', 'door', doorNumber, actorEmail);
}

/** Operator: set a new customer PIN on a door. */
export async function changeDoorPin(
  doorNumber: string,
  pin: string,
  actorEmail: string,
): Promise<void> {
  if (isCommonPin(pin)) {
    throw new ServiceError('That PIN is too easy to guess', 422, 'COMMON_PIN');
  }

  await connectToDatabase();
  const door = await Door.findOne({ doorNumber }).select('+mpin');
  if (!door) throw new ServiceError('Unknown door', 404, 'DOOR_NOT_FOUND');

  door.mpin = pin;

  const open = await Transaction.findOne({
    doorNumber,
    bookingStatus: { $nin: ['completed', 'canceled', 'cleared'] },
  }).sort({ createdAt: -1 });
  if (open) {
    open.qpin = pin;
    await open.save();
  }

  door.transStatus = 'Change pin';
  await door.save();

  await record('door.change_pin', 'door', doorNumber, actorEmail, {
    transactionId: open?.transId ?? '',
    // The PIN itself is deliberately never written to the audit log.
  });
}

/** Customer: open an occupied door they have the PIN for. */
export async function openOccupiedDoor(
  doorNumber: string,
  pin: string,
): Promise<{ openCount: number }> {
  await connectToDatabase();

  const door = await Door.findOne({ doorNumber }).select('+mpin');
  if (!door) throw new ServiceError('Unknown door', 404, 'DOOR_NOT_FOUND');
  if (door.doorStatus !== 1) throw new ServiceError('Door is not in use', 409, 'DOOR_FREE');
  if (door.mpin !== pin) throw new ServiceError('PIN does not match', 401, 'PIN_MISMATCH');

  const opened = await controllerOpenDoor(doorNumber);
  if (!opened.ok) {
    throw new ServiceError(opened.error ?? 'Controller refused to open the door', 502, 'CONTROLLER_ERROR');
  }

  door.openCount += 1;
  door.transStatus = 'Active';
  await door.save();

  return { openCount: door.openCount };
}

// ── Operator listings ────────────────────────────────────────────────

/** Doors currently holding a customer's belongings. */
export async function listOccupiedDoors(): Promise<DoorView[]> {
  await connectToDatabase();
  const doors = await Door.find({ doorStatus: 1 }).sort({ doorNumber: 1 }).lean();
  return doors.map(toDoorView);
}

export async function listRecentBookings(limit = 50): Promise<TransactionView[]> {
  await connectToDatabase();
  const transactions = await Transaction.find().sort({ createdAt: -1 }).limit(limit).lean();
  return transactions.map(toTransactionView);
}
