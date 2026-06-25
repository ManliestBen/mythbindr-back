import crypto from 'crypto';
import { env } from '../../lib/env';
import { encryptSecret, decryptSecret } from '../../lib/crypto';
import { User } from '../../models/User';

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_ME_URL = 'https://api.spotify.com/v1/me';

// Scopes requested when a GM connects (docs/spotify-setup.md §3).
export const SPOTIFY_SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-modify-playback-state',
  'user-read-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ');

// ── Stateless signed `state` ───────────────────────────────────────────────
// The OAuth callback hits the backend directly (127.0.0.1:4000), bypassing the
// Vite dev proxy, so it does NOT carry the session cookie. We therefore encode
// the user id into a signed `state` value (HMAC over SESSION_SECRET): unforgeable
// CSRF protection that also tells the callback whom to attach the tokens to.
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const stateKey = crypto.scryptSync(env.sessionSecret, 'mythbindr.spotify.state.v1', 32);

export function signState(userId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ u: userId, t: Date.now(), n: crypto.randomBytes(8).toString('hex') }),
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', stateKey).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/** Verify a `state` token and return the user id it carries, or null if invalid/expired. */
export function verifyState(state: string): string | null {
  const [payload, sig] = (state ?? '').split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', stateKey).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { u, t } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof u !== 'string' || typeof t !== 'number') return null;
    if (Date.now() - t > STATE_TTL_MS) return null;
    return u;
  } catch {
    return null;
  }
}

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.spotify.clientId,
    scope: SPOTIFY_SCOPES,
    redirect_uri: env.spotify.redirectUri,
    state,
  });
  return `${SPOTIFY_AUTH_URL}?${params.toString()}`;
}

function basicAuthHeader(): string {
  const creds = `${env.spotify.clientId}:${env.spotify.clientSecret}`;
  return 'Basic ' + Buffer.from(creds).toString('base64');
}

interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  refresh_token?: string;
}

async function postToken(body: URLSearchParams, label: string): Promise<SpotifyTokenResponse> {
  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Spotify ${label} failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as SpotifyTokenResponse;
}

export function exchangeCodeForTokens(code: string): Promise<SpotifyTokenResponse> {
  return postToken(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: env.spotify.redirectUri,
    }),
    'token exchange',
  );
}

export function refreshAccessToken(refreshToken: string): Promise<SpotifyTokenResponse> {
  return postToken(
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    'token refresh',
  );
}

export interface SpotifyProfile {
  id: string;
  display_name: string | null;
  email?: string;
  product?: string; // 'premium' | 'free' | 'open'
}

export async function fetchProfile(accessToken: string): Promise<SpotifyProfile> {
  const res = await fetch(SPOTIFY_ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Spotify profile fetch failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as SpotifyProfile;
}

/** Persist tokens + profile onto the user (access/refresh tokens encrypted at rest). */
export async function storeConnection(
  userId: string,
  tokens: SpotifyTokenResponse,
  profile: SpotifyProfile,
): Promise<void> {
  const update: Record<string, unknown> = {
    'spotify.connected': true,
    'spotify.accessToken': encryptSecret(tokens.access_token),
    'spotify.expiresAt': new Date(Date.now() + tokens.expires_in * 1000),
    'spotify.scope': tokens.scope,
    'spotify.productTier': profile.product ?? 'unknown',
    'spotify.spotifyUserId': profile.id,
    'spotify.displayName': profile.display_name ?? null,
    'spotify.connectedAt': new Date(),
  };
  // On first connect Spotify returns a refresh token; on re-consent it may not.
  if (tokens.refresh_token) {
    update['spotify.refreshToken'] = encryptSecret(tokens.refresh_token);
  }
  await User.updateOne({ _id: userId }, { $set: update });
}

/**
 * Return a currently-valid access token for the user, refreshing via the stored
 * refresh token if the current one is expired (or within 60s of expiring).
 * Returns null if the user isn't connected or has no refresh token to renew with.
 */
export async function getValidAccessToken(
  userId: string,
): Promise<{ accessToken: string; expiresAt: Date } | null> {
  const user = await User.findById(userId);
  const s = user?.spotify;
  if (!s?.connected || !s.accessToken) return null;

  const expiresAt = s.expiresAt ? new Date(s.expiresAt) : new Date(0);
  if (expiresAt.getTime() - Date.now() > 60_000) {
    return { accessToken: decryptSecret(s.accessToken), expiresAt };
  }

  if (!s.refreshToken) return null;
  const refreshed = await refreshAccessToken(decryptSecret(s.refreshToken));
  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
  const update: Record<string, unknown> = {
    'spotify.accessToken': encryptSecret(refreshed.access_token),
    'spotify.expiresAt': newExpiresAt,
    'spotify.scope': refreshed.scope,
  };
  // Spotify occasionally rotates the refresh token; keep the new one if present.
  if (refreshed.refresh_token) {
    update['spotify.refreshToken'] = encryptSecret(refreshed.refresh_token);
  }
  await User.updateOne({ _id: userId }, { $set: update });
  return { accessToken: refreshed.access_token, expiresAt: newExpiresAt };
}

/** Forget all stored Spotify tokens/profile for the user. */
export async function disconnect(userId: string): Promise<void> {
  await User.updateOne(
    { _id: userId },
    {
      $set: { 'spotify.connected': false },
      $unset: {
        'spotify.accessToken': '',
        'spotify.refreshToken': '',
        'spotify.expiresAt': '',
        'spotify.scope': '',
        'spotify.productTier': '',
        'spotify.spotifyUserId': '',
        'spotify.displayName': '',
        'spotify.connectedAt': '',
      },
    },
  );
}
