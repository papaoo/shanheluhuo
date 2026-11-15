// Translation authoring helper. Keeps Russian keys intact; never edits English dictionaries.
// node tools/i18n/zh-batch.js list ui 0 80
// node tools/i18n/zh-batch.js write ui 0 <UTF-8 JSON array of translated values>
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '../..');
function dictionary(file, lang) {
  const d = {};
  if (fs.existsSync(file)) vm.runInNewContext(fs.readFileSync(file, 'utf8'), { I18N: { add(l, o) { if (l === lang) Object.assign(d, o); } } });
  return d;
}
const [action, moduleName, startArg = '0', input = '80'] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(moduleName || '')) throw new Error('Invalid module');
const source = path.join(ROOT, 'js/i18n/en-' + moduleName + '.js');
if (!fs.existsSync(source)) throw new Error('Source dictionary does not exist');
const entries = Object.entries(dictionary(source, 'en')), start = Number(startArg);
if (!Number.isInteger(start) || start < 0) throw new Error('Invalid offset');
if (action === 'list') {
  for (let i = start; i < Math.min(entries.length, start + Number(input)); i++) console.log(JSON.stringify([i, ...entries[i]]));
} else if (action === 'write') {
  const values = JSON.parse(fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, ''));
  if (!Array.isArray(values) || start + values.length > entries.length) throw new Error('Batch exceeds source');
  const target = path.join(ROOT, 'js/i18n/zh-CN-' + moduleName + '.js'), result = dictionary(target, 'zh-CN');
  const ph = s => (s.match(/\{\d+\}/g) || []).sort().join(',');
  values.forEach((value, j) => {
    const key = entries[start + j][0];
    if (typeof value !== 'string' || !value.trim()) throw new Error('Empty translation at ' + (start + j));
    if (ph(key) !== ph(value)) throw new Error('Placeholder mismatch at ' + (start + j) + ': ' + key);
    result[key] = value;
  });
  const body = entries.filter(([key]) => Object.prototype.hasOwnProperty.call(result, key)).map(([key]) => '  ' + JSON.stringify(key) + ': ' + JSON.stringify(result[key])).join(',\n');
  fs.writeFileSync(target, "// Simplified Chinese. Russian source keys are intentionally preserved.\nI18N.add('zh-CN', {\n" + body + '\n});\n');
  console.log(`${moduleName}: ${Object.keys(result).length}/${entries.length} entries`);
} else throw new Error('Use list or write');
