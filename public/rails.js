// Rail system for the GO 3D Tracker: real rail geometry (twin rails +
// sleepers) in each corridor's color, double-tracked so opposing trains
// never overlap, with a fan-out near Union Station so converging lines
// keep their trains on separate tracks.
//
// Technique: each line's GTFS shape is resampled into an arc-length
// parameterized polyline. Rails/sleepers are merged boxes; trains are
// map-matched onto the path and each car is placed independently.

import * as THREE from 'three';
import { LINES } from './lines.js?v=3';

const TRACK_GAP = 0.9;    // lateral distance between the two directional tracks
const RAIL_GAUGE = 0.30;  // distance between the two rails of one track
const RAIL_W = 0.075, RAIL_H = 0.10;   // rail cross-section
const SLEEPER_W = 0.66, SLEEPER_H = 0.055, SLEEPER_D = 0.24;
export const RAIL_TOP_Y = 0.16;  // wheel treads sit here (car geo has wheels at y~0)
const RESAMPLE_STEP = 0.14;
const SLEEPER_EVERY = 0.38;

// Per-line lateral slot (km-ish scene units). Near Union the lines run
// parallel and close; the slots fan them out so each line's track pair
// stays clear of its neighbours'. Fades to 0 beyond FAN_KM from Union.
const SLOT = { LW: -1.25, MI: 0, KI: 1.25, LE: -0.75, ST: 0.75, BR: -0.75, RH: 0.75 };
const FAN_KM = 26;
const UNION_LL = [43.6445, -79.38032];

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

// box segment from p0 to p1 (both [x,z]), width across, height up, centered at y
function hBeam(p0, p1, width, y, h, color) {
  const dx = p1[0] - p0[0], dz = p1[1] - p0[1];
  const len = Math.hypot(dx, dz) || 1e-6;
  const g = new THREE.BoxGeometry(width, h, len + 0.02);
  g.rotateY(Math.atan2(dx, dz));
  return tinted(g, color, (p0[0] + p1[0]) / 2, y, (p0[1] + p1[1]) / 2);
}

const railMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.35 });

// Build the full rail system. project(lat,lon)->[x,z].
// Returns { paths: Map(short -> path), mesh } where path =
// { short, color, pts:[[x,z]..], cum:[..], total, slot, unionAtS0 }
export function buildRailSystem(project) {
  const [ux, uz] = project(UNION_LL[0], UNION_LL[1]);
  const paths = new Map();
  const allParts = [];

  for (const line of LINES) {
    const v3 = line.path.map(([lat, lon]) => {
      const [x, z] = project(lat, lon);
      return new THREE.Vector3(x, 0, z);
    });
    const curve = new THREE.CatmullRomCurve3(v3);
    const len = curve.getLength();
    const n = Math.max(8, Math.round(len / RESAMPLE_STEP));
    const sp = curve.getSpacedPoints(n); // arc-length uniform
    const pts = sp.map((p) => [p.x, p.z]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    // which end is Union? (all lines touch Union at one end)
    const d0 = Math.hypot(pts[0][0] - ux, pts[0][1] - uz);
    const d1 = Math.hypot(pts[pts.length - 1][0] - ux, pts[pts.length - 1][1] - uz);
    const unionAtS0 = d0 < d1;
    const path = {
      short: line.short, color: line.color, pts, cum,
      total: cum[cum.length - 1],
      slot: SLOT[line.short] || 0, unionAtS0,
    };
    paths.set(line.short, path);

    // --- rail geometry for this line: 2 tracks ---
    const distFromUnion = (s) => unionAtS0 ? s : path.total - s;
    const parts = [];
    let lastSleeper = -1e9;
    for (let i = 0; i < pts.length; i++) {
      const s = cum[i];
      const fan = (() => {
        const d = distFromUnion(s);
        if (d >= FAN_KM) return 0;
        const f = 1 - d / FAN_KM;
        return f * f * (3 - 2 * f);
      })();
      const slotOff = path.slot * fan;
      const t = tangentAt(path, i);
      const nx = -t[1], nz = t[0]; // left normal
      for (const side of [-1, 1]) { // two directional tracks
        const to = slotOff + side * TRACK_GAP / 2;
        const cx = pts[i][0] + nx * to, cz = pts[i][1] + nz * to;
        // sleepers
        if (s - lastSleeper >= SLEEPER_EVERY) {
          lastSleeper = s;
          const g = new THREE.BoxGeometry(SLEEPER_W, SLEEPER_H, SLEEPER_D);
          g.rotateY(Math.atan2(t[0], t[1]));
          parts.push(tinted(g, 0x232830, cx, RAIL_TOP_Y - RAIL_H - SLEEPER_H / 2, cz));
        }
        // rails: segments to next point
        if (i < pts.length - 1) {
          const s2 = cum[i + 1];
          const fan2 = (() => {
            const d = distFromUnion(s2);
            if (d >= FAN_KM) return 0;
            const f = 1 - d / FAN_KM;
            return f * f * (3 - 2 * f);
          })();
          const slotOff2 = path.slot * fan2;
          const t2 = tangentAt(path, i + 1);
          const nx2 = -t2[1], nz2 = t2[0];
          const to2 = slotOff2 + side * TRACK_GAP / 2;
          const cx2 = pts[i + 1][0] + nx2 * to2, cz2 = pts[i + 1][1] + nz2 * to2;
          for (const rs of [-1, 1]) {
            const r0 = [cx + nx * rs * RAIL_GAUGE / 2, cz + nz * rs * RAIL_GAUGE / 2];
            const r1 = [cx2 + nx2 * rs * RAIL_GAUGE / 2, cz2 + nz2 * rs * RAIL_GAUGE / 2];
            parts.push(hBeam(r0, r1, RAIL_W, RAIL_TOP_Y - RAIL_H / 2, RAIL_H, line.color));
          }
        }
      }
    }
    allParts.push(...parts);
  }

  const mesh = new THREE.Mesh(mergeParts(allParts), railMat);
  return { paths, mesh };
}

function tangentAt(path, i) {
  const p = path.pts;
  const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l = Math.hypot(dx, dz) || 1e-6;
  return [dx / l, dz / l];
}

// interpolate point + tangent at arc-length s
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
  const dx = pts[hi][0] - pts[lo][0], dz = pts[hi][1] - pts[lo][1];
  const l = Math.hypot(dx, dz) || 1e-6;
  return { x, z, tx: dx / l, tz: dz / l };
}

// lateral offset (slot fan + directional track) at arc-length s
export function trackOffset(path, s, dir) {
  const d = path.unionAtS0 ? s : path.total - s;
  let fan = 0;
  if (d < FAN_KM) { const f = 1 - d / FAN_KM; fan = f * f * (3 - 2 * f); }
  return path.slot * fan + dir * TRACK_GAP / 2;
}

// Map-match a lat/lon (+optional course bearing) onto a path.
// Returns { s, dir } — arc-length of nearest point, travel direction (+1/-1).
export function snapToPath(path, x, z, courseDeg) {
  let best = 0, bestD = Infinity;
  const { pts } = path;
  // coarse scan every 4th point, then refine
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
    const vx = Math.sin(cr), vz = -Math.cos(cr); // 0°=north(-z), 90°=east(+x)
    dir = (vx * p.tx + vz * p.tz) >= 0 ? 1 : -1;
  }
  return { s, dir };
}

export const CAR_PITCH = 0.36;
