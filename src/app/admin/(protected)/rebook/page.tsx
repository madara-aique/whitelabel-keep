import type { Metadata } from 'next';
import Link from 'next/link';
import { DoorActionButton } from '@/components/admin/door-action-button';
import { Alert, Card, CardBody, CardHeader, CardTitle } from '@/components/ui';
import { serverEnv } from '@/lib/env';
import { listOccupiedDoors, listRecentBookings } from '@/lib/services/booking-service';
import type { BookingStatus, TransactionView } from '@/types/domain';

/**
 * Rebook tool.
 *
 * A door is a rebook candidate when it is not currently occupied but its
 * most recent booking is closed: the customer took their belongings (or
 * an operator cleared the door) and the door needs to be put back into
 * service.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Rebook doors' };

/** The candidate list is derived from this many recent bookings. */
const RECENT_BOOKING_LIMIT = 200;

const dateTimeFormat = new Intl.DateTimeFormat(serverEnv.app.locale, {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: serverEnv.app.timeZone,
});

function formatDateTime(iso: string | null): string {
  if (!iso) return 'no timestamp';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'no timestamp' : dateTimeFormat.format(date);
}

function statusLabel(status: BookingStatus): string {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'cleared':
      return 'cleared by an operator';
    case 'canceled':
      return 'canceled';
    case 'ready-for-pickup':
      return 'ready for pickup';
    default:
      return 'awaiting payment';
  }
}

export default async function RebookPage() {
  const [recentResult, occupiedResult] = await Promise.all([
    listRecentBookings(RECENT_BOOKING_LIMIT).catch(() => null),
    listOccupiedDoors().catch(() => null),
  ]);

  const recent = recentResult ?? [];
  const occupied = occupiedResult ?? [];
  const degraded = recentResult === null || occupiedResult === null;

  const occupiedDoors = new Set(occupied.map((door) => door.doorNumber));

  // `listRecentBookings` is newest first, so the first entry per door is
  // that door's last booking.
  const lastBookingByDoor = new Map<string, TransactionView>();
  for (const booking of recent) {
    if (!lastBookingByDoor.has(booking.doorNumber)) {
      lastBookingByDoor.set(booking.doorNumber, booking);
    }
  }

  const candidates = Array.from(lastBookingByDoor.values())
    .filter(
      (booking) =>
        !occupiedDoors.has(booking.doorNumber) &&
        (booking.bookingStatus === 'completed' || booking.bookingStatus === 'cleared'),
    )
    .sort((a, b) => a.doorNumber.localeCompare(b.doorNumber, 'en', { numeric: true }));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="kiosk-heading">Rebook doors</h1>
        <p className="kiosk-label mt-2">
          Free lockers whose last booking is closed. Rebooking puts a locker back into service without
          taking a new payment.
        </p>
      </header>

      {degraded ? (
        <Alert tone="warning" title="Some data could not be loaded">
          The candidate list may be incomplete because the recent bookings or the occupied-door list
          could not be read. Do not rebook a locker you have not checked physically.
        </Alert>
      ) : null}

      {candidates.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nothing to rebook</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="space-y-3">
              <p className="text-kiosk-muted">
                No free locker has a closed booking in the latest {RECENT_BOOKING_LIMIT} bookings.
              </p>
              <p className="text-sm text-kiosk-muted">
                A locker that is still occupied has to be cleared first.{' '}
                <Link href="/admin/clear" className="text-brand-300 underline">
                  Open the clear tool
                </Link>
                .
              </p>
            </div>
          </CardBody>
        </Card>
      ) : (
        <ul className="space-y-4">
          {candidates.map((booking) => (
            <li key={booking.doorNumber}>
              <Card>
                <CardBody>
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="text-2xl font-semibold text-white">Locker {booking.doorNumber}</p>
                      <p className="mt-1 text-sm text-kiosk-muted">
                        Last booking {statusLabel(booking.bookingStatus)} ·{' '}
                        {formatDateTime(booking.timeOut ?? booking.timeIn ?? booking.createdAt)}
                      </p>
                      <p className="mt-1 text-sm text-kiosk-muted">Reference {booking.transId}</p>
                    </div>
                    <DoorActionButton
                      doorNumber={booking.doorNumber}
                      action="rebook"
                      label="Rebook"
                      confirmTitle={`Rebook locker ${booking.doorNumber}?`}
                      confirmBody="The locker returns to the available pool straight away. Only do this once the locker has been emptied and checked."
                    />
                  </div>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
