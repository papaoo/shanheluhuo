// Reproducible Chinese catalogue audit, using the browser's actual load order.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '../..');
function runtime(lang = 'zh-CN') {
  const context = { URLSearchParams, URL, Intl, navigator: { language: lang },
    location: { search: '?lang=' + lang }, localStorage: { getItem() {}, setItem() {} },
    document: { documentElement: {}, addEventListener() {}, write() {} } };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/i18n.js'), 'utf8'), context);
  return context;
}
function audit({ source = false } = {}) {
  const context = runtime(), I = context.I18N, errors = [], modules = [], duplicates = [], previous = new Map();
  const en = {}, zh = {};
  for (const lang of ['en', 'zh-CN']) for (const name of I.files(lang)) {
    const file = path.join(ROOT, 'js/i18n', name + '.js');
    if (!fs.existsSync(file)) { errors.push('Missing dictionary: ' + name); continue; }
    const local = {};
    try {
      vm.runInNewContext(fs.readFileSync(file, 'utf8'), { I18N: { add(l, dict) {
        if (l !== lang) errors.push(name + ': wrong locale ' + l);
        for (const [key, value] of Object.entries(dict)) {
          if (typeof value !== 'string' || !value.trim()) errors.push(name + ': empty value: ' + key);
          const ph = s => (String(s).match(/\{\d+\}/g) || []).sort().join(',');
          if (lang === 'zh-CN' && ph(key) !== ph(value)) errors.push(name + ': placeholder mismatch: ' + key);
          const prose = String(value).replace(/[^\s“”«»<>"']+\.(?:md|js|html|json)/g, token => fs.existsSync(path.join(ROOT, token)) ? '' : token);
          if (lang === 'zh-CN' && /[А-Яа-яЁё]/.test(prose) && value !== 'Русский') errors.push(name + ': Cyrillic in translation: ' + key);
          if (lang === 'zh-CN' && previous.has(key) && previous.get(key).value !== value) duplicates.push({ key, first: previous.get(key), last: { module: name, value } });
          if (lang === 'zh-CN') previous.set(key, { module: name, value });
          local[key] = value;
        }
      } } }, { filename: name });
      Object.assign(lang === 'en' ? en : zh, local);
      I.add(lang, local);
      if (lang === 'zh-CN') modules.push({ module: name, entries: Object.keys(local).length });
    } catch (e) { errors.push(name + ': ' + e.message); }
  }
  const missingBase = Object.keys(en).filter(k => !(k in zh));
  const report = { errors, modules, englishKeys: Object.keys(en).length, chineseKeys: Object.keys(zh).length, missingBase, conflictingDuplicates: duplicates };
  if (source) {
    const { scanAll } = require('../i18n-extract');
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const loaded = new Set([...html.matchAll(/src="(js\/[^"?]+\.js)/g)].map(m => m[1]));
    loaded.add('index.html'); loaded.add('privacy.html');
    const entries = scanAll();
    const live = entries.filter(e => [...e.files].some(f => loaded.has(f.split(':')[0])));
    report.source = { scanned: entries.length, browserCandidates: live.length, exact: 0, resolved: 0, unresolved: [], excludedNonBrowser: entries.length - live.length };
    for (const e of live) {
      if (e.ru in zh) { report.source.exact++; continue; }
      let rendered;
      try { rendered = I.tr(e.ru); } catch (error) { errors.push('Translation error: ' + e.ru + ': ' + error.message); rendered = e.ru; }
      if (/[А-Яа-яЁё]/.test(rendered)) report.source.unresolved.push({ ru: e.ru, rendered, files: [...e.files] });
      else report.source.resolved++;
    }
  }
  return { report, context, en, zh };
}
module.exports = { audit, runtime };
if (require.main === module) {
  const { report } = audit({ source: process.argv.includes('--source') });
  const out = process.argv.indexOf('--write');
  if (out >= 0) fs.writeFileSync(path.resolve(process.argv[out + 1]), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ englishKeys: report.englishKeys, chineseKeys: report.chineseKeys, missingBase: report.missingBase.length,
    conflictingDuplicates: report.conflictingDuplicates.length, errors: report.errors,
    source: report.source && { ...report.source, unresolved: report.source.unresolved.length } }, null, 2));
  if (report.errors.length || report.missingBase.length) process.exitCode = 1;
}
