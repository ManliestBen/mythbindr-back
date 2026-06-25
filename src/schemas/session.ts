import { z } from 'zod';

const condition = z.object({
  name: z.string().max(40),
  rounds: z.number().nullable().optional(),
});

const combatant = z.object({
  cid: z.string().max(64),
  name: z.string().min(1).max(120),
  initiative: z.number(),
  maxHp: z.number().min(0),
  currentHp: z.number(),
  tempHp: z.number().min(0),
  conditions: z.array(condition).max(30),
  deathSaves: z.object({
    successes: z.number().min(0).max(3),
    failures: z.number().min(0).max(3),
  }),
  isPlayer: z.boolean(),
  sourceElementId: z.string().nullable().optional(),
  notes: z.string().max(500).optional(),
});

const logEntry = z.object({
  at: z.union([z.string(), z.number()]).optional(),
  kind: z.enum(['roll', 'note', 'event']),
  text: z.string().max(500),
  by: z.string().max(120).optional(),
});

export const sessionStartSchema = z.object({
  sourceEncounterId: z.string().optional(),
});

export const sessionUpdateSchema = z.object({
  round: z.number().int().min(1).optional(),
  turnIndex: z.number().int().min(0).optional(),
  combatants: z.array(combatant).max(100).optional(),
  log: z.array(logEntry).max(500).optional(),
  status: z.enum(['active', 'ended']).optional(),
});
