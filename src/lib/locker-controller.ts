import { serverEnv } from '@/lib/env';
import { fetchWithTimeout } from '@/lib/utils';

/**
 * Locker controller HTTP client.
 *
 * Door actuation is a separate concern from the bill acceptor: the
 * controller is a plain HTTP service, and the legacy app called it from
 * the browser. It now runs server-side so the controller address is not
 * exposed and every call has a timeout.
 */
function url(path: string, ...segments: (string | number)[]): string {
  const base = serverEnv.lockerController.baseUrl.replace(/\/+$/, '');
  const suffix = segments.length > 0 ? `/${segments.map((s) => encodeURIComponent(String(s))).join('/')}` : '';
  return `${base}${path}${suffix}`;
}

export interface ControllerResult<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

async function call<T>(target: string): Promise<ControllerResult<T>> {
  try {
    const response = await fetchWithTimeout(target, {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      timeoutMs: serverEnv.lockerController.timeoutMs,
    });

    if (!response.ok) {
      return { ok: false, status: response.status, error: `Controller returned ${response.status}` };
    }

    const text = await response.text();
    const data = text ? (JSON.parse(text) as T) : undefined;
    return { ok: true, status: response.status, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown controller error';
    return { ok: false, status: 0, error: message };
  }
}

/** Energise the lock on one door. */
export function openDoor(doorNumber: string): Promise<ControllerResult> {
  return call(url(serverEnv.lockerController.doorPath, doorNumber, 'open'));
}

/** Energise every lock — used by the operator "open all and clear" action. */
export function openAllDoors(): Promise<ControllerResult> {
  return call(url(serverEnv.lockerController.openAllPath));
}

/** Doors the controller knows about. */
export function listDoors(): Promise<ControllerResult<{ data?: { doors?: Record<string, unknown> } }>> {
  return call(url(serverEnv.lockerController.doorsPath));
}

/** Physical location reported by the controller, used when seeding doors. */
export function getLocation(): Promise<ControllerResult<{ location?: string }>> {
  return call(url(serverEnv.lockerController.locationPath));
}
