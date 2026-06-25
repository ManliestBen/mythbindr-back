/** Recursively collect text from a ProseMirror/TipTap JSON node. */
function pmText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { text?: unknown; content?: unknown };
  let out = typeof n.text === 'string' ? n.text : '';
  if (Array.isArray(n.content)) out += ' ' + n.content.map(pmText).join(' ');
  return out;
}

/**
 * Derive a plaintext representation of an element body for the search index.
 * Handles both a plain string (Slice 1) and ProseMirror JSON (Slice 2+).
 */
export function deriveBodyText(body: unknown): string {
  if (typeof body === 'string') return body.replace(/\s+/g, ' ').trim();
  if (body && typeof body === 'object') return pmText(body).replace(/\s+/g, ' ').trim();
  return '';
}
