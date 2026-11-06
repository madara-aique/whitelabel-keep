import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Card, CardBody, CardHeader, CardTitle } from '@/components/ui';
import { formatAmount } from '@/lib/config/kiosk-config';
import { serverEnv } from '@/lib/env';
import { listDoors, listOccupiedDoors, listRecentBookings } from '@/lib/services/booking-service';
import { CLOSED_BOOKING_STATUSES, type BookingStatus, type TransactionView } from '@/types/domain';

/**
 * Operator dashboard.
 *
 * Every figure is computed on the server at request time, so the page
 * renders with live locker state in the HTML and the browser makes no
 * extra call to show it.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Dashboard' };

/** Booking-derived figures are only as complete as this window. */
const RECENT_BOOKING_LIMIT = 200;

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: serverEnv.app.timeZone });

function dayKey(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : dayFormat.format(date);
}

function isOpenBooking(status: BookingStatus): boolean {
  return !CLOSED_BOOKING_STATUSES.includes(status);
}

function isSettledBooking(status: BookingStatus): boolean {
  return status === 'ready-for-pickup' || status === 'completed' || status === 'cleared';
}

/** A booking counts towards today when it was settled earlier today. */
function settledToday(booking: TransactionView, today: string): boolean {
  if (!isSettledBooking(booking.bookingStatus)) return false;
  return booking.timeIn === null ? dayKey(booking.createdAt) === today : dayKey(booking.timeIn) === today;
}

const TOOLS = [
  {
    href: '/admin/rebook',
    title: 'Rebook a door',
    body: 'Put a closed door back into service without taking a new payment.',
  },
  {
    href: '/admin/forgot-pin',
    title: 'Forgot PIN',
    body: 'Set a new pickup PIN for a customer who cannot open their locker.',
  },
  {
    href: '/admin/clear',
    title: 'Clear doors',
    body: 'Empty a locker a customer left behind, or sweep every door at once.',
  },
] as const;

export default async function AdminDashboardPage() {
  const [doorsResult, occupiedResult, recentResult] = await Promise.all([
    listDoors().catch(() => null),
    listOccupiedDoors().catch(() => null),
    listRecentBookings(RECENT_BOOKING_LIMIT).catch(() => null),
  ]);

  const doors = doorsResult ?? [];
  const occupiedDoors = occupiedResult ?? [];
  const recent = recentResult ?? [];
  const degraded = doorsResult === null || occupiedResult === null || recentResult === null;

  // Fall back to the full door list when the occupied query failed, so a
  // partially readable database still produces a meaningful split.
  const occupiedCount =
    occupiedResult === null
      ? doors.filter((door) => door.doorStatus === 1).length
      : occupiedDoors.length;
  const freeCount = doorsResult === null ? null : Math.max(0, doors.length - occupiedCount);

  const openBookings = recent.filter((booking) => isOpenBooking(booking.bookingStatus));
  const today = dayFormat.format(new Date());
  const todaysSettled = recent.filter((booking) => settledToday(booking, today));
  const todaysSettledTotal = todaysSettled.reduce((total, booking) => total + booking.amount, 0);

  const stats: { label: string; value: string; hint: string; money?: number }[] = [
    {
      label: 'Occupied doors',
      value: occupiedCount.toLocaleString('en-US'),
      hint: 'Holding a customer’s belongings right now',
    },
    {
      label: 'Free doors',
      value: freeCount === null ? '—' : freeCount.toLocaleString('en-US'),
      hint: 'Available for the next booking',
    },
    {
      label: 'Open bookings',
      value: openBookings.length.toLocaleString('en-US'),
      hint: `Awaiting payment or pickup, within the latest ${RECENT_BOOKING_LIMIT} bookings`,
    },
    {
      label: 'Settled today',
      value: todaysSettled.length.toLocaleString('en-US'),
      hint: 'Paid bookings recorded today',
      money: todaysSettledTotal,
    },
  ];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="kiosk-heading">Operator dashboard</h1>
        <p className="kiosk-label mt-2">Live locker state for this kiosk.</p>
      </header>

      {degraded ? (
        <Alert tone="warning" title="Some live data could not be loaded">
          Locker counts may be incomplete. Check the database connection, then reload this page.
        </Alert>
      ) : null}

      <section aria-label="Locker totals" className="grid gap-4 sm:grid-cols-2">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardBody>
              <p className="text-sm font-medium uppercase tracking-wide text-kiosk-muted">
                {stat.label}
              </p>
              <p className="mt-2 text-4xl font-semibold tabular-nums text-white">{stat.value}</p>
              {typeof stat.money === 'number' ? (
                <p className="mt-1 text-lg text-brand-300">{formatAmount(stat.money)}</p>
              ) : null}
              <p className="mt-2 text-sm text-kiosk-muted">{stat.hint}</p>
            </CardBody>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Operator tools</CardTitle>
        </CardHeader>
        <CardBody>
          <ul className="grid gap-4 sm:grid-cols-3">
            {TOOLS.map((tool) => (
              <li key={tool.href}>
                <Link
                  href={tool.href}
                  className="block h-full rounded-2xl border border-kiosk-border bg-kiosk-bg p-4 transition hover:border-brand-400"
                >
                  <span className="block text-lg font-semibold text-white">{tool.title}</span>
                  <span className="mt-2 block text-sm text-kiosk-muted">{tool.body}</span>
                </Link>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <p className="text-sm text-kiosk-muted">
        Booking figures cover the latest {RECENT_BOOKING_LIMIT} bookings and use the kiosk time zone (
        {serverEnv.app.timeZone}).
      </p>
    </div>
  );
}
