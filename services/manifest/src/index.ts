// Edge-worker entry point. Maps an incoming request to the /manifest/{variant_id}.m3u8 contract and
// returns a standard Response. Stateless: every request is a pure function of the path variant_id plus
// the injected DB read. The route and content types match contracts/api/manifest.yaml (0.3.1) exactly.
// No em dashes.

import type { ManifestDB } from "./db.js";
import { handleManifest } from "./manifest.js";

// /manifest/{variant_id}.m3u8 where variant_id is a uuid (per the contract path parameter schema).
const ROUTE = /^\/manifest\/([0-9a-fA-F-]{36})\.m3u8$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function errorResponse(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Build a fetch handler bound to a DB. The real worker passes the Supabase-backed implementation; tests
// and local runs pass the in-memory fixture DB.
export function createHandler(db: ManifestDB): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    if (request.method !== "GET") {
      return errorResponse(405, "method_not_allowed");
    }

    const match = ROUTE.exec(url.pathname);
    if (!match || !UUID.test(match[1])) {
      // Path does not name a valid variant id. Treated as variant_not_found per the contract surface,
      // which only defines 200 and 404 for this path.
      return errorResponse(404, "variant_not_found");
    }

    const result = await handleManifest(match[1], db);
    return new Response(result.body, { status: result.status, headers: result.headers });
  };
}
