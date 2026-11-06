'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { clearDoorAction, rebookDoorAction } from '@/app/actions/admin';
import { Alert, Button, Modal } from '@/components/ui';
import { useToast } from '@/context/toast-provider';

/**
 * One mutating door control, with its own confirmation and error surface.
 *
 * The busy flag is cleared in `finally` on every path, so a rejected or
 * thrown request can never leave the button spinning.
 */
export interface DoorActionButtonProps {
  doorNumber: string;
  action: 'rebook' | 'clear';
  label: string;
  confirmTitle?: string;
  confirmBody?: string;
}

export function DoorActionButton({
  doorNumber,
  action,
  label,
  confirmTitle,
  confirmBody,
}: DoorActionButtonProps) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const needsConfirmation = Boolean(confirmTitle || confirmBody);
  const body =
    confirmBody ??
    (action === 'clear'
      ? `Locker ${doorNumber} will be opened and archived as cleared. Take the belongings out first.`
      : `Locker ${doorNumber} will return to the available pool immediately.`);

  async function run(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const result =
        action === 'rebook'
          ? await rebookDoorAction(doorNumber)
          : await clearDoorAction(doorNumber);

      if (result.ok) {
        setConfirming(false);
        toast.success(
          action === 'rebook'
            ? `Locker ${doorNumber} is ready to be booked again`
            : `Locker ${doorNumber} has been cleared`,
        );
        router.refresh();
        return;
      }

      setError(result.error);
      toast.error(result.error);
    } catch {
      const message = 'The request could not be completed. Check the connection and try again.';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  function handleClick(): void {
    setError(null);

    if (needsConfirmation) {
      setConfirming(true);
      return;
    }

    void run();
  }

  return (
    <div>
      <Button loading={busy} onClick={handleClick}>
        {label}
      </Button>

      {!needsConfirmation && error ? (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      ) : null}

      {needsConfirmation ? (
        <Modal
          open={confirming}
          onClose={() => {
            if (!busy) setConfirming(false);
          }}
          title={confirmTitle ?? label}
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
                {label}
              </Button>
            </div>
          }
        >
          <p className="text-base text-kiosk-muted">{body}</p>
          {error ? (
            <Alert tone="danger" className="mt-4">
              {error}
            </Alert>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}
