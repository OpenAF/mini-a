// Execute the actual YAML route bodies with deterministic scheduling and agent fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const yaml = require('./webSource.cjs');
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
  sleep() {},
  $tb(fn) { return { stopWhen(check) { this.check = check; return this; }, exec() { fn(); this.check(true); } }; },
  $doV(fn) { if (scheduleFail) throw Error('schedule failed'); pending.push(fn); return { catch() {} }; } };
vm.createContext(c);
vm.runInContext(fs.readFileSync('mini-a-common.js', 'utf8'), c);
vm.runInContext(fs.readFileSync('mini-a-web-attachments.js', 'utf8'), c);
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

// Advanced transport cannot instantiate or mutate sessions before opt-in and authentication.
assert.equal(call('advanced', {uuid:'a',action:'snapshot'}).error, 'Advanced mode is disabled');
let advancedCalls = 0;
g.__advanced = { request(data) { advancedCalls++; return {uuid:data.uuid,ok:true}; } };
g._mini_a_web_checkToken = () => false;
assert.equal(call('advanced', {uuid:'a',action:'snapshot'}).error, 'unauthorized');
assert.equal(advancedCalls, 0);
g._mini_a_web_checkToken = () => true;
assert.equal(call('advanced', {uuid:'a',action:'snapshot'}).ok, true);
assert.equal(call('advanced', {uuid:'a',command:'x'.repeat(150001)}).error, 'Invalid advanced request');
assert.equal(advancedCalls, 1);
console.log('Advanced opt-in, authentication and request-size checks passed.');

// Custom command labels reach the transcript and journal while the agent receives
// the full prompt, including on a reused agent and after returning to plain input.
const commandEvents = [];
g._mini_a_web_extractSubtaskId = message => /^\[subtask:([^\]]+)\]/.exec(message)?.[1];
const commandState = { runtime: {
  options: () => ({}), attach() {}, sync() {}, beginTrace: () => () => {},
  saveConversation() {}, afterGoal() {}
} };
g.__advanced = { sessions: { commands: commandState }, persist() {}, safe: x => x,
  emit(state, type, value) { commandEvents.push({type, value}); } };
Agent.prototype.setTraceFn = function() {};
const originalStart = Agent.prototype.start;
Agent.prototype.start = function(args) {
  this.fn('user', args.goal);
  return originalStart.call(this, args);
};
finalResult = 'Command answer';
for (const [prompt, displayPrompt] of [
  ['Expanded impact instructions', '/git-impact'],
  ['Expanded commit instructions', '/git-commit'],
  ['Plain follow-up', undefined]
]) {
  call('prompt', {uuid: 'commands', prompt, displayPrompt}); pending.shift()();
  assert.equal(g.__conversations.commands.lastArgs.goal, 'Prefix: ' + prompt);
  assert.equal(g.__res.commands.filter(e => e.event === '👤').at(-1).message, displayPrompt || 'Prefix: ' + prompt);
  assert.equal(commandEvents.filter(e => e.type === 'user').at(-1).value, displayPrompt || 'Prefix: ' + prompt);
  assert.equal(commandState.displayPrompt, undefined, 'display label cleared after the run');
}
call('prompt', {uuid: 'simple-label', prompt: 'Simple prompt', displayPrompt: '/ignored'}); pending.shift()();
assert.equal(g.__res['simple-label'].find(e => e.event === '👤').message, 'Prefix: Simple prompt');
Agent.prototype.start = originalStart;
console.log('Advanced custom command display checks passed.');

// Advanced new-conversation and expiry preserve console history and its VM store.
let savedAdvanced = 0, persistedAdvanced = 0, disposedAdvanced = 0, deletedVm = 0, prunedAdvanced = 0;
g.__advanced = {
  sessions: { advanced: {runtime: {
    saveConversation() { savedAdvanced++; }, dispose() { disposedAdvanced++; }
  }} },
  persist() { persistedAdvanced++; }, pruneHistory() { prunedAdvanced++; }
};
g.__usehistory = false; g.__historykeep = false;
g.__conversations.advanced = new Agent();
g.__conversations.advanced._historyVm = {deleteOwnedStore() { deletedVm++; }};
g.__res.advanced = [{event:'final',message:'kept'}];
assert.equal(call('clear', {uuid:'advanced'}).status, 'cleared');
assert.equal(savedAdvanced, 1); assert.equal(persistedAdvanced, 1);
assert.equal(deletedVm, 0); assert.equal(g.__res.advanced.length, 1);
g.__lastActivity.advanced = 0;
c.args = {historyretention:1, ssequeuetimeout:1};
vm.runInContext(cleanup, c);
assert.equal(prunedAdvanced, 1); assert.equal(disposedAdvanced, 1);
assert.equal(deletedVm, 0); assert.equal(g.__advanced.sessions.advanced, undefined);
console.log('Advanced history lifecycle checks passed.');

