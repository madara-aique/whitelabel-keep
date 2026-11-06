import { Schema, model, models, type Model, type InferSchemaType } from 'mongoose';

/**
 * Write-ahead log for the offline → online sync worker.
 *
 * A local change is always recorded here first, then forwarded. If the
 * online cluster is unreachable the row stays `pending` and is retried
 * on the next sweep, so a kiosk that loses connectivity never loses a
 * sale.
 */
const syncQueueSchema = new Schema(
  {
    changeType: {
      type: String,
      enum: ['insert', 'update', 'delete', 'replace'],
      required: true,
    },
    sourceCollection: { type: String, required: true },
    documentId: { type: String, default: '' },
    document: { type: Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ['pending', 'synced', 'failed'],
      default: 'pending',
    },
    retryCount: { type: Number, default: 0, min: 0 },
    lastError: { type: String, default: '' },
    syncedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'sync_queue' },
);

syncQueueSchema.index({ status: 1, createdAt: 1 });
syncQueueSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export type SyncQueueDoc = InferSchemaType<typeof syncQueueSchema>;

export const SyncQueue: Model<SyncQueueDoc> =
  (models.SyncQueue as Model<SyncQueueDoc>) ??
  model<SyncQueueDoc>('SyncQueue', syncQueueSchema);
