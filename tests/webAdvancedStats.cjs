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
const decision = {model: 'decision-test', provider: 'openai', source: 'modeldec', calls: 3,
  input_tokens: 10, output_tokens: 2, total_tokens: 12, usage_reports: 2, duration_ms: 45, failures: 1, fallbacks: 1};
context.decisionFixture = decision;
vm.runInContext(`statsMode = 'summary'; statsMetrics = {performance: {llm_normal_tokens: 42}, decisions: decisionFixture}; renderStats(container);`, context);
const decisionCard = () => context.container.children.find(card => card.children[0]?.text === 'Decision model');
const decisionValues = () => JSON.parse(decisionCard().children[1].children[0].text);
assert.deepEqual(decisionValues(), {Model: 'decision-test', Provider: 'openai', 'Configuration source': 'modeldec', Calls: 3,
  'Input tokens': 10, 'Output tokens': 2, 'Total tokens': 12, 'Usage reports': 2, 'Elapsed (ms)': 45, Failures: 1, Fallbacks: 1});
assert.ok(decisionCard(), 'decision values remain visible without Chart.js');
vm.runInContext(`window.Chart = function(canvas, config) { this.destroy = () => {}; chartConfigs.push(config); };`, Object.assign(context, {chartConfigs: configs}));
vm.runInContext('renderStats(container)', context);
assert.deepEqual(Array.from(configs.at(-1).data.labels), ['Main', 'Decision']);
assert.deepEqual(Array.from(configs.at(-1).data.datasets[0].data), [42, 12]);
decision.usage_reports = 0;
vm.runInContext('renderStats(container)', context);
assert.equal(decisionValues()['Total tokens'], 'Unavailable');
assert.deepEqual(Array.from(configs.at(-1).data.labels), ['Main']);
decision.usage_reports = 1; decision.total_tokens = 0;
vm.runInContext('renderStats(container)', context);
assert.equal(decisionValues()['Total tokens'], 0, 'reported zero remains numeric');
vm.runInContext('statsMetrics.decisions = {}; renderStats(container)', context);
assert.equal(decisionValues().Model, 'Not configured');
vm.runInContext('delete statsMetrics.decisions; renderStats(container)', context);
assert.equal(decisionCard(), undefined, 'older sessions need no decision metrics');
console.log('Advanced statistics charts: data, palette, cleanup, tables and empty states passed.');
