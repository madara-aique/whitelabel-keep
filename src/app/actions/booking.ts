'use server';

import { revalidatePath } from 'next/cache';
import { runAction, type ActionResult } from '@/app/actions/_result';
import { getSessionUser } from '@/lib/auth';
import { settleBookingSchema, startBookingSchema } from '@/lib/schemas/booking';
import {
  cancelBooking,
  completeBooking,
  settleBooking,
  startBooking,
} from '@/lib/services/booking-service';
import type { TransactionView } from '@/types/domain';

/**
 * Booking Server Actions.
 *
 * The kiosk no longer POSTs to the API to create or settle a booking:
 * creation, settlement and completion are actions so the client gets a
 * typed result and a revalidated view in one round trip.
 */

/** Pages that render booking or door state and must be refreshed. */
const BOOKING_VIEWS = ['/', '/admin', '/admin/doors', '/admin/transactions'] as const;

function revalidateBookingViews(): void {
  for (const path of BOOKING_VIEWS) revalidatePath(path);
}

/** Reserve a door and open a booking that is awaiting payment. */
export async function startBookingAction(input: {
  doorNumber: string;
  lockerLocation?: string;
  alias?: string;
  pin?: string;
}): Promise<ActionResult<TransactionView>> {
  return runAction('booking.start', async () => {
    const parsed = startBookingSchema.parse(input);
    const transaction = await startBooking(parsed);
    revalidateBookingViews();
    return transaction;
  });
}

/** Attach the chosen payment method and mark the booking ready for pickup. */
export async function settleBookingAction(
  transId: string,
  input: {
    payType: 'CASH' | 'EWALLET' | 'PROMO';
    amount: number;
    bills?: { denomination: number; count: number }[];
    refNumber?: string;
    paymentId?: string;
  },
): Promise<ActionResult<{ transaction: TransactionView; doorNumber: string }>> {
  return runAction('booking.settle', async () => {
    const parsed = settleBookingSchema.parse(input);
    const result = await settleBooking(transId, parsed);
    revalidateBookingViews();
    return result;
  });
}

/** End a stay once the customer has collected their belongings. */
export async function completeBookingAction(
  transId: string,
): Promise<ActionResult<{ doorNumber: string }>> {
  return runAction('booking.complete', async () => {
    // The kiosk completes bookings anonymously, so fall back to the
    // service's own default actor when no operator is signed in.
    const user = await getSessionUser();
    const result = await completeBooking(transId, user?.email ?? 'kiosk');
    revalidateBookingViews();
    return result;
  });
}

/** Cancel a booking the customer abandoned before paying. */
export async function cancelBookingAction(
  transId: string,
): Promise<ActionResult<{ transId: string }>> {
  return runAction('booking.cancel', async () => {
    await cancelBooking(transId);
    revalidateBookingViews();
    return { transId };
  });
}
