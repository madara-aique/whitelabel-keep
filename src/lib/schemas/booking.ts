import { z } from 'zod';
import { serverEnv } from '@/lib/env';
import { BOOKING_STATUSES } from '@/types/domain';

const doorNumber = z.string().trim().min(1).max(32);
const pin = z
  .string()
  .regex(new RegExp(`^\\d{${serverEnv.kiosk.pinLength}}$`), `PIN must be ${serverEnv.kiosk.pinLength} digits`);

/** Create a booking as soon as a door and payment choice are known. */
export const startBookingSchema = z.object({
  doorNumber,
  lockerLocation: z.string().trim().max(64).optional().default(''),
  alias: z.string().trim().max(serverEnv.kiosk.maxAliasLength).optional().default(''),
  pin: pin.optional(),
});

export type StartBookingInput = z.infer<typeof startBookingSchema>;

/** Attach the chosen payment method and complete the booking. */
export const settleBookingSchema = z.object({
  payType: z.enum(['CASH', 'EWALLET', 'PROMO']),
  amount: z.number().int().min(0),
  bills: z
    .array(
      z.object({
        denomination: z.number().int().positive(),
        count: z.number().int().min(0),
      }),
    )
    .optional()
    .default([]),
  refNumber: z.string().trim().max(64).optional().default(''),
  paymentId: z.string().trim().max(64).optional().default(''),
});

export type SettleBookingInput = z.infer<typeof settleBookingSchema>;

/** General-purpose status transition used by admin tooling. */
export const updateBookingSchema = z.object({
  bookingStatus: z.enum(BOOKING_STATUSES as unknown as [string, ...string[]]),
  payType: z.enum(['CASH', 'EWALLET', 'PROMO']).optional(),
  amount: z.number().int().min(0).optional(),
  timeOut: z.string().datetime().optional(),
  refNumber: z.string().trim().max(64).optional(),
});

export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;

/** Customer PIN reset performed by an operator. */
export const changePinSchema = z.object({
  doorNumber,
  pin,
  transStatus: z.string().trim().max(32).optional(),
});

export type ChangePinInput = z.infer<typeof changePinSchema>;

/** Query parameters for listing bookings. */
export const listBookingsQuerySchema = z.object({
  doorNumber: doorNumber.optional(),
  bookingStatus: z.string().trim().optional(),
  payType: z.enum(['CASH', 'EWALLET', 'PROMO', '']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

export const doorQuerySchema = z.object({
  doorNumber,
});
