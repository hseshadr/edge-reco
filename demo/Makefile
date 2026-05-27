# Nimbus demo — dev run tooling. The demo is BACKEND-FREE: the SPA syncs a signed
# bundle from the Caddy edge and runs edge-reco's engine in the browser.
#
# Quickstart (recommended path):
#   docker compose up --build     # the whole backend-free showcase, one command
#
# Iterate on the SPA locally:
#   make install   # one-time: frontend (npm) deps
#   make edge      # serve the signed bundle from the Caddy edge (:8081)
#   make frontend  # Vite dev server on localhost:5173 (syncs from the edge)
#   make dev       # edge + frontend together
#   make test      # frontend vitest
#
# NOTE on paths: python targets (the OPTIONAL API backend) run from the REPO ROOT
# because the engine is a `demo.backend.*` module under that root and depends on
# sibling repos (../edge-proc, ../shared-libs-python) via uv local sources.

# Absolute path to demo/ regardless of where make is invoked from.
DEMO_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
ROOT_DIR := $(abspath $(DEMO_DIR)/..)

.DEFAULT_GOAL := help
.PHONY: help install dev edge frontend backend test

help: ## Show this help.
	@echo "Nimbus demo (backend-free) targets:"
	@echo "  docker compose up --build   the whole showcase, one command"
	@echo "  make install   npm install (frontend)"
	@echo "  make edge       serve the signed bundle from Caddy (:8081)"
	@echo "  make frontend   Vite dev server (open http://localhost:5173)"
	@echo "  make dev        edge + frontend together"
	@echo "  make test       frontend vitest"
	@echo "  make backend    (optional) the API-server use case (:8000)"

install: ## One-time: install frontend dependencies.
	cd $(DEMO_DIR)/frontend && npm install

# Serve the signed bundle from the Caddy edge so the SPA can sync it in-browser.
edge: ## Run the origin + Caddy edge (signed bundle on :8081).
	cd $(DEMO_DIR) && docker compose up -d origin edge

# Edge (signed bundle) + the Vite SPA. The edge runs detached; the frontend runs
# in the foreground; `trap` tears the edge down on Ctrl-C.
dev: ## Run edge + frontend together. Open http://localhost:5173
	@echo ">> edge     -> http://localhost:8081  (signed bundle the SPA syncs)"
	@echo ">> frontend -> http://localhost:5173  <- open this in your browser"
	@cd $(DEMO_DIR) && docker compose up -d origin edge
	@trap "cd $(DEMO_DIR) && docker compose stop origin edge >/dev/null 2>&1" EXIT INT TERM; \
		cd $(DEMO_DIR)/frontend && npm run dev

frontend: ## Run only the Vite dev server (localhost:5173).
	cd $(DEMO_DIR)/frontend && npm run dev

backend: ## (Optional) Run the API-server launcher (127.0.0.1:8000) — NOT needed for the demo.
	cd $(ROOT_DIR) && uv run python -m demo.backend.serve

test: ## Run the frontend vitest units.
	cd $(DEMO_DIR)/frontend && npm run test
