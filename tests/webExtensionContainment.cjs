// First-party containment boundary: real bootstrap code with controlled windows/ports.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const contract = require('../public/web-extension-contract.js')
function fixture() {
  const listeners = {}, messages = [], channels = [], children = [], parent = {}, digest = 'a'.repeat(64)
  const location = { origin: 'https://host.example', pathname: '/prefix/web-extension-frame/' + digest, href: 'https://host.example/prefix/web-extension-frame/' + digest }
  const window = { addEventListener(name, fn) { listeners[name] = fn }, removeEventListener(name) { delete listeners[name] } }
  parent.postMessage = (message, origin, ports) => messages.push({ message, origin, ports })
  const document = {
    body: { appendChild(child) { children.push(child) } },
    createElement() {
      const child = { attributes: {}, events: {}, setAttribute(k, v) { this.attributes[k] = v }, addEventListener(k, fn) { this.events[k] = fn }, remove() { this.removed = true }, contentWindow: { postMessage(message, origin, ports) { child.bootstrap = { message, origin, ports } } } }
      return child
    }
  }
  function MessageChannel() {
    this.port1 = { onmessage: null, start() {}, close() { this.closed = true } }
    this.port2 = {}; channels.push(this)
  }
  vm.runInNewContext(fs.readFileSync('public/web-extension-frame.js', 'utf8'), { MiniAWebExtensionContract: contract, window, parent, location, document, URL, MessageChannel, setTimeout, clearTimeout })
  const mount = { type: 'mini-a:web-extension:container', phase: 'mount', instanceId: 'instance-one', nonce: 'b'.repeat(48), entryUrl: '/prefix/web-extension-assets/' + digest + '/index.html' }
  const emit = (data, source = parent, origin = location.origin) => listeners.message?.({ data, source, origin })
  return { listeners, messages, channels, children, parent, location, mount, emit, close: () => listeners.pagehide() }
}
const f = fixture()
f.emit(f.mount, {})
f.emit(f.mount, f.parent, 'https://evil.example')
f.emit({ ...f.mount, entryUrl: 'https://evil.example/index.html' })
f.emit({ ...f.mount, entryUrl: '/prefix/web-extension-assets/' + 'c'.repeat(64) + '/index.html' })
f.emit({ ...f.mount, entryUrl: f.mount.entryUrl + '?token=never' })
assert.equal(f.children.length, 0, 'reject unbound parents, origins and asset namespaces')
f.emit(f.mount)
assert.equal(f.children.length, 1)
const child = f.children[0]
assert.equal(child.attributes.sandbox, 'allow-scripts')
assert.equal(child.attributes.referrerpolicy, 'no-referrer')
assert.match(child.attributes.allow, /clipboard-read 'none'/)
const ready = { type: 'mini-a:web-extension:bootstrap', phase: 'ready', versions: ['1.0'] }
f.emit(ready, {}, 'null')
f.emit(ready, child.contentWindow, f.location.origin)
assert.equal(f.channels.length, 0, 'null origin alone or same-origin sender cannot authenticate the guest')
f.emit(ready, child.contentWindow, 'null')
assert.equal(f.channels.length, 1)
assert.equal(child.bootstrap.origin, '*', 'opaque bootstrap is the only wildcard transfer')
const ack = { type: 'mini-a:web-extension:bootstrap', phase: 'connected', instanceId: f.mount.instanceId, nonce: f.mount.nonce, version: '1.0' }
f.channels[0].port1.onmessage({ data: ack })
assert.equal(f.messages[0].origin, f.location.origin)
assert.equal(f.messages[0].message.phase, 'connected')
assert.equal(f.messages[0].ports[0], f.channels[0].port1)
f.emit(ready, child.contentWindow, 'null')
assert.equal(f.channels.length, 1, 'guest cannot replace a transferred channel')
child.events.load(); child.events.load()
assert.equal(child.removed, true, 'navigation revokes and removes the guest')
assert.equal(f.messages.at(-1).message.phase, 'failed')
f.close()
const wrong = fixture(); wrong.emit(wrong.mount)
wrong.emit(ready, wrong.children[0].contentWindow, 'null')
wrong.channels[0].port1.onmessage({ data: { ...ack, nonce: 'c'.repeat(48) } })
assert.equal(wrong.channels[0].port1.closed, true)
assert.equal(wrong.children[0].removed, true)
wrong.close()
const html = fs.readFileSync('public/web-extension-frame.html', 'utf8')
for (const path of [...html.matchAll(/(?:href|src)="([^\"]+)"/g)].map(match => match[1])) assert.equal(new URL(path, f.location.href).pathname.startsWith('/prefix/'), true, 'containment assets preserve reverse-proxy prefix')
console.log('PASS containment parent/source/origin/nonce binding, package paths, navigation revocation and prefixed assets')
