import { fail, handleRouteError, ok } from '@/lib/api/response';
import { serverEnv } from '@/lib/env';
import { issueHardwareToken } from '@/lib/hardware/token';

/**
 * Issue a short-lived hardware session token.
 *
 * The browser never receives the long-lived hardware access key; it
 * receives a scoped token that expires in minutes and can only be used
 * against this kiosk's gateway.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (!serverEnv.hardware.enabled) {
      return fail('Hardware gateway is disabled', 503);
    }

    return ok({
      token: issueHardwareToken(),
      expiresInSeconds: serverEnv.hardware.sessionTtlSeconds,
      gatewayPort: serverEnv.hardware.socketPort,
    });
  } catch (error) {
    return handleRouteError(error, 'hardware.token');
  }
}
