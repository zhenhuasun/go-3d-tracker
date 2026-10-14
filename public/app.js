import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LINES } from './lines.js';
import { API_BASE } from './config.js';

// Data source: local proxy serves same-origin /api; GitHub Pages build points
// API_BASE at the Cloudflare Worker URL (see public/config.js).
const API = API_BASE ? API_BASE.replace(/\/+$/, '') : '/api';

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
  new THREE.CircleGeometry(200, 64),
  new THREE.MeshStandardMaterial({ color: 0x0b1220, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.06;
scene.add(ground);
const grid = new THREE.GridHelper(400, 80, 0x1c2a44, 0x101828);
scene.add(grid);

// --- rail lines + stations (schematic) ---
const stationGeo = new THREE.SphereGeometry(0.32, 12, 12);
const stationMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
for (const line of LINES) {
  const pts = line.stations.map(([, lat, lon]) => {
    const [x, z] = project(lat, lon);
    return new THREE.Vector3(x, 0.12, z);
  });
  const curve = new THREE.CatmullRomCurve3(pts);
  scene.add(new THREE.Mesh(
    new THREE.TubeGeometry(curve, 90, 0.16, 6, false),
    new THREE.MeshBasicMaterial({ color: line.color })
  ));
  for (const [name, lat, lon] of line.stations) {
    const [x, z] = project(lat, lon);
    const m = new THREE.Mesh(stationGeo, stationMat);
    m.position.set(x, 0.12, z);
    m.userData = { tip: `${name} · ${line.name}` };
    scene.add(m);
  }
}

// legend
const legend = document.getElementById('legend');
for (const line of LINES) {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `<span class="sw" style="background:#${line.color.toString(16).padStart(6, '0')}"></span>${line.name}`;
  legend.appendChild(row);
}

// --- vehicles ---
const vehicles = new Map(); // id -> record

// --- procedural 3D vehicle models -------------------------------------------
// Each vehicle is ONE merged mesh (vertex colors, single draw call) so a few
// hundred live vehicles stay smooth on phones. Livery: GO green/white.
const vehicleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25 });
const LIV = { white: 0xe9edf1, green: 0x00843d, glass: 0x0e1826, dark: 0x20242c, roof: 0xa8b1ba, loco: 0x0a5c37 };

