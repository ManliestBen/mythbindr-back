import { Router } from 'express';
import { asyncHandler, requireAuth } from '../auth/middleware';
import { SrdResource, srdDetail, srdListItem, type SrdResourceDoc } from '../models/SrdResource';

// Reference data — requires login, but not campaign-scoped.
const router = Router();
router.use(requireAuth);

// Categories + counts (reference landing).
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const counts = await SrdResource.aggregate<{ _id: string; count: number }>([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    res.json({ categories: counts.map((c) => ({ category: c._id, count: c.count })) });
  }),
);

// List within a category, with filters.
router.get(
  '/:category',
  asyncHandler(async (req, res) => {
    const { category } = req.params;
    const { q, cr, type, level, school, size, rarity, limit } = req.query as Record<
      string,
      string | undefined
    >;
    const filter: Record<string, unknown> = { category };
    if (q) filter.name = { $regex: q, $options: 'i' };
    if (cr !== undefined && cr !== '') filter.cr = Number(cr);
    if (type) filter.type = type;
    if (level !== undefined && level !== '') filter.level = Number(level);
    if (school) filter.school = school;
    if (size) filter.size = size;
    if (rarity) filter.rarity = rarity;
    const lim = Math.min(Number(limit) || 100, 300);
    const [items, count] = await Promise.all([
      SrdResource.find(filter)
        .select('category slug name cr hp ac size type level school rarity classes')
        .sort({ name: 1 })
        .limit(lim),
      SrdResource.countDocuments(filter),
    ]);
    res.json({ count, results: items.map((i) => srdListItem(i as SrdResourceDoc)) });
  }),
);

// Full resource.
router.get(
  '/:category/:slug',
  asyncHandler(async (req, res) => {
    const item = await SrdResource.findOne({
      category: req.params.category,
      slug: req.params.slug,
    });
    if (!item) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json({ resource: srdDetail(item as SrdResourceDoc) });
  }),
);

export default router;
