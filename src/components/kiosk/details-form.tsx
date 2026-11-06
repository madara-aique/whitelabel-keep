'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { completeBookingAction, startBookingAction } from '@/app/actions/booking';
import { openOccupiedDoorAction } from '@/app/actions/door';
import { Alert, Button, Card, CardBody, CardFooter, Keypad, Modal, PinDisplay } from '@/components/ui';
import { useKiosk } from '@/context/kiosk-provider';
import { useToast } from '@/context/toast-provider';
import { useIdleTimeout } from '@/hooks/use-idle-timeout';
import { useNetwork } from '@/hooks/use-network';
import { cn } from '@/lib/utils';
import type { DoorView, TransactionView } from '@/types/domain';

/**
 * Details form — the heart of the customer flow.
 *
 * The same screen serves both directions of a locker: a customer starting
 * a booking on a free door, and a customer coming back for their items on
 * an occupied one. The mode is derived from the door's server-fetched
 * status, never from the query string, so a stale link cannot put the
 * customer on the wrong path.
 */

/** Seconds the success state stays up before the kiosk returns home. */
const SUCCESS_SECONDS = 5;

/** Shortest locker name the customer may use. */
const MIN_ALIAS_LENGTH = 2;

/** Fallback copy for an unexpected failure (a dropped connection, say). */
const GENERIC_ERROR = 'Something went wrong. Please try again.';

/**
 * Mirror of the server's trivially guessable PIN list.
 *
 * `@/lib/config/kiosk-config` owns the authoritative set but reads server
 * environment, so it cannot be imported into a Client Component. This copy
 * exists purely to give the customer immediate feedback; the server still
 * decides whether a PIN is acceptable.
 */
