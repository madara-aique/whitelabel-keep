'use client';

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { Button, Money } from '@/components/ui';
import { useKiosk } from '@/context/kiosk-provider';
import { useCountdown } from '@/hooks/use-countdown';

export interface PaymentSuccessProps {
  /** Headline shown above the amount. */
  title: string;
  /** Amount actually collected for this booking. */
  amount: number;
  /** Optional detail block, e.g. the accepted denominations. */
  summary?: ReactNode;
  /** Invoked by both the countdown and the button. */
  onDone: () => void;
  /** Seconds before the kiosk returns home on its own. Defaults to 8. */
  seconds?: number;
}

/**
 * Shared "payment successful" panel.
 *
 * Owns only presentation and the return-home countdown: the payment
 * screens decide when a payment is really complete. The callback is held
 * in a ref so a new `onDone` identity never restarts the countdown.
 */
export function PaymentSuccess({
  title,
  amount,
  summary,
  onDone,
  seconds = 8,
}: PaymentSuccessProps) {
  const { currencySymbol } = useKiosk();

  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const handleDone = useCallback(() => {
    onDoneRef.current();
  }, []);

  const { remaining } = useCountdown({
    seconds,
    onComplete: handleDone,
    autoStart: true,
  });

  return (
    <section className="animate-fade-in mx-auto w-full max-w-xl text-center">
      <span
        aria-hidden="true"
        className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border-2 border-success/60 bg-success/15 text-4xl text-success"
      >
        ✓
      </span>

      <h1 className="kiosk-heading mt-6">{title}</h1>

      <p className="mt-4">
        <Money amount={amount} symbol={currencySymbol} size="xl" className="text-success" />
      </p>

      {summary ? <div className="mt-8 text-left">{summary}</div> : null}

      <p aria-live="polite" className="kiosk-label mt-8">
        Returning to the home screen in {remaining} second{remaining === 1 ? '' : 's'}.
      </p>

      <div className="mt-6">
        <Button size="lg" fullWidth onClick={handleDone}>
          Back to home
        </Button>
      </div>
    </section>
  );
}
