import { Schema, model, InferSchemaType, Types } from 'mongoose';

export const MEMBERSHIP_ROLES = ['owner', 'editor', 'viewer'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

const membershipSchema = new Schema(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: MEMBERSHIP_ROLES, required: true },
  },
  { timestamps: true },
);

// A user has at most one membership per campaign.
membershipSchema.index({ campaignId: 1, userId: 1 }, { unique: true });

export type MembershipDoc = InferSchemaType<typeof membershipSchema> & {
  _id: Types.ObjectId;
};

export const Membership = model('Membership', membershipSchema);
