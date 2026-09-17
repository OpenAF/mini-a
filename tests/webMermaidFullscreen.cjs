// Focused gesture and dialog lifecycle checks: node tests/webMermaidFullscreen.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = fs.readFileSync(require('node:path').join(__dirname, '../public/index.md'), 'utf8');
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.attrs = {}; this.events = {}; this.isConnected = true; }
  setAttribute(key, value) { this.attrs[key] = value; }
  removeAttribute(key) { delete this.attrs[key]; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); }
  addEventListener(name, callback) { this.events[name] = callback; }
  emit(name, event = {}) { this.events[name]?.(event); }
  cloneNode() { const copy = new Element(this.tag); copy.attrs = { ...this.attrs }; return copy; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 800 }; }
  setPointerCapture() {}
  querySelector() { return { focus() {} }; }
  focus() { this.focused = true; }
  showModal() { this.modal = true; }
  close() { this.emit('close'); }
  remove() { this.isConnected = false; }
}
const body = new Element('body');
body.style.overflow = 'auto';
const trigger = new Element('button');
let serialized;
let revoked;
const context = { document: { body, activeElement: trigger, createElement: tag => new Element(tag) },
  Blob, URL: { createObjectURL: () => 'blob:test', revokeObjectURL: url => { revoked = url; } },
  XMLSerializer: class { serializeToString(copy) { serialized = copy.attrs; return '<svg/>'; } } };
vm.createContext(context);
vm.runInContext(page.slice(page.indexOf('    function openMermaidFullscreen('), page.indexOf('    function addMermaidPanZoomLayer(')), context);
const svg = new Element('svg');
svg.setAttribute('viewBox', '10 20 50 50');
context.openMermaidFullscreen(svg, '0 0 100 100', null);
const dialog = body.children[0];
const [stage, controls] = dialog.children;
const picture = stage.children[0];
assert.equal(dialog.modal, true);
assert.equal(body.style.overflow, 'hidden');
assert.equal(serialized.viewBox, '0 0 100 100');
assert.equal(svg.attrs.viewBox, '10 20 50 50', 'Inline view is untouched');
const pointer = (name, id, x, y) => stage.emit(name, { pointerId: id, button: 0, clientX: x, clientY: y });
const action = action => controls.emit('click', { target: { closest: () => ({ getAttribute: () => action }) } });
const transform = () => picture.style.transform.match(/-?\d+(?:\.\d+)?/g).map(Number);
pointer('pointerdown', 1, 100, 400);
pointer('pointerdown', 2, 300, 400);
pointer('pointermove', 2, 400, 400);
assert.deepEqual(transform(), [50, 0, 1.5], 'Pinch scales around the old midpoint and follows the new midpoint');
pointer('pointerup', 2, 400, 400);
pointer('pointermove', 1, 120, 430);
assert.deepEqual(transform(), [70, 30, 1.5], 'Lifting one finger continues panning without jumping');
pointer('pointercancel', 1);
pointer('pointermove', 1, 200, 500);
assert.deepEqual(transform(), [70, 30, 1.5], 'Cancelled pointers stop moving the image');
action('reset');
assert.deepEqual(transform(), [0, 0, 1]);
pointer('pointerdown', 3, 100, 400);
pointer('lostpointercapture', 3);
pointer('pointermove', 3, 200, 400);
assert.deepEqual(transform(), [0, 0, 1]);
for (let i = 0; i < 40; i++) action('zoom-in');
assert.equal(transform()[2], 12);
for (let i = 0; i < 60; i++) action('zoom-out');
assert.equal(transform()[2], 0.35);
action('reset');
let prevented = false;
stage.emit('wheel', { deltaY: -1, clientX: 200, clientY: 400, preventDefault() { prevented = true; } });
assert.equal(prevented, true);
assert.deepEqual(transform(), [0, 0, 1.12]);
action('close');
assert.equal(revoked, 'blob:test');
assert.equal(dialog.isConnected, false);
assert.equal(body.style.overflow, 'auto');
assert.equal(trigger.focused, true);
console.log('Mermaid full-screen gesture and lifecycle checks passed.');
