// Execute the actual YAML route bodies with deterministic scheduling and agent fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const yaml = fs.readFileSync('mini-a-web.yaml', 'utf8');
const route = name => yaml.split('((uri          )): /' + name + '\n')[1].split('((execURI      )): | #js\n')[1].split(/\n(?=[^ \n])/)[0].replace(/^    /gm, '');
let serial = 0, starts = 0, closes = 0, fail = false, scheduleFail = false;
let finalResult = { answer: 'fixture answer' };
const pending = [], agents = [];
class Agent {
  constructor() { agents.push(this); this.history = []; }
  setInteractionFn(fn) { this.fn = fn; }
  init(args) { this.args = args; if (fail) throw Error('init fixture failure'); }
  start(args) {
    if (this.history.length === 0) assert.equal(args, this.args, 'init and start share complete args');
    this.lastArgs = args; starts++; this.history.push({ tool: 'fixture result' });
    return finalResult;
  }
  _stopAgentResources() { closes++; }
}
const g = { __busy: {}, __runTokens: {}, __conversations: {}, __res: {}, __lastActivity: {}, __logpromptheaders: [],
  __memorysessionheader: 'x-session', __historypath: '/fixture',
  __sessionLock: { lock() {}, unlock() {} }, maArgs: { goalprefix: 'Prefix: ', usememory: true },
  _mini_a_web_checkToken: () => true, _mini_a_web_isValidUuid: () => true,
  _mini_a_web_loadFile: x => x };
const c = { global: g, MiniA: Agent, __: undefined, genUUID: () => 'token-' + ++serial,
  isDef: x => x !== undefined && x !== null, isUnDef: x => x === undefined || x === null,
  isMap: x => x !== null && typeof x === 'object' && !Array.isArray(x), isObject: x => x !== null && typeof x === 'object',
  isNumber: x => typeof x === "number", isString: x => typeof x === 'string', isFunction: x => typeof x === 'function', isArray: Array.isArray,
  toBoolean: x => x === true, merge: (a,b) => ({...a,...b}), jsonParse: JSON.parse, stringify: JSON.stringify,
  af: { fromJSSLON: JSON.parse, toSLON: JSON.stringify }, ow: { server: { httpd: { reply: x => x } } },
  log() {}, logErr() {}, logWarn() {}, printErr(e) { throw e; }, $err() {}, __miniAErrMsg: String,
  $doV(fn) { if (scheduleFail) throw Error('schedule failed'); pending.push(fn); return { catch() {} }; } };
