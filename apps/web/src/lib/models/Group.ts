import mongoose, { Schema, Model } from 'mongoose';
import { CreationRequestSchema, type ICreationRequest } from '@/lib/financial-write';
import { MAX_EXTRA_CURRENCIES } from '@splitbook/shared/group-currencies';
import { ASSISTANT_RULES, type AssistantRule } from '@splitbook/shared/assistant-rule';

export interface IGroupMemberDocument {
  user: mongoose.Types.ObjectId;
  role: 'admin' | 'member';
  joinedAt: Date;
}

export interface IGroupTagDocument {
  _id: mongoose.Types.ObjectId;
  name: string;
  isArchived: boolean;
  isDeleted?: boolean;
  revision?: number;
  createdAt: Date;
}

export interface IGroupDocument {
  _id: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  image?: string;
  createdBy: mongoose.Types.ObjectId;
  members: IGroupMemberDocument[];
  tags: IGroupTagDocument[];
  defaultCurrency: string;
  currencyLocked: boolean;
  alternateCurrencies: string[];
  category: 'trip' | 'home' | 'couple' | 'work' | 'other';
  startDate?: Date | null;
  endDate?: Date | null;
  isArchived: boolean;
  /** Whether members' Connected assistants may reach this Group (#621). Unset reads as allowed. */
  assistantRule?: AssistantRule;
  /** The admin who last set the Assistant rule. */
  assistantRuleSetBy?: mongoose.Types.ObjectId | null;
  deletionRequestedAt?: Date;
  mutationSequence?: number;
  inviteCode?: string | null;
  inviteCodeExpiresAt?: Date | null;
  creationRequest?: ICreationRequest;
  createdAt: Date;
  updatedAt: Date;
}

const GroupMemberSchema = new Schema<IGroupMemberDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['admin', 'member'], default: 'member' },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const GroupTagSchema = new Schema<IGroupTagDocument>({
  name: { type: String, required: true, trim: true, maxlength: 50 },
  isArchived: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false },
  revision: { type: Number, default: 0, min: 0 },
  createdAt: { type: Date, default: Date.now },
});

const GroupSchema = new Schema<IGroupDocument>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 100,
    },
    description: { type: String, trim: true, maxlength: 500 },
    image: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    members: { type: [GroupMemberSchema], default: [] },
    tags: { type: [GroupTagSchema], default: [] },
    defaultCurrency: { type: String, required: true, trim: true },
    currencyLocked: { type: Boolean, default: false },
    alternateCurrencies: {
      type: [String],
      default: [],
      // The Group's extra currencies (#719). Only the cap is checked here: every save validates
      // the stored list, and an older Group's may hold repeats or retired codes that the service
      // cleans up when the currencies are saved. The rule itself is the service's and Zod's.
      validate: {
        validator: (v: string[]) => v.length <= MAX_EXTRA_CURRENCIES,
        message: `At most ${MAX_EXTRA_CURRENCIES} extra currencies`,
      },
    },
    category: {
      type: String,
      enum: ['trip', 'home', 'couple', 'work', 'other'],
      default: 'other',
    },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    assistantRule: { type: String, enum: ASSISTANT_RULES, default: 'allowed' },
    assistantRuleSetBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    isArchived: { type: Boolean, default: false },
    deletionRequestedAt: { type: Date, select: false },
    mutationSequence: { type: Number, select: false },
    inviteCode: { type: String, default: null },
    inviteCodeExpiresAt: { type: Date, default: null },
    creationRequest: { type: CreationRequestSchema, default: undefined, select: false },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, value) {
        delete value.creationRequest;
        return value;
      },
    },
  },
);

// Indexes
GroupSchema.index({ 'members.user': 1 });
GroupSchema.index({ createdBy: 1 });
// Partial (not sparse): `inviteCode` has `default: null`, and sparse unique
// indexes still index explicit nulls — multiple null-coded groups would collide.
GroupSchema.index(
  { inviteCode: 1 },
  { unique: true, partialFilterExpression: { inviteCode: { $type: 'string' } } },
);
GroupSchema.index(
  { createdBy: 1, 'creationRequest.key': 1 },
  { unique: true, partialFilterExpression: { 'creationRequest.key': { $type: 'string' } } },
);

// In development, Mongoose models persist across hot reloads but schema changes
// are not picked up. Force re-registration so new/modified fields are recognised.
if (mongoose.models.Group) {
  mongoose.deleteModel('Group');
}
const Group: Model<IGroupDocument> = mongoose.model<IGroupDocument>('Group', GroupSchema);

export default Group;
