// Exercise the actual preparation methods with deterministic worker scheduling.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = fs.readFileSync('mini-a.js', 'utf8');
let clock = 1000, pending = [], clients = [], events = [], stamps = {}, wikiCloses = 0;
function MiniA() { this._mcpConnections = {}; }
function File(path) { this.path = path; this.getCanonicalPath = () => path; this.lastModified = () => stamps[path] || 1; this.length = () => 1; }
function Latch(n) { this.getCount = () => n; this.countDown = () => n--; this.await = () => { if (n) pending.shift()(); return n === 0; }; }
function Atomic(value) { this.compareAndSet = (old, next) => value === old && (value = next, true); }
function validation(value) {
  let valid = true;
  const v = { isBoolean() { valid = typeof value === 'boolean'; return v; }, isString() { valid = typeof value === 'string'; return v; }, isNumber() { valid = typeof value === 'number'; return v; }, default(other) { return valid && value !== undefined && value !== null ? value : other; } };
  return v;
}
const context = {
  MiniA, __: undefined, now: () => clock,
  isDef: v => v !== undefined && v !== null, isUnDef: v => v === undefined || v === null,
  isObject: v => !!v && typeof v === 'object', isMap: v => !!v && typeof v === 'object' && !Array.isArray(v),
  isArray: Array.isArray, isFunction: v => typeof v === 'function', isString: v => typeof v === 'string', isNumber: v => typeof v === 'number',
  toBoolean: v => v == null ? v : v === true || v === 'true',
  merge: (...values) => Object.assign({}, ...values), stringify: JSON.stringify, jsonParse: JSON.parse,
  sha384: value => crypto.createHash('sha384').update(value).digest('hex'), _$: validation,
  getEnv() {}, getOPackPath: () => '/bundle',
  af: { fromJSSLON: v => typeof v === 'string' ? JSON.parse(v) : v },
  java: { io: { File }, util: { concurrent: { CountDownLatch: Latch, TimeUnit: { MILLISECONDS: 1 }, atomic: { AtomicBoolean: Atomic } } } },
  $doV(fn) { pending.push(fn); },
  $mcp(config) {
    const c = { config, initialized: 0, closed: 0, catalogs: 0,
      initialize() { this.initialized++; clock += 200; if (config.url === 'fail') throw Error('handshake failed'); },
      listTools() { this.catalogs++; return { tools: [{ name: 'current-tool' }] }; },
      callTool(name, args) { config.preFn?.(name, args); config.posFn?.(name, args, {}); return 'result'; },
      destroy() { this.closed++; }
    };
    clients.push(c); return c;
  }
};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('MiniA.prepareWebSession ='), source.indexOf('MiniA.prototype._initWiki =')), context);
MiniA.prototype._normalizeMcpJobPaths = mcp => ({ mcp });
MiniA.prototype.fnI = (level, message) => events.push([level, message]);
MiniA.prototype._trace = (kind, data) => events.push([kind, data]);
function manager(root) {
  return { _backendType: 'fs', _mounts: [], _getIndexRoot: () => root, _getGraphPath: () => root + '/graph', close() { wikiCloses++; } };
}
MiniA.prototype._initWiki = args => args.usewiki ? manager(args.wikiroot) : undefined;
MiniA.prototype._initSkillWiki = (args, prepareOnly, report, primary) => args.useskillswiki ? primary || manager(args.skillwikiroot) : undefined;
const drain = () => { while (pending.length) pending.shift()(); };
const config = { type: 'remote', url: 'http://fixture', id: 'one' };
const args = { usewiki: true, wikiroot: '/wiki', useskillswiki: true, mcp: JSON.stringify([config]) };
const a = new MiniA();
a.prepareSession(args);
assert.equal(pending.length, 2, 'wiki and MCP work run independently');
assert.equal(a._wikiManager, undefined, 'preparation does not bind session state');
drain();
assert.equal(clients[0].initialized, 1);
assert.equal(clients[0].catalogs, 0, 'catalog remains fresh at submission');
const preparedWiki = a._startupEntries[0].wiki;
a._beginStartupTiming({ __startupSubmittedAt: clock });
assert.equal(a._adoptStartupWiki(args), true);
assert.equal(a._wikiManager, preparedWiki);
assert.equal(a._skillWikiManager, preparedWiki, 'shared wiki preserves identity');
let calls = 0;
const adopted = a._startupMcpClient(config, { preFn() { calls++; }, posFn() { calls++; } });
assert.equal(adopted, clients[0]);
assert.equal(adopted.__miniAPreinitialized, true);
assert.equal(adopted.listTools().tools[0].name, 'current-tool');
adopted.callTool('current-tool', {});
assert.equal(calls, 2, 'callbacks attach to this agent at adoption');
a._closeStartupPreparation();
assert.equal(adopted.closed, 0, 'adopted transport survives speculative cleanup');
assert.equal(a.getStartupTimings().mcp_reused, 1);
assert.equal(a.getStartupTimings().wiki_reused, true);

