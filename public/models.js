// Procedural 3D vehicle models for the GO 3D Tracker.
// Built from public reference material (CPTDB wiki, Wikimedia Commons).
// Technique: extruded 2D profiles capture each vehicle's silhouette;
// details are merged into ONE geometry per model (vertex colors) so each
// vehicle renders in a single draw call. Geometries are cached and shared.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { busInfo, locoInfo } from './fleet.js?v=1';

export const vehicleMat = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.45, metalness: 0.25,
});

const LIV = {
  white: 0xe9edf1, green: 0x00843d, glass: 0x0e1826, dark: 0x20242c,
  roof: 0xa8b1ba, loco: 0x0a5c37, amber: 0xffb300, steel: 0x7d8894,
  lamp: 0xfff3c4,
};

// ---------- geometry helpers ----------

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
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  merged.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return merged;
}

const bx = (w, h, d, color, x, y, z) => tinted(new THREE.BoxGeometry(w, h, d), color, x, y, z);
const axle = (r, len, color, x, y, z) => {
  const g = new THREE.CylinderGeometry(r, r, len, 10);
  g.rotateZ(Math.PI / 2);
  return tinted(g, color, x, y, z);
};
const cylY = (r, h, color, x, y, z) =>
  tinted(new THREE.CylinderGeometry(r, r, h, 10), color, x, y, z);

// extrude a 2D profile (array of [x,y]) by depth along z
function extrudeProfile(pts, depth, color, bevel = 0.006) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 1, steps: 1,
  });
  g.translate(0, 0, -depth / 2);
  return tinted(g, color);
}

// side profile: shape x = length (front at +x, centered), y = height.
// Result: length along Z, width along X. noseAtPlusZ puts the front at +Z.
function sideBody(pts, width, color, noseAtPlusZ = true) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: width, bevelEnabled: true, bevelThickness: 0.006,
    bevelSize: 0.006, bevelSegments: 1, steps: 1,
  });
  const t = tinted(g, color);
  if (noseAtPlusZ) { t.rotateY(-Math.PI / 2); t.translate(width / 2, 0, 0); }
  else { t.rotateY(Math.PI / 2); t.translate(-width / 2, 0, 0); }
  return t;
}

function windshield(w, h, color, x, y, z, tiltX = 0) {
  const g = new THREE.BoxGeometry(w, h, 0.016);
  if (tiltX) g.rotateX(tiltX);
  return tinted(g, color, x, y, z);
}

function wheelset(x, y, z, r = 0.045) {
  const P = [];
  P.push(axle(r, 0.20, LIV.dark, x, y, z));
  P.push(axle(r * 0.45, 0.21, LIV.steel, x, y, z)); // hub
  return P;
}

// ---------- Bombardier BiLevel ----------
// Signature: octagonal cross-section, widest at mid-height, tapered top/bottom.
// The END profile is extruded along the car's length.

function bilevelBody(len = 0.30) {
  const prof = [
    [-0.055, 0.02], [0.055, 0.02], [0.10, 0.10], [0.10, 0.27],
    [0.075, 0.33], [0.055, 0.35], [-0.055, 0.35], [-0.075, 0.33],
    [-0.10, 0.27], [-0.10, 0.10],
  ];
  return extrudeProfile(prof, len, LIV.white, 0.005);
}

