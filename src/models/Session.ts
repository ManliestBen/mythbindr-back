import { Schema, model, InferSchemaType, Types } from 'mongoose';

const conditionSchema = new Schema(
  { name: { type: String, required: true }, rounds: { type: Number, default: null } },
  { _id: false },
);

const deathSavesSchema = new Schema(
  { successes: { type: Number, default: 0 }, failures: { type: Number, default: 0 } },
  { _id: false },
);

const combatantSchema = new Schema(
  {
    cid: { type: String, required: true }, // client-generated stable id
    name: { type: String, required: true },
    initiative: { type: Number, default: 0 },
    maxHp: { type: Number, default: 0 },
    currentHp: { type: Number, default: 0 },
    tempHp: { type: Number, default: 0 },
    conditions: { type: [conditionSchema], default: [] },
    deathSaves: { type: deathSavesSchema, default: () => ({ successes: 0, failures: 0 }) },
    isPlayer: { type: Boolean, default: false },
    sourceElementId: { type: Schema.Types.ObjectId, ref: 'Element', default: null },
    notes: { type: String, default: '' },
  },
  { _id: false },
);

const logEntrySchema = new Schema(
  {
    at: { type: Date, default: Date.now },
    kind: { type: String, enum: ['roll', 'note', 'event'], required: true },
    text: { type: String, required: true },
    by: { type: String, default: '' },
  },
  { _id: false },
);

const sessionSchema = new Schema(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    status: { type: String, enum: ['active', 'ended'], default: 'active' },
    sourceEncounterId: { type: Schema.Types.ObjectId, ref: 'Element', default: null },
    round: { type: Number, default: 1 },
    turnIndex: { type: Number, default: 0 },
    combatants: { type: [combatantSchema], default: [] },
    log: { type: [logEntrySchema], default: [] },
    startedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export type SessionDoc = InferSchemaType<typeof sessionSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const GameSession = model('Session', sessionSchema);

export function publicSession(s: SessionDoc) {
  return {
    id: String(s._id),
    status: s.status,
    sourceEncounterId: s.sourceEncounterId ? String(s.sourceEncounterId) : null,
    round: s.round,
    turnIndex: s.turnIndex,
    combatants: (s.combatants ?? []).map((c) => ({
      cid: c.cid,
      name: c.name,
      initiative: c.initiative,
      maxHp: c.maxHp,
      currentHp: c.currentHp,
      tempHp: c.tempHp,
      conditions: (c.conditions ?? []).map((x) => ({ name: x.name, rounds: x.rounds })),
      deathSaves: {
        successes: c.deathSaves?.successes ?? 0,
        failures: c.deathSaves?.failures ?? 0,
      },
      isPlayer: c.isPlayer,
      sourceElementId: c.sourceElementId ? String(c.sourceElementId) : null,
      notes: c.notes,
    })),
    log: (s.log ?? []).map((l) => ({ at: l.at, kind: l.kind, text: l.text, by: l.by })),
    startedAt: s.createdAt,
    endedAt: s.endedAt,
  };
}
