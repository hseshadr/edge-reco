# Nimbus demo frontend image — multi-stage: Vite build -> static serve.
#
# The SPA is backend-free: it syncs the signed bundle from the Caddy edge and
# runs edge-reco's engine entirely in the browser. There is no API server.
#
# Build context: the FRONTEND dir (demo/frontend). It has no sibling-repo
# dependency, so its context stays local.
#
# VITE_BUNDLE_BASE_URL is baked at BUILD time (Vite inlines import.meta.env at
# compile). It must be the origin the BROWSER reaches — i.e. the host-mapped
# edge port (http://localhost:8081), NOT the in-network `edge` hostname.

# ---- stage 1: build the static bundle ----
FROM node:22-slim AS build

WORKDIR /app

# Install deps first (better layer caching).
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Caddy edge origin the browser syncs the signed bundle from. Default targets
# the host-mapped edge port; compose can override.
ARG VITE_BUNDLE_BASE_URL=http://localhost:8081
ENV VITE_BUNDLE_BASE_URL=${VITE_BUNDLE_BASE_URL}

RUN npm run build

# ---- stage 2: serve the static dist/ ----
# `serve` is a tiny zero-config static server; -s rewrites unknown routes to
# index.html (SPA). Listens on 5173 to match the dev origin.
FROM node:22-slim AS serve

WORKDIR /app
RUN npm install -g serve@14

COPY --from=build /app/dist ./dist

EXPOSE 5173

CMD ["serve", "-s", "dist", "-l", "5173"]
