'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelBookingAction, settleBookingAction } from '@/app/actions/booking';
import { PaymentSuccess } from '@/components/kiosk/payment-success';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CardTitle,
  Modal,
  Money,
  Spinner,
  SpinnerOverlay,
  type AlertTone,
} from '@/components/ui';
import { useHardware } from '@/context/hardware-provider';
import { useKiosk } from '@/context/kiosk-provider';
import { useBillSession, type BillSessionSummary } from '@/hooks/use-bill-session';
import type { BillInsertEvent } from '@/lib/hardware/protocol';
import type { BillCount } from '@/types/domain';

export interface CashPaymentProps {
  transId: string | null;
  doorNumber: string;
  lockerLocation: string;
  alias: string;
  pin: string;
}

/** How long the "connecting" overlay stays up before the session starts. */
const CONNECT_SETTLE_MS = 1_000;

/** Countdown before the kiosk returns home after a successful payment. */
const SUCCESS_SECONDS = 8;

/** Friendly copy for a note the acceptor would not take. */
function rejectedNotice(acceptedText: string): string {
  return acceptedText
    ? `Only ${acceptedText} notes are accepted.`
    : 'That note is not accepted. Please use a note shown on screen.';
}

const EXACT_AMOUNT_NOTICE = 'Exact amount required. This machine does not give change.';

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
 * Cash payment screen.
 *
 * Drives the bill acceptor through `useBillSession`, then settles the
 * booking and opens the door. Every step that must not repeat is guarded
 * by its own ref, and every failure path leaves the customer a way out —
 * the legacy screen could sit on a disabled spinner forever.
 */