function bilevelParts(isCabCar) {
  const P = [];
  const L = 0.30;
  P.push(bilevelBody(L));
  // two window bands on the flat midsection
  P.push(bx(0.207, 0.055, 0.26, LIV.glass, 0, 0.225, 0));
  P.push(bx(0.207, 0.05, 0.26, LIV.glass, 0, 0.155, 0));
  // green livery stripe
  P.push(bx(0.207, 0.04, L, LIV.green, 0, 0.095, 0));
  // center double doors, both sides
  for (const sx of [-1, 1]) {
    P.push(bx(0.006, 0.19, 0.062, LIV.white, sx * 0.101, 0.155, 0));
    P.push(bx(0.006, 0.075, 0.046, LIV.glass, sx * 0.102, 0.205, 0));
  }
  // roof AC box
  P.push(bx(0.07, 0.025, 0.12, LIV.roof, 0, 0.362, -0.05));
  // trucks + wheels
  for (const sz of [-0.10, 0.10]) {
    P.push(bx(0.13, 0.07, 0.09, LIV.dark, 0, 0.055, sz));
    P.push(...wheelset(0, 0.04, sz));
  }
  // rear diaphragm (both ends for trailer; cab car keeps only the rear one)
  P.push(bx(0.15, 0.18, 0.025, LIV.dark, 0, 0.17, -L / 2));
  if (!isCabCar) {
    P.push(bx(0.15, 0.18, 0.025, LIV.dark, 0, 0.17, L / 2));
  } else {
    // CEM cab end: blunt nose with paired windshields, headlights, ditch lights
    P.push(bx(0.16, 0.20, 0.05, LIV.white, 0, 0.19, L / 2 + 0.01));
    P.push(bx(0.065, 0.085, 0.02, LIV.glass, -0.042, 0.245, L / 2 + 0.038));
    P.push(bx(0.065, 0.085, 0.02, LIV.glass, 0.042, 0.245, L / 2 + 0.038));
    P.push(bx(0.03, 0.03, 0.015, LIV.lamp, -0.06, 0.13, L / 2 + 0.038));
    P.push(bx(0.03, 0.03, 0.015, LIV.lamp, 0.06, 0.13, L / 2 + 0.038));
    P.push(bx(0.02, 0.02, 0.015, LIV.lamp, -0.03, 0.06, L / 2 + 0.038));
    P.push(bx(0.02, 0.02, 0.015, LIV.lamp, 0.03, 0.06, L / 2 + 0.038));
  }
  return P;
}

// ---------- MPI locomotives ----------
// Hood unit: long engine hood, wide-nose safety cab. MP54AC's tell is the
// TWIN radiator humps (twin engines) vs the MP40's single radiator section.

function mpBase(noseAtPlusZ) {
  // side profile, x = length centered (front/nose at +x), y = height
  const prof = [
    [-0.17, 0.10], [-0.17, 0.28], [0.03, 0.28], [0.05, 0.35],
    [0.13, 0.35], [0.17, 0.29], [0.17, 0.10],
  ];
  return sideBody(prof, 0.20, LIV.loco, noseAtPlusZ);
}

function locoParts(type) {
  const P = [];
  const mp54 = type === "mp54";
  P.push(mpBase(false)); // nose faces -Z (outward, away from the train)
  // white cab stripe + number boards
  P.push(bx(0.205, 0.045, 0.30, LIV.white, 0, 0.175, 0.01));
  // paired cab windshields on the nose face
  P.push(bx(0.075, 0.09, 0.02, LIV.glass, -0.048, 0.30, -0.172));
  P.push(bx(0.075, 0.09, 0.02, LIV.glass, 0.048, 0.30, -0.172));
  P.push(bx(0.05, 0.025, 0.015, LIV.white, 0, 0.365, -0.172)); // number board
  // ditch lights
  P.push(bx(0.025, 0.025, 0.015, LIV.lamp, -0.07, 0.14, -0.172));
  P.push(bx(0.025, 0.025, 0.015, LIV.lamp, 0.07, 0.14, -0.172));
  if (mp54) {
    // TWIN radiator humps — the MP54AC signature
    for (const rz of [-0.02, -0.11]) {
      P.push(bx(0.16, 0.05, 0.07, LIV.loco, 0, 0.305, rz));
      P.push(cylY(0.028, 0.03, LIV.dark, 0, 0.335, rz));
      P.push(bx(0.03, 0.05, 0.03, LIV.dark, 0.05, 0.32, rz)); // exhaust stack
    }
  } else {
    // single radiator section + exhaust stacks
    P.push(bx(0.16, 0.04, 0.14, LIV.loco, 0, 0.30, -0.07));
    P.push(cylY(0.03, 0.035, LIV.dark, -0.04, 0.33, -0.05));
    P.push(cylY(0.03, 0.035, LIV.dark, 0.04, 0.33, -0.09));
    P.push(bx(0.03, 0.06, 0.03, LIV.dark, 0, 0.325, -0.02));
  }
  // air horn on cab roof
  P.push(bx(0.05, 0.025, 0.03, LIV.dark, 0, 0.365, -0.145));
  // trucks, fuel tank
  for (const sz of [-0.10, 0.10]) {
    P.push(bx(0.15, 0.08, 0.11, LIV.dark, 0, 0.06, sz));
    P.push(...wheelset(0, 0.042, sz - 0.025));
    P.push(...wheelset(0, 0.042, sz + 0.025));
  }
  P.push(bx(0.13, 0.06, 0.14, LIV.dark, 0, 0.05, 0));
  return P;
}

