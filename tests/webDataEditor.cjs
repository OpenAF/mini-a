const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
// Minimal DOM harness exercises user controls without introducing runtime dependencies.
class Element {
  constructor(tag) { this.tag = tag; this.tagName = tag?.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {}; this.style = {}; this.classList = {add(){}}; if (tag) this.value = ''; }
  append(...items) { for (const item of items) { if (item.parent) item.parent.children = item.parent.children.filter(n => n !== item); item.parent = this; this.children.push(item); if (this.isConnected) connect(item); if (this.tag === 'select' && !this.value) this.value = item.value; } }
  prepend(...items) { for (const item of items.reverse()) { item.parent = this; this.children.unshift(item); } }
  after(item) { item.parent = this.parent; this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, item); }
  closest(tag) { return this.parent?.tag === tag ? this.parent : null; }
  replaceChildren(...items) { this.children.forEach(n => n.isConnected = false); this.children = []; this.append(...items); }
  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k]; }
  addEventListener(k, fn) { (this.listeners[k] ||= []).push(fn); }
  setCustomValidity(text) { this.validityMessage = text; }
  dispatchEvent(event) { this.lastEvent = event; this['on' + event.type]?.(event); (this.listeners[event.type] || []).forEach(fn => fn(event)); }
  click() { if (!this.disabled) this.dispatchEvent({type:'click'}); }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent({type:'close'}); }
  remove() { this.parent.children = this.parent.children.filter(n => n !== this); this.isConnected = false; }
  querySelectorAll(selector) { return descendants(this).filter(n => selector === '.data-editor-string' ? n.className?.includes('data-editor-string') : n.dataset.editorFocus); }
  getClientRects() { return []; }
}
function connect(node) { node.isConnected = true; node.connectedCallback?.(); node.children.forEach(connect); }
function descendants(node) { return node.children.flatMap(n => [n, ...descendants(n)]); }
let Editor, copiedOutput;
class ResizeObserver {
  constructor(callback) { this.callback = callback; }
  observe(target) { this.target = target; }
  disconnect() { this.disconnected = true; }
}
const window = {}, body = new Element('body'); body.isConnected = true;
class UIEvent { constructor(type, options) { this.type = type; Object.assign(this, options); } }
vm.runInNewContext(fs.readFileSync('public/data-editor.js', 'utf8'), {
  window, ResizeObserver, requestAnimationFrame: fn => fn(), HTMLElement: Element,
  getComputedStyle: () => ({paddingTop:'4px', paddingBottom:'4px', borderTopWidth:'1px', borderBottomWidth:'1px', lineHeight:'18px'}),
  navigator: {clipboard: {writeText: async text => { copiedOutput = text; }}}, document: {body, getElementById: id => descendants(body).find(n => n.id === id), createElementNS: (_ns, tag) => new Element(tag), createElement: tag => tag === 'mini-a-data-editor' ? new Editor() : new Element(tag)},
  customElements: {get(){}, define(name, value) { Editor = value; }}, CustomEvent: UIEvent, Event: UIEvent
});
const editor = new Editor(); editor.connectedCallback(); editor._format.value = 'json';
const value = () => JSON.parse(JSON.stringify(editor.value));
const field = (path, suffix) => descendants(editor).find(n => n.dataset.editorFocus === JSON.stringify(path) + suffix);
const named = (root, label) => descendants(root).find(n => n.tag === 'button' && (n.getAttribute('aria-label') || n.textContent) === label);
const click = text => { const b = named(editor, text); assert.ok(b, text); b.click(); };
assert.equal(editor._undoButton.disabled, true); assert.equal(editor._redoButton.disabled, true);
for (const label of ['Preview', 'Import', 'Help']) {
  const toggle = named(editor, label), panel = descendants(editor).find(n => n.id === toggle.getAttribute('aria-controls'));
  assert.equal(toggle.getAttribute('aria-expanded'), 'false'); assert.equal(panel.hidden, true);
  toggle.click(); assert.equal(panel.hidden, false); assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  toggle.click(); assert.equal(panel.hidden, true);
}
editor.value = {nested:[1, false, null, 'true', "a'\"\\\n|()"], empty:{}};
for (const label of ['Undo','Redo','Add property','Add item','Remove','Move up','Move down','Copy output']) {
  const button = named(editor, label); assert.ok(button, label);
  assert.equal(button.textContent, undefined, label + ' has no visible text');
  assert.equal(button.title, label); assert.equal(button.children[0].tag, 'svg');
  assert.equal(button.children[0].getAttribute('aria-hidden'), 'true');
}
const disclosure = field(['nested'], 'disclosure');
assert.equal(disclosure.getAttribute('aria-expanded'), 'true'); disclosure.click();
assert.equal(disclosure.getAttribute('aria-expanded'), 'false');
assert.equal(descendants(editor).find(n => n.id === disclosure.getAttribute('aria-controls')).hidden, true);
editor._render(); assert.equal(field(['nested'], 'disclosure').getAttribute('aria-expanded'), 'false');
field(['nested'], 'disclosure').click(); assert.equal(field(['nested'], 'disclosure').getAttribute('aria-expanded'), 'true');
assert.equal(field(['nested', 3], 'value').rows, 1);
// Automatic height starts at one line, caps at six, and respects a manual drag.
const stringField = field(['nested', 3], 'value');
stringField.isConnected = true; stringField.getClientRects = () => [{}];
Object.defineProperty(stringField, 'offsetHeight', {get: () => parseFloat(stringField.style.height)});
stringField.scrollHeight = 26; editor._grow(stringField); assert.equal(stringField.style.height, '28px');
stringField.scrollHeight = 62; editor._grow(stringField); assert.equal(stringField.style.height, '64px');
stringField.scrollHeight = 188; editor._grow(stringField); assert.equal(stringField.style.height, '118px');
stringField.style.height = '170px'; stringField.onpointerup();
stringField.value = 'manually resized'; stringField.oninput(); assert.equal(stringField.style.height, '170px');
const observer = editor._resizeObserver; observer.callback([{contentRect:{width:390}}]);
assert.equal(stringField.style.height, '170px', 'Responsive reflow preserves a manual resize');
editor.disconnectedCallback(); assert.equal(observer.disconnected, true);
editor.connectedCallback(); assert.notEqual(editor._resizeObserver, observer);
const copy = editor.value; copy.nested.push(4); assert.equal(editor.value.nested.length, 5);
assert.deepEqual(JSON.parse(editor.serialize('json')), value());
assert.match(editor.serialize('slon'), /\\u0027/);
field(['nested', 0], 'value').value = '1e'; field(['nested', 0], 'value').oninput();
assert.equal(editor._copy.disabled, true); assert.equal(editor._output.value, '');
assert.throws(() => editor.serialize('json'), /invalid fields/);
editor._format.value = 'slon'; editor._format.onchange(); assert.equal(editor._output.value, '');
field(['nested', 0], 'value').value = '-2.5e2'; field(['nested', 0], 'value').oninput();
assert.equal(editor.value.nested[0], -250); assert.equal(editor._copy.disabled, false);
click('Copy output'); assert.equal(copiedOutput, editor._output.value);
click('Undo'); assert.equal(editor.value.nested[0], 1);
click('Redo'); assert.equal(editor.value.nested[0], -250);
editor.value = {a:1, b:2};
field(['a'], 'key').value = 'b'; field(['a'], 'key').onchange();
assert.equal(editor._copy.disabled, true); assert.deepEqual(value(), {a:1,b:2});
field(['a'], 'key').value = '__proto__'; field(['a'], 'key').onchange();
assert.equal(Object.hasOwn(editor.value, '__proto__'), true); assert.equal(editor.value.__proto__, 1);
editor.value = ['a', 'b'];
assert.equal(named(editor, 'Move up').disabled, true);
const moves = descendants(editor).filter(n => n.getAttribute('aria-label') === 'Move down'); assert.equal(moves[0].disabled, false); assert.equal(moves[1].disabled, true); moves[1].click(); assert.deepEqual(value(), ['a','b']); moves[0].click();
assert.deepEqual(value(), ['b','a']); click('Remove'); assert.deepEqual(value(), ['a']); click('Undo'); assert.deepEqual(value(), ['b','a']);
click('Add item'); assert.deepEqual(value(), ['b','a','']);
field([2], 'type').value = 'map'; field([2], 'type').onchange(); assert.deepEqual(value()[2], {});
field([2], 'disclosure').click(); field([2], 'add').click();
assert.equal(field([2], 'disclosure').getAttribute('aria-expanded'), 'true');
assert.equal(field([2, 'key'], 'key').focused, true); click('Undo');
editor._source.value = '{bad'; click('Replace with JSON/SLON'); assert.deepEqual(value(), ['b','a',{}]);
editor._source.value = '{"imported":[]}'; click('Replace with JSON/SLON'); assert.deepEqual(value(), {imported:[]}); click('Undo'); assert.deepEqual(value(), ['b','a',{}]);
assert.throws(() => { editor.value = null; }, /root/);
assert.throws(() => { editor.value = {date:new Date()}; }, /JSON-compatible/);
const retainedTree = editor._tree; editor.connectedCallback(); assert.equal(editor._tree, retainedTree, 'Reattachment preserves the draft DOM');
assert.throws(() => { editor.value = {number:Infinity}; }, /JSON-compatible/);
assert.throws(() => { editor.value = Array(2001).fill(0); }, /2,000/);
const page = fs.readFileSync('public/index.md', 'utf8');
assert.ok(page.indexOf("resolveAppUrl('data-editor.js?raw=true')") < page.indexOf("resolveAppUrl('advanced.js?raw=true')"));
assert.doesNotMatch(fs.readFileSync('public/advanced.js', 'utf8'), /activeScreen === 'editor'|\['editor', 'Data editor'/);
assert.match(fs.readFileSync('public/advanced.js', 'utf8'), /MiniADataEditor.bind/);
console.log('Data editor controls: nesting, types, validation, history, array order, import, safe keys, serialization, and loading passed.');
// Optional reference parser interoperability when the sibling SLON checkout is available.
if (fs.existsSync('../slon/nodejs/index.js')) {
  const slon = require('../../slon/nodejs');
  editor.value = {values:['true','false','null','1','a|b',"a'b\"c",'line\nnext','💚',{},[]], enabled:true, n:-2.5e20};
  assert.deepEqual(slon.parse(editor.serialize('slon')), value());
  console.log('SLON reference parser round-trip passed.');
}

const api = window.MiniADataEditor;
const plain = value => JSON.parse(JSON.stringify(value));
assert.deepEqual(plain(api.parse("(type: openai, options: (temperature: 0.2), roles: [user | 'admin'])").value), {type:'openai',options:{temperature:0.2},roles:['user','admin']});
assert.throws(() => api.parse('(x: 1, x: 2)'), /Duplicate/);
assert.throws(() => api.parse('(date: 2026-10-02/12:00:00.000)'), /datetime/);
assert.throws(() => api.parse('(x: 1) trailing'), /trailing/);
assert.equal(Object.hasOwn(api.parse('(__proto__: (safe: true))').value, '__proto__'), true);
editor.value = {nested:['hello world',"quote'",'line\nnext',0,false,null,{}]};
assert.deepEqual(plain(api.parse(editor.serialize('slon')).value), value());
const origin = new Element('input'); origin.value = '(model: test, enabled: true)'; body.append(origin);
const trigger = api.bind(origin, {label:'model'}); assert.ok(trigger);
assert.equal(trigger.children[0].tag, 'svg'); assert.equal(trigger.parent, origin.parent);
assert.equal(trigger.attributes['aria-haspopup'], 'dialog');
const label = new Element('label'), labelled = new Element('input'); label.append(labelled); body.append(label);
const labelledTrigger = api.bind(labelled, {label:'state'});
assert.equal(label.htmlFor, labelled.id); assert.ok(labelled.id);
assert.equal(labelledTrigger.parent, labelled.parent); assert.notEqual(labelled.parent, label); assert.equal(api.bind(origin), undefined);
let popup = api.open(origin, {label:'model'});
let draft = descendants(popup).find(n => n instanceof Editor);
assert.equal(draft.format, 'slon'); assert.equal(draft.value.model, 'test');
draft.value = {model:'changed', options:{list:[1,2]}};
const popupClick = label => descendants(popup).find(n => n.textContent === label && n.tag === 'button').click();
popupClick('Cancel'); assert.equal(origin.value, '(model: test, enabled: true)'); assert.equal(origin.focused, true);
popup = api.open(origin); draft = descendants(popup).find(n => n instanceof Editor); draft.value = {model:'changed'}; draft.format = 'json'; popupClick('Use value');
assert.equal(origin.value, '{"model":"changed"}'); assert.equal(origin.lastEvent.type, 'change'); assert.equal(popup.open, false);
popup = api.open(origin); origin.value = 'changed elsewhere'; popupClick('Use value'); assert.equal(popup.open, true); assert.equal(origin.value, 'changed elsewhere'); popupClick('Cancel');
popup = api.open(origin); assert.equal(descendants(popup).find(n => n.textContent === 'Use value').disabled, true);
draft = descendants(popup).find(n => n instanceof Editor); assert.equal(draft._importer.hidden, false); assert.equal(draft._importer.toggle.getAttribute('aria-expanded'), 'true'); draft.dispatchEvent({type:'change'});
assert.equal(descendants(popup).find(n => n.textContent === 'Use value').disabled, true, 'Native source/format change must not enable an unloaded draft');
let cancelled = false; popup.dispatchEvent({type:'cancel',preventDefault(){cancelled=true;},stopPropagation(){}}); assert.equal(cancelled,true); assert.equal(popup.open,false);
origin.readOnly = true; assert.equal(api.open(origin), undefined);
assert.ok(descendants(editor).some(n => n.tag === 'table'), 'Nested values render as inline editable tables');
console.log('Field popup: JSON/SLON loading, inline tables, cancel/Escape, write-back, stale-field protection, and read-only guard passed.');
