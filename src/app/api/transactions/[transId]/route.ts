import { fail, handleRouteError, ok } from '@/lib/api/response';
import { requireSessionUser, type SessionUser } from '@/lib/auth';
import { updateBookingSchema } from '@/lib/schemas/booking';
import {
  cancelBooking,
  completeBooking,
  getBookingByTransId,
} from '@/lib/services/booking-service';

/**
 * One booking, plus the operator status transition.
 *
 * Only the transitions the domain service supports are accepted here:
 * `completed` releases the door, `canceled` abandons an unpaid booking.
 * Anything else is rejected rather than written straight to the model.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ transId: string }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { transId } = await params;

    const transaction = await getBookingByTransId(transId);
    if (!transaction) return fail('Booking not found', 404);

    return ok({ transaction });
  } catch (error) {
    return handleRouteError(error, 'transactions.detail.get');
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { transId } = await params;

    let user: SessionUser;
    try {
      user = await requireSessionUser();
    } catch {
      return fail('Unauthorized', 401);
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return fail('Invalid JSON body', 400);
    }

    const input = updateBookingSchema.parse(payload);

    const existing = await getBookingByTransId(transId);
    if (!existing) return fail('Booking not found', 404);

    if (input.bookingStatus === 'completed') {
      await completeBooking(transId, user.email);
    } else if (input.bookingStatus === 'canceled') {
      await cancelBooking(transId);
    } else {
      return fail('Unsupported booking status transition', 422, {
        bookingStatus: input.bookingStatus,
        supported: ['completed', 'canceled'],
      });
    }

    const transaction = await getBookingByTransId(transId);
    if (!transaction) return fail('Booking not found', 404);

    return ok({ transaction });
  } catch (error) {
    return handleRouteError(error, 'transactions.detail.patch');
  }
}
