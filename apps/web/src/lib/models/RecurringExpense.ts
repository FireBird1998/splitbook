import mongoose, { Schema, Model } from 'mongoose';
import type { IExpensePayerDocument, IExpenseSplitDocument } from '@/lib/models/Expense';

export interface IRecurringExpenseDocument {
  _id: mongoose.Types.ObjectId;
  group: mongoose.Types.ObjectId;
  description: string;
  amount: number;
  currency: string;
  category: string;
  tag: string;
  paidBy: IExpensePayerDocument[];
  splitMethod: 'equal' | 'unequal' | 'percentage' | 'shares' | 'exact';
  splitBetween: IExpenseSplitDocument[];
  /** 1–31; clamped to the last day of short months at generation time. */
  dayOfMonth: number;
  startsOn: Date;
  endsOn?: Date | null;
  isPaused: boolean;
  /** Last materialized period (`YYYY-MM`); advanced monotonically via $max. */
  lastGeneratedFor?: string | null;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const RecurringPayerSchema = new Schema<IExpensePayerDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const RecurringSplitSchema = new Schema<IExpenseSplitDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true, min: 0 },
    percentage: { type: Number },
    shares: { type: Number },
  },
  { _id: false },
);

const RecurringExpenseSchema = new Schema<IRecurringExpenseDocument>(
  {
    group: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 200,
    },
    amount: { type: Number, required: true, min: 0.01, max: 10_000_000 },
    currency: { type: String, required: true, trim: true },
    category: { type: String, default: 'other', trim: true },
    tag: { type: String, required: true, trim: true },
    paidBy: {
      type: [RecurringPayerSchema],
      required: true,
      validate: {
        validator: (v: IExpensePayerDocument[]) => v.length >= 1,
        message: 'At least one payer is required',
      },
    },
    splitMethod: {
      type: String,
      enum: ['equal', 'unequal', 'percentage', 'shares', 'exact'],
      required: true,
    },
    splitBetween: {
      type: [RecurringSplitSchema],
      required: true,
      validate: {
        validator: (v: IExpenseSplitDocument[]) => v.length >= 1,
        message: 'At least one person must be in the split',
      },
    },
    dayOfMonth: { type: Number, required: true, min: 1, max: 31 },
    startsOn: { type: Date, required: true },
    endsOn: { type: Date, default: null },
    isPaused: { type: Boolean, default: false },
    lastGeneratedFor: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: true,
  },
);

RecurringExpenseSchema.index({ group: 1 });

// In development, Mongoose models persist across hot reloads but schema changes
// are not picked up. Force re-registration so new/modified fields are recognised.
if (mongoose.models.RecurringExpense) {
  mongoose.deleteModel('RecurringExpense');
}
const RecurringExpense: Model<IRecurringExpenseDocument> =
  mongoose.model<IRecurringExpenseDocument>('RecurringExpense', RecurringExpenseSchema);

export default RecurringExpense;
