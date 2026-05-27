# Nimbus demo — dev run tooling.
#
# Quickstart (recommended path):
#   make install   # one-time: sync python deps + npm install
#   make dev       # start backend (127.0.0.1:8000) + frontend (localhost:5173)
#   make test      # backend pytest + frontend vitest
#
# `make dev` is the supported way to run the demo locally. Docker
# (docker-compose.yml) is best-effort — see the header in that file.
#
# NOTE on paths: all python targets run from the REPO ROOT (one level up from
# this demo/ dir) because the engine is a `demo.backend.*` module under that
# root and depends on sibling repos (../edgeproc, ../shared-libs-python) via
# uv local sources resolved at the repo root.

# Absolute path to demo/ regardless of where make is invoked from.
DEMO_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
ROOT_DIR := $(abspath $(DEMO_DIR)/..)

.DEFAULT_GOAL := help
.PHONY: help install dev backend frontend test

help: ## Show this help.
	@echo "Nimbus demo targets:"
	@echo "  make install   sync python deps (repo root) + npm install (frontend)"
	@echo "  make dev       run backend + frontend concurrently (open http://localhost:5173)"
	@echo "  make test      backend pytest + frontend vitest"

install: ## One-time: install python + frontend dependencies.
	cd $(ROOT_DIR) && uv sync
	cd $(DEMO_DIR)/frontend && npm install

# Start BOTH servers concurrently. The backend is launched in the background;
# the frontend runs in the foreground. `trap` kills the backend when the
# frontend exits (Ctrl-C) so we don't leak a port-8000 process.
dev: ## Run backend + frontend together. Open http://localhost:5173
	@echo ">> backend  -> http://127.0.0.1:8000  (FAISS build ~8s on first request)"
	@echo ">> frontend -> http://localhost:5173  <- open this in your browser"
	@cd $(ROOT_DIR) && uv run python -m demo.backend.serve & \
		BACKEND_PID=$$!; \
		trap "kill $$BACKEND_PID 2>/dev/null" EXIT INT TERM; \
		cd $(DEMO_DIR)/frontend && npm run dev

# Individual servers (handy for debugging one side at a time).
backend: ## Run only the backend launcher (127.0.0.1:8000).
	cd $(ROOT_DIR) && uv run python -m demo.backend.serve

frontend: ## Run only the Vite dev server (localhost:5173).
	cd $(DEMO_DIR)/frontend && npm run dev

test: ## Run backend pytest + frontend vitest.
	cd $(ROOT_DIR) && uv run pytest demo/backend/tests
	cd $(DEMO_DIR)/frontend && npm run test
