import { z } from 'zod';
import { handleRouteError, ok } from '@/lib/api/response';
import { listDoors } from '@/lib/services/booking-service';
import type { DoorStatus } from '@/types/domain';

/**
 * Door listing for the kiosk grid and operator screens.
 *
 * Reads the service, never the controller, so the response reflects the
 * door state stored with the bookings rather than the raw hardware.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `?status=0|1` narrows the list to free or occupied doors. */
const doorsQuerySchema = z.object({
  status: z.enum(['0', '1']).optional(),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const { status } = doorsQuerySchema.parse({
      status: searchParams.get('status') ?? undefined,
    });

    const wanted: DoorStatus | undefined =
      status === undefined ? undefined : status === '1' ? 1 : 0;

    const doors = await listDoors();
    const filtered = wanted === undefined ? doors : doors.filter((door) => door.doorStatus === wanted);

    return ok({ doors: filtered, count: filtered.length });
  } catch (error) {
    return handleRouteError(error, 'doors.list');
  }
}
