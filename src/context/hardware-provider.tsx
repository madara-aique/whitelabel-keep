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
import { HardwareClient } from '@/lib/hardware/client';
import {
  HARDWARE_ERROR_CODES,
  hardwareFailure,
  type BillAcceptorStatus,
  type BillInsertEvent,
  type HardwareAck,
} from '@/lib/hardware/protocol';
import type { KioskConfig } from '@/types/domain';

export type HardwareDriverKind = 'mock' | 'socketio' | 'unknown';

export interface BillSessionRequest {
  total: number;
  transactionId: string;
  acceptedBills: number[];
}

export interface HardwareContextValue {
  /** True only while the gateway socket is live. Starts false. */
  connected: boolean;
  /** True when the connected gateway is running the emulator driver. */
  isEmulator: boolean;
  /** Raw driver kind reported by the gateway, or 'unknown' until queried. */
  driver: HardwareDriverKind;
  connect: () => Promise<void>;
  disconnect: () => void;
  startBillSession: (payload: BillSessionRequest) => Promise<HardwareAck>;
  endBillSession: () => Promise<HardwareAck>;
  rejectBill: () => Promise<HardwareAck>;
  /** Emulator only; a real gateway rejects this command. */
  feedNote: (denomination: number) => Promise<HardwareAck>;
  openDoors: (doorNumbers: string[]) => Promise<HardwareAck>;
  /**
   * Observe bill-acceptor events. The provider owns the single
   * HardwareClient, so consumers must subscribe here instead of creating
   * a second socket.
   */
  subscribeToInserts: (handler: (event: BillInsertEvent) => void) => () => void;
}

const HardwareContext = createContext<HardwareContextValue | null>(null);

export function useHardware(): HardwareContextValue {
  const context = useContext(HardwareContext);
  if (!context) {
    throw new Error('useHardware must be used inside a <HardwareProvider>. Wrap the kiosk layout in <HardwareProvider config={config}>.');
  }
  return context;
}

/** The gateway is reached on the browser's own host, never a hard-coded one. */
function buildGatewayUrl(port: number): string | null {
  if (typeof window === 'undefined') return null;
  const { protocol, hostname } = window.location;
  if (!hostname) return null;
  return `${protocol}//${hostname}:${port}`;
}

function hardwareDisabled(): HardwareAck<never> {
  return hardwareFailure(HARDWARE_ERROR_CODES.unsupported, 'Hardware is disabled for this kiosk');
}

export interface HardwareProviderProps {
  config: KioskConfig;
  children: ReactNode;
}

export function HardwareProvider({ config, children }: HardwareProviderProps) {
  const { hardwareEnabled, hardwareGatewayPort } = config;

  const [connected, setConnected] = useState(false);
  const [driver, setDriver] = useState<HardwareDriverKind>('unknown');

  const clientRef = useRef<HardwareClient | null>(null);
  const insertHandlersRef = useRef(new Set<(event: BillInsertEvent) => void>());

  /** Ask the gateway which driver backs it; 'mock' means the emulator. */
  const refreshDriver = useCallback(async () => {
    const client = clientRef.current;
    if (!client?.isConnected) {
      setDriver('unknown');
      return;
    }
    const ack = await client.getBillAcceptorStatus();
    const status: BillAcceptorStatus | undefined = ack.data;
    if (!ack.completed || !status) {
      setDriver('unknown');
      return;
    }
    setDriver(status.driver === 'mock' ? 'mock' : 'socketio');
  }, []);

  const handleConnectionChange = useCallback(
    (isConnected: boolean) => {
      setConnected(isConnected);
      if (!isConnected) {
        setDriver('unknown');
        return;
      }
      void refreshDriver();
    },
    [refreshDriver],
  );

  // Created on demand so the provider can also cover the brief window
  // before its mount effect has run.
  const ensureClient = useCallback((): HardwareClient | null => {
    if (!hardwareEnabled) return null;
    if (clientRef.current) return clientRef.current;

    const gatewayUrl = buildGatewayUrl(hardwareGatewayPort);
    if (!gatewayUrl) return null;

    const client = new HardwareClient(gatewayUrl, {
      onInsert: (event) => {
        insertHandlersRef.current.forEach((handler) => {
          try {
            handler(event);
          } catch {
            // A misbehaving subscriber must not break the fan-out.
          }
        });
      },
      onConnectionChange: handleConnectionChange,
    });

    clientRef.current = client;
    return client;
  }, [hardwareEnabled, hardwareGatewayPort, handleConnectionChange]);

  // One client for the whole app, disposed on unmount.
  useEffect(() => {
    if (!hardwareEnabled) return;
    ensureClient();

    // Captured here rather than inside the cleanup: the ref may point at
    // a different set by the time the cleanup runs.
    const handlers = insertHandlersRef.current;

    return () => {
      const client = clientRef.current;
      clientRef.current = null;
      handlers.clear();
      client?.disconnect();
      setConnected(false);
      setDriver('unknown');
    };
  }, [hardwareEnabled, ensureClient]);

  const connect = useCallback(async () => {
    // Disabled hardware never opens a socket; consumers get a failed ack
    // from the commands below instead.
    if (!hardwareEnabled) return;
    const client = ensureClient();
    if (!client) return;
    await client.connect();
    await refreshDriver();
  }, [hardwareEnabled, ensureClient, refreshDriver]);

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
    setConnected(false);
    setDriver('unknown');
  }, []);

  const subscribeToInserts = useCallback((handler: (event: BillInsertEvent) => void) => {
    const handlers = insertHandlersRef.current;
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  }, []);

  const startBillSession = useCallback(
    (payload: BillSessionRequest): Promise<HardwareAck> => {
      const client = ensureClient();
      if (!client) return Promise.resolve(hardwareDisabled());
      return client.startBillSession(payload);
    },
    [ensureClient],
  );

  const endBillSession = useCallback((): Promise<HardwareAck> => {
    const client = ensureClient();
    if (!client) return Promise.resolve(hardwareDisabled());
    return client.endBillSession();
  }, [ensureClient]);

  const rejectBill = useCallback((): Promise<HardwareAck> => {
    const client = ensureClient();
    if (!client) return Promise.resolve(hardwareDisabled());
    return client.rejectBill();
  }, [ensureClient]);

  const feedNote = useCallback(
    (denomination: number): Promise<HardwareAck> => {
      const client = ensureClient();
      if (!client) return Promise.resolve(hardwareDisabled());
      return client.feedNote(denomination);
    },
    [ensureClient],
  );

  const openDoors = useCallback(
    (doorNumbers: string[]): Promise<HardwareAck> => {
      const client = ensureClient();
      if (!client) return Promise.resolve(hardwareDisabled());
      return client.openDoors(doorNumbers);
    },
    [ensureClient],
  );

  const value = useMemo<HardwareContextValue>(
    () => ({
      connected,
      isEmulator: driver === 'mock',
      driver,
      connect,
      disconnect,
      startBillSession,
      endBillSession,
      rejectBill,
      feedNote,
      openDoors,
      subscribeToInserts,
    }),
    [
      connected,
      driver,
      connect,
      disconnect,
      startBillSession,
      endBillSession,
      rejectBill,
      feedNote,
      openDoors,
      subscribeToInserts,
    ],
  );

  return <HardwareContext.Provider value={value}>{children}</HardwareContext.Provider>;
}
