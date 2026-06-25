import { RequestHandler } from 'express';
import { isValidObjectId } from 'mongoose';
import { Campaign } from '../models/Campaign';
import { Membership, type MembershipRole } from '../models/Membership';

const ROLE_RANK: Record<MembershipRole, number> = { viewer: 0, editor: 1, owner: 2 };

/** True if `role` meets or exceeds `min` in the owner>editor>viewer hierarchy. */
export function roleAtLeast(role: MembershipRole, min: MembershipRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/**
 * Authorize the current user against the campaign in `:cid`. Loads the campaign
 * and the user's Membership, enforces a minimum role, and attaches
 * `req.campaign` / `req.membership` for downstream handlers.
 *
 * Role gates are already correct for Phase 2 (editor/viewer invites) even though
 * Phase 1 only ever creates `owner` memberships.
 */
export function requireCampaignAccess(
  minRole: MembershipRole = 'viewer',
  opts: { allowDeleted?: boolean } = {},
): RequestHandler {
  return async (req, res, next) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }
      const cid = req.params.cid;
      if (!isValidObjectId(cid)) {
        res.status(404).json({ error: 'Campaign not found' });
        return;
      }
      const filter = opts.allowDeleted ? { _id: cid } : { _id: cid, deletedAt: null };
      const campaign = await Campaign.findOne(filter);
      if (!campaign) {
        res.status(404).json({ error: 'Campaign not found' });
        return;
      }
      const membership = await Membership.findOne({ campaignId: cid, userId });
      if (!membership || ROLE_RANK[membership.role as MembershipRole] < ROLE_RANK[minRole]) {
        res.status(403).json({ error: 'You do not have access to this campaign' });
        return;
      }
      req.campaign = campaign;
      req.membership = membership;
      next();
    } catch (err) {
      next(err);
    }
  };
}
