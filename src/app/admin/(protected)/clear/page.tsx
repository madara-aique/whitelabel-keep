import type { Metadata } from 'next';
import { ClearAllButton } from '@/components/admin/clear-all-button';
import { DoorActionButton } from '@/components/admin/door-action-button';
import { Alert, Card, CardBody, CardHeader, CardTitle } from '@/components/ui';
import { serverEnv } from '@/lib/env';
import { listOccupiedDoors } from '@/lib/services/booking-service';

/**
 * Clear tool.
 *
 * Clearing archives the booking, opens the lock through the controller and
 * frees the door, so every row carries an explicit confirmation. The
 * sweep at the top does the same for every occupied door at once and
 * reports the locks it could not clear.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Clear doors' };

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

export default async function ClearDoorsPage() {
  const occupiedResult = await listOccupiedDoors().catch(() => null);
  const occupied = occupiedResult ?? [];
  const degraded = occupiedResult === null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="kiosk-heading">Clear doors</h1>
        <p className="kiosk-label mt-2">
          Empty a locker a customer left behind. Clearing opens the lock, archives the booking and
          frees the locker for the next customer.
        </p>
      </header>

      {degraded ? (
        <Alert tone="warning" title="The door list could not be loaded">
          Occupied lockers may be missing from this page. Check the database connection before clearing
          anything.
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Emergency sweep</CardTitle>
        </CardHeader>
        <CardBody>
          <ClearAllButton />
        </CardBody>
      </Card>

      <section aria-label="Occupied lockers" className="space-y-4">
        <h2 className="text-xl font-semibold text-white">
          Occupied lockers ({occupied.length.toLocaleString('en-US')})
        </h2>

        {occupied.length === 0 ? (
          <Card>
            <CardBody>
              <p className="text-kiosk-muted">No locker is currently in use.</p>
            </CardBody>
          </Card>
        ) : (
          <ul className="space-y-4">
            {occupied.map((door) => (
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
                          Alias: {door.alias || 'not set'} · Time in: {formatDateTime(door.timeIn)}
                        </p>
                        <p className="mt-1 text-sm text-kiosk-muted">
                          Openings recorded: {door.openCount.toLocaleString('en-US')}
                        </p>
                      </div>
                      <DoorActionButton
                        doorNumber={door.doorNumber}
                        action="clear"
                        label="Clear door"
                        confirmTitle={`Clear locker ${door.doorNumber}?`}
                        confirmBody="The lock is energised, the booking is archived as cleared and the locker becomes available. Make sure the locker is empty and nobody is standing at the kiosk."
                      />
                    </div>
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
