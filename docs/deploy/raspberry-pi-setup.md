# Deploying MythBindr on a Raspberry Pi 5

This guide takes a bare Raspberry Pi 5 to a running, auto-restarting MythBindr
API container. It's written to host **several apps** on one Pi behind a single
domain — the reverse proxy and public ingress are covered separately in
[cloudflare-caddy.md](./cloudflare-caddy.md).

> **Read both docs before starting.** This one gets the app running on the Pi's
> private network; the other exposes it to `https://mythbindr.benmanley.biz`.

---

## 0. What you'll end up with

```
Internet ───────▶ Cloudflare ──▶ cloudflared tunnel ──▶ Caddy ──▶ mythbindr-web  (React SPA, static)
(mythbindr.benmanley.biz)        (no open ports)        (TLS,      ├▶ mythbindr-api  (this app)
                                                         routing)  └▶ other-app-N    (own subdomains)
```

The SPA (`mythbindr-front`) and the API are served **same-origin** under
`mythbindr.benmanley.biz`: Caddy serves the static front-end and proxies `/api/*`
and `/socket.io/*` to the API. See [cloudflare-caddy.md](./cloudflare-caddy.md).

Every container has `restart: unless-stopped`, so a crash or a power-cycle
brings the whole stack back automatically. The app handles `SIGTERM` for clean
restarts (drains websockets, closes Mongo).

---

## 1. Hardware checklist

| Item | Recommendation | Why |
|------|----------------|-----|
| Power | **Official 27 W USB‑C PSU** | Under-powering causes random instability that looks like software bugs. |
| Cooling | Active cooler / fan | The Pi 5 throttles under sustained load without it. |
| Storage | **NVMe SSD (M.2 HAT) or USB SSD** — *not* an SD card for the OS | SD cards corrupt under database/log writes; this is the #1 cause of Pi server death. |
| RAM | 8 GB model | Comfortable headroom for several Node apps + Caddy. |

If you must start on an SD card, plan to move to SSD before going live, and use
**MongoDB Atlas** (below) so the heavy writes never touch the card.

---

## 2. Flash the OS

Use **Raspberry Pi OS Lite (64-bit)** — headless, Debian Bookworm base, best Pi
hardware support. (Ubuntu Server 24.04 LTS arm64 is a fine alternative.)

1. Install **Raspberry Pi Imager** on your laptop.
2. Choose device *Raspberry Pi 5*, OS *Raspberry Pi OS Lite (64-bit)*, your SSD/SD.
3. Click the **gear ⚙ icon** (edit settings) **before** writing and set:
   - **Hostname**: `mythpi` (or anything memorable)
   - **Enable SSH** → *Use public-key authentication*, paste your `~/.ssh/id_ed25519.pub`
   - **Username**: e.g. `ben` (avoid the default `pi`)
   - **Wi‑Fi** (or plan to use Ethernet) + locale/timezone
4. Write, boot the Pi, then from your laptop:
   ```bash
   ssh ben@mythpi.local        # or the IP from your router
   ```

### Boot from SSD (if using NVMe/USB SSD)
After first boot, ensure the bootloader prefers NVMe/USB:
```bash
sudo raspi-config        # Advanced Options → Boot Order → NVMe/USB Boot
sudo rpi-eeprom-update -a && sudo reboot
```

---

## 3. Base system prep

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y git ca-certificates curl ufw fail2ban unattended-upgrades
sudo timedatectl set-timezone America/Chicago     # your zone
```

### Automatic security updates
```bash
sudo dpkg-reconfigure -plow unattended-upgrades    # choose "Yes"
```

### Firewall (defence in depth — Cloudflare Tunnel needs **no** inbound ports)
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH          # keep yourself able to SSH in
sudo ufw enable
```
> Because we use Cloudflare Tunnel, you do **not** open 80/443 on the router or
> the Pi. The only inbound port is SSH (and only on your LAN).

### Harden SSH (key-only)
Edit `/etc/ssh/sshd_config` (or a drop-in in `/etc/ssh/sshd_config.d/`):
```
PasswordAuthentication no
PermitRootLogin no
```
```bash
sudo systemctl restart ssh
```
`fail2ban` is already running with sane SSH defaults after install.

---

## 4. Install Docker Engine + Compose

Use Docker's official convenience script (correct arm64 packages for Bookworm):
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"      # run docker without sudo
newgrp docker                        # apply group now (or log out/in)
docker run --rm hello-world          # sanity check
```
Compose v2 ships as the `docker compose` plugin with the above — verify:
```bash
docker compose version
```
Enable on boot (usually already enabled):
```bash
sudo systemctl enable --now docker
```

---

## 5. Choose where MongoDB lives

**Recommended: MongoDB Atlas free tier (M0).** Managed backups, no SD/SSD wear,
one less container to babysit.
1. Create a free M0 cluster at <https://www.mongodb.com/atlas>.
2. Add a database user and allow your Pi's outbound IP (or `0.0.0.0/0` if your
   home IP is dynamic — the user/password still gates access).
3. Copy the `mongodb+srv://...` connection string for the `.env` below.

**Alternative: local Mongo container.** Uncomment the `mongo` service in
`docker-compose.yml`, add it under `depends_on`, and set
`MONGODB_URI=mongodb://mongo:27017/mythbindr`. You then own backups (see §9).

---

## 6. Get the code and configure `.env`

