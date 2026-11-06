import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Card, CardBody, CardHeader, CardTitle } from '@/components/ui';
import { cn } from '@/lib/utils';
import { serverEnv } from '@/lib/env';
import { getActiveBookingForDoor, listOccupiedDoors } from '@/lib/services/booking-service';

/**
 * Forgot-PIN tool.
 *
 * The stored pickup PIN is deliberately never read and never rendered —
 * the legacy screen printed the plaintext PIN into the page and hid it
 * with CSS, which a view-source or a saved HTML file defeats. This page
 * only reports whether a door currently has an active pickup booking
 * (and therefore a PIN on file) and links to the reset screen.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Forgot PIN' };

const dateTimeFormat = new Intl.DateTimeFormat(serverEnv.app.locale, {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: serverEnv.app.timeZone,
});

function formatDateTime(iso: string | null): string {
  if (!iso) return 'not recorded';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'not recorded' : dateTimeFormat.format(date);
}

export default async function ForgotPinPage() {
  const occupiedResult = await listOccupiedDoors().catch(() => null);
  const occupied = occupiedResult ?? [];
  const degraded = occupiedResult === null;

  // Doors holding a settled booking are the ones where a customer PIN is
  // in force. Only the boolean leaves the service layer.
  const doorsWithPin = new Set<string>();
  if (occupiedResult !== null) {
    const states = await Promise.all(
      occupied.map(async (door) => {
        const booking = await getActiveBookingForDoor(door.doorNumber).catch(() => null);
        return {
          doorNumber: door.doorNumber,
          pinOnFile: booking !== null && booking.bookingStatus === 'ready-for-pickup',
        };
      }),
    );

    for (const state of states) {
      if (state.pinOnFile) doorsWithPin.add(state.doorNumber);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="kiosk-heading">Forgot PIN</h1>
        <p className="kiosk-label mt-2">
          Lockers currently in use. Issue a new pickup PIN for a customer who cannot open theirs.
        </p>
      </header>

      <Alert tone="info" title="PIN values are never shown">
        This screen never reads or displays a stored PIN. Set a fresh one instead, then tell it to the
        customer.
      </Alert>

      {degraded ? (
        <Alert tone="warning" title="Some data could not be loaded">
          The occupied-door list could not be read, so it may be incomplete.
        </Alert>
      ) : null}

      {occupied.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No lockers in use</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-kiosk-muted">
              Every locker is free, so there is no pickup PIN to reset right now.
            </p>
          </CardBody>
        </Card>
      ) : (
        <ul className="space-y-4">
          {occupied.map((door) => {
            const pinOnFile = doorsWithPin.has(door.doorNumber);

            return (
              <li key={door.doorNumber}>
                <Card>
                  <CardBody>
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <p className="text-2xl font-semibold text-white">
                          Locker {door.lockerLocation}
                          {door.doorNumber}
                        </p>
                        <p className="mt-1 text-sm text-kiosk-muted">
                          Alias: {door.alias || 'not set'} · In use since {formatDateTime(door.timeIn)}
                        </p>
                        <p className="mt-2">
                          <span
                            className={cn(
                              'inline-block rounded-full px-3 py-1 text-sm font-medium',
                              pinOnFile
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : 'bg-warning/15 text-warning',
                            )}
                          >
                            {pinOnFile ? 'Pickup PIN on file' : 'No pickup PIN recorded'}
                          </span>
                        </p>
                      </div>

                      <Link
                        href={`/admin/change-pin?doorNumber=${encodeURIComponent(door.doorNumber)}`}
                        className="inline-flex min-h-touch items-center rounded-2xl bg-brand-600 px-5 text-base font-medium text-white transition hover:bg-brand-700"
                      >
                        Change PIN
                      </Link>
                    </div>
                  </CardBody>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
