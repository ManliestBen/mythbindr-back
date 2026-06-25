# MythBindr — Backend

Express + TypeScript API for MythBindr (passkey auth, MongoDB; real-time + integrations planned).

MythBindr is split across **two repos that together make up the app** — this is the
**back end**:

- **Backend (this repo):** Express API — passkey auth, sessions, MongoDB.
- **Frontend:** [ManliestBen/mythbindr-front](https://github.com/ManliestBen/mythbindr-front) — React + Vite client (passkey UI, theming, app shell).
- **Product plan & feature catalog:** see [`PLAN.md`](https://github.com/ManliestBen/mythbindr-front/blob/main/PLAN.md) in the frontend repo.

**Auth status:** passkey (WebAuthn) auth is **implemented and working end-to-end** with the
frontend — usernameless register / login / logout, sessions in MongoDB, first-user-admin
bootstrap. See [Endpoints](#endpoints).

## Stack

- Node + Express + TypeScript, MongoDB via Mongoose
- Passkeys via [SimpleWebAuthn](https://simplewebauthn.dev/), `express-session` + `connect-mongo`
- Socket.IO for real-time co-editing (planned)

## Develop

```bash
npm install
npm run dev        # tsx watch -> http://localhost:4000
npm run db:check   # verify the MongoDB connection
```

Requires a `.env` (copy from `.env.example`). The frontend dev server proxies
`/api` and `/socket.io` to `http://localhost:4000`.

## Deploy on a Raspberry Pi

```bash
npm ci
npm run build      # tsc -> dist/
npm start          # node dist/index.js
```

- Node 20+ recommended.
- Keep it alive with **pm2** (`pm2 start dist/index.js --name mythbindr-back`)
  or a **systemd** service.
- Production `.env`: `NODE_ENV=production`, `MONGODB_URI`, `SESSION_SECRET`,
  `CLIENT_ORIGIN=https://<your-netlify-domain>`, and `RP_ID` / `RP_ORIGIN` set
  to the **client** domain (where the passkey ceremony runs).
- Put it behind a reverse proxy (Caddy/Nginx) with TLS, or expose it via the
  Netlify `/api` proxy. Cross-site session cookies need `SameSite=None; Secure`
  (already handled when `NODE_ENV=production`).

## Endpoints

- `GET /api/health`

**Passkey auth** — ✅ implemented & working end-to-end with the frontend:
- `POST /api/auth/register/options` · `POST /api/auth/register/verify`
- `POST /api/auth/login/options` · `POST /api/auth/login/verify`
- `POST /api/auth/logout` · `GET /api/auth/me` · `PATCH /api/auth/me`

**Spotify integration** (`/api/integrations/spotify`) — ✅ working; **admin-only**
(OAuth 2.0, tokens encrypted at rest; see [`docs/spotify-setup.md`](docs/spotify-setup.md)):
- `GET /login` — redirect the GM to Spotify's consent screen (signed `state`)
- `GET /callback` — OAuth callback: exchanges the code, stores encrypted tokens, records Premium tier
- `GET /status` — connection + Premium status
- `GET /token` — short-lived access token for the browser Web Playback SDK
- `POST /disconnect` — forget the stored Spotify tokens
