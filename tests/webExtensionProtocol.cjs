// Protocol boundary and SDK behavior, without a browser/provider dependency.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const contract = require('../public/web-extension-contract.js')
const manifest = {
  $schema: contract.schema, id: 'org.example.text', name: 'Text editor', version: '1.0.0', apiVersions: ['1.0'],
  entry: 'index.html', rendering: 'iframe', activation: ['command', 'open-with'],
  formats: [{ mimeTypes: ['text/plain'], extensions: ['.txt'] }],
  capabilities: ['render', 'edit', 'create', 'export'],
  permissions: ['artifact.read', 'artifact.propose-write', 'artifact.propose-export'],
  exports: [{ mimeType: 'text/plain', extension: '.txt' }], network: { origins: [] }, offline: true, license: 'Apache-2.0'
}
assert.deepEqual(contract.validateManifest(manifest), manifest)
assert.notEqual(contract.validateManifest(manifest), manifest, 'return an independent manifest')
for (const patch of [
  { $schema: 'https://elsewhere/schema' }, { entry: '../index.html' }, { entry: 'nested//index.html' },
  { entry: 'https://evil.example/index.html' }, { entry: '.hidden/index.html' }, { entry: 'adapter.js' },
  { network: { origins: ['https://evil.example'] } }, { offline: false }, { permissions: ['filesystem'] },
  { capabilities: ['edit'] }, { permissions: [] }, { exports: [] }, { unexpected: true },
  { apiVersions: [] }, { id: 'UpperCase.id' }, { resources: { maxArtifactBytes: 8388609 } },
  { formats: [{ mimeTypes: ['text/plain'], extensions: ['.txt'] }, { extensions: ['.txt'], mimeTypes: ['text/plain'] }] },
  { extensions: { arbitrary: {} } }, { extensions: JSON.parse('{"x-test":{"__proto__":{"admin":true}}}') }
]) assert.throws(() => contract.validateManifest({ ...manifest, ...patch }), JSON.stringify(patch))
assert.equal(contract.negotiate(['2.0', '1.0']), '1.0')
assert.throws(() => contract.negotiate(['2.0']), /compatible/)
assert.equal(contract.bytes('é😀'), 6)
assert.equal(contract.content({ encoding: 'utf8', text: 'é😀' }, 6), 6)
assert.throws(() => contract.content({ encoding: 'utf8', text: 'é😀' }, 5), /limit/)
assert.equal(contract.content({ encoding: 'base64', data: 'w6k=' }), 2)
for (const data of ['a', '====', 'YQ=!', 'AA=A', 'AA\nA']) assert.throws(() => contract.content({ encoding: 'base64', data }))
assert.throws(() => contract.content({ encoding: 'utf8', text: 'safe', data: 'ignored' }))

const base = { protocol: contract.protocol, version: '1.0', instanceId: 'instance-one' }
const request = (method, params = {}, id = 'request-one') => ({ ...base, kind: 'request', id, method, params })
const event = (name, params) => ({ ...base, kind: 'event', event: name, params })
const init = { apiVersion: '1.0', capabilities: manifest.capabilities, permissions: manifest.permissions, limits: { nativeBytes: 8388608, exportBytes: 16777216 } }
assert.equal(contract.validateMessage(request('initialize', init)).method, 'initialize')
assert.equal(contract.validateMessage(request('save')).method, 'save')
for (const value of [
  request('fetch', { url: '/advanced' }), request('save', { path: '/tmp/secret' }), request('export', {}),
  request('open', { artifact: {}, content: { encoding: 'utf8', text: 'x' } }),
  request('resize', { width: -1, height: 100 }), request('cancel', { requestId: 'a/b' }),
  request('initialize', { ...init, permissions: ['filesystem'] }),
  event('dirtyChanged', { dirty: 'true', editSequence: 1 }), event('dirtyChanged', { dirty: true, editSequence: -1 }),
  event('commit', { revision: 0, editSequence: 1 }), event('saveRequested', { path: 'x' }),
  { ...base, kind: 'response', id: 'x', result: {}, error: { code: 'no', message: 'x', retryable: false } },
  { ...request('save'), extra: true }, { ...request('save'), instanceId: 'other' }
]) assert.throws(() => contract.validateMessage(value, { instanceId: base.instanceId }))
const result = { ...base, kind: 'response', id: 'x', result: { content: { encoding: 'utf8', text: 'hi' }, mimeType: 'text/plain', editSequence: 1 } }
assert.equal(contract.validateMessage(result, { method: 'save' }), result)
assert.throws(() => contract.validateMessage({ ...result, result: { ...result.result, execute: 'x' } }, { method: 'save' }))
assert.throws(() => contract.validateMessage({ ...result, result: { ...result.result, editSequence: undefined } }, { method: 'save' }))
assert.throws(() => contract.validateMessage({ ...result, result: { ...result.result, content: { encoding: 'utf8', text: 'x'.repeat(1000) } } }, { method: 'save', maxContentBytes: 999 }))
assert.throws(() => contract.validateMessage(event('error', { code: 'x', message: 'x'.repeat(1001) })))
assert.throws(() => contract.validateMessage({ ...base, kind: 'response', id: 'x', result: { metadata: { big: 'x'.repeat(65536) } } }, { method: 'inspect' }))
const schema = JSON.parse(fs.readFileSync('schemas/mini-a-web-1.0.schema.json', 'utf8'))
assert.equal(schema.$id, contract.schema)
assert.equal(schema.additionalProperties, false)
assert.deepEqual(schema.properties.capabilities.items.enum, contract.capabilities)
assert.deepEqual(schema.properties.permissions.items.enum, contract.permissions)
const protocolSchema = JSON.parse(fs.readFileSync('schemas/mini-a-web-protocol-1.0.schema.json', 'utf8'))
assert.deepEqual(protocolSchema.oneOf.filter(x => x.properties.kind.const === 'request').map(x => x.properties.method.const), contract.methods)

