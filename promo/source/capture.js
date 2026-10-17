// Usage: node capture.js stills 1.2,3.9,...   |   node capture.js video out.mp4
const { chromium } = require("playwright-core");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const EXE = path.join(process.env.HOME, "Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const FPS = 30, W = 1920, H = 1200;
const dir = __dirname;

(async () => {
  const [mode, arg] = process.argv.slice(2);
  const browser = await chromium.launch({ executablePath: EXE, args: ["--force-color-profile=srgb", "--hide-scrollbars"] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
  await page.goto("file://" + path.join(dir, "promo.html"));
  await page.evaluate(() => document.fonts.ready);
  const { cues, total, marks } = await page.evaluate(() => ({ cues: window.CUES, total: window.TOTAL, marks: window.MARKS }));
  fs.writeFileSync(path.join(dir, "cues.json"), JSON.stringify({ total, marks, cues }, null, 1));

  if (mode === "stills") {
    fs.mkdirSync(path.join(dir, "stills"), { recursive: true });
    for (const t of arg.split(",").map(Number)) {
      await page.evaluate((t) => window.render(t), t);
      await page.screenshot({ path: path.join(dir, "stills", `t${t.toFixed(2)}.png`) });
    }
  } else {
    const out = arg || path.join(dir, "video.mp4");
    const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
      "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", out], { stdio: ["pipe", "inherit", "inherit"] });
    const N = Math.round(FPS * total);
    for (let f = 0; f < N; f++) {
      await page.evaluate((t) => window.render(t), f / FPS);
      const buf = await page.screenshot({ type: "png" });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
      if (f % 90 === 0) console.log(`frame ${f}/${N}`);
    }
    ff.stdin.end();
    await new Promise((r) => ff.on("close", r));
  }
  await browser.close();
})();
