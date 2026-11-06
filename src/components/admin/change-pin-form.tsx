'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { changeDoorPinAction } from '@/app/actions/admin';
import { Alert, Button, Keypad, PinDisplay } from '@/components/ui';
import { useKiosk } from '@/context/kiosk-provider';
import { useToast } from '@/context/toast-provider';

/**
 * Two-step pickup PIN reset.
 *
 * The new PIN is entered once, then again to confirm, and is submitted
 * only after both entries agree. Obviously guessable PINs are rejected
 * here for immediate feedback; the service layer rejects them again, and
 * its answer is what decides the outcome. The busy flag is always
 * released in `finally`.
 */
type Stage = 'enter' | 'confirm';

/** Mirrors the trivially guessable PINs the service refuses. */
const OBVIOUS_PINS = new Set([
  '123456',
  '654321',
  '111111',
  '222222',
  '333333',
  '444444',
  '555555',
  '666666',
  '777777',
  '888888',
  '999999',
  '000000',
  '567890',
  '098765',
]);

function isWeakPin(pin: string): boolean {
  if (OBVIOUS_PINS.has(pin)) return true;
  if (/^(\d)\1*$/.test(pin)) return true;

  let ascending = true;
  let descending = true;
  for (let index = 1; index < pin.length; index += 1) {
    const step = pin.charCodeAt(index) - pin.charCodeAt(index - 1);
    if (step !== 1) ascending = false;
    if (step !== -1) descending = false;
  }

  return ascending || descending;
}

export function ChangePinForm({ doorNumber }: { doorNumber: string }) {
  const router = useRouter();
  const config = useKiosk();
  const toast = useToast();

  const pinLength = Math.max(4, Math.trunc(config.pinLength) || 6);

  const [pin, setPin] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [stage, setStage] = useState<Stage>('enter');
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const complete = pin.length === pinLength;

  async function submit(value: string): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const result = await changeDoorPinAction(doorNumber, value);

      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }

      toast.success(`Pickup PIN updated for locker ${doorNumber}`);
      router.push('/admin/forgot-pin');
      router.refresh();
    } catch {
      const message = 'The PIN could not be saved. Check the connection and try again.';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  function handleAdvance(): void {
    setError(null);

    if (!complete) {
      setError(`Enter all ${pinLength} digits.`);
      return;
    }

    if (stage === 'enter') {
      if (isWeakPin(pin)) {
        setError('That PIN is too easy to guess. Choose a less predictable one.');
        return;
      }

      setFirstPin(pin);
      setPin('');
      setStage('confirm');
      return;
    }

    if (pin !== firstPin) {
      setError('The two PINs do not match. Start again.');
      setFirstPin('');
      setPin('');
      setStage('enter');
      return;
    }

    void submit(pin);
  }

  function startOver(): void {
    setError(null);
    setFirstPin('');
    setPin('');
    setStage('enter');
  }

  return (
    <div className="space-y-5">
      <p className="text-base text-kiosk-muted">
        {stage === 'enter'
          ? `Enter a new ${pinLength}-digit pickup PIN for this locker.`
          : 'Enter the same PIN again to confirm it.'}
      </p>

      <PinDisplay
        length={pinLength}
        value={pin}
        masked={!revealed}
        revealLabel={revealed ? 'Hide PIN' : 'Reveal PIN'}
        onToggleReveal={() => setRevealed((current) => !current)}
      />

      {error ? (
        <Alert tone="danger" title="PIN not changed">
          {error}
        </Alert>
      ) : null}

      <Keypad
        value={pin}
        maxLength={pinLength}
        disabled={busy}
        onDigit={(digit) => {
          setError(null);
          setPin((current) => (current.length >= pinLength ? current : `${current}${digit}`));
        }}
        onBackspace={() => setPin((current) => current.slice(0, -1))}
        onClear={() => setPin('')}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button loading={busy} onClick={handleAdvance}>
          {stage === 'enter' ? 'Continue' : 'Set PIN'}
        </Button>

        {stage === 'confirm' ? (
          <button
            type="button"
            disabled={busy}
            onClick={startOver}
            className="min-h-touch rounded-2xl border border-kiosk-border px-5 text-base font-medium text-slate-100 transition hover:bg-kiosk-bg disabled:opacity-50"
          >
            Start over
          </button>
        ) : null}
      </div>
    </div>
  );
}
