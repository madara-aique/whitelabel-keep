/**
 * Server-side environment access.
 *
 * Every runtime value and every piece of site-specific copy is read in
 * one place so that no brand string or endpoint is hard-coded inside a
 * component. Nothing in this module may be imported by a Client
 * Component — the subset a client needs is passed down as props via
 * `getKioskConfig()`.
 */

const DEFAULT_MONGODB_URI =
  'mongodb://admin:changeme123@localhost:27019/whitelabel-keep?authSource=admin&replicaSet=rs0&directConnection=true';

function readString(key: string, fallback = ''): string {
  const raw = process.env[key];
  return raw === undefined || raw === '' ? fallback : raw;
}

function readNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readInt(key: string, fallback: number): number {
  return Math.trunc(readNumber(key, fallback));
}

function readBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function readNumberArray(key: string, fallback: number[]): number[] {
  const raw = process.env[key];
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    const numbers = parsed.map(Number).filter((n) => Number.isFinite(n) && n > 0);
    return numbers.length > 0 ? numbers : fallback;
  } catch {
    return fallback;
  }
}

function readDate(key: string): Date | null {
  const raw = process.env[key];
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Warnings surfaced once at boot for configuration that cannot work. */
export function validateServerEnv(): string[] {
  const problems: string[] = [];

  if (!process.env.MONGODB_URI) {
    problems.push('MONGODB_URI is not set; falling back to the local development URI.');
  }
  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.startsWith('replace-me')) {
    problems.push('AUTH_SECRET is missing or still the placeholder; admin sessions are not safe.');
  }
  if (serverEnv.hardware.driver === 'socketio' && !serverEnv.hardware.accessKey) {
    problems.push('HARDWARE_DRIVER=socketio requires HARDWARE_ACCESS_KEY.');
  }
  if (serverEnv.paymentGateway.enabled && !serverEnv.paymentGateway.url) {
    problems.push('PAYMENT_GATEWAY_ENABLED=true requires PAYMENT_GATEWAY_URL.');
  }

  return problems;
}

export const serverEnv = {
  nodeEnv: readString('NODE_ENV', 'development'),
  isProduction: process.env.NODE_ENV === 'production',

  // ── Database ───────────────────────────────────────────────
  mongoUri: readString('MONGODB_URI', DEFAULT_MONGODB_URI),
  mongoMaxPoolSize: readInt('MONGODB_MAX_POOL_SIZE', 10),

  // ── Admin authentication ───────────────────────────────────
  authSecret: readString('AUTH_SECRET', 'insecure-development-secret'),
  authTrustHost: readBool('AUTH_TRUST_HOST', true),
  adminEmail: readString('ADMIN_EMAIL', 'admin@example.com'),
  adminPassword: readString('ADMIN_PASSWORD', 'ChangeMe123!'),
  adminScanCode: readString('ADMIN_SCAN_CODE', 'admin-scan-code'),

  // ── App identity (generic; override per deployment) ────────
  app: {
    name: readString('APP_NAME', 'Smart Locker'),
    operatorName: readString('APP_OPERATOR_NAME', 'Locker Operations'),
    locale: readString('APP_LOCALE', 'en-PH'),
    currency: readString('APP_CURRENCY', 'PHP'),
    currencySymbol: readString('APP_CURRENCY_SYMBOL', 'PHP'),
    supportEmail: readString('APP_SUPPORT_EMAIL', 'support@example.com'),
    supportPhone: readString('APP_SUPPORT_PHONE', ''),
    referencePrefix: readString('APP_REFERENCE_PREFIX', 'REF'),
    timeZone: readString('APP_TIMEZONE', 'Asia/Manila'),
    timeZoneOffsetMinutes: readInt('APP_TIMEZONE_OFFSET_MINUTES', 480),
  },

  // ── Kiosk behaviour ────────────────────────────────────────
  kiosk: {
    doorRate: readInt('DOOR_RATE', 250),
    billAcceptorEnabled: readBool('BILL_ACCEPTOR_ENABLED', true),
    idleTimeoutSeconds: readInt('IDLE_TIMEOUT_SECONDS', 120),
    maxAliasLength: readInt('MAX_ALIAS_LENGTH', 8),
    pinLength: readInt('PIN_LENGTH', 6),
    acceptedBills: readNumberArray('ACCEPTED_BILLS', [50, 100, 200]),
  },

  // ── Promo pricing ──────────────────────────────────────────
  promo: {
    enabled: readBool('PROMO_ENABLED', false),
    startDate: readDate('PROMO_START_DATE'),
    endDate: readDate('PROMO_END_DATE'),
    rate: readInt('PROMO_RATE', 0),
  },

  // ── Hardware gateway ───────────────────────────────────────
  hardware: {
    driver: readString('HARDWARE_DRIVER', 'mock') === 'socketio' ? 'socketio' : 'mock',
    enabled: readBool('HARDWARE_ENABLED', true),
    socketPort: readInt('HARDWARE_SOCKET_PORT', 4000),
    /** Address of the physical controller gateway (not our own port). */
    deviceUrl: readString('HARDWARE_DEVICE_URL'),
    accessKey: readString('HARDWARE_ACCESS_KEY'),
    sessionTtlSeconds: readInt('HARDWARE_SESSION_TTL_SECONDS', 300),
    connectTimeoutMs: readInt('HARDWARE_CONNECT_TIMEOUT_MS', 10_000),
  } as {
    driver: 'mock' | 'socketio';
    enabled: boolean;
    socketPort: number;
    deviceUrl: string;
    accessKey: string;
    sessionTtlSeconds: number;
    connectTimeoutMs: number;
  },

  // ── Locker controller ──────────────────────────────────────
  lockerController: {
    baseUrl: readString('LOCKER_CONTROLLER_BASE_URL', 'http://localhost:9090'),
    doorsPath: readString('LOCKER_CONTROLLER_DOORS_PATH', '/api/doors'),
    locationPath: readString('LOCKER_CONTROLLER_LOCATION_PATH', '/api/location'),
    doorPath: readString('LOCKER_CONTROLLER_DOOR_PATH', '/api/door'),
    openAllPath: readString('LOCKER_CONTROLLER_OPEN_ALL_PATH', '/api/doors/open-all'),
    timeoutMs: readInt('LOCKER_CONTROLLER_TIMEOUT_MS', 8_000),
  },

  // ── Payment gateway (e-wallet / QR) ────────────────────────
  paymentGateway: {
    enabled: readBool('PAYMENT_GATEWAY_ENABLED', false),
    url: readString('PAYMENT_GATEWAY_URL'),
    statusUrl: readString('PAYMENT_GATEWAY_STATUS_URL'),
    timeoutMs: readInt('PAYMENT_GATEWAY_TIMEOUT_MS', 15_000),
  },

  // ── Offline → online sync ──────────────────────────────────
  sync: {
    enabled: readBool('SYNC_ENABLED', false),
    onlineUri: readString('ONLINE_MONGO_URI'),
    onlineDb: readString('ONLINE_MONGO_DB'),
    onlineCollection: readString('SYNC_ONLINE_COLLECTION', 'kiosk_sync_transactions'),
    retryIntervalMs: readInt('SYNC_RETRY_INTERVAL_MS', 30_000),
    batchSize: readInt('SYNC_BATCH_SIZE', 50),
  },
} as const;
