# Chrome Web Store listing

## Identity

- **Listing name:** Sophon — Private Local AI
- **Category:** Productivity
- **Language:** English
- **Homepage:** https://sophon-coral.vercel.app
- **Support:** https://github.com/rangan39/sophon/issues
- **Privacy policy:** https://sophon-coral.vercel.app/privacy
- **Affiliation:** Sophon is not affiliated with, sponsored by, or endorsed by Cohere or Hugging Face.

## Summary

Run multilingual Tiny Aya models locally in Chrome without sending prompts or responses to an inference service.

## Detailed description

Sophon brings private, multilingual AI chat to desktop Chrome. Select a Tiny Aya model, download its weights once, and run prompts locally with WebGPU. Prompts and generated responses stay in the browser and are never sent to an inference service.

Choose from Tiny Aya Global, Earth, Fire, and Water for different language-region strengths. Sophon shows model status and generation performance, supports resumable downloads, accepts verified offline model packs, and lets you delete each saved model from the model library.

Before downloading:

- Each selected model downloads approximately 2.35 GB and may take several minutes.
- A recent desktop Chromium browser, WebGPU-capable GPU, sufficient memory, and available browser storage are required.
- Tiny Aya weights are licensed under CC BY-NC 4.0 for non-commercial use and remain subject to the Cohere Labs Acceptable Use Policy.
- Sophon is an independent project and is not affiliated with, sponsored by, or endorsed by Cohere or Hugging Face.

Privacy:

- No account, cloud inference, analytics, advertising, telemetry upload, or human review.
- Prompts and responses are processed locally and kept only for the current page session.
- Model weights are downloaded from immutable Hugging Face revisions over HTTPS, checked by exact size and SHA-256, and stored in browser-private storage.
- Hugging Face and CDN providers receive ordinary request metadata such as IP address and user agent during a model download. Prompts and responses are not included.

## Single purpose

Run selected Tiny Aya language models locally in Chrome so users can chat without sending prompts or responses to an inference service.

## Permission justifications

### `unlimitedStorage`

Sophon stores user-selected multi-gigabyte model tensor data in extension-origin OPFS and stores integrity checkpoints plus packaged runtime artifacts in IndexedDB and Cache Storage. This permission keeps verified models available for local inference between sessions.

### Host access

`https://huggingface.co/*`, `https://*.huggingface.co/*`, `https://*.hf.co/*`, and `https://*.xethub.hf.co/*` are used only to download external tensor-weight files for a model the user explicitly selected and confirmed. Every model uses an immutable revision, exact allowlisted paths and sizes, whole-file SHA-256, and per-segment SHA-256. Prompts, responses, model configuration, ONNX graphs, JavaScript, and WebAssembly are never downloaded from these hosts.

## Privacy-practices declarations

- **Personally identifiable information:** Not collected.
- **Health information:** Not collected.
- **Financial and payment information:** Not collected.
- **Authentication information:** Not collected.
- **Personal communications:** User prompts and generated responses are handled locally for the user-facing chat feature; they are not transmitted or persistently stored.
- **Location:** Not collected.
- **Web history:** Not collected.
- **User activity:** Not collected.
- **Website content:** Not collected.
- **User-generated content:** Prompts are processed locally and retained only in page memory for the current conversation.

Certify that data use complies with the Chrome Web Store User Data Policy and its Limited Use requirements. The privacy policy, listing, dashboard declarations, and product UI must stay consistent with this file.
