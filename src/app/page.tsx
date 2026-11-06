import { DoorGrid } from '@/components/kiosk/door-grid';
import { ScanListener } from '@/components/kiosk/scan-listener';
import { listDoors } from '@/lib/services/booking-service';
import { serverEnv } from '@/lib/env';

/**
 * Home screen — a Server Component.
 *
 * Reads the door list straight from the database on the server, so the
 * kiosk renders with data already in the HTML and the browser makes no
 * fetch to show it. Only selection and the scan listener are client-side.
 */
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const doors = await listDoors().catch(() => []);

  return (
    <main className="kiosk-shell">
      <ScanListener adminScanCode={serverEnv.adminScanCode} />
      <DoorGrid doors={doors} />
    </main>
  );
}
