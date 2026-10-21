const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('mini-a-session.js', 'utf8');
const start = source.indexOf('  function printStats(');
const end = source.indexOf('\n  function commandHelpRows(', start);
let rows, exported;
const metrics = {llm_calls: {total: 4, normal: 1, decision: 3}, decisions: {
  model: 'decision-test', provider: 'openai', source: 'OAF_DECIDE_MODEL', calls: 3,
  input_tokens: 10, output_tokens: 2, total_tokens: 12, usage_reports: 2, duration_ms: 45,
  failures: 1, fallbacks: 1, reasons: {provider_error: 1}
}};
const context = vm.createContext({
  activeAgent: {getMetrics: () => metrics}, sessionMetrics: () => metrics,
  parseStatsOptions: () => ({ok: true, outputPath: '/fixture/stats.json'}),
  isObject: x => x !== null && typeof x === 'object',
  isMap: x => x !== null && typeof x === 'object' && !Array.isArray(x),
  isString: x => typeof x === 'string', isDef: x => x !== undefined,
  clone: x => JSON.parse(JSON.stringify(x)),
  print() {}, printErr() {}, colorifyText: x => x,
  printTable: value => { rows = JSON.parse(JSON.stringify(value)); return ''; },
  io: {writeFileJSON: (path, payload) => { exported = JSON.parse(JSON.stringify(payload)); }},
  browserResult() {}, __: undefined, __conAnsi: false,
  accentColor: '', hintColor: '', errorColor: '', successColor: ''
});
vm.runInContext(source.slice(start, end), context);
const run = () => vm.runInContext("printStats('')", context);
const values = () => Object.fromEntries(rows.filter(row => row.category === 'Decision').map(row => [row.metric, row.value]));
run();
assert.deepEqual(values(), {Model: 'decision-test', Provider: 'openai', 'Configuration source': 'OAF_DECIDE_MODEL', Calls: 3,
  'Input tokens': 10, 'Output tokens': 2, 'Total tokens': 12, 'Usage reports': 2, 'Elapsed (ms)': 45, Failures: 1, Fallbacks: 1});
assert.deepEqual(exported.data.decisions, metrics.decisions, 'export preserves every raw decision field');
assert.equal(exported.data.llm_calls.total, 4);
metrics.decisions.usage_reports = 0; run();
assert.equal(values()['Total tokens'], 'Unavailable');
assert.equal(exported.data.decisions.total_tokens, 12, 'display placeholders do not change exports');
metrics.decisions.usage_reports = 1; metrics.decisions.total_tokens = 0; run();
assert.equal(values()['Total tokens'], 0);
delete metrics.llm_calls; metrics.decisions = {}; run();
assert.equal(values().Model, 'Not configured', 'decision display does not depend on LLM call counters');
delete metrics.decisions; run();
assert.deepEqual(values(), {});
assert.equal(exported.data.decisions, undefined);
console.log('Console statistics: decision identity, usage availability, legacy metrics and exports passed.');
