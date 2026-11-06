/**
 * Offline → online sync worker.
 *
 * A kiosk keeps selling when the internet is down. Every local write is
 * mirrored into the `sync_queue` write-ahead log by the domain service,
 * and this worker is the only thing that talks to the online cluster:
 *
 *   transactions change stream ──▶ sync_queue (pending)
 *   sync_queue (pending|failed) ──▶ online collection (upsert by transId)
 *
 * Usage:
 *   npm run sync
 *
 * Requires the replica set from `docker-compose.yml` for the change
 * stream. A change-stream error is fatal on purpose: the supervisor
 * restarts the process so the queue is never left unwatched.
 */

// Must come first: @/lib/env reads process.env at module load.
import '@/server/load-env';
import { MongoClient, type ChangeStream, type ChangeStreamDocument, type Collection, type Document } from 'mongodb';
import { serverEnv } from '@/lib/env';
import { connectToDatabase, disconnectFromDatabase } from '@/lib/mongodb';
import { SyncQueue } from '@/lib/models/sync-queue';
import { isRecord } from '@/lib/utils';

/** Local collection the worker mirrors. */
const SOURCE_COLLECTION = 'transactions';
/** Fields that only make sense inside the originating database. */
const STRIPPED_FIELDS = ['_id', '__v'] as const;

type LocalChange = ChangeStreamDocument<Record<string, unknown>>;
type LocalChangeStream = ChangeStream<Record<string, unknown>, LocalChange>;

let onlineClient: MongoClient | null = null;
let onlineCollection: Collection<Document> | null = null;
let changeStream: LocalChangeStream | null = null;
let sweepTimer: ReturnType<typeof setInterval> | null = null;

let sweeping = false;
let shuttingDown = false;
/** Serialises change events so they are queued in the order they happened. */
let queuedWrites: Promise<void> = Promise.resolve();

function log(message: string): void {
  console.log(`[sync] ${message}`);
}

function warn(message: string): void {
  console.warn(`[sync] ${message}`);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Remove database-local fields before forwarding a document. */
function sanitize(document: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(document)) {
    if ((STRIPPED_FIELDS as readonly string[]).includes(key)) continue;
    clean[key] = value;
  }
  return clean;
}

function readTransId(document: unknown): string {
  const record = isRecord(document) ? document : {};
  return typeof record.transId === 'string' ? record.transId.trim() : '';
}

// ── Online connection ────────────────────────────────────────────────

async function closeOnline(): Promise<void> {
  const client = onlineClient;
  onlineClient = null;
  onlineCollection = null;
  if (client) await client.close().catch(() => undefined);
}

/**
 * The online collection, reconnecting the client when it has dropped.
 *
 * A kiosk network comes and goes, so a connection is verified with a
 * cheap ping before every batch rather than trusted indefinitely.
 */
async function onlineTarget(): Promise<Collection<Document>> {
  if (onlineClient && onlineCollection) {
    try {
      const current = onlineClient;
      await current.db(serverEnv.sync.onlineDb || undefined).command({ ping: 1 });
      return onlineCollection;
    } catch (error) {
      warn(`online connection dropped (${describe(error)}); reconnecting`);
      await closeOnline();
    }
  }

  const client = new MongoClient(serverEnv.sync.onlineUri, {
    serverSelectionTimeoutMS: 5_000,
    connectTimeoutMS: 5_000,
  });
  await client.connect();

  const db = serverEnv.sync.onlineDb ? client.db(serverEnv.sync.onlineDb) : client.db();
  const collection = db.collection(serverEnv.sync.onlineCollection);

  onlineClient = client;
  onlineCollection = collection;
  log(
    `connected to the online cluster (db=${db.databaseName}, collection=${serverEnv.sync.onlineCollection})`,
  );
  return collection;
}

// ── Queue forwarding ─────────────────────────────────────────────────

