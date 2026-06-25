import { Schema, model, InferSchemaType, Types } from 'mongoose';
import { ELEMENT_TYPES } from '../schemas/elements/base';

/** Outbound link to another element (mention = from the body; relationship = typed form field). */
const linkSchema = new Schema(
  {
    targetId: { type: Schema.Types.ObjectId, ref: 'Element', required: true },
    relType: { type: String, default: '' },
    source: { type: String, enum: ['mention', 'relationship'], required: true },
  },
  { _id: false },
);

const soundtrackSubSchema = new Schema(
  { spotifyUri: { type: String, default: '' }, name: { type: String, default: '' } },
  { _id: false },
);

const elementSchema = new Schema(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    type: { type: String, enum: ELEMENT_TYPES, required: true },
    name: { type: String, required: true, trim: true },
    /** Rich body — ProseMirror JSON once TipTap lands; plain string in early slices. */
    body: { type: Schema.Types.Mixed, default: null },
    /** Server-derived plaintext powering the text index. */
    bodyText: { type: String, default: '' },
    tags: { type: [String], default: [] },
    links: { type: [linkSchema], default: [] },
    /** Type-specific fields, validated by the per-type zod schema. */
    data: { type: Schema.Types.Mixed, default: {} },
    playerVisible: { type: Boolean, default: false },
    /** GM-only; never published to the player share view. */
    secrets: { type: String, default: '' },
    soundtrack: { type: soundtrackSubSchema, default: null },
    /** Reserved for Phase 2 CRDT co-editing. */
    docState: { type: Schema.Types.Mixed, default: null },
    deletedAt: { type: Date, default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    version: { type: Number, default: 1 },
  },
  { timestamps: true },
);

elementSchema.index({ campaignId: 1, type: 1, deletedAt: 1 });
elementSchema.index({ campaignId: 1, deletedAt: 1 });
elementSchema.index({ 'links.targetId': 1 });
elementSchema.index({ name: 'text', bodyText: 'text' });

export type ElementDoc = InferSchemaType<typeof elementSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const Element = model('Element', elementSchema);

/** GM-facing serialization (includes `secrets`; the share view strips it separately). */
export function publicElement(e: ElementDoc) {
  return {
    id: String(e._id),
    campaignId: String(e.campaignId),
    type: e.type,
    name: e.name,
    body: e.body,
    tags: e.tags,
    links: (e.links ?? []).map((l) => ({
      targetId: String(l.targetId),
      relType: l.relType,
      source: l.source,
    })),
    data: e.data,
    playerVisible: e.playerVisible,
    secrets: e.secrets,
    soundtrack: e.soundtrack,
    version: e.version,
    deletedAt: e.deletedAt,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}