export function CashPayment({ transId, doorNumber, lockerLocation, alias, pin }: CashPaymentProps) {
  const router = useRouter();
  const config = useKiosk();
  const { currencySymbol, effectiveRate, acceptedBills, billAcceptorEnabled, formatAmount } = config;
  const { openDoors, subscribeToInserts } = useHardware();

  const selectionHref = paymentSelectionHref({ transId, doorNumber, lockerLocation, alias, pin });
  const acceptedLabels = acceptedBills.map((denomination) => formatAmount(denomination));
  const acceptedText = acceptedLabels.join(', ');

  // A stable correlation id for the hardware session. The booking id is
  // preferred; the fallback only matters for direct visits.
  const [sessionTransactionId] = useState(
    () => transId ?? `CASH-${doorNumber}-${Date.now().toString(36)}`,
  );

  const [notice, setNotice] = useState<{ tone: AlertTone; text: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);

  // Step guards: the `*ing` refs stop concurrent duplicates, the plain
  // refs stop a step from ever running twice once it has succeeded.
  const settlingRef = useRef(false);
  const settledRef = useRef(false);
  const openingRef = useRef(false);
  const openedRef = useRef(false);
  /** The session completion callback is not guaranteed to be unique. */
  const completionRef = useRef(false);
  const startRef = useRef<() => Promise<void>>(async () => undefined);
  const totalRef = useRef(0);
  const billsRef = useRef<BillCount[]>([]);

  /** Human-readable outcome once one of the two completion steps fails. */
  const failureMessage = useCallback((): string => {
    if (openedRef.current && !settledRef.current) {
      return `Locker ${doorNumber} has been opened, but we could not update your booking. Please continue to your locker; contact support so the booking can be corrected.`;
    }
    if (settledRef.current && !openedRef.current) {
      return `Your payment was recorded, but locker ${doorNumber} did not open. Tap “Try again” to open it, or contact support.`;
    }
    return `We could not record your payment or open locker ${doorNumber}. Tap “Try again”; if it keeps failing, please contact support. Cash already inserted cannot be refunded automatically.`;
  }, [doorNumber]);

  /**
   * Settle the booking, then open the door, then reveal the success panel.
   *
   * Safe to call again from the retry button: each successful step is
   * remembered, so a retry only repeats what actually failed.
   */
  const completePayment = useCallback(async (): Promise<void> => {
    if (settledRef.current && openedRef.current) {
      setFailure(null);
      setCompleted(true);
      return;
    }

    if (!settledRef.current && !settlingRef.current) {
      if (!transId) {
        setCompleted(false);
        setFailure(
          'This screen has no booking reference, so your payment could not be recorded. Please show this screen to a member of staff.',
        );
        return;
      }

      settlingRef.current = true;
      let settled = false;
      try {
        const outcome = await bounded(
          settleBookingAction(transId, {
            payType: 'CASH',
            amount: totalRef.current > 0 ? totalRef.current : effectiveRate,
            bills: billsRef.current,
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
  }, [doorNumber, effectiveRate, failureMessage, openDoors, transId]);

  // Latest completion routine, reachable from the session callback without
  // forcing the hook to rebuild its subscription mid-session.
  const completePaymentRef = useRef(completePayment);
  useEffect(() => {
    completePaymentRef.current = completePayment;
  }, [completePayment]);

  const session = useBillSession({
    target: effectiveRate,
    transactionId: sessionTransactionId,
    onComplete: (summary: BillSessionSummary) => {
      totalRef.current = summary.totalInserted;
      billsRef.current = summary.bills;
      if (completionRef.current) return;
      completionRef.current = true;
      void completePaymentRef.current();
    },
  });

  const {
    phase,
    totalInserted,
    remaining,
    bills,
    lastError,
    start,
    cancel,
    isEmulator,
    feedNote,
  } = session;

  useEffect(() => {
    totalRef.current = totalInserted;
  }, [totalInserted]);

  useEffect(() => {
    billsRef.current = bills;
  }, [bills]);

  useEffect(() => {
    startRef.current = start;
  }, [start]);

  // Deliberate settle delay so the customer sees the acceptor initialise,
  // then start the session. The timer is cleared if the screen goes away.
  useEffect(() => {
    if (!billAcceptorEnabled) return;
    const timer = window.setTimeout(() => {
      void startRef.current();
    }, CONNECT_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [billAcceptorEnabled]);

  // Turn raw insert events into customer-facing copy. Held notes are
  // already returned to the customer by the session hook itself.
  useEffect(() => {
    if (!billAcceptorEnabled) return;
    const unsubscribe = subscribeToInserts((event: BillInsertEvent) => {
      if (event.status === 'accepted') {
        setNotice(null);
        return;
      }
      if (event.status === 'hold') {
        setNotice({ tone: 'warning', text: EXACT_AMOUNT_NOTICE });
        return;
      }
      setNotice({ tone: 'danger', text: rejectedNotice(acceptedText) });
    });
    return unsubscribe;
  }, [acceptedText, billAcceptorEnabled, subscribeToInserts]);

  const handleRetry = useCallback(() => {
    setRetrying(true);
    setFailure(null);
    void completePayment().finally(() => setRetrying(false));
  }, [completePayment]);

  const goHome = useCallback(() => {
    router.push('/');
  }, [router]);

  const goBackToSelection = useCallback(() => {
    router.push(selectionHref);
  }, [router, selectionHref]);

  const cancelAndLeave = useCallback(async () => {
    setCancelling(true);
    try {
      await cancel();
    } catch {
      // Ending the hardware session must never trap the customer.
    }
    if (transId) {
      try {
        await cancelBookingAction(transId);
      } catch {
        // The booking can be reconciled by an operator; navigation wins.
      }
    }
    setShowCancelModal(false);
    setCancelling(false);
    goBackToSelection();
  }, [cancel, goBackToSelection, transId]);

  const handleCancel = useCallback(() => {
    if (totalInserted > 0) {
      setShowCancelModal(true);
      return;
    }
    void cancelAndLeave();
  }, [cancelAndLeave, totalInserted]);

  // ── Render ─────────────────────────────────────────────────────────

  if (!billAcceptorEnabled) {
    return (
      <Card className="mx-auto max-w-xl text-center">
        <CardBody className="py-10">
          <h1 className="kiosk-heading">Cash payment is unavailable at this kiosk</h1>
          <p className="kiosk-label mt-4">
            Please choose another payment method, or ask a member of staff for help.
          </p>
          <div className="mt-8">
            <Link
              href={selectionHref}
              className="inline-flex min-h-touch items-center justify-center rounded-xl bg-brand-600 px-7 text-lg font-semibold text-white active:bg-brand-700"
            >
              Back to payment options
            </Link>
          </div>
        </CardBody>
      </Card>
    );
  }

  if (completed) {
    return (
      <PaymentSuccess
        title="Payment successful"
        amount={totalInserted > 0 ? totalInserted : effectiveRate}
        seconds={SUCCESS_SECONDS}
        onDone={goHome}
        summary={
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Cash received</CardTitle>
            </CardHeader>
            <CardBody>
              {bills.length === 0 ? (
                <p className="kiosk-label">No note breakdown was recorded.</p>
              ) : (
                <ul className="divide-y divide-kiosk-border">
                  {bills.map((bill) => (
                    <li
                      key={bill.denomination}
                      className="flex items-center justify-between py-3 text-lg"
                    >
                      <span>
                        {formatAmount(bill.denomination)} × {bill.count}
                      </span>
                      <span className="font-semibold tabular-nums">
                        {formatAmount(bill.denomination * bill.count)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
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
          <Button size="lg" loading={retrying} fullWidth onClick={handleRetry}>
            Try again
          </Button>
          <Button variant="secondary" size="lg" fullWidth onClick={goHome}>
            Return home
          </Button>
        </div>
      </div>
    );
  }

  if (phase === 'idle' || phase === 'connecting') {
    return <SpinnerOverlay message="Connecting to the bill acceptor…" />;
  }

  if (phase === 'complete') {
    return <SpinnerOverlay message="Finishing your payment…" />;
  }

  if (phase === 'error') {
    return (
      <div className="mx-auto w-full max-w-xl space-y-6">
        <Alert tone="danger" title="The bill acceptor is unavailable">
          <p>
            {lastError ?? 'The cash acceptor could not be started.'} No payment has been taken.
          </p>
        </Alert>
        <div className="flex flex-col gap-4 sm:flex-row">
          <Button
            size="lg"
            fullWidth
            onClick={() => {
              void startRef.current();
            }}
          >
            Try again
          </Button>
          <Button variant="secondary" size="lg" fullWidth onClick={goBackToSelection}>
            Back to payment options
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Card className="mx-auto w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Insert cash</CardTitle>
          <span className="kiosk-label">
            Locker {lockerLocation}
            {doorNumber}
          </span>
        </CardHeader>

        <CardBody className="space-y-8">
          <div className="text-center">
            <p className="kiosk-label">Inserted so far</p>
            <p className="mt-2">
              <Money amount={totalInserted} symbol={currencySymbol} size="xl" />
            </p>
            <p className="kiosk-label mt-3">
              Still due: <Money amount={remaining} symbol={currencySymbol} size="md" />
            </p>
          </div>

          <div className="text-center">
            <p className="kiosk-label">Accepted notes</p>
            <ul className="mt-3 flex flex-wrap justify-center gap-3">
              {acceptedBills.map((denomination) => (
                <li
                  key={denomination}
                  className="rounded-full border border-kiosk-border bg-kiosk-bg px-5 py-2 text-lg font-semibold tabular-nums text-white"
                >
                  {formatAmount(denomination)}
                </li>
              ))}
            </ul>
          </div>

          {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

          {lastError && !notice ? <Alert tone="warning">{lastError}</Alert> : null}

          <Alert tone="warning" title="No change is given">
            Cash inserted before cancelling cannot be refunded. Please insert the exact amount.
          </Alert>

          {isEmulator ? (
            <div className="rounded-2xl border-2 border-dashed border-warning/70 bg-warning/10 p-5">
              <p className="text-sm font-bold uppercase tracking-widest text-amber-200">
                Developer emulator — not customer facing
              </p>
              <p className="kiosk-label mt-2 text-base">
                Simulate feeding a note into the acceptor:
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                {acceptedBills.map((denomination) => (
                  <Button
                    key={denomination}
                    variant="secondary"
                    size="lg"
                    onClick={() => {
                      void feedNote(denomination);
                    }}
                  >
                    Feed {formatAmount(denomination)}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-center gap-3 text-kiosk-muted">
            <Spinner size="sm" label="Waiting for notes" />
            <span>Waiting for your notes…</span>
          </div>
        </CardBody>

        <CardFooter>
          <Button variant="secondary" size="lg" fullWidth onClick={handleCancel}>
            Cancel
          </Button>
        </CardFooter>
      </Card>

      <Modal
        open={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        title="Cancel this payment?"
        footer={
          <>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => setShowCancelModal(false)}
              disabled={cancelling}
            >
              Keep paying
            </Button>
            <Button
              variant="danger"
              size="lg"
              loading={cancelling}
              onClick={() => {
                void cancelAndLeave();
              }}
            >
              Cancel payment
            </Button>
          </>
        }
      >
        <p>
          You have inserted {formatAmount(totalInserted)}. Cash already inserted cannot be refunded,
          and this booking will be cancelled.
        </p>
      </Modal>
    </>
  );
}
