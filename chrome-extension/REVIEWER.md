# Chrome Web Store reviewer instructions

## Environment

Use current stable desktop Google Chrome on a WebGPU-capable macOS, Windows, or Linux computer. The extension requires Chrome 121 or later, a working high-performance WebGPU adapter, at least 2.35 GB of free browser storage for one model, and enough system/GPU memory to initialize a 3.35-billion-parameter q4f16 model.

No account, API key, payment, external service login, or companion application is required.

## Primary review flow

1. Install the submitted ZIP and click the Sophon toolbar action. It opens `index.html` in a full extension tab.
2. Confirm that the first-run screen says prompts and responses are not sent to an inference server and discloses the approximately 2.35 GB model download.
3. Choose **Tiny Aya Global**. Review the confirmation dialog, licensing notice, required storage, and reported available browser storage.
4. Choose **Download model**. On a typical broadband connection the 2.35 GB download can take several minutes. The UI shows verified progress and permits pause/resume.
5. When the model is ready, enter a short prompt such as `Reply with exactly: local inference works`.
6. Confirm that a response appears and the runtime status identifies WebGPU. Generation can be slow on integrated GPUs.
7. Open **Models** and use the delete control beside Tiny Aya Global. Confirm deletion in the dialog.

## Network verification

Open DevTools for the extension page and use the Network panel:

- Before model selection, there are no Hugging Face/CDN requests.
- After confirmation, remote requests are limited to the two allowlisted `onnx/model_q4f16.onnx_data*` tensor-weight files at the immutable Tiny Aya revision.
- Prompts and responses do not appear in request URLs, headers, or bodies.
- Application JavaScript, WebAssembly, the ONNX graph, configuration, generation configuration, and tokenizer files load from the `chrome-extension://` origin.

The package audit report and `model-runtime/artifacts.json` enumerate the behavior-defining model files included in the submitted ZIP. Remote tensor files are pinned by immutable revision, exact size, whole-file SHA-256, and 64 MiB segment SHA-256.

## Additional behavior

- **Pause/resume:** Pause during a download, then resume from the header or model library. Flushed verified segments are retained.
- **Offline import:** In **Models**, choose **Import offline pack**, select a matching `.sophon-model` file, review the license gate, then import. This is optional and no pack is required for primary review.
- **Conversation deletion:** Use the trash control in the header and confirm **Reset**. Conversations are otherwise held only in page memory.
- **Model deletion:** Use the per-model trash control in **Models**. This removes weights, resumable state, and cached runtime artifacts for that model.
- **Uninstall:** Remove Sophon from `chrome://extensions` to remove the extension and its extension-origin data.

## Expected limitations

- Tiny Aya is experimental and limited to non-commercial use under CC BY-NC 4.0 plus the Cohere Labs Acceptable Use Policy.
- A device without WebGPU is intentionally blocked before download/inference.
- Sophon has no cloud-inference fallback.
- The project is independent and is not affiliated with, sponsored by, or endorsed by Cohere or Hugging Face.