Agent.prototype.start = function(args) {
  this.fn('user', args.goal);
  return originalStart.call(this, args);
};
// Binary data is processed only inside the accepted, reserved prompt run.
delete g.__advanced;
g.__useattach = true;
const attachment = {name:'report.pdf',base64:Buffer.from('%PDF-fixture').toString('base64')};
let processed = 0;
c.MiniAWebAttachments.process = (items, prompt, agent, alive, progress) => {
  processed++; assert.equal(alive(),true); assert.equal(items[0].name,'report.pdf');
  progress('Processing attachment: report.pdf'); return prompt + '\nDocument evidence';
};
assert.equal(call('prompt',{uuid:'binary',prompt:'Read',attachments:[attachment]}).error,undefined,'accepted submission has no error');
assert.equal(processed,0,'extraction is asynchronous');
assert.equal(call('prompt',{uuid:'binary',prompt:'Overlap',attachments:[attachment]}).busy,true);
pending.shift()();
assert.equal(processed,1);
assert.match(g.__conversations.binary.lastArgs.goal,/Document evidence/);
const binaryUser = g.__res.binary.find(e => e.event === '👤');
assert.match(binaryUser.message,/Document evidence/,'model history retains extracted content');
assert.equal(binaryUser.displayMessage,'Read\n\n📎 report.pdf');
assert.equal(g.__conversations.binary._webAttachmentDisplayPrompt,undefined,'display label expires after the run');
const binaryResult = call('result',{uuid:'binary'});
assert.match(binaryResult.content,/Read/);assert.match(binaryResult.content,/report.pdf/);
assert.doesNotMatch(binaryResult.content,/Document evidence/,'answer view hides Tika source text');
assert.equal(binaryResult.history.find(e => e.event === '👤').displayMessage,binaryUser.displayMessage);
assert.equal(JSON.stringify(g.__res.binary).includes(attachment.base64),false,'binary payload is absent from transcript');
assert.match(call('prompt',{uuid:'invalid',prompt:'Read',attachments:[{...attachment,name:'x.exe'}]}).error,/unsupported/);
assert.equal(g.__busy.invalid,undefined);
const priorStarts = starts;
c.MiniAWebAttachments.process = () => { throw Error('report.pdf: parser failed'); };
call('prompt',{uuid:'binary-failure',prompt:'Read',attachments:[attachment]});pending.shift()();
assert.equal(starts,priorStarts,'failed extraction never starts the agent');
assert.match(g.__res['binary-failure'].at(-1).message,/parser failed/);
call('prompt',{uuid:'binary-stop',prompt:'Read',attachments:[attachment]});
g.__attachmentStops['binary-stop']=g.__runTokens['binary-stop'];
c.MiniAWebAttachments.process = (items,prompt,agent,alive) => { assert.equal(alive(),false);throw Error('cancelled'); };
pending.shift()();assert.equal(starts,priorStarts);
assert.equal(g.__busy['binary-stop'],undefined);
console.log('Web binary processing, failure and cancellation checks passed.');
const beforeExpandedLimit = starts;
c.MiniAWebAttachments.process = () => 'x'.repeat(120001);
call('prompt',{uuid:'binary-limit',prompt:'Read',attachments:[attachment]});pending.shift()();
assert.equal(starts,beforeExpandedLimit);
assert.match(g.__res['binary-limit'].at(-1).message,/prompt exceeds/);
c.MiniAWebAttachments.process = (items,prompt,agent,alive) => {assert.equal(alive(),true);return prompt+'\nSaved evidence';};
call('prompt',{uuid:'binary-stop',prompt:'Try again',attachments:[attachment]});pending.shift()();
assert.equal(starts,beforeExpandedLimit+1,'a new run after Stop can process files');
console.log('Expanded prompt limit and post-cancellation retry checks passed.');

