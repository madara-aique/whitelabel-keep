/**
 * Idempotent database seed.
 *
 * Safe to run on every environment, at any time:
 *   - the administrator account is created only when it is missing;
 *   - schema indexes are reconciled with the models;
 *   - doors are discovered from the locker controller when it answers,
 *     and placeholder doors can be created instead when it does not.
 *
 * Usage:
 *   npm run seed
 *   npm run seed -- --reset-password
 *   npm run seed -- --doors=12
 *
 * The script exits non-zero only for a genuine database failure; an
 * unreachable locker controller is a warning, because a developer with
 * no hardware attached must still be able to seed a usable kiosk.
 */

// Must come first: @/lib/env reads process.env at module load.
import '@/server/load-env';
import bcrypt from 'bcryptjs';
import { serverEnv } from '@/lib/env';
import { connectToDatabase, disconnectFromDatabase } from '@/lib/mongodb';
import { Door } from '@/lib/models/door';
import { SyncQueue } from '@/lib/models/sync-queue';
import { Transaction } from '@/lib/models/transaction';
import { User } from '@/lib/models/user';
import { seedDoorsFromController } from '@/lib/services/booking-service';
import { getLocation, listDoors } from '@/lib/locker-controller';
import { isRecord } from '@/lib/utils';

/** bcrypt cost; matches `src/lib/auth.ts` verification. */
const BCRYPT_ROUNDS = 10;
/** Location used for placeholder doors when the controller cannot report one. */
const FALLBACK_LOCATION = '1000';
const DEFAULT_PLACEHOLDER_DOORS = 12;
const MAX_PLACEHOLDER_DOORS = 200;

interface SeedOptions {
  resetPassword: boolean;
  /** `null` when `--doors=N` was not passed. */
  doorCount: number | null;
}

