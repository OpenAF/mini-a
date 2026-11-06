// Optional guest SDK. Only the parent-bound port carries document data.
var MiniAWebExtensionSDK = (function() {
  function connect(options) {
    options = options || {}
    var win = options.window || window, contract = MiniAWebExtensionContract
    var handlers = options.handlers || {}, versions = options.versions || ["1.0"]
    var port = null, instanceId = null, active = true, initialized = false, pending = Object.create(null), seen = Object.create(null), order = []
    var permissions = [], granted = [], violations = 0, eventCount = 0, eventStart = Date.now(), queuedDirty = null
    var resolveReady, rejectReady
    var ready = new Promise(function(resolve, reject) { resolveReady = resolve; rejectReady = reject })
    // Authors can await ready, but a failed mount must not cause an unhandled rejection.
    ready.catch(function() {})
    function envelope(kind) { return { protocol: contract.protocol, version: "1.0", kind: kind, instanceId: instanceId } }
    function send(message) { if (active && port) { contract.validateMessage(message, { instanceId: instanceId }); port.postMessage(message) } }
    function flushDirty() {
      if (!queuedDirty || !active || !initialized) return
      var message = envelope("event"); message.event = "dirtyChanged"; message.params = queuedDirty; queuedDirty = null; send(message)
    }
    function errorFor(error) { return { code: /^[a-z][a-z0-9_]*$/.test(error && error.code || "") ? error.code : "extension_error", message: String(error && error.message || error || "Extension operation failed").slice(0, 1000), retryable: false } }
    function close() {
      if (!active) return
      active = false
      queuedDirty = null
      win.removeEventListener("message", bootstrap)
      win.removeEventListener("pagehide", close)
      clearTimeout(timer)
      Object.keys(pending).forEach(function(id) { pending[id].cancelled = true })
      if (port) { port.onmessage = null; port.close(); port = null }
      rejectReady(new Error("Extension connection closed"))
    }
    function allowed(method) {
      var cap = { open: "render", update: "edit", save: "edit", create: "create", export: "export", inspect: "inspect" }[method]
      if (cap && granted.indexOf(cap) < 0 && !(method === "save" && granted.indexOf("create") >= 0)) contract.fail("Capability not granted", "permission_denied")
    }
    async function receive(event) {
      var message = event.data, admitted = false
      try {
        contract.validateMessage(message, { instanceId: instanceId })
        if (message.kind === "event") {
          if (message.event !== "commit" || !initialized) contract.fail("Unexpected host event")
          if (handlers.commit) await handlers.commit(message.params)
          return
        }
        if (message.kind !== "request") contract.fail("Unexpected host message")
        if (seen[message.id]) contract.fail("Request ID already used", "duplicate_request")
        if (Object.keys(pending).length >= contract.limits.pending) contract.fail("Too many pending requests", "busy")
        seen[message.id] = true; order.push(message.id)
        if (order.length > 1024) delete seen[order.shift()]
        if (!initialized && message.method !== "initialize" && message.method !== "dispose") contract.fail("Extension is not initialized")
        if (initialized && message.method === "initialize") contract.fail("Extension is already initialized")
        var state = { cancelled: false }, result = {}, method = message.method
        pending[message.id] = state
        admitted = true
        if (method === "initialize") {
          var params = message.params
          contract.negotiate([params.apiVersion || "1.0"])
          granted = Array.isArray(params.capabilities) ? params.capabilities.slice() : []
          permissions = Array.isArray(params.permissions) ? params.permissions.slice() : []
        } else allowed(method)
        if (method === "cancel") {
          if (pending[message.params.requestId]) pending[message.params.requestId].cancelled = true
          result = { cancelled: true }
        }
        if (method === "initialize") result = { initialized: true }
        if (method === "focus") result = { focused: true }
        if (method === "resize") result = { resized: true }
        if (method === "dispose") result = { disposed: true }
        if (typeof handlers[method] === "function") result = await handlers[method](message.params, { isCancelled: function() { return state.cancelled } })
        else if (["focus", "resize", "cancel", "dispose", "initialize"].indexOf(method) < 0) contract.fail("Operation is not implemented", "unsupported_operation")
        if (state.cancelled) contract.fail("Operation was cancelled", "cancelled")
        if (method === "initialize") initialized = true
        // Keep the last coalesced edit sequence ahead of its save result on the
        // ordered port, even when typing exceeded the ordinary event rate.
        if (method === "save" || method === "export") flushDirty()
        var reply = envelope("response"); reply.id = message.id; reply.result = result || {}
        contract.validateMessage(reply, { instanceId: instanceId, method: method })
        send(reply)
        if (method === "dispose") close()
      } catch (error) {
        if (contract.map(message) && typeof message.id === "string" && /^[A-Za-z0-9-]{1,128}$/.test(message.id) && message.instanceId === instanceId) {
          var reply = envelope("response"); reply.id = message.id; reply.error = errorFor(error)
          try { send(reply) } catch (_) { close() }
        } else if (++violations >= 3) close()
      } finally { if (admitted) delete pending[message.id] }
    }
    function bootstrap(event) {
      var data = event.data
      if (!active || port || event.source !== win.parent || !contract.map(data) || data.type !== "mini-a:web-extension:bootstrap" || data.phase !== "connect") return
      try {
        contract.keys(data, ["type", "phase", "instanceId", "nonce", "versions"], ["instanceId", "nonce", "versions"])
        if (!/^[a-f0-9]{32,128}$/.test(data.nonce) || !/^[A-Za-z0-9-]{1,128}$/.test(data.instanceId) || !event.ports || event.ports.length !== 1) return
        var version = contract.negotiate(data.versions)
        if (versions.indexOf(version) < 0) contract.fail("Unsupported API", "incompatible_version")
        instanceId = data.instanceId; port = event.ports[0]
        port.onmessage = receive; port.start()
        port.postMessage({ type: "mini-a:web-extension:bootstrap", phase: "connected", instanceId: instanceId, nonce: data.nonce, version: version })
        win.removeEventListener("message", bootstrap)
        clearTimeout(timer)
        resolveReady({ version: version, instanceId: instanceId })
      } catch (error) { rejectReady(error); close() }
    }
    var timer = setTimeout(function() { rejectReady(new Error("Extension handshake timed out")); close() }, 60000)
    win.addEventListener("message", bootstrap)
    win.addEventListener("pagehide", close)
    if (win.parent !== win) win.parent.postMessage({ type: "mini-a:web-extension:bootstrap", phase: "ready", versions: versions }, "*")
    else { rejectReady(new Error("Open this extension through Mini-A")); close() }
    return {
      ready: ready,
      emit: function(name, params) {
        if (!active || !port || !initialized) return false
        if (name === "commit") contract.fail("Only the host may commit documents", "permission_denied")
        if (name === "selectionChanged" && permissions.indexOf("selection.report") < 0) contract.fail("Selection permission denied", "permission_denied")
        if (name === "dirtyChanged" && granted.indexOf("edit") < 0 && granted.indexOf("create") < 0) contract.fail("Editing permission denied", "permission_denied")
        if (Date.now() - eventStart >= 1000) { eventStart = Date.now(); eventCount = 0 }
        if (++eventCount > 60) {
          if (name === "dirtyChanged") { var check = envelope("event"); check.event = name; check.params = params; contract.validateMessage(check, { instanceId: instanceId }); queuedDirty = params }
          return false
        }
        if (name === "dirtyChanged") queuedDirty = null
        var message = envelope("event"); message.event = name; message.params = params || {}; send(message); return true
      },
      dispose: close
    }
  }
  return { connect: connect }
})()
if (typeof module !== "undefined" && module.exports) module.exports = MiniAWebExtensionSDK
