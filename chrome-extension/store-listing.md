# Chrome Web Store listing

## Identity

- **Listing name:** Glaux — Private Local AI
- **Category:** Productivity
- **Language:** English
- **Homepage:** https://glaux-ai.vercel.app
- **Support:** https://github.com/rangan39/glaux/issues
- **Privacy policy:** https://glaux-ai.vercel.app/privacy

## Summary

Find compatible Hugging Face ONNX Community models and run them locally in Chrome with WebGPU.

## Detailed description

Glaux is an open-source browser workspace for local AI chat. Search the Hugging Face ONNX Community catalog, review a model’s compatibility and license, download its pinned ONNX artifacts into browser-private storage, and run prompts locally with WebGPU.

Glaux includes model search, popular-model discovery, Hugging Face model details, resumable browser storage, local chat, and developer views for generation metrics and token or word inspection.

Before downloading:

- Glaux shows the model’s exact estimated download size and available browser storage.
- Only compatible text-generation repositories can continue.
- Switching models removes the previous complete or partial model after confirmation.
- Model licenses vary and remain governed by their Hugging Face repositories.
- A current Chromium browser, WebGPU-capable GPU, sufficient memory, and sufficient browser storage are required.

Privacy:

- No account, cloud inference, advertising, telemetry upload, or human review.
- Prompts and responses are processed locally and retained only for the current page session.
- Catalog metadata and selected model files are downloaded from Hugging Face over HTTPS.
- Hugging Face and its delivery providers receive ordinary request metadata such as IP address and user agent. Prompts and responses are not included.

Glaux is independent and is not affiliated with, sponsored by, or endorsed by Hugging Face, Cohere, or model publishers.

## Single purpose

Run user-selected compatible ONNX text-generation models locally in Chrome without sending prompts or responses to an inference service.

## Permission justification

### `unlimitedStorage`

Glaux stores user-selected multi-gigabyte model artifacts in extension-origin OPFS and stores catalog metadata, immutable descriptors, integrity checkpoints, and runtime artifacts in IndexedDB and Cache Storage. This permission keeps the selected local model available between sessions.

### Host access

Hugging Face and related delivery hosts are used only to retrieve public ONNX Community catalog metadata and artifacts for models the user explicitly selects and confirms. Prompts, responses, Glaux application code, and WebAssembly are not uploaded to or downloaded from those hosts.

## Privacy-practices declarations

- Personally identifiable, health, financial, authentication, location, web-history, and website-content data: not collected.
- Personal communications and user-generated content: prompts and generated responses are handled locally for the chat feature; they are not transmitted or persistently stored.
- User activity: not collected for analytics, advertising, or tracking.

The privacy policy, store listing, dashboard declarations, and product UI must remain consistent with this file.
