# EdgeReco

**A store's search and "you might also like" — running entirely inside the shopper's browser tab, with no server behind it.**

[![CI](https://github.com/hseshadr/edge-reco/actions/workflows/ci.yml/badge.svg)](https://github.com/hseshadr/edge-reco/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.13+](https://img.shields.io/badge/python-3.13+-blue.svg)](https://www.python.org/downloads/)
[![TypeScript 6](https://img.shields.io/badge/typescript-6.0-blue.svg)](https://www.typescriptlang.org/)
[![Live demo](https://img.shields.io/badge/live%20demo-edge--reco.com-brightgreen.svg)](https://edge-reco.com)

▶ **[Try it live at edge-reco.com](https://edge-reco.com)** — nothing to install, nothing to sign up for. The whole engine boots in your tab.

## The problem, in one shopping trip

You're on a store's website. Your back hurts. You type **"something for my aching back"** into the search box.

An ordinary search box matches *words*. Your words are "something", "for", "my", "aching", "back" — so it hunts for products with those words in the title and hands you whatever it finds. Here is what that actually returns from a real 720-product catalog:

```
Reserved Parking Sign, Custom Parking Signs for Business
Massage Gun Deep Tissue - Back Muscle Massager
Don't Kill My Vibe Neon Sign
```

A parking sign. Because the word "back" showed up somewhere and the word-matcher has no idea what you *meant*.

EdgeReco runs the word match **and** a meaning match, then merges them:

```
Massage Gun Deep Tissue - Back Muscle Massager
Silicone Earring Backs for Studs
Sheenive Stadium Seats for Bleachers with Back Support
```

The massage gun is now first. You never typed "massage" or "muscle". The engine understood the request.

That output is real — [run it yourself in about ten lines of Python](#see-it-yourself-in-python).

## The part that's actually unusual

That entire search ran **on the shopper's device**. Not on a server. Not in a cloud API. In the browser tab.

Most stores rent search and recommendations from a cloud service and pay per query. Every shopper's every keystroke crosses the network and costs money. To survive Black Friday you rent far more capacity than you need the other 364 days — and the smartest part of the store is also the most expensive one, and the first to fall over when traffic spikes.

**EdgeReco flips that.** Your store sends each shopper's browser one small file — your products plus the logic that ranks them — exactly once. After that, search, ranking, and personalization all run locally, with nothing sent back to a server.

So every shopper brings their own hardware. The more popular you get, the more capacity you have. Your bill stops growing with traffic and drops to the cost of handing out one small file. Results come back instantly, and keep coming back when the connection drops.

**And it still gets smarter.** An optional loop — off by default — lets your store learn from anonymous, grouped shopper activity in the cloud, then hand every device an updated file to pick up on its next visit. The shopping always runs on the device; only the learning is optional, and even that never touches a live shopper's results.

### Nimbus is the proof

Nimbus is a pretend storefront built on 720 real products so you can watch this happen: search, click a few items, and see the recommendations re-rank — while the **"backend calls" counter sits at 0**.

[![Nimbus demo: searching the storefront and clicking a few products — the "Recommended for you" rail re-ranks instantly while the metrics strip stays at zero backend calls](docs/assets/nimbus-hero.gif)](https://edge-reco.com)

A live **metrics strip** inside the app reports the real numbers for *your* session — search latency, memory, and backend calls — measured in your own browser as you browse. That's the honest place to look at performance; this README deliberately publishes no timing figures of its own, because a number typed into a README goes stale the moment anything changes.

> _Nimbus is fictional — built only to demo EdgeReco. It is not a real shop. Its products come from a public Amazon research dataset — see [Data & attribution](#data--attribution)._

**What's actually deployed right now:** [`edge-reco.com/build.json`](https://edge-reco.com/build.json) is generated at deploy time and names the exact commit, version, and catalog bundle currently live. It is always current, which is why this README doesn't pin a commit.

## Try it (one command)

You need this repo and Docker. Nothing else.

```bash
cd frontend && docker compose up --build

# then visit http://localhost:5174 in your browser
```

You'll land on a short intro page — hit **"Launch the live demo"** and the engine boots right in your tab (a brief loading screen while it fetches the catalog and a small AI model), then the storefront appears.

Search for "shirt", then click a couple of products. Every click reshapes the "Recommended for you" rail across five taste signals — category, brand, tags, popularity, and freshness — re-ranking instantly, on-device, with no trip to a server. Hearts and cart-adds count more than clicks; what you linger on nudges things gently. The home page also stacks *Trending* and *New arrivals*; open any product for *Similar items*, *Because you viewed*, *Customers also bought*, and *Frequently bought together*.

Then stop the containers and reload the page. It still works — everything it needs is already on your machine.

> _What that one-time download fetches:_ the signed catalog file, the `all-MiniLM-L6-v2` language model (~23 MB), and the runtime that executes it (~23 MB) — **all from the demo's own web address**, never a third-party CDN. Both are copied in at build time and pinned to their exact content hashes; an automated browser test boots the store with every external CDN blocked to prove it.

**Working on the code?** With the toolchain installed (uv + Node + pnpm + Docker), `make demo` (or `poe demo`) from the repo root does the same thing in one command and opens your browser. It picks **free ports per run**, so it never clashes with a stale container or another project. (`cd backend && uv run poe demo` works too, e.g. without a global poe install; `make demo` falls back to it automatically.)

## See it yourself, in Python

The same engine also runs as a plain Python library — same catalog file, same ranking, no browser. This is the script that produced the search output at the top of this README:

```python
# Save as backend/demo.py, then:
#   cd backend && uv sync --group dev && uv run python demo.py
from pathlib import Path
from edgeproc.bundles.signing import Ed25519Verifier
from edgereco.api.deps import ServiceContainer
from edgereco.search.hybrid import reciprocal_rank_fusion

# Sync the committed signed catalog, verify it, and load the engine locally.
engine = ServiceContainer.from_synced(
    base_url=str(Path("examples/catalog").resolve()),
    cache_root=Path("/tmp/edgereco-cache"),
    verifier=Ed25519Verifier.from_public_bytes(
        Path("examples/keys/public.key").read_bytes()
    ),
)

query = "something for my aching back"
keyword = engine.keyword.search(query, k=30)                             # word matching
vector = engine.vector.search(engine.encoder.encode_query(query), k=30)  # meaning matching

print("keyword only:")
for pid, _ in keyword[:3]:
    print("   ", engine.by_id[pid].title[:60])

print("keyword + meaning, fused:")
for pid, _ in reciprocal_rank_fusion(keyword, vector)[:3]:
    print("   ", engine.by_id[pid].title[:60])
```

Real output:

```
keyword only:
    Reserved Parking Sign, Custom Parking Signs for Business,10x
    Massage Gun Deep Tissue - Back Muscle Massager w/High Torque
    Don't Kill My Vibe Neon Sign Vibe Led Sign Pink And White Ne
keyword + meaning, fused:
    Massage Gun Deep Tissue - Back Muscle Massager w/High Torque
    Silicone Earring Backs for Studs 6 Styles Clear Hypoallergen
    Sheenive Stadium Seats for Bleachers with Back Support, Blea
```

The first run downloads the language model, so it takes a minute; after that it's local.

## The learning loop

`make demo` makes **zero** backend calls — that's the default. Two extra commands show the optional loop that lets the store improve:

**1. Send activity up.** `poe demo-flywheel` adds a pretend cloud collector and shows the uplink half: clicks are captured in-tab and periodically flushed (batched, fire-and-forget) so the cloud can retrain. Signals are graded by intent — a cart-add weighs 4×, a favorite 3×, a click 1×, a lingered view 0.2× (the same grading both halves use in-session). Search and ranking still run 100% locally; the uplink is optional and off by default. Watch the `POST /events` requests and the "N interactions synced to cloud" badge.

**2. Learn and republish.** `poe demo-retrain` is the cloud half — it recomputes each product's popularity from the collected events **and** the "customers also bought" map from the session log, then republishes a freshly signed catalog file. Refresh the page and the rails re-rank toward what you clicked, because both halves re-read the new numbers from that one signed file — *no scoring-formula change, no re-computing the language model*.

That's the whole loop: **click → cloud → retrain → better recommendations.** (Re-signing needs the maintainer's private key, so step 2 is for repo owners; the published demo ships the result.)

Want to see what a retrain *would* do before doing it? `edgereco audit ORIGIN VERIFY_KEY --sessions LOG` is read-only: it prints the event counts, the top popularity movers, and the changed "also bought" edges behind the next update. It never signs, never publishes, and never touches the search path.

## Works offline, installs like an app

Nimbus is also a **PWA** (Progressive Web App — a website your browser can install like a native app). Where supported you'll get an "Add to Home Screen" prompt, and it opens in its own window.

More importantly: **after the first visit it keeps working with no network at all.** A service worker (the browser's background cache manager) precaches the app shell on first load; the language model and its runtime survive offline in the browser's own caches. The signed catalog is already stored on your device — and the service worker deliberately never touches it, so its signature guarantees are unchanged.

Product images render as local category tiles rather than remote image requests. That keeps your search results from leaking your browsing interest to an image CDN, and makes the storefront visually stable offline. Search, browse, and every recommendation rail work without a connection.

Prove it yourself:

```bash
pnpm -F frontend test:e2e:offline
```

That automated test warms the app online, cuts the network, reloads, and asserts the store still mounts and ranks — end to end, not a smoke test.

## Honest limits

Things this project does **not** do, stated plainly.

**1. There is no "verified" badge a user can see.** Signature checking genuinely runs, fail-closed, every time the catalog syncs — a tampered file *is* rejected and the app *does* refuse to load it (`frontend/packages/edgeproc-browser/src/engine/`: `crypto.ts`, `sync.ts`, `integrity.ts`). What does not exist is any screen that shows you that outcome. The landing page lists "verify (Ed25519 + SHA-256, fail-closed)" as a step, but that list is static text describing the pipeline — no checkmark, no pass/fail state, no live result. Don't read it as a user-visible verification result, because it isn't one.

**2. The ranking attestation is written but never displayed.** Every catalog publish seals its ranking weights into a signed attestation, `ranking_receipt.json` (written unconditionally by `_write_ranking_receipt` in `backend/src/edgereco/catalog/publish.py`, signed in `backend/src/edgereco/reco/score_receipt.py`). An exhaustive search of the frontend finds **zero** code that reads or displays it. A user-facing "these are the weights that ranked your results, and here's the proof" badge is designed and signed but **unimplemented**.

> Footnote: the committed demo catalog in `backend/examples/catalog/` predates that feature, so it does not carry `ranking_receipt.json` on disk today. Its manifest lists exactly `products.jsonl`, `catalog_meta.json`, `ranking_config.json`, `cooccurrence.json`, `vector/embeddings.f32`, `vector/index.faiss`, `vector/state.json`. Older catalogs simply lack the receipt by design.

**3. The language model is not inside the signed catalog file.** It ships as ordinary same-origin static files instead — the build copies the model into `/models/` and its runtime into `/ort/`, each pinned to its exact content hash, so a first visit fetches everything from the app's own web address and no third-party CDN. But those files are not covered by the catalog's signature. The catalog format is just content-addressed bytes, so it *could* carry the model, signed and patched like the products; folding it in is a natural next step.

**4. There is no origin→device handoff yet.** Because the same engine runs on both sides, a deployment *could* serve recommendations from a server while the device downloads its copy in the background, then switch over silently — erasing the initial wait entirely. The foundations exist (both halves are tested to agree, a clean seam, incremental updates), but the automatic handoff is **not wired**. Today the browser boot is a blocking gate and the two shapes are separate deployment choices.

---

# How it works under the hood

Everything below is the technical depth. Each term is defined the first time it appears.

## The layers

EdgeReco is two layers, not one.

The bottom layer is [**edge-proc**](https://github.com/hseshadr/edge-proc) — a reusable local-compute engine: signed catalog delivery, an on-device cache, fail-closed verification, and the retrieval primitives. The top layer is **edge-reco** — the product-discovery brain: the scoring formula, the session-signal capture, and the session-aware re-ranker.

That split is real in both runtimes. The Python side depends on [`edge-proc[localvec,bundles]`](backend/pyproject.toml); the browser side runs [`@edgeproc/browser`](frontend/packages/edgeproc-browser/) over the same signed file. The lower layer is reusable for any local search workload; edge-reco is what turns it into recommendations, and the two halves are tested against each other to return identical results.

| Repo | Role |
| --- | --- |
| [**edge-reco**](https://github.com/hseshadr/edge-reco) (this repo) | the product brain — scoring formula, session signals, session-aware re-ranker, the Nimbus demo storefront. |
| [**edge-proc**](https://github.com/hseshadr/edge-proc) | the reusable local-compute layer — signed catalog delivery, on-device content-addressed cache, fail-closed Ed25519 + SHA-256 verification, and the retrieval primitives. **This is what makes on-device search possible.** |
| [**edgeproc-core**](https://github.com/hseshadr/edgeproc-core) | the vector-partitioning protocol edge-proc builds its local vector index on. On PyPI as [`edgeproc-core`](https://pypi.org/project/edgeproc-core/). |

You don't need to clone edge-proc or edgeproc-core — the backend pulls edgeproc-core from PyPI and edge-proc from public GitHub automatically (see [QUICKSTART](docs/QUICKSTART.md)).

## Architecture

![EdgeReco architecture: a signed, content-addressed catalog is built and signed in your cloud and served through a CDN edge cache; each shopper's device downloads it once, verifies it (Ed25519 + SHA-256, fail-closed), then runs search, ranking, and recommendations locally with zero backend calls. An optional, off-by-default learning loop sends batched anonymous activity back to retrain and republish the catalog, which every device re-syncs.](docs/diagrams/architecture.svg)

- **origin** — serves a *signed, content-addressed bundle*. A **bundle** is the one file-set your store hands out: the products, the prebuilt search index, and the ranking weights. *Content-addressed* means every piece is named by the hash of its own bytes, so it can be cached forever and can't be tampered with undetectably. It's structured as a `latest` version pointer plus immutable `manifest/<hash>` and `chunk/<hash>` objects. A committed 720-product bundle lives in `backend/examples/catalog/` (1.6 MB on disk).
- **edge** — a Caddy reverse proxy (a small static web server standing in for a CDN) applying the cache policy: immutable chunks cached forever, short-lived pointer.
- **browser tier** — the Nimbus single-page app **syncs** the bundle — *sync* meaning: fetch it, check its signature, and store it locally — into **OPFS** (Origin Private File System: a private, per-site sandboxed disk the browser gives each website). It verifies with Ed25519 signatures + SHA-256 checksums *fail-closed* (any mismatch aborts the load) against a key baked into the app build, loads the `all-MiniLM-L6-v2` model, and runs the full pipeline **in the tab**. No application server in the request path.
- **edgereco runtime (Python)** — the same engine packaged as a FastAPI app for the server-side case. Same scoring formula, same sync + verify, same prebuilt index — the in-browser engine is tested for parity against it.

<details>
<summary>Diagram source (Mermaid)</summary>

```mermaid
flowchart TB
  subgraph cloud["☁️ Your cloud — touched only to publish or retrain"]
    direction LR
    cat["📦 Product catalog"] --> build["🔏 Build + sign<br>index · embeddings · ranking"] --> origin["🗄️ Origin<br>signed, content-addressed bundle"]
  end
  origin --> edge["🌐 CDN edge cache<br>serves one small signed file"]
  edge ==>|"one-time download"| sync
  subgraph device["📱💻🖥️ Shopper's own device — every search + click runs HERE"]
    direction LR
    sync["⬇️ Sync + verify<br>Ed25519 · SHA-256 · fail-closed"] --> opfs["💾 On-device store (OPFS)"] --> engine["🧠 On-device engine<br>keyword + meaning → fuse → personalize"] --> recs["✨ Results + recommendations<br>instant · offline · 0 backend calls"]
  end
  subgraph learn["🔁 Optional learning loop — OFF by default"]
    direction LR
    uplink["📨 Batched, anonymous activity"] --> retrain["🔧 Retrain ranking + co-occurrence<br>re-sign the bundle"] --> republish["📤 Republish → every device re-syncs"]
  end
  recs -.->|"only if you turn it on"| uplink
  classDef cloudCls fill:#f0e8f8,stroke:#9472b0,color:#171717;
  classDef edgeCls fill:#f8f0e8,stroke:#c2925a,color:#171717;
  classDef deviceCls fill:#e8f8e8,stroke:#5fa85f,color:#171717;
  classDef learnCls fill:#e8f4f8,stroke:#5b9bbf,color:#171717;
  class cat,build,origin cloudCls;
  class edge edgeCls;
  class sync,opfs,engine,recs deviceCls;
  class uplink,retrain,republish learnCls;
```

</details>

## Hybrid search

Two retrieval methods run in parallel and get merged.

**BM25** is the classic keyword-relevance score — it ranks documents by how well their words match the query's words. It catches exact matches and is why "Bose QuietComfort Earbuds" comes back for "earbuds".

**Vector search** catches meaning. Each product title is turned into an **embedding** — a list of numbers positioning that text in a space where similar meanings sit close together. The query gets the same treatment, and **FAISS** (Facebook AI Similarity Search) finds the nearest products fast. This is why "aching back" reaches a massage gun, and "earbuds" reaches "wireless headphones".

The two rankings are fused with **RRF** (Reciprocal Rank Fusion) — a simple, tuning-free way to merge two ranked lists by position rather than by score, so neither method's scoring scale can dominate the other:

```
rrf_score = Σ 1/(k + rank_i)   summed over each method's rank for an item
```

## Session-aware re-ranking

**Re-ranking** means: take the search results, then reorder them for *this* shopper. Every interaction bumps a per-session affinity for the product's category, tags, and brand, by a weight that scales with how much intent it shows:

| event | category | tag | brand |
|---|---|---|---|
| view | +0.02 | +0.01 | +0.02 |
| click | +0.10 | +0.05 | +0.08 |
| favorite | +0.20 | +0.10 | +0.15 |
| cart | +0.25 | +0.12 | +0.20 |

Affinities clamp at 1.0; the last 50 viewed product IDs carry a repetition penalty so the rail keeps surfacing new things. The re-ranker rescores the candidates against that live profile:

```
score = 0.40·popularity + 0.20·category_aff + 0.15·tag_aff
      + 0.10·brand_aff + 0.10·freshness − 0.25·repetition
```

This loop is **zero-network**: a click folds straight into the in-memory session profile and the rail reorders on the spot — no fetch, no round trip. And it isn't a black box — each result carries a "Why?" breakdown showing exactly which signal moved it. It's in-memory and per-tab, so reloading starts fresh.

## Ranking is data, not code

Those weights aren't compiled in. They ride inside the signed bundle as `ranking_config.json`, alongside the "also bought" map (`cooccurrence.json`). **Retuning ranking is a data republish — no code change, no redeploy** — and both the Python and browser halves pick it up on their next sync.

The Python types are `RankingConfig` and `DEFAULT_RANKING_CONFIG`. They are not re-exported from any `__init__.py`, so import them from their module directly:

```python
from edgereco.reco.ranking_config import RankingConfig, DEFAULT_RANKING_CONFIG

w = DEFAULT_RANKING_CONFIG.scoring_weights
print("popularity", w.popularity, "| category", w.category, "| tag", w.tag)
print("brand", w.brand, "| freshness", w.freshness, "| repetition", w.repetition_penalty)
print("strategies:", ", ".join(sorted(DEFAULT_RANKING_CONFIG.strategies)))

# Retune: a store that wants brand loyalty over raw popularity.
tuned = DEFAULT_RANKING_CONFIG.model_copy(
    update={"scoring_weights": w.model_copy(update={"brand": 0.30, "popularity": 0.20})}
)
print("tuned brand:", tuned.scoring_weights.brand)
print("valid config:", isinstance(tuned, RankingConfig))
```

Real output:

```
popularity 0.4 | category 0.2 | tag 0.15
brand 0.1 | freshness 0.1 | repetition 0.25
strategies: also_bought, because_viewed, for_you, frequently_bought_together, new_arrivals, similar_items, trending
tuned brand: 0.3
valid config: True
```

`RankingConfig` carries four fields: `scoring_weights: ScoringWeights`, `interaction_weights: InteractionWeights`, `schema_version: int` (currently 3), and `strategies: dict[str, Strategy]` — the seven named strategies above, one per rail on the storefront.

`ScoringWeights` requires `popularity`, `category`, `tag`, `brand`, `freshness`, and `repetition_penalty`, and defaults `similarity` and `cooccurrence` to `0.0` so an older bundle reduces to the original formula exactly. Every weight is constrained `>= 0`, so an illegal weight in a signed config fails validation rather than silently ranking badly:

```
ValidationError: Input should be greater than or equal to 0
  [type=greater_than_equal, input_value=-1.0, input_type=float]
```

## Delivery and updates

The whole engine ships as **static files on a CDN** — the app code, plus the signed bundle holding the products, the *prebuilt* vector index, the ranking weights, and the "also bought" map. The live demo serves all of it from Cloudflare Pages, same-origin; any static host works. On first load the browser syncs the bundle into OPFS, verifies it fail-closed, and from then on runs locally.

**Updates are a patch, not a re-download.** Because every piece is named by the hash of its bytes, publishing a new bundle lets the client compare the new manifest against what's already on the device and fetch **only the pieces that changed** — reusing everything else, notably the large vector index. A retrain that only moves popularity scores and "also bought" edges re-fetches a few small pieces; the rest is a cache hit. As [DEPLOY.md](docs/DEPLOY.md) puts it: *"a one-line edit re-publishes one chunk; every consumer fetches one chunk and reuses the rest."*

## Server-side variant — publish → sync → serve

For the **optional** server-side API (the FastAPI runtime, not used by the browser demo above), reproduce the delivery loop with the CLI:

```bash
cd backend
uv sync --group dev

# 1. build a products.jsonl from a scraped-Amazon CSV
uv run edgereco build-catalog products.csv /tmp/staging/products.jsonl

# 2. build the vector index into the staging dir
uv run edgereco index /tmp/staging /tmp/staging

# 3. sign + publish a content-addressed bundle origin
uv run edgereco bundle /tmp/staging /tmp/origin examples/keys/private.key \
    --catalog-id amazon-demo --version v1 --product-count 720

# 4. serve by syncing that origin (a filesystem path works too) + verifying the key
EDGERECO_BUNDLE_BASE_URL=/tmp/origin \
EDGERECO_VERIFY_KEY_PATH=examples/keys/public.key \
EDGERECO_BUNDLE_CACHE_DIR=/tmp/bundle-cache \
    uv run edgereco serve /tmp/staging /tmp/staging --port 8000
```

The committed `backend/examples/catalog/` is exactly such an origin, so step 4 alone — pointed at it — serves the demo data.

## CLI

```
edgereco build-catalog INPUT.csv OUTPUT.jsonl           # scraped-Amazon CSV -> products.jsonl
edgereco preprocess INPUT.csv OUTPUT_DIR [--limit N]    # Kaggle-schema CSV -> jsonl + manifest
edgereco index STAGING_DIR INDEX_DIR                    # build the vector/ index
edgereco bundle STAGING_DIR ORIGIN_DIR PRIVATE_KEY      # sign + publish a bundle origin
edgereco serve CACHE_DIR INDEX_DIR [--host HOST] [--port PORT]
    # with EDGERECO_BUNDLE_BASE_URL + EDGERECO_VERIFY_KEY_PATH set, syncs + verifies a
    # signed bundle from that origin instead of reading the flat CACHE_DIR/INDEX_DIR.
edgereco search QUERY CACHE_DIR INDEX_DIR [--limit N] [--category CAT] [--json]
    # reads a flat preprocess-style dir (products.jsonl + manifest.json + vector/).
    # To search a signed bundle, sync it first — see the Python example above.
edgereco retrain BUNDLE_BASE_URL ORIGIN_DIR PRIVATE_KEY VERIFY_KEY
    # the cloud half of the loop: sync, recompute popularity (from the collector's
    # --events-url) + co-occurrence (from a --sessions JSONL log), re-sign, republish.
    # Pure data transform — the scoring formula never changes.
    [--events-url URL] [--sessions LOG.jsonl] [--alpha 0.5] [--version V]
edgereco audit BUNDLE_BASE_URL VERIFY_KEY [--sessions LOG.jsonl] [--alpha 0.5]
    # read-only preview of what a retrain would change. Never signs or publishes.
```

## Configuration

Both halves run on safe defaults — config is opt-in. To see the full surface, copy the example files (nothing in them is a secret):

```bash
cp backend/.env.example backend/.env     # EDGERECO_* recommender + DEMO_* API vars
cp frontend/.env.example frontend/.env   # VITE_BUNDLE_BASE_URL + test tooling
```

Vite auto-loads `frontend/.env`. The backend's `EDGERECO_*` vars are read from the process environment, so export them first (`set -a && source .env && set +a`) or pass them inline as in the publish→sync→serve steps above.

## Development

```bash
make gate                         # the full dual-stack quality gate — mirrors CI

# Backend (Python recommender)
cd backend
uv sync --group dev
uv run poe gate                   # format + lint + types + complexity + tests/coverage
uv run poe audit                  # dependency vulnerability scan (network; own workflow)

# Frontend (Nimbus storefront + @edgeproc/browser)
cd ../frontend
pnpm install                      # resolves the whole pnpm workspace (app + package)
pnpm -r run lint                  # biome on both workspace members
pnpm -r run typecheck             # tsc -b on both
pnpm -r run test                  # vitest on both
pnpm -F frontend run build        # prove the workspace link resolves
```

The repo follows strict test-first development: unit tests in `backend/tests/unit/`, behaviour scenarios in `backend/features/` with steps in `backend/tests/bdd/`, integration tests in `backend/tests/integration/`, end-to-end in `backend/tests/e2e/`.

## Data & attribution

This demo ships **two different catalogs** — don't confuse them:

| Catalog | Path | What it is |
| --- | --- | --- |
| **Demo data (the headline)** | `backend/examples/catalog/` | A committed, signed 720-product bundle of **real Amazon products**, balanced across **12 categories** (60 each) so session-aware re-ranking visibly personalizes. This is what Nimbus and the offline demo use. |
| Synthetic API fixture | `backend/demo_server/catalog/products.jsonl` | 300 **fabricated** products with made-up brands, used only by the optional FastAPI server. Not real data. |

The committed 720-product bundle is a balanced, curated subset of the **Amazon Reviews 2023** dataset (item metadata) by the McAuley Lab at UC San Diego ([amazon-reviews-2023.github.io](https://amazon-reviews-2023.github.io/), released for research use; cite Hou et al., *arXiv:2403.03952*). It is produced by `scripts/curate_demo_catalog.py` → `edgereco build-catalog` → `edgereco index` → `edgereco bundle`; you can regenerate it with the same commands.

This attribution is *not* a license to the underlying content: the product listings, titles, and images originate from Amazon.com and remain subject to Amazon's terms. See [`NOTICE`](NOTICE) for the full attribution and the rights caveat — and verify your rights before redistributing.

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — architecture, system context, request lifecycle (with d2 diagrams).
- [`docs/QUICKSTART.md`](docs/QUICKSTART.md) — clone → backend gate → frontend test → run the demo end to end.
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — backend-free vs edge-origin deployment patterns.
- [`docs/SECURITY-PRIVACY.md`](docs/SECURITY-PRIVACY.md) — threat model, privacy/egress inventory, retention, operator requirements.
- [`docs/diagrams/`](docs/diagrams/) — d2 sources + rendered SVGs.

## Repo layout

- `backend/` — Python project root (`pyproject.toml`, `uv.lock`).
  - `backend/src/edgereco/` — runtime: `catalog/` `embeddings/` `search/` `reco/` `edge/` `telemetry/` `api/` `cli.py` `config.py`
  - `backend/features/` — Gherkin behaviour specs, decoupled from step implementations
  - `backend/tests/` — `unit/` `bdd/` `integration/` `e2e/`
  - `backend/deploy/` — `Dockerfile`, `docker-compose.yml`, Caddy edge config
  - `backend/examples/catalog/` — committed signed 720-product bundle (`latest` + `manifest/` + `chunk/`)
  - `backend/examples/source/catalog.csv` — committed, reproducible build source (12 balanced categories)
  - `backend/examples/keys/public.key` — pinned Ed25519 verify key for the bundle
  - `backend/demo_server/` — optional FastAPI launcher (not in the main gate); ships the synthetic fixture
  - `backend/scripts/` — `curate_demo_catalog.py` + browser-tier parity-fixture generators
- `frontend/` — pnpm workspace root (`package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`).
  - `frontend/app/` — Nimbus React storefront (backend-free; syncs + runs the engine in-browser)
  - `frontend/packages/edgeproc-browser/` — `@edgeproc/browser`, the in-browser sync + hybrid-search engine
- `docs/` — `ARCHITECTURE.md` · `QUICKSTART.md` · `DEPLOY.md` · `SECURITY-PRIVACY.md` · `diagrams/`

## Security

The catalog bundle is Ed25519-signed and verified fail-closed on both halves. Found a hole? See [`SECURITY.md`](SECURITY.md) for the trust model and private reporting.

## License

[MIT](LICENSE). Third-party data attribution is in [`NOTICE`](NOTICE).
