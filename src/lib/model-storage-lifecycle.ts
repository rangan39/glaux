export type StartupCleanupStatus = "cleaning" | "failed" | "idle" | "resetting-origin" | "verifying";

export function isModelStorageReady(runtimeEnabled: boolean, cleanupStatus: StartupCleanupStatus) {
  return runtimeEnabled && cleanupStatus === "idle";
}
