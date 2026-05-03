# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] — 2026-04-30

First public release. Python v1 reference architecture for edge-first product discovery.

### Added
- Manifest-based catalog sync with sha256 checksums (`edgereco sync`)
- BM25 keyword index (`rank-bm25`) and FAISS vector index (`sentence-transformers/all-MiniLM-L6-v2`)
- Reciprocal Rank Fusion hybrid search (`edgereco search`, `GET /search`)
- Session-aware reranker: `0.40·pop + 0.20·cat + 0.15·tag + 0.10·brand + 0.10·fresh − 0.25·rep`
- Interaction event ingest (`POST /events`) with click / view / favorite / cart weights
- Recommendation endpoint with session signals (`GET /recommend`)
- Typer CLI: `sync`, `index`, `serve`, `search`, `preprocess`
- FastAPI app with Protocol-based DI for edge clients (HTTP + filesystem adapters)
- Synthetic 1000-product demo catalog (`scripts/generate_demo_catalog.py`)
- Docker Compose stack: origin + Caddy edge + app, with healthcheck-gated startup
- BDD test suite (5 Gherkin features), integration + e2e coverage, 98%+ line coverage
- GitHub Actions CI: ruff + mypy strict + pytest with 90% coverage gate
