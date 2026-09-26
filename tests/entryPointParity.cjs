// Execute launcher bodies and shared helpers without provider calls or a terminal.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const common = fs.readFileSync('mini-a-common.js', 'utf8');
const job = fs.readFileSync('mini-a.yaml', 'utf8');
const con = fs.readFileSync('mini-a-con.js', 'utf8');
const output = [], warnings = [], executed = [];
const c = vm.createContext({
  __: undefined, isString: x => typeof x === 'string', isDef: x => x != null,
  isUnDef: x => x == null, isArray: Array.isArray, isNumber: x => typeof x === 'number',
  isObject: x => x !== null && typeof x === 'object', isFunction: x => typeof x === 'function',
  stringify: JSON.stringify, print: x => output.push(x), logWarn: x => warnings.push(x),
  java: { lang: { System: { console: () => null } } }, ow: { oJob: { output: x => output.push(x) } }
});
vm.runInContext(common, c);
const extract = name => { const start = con.indexOf('  function ' + name + '('); assert.ok(start >= 0); return con.slice(start, con.indexOf('\n  }', start) + 4); };
vm.runInContext(extract('unwrapSingleMarkdownCodeBlock'), c);
for (const lang of ['mermaid', 'leaflet', 'chart', 'chart.js', 'chartjs', 'oafPrintChart']) {
  const fence = '```' + lang + '\nexample\n```';
  assert.equal(c.unwrapSingleMarkdownCodeBlock(fence), fence);
}
assert.equal(c.__miniAUnwrapAnswer('```markdown\r\n# Title\r\n```'), '# Title');
assert.equal(c.__miniAUnwrapAnswer('```json\n{"ok":true}\n```', false), '{"ok":true}');
const multiple = '```js\nfirst\n```\n\nText\n\n```js\nlast\n```';
assert.equal(c.__miniAUnwrapAnswer(multiple), multiple);
assert.equal(c.__miniAUnwrapAnswer('```markdown\n```mermaid\ngraph TD\n```\n```'), '```markdown\n```mermaid\ngraph TD\n```\n```');
assert.equal(c.__miniAUnwrapAnswer('````markdown\n```mermaid\ngraph TD\n```\n````'), '```mermaid\ngraph TD\n```');
assert.equal(c.__miniAFinalResult(0, 'old'), 0);
assert.equal(c.__miniAFinalResult('', 'old'), '');
const tail = job.slice(job.indexOf('    var originalGoalText =')).replace(/^    /gm, '');
let result, closed = 0, hookOutput = [], blocked = false;
c.runHooks = () => ({ outputs: hookOutput, blocked });
c._ma = { init(args) { assert.equal(args.goal, 'Prefix: question'); }, start: () => result,
  getOrigAnswer: () => 'retained answer', _stopAgentResources() { closed++; } };
function run(args = {}) { output.length = 0; c.args = { goal: 'question', goalprefix: 'Prefix: ', ...args }; vm.runInContext('(function(){' + tail + '})()', c); }
run(); assert.deepEqual(output, ['retained answer']); assert.equal(closed, 1);
result = { answer: 42 }; run(); assert.deepEqual(output, [result]);
result = 'answer'; c._ma._streamOutputProduced = true; run({ usestream: true }); assert.deepEqual(output, []);
c._ma._streamOutputProduced = false; run({ usestream: true }); assert.deepEqual(output, ['answer']);
run({ outfile: '/fixture' }); assert.deepEqual(output, []);
hookOutput = [{ hookName: 'context', output: 'extra' }]; run(); assert.equal(c.args.hookcontext, '[Hook context] extra');
blocked = true; const before = closed; run(); assert.equal(closed, before); assert.deepEqual(output, []);
// Shared loader retains console diagnostics and hook metadata, plus boolean aliases.
const defs = {
  'valid.yaml': { event: 'before_tool', command: 'fixture', injectOutput: 'YES', failBlocks: 'on', toolFilter: 'read, WRITE', env: { COUNT: 2 } },
  'bad.yaml': { event: 'typo', command: 'fixture' }, 'empty.json': { event: 'before_goal' }
};
c.io = { fileExists: () => true, fileInfo: p => ({ isDirectory: true, canonicalPath: p }), listFiles: () => ({ files: Object.keys(defs).map(filename => ({ filename })) }),
  readFileYAML: p => defs[p.split('/').pop()], readFileJSON: p => defs[p.split('/').pop()] };
const hooks = { before_tool: [], before_goal: [] }; c.__miniALoadHooksFromDir('/fixture', hooks);
assert.equal(hooks.before_tool.length, 1); assert.equal(warnings.filter(x => /invalid or missing|no command/.test(x)).length, 2);
assert.equal(hooks.before_tool[0].file, '/fixture/valid.yaml');
c.$sh = command => ({ timeout(n) { assert.equal(n, 5000); return this; }, envs(env) { executed.push({ command, env }); return this; }, get() { return { exitcode: 1, stdout: ' context ', stderr: 'failed' }; } });
let r = c.__miniARunHooks(hooks, 'before_tool', { MINI_A_TOOL: 'READ' });
assert.equal(r.blocked, true); assert.equal(r.outputs[0].output, 'context'); assert.equal(executed[0].env.COUNT, '2');
c.__miniARunHooks(hooks, 'before_tool', { MINI_A_TOOL: 'other' }); assert.equal(executed.length, 1);
c.$sh = () => { throw Error('timeout'); }; assert.equal(c.__miniARunHooks(hooks, 'before_tool', {}).blocked, true);
// Console argument building applies the same prefix without mutating session settings.
Object.assign(c, { processFileAttachments: x => x, extraCLIArgs: {}, sessionOptions: { goalprefix: 'Prefix: ' }, internalParameters: { goalprefix: true }, sessionExplicitOptions: {}, merge: Object.assign });
vm.runInContext(extract('buildArgs'), c);
assert.equal(c.buildArgs(' question ').goal, 'Prefix: question'); assert.equal(c.buildArgs(' question ').goal, 'Prefix: question');
console.log('Entry-point prefix, output, fence and hook regressions passed.');
