const RESET_REQUEST_HEADER = "x-glaux-storage-reset";
const ALLOWED_FETCH_SITES = new Set(["same-origin", "none"]);

export async function POST(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  const requestedReset = request.headers.get(RESET_REQUEST_HEADER) === "1";
  const origin = request.headers.get("origin");
  const sameOrigin = origin === null || origin === new URL(request.url).origin;

  if (!requestedReset || !sameOrigin || (fetchSite !== null && !ALLOWED_FETCH_SITES.has(fetchSite))) {
    return new Response("Storage reset denied.", {
      status: 403,
      headers: { "Cache-Control": "no-store" }
    });
  }

  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store",
      "Clear-Site-Data": '"storage"'
    }
  });
}
