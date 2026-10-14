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
const GTFS_RT_VP =
  "https://api.openmetrolinx.com/OpenDataAPI/api/V1/Gtfs/Feed/VehiclePosition";
const CACHE_TTL = 30;

// GTFS-RT vehicle positions carry the TRUE fleet numbers (vehicle.id),
// which Service At Glance does not expose. Fetch once, match against SAG.
async function fetchGtfsFleet(key) {
  try {
    const r = await fetch(`${GTFS_RT_VP}?key=${encodeURIComponent(key)}`, {
      headers: { "User-Agent": "go-3d-tracker/0.1", Accept: "application/json" },
    });
    const data = await r.json();
    const out = [];
    for (const e of data.entity || []) {
      const v = e.vehicle;
      if (!v || !v.position) continue;
      const lat = Number(v.position.latitude);
      const lon = Number(v.position.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const fleet = String(v.vehicle?.id ?? v.vehicle?.label ?? "").trim();
      if (!fleet) continue;
      out.push({ fleet, lat, lon, tripId: String(v.trip?.trip_id ?? "") });
    }
    return out;
  } catch (e) {
    return [];
  }
}

// fast equirectangular distance, km (good enough for <1km matching)
function distKm(lat1, lon1, lat2, lon2) {
  const x = (lon2 - lon1) * 111.32 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  const y = (lat2 - lat1) * 110.57;
  return Math.sqrt(x * x + y * y);
}

// Attach true fleet numbers: trains match on scheduled train number
// (GTFS-RT trip_id ends with "-<trainNumber>"); buses match by position.
// Matching is exclusive — each GTFS entity is used at most once.
function attachFleet(vehicles, gtfs) {
  if (!gtfs.length) return;
  const used = new Set();
  for (const sv of vehicles) {
    if (sv.kind === "train") {
      const tn = String(sv.trip);
      for (let i = 0; i < gtfs.length; i++) {
        if (used.has(i)) continue;
        if (gtfs[i].tripId.split("-").pop() === tn) {
          sv.fleet = gtfs[i].fleet;
          used.add(i);
          break;
        }
      }
    } else {
      let best = -1, bestD = 0.2;
      for (let i = 0; i < gtfs.length; i++) {
        if (used.has(i)) continue;
        const d = distKm(sv.lat, sv.lon, gtfs[i].lat, gtfs[i].lon);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0) { sv.fleet = gtfs[best].fleet; used.add(best); }
    }
  }
}

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
        let data, gtfs = [];
        try {
          const [r, g] = await Promise.all([
            fetch(upstreamUrl, { headers: { "User-Agent": "go-3d-tracker/0.1" } }),
            fetchGtfsFleet(key),
          ]);
          data = await r.json();
          gtfs = g;
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
            trip: String(t.TripNumber ?? ""),
            kind,
            lat,
            lon,
            line: String(t.LineCode ?? t.RouteNumber ?? "").trim(),
            label: t.Display || String(t.TripNumber),
            delayMin: Math.round(((t.DelaySeconds || 0) / 60) * 10) / 10,
            moving: !!t.IsInMotion,
            heading: t.Course,
            updated: t.ModifiedDate,
            fleet: "",
          });
        }
        attachFleet(vehicles, gtfs);
        res = json({ vehicles });
        res.headers.set("Cache-Control", `public, max-age=${CACHE_TTL}`);
        // populate edge cache in the background; don't block the response
        cache.put(cacheKey, res.clone()).catch(() => {});
      }
      // re-wrap so CORS headers are present even on cache hits.
      // NOTE: use Headers.set (case-insensitive). Spreading
      // Object.fromEntries(res.headers) (lower-cased names) together with
      // corsHeaders() (canonical case) created DUPLICATE
      // Access-Control-Allow-Origin headers ("*, *"), which browsers reject
      // outright -> "Failed to fetch" on every /api/vehicles call.
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(corsHeaders())) headers.set(k, v);
      return new Response(res.body, { status: res.status, headers });
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
