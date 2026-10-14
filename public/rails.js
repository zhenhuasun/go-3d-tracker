// Rail system for the GO 3D Tracker: real rail geometry (twin rails +
// sleepers) in each corridor's color, double-tracked so opposing trains
// never overlap, with a clockwise fan-out near Union Station.
//
// Approach layout (clockwise around Union): LW, MI, KI (west); BR, RH
// (north); ST, LE (east). Each approach group is laterally separated along
// a GLOBAL axis, so converging lines never cross. Curvature-adaptive
// lateral offsets prevent kinks on tight curves.

import * as THREE from 'three';
import { SCHEMATIC, SCHEMATIC_META } from './schematic.js?v=1';

const TRACK_GAP = 0.9;    // lateral distance between the two directional tracks
const RAIL_GAUGE = 0.30;  // distance between the two rails of one track
const RAIL_W = 0.075, RAIL_H = 0.10;
const SLEEPER_W = 0.66, SLEEPER_H = 0.055, SLEEPER_D = 0.24;
export const RAIL_TOP_Y = 0.16;
export const CAR_PITCH = 0.36;
const RESAMPLE_STEP = 0.14;
const SLEEPER_EVERY = 0.38;
const FAN_KM = 26;
const UNION_LL = [43.6445, -79.38032];

// slot: lateral position within the approach group (scene units, + = axis+)
const APPROACH = {
  LW: { axis: 'z', slot: 2.1 },
  'LW-HA': { axis: 'z', slot: 2.1 },
  MI: { axis: 'z', slot: 0.7 },
  KI: { axis: 'z', slot: -0.7 },
  BR: { axis: 'z', slot: -2.1 },
  RH: { axis: 'z', slot: -1.0 },
  ST: { axis: 'z', slot: 0 },
  LE: { axis: 'z', slot: 1.0 },
};

function tinted(geo, color, x = 0, y = 0, z = 0) {
  geo.translate(x, y, z);
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function mergeParts(parts) {
  const pos = [], norm = [], col = [];
  for (const g of parts) {
    const ng = g.index ? g.toNonIndexed() : g;
    pos.push(...ng.attributes.position.array);
    norm.push(...ng.attributes.normal.array);
    col.push(...ng.attributes.color.array);
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  m.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return m;
}

function hBeam(p0, p1, width, y, h, color) {
  const dx = p1[0] - p0[0], dz = p1[1] - p0[1];
  const len = Math.hypot(dx, dz) || 1e-6;
  const g = new THREE.BoxGeometry(width, h, len + 0.02);
  g.rotateY(Math.atan2(dx, dz));
  return tinted(g, color, (p0[0] + p1[0]) / 2, y, (p0[1] + p1[1]) / 2);
}

const railMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.35 });

function tangentAtPts(pts, i) {
  const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l = Math.hypot(dx, dz) || 1e-6;
  return [dx / l, dz / l];
}

// interpolate point + tangent at arc-length s (tangent from smoothed wide window)
export function pointAt(path, s) {
  s = Math.max(0, Math.min(path.total, s));
  const { pts, cum } = path;
  let lo = 0, hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid; else hi = mid;
  }
  const s0 = cum[lo], s1 = cum[hi];
  const f = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
  const x = pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f;
  const z = pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f;
  // stable tangent: wide window (±8 pts ≈ ±1.1 units) to avoid normal flips
  const a = pts[Math.max(0, lo - 8)], b = pts[Math.min(pts.length - 1, hi + 8)];
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l = Math.hypot(dx, dz) || 1e-6;
  return { x, z, tx: dx / l, tz: dz / l };
}

function fanAt(path, s) {
  const d = path.unionAtS0 ? s : path.total - s;
  if (d >= FAN_KM) return 0;
  const f = 1 - d / FAN_KM;
  return f * f * (3 - 2 * f);
}

function curvScaleAt(path, s) {
  const { cum, curvScale } = path;
  s = Math.max(0, Math.min(path.total, s));
  let lo = 0, hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid; else hi = mid;
  }
  const s0 = cum[lo], s1 = cum[hi];
  const f = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
  return curvScale[lo] + (curvScale[hi] - curvScale[lo]) * f;
}

