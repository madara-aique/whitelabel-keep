'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'md' | 'lg' | 'xl';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Show an inline CSS spinner and disable the control. */
  loading?: boolean;
  fullWidth?: boolean;
  children?: ReactNode;
}

const BASE_CLASSES =
  'inline-flex select-none items-center justify-center rounded-xl font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-400/60 disabled:cursor-not-allowed disabled:opacity-60';

/**
 * Touch-first palette. There are deliberately no `hover:` affordances:
 * a kiosk driven by fingers has no hover state, so feedback comes from
 * `active:` and the focus ring.
 */
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white active:bg-brand-700 disabled:active:bg-brand-600',
  secondary:
    'border border-kiosk-border bg-kiosk-surface text-white active:bg-kiosk-bg disabled:active:bg-kiosk-surface',
  danger: 'bg-danger text-white active:bg-red-700 disabled:active:bg-danger',
  ghost:
    'border border-transparent bg-transparent text-brand-200 active:bg-kiosk-surface disabled:active:bg-transparent',
};

/** Every size keeps the control at or above the 56px touch minimum. */
const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: 'min-h-touch gap-2 px-5 text-kiosk',
  lg: 'min-h-[4rem] gap-3 px-7 text-lg',
  xl: 'min-h-[4.5rem] gap-3 px-9 text-xl',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    fullWidth = false,
    disabled,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={cn(
        BASE_CLASSES,
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : null}
      {children}
    </button>
  );
});

Button.displayName = 'Button';
