import { z } from 'zod';
import { baseElementCreate, type ElementSchemaSet } from './base';

// NPC fields (§5.4): identity + status + roleplay aids.
const npcData = z.object({
  race: z.string().max(80).optional(),
  role: z.string().max(120).optional(), // occupation
  alignment: z.string().max(40).optional(),
  status: z.enum(['alive', 'dead', 'missing', 'unknown']).optional(),
  location: z.string().max(120).optional(),
  faction: z.string().max(120).optional(),
  summary: z.string().max(500).optional(),
  traits: z.string().max(1000).optional(),
  ideal: z.string().max(300).optional(),
  bond: z.string().max(300).optional(),
  flaw: z.string().max(300).optional(),
  mannerism: z.string().max(300).optional(),
  catchphrase: z.string().max(300).optional(),
});

export const npcSchemas: ElementSchemaSet = {
  create: baseElementCreate.extend({
    type: z.literal('npc'),
    data: npcData.optional().default({}),
  }),
  update: baseElementCreate.partial().extend({ data: npcData.optional() }),
};
