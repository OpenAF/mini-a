const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/advanced.js', 'utf8');
const session = fs.readFileSync('mini-a-session.js', 'utf8');
const filters = [...session.matchAll(/\{ key: "([^"]+)", label: "([^"]+)" \}/g)].map(([, category, label]) => ({category, label}));
const shared = vm.createContext({
  isMap: value => value !== null && typeof value === 'object' && !Array.isArray(value),
  isString: value => typeof value === 'string', isDef: value => value !== undefined,
  stringify: JSON.stringify, __: undefined, truncateForConsoleWidth: (text, width) => text.slice(0, width)
});
vm.runInContext(session.slice(session.indexOf('  function traceEventSummary('), session.indexOf('  var debugTraceFilters =')), shared);
assert.equal(shared.traceEventSummary({kind: 'tool_result', payload: {count: 2}}), '{"count":2}', 'console JSON fallback is unchanged');
assert.equal(shared.traceEventSummary({kind: 'tool_result', payload: {count: 2}}, true), 'tool_result');
for (const [kind, payload, category] of [
  ['tool_call', {name: 'search'}, 'calls'], ['tool_result', {}, 'answers'],
  ['event', {message: '[mem: loaded]'}, 'memory'], ['llm_prompt', {label: 'SYSTEM_INSTRUCTION'}, 'system'],
  ['llm_prompt', {label: 'STEP_PROMPT'}, 'prompts'], ['llm_response', {}, 'responses'],
  ['event', {event: 'thought'}, 'thinking'], ['event', {event: 'warn'}, 'problems'], ['goal', {}, 'events']
]) assert.equal(shared.classifyDebugTraceRecord({kind, payload}), category);
function node(tag, text, className) {
  return {tag, textContent: text, className, children: [], attributes: {}, listeners: {},
    classList: {toggle(name, value) { this[name] = value; }},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, fn) { this.listeners[name] = fn; },
    contains(target) { return this === target || this.children.some(child => child.contains(target)); },
    get lastChild() { return this.children.at(-1); },
    get value() { return this._value ?? (this.tag === 'select' ? this.children[0]?.value : ''); },
    set value(value) { this._value = value; }
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup() {
  const requests = [];
  const context = vm.createContext({el: node, screen: node('section'), activeScreen: 'debug', enabled: true,
    uuid: 'first', document: {body: {classList: {contains: () => false}}}, window: {},
    button: (text, onclick) => Object.assign(node('button', text), {onclick}),
    api: data => new Promise((resolve, reject) => requests.push({data, resolve, reject})),
    events: node('div'), showError() { assert.fail('Debug errors must stay in Debug'); }
  });
  context.bridge = {uuid: () => context.uuid};
  vm.runInContext(source.slice(source.indexOf('  function activityText('), source.indexOf('  const toolbar =')), context);
  vm.runInContext(source.slice(source.indexOf('  function structuredOutput('), source.indexOf('  function renderStats(')), context);
  vm.runInContext(source.slice(source.indexOf('  let debugGeneration ='), source.indexOf('  function statisticsScreen(')), context);
  vm.runInContext('debugScreen()', context);
  const [controls, notice, frame, more, details] = context.screen.children;
  return {context, requests, category: controls.children[0].children[0], refresh: controls.children[1], notice, more, details,
    body: frame.children[0].children[1], status: details.children[1], content: details.children[2]};
}
const item = (sequence, category = 'calls') => ({sequence, category, kind: 'tool_call', summary: 'fixture ' + sequence, timestamp: '2026-10-02T10:00:00Z'});
const record = sequence => ({sequence, timestamp: '2026-10-02T10:00:00Z', kind: 'tool_call', payload: {nested: [{text: '<script>' + 'x'.repeat(16000)}]}});
async function page(ui, entries = [item(1), item(2)], extra = {}) {
  ui.requests.at(-1).resolve({events: entries, total: entries.length, filters, hasMore: false, ...extra}); await flush();
}
(async () => {
  const ui = setup();
  assert.equal(ui.requests[0].data.after, 0);
  await page(ui, [item(1), item(2)], {hasMore: true});
  assert.equal(ui.category.children.length, 9);
  assert.equal(ui.category.children[1].textContent, 'MCP and tool calls');
  assert.equal(ui.category.children[8].textContent, 'Warnings and errors');
  assert.deepEqual(ui.body.children.map(row => row.children[0].children[0].textContent), ['#1', '#2']);
  assert.equal(ui.body.children[0].children[1].textContent, 'tool_call');
  assert.equal(ui.body.children[0].children[2].textContent, 'fixture 1');
  assert.equal(ui.requests.at(-1).data.sequence, 1, 'first event selected automatically');
  const oldDetail = ui.requests.at(-1);
  ui.body.children[1].children[0].children[0].onclick();
  ui.requests.at(-1).resolve(record(2)); await flush();
  assert.equal(ui.body.children[1].classList['is-selected'], true);
  assert.equal(ui.body.children[0].children[0].children[0].attributes['aria-pressed'], 'false');
  assert.equal(ui.content.children.length, 1);
  assert.equal(ui.content.children[0].children[0].textContent, JSON.stringify(record(2), null, 2), 'full record plain-text fallback');
  oldDetail.resolve(record(1)); await flush();
  assert.equal(ui.status.textContent, '#2 tool_call', 'stale selection ignored');
  ui.more.onclick();
  assert.equal(ui.requests.at(-1).data.after, 2);
  await page(ui, [item(3)], {total: 3});
  assert.equal(ui.body.children.length, 3);
  assert.equal(ui.status.textContent, '#2 tool_call', 'pagination preserves details');
  assert.equal(ui.more.hidden, true);
  ui.body.children[2].listeners.click({target: ui.body.children[2]});
  ui.requests.at(-1).resolve({}); await flush();
  assert.match(ui.status.textContent, /no longer available/);
  assert.equal(ui.content.children.length, 0, 'new selection replaces old details immediately');
  ui.body.children[2].children[0].children[0].onclick();
  ui.requests.at(-1).reject(new Error('Offline')); await flush();
  assert.match(ui.status.textContent, /Unable to load record: Offline/);
  ui.category.value = 'problems'; ui.category.onchange();
  assert.equal(ui.requests.at(-1).data.after, 0);
  assert.equal(ui.requests.at(-1).data.category, 'problems');
  const stalePage = ui.requests.at(-1);
  ui.category.value = 'thinking'; ui.category.onchange();
  await page(ui, [], {total: 3});
  stalePage.resolve({events: [item(9)], filters, total: 3}); await flush();
  assert.equal(ui.body.children.length, 0);
  assert.equal(ui.notice.textContent, 'No events in this category.');
  ui.refresh.onclick(); await page(ui, [item(4, 'thinking')]);
  assert.equal(ui.requests.at(-1).data.sequence, 4, 'filter refresh auto-selects');
  const staleFilteredDetail = ui.requests.at(-1);
  ui.category.value = 'all'; ui.category.onchange();
  await page(ui, []);
  staleFilteredDetail.reject(new Error('Old error')); await flush();
  assert.match(ui.notice.textContent, /No debug trace events/);
  assert.equal(ui.status.textContent, 'No record selected.');
  ui.refresh.onclick(); ui.requests.at(-1).reject(new Error('Network')); await flush();
  assert.match(ui.notice.textContent, /Unable to load debug events: Network/);
  assert.equal(ui.refresh.disabled, false);
  assert.equal(ui.context.events.children.length, 0, 'browsing never appends Live activity');
  assert.ok(ui.requests.every(req => req.data.action === 'trace'), 'browsing only uses read-only trace requests');
  for (const change of [c => { c.uuid = 'second'; }, c => { c.activeScreen = 'activity'; }, c => { c.enabled = false; }, c => vm.runInContext('debugGeneration++', c)]) {
    for (const fail of [false, true]) {
      const stale = setup(); change(stale.context);
      const before = stale.notice.textContent;
      if (fail) stale.requests[0].reject(new Error('stale')); else stale.requests[0].resolve({events: [item(1)], filters});
      await flush(); assert.equal(stale.body.children.length, 0); assert.equal(stale.notice.textContent, before);
      const detail = setup(); await page(detail);
      change(detail.context); const status = detail.status.textContent;
      if (fail) detail.requests.at(-1).reject(new Error('stale')); else detail.requests.at(-1).resolve(record(1));
      await flush(); assert.equal(detail.content.children.length, 0); assert.equal(detail.status.textContent, status);
    }
  }
  const retry = setup(); await page(retry, [item(1)], {hasMore: true});
  retry.more.onclick(); retry.requests.at(-1).reject(new Error('Offline')); await flush();
  assert.equal(retry.body.children.length, 1); assert.equal(retry.more.disabled, false);
  assert.match(retry.notice.textContent, /Use Load more to retry/);
  console.log('Advanced Debug: chronology, labels, selection, replacement, pagination, failures, stale responses and activity isolation passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
