# Glaux architecture

Glaux is a browser-only local AI workspace. Next.js serves the application shell, while model discovery, delivery, storage, tokenization, and inference run in the user’s browser. There is no Glaux inference service, job queue, VM, account system, or cloud fallback.

## Runtime flow

```text
Hugging Face ONNX Community
  → browser catalog and popular-model queries
  → immutable compatibility descriptor
  → confirmed OPFS download
  → persistent Web Worker
  → Transformers.js
  → ONNX Runtime Web / WebGPU
  → local chat and performance telemetry
```

The UI and worker communicate with typed messages. The worker owns the active Transformers.js pipeline, model initialization, streaming generation, cancellation, and runtime measurements. Prompts and responses remain in page memory and are never submitted to a repository-owned server.

## Model discovery

The sidebar exposes three views: model search, selected-model details, and Dev Mode. Search queries the public Hugging Face API for repositories in the `onnx-community` namespace. With an empty query, Glaux shows five popular compatible text-generation models. Results and hydrated metadata are cached in IndexedDB to make subsequent browsing responsive.

Catalog presence does not imply runtime compatibility. Before download, Glaux resolves the selected repository to an immutable revision and builds a descriptor that validates the declared task, supported architecture, chat template, tokenizer resources, ONNX graph, external data, sizes, and available integrity metadata. Unsupported or incomplete repositories fail closed with an actionable error.

## Download and storage

Users explicitly approve model downloads. Glaux preflights browser storage, then streams the pinned repository files from Hugging Face into the Origin Private File System. Resumable checkpoints and cache inventory live in IndexedDB. Browser Cache Storage holds runtime assets where required by Transformers.js.

Glaux keeps one complete or partial model at a time. Replacing it requires confirmation and removes the previous model data before the new transfer begins. Clearing site data removes the local catalog, descriptors, checkpoints, model files, and runtime caches. Storage persistence and eviction remain controlled by the browser.

## Inference

Compatible text-generation models run through Transformers.js and ONNX Runtime Web using WebGPU. Architecture-specific sessions, KV cache, tokenization, sampling, and streaming remain inside the worker. The UI reports local timing data including time to first token, decode throughput, time per output token, and end-to-end latency. Request-scoped stopping criteria cancel generation without tearing down a reusable loaded pipeline.

Model context limits, quantization, memory use, and performance are repository- and device-specific. Glaux reserves output capacity and compacts older conversation turns when necessary, but does not claim that every ONNX Community repository will run on every browser or GPU.

## Security and privacy boundaries

Network access is limited to loading the application and querying or downloading public model data from Hugging Face and its delivery hosts. Those providers receive ordinary request metadata such as IP address, user agent, paths, timing, and transfer size. Glaux does not attach prompts, responses, analytics identifiers, or advertising identifiers to those requests.

Repository revisions and file contracts are pinned before model installation. Downloads are checked against the integrity metadata available from Hugging Face, and descriptor mismatches fail closed. Model licenses are independent of the MIT-licensed Glaux source and must be reviewed on the selected repository.

## Compatibility identifiers

Some source filenames, CSS classes, DOM IDs, and browser-storage keys still use the historical lowercase `sophon` namespace. They are intentionally retained as internal compatibility identifiers so the Glaux rename does not invalidate existing browser storage or styling contracts. They are not current product branding.

## Deployment surfaces

The same browser runtime is delivered as:

- a Next.js web application hosted on Vercel;
- a containerized frontend for self-hosting.
