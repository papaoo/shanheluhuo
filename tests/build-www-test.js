'use strict';
// Guard the destructive output boundary and cross-file classic-script contract.
// node tests/build-www-test.js
const assert = require('assert'), path = require('path'), vm = require('vm');
const { createRequire } = require('module');
const { safeOutput } = require('../desktop/build-www');
const ROOT = path.resolve(__dirname, '..');

for (const owner of ['desktop', 'mobile']) {
  assert.strictEqual(safeOutput(path.join(ROOT, owner, 'www')), path.join(ROOT, owner, 'www'));
}
for (const rel of ['.', 'mobile', 'desktop', 'assets', 'mobile/www/child', 'mobile/www-sibling', '../www']) {
  assert.throws(() => safeOutput(path.join(ROOT, rel)), /Output must be exactly/, rel);
}

let esbuild;
for (const owner of ['mobile', 'desktop']) {
  try { esbuild = createRequire(path.join(ROOT, owner, 'package.json'))('esbuild'); break; }
  catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
assert(esbuild, 'Install the existing mobile or desktop development dependencies first.');
const scripts = [
  'const SHARED_CONST = { title: "中文测试" }; let sharedState = 2; var sharedVar = 3; function sharedFunction(n) { return n + sharedState; }',
  'globalThis.result = [SHARED_CONST.title, sharedFunction(sharedVar), typeof globalThis.SHARED_CONST, globalThis.sharedVar]; SHARED_CONST.value ??= 9; sharedState += SHARED_CONST.value;',
  'globalThis.after = sharedFunction(1);',
];
const run = list => {
  const ctx = vm.createContext({});
  for (const source of list) vm.runInContext(source, ctx);
  return JSON.stringify({ result: ctx.result, after: ctx.after });
};
const minified = scripts.map(s => esbuild.transformSync(s, { loader: 'js', target: 'chrome85', minify: true, charset: 'utf8', legalComments: 'none' }).code);
assert.strictEqual(run(minified), run(scripts), 'Classic global const/let/var/function semantics changed');
assert(minified[0].includes('中文测试'), 'Unicode must remain UTF-8 instead of inflated ASCII escapes');
new vm.Script(minified.join('\n;\n'));
console.log('PASS: protected output paths and minified cross-script global semantics');
