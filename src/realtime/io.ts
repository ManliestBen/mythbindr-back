import { Server } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { isValidObjectId } from 'mongoose';
import { env } from '../lib/env';
import { createSessionMiddleware } from '../lib/session';
import { Element } from '../models/Element';
import { Membership, type MembershipRole } from '../models/Membership';
import { User } from '../models/User';
import { roleAtLeast } from '../campaigns/access';
import { applyUpdate, joinRoom, leaveRoom } from './yElement';

/** Normalize socket.io binary payloads (Buffer/ArrayBuffer/typed array) to Uint8Array. */
function toU8(d: unknown): Uint8Array {
  if (d instanceof Uint8Array) return d;
  if (d instanceof ArrayBuffer) return new Uint8Array(d);
  if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
  return new Uint8Array(0);
}

interface SessionReq {
  session?: { userId?: string };
}

let io: Server | null = null;

export function getIO(): Server | null {
  return io;
}

export function initRealtime(server: HttpServer): Server {
  io = new Server(server, { cors: { origin: env.clientOrigin, credentials: true } });

  // Reuse the exact express-session middleware so sockets share the web session.
  const sessionMw = createSessionMiddleware();
  io.engine.use((req: unknown, res: unknown, next: () => void) =>
    (sessionMw as (a: unknown, b: unknown, c: () => void) => void)(req, res, next),
  );

  io.use((socket, next) => {
    const userId = (socket.request as unknown as SessionReq).session?.userId;
    if (!userId) {
      next(new Error('unauthorized'));
      return;
    }
    next();
  });

  io.on('connection', (socket) => {
    const userId = (socket.request as unknown as SessionReq).session!.userId!;

    socket.on('element:join', async ({ elementId }: { elementId: string }) => {
      if (!(await canAccessElement(userId, elementId, 'viewer'))) return;
      const room = `el:${elementId}`;
      socket.data.userId = userId;
      socket.data.displayName = await userName(userId);
      socket.data.room = room;
      await socket.join(room);
      await emitPresence(room);
    });

    socket.on('element:leave', async ({ elementId }: { elementId: string }) => {
      const room = `el:${elementId}`;
      await socket.leave(room);
      await emitPresence(room);
    });

    // ── Yjs CRDT co-editing (editor-only) ──────────────────────────────────
    const yrooms = new Set<string>();

    socket.on('yjs:join', async ({ elementId }: { elementId: string }) => {
      if (!(await canAccessElement(userId, elementId, 'editor'))) return;
      await socket.join(`y:${elementId}`);
      yrooms.add(elementId);
      const { state, seedFrom } = await joinRoom(elementId, socket.id);
      socket.emit('yjs:init', { elementId, state, seedFrom });
    });

    socket.on('yjs:update', ({ elementId, update }: { elementId: string; update: unknown }) => {
      if (!yrooms.has(elementId)) return;
      const u = toU8(update);
      applyUpdate(elementId, u);
      socket.to(`y:${elementId}`).emit('yjs:update', { elementId, update: u });
    });

    socket.on('yjs:awareness', ({ elementId, update }: { elementId: string; update: unknown }) => {
      if (!yrooms.has(elementId)) return;
      socket.to(`y:${elementId}`).emit('yjs:awareness', { elementId, update: toU8(update) });
    });

    socket.on('yjs:leave', ({ elementId }: { elementId: string }) => {
      yrooms.delete(elementId);
      void socket.leave(`y:${elementId}`);
      leaveRoom(elementId, socket.id);
    });

    socket.on('disconnect', async () => {
      for (const elementId of yrooms) leaveRoom(elementId, socket.id);
      const room = socket.data.room as string | undefined;
      if (room) await emitPresence(room);
    });
  });

  return io;
}

/** Broadcast the unique set of participants (by user) in a room. */
async function emitPresence(room: string): Promise<void> {
  if (!io) return;
  const sockets = await io.in(room).fetchSockets();
  const byUser = new Map<string, string>();
  for (const s of sockets) {
    const uid = s.data.userId as string | undefined;
    if (uid) byUser.set(uid, (s.data.displayName as string) ?? 'GM');
  }
  const participants = [...byUser.entries()].map(([userId, displayName]) => ({
    userId,
    displayName,
  }));
  io.to(room).emit('presence', { participants });
}

async function canAccessElement(
  userId: string,
  elementId: string,
  min: MembershipRole,
): Promise<boolean> {
  if (!isValidObjectId(elementId)) return false;
  const el = await Element.findById(elementId).select('campaignId');
  if (!el) return false;
  const m = await Membership.findOne({ campaignId: el.campaignId, userId });
  return !!m && roleAtLeast(m.role as MembershipRole, min);
}

async function userName(userId: string): Promise<string> {
  const u = await User.findById(userId).select('displayName');
  return u?.displayName ?? 'GM';
}
