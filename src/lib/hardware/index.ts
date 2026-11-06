import { serverEnv } from '@/lib/env';
import { MockHardwareDriver } from './mock-driver';
import { SocketIoHardwareDriver } from './socketio-driver';
import type { HardwareDriver } from './driver';

export { BillSession } from './session';
export * from './protocol';
export type { HardwareDriver } from './driver';
export { HardwareDriverError } from './driver';

let driver: HardwareDriver | null = null;

/**
 * The process-wide hardware driver.
 *
 * Only the gateway process should ever call this: it holds the device
 * credential that must never reach a browser.
 */
export function getHardwareDriver(): HardwareDriver {
  if (driver) return driver;

  driver =
    serverEnv.hardware.driver === 'socketio'
      ? new SocketIoHardwareDriver({
          url: serverEnv.hardware.deviceUrl,
          accessKey: serverEnv.hardware.accessKey,
          connectTimeoutMs: serverEnv.hardware.connectTimeoutMs,
        })
      : new MockHardwareDriver();

  return driver;
}

/** Replace the driver, used by tests. */
export function setHardwareDriver(next: HardwareDriver | null): void {
  driver = next;
}
