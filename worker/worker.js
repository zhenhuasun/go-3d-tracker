/**
 * go-3d-tracker edge proxy (Cloudflare Worker, free tier).
 *
 * Holds the GO OpenData API key server-side (as a Worker secret) and serves
 * normalized vehicle positions to the GitHub Pages frontend. Responses are
 * cached at the edge for 30s, which also protects the key from excessive
 * upstream calls.
 *
 * Deploy:
 *   npx wrangler login
 *   npx wrangler secret put GO_API_KEY   # paste your key when prompted
 *   npx wrangler deploy
 */

const API_BASE = "https://api.openmetrolinx.com/OpenDataAPI/api/V1";
const CACHE_TTL = 30;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (url.pathname === "/api/health") {
      return json({ ok: true, keyConfigured: !!env.GO_API_KEY });
    }

    if (url.pathname === "/api/vehicles") {
      const key = env.GO_API_KEY;
      if (!key) return json({ error: "GO_API_KEY secret is not set" }, 500);
      const type = url.searchParams.get("type") === "buses" ? "buses" : "trains";
      const kind = type === "buses" ? "bus" : "train";
      const upstream =
        type === "buses"
          ? "ServiceataGlance/Buses/All"
          : "ServiceataGlance/Trains/All";

      const cache = caches.default;
      const cacheKey = new Request(url.toString(), request);
      let res = await cache.match(cacheKey);
      if (!res) {
        const upstreamUrl = `${API_BASE}/${upstream}?key=${encodeURIComponent(key)}`;
        let data;
        try {
          const r = await fetch(upstreamUrl, {
            headers: { "User-Agent": "go-3d-tracker/0.1" },
          });
          data = await r.json();
        } catch (e) {
          return json({ error: `upstream fetch failed: ${e.message}` }, 502);
        }
        const meta = data.Metadata || {};
        if (!["200", "204"].includes(String(meta.ErrorCode))) {
          return json({ error: `upstream ${meta.ErrorCode}: ${meta.ErrorMessage}` }, 502);
        }
        const trips = (data.Trips || {}).Trip || [];
        const vehicles = [];
        for (const t of trips) {
          const lat = Number(t.Latitude);
          const lon = Number(t.Longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
          vehicles.push({
            id: String(t.TripNumber ?? "?"),
            kind,
            lat,
            lon,
            line: String(t.LineCode ?? t.RouteNumber ?? "").trim(),
            label: t.Display || String(t.TripNumber),
            delayMin: Math.round(((t.DelaySeconds || 0) / 60) * 10) / 10,
            moving: !!t.IsInMotion,
            heading: t.Course,
            updated: t.ModifiedDate,
          });
        }
        res = json({ vehicles });
        res.headers.set("Cache-Control", `public, max-age=${CACHE_TTL}`);
        // populate edge cache in the background; don't block the response
        cache.put(cacheKey, res.clone()).catch(() => {});
      }
      // re-wrap so CORS headers are present even on cache hits
      return new Response(res.body, {
        status: res.status,
        headers: { ...Object.fromEntries(res.headers), ...corsHeaders() },
      });
    }

    return new Response("go-3d-tracker worker — try /api/vehicles?type=trains", {
      status: 404,
      headers: corsHeaders(),
    });
  },
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}
