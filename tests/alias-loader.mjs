export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@huggingface/transformers") {
    return { shortCircuit: true, url: new URL("./fake-transformers.mjs", import.meta.url).href };
  }
  if ((context.parentURL?.endsWith("/src/lib/onnx-runner.ts") || context.parentURL?.endsWith("/src/lib/onnx-models.ts"))
    && specifier === "@/lib/model-catalog/descriptor-store") {
    return { shortCircuit: true, url: new URL("./fake-descriptor-store.mjs", import.meta.url).href };
  }
  if (context.parentURL?.endsWith("/src/lib/onnx-runner.ts") && specifier === "@/lib/model-delivery/community-delivery") {
    return { shortCircuit: true, url: new URL("./fake-community-delivery.mjs", import.meta.url).href };
  }
  if (specifier.startsWith("@/")) {
    const sourcePath = `${specifier.slice(2)}.ts`;
    return nextResolve(new URL(`../src/${sourcePath}`, import.meta.url).href, context);
  }
  return nextResolve(specifier, context);
}
