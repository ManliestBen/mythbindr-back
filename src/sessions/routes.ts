import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { asyncHandler } from '../auth/middleware';
import { requireCampaignAccess } from '../campaigns/access';
import { validate } from '../lib/validate';
import { GameSession, publicSession, type SessionDoc } from '../models/Session';
import { Element } from '../models/Element';
import { sessionStartSchema, sessionUpdateSchema } from '../schemas/session';
import { parseCombatants } from './combatants';

const router = Router({ mergeParams: true });

// ── Active session (or null) ────────────────────────────────────────────────
router.get(
  '/session',
  requireCampaignAccess('viewer'),
  asyncHandler(async (req, res) => {
    const s = await GameSession.findOne({ campaignId: req.params.cid, status: 'active' }).sort({
      createdAt: -1,
    });
    res.json({ session: s ? publicSession(s as SessionDoc) : null });
  }),
);

// ── Start (returns the existing active session if there is one) ─────────────
router.post(
  '/session',
  requireCampaignAccess('editor'),
  validate(sessionStartSchema),
  asyncHandler(async (req, res) => {
    const existing = await GameSession.findOne({ campaignId: req.params.cid, status: 'active' });
    if (existing) {
      res.json({ session: publicSession(existing as SessionDoc) });
      return;
    }
    let combatants: ReturnType<typeof parseCombatants> = [];
    let sourceEncounterId: unknown = null;
    const seid = req.body?.sourceEncounterId;
    if (seid && isValidObjectId(seid)) {
      const enc = await Element.findOne({
        _id: seid,
        campaignId: req.params.cid,
        type: 'encounter',
        deletedAt: null,
      });
      if (enc) {
        sourceEncounterId = enc._id;
        combatants = parseCombatants((enc.data as { combatants?: string })?.combatants);
      }
    }
    const s = await GameSession.create({
      campaignId: req.params.cid,
      startedBy: req.session.userId,
      sourceEncounterId,
      combatants,
    });
    res.status(201).json({ session: publicSession(s as SessionDoc) });
  }),
);

// ── Replace mutable state (debounced from the client) ──────────────────────
router.patch(
  '/session/:sid',
  requireCampaignAccess('editor'),
  validate(sessionUpdateSchema),
  asyncHandler(async (req, res) => {
    if (!isValidObjectId(req.params.sid)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const $set: Record<string, unknown> = {};
    for (const k of ['round', 'turnIndex', 'combatants', 'log', 'status'] as const) {
      if (req.body[k] !== undefined) $set[k] = req.body[k];
    }
    if ($set.status === 'ended') $set.endedAt = new Date();
    const s = await GameSession.findOneAndUpdate(
      { _id: req.params.sid, campaignId: req.params.cid },
      { $set },
      { new: true },
    );
    if (!s) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ session: publicSession(s as SessionDoc) });
  }),
);

// ── End ─────────────────────────────────────────────────────────────────────
router.post(
  '/session/:sid/end',
  requireCampaignAccess('editor'),
  asyncHandler(async (req, res) => {
    if (!isValidObjectId(req.params.sid)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const s = await GameSession.findOneAndUpdate(
      { _id: req.params.sid, campaignId: req.params.cid },
      { $set: { status: 'ended', endedAt: new Date() } },
      { new: true },
    );
    if (!s) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ session: publicSession(s as SessionDoc) });
  }),
);

// ── Ended-session history ───────────────────────────────────────────────────
router.get(
  '/sessions',
  requireCampaignAccess('viewer'),
  asyncHandler(async (req, res) => {
    const list = await GameSession.find({ campaignId: req.params.cid, status: 'ended' })
      .sort({ endedAt: -1 })
      .limit(20);
    res.json({ sessions: list.map((s) => publicSession(s as SessionDoc)) });
  }),
);

export default router;
