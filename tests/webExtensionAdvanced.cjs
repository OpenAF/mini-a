// Execute the real Advanced command adapter with provider-free transport fixtures.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync('js/web/mini-a-advanced.js', 'utf8')
function fixture() {
  const jobs = [], events = [], submitted = [], reservations = new Map()
  const state = { uuid: 'session', receipts: {}, nativeResults: {}, overrides: {}, operation: null, closed: false }
  state.runtime = {
    commandView: () => ({ name: 'activity', params: {} }), options: () => ({}),
    sync() {}, saveConversation() {}, agent: () => null,
    execute(command) { if (command !== '/help') state.goal = { prompt: command }; return true }
  }
  const context = {
    __: undefined, MiniAAdvanced: function() {},
    isDef: value => value !== undefined && value !== null,
    isUnDef: value => value === undefined || value === null,
    isString: value => typeof value === 'string', isArray: Array.isArray,
    isMap: value => !!value && typeof value === 'object' && !Array.isArray(value),
    stringify: value => JSON.stringify(value), jsonParse: JSON.parse,
    __miniAErrMsg: error => error.message || String(error), merge: (...args) => Object.assign({}, ...args),
    __conversations: {}, __webtoken: 'fixture-token',
    _mini_a_web_reserve: id => { if (reservations.has(id)) return; reservations.set(id, 'token'); return 'token' },
    _mini_a_web_release: (id, token) => { if (reservations.get(id) === token) reservations.delete(id) }
  }
  context.global = context
  vm.createContext(context)
  vm.runInContext(source.slice(source.indexOf('MiniAAdvanced.prototype.request =')), context)
  const advanced = new context.MiniAAdvanced()
  advanced.get = () => state
  advanced.safe = value => value
  advanced.persist = () => {}
  advanced.emit = (value, type, data, id) => events.push({ type, data, runId: id || value.operation })
  advanced.schedule = fn => { jobs.push(fn); return { catch() {} } }
  advanced.submitPrompt = request => { submitted.push(JSON.parse(request.files.postData)); return { data: JSON.stringify({ uuid: state.uuid, runId: 'goal' }) } }
  return { context, advanced, state, jobs, events, submitted, reservations }
}
const scoped = { uuid: 'session', action: 'command', command: 'Edit selected document', requestId: 'request-one', artifactReferences: [{ id: 'document', revision: 1 }], artifactPermissions: { write: true } }
{
  const f = fixture()
  f.context.MiniAWebDocumentAgent = { prepare() { throw new Error('Selected document changed') } }
  assert.throws(() => f.advanced.request(scoped), /changed/)
  assert.equal(f.jobs.length, 0)
  assert.equal(f.reservations.size, 0, 'failed validation releases command ownership')
  assert.equal(Object.keys(f.state.receipts).length, 0, 'rejected document scope is never accepted')
}
{
  const f = fixture()
  let preparations = 0
  f.context.MiniAWebDocumentAgent = { prepare(request) { preparations++; assert.equal(request.header['x-mini-a-token'], 'fixture-token') } }
  f.reservations.set('session', 'another-request')
  assert.equal(f.advanced.request(scoped).busy, true)
  assert.equal(preparations, 0, 'busy requests cannot attach document scope')
}
for (const data of [{ error: 'Selected document changed' }, { error: 'session busy', busy: true }]) {
  const f = fixture()
  f.context.MiniAWebDocumentAgent = { prepare() {} }
  f.advanced.submitPrompt = () => { f.state.operation = 'newer-request'; return { data: JSON.stringify(data) } }
  assert.equal(f.advanced.request(scoped).accepted, true)
  f.jobs.shift()()
  const error = f.events.find(event => event.type === 'error')
  assert.equal(error.runId, scoped.requestId)
  assert.equal(error.data, data.error)
  assert.equal(f.events.find(event => event.type === 'command-result').data.status, 'failed')
  assert.equal(f.state.operation, 'newer-request', 'failure correlation does not overwrite a newer operation')
}
{
  const f = fixture()
  f.context.MiniAWebDocumentAgent = { prepare() {} }
  f.advanced.request(scoped); f.jobs.shift()()
  assert.equal(f.submitted[0].artifactReferences[0].id, 'document')
  assert.equal(f.events.filter(event => event.type === 'error').length, 0)
}
{
  const f = fixture()
  f.context.MiniAWebDocumentAgent = { prepare() {} }
  f.advanced.submitPrompt = () => { throw new Error('Document scope became unavailable') }
  f.advanced.request(scoped); f.jobs.shift()()
  assert.equal(f.events.find(event => event.type === 'error').runId, scoped.requestId)
  assert.equal(f.events.find(event => event.type === 'command-result').data.status, 'failed')
}
{
  const f = fixture()
  f.advanced.submitPrompt = () => undefined
  f.advanced.request({ uuid: 'session', action: 'command', command: 'Ordinary goal', requestId: 'ordinary' }); f.jobs.shift()()
  assert.equal(f.events.filter(event => event.type === 'error').length, 0, 'ordinary disabled-mode forwarding behavior is unchanged')
  assert.throws(() => f.advanced.request(scoped), /disabled/)
}
{
  const f = fixture(), lines = []
  f.context.io = { fileExists: () => false, writeFileString: (file, text) => lines.push(JSON.parse(text)) }
  f.context.__lastActivity = {}
  f.state.lock = { lock() {}, unlock() {} }; f.state.sequence = 0; f.state.offsets = []
  f.state.operation = 'newer-request'; f.state.journal = '/fixture/journal'
  vm.runInContext(source.slice(source.indexOf('MiniAAdvanced.prototype.emit ='), source.indexOf('MiniAAdvanced.prototype.events =')), f.context)
  f.context.MiniAAdvanced.prototype.emit.call(f.advanced, f.state, 'command-result', { status: 'failed' }, scoped.requestId)
  assert.equal(lines[0].runId, scoped.requestId, 'real journal writer honors explicit request correlation')
  assert.equal(f.state.nativeResults[scoped.requestId], true)
  assert.equal(f.state.operation, 'newer-request')
}
console.log('PASS Advanced document scope admission, rejection races, correlation and disabled compatibility')
