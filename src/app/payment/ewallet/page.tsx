import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EWalletPayment } from '@/components/kiosk/ewallet-payment';
import { Alert } from '@/components/ui';
import { getKioskConfig } from '@/lib/config/kiosk-config';
import { getBookingByTransId } from '@/lib/services/booking-service';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

/** Search params can repeat; the kiosk always wants a single string. */
function readParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/** Fallback destination when this screen cannot proceed. */
function selectionHref(params: {
  transId: string;
  doorNumber: string;
  lockerLocation: string;
  alias: string;
  pin: string;
}): string {
  const query = new URLSearchParams();
  if (params.transId) query.set('transId', params.transId);
  if (params.doorNumber) query.set('doorNumber', params.doorNumber);
  if (params.lockerLocation) query.set('lockerLocation', params.lockerLocation);
  if (params.alias) query.set('alias', params.alias);
  if (params.pin) query.set('pin', params.pin);
  const search = query.toString();
  return search ? `/payment-selection?${search}` : '/payment-selection';
}

/**
 * E-wallet payment route (Server Component).
 *
 * Decides whether the QR flow may run at all, then resolves the booking
 * before the client component starts talking to the gateway.
 */
export default async function EWalletPaymentPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  const transId = readParam(params.transId).trim();
  const requestedDoorNumber = readParam(params.doorNumber).trim();
  const requestedLocation = readParam(params.lockerLocation).trim();
  const alias = readParam(params.alias).trim();
  const pin = readParam(params.pin).trim();

  if (!requestedDoorNumber) redirect('/');

  const backHref = selectionHref({
    transId,
    doorNumber: requestedDoorNumber,
    lockerLocation: requestedLocation,
    alias,
    pin,
  });

  const config = getKioskConfig();

  if (!config.eWalletEnabled) {
    return (
      <main className="kiosk-shell">
        <div className="mx-auto w-full max-w-xl space-y-6">
          <Alert tone="warning" title="E-wallet payment is unavailable at this kiosk">
            <p>
              This kiosk is not connected to an e-wallet payment provider. Please choose another
              payment method, or ask a member of staff for help.
            </p>
          </Alert>
          <Link
            href={backHref}
            className="inline-flex min-h-touch items-center justify-center rounded-xl bg-brand-600 px-7 text-lg font-semibold text-white active:bg-brand-700"
          >
            Back to payment options
          </Link>
        </div>
      </main>
    );
  }

  const booking = transId ? await getBookingByTransId(transId).catch(() => null) : null;

  if (!booking || booking.bookingStatus !== 'payment-pending') {
    redirect(backHref);
  }

  return (
    <main className="kiosk-shell">
      <EWalletPayment
        transId={booking.transId}
        doorNumber={booking.doorNumber || requestedDoorNumber}
        lockerLocation={booking.lockerLocation || requestedLocation}
        alias={alias}
        pin={pin}
      />
    </main>
  );
}