// ---------- buses ----------
// All 45-ft coaches; D4500CT has the classic rounded cap, D45 CRT a more
// angular cap; the Enviro500 is a tall double-decker with luggage bays
// (no windows) on the lower-deck rear.

function busBaseD4500() {
  // side profile, front at +x
  const prof = [
    [-0.23, 0.09], [-0.23, 0.31], [0.14, 0.31], [0.23, 0.21], [0.23, 0.09],
  ];
  return sideBody(prof, 0.20, LIV.white, true);
}

function d4500ctParts() {
  const P = [];
  P.push(busBaseD4500());
  // raked windshield on the sloped cap
  P.push(windshield(0.17, 0.11, LIV.glass, 0, 0.26, 0.20, -0.65));
  P.push(bx(0.10, 0.035, 0.015, LIV.amber, 0, 0.335, 0.175)); // destination sign
  // bonded window band, high (luggage bays below)
  P.push(bx(0.206, 0.075, 0.40, LIV.glass, 0, 0.245, -0.01));
  P.push(bx(0.206, 0.045, 0.45, LIV.green, 0, 0.175, 0));     // stripe
  // headlights low on the rounded cap
  P.push(bx(0.05, 0.035, 0.015, LIV.lamp, -0.06, 0.14, 0.228));
  P.push(bx(0.05, 0.035, 0.015, LIV.lamp, 0.06, 0.14, 0.228));
  // roof AC pod
  P.push(bx(0.12, 0.03, 0.16, LIV.roof, 0, 0.335, 0.05));
  // three axles; wheels tucked behind skirts
  for (const sz of [-0.15, 0.07, 0.16]) P.push(...wheelset(0, 0.05, sz, 0.048));
  P.push(bx(0.19, 0.09, 0.05, LIV.dark, 0, 0.10, -0.225));    // rear cap vents
  return P;
}

function d45crtParts() {
  const P = [];
  // more angular front cap than the D4500CT
  const prof = [
    [-0.23, 0.09], [-0.23, 0.32], [0.16, 0.32], [0.23, 0.24], [0.23, 0.09],
  ];
  P.push(sideBody(prof, 0.20, LIV.white, true));
  // larger, more upright windshield
  P.push(windshield(0.18, 0.13, LIV.glass, 0, 0.26, 0.205, -0.45));
  P.push(bx(0.11, 0.035, 0.015, LIV.amber, 0, 0.345, 0.185));
  P.push(bx(0.206, 0.08, 0.40, LIV.glass, 0, 0.25, -0.01));
  P.push(bx(0.206, 0.045, 0.45, LIV.green, 0, 0.175, 0));
  // slim LED headlight clusters
  P.push(bx(0.07, 0.025, 0.015, LIV.lamp, -0.055, 0.15, 0.232));
  P.push(bx(0.07, 0.025, 0.015, LIV.lamp, 0.055, 0.15, 0.232));
  P.push(bx(0.12, 0.03, 0.16, LIV.roof, 0, 0.345, 0.05));
  for (const sz of [-0.15, 0.07, 0.16]) P.push(...wheelset(0, 0.05, sz, 0.048));
  P.push(bx(0.19, 0.10, 0.04, LIV.dark, 0, 0.11, -0.225));
  return P;
}