function tinted(geo, color, x = 0, y = 0, z = 0) {
  geo.translate(x, y, z);
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
const bx = (w, h, d, color, x, y, z) => tinted(new THREE.BoxGeometry(w, h, d), color, x, y, z);
const axle = (r, len, color, x, y, z) => {
  const g = new THREE.CylinderGeometry(r, r, len, 10);
  g.rotateZ(Math.PI / 2);
  return tinted(g, color, x, y, z);
};
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
// BiLevel coach, centered at zc. cabEnd adds cab windows on the +z face.
function bilevelCoach(zc, cabEnd = false) {
  const P = [], z = zc;
  P.push(bx(0.20, 0.22, 0.30, LIV.white, 0, 0.25, z));       // body
  P.push(bx(0.206, 0.05, 0.306, LIV.green, 0, 0.165, z));   // green stripe
  P.push(bx(0.206, 0.055, 0.295, LIV.glass, 0, 0.325, z));  // upper windows
  P.push(bx(0.206, 0.05, 0.295, LIV.glass, 0, 0.245, z));   // lower windows
  P.push(bx(0.19, 0.03, 0.29, LIV.roof, 0, 0.375, z));      // roof
  P.push(bx(0.15, 0.08, 0.10, LIV.dark, 0, 0.09, z - 0.10)); // bogies
  P.push(bx(0.15, 0.08, 0.10, LIV.dark, 0, 0.09, z + 0.10));
  P.push(axle(0.042, 0.20, LIV.dark, 0, 0.045, z - 0.10));   // wheelsets
  P.push(axle(0.042, 0.20, LIV.dark, 0, 0.045, z + 0.10));
  if (cabEnd) P.push(bx(0.17, 0.09, 0.02, LIV.glass, 0, 0.32, z + 0.155));
  return P;
}
function locomotive(zc) {
  const P = [], z = zc;
  P.push(bx(0.21, 0.26, 0.34, LIV.loco, 0, 0.26, z));        // body
  P.push(bx(0.215, 0.05, 0.345, LIV.white, 0, 0.16, z));     // white stripe
  P.push(bx(0.19, 0.10, 0.02, LIV.glass, 0, 0.33, z + 0.175)); // cab windshield
  P.push(bx(0.19, 0.025, 0.32, LIV.roof, 0, 0.40, z));       // roof
  P.push(bx(0.12, 0.05, 0.10, LIV.dark, 0, 0.44, z - 0.05)); // exhaust detail
  P.push(bx(0.16, 0.09, 0.12, LIV.dark, 0, 0.09, z - 0.11)); // bogies
  P.push(bx(0.16, 0.09, 0.12, LIV.dark, 0, 0.09, z + 0.11));
  P.push(axle(0.05, 0.20, LIV.dark, 0, 0.05, z - 0.11));     // wheelsets
  P.push(axle(0.05, 0.20, LIV.dark, 0, 0.05, z + 0.11));
  P.push(bx(0.14, 0.07, 0.16, LIV.dark, 0, 0.075, z));       // fuel tank
  return P;
}

function makeTrain() {
  const parts = [];
  const pitch = 0.35;
  parts.push(...locomotive(-2 * pitch));
  parts.push(...bilevelCoach(-pitch));
  parts.push(...bilevelCoach(0));
  parts.push(...bilevelCoach(pitch));
  parts.push(...bilevelCoach(2 * pitch, true)); // cab car at the front (+z)
  const g = new THREE.Group();
  g.add(new THREE.Mesh(mergeParts(parts), vehicleMat));
  return g;
}

function makeBus() {
  const P = [];
  P.push(bx(0.20, 0.24, 0.46, LIV.white, 0, 0.25, 0));        // body
  P.push(bx(0.206, 0.055, 0.465, LIV.green, 0, 0.175, 0));   // stripe
  P.push(bx(0.206, 0.085, 0.42, LIV.glass, 0, 0.315, -0.01));// window band
  P.push(bx(0.17, 0.11, 0.025, LIV.glass, 0, 0.30, 0.232));  // windshield
  P.push(bx(0.19, 0.03, 0.44, LIV.roof, 0, 0.385, 0));       // roof
  P.push(bx(0.17, 0.07, 0.44, LIV.dark, 0, 0.085, 0));       // skirt
  P.push(axle(0.048, 0.20, LIV.dark, 0, 0.05, -0.15));        // wheels
  P.push(axle(0.048, 0.20, LIV.dark, 0, 0.05, 0.15));
  P.push(bx(0.16, 0.06, 0.03, LIV.dark, 0, 0.16, -0.235));   // rear cap
  const g = new THREE.Group();
  g.add(new THREE.Mesh(mergeParts(P), vehicleMat));
  return g;
}

const countsEl = document.getElementById('counts');
const updatedEl = document.getElementById('updated');
const statusEl = document.getElementById('status');
const setStatus = (msg, isErr = false) => {
  statusEl.textContent = msg;
  statusEl.className = isErr ? 'err' : 'dim';
};

async function poll() {
  let nTrains = 0, nBuses = 0;
  for (const type of ['trains', 'buses']) {
    try {
      const r = await fetch(`${API}/vehicles?type=${type}`);
      if (!r.ok) throw new Error(`HTTP ${r.status} — data source unreachable`);
      const { vehicles: list } = await r.json();
      const seen = new Set();
      const now = performance.now();
      for (const v of list) {
        seen.add(v.id);
        const [x, z] = project(v.lat, v.lon);
        let rec = vehicles.get(v.id);
        if (!rec) {
          const group = v.kind === 'train' ? makeTrain() : makeBus();
          group.position.set(x, 0.12, z);
          group.userData.vid = v.id;
          scene.add(group);
          rec = { group, x, z, tx: x, tz: z, t0: now, data: v, missing: 0 };
          vehicles.set(v.id, rec);
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
        if (v.kind === 'train') nTrains++; else nBuses++;
      }
      const wantKind = type === 'trains' ? 'train' : 'bus';
      for (const [id, rec] of vehicles) {
        if (!seen.has(id) && rec.data.kind === wantKind && ++rec.missing >= 3) {
          scene.remove(rec.group);
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
  for (const rec of vehicles.values()) meshes.push(...rec.group.children);
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
  panel.innerHTML = `<h3>${v.kind === 'train' ? '🚂' : '🚌'} ${v.label}</h3>
    vehicle #${v.id}<br>line: ${v.line || '—'}<br>${delayTxt}<br>
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
    rec.group.position.x = rec.x + (rec.tx - rec.x) * e;
    rec.group.position.z = rec.z + (rec.tz - rec.z) * e;
    if (rec.targetRot != null) {
      let d = rec.targetRot - rec.group.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      rec.group.rotation.y += d * 0.08;
    }
    rec.group.position.y = 0.12 + (rec.data.moving ? Math.sin(now / 280) * 0.02 : 0);
  }
  controls.update();
  renderer.render(scene, camera);
}

poll();
setInterval(poll, POLL_MS);
animate();
