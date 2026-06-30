import http from 'http';
import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { initRealtime, getIO } from './realtime/io';
import { env } from './lib/env';
import { connectToDatabase, disconnectFromDatabase } from './lib/db';
import { createSessionMiddleware } from './lib/session';
import authRoutes from './auth/routes';
import spotifyRoutes from './integrations/spotify/routes';
import campaignRoutes from './campaigns/routes';
import elementRoutes from './elements/routes';
import collabRoutes from './collab/routes';
import inviteRoutes from './invites/routes';
import shareRoutes from './share/routes';
import sessionRoutes from './sessions/routes';
import srdRoutes from './srd/routes';
import { globalAiRoutes, scopedAiRoutes } from './ai/routes';

async function main(): Promise<void> {
  await connectToDatabase();
  console.log(`✓ Connected to MongoDB (db: ${mongoose.connection.name})`);

  const app = express();
  if (env.nodeEnv === 'production') {
    app.set('trust proxy', 1); // honor X-Forwarded-Proto for Secure cookies
  }
  app.use(cors({ origin: env.clientOrigin, credentials: true }));
  app.use(express.json());
  app.use(createSessionMiddleware());

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      dbName: mongoose.connection.name,
      env: env.nodeEnv,
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/integrations/spotify', spotifyRoutes);
  app.use('/api/campaigns', campaignRoutes);
  app.use('/api/campaigns/:cid/elements', elementRoutes);
  app.use('/api/campaigns/:cid', collabRoutes);
  app.use('/api/campaigns/:cid', sessionRoutes);
  app.use('/api/campaigns/:cid/ai', scopedAiRoutes);
  app.use('/api/ai', globalAiRoutes);
  app.use('/api/invites', inviteRoutes);
  app.use('/api/srd', srdRoutes);
  app.use('/api/share', shareRoutes); // public — no auth

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  };
  app.use(errorHandler);

  const server = http.createServer(app);
  initRealtime(server);
  server.listen(env.port, () => {
    console.log(`✓ Server listening on http://localhost:${env.port}`);
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────
  // Docker/systemd send SIGTERM on stop/restart. Stop accepting connections,
  // drain Socket.IO clients, then close the DB. A timeout guards a hung close.
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received — shutting down gracefully…`);

    const forceExit = setTimeout(() => {
      console.error('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    const finish = async (): Promise<void> => {
      try {
        await disconnectFromDatabase();
        console.log('✓ Closed server and database connection');
        process.exit(0);
      } catch (err) {
        console.error('Error during shutdown:', err);
        process.exit(1);
      }
    };

    const io = getIO();
    if (io) {
      // io.close() also closes the underlying HTTP server once clients drain.
      io.close(() => void finish());
    } else {
      server.close(() => void finish());
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
