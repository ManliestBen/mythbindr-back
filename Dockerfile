# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────
# MythBindr API — multi-stage build.
# Builds arm64 natively on a Raspberry Pi 5 (and amd64 on a dev machine).
# ─────────────────────────────────────────────────────────────────────────

# ── Stage 1: build (TypeScript → dist/) ──────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Install ALL deps (incl. dev) using the lockfile for reproducible builds.
COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Prune to production-only deps so we copy a lean node_modules forward.
RUN npm prune --omit=dev

# ── Stage 2: runtime ─────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Built-in non-root "node" user — never run the app as root.
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node package.json ./

USER node
EXPOSE 4000

# Direct `node` as PID 1; tini (via compose `init: true`) reaps zombies and
# forwards SIGTERM so the graceful-shutdown handler in src/index.ts runs.
CMD ["node", "dist/index.js"]
