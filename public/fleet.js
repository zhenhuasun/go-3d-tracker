// GO Transit fleet number -> vehicle model mapping.
// Compiled from public roster data (CPTDB wiki, Wikipedia "GO Transit fleet"),
// Oct 2026. Ranges are inclusive. Anything unmatched falls back to the default.

const BUS_RANGES = [
  { lo: 8300, hi: 8567, type: "dd", name: "Enviro500 SuperLo" }, // double-decker, 2016-2021
  { lo: 4000, hi: 4001, type: "dd", name: "Enviro500EV" },       // electric trial double-decker
  { lo: 5000, hi: 5079, type: "coach", name: "MCI D45 CRT" },   // 2025 builds
  { lo: 2450, hi: 2616, type: "coach", name: "MCI D4500CT" },   // 2011-2015, main fleet
  { lo: 2448, hi: 2449, type: "coach", name: "MCI D4500CT" },   // survivors
  { lo: 2442, hi: 2442, type: "coach", name: "MCI D4500CT" },
  { lo: 2432, hi: 2432, type: "coach", name: "MCI D4500CT" },
];

const LOCO_RANGES = [
  { lo: 667, hi: 682, type: "mp54", name: "MPI MP54AC" },
  { lo: 647, hi: 647, type: "mp54", name: "MPI MP54AC" },  // prototype rebuild
  { lo: 600, hi: 666, type: "mp40", name: "MPI MP40PH-3C" },
];

function lookup(ranges, fleet, fallback) {
  const n = parseInt(fleet, 10);
  if (!Number.isFinite(n)) return fallback;
  for (const r of ranges) {
    if (n >= r.lo && n <= r.hi) return r;
  }
  return fallback;
}

const BUS_DEFAULT = { type: "coach", name: "GO coach" };
const LOCO_DEFAULT = { type: "mp40", name: "MPI MP40PH-3C" };

export function busInfo(fleet) {
  const r = lookup(BUS_RANGES, fleet, null);
  return r ? { type: r.type, name: r.name } : { ...BUS_DEFAULT };
}

export function locoInfo(fleet) {
  const r = lookup(LOCO_RANGES, fleet, null);
  return r ? { type: r.type, name: r.name } : { ...LOCO_DEFAULT };
}
