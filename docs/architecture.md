# Sophon runtime architecture

Sophon is a browser-only local chat and compatibility tool for Cohere Labs' Tiny Aya language models in ONNX format. Its support claims are intentionally narrower than its model catalog.

## Runtime flow

```text
Compiled model manifest
  → persistent model worker
  → online ranges OR local .sophon-model pack
  → shared resumable OPFS delivery / verified File objects
  → Transformers.js pipeline
  → ONNX Runtime provider
  → token telemetry / generation result
```

The browser owns one long-lived worker. Its initial cache-inventory path loads only storage metadata; the Transformers.js and ONNX runtime chunk is imported on demand when a model is selected. Requests are queued inside that worker so model loading and inference cannot race. Loaded sessions remain available across prompts until the user changes models, explicitly unloads a model, or closes the page. Generation cancellation is request-scoped so stopping a response preserves the loaded model cache. A shared discriminated protocol validates requests, events, and completed results at the worker boundary. Operations have recovery timeouts; a timed-out or malformed worker is terminated so the UI cannot remain pending forever.

## Repository boundary

Sophon has no inference server or server fallback. Next.js delivers the application shell; the Web Worker owns model delivery, tokenization, sessions, generation, and telemetry. Model artifacts are fetched from pinned Hugging Face revisions only after an explicit user selection. Prompts are never routed through a repository-owned API.

## Model support levels

- `verified`: Sophon has a known graph contract and has validated the model against its own runtime.
- `experimental`: a compatible repository is known, but Sophon has not certified the graph, tokenizer, provider support, and generation behavior together.

The current four-model catalog is experimental. Each entry may fail on a particular browser or device until its graph and tokenizer combination completes the conformance suite.

## Unified model adapter

The Tiny Aya models use the Transformers.js text-generation pipeline. The pipeline owns architecture-specific ONNX sessions, KV-cache tensors, sampling, browser caching, and provider integration. A `TextStreamer` timestamps generated token IDs before the completed result returns, while request-scoped stopping criteria cancel generation without destroying the loaded pipeline.

Each Tiny Aya variant is a 3.35B q4f16 graph with an adaptive profile: 8K context and 48 output tokens on desktop, 2K context and 24 output tokens on mobile. Every model requires WebGPU. Chromium uses a high-performance adapter preference and full ONNX graph optimization; Transformers.js pins supported KV-cache outputs to GPU buffers. Graph capture remains disabled because autoregressive generation uses dynamic shapes. Sophon reserves output-token capacity, removes the oldest complete conversation turns when necessary, and left-truncates only when one remaining turn still exceeds the budget.

The q4f16 graph, tokenizer, and configuration files total about 2.35 GB per variant. Verified weights are retained in browser-private origin storage; selecting another variant releases the active worker but retains completed files and flushed download segments on disk.

Conversations remain structured until they reach the pipeline, allowing the Cohere tokenizer to apply its native chat template.

## Model delivery and integrity

The registry is paired with an allowlisted artifact manifest containing immutable repository revisions, exact paths, byte sizes, and SHA-256 digests. The existing model worker is also the delivery worker, which keeps main-thread work and cross-worker copies out of the hot path.

Supported browsers use one global adaptive queue for Tiny Aya HTTP range requests. Capable desktop Chromium devices start with six streams and can probe up to twelve; Chromium devices with no more than 4 GB reported memory or four logical processors start with four and cap at eight. Other desktop browsers start with four and can probe up to twelve. Mobile starts with two and caps at four. Capable desktop Chromium devices also use four cached-segment verification workers; all other profiles use two. Every profile measures completed-range goodput in bounded epochs and backs off multiplicatively after transient failures. A build-time environment flag disables upward probing while retaining each device tier's conservative starting point.

Each 64 MiB segment is streamed into an OPFS synchronous access handle at its final byte offset and hashed as its response arrives. Fixed-size segment digests are generated from immutable revisions, checked against the existing whole-file hashes, and pinned with the runtime manifest. A segment becomes eligible for a durable checkpoint only after its exact size and digest match; transient corruption retries only that range. This removes the complete 2.33 GB verification reread from fresh downloads.

Strong ETags and `If-Range` protect resumed files from remote revision drift. Downloads resumed from older partial state use an ordered incremental hasher that reads newly contiguous segments while later requests remain active, preserving whole-file verification without delaying all hashing until the network finishes. Ready files are still rehashed once per worker session before reuse, so a stale metadata record alone cannot authorize runtime bytes.

Completed segments are checkpointed after four completions or one second, whichever comes first. A checkpoint flushes OPFS before committing its completed-segment set through a strict IndexedDB transaction. This order permits bounded redundant work after a crash but never records an unflushed segment as resumable. Graceful completion and cancellation drain the outstanding batch.

