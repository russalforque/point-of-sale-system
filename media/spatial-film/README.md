# Sellix POS — Spatial Film

A 40-second product film for Sellix POS, at 1920×1080 and 60 fps. Every screen in it is a
capture of the real Sellix app, shown on panels floating in 3D space.

**Output:** `sellix-pos-spatial-film-1080p60.mp4` (H.264 High, yuv420p, BT.709, faststart)

## Scenes

| Time | Scene | What happens |
| --- | --- | --- |
| 0–5s | Intro | The Sellix mark spins in and the title rises. |
| 5–10s | Register | Six products are tapped on the real Sales screen. Each one flies into the order and the cart updates to ₱784.00. |
| 10–14s | Payment | The real payment dialog lifts out of the screen. ₱1,000 cash is tendered, change of ₱216.00 is shown, and the sale completes. |
| 14–19s | Printing | The receipt the app produced for that sale prints from a 3D thermal printer. |
| 19–26s | Insights | The real Dashboard, Inventory and Reports screens. |
| 26–31s | Everywhere | The Android layout on a phone, the dashboard on a monitor, a printer, and the Sellix API. The phone goes offline and keeps selling. |
| 31–36s | Operations | Real screens for Shifts, Returns & voids, Receive stock, Customers, Audit log, and Users. |
| 36–40s | End card | "Sell smarter. Anywhere." |

## Audio

The film has an original score and UI sound effects. There is no narration.

- `audio/music.py` synthesizes the whole track from code with numpy and scipy, so there are no samples
  and no licensing to worry about. It runs at 96 BPM, so bars land on the scene cuts. A riser leads into
  the drop at 5s, there's a breakdown before Insights, and the track resolves on the end card. Taps,
  the payment dialog, the sale chime, the printer buzz and the offline/online cues are synced to `film.html`.
- To add a voiceover later, record the eight lines in `audio/voiceover.json`. Save each one as
  `audio/vo/01.wav` … `08.wav`, then run `python audio/mix.py`. Each line is placed at its start time,
  and the music ducks under the voice.

```bash
python audio/music.py audio/music.wav
ffmpeg -i video-only.mp4 -i audio/music.wav -map 0:v -map 1:a -c:v copy \
  -af loudnorm=I=-14:TP=-1.5:LRA=7 -c:a aac -b:a 256k -shortest sellix-pos-spatial-film-1080p60.mp4
```

## How the screens are captured

`capture/` runs the real app from `src/` in Chromium. No app code is changed. A capture-only Vite
config swaps out three modules:

- `src/database/sqlite.ts` → `capture/sqlite-web.ts`, the same API backed by sql.js (SQLite in WebAssembly)
- `src/database/seed.ts` → `capture/seed-demo.ts`, which runs the real seed and then adds a demo café:
  18 products, customers, suppliers and 12 weeks of sales history
- `src/services/printer/printerService.ts` → `capture/printer-demo.ts`, a virtual connected printer

`capture/capacitor-core.ts` reports a native platform, so the app takes its SQLite code paths.
The browser clock is pinned to Oct 5, 2026, 3:30 PM (Asia/Manila).

`capture/capture-shots.mjs` then rings up a real sale in the app and saves each screen state to
`shots/`. It also saves the positions of the tiles and buttons the film animates to `shots/shots.json`.

All store data is demo data: Sellix Café, Maria Santos and the customers are made up.

## Re-rendering

You need Node 18+, Playwright with Chromium, and `ffmpeg`.

```bash
npm ci && npm i --no-save sql.js@1.12.0
npx vite --config media/spatial-film/capture/vite.capture.config.ts   # serves the app on :5199
node media/spatial-film/capture/capture-shots.mjs                     # refresh shots/ (optional)

cd media/spatial-film
node render.mjs                          # full film
node render.mjs out.mp4 --from=5 --to=19 # render only part of the film
node render.mjs --stills=8.5,22.5        # save PNG stills at the given seconds
```

A full render is slow: about 1.5 s per frame on 4 cores. Render 10-second parts in parallel, then
join them with `ffmpeg -f concat -c copy`. To preview the film live in a browser, open `film.html`
from a local web server.
