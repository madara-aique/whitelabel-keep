'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { cancelBookingAction } from '@/app/actions/booking';
import { Alert, Button, Card, CardBody, CardFooter } from '@/components/ui';
import { useKiosk } from '@/context/kiosk-provider';
import { useToast } from '@/context/toast-provider';
import { cn } from '@/lib/utils';
import type { PaymentMethod } from '@/types/domain';

/**
 * Payment method picker.
 *
 * The booking itself was created when the customer confirmed their locker
 * details, so this screen only chooses how to settle it. Leaving with
 * `Back` cancels that booking — awaited, because the navigation unmounts
 * the component and a fire-and-forget cancel would be lost with it.
 */

export interface PaymentMethodPickerProps {
  /** Booking awaiting payment, or null when it could not be started. */
  transId: string | null;
  doorNumber: string;
  lockerLocation: string;
  alias: string;
  pin: string;
}

interface MethodCardProps {
  label: string;
  description: string;
  selected: boolean;
  disabled: boolean;
  note?: string;
  onSelect: () => void;
}

/** Large tappable card used for the two payment methods. */
function MethodCard({
  label,
  description,
  selected,
  disabled,
  note,
  onSelect,
}: MethodCardProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex min-h-[10rem] flex-col items-start gap-2 rounded-3xl border p-6 text-left transition-colors',
        'border-kiosk-border bg-kiosk-surface text-white active:bg-kiosk-bg',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-400/60',
        selected && 'border-brand-400 ring-4 ring-brand-400/60',
        disabled && 'cursor-not-allowed opacity-50 active:bg-kiosk-surface',
      )}
    >
      <span className="text-2xl font-semibold">{label}</span>
      <span className="text-kiosk text-white/80">{description}</span>
      <span className={cn('mt-auto text-kiosk', disabled ? 'text-kiosk-muted' : 'text-amber-200')}>
        {selected ? 'Selected' : (note ?? '')}
      </span>
    </button>
  );
}

/** Build the URL of a payment screen, encoding every value. */
function paymentHref(
  method: PaymentMethod,
  params: { transId: string; doorNumber: string; lockerLocation: string; alias: string; pin: string },
): string {
  const query = new URLSearchParams({
    transId: params.transId,
    doorNumber: params.doorNumber,
    lockerLocation: params.lockerLocation,
    alias: params.alias,
    pin: params.pin,
  });
  return `/payment/${method}?${query.toString()}`;
}

export function PaymentMethodPicker({
  transId,
  doorNumber,
  lockerLocation,
  alias,
  pin,
}: PaymentMethodPickerProps) {
  const router = useRouter();
  const config = useKiosk();
  const toast = useToast();

  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const missingBooking = transId === null;
  const eWalletAvailable = config.eWalletEnabled && !missingBooking;
  const cashAvailable = config.billAcceptorEnabled && !missingBooking;

  const goHome = useCallback(() => {
    router.push('/');
  }, [router]);

  async function handleBack(): Promise<void> {
    setCancelling(true);
    try {
      // The cancellation must finish before this component unmounts, so it is
      // awaited rather than fired and forgotten.
      if (transId !== null) {
        const result = await cancelBookingAction(transId);
        if (!result.ok) {
          toast.error('We could not cancel the booking. Please ask the cashier for help.');
        }
      }
    } catch {
      toast.error('We could not cancel the booking. Please ask the cashier for help.');
    } finally {
      setCancelling(false);
    }
    goHome();
  }

  function handleNext(): void {
    if (method === null || transId === null) return;
    router.push(paymentHref(method, { transId, doorNumber, lockerLocation, alias, pin }));
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="kiosk-heading">Select payment method</h1>
        <p className="kiosk-label mt-1">Get your receipt at the cashier</p>
        <p className="kiosk-label mt-1">
          Locker {lockerLocation}
          {doorNumber}
          {alias ? ` · ${alias}` : ''}
        </p>
      </header>

      {missingBooking ? (
        <Alert tone="danger" title="We could not start your booking">
          <p>No booking was registered for this locker, so no payment can be taken.</p>
          <Link
            href={`/details?doorNumber=${encodeURIComponent(doorNumber)}&lockerLocation=${encodeURIComponent(
              lockerLocation,
            )}&alias=${encodeURIComponent(alias)}&doorStatus=0`}
            className="mt-3 inline-flex min-h-touch items-center justify-center rounded-xl bg-brand-600 px-6 font-semibold text-white active:bg-brand-700"
          >
            Back to the locker
          </Link>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <MethodCard
          label="E-Wallet"
          description="Pay with your e-wallet app."
          selected={method === 'ewallet'}
          disabled={!eWalletAvailable || cancelling}
          note={config.eWalletEnabled ? undefined : 'Not available on this kiosk.'}
          onSelect={() => setMethod('ewallet')}
        />
        <MethodCard
          label="Cash"
          description="Insert bills into the machine."
          selected={method === 'cash'}
          disabled={!cashAvailable || cancelling}
          note={config.billAcceptorEnabled ? undefined : 'Not available on this kiosk.'}
          onSelect={() => setMethod('cash')}
        />
      </div>

      {method === 'cash' ? (
        <Alert tone="warning" title="No change is given">
          This machine does not give change. Please insert the exact amount.
        </Alert>
      ) : null}

      <Card>
        <CardBody className="text-kiosk text-white/80">
          {method === null
            ? 'Choose how you would like to pay.'
            : method === 'cash'
              ? 'Have the exact amount ready before you start.'
              : 'Open your e-wallet app when the code appears.'}
        </CardBody>
        <CardFooter className="justify-between">
          <Button variant="secondary" size="lg" loading={cancelling} disabled={cancelling} onClick={handleBack}>
            Back
          </Button>
          <Button size="lg" disabled={method === null || missingBooking || cancelling} onClick={handleNext}>
            Next
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
