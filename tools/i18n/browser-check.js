// Local browser localisation acceptance. Uses an isolated, disposable profile.
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'tests/i18n/out');
const pw = require('../browsers/node_modules/playwright-core');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf' };
async function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let url;
      try { url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); return res.end(); }
      if (url === '/coop-info') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"online":0}'); }
      if (url.endsWith('/')) url += 'index.html';
      const file = path.resolve(ROOT, '.' + url);
      if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    }).listen(0, '127.0.0.1', () => resolve(server));
  });
}
async function launch() {
  const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(f => f && fs.existsSync(f));
  return pw.chromium.launch({ executablePath, headless: true });
}
async function inspect(page) {
  return page.evaluate(() => {
    const russian = [], overflow = [], buttons = [];
    const visible = e => e && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const e = n.parentElement;
      if (!visible(e) || e.closest('script,style,code,pre,textarea,[translate="no"],[data-i18n-skip]')) continue;
      if (/[А-Яа-яЁё]/.test(n.data)) russian.push({ text: n.data.trim(), tag: e.tagName, id: e.id, class: e.className });
    }
    for (const e of document.querySelectorAll('[title],[placeholder],[aria-label],[alt]')) if (visible(e) && !e.closest('[translate="no"],[data-i18n-skip]')) {
      for (const attr of ['title', 'placeholder', 'aria-label', 'alt']) {
        const text = e.getAttribute(attr);
        if (text && /[А-Яа-яЁё]/.test(text)) russian.push({ text, attr, tag: e.tagName, id: e.id });
      }
    }
    for (const e of document.querySelectorAll('button')) if (visible(e)) {
      buttons.push({ text: e.textContent.trim(), sm: e.dataset.sm, pa: e.dataset.pa, id: e.id });
      // Decorative vines intentionally extend outside the button. Inspect
      // actual text boxes, not scrollWidth (which includes those ornaments).
      const r = e.getBoundingClientRect(), tw = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
      let tn;
      while ((tn = tw.nextNode())) if (tn.data.trim()) {
        // Level badges deliberately hang outside their button; landscape
        // closes use a visible ::after cross with offscreen accessible text.
        if (tn.parentElement.closest('.hb-lv') || parseFloat(getComputedStyle(tn.parentElement).textIndent) < -100) continue;
        const range = document.createRange(); range.selectNodeContents(tn);
        for (const rect of range.getClientRects()) if (rect.left < r.left - 2 || rect.right > r.right + 2 || rect.bottom > r.bottom + 2) {
          overflow.push({ text: tn.data.trim(), button: e.dataset.sm || e.id, rect: [rect.left, rect.top, rect.right, rect.bottom], buttonRect: [r.left, r.top, r.right, r.bottom] }); break;
        }
      }
    }
    return { language: I18N.lang, htmlLanguage: document.documentElement.lang, russian, overflow, buttons,
      missing: I18N.missing(), horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
}
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve(), browser = await launch();
  const base = 'http://127.0.0.1:' + server.address().port;
  const profiles = process.argv.includes('--all') ? [['desktop', 1280, 800, false], ['portrait', 390, 844, true], ['landscape', 844, 390, true]] : [['desktop', 1280, 800, false]];
  const reports = [];
  try {
    for (const [name, width, height, mobile] of profiles) {
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: mobile, isMobile: mobile, locale: 'zh-CN', deviceScaleFactor: 1, reducedMotion: 'reduce' });
      // Acceptance is local and deterministic; external analytics and the
      // public co-op directory are unrelated to translated browser screens.
      await context.route(/^https?:\/\//, route => route.request().url().startsWith(base + '/') ? route.continue()
        : route.fulfill({ status: 200, contentType: route.request().resourceType() === 'script' ? 'application/javascript' : 'application/json', body: route.request().resourceType() === 'script' ? '' : '{"online":0}' }));
      const page = await context.newPage(), errors = [], failed = [];
      page.setDefaultTimeout(20000);
      page.on('pageerror', e => errors.push(e.message));
      page.on('response', r => { if (r.status() >= 400 && r.url().startsWith(base)) failed.push(r.status() + ' ' + r.url().slice(base.length)); });
      await page.goto(base + '/?lang=zh-CN', { waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.waitForSelector('#start-menu [data-sm="new"]', { timeout: 60000 });
      await page.addStyleTag({ content: '*{animation:none!important;transition:none!important;caret-color:transparent!important}' });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(OUT, name + '-menu.png') });
      const report = { name, errors, failed, menu: await inspect(page) };
      reports.push(report);
      if (process.argv.includes('--play')) {
        const capture = async label => {
          await page.waitForTimeout(250);
          report[label] = await inspect(page);
          await page.screenshot({ path: path.join(OUT, name + '-' + label + '.png') });
        };
        try {
          await page.click('#start-menu [data-sm="new"]'); await capture('mode');
          await page.click('#start-menu [data-sm="mode-free"]');
          await page.waitForSelector('#start-menu [data-panel="map"]:not(.hidden)'); await capture('map');
          await page.click('#start-menu [data-sm="map-go"]');
          await page.waitForSelector('#start-menu [data-panel="diff"]:not(.hidden)', { timeout: 60000 }); await capture('difficulty');
          await page.click('#start-menu [data-sm="diff:normal"]');
          await page.waitForSelector('#ha-name', { timeout: 60000 });
          await capture('appearance');
          await page.fill('#ha-name', '中文勇士·A7');
          await page.click('#ha-editor [data-ha="ok"]');
          await page.waitForFunction(() => !StartMenu.open && Game.hero && Game.hero.hero.name === '中文勇士·A7');
          // The normal first-run queue deliberately delays the tutorial.
          // Open the actual tutorial explicitly, then dismiss its queued copy.
          await page.evaluate(() => { Notify.want.tut = false; tutStart(); });
          await page.waitForFunction(() => Tut.on && Tut.el && !Tut.el.classList.contains('hidden'));
          await capture('tutorial');
          report.tutorialTemplates = await page.evaluate(() => TUT_STEPS.map(s => {
            const html = I18N.trHtml(s.text());
            const el = document.createElement('div'); el.innerHTML = html;
            return { id: s.id, text: el.textContent, untranslated: /[А-Яа-яЁё]/.test(el.textContent) };
          }));
          await page.evaluate(() => { tutClose(false); Notify.want.tut = false; });
          await capture('game');
          report.save = await page.evaluate(() => {
            Game.paused = true;
            const before = { name: Game.hero.hero.name, buildings: Game.buildings.length, units: Game.units.length };
            saveGame('manual'); const loaded = loadGame('manual');
            return { before, loaded, after: { name: Game.hero.hero.name, buildings: Game.buildings.length, units: Game.units.length } };
          });
          await page.locator('.rv-note').waitFor({ state: 'hidden', timeout: 30000 });
          await page.evaluate(() => { const spot = heroSpawnSpot(); R.cam.z = 2; centerOn((spot.sign[0] + .5) * TILE, (spot.sign[1] - 1) * TILE); });
          await capture('sign');
          if (mobile) {
            await page.evaluate(() => { R.cam.z = 1; const spot = heroSpawnSpot(); centerOn((spot.sign[0] + .5) * TILE, (spot.sign[1] - 1) * TILE); });
            await capture('zoom');
          }
          await page.evaluate(() => { tutClose(false); Notify.want.tut = false; if (typeof rvShowAll === 'function' && !rvShowAll()) rvToggleAll(); });
          for (const tab of ['build', 'overview', 'log', 'menu']) {
            await page.evaluate(t => { const b = document.querySelector('[data-tab="' + t + '"]'); if (b) b.click(); }, tab);
            await capture('tab-' + tab);
          }
          await page.evaluate(() => { Game.selected = Game.buildings.find(b => b.type === 'storehouse'); Game.selUnit = null; updateUI(true); if (Mobile.on) mobileSheet('info'); });
          await page.waitForSelector('#info', { state: 'visible' });
          await capture('building');
          await page.evaluate(() => { mobileSheet(null); Game.selected = null; Game.selUnit = Game.hero; heroCardUpdate(); heroCardMini = false; heroCardOpen = true; heroCardTab = 'hero'; heroCardUpdate(); });
          await page.waitForSelector('#hero-card', { state: 'visible' });
          await page.locator('.rv-note').waitFor({ state: 'hidden', timeout: 30000 });
          await capture('hero');
          await page.evaluate(() => { Game.selUnit = null; updateUI(true); guideOpen(); });
          await capture('help');
          await page.fill('#g-q', '仓库');
          await page.waitForSelector('#g-list .g-card');
          report.helpSearch = await page.locator('#g-list .g-t').allTextContents();
          await page.locator('#g-list .g-card').first().click();
          await capture('help-detail');
          await page.evaluate(() => { guideClose(); profOpen('ach'); });
          await capture('achievements');
          await page.evaluate(() => { profClose(); });
          report.contracts = await page.evaluate(() => {
            const input = document.createElement('input'); input.value = 'Склад';
            const code = document.createElement('pre'); code.textContent = 'Склад';
            const c = document.createElement('canvas').getContext('2d'); c.font = '12px sans-serif';
            const lines = I18N.wrapText(c, '矮人走进酒馆，喝了一杯麦酒。', 80);
            return { inputPreserved: input.value === 'Склад', codePreserved: code.textContent === 'Склад',
              wrapped: lines.length > 1 && lines.every(line => c.measureText(line).width <= 80), font: getComputedStyle(document.body).fontFamily };
          });
          if (name === 'desktop') {
            report.languages = [];
            for (const expected of ['ru', 'en', 'zh-CN']) {
              await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.evaluate(() => I18N.toggle())]);
              await page.waitForFunction(l => window.I18N && I18N.lang === l && typeof StartMenu !== 'undefined', expected);
              report.languages.push(await page.evaluate(() => ({ lang: I18N.lang, stored: localStorage.getItem('og_lang'), html: document.documentElement.lang, title: t('Новая игра') })));
            }
            await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; });
            await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 60000 });
            report.offlineCache = await page.evaluate(async () => {
              const keys = await caches.keys(), c = await caches.open(keys.find(k => k.startsWith('oldgold-zh-CN')));
              return { dictionaries: (await c.keys()).filter(r => /\/zh-CN-.*\.js$/.test(r.url)).length };
            });
            await context.setOffline(true);
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForSelector('#start-menu [data-sm="new"]');
            report.offline = await page.evaluate(() => ({ lang: I18N.lang, title: t('Новая игра'), dictionaries: Object.keys(I18N.dict['zh-CN']).length }));
            await page.click('#start-menu [data-sm="continue"]');
            await page.waitForFunction(() => !StartMenu.open && Game.hero && Game.buildings.length > 0);
            report.offline.play = await page.evaluate(() => ({ name: Game.hero.hero.name, buildings: Game.buildings.length }));
            await capture('offline-game');
            await context.setOffline(false);
            await page.goto(base + '/privacy.html?lang=zh-CN', { waitUntil: 'domcontentloaded' });
            await capture('privacy');
          }
        } catch (e) { report.playError = e.message; await page.screenshot({ path: path.join(OUT, name + '-error.png') }); }
      }
      await context.close();
    }
  } finally { await browser.close(); await new Promise(r => server.close(r)); }
  fs.writeFileSync(path.join(OUT, 'browser-report.json'), JSON.stringify(reports, null, 2));
  const git = args => require('child_process').execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  const screenshots = [];
  for (const r of reports) for (const [label, screen] of Object.entries(r)) if (screen && screen.russian) {
    const file = r.name + '-' + label + '.png';
    screenshots.push({ file, sha256: require('crypto').createHash('sha256').update(fs.readFileSync(path.join(OUT, file))).digest('hex') });
  }
  fs.writeFileSync(path.join(OUT, 'acceptance-manifest.json'), JSON.stringify({ commit: git(['rev-parse', 'HEAD']), trackedChanges: git(['diff', '--name-only']), capturedAt: new Date().toISOString(), browser: browser.version(), screenshots }, null, 2));
  const failures = [];
  for (const r of reports) {
    if (r.errors.length || r.failed.length || r.playError) failures.push(r.name + ': browser or flow error');
    for (const [key, screen] of Object.entries(r)) if (screen && screen.russian && (screen.russian.length || screen.overflow.length || screen.horizontalOverflow)) failures.push(r.name + '/' + key + ': untranslated or overflowing text');
    if (!process.argv.includes('--play')) continue;
    if (!r.save || !r.save.loaded || JSON.stringify(r.save.before) !== JSON.stringify(r.save.after)) failures.push(r.name + ': save roundtrip');
    if (!r.contracts || !r.contracts.inputPreserved || !r.contracts.codePreserved || !r.contracts.wrapped) failures.push(r.name + ': boundary or wrapping contract');
    if (!r.helpSearch || !r.helpSearch.length || !r.helpSearch.every(s => s.includes('仓库'))) failures.push(r.name + ': Chinese help search');
    if (!r.tutorialTemplates || r.tutorialTemplates.some(s => s.untranslated)) failures.push(r.name + ': tutorial fragments');
    if (r.name === 'desktop' && (!r.offline || r.offline.lang !== 'zh-CN' || !r.offline.play || r.offline.play.name !== '中文勇士·A7' || r.offlineCache.dictionaries !== 35 || r.languages.map(l => l.lang).join(',') !== 'ru,en,zh-CN')) failures.push('desktop: language/offline');
  }
  console.log(JSON.stringify(reports.map(r => ({ name: r.name, errors: r.errors, failed: r.failed, playError: r.playError, save: r.save,
    screens: Object.fromEntries(Object.entries(r).filter(([, v]) => v && v.russian).map(([k, v]) => [k, { russian: v.russian.length, textOverflow: v.overflow.length, horizontalOverflow: v.horizontalOverflow }])) })), null, 2));
  if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
}
module.exports = { serve, launch, inspect, ROOT, OUT };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
