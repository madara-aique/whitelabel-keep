import { cn, formatMoney } from '@/lib/utils';

export type MoneySize = 'md' | 'lg' | 'xl';

export interface MoneyProps {
  amount: number;
  /** Currency symbol, always supplied by the kiosk configuration. */
  symbol: string;
  size?: MoneySize;
  className?: string;
}

const MONEY_SIZES: Record<MoneySize, string> = {
  md: 'text-2xl',
  lg: 'text-4xl',
  xl: 'text-6xl',
};

/** Renders an amount with the configured currency symbol. */
export function Money({ amount, symbol, size = 'lg', className }: MoneyProps) {
  return (
    <span className={cn('font-semibold tabular-nums text-white', MONEY_SIZES[size], className)}>
      {formatMoney(amount, symbol)}
    </span>
  );
}