// Reused callbacks must read the new label and never apply it to later plain goals.
c.MiniAWebAttachments.process = (items,prompt) => prompt+'\nImage evidence';
call('prompt',{uuid:'binary',prompt:'Inspect',attachments:[{name:'image.png',base64:'iVBORw0KGgo='}]});pending.shift()();
assert.equal(g.__res.binary.filter(e => e.event === '👤').at(-1).displayMessage,'Inspect\n\n📎 image.png');
call('prompt',{uuid:'binary',prompt:'Follow up'});pending.shift()();
assert.equal(g.__res.binary.filter(e => e.event === '👤').at(-1).displayMessage,undefined);
assert.equal(g.__res.binary.filter(e => e.event === '👤').at(-1).message,'Prefix: Follow up');
// Advanced user journal and answer pane use the label; the model still sees evidence.
g.__advanced = {sessions:{'binary-advanced':commandState},persist(){},safe:x=>x,emit(state,type,value){commandEvents.push({type,value});}};
call('prompt',{uuid:'binary-advanced',prompt:'Explain',attachments:[attachment]});pending.shift()();
assert.equal(commandEvents.filter(e => e.type === 'user').at(-1).value,'Explain\n\n📎 report.pdf');
assert.match(g.__conversations['binary-advanced'].lastArgs.goal,/Image evidence/);
assert.doesNotMatch(call('result',{uuid:'binary-advanced'}).content,/Image evidence/);
assert.equal(g.__conversations['binary-advanced']._webAttachmentDisplayPrompt,undefined);
Agent.prototype.start = originalStart;
console.log('Simple and Advanced attachment transcript display checks passed.');

// Stop while start() is blocked must interrupt the worker and discard its answer.
const normalBox = c.$tb;
c.$tb = () => ({stopWhen(check) { this.check = check; return this; }, exec() {
  assert.equal(this.check(false), false, 'active goal keeps running');
  commandState.cancelled = true;
  assert.equal(this.check(false), true, 'Stop interrupts a blocked goal');
}});
call('prompt',{uuid:'binary-advanced',prompt:'Blocked goal'});pending.shift()();
assert.equal(g.__busy['binary-advanced'],undefined,'Stop releases reservation');
assert.equal(g.__conversations['binary-advanced'],undefined,'stopped agent is disposed');
assert.equal(g.__res['binary-advanced'].at(-1).event,'stop','Stop is not a failed or final answer');
c.$tb = normalBox;
call('prompt',{uuid:'binary-advanced',prompt:'Retry'});pending.shift()();
assert.equal(g.__res['binary-advanced'].at(-1).event,'final','new goal works after Stop');
console.log('Advanced blocked worker cancellation and retry checks passed.');

assert.equal(call('load-history',{uuid:'restored-binary',history:binaryResult.history}).status,'loaded');
const restoredUser = g.__res['restored-binary'].find(e => e.event === '👤');
assert.equal(restoredUser.displayMessage,binaryUser.displayMessage);
assert.match(restoredUser.message,/Document evidence/);
assert.doesNotMatch(call('result',{uuid:'restored-binary'}).content,/Document evidence/);
console.log('Restored attachment history preserves presentation and model content.');

// Both recovery paths must retain the answer, not just completion notifications.
delete g.__advanced;
g.__usehistory = true;
g.__res.recovery = [{event:'👤',message:'Question'}, {event:'final',message:'Important answer'}];
g._mini_a_web_historyExists = () => false;
let rebuilt;
g._mini_a_web_saveFile = (_path, value) => { rebuilt = value; };
call('prompt', {uuid:'recovery',prompt:'Follow up'}); pending.shift()();
assert.equal(rebuilt.c.at(-1).role, 'assistant');
assert.equal(rebuilt.c.at(-1).content, 'Important answer');
const payloadHelper = yaml.slice(yaml.indexOf('    global._mini_a_web_buildHistoryPayload ='), yaml.indexOf('    global._mini_a_web_storeHistory =')).replace(/^    /gm, '');
c.io = {fileExists: () => false};
vm.runInContext(payloadHelper, c);
g.__res.recovery = [{event:'👤',message:'Question'}, {event:'final',message:'Important answer'}];
const recovered = JSON.parse(g._mini_a_web_buildHistoryPayload('recovery'));
assert.equal(recovered.c.at(-1).role, 'assistant');
assert.equal(recovered.c.at(-1).content, 'Important answer');
console.log('Final answers survive local recovery and remote history payload rebuilding.');
