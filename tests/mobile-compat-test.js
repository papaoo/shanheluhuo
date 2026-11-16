'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../mobile/compat.js'), 'utf8');

function realm(fallback) {
  const context = vm.createContext({});
  if (fallback) vm.runInContext('delete Object.hasOwn; delete Array.prototype.at;', context);
  vm.runInContext(source, context);
  return context;
}
const native = realm(false), fallback = realm(true);
let comparisons = 0;
function same(expression) {
  // Serialize in each realm so cross-realm prototypes do not obscure equality.
  const wrapped = `JSON.stringify((function () { try { var value = (${expression}); return { type: typeof value, value: value }; } catch (error) { return { error: error.name }; } }()))`;
  assert.equal(vm.runInContext(wrapped, fallback), vm.runInContext(wrapped, native), expression);
  comparisons++;
}

for (const expression of [
  'Object.hasOwn({a: 1}, "a")',
  'Object.hasOwn(Object.create({a: 1}), "a")',
  'Object.hasOwn(Object.assign(Object.create(null), {a: 1}), "a")',
  'Object.hasOwn({hasOwnProperty: null}, "hasOwnProperty")',
  'Object.hasOwn(JSON.parse(\'{"__proto__":1}\'), "__proto__")',
  'Object.hasOwn("abc", 1)', 'Object.hasOwn(1, "a")',
  'Object.hasOwn(null, "a")', 'Object.hasOwn(undefined, "a")',
  '(function () { var key = Symbol("key"), value = {}; value[key] = 1; return Object.hasOwn(value, key); }())',
  '(function () { var calls = 0, key = {toString: function () { calls++; return "a"; }}; return [Object.hasOwn({a: 1}, key), calls]; }())',
  '(function () { var key = {toString: function () { throw new RangeError(); }}; return Object.hasOwn(null, key); }())',
  '(function () { var keys = []; var value = new Proxy({a: 1}, {getOwnPropertyDescriptor: function (target, key) { keys.push(key); return Object.getOwnPropertyDescriptor(target, key); }}); return [Object.hasOwn(value, "a"), keys]; }())'
]) same(expression);

for (const index of ['undefined', 'null', 'NaN', '0', '-0', '1', '-1', '2', '-2', '3', '-4', '1.9', '-1.9', 'Infinity', '-Infinity', '"1"', '"bad"', 'true', '1n', 'Symbol()']) {
  same(`[10, 20, 30].at(${index})`);
}
for (const expression of [
  'Array.prototype.at.call(null, 0)', 'Array.prototype.at.call(undefined, 0)',
  'Array.prototype.at.call("abc", -1)', 'Array.prototype.at.call(42, 0)',
  'Array.prototype.at.call({0: "a", 1: "b", length: 1.9}, -1)',
  'Array.prototype.at.call({0: "a", length: -1}, 0)',
  'Array.prototype.at.call({0: "a", length: NaN}, 0)',
  'Array.prototype.at.call({0: "a", length: 1n}, 0)',
  'Array.prototype.at.call({9007199254740990: "last", length: Infinity}, -1)',
  'Array.prototype.at.call(Object.create({0: "inherited", length: 1}), 0)',
  '(function () { var calls = []; var value = {get length() { calls.push("length"); return 1; }, get 0() { calls.push("item"); return "a"; }}; var index = {valueOf: function () { calls.push("index"); return 0; }}; return [Array.prototype.at.call(value, index), calls]; }())',
  '(function () { var value = {length: 0, get 0() { throw new RangeError(); }}; return Array.prototype.at.call(value, 0); }())',
  '(function () { var index = {valueOf: function () { throw new RangeError(); }}; return Array.prototype.at.call({length: 0}, index); }())',
  'Array.prototype.at.length', 'Object.hasOwn.length',
  'Object.getOwnPropertyDescriptor(Array.prototype, "at").enumerable',
  'Object.getOwnPropertyDescriptor(Object, "hasOwn").enumerable',
  'Array.prototype[Symbol.unscopables].at'
]) same(expression);

vm.runInContext('var savedAt = Array.prototype.at, savedHasOwn = Object.hasOwn;', native);
vm.runInContext(source, native);
assert.equal(vm.runInContext('savedAt === Array.prototype.at && savedHasOwn === Object.hasOwn', native), true, 'native implementations must remain intact');
vm.runInContext('var savedAt = Array.prototype.at, savedHasOwn = Object.hasOwn;', fallback);
vm.runInContext(source, fallback);
assert.equal(vm.runInContext('savedAt === Array.prototype.at && savedHasOwn === Object.hasOwn', fallback), true, 'fallback loading must be idempotent');
console.log(`Mobile compatibility: ${comparisons} native-equivalence cases, native preservation and repeated loading passed.`);
