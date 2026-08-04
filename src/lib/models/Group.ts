import mongoose, { Schema, Model } from 'mongoose';

export interface IGroupMemberDocument {
  user: mongoose.Types.ObjectId;
  role: 'admin' | 'member';
  joinedAt: Date;
}

export interface IGroupTagDocument {
  _id: mongoose.Types.ObjectId;
  name: string;
  isArchived: boolean;
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
  alternateCurrencies: string[];
  category: 'trip' | 'home' | 'couple' | 'work' | 'other';
  startDate?: Date | null;
  endDate?: Date | null;
  isArchived: boolean;
  inviteCode?: string | null;
  inviteCodeExpiresAt?: Date | null;
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
    alternateCurrencies: {
      type: [String],
      default: [],
      validate: {
        validator: (v: string[]) => v.length <= 2,
        message: 'Maximum 2 alternate currencies allowed',
      },
    },
    category: {
      type: String,
      enum: ['trip', 'home', 'couple', 'work', 'other'],
      default: 'other',
    },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    isArchived: { type: Boolean, default: false },
    inviteCode: { type: String, default: null },
    inviteCodeExpiresAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  },
);

// Indexes
GroupSchema.index({ 'members.user': 1 });
GroupSchema.index({ createdBy: 1 });
GroupSchema.index({ inviteCode: 1 }, { unique: true, sparse: true });

// In development, Mongoose models persist across hot reloads but schema changes
// are not picked up. Force re-registration so new/modified fields are recognised.
if (mongoose.models.Group) {
  mongoose.deleteModel('Group');
}
const Group: Model<IGroupDocument> = mongoose.model<IGroupDocument>('Group', GroupSchema);

export default Group;
