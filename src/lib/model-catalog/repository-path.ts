const ENCODED_UNSAFE_PATH_TOKEN = /%(?:00|2e|2f|5c)/i;

export function isSafeRepositoryPath(path: string) {
  if (!path || path.startsWith("/") || path.includes("\\") || path.includes("\0") || ENCODED_UNSAFE_PATH_TOKEN.test(path)) {
    return false;
  }
  return path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}
