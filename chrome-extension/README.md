# Sophon Chrome extension

Sophon is packaged as a public Manifest V3 extension named **Sophon — Private Local AI**. The submitted code contains all application JavaScript, WebAssembly, ONNX graphs, model configuration, generation configuration, and tokenizer files. Runtime network downloads are limited to immutable external tensor-weight files.

## Local build

Install exactly from the lockfile, then build and smoke-test the unpacked extension:

```bash
npm ci
npm run build:extension
npm run smoke:extension
npm run audit:extension
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `dist/chrome-extension`.

The toolbar action opens Sophon in a full extension tab. Model files are stored under the extension origin, so downloads from `localhost` or the hosted web app are not shared with the extension.

## Model-code policy boundary

- Remote: only `onnx/model_q4f16.onnx_data` and `onnx/model_q4f16.onnx_data_1` tensor sidecars for each model.
- Packaged: application JavaScript, ONNX Runtime WebAssembly, ONNX graph, `config.json`, `generation_config.json`, `tokenizer.json`, and `tokenizer_config.json`.
- Every remote tensor file is pinned by a 40-character immutable revision, exact path, exact byte size, whole-file SHA-256, and 64 MiB segment SHA-256.
- `public/model-runtime/artifacts.json` lists the deduplicated packaged model-logic files and their exact hashes.
- The build rejects executable inline scripts, remote scripts, remote WebAssembly, reserved Chrome paths, packaged `.onnx_data`, packaged `.sophon-model`, version drift, or a 128px icon outside the required safe area.
- `npm run audit:extension` independently hashes model logic and emits the complete remote-tensor allowlist.

`npm run fetch:model-logic` reconstructs the seven deduplicated packaged files from the pinned upstream revisions. Release builds use the checked-in files and do not fetch anything.

## Offline model pack

To install a model without downloading it again:

1. Open **Models** and find the matching Tiny Aya region.
2. Choose **Import offline pack**.
3. Select its `.sophon-model` file.
4. Review the pinned revision, required storage, CC BY-NC attribution, model card, and Cohere Labs AUP.
5. Accept the non-commercial terms and choose **Import and verify**.

The import runs in the model worker and reports `Validating → Importing → Verifying → Ready`. It writes only exact allowlisted data into the same browser-private cache used by online downloads. Cancelling keeps flushed verified segments; selecting the same file resumes them. A corrupt, stale, truncated, wrong-model, or trailing-data pack fails closed. The source pack remains in the user's filesystem and is not copied into the extension package.

## Store material

- Listing copy, single-purpose statement, permission justifications, and privacy-practices answers: [`store-listing.md`](store-listing.md)
- Reviewer instructions: [`REVIEWER.md`](REVIEWER.md)
- Privacy policy source: [`src/app/privacy/page.tsx`](../src/app/privacy/page.tsx), published at https://sophon-coral.vercel.app/privacy and included as `privacy.html`
- Required and optional graphics: [`store-assets/`](store-assets/)

Regenerate screenshots and promotional graphics after a visible product or identity change:

```bash
npm run build:extension
npm run assets:extension
```

## Release

Keep `package.json` and `chrome-extension/manifest.json` versions identical. The build and audit fail when they differ.

Run the complete release gate from a clean checkout:

```bash
npm ci
npm run release:extension
```

The release command:

1. Runs lint, type checking, and all tests.
2. Builds the extension.
3. Loads the unpacked build in a clean Chromium profile and confirms the model-download dialog before any Hugging Face request.
4. Audits the package for remote JavaScript/WebAssembly, forbidden payloads, permissions, pinned remote tensors, and packaged model logic.
5. Creates `artifacts/chrome-web-store/sophon-<version>.zip` with `manifest.json` at its root.
6. Normalizes file order, modes, and timestamps so the ZIP is reproducible.
7. Writes `sophon-<version>.zip.sha256`.
8. Rebuilds from scratch, packages again, and requires the second ZIP SHA-256 to match.
9. Extracts that exact ZIP, audits it again, and loads it in a second clean Chromium profile for the final smoke test.
10. Writes `sophon-<version>-audit.json` for the reviewed ZIP.

Re-running `npm run package:extension` against identical build output must produce the same SHA-256.

## Manual release checklist

Automated checks deliberately stop short of downloading 2.35 GB or publishing externally. Before submission, test the exact release on supported desktop Chrome:

- First run and WebGPU compatibility gate.
- Download disclosure, size, license, storage estimate, and explicit confirmation.
- Pause, close Chrome, reopen, and resume from verified progress.
- Complete download and local inference with DevTools showing that prompts are not transmitted.
- Disconnect the network after the model is ready and verify local inference.
- Import a matching offline pack and reject a corrupt or wrong-model pack.
- Delete a partial model and a completed model.
- Reset the conversation and verify page reload clears it.
- Uninstall the extension and confirm its extension-origin data is removed.

For the first submission:

1. Use a verified Chrome Web Store publisher account with two-step verification and the registration fee completed.
2. Upload the ZIP as **Private** or **Trusted Testers**.
3. Copy the listing and privacy declarations exactly from `store-listing.md`.
4. Copy the environment and test flow from `REVIEWER.md`.
5. Select deferred publishing.
6. Validate the approved build with trusted testers before changing visibility to **Public**.

Request Chrome Web Store support clarification about remotely downloaded immutable tensor sidecars before public submission, because Google has not published a model-specific ruling for external ONNX data. For future automated updates, use Chrome Web Store API v2; do not add new v1 automation.
