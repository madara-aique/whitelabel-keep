import { redirect } from 'next/navigation';
import { PaymentMethodPicker } from '@/components/kiosk/payment-method-picker';
import { getBookingByTransId, getDoor } from '@/lib/services/booking-service';

/**
 * Payment method screen — a Server Component.
 *
 * Resolves the booking server-side so a transaction id that no longer
 * exists cannot carry the customer into a payment flow with nothing to
 * settle. Availability of each payment method is published to the client
 * by the kiosk provider, so the picker reads `eWalletEnabled` and
 * `billAcceptorEnabled` from `useKiosk()` rather than being handed them
 * again as props.
 */
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

/** Query values arrive as `string | string[] | undefined`; flatten to string. */
function readParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return (value[0] ?? '').trim();
  return (value ?? '').trim();
}

export default async function PaymentSelectionPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  const doorNumber = readParam(params.doorNumber);
  const requestedTransId = readParam(params.transId);
  const queriedLocation = readParam(params.lockerLocation);
  const alias = readParam(params.alias);
  const pin = readParam(params.pin);

  if (!doorNumber) redirect('/');

  const [booking, door] = await Promise.all([
    requestedTransId ? getBookingByTransId(requestedTransId) : Promise.resolve(null),
    getDoor(doorNumber),
  ]);

  // A booking that belongs to another locker would settle the wrong door, so
  // a mismatched link is treated as no booking at all.
  if (booking && booking.doorNumber !== doorNumber) redirect('/');

  return (
    <main className="kiosk-shell">
      <PaymentMethodPicker
        transId={booking?.transId ?? null}
        doorNumber={doorNumber}
        lockerLocation={queriedLocation || booking?.lockerLocation || door?.lockerLocation || ''}
        alias={alias}
        pin={pin}
      />
    </main>
  );
}