```bash
mkdir -p ~/apps && cd ~/apps
git clone <your-mythbindr-back-repo-url> mythbindr-back
cd mythbindr-back
cp .env.example .env
nano .env
```

Set **production** values — these differ from local dev:

```ini
NODE_ENV=production
PORT=4000
# Public origin where the browser loads the app (SPA + API, same origin). No trailing slash.
CLIENT_ORIGIN=https://mythbindr.benmanley.biz

MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/mythbindr?retryWrites=true&w=majority

# Generate a fresh secret: openssl rand -hex 32
SESSION_SECRET=<64-hex-chars>

# WebAuthn / passkeys — RP_ID is the exact host serving the app, NO scheme/port.
RP_ID=mythbindr.benmanley.biz
RP_NAME=MythBindr
RP_ORIGIN=https://mythbindr.benmanley.biz

# Spotify — must byte-for-byte match a Redirect URI registered in the dashboard.
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
SPOTIFY_REDIRECT_URI=https://mythbindr.benmanley.biz/api/integrations/spotify/callback

# AI assist (optional; routes return 503 until set)
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-opus-4-8
```

> **Important about the domain & passkeys:** `RP_ID` must match the host the
> browser uses, and passkeys only work over **HTTPS** (provided by Cloudflare in
> the other doc). This app lives on its own subdomain, `mythbindr.benmanley.biz`,
> so `RP_ID=mythbindr.benmanley.biz` and `RP_ORIGIN`/`CLIENT_ORIGIN` are that exact
> origin. (Scoping `RP_ID` to the subdomain — rather than the registrable domain
> `benmanley.biz` — keeps these passkeys isolated from other apps you host on
> sibling subdomains.)
>
> Also update the **Spotify** redirect URI in the Spotify Developer Dashboard to
> the production URL, or OAuth will fail.

`.env` is gitignored — secrets stay on the Pi and are injected at runtime via
`env_file`; they are never baked into the image.

---

## 7. Create the shared network and start the app

The `edge` network is shared with Caddy/cloudflared (other doc). Create it once:
```bash
docker network create edge        # ignore "already exists" on re-runs
```

Build and launch:
```bash
cd ~/apps/mythbindr-back
docker compose up -d --build
```

Check it:
```bash
docker compose ps                 # STATUS should become "healthy"
docker compose logs -f api        # watch for "✓ Server listening" / "✓ Connected to MongoDB"
```

The container exposes `4000` on the `edge` network only (not to your LAN). To
poke it directly while debugging, temporarily uncomment the `ports:` block in
`docker-compose.yml`, `docker compose up -d`, then:
```bash
curl http://localhost:4000/api/health
# {"status":"ok","db":"connected",...}
```

> At this point the app runs but isn't reachable from the internet yet.
> Continue to **[cloudflare-caddy.md](./cloudflare-caddy.md)** to put it online.

---

## 8. Day-2 operations

**Deploy a new version:**
```bash
cd ~/apps/mythbindr-back
git pull
docker compose up -d --build          # rebuild + rolling replace; old container gets SIGTERM
docker image prune -f                 # reclaim space from old layers
```

**Restart / stop / logs:**
```bash
docker compose restart api
docker compose stop
docker compose logs -f api
```

**Auto-start on boot** is automatic: `restart: unless-stopped` + Docker's
systemd unit bring containers back after a reboot or power loss. Verify with a
reboot:
```bash
sudo reboot
# after it comes back:
docker compose ps
```

---

## 9. Backups

**Atlas:** backups are managed for you (enable continuous/cloud backups in the
Atlas UI). Nothing to do on the Pi.

**Local Mongo container:** dump nightly to the host and copy off-box. Example
cron (`crontab -e`):
```bash
0 3 * * * docker exec mythbindr-mongo mongodump --archive=/tmp/db.gz --gzip \
  && docker cp mythbindr-mongo:/tmp/db.gz "$HOME/backups/mythbindr-$(date +\%F).gz"
```
Then sync `~/backups` to external storage (rclone to a cloud bucket, or a NAS).

Also back up your **`.env`** files somewhere safe (a password manager / secrets
vault) — they're not in git by design.

---

## 10. Monitoring (recommended)

Run **Uptime Kuma** as one more container to watch `/api/health` and alert you:
```bash
docker run -d --restart=unless-stopped -p 3001:3001 \
  -v uptime-kuma:/app/data --name uptime-kuma louislam/uptime-kuma:1
```
Add an HTTP(s) monitor for `https://mythbindr.benmanley.biz/api/health` and a keyword
check for `"status":"ok"`.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| `docker: permission denied` | You skipped `usermod -aG docker $USER` / didn't re-login. Run `newgrp docker`. |
| Container restarts in a loop | `docker compose logs api`. Usually a missing/bad `MONGODB_URI` or unreachable Atlas IP allowlist. |
| `healthy` never reached | App can't reach Mongo. Check the URI, Atlas network access list, and DNS from the Pi. |
| Passkeys fail in the browser | `RP_ID`/`RP_ORIGIN` don't match the URL, or you're on HTTP. Must be HTTPS via Cloudflare. |
| Spotify OAuth error | Redirect URI in `.env` ≠ the one registered in the Spotify dashboard. |
| Random freezes/reboots | Under-powered PSU or thermal throttling — use the 27 W PSU + active cooling. |