vm.createContext(c);
vm.runInContext(fs.readFileSync('mini-a-common.js', 'utf8'), c);
const helpers = yaml.slice(yaml.indexOf('    global._mini_a_web_reserve ='), yaml.indexOf('    global.__webtoken =')).replace(/^    /gm,'');
vm.runInContext(helpers,c);
function call(name, data) { c.request = { files: { postData: JSON.stringify(data) }, header: { 'x-session': ' selected ' } }; return vm.runInContext('(function(){'+route(name)+'})()',c); }
const browser = { viewportWidth: 777 };
assert.equal(call('prompt',{uuid:'a',prompt:'first\r\nline',browserContext:browser}).uuid,'a');
assert.equal(call('prompt',{uuid:'a',prompt:'overlap'}).error,'session busy');
assert.equal(call('clear',{uuid:'a',force:true}).error,'session busy');
assert.equal(call('load-history',{uuid:'a',history:[]}).error,'session busy');
call('prompt',{uuid:'b',prompt:'independent'});
assert.equal(pending.length,2); pending.shift()(); pending.shift()();
assert.equal(starts,2); assert.equal(g.__busy.a,undefined);
assert.equal(agents[0].args.goal,'Prefix: first\nline');
assert.equal(agents[0].args.memorysessionid,'selected');
assert.equal(agents[0].args.browsercontext.viewportWidth,777);
call('prompt',{uuid:'a',prompt:'second',browserContext:{viewportWidth:999}}); pending.shift()();
assert.equal(agents.length,2); assert.equal(agents[0].history.length,2);
assert.equal(agents[0].lastArgs.browsercontext,undefined);
call('clear',{uuid:'a',force:true}); assert.equal(closes,1);
call('clear',{uuid:'a',force:true}); assert.equal(closes,1);
fail=true; call('prompt',{uuid:'failed',prompt:'x'}); pending.shift()();
assert.equal(g.__busy.failed,undefined); assert.equal(g.__conversations.failed,undefined); assert.equal(closes,2);
fail=false; scheduleFail=true; call('prompt',{uuid:'schedule',prompt:'x'}); assert.equal(g.__busy.schedule,undefined);
const t=g._mini_a_web_reserve('owner'); g._mini_a_web_release('owner','wrong'); assert.equal(g.__busy.owner,true); g._mini_a_web_release('owner',t);
console.log('Web session route checks passed.');
// Expiry cannot remove a reserved session, and history retention still closes resources.
const cleanup = yaml.split('- name : Periodic cleanup of old sessions')[1].split('  exec : | #js\n')[1].split('\n#')[0].replace(/^    /gm,'');
c.args = { historyretention: 1, ssequeuetimeout: 1 }; c.now = () => Date.now();
g.__historykeep = true; g.__sseQueues = {}; g.__lastActivity.b = 0;
const busy = g._mini_a_web_reserve('b');
vm.runInContext(cleanup,c); assert.ok(g.__conversations.b);
g._mini_a_web_release('b',busy); vm.runInContext(cleanup,c); assert.equal(g.__conversations.b,undefined); assert.equal(closes,3);
// Retained-history clear also closes the idle agent without erasing transcript.
g.__usehistory = true; g.__conversations.retained = new Agent(); g.__res.retained = [{event:'final',message:'saved'}];
call('clear',{uuid:'retained'}); assert.equal(closes,4); assert.equal(g.__res.retained.length,1);
g.__conversations.loaded = new Agent(); call('load-history',{uuid:'loaded',history:[]}); assert.equal(closes,5);
// Execute the bootstrap block in both ownership modes.
const bootstrap = yaml.slice(yaml.indexOf('    var needsWorkerRegBootstrap'), yaml.indexOf('    global._mini_a_web_historyS3Key')).replace(/^    /gm,'');
c.args = { mcplazy:false }; vm.runInContext(bootstrap,c); assert.equal(closes,6);
c.args = { mcplazy:false,workerreg:9999 }; vm.runInContext(bootstrap,c); assert.equal(closes,6); assert.ok(g.__bootstrapAgent);
console.log('Web expiry, history and bootstrap ownership checks passed.');

// All supported result shapes reach the final transcript without losing typed data.
g.__usehistory = false;
scheduleFail = false;
for (const [value, expected] of [
  ['```markdown\n# Answer\n```', '# Answer'],
  [{ answer: '```markdown\n# Answer\n```' }, '# Answer'],
  [{ answer: 42 }, '{"answer":42}'],
  [{ answer: { count: 2 } }, '{"answer":{"count":2}}'],
  ['```mermaid\ngraph TD; A-->B\n```', '```mermaid\ngraph TD; A-->B\n```']
]) {
  finalResult = value;
  call('prompt', { uuid: 'shape', prompt: 'x' }); pending.shift()();
  assert.equal(g.__res.shape.at(-1).event, 'final');
  assert.equal(g.__res.shape.at(-1).message, expected);
}
g.maArgs.format = 'raw'; finalResult = '```markdown\nraw answer\n```';
call('prompt', { uuid: 'shape', prompt: 'x' }); pending.shift()();
assert.equal(g.__res.shape.at(-1).message, finalResult);
finalResult = undefined;
call('prompt', { uuid: 'shape', prompt: 'x' }); pending.shift()();
assert.equal(g.__res.shape.at(-1).event, '❗');
assert.match(g.__res.shape.at(-1).message, /no final answer/);
assert.equal(g.__busy.shape, undefined); assert.equal(g.__conversations.shape, undefined);
console.log('Web final-result shape checks passed.');
