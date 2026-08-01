# Glaux Chrome extension

Glaux is packaged as a Manifest V3 extension named **Glaux — Private Local AI**. It runs compatible Hugging Face ONNX Community text-generation models locally through WebGPU.

## Build and test

```bash
npm ci
npm run build:extension
npm run smoke:extension
npm run audit:extension
```

Load `dist/chrome-extension` from `chrome://extensions` with Developer mode enabled. The toolbar action opens Glaux in a full extension tab.

## Runtime boundary

- Application JavaScript, WebAssembly, UI assets, and the browser worker are packaged with the extension.
- Model metadata and user-selected ONNX artifacts are fetched from immutable Hugging Face revisions after explicit selection and download confirmation.
- Prompts and responses remain in the extension page and are never sent to a Glaux inference service.
- Model files live in extension-origin OPFS; catalog metadata, descriptors, and checkpoints use extension-origin IndexedDB and Cache Storage.
- The extension requests `unlimitedStorage` because compatible models can require multiple gigabytes.

The extension and hosted web app use different browser origins and do not share downloaded models.

## Store material

- Listing and privacy declarations: [store-listing.md](store-listing.md)
- Reviewer instructions: [REVIEWER.md](REVIEWER.md)
- Privacy policy: [glaux-ai.vercel.app/privacy](https://glaux-ai.vercel.app/privacy)
- Store graphics: [store-assets/](store-assets/)

Regenerate visible assets after identity or UI changes:

```bash
npm run build:extension
npm run assets:extension
```

## Release

Keep `package.json` and `chrome-extension/manifest.json` versions aligned, then run:

```bash
npm run release:extension
```

The release workflow validates the repository, builds and audits the extension, creates a reproducible ZIP, verifies its SHA-256, and smoke-tests the exact packaged artifact. It does not publish to the Chrome Web Store automatically.
