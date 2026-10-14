import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LINES, STATIONS, LAKE_ONTARIO } from './lines.js?v=3';
import { API_BASE } from './config.js?v=2';
import { busInfo, locoInfo } from './fleet.js?v=1';
import { vehicleMesh } from './models.js?v=1';

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
    new THREE.MeshStandardMaterial({ color: 0x0e2a4a, roughness: 0.35, metalness: 0.1 })
  );
  lake.position.y = -0.045;
  scene.add(lake);
}

// --- rail lines (real GTFS track shapes) + stations (real positions) ---
const stationGeo = new THREE.SphereGeometry(0.18, 10, 10);
const stationMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
for (const line of LINES) {
  const pts = line.path.map(([lat, lon]) => {
    const [x, z] = project(lat, lon);
    return new THREE.Vector3(x, 0.12, z);
  });
  const curve = new THREE.CatmullRomCurve3(pts);
  scene.add(new THREE.Mesh(
    new THREE.TubeGeometry(curve, Math.max(64, pts.length * 2), 0.14, 6, false),
    new THREE.MeshBasicMaterial({ color: line.color })
  ));
}
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

// --- vehicles ---
const vehicles = new Map(); // id -> record


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
      const u = `${API}/vehicles?type=${type}`;
      const r = await fetch(u);
      if (!r.ok) throw new Error(`HTTP ${r.status} — ${u}`);
      const { vehicles: list } = await r.json();
      const seen = new Set();
      const now = performance.now();
      for (const v of list) {
        seen.add(v.id);
        const [x, z] = project(v.lat, v.lon);
        let rec = vehicles.get(v.id);
        if (!rec) {
          const mesh = vehicleMesh(v.kind, v.fleet);
          const group = new THREE.Group();
          group.add(mesh);
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
  const info = v.kind === 'train' ? locoInfo(v.fleet) : busInfo(v.fleet);
  const fleetTxt = v.fleet ? `${info.name} #${v.fleet}<br>` : '';
  panel.innerHTML = `<h3>${v.kind === 'train' ? '🚂' : '🚌'} ${v.label}</h3>
    vehicle #${v.id}<br>${fleetTxt}line: ${v.line || '—'}<br>${delayTxt}<br>
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
