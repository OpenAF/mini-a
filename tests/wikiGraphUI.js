// Dependency-free interaction smoke test, not a browser/rendering test.
// Usage: node tests/wikiGraphUI.js /path/to/export.html
var fs = require('fs'), vm = require('vm'), assert = require('assert');
var html = fs.readFileSync(process.argv[2], 'utf8');
var payload = html.match(/<script id="graph-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
var script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
var elements = new Map();
function element(tag) {
  return {
    tagName: tag.toUpperCase(), children: [], style: {}, value: '', checked: true,
    append: function() { this.children.push.apply(this.children, arguments); },
    appendChild: function(child) { this.children.push(child); return child; },
    replaceChildren: function() { this.children = Array.from(arguments); },
    setAttribute: function(k, v) { this[k] = v; },
    querySelector: function(tag) { return this.children.find(function(c) { return c.tagName === tag.toUpperCase(); }); },
    focus: function() { document.activeElement = this; },
    click: function() { if(this.onclick) this.onclick(); },
    setPointerCapture: function() {}
  };
}
Array.from(html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"/g)).forEach(function(m) { elements.set(m[2], element(m[1])); });
elements.get('graph-data').textContent = payload;
var context = new Proxy({}, { get: function(target, key) {
  if(key === 'createRadialGradient') return function() { return { addColorStop: function() {} }; };
  return target[key] || function() {};
}, set: function(target, key, value) { target[key] = value; return true; } });
elements.get('sky').getContext = function() { return context; };
var document = { getElementById: function(id) { return elements.get(id); }, createElement: element,
  createTextNode: function(text) { return { textContent: text }; }, activeElement: element('body') };
var frames = [], sandbox = { document: document, console: console, innerWidth: 1400, innerHeight: 900,
  devicePixelRatio: 1, matchMedia: function() { return { matches: true }; },
  location: { hash: '', pathname: '/atlas.html', search: '' },
  requestAnimationFrame: function(fn) { frames.push(fn); }, setTimeout: setTimeout,
  performance: { now: function() { return 0; } }, URL: URL };
sandbox.window = sandbox; sandbox.history = { replaceState: function() {} };
vm.runInNewContext(script, sandbox);
frames.shift()(0);
assert.match(elements.get('stats').textContent, /stars/);
var data = JSON.parse(payload);
if(data.nodes.length) {
  elements.get('random').click();
  assert(elements.get('detail').children.some(function(c) { return c.tagName === 'H2'; }));
  var connection = elements.get('detail').children.find(function(c) { return c.tagName === 'BUTTON'; });
  if(connection) { connection.click(); assert.strictEqual(elements.get('back').disabled, false); elements.get('back').click(); }
  var search = elements.get('search'); search.value = data.nodes[0].label; search.oninput();
  assert(elements.get('results').children.length > 1);
  elements.get('focus').checked = true; elements.get('focus').onchange();
  elements.get('plus').click(); elements.get('minus').click(); elements.get('fit').click();
  elements.get('types').children.forEach(function(row) { var input = row.querySelector('input'); input.checked = false; input.onchange(); });
  assert.match(elements.get('notice').textContent, /No stars/);
  elements.get('random').click();
  document.onkeydown({ key: 'Escape' });
  frames.shift()(16);
}
assert.strictEqual(sandbox.injected, undefined);
console.log('Interaction smoke passed (DOM/canvas stubs; visual browser QA still required).');
