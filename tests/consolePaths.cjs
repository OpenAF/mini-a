// Exercise production console handlers without starting a model or interactive terminal.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('mini-a-con.js', 'utf8');
function extract(name) {
  const start = source.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n  }', start) + 4;
  return source.slice(start, end);
}
const calls = [], output = [];
const wm = {
  read: p => { calls.push(['read', p]); return { body: 'body' }; },
  write: (p, body) => { calls.push(['write', p, body]); return { ok: true }; },
  move: (a, b) => { calls.push(['move', a, b]); return { ok: true }; },
  attach: (name, cfg) => { calls.push(['attach', name, cfg.root]); return { ok: true }; },
  graph: (sub, p) => { calls.push(['graph', sub, p.from, p.to]); return {}; }
};
const ctx = vm.createContext({
  isString: x => typeof x === 'string', isObject: x => x !== null && typeof x === 'object',
  isMap: x => x !== null && typeof x === 'object', isArray: Array.isArray,
  isUnDef: x => x === undefined, isFunction: x => typeof x === 'function', isDef: x => x !== undefined,
  __: undefined, global: {}, sessionOptions: { usewiki: true, wikiaccess: 'rw' },
  activeAgent: { _wikiManager: wm }, getConsoleWikiManager: () => wm,
  colorifyText: x => x, ansiColor: () => '', print: x => output.push(x), printErr: x => output.push(x),
  printTree: x => x, errorColor: '', hintColor: '', successColor: '', accentColor: '', promptColor: '',
  __miniAErrMsg: e => e.message, merge: Object.assign, toBoolean: x => x === true || x === 'true',
  loadLib: () => {}, MiniAIngest: function(args) { this.run = () => { calls.push(['ingest', args.ingestsource, args.ingestsection, args.ingestsourceid]); return { ok: true }; }; }
});
for (const name of ['parseConsolePathArgs', 'consolePathValue', 'printWiki', 'printGraph', 'printIngest', 'consolePathCompletion', 'quoteConsolePath']) vm.runInContext(extract(name), ctx);
function run(code, expected) { calls.length = 0; vm.runInContext(code, ctx); assert.deepEqual(calls, expected); }
run(`printIngest('"/tmp/My  Docs" "Team Docs" sourceid="My Origin" dryrun')`, [['ingest', '/tmp/My  Docs', 'Team Docs', 'My Origin']]);
run(`printIngest('"unterminated')`, []);
run(`printIngest('/tmp/my docs extra section')`, []);
run(`printWiki('read "Team  Docs/a file.md"')`, [['read', 'Team  Docs/a file.md']]);
run(`printWiki('read Team  Docs/a file.md')`, [['read', 'Team  Docs/a file.md']]);
run(String.raw`printWiki('write "Team Docs/a file.md" It\'s  content')`, [['write', 'Team Docs/a file.md', "It's  content"]]);
run(`printWiki('move "old file.md" "new file.md"')`, [['move', 'old file.md', 'new file.md']]);
run(`printWiki('move "old file.md" "new file.md" extra')`, []);
run(`printWiki('attach team root="/tmp/My Wiki.zip"')`, [['attach', 'team', '/tmp/My Wiki.zip']]);
run(`printGraph('path "first page.md" "second page.md"')`, [['graph', 'path', 'first page.md', 'second page.md']]);
run(`printGraph('path "unterminated')`, []);
assert.equal(ctx.consolePathValue('"/tmp/My  File.md"'), '/tmp/My  File.md');
assert.deepEqual(Array.from(ctx.parseConsolePathArgs(String.raw`C:\Docs\file.md /tmp/My\ File.md`).argv), ['C:\\Docs\\file.md', '/tmp/My File.md']);
// Run the actual save branch including its exception handler.
const saveStart = source.indexOf('        try {\n          // Parse filename');
const saveEnd = source.indexOf('\n        continue', saveStart);
ctx.lastOrigResult = 'saved body'; ctx.command = 'save "/tmp/My  Response.md"'; ctx.commandLower = ctx.command.toLowerCase();
ctx.io = { writeFileString: (p, body) => calls.push(['save', p, body]) };
calls.length = 0; vm.runInContext(source.slice(saveStart, saveEnd), ctx);
assert.deepEqual(calls, [['save', '/tmp/My  Response.md', 'saved body']]);
// Attachments use actual filesystem reads from a temporary directory containing spaces.
const os = require('node:os'), path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mini a files '));
try {
  const file = path.join(dir, 'a  file.md'); fs.writeFileSync(file, 'ATTACHED CONTENT');
  ctx.io = { fileExists: fs.existsSync, fileInfo: p => ({ isFile: fs.statSync(p).isFile() }), readFileString: p => fs.readFileSync(p, 'utf8') };
  ctx.countImmediateBackslashes = (text, pos) => { let n = 0; while (pos > 0 && text[--pos] === '\\') n++; return n; };
  ctx.canStartInlineShortcut = (text, pos) => pos === 0 || /\s/.test(text[pos - 1]);
  for (const name of ['processFileAttachments']) vm.runInContext(extract(name), ctx);
  assert.match(ctx.processFileAttachments('Read @"' + file + '".'), /ATTACHED CONTENT/);
  assert.match(ctx.processFileAttachments("Read @'" + file + "'."), /ATTACHED CONTENT/);
  assert.match(ctx.processFileAttachments('Read @' + file.replace(/ /g, '\\ ')), /ATTACHED CONTENT/);
  assert.equal(ctx.processFileAttachments('Read @"unfinished path'), 'Read @"unfinished path');
} finally { fs.rmSync(dir, { recursive: true }); }
console.log('Console path handler checks passed');

