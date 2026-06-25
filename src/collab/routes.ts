import { Router, type Request } from 'express';
import crypto from 'crypto';
import { isValidObjectId } from 'mongoose';
import { env } from '../lib/env';
import { asyncHandler } from '../auth/middleware';
import { requireCampaignAccess } from '../campaigns/access';
import { Membership } from '../models/Membership';
import { Invite, type InviteDoc } from '../models/Invite';
import { Activity } from '../models/Activity';
import { ShareLink, type ShareLinkDoc } from '../models/ShareLink';

// mergeParams so `:cid` from /api/campaigns/:cid is available.
const router = Router({ mergeParams: true });

function publicInvite(i: InviteDoc) {
  return {
    id: String(i._id),
    token: i.token,
    role: i.role,
    url: `${env.clientOrigin}/invite/${i.token}`,
    expiresAt: i.expiresAt,
  };
}

// ── Invites (owner-only) ───────────────────────────────────────────────────
router.post(
  '/invites',
  requireCampaignAccess('owner'),
  asyncHandler(async (req, res) => {
    const role = req.body?.role === 'viewer' ? 'viewer' : 'editor';
    const invite = await Invite.create({
      campaignId: req.params.cid,
      token: crypto.randomBytes(24).toString('base64url'),
      role,
      createdBy: req.session.userId,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7), // 7 days
    });
    res.status(201).json({ invite: publicInvite(invite as InviteDoc) });
  }),
);

router.get(
  '/invites',
  requireCampaignAccess('owner'),
  asyncHandler(async (req, res) => {
    const invites = await Invite.find({
      campaignId: req.params.cid,
      revoked: false,
      usedBy: null,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });
    res.json({ invites: invites.map((i) => publicInvite(i as InviteDoc)) });
  }),
);

router.delete(
  '/invites/:inviteId',
  requireCampaignAccess('owner'),
  asyncHandler(async (req, res) => {
    if (!isValidObjectId(req.params.inviteId)) {
      res.status(404).json({ error: 'Invite not found' });
      return;
    }
    await Invite.findOneAndUpdate(
      { _id: req.params.inviteId, campaignId: req.params.cid },
      { $set: { revoked: true } },
    );
    res.json({ ok: true });
  }),
);

// ── Members ────────────────────────────────────────────────────────────────
router.get(
  '/members',
  requireCampaignAccess('viewer'),
  asyncHandler(async (req, res) => {
    const members = await Membership.find({ campaignId: req.params.cid })
      .populate<{ userId: { _id: unknown; displayName: string } }>('userId', 'displayName')
      .sort({ createdAt: 1 });
    res.json({
      members: members.map((m) => ({
        userId: String(m.userId?._id ?? m.userId),
        displayName: m.userId?.displayName ?? 'Unknown',
        role: m.role,
      })),
    });
  }),
);

router.patch(
  '/members/:userId',
  requireCampaignAccess('owner'),
  asyncHandler(async (req, res) => {
    const role = req.body?.role;
    if (!['owner', 'editor', 'viewer'].includes(role)) {
      res.status(400).json({ error: 'Invalid role' });
      return;
    }
    const target = await Membership.findOne({
      campaignId: req.params.cid,
      userId: req.params.userId,
    });
    if (!target) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }
    if (target.role === 'owner' && role !== 'owner' && (await lastOwner(req))) {
      res.status(400).json({ error: 'Cannot demote the last owner' });
      return;
    }
    target.role = role;
    await target.save();
    res.json({ ok: true });
  }),
);

router.delete(
  '/members/:userId',
  requireCampaignAccess('owner'),
  asyncHandler(async (req, res) => {
    const target = await Membership.findOne({
      campaignId: req.params.cid,
      userId: req.params.userId,
    });
    if (!target) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }
    if (target.role === 'owner' && (await lastOwner(req))) {
      res.status(400).json({ error: 'Cannot remove the last owner' });
      return;
    }
    await Membership.deleteOne({ _id: target._id });
    res.json({ ok: true });
  }),
);

// ── Activity feed ──────────────────────────────────────────────────────────
router.get(
  '/activity',
  requireCampaignAccess('viewer'),
  asyncHandler(async (req, res) => {
    const items = await Activity.find({ campaignId: req.params.cid })
      .populate<{ userId: { displayName: string } }>('userId', 'displayName')
      .sort({ createdAt: -1 })
      .limit(30);
    res.json({
      activity: items.map((a) => ({
        id: String(a._id),
        action: a.action,
        elementId: a.elementId ? String(a.elementId) : null,
        elementType: a.elementType ?? null,
        elementName: a.elementName ?? null,
        userName: a.userId?.displayName ?? 'Someone',
        at: a.createdAt,
      })),
    });
  }),
);

// ── Player share links (owner-only) ────────────────────────────────────────
function publicShareLink(s: ShareLinkDoc) {
  return {
    id: String(s._id),
    token: s.token,
    url: `${env.clientOrigin}/share/${s.token}`,
    createdAt: s.createdAt,
  };
}

router.post(
  '/share',
  requireCampaignAccess('owner'),
  asyncHandler(async (req, res) => {
    const link = await ShareLink.create({
      campaignId: req.params.cid,
      token: crypto.randomBytes(24).toString('base64url'),
      createdBy: req.session.userId,
    });
    res.status(201).json({ link: publicShareLink(link as ShareLinkDoc) });
  }),
);

router.get(
  '/share',
  requireCampaignAccess('owner'),
  asyncHandler(async (req, res) => {
    const links = await ShareLink.find({ campaignId: req.params.cid, revoked: false }).sort({
      createdAt: -1,
    });
    res.json({ links: links.map((l) => publicShareLink(l as ShareLinkDoc)) });
  }),
);

router.delete(
  '/share/:linkId',
  requireCampaignAccess('owner'),
  asyncHandler(async (req, res) => {
    if (!isValidObjectId(req.params.linkId)) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    await ShareLink.findOneAndUpdate(
      { _id: req.params.linkId, campaignId: req.params.cid },
      { $set: { revoked: true } },
    );
    res.json({ ok: true });
  }),
);

async function lastOwner(req: Request): Promise<boolean> {
  const owners = await Membership.countDocuments({ campaignId: req.params.cid, role: 'owner' });
  return owners <= 1;
}

export default router;
