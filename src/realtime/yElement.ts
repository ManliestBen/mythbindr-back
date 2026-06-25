import * as Y from 'yjs';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import { Element } from '../models/Element';
import { deriveBodyText } from '../elements/bodyText';
import { mentionLinks } from '../elements/links';

/** One live Yjs document per element being co-edited. */
interface Room {
  doc: Y.Doc;
  sockets: Set<string>;
  saveTimer: ReturnType<typeof setTimeout> | null;
  dirty: boolean;
}

const rooms = new Map<string, Room>();
const SAVE_DEBOUNCE_MS = 2000;
// TipTap Collaboration binds to ydoc.getXmlFragment('default').
const FRAGMENT = 'default';

/**
 * Join (creating if needed) an element's Yjs room. Returns the current doc state
 * and — only for the first joiner of a never-collaborated element — the existing
 * `body` to seed the empty doc from (server controls who seeds, avoiding races).
 */
export async function joinRoom(
  elementId: string,
  socketId: string,
): Promise<{ state: Uint8Array; seedFrom: unknown | null }> {
  const existing = rooms.get(elementId);
  if (existing) {
    existing.sockets.add(socketId);
    return { state: Y.encodeStateAsUpdate(existing.doc), seedFrom: null };
  }

  const doc = new Y.Doc();
  const el = await Element.findById(elementId).select('docState body');
  let seedFrom: unknown | null = null;
  if (el?.docState) {
    Y.applyUpdate(doc, new Uint8Array(el.docState as Buffer));
  } else if (el && el.body != null) {
    seedFrom = el.body; // first joiner seeds the empty doc from the legacy body
  }

  const room: Room = { doc, sockets: new Set([socketId]), saveTimer: null, dirty: false };
  rooms.set(elementId, room);
  doc.on('update', () => {
    room.dirty = true;
    scheduleSave(elementId);
  });

  return { state: Y.encodeStateAsUpdate(doc), seedFrom };
}

export function applyUpdate(elementId: string, update: Uint8Array): void {
  const room = rooms.get(elementId);
  if (room) Y.applyUpdate(room.doc, update);
}

export function leaveRoom(elementId: string, socketId: string): void {
  const room = rooms.get(elementId);
  if (!room) return;
  room.sockets.delete(socketId);
  if (room.sockets.size === 0) void saveRoom(elementId, true);
}

function scheduleSave(elementId: string): void {
  const room = rooms.get(elementId);
  if (!room || room.saveTimer) return;
  room.saveTimer = setTimeout(() => {
    room.saveTimer = null;
    void saveRoom(elementId, false);
  }, SAVE_DEBOUNCE_MS);
}

/**
 * Persist the Yjs binary state AND derive `body` (PM JSON) + `bodyText`, so REST
 * load, search, and the share view keep working off the same element.
 */
async function saveRoom(elementId: string, cleanup: boolean): Promise<void> {
  const room = rooms.get(elementId);
  if (!room) return;
  if (room.dirty) {
    room.dirty = false;
    try {
      const docState = Buffer.from(Y.encodeStateAsUpdate(room.doc));
      const body = yDocToProsemirrorJSON(room.doc, FRAGMENT);
      // Recompute mention links from the new body; preserve typed relationships.
      const current = await Element.findById(elementId).select('links');
      const rel = (current?.links ?? [])
        .filter((l) => l.source === 'relationship')
        .map((l) => ({ targetId: l.targetId, relType: l.relType, source: l.source }));
      await Element.findByIdAndUpdate(elementId, {
        $set: {
          docState,
          body,
          bodyText: deriveBodyText(body),
          links: [...rel, ...mentionLinks(body)],
        },
      });
    } catch (err) {
      console.error('yjs save error:', err);
    }
  }
  if (cleanup && room.sockets.size === 0) {
    if (room.saveTimer) clearTimeout(room.saveTimer);
    room.doc.destroy();
    rooms.delete(elementId);
  }
}
