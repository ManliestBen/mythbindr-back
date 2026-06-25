import { Schema, model, InferSchemaType, Types } from 'mongoose';

const inviteSchema = new Schema(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    token: { type: String, required: true, unique: true },
    role: { type: String, enum: ['editor', 'viewer'], required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
    /** Set once accepted (single-use). */
    usedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    usedAt: { type: Date, default: null },
    revoked: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type InviteDoc = InferSchemaType<typeof inviteSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
};

export const Invite = model('Invite', inviteSchema);

/** True if the invite can still be accepted. */
export function inviteIsLive(i: InviteDoc): boolean {
  return !i.revoked && !i.usedBy && i.expiresAt.getTime() > Date.now();
}
