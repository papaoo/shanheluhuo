'use strict';
// Prove translation happens before DOMContentLoaded, even on a slow WebView.
// Later game scripts are intentionally held/stubbed; full gameplay has separate
// acceptance. --baseline <SHA> can demonstrate the former first-paint failure.
const fs = require('fs'), path = require('path'), http = require('http'), cp = require('child_process'), crypto = require('crypto');
const assert = require('assert/strict');
const { launch, ROOT, OUT } = require('./browser-check');
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const root = path.resolve(arg('--web-root') || ROOT);
const output = path.resolve(arg('--write') || path.join(OUT, 'startup-check.json'));
const baseline = arg('--baseline');
if (baseline && !/^[a-f0-9]{7,40}$/.test(baseline)) throw new Error('Invalid --baseline commit');
const baselineIndex = baseline && cp.execFileSync('git', ['show', baseline + ':index.html'], { cwd: ROOT, encoding: 'utf8' });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf' };
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
async function snapshot(page) {
  return page.evaluate(() => {
    const visible = e => e && e.getClientRects().length > 0 && getComputedStyle(e).visibility === 'visible' && getComputedStyle(e).display !== 'none';
    const russian = [], walker = document.createTreeWalker(document.getElementById('loading'), NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) if (visible(node.parentElement) && !node.parentElement.closest('[translate="no"],script,style') && /[А-Яа-яЁё]/.test(node.data)) russian.push(node.data.trim());
    return { readyState: document.readyState, pending: document.documentElement.classList.contains('i18n-pending'),
      language: window.I18N && I18N.lang, menuVisible: visible(document.querySelector('#start-menu [data-sm="new"]')),
      subtitleVisible: visible(document.querySelector('.fantasy-subtitle')), russian,
      newGame: document.querySelector('[data-sm="new"] b').textContent,
      continueEnabled: !document.querySelector('[data-sm="continue"]').disabled,
      continueLabel: document.querySelector('[data-sm="continue"] small').textContent,
      nextLanguage: document.querySelector('.lang-name').textContent,
      mode: document.querySelector('[data-sm="mode-free"] b').textContent };
  });
}
async function main() {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
    if (baselineIndex && path.basename(file) === 'index.html') return res.end(baselineIndex);
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const git = args => cp.execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  const manifestFile = path.join(root, 'build-manifest.json');
  const report = { capturedAt: new Date().toISOString(), webRoot: root, baselineIndex: baseline || null,
    sourceCommit: git(['rev-parse', 'HEAD']), trackedChanges: git(['diff', '--name-only']),
    bundleManifestSha256: fs.existsSync(manifestFile) ? crypto.createHash('sha256').update(fs.readFileSync(manifestFile)).digest('hex') : null, cases: [] };
  try {
    browser = await launch(); report.browser = browser.version();
    const base = 'http://127.0.0.1:' + server.address().port;
    for (const fixture of [
      { name: 'default-zh', stored: null, query: '', language: 'zh-CN', newGame: '新游戏', next: 'Русский' },
      { name: 'saved-en', stored: 'en', resume: true, query: '', language: 'en', newGame: 'New game', next: '简体中文' },
      { name: 'selected-ru', stored: 'en', query: '?lang=ru', language: 'ru', newGame: 'Новая игра', next: 'English' }
    ]) {
      const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, locale: 'en-US' });
      const early = gate(), late = gate(), result = { name: fixture.name, errors: [] };
      report.cases.push(result);
      await context.addInitScript(({ stored, resume }) => {
        if (stored) localStorage.setItem('og_lang', stored);
        if (resume) localStorage.setItem('feod.save.manual.meta', '{"at":1}');
      }, { stored: fixture.stored, resume: !!fixture.resume });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== base) return route.abort();
        if (url.pathname === '/js/i18n.js') { await early.promise; return route.continue().catch(() => {}); }
        if (url.pathname === '/js/loading.js') { await late.promise; return route.continue().catch(() => {}); }
        // Only localization and actual index markup participate in this test.
        if (url.pathname.startsWith('/js/') && !url.pathname.startsWith('/js/i18n/')) return route.fulfill({ contentType: 'application/javascript', body: '' });
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', error => result.errors.push(error.message));
      try {
        await page.goto(base + '/' + fixture.query, { waitUntil: 'commit' });
        await page.waitForSelector('#start-menu', { state: 'attached' });
        // Give two real paint opportunities while i18n itself is still held.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        result.beforeDictionary = await snapshot(page);
        assert.equal(result.beforeDictionary.readyState, 'loading');
        assert.equal(result.beforeDictionary.pending, true, 'initial translation visibility gate is missing');
        assert.equal(result.beforeDictionary.menuVisible, false, 'source-language menu must never be painted before translation');
        assert.equal(result.beforeDictionary.subtitleVisible, false, 'source-language subtitle must not flash');
        assert.deepEqual(result.beforeDictionary.russian, []);
        early.release();
        await page.waitForFunction(() => window.I18N && !document.documentElement.classList.contains('i18n-pending'));
        result.beforeGameScripts = await snapshot(page);
        assert.equal(result.beforeGameScripts.readyState, 'loading', 'do not wait for DOMContentLoaded');
        assert.equal(result.beforeGameScripts.language, fixture.language);
        assert.equal(result.beforeGameScripts.menuVisible, true, 'translated menu should appear promptly');
        assert.equal(result.beforeGameScripts.newGame, fixture.newGame);
        assert.equal(result.beforeGameScripts.nextLanguage, fixture.next);
        if (fixture.resume) {
          assert.equal(result.beforeGameScripts.continueEnabled, true);
          assert.equal(/[А-Яа-яЁё]/.test(result.beforeGameScripts.continueLabel), false, 'early resume label must be translated');
        }
        if (fixture.language !== 'ru') assert.deepEqual(result.beforeGameScripts.russian, []);
        await page.click('[data-sm="new"]');
        result.earlyInteraction = await snapshot(page);
        assert.equal(await page.locator('[data-sm="mode-free"]').isVisible(), true);
        if (fixture.language !== 'ru') assert.deepEqual(result.earlyInteraction.russian, [], 'early submenu is translated too');
        await page.click('[data-sm="mode-free"]');
        result.queuedAction = await page.evaluate(() => ({ pending: document.getElementById('start-menu').dataset.pending,
          status: document.querySelector('.sm-boot-status').textContent, expectedStatus: t('Подготавливаем игру…'), readyState: document.readyState }));
        assert.equal(result.queuedAction.pending, 'mode-free', 'early game selection must remain queued for the real loader');
        assert.equal(result.queuedAction.readyState, 'loading');
        assert.equal(result.queuedAction.status, result.queuedAction.expectedStatus);
        if (fixture.language !== 'ru') assert.equal(/[А-Яа-яЁё]/.test(result.queuedAction.status), false, 'early preparation message must be translated');
        assert.deepEqual(result.errors, []);
      } catch (e) {
        result.failure = e.message;
        await page.screenshot({ path: output.replace(/\.json$/, '') + '-' + fixture.name + '-error.png', timeout: 1500 }).catch(() => {});
      } finally {
        // Close the parser before releasing game code which is outside scope.
        const closing = context.close(); early.release(); late.release(); await closing;
      }
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  report.failures = report.cases.filter(c => c.failure).map(c => c.name + ': ' + c.failure);
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (report.failures.length) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
