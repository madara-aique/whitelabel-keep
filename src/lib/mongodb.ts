import mongoose from 'mongoose';
import { serverEnv } from '@/lib/env';

/**
 * Mongoose connection singleton.
 *
 * Next.js hot-reloads modules in development, so the connection is
 * cached on `globalThis` to avoid opening a new pool on every reload.
 * `bufferCommands` is disabled so a query against a dead database fails
 * immediately instead of hanging the kiosk.
 */
interface MongooseCache {
  connection: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  var __lockerKioskMongoose: MongooseCache | undefined;
}

const cache: MongooseCache =
  global.__lockerKioskMongoose ?? (global.__lockerKioskMongoose = { connection: null, promise: null });

export async function connectToDatabase(): Promise<typeof mongoose> {
  if (cache.connection) return cache.connection;

  if (!cache.promise) {
    mongoose.set('strictQuery', true);
    cache.promise = mongoose.connect(serverEnv.mongoUri, {
      maxPoolSize: serverEnv.mongoMaxPoolSize,
      serverSelectionTimeoutMS: 5_000,
      socketTimeoutMS: 45_000,
      bufferCommands: false,
    });
  }

  try {
    cache.connection = await cache.promise;
  } catch (error) {
    // Drop the failed promise so the next request retries cleanly.
    cache.promise = null;
    throw error;
  }

  return cache.connection;
}

export async function disconnectFromDatabase(): Promise<void> {
  if (!cache.connection) return;
  await mongoose.disconnect();
  cache.connection = null;
  cache.promise = null;
}

const READY_STATES: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

export function getDatabaseStatus(): { state: string; readyState: number; connected: boolean } {
  const readyState = mongoose.connection.readyState;
  return {
    readyState,
    state: READY_STATES[readyState] ?? 'unknown',
    connected: readyState === 1,
  };
}
