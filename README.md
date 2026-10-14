# GO 3D Tracker

A fun-project starter: a Three.js "model railway" view of live GO Transit trains
and buses, fed by the official Metrolinx OpenData API through a tiny local proxy
(so your API key never ships to browsers).

## Run it

```bash
cp .env.example .env        # then put your key in .env (or export GO_API_KEY)
GO_API_KEY=your_key_here python3 proxy.py
# open http://localhost:8080
```

- Drag to orbit, scroll to zoom, click a vehicle for details.
- Positions poll every 30s; motion is interpolated between polls.
- Trains render as little multi-car consists, buses as single coaches.
  Late vehicles show their delay in the click panel.

## View it on your phone

The API key must stay server-side, so this can't go on plain static hosting.
Instead, run the proxy on a computer on your home Wi-Fi and open it from
your phone:

1. On your computer: `git clone https://github.com/zhenhuasun/go-3d-tracker.git`
2. `cd go-3d-tracker`
3. `HOST=0.0.0.0 GO_API_KEY=your_key_here python3 proxy.py`
   (the `HOST=0.0.0.0` part lets other devices on your network reach it)
4. Find your computer's Wi-Fi IP — Mac: System Settings → Wi-Fi → Details;
   Windows: run `ipconfig` — e.g. `192.168.1.42`
5. On your phone (same Wi-Fi): open `http://192.168.1.42:8080`

## What's schematic (on purpose)

- `public/lines.js` holds **approximate, hand-drawn** GO rail line geometry and
  station positions — good enough for the toy-train look. For survey accuracy,
  replace it with `shapes.txt` / `stops.txt` from the public GO GTFS zip
  (keyless download from gotransit.com).
- Line colors are stylized, not official brand colors.
- Vehicle labels come from the live API (`Display`, `TripNumber`, `DelaySeconds`).

## Extension ideas

- Join the CPTDB wiki coach roster (one cached scrape) to label vehicles with
  their real series/year, e.g. "BiLevel Series VIII, 2010".
- Request the Fleet capability on your API key for live consist data
  (currently 403 for standard keys) and render the actual cars per train.
- Add the ServiceAlert feed as floating markers on affected lines.
- Accumulate history like TransSee does: schedule adherence per vehicle.
- The delay-refund angle: flag trains 15+ min late as service-guarantee eligible.

## Key hygiene

Never commit your API key. It lives only in the `GO_API_KEY` environment
variable / `.env` (gitignored). The browser never sees it — all API calls go
through the proxy.
