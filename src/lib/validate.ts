import { RequestHandler } from 'express';
import { z } from 'zod';

/**
 * Validate `req.body` against a zod schema. On success the parsed (and defaulted)
 * value replaces `req.body`; on failure responds 400 with structured issues that
 * the frontend's react-hook-form resolver can surface per field.
 */
export const validate =
  (schema: z.ZodTypeAny): RequestHandler =>
  (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', issues: result.error.issues });
      return;
    }
    req.body = result.data;
    next();
  };
