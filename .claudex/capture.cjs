// Claudex capture harness: screenshots + scripted playtests in real Chrome (GitHub Actions).
// Output markers are parsed by the Claudex server. Do not edit unless you know why.
const path = require("path");
const { chromium } = require("playwright-core");

const URL_ = process.env.CAPTURE_URL;
const SCRIPT = process.env.CAPTURE_SCRIPT;
const MAX_SHOTS = 8;
const report = { url: URL_, ok: true, console_errors: [], page_errors: [], failed_requests: [], logs: [], assertions: [], shots: [] };

function emit(name, buf) {
  const b64 = buf.toString("base64");
  console.log("CLAUDEX_IMG_BEGIN " + name);
  for (let i = 0; i < b64.length; i += 3000) console.log(b64.slice(i, i + 3000));
  console.log("CLAUDEX_IMG_END");
}

async function newPage(browser, opts) {
  const mobile = !opts || opts.mobile !== false;
  const context = await browser.newContext(
    mobile
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }
      : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }
  );
  const page = await context.newPage();
  page.__mobile = mobile;
  page.on("console", (m) => { if (m.type() === "error" && report.console_errors.length < 20) report.console_errors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => { if (report.page_errors.length < 20) report.page_errors.push(String(e.message || e).slice(0, 300)); });
  page.on("requestfailed", (r) => { if (report.failed_requests.length < 20) report.failed_requests.push(r.url().slice(0, 200) + " " + ((r.failure() && r.failure().errorText) || "")); });
  page.on("response", (r) => { if (r.status() >= 400 && report.failed_requests.length < 20) report.failed_requests.push(r.status() + " " + r.url().slice(0, 200)); });
  return page;
}

async function shot(page, name, o) {
  if (report.shots.length >= MAX_SHOTS) return;
  const safe = String(name || "shot").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40);
  const width = page.__mobile ? 390 : 1280;
  let buf;
  if (o && o.fullPage) {
    const h = Math.min(await page.evaluate(() => document.documentElement.scrollHeight), 2400);
    buf = await page.screenshot({ type: "jpeg", quality: 60, fullPage: true, clip: { x: 0, y: 0, width, height: h } });
  } else buf = await page.screenshot({ type: "jpeg", quality: 60 });
  report.shots.push(safe);
  emit(safe, buf);
}

async function defaultRun(ctx) {
  for (const [label, mobile] of [["mobile", true], ["desktop", false]]) {
    const page = await ctx.newPage({ mobile });
    await page.goto(URL_, { waitUntil: "networkidle", timeout: 30000 });
    if (mobile) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      ctx.assert(!overflow, "no horizontal scrolling on mobile");
    }
    ctx.assert(((await page.title()) || "").length > 0, label + ": page has a title");
    await ctx.shot(page, label, { fullPage: true });
  }
}

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox"] });
    const ctx = {
      url: URL_,
      browser,
      newPage: (o) => newPage(browser, o),
      shot,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      log: (m) => { if (report.logs.length < 50) report.logs.push(String(m).slice(0, 300)); },
      assert: (cond, msg) => { report.assertions.push({ pass: !!cond, msg: String(msg).slice(0, 200) }); },
    };
    if (SCRIPT) {
      const abs = path.resolve(SCRIPT);
      if (!abs.startsWith(process.cwd() + path.sep)) throw new Error("script must be inside the repo");
      const mod = require(abs);
      const fn = typeof mod === "function" ? mod : mod.run;
      if (typeof fn !== "function") throw new Error("playtest script must export an async function (module.exports = async (ctx) => {...})");
      let timer;
      await Promise.race([fn(ctx), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("playtest timed out after 90s")), 90000); })]);
      clearTimeout(timer);
    } else await defaultRun(ctx);
  } catch (e) {
    report.ok = false;
    report.error = String((e && e.stack) || e).slice(0, 1500);
  }
  if (browser) { try { await browser.close(); } catch (e) {} }
  report.ok = report.ok && report.assertions.every((a) => a.pass);
  console.log("CLAUDEX_REPORT " + JSON.stringify(report));
  process.exit(report.ok ? 0 : 1);
})();