function sdkFixture(handlers = {}) {
  const listeners = {}, parent = {}, sent = [], posted = []
  const window = {
    parent,
    addEventListener(name, fn) { listeners[name] = fn },
    removeEventListener(name, fn) { if (listeners[name] === fn) delete listeners[name] }
  }
  parent.postMessage = (message, target) => posted.push({ message, target })
  const context = vm.createContext({ window, MiniAWebExtensionContract: contract, setTimeout, clearTimeout, Promise, Date })
  vm.runInContext(fs.readFileSync('public/web-extension-sdk.js', 'utf8'), context)
  const sdk = context.MiniAWebExtensionSDK.connect({ versions: ['1.0'], handlers })
  const port = { onmessage: null, start() {}, close() { this.closed = true }, postMessage(message) { sent.push(message) } }
  const connect = () => listeners.message({ source: parent, origin: 'https://host.example', data: { type: 'mini-a:web-extension:bootstrap', phase: 'connect', instanceId: base.instanceId, nonce: 'a'.repeat(48), versions: ['1.0'] }, ports: [port] })
  return { sdk, port, sent, posted, listeners, parent, connect, receive: message => port.onmessage({ data: message }) }
}

;(async () => {
  let finishSave, commits = 0
  const fixture = sdkFixture({
    initialize: async () => ({ initialized: true }),
    save: async () => { await new Promise(resolve => { finishSave = resolve }); return result.result },
    commit: () => { commits++ }
  })
  assert.equal(fixture.posted[0].message.phase, 'ready')
  fixture.listeners.message({ source: {}, data: { type: 'mini-a:web-extension:bootstrap', phase: 'connect' }, ports: [fixture.port] })
  assert.equal(fixture.port.onmessage, null, 'another window cannot establish the channel')
  fixture.connect(); await fixture.sdk.ready
  assert.equal(fixture.sent[0].phase, 'connected')
  assert.equal(fixture.listeners.message, undefined, 'remove bootstrap listener after binding')
  await fixture.receive(request('save', {}, 'early'))
  assert.match(fixture.sent.at(-1).error.message, /initialized/)
  await fixture.receive(request('initialize', init, 'init'))
  assert.equal(fixture.sent.at(-1).result.initialized, true)
  const pending = fixture.receive(request('save', {}, 'saving'))
  await fixture.receive(request('save', {}, 'saving'))
  assert.equal(fixture.sent.at(-1).error.code, 'duplicate_request')
  await fixture.receive(request('cancel', { requestId: 'saving' }, 'cancel'))
  assert.equal(fixture.sent.at(-1).result.cancelled, true)
  finishSave(); await pending
  assert.equal(fixture.sent.at(-1).error.code, 'cancelled', 'duplicate request must not erase cancellation state')
  fixture.sdk.emit('dirtyChanged', { dirty: true, editSequence: 2 })
  assert.equal(fixture.sent.at(-1).event, 'dirtyChanged')
  assert.throws(() => fixture.sdk.emit('commit', { revision: 1, editSequence: 2 }), /host/)
  assert.throws(() => fixture.sdk.emit('selectionChanged', { ids: ['x'] }), /permission/)
  await fixture.receive(event('commit', { revision: 1, editSequence: 2 }))
  assert.equal(commits, 1)
  await fixture.receive(request('dispose', {}, 'dispose'))
  assert.equal(fixture.port.closed, true)
  assert.equal(fixture.listeners.pagehide, undefined)
  assert.equal(fixture.sdk.emit('dirtyChanged', { dirty: true, editSequence: 3 }), false)
  const viewer = sdkFixture()
  viewer.connect(); await viewer.sdk.ready
  await viewer.receive(request('initialize', { ...init, capabilities: ['render'], permissions: ['artifact.read'] }, 'init-viewer'))
  await viewer.receive(request('save', {}, 'denied'))
  assert.equal(viewer.sent.at(-1).error.code, 'permission_denied')
  viewer.sdk.dispose()
  console.log('PASS extension manifests, protocol schemas, payload limits, SDK binding, capabilities, cancellation and disposal')
})().catch(error => { console.error(error); process.exitCode = 1 })
