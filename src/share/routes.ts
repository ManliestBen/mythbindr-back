import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { asyncHandler } from '../auth/middleware';
import { Campaign } from '../models/Campaign';
import { Element, type ElementDoc } from '../models/Element';
import { ShareLink, shareLinkIsLive, type ShareLinkDoc } from '../models/ShareLink';
import { sharedElement } from './serialize';

// PUBLIC — no auth, no session. Token in the path is the only credential.
const router = Router();

async function resolve(token: string) {
  const link = await ShareLink.findOne({ token });
  if (!link || !shareLinkIsLive(link as ShareLinkDoc)) return null;
  const campaign = await Campaign.findOne({ _id: link.campaignId, deletedAt: null });
  if (!campaign) return null;
  return { link, campaign };
}

router.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const r = await resolve(req.params.token);
    if (!r) {
      res.status(404).json({ error: 'Share link not found' });
      return;
    }
    res.json({ campaign: { name: r.campaign.name }, valid: true });
  }),
);

router.get(
  '/:token/elements',
  asyncHandler(async (req, res) => {
    const r = await resolve(req.params.token);
    if (!r) {
      res.status(404).json({ error: 'Share link not found' });
      return;
    }
    // Hard-coded visibility filter — only published, non-deleted elements.
    const filter: Record<string, unknown> = {
      campaignId: r.campaign._id,
      deletedAt: null,
      playerVisible: true,
    };
    if (req.query.type) filter.type = req.query.type;
    const els = await Element.find(filter).sort({ type: 1, name: 1 });
    res.json({ elements: els.map((e) => sharedElement(e as ElementDoc)) });
  }),
);

router.get(
  '/:token/elements/:id',
  asyncHandler(async (req, res) => {
    const r = await resolve(req.params.token);
    if (!r || !isValidObjectId(req.params.id)) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const el = await Element.findOne({
      _id: req.params.id,
      campaignId: r.campaign._id,
      deletedAt: null,
      playerVisible: true,
    });
    if (!el) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json({ element: sharedElement(el as ElementDoc) });
  }),
);

export default router;
