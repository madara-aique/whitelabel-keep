'use client';

import { cn } from '@/lib/utils';

export interface PinDisplayProps {
  /** Number of digit slots to render. */
  length: number;
  /** Digits entered so far. Only the first `length` characters are shown. */
  value: string;
  /** When true the digits are replaced by bullets. */
  masked?: boolean;
  /** Label for the reveal toggle; defaults to a masked/unmasked pair. */
  revealLabel?: string;
  /** Providing this renders the reveal toggle button. */
  onToggleReveal?: () => void;
  className?: string;
}

const BULLET = '\u2022';

/**
 * Fixed-width PIN slots.
 *
 * While masked, the plaintext digits never enter the DOM: each filled slot
 * renders a bullet instead, so the value cannot be read from the markup or
 * by a screen reader.
 */
export function PinDisplay({
  length,
  value,
  masked = true,
  revealLabel,
  onToggleReveal,
  className,
}: PinDisplayProps) {
  const slots = Math.max(0, Math.trunc(length));
  const digits = value.slice(0, slots);
  const entered = digits.length;
  const toggleLabel = revealLabel ?? (masked ? 'Show PIN' : 'Hide PIN');

  return (
    <div className={cn('flex flex-col items-center gap-5', className)}>
      <div
        role="group"
        aria-label={`${entered} of ${slots} digits entered`}
        className="flex flex-wrap items-center justify-center gap-3"
      >
        {Array.from({ length: slots }, (_, index) => {
          const digit = digits[index];
          const filled = digit !== undefined;
          return (
            <span
              key={index}
              aria-hidden="true"
              data-filled={filled ? 'true' : 'false'}
              className={cn(
                'flex h-[4.5rem] w-16 items-center justify-center rounded-xl border text-4xl font-semibold',
                filled
                  ? 'border-brand-500 bg-kiosk-bg text-white'
                  : 'border-kiosk-border bg-kiosk-bg/60 text-kiosk-muted',
              )}
            >
              {filled ? (masked ? BULLET : digit) : ''}
            </span>
          );
        })}
      </div>

      {onToggleReveal ? (
        <button
          type="button"
          onClick={onToggleReveal}
          aria-pressed={!masked}
          className="flex min-h-touch items-center justify-center rounded-xl border border-kiosk-border bg-kiosk-surface px-6 text-kiosk font-semibold text-brand-200 active:bg-kiosk-bg"
        >
          {toggleLabel}
        </button>
      ) : null}
    </div>
  );
}
