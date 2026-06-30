# Spotify Integration — Setup Guide

MythBindr uses Spotify to let a GM attach soundtracks to scenes and control playback
during a session (see PLAN.md §5.12a). This guide walks through creating the Spotify
app and configuring the credentials.

## TL;DR

- It's **OAuth 2.0**, not a single API key. You'll get a **Client ID** + **Client Secret**.
- Each GM connects **their own** Spotify account inside MythBindr.
- **In-app playback requires Spotify Premium** — this is a Spotify rule (the Web Playback
  SDK refuses to stream for free accounts). Free accounts can still browse/search and
  control playback on other devices in a limited way, but the in-app player needs Premium.
- Credentials live in `.env` (never committed). The **Client Secret stays on the
  server** — it is never shipped to the browser.

---

## 1. Create a Spotify app

1. Go to the **Spotify Developer Dashboard**: https://developer.spotify.com/dashboard
2. Log in with any Spotify account and accept the Developer Terms.
3. Click **Create app**. Fill in:
   - **App name:** `MythBindr` (or `MythBindr (dev)` for local)
   - **App description:** anything, e.g. "D&D session ambiance and playback"
   - **Redirect URIs:** add the callback URL(s) — see step 2 below
   - **Which API/SDKs are you planning to use?** check **Web API** and **Web Playback SDK**
4. Save. On the app's **Settings** page you'll see the **Client ID** and a button to
   **View client secret**.

## 2. Configure Redirect URIs

The redirect URI is where Spotify sends the user back after they authorize. It must match
**exactly** (scheme, host, port, path) what the server sends.

Add these in the dashboard under **Settings → Redirect URIs**:

| Environment | Redirect URI |
|---|---|
| Local dev | `http://127.0.0.1:4000/api/integrations/spotify/callback` |
| Production | `https://<your-api-domain>/api/integrations/spotify/callback` |

> **Use `127.0.0.1`, not `localhost`, for local dev.** Spotify now requires the explicit
> loopback IP for new apps; `http://localhost` redirect URIs are rejected. (Loopback HTTP
> is the only non-HTTPS redirect Spotify allows.)
>
> The production redirect URL is on your own domain (e.g.
> `https://mythbindr.benmanley.biz/api/integrations/spotify/callback`) — the API handles the
> OAuth code exchange, served same-origin behind Caddy (see `docs/deploy/`).

## 3. Required OAuth scopes

MythBindr requests these scopes when a GM connects:

| Scope | Why |
|---|---|
| `streaming` | Play audio via the Web Playback SDK |
| `user-read-email`, `user-read-private` | Required by the Web Playback SDK; also confirms Premium |
| `user-modify-playback-state` | Play / pause / skip / set volume |
| `user-read-playback-state` | Read what's currently playing + device list |
| `user-read-currently-playing` | Show the now-playing track |
| `playlist-read-private`, `playlist-read-collaborative` | Browse the GM's playlists to assign soundtracks |

## 4. Add credentials to `.env`

Copy the Client ID and Client Secret into `.env` (already gitignored):

```dotenv
# ── Spotify integration ─────────────────────────────────
SPOTIFY_CLIENT_ID=your_client_id_here
SPOTIFY_CLIENT_SECRET=your_client_secret_here
SPOTIFY_REDIRECT_URI=http://127.0.0.1:4000/api/integrations/spotify/callback
```

The placeholders are already present in `.env` and documented in
`.env.example`. Just paste your real values over the placeholders. **Restart the
server** after editing `.env`.

## 5. How the flow works (reference)

1. GM clicks **Connect Spotify** (Settings → Integrations).
2. Browser → `GET /api/integrations/spotify/login` → server redirects to Spotify's
   authorize page with the scopes above and a signed `state` (CSRF protection).
3. GM approves → Spotify redirects to the **callback** with a `code`.
4. **Server** exchanges the `code` for an **access token** + **refresh token** (using the
   Client Secret), stores them encrypted on the `User`, and records whether the account is
   Premium (`productTier`).
5. The browser gets a short-lived access token to initialize the **Web Playback SDK**,
   which registers a "MythBindr" device. The server refreshes tokens automatically as they
   expire.

## 6. Production checklist (at deploy)

- [ ] Add the production redirect URI to the Spotify dashboard.
- [ ] Set `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` / `SPOTIFY_REDIRECT_URI` in the
      API's `.env` on the Pi (injected via `env_file`; see `docs/deploy/`).
- [ ] If you expect more than 25 distinct Spotify users, request a **quota extension**
      (move the app out of Development Mode) in the dashboard — otherwise only allow-listed
      users can connect.
- [ ] Confirm the GM account used for playback is **Premium**.

## Troubleshooting

- **`INVALID_CLIENT: Invalid redirect URI`** — the URI sent doesn't byte-for-byte match a
  registered one (check `http` vs `https`, trailing slash, `127.0.0.1` vs `localhost`, port).
- **Playback fails / "premium required"** — the connected account isn't Premium, or the
  `streaming` scope wasn't granted (disconnect and reconnect to re-consent).
- **Users can't connect in production** — the app is still in Development Mode; add them to
  the user allow-list or request a quota extension.
