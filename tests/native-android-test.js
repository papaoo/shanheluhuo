'use strict';
// Exercise the shipped bridge and export UI against asynchronous Android results.
// Java compilation and the Android document picker still need a device/emulator.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

function boot(native = true, asyncListeners = false) {
  const listeners = {}, calls = [], store = new Map();
  const ctx = { console: { warn() {} }, document: { documentElement: { classList: { add() {} } } },
    Game: { units: [{}], paused: false }, StartMenu: { open: false }, handled: false,
    saveOK: true, accepted: true, result: { saved: true },
    t: s => s, confirm: s => { calls.push(['confirm', s]); return ctx.accepted; },
    alert: s => calls.push(['alert', s]), wmBack: () => ctx.handled,
    audioHide: () => calls.push(['audio', 'hide']), audioShow: () => calls.push(['audio', 'show']),
    saveGame: slot => { calls.push(['save', slot]); return ctx.saveOK; },
    localStorage: { getItem: k => store.get(k) || null },
  };
  ctx.window = ctx;
  if (native) ctx.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: {
    App: { addListener(name, fn) { listeners[name] = fn; const handle = { remove() {} }; return asyncListeners ? Promise.resolve(handle) : handle; }, exitApp: async () => calls.push(['exit']) },
    StatusBar: { hide() {} },
    OldGoldFiles: { saveFile: async options => { calls.push(['file', options]); if (ctx.error) throw ctx.error; return ctx.result; } },
  } };
  vm.createContext(ctx); vm.runInContext(read('js/native.js'), ctx);
  return { ctx, calls, listeners, store };
}

