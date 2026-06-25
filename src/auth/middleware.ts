import { RequestHandler } from 'express';
import { User } from '../models/User';

/** Wrap an async handler so rejections flow to the Express error middleware. */
export const asyncHandler =
  (fn: (...args: Parameters<RequestHandler>) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.session.userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  next();
};

/**
 * Account-level admin gate. Used on all AI routes (PLAN.md §5.14) and any other
 * privileged operation. Never trust the client — this is the real check.
 */
export const requireAdmin: RequestHandler = asyncHandler(async (req, res, next) => {
  if (!req.session.userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  const user = await User.findById(req.session.userId);
  if (!user || !user.isAdmin) {
    res.status(403).json({ error: 'Admin only' });
    return;
  }
  next();
});
