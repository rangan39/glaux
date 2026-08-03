export type StartupCleanupStatus = "cleaning" | "failed" | "idle";

export function isModelStorageReady(runtimeEnabled: boolean, cleanupStatus: StartupCleanupStatus) {
  return runtimeEnabled && cleanupStatus === "idle";
}
