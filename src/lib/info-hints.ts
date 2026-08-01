export const INFO_HINTS = {
  modelSpecs: {
    label: "About model specifications",
    title: "Model specifications",
    description: "Model size, quantization, context length, and supported execution providers come from the selected Hugging Face repository. Larger models generally need more download space, memory, and GPU capacity."
  },
  browserStorage: {
    label: "About browser storage",
    title: "Browser storage",
    description: "The first value is Glaux’s current site usage; the second is the browser’s estimated quota, not reserved disk space. Persistent storage is protected from routine eviction; best effort data may be removed when space is low."
  },
  generationMetrics: {
    label: "About response metrics",
    title: "Response metrics",
    description: "Input → output shows tokens used and generated. tokens/s is generation speed; TTFT is the wait until the first generated token. A fraction means earlier input was omitted to fit the context."
  },
  webgpu: {
    label: "About WebGPU",
    title: "WebGPU",
    description: "WebGPU runs the model on this device’s GPU inside the browser. Chromium uses a high-performance GPU profile and optimized ONNX graph. Prompts and responses are not sent to an inference server."
  },
  tokenLens: {
    label: "About token display",
    title: "Token display",
    description: "Text shows the rendered message. Tokens shows the model pieces and IDs; Words groups them. Outside context means a piece was not included in the active input."
  },
  modelLicense: {
    label: "About model usage",
    title: "Model usage",
    description: "Each community model keeps its own license and usage terms. Review the selected model’s Hugging Face repository before downloading or using its files."
  }
} as const;

export type InfoHintId = keyof typeof INFO_HINTS;
