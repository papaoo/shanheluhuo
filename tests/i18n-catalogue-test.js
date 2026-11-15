'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { audit } = require('../tools/i18n/zh-audit');
const htmlFixtures = require('./fixtures/i18n-zh-html.json');
const seasonFixtures = require('./fixtures/i18n-zh-seasons.json');
const visibleNumbers = text => (text.replace(/<[^>]*>/g, '').match(/\d+(?:[.,]\d+)?%?/g) || []);
const { report, context, en, zh } = audit();
assert.deepEqual(report.errors, [], report.errors.join('\n'));
assert.deepEqual(report.missingBase, [], 'Every shipped English key needs an independent Chinese translation');
assert.deepEqual(report.conflictingDuplicates, [], 'Duplicate source keys must agree across all Chinese modules');
for (const [key, value] of Object.entries(zh)) {
  assert.equal(context.t(key), value, 'Explicit lookup must preserve the whole translation: ' + key);
}
// Real rendered fragments also cover empty branches and HTML inserted inside
// source templates, which an exact dictionary-key audit cannot exercise.
context.I18N.setLang('zh-CN');
for (const { source, html, after } of htmlFixtures) {
  const actual = context.I18N.trHtml(html);
  assert.equal(actual, after, 'Rendered Chinese fragment changed: ' + source);
  assert.deepEqual(actual.match(/<[^>]*>/g) || [], html.match(/<[^>]*>/g) || [], 'HTML tags changed: ' + source);
  assert.deepEqual(visibleNumbers(actual), visibleNumbers(html), 'Visible numbers changed: ' + source);
}
// Build the actual season tooltip: independently translated sentences must
// survive concatenation, including reserve counters and permanent biomes.
const snow = fs.readFileSync(path.join(__dirname, '../js/world/snow.js'), 'utf8');
vm.runInContext(snow.slice(snow.indexOf('const SEA_GLYPH'), snow.indexOf('\nconst MT_CAP')), context);
for (const { name, state, raw, after, chip } of seasonFixtures) {
  Object.assign(context, { SEA: () => state, SEA_NAMES: ['Лето', 'Осень', 'Зима', 'Весна'],
    seaIdx: () => state.index, seaDayIn: () => state.day, isMirror: () => false,
    seaHayInfo: () => state.hay, seaWoodInfo: () => state.wood });
  context.I18N.setLang('ru');
  assert.equal(vm.runInContext('seaChipTip()', context), raw, 'Russian season tooltip changed: ' + name);
  context.I18N.setLang('zh-CN');
  const actual = context.I18N.trHtml(vm.runInContext('seaChipTip()', context));
  assert.equal(actual, after, 'Chinese season tooltip changed: ' + name);
  assert.deepEqual(visibleNumbers(actual), visibleNumbers(raw), 'Season tooltip numbers changed: ' + name);
  if (chip) for (const profile of ['desktop', 'portrait', 'landscape']) {
    const mobile = profile !== 'desktop';
    context.document.body = { classList: { contains: className => className === 'mobile' && mobile } };
    const text = vm.runInContext('seaChipText()', context), expected = chip[mobile ? 'mobile' : 'desktop'];
    assert.equal(context.I18N.tr(text), expected, 'Winter clock label changed: ' + name + ' / ' + profile);
    const clock = { textContent: '', title: '' };
    context.document.getElementById = id => id === 'clock' ? clock : null;
    Object.assign(context, { Game: { sea: state, time: 0 }, isNightNow: () => false, isEveningNow: () => false });
    vm.runInContext('seaChip()', context);
    assert.equal(context.I18N.tr(clock.textContent), '☀ 00:00 · ' + expected, 'Full winter clock changed: ' + name + ' / ' + profile);
    assert.deepEqual(visibleNumbers(expected), visibleNumbers(text), 'Winter clock numbers changed: ' + name + ' / ' + profile);
  }
}
for (const [key, value] of Object.entries(en)) {
  context.I18N.setLang('en');
  assert.equal(context.t(key), value, 'English dictionary lookup changed: ' + key);
}
context.I18N.setLang('ru');
assert.equal(context.t('Склад'), 'Склад');
// Exercise the real help generator with production building costs. Russian
// "стоит" also means "is idle", so construction cost needs its own context.
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/config.js'), 'utf8'), context);
Object.assign(context, { SARC_B: {}, SARC_CAT: {}, SARC_G: {}, CREATURES: [], GUIDE_TOPICS: [],
  producersOf: () => [], consumersOf: () => [], bName: name => name });
const guide = fs.readFileSync(path.join(__dirname, '../js/guide.js'), 'utf8');
vm.runInContext(guide.slice(guide.indexOf('function guideEntries()'), guide.indexOf('\nconst GUIDE_CATS')), context);
const rawEntries = vm.runInContext('guideEntries()', context);
context.I18N.setLang('en');
assert.deepEqual(vm.runInContext('guideEntries()', context), rawEntries, 'Russian/English help source must remain unchanged');
context.I18N.setLang('zh-CN');
const localEntries = vm.runInContext('guideEntries()', context);
const storeBody = context.I18N.trHtml(localEntries.find(e => e.id === 'b:storehouse').body);
assert.match(storeBody, /造价：6 木板[，,] ?6 石头。/);
assert.ok(!storeBody.includes('停工'), 'Construction costs must not translate as idle status');
for (const entry of localEntries.filter(e => e.id.startsWith('b:'))) {
  const raw = rawEntries.find(e => e.id === entry.id).body;
  const body = context.I18N.trHtml(entry.body);
  assert.ok(!/[А-Яа-яЁё]/.test(body), 'Building help must translate collapsed details too: ' + entry.id + '\n' + body);
  const productionNumbers = s => visibleNumbers((s.match(/<p class="gk">[\s\S]*?<\/p>/g) || []).join(''));
  assert.deepEqual(productionNumbers(body), productionNumbers(raw), 'Building cost/recipe numbers changed: ' + entry.id);
  if (raw.includes(' Работает:')) assert.ok(body.includes('工作人员：'), 'Worker requirement missing: ' + entry.id);
  if (raw.includes(' Работает сам.')) assert.ok(body.includes('自动运作'), 'Automatic production missing: ' + entry.id);
}
console.log('Chinese catalogue: ' + report.chineseKeys + ' keys, ' + htmlFixtures.length + ' rendered HTML fixtures, ' + seasonFixtures.length + ' season tooltips, exact placeholders, valid locale and preserved English/Russian lookup.');
