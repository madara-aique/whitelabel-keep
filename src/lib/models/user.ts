import { Schema, model, models, type Model, type InferSchemaType } from 'mongoose';

export const USER_ROLES = ['admin', 'operator'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Operator account. The legacy app had no accounts at all — the admin
 * area was reachable by anyone who knew the URL — so this is new.
 */
const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, default: '', trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: USER_ROLES as unknown as string[], default: 'operator' },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'users' },
);

export type UserDoc = InferSchemaType<typeof userSchema>;

export const User: Model<UserDoc> =
  (models.User as Model<UserDoc>) ?? model<UserDoc>('User', userSchema);