The allowlist covers ONNX graphs, Tiny Aya external-data files, configuration, generation settings, and tokenizer resources at immutable repository commits. Graphs, configuration, generation settings, and tokenizers are deduplicated into the application package and hashed before they enter Transformers.js-compatible Cache Storage. Only the two external tensor sidecars per model remain remote. Tiny Aya weights use OPFS only, avoiding a duplicate CacheStorage copy. Sophon then initializes each pipeline in local-files-only mode. Missing packaged files, unavailable platform APIs or quota, absent required range support, contract violations, and integrity failures all fail closed.

Offline packs are a second byte source for this state machine, not a second cache. A worker-only parser reads the fixed preamble and at most 1 MiB of canonical JSON, validates every safe-integer range, and requires a byte-for-byte identity match with the compiled model, revision, quantization, artifact, segment-digest, license, attribution, model-card, and acceptable-use allowlist. No pack-provided URL, content type, path, script, Wasm module, or runtime option becomes authoritative.

The importer takes the same exclusive per-model Web Lock used by deletion and conflicts with online delivery. It reads each payload range with `Blob.slice().stream()`, hashes and writes bounded chunks at their final OPFS offsets, flushes the synchronous access handle, and only then records a verified segment checkpoint. Small verified graph/config/tokenizer artifacts enter the existing Transformers.js CacheStorage keys. After all artifact bytes arrive, the worker performs ordered whole-file verification, commits all external artifacts to `ready` in one strict IndexedDB transaction, and marks the session verification cache. Failure or cancellation can leave verified partial checkpoints but cannot create a runnable model.

Preload and generation requests share the worker's targeted cancellation protocol. Cancelling a preload aborts probes and response readers but retains every flushed checkpoint; selection can resume it later. Cache inspection combines IndexedDB checkpoints, OPFS file sizes, and auxiliary CacheStorage entries. Where Web Locks are available, deletion takes an exclusive per-model lock; the worker also serializes the operation, disposes the live pipeline, and removes all three storage layers.

The artifact release pipeline lives outside `src`. It converts the current 1.92 GiB + 256 MiB sidecars into five balanced, conventionally named shards, rewrites ONNX external locations, stably topologically orders the upstream node definitions, updates the Transformers.js shard count, and proves tensor identity before publication. It never runs during a Next.js or Vercel build.

## Metrics

Sophon timestamps tokens inside the worker, on the same monotonic clock as inference. Timing begins after model loading and before prompt tokenization, so model download/load time is reported separately. It reports:

- model load/reuse time
- time to first token (TTFT)
- end-to-end generation latency
- decode tokens per second, excluding the first output token
- time per output token (TPOT)
- p95 inter-token latency in the completed result
- tokenizer-derived input and output token counts
- provider used for the run

For output token timestamps `t[0..n-1]` and request start `s`, the core calculations are:

```text
TTFT       = t[0] - s
E2E        = t[n-1] - s
Decode TPS = 1000 × (n - 1) / (t[n-1] - t[0])
TPOT       = (t[n-1] - t[0]) / (n - 1)
```

Decode TPS and TPOT remain unavailable until at least two output tokens exist. Sophon does not estimate browser GPU memory because browsers do not expose a reliable cross-platform value.

Request-scoped worker events expose the same measurements during decoding without launching extra inference or blocking chat. Completed metrics are attached to the generation result, and the compact chat metadata surfaces the most useful values without a permanent telemetry panel.

## Cross-origin isolation

COOP/COEP headers are intentionally deferred. The external tensor path can follow Hugging Face redirects to multiple signed artifact and CDN origins, and the repository does not yet run a conformance check proving that every response in that chain satisfies COEP. Enabling cross-origin isolation before that check could block otherwise valid weight downloads. Add the headers only alongside an end-to-end delivery test for every supported remote source.

## Frontend delivery budget

The initial layout/page entry set is capped at 56 KiB gzip. Info hints use a focused portal-based implementation instead of a general-purpose component package; the measured production entry set is 47,044 bytes gzip. This gate measures the existing Next.js entry-manifest boundary, not every deferred chunk requested by the route or the on-demand inference runtime.

## Token display

Generation results include exact tokenizer IDs and individually decoded text for the latest user turn and generated output. Messages render as clean text by default; the opt-in token and word modes expose boundaries, token indexes, vocabulary IDs, and active-context state on hover, click, or keyboard focus. Input tokens removed by context truncation remain visible but are marked as windowed out.

## Next technical milestones

1. Publish and benchmark the verified five-shard derivatives, then pin their immutable revisions.
2. Add explicit per-model cache inspection and deletion controls before automatic eviction is considered.
3. Add model conformance fixtures that validate tokenizer, graph inputs/outputs, EOS behavior, chat templates, and provider compatibility.
4. Add a cross-origin delivery test before enabling threaded-WASM isolation headers.
