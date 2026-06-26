import mongoose from 'mongoose';
import { connectToDatabase } from '../lib/db';
import { SrdResource } from '../models/SrdResource';

// Every Open5e v1 collection — we pull EVERYTHING.
const ENDPOINTS = [
  'spells',
  'spelllist',
  'monsters',
  'documents',
  'backgrounds',
  'planes',
  'sections',
  'feats',
  'conditions',
  'races',
  'classes',
  'magicitems',
  'weapons',
  'armor',
];

const BASE = 'https://api.open5e.com/v1';
const PAGE = 500;
const DELAY_MS = 300; // be polite to the public API

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseCR(v: unknown): number | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (s.includes('/')) {
    const [a, b] = s.split('/').map(Number);
    return b ? a / b : undefined;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toDoc(category: string, item: any) {
  const slug: string = item.slug || item.key || String(item.name ?? '').toLowerCase().replace(/\s+/g, '-');
  const classes =
    typeof item.dnd_class === 'string'
      ? item.dnd_class.split(',').map((c: string) => c.trim()).filter(Boolean)
      : [];
  return {
    category,
    slug,
    name: item.name || item.title || slug,
    cr: parseCR(item.challenge_rating),
    hp: num(item.hit_points),
    ac: num(item.armor_class),
    size: str(item.size),
    type: str(item.type),
    level: num(item.level_int),
    school: str(item.school),
    rarity: str(item.rarity),
    classes,
    desc: str(item.desc),
    data: item,
  };
}

async function seedEndpoint(endpoint: string): Promise<number> {
  let next: string | null = `${BASE}/${endpoint}/?limit=${PAGE}`;
  let total = 0;
  while (next) {
    const res: Response = await fetch(next);
    if (!res.ok) throw new Error(`${endpoint}: ${next} → ${res.status}`);
    const body: any = await res.json();
    const items: any[] = body.results ?? [];
    if (items.length) {
      const ops = items.map((item) => {
        const doc = toDoc(endpoint, item);
        return {
          updateOne: {
            filter: { category: endpoint, slug: doc.slug },
            update: { $set: doc },
            upsert: true,
          },
        };
      });
      await SrdResource.bulkWrite(ops, { ordered: false });
      total += items.length;
    }
    process.stdout.write(`\r  ${endpoint}: ${total}/${body.count ?? '?'}   `);
    next = body.next;
    if (next) await sleep(DELAY_MS);
  }
  process.stdout.write('\n');
  return total;
}

async function main(): Promise<void> {
  await connectToDatabase();
  console.log('Seeding SRD resources from Open5e v1 …');
  let grand = 0;
  for (const endpoint of ENDPOINTS) {
    try {
      const n = await seedEndpoint(endpoint);
      grand += n;
    } catch (err) {
      console.error(`\n  ! ${endpoint} failed:`, (err as Error).message);
    }
  }
  const counts = await SrdResource.aggregate([
    { $group: { _id: '$category', count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  console.log(`\nDone. ${grand} fetched. Stored by category:`);
  for (const c of counts) console.log(`  ${c._id}: ${c.count}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
