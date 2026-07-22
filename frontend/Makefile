# Nimbus frontend — dev run tooling. The demo is BACKEND-FREE: the SPA syncs a signed
# bundle from the Caddy edge and runs the engine in the browser.
#
# Quickstart (recommended path):
#   cd ../backend && uv run poe demo   # turnkey: edge + SPA + opens your browser
#   docker compose up --build          # fully containerized (Docker only), one command
#
# Iterate on the SPA locally:
#   make install   # one-time: pnpm workspace deps (app + @edgeproc/browser)
#   make edge      # serve the signed bundle from the Caddy edge (:8081)
#   make app       # Vite dev server on localhost:5174 (syncs from the edge)
#   make dev       # edge + app together
#   make test      # frontend vitest
#
# NOTE on paths: python targets (the OPTIONAL API backend) run from backend/
# because the launcher is a `demo_server.*` module under that dir and depends
# on the substrate deps (edgeproc-core from PyPI, edge-proc via its git pin).

# Absolute path to frontend/ regardless of where make is invoked from.
FRONTEND_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
ROOT_DIR := $(abspath $(FRONTEND_DIR)/..)
BACKEND_DIR := $(ROOT_DIR)/backend

.DEFAULT_GOAL := help
.PHONY: help install dev edge app backend test

help: ## Show this help.
	@echo "Nimbus frontend (backend-free) targets:"
	@echo "  cd ../backend && uv run poe demo   turnkey: edge + SPA + opens your browser"
	@echo "  docker compose up --build   the whole showcase, one command"
	@echo "  make install   pnpm install (workspace: app + @edgeproc/browser)"
	@echo "  make edge       serve the signed bundle from Caddy (:8081)"
	@echo "  make app        Vite dev server (open http://localhost:5174)"
	@echo "  make dev        edge + app together"
	@echo "  make test       frontend vitest"
	@echo "  make backend    (optional) the API-server use case (:8000)"

install: ## One-time: install workspace deps (app + @edgeproc/browser package).
	cd $(FRONTEND_DIR) && pnpm install

# Serve the signed bundle from the Caddy edge so the SPA can sync it in-browser.
edge: ## Run the origin + Caddy edge (signed bundle on :8081).
	cd $(FRONTEND_DIR) && docker compose up -d origin edge

# Edge (signed bundle) + the Vite SPA. The edge runs detached; the app runs
# in the foreground; `trap` tears the edge down on Ctrl-C.
dev: ## Run edge + app together. Open http://localhost:5174
	@echo ">> edge -> http://localhost:8081  (signed bundle the SPA syncs)"
	@echo ">> app  -> http://localhost:5174  <- open this in your browser"
	@cd $(FRONTEND_DIR) && docker compose up -d origin edge
	@trap "cd $(FRONTEND_DIR) && docker compose stop origin edge >/dev/null 2>&1" EXIT INT TERM; \
		cd $(FRONTEND_DIR)/app && pnpm run dev

app: ## Run only the Vite dev server (localhost:5174).
	cd $(FRONTEND_DIR)/app && pnpm run dev

backend: ## (Optional) Run the API-server launcher (127.0.0.1:8000) — NOT needed for the demo.
	cd $(BACKEND_DIR) && uv run python -m demo_server.serve

test: ## Run the frontend vitest units.
	cd $(FRONTEND_DIR)/app && pnpm run test
