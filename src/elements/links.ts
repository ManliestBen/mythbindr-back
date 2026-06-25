import { isValidObjectId } from 'mongoose';

/** Collect mention-node ids from a ProseMirror/TipTap JSON body. */
function walk(node: unknown, out: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  const n = node as { type?: unknown; attrs?: { id?: unknown }; content?: unknown };
  if (n.type === 'mention' && n.attrs && typeof n.attrs.id === 'string') {
    out.add(n.attrs.id);
  }
  if (Array.isArray(n.content)) n.content.forEach((c) => walk(c, out));
}

export function extractMentionIds(body: unknown): string[] {
  const out = new Set<string>();
  walk(body, out);
  return [...out].filter((id) => isValidObjectId(id));
}

/** Build `links[]` entries (source: 'mention') from the mentions in a body. */
export function mentionLinks(body: unknown) {
  return extractMentionIds(body).map((id) => ({
    targetId: id,
    relType: '',
    source: 'mention' as const,
  }));
}

/** Build `links[]` entries (source: 'relationship') from typed form relationships. */
export function relationshipLinks(rels: unknown) {
  if (!Array.isArray(rels)) return [];
  return rels
    .filter(
      (r): r is { targetId: string; relType?: string } =>
        !!r &&
        typeof r === 'object' &&
        typeof (r as { targetId?: unknown }).targetId === 'string' &&
        isValidObjectId((r as { targetId: string }).targetId),
    )
    .map((r) => ({ targetId: r.targetId, relType: r.relType ?? '', source: 'relationship' as const }));
}
