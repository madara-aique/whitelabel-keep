import { fail, handleRouteError, methodNotAllowed, ok } from '@/lib/api/response';
import { getPaymentStatus, isPaymentGatewayEnabled } from '@/lib/payments/gateway';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/payments/[paymentId]
 *
 * Poll a single e-wallet payment. Used as the fallback when the gateway
 * push channel is unavailable. Returns only the mapped status — never
 * the raw upstream body.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ paymentId: string }> },
): Promise<Response> {
  if (!isPaymentGatewayEnabled()) {
    return fail('E-wallet payments are not enabled', 503);
  }

  try {
    const { paymentId } = await params;
    if (!paymentId) return fail('paymentId is required', 400);

    const status = await getPaymentStatus(paymentId);
    return ok({ paymentId, status });
  } catch (error) {
    return handleRouteError(error, 'GET /api/payments/[paymentId]');
  }
}

export function POST(): Response {
  return methodNotAllowed(['GET']);
}
