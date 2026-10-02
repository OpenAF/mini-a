const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/advanced.js', 'utf8');
const session = fs.readFileSync('mini-a-session.js', 'utf8');
const start = session.indexOf('  var parameterDefinitions = {');
const end = session.indexOf('\n  }', start) + 4;
const definitions = vm.runInNewContext(session.slice(start, end) + '; parameterDefinitions', {__: undefined});
const node = (tag, text, className) => ({tag, text, className, children: [], attributes: {},
  append(...children) { this.children.push(...children); },
  replaceChildren(...children) { this.children = children; },
  setAttribute(name, value) { this.attributes[name] = value; }
});
const bindings = [];
const context = vm.createContext({
  statsGeneration: 0, debugGeneration: 0, destroyStatsCharts() {}, activeScreen: 'settings',
  screens: ['settings', 'wiki', 'graph', 'history', 'ingest', 'absorb'].map(name => [name, name, '']),
  screenTrigger: node('button'), screenButtons: [], activity: node('div'), screen: node('div'),
  tabIcon: () => node('svg'), el: node, input: (name, value = '') => Object.assign(node('input'), {value}),
  button: (text, onclick) => Object.assign(node('button', text), {onclick}),
  asText: value => value === undefined ? undefined : String(value),
  snapshot: {settings: Object.entries(definitions).map(([name, def]) => ({...def, name, value: def.default})), presets: []},
  window: {MiniADataEditor: {bind(field, options) { bindings.push({field, ...options}); }}},
  api: async () => ({sessions: []}), showError: assert.fail
});
vm.runInContext(source.slice(source.indexOf('  function commandForm('), source.indexOf('  let statsMode =')), context);
vm.runInContext(source.slice(source.indexOf('  function renderScreen() {'), source.indexOf('\n  renderScreen();')), context);
context.renderScreen();
for (const name of ['absorboutput', 'policyfile', 'dreamreport', 'wikiroot', 'debugfile', 'subtasksfile', 'planfile', 'outfile', 'conversation', 'utilsroot', 'homedir', 'path', 'format', 'goal']) {
  assert.ok(!bindings.some(binding => binding.label === name), name + ' remains plain text');
}
for (const name of ['policy', 'model', 'modellc', 'modelval', 'wikimounts', 'memorych', 'auditch', 'rules', 'subtasks']) {
  assert.ok(bindings.some(binding => binding.label === name), name + ' retains structured editing');
}
assert.equal(bindings.find(binding => binding.label === 'wikimounts').root, 'array');
assert.equal(bindings.find(binding => binding.label === 'policy').root, 'map');
const list = context.screen.children.find(child => child.className === 'advanced-settings');
const booleanLabel = list.children.find(row => row.children[0].text === 'adaptiverouting').children[0];
assert.equal(booleanLabel.className, 'advanced-boolean-setting');
assert.equal(booleanLabel.children[0].type, 'checkbox');
assert.equal(booleanLabel.children[0].checked, false);
context.snapshot.settings.forEach(setting => setting.readOnly = true);
bindings.length = 0;
context.renderScreen();
assert.equal(bindings.length, 0, 'server-controlled settings cannot open an editor');
for (const screen of ['wiki', 'graph', 'history', 'ingest']) {
  context.activeScreen = screen; context.renderScreen();
  assert.equal(bindings.length, 0, screen + ' path and command inputs remain plain text');
}
context.activeScreen = 'absorb'; context.renderScreen();
assert.equal(bindings.length, 1, 'only inline plan specs offer the editor');
assert.equal(bindings[0].label, 'Spec file or inline JSON/SLON');
assert.equal(bindings[0].root, 'map');
console.log('Advanced settings and command forms: editor eligibility and Boolean controls passed.');
