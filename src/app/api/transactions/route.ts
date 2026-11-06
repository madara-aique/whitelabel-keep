import { handleRouteError, methodNotAllowed, ok } from '@/lib/api/response';
import { listBookingsQuerySchema } from '@/lib/schemas/booking';
import { getActiveBookingForDoor, listRecentBookings } from '@/lib/services/booking-service';
import type { TransactionView } from '@/types/domain';

/**
 * Booking listing.
 *
 * Bookings are created by a Server Action, not by POSTing here, so only
 * GET is implemented; a POST is answered with 405 and an `Allow` header.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = listBookingsQuerySchema.parse({
      doorNumber: searchParams.get('doorNumber') ?? undefined,
      bookingStatus: searchParams.get('bookingStatus') ?? undefined,
      payType: searchParams.get('payType') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
    });

    let transactions: TransactionView[];
    if (query.doorNumber) {
      // The kiosk only ever cares about the open booking for a door.
      const active = await getActiveBookingForDoor(query.doorNumber);
      transactions = active ? [active] : [];
    } else {
      transactions = await listRecentBookings(query.limit);
    }

    if (query.bookingStatus) {
      transactions = transactions.filter(
        (transaction) => transaction.bookingStatus === query.bookingStatus,
      );
    }

    return ok({ transactions, count: transactions.length });
  } catch (error) {
    return handleRouteError(error, 'transactions.list');
  }
}

export async function POST() {
  try {
    return methodNotAllowed(['GET']);
  } catch (error) {
    return handleRouteError(error, 'transactions.create');
  }
}