const complete = ctx.consolePathCompletion('old.md "Team  Docs/a f');
assert.equal(complete.offset, 7);
assert.equal(complete.token, 'Team  Docs/a f');
assert.deepEqual(Array.from(complete.before), ['old.md']);
assert.equal(ctx.consolePathCompletion('out="/tmp/My File').token, 'out=/tmp/My File');
assert.equal(ctx.quoteConsolePath('/tmp/My File.md'), '"/tmp/My File.md"');
// Execute the production completer callback with simulated JLine candidates.
const completionStart = source.indexOf('function(buf, cursor, candidates) {');
const completionEnd = source.indexOf('\n        })', completionStart);
ctx.getFileCompletions = prefix => { calls.push(['prefix', prefix]); return ['/tmp/My  Docs/a file.md']; };
ctx.getWikiPageCompletions = prefix => { calls.push(['prefix', prefix]); return ['Team  Docs/a file.md']; };
ctx.wikiReadPathCommands = { read: true, write: true, move: true };
ctx.statsCompletions = ['out='];
ctx.complete = vm.runInContext('(' + source.slice(completionStart, completionEnd) + '\n})', ctx);
for (const [line, prefix, offset, candidate] of [
  ['/ingest "/tmp/My  Docs/a', '/tmp/My  Docs/a', 8, '"/tmp/My  Docs/a file.md"'],
  ['/stats out="/tmp/My  Docs/a', '/tmp/My  Docs/a', 7, 'out="/tmp/My  Docs/a file.md"'],
  ['Read @"/tmp/My  Docs/a', '/tmp/My  Docs/a', 6, '"/tmp/My  Docs/a file.md"'],
  ['/wiki move "old file.md" "Team  Docs/a', 'Team  Docs/a', 25, '"Team  Docs/a file.md"']
]) {
  const items = []; calls.length = 0;
  const position = ctx.complete(line, line.length, { add: x => items.push(x), isEmpty: () => !items.length });
  assert.deepEqual(calls, [['prefix', prefix]]);
  assert.equal(position, offset);
  assert.deepEqual(items, [candidate]);
}
console.log('Console completion callback checks passed');
// Interactive recovery choices: bare /ingest, exact resume command, explicit
// discard confirmation, and independent continuation of the requested source.
vm.runInContext(extract('printIngestRecovery'), ctx);
let answers = [], recoveryCalls = [];
const recoveryEntry = { id: 'scope-id', scopeId: 'scope', phase: 'prepared',
  scope: { source: '/tmp/Original Docs', section: 'Original Section', sourceid: 'logical origin' },
  resume_command: '/ingest recovery resume scope-id', discard_command: '/ingest recovery discard scope-id' };
