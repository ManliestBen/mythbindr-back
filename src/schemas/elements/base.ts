import { z } from 'zod';

/** Element types. PCs, quests, factions are [P1] and intentionally excluded for now. */
export const ELEMENT_TYPES = ['npc', 'location', 'encounter', 'item', 'note'] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

export const soundtrackSchema = z
  .object({
    spotifyUri: z.string().max(200),
    name: z.string().max(200),
  })
  .nullable();

/** Fields shared by every element type. Per-type schemas extend this with `type` + `data`. */
export const baseElementCreate = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  body: z.unknown().optional(),
  tags: z.array(z.string().max(40)).max(50).optional().default([]),
  playerVisible: z.boolean().optional().default(false),
  secrets: z.string().max(20000).optional().default(''),
  soundtrack: soundtrackSchema.optional(),
  /** Typed relationships to other elements (stored as source: 'relationship' links). */
  relationships: z
    .array(z.object({ targetId: z.string(), relType: z.string().max(40).optional().default('') }))
    .max(100)
    .optional(),
});

export interface ElementSchemaSet {
  create: z.ZodTypeAny;
  update: z.ZodTypeAny;
}
