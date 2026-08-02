# Glaux

Glaux is an open-source local AI workspace for running compatible Hugging Face ONNX Community text-generation models directly in a browser with WebGPU. Prompts and generated responses stay in the browser; Glaux has no inference server, account system, analytics, or cloud fallback.

Production app: [glaux-ai.vercel.app](https://glaux-ai.vercel.app)

The application is MIT licensed. Model weights retain the license published by each Hugging Face repository.

## Current product

- Searches the `onnx-community` namespace from the browser and keeps a local searchable catalog in IndexedDB.
- Shows five popular text-generation models when the search field is empty.
- Pins a selected repository to an immutable Hugging Face revision and validates its task, architecture, chat template, graph, file sizes, and integrity metadata before download.
- Downloads ONNX graphs and external tensor data directly into browser-private OPFS storage with resumable checkpoints.
- Runs tokenization and WebGPU inference in a persistent Web Worker through Transformers.js and ONNX Runtime Web.
- Stores one model at a time and confirms replacement before deleting the existing model.
- Restores compatible downloaded community models across browser sessions.
- Provides model search, Hugging Face model details, and developer inspection views in the sidebar.
- Reports token timing, TTFT, decode throughput, TPOT, and end-to-end generation latency.
- Supports token- and word-level response inspection in Dev Mode.

## Requirements

- A current Chromium-based browser with WebGPU enabled
- A WebGPU-capable GPU and sufficient system/GPU memory for the selected model
- Enough browser storage for the selected model’s exact confirmed download size
- Node.js 22 for local development

Model compatibility and performance vary by architecture, graph, tokenizer, browser, and hardware. Glaux fails closed when a model cannot satisfy its browser-runtime contract.

## Run locally

```bash
nvm use
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Common validation commands:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run budget:bundle
npm run audit:production
```

## Browser-only architecture

```text
Hugging Face catalog
  → browser-side metadata index
  → immutable compatibility descriptor
  → OPFS model delivery
  → persistent Web Worker
  → Transformers.js
  → ONNX Runtime Web / WebGPU
  → local chat and developer telemetry
```

Next.js serves the application shell only. No repository-owned API receives prompts, responses, model selections, or runtime measurements. Hugging Face and its delivery providers receive ordinary network metadata only when the user searches the public catalog or confirms a model download.

See [docs/architecture.md](docs/architecture.md) for runtime and compatibility details and [docs/security/dependency-audit.md](docs/security/dependency-audit.md) for dependency policy.

## Storage and model delivery

Community model descriptors and catalog metadata are stored in IndexedDB. Model files are streamed into the Origin Private File System. Downloads are pinned to immutable revisions, preflighted against browser quota, and checked against the integrity metadata available from Hugging Face. Glaux keeps one model download at a time; selecting another model removes the previous model’s complete or partial data only after confirmation.

Clearing site data removes the local catalog, saved descriptors, checkpoints, models, and runtime caches. Browser eviction behavior remains under browser control.

## Product-test states

Start deterministic development fixtures without downloading a model:

```bash
npm run product:ui
```

Fixture URLs use `?glaux-product-test=<state>`. Available states include `checking`, `confirmation`, `downloading`, `paused`, `verifying`, `ready`, `generating`, `stopped`, `error`, and `reset`.

```bash
npm run smoke:product-ui
```

Fixture mode does not create the inference worker, contact model hosts, or write model bytes.

## Container

```bash
docker build -f Dockerfile.frontend -t glaux .
docker run --rm -p 3000:3000 glaux
```

## Project layout

```text
src/components/sophon-workbench.tsx   Main chat workspace
src/components/sophon-model-sidebar.tsx  Search, details, and Dev Mode views
src/lib/model-catalog/                Browser catalog and immutable descriptors
src/lib/model-delivery/               OPFS downloads and cache inventory
src/lib/onnx-runner.ts                Transformers.js pipeline orchestration
src/workers/onnx-worker.ts            Browser inference worker
```

The historical lowercase `sophon-*` CSS and storage namespaces remain internal compatibility identifiers so existing installations do not lose cached model data during the Glaux rename.

## License

Glaux source code is available under the [MIT License](LICENSE). Model licenses are separate and must be reviewed on the selected Hugging Face repository before use.
