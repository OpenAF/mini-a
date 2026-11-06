// Exercise the actual host against a minimal DOM and controlled HTTP/port peers.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { webcrypto } = require('node:crypto')
const contract = require('../public/web-extension-contract.js')
const tick = () => new Promise(resolve => setImmediate(resolve))
class Element {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase(); this.document = document; this.children = []; this.listeners = {}; this.attributes = {}; this.className = ''; this.clientWidth = 800; this.clientHeight = 500; this.isConnected = false
    const values = new Set()
    this.classList = { contains: key => values.has(key), toggle: key => values.has(key) ? values.delete(key) : values.add(key) }
    if (tag === 'iframe') this.contentWindow = { postMessage: message => document.mount(this, message) }
  }
  set src(value) { this._src = value; queueMicrotask(() => this.dispatch('load', {})) }
  get src() { return this._src }
  setAttribute(name, value) { this.attributes[name] = value }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn) }
  async dispatch(name, event = {}) { event.preventDefault ||= () => {}; for (const fn of this.listeners[name] || []) await fn(event) }
  appendChild(child) { child.parentNode = this; child.isConnected = this.isConnected; this.children.push(child); return child }
  append(...children) { children.forEach(child => this.appendChild(child)) }
  replaceChildren() { this.children.forEach(child => child.isConnected = false); this.children = [] }
  remove() { this.isConnected = false; if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this) }
  close() { this.open = false }
  showModal() { this.open = true }
  focus() { this.document.activeElement = this }
  click() { return this.dispatch('click') }
}
function descendants(node) { return node.children.flatMap(child => [child, ...descendants(child)]) }
function fixture(viewer = false) {
  const listeners = {}, calls = [], peers = [], storage = new Map(), selected = []
  let binds = 0, saves = 0, conflict = false
  const manifest = {
    $schema: contract.schema, id: 'org.example.text', name: 'Text editor', version: '1.0.0', apiVersions: ['1.0'], entry: 'index.html', rendering: 'iframe', activation: ['command', 'open-with'],
    formats: [{ mimeTypes: ['text/plain'], extensions: ['.txt'] }], capabilities: viewer ? ['render'] : ['render', 'edit', 'create', 'export'],
    permissions: viewer ? ['artifact.read'] : ['artifact.read', 'artifact.propose-write', 'artifact.propose-export'],
    exports: viewer ? [] : [{ mimeType: 'text/plain', extension: '.txt' }], network: { origins: [] }, offline: true, license: 'Apache-2.0'
  }
  const digest = 'a'.repeat(64), extension = { manifest, digest, enabled: true, status: 'enabled', frameUrl: '/prefix/web-extension-frame/' + digest, entryUrl: '/prefix/web-extension-assets/' + digest + '/index.html' }
  let artifact = { id: 'document-one', title: 'Document', revision: 1, native: { mimeType: 'text/plain', filename: 'document.txt' } }
  const document = { baseURI: 'https://host.example/prefix/', activeElement: null, createElement: tag => new Element(tag, document) }
  document.body = new Element('body', document); document.body.isConnected = true
  const window = {
    location: { origin: 'https://host.example' }, navigator: { language: 'en-US' }, crypto: webcrypto,
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    atob: value => Buffer.from(value, 'base64').toString('binary'), btoa: value => Buffer.from(value, 'binary').toString('base64'),
    addEventListener(name, fn) { (listeners[name] ||= []).push(fn) }, removeEventListener(name, fn) { listeners[name] = (listeners[name] || []).filter(value => value !== fn) },
    async fetch(url, options) {
      const body = options.body ? JSON.parse(options.body) : {}, route = new URL(url).pathname
      calls.push({ route, ...body, ascii: !options.body || !/[^\x00-\x7f]/.test(options.body) }); let value, status = 200
      if (route.endsWith('/web-extensions') && !body.action) value = { extensions: [extension], defaults: {}, limits: {} }
      else if (body.action === 'bind') value = { binding: 'binding-' + (++binds), instanceId: 'instance-' + binds, permissions: manifest.permissions, limits: {}, frameUrl: extension.frameUrl, entryUrl: extension.entryUrl }
      else if (body.action === 'read') value = { artifact, content: { encoding: 'base64', data: 'b3JpZ2luYWw=' } }
      else if (body.action === 'list') value = { documents: [artifact] }
      else if (body.action === 'save') {
        if (conflict && body.id) { value = { error: { code: 'revision_conflict', message: 'Newer revision' } }; status = 409 }
        else { saves++; artifact = { ...artifact, id: body.id || 'copy-' + saves, title: body.title, revision: body.expectedRevision + 1 }; value = artifact }
      } else value = { ok: true }
      return { ok: status < 400, status, json: async () => value }
    }
  }
  document.mount = (frame, message) => {
    if (message.phase !== 'mount') return
    const peer = { sent: [], closed: false, onmessage: null, start() {}, close() { this.closed = true }, postMessage(request) {
      this.sent.push(request)
      if (request.kind !== 'request') return
      let result = {}
      if (request.method === 'initialize') result = { initialized: true }
      else if (request.method === 'open' || request.method === 'update') result = { opened: true }
      else if (request.method === 'create') result = { created: true }
      else if (request.method === 'save' || request.method === 'export') result = { content: { encoding: 'utf8', text: this.nativeText || 'edited' }, mimeType: 'text/plain', editSequence: 1 }
      const response = { data: { protocol: contract.protocol, version: '1.0', kind: 'response', instanceId: message.instanceId, id: request.id, result } }
      if (request.method === 'save' && this.holdSave) { this.held = response; return }
      if (request.method === 'save' && this.saveSequence !== undefined) result.editSequence = this.saveSequence
      queueMicrotask(() => this.onmessage?.(response))
    } }
    peers.push(peer)
    queueMicrotask(() => (listeners.message || []).forEach(fn => fn({ source: frame.contentWindow, origin: window.location.origin, data: { type: 'mini-a:web-extension:container', phase: 'connected', instanceId: message.instanceId, nonce: message.nonce, version: '1.0' }, ports: [peer] })))
  }
  const context = vm.createContext({ MiniAWebExtensionContract: contract, window, document, Uint8Array, TextEncoder, URL, Blob, Promise, Date, setTimeout, clearTimeout, setInterval, clearInterval })
  vm.runInContext(fs.readFileSync('public/web-extensions.js', 'utf8'), context)
  const host = context.MiniAWebExtensionsUI({ url: path => 'https://host.example/prefix/' + path, uuid: () => 'host-session', agentAvailable: true, onSelectArtifact: value => selected.push(value) })
  const find = text => descendants(document.body).filter(node => node.tagName === 'BUTTON' && node.textContent === text).at(-1)
  const emit = (instance, event, params) => peers.at(-1).onmessage({ data: { protocol: contract.protocol, version: '1.0', kind: 'event', instanceId: instance.id, event, params } })
  return { host, window, document, calls, peers, selected, find, emit, setConflict: value => { conflict = value }, listeners }
}

