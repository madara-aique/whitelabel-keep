'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHardware } from '@/context/hardware-provider';
import { useKiosk } from '@/context/kiosk-provider';
import type { BillInsertEvent, HardwareAck } from '@/lib/hardware/protocol';
import type { BillCount } from '@/types/domain';

export type BillSessionPhase = 'idle' | 'connecting' | 'accepting' | 'complete' | 'error';

export interface BillSessionSummary {
  totalInserted: number;
  bills: BillCount[];
}

export interface UseBillSessionOptions {
  /** Amount owed for this transaction. */
  target: number;
  transactionId: string;
  onComplete?: (summary: BillSessionSummary) => void;
}

export interface UseBillSessionResult {
  phase: BillSessionPhase;
  totalInserted: number;
  remaining: number;
  bills: BillCount[];
  lastError: string | null;
  start: () => Promise<void>;
  cancel: () => Promise<void>;
  isEmulator: boolean;
  /** Emulator only: simulate feeding one note. */
  feedNote: (denomination: number) => Promise<HardwareAck>;
}

/** The acceptor never dispenses change, so an overshoot is always this error. */
const EXACT_AMOUNT_ERROR = 'Exact amount required — this machine gives no change.';
const REJECTED_NOTE_ERROR = 'That note was not accepted.';

const BILL_ERROR_MESSAGES: Record<string, string> = {
  DENOMINATION_NOT_ACCEPTED: 'That note is not accepted. Please use a note shown on screen.',
  WOULD_OVERSHOOT: EXACT_AMOUNT_ERROR,
  SESSION_CLOSED: 'This payment session has already ended.',
};

function describeInsertError(event: BillInsertEvent): string {
  const code = event.error?.code;
  if (code !== undefined) {
    const mapped = BILL_ERROR_MESSAGES[code];
    if (mapped !== undefined) return mapped;
  }

  const message = event.error?.message;
  if (message !== undefined && message.trim() !== '') return message;

  return event.status === 'hold' ? EXACT_AMOUNT_ERROR : REJECTED_NOTE_ERROR;
}

/** Add one accepted note to the denomination tally, keeping it ascending. */
function addBillCount(bills: BillCount[], denomination: number): BillCount[] {
  const index = bills.findIndex((bill) => bill.denomination === denomination);
  if (index === -1) {
    return [...bills, { denomination, count: 1 }].sort((a, b) => a.denomination - b.denomination);
  }

  return bills.map((bill, current) =>
    current === index ? { ...bill, count: bill.count + 1 } : bill,
  );
}

/**
 * Cash-acceptance session for one transaction.
 *
 * Requires both <KioskProvider> (accepted denominations) and
 * <HardwareProvider> (the single gateway socket). It never instantiates a
 * HardwareClient itself: inserts arrive through `subscribeToInserts`.
 */
