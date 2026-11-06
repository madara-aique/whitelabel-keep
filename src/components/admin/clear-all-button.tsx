'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { openAllAndClearAction } from '@/app/actions/admin';
import { Alert, Button, Modal } from '@/components/ui';
import { useToast } from '@/context/toast-provider';

/**
 * Emergency sweep: open every lock, then clear every occupied door.
 *
 * The action reports per-door failures rather than aborting, so the
 * operator sees exactly which lockers still need a manual visit. The
 * busy flag is released in `finally` on every path.
 */
interface SweepReport {
  cleared: number;
  failed: { doorNumber: string; error: string }[];
}

export function ClearAllButton() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [report, setReport] = useState<SweepReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(): Promise<void> {
    setBusy(true);
    setError(null);
    setReport(null);

    try {
      const result = await openAllAndClearAction();

      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }

      setConfirming(false);
      setReport(result.data);

      if (result.data.failed.length === 0) {
        toast.success(`Cleared ${result.data.cleared} locker(s)`);
      } else {
        toast.error(
          `Cleared ${result.data.cleared} locker(s); ${result.data.failed.length} could not be cleared`,
        );
      }

      router.refresh();
    } catch {
      const message =
        'The sweep could not be completed. Check the connection to the locker controller and try again.';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Button
        loading={busy}
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
      >
        Open all doors and clear
      </Button>

      <p className="text-sm text-kiosk-muted">
        Energises every lock, then archives each occupied locker as cleared.
      </p>

      {error ? (
        <Alert tone="danger" title="The sweep did not run">
          {error}
        </Alert>
      ) : null}

      {report ? (
        <Alert tone={report.failed.length === 0 ? 'success' : 'warning'} title="Sweep finished">
          <p>
            Cleared {report.cleared} locker(s).
            {report.failed.length === 0
              ? ' Every occupied locker was cleared.'
              : ` ${report.failed.length} locker(s) could not be cleared.`}
          </p>
          {report.failed.length > 0 ? (
            <ul className="mt-3 space-y-1">
              {report.failed.map((failure) => (
                <li key={failure.doorNumber} className="text-sm">
                  <span className="font-medium text-slate-100">Locker {failure.doorNumber}</span>:{' '}
                  {failure.error}
                </li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}

      <Modal
        open={confirming}
        onClose={() => {
          if (!busy) setConfirming(false);
        }}
        title="Open every door and clear?"
        footer={
          <div className="flex justify-end gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="min-h-touch rounded-2xl border border-kiosk-border px-5 text-base font-medium text-slate-100 transition hover:bg-kiosk-bg disabled:opacity-50"
            >
              Cancel
            </button>
            <Button
              loading={busy}
              onClick={() => {
                void run();
              }}
            >
              Run the sweep
            </Button>
          </div>
        }
      >
        <p className="text-base text-kiosk-muted">
          Every lock in this bank is energised and every occupied locker is archived as cleared. Only
          run this when the lockers are empty or the kiosk is being taken out of service.
        </p>
      </Modal>
    </div>
  );
}
