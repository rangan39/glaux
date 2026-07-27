# Sophon

Sophon is an open-source, multilingual AI web tool that runs ONNX language models locally in a browser with WebGPU. Prompts stay on the device instead of traveling to an inference server.

Production app: [sophon-coral.vercel.app](https://sophon-coral.vercel.app)

Sophon’s code is available under the [MIT License](LICENSE). The included Tiny Aya models are open weights subject to CC BY-NC 4.0 and the Cohere Labs Acceptable Use Policy; they are limited to non-commercial use.

## What it does

- Chats with a local ONNX model directly in the browser
- Uses WebGPU through Transformers.js and ONNX Runtime Web
- Keeps model loading and inference off the main UI thread
- Loads the large Transformers.js/ONNX runtime only after a model is selected
- Downloads a model only after the user selects it from a strict registry
- Resumes interrupted weight downloads from verified browser-private storage
- Shows model, runtime, and generation status in a compact HUD-style interface
- Offers Cohere Labs' Tiny Aya Global, Earth, Fire, and Water variants
- Measures normal chat generations with tokenizer-derived TTFT, decode throughput, TPOT, and end-to-end latency
- Provides an opt-in text/token/word lens with exact token IDs and context-window status

## Stack

- Next.js App Router
- React 19 and strict TypeScript
- Tailwind CSS and native platform controls
- Transformers.js
- ONNX Runtime Web and WebGPU
- OPFS, IndexedDB, and streaming SHA-256 verification
- Vercel

## Run locally

Use Node.js 22 (the repository includes an `.nvmrc`), then install exactly from the lockfile:

```bash
nvm use
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Build and validate the production bundle:

```bash
npm run build
npm run budget:bundle
npm run check
npm run audit:production
npm run build:extension
npm run smoke:extension
npm run audit:extension
```

See [`docs/security/dependency-audit.md`](docs/security/dependency-audit.md) for
the production audit gate and the bounded development-only ESLint advisory.

WebGPU works best in a recent browser with WebGPU enabled. Opening Sophon does not download model weights; an explicit Tiny Aya selection downloads and caches about 2.35 GB. Sophon stores one model at a time, so choosing another model removes all saved model files—including partial downloads—before starting the new download from scratch.

### Product-test states

Start the development-only product fixture workflow with one command:

```bash
npm run product:ui
```

The root page opens the deterministic `checking` state. Use these URLs to review the complete lifecycle at the desktop `1440×900` and mobile `320×800` breakpoints:

| State | URL |
| --- | --- |
| Browser/cache check | [checking](http://localhost:3000/?sophon-product-test=checking) |
| Legacy model cleanup | [legacy-cleanup](http://localhost:3000/?sophon-product-test=legacy-cleanup) |
| Legacy cleanup failure | [legacy-cleanup-error](http://localhost:3000/?sophon-product-test=legacy-cleanup-error) |
| Download confirmation | [confirmation](http://localhost:3000/?sophon-product-test=confirmation) |
| Model replacement confirmation | [replacement-confirmation](http://localhost:3000/?sophon-product-test=replacement-confirmation) |
| Model replacement cleanup | [replacement-deleting](http://localhost:3000/?sophon-product-test=replacement-deleting) |
| Download progress | [downloading](http://localhost:3000/?sophon-product-test=downloading) |
| Paused download | [paused](http://localhost:3000/?sophon-product-test=paused) |
| Integrity verification | [verifying](http://localhost:3000/?sophon-product-test=verifying) |
| Ready transcript, metrics, tokens, and long Markdown | [ready](http://localhost:3000/?sophon-product-test=ready) |
| Streaming generation | [generating](http://localhost:3000/?sophon-product-test=generating) |
| Stopped generation recovery | [stopped](http://localhost:3000/?sophon-product-test=stopped) |
| Recoverable runtime error | [error](http://localhost:3000/?sophon-product-test=error) |
| Reset confirmation | [reset](http://localhost:3000/?sophon-product-test=reset) |

Fixture mode replaces runtime capabilities, storage inventory, delivery progress, and generation data in memory. It does not create the model worker, contact model hosts, or write model bytes. The query parameter is ignored by normal development, production, and Chrome-extension builds; activation requires both `next dev` and the explicit opt-in set by `npm run product:ui`.

With that server running, validate every state at both breakpoints with:

```bash
npm run smoke:product-ui
```

### Chrome extension

`npm run build:extension` creates a self-contained Manifest V3 extension in `dist/chrome-extension`. Its toolbar action opens Sophon in a full extension tab, where `unlimitedStorage` protects the multi-gigabyte OPFS, IndexedDB, and Cache Storage model cache. The build externalizes Next.js hydration scripts so the result complies with Chrome's extension-page CSP while retaining local WebAssembly support. Load the output folder from `chrome://extensions` with Developer mode enabled.

The extension has its own `chrome-extension://` storage origin. Models downloaded on `localhost` or the hosted web app are not shared with it, so download the model again inside the extension.

Probe the pinned model CDN across repeated concurrency trials (defaults: three trials, 64 MiB per trial, concurrency 1/2/4):

```bash
npm run benchmark:download
```

Override the matrix when comparing a particular connection:

```bash
SOPHON_BENCHMARK_TRIALS=5 \
SOPHON_BENCHMARK_BYTES=134217728 \
SOPHON_BENCHMARK_CONCURRENCY=2,4,6,8,12 \
npm run benchmark:download
```

Build and run the production container:

```bash
docker build -f Dockerfile.frontend -t sophon .
docker run --rm -p 3000:3000 sophon
```

`docker compose up frontend` uses the Dockerfile's development target with source mounts and hot reload.

The repository has no inference backend. The browser worker owns model loading, tokenization, generation, and telemetry in both development and production.

## Model architecture

Models are defined in [`src/lib/onnx-models.ts`](src/lib/onnx-models.ts). The registry records provider preference, quantization, context, source revision, and verification status:

```text
Model manifest → persistent browser Web Worker → Transformers.js pipeline → ONNX Runtime provider → token telemetry → chat UI
```

The current registry includes:

- Tiny Aya Global — balanced multilingual coverage
- Tiny Aya Earth — optimized for West Asian and African languages
- Tiny Aya Fire — optimized for South Asian languages
- Tiny Aya Water — optimized for European and Asia-Pacific languages

The four Tiny Aya entries are 3.35B-parameter q4f16 ONNX conversions. They use an 8K context and 48-token default on desktop, then switch to a 2K context and 24-token default on mobile hardware. Every model is WebGPU-only, pinned to an immutable repository revision, and marked `experimental` until Sophon certifies each tokenizer, graph, and browser combination. Chromium browsers request the high-performance GPU adapter and load the model with full ONNX graph optimization; Transformers.js keeps Tiny Aya's KV-cache outputs on the GPU.

Tiny Aya is an open-weights research release governed by CC BY-NC 4.0 and the Cohere Labs Acceptable Use Policy; commercial use is not permitted under that license. Each variant has a separate browser cache key, but Sophon keeps only one model download at a time to bound normal model storage near 2.35 GB.

## Model delivery and caching

Selecting a model starts a pinned Hugging Face download of external tensor weights inside the browser worker. The ONNX graph, model configuration, generation configuration, and tokenizer are packaged with Sophon, verified against their compiled size and SHA-256, and seeded into local Cache Storage. Tiny Aya weights download in 64 MiB ranges through a bounded adaptive queue. Capable desktop Chromium devices warm up with six requests and can probe up to twelve; constrained Chromium devices start at four and cap at eight. Other desktop browsers start at four and can probe up to twelve, while phones start at two and cap at four to reduce memory and radio pressure. Chromium also verifies cached model segments with up to four workers on capable desktops. Every range is streamed directly into the Origin Private File System and simultaneously checked against a pinned segment SHA-256 digest. A corrupt response retries only its range, and a fresh download does not need a final OPFS reread. Resumed downloads retain the complete ordered SHA-256 path as a compatibility fallback and overlap it with remaining network work.

Completed ranges become resumable in batches of four or after one second, whichever comes first. Every checkpoint flushes OPFS before its strict IndexedDB commit, so a crash can cause bounded redundant downloading but cannot authorize bytes that were not durably written. Reloading or pausing the same model can therefore reuse durable ranges; switching models deliberately removes them and starts from scratch. Set `NEXT_PUBLIC_SOPHON_ADAPTIVE_DOWNLOADS=0` before building to disable upward probing while retaining the device tier's conservative starting point.

Verified OPFS `File` objects are handed to Transformers.js as ONNX external data, so weights are not duplicated in CacheStorage. Packaged graph, configuration, generation settings, and tokenizer files are pinned by exact size and SHA-256, verified by Sophon, and stored under Transformers.js-compatible CacheStorage keys. They are never fetched from a remote model host. A cached artifact is rehashed once per browser-worker session before runtime use.

Delivery fails closed when OPFS, synchronous worker access, CacheStorage, strong validators, or HTTP ranges are unavailable; there is no unverified multi-gigabyte fallback. Sophon checks the browser's available storage before starting and distinguishes failures to open, resize, write, flush, checkpoint, cache, or delete model data. Storage errors include the browser's reported usage, quota, available capacity, and persistence status when those estimates are available. Model selection also makes a best-effort persistent-storage request, while the browser retains final control over quota and eviction.

Pressing Pause aborts active network reads without discarding flushed 64 MiB checkpoints, so the same model can resume. Switching models first stops the live pipeline, removes all saved model files—including old partial data for the selected model—from OPFS, IndexedDB, and CacheStorage, verifies that cleanup, and only then starts a fresh download. At startup, Sophon automatically removes legacy storage containing more than one model before attempting auto-restore; a failed cleanup blocks model actions and exposes a retry. Returning to the previous model also requires a fresh download. The model library distinguishes partial and fully cached models, provides explicit deletion, and reports approximate site usage and quota through the Storage API.

## Repacking model artifacts

The checked-in artifact seed records the exact upstream files, immutable revisions, sizes, and hashes for all four models. Build-only tooling can repack the current imbalanced two-file q4f16 layout into five approximately 448 MiB ONNX sidecars without changing tensor bytes or node definitions. It also topologically orders the upstream nodes so the derivative passes the ONNX checker:

```bash
python3.12 -m venv artifacts/model-build-venv
artifacts/model-build-venv/bin/pip install -r scripts/model-build-requirements.txt
artifacts/model-build-venv/bin/python scripts/reshard_onnx.py \
  --model-id tiny-aya-global \
  --input-dir artifacts/models/tiny-aya-global-source \
  --output-dir artifacts/models/tiny-aya-global-five-shard
artifacts/model-build-venv/bin/python scripts/verify_model_artifacts.py \
  --artifact-dir artifacts/models/tiny-aya-global-five-shard \
  --source-dir artifacts/models/tiny-aya-global-source
```

The source snapshot must contain every pinned file recorded in `models/model-artifacts.seed.json`; unrelated files are ignored. Process one model at a time and publish verified derivatives to immutable Hugging Face revisions; model weights do not belong in the Next.js or Vercel build.

## Project layout

```text
src/components/sophon-workbench.tsx  Chat/HUD interface
src/components/ui/                    Small shared message/button primitives
src/lib/onnx-models.ts                 Model registry
src/lib/model-delivery/                Resumable OPFS model transport
src/lib/generation-metrics.ts          Standardized token timing calculations
src/lib/onnx-worker-protocol.ts         Validated worker message boundary
src/lib/onnx-runner.ts                 Unified generation pipeline
src/workers/onnx-worker.ts             Background inference worker
```

## Limitations

WebGPU support and ONNX operator coverage vary by browser and device. Model downloads are client-side, and the app currently reports runtime failures rather than falling back to a server inference provider.

OPFS removes repeated network work and bounds download buffers, but ONNX Runtime still materializes the complete external data while creating a WebGPU session. Browser storage is not GPU or unified memory.

All models use architecture-specific KV caching through Transformers.js. See [`docs/architecture.md`](docs/architecture.md) for support semantics and metric definitions.

Long prompts are accepted, but each runtime profile has a bounded active context. Sophon uses 2K on phones and 8K on desktop. It reserves space for the response, removes the oldest complete turns first, then left-truncates an oversized remaining turn and reports how many earlier tokens were omitted.