;(async () => {
  const f = fixture()
  assert.equal(f.calls.length, 0, 'constructing optional host does not load extension resources')
  const instance = await f.host.openArtifact({ id: 'document-one' })
  const peer = f.peers[0]
  assert.equal(peer.sent[0].method, 'initialize')
  const open = peer.sent.find(message => message.method === 'open')
  assert.equal(open.params.content.data, 'b3JpZ2luYWw=')
  assert.equal(JSON.stringify(open).includes('host-session'), false, 'host session must not enter guest messages')
  assert.equal(JSON.stringify(peer.sent).includes('binding-'), false, 'server binding must not enter guest messages')
  await f.emit(instance, 'dirtyChanged', { dirty: true, editSequence: 1 })
  assert.equal(instance.dirty, true)
  await f.emit(instance, 'dirtyChanged', { dirty: false, editSequence: 1 })
  assert.equal(instance.dirty, true, 'guest cannot clear unsaved state')
  peer.nativeText = 'Olá — 😀'
  assert.equal(await instance.save(), true)
  const firstSave = f.calls.find(call => call.action === 'save')
  assert.equal(firstSave.content.encoding, 'base64')
  assert.equal(Buffer.from(firstSave.content.data, 'base64').toString('utf8'), 'Olá — 😀', 'Unicode content is binary-safe in the bounded HTTP envelope')
  assert.equal(firstSave.ascii, true, 'wire JSON remains compatible with ASCII-decoding HTTP servers')
  assert.equal(instance.revision, 2)
  assert.equal(instance.dirty, false)
  assert.equal(peer.sent.at(-1).event, 'commit')
  await f.find('Use in next prompt').click()
  assert.equal(f.selected[0].id, 'document-one')
  await f.emit(instance, 'dirtyChanged', { dirty: true, editSequence: 2 })
  const changing = f.host.beforeSessionChange(); await tick()
  await f.find('Cancel').click()
  assert.equal(await changing, false)
  assert.equal(instance.disposed, false)
  f.setConflict(true)
  assert.equal(await instance.save(), false)
  assert.equal(instance.dirty, true)
  assert.equal(instance.revision, 2, 'conflict cannot replace committed revision')
  await f.find('Save as copy').click()
  assert.equal(instance.artifact.id, 'copy-2')
  assert.equal(f.calls.filter(call => call.action === 'bind').length, 2)
  assert.equal(f.calls.filter(call => call.action === 'save').at(-1).id, undefined)
  assert.equal(instance.dirty, true, 'new edits while saving remain dirty')
  await f.find('Use by default for this format').click()
  assert.match(f.window.localStorage.getItem('mini-a-web-extension-preferences'), /org.example.text/)
  const committedBefore = f.calls.filter(call => call.action === 'save').length
  peer.saveSequence = 99
  assert.equal(await instance.save(), false)
  assert.equal(f.calls.filter(call => call.action === 'save').length, committedBefore, 'unobserved future edit sequence cannot commit')
  delete peer.saveSequence; peer.holdSave = true
  const cancelledSave = instance.save(); await tick()
  await f.find('Cancel operation').click()
  assert.equal(await cancelledSave, false)
  peer.onmessage(peer.held); await tick()
  assert.equal(f.calls.filter(call => call.action === 'save').length, committedBefore, 'late reply to cancelled save cannot commit')
  peer.holdSave = false
  await f.host.dispose()
  assert.equal(peer.closed, true)
  assert.equal(instance.disposed, true)
  assert.equal((f.listeners.message || []).length, 0)
  assert.equal((f.listeners.beforeunload || []).length, 0)
  assert.equal(f.calls.some(call => call.action === 'release' && call.binding === instance.binding), true)
  const viewer = fixture(true)
  await viewer.host.openArtifact({ id: 'document-one' })
  await viewer.find('Save native copy').click()
  assert.equal(viewer.peers[0].sent.some(message => message.method === 'save'), false, 'viewer downloads original bytes without editor authority')
  await viewer.host.dispose()
  console.log('PASS host private bindings, explicit save, dirty guards, conflicts, save-copy, preferences, viewer download and teardown')
})().catch(error => { console.error(error); process.exitCode = 1 })
