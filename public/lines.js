// ---------------------------------------------------------------------------
// SCHEMATIC geometry for the fun prototype.
//
// Station coordinates are APPROXIMATE (rounded, hand-placed) and line colors
// are stylized, not official GO brand colors. This is fine for the toy-train
// look. For survey accuracy, replace with shapes.txt / stops.txt from the
// public GO Transit GTFS zip (keyless download from gotransit.com).
// Format per line: { name, color, stations: [[name, lat, lon], ...] }
// ---------------------------------------------------------------------------
export const LINES = [
  { name: "Lakeshore West", color: 0xff3b30, stations: [
    ["Union", 43.65, -79.38], ["Exhibition", 43.64, -79.42],
    ["Port Credit", 43.55, -79.59], ["Clarkson", 43.52, -79.64],
    ["Oakville", 43.46, -79.68], ["Appleby", 43.43, -79.72],
    ["Burlington", 43.42, -79.78], ["Aldershot", 43.32, -79.86],
    ["West Harbour", 43.27, -79.87],
  ]},
  { name: "Lakeshore East", color: 0xff9f0a, stations: [
    ["Union", 43.65, -79.38], ["Danforth", 43.69, -79.34],
    ["Guildwood", 43.75, -79.20], ["Pickering", 43.84, -79.09],
    ["Oshawa", 43.86, -78.87],
  ]},
  { name: "Milton", color: 0xffd60a, stations: [
    ["Union", 43.65, -79.38], ["Kipling", 43.64, -79.54],
    ["Cooksville", 43.58, -79.62], ["Streetsville", 43.58, -79.72],
    ["Meadowvale", 43.60, -79.78], ["Milton", 43.51, -79.88],
  ]},
  { name: "Kitchener", color: 0x34c759, stations: [
    ["Union", 43.65, -79.38], ["Bloor", 43.65, -79.48],
    ["Weston", 43.70, -79.52], ["Malton", 43.71, -79.64],
    ["Bramalea", 43.71, -79.73], ["Brampton", 43.69, -79.77],
    ["Mount Pleasant", 43.67, -79.83], ["Georgetown", 43.65, -79.92],
    ["Guelph", 43.55, -80.25], ["Kitchener", 43.55, -80.49],
  ]},
  { name: "Barrie", color: 0x0a84ff, stations: [
    ["Union", 43.65, -79.38], ["Downsview Park", 43.74, -79.48],
    ["Rutherford", 43.84, -79.50], ["King City", 43.93, -79.53],
    ["Aurora", 44.00, -79.47], ["Newmarket", 44.06, -79.47],
    ["Bradford", 44.12, -79.57], ["Barrie South", 44.36, -79.69],
    ["Allandale", 44.38, -79.68],
  ]},
  { name: "Richmond Hill", color: 0xbf5af2, stations: [
    ["Union", 43.65, -79.38], ["Oriole", 43.76, -79.44],
    ["Langstaff", 43.84, -79.44], ["Richmond Hill", 43.87, -79.44],
    ["Bloomington", 43.97, -79.39],
  ]},
  { name: "Stouffville", color: 0xac8e68, stations: [
    ["Union", 43.65, -79.38], ["Kennedy", 43.73, -79.26],
    ["Agincourt", 43.78, -79.27], ["Unionville", 43.87, -79.31],
    ["Markham", 43.89, -79.26], ["Mount Joy", 43.92, -79.24],
    ["Stouffville", 43.97, -79.25], ["Old Elm", 44.00, -79.28],
  ]},
];
