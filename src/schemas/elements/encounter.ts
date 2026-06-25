import { z } from 'zod';
import { baseElementCreate, type ElementSchemaSet } from './base';

// Encounter fields (§5.6). The combatant list is freeform text in the MVP; the
// structured initiative tracker arrives with Run Session (Phase 3).
const encounterData = z.object({
  encType: z.enum(['combat', 'social', 'exploration', 'puzzle', 'trap']).optional(),
  status: z.enum(['planned', 'in-progress', 'completed']).optional(),
  trigger: z.string().max(500).optional(),
  objective: z.string().max(2000).optional(),
  combatants: z.string().max(4000).optional(),
  xp: z.coerce.number().min(0).max(1e7).optional(),
  gold: z.coerce.number().min(0).max(1e9).optional(),
  rewards: z.string().max(2000).optional(),
  outcome: z.string().max(2000).optional(),
});

export const encounterSchemas: ElementSchemaSet = {
  create: baseElementCreate.extend({
    type: z.literal('encounter'),
    data: encounterData.optional().default({}),
  }),
  update: baseElementCreate.partial().extend({ data: encounterData.optional() }),
};
