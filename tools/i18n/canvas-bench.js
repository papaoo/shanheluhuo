// Paired microbenchmark for i18n Canvas overhead. This does not estimate game FPS.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const cp = require('node:child_process'), crypto = require('node:crypto');
const { launch, ROOT, OUT } = require('./browser-check');
const sha = process.argv[process.argv.indexOf('--baseline') + 1];
if (!process.argv.includes('--baseline') || !/^[0-9a-f]{7,40}$/.test(sha || '')) throw Error('Usage: node tools/i18n/canvas-bench.js --baseline <commit>');
const before = cp.execFileSync('git', ['show', sha + ':js/i18n.js'], { cwd: ROOT, encoding: 'utf8' });
const after = fs.readFileSync(path.join(ROOT, 'js/i18n.js'), 'utf8');
const digest = s => crypto.createHash('sha256').update(s).digest('hex');
const median = a => [...a].sort((x, y) => x - y)[a.length >> 1];

(async () => {
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><html><body></body></html>'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await launch();
  const report = { baseline: sha, beforeSourceSHA256: digest(before), afterSourceSHA256: digest(after), browser: browser.version(), samples: [], scope: 'Same-browser Canvas microbenchmark; no game FPS or device-performance claim.' };
  const contexts = [];
  try {
    for (const lang of ['zh-CN', 'en']) {
      const pages = {};
      for (const [variant, source] of [['before', before], ['after', after]]) {
        const context = await browser.newContext({ locale: lang }); contexts.push(context);
        const page = await context.newPage(); pages[variant] = page;
        await page.goto('http://127.0.0.1:' + server.address().port + '/?lang=' + lang);
        await page.evaluate(() => { document.write = () => {}; });
        await page.addScriptTag({ content: source });
        await page.evaluate(() => {
          I18N.add('zh-CN', { 'Склад': '仓库', 'Здоровье': '生命值', 'История': '矮人走进酒馆，喝了一杯香醇的麦酒。' });
          I18N.add('en', { 'Склад': 'Storehouse', 'Здоровье': 'Health', 'История': 'The dwarf entered the tavern and drank a mug of ale.' });
        });
      }
      const samples = { language: lang, timingsMs: { before: [], after: [] }, equivalent: false };
      const fixture = async page => page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 200;
        const c = canvas.getContext('2d'); c.font = 'bold 14px sans-serif';
        const original = c.font, metrics = [];
        for (const [i, text] of ['Склад', 'Здоровье', '90/90 · Ctrl+S', '中文勇士·A7'].entries()) {
          const m = c.measureText(text); metrics.push([m.width, m.actualBoundingBoxLeft, m.actualBoundingBoxRight, m.actualBoundingBoxAscent, m.actualBoundingBoxDescent]);
          c.strokeStyle = '#806020'; c.strokeText(text, 10, 20 + i * 25);
          c.fillStyle = '#f0c080'; c.fillText(text, 10, 20 + i * 25);
        }
        I18N.canvasUserText(c, 'fillText', 'Склад', 150, 20);
        const wrapped = I18N.wrapText(c, 'История', 120);
        wrapped.forEach((text, i) => c.fillText(text, 10, 125 + i * 20));
        return { pixels: canvas.toDataURL(), metrics, wrapped, original, restored: c.font };
      });
      const a = await fixture(pages.before), b = await fixture(pages.after);
      assert.deepEqual(b, a, lang + ': pixels, metrics, wrapping or restored font changed');
      samples.equivalent = true; samples.pixelSHA256 = digest(a.pixels); samples.metrics = a.metrics; samples.wrapped = a.wrapped;
      const bench = async page => page.evaluate(() => {
        const c = document.createElement('canvas').getContext('2d'); c.font = 'bold 12px sans-serif';
        const start = performance.now();
        for (let i = 0; i < 3000; i++) {
          c.measureText('仓库 123');
          c.fillText('生命值90/90', 0, 20);
          c.strokeText('中文勇士', 0, 40);
          if (i % 20 === 0) I18N.wrapText(c, 'История', 90);
        }
        c.getImageData(0, 0, 1, 1); // Include deferred raster work consistently.
        return performance.now() - start;
      });
      await bench(pages.before); await bench(pages.after); // Warm fonts/JIT in both pages.
      for (let i = 0; i < 6; i++) for (const variant of i % 2 ? ['after', 'before'] : ['before', 'after']) samples.timingsMs[variant].push(await bench(pages[variant]));
      samples.medianMs = { before: median(samples.timingsMs.before), after: median(samples.timingsMs.after) };
      samples.ratio = +(samples.medianMs.after / samples.medianMs.before).toFixed(3);
      report.samples.push(samples);
      await pages.before.close(); await pages.after.close();
    }
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'canvas-performance.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report.samples.map(({ language, equivalent, medianMs, ratio }) => ({ language, equivalent, medianMs, ratio })), null, 2));
  } finally { for (const context of contexts) await context.close(); await browser.close(); await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
