// Apache-2.0. Only the documented native load/export subset is exposed.
(function() {
  var frame, sdk, pending, boot, sequence = 0, committedSequence = 0, disposed = false, loading = false, unusable = false
  var status = document.getElementById('status'), container = document.getElementById('editor')
  var maxExport = 16 * 1024 * 1024, readOnly = false, requestSequence = 0
  function fail(message) { throw new Error(message) }
  function send(message) {
    if (!frame || disposed) fail('Diagram editor is unavailable')
    // Both frames are intentionally opaque; only this exact child receives data.
    frame.contentWindow.postMessage(JSON.stringify(message), '*')
  }
  function rejectPending(error) {
    if (pending) { var task = pending; pending = null; clearTimeout(task.timer); task.reject(error) }
  }
  function request(message, event) {
    if (unusable) return Promise.reject(new Error('Close and reopen the diagram after a cancelled or timed-out operation'))
    if (pending) return Promise.reject(new Error('Diagram editor is busy'))
    return new Promise(function(resolve, reject) {
      var id = 'editor-' + (++requestSequence)
      message.miniARequestId = id
      pending = { id: id, event: event, format: message.format, resolve: resolve, reject: reject,
        timer: setTimeout(function() { unusable = true; rejectPending(new Error('Diagram editor timed out; close and reopen it before retrying')) }, 60000) }
      try { send(message) } catch (error) { rejectPending(error) }
    })
  }
  function changed() {
    sequence++
    sdk.emit('dirtyChanged', { dirty: sequence !== committedSequence, editSequence: sequence })
  }
  function receive(event) {
    if (disposed || !frame || event.source !== frame.contentWindow || event.origin !== 'null' || typeof event.data !== 'string' || event.data.length > 24 * 1024 * 1024) return
    var message
    try { message = JSON.parse(event.data) } catch (ignore) { return }
    if (!message || typeof message !== 'object' || Array.isArray(message)) return
    if (message.event === 'configure' && boot) {
      send({ action: 'configure', config: {
        defaultFonts: ['Arial', 'Helvetica', 'Verdana', 'Times New Roman', 'Courier New'],
        defaultVertexStyle: { html: 0, fontFamily: 'Arial' },
        defaultEdgeStyle: { html: 0, fontFamily: 'Arial' },
        enableCustomLibraries: false, libraries: 'general', customLibraries: [],
        plugins: [], mathJaxRender: false, compressXml: false,
        exportUrl: '', proxyUrl: '', aiEnabled: false
      }})
      return
    }
    if (message.event === 'init' && boot) {
      var ready = boot; boot = null; clearTimeout(ready.timer); status.textContent = ''; ready.resolve({ initialized: true }); return
    }
    if (message.event === 'autosave' && !loading && !readOnly) { changed(); return }
    if (message.event === 'save' && !readOnly) { sdk.emit('saveRequested', {}); return }
    if (message.event === 'exit') { sdk.emit('closeRequested', {}); return }
    // openLink, remoteInvoke, editor-selected imports and unsolicited exports are deliberately ignored.
    if (!pending || message.event !== pending.event || pending.format && message.format !== pending.format) return
    var echoed = message.message
    if (typeof echoed === 'string') { try { echoed = JSON.parse(echoed) } catch (ignoreEcho) { return } }
    // Require an echoed identifier when present, otherwise serialize the upstream operation.
    if (echoed && echoed.miniARequestId !== pending.id) return
    var task = pending; pending = null; clearTimeout(task.timer)
    if (message.error) task.reject(new Error('Diagram editor rejected the operation'))
    else task.resolve(message)
  }
  function initialize() {
    return new Promise(function(resolve, reject) {
      if (frame || disposed) { reject(new Error('Diagram editor has already initialized')); return }
      var url = new URL('editor/index.html', document.baseURI)
      var options = { embed: 1, proto: 'json', configure: 1, local: 1, pwa: 0, plugins: 0, offline: 1,
        ui: 'atlas', themes: 0, stealth: 1, lockdown: 1, suppressNewWindows: 1, saveAndExit: 0, noSaveBtn: 1, noExitBtn: 1 }
      Object.keys(options).forEach(function(key) { url.searchParams.set(key, String(options[key])) })
      frame = document.createElement('iframe')
      frame.title = 'Local diagram editor'
      frame.setAttribute('sandbox', 'allow-scripts')
      frame.setAttribute('referrerpolicy', 'no-referrer')
      frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'")
      boot = { resolve: resolve, reject: reject, timer: setTimeout(function() {
        if (boot) { var task = boot; boot = null; task.reject(new Error('Local diagram editor did not initialize; verify the pinned assets and browser conformance')) }
      }, 60000) }
      window.addEventListener('message', receive)
      frame.src = url.href
      container.appendChild(frame)
    })
  }
  async function open(params) {
    if (params.artifact && params.artifact.readOnly) fail('This reference editor does not support read-only documents')
    var native = await MiniADrawioNative.normalize(MiniADrawioNative.decodeContent(params.content))
    loading = true
    try { await request({ action: 'load', xml: native, autosave: 1, exportProtocol: true }, 'load') }
    finally { loading = false }
    committedSequence = sequence; readOnly = false
    return { opened: true, revision: params.artifact ? params.artifact.revision : 0, editSequence: sequence }
  }
  async function save() {
    var editSequence = sequence, result = await request({ action: 'export', format: 'xml' }, 'export')
    var native = await MiniADrawioNative.normalize(result.xml)
    return { mimeType: 'application/vnd.jgraph.mxfile', filename: 'diagram.drawio', content: { encoding: 'utf8', text: native }, editSequence: editSequence }
  }
  function decodeExport(uri, mime) {
    if (typeof uri !== 'string' || uri.length > Math.ceil(maxExport / 3) * 4 + 256) fail('Invalid or oversized diagram export')
    var prefix = 'data:' + mime + ';base64,'
    if (uri.indexOf(prefix) === 0) {
      var data = uri.substring(prefix.length), raw = atob(data)
      if (raw.length > maxExport) fail('Diagram export exceeds the size limit')
      if (mime === 'image/png') {
        if (raw.substring(0, 8) !== '\x89PNG\r\n\x1a\n') fail('Invalid PNG export')
        if (raw.length < 24 || raw.substring(12, 16) !== 'IHDR') fail('Invalid PNG header')
        function uint32(offset) { return raw.charCodeAt(offset) * 16777216 + raw.charCodeAt(offset + 1) * 65536 + raw.charCodeAt(offset + 2) * 256 + raw.charCodeAt(offset + 3) }
        var width = uint32(16), height = uint32(20)
        if (!width || !height || width > 8192 || height > 8192 || width * height > 16777216) fail('PNG dimensions exceed the export limit')
        return { encoding: 'base64', data: data }
      }
      var buffer = new Uint8Array(raw.length)
      for (var i = 0; i < raw.length; i++) buffer[i] = raw.charCodeAt(i)
      return { encoding: 'utf8', text: MiniADrawioNative.safeSvg(new TextDecoder('utf-8', { fatal: true }).decode(buffer)) }
    }
    if (mime === 'image/svg+xml' && /^data:image\/svg\+xml(?:;charset=utf-8)?,/i.test(uri)) {
      return { encoding: 'utf8', text: MiniADrawioNative.safeSvg(decodeURIComponent(uri.substring(uri.indexOf(',') + 1))) }
    }
    fail('Unsupported diagram export encoding')
  }
  function dispose() {
    disposed = true
    rejectPending(new Error('Diagram editor closed'))
    if (boot) { clearTimeout(boot.timer); boot.reject(new Error('Diagram editor closed')); boot = null }
    window.removeEventListener('message', receive)
    if (frame) frame.remove()
    frame = null; status.textContent = ''
    return {}
  }
  sdk = MiniAWebExtensionSDK.connect({ versions: ['1.0'], handlers: {
    initialize: initialize,
    open: open,
    update: open,
    create: async function() { await open({ content: { encoding: 'utf8', text: MiniADrawioNative.blank } }); changed(); return { created: true } },
    save: save,
    export: async function(params) {
      var format = params.mimeType === 'image/svg+xml' ? 'svg' : params.mimeType === 'image/png' ? 'png' : null
      if (!format) fail('Unsupported diagram export format')
      // Keep the light fallback palette; safeSvg drops upstream's adaptive CSS entirely.
      var result = await request({ action: 'export', format: format, theme: 'light', embedImages: false, embedFonts: false, scale: 1, transparent: true }, 'export')
      return { mimeType: params.mimeType, filename: 'diagram.' + format, content: decodeExport(result.data, params.mimeType), editSequence: sequence }
    },
    commit: function(params) {
      committedSequence = params.editSequence
      sdk.emit('dirtyChanged', { dirty: sequence !== committedSequence, editSequence: sequence })
      if (sequence === committedSequence) send({ action: 'status', message: 'Saved in Mini-A', modified: false })
    },
    focus: function() { if (frame) frame.focus(); return {} },
    cancel: function() { if (pending) unusable = true; rejectPending(new Error('Diagram operation cancelled; close and reopen it before retrying')); return { cancelled: true } },
    dispose: dispose
  }})
})()
