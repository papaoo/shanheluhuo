'use strict';
// Real debug-APK acceptance on the isolated task emulator. Never clears app data.
// node tools/android-device-smoke.js [--serial emulator-5554] [--resume]
// --resume only continues the named acceptance save after an interrupted run.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const assert = require('assert/strict');
const { execFile } = require('child_process');
const { promisify } = require('util');
const run = promisify(execFile), ROOT = path.resolve(__dirname, '..');
const { chromium } = require('./browsers/node_modules/playwright-core');
const { inspect } = require('./i18n/browser-check');
const arg = (key, fallback) => { const i = process.argv.indexOf(key); if (i < 0) return fallback; if (!process.argv[i + 1] || process.argv[i + 1].startsWith('--')) throw Error(key + ' requires a value'); return process.argv[i + 1]; };
const ADB = arg('--adb', 'D:/Programs/SDK/platform-tools/adb.exe');
const SERIAL = arg('--serial', 'emulator-5554'), PACKAGE = 'ru.oldgold.zhcn';
const OUT = path.resolve(arg('--out', path.join(ROOT, 'mobile/out/device-debug')));
const HERO = '中文勇士·APK验收', RESUME = process.argv.includes('--resume');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { startedAt: new Date().toISOString(), serial: SERIAL, package: PACKAGE,
  scope: 'Installed debug APK on isolated Android emulator; native bridge, lifecycle, document picker and persistence. Not physical-device performance.',
  steps: [], screenshots: [], errors: [], failedResources: [], dialogs: [] };
