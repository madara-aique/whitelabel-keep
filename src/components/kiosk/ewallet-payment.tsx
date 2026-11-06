'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import { settleBookingAction } from '@/app/actions/booking';
import { PaymentSuccess } from '@/components/kiosk/payment-success';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CardTitle,
  Money,
  Spinner,
  SpinnerOverlay,
} from '@/components/ui';
import { useHardware } from '@/context/hardware-provider';
import { useKiosk } from '@/context/kiosk-provider';
import { useNetwork } from '@/hooks/use-network';
import { isRecord } from '@/lib/utils';

export interface EWalletPaymentProps {
  transId: string | null;
  doorNumber: string;
  lockerLocation: string;
  alias: string;
  pin: string;
}

/** How often the kiosk asks the server whether the payment landed. */
const POLL_INTERVAL_MS = 3_000;

/** Give up waiting for confirmation after this long and offer a retry. */
const PAYMENT_TIMEOUT_MS = 3 * 60 * 1_000;

/** Countdown before the kiosk returns home after a successful payment. */
const SUCCESS_SECONDS = 8;

/** No completion step may hold the customer on a spinner forever. */
const STEP_TIMEOUT_MS = 20_000;

/** Result of a step that is not allowed to hang. */
type StepOutcome<T> = { kind: 'ok'; value: T } | { kind: 'error' } | { kind: 'timeout' };

function bounded<T>(promise: Promise<T>, timeoutMs: number): Promise<StepOutcome<T>> {
  return new Promise((resolve) => {
    let done = false;
    const timer = window.setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ kind: 'timeout' });
    }, timeoutMs);

    promise.then(
      (value) => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        resolve({ kind: 'ok', value });
      },
      () => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        resolve({ kind: 'error' });
      },
    );
  });
}

type Phase = 'creating' | 'awaiting' | 'processing' | 'error';

interface CreatedPayment {
  paymentId: string;
  reference: string;
  qrPayload: string;
}

type PaymentStatus = 'paid' | 'pending' | 'failed' | 'unknown';

/** Read `{success:true,data:{status}}` without trusting the shape. */
function readStatus(payload: unknown): PaymentStatus {
  if (!isRecord(payload) || payload.success !== true || !isRecord(payload.data)) return 'unknown';
  const status = payload.data.status;
  if (status === 'paid' || status === 'pending' || status === 'failed') return status;
  return 'unknown';
}

/** Build the selection URL from the values this screen already knows. */
function paymentSelectionHref(props: {
  transId: string | null;
  doorNumber: string;
  lockerLocation: string;
  alias: string;
  pin: string;
}): string {
  const query = new URLSearchParams();
  query.set('doorNumber', props.doorNumber);
  if (props.lockerLocation) query.set('lockerLocation', props.lockerLocation);
  if (props.alias) query.set('alias', props.alias);
  if (props.pin) query.set('pin', props.pin);
  if (props.transId) query.set('transId', props.transId);
  return `/payment-selection?${query.toString()}`;
}

/**
 * E-wallet QR payment screen.
 *
 * The server creates (or reuses) the payment and decides the amount; this
 * screen only renders the QR and polls for the outcome. Polling stops on
 * unmount, on success, on failure and after the overall timeout, and the
 * completion steps are guarded so a repeated "paid" can never settle a
 * booking or open a door twice.
 */
