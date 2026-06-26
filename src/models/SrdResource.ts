import { Schema, model, InferSchemaType, Types } from 'mongoose';

/**
 * Generic 5e SRD / open-license reference resource. One collection, tagged by
 * `category` (the Open5e endpoint: monsters, spells, conditions, magicitems,
 * weapons, armor, feats, races, classes, backgrounds, planes, sections, …).
 * Common filter fields are lifted to the top level; the full object lives in `data`.
 */
const srdResourceSchema = new Schema(
  {
    category: { type: String, required: true, index: true },
    slug: { type: String, required: true },
    name: { type: String, required: true },
    // Optional, category-dependent filter fields (sparse).
    cr: { type: Number },
    hp: { type: Number },
    ac: { type: Number },
    size: { type: String },
    type: { type: String },
    level: { type: Number },
    school: { type: String },
    rarity: { type: String },
    classes: { type: [String], default: [] },
    desc: { type: String },
    data: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

srdResourceSchema.index({ category: 1, slug: 1 }, { unique: true });
srdResourceSchema.index({ category: 1, name: 1 });
srdResourceSchema.index({ category: 1, cr: 1 });
srdResourceSchema.index({ category: 1, level: 1 });

export type SrdResourceDoc = InferSchemaType<typeof srdResourceSchema> & {
  _id: Types.ObjectId;
};

export const SrdResource = model('SrdResource', srdResourceSchema);

export function srdListItem(r: SrdResourceDoc) {
  return {
    category: r.category,
    slug: r.slug,
    name: r.name,
    cr: r.cr ?? null,
    hp: r.hp ?? null,
    ac: r.ac ?? null,
    size: r.size ?? null,
    type: r.type ?? null,
    level: r.level ?? null,
    school: r.school ?? null,
    rarity: r.rarity ?? null,
    classes: r.classes ?? [],
  };
}

export function srdDetail(r: SrdResourceDoc) {
  return {
    category: r.category,
    slug: r.slug,
    name: r.name,
    desc: r.desc ?? null,
    data: r.data,
  };
}
