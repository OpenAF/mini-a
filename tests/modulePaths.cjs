// Verify source, installed-package and local-checkout precedence without a package registry write.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path').posix;
const vm = require('node:vm');
const source = fs.readFileSync('js/mini-a-paths.js', 'utf8');
function fixture(from, installed, cwd = '/caller', packages = ['/checkout', '/installed']) {
  function File(parent, child) {
    this.path = path.resolve(cwd, child === undefined ? String(parent) : path.join(String(parent), String(child)));
  }
  File.prototype.getCanonicalFile = function() { return this; };
  File.prototype.getCanonicalPath = File.prototype.getPath = function() { return this.path; };
  File.prototype.isDirectory = function() { return packages.includes(this.path); };
  File.prototype.getParentFile = function() { return this.path === '/' ? null : new File(path.dirname(this.path)); };
  const files = new Set(packages.flatMap(p => [p + '/mini-a.yaml', p + '/js/mini-a-paths.js']));
  const context = vm.createContext({
    __loadedfrom: from, java: { io: { File } }, io: { fileExists: p => files.has(p) },
    getOPackPath: name => { assert.equal(name, 'mini-a'); return installed; },
    isString: x => typeof x === 'string', isDef: x => x !== undefined
  });
  vm.runInContext(source, context);
  return context;
}
for (const from of ['/checkout/mini-a.js', '/checkout/js/core/mini-a.js', '/checkout/js/wiki/mini-a-wiki.js']) {
  const c = fixture(from, '/installed');
  assert.equal(c.__miniAPackageRoot, '/checkout');
  assert.equal(c.__miniAPath('js/core/mini-a-common.js'), '/checkout/js/core/mini-a-common.js');
  assert.equal(c.__miniAPath('js/core/mini-a-common.js', '/installed'), '/installed/js/core/mini-a-common.js');
}
assert.equal(fixture('/caller/script.js', '/installed').__miniAPackageRoot, '/installed');
assert.equal(fixture(undefined, undefined, '/checkout').__miniAPackageRoot, '/checkout');
assert.throws(() => fixture('/caller/script.js', undefined, '/caller', []), /Cannot locate the Mini-A package/);
console.log('Module source, installed-package and local-checkout path checks passed.');
