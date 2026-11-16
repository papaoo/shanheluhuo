'use strict';
// Validate the actual packaged payload, not the unbuilt source tree.
// node tools/check-www.js mobile/www
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
function verifyBundle(directory) {
  const root = path.resolve(directory), errors = [], checked = new Set();
  const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
  function expect(rel, from) {
    rel = rel.replace(/\\/g, '/');
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) { errors.push('Reference leaves bundle: ' + rel + ' from ' + from); return; }
    if (from !== 'build manifest') checked.add(rel);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) errors.push('Missing ' + rel + ' from ' + from);
  }
  function reference(url, from, base = from) {
    if (!url || /^(?:[a-z]+:|\/\/|#)/i.test(url)) return;
    let clean; try { clean = decodeURIComponent(url.split(/[?#]/)[0]); } catch { errors.push('Invalid URL in ' + from); return; }
    if (!clean) return;
    expect(clean.startsWith('/') ? clean.slice(1) : path.posix.join(path.posix.dirname(base), clean), from);
  }
  let files = [], manifest;
  try {
    manifest = JSON.parse(read('build-manifest.json')); files = manifest.files;
    for (const item of files) {
      expect(item.path, 'build manifest');
      const full = path.join(root, item.path); if (!fs.existsSync(full)) continue;
      const data = fs.readFileSync(full);
      if (data.length !== item.bytes || crypto.createHash('sha256').update(data).digest('hex') !== item.sha256) errors.push('Changed bytes: ' + item.path);
    }
    if (files.some(f => f.path.startsWith('assets/graphics-review/'))) errors.push('Review artwork included in game payload');
    // frog-troll-artwork.js resolves these basenames relative to currentScript;
    // their metadata-looking names do not make them optional authoring files.
    for (const name of ['artwork-index.json', 'phase-plan.json']) expect('assets/fantasy/roster-v4/' + name, 'runtime roster adapter');
    try {
      const indexFile = 'assets/fantasy/roster-v4/artwork-index.json', planFile = 'assets/fantasy/roster-v4/phase-plan.json';
      const index = JSON.parse(read(indexFile)), plan = JSON.parse(read(planFile));
      // Exactly mirror prepare(): only atlas records selected by non-null plan
      // poses are loaded. The index also retains historical, unused atlases.
      for (const [id, role] of Object.entries(plan.roles)) for (const view of Object.values(role.frames)) for (const pose of Object.values(view)) {
        if (!pose) continue;
        const art = index.roles[pose.role || id]?.assets[pose.asset];
        if (!art || !art.png || !art.keys?.[pose.frame]) errors.push('Unresolvable runtime roster pose: ' + id + '/' + pose.asset + '/' + pose.frame);
        else reference(art.png, planFile, indexFile);
      }
    } catch (e) { errors.push('Runtime roster metadata: ' + e.message); }
    for (const item of files) {
      const rel = item.path;
      if (/\.html$/.test(rel)) {
        const html = read(rel);
        for (const tag of html.matchAll(/<(?:script|link|img)\b[^>]*>/gi)) {
          const src = /\b(?:src|href)=["']([^"']+)["']/i.exec(tag[0]);
          if (src) reference(src[1], rel);
          for (const frame of tag[0].matchAll(/\bdata-(?:frequent|rare)-frames=["']([^"']+)["']/g)) reference(frame[1], rel, src ? src[1] : rel);
        }
        if (rel === 'index.html') {
          if (/src=["']js\/pwa\.js/.test(html)) errors.push('Packaged index still loads the website service worker');
          if (!html.includes('js/native.js')) errors.push('Native application bridge entry is missing');
          if (manifest.platform === 'mobile' && !/<script\b[^>]*src=["']compat\.js["']/.test((html.match(/<script\b[^>]*>/i) || [''])[0])) errors.push('Android compatibility script must be the first script');
          if (!manifest.keepAnalytics && /<script[^>]*goatcounter/.test(html)) errors.push('Packaged index still loads website analytics');
          // A combined parse catches global const/let declaration collisions
          // introduced by independently minifying classic script files.
          const scripts = [...html.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*>/gi)]
            .map(m => m[1]).filter(s => !/^(?:[a-z]+:|\/\/)/i.test(s));
          try { new vm.Script(scripts.map(s => read(s.split(/[?#]/)[0])).join('\n;\n'), { filename: 'packaged-classic-scripts.js' }); }
          catch (e) { errors.push('Classic script declaration error: ' + e.message); }
        }
      } else if (/\.css$/.test(rel)) {
        for (const m of read(rel).matchAll(/url\(\s*["']?([^\s)"']+)["']?\s*\)/g)) reference(m[1], rel);
      } else if (/\.js$/.test(rel) && !rel.startsWith('js/i18n/')) {
        // Direct paths are checked; whole dynamic asset families are preserved
        // by the builder, including JSON atlases and compressed frame banks.
        for (const m of read(rel).matchAll(/["'`]((?:\.\.\/)?(?:assets|js|css|fonts|icons)\/[^"'`\s${}]+\.(?:png|webp|svg|json|bin\.(?:gz|gzip)|ttf|woff2?|js|css))["'`]/g)) {
          reference(m[1], rel, m[1].startsWith('../') ? rel : 'index.html');
        }
      } else if (/\.json$/.test(rel) && rel.startsWith('assets/') && !/^assets\/fantasy\/roster-v4\/(?:artwork-index|phase-plan)\.json$/.test(rel)) {
        const inspect = o => {
          if (typeof o === 'string' && /^[^\s]+\.(?:png|webp|bin\.(?:gz|gzip))$/.test(o)) reference(o, rel);
          else if (o && typeof o === 'object') Object.values(o).forEach(inspect);
        };
        inspect(JSON.parse(read(rel)));
      }
    }
  } catch (e) { errors.push('Payload read error: ' + e.message); }
  let dictionaries = 0;
  try {
    // Read the built runtime's actual dictionary inventory, including minified
    // builds whose private manifest variable names may have changed.
    for (const lang of ['zh-CN', 'en', 'ru']) {
      const context = { URLSearchParams, URL, Intl, navigator: { language: 'en-US' },
        location: { search: lang === 'zh-CN' ? '' : '?lang=' + lang },
        localStorage: { getItem() {}, setItem() {} }, document: { documentElement: {}, addEventListener() {}, write() {} } };
      context.window = context; vm.createContext(context);
      vm.runInContext(read('js/i18n.js'), context);
      if (context.I18N.lang !== lang) errors.push('Wrong packaged default/selected language: ' + context.I18N.lang);
      for (const name of context.I18N.files()) {
        const rel = 'js/i18n/' + name + '.js'; expect(rel, 'I18N.files(' + lang + ')');
        vm.runInContext(read(rel), context); dictionaries++;
      }
      const expected = { 'zh-CN': '新游戏', en: 'New game', ru: 'Новая игра' }[lang];
      if (context.t('Новая игра') !== expected) errors.push('Invalid packaged translation for ' + lang);
    }
  } catch (e) { errors.push('Dictionary/runtime error: ' + e.message); }
  return { directory: root, files: files.length, references: checked.size, dictionaries, errors: [...new Set(errors)] };
}
module.exports = { verifyBundle };
if (require.main === module) {
  const result = verifyBundle(process.argv[2] || 'mobile/www');
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length) process.exitCode = 1;
}
