import { z } from 'zod';
import { baseElementCreate, type ElementSchemaSet } from './base';

// Item fields (§5.7). Owner is a typed relationship (to an NPC/PC/location).
const itemData = z.object({
  itemType: z
    .enum(['weapon', 'armor', 'potion', 'wondrous', 'quest', 'currency', 'other'])
    .optional(),
  rarity: z
    .enum(['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact'])
    .optional(),
  attunement: z.enum(['no', 'yes']).optional(),
  ownership: z.enum(['unassigned', 'npc', 'pc', 'stashed']).optional(),
  value: z.coerce.number().min(0).max(1e9).optional(),
  weight: z.coerce.number().min(0).max(1e6).optional(),
  effect: z.string().max(4000).optional(),
});

export const itemSchemas: ElementSchemaSet = {
  create: baseElementCreate.extend({
    type: z.literal('item'),
    data: itemData.optional().default({}),
  }),
  update: baseElementCreate.partial().extend({ data: itemData.optional() }),
};
