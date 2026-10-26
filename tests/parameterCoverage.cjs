// Public parameter coverage and argument-flow regressions; no providers or servers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const inventory = require('./fixtures/parameterCoverage.json');
const read = path => fs.readFileSync(path, 'utf8');
const session = read('mini-a-session.js');
const core = read('mini-a.js');
const section = (source, start, end) => {
  const offset = source.indexOf(start);
  assert.ok(offset >= 0, start);
  const limit = source.indexOf(end, offset);
  assert.ok(limit > offset, end);
  return source.slice(offset, limit);
};
const definitionSource = section(session, '  var parameterDefinitions = {', '\n  }') + '\n  }';
const definitions = vm.runInNewContext(definitionSource + ';parameterDefinitions', { __: undefined });
const primarySource = section(session, '  var cliPrimaryOptionKeys = {', '\n  }') + '\n  }';
const primaryNames = new Set(Object.keys(vm.runInNewContext(primarySource + ';cliPrimaryOptionKeys')).filter(name => !name.startsWith('-')));
const unique = (names, label) => assert.equal(new Set(names).size, names.length, label + ' has duplicate parameter names');
unique([...definitionSource.matchAll(/^    ([\w-]+|"[\w-]+")\s*:/gm)].map(m => m[1].replaceAll('"', '')), 'interactive definitions');
const helpFiles = ['mini-a.yaml', 'mini-a-web.yaml', 'mini-a-worker.yaml', 'mini-a-ingest.yaml', 'mini-a-absorb.yaml', 'mini-a-eval.yaml'];
function helpNames(file) {
  const source = read(file);
  // The eval adapter owns job-local help; all other launchers own top-level help.
  const help = file === 'mini-a-eval.yaml'
    ? section(source, '  help:', '\n  exec:')
    : section(source, 'help:', source.includes('\ninclude:') ? '\ninclude:' : '\nojob:');
  const names = [...help.matchAll(/^\s*- name\s*:\s*([\w-]+)\s*$/gm)].map(m => m[1]);
  unique(names, file);
  return new Set(names);
}
const helps = Object.fromEntries(helpFiles.map(file => [file, helpNames(file)]));
const flatten = groups => new Set(Object.values(groups).flat());
const jobExcluded = flatten(inventory.jobHelpExclusions);
const webExcluded = flatten(inventory.webHelpExclusions);
const consoleExcluded = flatten(inventory.consoleHelpExclusions);
const publicNames = new Set([...Object.keys(definitions), ...primaryNames, ...Object.values(helps).flatMap(names => [...names])]);
const knownSource = section(core, 'MiniA._KNOWN_ARGUMENT_NAMES =', '\nMiniA._IGNORED_INTERNAL_ARGUMENT_NAMES =');
const knownNames = new Set([...knownSource.matchAll(/"([a-z][\w-]*)"/g)].map(m => m[1]));
for (const name of publicNames) {
  if (!consoleExcluded.has(name)) assert.ok(definitions[name] || primaryNames.has(name), name + ' missing interactive help (or an applicability exclusion)');
}
for (const name of Object.keys(definitions)) {
  if (!jobExcluded.has(name)) assert.ok(helps['mini-a.yaml'].has(name), name + ' missing job help');
  if (!webExcluded.has(name)) assert.ok(helps['mini-a-web.yaml'].has(name), name + ' missing web help');
  assert.ok(knownNames.has(name), name + ' missing known-argument diagnostics');
}
// Inventory the declared runtime contract too, so an option cannot disappear from
// all help sources and thereby escape a union-of-help check.
const runtimeNames = new Set([
  ...[...core.matchAll(/\{ name: "([\w-]+)", type:/g)].map(m => m[1]),
  ...[...core.matchAll(/args\.(\w+) = _\$/g)].map(m => m[1]),
  ...knownNames
]);
for (const name of runtimeNames) {
  if (inventory.nonPublic[name]) continue;
  assert.ok(publicNames.has(name), name + ' runtime argument lacks public help or an internal exclusion');
}
for (const [name, reason] of Object.entries(inventory.nonPublic)) {
  assert.ok(reason.length > 15, name + ' requires an exclusion reason');
  assert.ok(!publicNames.has(name), name + ' internal/inactive setting must not be advertised');
}
assert.ok(!publicNames.has('dreamwikilevel'), 'unsupported dreamwikilevel must not be advertised');
for (const [file, keys] of [['mini-a-worker.yaml', inventory.workerStartup], ['mini-a-ingest.yaml', inventory.ingestBudgets]]) {
  for (const name of keys) assert.ok(helps[file].has(name), name + ' missing ' + file + ' help');
}
for (const file of ['USAGE.md', 'CHEATSHEET.md']) {
  let fence;
  const text = read(file).split('\n').filter(line => {
    const match = line.match(/^\s*(`{3,}|~{3,})/);
    if (match) {
      if (!fence) fence = match[1];
      else if (match[1][0] === fence[0] && match[1].length >= fence.length) fence = undefined;
      return false;
    }
    return !fence;
  }).join('\n');
  const entries = new Set([
    ...[...text.matchAll(/^\|\s*`([\w-]+)`\s*\|/gm)].map(m => m[1]),
    ...[...text.matchAll(/^- \*\*`([\w-]+)`\*\*/gm)].map(m => m[1])
  ]);
  for (const name of publicNames) assert.ok(entries.has(name), name + ' missing an explicit reference entry in ' + file);
}
const groupsSource = section(session, '  var argumentHelpGroups = [', '\n  ]') + '\n  ]';
const groups = vm.runInNewContext(groupsSource + ';argumentHelpGroups');
const categorized = groups.flatMap(group => Array.from(group.names));
unique(categorized, 'help categories');
for (const name of Object.keys(definitions)) assert.ok(categorized.includes(name), name + ' needs an explicit help category');
// Newly exposed settings inherit runtime defaults instead of introducing session overrides.
for (const name of inventory.newInteractive) {
  assert.ok(definitions[name], name + ' interactive entry disappeared');
  assert.equal(Object.hasOwn(definitions[name], 'default'), false, name + ' must preserve runtime fallback');
}
function extractFunction(name) {
  return section(session, '  function ' + name + '(', '\n  }') + '\n  }';
}
const context = vm.createContext({
  adapter: undefined, __: undefined, isDef: x => x !== undefined && x !== null, isUnDef: x => x === undefined || x === null,
  isString: x => typeof x === 'string', isArray: Array.isArray,
  isObject: x => x !== null && typeof x === 'object', isNumber: x => typeof x === 'number',
  stringify: JSON.stringify, af: { toSLON: JSON.stringify }, canonicalizePath: x => x,
  processFileAttachments: x => x, merge: Object.assign, parameterDefinitions: definitions,
  extraCLIArgs: {}, sessionOptions: {}, internalParameters: {}, sessionExplicitOptions: {},
  __miniAPrefixGoal: (goal, prefix) => (prefix || '') + goal
});
for (const name of ['parseBoolean', 'coerceDefaultValue', 'applyArgumentDefaults', 'buildArgs']) vm.runInContext(extractFunction(name), context);
const overrides = {
  wikimaxprompttokens: '12000', wikiingestmaxcalls: '8', wikiingestbudget: '0', wikillmbudget: '-1',
  toolargcheck: 'false', mcpproxydeny: 'write,delete', agentcomms: { profiles: {} },
  memoryreflectmodel: { type: 'fixture', model: 'test' }
};
context.argumentOverrides = overrides;
vm.runInContext('applyArgumentDefaults(argumentOverrides)', context);
for (const name of Object.keys(overrides)) context.sessionOptions[name] = context.parameterDefinitions[name].default;
const args = context.buildArgs('test');
assert.equal(args.wikimaxprompttokens, 12000);
assert.equal(args.wikiingestmaxcalls, 8);
assert.equal(args.wikiingestbudget, 0);
assert.equal(args.wikillmbudget, -1);
assert.equal(args.toolargcheck, false);
assert.equal(args.mcpproxydeny, 'write,delete');
assert.equal(args.agentcomms, '{"profiles":{}}');
assert.equal(args.memoryreflectmodel, '{"type":"fixture","model":"test"}');
assert.equal(context.coerceDefaultValue(definitions.mcp, [{ type: 'fixture' }], 'mcp'), '[{"type":"fixture"}]');
assert.equal(context.coerceDefaultValue(definitions.agentcomms, '(profiles: {})', 'agentcomms'), '(profiles: {})');
assert.equal(args.memoryinject, undefined, 'unset conditional memory injection remains omitted');
assert.equal(args.ingestmode, undefined, 'unset ingestion mode remains omitted');
context.sessionOptions = {};
assert.equal(context.buildArgs('test').wikimaxprompttokens, undefined, 'unset prompt cap remains omitted');
// Execute the production budget helper to pin the documented precedence/sentinel behavior.
const budgetSource = read('mini-a-wiki-knowledge.js').split('\nMiniAWikiManager.prototype.')[0];
const Budget = vm.runInNewContext(budgetSource + ';MiniAWikiKnowledgeBudget', { isMap: x => x && typeof x === 'object' });
assert.equal(new Budget({}, 'ingest').maxPrompt, 0);
assert.equal(new Budget({ wikimaxprompttokens: 0 }, 'ingest').maxPrompt, 0);
assert.equal(new Budget({ wikimaxprompttokens: 'invalid' }, 'ingest').maxPrompt, 0);
assert.equal(new Budget({ wikillmbudget: 100, wikiingestbudget: 200 }, 'ingest').limit, 200);
assert.equal(new Budget({ wikillmbudget: 100, wikiingestbudget: -1 }, 'ingest').limit, 100);
assert.equal(new Budget({ wikillmbudget: -1 }, 'ingest').limit, -1);
assert.equal(new Budget({ wikiingestbudget: 0 }, 'ingest').reserve('test', 1, 0), false);
assert.equal(new Budget({ wikimaxprompttokens: 10 }, 'ingest').reserve('test', 11, 0), false);
console.log('PASS public parameter help/reference coverage (' + publicNames.size + ' names), categories, argument flow and budget defaults');
