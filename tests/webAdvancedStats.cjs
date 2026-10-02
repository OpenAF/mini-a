const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/advanced.js', 'utf8');
const makeNode = tag => ({tag, children: [], style: {}, append(...nodes) { this.children.push(...nodes); }, replaceChildren(...nodes) { this.children = nodes; }, setAttribute() {}, get childElementCount() { return this.children.length; }});
const configs = []; let destroyed = 0;
const context = vm.createContext({
  activityText: value => typeof value === 'string' ? value : JSON.stringify(value),
  el: (tag, text) => Object.assign(makeNode(tag), {text}), shell: {},
  getComputedStyle: () => ({getPropertyValue: name => name === '--advanced-muted' ? '#556e5e' : '#24352a'}),
  window: {Chart: function(canvas, config) { configs.push(config); this.destroy = () => destroyed++; }}
});
vm.runInContext(source.slice(source.indexOf("  let statsMode ="), source.indexOf('  function statisticsScreen()')), context);
context.container = makeNode('div');
vm.runInContext(`statsMetrics = {performance: {llm_normal_tokens: 42, llm_lc_tokens: 0, llm_val_tokens: 2, step_llm_wait_ms_total: 500}, goals: {achieved: 1, failed: 0}, per_tool_usage: {search: {calls: 3, successes: 2, failures: 1}}}; renderStats(container);`, context);
assert.ok(configs.length >= 3);
assert.equal(configs[0].data.datasets[0].backgroundColor, '#556e5e');
assert.deepEqual(Array.from(configs[0].data.datasets[0].data), [42, 0, 2]);
assert.equal(configs[0].options.plugins.colors.enabled, false);
const previous = configs.length;
vm.runInContext("statsMode = 'tools'; renderStats(container)", context);
assert.equal(destroyed, previous, 'old charts are destroyed on switching categories');
assert.deepEqual(Array.from(configs.at(-3).data.datasets[0].data), [3]);
vm.runInContext("window.Chart = undefined; renderStats(container)", context);
assert.ok(context.container.children.every(card => card.children.at(-1).open), 'tables stay visible without Chart.js');
vm.runInContext("statsMetrics = null; renderStats(container)", context);
assert.match(context.container.children[0].text, /Run a goal/);
vm.runInContext("statsMetrics = {}; statsMode = 'wiki'; renderStats(container)", context);
assert.match(context.container.children[0].text, /No wiki/);
console.log('Advanced statistics charts: data, palette, cleanup, tables and empty states passed.');
