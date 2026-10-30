// Production method regressions with deterministic clocks; no provider calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('mini-a.js', 'utf8');
const decision = fs.readFileSync('mini-a-decision.js', 'utf8');
const wiki = fs.readFileSync('mini-a-wiki.js', 'utf8');
let clock = 0;
const context = {
  MiniA: function() {}, MiniAWikiManager: function() {}, __: undefined,
  isObject: v => v !== null && typeof v === 'object',
  isMap: v => v !== null && typeof v === 'object' && !Array.isArray(v),
  isFunction: v => typeof v === 'function', isString: v => typeof v === 'string',
  isNumber: v => typeof v === 'number', isArray: Array.isArray,
  isDef: v => v !== undefined && v !== null, isUnDef: v => v === undefined || v === null,
  stringify: JSON.stringify, merge: (...v) => Object.assign({}, ...v),
  toBoolean: v => v === true, sleep: n => { clock += n; },
  Date: { now: () => clock }, now: () => clock, console,
  MiniADecision: { digest: v => v, sanitize: () => ({code:'fixture-error'}) },
  __miniAWikiNormalizePath: v => v,
  java: { lang: { String: function(s) { this.getBytes = () => Buffer.from(s); } } }
};
vm.createContext(context);
function method(text, owner, name) {
  const start = text.indexOf(owner + '.prototype.' + name + ' =');
  assert.ok(start >= 0, name);
  const end = text.indexOf('\n' + (owner === 'MiniA' && text === decision ? '  ' : '') + '}', start) + (text === decision ? 4 : 2);
  vm.runInContext(text.slice(start, end), context);
}
for (const name of ['_categorizeError','_withRateLimitedCall','_withExponentialBackoff']) method(source,'MiniA',name);
const a = new context.MiniA();
a._isContextOverflowError = () => false;
a._getTotalTokens = stats => stats.total_tokens || 0;
let calls = 0, active = 0, used = [];
const controls = {beforeCall() { active++; return true; }, afterCall(tokens) { active--; used.push(tokens); }};
for (const message of ['tool call validation failed: missing query', 'tool_use_failed', "attempted to call tool 'json'"]) {
  calls = 0; clock = 0;
  assert.throws(() => a._withExponentialBackoff(() => a._withRateLimitedCall(() => {
    calls++; throw Error(message);
  }, controls)), new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(calls, 1); assert.equal(clock, 0); assert.equal(active, 0);
}
calls = 0; used = [];
const response = a._withExponentialBackoff(() => a._withRateLimitedCall(() => {
  calls++; if (calls < 3) throw Error('connection closed'); return {stats:{total_tokens:9}};
}, controls));
assert.equal(response.stats.total_tokens, 9);
assert.deepEqual(used, [0,0,9]); assert.equal(active, 0);
let dispatched = false;
assert.throws(() => a._withRateLimitedCall(() => { dispatched = true; }, {beforeCall:()=>false, afterCall:()=>assert.fail('unadmitted')}), /cancelled/);
assert.equal(dispatched, false);
a.state = 'stop';
assert.throws(() => a._withRateLimitedCall(() => { dispatched = true; }, controls), /cancelled/);
assert.equal(active, 0); assert.equal(dispatched, false); a.state = 'running';

// Exercise the actual foreground callback, not just the limiter's optional API.
const begin = source.indexOf('    var addCall = () => {');
const end = source.indexOf('    var registerCallUsage', begin);
const foreground = vm.runInContext('(function(rateLimiter) {' + source.slice(begin,end) + '; return addCall; })', context);
const addCall = foreground.call(a, { beforeCall(cancelled) { a._stopRequested = true; return !cancelled(); } });
assert.throws(addCall, /cancelled/); a._stopRequested = false;

method(decision,'MiniA','_assessComplexityByDecision');
a._decisionFallback = () => {}; a._trace = () => {};
calls = 0;
a._decision = { _config:{model:'fixture'}, isConfigured:()=>true, bounded(ms) {
  assert.equal(ms, 5000); return {decide() { calls++; throw Error('timeout'); }};
}};
for (let i=0;i<3;i++) assert.equal(a._assessComplexityByDecision('goal','medium',{}), undefined);
assert.equal(calls, 1, 'failure shared across startup consumers');
a._assessComplexityByDecision('next goal','medium',{}); assert.equal(calls, 2);
a._decisionComplexity = undefined; // init starts a new run, even for the same goal.
a._assessComplexityByDecision('next goal','medium',{}); assert.equal(calls, 3);
a._decision._config.model = 'changed'; a._assessComplexityByDecision('next goal','medium',{}); assert.equal(calls, 4);

const helper = wiki.indexOf('function __miniAWikiDeadlineOptions');
vm.runInContext(wiki.slice(helper, wiki.indexOf('\n}\n',helper)+3),context);
for (const name of ['read','agenticRead','retrieve']) method(wiki,'MiniAWikiManager',name);
const w = new context.MiniAWikiManager();
w._maybeRefreshArtifactBundle = () => {}; w._refreshRetrievalMode = () => {};
w.parseFrontmatter = raw => ({body:raw,meta:{}}); w._extractLinkEntries = () => [];
w._decorateEntry = v => v; w._agenticPath = v => v;
clock = 0; let budget;
w._backend = {read(path,opts) { budget = opts; return 'text'; }};
w.read('page.md',{maxMillis:100}); assert.equal(budget.__deadline,100); assert.equal(budget.maxMillis,100);
clock = 40; w.read('page.md',{__deadline:100}); assert.equal(budget.maxMillis,60);
w._backend.read = () => assert.fail('expired read must not dispatch');
clock = 100; assert.equal(w.read('page.md',{__deadline:100}), undefined);
clock = 0; w.read = (path,opts) => { budget=opts; return undefined; };
w.agenticRead('page.md',{maxMillis:100}); assert.equal(budget.__deadline,100);
const mounted = new context.MiniAWikiManager();
mounted._maybeRefreshArtifactBundle = () => {};
mounted._resolveMountPath = () => ({name:'mount',localPath:'page.md',mount:{manager:w}});
mounted.read('@mount/page.md',{__deadline:100}); assert.equal(budget.__deadline,100);

clock = 0; let reads = 0;
w._retrievalEngineFor = () => null;
w.agenticSearch = (query,opts) => { assert.equal(opts.maxMillis,100); clock+=30; return {results:[{ref:'one',path:'one'},{ref:'two',path:'two'}]}; };
w._rankRetrievalCandidates = results => results.map(candidate => ({candidate,score:1,components:{}}));
w.agenticRead = (path,opts) => {
  reads++; assert.equal(opts.maxMillis,70); assert.equal(opts.__deadline,100); clock+=80;
  return {body:'evidence',ref:path,path};
};
w._agenticLog = () => {};
const result = w.retrieve('query',{maxMillis:100});
assert.equal(reads,1); assert.equal(result.evidence.length,1);
assert.equal(result.outcome,'partial'); assert.ok(result.stopReasons.includes('request-deadline-exhausted'));
console.log('PASS latency: retry recovery, cancellation/accounting, complexity failure cache, wiki deadlines');

// Init and execution share a result; the next submission retries a failed one.
const runStart = source.indexOf('MiniA.prototype.startUnlocked = function(args) {');
const runBody = source.indexOf('\n',runStart)+1;
const runEnd = source.indexOf('    if (!this._startupTimingPending',runBody);
const beginRun = vm.runInContext('(function(args) {' + source.slice(runBody,runEnd) + '})',context);
const runArgs = {goal:'same'};
a._decisionComplexityArgs = runArgs; a._decisionComplexity = {failed:true};
beginRun.call(a,runArgs); assert.equal(a._decisionComplexity.failed,true);
a._decisionComplexityRunComplete = true;
beginRun.call(a,runArgs); assert.equal(a._decisionComplexity,undefined);
console.log('PASS complexity cache submission lifecycle');
