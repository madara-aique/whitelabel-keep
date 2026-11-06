import { redirect } from 'next/navigation';
import { CashPayment } from '@/components/kiosk/cash-payment';
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
 * Cash payment route (Server Component).
 *
 * Resolves the query string and the booking before any hardware code
 * runs, so a stale or already-settled link can never open the acceptor.
 */
export default async function CashPaymentPage({
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

  const booking = transId ? await getBookingByTransId(transId).catch(() => null) : null;

  if (!booking || booking.bookingStatus !== 'payment-pending') {
    redirect(
      selectionHref({
        transId,
        doorNumber: requestedDoorNumber,
        lockerLocation: requestedLocation,
        alias,
        pin,
      }),
    );
  }

  return (
    <main className="kiosk-shell">
      <CashPayment
        transId={booking.transId}
        doorNumber={booking.doorNumber || requestedDoorNumber}
        lockerLocation={booking.lockerLocation || requestedLocation}
        alias={alias}
        pin={pin}
      />
    </main>
  );
}