function enviro500Parts() {
  const P = [];
  // tall double-decker profile, rounded top front
  const prof = [
    [-0.23, 0.09], [-0.23, 0.47], [0.14, 0.50], [0.23, 0.42], [0.23, 0.09],
  ];
  P.push(sideBody(prof, 0.20, LIV.white, true));
  // two full window bands...
  P.push(bx(0.206, 0.10, 0.40, LIV.glass, 0, 0.40, -0.01));   // upper deck
  // ...but the lower-deck rear is luggage bays (solid, louvered look)
  P.push(bx(0.206, 0.09, 0.24, LIV.glass, 0, 0.26, 0.09));    // lower deck front
  P.push(bx(0.206, 0.09, 0.14, LIV.steel, 0, 0.26, -0.14));   // luggage panels
  // tall curved windshields on both decks
  P.push(windshield(0.17, 0.12, LIV.glass, 0, 0.40, 0.205, -0.35));
  P.push(windshield(0.17, 0.11, LIV.glass, 0, 0.27, 0.215, -0.25));
  P.push(bx(0.10, 0.04, 0.015, LIV.amber, 0, 0.335, 0.20));   // destination sign
  P.push(bx(0.206, 0.05, 0.45, LIV.green, 0, 0.175, 0));      // stripe
  // single front door (GO commuter config)
  P.push(bx(0.006, 0.24, 0.07, LIV.glass, 0.101, 0.30, 0.14));
  P.push(bx(0.006, 0.24, 0.07, LIV.glass, -0.101, 0.30, 0.14));
  P.push(bx(0.05, 0.03, 0.015, LIV.lamp, -0.06, 0.15, 0.232));
  P.push(bx(0.05, 0.03, 0.015, LIV.lamp, 0.06, 0.15, 0.232));
  for (const sz of [-0.15, 0.07, 0.16]) P.push(...wheelset(0, 0.05, sz, 0.048));
  return P;
}

// ---------- assembly (cached) ----------

const geoCache = {};
function cached(key, builder) {
  if (!geoCache[key]) geoCache[key] = mergeParts(builder());
  return geoCache[key];
}

function trainGeo(fleet, carCount) {
  const type = locoInfo(fleet).type;
  const n = Math.max(2, Math.min(16, carCount || 6)); // clamp 2-16, default 6
  return cached("train-" + type + "-" + n, () => {
    const parts = [];
    const pitch = 0.36;
    const shift = (arr, dz) => arr.map((g) => { g.translate(0, 0, dz); return g; });
    // locomotive at back, (n-2) trailers, cab car at front
    parts.push(...shift(locoParts(type), (-(n - 1) / 2) * pitch));
    for (let i = 0; i < n - 2; i++) parts.push(...shift(bilevelParts(false), (-(n - 1) / 2 + 1 + i) * pitch));
    parts.push(...shift(bilevelParts(true), ((n - 1) / 2) * pitch)); // cab car at front
    return parts;
  });
}

function busGeo(fleet) {
  const t = busInfo(fleet).type;
  if (t === "dd") return cached("bus-dd", enviro500Parts);
  if (t === "d45crt") return cached("bus-d45crt", d45crtParts);
  return cached("bus-d4500ct", d4500ctParts);
}

// Single-car geometries, each centered at origin with front at +z.
// Used for per-car path following (Batch 2): every car is placed and
// oriented independently along the rail path.
const singleCache = {};
export function singleCarGeos(fleet) {
  const type = locoInfo(fleet).type;
  const key = "single-" + type;
  if (!singleCache[key]) {
    singleCache[key] = {
      loco: mergeParts(locoParts(type)),
      trailer: mergeParts(bilevelParts(false)),
      cab: mergeParts(bilevelParts(true)),
    };
  }
  return singleCache[key];
}

// fleet.js distinguishes the MCI generations; default coach -> D4500CT look
export function vehicleMesh(kind, fleet, cars) {
  const geo = kind === "train" ? trainGeo(fleet, cars) : busGeo(fleet);
  return new THREE.Mesh(geo, vehicleMat);
}

// direction chevrons: 3 glowing ">>>" pointing +z, built centered at origin.
// The caller positions the mesh ahead of the train head and orients +z
// along the direction of travel.
const chevMat = new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.85, depthWrite: false });
export function makeChevrons() {
  const geos = [];
  for (let i = 0; i < 3; i++) {
    const z = 0.35 + i * 0.55;
    for (const s of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.55, 0.05, 0.16);
      g.rotateY(s * 0.65);
      g.translate(s * 0.24, 1.3, z);
      geos.push(g);
    }
  }
  const merged = mergeGeometries(geos);
  geos.forEach((g) => g.dispose());
  return new THREE.Mesh(merged, chevMat);
}
