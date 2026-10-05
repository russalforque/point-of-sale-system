// Renders film.html frame-by-frame to a 1920x1080 @ 60fps H.264 MP4.
// Usage: node render.mjs [out.mp4] [--from=sec] [--to=sec] [--stills=t1,t2,...]
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require("/opt/node22/lib/node_modules/playwright"); }

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith("--")).map(a => a.slice(2).split("=")));
const out = process.argv.slice(2).find(a => !a.startsWith("--")) || path.join(here, "sellix-pos-spatial-film-1080p60.mp4");
const FPS = 60, W = 1920, H = 1080;

const browser = await playwright.chromium.launch({ args: ["--disable-lcd-text", "--force-color-profile=srgb", "--hide-scrollbars"] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.join(here, "film.html")).href + "?capture");
await page.evaluate(() => window.ready);
const duration = await page.evaluate(() => window.DURATION);

if (args.stills) {
  for (const s of args.stills.split(",")) {
    await page.evaluate(t => window.render(t), Number(s));
    await page.screenshot({ path: path.join(args.dir || here, `still-${s}.png`) });
  }
  await browser.close();
  process.exit(0);
}

const from = Number(args.from ?? 0), to = Number(args.to ?? duration);
const frames = Math.round((to - from) * FPS);
const ff = spawn("ffmpeg", [
  "-y", "-loglevel", "error",
  "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
  "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-profile:v", "high", "-level", "4.2",
  "-pix_fmt", "yuv420p", "-r", String(FPS), "-movflags", "+faststart",
  "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
  out,
], { stdio: ["pipe", "inherit", "inherit"] });

const t0 = Date.now();
for (let i = 0; i < frames; i++) {
  const t = from + i / FPS;
  await page.evaluate(t => window.render(t), t);
  const buf = await page.screenshot({ type: "jpeg", quality: 95 });
  if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once("drain", r));
  if (i % 120 === 0) console.log(`frame ${i}/${frames}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
ff.stdin.end();
await new Promise(r => ff.on("close", r));
await browser.close();
console.log(`done → ${out} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