// Track center [x, z] at arc-length s for travel direction dir (+1/-1).
export function trackPointAt(path, s, dir) {
  const p = pointAt(path, s);
  const ap = APPROACH[path.short] || { axis: 'z', slot: 0 };
  const fan = fanAt(path, s);
  const ax = ap.axis === 'x' ? ap.slot * fan : 0;
  const az = ap.axis === 'z' ? ap.slot * fan : 0;
  const scale = curvScaleAt(path, s);
  const doff = dir * TRACK_GAP / 2 * scale;
  // use smoothed tangent for stable normal (not the raw ±8pt tangent from pointAt)
  const st = smoothTangentAt(path, s);
  const nx = -st.tz, nz = st.tx;
  return [p.x + ax + nx * doff, p.z + az + nz * doff];
}

function smoothTangentAt(path, s) {
  const { cum, sTx, sTz } = path;
  s = Math.max(0, Math.min(path.total, s));
  let lo = 0, hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid; else hi = mid;
  }
  const s0 = cum[lo], s1 = cum[hi];
  const f = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
  return { tx: sTx[lo] + (sTx[hi] - sTx[lo]) * f, tz: sTz[lo] + (sTz[hi] - sTz[lo]) * f };
}

export function buildRailSystem(project) {
  const [ux, uz] = project(UNION_LL[0], UNION_LL[1]);
  const paths = new Map();
  const allParts = [];

  for (const [short, waypoints] of Object.entries(SCHEMATIC)) {
    const meta = SCHEMATIC_META[short];
    const v3 = waypoints.map(([lat, lon]) => {
      const [x, z] = project(lat, lon);
      return new THREE.Vector3(x, 0, z);
    });
    const curve = new THREE.CatmullRomCurve3(v3);
    const len = curve.getLength();
    const n = Math.max(8, Math.round(len / RESAMPLE_STEP));
    const sp = curve.getSpacedPoints(n);
    let pts = sp.map((p) => [p.x, p.z]);
    // 2x Chaikin: strong smoothing to kill high-frequency GTFS wiggles
    // (lateral offset amplifies curvature, so rails need cleaner centerlines)
    for (let iter = 0; iter < 2; iter++) {
      const out = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
        out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      out.push(pts[pts.length - 1]);
      pts = out;
    }
    // despike: iteratively replace points where direction changes >35°
    // (GTFS shape artifacts that would cusp when offset)
    for (let pass = 0; pass < 3; pass++) {
      let fixed = 0;
      for (let i = 1; i < pts.length - 1; i++) {
        const v1x = pts[i][0] - pts[i - 1][0], v1z = pts[i][1] - pts[i - 1][1];
        const v2x = pts[i + 1][0] - pts[i][0], v2z = pts[i + 1][1] - pts[i][1];
        const l1 = Math.hypot(v1x, v1z), l2 = Math.hypot(v2x, v2z);
        if (l1 < 1e-9 || l2 < 1e-9) continue;
        const dot = Math.max(-1, Math.min(1, (v1x * v2x + v1z * v2z) / (l1 * l2)));
        if (Math.acos(dot) > 35 * Math.PI / 180) {
          pts[i] = [(pts[i - 1][0] + pts[i + 1][0]) / 2, (pts[i - 1][1] + pts[i + 1][1]) / 2];
          fixed++;
        }
      }
      if (!fixed) break;
    }
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    // curvature-adaptive scale per point (tames kinks on tight curves)
    const curvScale = new Array(pts.length).fill(1);
    for (let i = 1; i < pts.length - 1; i++) {
      const v1x = pts[i][0] - pts[i - 1][0], v1z = pts[i][1] - pts[i - 1][1];
      const v2x = pts[i + 1][0] - pts[i][0], v2z = pts[i + 1][1] - pts[i][1];
      const l1 = Math.hypot(v1x, v1z), l2 = Math.hypot(v2x, v2z);
      if (l1 < 1e-9 || l2 < 1e-9) continue;
      const dot = Math.max(-1, Math.min(1, (v1x * v2x + v1z * v2z) / (l1 * l2)));
      const curv = Math.acos(dot) / ((l1 + l2) / 2);
      curvScale[i] = 1 / (1 + curv * 10);
    }
    // smoothed tangents: moving average over ±4 points to stabilize normals in curves
    // (raw ±8pt tangent jitters in tight turns, causing offset zigzag)
    const sTx = new Array(pts.length), sTz = new Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
      let sx = 0, sz = 0, cnt = 0;
      for (let j = Math.max(0, i - 4); j <= Math.min(pts.length - 1, i + 4); j++) {
        const a = pts[Math.max(0, j - 8)], b = pts[Math.min(pts.length - 1, j + 8)];
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const l = Math.hypot(dx, dz) || 1e-6;
        sx += dx / l; sz += dz / l; cnt++;
      }
      const l = Math.hypot(sx, sz) || 1e-6;
      sTx[i] = sx / l; sTz[i] = sz / l;
    }
    const d0 = Math.hypot(pts[0][0] - ux, pts[0][1] - uz);
    const d1 = Math.hypot(pts[pts.length - 1][0] - ux, pts[pts.length - 1][1] - uz);
    const unionAtS0 = d0 < d1;
    const path = {
      short, color: meta.color, pts, cum, curvScale, sTx, sTz,
      total: cum[cum.length - 1], unionAtS0,
    };
    paths.set(short, path);

    // rail geometry: 2 directional tracks
    const parts = [];
    const lastSleeper = { '-1': -1e9, '1': -1e9 };
    for (let i = 0; i < pts.length; i++) {
      const s = cum[i];
      for (const side of [-1, 1]) {
        const [cx, cz] = trackPointAt(path, s, side);
        const st = smoothTangentAt(path, s);
        if (s - lastSleeper[side] >= SLEEPER_EVERY) {
          lastSleeper[side] = s;
          const g = new THREE.BoxGeometry(SLEEPER_W, SLEEPER_H, SLEEPER_D);
          g.rotateY(Math.atan2(st.tx, st.tz));
          parts.push(tinted(g, 0x232830, cx, RAIL_TOP_Y - RAIL_H - SLEEPER_H / 2, cz));
        }
        if (i < pts.length - 1) {
          const [cx2, cz2] = trackPointAt(path, cum[i + 1], side);
          const st2 = smoothTangentAt(path, cum[i + 1]);
          const nx = -st.tx, nz = st.tz, nx2 = -st2.tx, nz2 = st2.tz;
          for (const rs of [-1, 1]) {
            const r0 = [cx + nx * rs * RAIL_GAUGE / 2, cz + nz * rs * RAIL_GAUGE / 2];
            const r1 = [cx2 + nx2 * rs * RAIL_GAUGE / 2, cz2 + nz2 * rs * RAIL_GAUGE / 2];
            parts.push(hBeam(r0, r1, RAIL_W, RAIL_TOP_Y - RAIL_H / 2, RAIL_H, meta.color));
          }
        }
      }
    }
    allParts.push(...parts);
  }

  const mesh = new THREE.Mesh(mergeParts(allParts), railMat);
  return { paths, mesh };
}

// Map-match a lat/lon (+optional course) onto a path -> { s, dir, d }.
export function snapToPath(path, x, z, courseDeg) {
  let best = 0, bestD = Infinity;
  const { pts } = path;
  let bi = 0;
  for (let i = 0; i < pts.length; i += 4) {
    const dx = pts[i][0] - x, dz = pts[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; bi = i; }
  }
  best = bi; bestD = Infinity;
  for (let i = Math.max(0, bi - 4); i < Math.min(pts.length, bi + 5); i++) {
    const dx = pts[i][0] - x, dz = pts[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  const s = path.cum[best];
  let dir = 1;
  if (courseDeg != null && !isNaN(courseDeg)) {
    const p = pointAt(path, s);
    const cr = courseDeg * Math.PI / 180;
    const vx = Math.sin(cr), vz = -Math.cos(cr);
    dir = (vx * p.tx + vz * p.tz) >= 0 ? 1 : -1;
  }
  return { s, dir, d: bestD };
}
