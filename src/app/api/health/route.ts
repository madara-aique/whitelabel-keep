import { fail, handleRouteError, ok } from '@/lib/api/response';
import { serverEnv } from '@/lib/env';
import { connectToDatabase, getDatabaseStatus } from '@/lib/mongodb';

/**
 * Liveness/readiness probe.
 *
 * Confirms the database is actually reachable (not merely configured)
 * and reports which hardware driver the kiosk is running with.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await connectToDatabase();

    const database = getDatabaseStatus();

    if (!database.connected) {
      return fail('Database unavailable', 503, {
        mongodb: database.state,
        readyState: database.readyState,
      });
    }

    return ok({
      status: 'ok',
      mongodb: database.state,
      readyState: database.readyState,
      hardware: {
        driver: serverEnv.hardware.driver,
        enabled: serverEnv.hardware.enabled,
      },
    });
  } catch (error) {
    // Log through the shared helper for a consistent tag, but report an
    // explicit 503 so callers can tell "unhealthy" from "broken route".
    handleRouteError(error, 'health');
    return fail('Service unavailable', 503);
  }
}