let browser, page, forwardPort, network, hardKeyboard;
const dialogs = [];
async function adb(args, binary = false) {
  const result = await run(ADB, ['-s', SERIAL, ...args], { encoding: binary ? 'buffer' : 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 60000 });
  return binary ? result.stdout : result.stdout.trim();
}
const shell = (...args) => adb(['shell', ...args]);
async function until(fn, timeout = 30000, label = 'condition') {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) { try { const value = await fn(); if (value) return value; } catch (e) { last = e; } await delay(400); }
  throw Error('Timed out: ' + label + (last ? '\n' + last.message : ''));
}
function persist() { fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
async function step(name, fn) {
  const entry = { name, startedAt: new Date().toISOString() }; report.steps.push(entry); persist(); console.log('START ' + name);
  try { entry.result = await fn(); entry.passed = true; console.log('PASS ' + name); }
  catch (e) { entry.passed = false; entry.error = e.stack; throw e; }
  finally { entry.finishedAt = new Date().toISOString(); persist(); }
}
async function screenshot(label) {
  const data = await adb(['exec-out', 'screencap', '-p'], true);
  const filename = label + '.png'; fs.writeFileSync(path.join(OUT, filename), data);
  report.screenshots.push({ label, filename, bytes: data.length, sha256: sha(data) }); persist();
}
const decode = text => text.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function nodes(xml) {
  return [...xml.matchAll(/<node\b([^>]*)>/g)].map(m => Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(a => [a[1], decode(a[2])])));
}
async function ui(label) {
  const remote = '/sdcard/oldgold-device-smoke-ui.xml';
  await shell('uiautomator', 'dump', '--compressed', remote);
  const xml = await shell('cat', remote);
  fs.writeFileSync(path.join(OUT, label + '.xml'), xml);
  return nodes(xml);
}
async function tap(node) {
  const b = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(node.bounds || '');
  assert(b, 'Native UI node must have bounds');
  await shell('input', 'tap', String(Math.round((+b[1] + +b[3]) / 2)), String(Math.round((+b[2] + +b[4]) / 2)));
}
async function uiNode(label, predicate, timeout = 20000) {
  return until(async () => (await ui(label)).find(predicate), timeout, label);
}
async function start() { await shell('am', 'start', '-W', '-n', PACKAGE + '/ru.oldgold.game.MainActivity'); }
async function dismissSystemIntro() {
  // Once Android's one-time overlay has been acknowledged, do not ask
  // UIAutomator to wait for an idle, continuously animated game menu.
  if (await shell('settings', 'get', 'secure', 'immersive_mode_confirmations') === 'confirmed') return false;
  const current = await ui('system-intro');
  const gotIt = current.find(n => n.package === 'com.android.systemui' && (/:id\/ok$/.test(n['resource-id'] || '') || /^(Got it|知道了|确定)$/.test(n.text || '')));
  if (gotIt) { await screenshot('00-android-fullscreen-intro'); await tap(gotIt); await delay(300); }
  return !!gotIt;
}
async function connect() {
  if (browser) { await browser.close().catch(() => {}); browser = null; }
  if (forwardPort) { await adb(['forward', '--remove', 'tcp:' + forwardPort]).catch(() => {}); forwardPort = null; }
  const pid = await until(async () => (await shell('pidof', PACKAGE)).split(/\s/)[0], 30000, 'app process');
  const socket = await until(async () => {
    const list = await shell('cat', '/proc/net/unix');
    return list.match(new RegExp('@(webview_devtools_remote_' + pid + ')\\b'))?.[1];
  }, 60000, 'debug WebView socket');
  forwardPort = await adb(['forward', 'tcp:0', 'localabstract:' + socket]);
  // Android WebView has no Browser.setDownloadBehavior/context management.
  // Keep its native settings and focus/visibility behavior for lifecycle tests.
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + forwardPort, { timeout: 60000, noDefaults: true });
  page = await until(() => browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('https://localhost')), 60000, 'local APK page');
  page.setDefaultTimeout(60000);
  page.on('pageerror', e => { report.errors.push(e.message); persist(); });
  page.on('response', response => { if (response.url().startsWith('https://localhost/') && response.status() >= 400) { report.failedResources.push({ url: response.url(), status: response.status() }); persist(); } });
  // Keep a real JS confirmation open for the native-button acceptance step.
  page.on('dialog', dialog => { dialogs.push(dialog); report.dialogs.push({ type: dialog.type(), message: dialog.message() }); persist(); });
  await page.waitForFunction(() => typeof I18N !== 'undefined' && typeof StartMenu !== 'undefined');
}
async function gameplay() {
  await page.waitForFunction(name => !StartMenu.open && Game.hero && Game.hero.hero.name === name, HERO, { timeout: 180000 });
  await page.evaluate(() => { Game.paused = true; if (typeof tutClose === 'function') tutClose(false); if (typeof Notify !== 'undefined') Notify.want.tut = false; });
}
async function closePanels() {
  await page.evaluate(() => { if (typeof mobileSheet === 'function') mobileSheet(null); if (typeof profClose === 'function') profClose(); if (typeof guideClose === 'function') guideClose(); Game.tool = null; Game.selUnit = null; Game.selected = null; if (typeof tutClose === 'function') tutClose(false); });
}
async function inspectChinese(label) {
  const view = await inspect(page); fs.writeFileSync(path.join(OUT, label + '-text.json'), JSON.stringify(view, null, 2));
  assert.equal(view.language, 'zh-CN'); assert.deepEqual(view.russian, [], label + ': untranslated text');
  assert.deepEqual(view.overflow, [], label + ': overflowing button text'); assert.equal(view.horizontalOverflow, false);
  return { language: view.language, visibleButtons: view.buttons.length, russian: view.russian, overflow: view.overflow };
}
async function cacheFiles() { return (await shell('run-as', PACKAGE, 'ls', 'cache/oldgold-exports')).split(/\r?\n/).filter(Boolean); }
async function main() {
  assert(/^emulator-\d+$/.test(SERIAL), 'Refuse physical devices: only the task emulator is authorized');
  fs.mkdirSync(OUT, { recursive: true });
  assert.equal(await shell('getprop', 'ro.kernel.qemu'), '1', 'The target must be an emulator');
  report.device = { model: await shell('getprop', 'ro.product.model'), android: await shell('getprop', 'ro.build.version.release'), sdk: await shell('getprop', 'ro.build.version.sdk'), webview: await shell('dumpsys', 'webviewupdate') };
  report.packageInfo = await shell('dumpsys', 'package', PACKAGE);
  assert(report.packageInfo.includes('versionName='), 'Install the debug APK before running acceptance');
  network = { wifi: await shell('settings', 'get', 'global', 'wifi_on'), data: await shell('settings', 'get', 'global', 'mobile_data'), airplane: await shell('settings', 'get', 'global', 'airplane_mode_on') };
  hardKeyboard = await shell('settings', 'get', 'secure', 'show_ime_with_hard_keyboard');
  await step('offline first launch and native registration', async () => {
    await shell('cmd', 'connectivity', 'airplane-mode', 'enable'); await shell('svc', 'wifi', 'disable'); await shell('svc', 'data', 'disable');
    const connectivity = await until(async () => { const state = await shell('dumpsys', 'connectivity'); return /Active default network: none/.test(state) && state; }, 20000, 'no default Android network');
    fs.writeFileSync(path.join(OUT, 'offline-connectivity.txt'), connectivity);
    await shell('am', 'force-stop', PACKAGE); await start(); await connect();
    await page.waitForSelector('#start-menu [data-sm="new"]', { timeout: 180000 });
    await dismissSystemIntro();
    const state = await page.evaluate(async () => ({ origin: location.origin, language: I18N.lang, online: navigator.onLine,
      native: Capacitor.isNativePlatform(), platform: Capacitor.getPlatform(), info: await Capacitor.Plugins.App.getInfo(),
      filesPlugin: typeof Capacitor.Plugins.OldGoldFiles.saveFile, bridge: typeof OldGoldAndroid.saveFile,
      saveKeys: Object.keys(localStorage).filter(k => /^feod\.save\.(auto|manual)$/.test(k)), viewport: [innerWidth, innerHeight],
      manifest: await (await fetch('build-manifest.json')).text() }));
    assert.equal(state.origin, 'https://localhost'); assert.equal(state.language, 'zh-CN'); assert.equal(state.native, true); assert.equal(state.platform, 'android');
    assert.equal(state.info.id, PACKAGE); assert.equal(state.filesPlugin, 'function'); assert.equal(state.bridge, 'function'); assert(state.viewport[0] > state.viewport[1], 'APK must launch in landscape');
    if (!RESUME) assert.deepEqual(state.saveKeys, [], 'Fresh run requires an untouched install; --resume preserves the existing acceptance save');
    state.manifestSha256 = sha(state.manifest); fs.writeFileSync(path.join(OUT, 'installed-build-manifest.json'), state.manifest); delete state.manifest;
    state.text = await inspectChinese('menu'); await screenshot('01-offline-chinese-menu'); return state;
  });
  await step('APK compressed frame banks decode successfully', async () => {
    const state = await page.evaluate(async () => ({ ready: await FrogDirections.bakedReady,
      errors: FrogDirections.errors.slice(), banks: FrogDirections.bankStats(),
      paths: { ...document.querySelector('script[src*="fantasy-frog-directions"]').dataset } }));
    assert.equal(state.ready, true, 'Both packaged gzip frame banks must decode'); assert.deepEqual(state.errors, []);
    assert(state.paths.frequentFrames.endsWith('.bin.gzip')); assert(state.paths.rareFrames.endsWith('.bin.gzip'));
    return state;
  });
  await step('Chinese new-game UI and manual save', async () => {
    const existing = await page.evaluate(() => !!localStorage.getItem('feod.save.manual'));
    if (RESUME && existing) {
      await page.click('#start-menu [data-sm="continue"]'); await gameplay();
    } else {
      await page.click('#start-menu [data-sm="new"]'); await page.click('#start-menu [data-sm="mode-free"]');
      await page.waitForSelector('#start-menu [data-panel="map"]:not(.hidden)'); await page.click('#start-menu [data-sm="map-go"]');
      await page.waitForSelector('#start-menu [data-panel="diff"]:not(.hidden)'); await page.click('#start-menu [data-sm="diff:normal"]');
      await page.waitForSelector('#ha-name'); await page.fill('#ha-name', HERO); await screenshot('02-chinese-name');
      await page.click('#ha-editor [data-ha="ok"]'); await gameplay();
    }
    await closePanels();
    await page.evaluate(() => { openTab('menu'); if (Mobile.on) mobileSheet('tab'); });
    await page.click('[data-menu="save"]');
    await page.waitForFunction(() => !!localStorage.getItem('feod.save.manual'));
    const save = await page.evaluate(() => ({ raw: localStorage.getItem('feod.save.manual'), name: Game.hero.hero.name, units: Game.units.length, buildings: Game.buildings.length }));
    assert.equal(save.name, HERO); fs.writeFileSync(path.join(OUT, 'manual-save.json'), save.raw); save.bytes = Buffer.byteLength(save.raw); save.sha256 = sha(save.raw); delete save.raw;
    await closePanels(); await screenshot('03-game-and-save'); return save;
  });
  await step('Chinese name input with real Android keyboard and reachable confirmation', async () => {
    await closePanels(); await page.evaluate(() => haEditNow());
    await page.waitForSelector('#ha-name');
    await shell('settings', 'put', 'secure', 'show_ime_with_hard_keyboard', '1');
    const point = await page.locator('#ha-name').evaluate(e => { e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: (r.x + r.width / 2) * devicePixelRatio, y: (r.y + r.height / 2) * devicePixelRatio }; });
    await shell('input', 'tap', String(Math.round(point.x)), String(Math.round(point.y)));
    const ime = await until(async () => { const state = await shell('dumpsys', 'input_method'); return /(?:mInputShown|isInputViewShown|mIsInputViewShown)=true/.test(state) && state; }, 20000, 'Android keyboard shown');
    fs.writeFileSync(path.join(OUT, 'keyboard-shown.txt'), ime);
    await page.fill('#ha-name', HERO); await screenshot('03a-chinese-name-keyboard');
    await shell('input', 'keyevent', 'KEYCODE_BACK');
    await page.waitForSelector('#ha-editor [data-ha="ok"]');
    await page.locator('#ha-editor [data-ha="ok"]').scrollIntoViewIfNeeded();
    const button = await page.locator('#ha-editor [data-ha="ok"]').evaluate(e => { const r = e.getBoundingClientRect(); return { text: e.textContent, x: (r.x + r.width / 2) * devicePixelRatio, y: (r.y + r.height / 2) * devicePixelRatio, visible: r.top >= 0 && r.bottom <= innerHeight }; });
    assert(button.visible, 'Confirmation must remain reachable after hiding keyboard'); await screenshot('03b-name-confirm-reachable');
    await shell('input', 'tap', String(Math.round(button.x)), String(Math.round(button.y)));
    await page.waitForFunction(() => !document.getElementById('ha-editor')); assert.equal(await page.evaluate(() => Game.hero.hero.name), HERO);
    return { keyboardShown: true, keyboardDismissedWithBack: true, confirmation: button.text, name: HERO };
  });
  await step('Home background autosave and pause/audio restoration', async () => {
    await page.evaluate(() => {
      window.__apkEvents = [];
      window.__apkSaves = []; window.__apkOriginalSave = saveGame;
      saveGame = function () {
        const started = performance.now(), result = window.__apkOriginalSave.apply(this, arguments);
        window.__apkSaves.push({ slot: arguments[0], milliseconds: +(performance.now() - started).toFixed(2), result }); return result;
      };
      Capacitor.Plugins.App.addListener('appStateChange', state => window.__apkEvents.push({ active: state.isActive, paused: Game.paused,
        hiddenAudio: AudioCore.hiddenAt > 0, audio: AudioCore.ctx && AudioCore.ctx.state,
        autoAt: saveMeta('auto') && saveMeta('auto').at }));
    });
    const cases = [];
    for (const paused of [false, true]) {
      const before = await page.evaluate(p => { Game.paused = p; window.__apkSaves.length = 0; return saveMeta('auto')?.at || 0; }, paused);
      await shell('input', 'keyevent', 'KEYCODE_HOME'); await delay(1200); await start();
      await page.waitForFunction(() => !document.hidden);
      const state = await page.evaluate(() => ({ paused: Game.paused, autoAt: saveMeta('auto')?.at || 0, audio: AudioCore.ctx && AudioCore.ctx.state, hiddenAudio: AudioCore.hiddenAt > 0, events: window.__apkEvents.slice(), saves: window.__apkSaves.slice() }));
      assert.equal(state.paused, paused); assert(state.autoAt > before, 'Home must persist a new autosave');
      assert(state.events.some(e => !e.active && e.paused), 'Native inactive event must pause'); assert.equal(state.hiddenAudio, false);
      cases.push({ originalPause: paused, before, ...state });
    }
    await page.evaluate(() => { saveGame = window.__apkOriginalSave; delete window.__apkOriginalSave; });
    await screenshot('04-background-return'); return cases;
  });
  await step('force-stop and reopen retains Chinese save', async () => {
    const before = await page.evaluate(() => ({ name: Game.hero.hero.name, manual: localStorage.getItem('feod.save.manual'), auto: localStorage.getItem('feod.save.auto') }));
    await shell('am', 'force-stop', PACKAGE); await start(); await connect();
    await page.waitForSelector('#start-menu [data-sm="continue"]:not([disabled])', { timeout: 180000 });
    const after = await page.evaluate(() => ({ manual: localStorage.getItem('feod.save.manual'), auto: localStorage.getItem('feod.save.auto'), language: I18N.lang }));
    assert.equal(after.manual, before.manual); assert.equal(after.auto, before.auto); assert.equal(after.language, 'zh-CN');
    await screenshot('05-reopen-continue'); await page.click('#start-menu [data-sm="continue"]'); await gameplay();
    return { language: after.language, name: before.name, manualSha256: sha(after.manual), autoSha256: sha(after.auto) };
  });
  await step('real SAF save and byte-identical JSON', async () => {
    await closePanels(); await page.evaluate(() => saveFileOpen());
    const raw = await page.evaluate(() => localStorage.getItem('feod.save.auto'));
    assert(raw, 'The first export row is the autosave');
    await page.locator('#save-file-win button').filter({ hasText: /^下载文件$/ }).first().click();
    const input = await uiNode('saf-save', n => n.class === 'android.widget.EditText');
    await screenshot('06-saf-destination');
    const filename = 'oldgold-acceptance-' + Date.now() + '.json';
    await tap(input); await shell('input', 'keyevent', 'KEYCODE_MOVE_END');
    await shell('input', 'keycombination', '113', '29'); await shell('input', 'text', filename);
    const save = await uiNode('saf-save-ready', n => n.enabled === 'true' && (/^保存$|^SAVE$|^Save$/.test(n.text || '') || /:id\/(action_menu_save|button1)$/.test(n['resource-id'] || '')));
    await tap(save);
    await page.waitForFunction(() => document.getElementById('save-file-win')?.textContent.includes('文件已保存。'), null, { timeout: 60000 });
    const remote = '/sdcard/Download/' + filename, local = path.join(OUT, filename);
    await adb(['pull', remote, local]);
    const exported = fs.readFileSync(local); assert.equal(exported.toString('utf8'), raw, 'SAF must preserve the exported JSON bytes including Chinese');
    const cache = await cacheFiles(); assert.deepEqual(cache, [], 'Successful export must clean its own pending file');
    await screenshot('07-saf-success'); return { filename, bytes: exported.length, sha256: sha(exported), originalSha256: sha(raw), cacheFiles: cache };
  });
  await step('real SAF cancellation returns without success and clears pending cache', async () => {
    await page.locator('#save-file-win button').filter({ hasText: /^下载文件$/ }).first().click();
    await uiNode('saf-cancel', n => n.class === 'android.widget.EditText'); await screenshot('08-saf-before-cancel');
    await shell('input', 'keyevent', 'KEYCODE_BACK');
    // Some keyboards consume the first back press. The next dismisses the picker.
    await delay(500);
    const activity = await shell('dumpsys', 'activity', 'activities');
    if (/mResumedActivity:.*documentsui/.test(activity)) await shell('input', 'keyevent', 'KEYCODE_BACK');
    await page.waitForFunction(() => { const w = document.getElementById('save-file-win'); return w && w.lastChild.textContent === '取消'; }, null, { timeout: 60000 });
    const cache = await cacheFiles(); assert.deepEqual(cache, []); await screenshot('09-saf-cancelled'); return { message: '取消', cacheFiles: cache };
  });
  await step('Android back closes Chinese panel, then top-level exit can be cancelled', async () => {
    await shell('input', 'keyevent', 'KEYCODE_BACK'); await page.waitForFunction(() => !document.getElementById('save-file-win'));
    await closePanels();
    // Dismiss any queued one-time window through its own close control first.
    await page.evaluate(() => { for (let i = 0; i < 8 && wmCloseTop(); i++); });
    await screenshot('10-back-closed-panel');
    await shell('input', 'keyevent', 'KEYCODE_BACK');
    let cancelledWith;
    try {
      const cancel = await uiNode('exit-confirmation', n => /:id\/button2$/.test(n['resource-id'] || '') || /^(取消|Cancel|CANCEL)$/.test(n.text || ''), 7000);
      assert(fs.readFileSync(path.join(OUT, 'exit-confirmation.xml'), 'utf8').includes('保存游戏并退出？'), 'Native confirmation message must be Chinese');
      await screenshot('11-exit-confirmation');
      await tap(cancel); cancelledWith = 'Android dialog button';
    } catch (e) {
      const dialog = dialogs.findLast(d => d.type() === 'confirm');
      if (!dialog) throw e; assert(dialog.message().includes('保存游戏并退出')); await screenshot('11-exit-confirmation'); await dialog.dismiss(); cancelledWith = 'CDP dismiss of real WebView confirm';
    }
    await page.waitForFunction(() => !StartMenu.open && Game.hero?.hero.name === '中文勇士·APK验收');
    assert(await shell('pidof', PACKAGE), 'Cancelling exit must keep the app running');
    await screenshot('12-exit-cancelled'); return { cancelledWith, stillInGame: true };
  });
  assert.deepEqual(report.errors, [], 'No WebView page exceptions'); assert.deepEqual(report.failedResources, [], 'No missing local resources');
  report.passed = true;
}
main().catch(async e => { report.passed = false; report.error = e.stack; console.error(e.stack); await screenshot('failure').catch(() => {}); process.exitCode = 1; })
  .finally(async () => {
    if (network) {
      await shell('cmd', 'connectivity', 'airplane-mode', network.airplane === '1' ? 'enable' : 'disable').catch(() => {});
      if (/^[01]$/.test(network.wifi)) await shell('svc', 'wifi', network.wifi === '1' ? 'enable' : 'disable').catch(() => {});
      if (/^[01]$/.test(network.data)) await shell('svc', 'data', network.data === '1' ? 'enable' : 'disable').catch(() => {});
    }
    if (hardKeyboard != null) {
      if (hardKeyboard === 'null') await shell('settings', 'delete', 'secure', 'show_ime_with_hard_keyboard').catch(() => {});
      else await shell('settings', 'put', 'secure', 'show_ime_with_hard_keyboard', hardKeyboard).catch(() => {});
    }
    if (browser) await browser.close().catch(() => {});
    if (forwardPort) await adb(['forward', '--remove', 'tcp:' + forwardPort]).catch(() => {});
    report.finishedAt = new Date().toISOString(); if (fs.existsSync(OUT)) persist();
    console.log(JSON.stringify({ output: path.join(OUT, 'report.json'), passed: report.passed, steps: report.steps.map(s => ({ name: s.name, passed: s.passed })) }, null, 2));
  });
