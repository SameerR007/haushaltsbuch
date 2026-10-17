// Usage: node snap.js <time> <out.png> — the app window at that moment, 2x, without captions or cursor.
const { chromium } = require("playwright-core");
const path = require("path");
const EXE = path.join(process.env.HOME, "Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
(async () => {
  const [t, out] = process.argv.slice(2);
  const browser = await chromium.launch({ executablePath: EXE, args: ["--force-color-profile=srgb"] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1200 }, deviceScaleFactor: 2 });
  await page.goto("file://" + path.join(__dirname, "promo.html"));
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate((t) => {
    window.render(+t);
    // a still has no cursor, and rows should look settled rather than just-added
    for (const id of ["cursor", "ripple"]) document.getElementById(id).style.visibility = "hidden";
    document.querySelectorAll("tr").forEach((tr) => (tr.style.background = "transparent"));
  }, t);
  await page.screenshot({ path: out, clip: { x: 150, y: 212, width: 1620, height: 988 } });
  await browser.close();
})();
