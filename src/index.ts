import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { env } from './lib/env';
import { connectToDatabase } from './lib/db';
import { createSessionMiddleware } from './lib/session';
import authRoutes from './auth/routes';
import spotifyRoutes from './integrations/spotify/routes';
import campaignRoutes from './campaigns/routes';
import elementRoutes from './elements/routes';
import collabRoutes from './collab/routes';
import inviteRoutes from './invites/routes';

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
  app.use('/api/invites', inviteRoutes);

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  };
  app.use(errorHandler);

  app.listen(env.port, () => {
    console.log(`✓ Server listening on http://localhost:${env.port}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
