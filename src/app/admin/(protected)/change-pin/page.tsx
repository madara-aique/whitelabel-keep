import type { Metadata } from 'next';
import Link from 'next/link';
import { ChangePinForm } from '@/components/admin/change-pin-form';
import { Alert, Card, CardBody, CardHeader, CardTitle } from '@/components/ui';
import { getDoor } from '@/lib/services/booking-service';

/**
 * Change-PIN screen.
 *
 * The door comes from the query string, so the operator can reach it from
 * the forgot-PIN list. `searchParams` is a Promise in Next 16 and must be
 * awaited. The stored PIN is never loaded here: only the door identity is
 * read, and the new PIN is entered twice in the client form.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Change PIN' };

interface ChangePinPageProps {
  searchParams: Promise<{ doorNumber?: string | string[] }>;
}

function readDoorNumber(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return (value[0] ?? '').trim();
  return (value ?? '').trim();
}

export default async function ChangePinPage({ searchParams }: ChangePinPageProps) {
  const params = await searchParams;
  const doorNumber = readDoorNumber(params.doorNumber);

  if (!doorNumber) {
    return (
      <div className="space-y-6">
        <Alert tone="warning" title="No locker selected">
          Open this screen from the forgot-PIN list so the kiosk knows which locker to update.
        </Alert>
        <Link href="/admin/forgot-pin" className="text-brand-300 underline">
          Back to the locker list
        </Link>
      </div>
    );
  }

  const door = await getDoor(doorNumber).catch(() => null);

  if (!door) {
    return (
      <div className="space-y-6">
        <Alert tone="danger" title="Locker not found">
          No locker matches {doorNumber}. It may have been removed from this kiosk.
        </Alert>
        <Link href="/admin/forgot-pin" className="text-brand-300 underline">
          Back to the locker list
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="kiosk-heading">Change pickup PIN</h1>
        <p className="kiosk-label mt-2">
          Locker {door.lockerLocation}
          {door.doorNumber}
          {door.alias ? ` · alias ${door.alias}` : ''} ·{' '}
          {door.doorStatus === 1 ? 'currently in use' : 'currently free'}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>New PIN</CardTitle>
        </CardHeader>
        <CardBody>
          <ChangePinForm doorNumber={door.doorNumber} />
        </CardBody>
      </Card>

      <Link href="/admin/forgot-pin" className="inline-block text-brand-300 underline">
        Back to the locker list
      </Link>
    </div>
  );
}
