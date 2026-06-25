import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { env } from './lib/env';
import { connectToDatabase } from './lib/db';
import { createSessionMiddleware } from './lib/session';
import authRoutes from './auth/routes';

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
