// Exercise the actual adapter without loading upstream code or any LLM provider.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const contract = require('../public/web-extension-contract.js')
for (const name of ['text-editor', 'drawio']) {
  const manifest = JSON.parse(fs.readFileSync(`examples/web-extensions/${name}/mini-a-web.json`, 'utf8'))
  contract.manifest(manifest)
}
function fixture() {
  const sent = [], emitted = [], listeners = {}, timers = new Map()
  let handlers, frame, id = 0
  const status = { textContent: '' }, container = { appendChild(value) { frame = value } }
  const child = { postMessage(message, origin) { assert.equal(origin, '*'); sent.push(JSON.parse(message)) } }
  const document = {
    baseURI: 'http://localhost:8888/web-extension-assets/digest/index.html',
    getElementById(name) { return name === 'status' ? status : container },
    createElement(tag) {
      assert.equal(tag, 'iframe')
      return { contentWindow: child, attributes: {}, setAttribute(k,v) { this.attributes[k] = v }, remove() { this.removed = true }, focus() {} }
    }
  }
  const context = vm.createContext({ document, URL, Uint8Array, TextDecoder, Promise, JSON, atob, isFinite,
    window: { addEventListener(name, fn) { listeners[name] = fn }, removeEventListener(name) { delete listeners[name] } },
    setTimeout(fn) { const key = ++id; timers.set(key, fn); return key }, clearTimeout(key) { timers.delete(key) },
    MiniADrawioNative: { blank: '<mxfile/>', normalize: async text => { if (typeof text !== 'string') throw Error('Bad XML'); return text }, decodeContent: value => value.text, safeSvg: value => value },
    MiniAWebExtensionSDK: { connect(options) { handlers = options.handlers; return { emit(event, params) { emitted.push({event, ...params}) } } } }
  })
  vm.runInContext(fs.readFileSync('examples/web-extensions/drawio/web/adapter.js', 'utf8'), context)
  function receive(value, source = child, origin = 'null') { listeners.message?.({ source, origin, data: JSON.stringify(value) }) }
  return { sent, emitted, timers, listeners, handlers, receive, get frame() { return frame } }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
async function boot(f) {
  const result = f.handlers.initialize()
  assert.equal(f.frame.attributes.sandbox, 'allow-scripts')
  assert.match(f.frame.src, /local=1/)
  assert.match(f.frame.src, /pwa=0/)
  assert.match(f.frame.src, /ui=atlas/)
  f.receive({ event:'configure' }, {})
  f.receive({ event:'configure' }, undefined, 'https://attacker.test')
  assert.equal(f.sent.length, 0, 'reject wrong source and origin')
  f.receive({ event:'configure' })
  assert.equal(f.sent[0].action, 'configure')
  assert.equal(f.sent[0].config.aiEnabled, false)
  f.receive({ event:'init' })
  assert.equal((await result).initialized, true)
}
function respond(f, event, extra = {}) {
  const command = f.sent.at(-1)
  f.receive({ event, format: command.format, message: command, ...extra })
}
(async function() {
  const f = fixture()
  await boot(f)
  const creating = f.handlers.create()
  await tick()
  assert.equal(f.sent.at(-1).action, 'load')
  respond(f, 'load')
  assert.equal((await creating).created, true)
  assert.equal(f.emitted.at(-1).dirty, true)
  f.receive({ event:'autosave', xml:'<mxfile/>' })
  const saving = f.handlers.save()
  await tick()
  assert.equal(f.sent.at(-1).format, 'xml')
  f.receive({ event:'export', format:'xml', xml:'wrong', message:{ miniARequestId:'stale' } })
  f.receive({ event:'autosave', xml:'<mxfile>later</mxfile>' })
  respond(f, 'export', { xml:'<mxfile>saved</mxfile>' })
  const saved = await saving
  assert.equal(saved.content.text, '<mxfile>saved</mxfile>')
  f.handlers.commit({ editSequence: saved.editSequence })
  assert.equal(f.emitted.at(-1).dirty, true, 'edits during save stay dirty')
  const exporting = f.handlers.export({ mimeType:'image/svg+xml' })
  await tick()
  assert.equal(f.sent.at(-1).theme, 'light', 'fixed export palette retains light fallback colors')
  respond(f, 'export', { data:'data:image/svg+xml,' + encodeURIComponent('<svg/>') })
  assert.equal((await exporting).content.text, '<svg/>')
  const sequence = f.emitted.at(-1).editSequence
  const updating = f.handlers.update({artifact:{revision:2},content:{encoding:'utf8',text:'<mxfile>reloaded</mxfile>'}})
  await tick(); respond(f, 'load')
  assert.equal((await updating).editSequence, sequence, 'reload preserves instance sequence')
  f.receive({event:'autosave'})
  assert.equal(f.emitted.at(-1).editSequence, sequence + 1)
  const before = f.emitted.length
  f.receive({ event:'remoteInvoke', funtionName:'fetch', functionArgs:['/advanced'] })
  f.receive({ event:'openLink', href:'https://attacker.test' })
  f.receive({ event:'export', format:'png', data:'unsolicited' })
  assert.equal(f.emitted.length, before, 'no generic RPC, links or unsolicited download')
  f.receive({ event:'save', xml:'untrusted' })
  assert.equal(f.emitted.at(-1).event, 'saveRequested')
  f.receive({ event:'exit' })
  assert.equal(f.emitted.at(-1).event, 'closeRequested')
  const pending = f.handlers.save()
  const rejected = assert.rejects(pending, /cancelled/)
  f.handlers.cancel()
  await rejected
  await assert.rejects(f.handlers.save(), /Close and reopen/)
  f.handlers.dispose()
  assert.equal(f.frame.removed, true)
  assert.equal(Object.keys(f.listeners).length, 0)
  assert.equal(f.timers.size, 0)
  const late = fixture()
  await boot(late)
  const timedOut = late.handlers.save()
  const timeoutRejected = assert.rejects(timedOut, /timed out/)
  Array.from(late.timers.values())[0]()
  await timeoutRejected
  await assert.rejects(late.handlers.save(), /Close and reopen/)
  late.handlers.dispose()
  console.log('PASS reference manifests, opaque embed handshake, create/save/export, dirty sequence, spoof rejection, cancellation and cleanup')
})().catch(error => { console.error(error); process.exitCode = 1 })
