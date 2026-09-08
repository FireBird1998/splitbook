import mongoose, { Schema, Model } from 'mongoose';
import { USERS_EMAIL_INDEX } from '@/lib/auth/collections';

export interface IUserDocument {
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  image?: string;
  /** Better Auth field: whether the sign-in provider vouched for the email. */
  emailVerified: boolean;
  preferredCurrency: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUserDocument>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    image: { type: String },
    emailVerified: { type: Boolean, default: false },
    preferredCurrency: { type: String, default: 'INR', trim: true },
  },
  {
    timestamps: true,
  },
);

// Indexes. The unique email index carries the name Better Auth's adapter
// generates, so both sides agree on one index (see src/lib/auth/collections.ts).
UserSchema.index({ email: 1 }, { unique: true, name: USERS_EMAIL_INDEX });

// Prevent model recompilation in development
const User: Model<IUserDocument> =
  mongoose.models.User || mongoose.model<IUserDocument>('User', UserSchema);

export default User;