async function main() {
  let checks = 0;
  const check = async (name, fn) => { await fn(); checks++; console.log('✓ ' + name); };
  await check('browser leaves Android bridge and lifecycle untouched', () => {
    const { ctx, calls, listeners } = boot(false);
    assert.equal(ctx.OldGoldAndroid, undefined); assert.deepEqual(calls, []); assert.deepEqual(listeners, {});
  });
  await check('direct injected plugins and Promise-based listeners both register lifecycle and back', () => {
    for (const asyncListeners of [false, true]) {
      const { listeners } = boot(true, asyncListeners);
      assert.equal(typeof listeners.appStateChange, 'function');
      assert.equal(typeof listeners.backButton, 'function');
      assert.equal(typeof listeners.appRestoredResult, 'function');
    }
  });
  await check('restored export results notify only this plugin and method, with cancellation silent', () => {
    const { calls, listeners } = boot();
    const restored = listeners.appRestoredResult;
    for (const event of [null, {}, { pluginId: 'Camera', methodName: 'saveFile', success: false },
      { pluginId: 'OldGoldFiles', methodName: 'other', success: true, data: { saved: true } },
      { pluginId: 'OldGoldFiles', methodName: 'saveFile', success: true, data: { cancelled: true, saved: false } }]) restored(event);
    assert.deepEqual(calls, []);
    restored({ pluginId: 'OldGoldFiles', methodName: 'saveFile', success: true, data: { saved: true } });
    assert.deepEqual(calls.pop(), ['alert', 'Файл сохранён.']);
    restored({ pluginId: 'OldGoldFiles', methodName: 'saveFile', success: false, error: { message: 'Rejected URI' } });
    assert.deepEqual(calls.pop(), ['alert', 'Не удалось сохранить файл.']);
    restored({ pluginId: 'OldGoldFiles', methodName: 'saveFile', success: true, data: {} });
    assert.deepEqual(calls.pop(), ['alert', 'Не удалось сохранить файл.']);
  });
  await check('Android result distinguishes confirmed write, cancellation and failure', async () => {
    const { ctx, calls } = boot(); const data = '{"name":"中文勇士·A7","raw":"Склад"}\n';
    assert.equal(await ctx.OldGoldAndroid.saveFile('中文档案.json', data), true);
    assert.equal(calls[0][1].name, '中文档案.json'); assert.equal(calls[0][1].data, data);
    ctx.result = { cancelled: true }; assert.equal(await ctx.OldGoldAndroid.saveFile('a.json', data), null);
    ctx.error = Error('Provider rejected the write'); assert.equal(await ctx.OldGoldAndroid.saveFile('a.json', data), false);
    delete ctx.Capacitor.Plugins.OldGoldFiles;
    assert.equal(await ctx.OldGoldAndroid.saveFile('a.json', data), false, 'Missing native plugin must not claim a browser download succeeded');
  });
  await check('background saves once, pauses, silences and restores the prior pause state', () => {
    const { ctx, calls, listeners } = boot();
    listeners.appStateChange({ isActive: false }); listeners.appStateChange({ isActive: false });
    assert.equal(calls.filter(c => c[0] === 'save').length, 1); assert.equal(ctx.Game.paused, true);
    listeners.appStateChange({ isActive: true }); assert.equal(ctx.Game.paused, false);
    assert.ok(calls.some(c => c[0] === 'audio' && c[1] === 'show'));
    ctx.Game.paused = true; listeners.appStateChange({ isActive: false }); listeners.appStateChange({ isActive: true });
    assert.equal(ctx.Game.paused, true);
  });
  await check('start menu and lost games do not overwrite autosaves on background/exit', async () => {
    for (const mode of ['menu', 'lose']) {
      const { ctx, calls, listeners } = boot();
      if (mode === 'menu') ctx.StartMenu.open = true; else ctx.Game.goal = { over: { res: 'lose' } };
      listeners.appStateChange({ isActive: false }); listeners.appStateChange({ isActive: true });
      await listeners.backButton();
      assert.equal(calls.filter(c => c[0] === 'save').length, 0); assert.ok(calls.some(c => c[0] === 'exit'));
    }
  });
  await check('back closes a panel first, honours cancel and never exits after a failed save', async () => {
    const { ctx, calls, listeners } = boot();
    ctx.handled = true; await listeners.backButton(); assert.deepEqual(calls, []);
    ctx.handled = false; ctx.accepted = false; await listeners.backButton(); assert.equal(calls.length, 1);
    ctx.accepted = true; ctx.saveOK = false; await listeners.backButton();
    assert.ok(calls.some(c => c[0] === 'alert')); assert.ok(!calls.some(c => c[0] === 'exit'));
    ctx.saveOK = true; await listeners.backButton(); assert.equal(calls.at(-1)[0], 'exit');
  });
  await check('real saveExport preserves exact JSON and empty slots still return false', async () => {
    const { ctx, calls, store } = boot();
    Object.assign(ctx, { SAVE_KEY: 'feod.save.', saveRawGv: () => '0.12.5', saveMeta: () => ({ time: 120 }) });
    const src = read('js/save.js'); vm.runInContext(src.slice(src.indexOf('function saveDownload('), src.indexOf('\nfunction saveBrokenNotice')), ctx);
    assert.equal(ctx.saveExport('empty'), false);
    const raw = '{"v":2,"name":"中文勇士","units":[1]}'; store.set('feod.save.manual', raw);
    assert.equal(await ctx.saveExport('manual'), true); assert.equal(calls.at(-1)[1].data, raw);
  });
  await check('profile export preserves player and slot data and waits for native completion', async () => {
    const { ctx, calls, store } = boot();
    const profile = { name: '中文勇士', ach: {}, st: {} };
    Object.assign(ctx, { profCur: () => profile, PROF_SLOTS: 2, SAVE_KEY: 'feod.save.', slotKey: n => 'p1.' + n,
      profRefresh: () => calls.push(['refresh']), profMsg: '' });
    store.set('feod.save.p1.1', '{"name":"Склад"}'); store.set('feod.save.p1.1.meta', '{"time":7}');
    const src = read('js/profile.js'); vm.runInContext(src.slice(src.indexOf('async function profExport('), src.indexOf('\nfunction profImport(')), ctx);
    await ctx.profExport();
    const file = calls.find(c => c[0] === 'file')[1], parsed = JSON.parse(file.data);
    assert.equal(file.name, 'oldgold-中文勇士.json'); assert.deepEqual(parsed.profile, profile);
    assert.equal(parsed.slots[1].data, '{"name":"Склад"}'); assert.equal(parsed.slots[1].meta, '{"time":7}');
    assert.equal(ctx.profMsg, 'Файл сохранён.'); ctx.result = { cancelled: true }; await ctx.profExport(); assert.equal(ctx.profMsg, 'Отмена');
    ctx.error = Error('Provider rejected write'); await ctx.profExport(); assert.equal(ctx.profMsg, 'Не удалось сохранить файл.');
  });
  await check('save-file UI reports success only after Android confirms a completed write', async () => {
    const { ctx } = boot();
    class Element {
      constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this._text = ''; }
      appendChild(e) { this.children.push(e); e.parent = this; return e; }
      set textContent(v) { this._text = v; this.children = []; } get textContent() { return this._text; }
      set innerHTML(v) { this.children = ['b', 'br', 'span'].map(tag => new Element(tag)); }
      get firstChild() { return this.children[0]; } get lastChild() { return this.children.at(-1); }
      all() { return this.children.flatMap(e => [e, ...e.all()]); }
      querySelector(tag) { return this.all().find(e => e.tag === tag) || null; }
      remove() { if (this.parent) this.parent.children = this.parent.children.filter(e => e !== this); }
    }
    let resolve;
    const body = new Element('body');
    Object.assign(ctx, { document: { body, createElement: tag => new Element(tag), getElementById: () => null, addEventListener() {} },
      SAVE_KEY: 'feod.save.', saveMeta: slot => slot === 'auto' ? { time: 60, people: 17 } : null,
      saveExport: () => new Promise(r => { resolve = r; }) });
    vm.runInContext(read('js/savefile.js'), ctx); ctx.saveFileOpen();
    const button = body.all().find(e => e.tag === 'button' && e.textContent === 'Скачать файл');
    const message = body.all().find(e => (e.style.cssText || '').includes('min-height:20px'));
    for (const [result, label] of [[false, 'Не удалось сохранить файл.'], [null, 'Отмена'], [true, 'Файл сохранён.']]) {
      message.textContent = '';
      const pending = button.onclick({ currentTarget: button });
      assert.equal(message.textContent, ''); assert.equal(button.disabled, true);
      resolve(result); await pending;
      assert.equal(message.textContent, label); assert.equal(button.disabled, false);
    }
  });
  await check('Chinese text-only close buttons are handled before native exit', () => {
    const src = read('js/winmgr.js'); const { ctx } = boot();
    let closed = 0;
    const button = { offsetWidth: 30, textContent: '关闭', click: () => closed++ };
    const top = { classList: { contains: () => false }, querySelector: () => null, querySelectorAll: () => [button] };
    Object.assign(ctx, { wmDialogs: () => [top], WM: { seen: new Map() } });
    vm.runInContext(src.slice(src.indexOf('const WM_CLOSE_RE'), src.indexOf('// «Назад»')), ctx);
    assert.equal(ctx.wmCloseTop(), true); assert.equal(closed, 1);
  });
  console.log('Android native boundaries: ' + checks + ' checks passed.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
