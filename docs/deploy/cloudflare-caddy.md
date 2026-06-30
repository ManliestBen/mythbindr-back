# Public ingress: Cloudflare Tunnel + Caddy reverse proxy

This puts the apps running on your Pi (see
[raspberry-pi-setup.md](./raspberry-pi-setup.md)) onto the internet — MythBindr at
`mythbindr.benmanley.biz`, and any future app on its own subdomain — **without
opening any ports on your router** and without exposing your home IP address.

```
Browser ──TLS──▶ Cloudflare edge ──encrypted tunnel──▶ cloudflared (on Pi)
                                                            │  http
                                                            ▼
                                                          Caddy  (routing + headers)
   mythbindr.benmanley.biz ──────────────────────────────▶  ├──▶ mythbindr-web:80   (SPA)
                                                            │   └▶ mythbindr-api:4000 (/api, /socket.io)
   other.benmanley.biz ───────────────────────────────────▶  └──▶ other-app:PORT
```

**Why this design**

- **Cloudflare Tunnel** dials *out* from the Pi, so it works behind dynamic IPs
  and CGNAT, and you keep every inbound port closed. Cloudflare terminates TLS.
- **Caddy** is the single internal router: one place to map hostnames/paths to
  each app, set proxy headers, and handle websockets. Adding an app is a few
  lines, not a new tunnel.

> Why both? You *can* point a tunnel straight at one app. Caddy earns its place
> once you have **several** apps — clean host/path routing, shared headers,
> websocket handling, and easy local TLS if you ever drop the tunnel.

---

## Part A — Move the domain onto Cloudflare (registrar stays Bluehost)

You keep `benmanley.biz` **registered** at Bluehost; you just change its
**nameservers** so Cloudflare runs DNS (required for Tunnel + free TLS).

1. Create a free account at <https://dash.cloudflare.com>.
2. **Add a site** → `benmanley.biz` → Free plan. Cloudflare scans existing DNS.
3. Cloudflare shows two nameservers, e.g. `xxx.ns.cloudflare.com`.
4. In **Bluehost** → Domains → `benmanley.biz` → **Nameservers** → *Custom*,
   replace Bluehost's with Cloudflare's two. Save.
5. Wait for Cloudflare to show the domain **Active** (minutes to a few hours).

> ⚠️ Moving nameservers moves **all** DNS for the domain to Cloudflare. If
> Bluehost also hosts your **email** or other records for this domain, re-create
> those records in Cloudflare's DNS first so nothing breaks (MX, TXT/SPF, etc.).

---

## Part B — Create the Tunnel (dashboard / "remotely-managed")

This is the easiest path — the tunnel config and DNS live in Cloudflare; the Pi
only runs the connector with a token.

1. Cloudflare dashboard → **Zero Trust** → **Networks → Tunnels** → **Create a
   tunnel** → **Cloudflared**.
2. Name it `mythpi` → **Save**.
3. On the install screen, choose **Docker**. Copy the **token** from the shown
   command (the long string after `--token`). You only need the token.
4. **Public Hostnames** tab → **Add a public hostname**:

   | Field | Value |
   |-------|-------|
   | Subdomain | `mythbindr` |
   | Domain | `benmanley.biz` |
   | Service type | `HTTP` |
   | URL | `caddy:80` |

   Save. (Each future app gets its own Public Hostname entry the same way — see
   "Hosting multiple apps on different subdomains" below.)

   > The tunnel forwards to **`caddy:80`** — the Caddy container's name on the
   > shared `edge` Docker network. Caddy then routes to the right app by hostname.

Keep that token for Part D.

---

## Part C — Caddy configuration

Create a dedicated stack for the edge (proxy + tunnel), separate from the apps.

```bash
mkdir -p ~/apps/edge && cd ~/apps/edge
```

### `~/apps/edge/Caddyfile`

Because Cloudflare already terminates TLS and the tunnel speaks plain HTTP to
Caddy, run Caddy on **:80 only** and disable its own auto-HTTPS. Caddy routes by
hostname to each app on the `edge` network.