const changed = new MiniA(); changed.prepareSession(args);
assert.equal(changed._adoptStartupWiki({ ...args, fileallow: ['/other'] }), false);
assert.equal(changed._startupEntries[0].closed, true, 'permission changes cancel old wiki');
drain(); changed._closeStartupPreparation();
assert.equal(clients.at(-1).closed, 1);
const stale = new MiniA(); stale.prepareSession(args); drain();
stamps['/wiki/graph/graph.json'] = 2;
assert.equal(stale._adoptStartupWiki(args), false, 'changed graph/publication rebuilds');
stale._closeStartupPreparation();
stamps = {};
const retired = new MiniA(); retired.prepareSession(args); retired._resourcesStopped = true; retired._closeStartupPreparation(); drain();
assert.equal(retired._startupEntries.every(e => e.disposed), true, 'late workers cannot leak resources after close');
retired._closeStartupPreparation();
const rw = new MiniA(); rw.prepareSession({ ...args, wikiaccess: 'rw' }); drain();
assert.equal(rw._startupEntries.some(e => e.kind === 'wiki'), false, 'writable wiki bootstrap stays at submission'); rw._closeStartupPreparation();
const disabled = new MiniA(); disabled.prepareSession({ ...args, sessionprewarm: false });
assert.equal(disabled._startupEntries, undefined);
const local = new MiniA(); local.prepareSession({ mcp: JSON.stringify([{type:'ojob',options:{job:'tools.yaml'}}, {type:'dummy'}, {type:'remote',url:'interactive',auth:{grantType:'authorization_code'}}]) });
assert.equal(pending.length, 0, 'local/session-bound and interactive-auth MCPs keep foreground setup');
const failure = new MiniA(); failure.prepareSession({mcp: JSON.stringify({type:'remote',url:'fail'})}); drain();
const retry = failure._startupMcpClient({type:'remote',url:'fail'}, {});
assert.equal(retry.initialized, 0, 'failed preparation creates a fresh foreground client');
failure._closeStartupPreparation(); retry.destroy();
const different = new MiniA(); different.prepareSession({mcp:JSON.stringify(config)});
const fresh = different._startupMcpClient({...config,url:'new-endpoint'}, {});
assert.equal(pending.length, 1, 'changed MCP does not wait for old endpoint');
different._closeStartupPreparation(); drain(); fresh.destroy();

// STDIO preparation uses the intended session directory without changing globals.
const stdio = new MiniA();
context.__flags = {JSONRPC:{cmd:{defaultDir:'/old'}}};
const stdioConfig = {cmd:'fixture-server'};
stdio.prepareSession({mcp:JSON.stringify(stdioConfig),_agentBaseDir:'/intended'}); drain();
assert.equal(clients.at(-1).config.pwd,'/intended');
assert.equal(context.__flags.JSONRPC.cmd.defaultDir,'/old');
context.__flags.JSONRPC.cmd.defaultDir = '/intended';
const stdioClient = stdio._startupMcpClient(stdioConfig,{});
assert.equal(stdioClient.__miniAPreinitialized,true);
stdio._closeStartupPreparation(); stdioClient.destroy();
const newDir = new MiniA(); newDir.prepareSession({mcp:JSON.stringify(stdioConfig),_agentBaseDir:'/intended'}); drain();
context.__flags.JSONRPC.cmd.defaultDir = '/changed';
assert.equal(newDir._startupMcpClient(stdioConfig,{}).__miniAPreinitialized,undefined,'Changed effective cwd prevents adoption');
newDir._closeStartupPreparation();

// First auxiliary-model dispatch and main-model dispatch are separate, reset per goal.
const timing = new MiniA(); timing._beginStartupTiming({__startupSubmittedAt:clock});
const decision = timing._instrumentStartupLlm({decideWithStats(){ clock += 500; return 'choice'; }}, 'decision');
const main = timing._instrumentStartupLlm({promptWithStats(){return 'answer';}}, 'main');
clock += 20; decision.decideWithStats(); main.promptWithStats();
assert.equal(timing.getStartupTimings().first_provider_ms, 20);
assert.equal(timing.getStartupTimings().first_provider_role, 'decision');
assert.equal(timing.getStartupTimings().first_main_provider_ms, 520);
const copy = timing.getStartupTimings(); copy.phases_ms.wrong = 1;
assert.equal(timing.getStartupTimings().phases_ms.wrong, undefined);
timing._beginStartupTiming({__startupSubmittedAt:clock}); clock += 7; main.promptWithStats();
assert.equal(timing.getStartupTimings().first_provider_ms, 7);
assert.equal(timing.getStartupTimings().first_provider_role, 'main');
console.log('Startup preparation ownership, freshness, failure, cancellation and timing checks passed.');
