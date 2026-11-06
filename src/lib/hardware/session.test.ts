import { describe, expect, it } from 'vitest';
import { BillSession } from '@/lib/hardware/session';

const ACCEPTED_BILLS = [50, 100, 200];

function makeSession(targetAmount = 250): BillSession {
  return new BillSession({
    transactionId: 'REF-1-1730000000000',
    targetAmount,
    acceptedBills: ACCEPTED_BILLS,
  });
}

describe('BillSession', () => {
  it('accepts a valid denomination and updates the running totals', () => {
    const session = makeSession();

    const event = session.handleNote(50);

    expect(event.status).toBe('accepted');
    expect(event.accepted).toBe(true);
    expect(event.data).toMatchObject({
      insertedAmount: 50,
      totalInsertedAmount: 50,
      totalAmount: 250,
      remainingAmount: 200,
    });
    expect(session.totalInserted).toBe(50);
    expect(session.remaining).toBe(200);
    expect(session.isComplete).toBe(false);
  });

  it('rejects a denomination that is not in acceptedBills', () => {
    const session = makeSession();

    const event = session.handleNote(20);

    expect(event.status).toBe('rejected');
    expect(event.accepted).toBe(false);
    expect(event.error?.code).toBe('DENOMINATION_NOT_ACCEPTED');
    expect(session.totalInserted).toBe(0);
    expect(session.denominations()).toEqual([]);
  });

  it('holds a note that would overshoot the target and reports the over amount', () => {
    const session = makeSession();
    session.handleNote(200);

    const event = session.handleNote(100);

    expect(event.status).toBe('hold');
    expect(event.accepted).toBe(false);
    expect(event.error?.code).toBe('WOULD_OVERSHOOT');
    expect(event.data?.insertedAmount).toBe(100);
    expect(event.data?.overAmount).toBe(50);
    expect(event.data?.remainingAmount).toBe(50);
    // The held note is not counted.
    expect(session.totalInserted).toBe(200);
  });

  it('reports completion and remaining once the target is reached', () => {
    const session = makeSession();
    session.handleNote(200);

    const event = session.handleNote(50);

    expect(event.status).toBe('accepted');
    expect(event.data?.remainingAmount).toBe(0);
    expect(session.remaining).toBe(0);
    expect(session.isComplete).toBe(true);
  });

  it('lists only the denominations that were counted, ascending', () => {
    const session = makeSession(400);
    session.handleNote(100);
    session.handleNote(100);
    session.handleNote(200);

    expect(session.denominations()).toEqual([
      { denomination: 100, count: 2 },
      { denomination: 200, count: 1 },
    ]);
  });

  it('rejects any note after the session is closed', () => {
    const session = makeSession();
    session.close();

    const event = session.handleNote(50);

    expect(session.isClosed).toBe(true);
    expect(event.status).toBe('rejected');
    expect(event.error?.code).toBe('SESSION_CLOSED');
    expect(session.totalInserted).toBe(0);
  });
});
