import { Router } from 'express';
import { asyncHandler, requireAuth } from '../auth/middleware';
import { Campaign } from '../models/Campaign';
import { Invite, inviteIsLive, type InviteDoc } from '../models/Invite';
import { Membership } from '../models/Membership';
import { User } from '../models/User';

// Not campaign-scoped: the accepting user isn't a member yet.
const router = Router();
router.use(requireAuth);

async function loadLiveInvite(token: string) {
  const invite = await Invite.findOne({ token });
  if (!invite || !inviteIsLive(invite as InviteDoc)) return null;
  return invite;
}

// Preview before accepting.
router.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const invite = await loadLiveInvite(req.params.token);
    if (!invite) {
      res.status(404).json({ error: 'Invite not found or no longer valid' });
      return;
    }
    const campaign = await Campaign.findOne({ _id: invite.campaignId, deletedAt: null });
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }
    const inviter = await User.findById(invite.createdBy).select('displayName');
    res.json({
      campaignName: campaign.name,
      role: invite.role,
      inviterName: inviter?.displayName ?? 'A GM',
    });
  }),
);

// Accept — creates the membership (the only path to a non-owner membership).
router.post(
  '/:token/accept',
  asyncHandler(async (req, res) => {
    const invite = await loadLiveInvite(req.params.token);
    if (!invite) {
      res.status(404).json({ error: 'Invite not found or no longer valid' });
      return;
    }
    const campaign = await Campaign.findOne({ _id: invite.campaignId, deletedAt: null });
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }
    const userId = req.session.userId;
    const existing = await Membership.findOne({ campaignId: invite.campaignId, userId });
    if (!existing) {
      await Membership.create({ campaignId: invite.campaignId, userId, role: invite.role });
    }
    invite.usedBy = userId as unknown as typeof invite.usedBy;
    invite.usedAt = new Date();
    await invite.save();
    res.json({ campaignId: String(invite.campaignId) });
  }),
);

export default router;