ctx.con = { readLinePrompt: () => answers.shift() };
ctx.MiniAIngest = function(args) {
  this.manageRecovery = (action, id, confirmed) => {
    recoveryCalls.push([action, id, confirmed]);
    return { ok: true, recoveries: [recoveryEntry] };
  };
  this.run = () => { recoveryCalls.push(['run', args.ingestsource, args.ingestindependent]); return { ok: true }; };
};
answers = ['cancel']; recoveryCalls = []; ctx.printIngest('');
assert.deepEqual(recoveryCalls, [['list', undefined, undefined]]);
assert.ok(output.includes('  Resume: /ingest recovery resume scope-id'));
recoveryCalls = []; ctx.printIngest('recovery resume scope-id');
assert.deepEqual(recoveryCalls, [['list', undefined, undefined], ['resume', 'scope-id', false]]);
answers = ['no']; recoveryCalls = []; ctx.printIngest('recovery discard scope-id');
assert.deepEqual(recoveryCalls, [['list', undefined, undefined]]);
answers = ['discard scope-id']; recoveryCalls = []; ctx.printIngest('recovery discard scope-id');
assert.deepEqual(recoveryCalls, [['list', undefined, undefined], ['discard', 'scope-id', true]]);
answers = ['independent']; recoveryCalls = [];
ctx.printIngestRecovery({ ingestsource: '/tmp/New Docs' }, [], true);
assert.deepEqual(recoveryCalls, [['list', undefined, undefined], ['run', '/tmp/New Docs', true]]);
answers = ['independent', '"/tmp/New Docs" "New Section"']; recoveryCalls = []; ctx.printIngest('');
assert.deepEqual(recoveryCalls, [['list', undefined, undefined], ['run', '/tmp/New Docs', true]]);
console.log('Interactive recovery choices passed');
ctx.MiniAIngest = function(args) {
  this.manageRecovery = action => { recoveryCalls.push([action]); return { ok: true, recoveries: [recoveryEntry] }; };
  this.run = () => {
    recoveryCalls.push(['run', args.ingestsource, args.ingestsection, args.ingestindependent === true]);
    return args.ingestindependent ? { ok: true } : { ok: false, recovery_pending: true, reason: 'recovery-scope-mismatch' };
  };
};
answers = ['independent']; recoveryCalls = []; ctx.printIngest('"/tmp/New Docs" "New Section"');
assert.deepEqual(recoveryCalls, [
  ['run', '/tmp/New Docs', 'New Section', false], ['list'], ['run', '/tmp/New Docs', 'New Section', true]
]);
answers = []; recoveryCalls = []; ctx.printIngest('"/tmp/New Docs" "New Section" dryrun');
assert.deepEqual(recoveryCalls, [['run', '/tmp/New Docs', 'New Section', false]], 'dry-run does not prompt for mutation');
console.log('Blocked ingestion recovery flow passed');

// Absorption dispatch preserves quoted specification paths and exact plan IDs.
ctx.af = { toYAML: JSON.stringify };
ctx.MiniAAbsorb = function(args) {
  this.run = () => { calls.push(['absorb', args.absorbop, args.absorbspec, args.absorbplan]); return { ok: true, plans: ['abc123'] }; };
};
vm.runInContext(extract('printAbsorb'), ctx);
run(`printAbsorb('plan "/tmp/My Sources.json"')`, [['absorb', 'plan', '/tmp/My Sources.json', undefined]]);
run(`printAbsorb('apply abc123')`, [['absorb', 'apply', undefined, 'abc123']]);
run(`printAbsorb('resume abc123')`, [['absorb', 'resume', undefined, 'abc123']]);
run(`printAbsorb('show abc123 extra')`, []);
run(`printAbsorb('plan "unterminated')`, []);
for (const [line, expected, offset] of [
  ['/absorb p', ['plan'], 8],
  ['/absorb plan "/tmp/My  Docs/a', ['"/tmp/My  Docs/a file.md"'], 13],
  ['/absorb apply abc', ['abc123'], 14],
  ['/absorb resume abc', ['abc123'], 15],
  ['/absorb status ', [], -1]
]) {
  const items = [];
  const position = ctx.complete(line, line.length, { add: x => items.push(x), isEmpty: () => !items.length });
  assert.deepEqual(items, expected);
  assert.equal(position, offset);
}
assert.match(source, /printAbsorb\(commandLower === "absorb"/);
console.log('Absorption dispatch and nested completion checks passed');
