import crypto from 'crypto';

export interface NewCombatant {
  cid: string;
  name: string;
  initiative: number;
  maxHp: number;
  currentHp: number;
  tempHp: number;
  conditions: { name: string; rounds: number | null }[];
  deathSaves: { successes: number; failures: number };
  isPlayer: boolean;
  sourceElementId: string | null;
  notes: string;
}

function blank(name: string): NewCombatant {
  return {
    cid: crypto.randomBytes(8).toString('hex'),
    name,
    initiative: 0,
    maxHp: 0,
    currentHp: 0,
    tempHp: 0,
    conditions: [],
    deathSaves: { successes: 0, failures: 0 },
    isPlayer: false,
    sourceElementId: null,
    notes: '',
  };
}

/**
 * Parse an encounter's freeform combatant list into combatants. Tolerant of
 * "2x Goblin", "2 Goblin", "Goblin x2", or a bare "Bugbear" (count defaults to 1).
 */
export function parseCombatants(text: string | undefined): NewCombatant[] {
  if (!text) return [];
  const out: NewCombatant[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let count = 1;
    let name = line;
    const lead = line.match(/^(\d+)\s*[x×]?\s+(.+)$/i);
    const trail = line.match(/^(.+?)\s*[x×]\s*(\d+)$/i);
    if (lead) {
      count = Number(lead[1]);
      name = lead[2].trim();
    } else if (trail) {
      name = trail[1].trim();
      count = Number(trail[2]);
    }
    count = Math.min(Math.max(count, 1), 30);
    for (let i = 0; i < count; i++) {
      out.push(blank(count > 1 ? `${name} ${i + 1}` : name));
    }
  }
  return out;
}
