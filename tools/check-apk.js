'use strict';
// Read-only verification of the shipped APK, using native-run's existing ZIP
// and Android binary-XML readers. No extraction or custom ZIP implementation.
// node tools/check-apk.js mobile/OldGold-zh-CN-0.12.5-1-release.apk [--web-root mobile/www] [--write report.json]
const fs = require('fs'), path = require('path'), crypto = require('crypto'), vm = require('vm');
const { createRequire } = require('module');
const { verifyBundle } = require('./check-www');
const ROOT = path.resolve(__dirname, '..');
const mobileRequire = createRequire(path.join(ROOT, 'mobile/package.json'));
const EXPECTED_APP_ID = 'ru.oldgold.zhcn';
const PUBLIC = 'assets/public/';
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const hashFile = async file => {
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
};

function readZip(file) {
  const yauzl = mobileRequire('yauzl');
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (err, zip) => {
      if (err) return reject(err);
      const entries = new Map(), data = new Map();
      let finished = false, totalBytes = 0;
      const fail = error => { if (finished) return; finished = true; zip.close(); reject(error); };
      zip.on('error', fail);
      zip.on('end', () => { if (!finished) { finished = true; resolve({ entries, data, totalBytes }); } });
      zip.on('entry', entry => {
        const name = entry.fileName;
        if (entries.has(name)) return fail(new Error('Duplicate APK ZIP entry: ' + name));
        entries.set(name, { bytes: entry.uncompressedSize, compressedBytes: entry.compressedSize });
        totalBytes += entry.uncompressedSize;
        if (entries.size > 30000 || totalBytes > 2 * 1024 * 1024 * 1024) return fail(new Error('APK exceeds inspection size limits'));
        if (name.endsWith('/')) return zip.readEntry();
        const inspect = name.startsWith('assets/') || name === 'AndroidManifest.xml';
        if (!inspect) return zip.readEntry();
        const capture = name === 'AndroidManifest.xml' || /^assets\/capacitor\.(?:config|plugins)\.json$/.test(name)
          || name === PUBLIC + 'build-manifest.json' || name === PUBLIC + 'index.html' || name === PUBLIC + 'js/i18n.js' || name.startsWith(PUBLIC + 'js/i18n/')
          || /^assets\/public\/assets\/fantasy\/roster-v4\/(?:artwork-index|phase-plan)\.json$/.test(name);
        if (capture && entry.uncompressedSize > 16 * 1024 * 1024) return fail(new Error('APK metadata too large: ' + name));
        zip.openReadStream(entry, (error, stream) => {
          if (error) return fail(error);
          const digest = crypto.createHash('sha256'), chunks = [];
          stream.on('error', fail);
          stream.on('data', chunk => { digest.update(chunk); if (capture) chunks.push(chunk); });
          stream.on('end', () => {
            if (finished) return;
            entries.get(name).sha256 = digest.digest('hex');
            if (capture) data.set(name, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

function forbiddenFile(name) {
  if (/(?:^|\/)(?:\.git|\.github|\.agents|node_modules|tests|tools)(?:\/|$)/i.test(name)) return true;
  if (/\.(?:jks|keystore|p12|pfx|pem|key|java|kt|ts|tsx|jsx|map|ps1|sh|bat|cmd|gradle|log)$/i.test(name)) return true;
  return /(?:^|\/)(?:signing\.json|local\.properties|gradlew(?:\.bat)?|package(?:-lock)?\.json|AGENTS\.md|SKILL\.md|\.env(?:\..*)?)$/i.test(name);
}

async function checkApk(apk, { webRoot = path.join(ROOT, 'mobile/www') } = {}) {
  apk = path.resolve(apk); webRoot = path.resolve(webRoot);
  const initial = fs.statSync(apk), errors = [];
  const baseline = verifyBundle(webRoot);
  for (const error of baseline.errors) errors.push('Web baseline: ' + error);
  const expectedManifestData = fs.readFileSync(path.join(webRoot, 'build-manifest.json'));
  const expectedManifest = JSON.parse(expectedManifestData);
  const archive = await readZip(apk), { entries, data } = archive;
  const report = { apk, bytes: initial.size, sha256: await hashFile(apk), webRoot,
    manifestSha256: hash(expectedManifestData), sourceCommit: expectedManifest.sourceCommit,
    zipEntries: entries.size, uncompressedBytes: archive.totalBytes, checkedWebFiles: 0,
    webReferences: baseline.references, chineseDictionaries: 0, extraPublicFiles: [],
    native: {}, forbiddenFiles: [], errors,
    indexPolicy: 'Capacitor sync preserves index.html byte-for-byte; the native bridge is injected at WebView runtime.',
    scope: 'APK contents and configuration. APK signature trust and Android runtime behavior require separate verification.' };
  const getData = name => { if (!data.has(name)) throw new Error('Missing APK file: ' + name); return data.get(name); };
  const embedded = getData(PUBLIC + 'build-manifest.json');
  report.embeddedManifestSha256 = hash(embedded);
  if (report.embeddedManifestSha256 !== report.manifestSha256) errors.push('APK build manifest differs from the verified web baseline');
  const expected = new Map(expectedManifest.files.map(item => [PUBLIC + item.path, item]));
  if (expected.size !== expectedManifest.files.length) errors.push('Duplicate file in web build manifest');
  report.requiredRosterMetadata = [];
  for (const name of ['artwork-index.json', 'phase-plan.json']) {
    const rel = 'assets/fantasy/roster-v4/' + name;
    if (!expected.has(PUBLIC + rel) || !entries.has(PUBLIC + rel)) errors.push('Missing dynamic roster metadata: ' + rel);
    report.requiredRosterMetadata.push(rel);
  }
  try {
    const directory = PUBLIC + 'assets/fantasy/roster-v4/';
    const index = JSON.parse(getData(directory + 'artwork-index.json')), plan = JSON.parse(getData(directory + 'phase-plan.json'));
    const atlasFiles = new Set();
    for (const [id, role] of Object.entries(plan.roles)) for (const view of Object.values(role.frames)) for (const pose of Object.values(view)) {
      if (!pose) continue;
      const art = index.roles[pose.role || id]?.assets[pose.asset];
      if (!art || !art.png || !art.keys?.[pose.frame]) errors.push('APK roster pose cannot resolve: ' + id + '/' + pose.asset + '/' + pose.frame);
      else {
        const file = path.posix.normalize(directory + art.png); atlasFiles.add(file);
        if (!expected.has(file) || !entries.has(file)) errors.push('Missing active roster atlas: ' + file);
      }
    }
    report.rosterAtlasFiles = [...atlasFiles].sort();
  } catch (e) { errors.push('APK roster dependencies: ' + e.message); }
  for (const [name, item] of expected) {
    const actual = entries.get(name);
    if (!actual) errors.push('Missing packaged web file: ' + item.path);
    else if (actual.bytes !== item.bytes || actual.sha256 !== item.sha256) errors.push('Changed packaged web bytes: ' + item.path);
    else report.checkedWebFiles++;
  }
  report.frameBankAliases = [];
  // Check the independently enumerated Android filename workaround against
  // both the original gzip bytes and the APK, not just a self-consistent ZIP.
  const indexHtml = getData(PUBLIC + 'index.html').toString('utf8');
  for (const kind of ['frequent', 'rare']) {
    const source = 'js/fantasy-frog-' + kind + '-frames.bin.gz', target = source.slice(0, -3) + '.gzip';
    const item = expected.get(PUBLIC + target), actual = entries.get(PUBLIC + target);
    const sourceSha256 = hash(fs.readFileSync(path.join(ROOT, source)));
    const alias = (expectedManifest.assetAliases || []).find(a => a.source === source && a.path === target);
    if (!alias || !item || item.source !== source || !actual || actual.sha256 !== sourceSha256) errors.push('Android gzip frame bank alias/source bytes differ: ' + source);
    if (entries.has(PUBLIC + source) || entries.has(PUBLIC + source.slice(0, -3))) errors.push('APK contains an unsafe .gz or unpacked frame bank: ' + source);
    if (indexHtml.split('data-' + kind + '-frames="' + path.posix.basename(target) + '"').length !== 2) errors.push('APK index must reference the gzip alias exactly once: ' + target);
    report.frameBankAliases.push({ source, path: target, sha256: sourceSha256 });
  }
  const extraPublic = new Set(['build-manifest.json', 'cordova.js', 'cordova_plugins.js']);
  const nativeAssets = new Set(['assets/capacitor.config.json', 'assets/capacitor.plugins.json', 'assets/native-bridge.js',
    // AGP generates these ART optimization profiles in release APKs.
    'assets/dexopt/baseline.prof', 'assets/dexopt/baseline.profm']);
  for (const [name, item] of entries) {
    if (name.endsWith('/')) continue;
    if (forbiddenFile(name)) report.forbiddenFiles.push(name);
    if (name.startsWith(PUBLIC) && !expected.has(name)) {
      const rel = name.slice(PUBLIC.length); report.extraPublicFiles.push(rel);
      if (!extraPublic.has(rel)) errors.push('Unexpected packaged web file: ' + rel);
      if (/^cordova(?:_plugins)?\.js$/.test(rel) && item.bytes !== 0) errors.push('Unexpected Cordova plugin code: ' + rel);
    } else if (name.startsWith('assets/') && !name.startsWith(PUBLIC) && !nativeAssets.has(name)) errors.push('Unexpected native asset: ' + name);
  }
  if (report.forbiddenFiles.length) errors.push('Private signing/development files found in APK: ' + report.forbiddenFiles.join(', '));
  try {
    const config = JSON.parse(getData('assets/capacitor.config.json'));
    const server = config.server || {};
    report.native.configAppId = config.appId;
    report.native.origin = (server.androidScheme || 'https') + '://' + (server.hostname || 'localhost');
    if (config.appId !== EXPECTED_APP_ID || config.webDir !== 'www') errors.push('Wrong local Capacitor app identity/webDir');
    if (Object.hasOwn(server, 'url')) errors.push('Capacitor server.url must be absent from the offline APK');
    if (server.androidScheme !== 'https' || (server.hostname && server.hostname !== 'localhost')) errors.push('APK must use the local https://localhost origin');
    if (server.cleartext !== false || (config.android || {}).allowMixedContent === true) errors.push('APK permits cleartext/mixed content');
    if ((server.allowNavigation || []).length) errors.push('Offline APK has external allowNavigation entries');
    const plugins = JSON.parse(getData('assets/capacitor.plugins.json'));
    report.native.plugins = plugins.map(p => p.pkg);
    if (!plugins.some(p => p.classpath === 'com.capacitorjs.plugins.app.AppPlugin')) errors.push('Capacitor App lifecycle plugin is missing');
    const bridge = entries.get('assets/native-bridge.js');
    const sourceBridge = path.join(ROOT, 'mobile/node_modules/@capacitor/android/capacitor/src/main/assets/native-bridge.js');
    report.native.bridgeSha256 = bridge && bridge.sha256;
    if (!bridge || bridge.sha256 !== hash(fs.readFileSync(sourceBridge))) errors.push('Native bridge differs from the installed locked Capacitor Android dependency');
    const { BinaryXmlParser } = mobileRequire('native-run/dist/android/utils/binary-xml-parser');
    const manifest = new BinaryXmlParser(getData('AndroidManifest.xml')).parse();
    const attribute = (node, name) => { const a = node && node.attributes.find(x => x.name === name); return a && (a.value == null ? a.typedValue.value : a.value); };
    const application = manifest.childNodes.find(n => n.nodeName === 'application');
    const activity = application.childNodes.find(n => n.nodeName === 'activity' && /MainActivity$/.test(attribute(n, 'name')));
    const sdk = manifest.childNodes.find(n => n.nodeName === 'uses-sdk');
    Object.assign(report.native, { appId: attribute(manifest, 'package'), versionName: attribute(manifest, 'versionName'),
      versionCode: attribute(manifest, 'versionCode'), minSdk: attribute(sdk, 'minSdkVersion'), targetSdk: attribute(sdk, 'targetSdkVersion'),
      debuggable: !!attribute(application, 'debuggable'), activity: attribute(activity, 'name'), orientation: attribute(activity, 'screenOrientation') });
    if (report.native.appId !== EXPECTED_APP_ID) errors.push('AndroidManifest package differs from the Chinese app ID');
    if (!activity) errors.push('MainActivity is absent from AndroidManifest');
    if (report.native.orientation !== 6) errors.push('MainActivity is not sensorLandscape');
  } catch (e) { errors.push('Native configuration: ' + e.message); }
  try {
    const context = { URLSearchParams, URL, Intl, navigator: { language: 'en-US' }, location: { search: '' },
      localStorage: { getItem() {}, setItem() {} }, document: { documentElement: {}, addEventListener() {}, write() {} } };
    context.window = context; vm.createContext(context);
    vm.runInContext(getData(PUBLIC + 'js/i18n.js').toString('utf8'), context, { timeout: 10000 });
    if (context.I18N.lang !== 'zh-CN') errors.push('APK does not default to Chinese on an English-locale device');
    for (const name of context.I18N.files()) {
      vm.runInContext(getData(PUBLIC + 'js/i18n/' + name + '.js').toString('utf8'), context, { timeout: 10000 });
      report.chineseDictionaries++;
    }
    if (report.chineseDictionaries !== 35 || context.t('Новая игра') !== '新游戏') errors.push('APK Chinese dictionary set/translation is incomplete');
  } catch (e) { errors.push('APK Chinese runtime: ' + e.message); }
  const final = fs.statSync(apk);
  if (initial.size !== final.size || initial.mtimeMs !== final.mtimeMs) errors.push('APK changed while being inspected; rerun after the build finishes');
  report.passed = errors.length === 0;
  return report;
}

module.exports = { checkApk, forbiddenFile };
if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2), apk = args[0];
    if (!apk || apk.startsWith('--')) throw new Error('Usage: node tools/check-apk.js file.apk [--web-root mobile/www] [--write report.json]');
    const option = name => { const i = args.indexOf(name); if (i < 0) return undefined; if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(name + ' requires a path'); return args[i + 1]; };
    const report = await checkApk(apk, { webRoot: option('--web-root') });
    const output = option('--write');
    if (output) { fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); }
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 1;
  })().catch(e => { console.error(e.message); process.exitCode = 1; });
}
