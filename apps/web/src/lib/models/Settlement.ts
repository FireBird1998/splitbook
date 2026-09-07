import mongoose, { Schema, Model } from 'mongoose';

export interface ISettlementDocument {
  _id: mongoose.Types.ObjectId;
  group: mongoose.Types.ObjectId;
  paidBy: mongoose.Types.ObjectId;
  paidTo: mongoose.Types.ObjectId;
  amount: number;
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
    currency: { type: String, required: true, trim: true },
    note: { type: String, trim: true, maxlength: 500 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: true,
  },
);

// Indexes
SettlementSchema.index({ group: 1, createdAt: -1 });
SettlementSchema.index({ group: 1, paidBy: 1 });
SettlementSchema.index({ group: 1, paidTo: 1 });

const Settlement: Model<ISettlementDocument> =
  mongoose.models.Settlement || mongoose.model<ISettlementDocument>('Settlement', SettlementSchema);

export default Settlement;
