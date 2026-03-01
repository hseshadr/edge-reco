# EdgeReco

**Push recommendation inference to the browser. Eliminate backend round-trips.**

<!-- Badges placeholder -->
<!-- ![Build](https://img.shields.io/badge/build-passing-brightgreen) -->
<!-- ![License](https://img.shields.io/badge/license-Apache%202.0-blue) -->

## What is EdgeReco?

EdgeReco is a hybrid edge recommendation system that runs inference directly in the browser via WebAssembly. It uses CDN-first artifact distribution, delta-sync product catalogs, versioned engine hot-swap, and a closed-loop personalization flywheel to deliver sub-10ms recommendations — offline-capable, privacy-preserving, and with 80%+ fewer backend calls.

## Key Capabilities

- **Browser-native inference** — WASM-compiled recommendation engine runs locally in a Dedicated Worker
- **CDN-first distribution** — Engines, catalogs, and configs delivered as static, content-addressed artifacts
- **Delta-sync catalogs** — Binary delta patches keep product data fresh without full re-downloads
- **Hot-swap engine updates** — New model versions deploy via manifest, with smoke tests and instant rollback
- **Offline-capable** — Cached artifacts and local state enable full recommendations without network
- **Closed-loop personalization** — Interaction events feed back into future model training
- **Privacy-preserving** — All personalization data stays on-device; only anonymous aggregates leave the browser
- **Mobile-ready** — Shared artifact format with `IRecoRuntime` interface for native SDK integration

## Architecture

```
                           +------------------+
                           |   Datalake /     |
                           |   Training       |
                           +--------+---------+
                                    |
                              model artifacts
                                    |
                           +--------v---------+
                           |   Backend API    |
                           |   (fallback +    |
                           |    event sink)   |
                           +--------+---------+
                                    |
                              publish artifacts
                                    |
                           +--------v---------+
                           |      CDN         |
                           |  (static assets) |
                           +--------+---------+
                                    |
                     +--------------+--------------+
                     |              |              |
              +------v------+ +----v----+ +-------v-------+
              | WASM Engine | | Catalog | | Config/       |
              | (.wasm)     | | (.db)   | | Manifest      |
              +------+------+ +----+----+ +-------+-------+
                     |              |              |
                     +--------------+--------------+
                                    |
                     +--------------v--------------+
                     |         Browser             |
                     |  +--------+  +-----------+  |
                     |  | Service|  | Compute   |  |
                     |  | Worker |  | Worker    |  |
                     |  +---+----+  +-----+-----+  |
                     |      |             |         |
                     |  +---v-------------v-----+   |
                     |  |  Storage (OPFS + IDB)  |  |
                     |  +------------------------+  |
                     |         |                    |
                     |  +------v---------+          |
                     |  | Hybrid Router  |<-- App   |
                     |  +----------------+          |
                     +------------------------------+
```

## Status

**Early stage / Pre-implementation** — Architecture and specifications are defined. No production code yet.

## Documentation

| Document | Description |
|----------|-------------|
| [Product Requirements](docs/PRD.md) | Business goals, user stories, success metrics, rollout strategy |
| [Architecture](docs/ARCHITECTURE.md) | Component breakdown, data flows, CDN strategy, failure handling |
| [Technical Specification](docs/TECH_SPEC.md) | WASM API, Worker protocols, storage schemas, artifact formats |

## Getting Started

> This project is in the design phase. Implementation instructions will be added as development begins.

## License

[Apache License 2.0](LICENSE)
