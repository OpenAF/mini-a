// Deliberately small parent API: context replacement and one initial plain goal.
var MiniAEmbedBridge = function(options) {
  var win = options.window || window, validate = MiniAEmbedContext
  var config = options.config, parentOrigin = null, channelId = null
  var current = null, revision = 0, invalid = false, consumed = false, handoff = null
  var active = config && config.enabled === true && win.parent !== win
  function send(action, requestId, extra) {
    var message = { type: "mini-a:embed", version: 1, action: action, channelId: channelId, requestId: requestId }
    Object.keys(extra || {}).forEach(function(key) { message[key] = extra[key] })
    win.parent.postMessage(message, parentOrigin)
  }
  function snapshot() {
    if (!active) throw new Error("Embedded mode is unavailable")
    if (invalid) throw new Error("Parent app context is invalid; wait for the parent to correct it")
    return validate.envelope({ version: 1, revision: revision, context: current }, config)
  }
  function error(requestId, message) { send("error", requestId, { message: message }) }
  async function receive(event) {
    if (!active || event.source !== win.parent || config.origins.indexOf(event.origin) < 0 || parentOrigin && event.origin !== parentOrigin) return
    var data = event.data
    if (!validate.map(data) || data.type !== "mini-a:embed" || data.version !== 1 || typeof data.requestId !== "string" || !/^[A-Za-z0-9-]{1,80}$/.test(data.requestId)) return
    if (data.action === "hello") {
      try { validate.keys(data, ["type", "version", "action", "requestId"]) } catch (_) { return }
      if (!parentOrigin) {
        if (!win.crypto || typeof win.crypto.getRandomValues !== "function") return
        var random = new Uint8Array(16)
        win.crypto.getRandomValues(random)
        channelId = Array.prototype.map.call(random, function(b) { return ("0" + b.toString(16)).slice(-2) }).join("")
        parentOrigin = event.origin
      }
      send("ready", data.requestId, { contextRequired: config.contextRequired, prompt: config.prompt === true && parentOrigin === win.location.origin })
      return
    }
    if (!parentOrigin || data.channelId !== channelId) return
    if (data.action === "set-context" || data.action === "clear-context") {
      if (!validate.revision(data.revision) || data.revision <= revision) { error(data.requestId, "Context revision must increase"); return }
      revision = data.revision
      try {
        validate.keys(data, ["type", "version", "action", "requestId", "channelId", "revision"].concat(data.action === "set-context" ? ["context"] : []))
        current = data.action === "clear-context" ? null : validate.context(data.context, config)
        invalid = false
        send("ack", data.requestId, { revision: revision })
      } catch (e) {
        current = null
        invalid = true
        error(data.requestId, String(e.message || e))
      }
      return
    }
    if (data.action !== "start") { error(data.requestId, "Unknown embedding action"); return }
    var admitted = false
    try {
      if (config.prompt !== true || event.origin !== win.location.origin) throw new Error("Parent prompt handoff requires an enabled same-origin parent")
      validate.keys(data, ["type", "version", "action", "requestId", "channelId", "mode", "text", "revision"])
      if (["draft", "submit"].indexOf(data.mode) < 0 || typeof data.text !== "string" || !data.text.trim() || data.text.length > config.maxPromptChars) throw new Error("Invalid initial goal")
      var fingerprint = JSON.stringify([data.mode, data.text, data.revision])
      if (handoff && data.requestId === handoff.id) {
        if (fingerprint !== handoff.fingerprint) throw new Error("Request ID already used with different content")
        if (handoff.error) error(data.requestId, handoff.error)
        else send("ack", data.requestId, { status: handoff.status })
        return
      }
      if (consumed || !options.canStart()) throw new Error("Initial goal requires a fresh, idle conversation and an empty composer")
      var embed = snapshot()
      if (data.revision !== embed.revision) throw new Error("Context changed; use its latest acknowledged revision")
      consumed = true
      admitted = true
      handoff = { id: data.requestId, fingerprint: fingerprint, status: "pending" }
      // Mark consumed before awaiting: retries must never issue a second model request.
      await options.start(data.text, data.mode, embed)
      handoff.status = data.mode === "draft" ? "draft" : "submitted"
      send("ack", data.requestId, { status: handoff.status })
    } catch (e) {
      var message = String(e.message || e)
      if (admitted) handoff.error = message
      error(data.requestId, message)
    }
  }
  win.addEventListener("message", receive)
  return { snapshot: snapshot, dispose: function() { active = false; current = null; win.removeEventListener("message", receive) } }
}
if (typeof module !== "undefined" && module.exports) module.exports = MiniAEmbedBridge
