import { Router } from 'express';
import mongoose from 'mongoose';
import { Campaign, publicCampaign, type CampaignDoc } from '../models/Campaign';
import { Element } from '../models/Element';
import { Membership } from '../models/Membership';
import { asyncHandler, requireAuth } from '../auth/middleware';
import { validate } from '../lib/validate';
import { campaignCreateSchema, campaignUpdateSchema } from '../schemas/campaign';
import { requireCampaignAccess } from './access';

const router = Router();

// Every campaign route requires a logged-in user.
router.use(requireAuth);

// ── List my campaigns (via membership) ─────────────────────────────────────
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const memberships = await Membership.find({ userId: req.session.userId });
    const ids = memberships.map((m) => m.campaignId);
    const campaigns = await Campaign.find({ _id: { $in: ids }, deletedAt: null }).sort({
      updatedAt: -1,
    });
    res.json({ campaigns: campaigns.map((c) => publicCampaign(c as CampaignDoc)) });
  }),
);

// ── Create (creator becomes owner) ─────────────────────────────────────────
router.post(
  '/',
  validate(campaignCreateSchema),
  asyncHandler(async (req, res) => {
    const campaign = await Campaign.create({
      ...req.body,
      ownerId: req.session.userId,
      updatedBy: req.session.userId,
    });
    await Membership.create({
      campaignId: campaign._id,
      userId: req.session.userId,
      role: 'owner',
    });
    res.status(201).json({ campaign: publicCampaign(campaign as CampaignDoc) });
  }),
);

// ── Read one ───────────────────────────────────────────────────────────────
router.get('/:cid', requireCampaignAccess('viewer'), (req, res) => {
  res.json({ campaign: publicCampaign(req.campaign as CampaignDoc) });
});

// ── Update ─────────────────────────────────────────────────────────────────
router.patch(
  '/:cid',
  requireCampaignAccess('editor'),
  validate(campaignUpdateSchema),
  asyncHandler(async (req, res) => {
    const updated = await Campaign.findByIdAndUpdate(
      req.params.cid,
      { $set: { ...req.body, updatedBy: req.session.userId }, $inc: { version: 1 } },
      { new: true },
    );
    res.json({ campaign: updated ? publicCampaign(updated as CampaignDoc) : null });
  }),
);

// ── Soft-delete to trash ───────────────────────────────────────────────────
router.delete(
  '/:cid',
  requireCampaignAccess('owner'),
  asyncHandler(async (req, res) => {
    await Campaign.findByIdAndUpdate(req.params.cid, { $set: { deletedAt: new Date() } });
    res.json({ ok: true });
  }),
);

// ── Restore from trash ─────────────────────────────────────────────────────
router.post(
  '/:cid/restore',
  requireCampaignAccess('owner', { allowDeleted: true }),
  asyncHandler(async (req, res) => {
    const updated = await Campaign.findByIdAndUpdate(
      req.params.cid,
      { $set: { deletedAt: null } },
      { new: true },
    );
    res.json({ campaign: updated ? publicCampaign(updated as CampaignDoc) : null });
  }),
);

// ── Duplicate as a template (campaign fields only; elements copied later) ───
router.post(
  '/:cid/duplicate',
  requireCampaignAccess('viewer'),
  asyncHandler(async (req, res) => {
    const src = req.campaign as CampaignDoc;
    const copy = await Campaign.create({
      name: `${src.name} (Copy)`,
      hook: src.hook,
      premise: src.premise,
      tone: src.tone,
      startLevel: src.startLevel,
      endLevel: src.endLevel,
      settingName: src.settingName,
      storySoFar: src.storySoFar,
      moodSlots: src.moodSlots,
      ownerId: req.session.userId,
      updatedBy: req.session.userId,
    });
    await Membership.create({
      campaignId: copy._id,
      userId: req.session.userId,
      role: 'owner',
    });
    res.status(201).json({ campaign: publicCampaign(copy as CampaignDoc) });
  }),
);

// ── Dashboard: element counts by type + recent edits + story-so-far ────────
router.get(
  '/:cid/dashboard',
  requireCampaignAccess('viewer'),
  asyncHandler(async (req, res) => {
    const cid = req.params.cid;
    const grouped = await Element.aggregate<{ _id: string; count: number }>([
      { $match: { campaignId: new mongoose.Types.ObjectId(cid), deletedAt: null } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]);
    const counts: Record<string, number> = {};
    for (const g of grouped) counts[g._id] = g.count;

    const recent = await Element.find({ campaignId: cid, deletedAt: null })
      .sort({ updatedAt: -1 })
      .limit(8)
      .select('type name updatedAt');

    res.json({
      counts,
      recent: recent.map((r) => ({
        id: String(r._id),
        type: r.type,
        name: r.name,
        updatedAt: r.updatedAt,
      })),
      storySoFar: (req.campaign as CampaignDoc).storySoFar,
    });
  }),
);

// ── Global search (text index on name + bodyText; type/tag filters) ────────
router.get(
  '/:cid/search',
  requireCampaignAccess('viewer'),
  asyncHandler(async (req, res) => {
    const { q, type, tag } = req.query as Record<string, string | undefined>;
    const filter: Record<string, unknown> = { campaignId: req.params.cid, deletedAt: null };
    if (type) filter.type = type;
    if (tag) filter.tags = tag;
    if (q) filter.$text = { $search: q };

    const query = Element.find(
      filter,
      q ? { score: { $meta: 'textScore' } } : undefined,
    ).limit(50);
    query.sort(q ? { score: { $meta: 'textScore' } } : { updatedAt: -1 });
    const els = await query;

    res.json({
      results: els.map((e) => ({ id: String(e._id), type: e.type, name: e.name })),
    });
  }),
);

export default router;
