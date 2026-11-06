import { Schema, model, models, type Model, type InferSchemaType } from 'mongoose';

/**
 * Live state of one physical door.
 *
 * This replaces the legacy json-server `LocalDatabase` collection: the
 * MPIN is stored `select: false` so it cannot leak into a list response
 * by accident.
 */
const doorSchema = new Schema(
  {
    doorNumber: { type: String, required: true, unique: true, trim: true },
    lockerLocation: { type: String, required: true, trim: true },
    doorSize: { type: String, enum: ['S', 'M', 'L'], default: 'L' },
    doorStatus: { type: Number, enum: [0, 1], default: 0 },
    alias: { type: String, default: '', maxlength: 8 },
    payType: { type: String, enum: ['', 'CASH', 'EWALLET', 'PROMO'], default: '' },
    /** Customer PIN. Never selected unless explicitly asked for. */
    mpin: { type: String, default: '', select: false },
    currentTransactionId: { type: String, default: '' },
    amount: { type: Number, default: 0, min: 0 },
    openCount: { type: Number, default: 0, min: 0 },
    timeIn: { type: Date, default: null },
    timeOut: { type: Date, default: null },
    /** Free-text status mirroring the booking vocabulary (Active, Completed…). */
    transStatus: { type: String, default: '', trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'doors' },
);

doorSchema.index({ doorStatus: 1, lockerLocation: 1 });
doorSchema.index({ currentTransactionId: 1 });

export type DoorDoc = InferSchemaType<typeof doorSchema>;

export const Door: Model<DoorDoc> =
  (models.Door as Model<DoorDoc>) ?? model<DoorDoc>('Door', doorSchema);

/** Fields that put a door back into service. */
export const FREE_DOOR_STATE = {
  doorStatus: 0,
  alias: '',
  payType: '',
  mpin: '',
  currentTransactionId: '',
  amount: 0,
  timeIn: null,
  timeOut: null,
  transStatus: '',
} as const;
