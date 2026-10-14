// Schematic corridor waypoints for the GO 3D Tracker.
// Toy-project compromise: clean, kink-free corridors instead of detailed
// GTFS paths. Each line is 3-6 control points (real station locations, all
// on land); rails.js smooths them with CatmullRom + Chaikin.
// Trains map-match to these schematic paths, so they're always on clean rails.
// Positions are approximate (up to ~1km off in curvy sections) by design.

export const SCHEMATIC = {
  // Lakeshore West: Union -> Oakville -> Aldershot -> West Harbour -> St Catharines -> Niagara Falls
  LW: [
    [43.6452, -79.3806], [43.45559, -79.68224], [43.31338, -79.85566],
    [43.26678, -79.86622], [43.14761, -79.25491], [43.10888, -79.06332],
  ],
  // Hamilton branch: Hamilton Centre -> Aldershot
  'LW-HA': [
    [43.25294, -79.86852], [43.31338, -79.85566],
  ],
  // Milton: Union -> Kipling -> Milton
  MI: [
    [43.6452, -79.3806], [43.63696, -79.53629], [43.52364, -79.86717],
  ],
  // Kitchener (GT in API): Union -> Bramalea -> Kitchener
  KI: [
    [43.6452, -79.3806], [43.70226, -79.68875], [43.45569, -80.49313],
  ],
  // Barrie: Union -> Allandale Waterfront (via mid point for gentle curve)
  BR: [
    [43.6452, -79.3806], [44.0, -79.55], [44.37414, -79.68786],
  ],
  // Richmond Hill: Union -> Richmond Hill -> Bloomington
  RH: [
    [43.6452, -79.3806], [43.87431, -79.42617], [43.97595, -79.39726],
  ],
  // Stouffville: Union -> Stouffville -> Old Elm
  ST: [
    [43.6452, -79.3806], [43.97092, -79.24999], [43.99039, -79.2371],
  ],
  // Lakeshore East: Union -> Pickering -> Durham College Oshawa
  LE: [
    [43.6452, -79.3806], [43.83158, -79.08459], [43.871, -78.88481],
  ],
};

// Line metadata for schematic (colors from GTFS routes.txt)
export const SCHEMATIC_META = {
  LW: { name: 'Lakeshore West', color: 0x98002e },
  'LW-HA': { name: 'Lakeshore West (Hamilton)', color: 0x98002e },
  MI: { name: 'Milton', color: 0xf57f25 },
  KI: { name: 'Kitchener', color: 0x00853e },
  BR: { name: 'Barrie', color: 0x003767 },
  RH: { name: 'Richmond Hill', color: 0x0099c7 },
  ST: { name: 'Stouffville', color: 0x794500 },
  LE: { name: 'Lakeshore East', color: 0xff0d00 },
};
