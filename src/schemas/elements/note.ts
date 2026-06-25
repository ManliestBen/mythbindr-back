import { z } from 'zod';
import { baseElementCreate, type ElementSchemaSet } from './base';

// Notes carry no structured `data` in the MVP — just name/body/tags/secrets.
const noteData = z.object({}).passthrough();

export const noteSchemas: ElementSchemaSet = {
  create: baseElementCreate.extend({
    type: z.literal('note'),
    data: noteData.optional().default({}),
  }),
  update: baseElementCreate.partial().extend({
    data: noteData.optional(),
  }),
};
