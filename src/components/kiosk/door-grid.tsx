'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useKiosk } from '@/context/kiosk-provider';
import { useToast } from '@/context/toast-provider';
import { syncDoorsAction } from '@/app/actions/door';
import { cn } from '@/lib/utils';
import type { DoorView } from '@/types/domain';

/**
 * Door grid.
 *
 * A Client Component because it owns selection state and navigation;
 * the door list itself is fetched by the Server Component that renders
 * it, so this component never loads data itself.
 */
export function DoorGrid({ doors }: { doors: DoorView[] }) {
  const router = useRouter();
  const config = useKiosk();
  const toast = useToast();
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, startSync] = useTransition();

  if (doors.length === 0) {
    return (
      <Card className="mx-auto max-w-xl text-center">
        <h2 className="kiosk-heading">No doors configured yet</h2>
        <p className="kiosk-label mt-3">
          Import the doors this kiosk controls, then the grid will appear here.
        </p>
        <div className="mt-6 flex justify-center">
          <Button
            size="lg"
            loading={syncing}
            onClick={() =>
              startSync(async () => {
                const result = await syncDoorsAction();
                if (result.ok) {
                  toast.success(
                    result.data.added > 0
                      ? `Imported ${result.data.added} door(s)`
                      : 'All doors are already imported',
                  );
                  router.refresh();
                } else {
                  setError(result.error);
                }
              })
            }
          >
            Import doors from the controller
          </Button>
        </div>
        {error ? (
          <Alert tone="danger" className="mt-6 text-left">
            {error}
          </Alert>
        ) : null}
      </Card>
    );
  }

  return (
    <div>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="kiosk-heading">Choose a locker</h1>
          <p className="kiosk-label mt-1">
            Occupied lockers are shown in green. Tap a free locker to begin.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {doors.map((door) => {
          const occupied = door.doorStatus === 1;
          const isSelected = selected === door.doorNumber;

          return (
            <button
              key={door.doorNumber}
              type="button"
              aria-pressed={isSelected}
              aria-label={
                occupied
                  ? `Locker ${door.doorNumber}, in use`
                  : `Locker ${door.doorNumber}, available`
              }
              onClick={() => {
                setError(null);
                // A promo-tagged door is unavailable outside the promo window.
                if (!config.promoActive && door.payType === 'PROMO') {
                  setError('That locker is reserved for a promotion that is not running.');
                  return;
                }
                setSelected(door.doorNumber);
                router.push(
                  `/details?doorNumber=${encodeURIComponent(door.doorNumber)}` +
                    `&lockerLocation=${encodeURIComponent(door.lockerLocation)}` +
                    `&doorStatus=${door.doorStatus}` +
                    `&alias=${encodeURIComponent(door.alias)}`,
                );
              }}
              className={cn(
                'flex min-h-[9rem] flex-col items-center justify-center rounded-3xl border p-5 text-center transition',
                occupied
                  ? 'border-transparent bg-emerald-500 text-white'
                  : 'border-kiosk-border bg-kiosk-surface text-slate-100',
                isSelected && 'ring-4 ring-brand-400',
              )}
            >
              <span className="text-4xl font-semibold tabular-nums">
                {door.lockerLocation}
                {door.doorNumber}
              </span>
              <span
                className={cn(
                  'mt-2 text-sm font-semibold uppercase tracking-wide',
                  occupied ? 'text-white/85' : 'text-kiosk-muted',
                )}
              >
                {occupied ? door.alias || 'In use' : 'Available'}
              </span>
            </button>
          );
        })}
      </div>

      {syncing ? (
        <div className="mt-6 flex items-center gap-3 text-kiosk-muted">
          <Spinner />
          <span>Refreshing doors…</span>
        </div>
      ) : null}

      {error ? (
        <Alert tone="warning" className="mt-6">
          {error}
        </Alert>
      ) : null}
    </div>
  );
}
