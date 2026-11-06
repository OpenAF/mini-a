// First-party UI and broker. Extension code is never inserted into this document.
var MiniAWebExtensionsUI = function(options) {
  options = options || {}
  var contract = MiniAWebExtensionContract, doc = options.document || document, win = options.window || window
  var registry = { extensions: [], defaults: {}, limits: {} }, instances = [], manager = null, disposed = false, notices = []
  var requests = 0, selected = [], previousFocus = null
  function element(tag, text, className) {
    var node = doc.createElement(tag)
    if (text !== undefined) node.textContent = text
    if (className) node.className = className
    return node
  }
  function button(text, action) { var node = element("button", text); node.type = "button"; node.addEventListener("click", action); return node }
  function url(path) { return options.url ? options.url(path.replace(/^\//, "")) : new URL(path.replace(/^\//, ""), doc.baseURI).href }
  function endpoint(path) {
    // Server-returned paths are already prefix-aware. Never accept another origin.
    var target = new URL(path, doc.baseURI)
    if (target.origin !== win.location.origin) throw new Error("Extension URL must be local")
    return target.href
  }
  function uuid() { return typeof options.uuid === "function" ? options.uuid() : options.uuid }
  function random() {
    var bytes = new Uint8Array(24)
    if (!win.crypto || !win.crypto.getRandomValues) throw new Error("Secure random generation is unavailable")
    win.crypto.getRandomValues(bytes)
    return Array.prototype.map.call(bytes, function(v) { return ("0" + v.toString(16)).slice(-2) }).join("")
  }
  async function api(route, action, values) {
    var request = { headers: { Accept: "application/json" }, cache: "no-store" }
    if (action) {
      request.method = "POST"; request.headers["Content-Type"] = "application/json; charset=utf-8"
      var payload = Object.assign({ action: action }, values || {})
      // Keep an 8 MiB native document within the bounded HTTP envelope even if
      // most characters would need six-byte JSON Unicode escapes.
      if (payload.content && payload.content.encoding === "utf8") payload.content = fromBytes(new TextEncoder().encode(payload.content.text))
      // OpenAF HTTP implementations differ in request-body charset decoding. JSON
      // escapes preserve Unicode through ASCII-only transports, including surrogate pairs.
      request.body = JSON.stringify(payload).replace(/[\u007f-\uffff]/g, function(character) { return "\\u" + ("0000" + character.charCodeAt(0).toString(16)).slice(-4) })
    }
    var response = await win.fetch(url(route), request), value = await response.json()
    if (!response.ok || value.error) {
      var error = new Error(typeof value.error === "string" ? value.error : value.error && value.error.message || "Extension request failed")
      error.code = value.code || value.error && value.error.code || "request_failed"; error.status = response.status
      throw error
    }
    return value
  }
  function manifest(item) { return item.manifest || item }
  function has(item, cap) { return (manifest(item).capabilities || []).indexOf(cap) >= 0 }
  function nativeFormat(artifact) { return artifact.native ? artifact.native.mimeType : artifact.mimeType }
  function nativeName(artifact) { return artifact.native ? artifact.native.filename : artifact.filename }
  function enabled(item) { return item.enabled === true && item.status !== "incompatible" && item.status !== "unavailable" }
  function failure(error) { return String(error && error.message || error || "Operation failed").slice(0, 1000) }
  function announce(text) { if (manager) manager.status.textContent = text }
  function dialog(title) {
    var node = element("dialog", undefined, "mini-a-extension-dialog"), heading = element("h2", title), header = element("header", undefined, "mini-a-extension-header")
    heading.id = "mini-a-extension-heading-" + (++requests)
    node.setAttribute("aria-labelledby", heading.id); header.appendChild(heading); node.appendChild(header)
    return { node: node, header: header, heading: heading }
  }
  function show(node) { doc.body.appendChild(node); node.showModal() }
  function choose(title, choices) {
    return new Promise(function(resolve) {
      var view = dialog(title), actions = element("div", undefined, "mini-a-extension-actions"), done = false
      function finish(value) { if (done) return; done = true; view.node.close(); view.node.remove(); resolve(value) }
      choices.forEach(function(choice) { actions.appendChild(button(choice.label, function() { finish(choice.value) })) })
      view.node.appendChild(actions)
      view.node.addEventListener("cancel", function(event) { event.preventDefault(); finish(null) })
      show(view.node)
    })
  }
  async function refresh() {
    registry = await api("web-extensions")
    if (!Array.isArray(registry.extensions)) throw new Error("Invalid extension registry")
    return registry
  }
  function candidates(artifact) {
    var mime = nativeFormat(artifact), name = nativeName(artifact) || "", type = artifact.artifactType
    var preference = null
    try { preference = JSON.parse(win.localStorage.getItem("mini-a-web-extension-preferences") || "{}")[mime] } catch (_) {}
    return registry.extensions.filter(function(item) { return enabled(item) && has(item, "render") }).map(function(item) {
      var score = 0
      ;(manifest(item).formats || []).forEach(function(format) {
        var exact = (format.mimeTypes || []).indexOf(mime) >= 0, typed = type && (format.artifactTypes || []).indexOf(type) >= 0
        var suffix = (format.extensions || []).some(function(ext) { return name.toLowerCase().slice(-ext.length) === ext })
        score = Math.max(score, exact && typed ? 30 : exact ? 20 : suffix ? 10 : 0)
      })
      if (score && manifest(item).id === preference) score += 200
      else if (score && registry.defaults && manifest(item).id === registry.defaults[mime]) score += 100
      return { item: item, score: score }
    }).filter(function(value) { return value.score > 0 }).sort(function(a, b) { return b.score - a.score || manifest(a.item).id.localeCompare(manifest(b.item).id) })
  }
  async function resolve(artifact, explicit) {
    await refresh()
    if (explicit) {
      var selected = registry.extensions.filter(function(item) { return enabled(item) && manifest(item).id === explicit })[0]
      if (!selected) throw new Error("The selected extension is unavailable")
      return selected
    }
    var list = candidates(artifact)
    if (!list.length) throw new Error("No enabled extension supports this artifact. Enable a compatible extension or download the native file.")
    if (list.length === 1 || list[0].score > list[1].score && list[0].score >= 100) return list[0].item
    var id = await choose("Open with", list.map(function(value) { return { label: manifest(value.item).name, value: manifest(value.item).id } }).concat([{ label: "Cancel", value: null }]))
    return id ? list.filter(function(value) { return manifest(value.item).id === id })[0].item : null
  }
  function toBytes(content) {
    contract.content(content, contract.limits.exportBytes)
    if (content.encoding === "utf8") return new TextEncoder().encode(content.text)
    var binary = win.atob(content.data), bytes = new Uint8Array(binary.length)
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  }
  function fromBytes(bytes) {
    var text = ""
    for (var i = 0; i < bytes.length; i += 8192) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192))
    return { encoding: "base64", data: win.btoa(text) }
  }
  function download(content, mime, filename) {
    var bytes = toBytes(content), blob = new Blob([bytes], { type: mime }), objectUrl = URL.createObjectURL(blob)
    var anchor = element("a"); anchor.href = objectUrl; anchor.download = String(filename || "artifact").replace(/[\\/\u0000-\u001f\u007f]/g, "_").slice(0, 200)
    doc.body.appendChild(anchor); anchor.click(); anchor.remove()
    setTimeout(function() { URL.revokeObjectURL(objectUrl) }, 1000)
  }
  function admitExport(content, mime) {
    if (mime === "image/svg+xml") {
      if (typeof options.sanitizeSvg !== "function" || typeof options.validateSvg !== "function") throw new Error("Safe SVG export is unavailable; export PNG or the native document instead")
      var text = new TextDecoder("utf-8", { fatal: true }).decode(toBytes(content)), safe = options.sanitizeSvg(text)
      if (!safe || options.validateSvg(safe).valid !== true) throw new Error("Extension returned an unsafe SVG; export PNG or the native document instead")
      return { encoding: "utf8", text: safe }
    }
    if (mime === "image/png") {
      var bytes = toBytes(content), signature = [137, 80, 78, 71, 13, 10, 26, 10]
      if (bytes.length < 33 || signature.some(function(value, i) { return bytes[i] !== value }) || String.fromCharCode.apply(null, bytes.subarray(12, 16)) !== "IHDR") throw new Error("Extension returned an invalid PNG")
      var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), width = view.getUint32(16), height = view.getUint32(20)
      if (!width || !height || width > 8192 || height > 8192 || width * height > 16777216) throw new Error("PNG exceeds safe image dimensions")
    }
    return content
  }
  async function mount(item, artifact, content, create) {
    if (disposed) throw new Error("Extensions are unavailable")
    if (instances.length >= 4) throw new Error("Close an editor before opening another")
    var definition = contract.validateManifest(manifest(item)), session = uuid()
    var binding = await api("web-extensions", "bind", { uuid: session, extensionId: definition.id, digest: item.digest, documentId: artifact.id || undefined })
    var limits = binding.limits || {}, resource = definition.resources || {}
    var instance = {
      binding: binding.binding, id: binding.instanceId || random(), generation: random(), session: session,
      extension: item, definition: definition, artifact: artifact, revision: artifact.revision || 0,
      dirty: !!create || !artifact.id, editSequence: 0, savedSequence: 0, pending: Object.create(null), port: null,
      disposed: false, revoked: false, busy: false, violations: 0, eventStart: Date.now(), events: 0,
      limits: { nativeBytes: Math.min(limits.nativeBytes || limits.maxArtifactBytes || contract.limits.nativeBytes, resource.maxArtifactBytes || contract.limits.nativeBytes), exportBytes: Math.min(limits.exportBytes || limits.maxExportBytes || contract.limits.exportBytes, resource.maxExportBytes || contract.limits.exportBytes), controlBytes: contract.limits.controlBytes, operationTimeoutMs: resource.operationTimeoutMs || 15000 },
      permissions: (binding.permissions || definition.permissions).filter(function(p) { return definition.permissions.indexOf(p) >= 0 })
    }
    var permissionFor = { render: "artifact.read", edit: "artifact.propose-write", create: "artifact.propose-write", export: "artifact.propose-export", selection: "selection.report", fullscreen: "ui.fullscreen" }
    instance.capabilities = definition.capabilities.filter(function(cap) { return !permissionFor[cap] || instance.permissions.indexOf(permissionFor[cap]) >= 0 })
    instance.originalContent = content
    var view = dialog(artifact.title || definition.name), toolbar = element("div", undefined, "mini-a-extension-actions")
    var status = element("p", "Loading extension…", "mini-a-extension-status"), stage = element("div", undefined, "mini-a-extension-stage")
    status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite")
    var iframe = element("iframe"); iframe.title = definition.name + " container"; iframe.referrerPolicy = "no-referrer"
    stage.appendChild(iframe); view.node.appendChild(toolbar); view.node.appendChild(status); view.node.appendChild(stage)
    instance.view = view; instance.status = status; instance.iframe = iframe; instance.trigger = doc.activeElement
    function updateStatus(text) { status.textContent = text || (instance.dirty ? "Unsaved changes" : "Saved"); view.heading.textContent = (instance.artifact.title || definition.name) + (instance.dirty ? " *" : "") }
    function envelope(kind) { return { protocol: contract.protocol, version: "1.0", kind: kind, instanceId: instance.id } }
    function notify(name, params) { var message = envelope("event"); message.event = name; message.params = params; contract.validateMessage(message, { instanceId: instance.id }); instance.port.postMessage(message) }
    function request(method, params) {
      if (instance.disposed || instance.revoked && method !== "dispose" || !instance.port) return Promise.reject(new Error("Extension is unavailable"))
      if (Object.keys(instance.pending).length >= contract.limits.pending) return Promise.reject(new Error("Extension has too many pending operations"))
      var capability = { open: "render", update: "edit", save: "edit", create: "create", export: "export", inspect: "inspect" }[method]
      if (capability && instance.capabilities.indexOf(capability) < 0 && !(method === "save" && instance.capabilities.indexOf("create") >= 0)) return Promise.reject(new Error("Extension capability is unavailable"))
      var id = "request-" + (++requests), message = envelope("request"); message.id = id; message.method = method; message.params = params || {}
      contract.validateMessage(message, { instanceId: instance.id, maxContentBytes: instance.limits.nativeBytes })
      return new Promise(function(resolveRequest, rejectRequest) {
        var timeout = method === "dispose" ? 2000 : method === "initialize" || method === "export" ? 60000 : instance.limits.operationTimeoutMs
        var timer = setTimeout(function() {
          delete instance.pending[id]
          var error = new Error("Extension operation timed out"); error.code = "timeout"; rejectRequest(error)
          if (method !== "dispose" && method !== "cancel" && !instance.disposed) request("cancel", { requestId: id }).catch(function() {})
        }, timeout)
        instance.pending[id] = { resolve: resolveRequest, reject: rejectRequest, timer: timer, method: method }
        instance.port.postMessage(message)
      })
    }
    instance.request = request
    function retirePending(reason, onlyOperations) {
      var ids = []
      Object.keys(instance.pending).forEach(function(id) {
        var pending = instance.pending[id]
        if (onlyOperations && ["save", "export", "open", "create", "update"].indexOf(pending.method) < 0) return
        delete instance.pending[id]; clearTimeout(pending.timer)
        var error = new Error(reason); error.code = "cancelled"; pending.reject(error); ids.push(id)
      })
      return ids
    }
    function admitSave(result) {
      if (instance.disposed || instance.revoked) throw new Error("Extension binding was revoked before saving")
      if (result.editSequence < instance.savedSequence || result.editSequence > instance.editSequence) throw new Error("Extension returned an unobserved document revision")
      if (result.mimeType !== nativeFormat(instance.artifact)) throw new Error("Extension returned a different native format")
      contract.content(result.content, instance.limits.nativeBytes)
      instance.recoveryContent = result.content
    }
    async function save() {
      if (instance.busy || instance.disposed) return false
      if (instance.permissions.indexOf("artifact.propose-write") < 0) throw new Error("Saving was not permitted")
      instance.busy = true; updateStatus("Saving…")
      try {
        var result = await request("save"), mime = nativeFormat(instance.artifact)
        admitSave(result)
        var response = await api("web-documents", "save", { uuid: session, binding: instance.binding, id: instance.artifact.id || undefined, expectedRevision: instance.revision, title: instance.artifact.title, mimeType: mime, filename: nativeName(instance.artifact), artifactType: instance.artifact.artifactType, content: result.content })
        var saved = response.artifact || response
        if (instance.disposed || instance.revoked) return false
        if (!saved.id || !Number.isInteger(saved.revision)) throw new Error("Invalid save receipt")
        instance.artifact = saved; instance.revision = saved.revision; instance.savedSequence = result.editSequence
        instance.originalContent = result.content
        instance.dirty = instance.editSequence > result.editSequence
        notify("commit", { revision: saved.revision, editSequence: result.editSequence })
        updateStatus(); return true
      } catch (error) {
        instance.dirty = true; updateStatus(error.status === 409 ? "A newer revision exists. Your edits are still open; save a copy or reopen the document." : failure(error)); return false
      } finally { instance.busy = false }
    }
    async function closeNow(force, reason) {
      if (instance.disposed) return true
      if (!force && instance.busy) { updateStatus("Wait for the current operation, or cancel it, before closing."); return false }
      if (!force && instance.dirty) {
        var answer = await choose("Save changes before closing?", [{ label: "Save", value: "save" }, { label: "Discard", value: "discard" }, { label: "Cancel", value: null }])
        if (instance.disposed || instance.revoked) return true
        if (!answer || answer === "save" && !await save()) return false
        if (answer === "save" && instance.dirty) { updateStatus("The document changed while saving. Save again before closing."); return false }
      }
      instance.revoked = true
      if (rejectMount) rejectMount(new Error(reason || "Extension was closed"))
      retirePending("Extension was closed")
      // Revoke server authority before waiting for an unresponsive guest's disposal.
      api("web-extensions", "release", { binding: instance.binding }).catch(function() {})
      try { await request("dispose") } catch (_) {}
      instance.disposed = true; clearTimeout(instance.mountTimer); clearInterval(instance.heartbeat)
      win.removeEventListener("message", receiveContainer)
      if (instance.observer) instance.observer.disconnect()
      if (instance.port) { instance.port.onmessage = null; instance.port.close(); instance.port = null }
      Object.keys(instance.pending).forEach(function(id) { clearTimeout(instance.pending[id].timer); instance.pending[id].reject(new Error("Extension was closed")) }); instance.pending = Object.create(null)
      iframe.remove(); view.node.close(); view.node.remove()
      instances = instances.filter(function(value) { return value !== instance })
      if (instance.trigger && instance.trigger.isConnected) instance.trigger.focus()
      if (force && reason && !disposed) {
        var notice = dialog("Extension disconnected")
        notice.node.appendChild(element("p", reason))
        notice.node.appendChild(element("p", instance.dirty ? "The saved document is unchanged. Unsaved edits may not have been returned by the editor." : "Your saved document remains in the library."))
        if (instance.recoveryContent) notice.node.appendChild(button("Download last returned native snapshot", function() { download(instance.recoveryContent, "application/octet-stream", nativeName(instance.artifact)) }))
        function dismiss() { notice.node.close(); notice.node.remove(); notices = notices.filter(function(node) { return node !== notice.node }) }
        notice.node.appendChild(button("Close", dismiss)); notice.node.addEventListener("cancel", function(event) { event.preventDefault(); dismiss() }); notices.push(notice.node); show(notice.node)
      }
      return true
    }
    function close(force, reason) {
      if (instance.closing && (!force || instance.revoked)) return instance.closing
      instance.closing = closeNow(force, reason).then(function(result) { if (!result) instance.closing = null; return result }, function(error) { instance.closing = null; throw error })
      return instance.closing
    }
    instance.close = close
    instance.save = save
    toolbar.appendChild(button("Close", function() { close(false) }))
    if ((has(item, "edit") || has(item, "create")) && instance.permissions.indexOf("artifact.propose-write") >= 0) toolbar.appendChild(button("Save", save))
    if ((has(item, "edit") || has(item, "create")) && instance.permissions.indexOf("artifact.propose-write") >= 0) {
      toolbar.appendChild(button("Save as copy", async function() {
        if (instance.busy) return
        instance.busy = true; updateStatus("Saving a new copy…")
        var copyBinding = null
        try {
          var result = await request("save"), mime = nativeFormat(instance.artifact)
          admitSave(result)
          copyBinding = await api("web-extensions", "bind", { uuid: session, extensionId: definition.id, digest: item.digest })
          if (instance.disposed || instance.revoked) throw new Error("Extension was closed before saving")
          var response = await api("web-documents", "save", { uuid: session, binding: copyBinding.binding, expectedRevision: 0, title: (instance.artifact.title + " copy").slice(0, 200), mimeType: mime, filename: nativeName(instance.artifact), artifactType: instance.artifact.artifactType, content: result.content })
          var saved = response.artifact || response, previous = instance.binding
          if (instance.disposed || instance.revoked) throw new Error("Extension was closed while saving")
          if (!saved.id || !Number.isInteger(saved.revision)) throw new Error("Invalid save receipt")
          instance.binding = copyBinding.binding; copyBinding = null
          instance.artifact = saved; instance.revision = saved.revision; instance.savedSequence = result.editSequence; instance.originalContent = result.content
          instance.dirty = instance.editSequence > result.editSequence
          notify("commit", { revision: saved.revision, editSequence: result.editSequence })
          api("web-extensions", "release", { binding: previous }).catch(function() {})
          updateStatus("Saved a separate document")
        } catch (error) { updateStatus(failure(error)) }
        finally { instance.busy = false; if (copyBinding) api("web-extensions", "release", { binding: copyBinding.binding }).catch(function() {}) }
      }))
      if (has(item, "edit")) toolbar.appendChild(button("Reload saved revision", async function() {
        if (instance.busy) return
        if (!instance.artifact.id) { updateStatus("This document has no saved revision"); return }
        if (instance.dirty && !await choose("Discard unsaved edits and reload the saved revision?", [{ label: "Reload", value: true }, { label: "Cancel", value: false }])) return
        instance.busy = true
        try {
          var loaded = await api("web-documents", "read", { uuid: session, id: instance.artifact.id })
          var updated = await request("update", { artifact: { handle: "document-" + random(), revision: loaded.artifact.revision, title: loaded.artifact.title, mimeType: nativeFormat(loaded.artifact), readOnly: false }, content: loaded.content })
          if (updated.opened !== true) throw new Error("Extension did not reload the saved document")
          if (updated.editSequence < instance.savedSequence || updated.editSequence > instance.editSequence) throw new Error("Extension returned an unobserved reload revision")
          instance.artifact = loaded.artifact; instance.revision = loaded.artifact.revision; instance.originalContent = loaded.content
          instance.savedSequence = updated.editSequence; instance.dirty = instance.editSequence > updated.editSequence
          notify("commit", { revision: instance.revision, editSequence: updated.editSequence }); updateStatus()
        } catch (error) { updateStatus(failure(error)) } finally { instance.busy = false }
      }))
    }
    toolbar.appendChild(button("Save native copy", async function() {
      if (instance.busy) return
      instance.busy = true
      try { var result = has(item, "edit") || has(item, "create") ? await request("save") : { content: instance.originalContent }; contract.content(result.content, instance.limits.nativeBytes); download(result.content, "application/octet-stream", nativeName(instance.artifact)); updateStatus("Native copy downloaded. Server save state is unchanged.") } catch (error) { updateStatus(failure(error)) } finally { instance.busy = false }
    }))
    if (has(item, "export") && instance.permissions.indexOf("artifact.propose-export") >= 0) {
      ;(definition.exports || []).forEach(function(format) { toolbar.appendChild(button("Export " + format.extension.slice(1).toUpperCase(), async function() {
        if (instance.busy) return
        instance.busy = true; updateStatus("Exporting…")
        try {
          var result = await request("export", { mimeType: format.mimeType })
          if (result.mimeType !== format.mimeType) throw new Error("Extension returned an unexpected export format")
          contract.content(result.content, instance.limits.exportBytes)
          var safeContent = admitExport(result.content, format.mimeType)
          // The declared suffix wins over a guest-provided filename. Never insert rich content in host DOM.
          var basename = (result.filename || instance.artifact.title).replace(/\.[^.]+$/, "")
          download(safeContent, "application/octet-stream", basename + format.extension)
          updateStatus("Export downloaded")
        } catch (error) { updateStatus(failure(error)) } finally { instance.busy = false }
      })) })
    }
    if (has(item, "fullscreen") && instance.permissions.indexOf("ui.fullscreen") >= 0) toolbar.appendChild(button("Expand editor", function() { view.node.classList.toggle("mini-a-extension-fullscreen") }))
    toolbar.appendChild(button("Use by default for this format", function() {
      try {
        var preferences = JSON.parse(win.localStorage.getItem("mini-a-web-extension-preferences") || "{}")
        if (!contract.map(preferences)) preferences = {}
        preferences[nativeFormat(instance.artifact)] = definition.id
        win.localStorage.setItem("mini-a-web-extension-preferences", JSON.stringify(preferences))
        updateStatus("Preferred editor saved. Artifacts still open only when requested.")
      } catch (_) { updateStatus("Browser preferences could not be saved") }
    }))
    if (options.agentAvailable && options.onSelectArtifact) toolbar.appendChild(button("Use in next prompt", function() {
      if (!instance.artifact.id || instance.dirty) { updateStatus("Save this document before using it in a prompt."); return }
      var reference = { id: instance.artifact.id, revision: instance.revision }; selected = [reference]; options.onSelectArtifact(reference); updateStatus("Saved document selected for the next prompt")
    }))
    toolbar.appendChild(button("Cancel operation", function() {
      retirePending("Operation cancelled by user", true).forEach(function(id) { request("cancel", { requestId: id }).catch(function() {}) })
      updateStatus("Cancellation requested; committed saves cannot be undone")
    }))
    view.node.addEventListener("cancel", function(event) { event.preventDefault(); close(false) })
    var resolveMount, rejectMount
    var ready = new Promise(function(resolve, reject) { resolveMount = resolve; rejectMount = reject })
    async function receivePort(event) {
      var message = event.data
      try {
        var pending = message && instance.pending[message.id]
        contract.validateMessage(message, { instanceId: instance.id, method: pending && pending.method, maxContentBytes: pending && pending.method === "save" ? instance.limits.nativeBytes : instance.limits.exportBytes })
        if (message.kind === "response") {
          if (!pending) return
          clearTimeout(pending.timer); delete instance.pending[message.id]
          if (message.error) { var error = new Error(message.error.message); error.code = message.error.code; pending.reject(error) } else pending.resolve(message.result)
          return
        }
        if (message.kind !== "event" || message.event === "commit") throw new Error("Unexpected guest operation")
        if (Date.now() - instance.eventStart >= 1000) { instance.eventStart = Date.now(); instance.events = 0 }
        if (++instance.events > 60) throw new Error("Extension event rate exceeded")
        if (message.event === "dirtyChanged") {
          if (!has(item, "edit") && !has(item, "create")) throw new Error("Editing capability not granted")
          if (message.params.editSequence < instance.editSequence) return
          instance.editSequence = message.params.editSequence
          // A guest cannot clear uncommitted host dirty state by reporting false.
          instance.dirty = message.params.dirty || instance.editSequence > instance.savedSequence || instance.dirty
          updateStatus()
        } else if (message.event === "selectionChanged") {
          if (instance.permissions.indexOf("selection.report") < 0) throw new Error("Selection permission not granted")
          instance.selection = message.params
        } else if (message.event === "saveRequested") updateStatus("The extension requested a save. Use the host Save button to confirm.")
        else if (message.event === "closeRequested") close(false)
        else if (message.event === "error") updateStatus(message.params.message)
      } catch (error) {
        if (pending && message && message.kind === "response") {
          clearTimeout(pending.timer); delete instance.pending[message.id]; pending.reject(error)
        }
        updateStatus(failure(error))
        if (++instance.violations >= 3) { updateStatus("Extension disconnected after invalid messages"); close(true, "The extension sent invalid or unauthorized messages.") }
      }
    }
    function receiveContainer(event) {
      var data = event.data
      if (instance.disposed || event.source !== iframe.contentWindow || event.origin !== win.location.origin || !contract.map(data) || data.type !== "mini-a:web-extension:container" || data.instanceId !== instance.id || data.nonce !== instance.generation) return
      if (data.phase === "failed") { rejectMount(new Error(data.message || "Extension failed")); updateStatus(data.message || "Extension failed"); if (instance.port) close(true, data.message || "Extension failed"); return }
      if (data.phase !== "connected" || instance.port || !event.ports || event.ports.length !== 1 || data.version !== "1.0") return
      instance.port = event.ports[0]; instance.port.onmessage = receivePort; instance.port.start(); clearTimeout(instance.mountTimer); resolveMount()
    }
    win.addEventListener("message", receiveContainer)
    iframe.addEventListener("load", function() {
      if (instance.port) { updateStatus("Extension container reloaded"); close(true, "The extension container unexpectedly reloaded."); return }
      iframe.contentWindow.postMessage({ type: "mini-a:web-extension:container", phase: "mount", instanceId: instance.id, nonce: instance.generation, entryUrl: endpoint(binding.entryUrl || item.entryUrl) }, win.location.origin)
    })
    instance.mountTimer = setTimeout(function() { rejectMount(new Error("Extension did not become ready")) }, 60000)
    iframe.src = endpoint(binding.frameUrl || item.frameUrl)
    instances.push(instance); show(view.node)
    // Binding leases also cover slow editor startup, before the first open completes.
    instance.heartbeat = setInterval(function() { api("web-extensions", "heartbeat", { binding: instance.binding }).catch(function(error) { updateStatus(failure(error)); close(true, failure(error)) }) }, 15000)
    try {
      await ready
      var initialized = await request("initialize", { apiVersion: "1.0", capabilities: instance.capabilities, permissions: instance.permissions, limits: instance.limits, theme: doc.body.classList.contains("markdown-body-dark") ? "dark" : "light", locale: (win.navigator.language || "en").replace(/[^A-Za-z0-9-]/g, ""), viewport: { width: stage.clientWidth, height: stage.clientHeight } })
      if (initialized.initialized !== true) throw new Error("Extension did not acknowledge initialization")
      var opened
      if (create) { opened = await request("create", { title: artifact.title, mimeType: nativeFormat(artifact) }); if (opened.created !== true) throw new Error("Extension did not create a document") }
      else { opened = await request("open", { artifact: { handle: "document-" + random(), revision: instance.revision, title: artifact.title, mimeType: nativeFormat(artifact), readOnly: instance.permissions.indexOf("artifact.propose-write") < 0 }, content: content }); if (opened.opened !== true) throw new Error("Extension did not open the document") }
      await request("focus")
      updateStatus()
      if (typeof ResizeObserver !== "undefined") {
        instance.observer = new ResizeObserver(function() { if (!instance.disposed) request("resize", { width: stage.clientWidth, height: stage.clientHeight }).catch(function() {}) })
        instance.observer.observe(stage)
      }
      return instance
    } catch (error) { updateStatus(failure(error)); await close(true); throw error }
  }
  async function openArtifact(reference, explicit) {
    await api("web-documents", "link", { uuid: uuid(), id: reference.id })
    var loaded = await api("web-documents", "read", { uuid: uuid(), id: reference.id })
    var item = await resolve(loaded.artifact, explicit)
    if (item) return mount(item, loaded.artifact, loaded.content, false)
  }
  async function importFile(file) {
    if (!file || file.size > contract.limits.nativeBytes) throw new Error("Artifact exceeds the 8 MiB limit")
    var artifact = { title: file.name.slice(0, 200), revision: 0, native: { mimeType: file.type || "application/octet-stream", filename: file.name.slice(0, 200) } }
    var item = await resolve(artifact)
    if (!item) return
    // A filename match suggests a format; the isolated adapter must admit its actual contents.
    var formats = manifest(item).formats || []
    if (!formats.some(function(format) { return format.mimeTypes.indexOf(artifact.native.mimeType) >= 0 })) {
      var matched = formats.filter(function(format) { return (format.extensions || []).some(function(ext) { return file.name.toLowerCase().slice(-ext.length) === ext }) })[0]
      if (matched) artifact.native.mimeType = matched.mimeTypes[0]
    }
    return mount(item, artifact, fromBytes(new Uint8Array(await file.arrayBuffer())), false)
  }
  async function populateManager() {
    if (!manager) return
    manager.list.replaceChildren(); manager.documents.replaceChildren(); announce("Loading…")
    try {
      await refresh()
      registry.extensions.forEach(function(item) {
        var definition = manifest(item), row = element("section", undefined, "mini-a-extension-item")
        row.appendChild(element("h3", definition.name || definition.id || "Invalid extension"))
        row.appendChild(element("p", (definition.version || "") + " · " + (item.status || (item.enabled ? "enabled" : "disabled"))))
        if (item.reason) row.appendChild(element("p", item.reason))
        if (definition.description) row.appendChild(element("p", definition.description))
        if (item.digest) row.appendChild(button(item.enabled ? "Disable" : "Enable", async function() {
          try {
            if (item.enabled) {
              var matching = instances.filter(function(instance) { return instance.definition.id === definition.id })
              for (var i = 0; i < matching.length; i++) if (!await matching[i].close(false)) return
              await api("web-extensions", "disable", { extensionId: definition.id })
            } else {
              var answer = await choose("Enable " + definition.name + "? Permissions: " + (definition.permissions || []).join(", ") + ". Only open documents you trust this extension to read.", [{ label: "Enable", value: true }, { label: "Cancel", value: false }])
              if (!answer) return
              await api("web-extensions", "enable", { extensionId: definition.id, digest: item.digest, permissions: definition.permissions })
            }
            await populateManager()
          } catch (error) { announce(failure(error)) }
        }))
        if (enabled(item) && has(item, "create")) row.appendChild(button("New", async function() {
          try {
            var format = (definition.formats || [])[0]
            if (!format) throw new Error("Extension has no native create format")
            await mount(item, { title: "Untitled", revision: 0, native: { mimeType: format.mimeTypes[0], filename: "untitled" + ((format.extensions || [])[0] || ".bin") } }, null, true)
          } catch (error) { announce(failure(error)) }
        }))
        manager.list.appendChild(row)
      })
      if (!registry.extensions.length) manager.list.appendChild(element("p", "No extensions found in the configured local directories."))
      var library = await api("web-documents", "list", { uuid: uuid() })
      ;(library.documents || library.artifacts || []).forEach(function(artifact) {
        var row = element("section", undefined, "mini-a-extension-item")
        row.appendChild(element("h3", artifact.title)); row.appendChild(element("p", nativeFormat(artifact) + " · revision " + artifact.revision))
        row.appendChild(button("Open with", function() { openArtifact(artifact).catch(function(error) { announce(failure(error)) }) }))
        row.appendChild(button("Download native", async function() { try { await api("web-documents", "link", { uuid: uuid(), id: artifact.id }); var loaded = await api("web-documents", "read", { uuid: uuid(), id: artifact.id }); download(loaded.content, "application/octet-stream", nativeName(loaded.artifact)) } catch (error) { announce(failure(error)) } }))
        row.appendChild(button("Delete", async function() { if (await choose("Delete this saved document?", [{ label: "Delete", value: true }, { label: "Cancel", value: false }])) { try { await api("web-documents", "delete", { uuid: uuid(), id: artifact.id }); await populateManager() } catch (error) { announce(failure(error)) } } }))
        manager.documents.appendChild(row)
      })
      announce("Extensions run only when you open them. Saved documents remain available after an extension is removed.")
    } catch (error) { announce(failure(error)) }
  }
  async function openManager() {
    if (disposed) return
    if (manager) { if (!manager.view.node.open) manager.view.node.showModal(); await populateManager(); return }
    previousFocus = doc.activeElement
    var view = dialog("Extensions"), actions = element("div", undefined, "mini-a-extension-actions"), status = element("p", "", "mini-a-extension-status")
    status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite")
    var list = element("div"), documents = element("div"), input = element("input")
    input.type = "file"; input.hidden = true; input.addEventListener("change", function() { importFile(input.files[0]).catch(function(error) { announce(failure(error)) }); input.value = "" })
    function closeManager() { view.node.close(); if (previousFocus && previousFocus.isConnected) previousFocus.focus() }
    actions.appendChild(button("Open artifact", function() { input.click() }))
    actions.appendChild(button("Refresh installed extensions", async function() { try { await api("web-extensions", "refresh", {}); await populateManager() } catch (error) { announce(failure(error)) } }))
    actions.appendChild(button("Close", closeManager))
    view.node.addEventListener("cancel", function(event) { event.preventDefault(); closeManager() })
    view.node.appendChild(actions); view.node.appendChild(input); view.node.appendChild(status); view.node.appendChild(element("h3", "Installed extensions")); view.node.appendChild(list); view.node.appendChild(element("h3", "Saved documents")); view.node.appendChild(documents)
    manager = { view: view, list: list, documents: documents, status: status }; show(view.node); await populateManager()
  }
  async function beforeSessionChange() {
    for (var i = instances.length - 1; i >= 0; i--) if (!await instances[i].close(false)) return false
    selected = []
    if (manager) manager.view.node.close()
    return true
  }
  function renderArtifacts(container, artifacts) {
    if (!container || !Array.isArray(artifacts)) return
    artifacts.forEach(function(artifact) {
      if (!artifact || !/^[A-Za-z0-9-]{1,128}$/.test(artifact.id || artifact.artifactId || "")) return
      var reference = { id: artifact.id || artifact.artifactId, revision: artifact.revision }
      var row = element("div", undefined, "mini-a-extension-artifact"), title = element("span", artifact.title || "Saved artifact")
      row.appendChild(title); row.appendChild(button("Open with", function() { openArtifact(reference).catch(function(error) { choose(failure(error), [{ label: "Close", value: null }]) }) })); container.appendChild(row)
    })
  }
  function unload(event) { if (instances.some(function(instance) { return instance.dirty })) { event.preventDefault(); event.returnValue = "" } }
  win.addEventListener("beforeunload", unload)
  return {
    openManager: openManager, openArtifact: openArtifact, beforeSessionChange: beforeSessionChange, renderArtifacts: renderArtifacts,
    selectedReferences: function() { return selected.slice() },
    dispose: async function() { disposed = true; win.removeEventListener("beforeunload", unload); var active = instances.slice(); for (var i = 0; i < active.length; i++) await active[i].close(true); if (manager) { manager.view.node.remove(); manager = null } notices.forEach(function(node) { node.remove() }); notices = [] }
  }
}
if (typeof module !== "undefined" && module.exports) module.exports = MiniAWebExtensionsUI