const COMMON_PINS = new Set([
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

/** Which request is currently in flight, so only that button shows a spinner. */
type Pending = 'start' | 'open' | 'end';

/** Result shape shared by every Server Action this screen calls. */
type FailureResult = { error: string; code?: string };

export interface DetailsFormProps {
  door: DoorView;
  activeBooking: TransactionView | null;
}

/** Build the payment-selection URL, encoding every value. */
function paymentSelectionHref(params: {
  transId: string;
  doorNumber: string;
  lockerLocation: string;
  alias: string;
  pin: string;
}): string {
  const query = new URLSearchParams({
    transId: params.transId,
    doorNumber: params.doorNumber,
    lockerLocation: params.lockerLocation,
    alias: params.alias,
    pin: params.pin,
  });
  return `/payment-selection?${query.toString()}`;
}

export function DetailsForm({ door, activeBooking }: DetailsFormProps) {
  const router = useRouter();
  const config = useKiosk();
  const toast = useToast();
  const network = useNetwork();

  const occupied = door.doorStatus === 1;

  const [alias, setAlias] = useState(() => (occupied ? door.alias : ''));
  const [pin, setPin] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [outcome, setOutcome] = useState<'opened' | 'ended' | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(SUCCESS_SECONDS);

  const busy = pending !== null;
  const offline = network === 'offline';
  const pinComplete = pin.length === config.pinLength;
  const commonPin = pinComplete && COMMON_PINS.has(pin);
  const aliasTooShort = alias.trim().length < MIN_ALIAS_LENGTH;

  const goHome = useCallback(() => {
    router.push('/');
  }, [router]);

  // Leaving the locker half-entered must never strand the next customer.
  useIdleTimeout({
    seconds: config.idleTimeoutSeconds,
    onIdle: goHome,
    enabled: !busy && outcome === null,
  });

  // Count the success state down and hand the kiosk back to the start screen.
  useEffect(() => {
    if (outcome === null) return;
    if (secondsLeft <= 0) {
      router.push('/');
      return;
    }
    const timer = window.setTimeout(() => setSecondsLeft((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [outcome, secondsLeft, router]);

  function handleAliasChange(event: ChangeEvent<HTMLInputElement>): void {
    const cleaned = event.target.value
      .replace(/[^a-zA-Z ]/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, config.maxAliasLength)
      .toUpperCase();
    setAlias(cleaned);
    setError(null);
  }

  function handleDigit(digit: string): void {
    setError(null);
    setPin((current) => (current.length >= config.pinLength ? current : `${current}${digit}`));
  }

  function handleBackspace(): void {
    setError(null);
    setPin((current) => current.slice(0, -1));
  }

  function handleClear(): void {
    setError(null);
    setPin('');
  }

  /**
   * Surface a Server Action failure. Only a PIN mismatch clears the entry:
   * every other failure must leave the customer's digits alone.
   */
  function reportFailure(result: FailureResult): void {
    setError(result.error);
    if (result.code === 'PIN_MISMATCH') setPin('');
  }

  async function handleStart(): Promise<void> {
    if (aliasTooShort || !pinComplete || commonPin || offline || busy) return;

    const booking = {
      doorNumber: door.doorNumber,
      lockerLocation: door.lockerLocation,
      alias: alias.trim(),
      pin,
    };

    setPending('start');
    setError(null);
    try {
      // A booking left behind by a Back-then-Next round trip is reused
      // instead of duplicated.
      let transId = activeBooking?.transId ?? null;
      if (transId === null) {
        const result = await startBookingAction(booking);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        transId = result.data.transId;
      }
      router.push(paymentSelectionHref({ ...booking, transId }));
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setPending(null);
    }
  }

  async function handleOpenLocker(): Promise<void> {
    if (!pinComplete || offline || busy) return;

    setPending('open');
    setError(null);
    try {
      const result = await openOccupiedDoorAction(door.doorNumber, pin);
      if (!result.ok) {
        reportFailure(result);
        return;
      }
      setOutcome('opened');
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setPending(null);
    }
  }

  async function handleEndTransaction(): Promise<void> {
    if (!pinComplete || offline || busy) return;

    setPending('end');
    setError(null);
    try {
      // The door is released first: the customer is standing in front of it
      // and must not be blocked by a bookkeeping failure afterwards.
      const opened = await openOccupiedDoorAction(door.doorNumber, pin);
      if (!opened.ok) {
        reportFailure(opened);
        setConfirmOpen(false);
        return;
      }

      if (activeBooking) {
        const completed = await completeBookingAction(activeBooking.transId);
        if (!completed.ok) {
          // The locker is already open, so the customer is sent home and the
          // dangling booking is flagged for the cashier rather than trapping
          // them on a screen whose only action keeps failing.
          toast.error('Your locker is open, but we could not close the booking. Please tell the cashier.');
        }
      }

      setConfirmOpen(false);
      setOutcome('ended');
    } catch {
      setError(GENERIC_ERROR);
      setConfirmOpen(false);
    } finally {
      setPending(null);
    }
  }

  if (outcome !== null) {
    return (
      <Card role="status" aria-live="polite" className="mt-10">
        <CardBody className="flex flex-col items-center gap-4 py-12 text-center">
          <span
            aria-hidden="true"
            className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-success text-4xl font-bold text-success"
          >
            ✓
          </span>
          <h1 className="kiosk-heading">
            {outcome === 'opened' ? 'Locker opened' : 'Transaction ended'}
          </h1>
          <p className="kiosk-label max-w-md">
            {outcome === 'opened'
              ? 'Please take your items and close the door firmly behind you.'
              : 'Thank you for using this locker. Please make sure you have all your items.'}
          </p>
          <p className="text-xl font-semibold text-white">
            Returning to the start in {secondsLeft}…
          </p>
        </CardBody>
      </Card>
    );
  }

  const commonPinError = commonPin
    ? 'That PIN is too easy to guess. Please choose a different PIN.'
    : null;
  const canAct = pinComplete && !offline && !busy;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="kiosk-heading">{occupied ? 'Welcome back' : 'Start your booking'}</h1>
        <p className="kiosk-label mt-1">
          Locker {door.lockerLocation}
          {door.doorNumber} · Size {door.doorSize}
        </p>
        {!occupied ? (
          <p className="kiosk-label mt-1">
            {config.promoActive ? 'Promotional rate' : 'Rate'}:{' '}
            {config.formatAmount(config.effectiveRate)}
          </p>
        ) : null}
      </header>

      {offline ? (
        <Alert tone="warning" title="This kiosk is offline">
          Locker actions need the network. Please wait for the connection to come back.
        </Alert>
      ) : null}

      {!occupied && activeBooking ? (
        <Alert tone="info" title="Booking already in progress">
          This locker already has a booking open, so we will continue with it.
        </Alert>
      ) : null}

      <Card>
        <CardBody className="flex flex-col gap-8">
          {occupied ? (
            <>
              <div className="flex flex-col gap-3">
                <label htmlFor="locker-alias" className="text-xl font-semibold text-white">
                  Locker name
                </label>
                <input
                  id="locker-alias"
                  type="text"
                  value={door.alias || '—'}
                  readOnly
                  aria-readonly="true"
                  className="min-h-[4.5rem] w-full rounded-2xl border border-kiosk-border bg-kiosk-bg/60 px-5 text-3xl font-semibold uppercase tracking-wide text-white"
                />
              </div>

              <div className="flex flex-col gap-4">
                <h2 className="text-xl font-semibold text-white">
                  Enter your {config.pinLength}-digit PIN
                </h2>
                <PinDisplay
                  length={config.pinLength}
                  value={pin}
                  masked={!revealed}
                  revealLabel={revealed ? 'HIDE' : 'VIEW'}
                  onToggleReveal={() => setRevealed((value) => !value)}
                />
                <Keypad
                  onDigit={handleDigit}
                  onBackspace={handleBackspace}
                  onClear={handleClear}
                  disabled={busy}
                  maxLength={config.pinLength}
                  value={pin}
                />
                {commonPinError ? <Alert tone="danger">{commonPinError}</Alert> : null}
                {error ? <Alert tone="danger">{error}</Alert> : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Button
                  variant="secondary"
                  size="xl"
                  fullWidth
                  className="min-h-[9rem] flex-col gap-1"
                  disabled={!canAct}
                  loading={pending === 'end'}
                  onClick={() => setConfirmOpen(true)}
                >
                  <span className="text-2xl font-semibold">End transaction</span>
                  <span className="text-kiosk font-normal text-kiosk-muted">
                    I have taken everything out
                  </span>
                </Button>
                <Button
                  size="xl"
                  fullWidth
                  className="min-h-[9rem] flex-col gap-1"
                  disabled={!canAct}
                  loading={pending === 'open'}
                  onClick={handleOpenLocker}
                >
                  <span className="text-2xl font-semibold">Open locker</span>
                  <span className="text-kiosk font-normal text-white/80">Unlock the door</span>
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                <label htmlFor="alias" className="text-xl font-semibold text-white">
                  Enter your name
                </label>
                <input
                  id="alias"
                  name="alias"
                  type="text"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={config.maxAliasLength}
                  value={alias}
                  onChange={handleAliasChange}
                  disabled={busy}
                  aria-describedby="alias-hint"
                  placeholder="Tap to enter name"
                  className={cn(
                    'min-h-[4.5rem] w-full rounded-2xl border border-kiosk-border bg-kiosk-bg px-5 text-3xl font-semibold uppercase tracking-wide text-white',
                    'placeholder:text-kiosk-muted/60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-400/60',
                    busy && 'opacity-60',
                  )}
                />
                <p id="alias-hint" className="kiosk-label">
                  Maximum of {config.maxAliasLength} characters
                </p>
              </div>

              <div className="flex flex-col gap-4">
                <h2 className="text-xl font-semibold text-white">
                  Set a {config.pinLength}-digit PIN
                </h2>
                <PinDisplay
                  length={config.pinLength}
                  value={pin}
                  masked={!revealed}
                  revealLabel={revealed ? 'HIDE' : 'VIEW'}
                  onToggleReveal={() => setRevealed((value) => !value)}
                />
                <Keypad
                  onDigit={handleDigit}
                  onBackspace={handleBackspace}
                  onClear={handleClear}
                  disabled={busy}
                  maxLength={config.pinLength}
                  value={pin}
                />
                {commonPinError ? <Alert tone="danger">{commonPinError}</Alert> : null}
                {error ? <Alert tone="danger">{error}</Alert> : null}
              </div>
            </>
          )}
        </CardBody>

        <CardFooter className="justify-between">
          <Button variant="secondary" size="lg" onClick={goHome} disabled={busy}>
            Back
          </Button>
          {occupied ? null : (
            <Button
              size="lg"
              loading={pending === 'start'}
              disabled={aliasTooShort || !pinComplete || commonPin || offline || busy}
              onClick={handleStart}
            >
              Next
            </Button>
          )}
        </CardFooter>
      </Card>

      {occupied ? (
        <Modal
          open={confirmOpen}
          onClose={() => {
            if (!busy) setConfirmOpen(false);
          }}
          title="End your transaction?"
          footer={
            <>
              <Button
                variant="secondary"
                size="lg"
                className="flex-1"
                disabled={busy}
                onClick={() => setConfirmOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="lg"
                className="flex-1"
                disabled={busy}
                loading={pending === 'end'}
                onClick={handleEndTransaction}
              >
                Confirm
              </Button>
            </>
          }
        >
          <p>Please make sure you have retrieved all items before leaving.</p>
        </Modal>
      ) : null}
    </div>
  );
}
