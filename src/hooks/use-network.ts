'use client';

import { useEffect, useState } from 'react';

export type NetworkStatus = 'online' | 'offline' | 'unknown';

/**
 * Browser connectivity as reported by the platform.
 *
 * Deliberately no external ping: a kiosk on a LAN-only site is online for
 * our purposes even when it cannot reach the public internet.
 */
export function useNetwork(): NetworkStatus {
  // 'unknown' until mount so the server render and the first client render
  // produce identical markup.
  const [status, setStatus] = useState<NetworkStatus>('unknown');

  useEffect(() => {
    const update = () => {
      setStatus(navigator.onLine ? 'online' : 'offline');
    };

    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);

    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return status;
}
