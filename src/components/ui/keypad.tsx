'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface KeypadProps {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  disabled?: boolean;
  /** When `value` reaches this length, digit keys stop responding. */
  maxLength?: number;
  /** Current entry, used only to decide when a key is no longer useful. */
  value?: string;
  className?: string;
}

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/** 72px minimum on both axes: comfortable for a finger, not just a mouse. */
const KEY_CLASSES =
  'flex min-h-[4.5rem] min-w-[4.5rem] w-full items-center justify-center rounded-2xl border border-kiosk-border bg-kiosk-surface text-3xl font-semibold text-white transition-colors active:bg-brand-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-400/60 disabled:opacity-40';

interface KeypadKeyProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

function KeypadKey({ label, onPress, disabled = false, className, children }: KeypadKeyProps) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onPress}
      className={cn(KEY_CLASSES, className)}
    >
      {children}
    </button>
  );
}

/**
 * Numeric keypad laid out as a 4-column grid:
 * 1-9, backspace, 0, clear.
 */
export function Keypad({
  onDigit,
  onBackspace,
  onClear,
  disabled = false,
  maxLength,
  value,
  className,
}: KeypadProps) {
  const entered = value?.length ?? 0;
  const atMaxLength = maxLength !== undefined && entered >= maxLength;
  const digitsDisabled = disabled || atMaxLength;
  const backspaceDisabled = disabled || (value !== undefined && value.length === 0);

  return (
    <div className={cn('grid grid-cols-4 gap-3', className)}>
      {DIGITS.map((digit) => (
        <KeypadKey
          key={digit}
          label={`Digit ${digit}`}
          disabled={digitsDisabled}
          onPress={() => onDigit(digit)}
        >
          {digit}
        </KeypadKey>
      ))}

      <KeypadKey label="Backspace" disabled={backspaceDisabled} onPress={onBackspace}>
        <span aria-hidden="true">⌫</span>
      </KeypadKey>

      <KeypadKey label="Digit 0" disabled={digitsDisabled} onPress={() => onDigit('0')}>
        0
      </KeypadKey>

      <KeypadKey label="Clear entry" disabled={disabled} onPress={onClear} className="text-lg">
        Clear
      </KeypadKey>
    </div>
  );
}
