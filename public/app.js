import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LINES, STATIONS, LAKE_ONTARIO } from './lines.js?v=3';
import { API_BASE } from './config.js?v=2';
import { busInfo, locoInfo } from './fleet.js?v=1';
import { vehicleMesh, vehicleMat, singleCarGeos, makeChevrons } from './models.js?v=3';
import { buildRailSystem, pointAt, trackOffset, snapToPath, RAIL_TOP_Y, CAR_PITCH } from './rails.js?v=1';

// Data source: local proxy serves same-origin /api; GitHub Pages build points
// API_BASE at the Cloudflare Worker URL (see public/config.js).
const API = API_BASE ? API_BASE.replace(/\/+$/, '') + '/api' : '/api';

const POLL_MS = 30000;

// --- projection: equirectangular kilometres, 1 scene unit = 1 km ---
const LAT0 = 43.70, LON0 = -79.55;
const KX = 111.32 * Math.cos(LAT0 * Math.PI / 180);
const KY = 110.57;
const project = (lat, lon) => [(lon - LON0) * KX, -(lat - LAT0) * KY];

// --- renderer / scene / camera ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070b12);
scene.fog = new THREE.Fog(0x070b12, 140, 300);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1200);
camera.position.set(0, 75, 60);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 5);
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 8;
controls.maxDistance = 260;

scene.add(new THREE.AmbientLight(0x8899bb, 0.8));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(40, 90, 25);
scene.add(sun);

