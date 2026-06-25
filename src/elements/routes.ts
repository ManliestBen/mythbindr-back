import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { Element, publicElement, type ElementDoc } from '../models/Element';
import { asyncHandler } from '../auth/middleware';
import { requireCampaignAccess } from '../campaigns/access';
import { elementRegistry, type ElementType } from '../schemas/elements';
import { deriveBodyText } from './bodyText';
import { mentionLinks, relationshipLinks } from './links';
import { logActivity } from '../models/Activity';

// mergeParams so `:cid` from the mount path (/api/campaigns/:cid/elements) is visible.
const router = Router({ mergeParams: true });

// ── List (filter by type / tag / name query; optionally include trashed) ───
router.get(
  '/',
  requireCampaignAccess('viewer'),
  asyncHandler(async (req, res) => {
    const { type, tag, q, includeDeleted } = req.query as Record<string, string | undefined>;
    const filter: Record<string, unknown> = { campaignId: req.params.cid };
    if (!includeDeleted) filter.deletedAt = null;
    else filter.deletedAt = { $ne: null };
    if (type) filter.type = type;
    if (tag) filter.tags = tag;
    if (q) filter.name = { $regex: q, $options: 'i' };
    const els = await Element.find(filter).sort({ updatedAt: -1 }).limit(500);
    res.json({ elements: els.map((e) => publicElement(e as ElementDoc)) });
  }),
);

// ── Create ─────────────────────────────────────────────────────────────────
router.post(
  '/',
  requireCampaignAccess('editor'),
  asyncHandler(async (req, res) => {
    const type = req.body?.type as ElementType;
    const schemas = elementRegistry[type];
    if (!schemas) {
      res.status(400).json({ error: `Unsupported element type: ${type}` });
      return;
    }
    const parsed = schemas.create.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }
    const b = parsed.data as Record<string, unknown>;
    const el = await Element.create({
      campaignId: req.params.cid,
      type,
      name: b.name,
      body: b.body ?? null,
      bodyText: deriveBodyText(b.body),
      tags: b.tags ?? [],
      playerVisible: b.playerVisible ?? false,
      secrets: b.secrets ?? '',
      soundtrack: b.soundtrack ?? null,
      data: b.data ?? {},
      links: [...relationshipLinks(b.relationships), ...mentionLinks(b.body)],
      updatedBy: req.session.userId,
    });
    void logActivity({
      campaignId: req.params.cid,
      userId: req.session.userId,
      action: 'created',
      elementId: el._id,
      elementType: el.type,
      elementName: el.name,
    });
    res.status(201).json({ element: publicElement(el as ElementDoc) });
  }),
);

// ── Read one ─────────────────────────────────────────────────────────────
router.get(
  '/:id',
  requireCampaignAccess('viewer'),
  asyncHandler(async (req, res) => {
    const el = await findInCampaign(req.params.id, req.params.cid);
    if (!el) {
      res.status(404).json({ error: 'Element not found' });
      return;
    }
    res.json({ element: publicElement(el as ElementDoc) });
  }),
);

