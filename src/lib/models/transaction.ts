import { Schema, model, models, type Model, type InferSchemaType } from 'mongoose';
import { BOOKING_STATUSES, type BookingStatus } from '@/types/domain';

const billCountSchema = new Schema(
  {
    denomination: { type: Number, required: true, min: 0 },
    count: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false },
);

/**
 * One booking attempt and its payment lifecycle.
 *
 * A single record follows the customer from "choose a payment method"
 * through to the door being cleared by an operator, so the legacy split
 * between `Transaction` and the `LockerDetails` archive is gone.
 */
const transactionSchema = new Schema(
  {
    /** Business identifier, e.g. REF-12-1730000000000. Unique per booking. */
    transId: { type: String, required: true, unique: true, trim: true },
    doorNumber: { type: String, required: true, trim: true },
    lockerLocation: { type: String, default: '', trim: true },
    doorSize: { type: String, enum: ['S', 'M', 'L'], default: 'L' },
    alias: { type: String, default: '', maxlength: 8 },
    /** Customer PIN, stored hashed-free but never selected by default. */
    qpin: { type: String, default: '', select: false },
    payType: { type: String, enum: ['', 'CASH', 'EWALLET', 'PROMO'], default: '' },
    amount: { type: Number, default: 0, min: 0 },
    bookingStatus: {
      type: String,
      enum: BOOKING_STATUSES as unknown as string[],
      default: 'payment-pending',
    },
    /** Legacy-compatible free-text status (Active, Completed, Cleared…). */
    transStatus: { type: String, default: '' },
    timeIn: { type: Date, default: null },
    timeOut: { type: Date, default: null },
    bills: { type: [billCountSchema], default: [] },
    /** Reference returned by the payment gateway, when one exists. */
    refNumber: { type: String, default: '', trim: true },
    /** Gateway payment id, used to poll or reconcile a payment. */
    paymentId: { type: String, default: '', trim: true },
    /**
     * QR payload the gateway issued for this booking. Cached so a
     * retried request shows the same QR instead of creating a second
     * payment.
     */
    paymentQr: { type: String, default: '', select: false },
    paymentMethod: { type: String, enum: ['', 'cash', 'ewallet', 'promo'], default: '' },
    /** Guards against a retried request creating a second booking. */
    idempotencyKey: { type: String, default: '', trim: true },
    posted: { type: Boolean, default: false },
    postedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'transactions' },
);

transactionSchema.index({ bookingStatus: 1, createdAt: -1 });
transactionSchema.index({ doorNumber: 1, bookingStatus: 1 });
transactionSchema.index({ posted: 1, createdAt: 1 });
transactionSchema.index({ idempotencyKey: 1 }, { sparse: true });

export type TransactionDoc = InferSchemaType<typeof transactionSchema>;

export const Transaction: Model<TransactionDoc> =
  (models.Transaction as Model<TransactionDoc>) ??
  model<TransactionDoc>('Transaction', transactionSchema);

export function isOpenBooking(status: BookingStatus | string): boolean {
  return status !== 'completed' && status !== 'canceled' && status !== 'cleared';
}
