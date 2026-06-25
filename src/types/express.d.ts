import 'express';
import type { CampaignDoc } from '../models/Campaign';
import type { MembershipDoc } from '../models/Membership';

declare global {
  namespace Express {
    interface Request {
      /** Set by requireCampaignAccess once membership is verified. */
      campaign?: CampaignDoc;
      membership?: MembershipDoc;
    }
  }
}
