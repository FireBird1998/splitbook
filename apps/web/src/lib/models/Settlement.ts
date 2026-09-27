import mongoose, { Schema, Model } from 'mongoose';
import { readStoredAmountMinor } from '@splitbook/shared/exact-money';
import {
  CreationRequestSchema,
  PendingActivitySchema,
  type ICreationRequest,
  type IPendingActivity,
} from '@/lib/financial-write';

export interface ISettlementDocument {
  _id: mongoose.Types.ObjectId;
  group: mongoose.Types.ObjectId;
  paidBy: mongoose.Types.ObjectId;
  paidTo: mongoose.Types.ObjectId;
  amount: number;
  amountMinor?: number;
  moneyVersion?: number;
  creationRequest?: ICreationRequest;
  pendingActivity: IPendingActivity[];
  currency: string;
  note?: string;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const SettlementSchema = new Schema<ISettlementDocument>(
  {
    group: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
    paidBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    paidTo: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true, min: 0.01 },
    amountMinor: { type: Number, min: 1, validate: Number.isSafeInteger },
    moneyVersion: { type: Number, enum: [1] },
    creationRequest: { type: CreationRequestSchema, default: undefined, select: false },
    pendingActivity: {
      type: [PendingActivitySchema],
      default: [],
      select: false,
      validate: (events: unknown[]) => events.length <= 100,
    },
    currency: { type: String, required: true, trim: true },
    note: { type: String, trim: true, maxlength: 500 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, value) {
        delete value.creationRequest;
        Reflect.deleteProperty(value, 'pendingActivity');
        return value;
      },
    },
  },
);

SettlementSchema.pre('validate', function () {
  if (this.moneyVersion === 1) readStoredAmountMinor(this);
});

// Indexes
SettlementSchema.index({ group: 1, createdAt: -1 });
SettlementSchema.index({ group: 1, paidBy: 1 });
SettlementSchema.index({ group: 1, paidTo: 1 });
SettlementSchema.index(
  { group: 1, createdBy: 1, 'creationRequest.key': 1 },
  { unique: true, partialFilterExpression: { 'creationRequest.key': { $type: 'string' } } },
);

const Settlement: Model<ISettlementDocument> =
  mongoose.models.Settlement || mongoose.model<ISettlementDocument>('Settlement', SettlementSchema);

export default Settlement;
