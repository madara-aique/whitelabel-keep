'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { formatMoney } from '@/lib/utils';
import type { KioskConfig } from '@/types/domain';

export interface KioskContextValue extends KioskConfig {
  /** Format an amount with this kiosk's currency symbol. */
  formatAmount: (amount: number) => string;
}

const KioskContext = createContext<KioskContextValue | null>(null);

export function useKiosk(): KioskContextValue {
  const context = useContext(KioskContext);
  if (!context) {
    throw new Error('useKiosk must be used inside a <KioskProvider>. Wrap the kiosk layout in <KioskProvider config={config}>.');
  }
  return context;
}

export interface KioskProviderProps {
  config: KioskConfig;
  children: ReactNode;
}

/**
 * Single source of runtime settings for the UI: currency, rates, limits
 * and operator copy come from the serialized config, never from env reads
 * inside a Client Component.
 */
export function KioskProvider({ config, children }: KioskProviderProps) {
  const { currencySymbol } = config;

  const formatAmount = useCallback(
    (amount: number): string => formatMoney(amount, currencySymbol),
    [currencySymbol],
  );

  const value = useMemo<KioskContextValue>(
    () => ({ ...config, formatAmount }),
    [config, formatAmount],
  );

  return <KioskContext.Provider value={value}>{children}</KioskContext.Provider>;
}
