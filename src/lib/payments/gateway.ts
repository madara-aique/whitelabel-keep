import { serverEnv } from '@/lib/env';
import { fetchWithTimeout, isRecord } from '@/lib/utils';

/**
 * E-wallet / QR payment gateway client.
 *
 * Runs server-side only: the legacy app called the gateway straight from
 * the browser using `NEXT_PUBLIC_*` variables, which exposed the
 * endpoint and let the client choose the amount. Here the server decides
 * the amount and holds the credential.
 */

export class PaymentGatewayError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'PaymentGatewayError';
  }
}

export interface CreatePaymentInput {
  amount: number;
  doorNumber: string;
  lockerLocation: string;
  merchantName: string;
  /** Stable key so a retried request cannot create a second payment. */
  idempotencyKey: string;
}

export interface CreatePaymentResult {
  paymentId: string;
  reference: string;
  /** Payload to render as a QR code. */
  qrPayload: string;
}

export type PaymentStatus = 'paid' | 'pending' | 'failed' | 'unknown';

export function isPaymentGatewayEnabled(): boolean {
  return serverEnv.paymentGateway.enabled && Boolean(serverEnv.paymentGateway.url);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/** Create a payment and obtain the QR payload the customer scans. */
export async function createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
  if (!isPaymentGatewayEnabled()) {
    throw new PaymentGatewayError('E-wallet payments are not enabled', 'GATEWAY_DISABLED');
  }

  const body = {
    amount: input.amount,
    quantity: 1,
    location: input.lockerLocation,
    name: input.merchantName,
    description: `${input.merchantName} | Door ${input.doorNumber}`,
    idempotencyKey: input.idempotencyKey,
  };

  let response: Response;
  try {
    response = await fetchWithTimeout(serverEnv.paymentGateway.url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'idempotency-key': input.idempotencyKey,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      timeoutMs: serverEnv.paymentGateway.timeoutMs,
    });
  } catch (error) {
    throw new PaymentGatewayError(
      error instanceof Error ? error.message : 'Payment gateway unreachable',
      'GATEWAY_UNREACHABLE',
      true,
    );
  }

  if (!response.ok) {
    throw new PaymentGatewayError(
      `Payment gateway returned ${response.status}`,
      'GATEWAY_REJECTED',
      response.status >= 500,
    );
  }

  const payload: unknown = await response.json();
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : payload;

  if (!isRecord(data)) {
    throw new PaymentGatewayError('Payment gateway returned an unexpected body', 'GATEWAY_BAD_RESPONSE');
  }

  const paymentId = String(data.paymentId ?? data.id ?? '');
  const qrPayload = String(data.qrEmv ?? data.qrPayload ?? data.qr ?? '');
  const reference = String(data.transNumber ?? data.reference ?? paymentId);

  if (!paymentId || !qrPayload) {
    throw new PaymentGatewayError('Payment gateway did not return a QR payload', 'GATEWAY_BAD_RESPONSE');
  }

  return { paymentId, reference, qrPayload };
}

/** Poll a single payment. Used as the fallback when the push channel is down. */
export async function getPaymentStatus(paymentId: string): Promise<PaymentStatus> {
  const base = serverEnv.paymentGateway.statusUrl || serverEnv.paymentGateway.url;
  if (!isPaymentGatewayEnabled() || !base) return 'unknown';

  const target = `${trimTrailingSlash(base)}/${encodeURIComponent(paymentId)}`;

  try {
    const response = await fetchWithTimeout(target, {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      timeoutMs: serverEnv.paymentGateway.timeoutMs,
    });

    if (!response.ok) return 'unknown';

    const payload: unknown = await response.json();
    const data = isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
    const status = isRecord(data) ? String(data.status ?? '') : '';

    if (status === 'paid' || status === 'success' || status === 'completed') return 'paid';
    if (status === 'failed' || status === 'cancelled' || status === 'canceled') return 'failed';
    if (status === 'pending' || status === 'processing') return 'pending';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
