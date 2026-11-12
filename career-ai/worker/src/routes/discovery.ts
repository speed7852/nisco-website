import { listRecentRuns } from "../db/discovery-runs";
import { json } from "../http/responses";
import type { RequestContext } from "../http/router";

/** GET /api/discovery/runs?limit=5: outcomes of recent scheduled discovery runs. */
export async function listDiscoveryRuns({ env, url }: RequestContext): Promise<Response> {
  const requested = Number(url.searchParams.get("limit") ?? "5");
  const limit = Number.isInteger(requested) && requested >= 1 && requested <= 20 ? requested : 5;
  return json({ runs: await listRecentRuns(env.DB, limit) });
}
