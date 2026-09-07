import mongoose, { Schema, Model } from 'mongoose';
import type { ActivityType } from '@splitbook/shared/types';

export interface IActivityDocument {
  _id: mongoose.Types.ObjectId;
  group: mongoose.Types.ObjectId;
  type: ActivityType;
  actor: mongoose.Types.ObjectId;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

const ActivitySchema = new Schema<IActivityDocument>(
  {
    group: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
    type: {
      type: String,
      enum: [
        'expense_added',
        'expense_updated',
        'expense_deleted',
        'settlement_recorded',
        'member_joined',
        'member_left',
        'group_created',
        'group_updated',
      ],
      required: true,
    },
    actor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);

// Indexes
ActivitySchema.index({ group: 1, createdAt: -1 });

const Activity: Model<IActivityDocument> =
  mongoose.models.Activity || mongoose.model<IActivityDocument>('Activity', ActivitySchema);

export default Activity;