MythBindr is served **same-origin**: the React SPA (`mythbindr-front`) and the
API live under the *same* host, `mythbindr.benmanley.biz`. Caddy serves the static
front-end and proxies API + websocket paths to the API container. Same-origin is
what lets session cookies stay `SameSite=Lax` (simpler and safer than the
cross-site `None` you'd need if the front were on a separate domain like Netlify).

```caddyfile
{
    # Cloudflare does TLS at its edge; the tunnel hands us plain HTTP.
    auto_https off
}

# ── MythBindr (SPA + API, same origin) ──────────────────────────────────────
http://mythbindr.benmanley.biz {
    encode zstd gzip

    # API + realtime → the Node container. reverse_proxy auto-upgrades websockets,
    # so Socket.IO (/socket.io/*) and Yjs co-editing pass through untouched.
    @api path /api/* /socket.io/*
    handle @api {
        reverse_proxy mythbindr-api:4000 {
            header_up X-Forwarded-Proto {http.request.header.X-Forwarded-Proto}
        }
    }

    # Everything else → the static SPA container (built mythbindr-front).
    handle {
        reverse_proxy mythbindr-web:80
    }
}

# ── Add more apps on their own subdomains (see the section below) ───────────
# http://blog.benmanley.biz {
#     reverse_proxy blog:3000
# }
```

Notes:
- **`/socket.io/*` must be routed to the API**, not the SPA. The front uses
  `socket.io-client`, which connects to `/socket.io/` on the same origin; missing
  this rule breaks live co-editing while the rest of the app appears fine.
- The API already runs `app.set('trust proxy', 1)` in production, so it honours
  the forwarded `X-Forwarded-Proto` and issues **Secure** cookies — correct
  behaviour behind Cloudflare + Caddy.
- `RP_ID=mythbindr.benmanley.biz` must equal the host the browser uses, and match
  `RP_ORIGIN` / `CLIENT_ORIGIN` in the API `.env`. Scoping `RP_ID` to this exact
  subdomain keeps passkeys isolated from other apps on sibling subdomains.

### Serving the front-end (`mythbindr-web`)

The front-end is a Vite build — static files. Build it into a tiny static-server
image. Add this `Dockerfile` to **mythbindr-front**:

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
# Vite reads VITE_* at build time. If the client hardcodes an API base URL,
# pass it here; with same-origin relative paths ("/api") you usually need nothing.
RUN npm run build

FROM caddy:2-alpine AS runtime
COPY --from=build /app/dist /usr/share/caddy
# SPA fallback so client-side routes (e.g. /campaigns/123) load index.html.
RUN printf ':80 {\n\troot * /usr/share/caddy\n\ttry_files {path} /index.html\n\tfile_server\n}\n' \
    > /etc/caddy/Caddyfile
```

…and a `docker-compose.yml` in **mythbindr-front** that joins the shared network:

```yaml
services:
  web:
    build: .
    image: mythbindr-web:latest
    container_name: mythbindr-web      # ← matches the Caddyfile target
    restart: unless-stopped
    expose:
      - "80"
    networks:
      - edge

networks:
  edge:
    external: true
```

> Build the front on the Pi (`docker compose up -d --build`) the same way as the
> API. When you adopt the monorepo, this `web` service moves into the single
> root compose alongside `api` — the Caddy routing above doesn't change.

---

## Part D — Compose for Caddy + cloudflared

### `~/apps/edge/.env`
```ini
# Token copied from Part B step 3 (after --token)
TUNNEL_TOKEN=eyJhIjoi...your-long-token...
```

### `~/apps/edge/docker-compose.yml`
```yaml
services:
  caddy:
    image: caddy:2
    container_name: caddy
    restart: unless-stopped
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    networks:
      - edge

  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: cloudflared
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN}
    depends_on:
      - caddy
    networks:
      - edge

networks:
  edge:
    external: true        # shared with each app's compose (created in Pi setup §7)

volumes:
  caddy-data:
  caddy-config:
```

> `cloudflared` needs no published ports — it dials out to Cloudflare. Caddy
> publishes nothing to the host either; it's reached only via the tunnel on the
> internal `edge` network. Your router stays fully closed.

### Bring up the edge stack
```bash
docker network create edge        # no-op if it already exists
cd ~/apps/edge
docker compose up -d
docker compose logs -f cloudflared   # expect "Registered tunnel connection" x4
```

Make sure the API and front-end are also up and on the same network:
```bash
cd ~/apps/mythbindr-back && docker compose up -d
cd ~/apps/mythbindr-front && docker compose up -d --build
docker network inspect edge --format '{{range .Containers}}{{.Name}} {{end}}'
# should list: caddy cloudflared mythbindr-api mythbindr-web
```

---

## Part E — Verify end-to-end

```bash
# From anywhere (uses Cloudflare's public DNS + tunnel + Caddy + app):
curl -s https://mythbindr.benmanley.biz/api/health
# {"status":"ok","db":"connected","env":"production"}
```

Then in a browser:
- `https://mythbindr.benmanley.biz` loads the **SPA** (served by `mythbindr-web`),
  and a deep link like `https://mythbindr.benmanley.biz/campaigns/123` loads too —
  proves the SPA `try_files` fallback works.
- `https://mythbindr.benmanley.biz/api/health` returns JSON over a valid TLS cert.
- Register a **passkey** — works only because the origin is HTTPS and `RP_ID`
  matches `mythbindr.benmanley.biz`.
- Open a campaign element in two tabs and confirm **live co-editing** (Yjs over
  websockets) syncs — proves `/socket.io/*` routing and the websocket upgrade
  survive the tunnel + Caddy.

---

## Hosting multiple apps on different subdomains

This is the payoff of the Cloudflare-Tunnel + Caddy design: every app you add
later gets its own subdomain of `benmanley.biz`, all sharing the **one** tunnel
and the **one** Caddy router. There's no second tunnel, no extra ports, and no
new TLS setup — Cloudflare already holds a wildcard-capable cert for the zone.

### The mental model

A request's path through the system, and the **three** places each app is
registered:

```
https://blog.benmanley.biz
        │
        │  ① Cloudflare DNS + Tunnel "Public Hostname"
        ▼     blog.benmanley.biz ──▶ HTTP ──▶ caddy:80
   cloudflared ──▶ caddy
        │
        │  ② Caddyfile site block matches the Host header
        ▼     http://blog.benmanley.biz { reverse_proxy blog:3000 }
      blog:3000        ③ the app's container, on the shared `edge` network
```

| # | Where | What you set | Identifies the app by |
|---|-------|--------------|------------------------|
| ① | Cloudflare → Tunnel → **Public Hostnames** | `sub.benmanley.biz` → `HTTP` → `caddy:80` | **subdomain** (the public name) |
| ② | `~/apps/edge/Caddyfile` | a site block `http://sub.benmanley.biz { reverse_proxy <name>:<port> }` | **Host header** → container |
| ③ | the app's `docker-compose.yml` | `container_name`, `expose: ["<port>"]`, `networks: [edge]` | **container name + port** |

The container name in ② must match `container_name` in ③, and the port must
match what the app listens on inside its container. Caddy resolves the name via
Docker's built-in DNS on the `edge` network — no IPs, no host ports.

### Worked example — three apps, three subdomains

Say you want:

| Subdomain | App | Container | Internal port |
|-----------|-----|-----------|---------------|
| `mythbindr.benmanley.biz` | MythBindr (SPA + API) | `mythbindr-web` + `mythbindr-api` | 80 / 4000 |
| `blog.benmanley.biz` | a blog | `blog` | 3000 |
| `status.benmanley.biz` | Uptime Kuma | `uptime-kuma` | 3001 |

**`~/apps/edge/Caddyfile`** — one site block per subdomain:

```caddyfile
{
    auto_https off        # Cloudflare terminates TLS; the tunnel speaks HTTP to us
}

# MythBindr — SPA + API same-origin. Matches RP_ID=mythbindr.benmanley.biz.
http://mythbindr.benmanley.biz {
    encode zstd gzip
    @api path /api/* /socket.io/*
    handle @api {
        reverse_proxy mythbindr-api:4000 {
            header_up X-Forwarded-Proto {http.request.header.X-Forwarded-Proto}
        }
    }
    handle {
        reverse_proxy mythbindr-web:80
    }
}

# A blog
http://blog.benmanley.biz {
    encode zstd gzip
    reverse_proxy blog:3000
}

# Self-hosted status page
http://status.benmanley.biz {
    reverse_proxy uptime-kuma:3001
}
```

Each app's `docker-compose.yml` joins the shared network and exposes its port —
no host `ports:` needed because Caddy reaches it over `edge`:

