import { z } from 'zod';
import { baseElementCreate, type ElementSchemaSet } from './base';

// Location fields (§5.5). Parent/inhabitants/connected are typed relationships.
const locationData = z.object({
  locType: z
    .enum(['city', 'dungeon', 'wilderness', 'building', 'plane', 'region', 'other'])
    .optional(),
  features: z.string().max(4000).optional(),
  readAloud: z.string().max(4000).optional(),
});

export const locationSchemas: ElementSchemaSet = {
  create: baseElementCreate.extend({
    type: z.literal('location'),
    data: locationData.optional().default({}),
  }),
  update: baseElementCreate.partial().extend({ data: locationData.optional() }),
};
