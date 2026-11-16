'use strict';
// Localisation contracts, with isolated DOM / Canvas substitutes. No browser,
// production dictionaries or network needed for these runtime behaviour tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/i18n.js'), 'utf8');

function boot({ query = '', stored, nav = 'en-US', noStorage = false, dom = true } = {}) {
  const data = new Map(stored == null ? [] : [['og_lang', stored]]), scripts = [], events = {}, drawn = [];
  const nodeProp = (proto, name) => Object.defineProperty(proto, name, {
    configurable: true, get() { return this['_' + name] || ''; }, set(v) { this['_' + name] = v; },
  });
  class Node { constructor() { this.parentElement = null; this.nodeType = 1; } }
  nodeProp(Node.prototype, 'textContent'); nodeProp(Node.prototype, 'nodeValue');
  class Element extends Node {
    constructor(tag = 'div') { super(); this.tagName = tag.toUpperCase(); this.attrs = {}; }
    getAttribute(n) { return this.attrs[n] == null ? null : this.attrs[n]; }
    hasAttribute(n) { return n in this.attrs; }
    setAttribute(n, v) { this.attrs[n] = String(v); }
    insertAdjacentHTML(pos, html) { this.inserted = html; }
  }
  nodeProp(Element.prototype, 'innerHTML'); nodeProp(Element.prototype, 'outerHTML');
  class HTMLElement extends Element {}
  nodeProp(HTMLElement.prototype, 'innerText'); nodeProp(HTMLElement.prototype, 'title');
  class CharacterData extends Node { constructor() { super(); this.nodeType = 3; } }
  nodeProp(CharacterData.prototype, 'data');
  class HTMLInputElement extends HTMLElement { constructor() { super('input'); } }
  nodeProp(HTMLInputElement.prototype, 'value'); nodeProp(HTMLInputElement.prototype, 'placeholder');
  class HTMLImageElement extends HTMLElement { constructor() { super('img'); } }
  nodeProp(HTMLImageElement.prototype, 'alt');
  class Document {
    constructor() { this.documentElement = new HTMLElement('html'); this.readyState = 'loading'; }
    addEventListener(n, fn) { (events[n] || (events[n] = [])).push(fn); }
    querySelectorAll() { return this.labels || []; }
    createTextNode(s) { const n = new CharacterData(); n.data = s; return n; }
    write(s) { scripts.push(s); }
  }
  nodeProp(Document.prototype, 'title');
  class CanvasRenderingContext2D {
    constructor() { this.font = 'bold 12px Georgia'; }
    measureText(s) { drawn.push({ kind: 'measure', s, font: this.font }); return { width: Array.from(s).reduce((n, c) => n + (/\p{Script=Han}/u.test(c) ? 12 : 6), 0) }; }
    fillText(s, x, y) { if (this.failDraw) throw Error('draw failed'); drawn.push({ kind: 'fill', s, x, y, font: this.font }); }
    strokeText(s, x, y) { drawn.push({ kind: 'stroke', s, x, y, font: this.font }); }
  }
  const document = new Document();
  const context = {
    console, URL, URLSearchParams, Intl, document,
    navigator: { languages: [nav], language: nav },
    location: { search: query, href: 'http://localhost/' + query, reload() { context.reloaded = true; } },
    history: { replaceState(a, b, u) { context.replacedURL = String(u); } },
    localStorage: { getItem(k) { if (noStorage) throw Error('blocked'); return data.get(k); }, setItem(k, v) { if (noStorage) throw Error('blocked'); data.set(k, v); } },
    CanvasRenderingContext2D,
    alert(m) { context.alerted = m; }, confirm(m) { context.confirmed = m; return true; },
  };
  if (dom) Object.assign(context, { Node, Element, HTMLElement, CharacterData, HTMLInputElement, HTMLImageElement, Document, MutationObserver: class { observe() {} } });
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'i18n.js' });
  return { ...context, data, scripts, events, drawn, context, classes: { Element, HTMLElement, HTMLInputElement, CharacterData } };
}
const zh = {
  'Склад': '仓库', 'Дерево': '木材', 'Гном': '矮人', 'Русский': '俄语',
  'Построено: {0} зданий': '已建成 {0} 栋建筑', 'Получено {0}: {1}': '获得{0}：{1}',
  'Здоровье': '生命值', 'Нет еды': '没有食物', 'Очень длинная история': '矮人走进酒馆，喝了一杯香醇的麦酒。',
};
const en = { 'Склад': 'Storehouse', 'Гном': 'Gnome', 'Построено: {0} зданий': 'Built: {0} buildings' };
let count = 0;
function check(label, fn) { fn(); count++; console.log('✓ ' + label); }

