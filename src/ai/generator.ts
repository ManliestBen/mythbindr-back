import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { env } from '../lib/env';
import { ELEMENT_TYPES, type ElementType } from '../schemas/elements/base';

/**
 * Provider-agnostic content generation (PLAN.md §5.14). One concrete impl uses
 * the Claude API; swapping providers means another implementation of this interface.
 */
export interface GeneratedElement {
  name: string;
  body: string;
  secrets: string;
  tags: string[];
}

export interface GeneratedCampaign {
  name: string;
  hook: string;
  premise: string;
  elements: { type: ElementType; name: string; body: string; tags: string[]; secrets: string }[];
}

export interface ContentGenerator {
  configured(): boolean;
  generateElement(input: {
    type: ElementType;
    prompt: string;
    campaignName?: string;
  }): Promise<GeneratedElement>;
  refineText(input: { text: string; action: string }): Promise<string>;
  generateCampaign(input: { prompt: string }): Promise<GeneratedCampaign>;
}

const elementSchema = z.object({
  name: z.string(),
  body: z.string(),
  secrets: z.string(),
  tags: z.array(z.string()),
});

const campaignSchema = z.object({
  name: z.string(),
  hook: z.string(),
  premise: z.string(),
  elements: z
    .array(
      z.object({
        type: z.enum(ELEMENT_TYPES),
        name: z.string(),
        body: z.string(),
        tags: z.array(z.string()),
        secrets: z.string(),
      }),
    )
    .max(14),
});

const SYSTEM = `You are a creative assistant for Dungeon Masters building D&D 5e (SRD) campaigns.
Write vivid, usable, table-ready content. Keep "body" as readable prose (a few short paragraphs).
Put information the players must NOT see (twists, hidden motives, secret stats) in "secrets".
Tags are short lowercase keywords. Do not include markdown headers.`;

class ClaudeContentGenerator implements ContentGenerator {
  private client = new Anthropic({ apiKey: env.anthropic.apiKey });

  configured(): boolean {
    return env.anthropic.configured;
  }

  async generateElement(input: {
    type: ElementType;
    prompt: string;
    campaignName?: string;
  }): Promise<GeneratedElement> {
    const ctx = input.campaignName ? ` in the campaign "${input.campaignName}"` : '';
    const res = await this.client.messages.parse({
      model: env.anthropic.model,
      max_tokens: 4000,
      thinking: { type: 'adaptive' },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Generate a single ${input.type}${ctx}.\n\nBrief: ${input.prompt}`,
        },
      ],
      output_config: { format: zodOutputFormat(elementSchema) },
    });
    if (!res.parsed_output) throw new Error('AI returned no usable content');
    return res.parsed_output;
  }

  async generateCampaign(input: { prompt: string }): Promise<GeneratedCampaign> {
    const res = await this.client.messages.parse({
      model: env.anthropic.model,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Design a D&D 5e campaign from this premise. Provide a name, one-line hook, a premise (2-3 paragraphs), and 8-12 starter elements (a mix of npc, location, encounter, item, note) that reference each other where natural.\n\nPremise: ${input.prompt}`,
        },
      ],
      output_config: { format: zodOutputFormat(campaignSchema) },
    });
    if (!res.parsed_output) throw new Error('AI returned no usable content');
    return res.parsed_output;
  }

  async refineText(input: { text: string; action: string }): Promise<string> {
    const res = await this.client.messages.create({
      model: env.anthropic.model,
      max_tokens: 2000,
      thinking: { type: 'adaptive' },
      system: 'Rewrite the given text per the instruction. Return ONLY the rewritten text — no preamble, no quotes.',
      messages: [
        { role: 'user', content: `Instruction: ${input.action}\n\nText:\n${input.text}` },
      ],
    });
    const block = res.content.find((b) => b.type === 'text');
    return block && block.type === 'text' ? block.text.trim() : '';
  }
}

export const contentGenerator: ContentGenerator = new ClaudeContentGenerator();
