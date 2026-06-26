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
  // Spotify OAuth (see docs/spotify-setup.md). Optional: the server boots without
  // it; the integration routes return 503 until clientId/secret are set.
  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID ?? '',
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET ?? '',
    redirectUri:
      process.env.SPOTIFY_REDIRECT_URI ??
      'http://127.0.0.1:4000/api/integrations/spotify/callback',
    configured: Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET),
  },
  // AI assist (PLAN.md §5.14, admin-only). Optional: routes 503 until configured.
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8',
    configured: Boolean(process.env.ANTHROPIC_API_KEY),
  },
} as const;

export type Env = typeof env;
