import mongoose, { Schema, Model } from "mongoose";

export interface IInvitationDocument {
  _id: mongoose.Types.ObjectId;
  group: mongoose.Types.ObjectId;
  invitedBy: mongoose.Types.ObjectId;
  invitedEmail: string;
  status: "pending" | "accepted" | "declined" | "expired";
  token: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const InvitationSchema = new Schema<IInvitationDocument>(
  {
    group: { type: Schema.Types.ObjectId, ref: "Group", required: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    invitedEmail: { type: String, required: true, trim: true, lowercase: true },
    status: {
      type: String,
      enum: ["pending", "accepted", "declined", "expired"],
      default: "pending",
    },
    token: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  {
    timestamps: true,
  }
);

// Indexes
InvitationSchema.index({ token: 1 }, { unique: true });
InvitationSchema.index({ invitedEmail: 1, group: 1 });
InvitationSchema.index({ status: 1, expiresAt: 1 });

const Invitation: Model<IInvitationDocument> =
  mongoose.models.Invitation ||
  mongoose.model<IInvitationDocument>("Invitation", InvitationSchema);

export default Invitation;

