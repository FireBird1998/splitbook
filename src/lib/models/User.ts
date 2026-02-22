import mongoose, { Schema, Model } from "mongoose";

export interface IUserDocument {
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  image?: string;
  emailVerified?: Date | null;
  preferredCurrency: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUserDocument>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    image: { type: String },
    emailVerified: { type: Date, default: null },
    preferredCurrency: { type: String, default: "INR", trim: true },
  },
  {
    timestamps: true,
  }
);

// Indexes
UserSchema.index({ email: 1 }, { unique: true });

// Prevent model recompilation in development
const User: Model<IUserDocument> =
  mongoose.models.User || mongoose.model<IUserDocument>("User", UserSchema);

export default User;

