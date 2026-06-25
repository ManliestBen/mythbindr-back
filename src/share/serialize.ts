import type { ElementDoc } from '../models/Element';

/**
 * Replace @mention nodes in a ProseMirror body with plain text labels, so the
 * public share view never leaks element ids (existence of hidden elements).
 */
function sanitizeBody(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeBody);
  if (node && typeof node === 'object') {
    const n = node as { type?: unknown; attrs?: { label?: unknown }; content?: unknown };
    if (n.type === 'mention') {
      const label = typeof n.attrs?.label === 'string' ? n.attrs.label : '';
      return { type: 'text', text: `@${label}` };
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(n)) {
      out[k] = k === 'content' ? sanitizeBody((n as Record<string, unknown>)[k]) : (n as Record<string, unknown>)[k];
    }
    return out;
  }
  return node;
}

/**
 * Player-facing serialization. **Whitelist only** — never include `secrets`,
 * `links`, `updatedBy`, or any GM-only field. Used exclusively by /api/share/*.
 */
export function sharedElement(e: ElementDoc) {
  return {
    id: String(e._id),
    type: e.type,
    name: e.name,
    body: sanitizeBody(e.body),
    tags: e.tags,
    data: e.data,
    soundtrack: e.soundtrack,
  };
}
