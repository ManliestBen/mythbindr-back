import { Router, type Response } from 'express';
import { asyncHandler, requireAdmin, requireAuth } from '../auth/middleware';
import { requireCampaignAccess } from '../campaigns/access';
import { contentGenerator } from './generator';
import { ELEMENT_TYPES, type ElementType } from '../schemas/elements/base';
import { Campaign, publicCampaign, type CampaignDoc } from '../models/Campaign';
import { Membership } from '../models/Membership';
import { Element } from '../models/Element';
import { deriveBodyText } from '../elements/bodyText';

function ensureConfigured(res: Response): boolean {
  if (!contentGenerator.configured()) {
    res.status(503).json({ error: 'AI is not configured on the server (set ANTHROPIC_API_KEY).' });
    return false;
  }
  return true;
}

// ── Campaign-scoped (admin + editor): generate element, refine text ────────
export const scopedAiRoutes = Router({ mergeParams: true });

scopedAiRoutes.post(
  '/element',
  requireCampaignAccess('editor'),
  requireAdmin,
  asyncHandler(async (req, res) => {
    if (!ensureConfigured(res)) return;
    const type = req.body?.type as ElementType;
    const prompt = String(req.body?.prompt ?? '').trim();
    if (!ELEMENT_TYPES.includes(type)) {
      res.status(400).json({ error: 'Invalid element type' });
      return;
    }
    if (!prompt) {
      res.status(400).json({ error: 'A brief is required' });
      return;
    }
    try {
      const element = await contentGenerator.generateElement({
        type,
        prompt,
        campaignName: (req.campaign as CampaignDoc | undefined)?.name,
      });
      res.json({ element });
    } catch (err) {
      console.error('AI element error:', err);
      res.status(502).json({ error: 'AI generation failed' });
    }
  }),
);

scopedAiRoutes.post(
  '/refine',
  requireCampaignAccess('editor'),
  requireAdmin,
  asyncHandler(async (req, res) => {
    if (!ensureConfigured(res)) return;
    const text = String(req.body?.text ?? '');
    const action = String(req.body?.action ?? '').trim();
    if (!text || !action) {
      res.status(400).json({ error: 'text and action are required' });
      return;
    }
    try {
      const refined = await contentGenerator.refineText({ text, action });
      res.json({ text: refined });
    } catch (err) {
      console.error('AI refine error:', err);
      res.status(502).json({ error: 'AI refine failed' });
    }
  }),
);

// ── Global (admin): generate a whole campaign with starter elements ────────
export const globalAiRoutes = Router();
globalAiRoutes.use(requireAuth, requireAdmin);

globalAiRoutes.post(
  '/campaign',
  asyncHandler(async (req, res) => {
    if (!ensureConfigured(res)) return;
    const prompt = String(req.body?.prompt ?? '').trim();
    if (!prompt) {
      res.status(400).json({ error: 'A premise is required' });
      return;
    }
    let gen;
    try {
      gen = await contentGenerator.generateCampaign({ prompt });
    } catch (err) {
      console.error('AI campaign error:', err);
      res.status(502).json({ error: 'AI generation failed' });
      return;
    }

    const userId = req.session.userId;
    const campaign = await Campaign.create({
      name: gen.name,
      hook: gen.hook,
      premise: gen.premise,
      ownerId: userId,
      updatedBy: userId,
    });
    await Membership.create({ campaignId: campaign._id, userId, role: 'owner' });

    const docs = gen.elements
      .filter((e) => ELEMENT_TYPES.includes(e.type))
      .map((e) => ({
        campaignId: campaign._id,
        type: e.type,
        name: e.name,
        body: e.body,
        bodyText: deriveBodyText(e.body),
        tags: e.tags ?? [],
        secrets: e.secrets ?? '',
        updatedBy: userId,
      }));
    if (docs.length) await Element.insertMany(docs);

    res.status(201).json({
      campaign: publicCampaign(campaign as CampaignDoc),
      elementCount: docs.length,
    });
  }),
);
