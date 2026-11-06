'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ToastViewport, type ToastMessage, type ToastTone } from '@/components/ui/toast';

/** How long a toast stays on screen before it dismisses itself. */
const TOAST_DURATION_MS = 4_000;

/** Keep the stack short; a kiosk has no room for a wall of messages. */
const MAX_TOASTS = 4;

export interface ToastApi {
  /** Show a message and return its id, so it can be dismissed early. */
  show: (message: string, tone?: ToastTone) => string;
  success: (message: string) => string;
  error: (message: string) => string;
  info: (message: string) => string;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used inside a <ToastProvider>. Wrap the kiosk layout in <ToastProvider>.');
  }
  return context;
}

export interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const counterRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (message: string, tone: ToastTone = 'info'): string => {
      counterRef.current += 1;
      const id = `toast-${counterRef.current}`;

      setToasts((previous) => [...previous, { id, message, tone }].slice(-MAX_TOASTS));

      timersRef.current.set(
        id,
        setTimeout(() => dismiss(id), TOAST_DURATION_MS),
      );

      return id;
    },
    [dismiss],
  );

  // Every auto-dismiss timer is cleared when the provider goes away.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const value = useMemo<ToastApi>(
    () => ({
      show,
      success: (message: string) => show(message, 'success'),
      error: (message: string) => show(message, 'error'),
      info: (message: string) => show(message, 'info'),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}