```yaml
services:
  blog:
    image: ghcr.io/example/blog:latest
    container_name: blog          # ← must match the Caddyfile target
    restart: unless-stopped
    expose:
      - "3000"                    # ← must match the port in the Caddyfile
    networks:
      - edge

networks:
  edge:
    external: true
```

### Step-by-step to add `sub.benmanley.biz`

1. **App container** — give it `container_name`, `expose` its port, and put it on
   the external `edge` network (mirror `mythbindr-back/docker-compose.yml`).
   Start it: `docker compose up -d`.
2. **Caddyfile** — add a site block:
   ```caddyfile
   http://sub.benmanley.biz {
       reverse_proxy <container_name>:<port>
   }
   ```
3. **Cloudflare** → Zero Trust → Tunnels → your `mythpi` tunnel → **Public
   Hostnames** → *Add*: subdomain `sub`, domain `benmanley.biz`, type `HTTP`,
   URL `caddy:80`. (This also creates the proxied DNS record for you.)
4. **Reload Caddy** with zero downtime — no restart, existing connections survive:
   ```bash
   docker exec caddy caddy reload --config /etc/caddy/Caddyfile
   ```
5. Verify: `curl -s https://sub.benmanley.biz/...` from anywhere.

### Tips

- **Confirm wiring** — every app + Caddy + cloudflared must show on `edge`:
  ```bash
  docker network inspect edge --format '{{range .Containers}}{{.Name}} {{end}}'
  ```
- **Name collisions**: `container_name` must be unique across *all* stacks on the
  Pi, since they share one Docker network.
- **Validate before reloading**: `docker exec caddy caddy validate --config /etc/caddy/Caddyfile`.
- **Apex vs. subdomain**: a bare `benmanley.biz` needs its own Public Hostname
  entry (blank subdomain) and its own Caddy site label, as shown for MythBindr.
- **Wildcard shortcut (optional)**: instead of registering each hostname in
  Cloudflare, you can add a single wildcard Public Hostname `*.benmanley.biz` →
  `caddy:80`, then let the Caddyfile alone decide routing. Add a catch-all so
  unknown names don't 502:
  ```caddyfile
  http://blog.benmanley.biz { reverse_proxy blog:3000 }
  http://status.benmanley.biz { reverse_proxy uptime-kuma:3001 }
  http:// {                       # any other *.benmanley.biz host
      respond "Not found" 404
  }
  ```
  Wildcards are convenient but route *every* unlisted subdomain into Caddy —
  prefer explicit Public Hostnames unless you're adding apps frequently.
- **Path-based routing** (everything under one subdomain instead of many) is also
  possible — see the `handle /api/*` example in **Part C**. Subdomains are
  cleaner when apps are independent; paths suit a front-end + its API on one host.

---

## Cloudflare settings worth turning on

- **SSL/TLS mode: Full.** (Tunnel traffic is already encrypted Cloudflare→Pi;
  "Full" is the correct, safe setting for tunnels — avoid "Flexible".)
- **Always Use HTTPS**: On (redirects http→https at the edge).
- **WebSockets**: On (Network tab — usually on by default; required for Yjs).
- **Caching**: leave API paths uncached. If you later serve a static front-end,
  cache that but exclude `/api/*`.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| `cloudflared` logs show no connections | Bad/empty `TUNNEL_TOKEN`, or domain not yet **Active** in Cloudflare. |
| 502 from Cloudflare | Caddy can't reach the app. Confirm all three containers are on `edge` and the app name/port in the Caddyfile match. |
| 1033 "tunnel error" | The public hostname points at the wrong service — it must be `HTTP` → `caddy:80`. |
| Websockets/live edit fail | Cloudflare **WebSockets** off, or you bypassed Caddy. Caddy upgrades automatically; just ensure traffic flows through it. |
| Passkeys fail | `RP_ID`/`RP_ORIGIN` in the app `.env` don't match `mythbindr.benmanley.biz` / the exact browser origin. |
| Redirect loop / insecure cookie | App not in `production` (so `trust proxy` is off) — confirm `NODE_ENV=production`. |
| Email for the domain stopped | You moved nameservers without re-creating MX/TXT records in Cloudflare DNS (Part A warning). |