// --- ground ---
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(420, 64),
  new THREE.MeshStandardMaterial({ color: 0x0b1220, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.06;
scene.add(ground);
const grid = new THREE.GridHelper(400, 80, 0x1c2a44, 0x101828);
scene.add(grid);

// --- Lake Ontario (real shoreline, Natural Earth) ---
{
  const shape = new THREE.Shape();
  LAKE_ONTARIO.forEach(([lat, lon], i) => {
    const sx = (lon - LON0) * KX, sy = (lat - LAT0) * KY;
    if (i === 0) shape.moveTo(sx, sy); else shape.lineTo(sx, sy);
  });
  shape.closePath();
  const lakeGeo = new THREE.ShapeGeometry(shape);
  lakeGeo.rotateX(-Math.PI / 2); // lay flat: (x, y) -> (x, 0, z)
  const lake = new THREE.Mesh(
    lakeGeo,
    new THREE.MeshStandardMaterial({ color: 0x0e2a4a, roughness: 0.35, metalness: 0.1, side: THREE.DoubleSide })
  );
  lake.position.y = -0.045;
  scene.add(lake);
}

// --- city labels (map element) ---
function makeLabel(text) {
  const fs = 44;
  const meas = document.createElement('canvas').getContext('2d');
  meas.font = `600 ${fs}px system-ui, sans-serif`;
  const c = document.createElement('canvas');
  c.width = Math.ceil(meas.measureText(text).width) + 28;
  c.height = fs + 28;
  const ctx = c.getContext('2d');
  ctx.font = `600 ${fs}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(170,195,225,0.92)';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 14, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  const k = 0.045;
  sp.scale.set(c.width * k, c.height * k, 1);
  return sp;
}
const CITIES = [
  ["Toronto", 43.72, -79.38], ["Mississauga", 43.62, -79.64],
  ["Hamilton", 43.28, -79.87], ["Oshawa", 43.92, -78.87],
  ["Kitchener", 43.47, -80.49], ["Barrie", 44.41, -79.69],
  ["Oakville", 43.47, -79.68], ["Niagara Falls", 43.11, -79.06],
];
for (const [name, lat, lon] of CITIES) {
  const [x, z] = project(lat, lon);
  const label = makeLabel(name);
  label.position.set(x, 2.2, z);
  scene.add(label);
}

// --- rail system: real twin-rail geometry, double-tracked per corridor ---
const { paths: RAIL_PATHS, mesh: railMesh } = buildRailSystem(project);
scene.add(railMesh);

// --- stations (real positions) ---
const stationGeo = new THREE.SphereGeometry(0.18, 10, 10);
const stationMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
for (const [name, lat, lon] of STATIONS) {
  const [x, z] = project(lat, lon);
  const m = new THREE.Mesh(stationGeo, stationMat);
  m.position.set(x, 0.12, z);
  m.userData = { tip: name };
  scene.add(m);
}

// legend
const legend = document.getElementById('legend');
for (const line of LINES) {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `<span class="sw" style="background:#${line.color.toString(16).padStart(6, '0')}"></span>${line.name}`;
  legend.appendChild(row);
}

// --- delay glow: soft radial disc under each train head ---
// green = on time / early (<3 min), yellow = 3-14 min late, red = 15+ min late
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const glowTex = makeGlowTexture();
const glowGeo = new THREE.PlaneGeometry(1.6, 1.6);
glowGeo.rotateX(-Math.PI / 2);
const glowMats = {
  green: new THREE.MeshBasicMaterial({ map: glowTex, color: 0x22c55e, transparent: true, opacity: 0.9, depthWrite: false }),
  yellow: new THREE.MeshBasicMaterial({ map: glowTex, color: 0xeab308, transparent: true, opacity: 0.9, depthWrite: false }),
  red: new THREE.MeshBasicMaterial({ map: glowTex, color: 0xef4444, transparent: true, opacity: 0.9, depthWrite: false }),
};
const delayBucket = (d) => (d >= 15 ? 'red' : d >= 3 ? 'yellow' : 'green');

// --- vehicles ---
const vehicles = new Map(); // id -> record


const countsEl = document.getElementById('counts');
const updatedEl = document.getElementById('updated');
const statusEl = document.getElementById('status');
const setStatus = (msg, isErr = false) => {
  statusEl.textContent = msg;
  statusEl.className = isErr ? 'err' : 'dim';
};

// --- train placement: map-matched, per-car, head at live location ---
function ensureTrainMeshes(rec, v, n) {
  const fleetKey = v.fleet || '?';
  if (rec.carMeshes.length === n && rec.fleetKey === fleetKey) return;
  for (const m of rec.carMeshes) scene.remove(m);
  if (rec.glow) scene.remove(rec.glow);
  if (rec.chev) scene.remove(rec.chev);
  const geos = singleCarGeos(v.fleet);
  rec.carMeshes = [];
  for (let i = 0; i < n; i++) {
    const g = i === 0 ? geos.cab : (i === n - 1 ? geos.loco : geos.trailer);
    const m = new THREE.Mesh(g, vehicleMat);
    m.userData.vid = v.id;
    scene.add(m);
    rec.carMeshes.push(m);
  }
  rec.glow = new THREE.Mesh(glowGeo, glowMats.green);
  rec.glow.userData.vid = v.id;
  scene.add(rec.glow);
  rec.chev = makeChevrons();
  scene.add(rec.chev);
  rec.cars = n;
  rec.fleetKey = fleetKey;
}

function placeRailCars(rec) {
  const { path, s, dir, carMeshes } = rec;
  const n = carMeshes.length;
  for (let i = 0; i < n; i++) {
    const si = s - dir * (i + 0.5) * CAR_PITCH;
    const p = pointAt(path, si);
    const to = trackOffset(path, si, dir);
    const nx = -p.tz, nz = p.tx;
    const m = carMeshes[i];
    m.position.set(p.x + nx * to, RAIL_TOP_Y, p.z + nz * to);
    m.rotation.y = Math.atan2(dir * p.tx, dir * p.tz);
  }
  const hp = pointAt(path, s);
  const hto = trackOffset(path, s, dir);
  const hnx = -hp.tz, hnz = hp.tx;
  const hx = hp.x + hnx * hto, hz = hp.z + hnz * hto;
  rec.glow.position.set(hx, RAIL_TOP_Y + 0.025, hz);
  const fx = dir * hp.tx, fz = dir * hp.tz;
  rec.chev.position.set(hx + fx * 1.3, RAIL_TOP_Y, hz + fz * 1.3);
  rec.chev.rotation.y = Math.atan2(fx, fz);
}

function placeStraightCars(rec) {
  // fallback when the line has no rail path: straight consist, head at (x,z)
  const h = rec.headRad;
  const fx = Math.sin(h), fz = -Math.cos(h);
  const n = rec.carMeshes.length;
  for (let i = 0; i < n; i++) {
    const d = (i + 0.5) * CAR_PITCH;
    const m = rec.carMeshes[i];
    m.position.set(rec.x - fx * d, RAIL_TOP_Y, rec.z - fz * d);
    m.rotation.y = Math.atan2(fx, fz);
  }
  rec.glow.position.set(rec.x, RAIL_TOP_Y + 0.025, rec.z);
  rec.chev.position.set(rec.x + fx * (0.5 + 1.3), RAIL_TOP_Y, rec.z + fz * (0.5 + 1.3));
  rec.chev.rotation.y = Math.atan2(fx, fz);
}

function updateTrain(rec, v, now) {
  const n = Math.max(2, Math.min(16, v.cars || 6));
  const [x, z] = project(v.lat, v.lon);
  const path = RAIL_PATHS.get((v.line || '').trim());
  if (!rec || rec.kind !== 'train') {
    rec = {
      kind: 'train', data: v, missing: 0, carMeshes: [], glow: null, chev: null,
      cars: 0, fleetKey: '', mode: '', s: 0, s0: 0, targetS: 0, dir: 1,
      x: 0, z: 0, x0: 0, z0: 0, tx: 0, tz: 0, headRad: 0, t0: now,
    };
  }
  rec.data = v; rec.missing = 0;
  ensureTrainMeshes(rec, v, n);
  rec.glow.material = glowMats[delayBucket(v.delayMin || 0)];

  if (path) {
    const snap = snapToPath(path, x, z, v.heading);
    if (rec.mode !== 'rail') { rec.s = snap.s; rec.s0 = snap.s; }
    else { rec.s0 = rec.s; }
    rec.mode = 'rail'; rec.path = path;
    rec.targetS = snap.s;
    if (v.heading != null && !isNaN(v.heading)) rec.dir = snap.dir;
  } else {
    if (rec.mode !== 'straight') { rec.x = x; rec.z = z; rec.x0 = x; rec.z0 = z; }
    else { rec.x0 = rec.x; rec.z0 = rec.z; }
    rec.mode = 'straight';
    rec.tx = x; rec.tz = z;
    if (v.heading != null && !isNaN(v.heading)) rec.headRad = v.heading * Math.PI / 180;
  }
  rec.t0 = now;
  return rec;
}

function updateBus(rec, v, now) {
  const [x, z] = project(v.lat, v.lon);
  if (!rec || rec.kind !== 'bus') {
    const group = new THREE.Group();
    group.add(vehicleMesh('bus', v.fleet));
    group.position.set(x, 0.12, z);
    group.userData.vid = v.id;
    scene.add(group);
    rec = { kind: 'bus', group, x, z, tx: x, tz: z, t0: now, data: v, missing: 0, targetRot: null };
  } else {
    rec.x = rec.group.position.x;
    rec.z = rec.group.position.z;
    rec.tx = x; rec.tz = z; rec.t0 = now;
    rec.data = v; rec.missing = 0;
  }
  if (v.heading != null && !isNaN(v.heading)) {
    const h = v.heading * Math.PI / 180;
    rec.targetRot = Math.atan2(Math.sin(h), -Math.cos(h));
  }
  return rec;
}

async function poll() {
  let nTrains = 0, nBuses = 0;
  for (const type of ['trains', 'buses']) {
    try {
      const u = `${API}/vehicles?type=${type}`;
      const r = await fetch(u);
      if (!r.ok) throw new Error(`HTTP ${r.status} — ${u}`);
      const { vehicles: list } = await r.json();
      const seen = new Set();
      const now = performance.now();
      for (const v of list) {
        seen.add(v.id);
        let rec = vehicles.get(v.id);
        if (v.kind === 'train') rec = updateTrain(rec, v, now);
        else rec = updateBus(rec, v, now);
        vehicles.set(v.id, rec);
        if (v.kind === 'train') nTrains++; else nBuses++;
      }
      const wantKind = type === 'trains' ? 'train' : 'bus';
      for (const [id, rec] of vehicles) {
        if (!seen.has(id) && rec.kind === wantKind && ++rec.missing >= 3) {
          if (rec.kind === 'train') {
            for (const m of rec.carMeshes) scene.remove(m);
            if (rec.glow) scene.remove(rec.glow);
            if (rec.chev) scene.remove(rec.chev);
          } else {
            scene.remove(rec.group);
          }
          vehicles.delete(id);
        }
      }
      setStatus('live');
    } catch (e) {
      setStatus(e.message, true);
    }
  }
  countsEl.textContent = `${nTrains} trains · ${nBuses} buses in service`;
  updatedEl.textContent = 'updated ' + new Date().toLocaleTimeString();
}

// --- click for details ---
const panel = document.getElementById('panel');
const ray = new THREE.Raycaster();
const mouse = new THREE.Vector2();
renderer.domElement.addEventListener('click', (e) => {
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const meshes = [];
  for (const rec of vehicles.values()) {
    if (rec.kind === 'train') meshes.push(...rec.carMeshes, rec.glow);
    else meshes.push(...rec.group.children);
  }
  const hit = ray.intersectObjects(meshes, false)[0];
  if (!hit) { panel.hidden = true; return; }
  let g = hit.object;
  while (g && !g.userData.vid) g = g.parent;
  const rec = g && vehicles.get(g.userData.vid);
  if (!rec) { panel.hidden = true; return; }
  const v = rec.data;
  const delayTxt = v.delayMin >= 0.5
    ? `<span class="late">+${v.delayMin} min late</span>`
    : `<span class="ontime">on time</span>`;
  const info = v.kind === 'train' ? locoInfo(v.fleet) : busInfo(v.fleet);
  const fleetTxt = v.fleet ? `${info.name} #${v.fleet}<br>` : '';
  const carsTxt = v.kind === 'train' && v.cars ? `${v.cars} cars<br>` : '';
  panel.innerHTML = `<h3>${v.kind === 'train' ? '🚂' : '🚌'} ${v.label}</h3>
    vehicle #${v.id}<br>${fleetTxt}${carsTxt}line: ${v.line || '—'}<br>${delayTxt}<br>
    ${v.moving ? 'in motion' : 'stopped'}<br>
    <span style="color:#8fa1bd;font-size:12px">updated ${v.updated || '—'}</span><br>
    <button id="closep">close</button>`;
  panel.hidden = false;
  document.getElementById('closep').onclick = () => { panel.hidden = true; };
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --- main loop: interpolate between polls ---
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  for (const rec of vehicles.values()) {
    const k = Math.min(1, (now - rec.t0) / POLL_MS);
    const e = k * k * (3 - 2 * k);
    if (rec.kind === 'train') {
      if (rec.mode === 'rail') {
        rec.s = rec.s0 + (rec.targetS - rec.s0) * e;
        placeRailCars(rec);
      } else if (rec.mode === 'straight') {
        rec.x = rec.x0 + (rec.tx - rec.x0) * e;
        rec.z = rec.z0 + (rec.tz - rec.z0) * e;
        placeStraightCars(rec);
      }
      // gentle bob while moving
      const bob = rec.data.moving ? Math.sin(now / 280) * 0.02 : 0;
      for (const m of rec.carMeshes) m.position.y = RAIL_TOP_Y + bob;
    } else {
      rec.group.position.x = rec.x + (rec.tx - rec.x) * e;
      rec.group.position.z = rec.z + (rec.tz - rec.z) * e;
      if (rec.targetRot != null) {
        let d = rec.targetRot - rec.group.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        rec.group.rotation.y += d * 0.08;
      }
      rec.group.position.y = 0.12 + (rec.data.moving ? Math.sin(now / 280) * 0.02 : 0);
    }
  }
  controls.update();
  renderer.render(scene, camera);
}

poll();
setInterval(poll, POLL_MS);
animate();