export function EWalletPayment({
  transId,
  doorNumber,
  lockerLocation,
  alias,
  pin,
}: EWalletPaymentProps) {
  const router = useRouter();
  const config = useKiosk();
  const { currencySymbol, effectiveRate } = config;
  const { openDoors } = useHardware();
  const network = useNetwork();

  const selectionHref = paymentSelectionHref({ transId, doorNumber, lockerLocation, alias, pin });

  const [phase, setPhase] = useState<Phase>('creating');
  const [payment, setPayment] = useState<CreatedPayment | null>(null);
  // The amount actually charged, read once from the server response and
  // then used for display, settlement and the success panel alike.
  const [chargedAmount, setChargedAmount] = useState(effectiveRate);
  const [creationError, setCreationError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const settlingRef = useRef(false);
  const settledRef = useRef(false);
  const openingRef = useRef(false);
  const openedRef = useRef(false);
  const completionRef = useRef(false);
  /** Set while this screen must stop asking for the payment status. */
  const stopPollingRef = useRef(false);

  /** Human-readable outcome once one of the two completion steps fails. */
  const failureMessage = useCallback((): string => {
    if (openedRef.current && !settledRef.current) {
      return `Locker ${doorNumber} has been opened, but we could not update your booking. Please continue to your locker; contact support so the booking can be corrected.`;
    }
    if (settledRef.current && !openedRef.current) {
      return `Your e-wallet payment was recorded, but locker ${doorNumber} did not open. Tap “Try again” to open it, or contact support.`;
    }
    return `Your e-wallet payment went through, but we could not update your booking or open locker ${doorNumber}. Tap “Try again”; if it keeps failing, please contact support.`;
  }, [doorNumber]);

  /** Settle the paid booking, then open the door, then show success. */
  const completePayment = useCallback(async (): Promise<void> => {
    if (settledRef.current && openedRef.current) {
      setFailure(null);
      setCompleted(true);
      return;
    }

    if (!settledRef.current && !settlingRef.current) {
      if (!transId || !payment) {
        setCompleted(false);
        setFailure(
          'We could not match your payment to a booking. Please show this screen to a member of staff.',
        );
        return;
      }

      settlingRef.current = true;
      let settled = false;
      try {
        const outcome = await bounded(
          settleBookingAction(transId, {
            payType: 'EWALLET',
            amount: chargedAmount,
            paymentId: payment.paymentId,
            refNumber: payment.reference,
          }),
          STEP_TIMEOUT_MS,
        );

        if (outcome.kind === 'ok') {
          const result = outcome.value;
          if (result.ok) {
            settled = true;
          } else if (result.code === 'BOOKING_CLOSED') {
            // An earlier attempt landed after this screen stopped waiting.
            settled = true;
          } else {
            setActionError(result.error);
          }
        } else {
          setActionError(
            outcome.kind === 'timeout'
              ? 'The booking service did not respond in time.'
              : 'The booking service could not be reached.',
          );
        }
      } finally {
        settlingRef.current = false;
      }

      if (!settled) {
        setCompleted(false);
        setFailure(failureMessage());
        return;
      }
      settledRef.current = true;
    }

    if (!openedRef.current && !openingRef.current) {
      openingRef.current = true;
      let opened = false;
      try {
        const outcome = await bounded(openDoors([doorNumber]), STEP_TIMEOUT_MS);
        if (outcome.kind === 'ok') {
          opened = outcome.value.completed !== false;
          if (!opened) setActionError(outcome.value.error?.message ?? null);
        } else {
          setActionError(
            outcome.kind === 'timeout'
              ? 'The locker controller did not respond in time.'
              : 'The locker controller could not be reached.',
          );
        }
      } finally {
        openingRef.current = false;
      }

      if (!opened) {
        setCompleted(false);
        setFailure(failureMessage());
        return;
      }
      openedRef.current = true;
    }

    setActionError(null);
    setFailure(null);
    setCompleted(true);
  }, [chargedAmount, doorNumber, failureMessage, openDoors, payment, transId]);

  const completePaymentRef = useRef(completePayment);
  useEffect(() => {
    completePaymentRef.current = completePayment;
  }, [completePayment]);

  /** Ask the server to create (or reuse) the payment and its QR payload. */
  const createPayment = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      if (!transId) {
        setPayment(null);
        setCreationError(
          'This screen has no booking reference, so a payment cannot be started. Please show this screen to a member of staff.',
        );
        setPhase('error');
        return;
      }

      setPhase('creating');
      setCreationError(null);

      try {
        const response = await fetch('/api/payments', {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({ transId, doorNumber, lockerLocation }),
          cache: 'no-store',
          signal,
        });

        const payload: unknown = await response.json().catch(() => null);

        if (!response.ok || !isRecord(payload) || payload.success !== true || !isRecord(payload.data)) {
          const message =
            isRecord(payload) && typeof payload.error === 'string'
              ? payload.error
              : `The payment service responded with ${response.status}.`;
          setPayment(null);
          setCreationError(message);
          setPhase('error');
          return;
        }

        const data = payload.data;
        const paymentId = typeof data.paymentId === 'string' ? data.paymentId : '';
        const qrPayload = typeof data.qrPayload === 'string' ? data.qrPayload : '';
        const reference = typeof data.reference === 'string' ? data.reference : paymentId;

        if (!paymentId || !qrPayload) {
          setPayment(null);
          setCreationError('The payment service did not return a QR code.');
          setPhase('error');
          return;
        }

        if (typeof data.amount === 'number' && Number.isFinite(data.amount) && data.amount > 0) {
          setChargedAmount(Math.trunc(data.amount));
        }

        setPayment({ paymentId, reference, qrPayload });
        setPhase('awaiting');
      } catch (error) {
        if (signal?.aborted) return;
        setPayment(null);
        setCreationError(
          error instanceof Error
            ? error.message
            : 'The payment service could not be reached. Please try again.',
        );
        setPhase('error');
      }
    },
    [doorNumber, lockerLocation, transId],
  );

  // Create the payment once on mount; abort a request that is still in
  // flight when the screen goes away. The call is deferred out of the
  // effect body so the request's initial state updates are not rendered
  // synchronously as part of this effect.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void createPayment(controller.signal);
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [createPayment]);

  // Poll while — and only while — a QR is waiting to be paid.
  useEffect(() => {
    if (phase !== 'awaiting' || !payment) return;

    stopPollingRef.current = false;
    let cancelled = false;
    const startedAt = Date.now();

    const check = async (): Promise<void> => {
      if (cancelled || stopPollingRef.current) return;

      if (Date.now() - startedAt >= PAYMENT_TIMEOUT_MS) {
        cancelled = true;
        setCreationError(
          'We did not receive confirmation from your e-wallet in time. You can try again.',
        );
        setPhase('error');
        return;
      }

      try {
        const response = await fetch(`/api/payments/${encodeURIComponent(payment.paymentId)}`, {
          method: 'GET',
          headers: { accept: 'application/json' },
          cache: 'no-store',
        });
        const payload: unknown = await response.json().catch(() => null);
        if (cancelled || stopPollingRef.current) return;

        const status = readStatus(payload);
        if (status === 'paid') {
          cancelled = true;
          setPhase('processing');
          if (completionRef.current) return;
          completionRef.current = true;
          void completePaymentRef.current();
          return;
        }
        if (status === 'failed') {
          cancelled = true;
          setCreationError('The e-wallet payment was declined or cancelled. You can try again.');
          setPhase('error');
        }
      } catch {
        // Transient problems are expected; the timeout above is the exit.
      }
    };

    const interval = window.setInterval(() => {
      void check();
    }, POLL_INTERVAL_MS);
    void check();

    return () => {
      cancelled = true;
      stopPollingRef.current = true;
      window.clearInterval(interval);
    };
  }, [payment, phase]);

  const handleRetryCreation = useCallback(() => {
    setRetrying(true);
    void createPayment().finally(() => setRetrying(false));
  }, [createPayment]);

  const handleRetryCompletion = useCallback(() => {
    setRetrying(true);
    setFailure(null);
    void completePayment().finally(() => setRetrying(false));
  }, [completePayment]);

  const handleBack = useCallback(() => {
    stopPollingRef.current = true;
    router.push(selectionHref);
  }, [router, selectionHref]);

  const goHome = useCallback(() => {
    router.push('/');
  }, [router]);

  // ── Render ─────────────────────────────────────────────────────────

  if (completed) {
    return (
      <PaymentSuccess
        title="Payment successful"
        amount={chargedAmount}
        seconds={SUCCESS_SECONDS}
        onDone={goHome}
        summary={
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Payment details</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="kiosk-label">Method</span>
                <span className="text-lg text-white">E-wallet</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="kiosk-label">Reference</span>
                <span className="text-lg tabular-nums text-white">
                  {payment?.reference ?? '—'}
                </span>
              </div>
            </CardBody>
          </Card>
        }
      />
    );
  }

  if (failure) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-6">
        <Alert tone="danger" title="We need another try">
          <p>{failure}</p>
        </Alert>

        {actionError ? <p className="kiosk-label">Details: {actionError}</p> : null}

        <div className="flex flex-col gap-4 sm:flex-row">
          <Button size="lg" loading={retrying} fullWidth onClick={handleRetryCompletion}>
            Try again
          </Button>
          <Button variant="secondary" size="lg" fullWidth onClick={goHome}>
            Return home
          </Button>
        </div>
      </div>
    );
  }

  if (phase === 'creating') {
    return <SpinnerOverlay message="Creating your payment…" />;
  }

  if (phase === 'processing') {
    return <SpinnerOverlay message="Processing your payment…" />;
  }

  if (phase === 'error' || !payment) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-6">
        <Alert tone="danger" title="We could not start the e-wallet payment">
          <p>{creationError ?? 'Please try again, or choose another payment method.'}</p>
        </Alert>
        <div className="flex flex-col gap-4 sm:flex-row">
          <Button size="lg" loading={retrying} fullWidth onClick={handleRetryCreation}>
            Try again
          </Button>
          <Button variant="secondary" size="lg" fullWidth onClick={handleBack}>
            Back to payment options
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Pay with your e-wallet</CardTitle>
        <span className="kiosk-label">
          Locker {lockerLocation}
          {doorNumber}
        </span>
      </CardHeader>

      <CardBody className="space-y-6">
        <p className="text-center text-2xl font-semibold text-white">
          Scan this QR code with your e-wallet
        </p>

        <div
          role="img"
          aria-label="E-wallet payment QR code"
          className="mx-auto w-full max-w-xs rounded-2xl bg-white p-4"
        >
          <QRCode
            value={payment.qrPayload}
            size={256}
            style={{ height: 'auto', maxWidth: '100%', width: '100%' }}
          />
        </div>

        <p className="text-center">
          <Money amount={chargedAmount} symbol={currencySymbol} size="xl" />
        </p>

        <p className="kiosk-label text-center">
          Reference <span className="tabular-nums">{payment.reference}</span>
        </p>

        {network === 'offline' ? (
          <Alert tone="warning" title="This kiosk looks offline">
            Reconnect the kiosk to the network; your payment cannot be confirmed while it is offline.
          </Alert>
        ) : null}

        <Alert tone="info">
          Keep this screen open until your payment is confirmed. Do not close the browser.
        </Alert>

        <div className="flex items-center justify-center gap-3 text-kiosk-muted">
          <Spinner size="sm" label="Waiting for payment" />
          <span>Waiting for your payment…</span>
        </div>
      </CardBody>

      <CardFooter>
        <div className="flex w-full flex-col gap-4 sm:flex-row">
          <Button variant="secondary" size="lg" fullWidth onClick={handleBack}>
            Back
          </Button>
          <Link
            href="/"
            className="inline-flex min-h-[4rem] w-full items-center justify-center rounded-xl border border-transparent px-7 text-lg font-semibold text-brand-200 active:bg-kiosk-surface"
          >
            Return home
          </Link>
        </div>
      </CardFooter>
    </Card>
  );
}
