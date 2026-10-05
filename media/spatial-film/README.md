# Sellix POS — Spatial Film

A 40-second, 1920×1080 @ 60 fps product film for Sellix POS. Every frame is rendered from
`film.html`. The page uses CSS 3D: UI panels float in space and the camera moves around them.

**Output:** `sellix-pos-spatial-film-1080p60.mp4` (H.264 High, yuv420p, BT.709, faststart)

## Scenes

| Time | Scene | What happens |
| --- | --- | --- |
| 0–5s | Intro | The Sellix mark spins in, orbit rings appear and the title rises. |
| 5–10s | Register | Products fly into the cart and the total counts up to ₱700. |
| 10–14s | Payment | A ₱1,000 cash payment is entered, change of ₱300 is shown and the sale completes. |
| 14–19s | Printing | A thermal printer prints an ESC/POS receipt that includes the 12% VAT breakdown. |
| 19–26s | Insights | Dashboard KPIs and an hourly sales chart, inventory with low-stock alerts, and a weekly reports chart. |
| 26–31s | Everywhere | Android, desktop, printer and the Sellix API are linked. The phone goes offline, saves its sales locally, then syncs. |
| 31–36s | Operations | A wall of feature tiles: shifts, returns, suppliers, customers, audit log, roles. |
| 36–40s | End card | "Sell smarter. Anywhere." |

## Re-rendering

You need Node 18+, Playwright with Chromium, and `ffmpeg` on your PATH.

```bash
node render.mjs                          # full film → sellix-pos-spatial-film-1080p60.mp4
node render.mjs out.mp4 --from=5 --to=19 # render only part of the film
node render.mjs --stills=8.5,22.5        # save PNG stills at the given seconds
```

To preview the film live in a browser, open `film.html`. It loops in real time.
For capture, the renderer adds `?capture`, which turns off the loop and calls `render(t)` once for each frame.
The animation depends only on `t`, so every render produces identical frames.
