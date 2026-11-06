'use client';

import { useEffect, useRef } from 'react';

/**
 * Detect a barcode-scanner burst.
 *
 * Scanners type very fast and finish with Enter, so a burst of
 * keystrokes arriving within `maxIntervalMs` of each other is treated as
 * a scan rather than a human typing. The legacy app used a third-party
 * hook that could not be called conditionally; this version is a plain
 * effect with a full cleanup.
 */
export interface UseScanCodeOptions {
  onScan: (code: string) => void;
  enabled?: boolean;
  /** Maximum gap between keystrokes for the burst to count as a scan. */
  maxIntervalMs?: number;
  /** Discard a partial burst after this much silence. */
  idleTimeoutMs?: number;
  minLength?: number;
}

export function useScanCode({
  onScan,
  enabled = true,
  maxIntervalMs = 50,
  idleTimeoutMs = 300,
  minLength = 4,
}: UseScanCodeOptions): void {
  // Keep the callback in a ref so changing it never re-binds the listener.
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;

    let buffer = '';
    let lastKeyAt = 0;
    let resetTimer: ReturnType<typeof setTimeout> | null = null;

    const reset = () => {
      buffer = '';
      lastKeyAt = 0;
      if (resetTimer) {
        clearTimeout(resetTimer);
        resetTimer = null;
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore input the customer is typing into a real field.
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      const now = Date.now();
      if (lastKeyAt && now - lastKeyAt > maxIntervalMs) {
        // Too slow to be a scanner: start over.
        buffer = '';
      }
      lastKeyAt = now;

      if (event.key === 'Enter') {
        const code = buffer.trim();
        reset();
        if (code.length >= minLength) onScanRef.current(code);
        return;
      }

      if (event.key.length === 1) {
        buffer += event.key;
        if (resetTimer) clearTimeout(resetTimer);
        resetTimer = setTimeout(reset, idleTimeoutMs);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (resetTimer) clearTimeout(resetTimer);
    };
  }, [enabled, maxIntervalMs, idleTimeoutMs, minLength]);
}
