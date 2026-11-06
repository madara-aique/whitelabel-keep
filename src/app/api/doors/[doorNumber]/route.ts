import { fail, handleRouteError, ok } from '@/lib/api/response';
import { getDoor } from '@/lib/services/booking-service';

/**
 * One door, as presented to the kiosk UI.
 *
 * `params` is a Promise in the App Router, so it is awaited before use.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ doorNumber: string }> },
) {
  try {
    const { doorNumber } = await params;

    const door = await getDoor(doorNumber);
    if (!door) return fail('Door not found', 404);

    return ok({ door });
  } catch (error) {
    return handleRouteError(error, 'doors.detail');
  }
}
