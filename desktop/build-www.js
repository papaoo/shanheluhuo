'use strict';
// Build the local web payload for Electron / Capacitor.
// node desktop/build-www.js mobile/www [--keep-analytics] [--no-minify]
// Only generated www directories can be replaced. Artwork is copied unchanged.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { createRequire } = require('module');
const { execFileSync } = require('child_process');
const { verifyBundle } = require('../tools/check-www');
const ROOT = path.resolve(__dirname, '..');
const OMIT_ASSETS = new Set([
  'assets/fantasy/prompts.json', 'assets/fantasy/additional-prompts.json',
  'assets/fantasy/graphics-reference-measured.json',
]);
// Android's asset merger inflates *.gz and strips that suffix. Keep the gzip
// bytes under a neutral extension; the runtime already decodes gzip explicitly.
const ANDROID_ASSET_ALIASES = [
  { source: 'js/fantasy-frog-frequent-frames.bin.gz', path: 'js/fantasy-frog-frequent-frames.bin.gzip' },
  { source: 'js/fantasy-frog-rare-frames.bin.gz', path: 'js/fantasy-frog-rare-frames.bin.gzip' },
];
const slash = p => p.replace(/\\/g, '/');
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
function safeOutput(requested) {
  const out = path.resolve(requested || path.join(ROOT, 'desktop/www'));
  const owner = ['mobile', 'desktop'].find(d => samePath(out, path.join(ROOT, d, 'www')));
  if (!owner) throw new Error('Output must be exactly mobile/www or desktop/www; refusing to delete: ' + out);
  // A junction/symlink must not turn a permitted spelling into another target.
  const parent = path.dirname(out), realRoot = fs.realpathSync(ROOT);
  if (!samePath(fs.realpathSync(parent), path.join(realRoot, owner))) throw new Error('Output parent is redirected: ' + parent);
  if (fs.existsSync(out) && (fs.lstatSync(out).isSymbolicLink() || !fs.statSync(out).isDirectory())) throw new Error('Output is not a plain generated directory: ' + out);
  return out;
}
function build(requested, { keepStats = false, minify = true } = {}) {
  const out = safeOutput(requested);
  const platform = samePath(out, path.join(ROOT, 'mobile/www')) ? 'mobile' : 'desktop';
  const assetAliases = platform === 'mobile' ? ANDROID_ASSET_ALIASES : [];
  const sourceFor = rel => path.join(ROOT, rel === 'compat.js' ? 'mobile/compat.js' : (assetAliases.find(a => a.path === rel) || {}).source || rel);
  let esbuild = null;
  if (minify) for (const owner of [platform, platform === 'mobile' ? 'desktop' : 'mobile']) {
    try { esbuild = createRequire(path.join(ROOT, owner, 'package.json'))('esbuild'); break; } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  }
  if (minify && !esbuild) throw new Error('Install esbuild in mobile/ or desktop/, or explicitly use --no-minify.');
  const selected = [], excludedAssets = [];
  function walk(rel) {
    for (const item of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const name = slash(path.join(rel, item.name));
      if (item.isSymbolicLink()) throw new Error('Source contains a symbolic link: ' + name);
      if (name.startsWith('assets/') && (OMIT_ASSETS.has(name) || /\.md$/i.test(name))) { excludedAssets.push(name); continue; }
      if (item.isDirectory()) walk(name); else if (item.isFile()) selected.push(name);
    }
  }
  for (const dir of ['js', 'css', 'fonts', 'icons', 'assets/fantasy']) walk(dir);
  selected.push('favicon.svg', 'manifest.webmanifest', 'privacy.html', 'index.html');
  if (platform === 'mobile') selected.push('compat.js');
  for (const alias of assetAliases) {
    const index = selected.indexOf(alias.source);
    if (index < 0) throw new Error('Missing Android frame bank source: ' + alias.source);
    selected[index] = alias.path;
  }
  // Validate all sources before deleting the verified absolute generated target.
  for (const rel of selected) if (!fs.statSync(sourceFor(rel)).isFile()) throw new Error('Missing source: ' + rel);
  fs.rmSync(out, { recursive: true, force: true });
  const files = [], groups = {}, sourceGroups = {};
  for (const rel of selected.sort()) {
    const src = sourceFor(rel), dst = path.join(out, rel), ext = path.extname(rel);
    let data = fs.readFileSync(src);
    const group = rel.split('/')[0]; sourceGroups[group] = (sourceGroups[group] || 0) + data.length;
    if (rel === 'index.html') {
      let html = data.toString('utf8');
      if (!keepStats) html = html.replace(/<script[^>]*goatcounter[^>]*><\/script>\s*/g, '');
      html = html.replace(/<script src="js\/pwa\.js"><\/script>\s*/, '');
      if (platform === 'mobile') {
        const head = /(<head>\s*<meta charset="utf-8">)/;
        if (!head.test(html)) throw new Error('Cannot place the Android compatibility script before game scripts.');
        html = html.replace(head, '$1\n<script src="compat.js"></script>');
        for (const alias of assetAliases) {
          const name = path.posix.basename(alias.source), replacement = path.posix.basename(alias.path);
          const attribute = name.includes('-frequent-') ? 'data-frequent-frames' : 'data-rare-frames';
          const original = attribute + '="' + name + '"';
          if (html.split(original).length !== 2) throw new Error('Expected one frame bank URL in index.html: ' + name);
          html = html.replace(original, attribute + '="' + replacement + '"');
        }
      }
      data = Buffer.from(html);
    } else if (esbuild && (ext === '.js' || ext === '.css')) {
      // Transform each classic script separately. Never bundle or rename its
      // top-level declarations: other scripts intentionally share those names.
      data = Buffer.from(esbuild.transformSync(data.toString('utf8'), { loader: ext.slice(1), target: 'chrome85', minify: true, charset: 'utf8', legalComments: 'none' }).code);
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, data);
    const alias = assetAliases.find(a => a.path === rel);
    files.push({ path: rel, ...(alias ? { source: alias.source } : {}), bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') });
    groups[group] = (groups[group] || 0) + data.length;
  }
  let sourceCommit = null, trackedChanges = null;
  try {
    sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    trackedChanges = execFileSync('git', ['diff', 'HEAD', '--name-only'], { cwd: ROOT, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
  } catch (e) { /* source archives can be built without Git */ }
  const manifest = { format: 1, platform, sourceCommit, trackedChanges, minifier: esbuild ? 'esbuild@' + esbuild.version : null,
    syntaxTarget: 'chrome85', keepAnalytics: keepStats, assetAliases,
    assetPolicy: 'All assets/fantasy runtime files, including roster index/phase plans; no graphics-review directory, Markdown, prompts or graphics-reference measurements.',
    excludedAssets: excludedAssets.sort(), bytes: files.reduce((n, f) => n + f.bytes, 0), sourceGroups, groups, files };
  fs.writeFileSync(path.join(out, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const result = verifyBundle(out);
  if (result.errors.length) throw new Error('Bundle validation failed:\n' + result.errors.join('\n'));
  console.log(JSON.stringify({ output: out, files: files.length, MiB: +(manifest.bytes / 1048576).toFixed(2),
    minifier: manifest.minifier, referencesChecked: result.references, dictionaries: result.dictionaries,
    groupsMiB: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, +(v / 1048576).toFixed(2)])) }, null, 2));
  return manifest;
}
module.exports = { build, safeOutput };
if (require.main === module) {
  try { build(process.argv.slice(2).find(a => !a.startsWith('--')), { keepStats: process.argv.includes('--keep-analytics'), minify: !process.argv.includes('--no-minify') }); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
