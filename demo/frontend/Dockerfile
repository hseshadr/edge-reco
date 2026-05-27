# Nimbus demo frontend image — multi-stage: Vite build -> static serve.
#
# Build context: the FRONTEND dir (demo/frontend). Unlike the backend, the
# frontend has no sibling-repo dependency, so its context stays local.
#
# VITE_API_BASE is baked at BUILD time (Vite inlines import.meta.env at compile)
# — pass it as a build arg so the static bundle points at the right backend.

# ---- stage 1: build the static bundle ----
FROM node:22-slim AS build

WORKDIR /app

# Install deps first (better layer caching).
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Backend origin the browser bundle will call. Default targets the host-mapped
# backend port; compose overrides as needed.
ARG VITE_API_BASE=http://localhost:8000
ENV VITE_API_BASE=${VITE_API_BASE}

RUN npm run build

# ---- stage 2: serve the static dist/ ----
# `serve` is a tiny zero-config static server; -s rewrites unknown routes to
# index.html (SPA). Listens on 5173 to match the dev origin / CORS defaults.
FROM node:22-slim AS serve

WORKDIR /app
RUN npm install -g serve@14

COPY --from=build /app/dist ./dist

EXPOSE 5173

CMD ["serve", "-s", "dist", "-l", "5173"]
