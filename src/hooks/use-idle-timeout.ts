'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseIdleTimeoutOptions {
  /** Seconds of inactivity before `onIdle` fires. */
  seconds: number;
  onIdle?: () => void;
  enabled?: boolean;
}

export interface UseIdleTimeoutResult {
  secondsRemaining: number;
  reset: () => void;
}

function clampSeconds(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/** Passive listener options; the kiosk must never block scrolling to observe it. */
const PASSIVE: AddEventListenerOptions = { passive: true };

/**
 * Fires `onIdle` after a period without touch, key, pointer or wheel
 * activity. Every listener and the ticking interval are removed on
 * cleanup, and inactivity restarts the clock.
 */
export function useIdleTimeout({
  seconds,
  onIdle,
  enabled = true,
}: UseIdleTimeoutOptions): UseIdleTimeoutResult {
  const total = clampSeconds(seconds);

  const [secondsRemaining, setSecondsRemaining] = useState(total);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const remainingRef = useRef(total);
  const secondsRef = useRef(total);
  const onIdleRef = useRef(onIdle);

  useEffect(() => {
    onIdleRef.current = onIdle;
  }, [onIdle]);

  // Publish only real changes: activity events arrive in bursts and must
  // not re-render the kiosk on every tap.
  const publish = useCallback((value: number) => {
    if (remainingRef.current === value) return;
    remainingRef.current = value;
    setSecondsRemaining(value);
  }, []);

  const stopTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();

    const duration = secondsRef.current;
    publish(duration);
    if (duration <= 0) return;

    let left = duration;
    intervalRef.current = setInterval(() => {
      left -= 1;
      publish(Math.max(0, left));
      if (left <= 0) {
        stopTimer();
        onIdleRef.current?.();
      }
    }, 1000);
  }, [publish, stopTimer]);

  const reset = useCallback(() => {
    startTimer();
  }, [startTimer]);

  useEffect(() => {
    secondsRef.current = total;

    if (!enabled) {
      stopTimer();
      publish(total);
      return;
    }

    startTimer();

    const onActivity = () => {
      startTimer();
    };

    window.addEventListener('pointerdown', onActivity, PASSIVE);
    window.addEventListener('touchstart', onActivity, PASSIVE);
    window.addEventListener('wheel', onActivity, PASSIVE);
    window.addEventListener('keydown', onActivity, PASSIVE);

    return () => {
      window.removeEventListener('pointerdown', onActivity, PASSIVE);
      window.removeEventListener('touchstart', onActivity, PASSIVE);
      window.removeEventListener('wheel', onActivity, PASSIVE);
      window.removeEventListener('keydown', onActivity, PASSIVE);
      stopTimer();
    };
  }, [enabled, total, startTimer, stopTimer, publish]);

  return { secondsRemaining, reset };
}
