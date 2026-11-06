'use client';

import { cn } from '@/lib/utils';

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastMessage {
  id: string;
  message: string;
  tone: ToastTone;
}

export interface ToastProps {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}

const TONE_CLASSES: Record<ToastTone, string> = {
  info: 'border-brand-500/60 bg-kiosk-surface text-white',
  success: 'border-success/60 bg-kiosk-surface text-white',
  error: 'border-danger/60 bg-kiosk-surface text-white',
};

/** Accent bar colour per tone, so the tone reads at a glance. */
const TONE_ACCENTS: Record<ToastTone, string> = {
  info: 'bg-brand-500',
  success: 'bg-success',
  error: 'bg-danger',
};

export function Toast({ toast, onDismiss }: ToastProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      onClick={() => onDismiss(toast.id)}
      className={cn(
        'pointer-events-auto flex animate-fade-in items-center gap-4 overflow-hidden rounded-xl border px-5 py-4 text-kiosk shadow-2xl',
        TONE_CLASSES[toast.tone],
      )}
    >
      <span aria-hidden="true" className={cn('h-12 w-1.5 shrink-0 rounded-full', TONE_ACCENTS[toast.tone])} />
      <p className="flex-1 leading-snug">{toast.message}</p>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={(event) => {
          event.stopPropagation();
          onDismiss(toast.id);
        }}
        className="flex min-h-touch min-w-touch items-center justify-center rounded-lg border border-kiosk-border text-lg text-white active:bg-kiosk-bg"
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}

export interface ToastViewportProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
  className?: string;
}

/**
 * Stack of toasts pinned to the bottom-right, above the kiosk footer.
 * The container ignores pointer events so it never blocks the page; each
 * toast re-enables them for its own tap-to-dismiss surface.
 */
export function ToastViewport({ toasts, onDismiss, className }: ToastViewportProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      className={cn(
        'pointer-events-none fixed bottom-24 right-4 z-[60] flex w-[min(26rem,calc(100vw-2rem))] flex-col gap-3',
        className,
      )}
    >
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
