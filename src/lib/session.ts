import session from 'express-session';
import MongoStore from 'connect-mongo';
import mongoose from 'mongoose';
import { env } from './env';

/**
 * Session middleware backed by the existing Mongo connection. Must be created
 * AFTER connectToDatabase() so the shared client is available.
 */
export function createSessionMiddleware() {
  const isProd = env.nodeEnv === 'production';
  return session({
    name: 'mythbindr.sid',
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ client: mongoose.connection.getClient() }),
    cookie: {
      httpOnly: true,
      // Cross-site in prod (client on Netlify, API elsewhere) needs SameSite=None+Secure.
      sameSite: isProd ? 'none' : 'lax',
      secure: isProd,
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
    },
  });
}
