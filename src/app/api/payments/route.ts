import { z } from 'zod';
import { created, fail, handleRouteError, methodNotAllowed } from '@/lib/api/response';
import { getKioskConfig } from '@/lib/config/kiosk-config';
import { connectToDatabase } from '@/lib/mongodb';
import { Transaction, isOpenBooking } from '@/lib/models/transaction';
import { createPayment, isPaymentGatewayEnabled, PaymentGatewayError } from '@/lib/payments/gateway';
import { serverEnv } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createPaymentSchema = z.object({
  transId: z.string().trim().min(1),
  doorNumber: z.string().trim().min(1),
  lockerLocation: z.string().trim().max(64).optional().default(''),
});

/**
 * POST /api/payments
 *
 * Start an e-wallet payment for a booking.
 *
 * The amount is decided here, from server configuration — never by the
 * client — and an existing QR is reused so a retry cannot produce two
 * charges for one booking.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isPaymentGatewayEnabled()) {
    return fail('E-wallet payments are not enabled', 503);
  }

  try {
    const body = createPaymentSchema.parse(await request.json());
    await connectToDatabase();

    const transaction = await Transaction.findOne({ transId: body.transId }).select('+paymentQr');
    if (!transaction) return fail('Booking not found', 404);
    if (!isOpenBooking(transaction.bookingStatus)) {
      return fail('This booking is already settled', 409);
    }
    if (transaction.doorNumber !== body.doorNumber) {
      return fail('Booking does not belong to that door', 400);
    }

    // Reuse an in-flight payment rather than creating a second one.
    if (transaction.paymentId && transaction.paymentQr) {
      return created({
        paymentId: transaction.paymentId,
        reference: transaction.refNumber,
        qrPayload: transaction.paymentQr,
        amount: transaction.amount,
        reused: true,
      });
    }

    const config = getKioskConfig();
    const amount = config.effectiveRate;

    const payment = await createPayment({
      amount,
      doorNumber: body.doorNumber,
      lockerLocation: body.lockerLocation || transaction.lockerLocation || '',
      merchantName: config.operatorName,
      idempotencyKey: transaction.transId,
    });

    transaction.paymentId = payment.paymentId;
    transaction.paymentQr = payment.qrPayload;
    transaction.refNumber = payment.reference;
    transaction.amount = amount;
    transaction.payType = 'EWALLET';
    transaction.paymentMethod = 'ewallet';
    await transaction.save();

    return created({
      paymentId: payment.paymentId,
      reference: payment.reference,
      qrPayload: payment.qrPayload,
      amount,
      reused: false,
    });
  } catch (error) {
    if (error instanceof PaymentGatewayError) {
      return fail(error.message, error.retryable ? 502 : 400);
    }
    return handleRouteError(error, `POST /api/payments (gateway=${serverEnv.paymentGateway.url})`);
  }
}

export function GET(): Response {
  return methodNotAllowed(['POST']);
}
