import mongoose, { Schema, Model } from 'mongoose';

export interface IExpensePayerDocument {
  user: mongoose.Types.ObjectId;
  amount: number;
}

export interface IExpenseSplitDocument {
  user: mongoose.Types.ObjectId;
  amount: number;
  percentage?: number;
  shares?: number;
}

export interface IExpenseEditDocument {
  editedBy: mongoose.Types.ObjectId;
  editedAt: Date;
  changes: Record<string, { old: unknown; new: unknown }>;
}

export interface IExpenseDocument {
  _id: mongoose.Types.ObjectId;
  group: mongoose.Types.ObjectId;
  description: string;
  amount: number;
  currency: string;
  category: string;
  date: Date;
  paidBy: IExpensePayerDocument[];
  splitMethod: 'equal' | 'unequal' | 'percentage' | 'shares' | 'exact';
  splitBetween: IExpenseSplitDocument[];
  tag: string;
  predefinedItem?: string | null;
  receiptUrl?: string | null;
  notes?: string;
  /** Set when the expense was materialized from a recurring template. */
  recurringExpense?: mongoose.Types.ObjectId | null;
  /** The template period (`YYYY-MM`) this expense was generated for. */
  period?: string | null;
  createdBy: mongoose.Types.ObjectId;
  isDeleted: boolean;
  deletedAt?: Date | null;
  deletedBy?: mongoose.Types.ObjectId | null;
  editHistory: IExpenseEditDocument[];
  createdAt: Date;
  updatedAt: Date;
}

const ExpensePayerSchema = new Schema<IExpensePayerDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const ExpenseSplitSchema = new Schema<IExpenseSplitDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true, min: 0 },
    percentage: { type: Number },
    shares: { type: Number },
  },
  { _id: false },
);

const ExpenseEditSchema = new Schema<IExpenseEditDocument>(
  {
    editedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    editedAt: { type: Date, default: Date.now },
    changes: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false },
);

const ExpenseSchema = new Schema<IExpenseDocument>(
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
    date: { type: Date, required: true },
    paidBy: {
      type: [ExpensePayerSchema],
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
      type: [ExpenseSplitSchema],
      required: true,
      validate: {
        validator: (v: IExpenseSplitDocument[]) => v.length >= 1,
        message: 'At least one person must be in the split',
      },
    },
    tag: { type: String, required: true, trim: true },
    predefinedItem: { type: String, default: null },
    receiptUrl: { type: String, default: null },
    notes: { type: String, trim: true, maxlength: 500 },
    recurringExpense: { type: Schema.Types.ObjectId, ref: 'RecurringExpense', default: null },
    period: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    editHistory: { type: [ExpenseEditSchema], default: [] },
  },
  {
    timestamps: true,
  },
);

// Indexes
ExpenseSchema.index({ group: 1, date: -1 });
ExpenseSchema.index({ group: 1, isDeleted: 1 });
ExpenseSchema.index({ group: 1, tag: 1 });
ExpenseSchema.index({ group: 1, category: 1 });
ExpenseSchema.index({ description: 'text' });
// Idempotent recurring generation: one expense per (template, period).
// Partial because most expenses have `recurringExpense: null` — a plain unique
// index would collide on the nulls (same reason as Group.inviteCode).
ExpenseSchema.index(
  { recurringExpense: 1, period: 1 },
  { unique: true, partialFilterExpression: { recurringExpense: { $type: 'objectId' } } },
);

// In development, Mongoose models persist across hot reloads but schema changes
// are not picked up. Force re-registration so new/modified fields are recognised.
if (mongoose.models.Expense) {
  mongoose.deleteModel('Expense');
}
const Expense: Model<IExpenseDocument> = mongoose.model<IExpenseDocument>('Expense', ExpenseSchema);

export default Expense;
