import type { ElementType, ElementSchemaSet } from './base';
import { noteSchemas } from './note';
import { npcSchemas } from './npc';
import { locationSchemas } from './location';
import { itemSchemas } from './item';
import { encounterSchemas } from './encounter';

export * from './base';

/**
 * Per-type validation schemas. Adding an element type = add its schema module
 * and one entry here; the generic element controller does the rest.
 * Types without an entry are rejected with 400 "unsupported type".
 */
export const elementRegistry: Partial<Record<ElementType, ElementSchemaSet>> = {
  note: noteSchemas,
  npc: npcSchemas,
  location: locationSchemas,
  item: itemSchemas,
  encounter: encounterSchemas,
};
