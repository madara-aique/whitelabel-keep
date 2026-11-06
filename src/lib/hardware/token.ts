import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { serverEnv } from '@/lib/env';

/**
 * Short-lived hardware session tokens.
 *
 * The legacy app shipped `NEXT_PUBLIC_HARDWARE_ACCESS_KEY` into the
 * browser bundle, so anyone who loaded the kiosk page could command the
 * locks. Instead, the browser asks a Route Handler for a scoped token
 * that expires in minutes and is bound to this server instance.
 */
export interface HardwareTokenPayload {
  /** Issued-at, epoch seconds. */
  iat: number;
  /** Expiry, epoch seconds. */
  exp: number;
  /** Opaque session identifier. */
  sid: string;
  /** What the holder may do. */
  scope: 'kiosk';
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string): string {
  return createHmac('sha256', serverEnv.hardware.accessKey || serverEnv.authSecret)
    .update(payload)
    .digest('base64url');
}

export function issueHardwareToken(ttlSeconds = serverEnv.hardware.sessionTtlSeconds): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: HardwareTokenPayload = {
    iat: now,
    exp: now + Math.max(30, ttlSeconds),
    sid: randomUUID(),
    scope: 'kiosk',
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export function verifyHardwareToken(token: string | undefined | null): HardwareTokenPayload | null {
  if (!token || typeof token !== 'string') return null;

  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;

  const expected = sign(encoded);
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as HardwareTokenPayload;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
    if (payload.scope !== 'kiosk') return null;
    return payload;
  } catch {
    return null;
  }
}
