import mongoose, { Schema, Model } from 'mongoose';
import type { ActivityType } from '@splitbook/shared/types';
import {
  NotificationContextSchema,
  type NotificationContext,
  ACTIVITY_TYPES,
} from '@/lib/financial-write';
// `populate()` finds the model a `ref` names in Mongoose's registry, not through an import, and a
// fresh server instance loads only its route's modules. So this model registers every model its
// schema refers to, and any route that loads it can populate it (#947, #186).
import '@/lib/models/Group';
import '@/lib/models/User';

export interface IActivityDocument {
  _id: mongoose.Types.ObjectId;
  group: mongoose.Types.ObjectId;
  type: ActivityType;
  actor: mongoose.Types.ObjectId;
  metadata: Record<string, unknown>;
  notificationContext?: NotificationContext;
  createdAt: Date;
}

const ActivitySchema = new Schema<IActivityDocument>(
  {
    group: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
    type: {
      type: String,
      enum: ACTIVITY_TYPES,
      required: true,
    },
    actor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    notificationContext: {
      type: NotificationContextSchema,
      select: false,
      default: undefined,
      immutable: true,
    },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      transform(_doc, value) {
        Reflect.deleteProperty(value, 'notificationContext');
        return value;
      },
    },
  },
);

// Indexes
ActivitySchema.index(
  { 'notificationContext.version': 1, _id: 1, createdAt: 1 },
  { partialFilterExpression: { 'notificationContext.version': 2 } },
);
ActivitySchema.index({ group: 1, createdAt: -1, _id: -1 });

const Activity: Model<IActivityDocument> =
  mongoose.models.Activity || mongoose.model<IActivityDocument>('Activity', ActivitySchema);

export default Activity;
