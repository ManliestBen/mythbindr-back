import { z } from 'zod';

const moodSlot = z.object({
  label: z.string().min(1).max(40),
  spotifyUri: z.string().max(200).optional().default(''),
});

export const campaignCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  hook: z.string().max(280).optional().default(''),
  premise: z.unknown().optional(),
  tone: z.array(z.string().max(40)).max(20).optional().default([]),
  startLevel: z.number().int().min(1).max(20).optional(),
  endLevel: z.number().int().min(1).max(20).optional(),
  settingName: z.string().max(120).optional().default(''),
  storySoFar: z.string().max(20000).optional().default(''),
  moodSlots: z.array(moodSlot).max(12).optional(),
});

// All fields optional for PATCH; name still can't be set to empty if present.
export const campaignUpdateSchema = campaignCreateSchema.partial();

export type CampaignCreateInput = z.infer<typeof campaignCreateSchema>;
export type CampaignUpdateInput = z.infer<typeof campaignUpdateSchema>;
