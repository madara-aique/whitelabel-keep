import { notFound, redirect } from 'next/navigation';
import { DetailsForm } from '@/components/kiosk/details-form';
import { getActiveBookingForDoor, getDoor } from '@/lib/services/booking-service';
import type { DoorView } from '@/types/domain';

/**
 * Locker details screen — a Server Component.
 *
 * The door is resolved on the server so the screen renders with real data
 * in the HTML, and the customer never sees a flash of an empty form. Only
 * the form itself is client-side.
 */
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

/** Query values arrive as `string | string[] | undefined`; flatten to string. */
function readParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return (value[0] ?? '').trim();
  return (value ?? '').trim();
}

export default async function DetailsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  const doorNumber = readParam(params.doorNumber);
  const queriedLocation = readParam(params.lockerLocation);
  const queriedAlias = readParam(params.alias);
  const queriedStatus = readParam(params.doorStatus);

  if (!doorNumber) redirect('/');

  const record = await getDoor(doorNumber);
  if (!record) notFound();

  const activeBooking = await getActiveBookingForDoor(doorNumber);

  // The query carries what the grid knew when the locker was tapped; the
  // door record stays authoritative, so the mode always follows the live
  // `doorStatus` and a door cleared mid-flow cannot send the customer down
  // the returning path. The occupancy hint only scopes the alias fallback,
  // because a meaningful locker name is only ever passed for a used locker.
  const aliasFromQuery = queriedStatus === '1' ? queriedAlias : '';

  const door: DoorView = {
    ...record,
    lockerLocation: queriedLocation || record.lockerLocation,
    alias: record.alias || aliasFromQuery,
  };

  return (
    <main className="kiosk-shell">
      <DetailsForm door={door} activeBooking={activeBooking} />
    </main>
  );
}
