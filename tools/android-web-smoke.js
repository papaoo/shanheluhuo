'use strict';
// Test the packaged payload with external networking blocked. Android native
// lifecycle/filesystem behavior is deliberately left to device acceptance.
// node tools/android-web-smoke.js [mobile/www] [--write report.json]
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto');
const assert = require('assert/strict');
const { launch, inspect, ROOT } = require('./i18n/browser-check');
const { verifyBundle } = require('./check-www');
const root = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(ROOT, 'mobile/www'));
const writeArg = process.argv.indexOf('--write');
const output = writeArg >= 0 ? path.resolve(process.argv[writeArg + 1]) : path.join(ROOT, 'tests/i18n/out/android-web-smoke.json');
const out = path.dirname(output);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
async function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let url;
      try { url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); return res.end(); }
      if (url.endsWith('/')) url += 'index.html';
      const file = path.resolve(root, '.' + url);
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    }).listen(0, '127.0.0.1', () => resolve(server));
  });
}
async function main() {
  fs.mkdirSync(out, { recursive: true });
  const bundle = verifyBundle(root);
  assert.deepEqual(bundle.errors, [], 'bundle references and hashes');
  const server = await serve();
  let browser;
  try { browser = await launch(); }
  catch (e) { await new Promise(resolve => server.close(resolve)); throw e; }
  const base = 'http://127.0.0.1:' + server.address().port;
  const manifest = fs.readFileSync(path.join(root, 'build-manifest.json'));
  const report = { capturedAt: new Date().toISOString(), bundle, manifestSha256: crypto.createHash('sha256').update(manifest).digest('hex'),
    browser: browser.version(), scope: 'Packaged web payload in Chromium; external HTTP blocked; not a device FPS or native-bridge test.', profiles: [] };
  let saved;
  try {
    for (const [name, width, height, fallback] of [['landscape', 844, 390, false], ['portrait-fallback', 390, 844, true], ['compact-landscape', 640, 360, false]]) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US' });
      const r = { name, externalBlocked: [], failed: [], errors: [], screens: {} };
      report.profiles.push(r);
      await context.route(/^https?:\/\//, route => {
        if (route.request().url().startsWith(base + '/')) return route.continue();
        r.externalBlocked.push({ url: route.request().url(), type: route.request().resourceType() });
        return route.abort('internetdisconnected');
      });
      if (fallback) await context.addInitScript(() => {
        delete Object.hasOwn; delete Array.prototype.at;
        Intl.Segmenter = undefined;
        window.DecompressionStream = undefined;
      });
      const page = await context.newPage();
      page.setDefaultTimeout(45000);
      page.on('pageerror', e => r.errors.push(e.message));
      page.on('response', response => { if (response.url().startsWith(base + '/') && response.status() >= 400) r.failed.push(response.status() + ' ' + response.url().slice(base.length)); });
      const capture = async label => {
        await page.waitForTimeout(250);
        r.screens[label] = await inspect(page);
        const filename = 'android-' + name + '-' + label + '.png';
        await page.screenshot({ path: path.join(out, filename) });
        r.screens[label].screenshot = { filename, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(out, filename))).digest('hex') };
        assert.equal(r.screens[label].language, 'zh-CN', label + ': language');
        assert.deepEqual(r.screens[label].russian, [], label + ': untranslated system text');
        assert.deepEqual(r.screens[label].overflow, [], label + ': overflowing button text');
        assert.equal(r.screens[label].horizontalOverflow, false, label + ': horizontal overflow');
      };
      try {
        if (fallback) assert.equal(typeof saved, 'string', 'the first profile must provide a valid saved game');
        await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.waitForSelector('#start-menu [data-sm="new"]');
        assert.equal(await page.evaluate(() => I18N.lang), 'zh-CN', 'fresh English-locale device defaults to Chinese');
        assert.equal(await page.evaluate(() => t('Новая игра')), '新游戏');
        await capture('menu');
        if (!fallback) {
          await page.click('#start-menu [data-sm="new"]');
          await page.click('#start-menu [data-sm="mode-free"]');
          await page.waitForSelector('#start-menu [data-panel="map"]:not(.hidden)');
          await page.click('#start-menu [data-sm="map-go"]');
          await page.waitForSelector('#start-menu [data-panel="diff"]:not(.hidden)');
          await page.click('#start-menu [data-sm="diff:normal"]');
          await page.waitForSelector('#ha-name');
          await page.fill('#ha-name', '中文勇士·A7');
          await capture('name');
          await page.click('#ha-editor [data-ha="ok"]');
          await page.waitForFunction(() => !StartMenu.open && Game.hero && Game.hero.hero.name === '中文勇士·A7');
        } else {
          await page.evaluate(raw => { localStorage.setItem('feod.save.manual', raw); localStorage.setItem('feod.save.manual.meta', '{"time":1}'); }, saved);
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
          await page.waitForSelector('#start-menu [data-sm="continue"]:not([disabled])');
          await page.click('#start-menu [data-sm="continue"]');
          await page.waitForFunction(() => !StartMenu.open && Game.hero && Game.hero.hero.name === '中文勇士·A7');
        }
        await page.evaluate(() => { Game.paused = true; if (typeof tutClose === 'function') tutClose(false); if (typeof Notify !== 'undefined') Notify.want.tut = false; });
        r.save = await page.evaluate(() => {
          const snapshot = () => ({ name: Game.hero.hero.name, buildings: Game.buildings.length, units: Game.units.length });
          const before = snapshot(), saved = saveGame('manual'), loaded = loadGame('manual');
          return { before, saved, loaded, after: snapshot() };
        });
        assert.equal(r.save.saved, true); assert.equal(r.save.loaded, true);
        assert.deepEqual(r.save.after, r.save.before);
        saved = await page.evaluate(() => localStorage.getItem('feod.save.manual'));
        r.text = await page.evaluate(() => {
          const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 60;
          const c = canvas.getContext('2d'); c.font = '32px sans-serif';
          const glyph = text => { c.clearRect(0, 0, 100, 60); c.fillText(text, 3, 40); return canvas.toDataURL(); };
          const empty = canvas.toDataURL(), zhong = glyph('中'), wen = glyph('文'), tofu = glyph('\u{10FFFF}');
          const original = c.font, lines = I18N.wrapText(c, '矮人走进酒馆，喝了一杯麦酒。', 100);
          return { chineseGlyphs: zhong !== empty && wen !== empty && zhong !== wen && zhong !== tofu && wen !== tofu,
            wrapped: lines.length > 1 && lines.every(line => c.measureText(line).width <= 100), restoredFont: c.font === original,
            segmenter: typeof Intl.Segmenter, at: [1, 2].at(-1), hasOwn: Object.hasOwn({a: 1}, 'a'), decompressionStream: typeof DecompressionStream };
        });
        assert.equal(r.text.chineseGlyphs, true); assert.equal(r.text.wrapped, true); assert.equal(r.text.restoredFont, true);
        assert.equal(r.text.at, 2); assert.equal(r.text.hasOwn, true);
        if (fallback) {
          assert.equal(r.text.segmenter, 'undefined'); assert.equal(r.text.decompressionStream, 'undefined');
          r.frogFallback = await page.evaluate(async () => {
            await FrogDirections.bakedReady;
            const state = FrogDirections.states('ftG').find(s => !FrogStartFrames['ftG|S|' + s]);
            const before = FrogDirections.bankStats().proceduralBuilds;
            const frame = FrogDirections.frame('ftG', state, 'S');
            const pixels = frame.cv.getContext('2d').getImageData(0, 0, frame.cv.width, frame.cv.height).data;
            return { state, drawn: pixels.some((value, index) => index % 4 === 3 && value > 0),
              built: FrogDirections.bankStats().proceduralBuilds > before, errors: FrogDirections.errors.slice() };
          });
          assert.equal(r.frogFallback.drawn, true); assert.equal(r.frogFallback.built, true);
        } else {
          r.frogBanks = await page.evaluate(async () => ({ ready: await FrogDirections.bakedReady,
            stats: FrogDirections.bankStats(), errors: FrogDirections.errors.slice() }));
          assert.equal(r.frogBanks.ready, true, 'modern WebView must load both pre-rendered frog frame banks');
          assert.deepEqual(r.frogBanks.errors, [], 'frog frame-bank loading errors');
          assert.ok(r.frogBanks.stats.frequent.frames > 0 && r.frogBanks.stats.rare.frames > 0);
          assert.equal(r.frogBanks.stats.frequentPending, false); assert.equal(r.frogBanks.stats.rarePending, false);
        }
        await capture('game');
        await page.evaluate(() => { R.cam.z = 0.5; render(); });
        await capture('zoom');
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.waitForSelector('#start-menu [data-sm="continue"]:not([disabled])');
        await page.click('#start-menu [data-sm="continue"]');
        await page.waitForFunction(() => !StartMenu.open && Game.hero && Game.hero.hero.name === '中文勇士·A7');
        r.reload = await page.evaluate(() => ({ name: Game.hero.hero.name, language: I18N.lang, buildings: Game.buildings.length }));
        assert.equal(r.reload.language, 'zh-CN');
        assert.deepEqual(r.errors, []); assert.deepEqual(r.failed, []);
        assert.deepEqual(r.externalBlocked.filter(v => ['script', 'stylesheet', 'image', 'font', 'media'].includes(v.type)), [], 'offline game must not request external assets');
      } catch (e) { r.failure = e.stack; await page.screenshot({ path: path.join(out, 'android-' + name + '-error.png') }).catch(() => {}); }
      finally { await context.close(); }
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
  report.failures = report.profiles.filter(p => p.failure).map(p => p.name + ': ' + p.failure.split('\n')[0]);
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, manifestSha256: report.manifestSha256, profiles: report.profiles.map(p => ({ name: p.name, errors: p.errors, failed: p.failed, externalBlocked: p.externalBlocked, save: p.save, text: p.text, frogFallback: p.frogFallback, frogBanks: p.frogBanks, reload: p.reload })), failures: report.failures }, null, 2));
  if (report.failures.length) process.exitCode = 1;
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
