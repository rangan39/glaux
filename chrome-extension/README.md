# Sophon Chrome extension

Build the unpacked Manifest V3 extension:

```bash
npm run build:extension
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `dist/chrome-extension`.

The toolbar action opens Sophon in a full extension tab. Model files are stored under the extension origin, so downloads from `localhost` or the hosted web app are not shared with the extension.

To install a model without downloading it again:

1. Open **Models** and find the matching Tiny Aya region.
2. Choose **Import offline pack**.
3. Select its `.sophon-model` file.
4. Review the pinned revision, required storage, CC BY-NC attribution, model card, and Cohere Labs AUP.
5. Accept the non-commercial terms and choose **Import and verify**.

The import runs in the model worker and reports `Validating → Importing → Verifying → Ready`. It writes only exact allowlisted data into the same browser-private cache used by online downloads. Cancelling keeps flushed verified segments; selecting the same file resumes them. A corrupt, stale, truncated, wrong-model, or trailing-data pack fails closed. The source pack remains in the user's filesystem and is not copied into the extension package.
