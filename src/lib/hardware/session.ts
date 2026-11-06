import type { BillAcceptorStatus, BillInsertEvent } from './protocol';

/**
 * Bill-acceptor session accounting.
 *
 * Owns the rules the legacy screen implemented inline:
 *   - only configured denominations are accepted;
 *   - a note that would exceed the target is held, because the machine
 *     never dispenses change;
 *   - the session completes the moment the target is reached.
 *
 * Keeping this in one place means the mock driver, the real driver and
 * any future driver all settle identically.
 */
export class BillSession {
  readonly transactionId: string;
  readonly targetAmount: number;
  readonly acceptedBills: number[];

  private inserted = 0;
  private readonly counts = new Map<number, number>();
  private closed = false;

  constructor(options: {
    transactionId: string;
    targetAmount: number;
    acceptedBills: number[];
  }) {
    this.transactionId = options.transactionId;
    this.targetAmount = Math.max(0, Math.trunc(options.targetAmount));
    this.acceptedBills = [...options.acceptedBills].sort((a, b) => a - b);
  }

  get totalInserted(): number {
    return this.inserted;
  }

  get remaining(): number {
    return Math.max(0, this.targetAmount - this.inserted);
  }

  get isComplete(): boolean {
    return this.remaining <= 0;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  close(): void {
    this.closed = true;
  }

  denominations(): { denomination: number; count: number }[] {
    return [...this.counts.entries()]
      .filter(([, count]) => count > 0)
      .sort(([a], [b]) => a - b)
      .map(([denomination, count]) => ({ denomination, count }));
  }

  /**
   * Classify a note the customer fed.
   *
   * Returns `accepted` (added to the total), `rejected` (wrong
   * denomination) or `hold` (would overshoot the target — the caller
   * must return the note).
   */
  handleNote(denomination: number): BillInsertEvent {
    const value = Math.trunc(denomination);

    if (this.closed) {
      return { status: 'rejected', error: { code: 'SESSION_CLOSED', message: 'Session already ended' } };
    }

    if (!this.acceptedBills.includes(value)) {
      return {
        status: 'rejected',
        accepted: false,
        error: {
          code: 'DENOMINATION_NOT_ACCEPTED',
          message: `Only ${this.acceptedBills.join(', ')} are accepted`,
        },
      };
    }

    if (this.inserted + value > this.targetAmount) {
      return {
        status: 'hold',
        accepted: false,
        data: {
          insertedAmount: value,
          totalInsertedAmount: this.inserted,
          totalAmount: this.targetAmount,
          remainingAmount: this.remaining,
          overAmount: this.inserted + value - this.targetAmount,
        },
        error: { code: 'WOULD_OVERSHOOT', message: 'Exact amount required; this machine gives no change' },
      };
    }

    this.inserted += value;
    this.counts.set(value, (this.counts.get(value) ?? 0) + 1);

    return {
      status: 'accepted',
      accepted: true,
      data: {
        insertedAmount: value,
        totalInsertedAmount: this.inserted,
        totalAmount: this.targetAmount,
        remainingAmount: this.remaining,
      },
    };
  }

  status(driver: string, connected: boolean, sessionActive: boolean): BillAcceptorStatus {
    return {
      connected,
      driver,
      sessionActive,
      target: this.targetAmount,
      totalInserted: this.inserted,
      remaining: this.remaining,
      acceptedBills: this.acceptedBills,
    };
  }
}