// ── Update (type is immutable; validated against the element's own type) ───
router.patch(
  '/:id',
  requireCampaignAccess('editor'),
  asyncHandler(async (req, res) => {
    const el = await findInCampaign(req.params.id, req.params.cid);
    if (!el) {
      res.status(404).json({ error: 'Element not found' });
      return;
    }
    // Optimistic concurrency (last-write-wins guard): reject stale edits.
    const expectedVersion = Number(req.body?.expectedVersion);
    if (!Number.isNaN(expectedVersion) && el.version !== expectedVersion) {
      res.status(409).json({
        error: 'This element was changed by someone else. Reloaded to the latest.',
        element: publicElement(el as ElementDoc),
      });
      return;
    }
    const schemas = elementRegistry[el.type as ElementType];
    if (!schemas) {
      res.status(400).json({ error: `Unsupported element type: ${el.type}` });
      return;
    }
    const parsed = schemas.update.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }
    const b = parsed.data as Record<string, unknown>;
    const $set: Record<string, unknown> = { updatedBy: req.session.userId };
    if (b.name !== undefined) $set.name = b.name;
    if (b.body !== undefined) {
      $set.body = b.body;
      $set.bodyText = deriveBodyText(b.body);
    }
    // Recompute links when body and/or relationships change; preserve the other kind.
    if (b.body !== undefined || b.relationships !== undefined) {
      const existing = (el.links ?? []).map((l) => ({
        targetId: l.targetId,
        relType: l.relType,
        source: l.source,
      }));
      const mention =
        b.body !== undefined
          ? mentionLinks(b.body)
          : existing.filter((l) => l.source === 'mention');
      const rel =
        b.relationships !== undefined
          ? relationshipLinks(b.relationships)
          : existing.filter((l) => l.source === 'relationship');
      $set.links = [...rel, ...mention];
    }
    if (b.tags !== undefined) $set.tags = b.tags;
    if (b.playerVisible !== undefined) $set.playerVisible = b.playerVisible;
    if (b.secrets !== undefined) $set.secrets = b.secrets;
    if (b.soundtrack !== undefined) $set.soundtrack = b.soundtrack;
    if (b.data !== undefined) $set.data = b.data; // whole-subdoc replace

    const updated = await Element.findByIdAndUpdate(
      el._id,
      { $set, $inc: { version: 1 } },
      { new: true },
    );
    void logActivity({
      campaignId: req.params.cid,
      userId: req.session.userId,
      action: 'updated',
      elementId: el._id,
      elementType: el.type,
      elementName: (updated ?? el).name,
    });
    res.json({ element: updated ? publicElement(updated as ElementDoc) : null });
  }),
);

// ── Soft-delete to trash ───────────────────────────────────────────────────
router.delete(
  '/:id',
  requireCampaignAccess('editor'),
  asyncHandler(async (req, res) => {
    const el = await findInCampaign(req.params.id, req.params.cid);
    if (!el) {
      res.status(404).json({ error: 'Element not found' });
      return;
    }
    await Element.findByIdAndUpdate(el._id, { $set: { deletedAt: new Date() } });
    void logActivity({
      campaignId: req.params.cid,
      userId: req.session.userId,
      action: 'deleted',
      elementId: el._id,
      elementType: el.type,
      elementName: el.name,
    });
    res.json({ ok: true });
  }),
);

// ── Restore from trash ─────────────────────────────────────────────────────
router.post(
  '/:id/restore',
  requireCampaignAccess('editor'),
  asyncHandler(async (req, res) => {
    if (!isValidObjectId(req.params.id)) {
      res.status(404).json({ error: 'Element not found' });
      return;
    }
    const updated = await Element.findOneAndUpdate(
      { _id: req.params.id, campaignId: req.params.cid },
      { $set: { deletedAt: null } },
      { new: true },
    );
    if (!updated) {
      res.status(404).json({ error: 'Element not found' });
      return;
    }
    void logActivity({
      campaignId: req.params.cid,
      userId: req.session.userId,
      action: 'restored',
      elementId: updated._id,
      elementType: updated.type,
      elementName: updated.name,
    });
    res.json({ element: publicElement(updated as ElementDoc) });
  }),
);

// ── Backlinks ("Linked from") ──────────────────────────────────────────────
router.get(
  '/:id/backlinks',
  requireCampaignAccess('viewer'),
  asyncHandler(async (req, res) => {
    const el = await findInCampaign(req.params.id, req.params.cid);
    if (!el) {
      res.status(404).json({ error: 'Element not found' });
      return;
    }
    const back = await Element.find({
      campaignId: req.params.cid,
      deletedAt: null,
      'links.targetId': el._id,
    }).sort({ updatedAt: -1 });
    res.json({
      backlinks: back.map((b) => ({ id: String(b._id), type: b.type, name: b.name })),
    });
  }),
);

/** Find a live (or trashed) element scoped to a campaign, guarding bad ids. */
async function findInCampaign(id: string, campaignId: string) {
  if (!isValidObjectId(id)) return null;
  return Element.findOne({ _id: id, campaignId });
}

export default router;
