# Nimbus demo frontend image — multi-stage: Vite build -> static serve.
#
# The SPA is backend-free: it syncs the signed bundle from the Caddy edge and
# runs edge-reco's engine entirely in the browser. There is no API server.
#
# Build context: the npm-WORKSPACE ROOT (demo/), because the SPA depends on the
# in-repo @edgeproc/browser workspace package (demo/packages/edgeproc-browser)
# and the lockfile lives at the root. Built via docker compose with
# `context: .` + `dockerfile: frontend/Dockerfile`.
#
# VITE_BUNDLE_BASE_URL is baked at BUILD time (Vite inlines import.meta.env at
# compile). It must be the origin the BROWSER reaches — i.e. the host-mapped
# edge port (http://localhost:8081), NOT the in-network `edge` hostname.

# ---- stage 1: build the static bundle ----
FROM node:22-slim AS build

WORKDIR /app

# Install deps first (better layer caching): copy the workspace manifests + the
# root lockfile, then `npm ci` resolves the whole workspace (frontend + package).
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
COPY packages/edgeproc-browser/package.json ./packages/edgeproc-browser/package.json
RUN npm ci

# Bring in the full workspace sources (the package is consumed as TS by Vite).
COPY . .

# Caddy edge origin the browser syncs the signed bundle from. Default targets
# the host-mapped edge port; compose can override.
ARG VITE_BUNDLE_BASE_URL=http://localhost:8081
ENV VITE_BUNDLE_BASE_URL=${VITE_BUNDLE_BASE_URL}

# Build only the SPA workspace; it resolves @edgeproc/browser via the workspace link.
RUN npm run build -w frontend

# ---- stage 2: serve the static dist/ ----
# `serve` is a tiny zero-config static server; -s rewrites unknown routes to
# index.html (SPA). Listens on 5173 to match the dev origin.
FROM node:22-slim AS serve

WORKDIR /app
RUN npm install -g serve@14

COPY --from=build /app/frontend/dist ./dist

EXPOSE 5173

CMD ["serve", "-s", "dist", "-l", "5173"]
