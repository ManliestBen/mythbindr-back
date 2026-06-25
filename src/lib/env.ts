import dotenv from 'dotenv';
import path from 'path';

// Load server/.env regardless of the process cwd.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Set it in server/.env (see server/.env.example).`,
    );
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  mongodbUri: required('MONGODB_URI'),
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-insecure-secret-change-me',
  rp: {
    id: process.env.RP_ID ?? 'localhost',
    name: process.env.RP_NAME ?? 'MythBindr',
    origin: process.env.RP_ORIGIN ?? 'http://localhost:5173',
  },
} as const;

export type Env = typeof env;
