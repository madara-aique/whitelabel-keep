'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseCountdownOptions {
  seconds: number;
  onComplete?: () => void;
  autoStart?: boolean;
}

export interface UseCountdownResult {
  remaining: number;
  isRunning: boolean;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

function clampSeconds(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/**
 * Second-resolution countdown.
 *
 * The interval id lives in a ref and is cleared on unmount and whenever
 * the countdown restarts. `onComplete` is held in a ref so a new callback
 * identity never restarts the timer, and completion is decided inside the
 * interval callback — an external-system callback — rather than from a
 * synchronous effect body, so it fires exactly once and cannot cascade
 * renders.
 */
export function useCountdown({
  seconds,
  onComplete,
  autoStart = false,
}: UseCountdownOptions): UseCountdownResult {
  const initialSeconds = clampSeconds(seconds);

  const [remaining, setRemaining] = useState(initialSeconds);
  const [isRunning, setIsRunning] = useState(autoStart && initialSeconds > 0);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onCompleteRef = useRef(onComplete);
  const durationRef = useRef(initialSeconds);
  const remainingRef = useRef(initialSeconds);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const clearTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isRunning) return;

    const id = setInterval(() => {
      const next = Math.max(0, remainingRef.current - 1);
      remainingRef.current = next;
      setRemaining(next);

      if (next === 0) {
        clearInterval(id);
        intervalRef.current = null;
        setIsRunning(false);
        onCompleteRef.current?.();
      }
    }, 1000);

    intervalRef.current = id;
    return () => clearInterval(id);
  }, [isRunning]);

  // A new duration restarts the countdown from the new value.
  useEffect(() => {
    const next = clampSeconds(seconds);
    durationRef.current = next;
    if (remainingRef.current === next) return;
    clearTimer();
    remainingRef.current = next;
    setRemaining(next);
    setIsRunning(false);
  }, [seconds, clearTimer]);

  const start = useCallback(() => {
    if (durationRef.current <= 0) return;
    if (remainingRef.current <= 0) {
      remainingRef.current = durationRef.current;
      setRemaining(durationRef.current);
    }
    setIsRunning(true);
  }, []);

  const stop = useCallback(() => {
    clearTimer();
    setIsRunning(false);
  }, [clearTimer]);

  const reset = useCallback(() => {
    clearTimer();
    remainingRef.current = durationRef.current;
    setRemaining(durationRef.current);
    setIsRunning(false);
  }, [clearTimer]);

  return { remaining, isRunning, start, stop, reset };
}
