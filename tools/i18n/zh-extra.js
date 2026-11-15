// Author translations for source strings added after the English catalogue.
// Scratch catalogues stay outside the repository; merge after review.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { scanAll, loadDict } = require('../i18n-extract');
const ROOT = path.resolve(__dirname, '../..');
const scratch = path.join(os.tmpdir(), 'oldgold-zh');
fs.mkdirSync(scratch, { recursive: true });
const [action, group, startArg = '0', input = '60'] = process.argv.slice(2);
if (!['story', 'changelog'].includes(group)) throw Error('Expected story or changelog');
const cataloguePath = path.join(scratch, 'extra-catalogue.json');
if (!fs.existsSync(cataloguePath)) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const loaded = new Set([...html.matchAll(/src="(js\/[^"?]+\.js)/g)].map(m => m[1]));
  loaded.add('index.html'); loaded.add('privacy.html');
  const en = loadDict();
  const entries = scanAll().filter(e => !(e.ru in en) && [...e.files].some(f => loaded.has(f.split(':')[0])))
    .map(e => ({ ru: e.ru, files: [...e.files], group: [...e.files][0].startsWith('js/changelog.js:') ? 'changelog' : 'story' }));
  fs.writeFileSync(cataloguePath, JSON.stringify(entries, null, 2));
}
const entries = JSON.parse(fs.readFileSync(cataloguePath, 'utf8')).filter(e => e.group === group);
const start = Number(startArg);
if (!Number.isInteger(start) || start < 0) throw Error('Invalid offset');
if (action === 'list') {
  for (let i = start; i < Math.min(entries.length, start + Number(input)); i++) console.log(JSON.stringify([i, entries[i].ru, entries[i].files]));
} else if (action === 'write') {
  const values = JSON.parse(fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, ''));
  if (!Array.isArray(values) || start + values.length > entries.length) throw Error('Invalid batch');
  const out = path.join(scratch, 'extra-' + group + '.json');
  const dict = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : {};
  const ph = s => (s.match(/\{\d+\}/g) || []).sort().join(',');
  values.forEach((v, j) => {
    const key = entries[start + j].ru;
    if (typeof v !== 'string' || !v.trim() || ph(key) !== ph(v)) throw Error('Invalid translation at ' + (start + j));
    dict[key] = v;
  });
  fs.writeFileSync(out, JSON.stringify(dict, null, 2));
  console.log(`${group}: ${Object.keys(dict).length}/${entries.length} entries — ${out}`);
} else throw Error('Use list or write');
