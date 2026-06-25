import { Router } from 'express';
import { env } from '../../lib/env';
import { User } from '../../models/User';
import { asyncHandler, requireAdmin } from '../../auth/middleware';
import {
  signState,
  verifyState,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  fetchProfile,
  storeConnection,
  getValidAccessToken,
  disconnect,
} from './spotify';

const router = Router();

/** Browser landing spot after the OAuth round-trip (Settings → Integrations). */
const settingsUrl = (query: string): string =>
  `${env.clientOrigin}/settings?${query}`;

// ── Begin OAuth: redirect the GM to Spotify's authorize page ───────────────
// Hit as a top-level navigation through the dev proxy, so the session cookie is
// present and requireAdmin can identify the user.
router.get('/login', requireAdmin, (req, res) => {
  if (!env.spotify.configured) {
    res.status(503).send('Spotify integration is not configured on the server.');
    return;
  }
  const state = signState(String(req.session.userId));
  res.redirect(buildAuthorizeUrl(state));
});

// ── OAuth callback ─────────────────────────────────────────────────────────
// Spotify redirects the browser here directly (no session cookie). The user is
// identified from the signed `state`, then we exchange the code for tokens.
// Not admin-gated at this route (there's no session to check); the gate is on
// `/login`, which is admin-only — so only an admin can mint a valid `state` and
// reach a successful callback.
router.get(
  '/callback',
  asyncHandler(async (req, res) => {
    const { code, state, error } = req.query as Record<string, string | undefined>;
    if (error) {
      return res.redirect(settingsUrl(`spotify=error&reason=${encodeURIComponent(error)}`));
    }
    if (!code || !state) {
      return res.redirect(settingsUrl('spotify=error&reason=missing_params'));
    }
    const userId = verifyState(state);
    if (!userId) {
      return res.redirect(settingsUrl('spotify=error&reason=bad_state'));
    }
    try {
      const tokens = await exchangeCodeForTokens(code);
      const profile = await fetchProfile(tokens.access_token);
      await storeConnection(userId, tokens, profile);
      const tier = profile.product === 'premium' ? 'premium' : 'limited';
      return res.redirect(settingsUrl(`spotify=connected&tier=${tier}`));
    } catch (err) {
      console.error('Spotify callback error:', err);
      return res.redirect(settingsUrl('spotify=error&reason=exchange_failed'));
    }
  }),
);

// ── Connection status (for Settings → Integrations UI) ─────────────────────
router.get(
  '/status',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.session.userId);
    const s = user?.spotify;
    if (!s?.connected) {
      return res.json({ connected: false, configured: env.spotify.configured });
    }
    res.json({
      connected: true,
      configured: env.spotify.configured,
      productTier: s.productTier ?? 'unknown',
      premium: s.productTier === 'premium',
      displayName: s.displayName ?? null,
      spotifyUserId: s.spotifyUserId ?? null,
      connectedAt: s.connectedAt ?? null,
      scope: s.scope ?? null,
    });
  }),
);

// ── Short-lived access token for the browser Web Playback SDK ──────────────
router.get(
  '/token',
  requireAdmin,
  asyncHandler(async (req, res) => {
    if (!env.spotify.configured) {
      return res.status(503).json({ error: 'Spotify integration is not configured' });
    }
    try {
      const result = await getValidAccessToken(String(req.session.userId));
      if (!result) {
        return res.status(409).json({ error: 'Spotify not connected' });
      }
      res.json({ accessToken: result.accessToken, expiresAt: result.expiresAt });
    } catch (err) {
      console.error('Spotify token error:', err);
      res.status(502).json({ error: 'Could not obtain a Spotify access token' });
    }
  }),
);

// ── The GM's playlists (for assigning mood slots) ──────────────────────────
router.get(
  '/playlists',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const result = await getValidAccessToken(String(req.session.userId));
    if (!result) {
      return res.status(409).json({ error: 'Spotify not connected' });
    }
    const r = await fetch('https://api.spotify.com/v1/me/playlists?limit=50', {
      headers: { Authorization: `Bearer ${result.accessToken}` },
    });
    if (!r.ok) {
      return res.status(502).json({ error: 'Could not fetch playlists' });
    }
    const data = (await r.json()) as { items?: { uri: string; name: string }[] };
    res.json({
      playlists: (data.items ?? []).map((p) => ({ uri: p.uri, name: p.name })),
    });
  }),
);

// ── Disconnect ─────────────────────────────────────────────────────────────
router.post(
  '/disconnect',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await disconnect(String(req.session.userId));
    res.json({ ok: true });
  }),
);

export default router;