check('URL > saved preference > Chinese default, independent of browser language', () => {
  assert.equal(boot({ query: '?lang=zh-Hans', stored: 'ru', nav: 'en-US' }).I18N.lang, 'zh-CN');
  assert.equal(boot({ query: '?lang=bad', stored: 'zh', nav: 'ru' }).I18N.lang, 'zh-CN');
  assert.equal(boot({ stored: 'en', nav: 'zh-CN' }).I18N.lang, 'en');
  assert.equal(boot({ query: '?lang=ru', stored: 'zh-CN' }).I18N.lang, 'ru');
  assert.equal(boot({ stored: 'ru' }).I18N.lang, 'ru');
  for (const nav of ['zh-SG', 'en-US', 'ru-RU', 'de-DE', '']) {
    assert.equal(boot({ nav }).I18N.lang, 'zh-CN');
    assert.equal(boot({ nav, noStorage: true }).I18N.lang, 'zh-CN');
  }
  assert.equal(boot({ query: '?lang=bad', stored: 'bad', nav: 'en' }).I18N.lang, 'zh-CN');
  assert.equal(boot({ query: '?lang=zh', noStorage: true }).I18N.lang, 'zh-CN');
});
check('dictionaries load by selected locale; Russian remains source-only', () => {
  const c = boot({ query: '?lang=zh-CN' });
  assert.equal(c.scripts.length, 35);
  assert.ok(c.scripts.every(s => s.includes('js/i18n/zh-CN-')));
  assert.ok(c.scripts.at(-1).includes('zh-CN-extra.js'));
  assert.ok(boot({ query: '?lang=en' }).scripts.every(s => s.includes('js/i18n/en-')));
  assert.equal(boot({ query: '?lang=ru' }).scripts.length, 0);
  assert.equal(c.document.documentElement.lang, 'zh-CN');
});
check('three-language cycle retains native labels and preserves auto-save behaviour', () => {
  for (const [lang, next, name] of [['ru', 'en', 'English'], ['en', 'zh-CN', '简体中文'], ['zh-CN', 'ru', 'Русский']]) {
    const c = boot({ query: '?lang=' + lang });
    c.I18N.add('zh-CN', zh);
    const label = new c.classes.HTMLElement('b'); c.document.labels = [label];
    c.events.DOMContentLoaded[0]();
    assert.equal(label.textContent, name);
    let saved = 0;
    c.context.Game = { units: [{}] }; c.context.saveGame = slot => { assert.equal(slot, 'auto'); saved++; };
    c.I18N.toggle();
    assert.equal(c.data.get('og_lang'), next); assert.equal(c.I18N.lang, next);
    assert.equal(c.context.reloaded, true); assert.equal(saved, 1);
    assert.equal(new URL(c.context.replacedURL).searchParams.has('lang'), false);
    assert.deepEqual([...c.data.keys()], ['og_lang']);
  }
});
check('translation, nested arguments, inflected case and templates remain exact', () => {
  const c = boot({ query: '?lang=zh-CN' }); c.I18N.add('zh-CN', zh);
  assert.equal(c.t('Построено: {0} зданий', 12), '已建成 12 栋建筑');
  assert.equal(c.I18N.tr('Построено: 12 зданий'), '已建成 12 栋建筑');
  assert.equal(c.t('Получено {0}: {1}', 'Дерево', 7), '获得木材：7');
  assert.equal(c.I18N.tr('склад'), '仓库');
  assert.equal(c.I18N.tr('Склад\nНет еды'), '仓库\n没有食物');
  assert.equal(c.t('Построено: {0} зданий'), '已建成 {0} 栋建筑');
  assert.equal(c.I18N.tr('Gnome'), 'Gnome');
});
check('adding translations or switching dictionaries invalidates lookup caches', () => {
  const c = boot({ query: '?lang=zh-CN' });
  assert.equal(c.I18N.tr('Склад'), 'Склад'); assert.ok(c.I18N.missing().includes('Склад'));
  c.I18N.add('zh-CN', zh); c.I18N.add('en', en);
  assert.equal(c.I18N.tr('Склад'), '仓库');
  c.I18N.setLang('en'); assert.equal(c.I18N.tr('Склад'), 'Storehouse'); assert.equal(c.I18N.locale(), 'en-GB');
  assert.equal(c.I18N.missing().length, 0);
  c.I18N.setLang('ru'); assert.equal(c.I18N.tr('Склад'), 'Склад'); assert.equal(c.t('Гном'), 'Гном');
  c.I18N.setLang('zh'); assert.equal(c.I18N.tr('Склад'), '仓库'); assert.equal(c.I18N.locale(), 'zh-CN');
});
check('HTML translates visible copy, preserving script/style/code/user boundaries and IDs', () => {
  const c = boot({ query: '?lang=zh-CN' }); c.I18N.add('zh-CN', zh);
  const html = '<b data-id="Склад" title="Здоровье">Склад</b><input value="Гном" placeholder="Склад">';
  assert.equal(c.I18N.trHtml(html), '<b data-id="Склад" title="生命值">仓库</b><input value="Гном" placeholder="仓库">');
  for (const tag of ['script', 'style', 'pre', 'code', 'textarea']) {
    const s = '<' + tag + '>Склад</' + tag + '><p>Склад</p>';
    assert.equal(c.I18N.trHtml(s), '<' + tag + '>Склад</' + tag + '><p>仓库</p>');
  }
  for (const attr of ['translate="no"', 'data-i18n-skip', 'contenteditable="true"']) {
    assert.equal(c.I18N.trHtml('<div ' + attr + '><b>Склад</b></div><p>Склад</p>'), '<div ' + attr + '><b>Склад</b></div><p>仓库</p>');
  }
});
check('DOM setters never alter protected nodes or Chinese input data', () => {
  const c = boot({ query: '?lang=zh-CN' }); c.I18N.add('zh-CN', zh);
  const input = new c.classes.HTMLInputElement(); input.value = 'Гном'; input.placeholder = 'Склад';
  assert.equal(input.value, 'Гном'); assert.equal(input.placeholder, '仓库');
  const pre = new c.classes.HTMLElement('pre'); pre.textContent = 'Склад'; assert.equal(pre.textContent, 'Склад');
  const span = new c.classes.HTMLElement('span'); span.parentElement = pre; span.textContent = 'Склад'; assert.equal(span.textContent, 'Склад');
  const node = c.document.createTextNode('Склад'); assert.equal(node.data, 'Склад');
  node.parentElement = pre; c.I18N.walk(node); assert.equal(node.data, 'Склад');
  node.parentElement = new c.classes.HTMLElement(); c.I18N.walk(node); assert.equal(node.data, '仓库');
  const english = boot({ query: '?lang=en' }); english.I18N.add('en', en);
  const enInput = new english.classes.HTMLInputElement(); enInput.value = 'Гном'; assert.equal(enInput.value, 'Gnome');
});
check('Canvas measurement and both drawing paths share CJK font without leaking state', () => {
  const c = boot({ nav: 'zh-CN' }); c.I18N.add('zh-CN', zh);
  const ctx = new c.CanvasRenderingContext2D(); const original = ctx.font;
  assert.equal(ctx.measureText('Склад').width, 24); ctx.fillText('Склад', 10, 20); ctx.strokeText('Склад', 10, 20);
  assert.equal(ctx.font, original); assert.ok(c.drawn.every(x => x.s === '仓库' && x.font.includes('Noto Sans CJK SC')));
  assert.equal(new Set(c.drawn.map(x => x.font)).size, 1);
  c.confirm('Нет еды'); assert.equal(c.context.confirmed, '没有食物');
  const english = boot({ query: '?lang=en' }); const ec = new english.CanvasRenderingContext2D(); ec.fillText('Hello', 0, 0);
  assert.equal(english.drawn[0].font, ec.font);
});
check('Canvas avoids redundant font changes and restores fonts and name boundaries after errors', () => {
  const c = boot(); c.I18N.add('zh-CN', zh);
  const ctx = new c.CanvasRenderingContext2D();
  let font = c.I18N.canvasFont(ctx.font), writes = 0;
  Object.defineProperty(ctx, 'font', { get() { return font; }, set(v) { writes++; font = v; } });
  ctx.measureText('Склад'); ctx.fillText('Склад', 0, 0); ctx.strokeText('Склад', 0, 0);
  assert.equal(writes, 0, 'Already-localised font must not be reparsed by native Canvas setters');
  font = 'bold 12px Georgia'; ctx.failDraw = true;
  assert.throws(() => c.I18N.canvasUserText(ctx, 'fillText', 'Склад', 0, 0), /draw failed/);
  assert.equal(font, 'bold 12px Georgia');
  assert.equal(writes, 2, 'An exceptional draw must restore the original font');
  ctx.failDraw = false; ctx.fillText('Склад', 0, 0);
  assert.equal(c.drawn.at(-1).s, '仓库', 'A failed name draw must not suppress later system translations');
  const english = boot({ query: '?lang=en' }), ec = new english.CanvasRenderingContext2D();
  let enWrites = 0, enFont = ec.font;
  Object.defineProperty(ec, 'font', { get() { return enFont; }, set(v) { enWrites++; enFont = v; } });
  ec.measureText('123'); ec.fillText('123', 0, 0); ec.strokeText('123', 0, 0);
  assert.equal(enWrites, 0, 'English must retain its original no-font-write path');
});
check('Chinese wrapping translates before measuring, preserves content and explicit lines', () => {
  const c = boot({ nav: 'zh-CN' }); c.I18N.add('zh-CN', zh); const ctx = new c.CanvasRenderingContext2D();
  const lines = c.I18N.wrapText(ctx, 'Очень длинная история', 60);
  assert.ok(lines.length > 1); assert.equal(lines.join(''), zh['Очень длинная история']);
  assert.ok(lines.every(s => ctx.measureText(s).width <= 60 && !/^[，。！？]/.test(s)));
  assert.deepEqual(Array.from(c.I18N.wrapText(ctx, '仓库\n\n没有食物', 100)), ['仓库', '', '没有食物']);
  assert.equal(c.I18N.wrapText(ctx, 'Ctrl+S 保存', 100)[0], 'Ctrl+S 保存');
  assert.equal(ctx.font, 'bold 12px Georgia');
  // Older Android WebViews may not expose Intl.Segmenter. Keep the existing
  // code-point fallback usable instead of making the cached fast path required.
  c.context.Intl = {};
  const fallback = c.I18N.wrapText(ctx, '中文 Ctrl+S 保存', 100);
  assert.equal(fallback.join('').replace(/ /g, ''), '中文Ctrl+S保存');
  assert.ok(fallback.every(s => ctx.measureText(s).width <= 100));
  assert.equal(ctx.font, 'bold 12px Georgia');
});
check('user names matching source keys remain literal in HTML, native dialogs and Canvas', () => {
  const c = boot({ nav: 'zh-CN' });
  c.I18N.add('zh-CN', { ...zh, 'Игрок: {0}': '玩家：{0}' });
  for (const name of ['Склад', 'Русский', '中文勇士·A7', '<b>Склад</b>']) {
    const rendered = c.I18N.userFormatHTML('Игрок: {0}', name);
    assert.equal(c.I18N.trHtml(rendered), rendered);
    assert.ok(rendered.startsWith('玩家：<span translate="no" data-i18n-user>'));
    if (name.startsWith('<')) assert.ok(rendered.includes('&lt;b&gt;Склад&lt;/b&gt;'));
    c.confirm(c.I18N.userMessage('Игрок: {0}', name));
    assert.equal(String(c.context.confirmed), '玩家：' + name);
    const ctx = new c.CanvasRenderingContext2D();
    for (const method of ['measureText', 'fillText', 'strokeText']) c.I18N.canvasUserText(ctx, method, name, 0, 0);
    assert.ok(c.drawn.slice(-3).every(x => x.s === name && x.font.includes('Noto Sans CJK SC')));
    ctx.fillText('Склад', 0, 0);
    assert.equal(c.drawn.at(-1).s, '仓库', 'name protection must not leak into system labels');
  }
  const english = boot({ query: '?lang=en' }); english.I18N.add('en', en);
  assert.equal(english.I18N.userHTML('Склад'), 'Склад');
  assert.equal(english.I18N.trHtml(english.I18N.userHTML('Склад')), 'Storehouse');
  const ctx = new english.CanvasRenderingContext2D();
  english.I18N.canvasUserText(ctx, 'fillText', 'Склад', 0, 0);
  assert.equal(english.drawn.at(-1).s, 'Storehouse');
});
check('Chinese random default hero names localise without changing source name pools', () => {
  const c = boot({ nav: 'zh-CN' }); c.I18N.add('zh-CN', { 'Торин': '索林', 'Брунгильд': '布伦希尔德' });
  c.context.Math = Object.create(Math); c.context.Math.random = () => 0;
  const header = fs.readFileSync(path.join(__dirname, '../js/hero.js'), 'utf8').split('const heroNameHTML')[0];
  vm.runInNewContext(header, c.context);
  assert.equal(vm.runInNewContext('heroNameFor(false)', c.context), '索林');
  assert.equal(vm.runInNewContext('heroNameFor(true)', c.context), '布伦希尔德');
  assert.equal(vm.runInNewContext('HERO_NAMES_M[0]', c.context), 'Торин');
  c.I18N.setLang('ru'); assert.equal(vm.runInNewContext('heroNameFor(false)', c.context), 'Торин');
});
check('co-op UI preserves sender names and custom messages while translating preset chat', () => {
  const c = boot({ nav: 'zh-CN' });
  c.I18N.add('zh-CN', { ...zh, 'В деревне: {0}': '村中玩家：{0}' });
  const nodes = { 'cp-online': new c.classes.HTMLElement(), 'cp-log': new c.classes.HTMLElement() };
  c.document.getElementById = id => nodes[id] || null;
  c.context.Coop = { on: true, meta: { chat: ['Нет еды'] }, chatLog: [
    { from: 'Склад', text: 'Нет еды', at: Date.now() },
    { from: 'Русский', text: 'Склад', at: Date.now() },
  ] };
  c.context.Game = { units: [{ owner: 'Склад' }, { owner: 'Русский' }] };
  const client = fs.readFileSync(path.join(__dirname, '../js/coop/coopclient.js'), 'utf8');
  const helpers = client.slice(client.indexOf('const coopEsc ='), client.indexOf('\n', client.indexOf('const coopPresetChat =')));
  const hud = client.slice(client.indexOf('function coopRefreshHud()'), client.indexOf('\nsetInterval(', client.indexOf('function coopRefreshHud()')));
  vm.runInNewContext(helpers + '\n' + hud + '\ncoopRefreshHud();', c.context);
  assert.equal(nodes['cp-online'].innerHTML, '村中玩家：<span translate="no" data-i18n-user>Склад, Русский</span>');
  assert.ok(nodes['cp-log'].innerHTML.includes('>Склад</span>:</b> 没有食物'));
  assert.ok(nodes['cp-log'].innerHTML.includes('>Русский</span>:</b> <span translate="no" data-i18n-user>Склад</span>'));
  assert.equal(c.context.Coop.chatLog[0].text, 'Нет еды', 'wire data remains in source language');
});
check('headless simulation exposes translation and wrapping without DOM hooks', () => {
  const c = boot({ nav: 'zh-CN', dom: false }); c.I18N.add('zh-CN', zh);
  assert.equal(c.t('Склад'), '仓库'); assert.equal(typeof c.I18N.wrapText, 'function');
});
console.log(`i18n runtime: ${count} checks passed.`);
