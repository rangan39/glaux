# Chrome Web Store reviewer instructions

## Environment

Use current stable desktop Chrome on a WebGPU-capable macOS, Windows, or Linux device. Glaux requires Chrome 121 or later, available browser storage, and enough system/GPU memory for the selected ONNX model.

No Glaux account, API key, payment, external login, or companion application is required.

## Primary review flow

1. Install the submitted ZIP and choose the Glaux toolbar action. It opens `index.html` in a full extension tab.
2. Confirm that the first-run screen states that prompts and responses are processed locally.
3. Use **Model Search** to choose a popular model or search the Hugging Face ONNX Community catalog.
4. Review the model details, repository license, immutable revision, exact download size, storage estimate, and compatibility result.
5. Confirm the model download. Large downloads can take several minutes and may be paused and resumed.
6. When the model is ready, enter a short prompt and confirm a locally generated response.
7. Open **Dev Mode** to inspect generation metrics, tokens, or words.
8. Delete the downloaded model and confirm its local files are removed.

## Network verification

- Before catalog refresh or model selection, Glaux makes no model-download request.
- Catalog and model requests go only to Hugging Face and its model-delivery hosts.
- Model artifacts use immutable repository revisions selected and validated by Glaux.
- Prompts and generated responses do not appear in request URLs, headers, or bodies.
- Application JavaScript, WebAssembly, and the inference worker load from the `chrome-extension://` origin.

## Expected limitations

- Only compatible text-generation repositories can proceed to download.
- Model behavior and performance vary by repository, browser, GPU, memory, and ONNX operator support.
- Devices without WebGPU are intentionally blocked from inference.
- Glaux has no cloud-inference fallback.
- Model weights retain their repository-specific licenses.
- Glaux is independent and is not affiliated with, sponsored by, or endorsed by Hugging Face, Cohere, or model publishers.
