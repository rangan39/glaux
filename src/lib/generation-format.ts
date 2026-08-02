export function formatGenerationRate(tokensPerSecond: number | null) {
  return tokensPerSecond === null ? "Speed pending" : `${tokensPerSecond.toFixed(1)} tokens/s`;
}

export function formatGenerationProvider(provider: string) {
  return provider === "webgpu" ? "WebGPU" : provider.toUpperCase();
}

export function formatGenerationDuration(milliseconds: number | null) {
  if (milliseconds === null) return "—";
  return milliseconds < 1_000
    ? `${Math.round(milliseconds)} ms`
    : `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`;
}
