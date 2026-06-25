import { Schema, model, InferSchemaType, Types } from 'mongoose';

const shareLinkSchema = new Schema(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    token: { type: String, required: true, unique: true },
    scope: { type: String, enum: ['campaign'], default: 'campaign' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, default: null },
    revoked: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type ShareLinkDoc = InferSchemaType<typeof shareLinkSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
};

export const ShareLink = model('ShareLink', shareLinkSchema);

export function shareLinkIsLive(s: ShareLinkDoc): boolean {
  return !s.revoked && (!s.expiresAt || s.expiresAt.getTime() > Date.now());
}
