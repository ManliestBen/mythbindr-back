import { Schema, model, InferSchemaType, Types } from 'mongoose';

/** One mood/ambiance slot bound to a Spotify playlist (§5.12a — field only, no playback yet). */
const moodSlotSchema = new Schema(
  {
    label: { type: String, required: true },
    spotifyUri: { type: String, default: '' },
  },
  { _id: false },
);

const campaignSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    /** One-line hook. */
    hook: { type: String, default: '' },
    /** Premise/synopsis — rich body (ProseMirror JSON once TipTap lands; may be plain in early slices). */
    premise: { type: Schema.Types.Mixed, default: null },
    tone: { type: [String], default: [] },
    startLevel: { type: Number, default: 1 },
    endLevel: { type: Number, default: 20 },
    settingName: { type: String, default: '' },
    /** GM-maintained "story so far", shown atop the dashboard (§5.3). */
    storySoFar: { type: String, default: '' },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    moodSlots: { type: [moodSlotSchema], default: [] },
    /** Soft-delete to a 30-day trash (§5.3). */
    deletedAt: { type: Date, default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    version: { type: Number, default: 1 },
  },
  { timestamps: true },
);

export type CampaignDoc = InferSchemaType<typeof campaignSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const Campaign = model('Campaign', campaignSchema);

/** Shape returned to the client. */
export function publicCampaign(c: CampaignDoc) {
  return {
    id: String(c._id),
    name: c.name,
    hook: c.hook,
    premise: c.premise,
    tone: c.tone,
    startLevel: c.startLevel,
    endLevel: c.endLevel,
    settingName: c.settingName,
    storySoFar: c.storySoFar,
    moodSlots: c.moodSlots,
    ownerId: String(c.ownerId),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}
