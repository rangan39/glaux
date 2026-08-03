const PROJECT_REPOSITORY_API_URL = "https://api.github.com/repos/rangan39/glaux";
const GITHUB_API_VERSION = "2026-03-10";
const STAR_COUNT_REVALIDATE_SECONDS = 60 * 60;

export function parseGitHubStarCount(value: unknown): number | null {
  if (!value || typeof value !== "object" || !("stargazers_count" in value)) return null;
  const count = value.stargazers_count;
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : null;
}

export async function getProjectStarCount(): Promise<number | null> {
  try {
    const response = await fetch(PROJECT_REPOSITORY_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION
      },
      next: { revalidate: STAR_COUNT_REVALIDATE_SECONDS }
    });
    if (!response.ok) return null;
    return parseGitHubStarCount(await response.json());
  } catch {
    return null;
  }
}
