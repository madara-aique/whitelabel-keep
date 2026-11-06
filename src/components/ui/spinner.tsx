import { cn } from '@/lib/utils';

export type SpinnerSize = 'sm' | 'md' | 'lg';

export interface SpinnerProps {
  size?: SpinnerSize;
  /** Accessible name announced while the spinner is visible. */
  label?: string;
  className?: string;
}

const SPINNER_SIZES: Record<SpinnerSize, string> = {
  sm: 'h-5 w-5 border-2',
  md: 'h-9 w-9 border-[3px]',
  lg: 'h-14 w-14 border-4',
};

/** Pure CSS spinner — no external dependency. */
export function Spinner({ size = 'md', label = 'Loading', className }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        'inline-block animate-spin rounded-full border-current border-t-transparent text-brand-300',
        SPINNER_SIZES[size],
        className,
      )}
    />
  );
}

export interface SpinnerOverlayProps {
  /** Blocking message shown under the spinner. */
  message?: string;
  className?: string;
}

/**
 * Full-surface block used while the kiosk must not accept input:
 * talking to the hardware gateway, charging a card, opening a door.
 */
export function SpinnerOverlay({ message, className }: SpinnerOverlayProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        'fixed inset-0 z-[70] flex flex-col items-center justify-center gap-5 bg-kiosk-bg/85 px-8 text-center backdrop-blur-sm',
        className,
      )}
    >
      <Spinner size="lg" label={message ?? 'Please wait'} />
      {message ? <p className="text-xl font-medium text-white">{message}</p> : null}
    </div>
  );
}