function parseArgs(argv: string[]): SeedOptions {
  let resetPassword = false;
  let doorCount: number | null = null;

  for (const arg of argv) {
    if (arg === '--reset-password') {
      resetPassword = true;
      continue;
    }
    if (arg.startsWith('--doors=')) {
      const parsed = Number.parseInt(arg.slice('--doors='.length), 10);
      doorCount = Number.isFinite(parsed)
        ? Math.min(Math.max(parsed, 1), MAX_PLACEHOLDER_DOORS)
        : null;
    }
  }

  return { resetPassword, doorCount };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Numeric door labels sort naturally ("2" before "10"). */
function compareDoorNumbers(a: string, b: string): number {
  const left = Number(a);
  const right = Number(b);
  if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
  return a.localeCompare(b);
}

/**
 * Pull door numbers out of the controller payload.
 *
 * The controller contract is `{ data: { doors: { ... } } }`, where the
 * map is keyed by door number and may hold either primitives or objects.
 * Both shapes are accepted so a controller firmware change does not
 * break seeding.
 */
function extractDoorNumbers(payload: unknown): string[] {
  if (!isRecord(payload)) return [];

  const doors = payload.doors;
  const numbers = new Set<string>();

  const add = (value: unknown): void => {
    if (typeof value === 'string' || typeof value === 'number') {
      const candidate = String(value).trim();
      if (candidate) numbers.add(candidate);
    }
  };

  const pick = (value: unknown, fallback: string): void => {
    if (isRecord(value)) {
      add(value.doorNumber ?? value.door ?? value.number ?? value.id ?? fallback);
      return;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      add(value);
      return;
    }
    add(fallback);
  };

  if (isRecord(doors)) {
    for (const [key, value] of Object.entries(doors)) pick(value, key);
  } else if (Array.isArray(doors)) {
    for (const entry of doors) pick(entry, '');
  }

  return [...numbers].sort(compareDoorNumbers);
}

interface ControllerReport {
  reachable: boolean;
  location: string;
  doorNumbers: string[];
}

async function readController(): Promise<ControllerReport> {
  const locationResult = await getLocation();
  const location = locationResult.ok ? (locationResult.data?.location ?? '').trim() : '';

  const doorsResult = await listDoors();
  if (!doorsResult.ok) {
    return { reachable: false, location, doorNumbers: [] };
  }

  return {
    reachable: true,
    location,
    doorNumbers: extractDoorNumbers(doorsResult.data?.data),
  };
}

type AdminOutcome = 'created' | 'existing' | 'reset';

/**
 * Ensure the administrator account exists.
 *
 * The plaintext password is never stored, and an existing hash is left
 * untouched unless `--reset-password` is passed, so re-seeding a live
 * kiosk does not silently change the operator's credentials.
 */
async function upsertAdmin(resetPassword: boolean): Promise<AdminOutcome> {
  const email = serverEnv.adminEmail.trim().toLowerCase();

  const existing = await User.findOne({ email }).select('+passwordHash').lean();

  if (!existing) {
    const passwordHash = await bcrypt.hash(serverEnv.adminPassword, BCRYPT_ROUNDS);
    await User.updateOne(
      { email },
      {
        $set: {
          email,
          name: serverEnv.app.operatorName,
          passwordHash,
          role: 'admin',
          isActive: true,
        },
      },
      { upsert: true },
    );
    return 'created';
  }

  if (!resetPassword) return 'existing';

  const passwordHash = await bcrypt.hash(serverEnv.adminPassword, BCRYPT_ROUNDS);
  await User.updateOne({ email }, { $set: { passwordHash, isActive: true } });
  return 'reset';
}

/** Reconcile every model's indexes with the database. */
async function syncIndexes(): Promise<void> {
  await Promise.all([
    Door.syncIndexes(),
    Transaction.syncIndexes(),
    SyncQueue.syncIndexes(),
    User.syncIndexes(),
  ]);
}

/**
 * Create placeholder doors for a kiosk with no controller attached.
 *
 * `$setOnInsert` keeps this idempotent: a door that is already in
 * service keeps its live state (occupancy, PIN, booking) untouched.
 */
async function createPlaceholderDoors(count: number, lockerLocation: string): Promise<number> {
  const doorNumbers = Array.from({ length: count }, (_, index) => String(index + 1));

  const result = await Door.bulkWrite(
    doorNumbers.map((doorNumber) => ({
      updateOne: {
        filter: { doorNumber },
        update: {
          $setOnInsert: {
            doorNumber,
            lockerLocation,
            doorSize: 'L',
            doorStatus: 0,
            payType: '',
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  return result.upsertedCount;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  console.log(`[seed] connecting to MongoDB (${serverEnv.nodeEnv}) ...`);
  // A genuine connection failure propagates and exits the script non-zero.
  await connectToDatabase();

  await syncIndexes();
  console.log('[seed] indexes ensured: doors, transactions, sync_queue, users');

  const adminOutcome = await upsertAdmin(options.resetPassword);
  const adminNote =
    adminOutcome === 'created'
      ? 'created from ADMIN_EMAIL / ADMIN_PASSWORD'
      : adminOutcome === 'reset'
        ? 'password reset from ADMIN_PASSWORD'
        : 'already present, password untouched (pass --reset-password to change it)';
  console.log(`[seed] admin ${serverEnv.adminEmail}: ${adminNote}`);

  let controller: ControllerReport = { reachable: false, location: '', doorNumbers: [] };
  try {
    controller = await readController();
  } catch (error) {
    console.warn(`[seed] warning: locker controller call failed (${describe(error)})`);
  }

  if (!controller.reachable) {
    console.warn(
      `[seed] warning: locker controller unreachable at ${serverEnv.lockerController.baseUrl}; skipping door discovery`,
    );
  } else if (controller.doorNumbers.length === 0) {
    console.warn('[seed] warning: locker controller answered but reported no doors');
  }

  const fromController = controller.reachable && controller.doorNumbers.length > 0;
  const placeholderLocation = controller.location || FALLBACK_LOCATION;
  let placeholdersCreated = 0;
  let controllerSeededDoors = 0;

  if (fromController) {
    controllerSeededDoors = await seedDoorsFromController(
      controller.doorNumbers,
      placeholderLocation,
    );
    console.log(
      `[seed] controller reported ${controller.doorNumbers.length} door(s) at ${placeholderLocation}; ${controllerSeededDoors} new record(s)`,
    );
    if (options.doorCount !== null) {
      console.log('[seed] controller doors were found, so placeholder doors were skipped');
    }
  } else if (options.doorCount !== null) {
    placeholdersCreated = await createPlaceholderDoors(options.doorCount, placeholderLocation);
    console.log(
      `[seed] created ${placeholdersCreated} placeholder door(s) 1..${options.doorCount} at ${placeholderLocation}`,
    );
  } else {
    console.warn(
      `[seed] no doors were discovered. Re-run "npm run seed -- --doors=${DEFAULT_PLACEHOLDER_DOORS}" to create placeholder doors without hardware.`,
    );
  }

  const [doorTotal, queuedSync] = await Promise.all([
    Door.countDocuments(),
    SyncQueue.countDocuments({ status: { $in: ['pending', 'failed'] } }),
  ]);

  console.log('');
  console.log('[seed] summary');
  console.log(`  admin user       : ${serverEnv.adminEmail} (${adminOutcome})`);
  console.log('  indexes          : doors, transactions, sync_queue, users');
  console.log(`  doors in database: ${doorTotal}`);
  console.log(`  from controller  : ${fromController ? controller.doorNumbers.length : 0}`);
  console.log(`  placeholders     : ${placeholdersCreated}`);
  console.log(`  awaiting sync    : ${queuedSync}`);
}

async function run(): Promise<void> {
  try {
    await main();
  } catch (error) {
    console.error(`[seed] failed: ${describe(error)}`);
    process.exitCode = 1;
  } finally {
    await disconnectFromDatabase().catch(() => undefined);
    console.log('[seed] disconnected from MongoDB');
  }
}

void run();
