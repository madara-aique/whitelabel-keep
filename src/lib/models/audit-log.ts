import { Schema, model, models, type Model, type InferSchemaType } from 'mongoose';

/**
 * Append-only record of privileged actions (PIN changes, door clears,
 * rebooks). The legacy app performed these silently, which made an
 * operator dispute impossible to resolve.
 */
const auditLogSchema = new Schema(
  {
    action: { type: String, required: true, index: true },
    actorId: { type: String, default: '' },
    actorEmail: { type: String, default: '' },
    targetType: { type: String, enum: ['door', 'transaction', 'user', 'system'], default: 'system' },
    targetId: { type: String, default: '' },
    /** Free-form context; must never contain a full PIN. */
    metadata: { type: Schema.Types.Mixed, default: {} },
    succeeded: { type: Boolean, default: true },
    errorMessage: { type: String, default: '' },
  },
  { timestamps: true, collection: 'audit_logs' },
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

export type AuditLogDoc = InferSchemaType<typeof auditLogSchema>;

export const AuditLog: Model<AuditLogDoc> =
  (models.AuditLog as Model<AuditLogDoc>) ??
  model<AuditLogDoc>('AuditLog', auditLogSchema);