async function sweep(): Promise<void> {
  if (sweeping || shuttingDown) return;
  sweeping = true;

  try {
    const rows = await SyncQueue.find({ status: { $in: ['pending', 'failed'] } })
      .sort({ createdAt: 1 })
      .limit(serverEnv.sync.batchSize)
      .lean();

    if (rows.length === 0) return;

    const batch = rows
      .filter((row) => readTransId(row.document) !== '')
      .map((row) => ({
        id: row._id,
        transId: readTransId(row.document),
        document: sanitize(isRecord(row.document) ? row.document : {}),
      }));

    const malformed = rows.filter((row) => readTransId(row.document) === '');
    if (malformed.length > 0) {
      const malformedIds = malformed.map((row) => row._id);
      await SyncQueue.updateMany(
        { _id: { $in: malformedIds } },
        {
          $set: { status: 'failed', lastError: 'Queued document has no transId' },
          $inc: { retryCount: 1 },
        },
      ).catch(() => undefined);
      warn(`skipped ${malformed.length} queued row(s) without a transId`);
    }

    if (batch.length === 0) return;

    const ids = batch.map((entry) => entry.id);

    try {
      // A dropped connection is recovered here, so a kiosk that lost its
      // uplink resumes without a restart.
      const collection = await onlineTarget();
      // Upserts are idempotent, so retrying a batch can never duplicate a sale.
      await collection.bulkWrite(
        batch.map((entry) => ({
          updateOne: {
            filter: { transId: entry.transId },
            update: { $set: entry.document },
            upsert: true,
          },
        })),
        { ordered: false },
      );
      await SyncQueue.updateMany(
        { _id: { $in: ids } },
        { $set: { status: 'synced', syncedAt: new Date(), lastError: '' } },
      );
      log(`synced ${batch.length} transaction(s)`);
    } catch (error) {
      const message = describe(error);
      await SyncQueue.updateMany(
        { _id: { $in: ids } },
        { $set: { status: 'failed', lastError: message }, $inc: { retryCount: 1 } },
      ).catch(() => undefined);
      warn(`batch of ${batch.length} failed: ${message} (will retry)`);
    }
  } catch (error) {
    // A local queue read failure must not kill the worker.
    warn(`sweep failed: ${describe(error)}`);
  } finally {
    sweeping = false;
  }
}

// ── Change stream ────────────────────────────────────────────────────

async function handleChange(change: LocalChange): Promise<void> {
  if (
    change.operationType !== 'insert' &&
    change.operationType !== 'update' &&
    change.operationType !== 'replace'
  ) {
    // Deletes carry no document to forward.
    return;
  }

  const fullDocument = change.fullDocument;
  if (!isRecord(fullDocument)) return;

  const transId = readTransId(fullDocument);
  if (!transId) {
    warn(`ignoring a local ${change.operationType} without a transId`);
    return;
  }

  await SyncQueue.create({
    changeType: change.operationType,
    sourceCollection: SOURCE_COLLECTION,
    documentId: String(change.documentKey._id),
    document: fullDocument,
    status: 'pending',
  });

  log(`queued ${change.operationType} ${transId}`);
}

async function startChangeStream(): Promise<void> {
  const connection = await connectToDatabase();
  const db = connection.connection.db;
  if (!db) throw new Error('local MongoDB connection is not ready');

  const collection = db.collection(SOURCE_COLLECTION);
  const stream = collection.watch<Record<string, unknown>, LocalChange>([], {
    fullDocument: 'updateLookup',
  });
  changeStream = stream;

  stream.on('change', (change) => {
    queuedWrites = queuedWrites
      .then(() => handleChange(change))
      .catch((error: unknown) => warn(`could not queue a change: ${describe(error)}`));
  });

  stream.on('error', (error: Error) => {
    console.error(`[sync] change stream error: ${error.message}`);
    void shutdown('change-stream error', 1);
  });

  log(`watching ${db.databaseName}.${SOURCE_COLLECTION} (fullDocument=updateLookup)`);
}

// ── Lifecycle ────────────────────────────────────────────────────────

async function shutdown(reason: string, exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${reason}; shutting down`);

  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }

  if (changeStream) {
    const stream = changeStream;
    changeStream = null;
    await stream.close().catch(() => undefined);
  }

  await queuedWrites.catch(() => undefined);
  await closeOnline();
  await disconnectFromDatabase().catch(() => undefined);

  process.exitCode = exitCode;
  log('shutdown complete');
}

async function run(): Promise<void> {
  if (!serverEnv.sync.enabled || serverEnv.sync.onlineUri.trim() === '') {
    log('sync is disabled (SYNC_ENABLED=false or ONLINE_MONGO_URI is empty); nothing to do');
    return;
  }

  log(
    `starting worker: interval=${serverEnv.sync.retryIntervalMs}ms batch=${serverEnv.sync.batchSize}`,
  );

  await startChangeStream();
  // Drain anything a previous run left behind before settling into the interval.
  await sweep();

  sweepTimer = setInterval(() => {
    void sweep();
  }, serverEnv.sync.retryIntervalMs);

  process.on('SIGINT', () => void shutdown('SIGINT', 0));
  process.on('SIGTERM', () => void shutdown('SIGTERM', 0));
}

void run().catch(async (error: unknown) => {
  console.error(`[sync] fatal: ${describe(error)}`);
  await shutdown('fatal error', 1);
});
