import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type AlertTone = 'info' | 'warning' | 'danger' | 'success';

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  tone?: AlertTone;
  /** Optional heading shown above the message. */
  title?: string;
  children?: ReactNode;
}

const TONE_CLASSES: Record<AlertTone, string> = {
  info: 'border-brand-500/50 bg-brand-500/10 text-brand-100',
  warning: 'border-warning/50 bg-warning/10 text-amber-100',
  danger: 'border-danger/60 bg-danger/10 text-red-100',
  success: 'border-success/50 bg-success/10 text-emerald-100',
};

/** Optional glyph per tone; purely decorative. */
const TONE_GLYPHS: Record<AlertTone, string> = {
  info: 'i',
  warning: '!',
  danger: '!',
  success: '✓',
};

/**
 * Inline status message. Announced politely so a screen reader hears the
 * outcome without having its current reading interrupted.
 */
export function Alert({ tone = 'info', title, className, children, ...rest }: AlertProps) {
  return (
    <div
      role="alert"
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        'flex items-start gap-4 rounded-xl border px-5 py-4 text-kiosk',
        TONE_CLASSES[tone],
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-current text-sm font-bold"
      >
        {TONE_GLYPHS[tone]}
      </span>
      <div className="flex flex-col gap-1">
        {title ? <p className="text-lg font-semibold">{title}</p> : null}
        <div className="leading-relaxed">{children}</div>
      </div>
    </div>
  );
}