export function useBillSession({
  target,
  transactionId,
  onComplete,
}: UseBillSessionOptions): UseBillSessionResult {
  const { acceptedBills } = useKiosk();
  const { connect, startBillSession, endBillSession, rejectBill, feedNote, subscribeToInserts, isEmulator } =
    useHardware();

  const [phase, setPhase] = useState<BillSessionPhase>('idle');
  const [totalInserted, setTotalInserted] = useState(0);
  const [bills, setBills] = useState<BillCount[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);

  const phaseRef = useRef<BillSessionPhase>('idle');
  const targetRef = useRef(target);
  const acceptedBillsRef = useRef<number[]>(acceptedBills);
  const onCompleteRef = useRef(onComplete);

  const billsRef = useRef<BillCount[]>([]);
  const runningTotalRef = useRef(0);
  /** Last running total the session reported; guards duplicate events. */
  const lastReportedTotalRef = useRef(0);

  const endSessionRef = useRef(endBillSession);
  const rejectBillRef = useRef(rejectBill);

  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  useEffect(() => {
    acceptedBillsRef.current = acceptedBills;
  }, [acceptedBills]);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    endSessionRef.current = endBillSession;
  }, [endBillSession]);

  useEffect(() => {
    rejectBillRef.current = rejectBill;
  }, [rejectBill]);

  const setPhaseBoth = useCallback((next: BillSessionPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  /**
   * Read the live phase through a function call. TypeScript's control-flow
   * analysis narrows `phaseRef.current` from an earlier comparison and does
   * not know an async callback may have changed it since.
   */
  const currentPhase = useCallback((): BillSessionPhase => phaseRef.current, []);

  // Stable handler: every value it needs comes from a ref, so the single
  // gateway subscription never has to be rebuilt mid-session.
  const handleInsert = useCallback(
    (event: BillInsertEvent) => {
      if (currentPhase() !== 'accepting') return;

      if (event.status === 'accepted') {
        const data = event.data;
        const inserted = typeof data?.insertedAmount === 'number' ? Math.trunc(data.insertedAmount) : 0;
        const reportedTotal =
          typeof data?.totalInsertedAmount === 'number' ? Math.trunc(data.totalInsertedAmount) : undefined;

        // Idempotency: a replayed or racing event must not double-count.
        // The session's own running total is authoritative, so an event
        // that does not advance it is a duplicate.
        if (reportedTotal !== undefined) {
          if (reportedTotal <= lastReportedTotalRef.current) return;
        } else if (inserted <= 0) {
          return;
        }

        const nextTotal =
          reportedTotal !== undefined ? reportedTotal : runningTotalRef.current + inserted;
        runningTotalRef.current = nextTotal;
        lastReportedTotalRef.current = Math.max(lastReportedTotalRef.current, nextTotal);

        const nextBills = addBillCount(billsRef.current, inserted);
        billsRef.current = nextBills;

        setTotalInserted(nextTotal);
        setBills(nextBills);
        setLastError(null);

        if (nextTotal >= targetRef.current) {
          setPhaseBoth('complete');
          void endSessionRef.current();
          onCompleteRef.current?.({ totalInserted: nextTotal, bills: nextBills });
        }
        return;
      }

      if (event.status === 'hold') {
        // The note would overshoot; the machine cannot give change, so
        // return it and tell the customer the amount must be exact.
        setLastError(EXACT_AMOUNT_ERROR);
        void rejectBillRef.current();
        return;
      }

      setLastError(describeInsertError(event));
    },
    [setPhaseBoth, currentPhase],
  );

  // One subscription for the hook's lifetime, removed on unmount.
  useEffect(() => {
    const unsubscribe = subscribeToInserts(handleInsert);
    return unsubscribe;
  }, [subscribeToInserts, handleInsert]);

  // Abandon any live session when the page goes away.
  useEffect(() => {
    return () => {
      const wasActive = phaseRef.current === 'accepting' || phaseRef.current === 'connecting';
      phaseRef.current = 'idle';
      if (wasActive) void endSessionRef.current();
    };
  }, []);

  const start = useCallback(async () => {
    if (phaseRef.current === 'connecting' || phaseRef.current === 'accepting') return;

    runningTotalRef.current = 0;
    lastReportedTotalRef.current = 0;
    billsRef.current = [];
    setTotalInserted(0);
    setBills([]);
    setLastError(null);
    setPhaseBoth('connecting');

    try {
      await connect();
      const ack = await startBillSession({
        total: targetRef.current,
        transactionId,
        acceptedBills: acceptedBillsRef.current,
      });

      if (!ack.completed) {
        setLastError(ack.error?.message ?? 'The bill acceptor could not start.');
        setPhaseBoth('error');
        return;
      }

      // The ack can land after the session already finished (a note that
      // completes the target is handled as soon as its event arrives), so
      // never walk the phase backwards.
      if (currentPhase() === 'connecting') setPhaseBoth('accepting');
    } catch (error) {
      setLastError(
        error instanceof Error ? error.message : 'The bill acceptor could not start.',
      );
      setPhaseBoth('error');
    }
  }, [connect, startBillSession, transactionId, setPhaseBoth, currentPhase]);

  const cancel = useCallback(async () => {
    const wasActive = phaseRef.current === 'accepting' || phaseRef.current === 'connecting';
    setPhaseBoth('idle');
    setLastError(null);
    if (!wasActive) return;

    const ack = await endBillSession();
    if (!ack.completed) {
      setLastError(ack.error?.message ?? 'The payment session could not be closed.');
    }
  }, [endBillSession, setPhaseBoth]);

  const feedNoteForSession = useCallback(
    (denomination: number): Promise<HardwareAck> => feedNote(denomination),
    [feedNote],
  );

  const remaining = useMemo(
    () => Math.max(0, Math.trunc(target) - totalInserted),
    [target, totalInserted],
  );

  return {
    phase,
    totalInserted,
    remaining,
    bills,
    lastError,
    start,
    cancel,
    isEmulator,
    feedNote: feedNoteForSession,
  };
}
