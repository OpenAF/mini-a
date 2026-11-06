// Shared browser/OpenAF/Node contract. No runtime dependency or executable manifest fields.
var MiniAWebExtensionContract = (function() {
  var schema = "https://openaf.io/schemas/mini-a/web-extension/1.0/schema.json"
  var protocol = "mini-a:web-extension"
  var limits = { controlBytes: 65536, nativeBytes: 8388608, exportBytes: 16777216, depth: 24, pending: 8 }
  var capabilities = ["render", "edit", "create", "export", "inspect", "selection", "fullscreen"]
  var permissions = ["artifact.read", "artifact.propose-write", "artifact.propose-export", "selection.report", "ui.fullscreen"]
  var methods = ["initialize", "open", "create", "update", "save", "export", "inspect", "resize", "focus", "cancel", "dispose"]
  var events = ["dirtyChanged", "selectionChanged", "saveRequested", "closeRequested", "commit", "error"]
  var own = function(value, key) { return Object.prototype.hasOwnProperty.call(value, key) }
  var map = function(value) { return value !== null && typeof value === "object" && !Array.isArray(value) && Object.prototype.toString.call(value) === "[object Object]" }
  function fail(message, code) { var error = new Error(message); error.code = code || "invalid_request"; throw error }
  function bytes(text) {
    var size = 0
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i)
      if (c < 128) size++
      else if (c < 2048) size += 2
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { size += 4; i++ }
      else size += 3
    }
    return size
  }
  function safe(value, depth) {
    depth = depth || 0
    if (depth > limits.depth) fail("Object exceeds depth limit")
    if (value === null || typeof value === "string" || typeof value === "boolean") return value
    if (typeof value === "number" && isFinite(value) && Math.abs(value) <= 9007199254740991) return value
    if (Array.isArray(value)) {
      if (value.length > 4096) fail("List exceeds item limit")
      var list = []
      for (var i = 0; i < value.length; i++) { if (!own(value, i)) fail("Sparse lists are not supported"); list.push(safe(value[i], depth + 1)) }
      return list
    }
    if (!map(value) || Object.keys(value).length > 128) fail("Expected a bounded JSON object")
    var out = {}
    Object.keys(value).forEach(function(key) {
      if (["__proto__", "prototype", "constructor"].indexOf(key) >= 0) fail("Unsafe object key")
      out[key] = safe(value[key], depth + 1)
    })
    return out
  }
  function keys(value, allowed, required) {
    if (!map(value) || Object.keys(value).some(function(key) { return allowed.indexOf(key) < 0 })) fail("Unexpected object field")
    ;(required || []).forEach(function(key) { if (!own(value, key)) fail("Missing field: " + key) })
  }
  function string(value, max, pattern) {
    if (typeof value !== "string" || !value.length || value.length > max || pattern && !pattern.test(value)) fail("Invalid string")
    return value
  }
  function integer(value, min, max) { if (typeof value !== "number" || !isFinite(value) || Math.floor(value) !== value || value < min || value > max) fail("Invalid integer"); return value }
  function canonical(value) {
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]"
    if (map(value)) return "{" + Object.keys(value).sort().map(function(key) { return JSON.stringify(key) + ":" + canonical(value[key]) }).join(",") + "}"
    return JSON.stringify(value)
  }
  function list(value, min, max, check) {
    if (!Array.isArray(value) || value.length < min || value.length > max) fail("Invalid list")
    var seen = {}
    value.forEach(function(item) { check(item); var k = canonical(item); if (own(seen, k)) fail("Duplicate list value"); seen[k] = true })
  }
  function choice(value, values) { if (values.indexOf(value) < 0) fail("Unsupported value: " + String(value)); return value }
  function path(value) {
    string(value, 240, /^[A-Za-z0-9_./-]+$/)
    if (value.charAt(0) === "/" || value.split("/").some(function(part) { return !part || part === "." || part === ".." || part.charAt(0) === "." })) fail("Unsafe relative asset path")
    return value
  }
  function mime(value) { return string(value, 128, /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/) }
  function extension(value) { return string(value, 34, /^\.[a-z0-9][a-z0-9.-]{0,31}$/) }
  function manifest(input) {
    var value = safe(input)
    if (bytes(JSON.stringify(value)) > limits.controlBytes) fail("Manifest exceeds 64 KiB")
    keys(value, ["$schema", "id", "name", "description", "version", "apiVersions", "minMiniAVersion", "entry", "rendering", "category", "activation", "formats", "capabilities", "permissions", "exports", "assetMounts", "childFrames", "network", "offline", "resources", "license", "licenseFiles", "attribution", "extensions"], ["$schema", "id", "name", "version", "apiVersions", "entry", "rendering", "activation", "capabilities", "permissions", "network", "offline", "license"])
    if (value.$schema !== schema) fail("Unsupported manifest schema", "incompatible_version")
    string(value.id, 128, /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/)
    if (value.id.length < 3) fail("Extension ID is too short")
    string(value.name, 100)
    if (own(value, "description") && (typeof value.description !== "string" || value.description.length > 1000)) fail("Invalid description")
    string(value.version, 64, /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/)
    list(value.apiVersions, 1, 8, function(v) { string(v, 16, /^[1-9][0-9]*\.[0-9]+$/) })
    if (own(value, "minMiniAVersion")) string(value.minMiniAVersion, 8, /^[0-9]{8}$/)
    path(value.entry)
    if (!/\.html$/.test(value.entry)) fail("Entry must be an HTML file")
    choice(value.rendering, ["iframe"])
    if (own(value, "category")) choice(value.category, ["viewer", "editor", "tool"])
    list(value.activation, 1, 3, function(v) { choice(v, ["command", "open-with", "artifact"]) })
    list(value.capabilities, 1, capabilities.length, function(v) { choice(v, capabilities) })
    list(value.permissions, 0, permissions.length, function(v) { choice(v, permissions) })
    if (own(value, "formats")) list(value.formats, 0, 32, function(format) {
      keys(format, ["mimeTypes", "extensions", "artifactTypes"], ["mimeTypes"])
      list(format.mimeTypes, 1, 16, mime)
      if (own(format, "extensions")) list(format.extensions, 0, 16, extension)
      if (own(format, "artifactTypes")) list(format.artifactTypes, 0, 16, function(v) { string(v, 128, /^[a-z0-9][a-z0-9._/-]*$/) })
    })
    if (own(value, "exports")) list(value.exports, 0, 16, function(format) { keys(format, ["mimeType", "extension"], ["mimeType", "extension"]); mime(format.mimeType); extension(format.extension) })
    if (own(value, "assetMounts")) list(value.assetMounts, 0, 4, function(v) { string(v, 32, /^[a-z][a-z0-9-]{0,31}$/) })
    if (own(value, "childFrames")) list(value.childFrames, 0, 4, path)
    keys(value.network, ["origins"], ["origins"])
    list(value.network.origins, 0, 0, function() {})
    if (value.offline !== true) fail("Version 1 requires local offline assets")
    if (own(value, "resources")) {
      keys(value.resources, ["maxArtifactBytes", "maxExportBytes", "operationTimeoutMs"])
      if (own(value.resources, "maxArtifactBytes")) integer(value.resources.maxArtifactBytes, 1, limits.nativeBytes)
      if (own(value.resources, "maxExportBytes")) integer(value.resources.maxExportBytes, 1, limits.exportBytes)
      if (own(value.resources, "operationTimeoutMs")) integer(value.resources.operationTimeoutMs, 1000, 60000)
    }
    string(value.license, 128)
    if (own(value, "licenseFiles")) list(value.licenseFiles, 0, 32, path)
    if (own(value, "attribution")) list(value.attribution, 0, 32, function(v) { string(v, 1000) })
    if (own(value, "extensions")) {
      if (!map(value.extensions) || Object.keys(value.extensions).length > 32) fail("Invalid extension metadata")
      Object.keys(value.extensions).forEach(function(k) { if (!/^x-[a-z0-9.-]+$/.test(k)) fail("Metadata must be namespaced") })
    }
    function requires(cap, permission) { if (value.capabilities.indexOf(cap) >= 0 && value.permissions.indexOf(permission) < 0) fail(cap + " requires " + permission) }
    requires("render", "artifact.read"); requires("edit", "artifact.propose-write"); requires("create", "artifact.propose-write"); requires("export", "artifact.propose-export"); requires("selection", "selection.report"); requires("fullscreen", "ui.fullscreen")
    if (value.capabilities.indexOf("edit") >= 0 && value.capabilities.indexOf("render") < 0) fail("Editing requires rendering")
    if (value.capabilities.indexOf("export") >= 0 && (!value.exports || !value.exports.length)) fail("Export capability requires export formats")
    return value
  }
  function content(value, max) {
    max = max || limits.nativeBytes
    keys(value, ["encoding", "text", "data"], ["encoding"])
    var size
    if (value.encoding === "utf8") {
      if (typeof value.text !== "string" || own(value, "data")) fail("Invalid UTF-8 content")
      size = bytes(value.text)
    } else if (value.encoding === "base64") {
      if (typeof value.data !== "string" || own(value, "text")) fail("Invalid base64 content")
      var data = value.data, end = data.length
      if (end > Math.ceil(max / 3) * 4 || end % 4) fail("Invalid or oversized base64 content", "payload_too_large")
      if (end && data.charAt(end - 1) === "=") end--
      if (end && data.charAt(end - 1) === "=") end--
      for (var i = 0; i < end; i++) { var c = data.charCodeAt(i); if (!(c >= 65 && c <= 90 || c >= 97 && c <= 122 || c >= 48 && c <= 57 || c === 43 || c === 47)) fail("Invalid base64 content") }
      size = data.length / 4 * 3 - (data.length - end)
    } else fail("Unsupported content encoding")
    if (size > max) fail("Content exceeds negotiated limit", "payload_too_large")
    return size
  }
  function operation(method, value, response) {
    choice(method, methods)
    var requestFields = {
      initialize: ["apiVersion", "capabilities", "permissions", "limits", "locale", "theme", "viewport"],
      open: ["artifact", "content"], update: ["artifact", "content"], create: ["title", "mimeType"],
      save: [], export: ["mimeType"], inspect: [], resize: ["width", "height"], focus: [], cancel: ["requestId"], dispose: []
    }
    var responseFields = {
      initialize: ["initialized", "capabilities"], open: ["opened", "revision", "editSequence"], update: ["opened", "revision", "editSequence"], create: ["created"],
      save: ["content", "mimeType", "filename", "editSequence"], export: ["content", "mimeType", "filename", "editSequence"],
      inspect: ["metadata"], resize: ["resized"], focus: ["focused"], cancel: ["cancelled"], dispose: ["disposed"]
    }
    var required = response ? { initialize: ["initialized"], open: ["opened"], update: ["opened", "editSequence"], create: ["created"], save: ["content", "mimeType", "editSequence"], export: ["content", "mimeType"], inspect: ["metadata"] } : {
      initialize: ["apiVersion", "capabilities", "permissions", "limits"], open: ["artifact", "content"], update: ["artifact", "content"], create: ["title", "mimeType"], export: ["mimeType"], resize: ["width", "height"], cancel: ["requestId"]
    }
    keys(value, (response ? responseFields : requestFields)[method], required[method] || [])
    if (own(value, "mimeType")) mime(value.mimeType)
    if (own(value, "title")) string(value.title, 200)
    if (own(value, "filename")) { string(value.filename, 200); if (/[\\/\u0000-\u001f\u007f]/.test(value.filename)) fail("Invalid filename") }
    if (own(value, "editSequence")) integer(value.editSequence, 0, 9007199254740991)
    if (own(value, "revision")) integer(value.revision, 0, 9007199254740991)
    if (own(value, "requestId")) string(value.requestId, 128, /^[A-Za-z0-9-]+$/)
    ;["initialized", "opened", "created", "resized", "focused", "cancelled", "disposed"].forEach(function(k) { if (own(value, k) && typeof value[k] !== "boolean") fail("Invalid operation status") })
    if (own(value, "capabilities")) list(value.capabilities, 0, capabilities.length, function(v) { choice(v, capabilities) })
    if (own(value, "permissions")) list(value.permissions, 0, permissions.length, function(v) { choice(v, permissions) })
    if (own(value, "apiVersion")) choice(value.apiVersion, ["1.0"])
    if (own(value, "locale")) string(value.locale, 64, /^[A-Za-z0-9-]+$/)
    if (own(value, "theme")) choice(value.theme, ["light", "dark"])
    if (own(value, "width")) integer(value.width, 0, 32768)
    if (own(value, "height")) integer(value.height, 0, 32768)
    if (own(value, "viewport")) { keys(value.viewport, ["width", "height"], ["width", "height"]); integer(value.viewport.width, 0, 32768); integer(value.viewport.height, 0, 32768) }
    if (own(value, "limits")) {
      keys(value.limits, ["nativeBytes", "exportBytes", "controlBytes", "operationTimeoutMs"], ["nativeBytes", "exportBytes"])
      integer(value.limits.nativeBytes, 1, limits.nativeBytes); integer(value.limits.exportBytes, 1, limits.exportBytes)
      if (own(value.limits, "controlBytes")) integer(value.limits.controlBytes, 1, limits.controlBytes)
      if (own(value.limits, "operationTimeoutMs")) integer(value.limits.operationTimeoutMs, 1000, 60000)
    }
    if (own(value, "artifact")) {
      keys(value.artifact, ["handle", "revision", "title", "mimeType", "readOnly"], ["handle", "revision", "title", "mimeType", "readOnly"])
      string(value.artifact.handle, 128, /^[A-Za-z0-9-]+$/); integer(value.artifact.revision, 0, 9007199254740991); string(value.artifact.title, 200); mime(value.artifact.mimeType)
      if (typeof value.artifact.readOnly !== "boolean") fail("Invalid read-only state")
    }
    if (own(value, "metadata") && !map(value.metadata)) fail("Inspection metadata must be an object")
    return value
  }
  function message(input, context) {
    context = context || {}
    if (!map(input)) fail("Expected protocol message")
    keys(input, ["protocol", "version", "kind", "instanceId", "id", "method", "event", "params", "result", "error"], ["protocol", "version", "kind", "instanceId"])
    if (input.protocol !== protocol || input.version !== "1.0") fail("Unsupported protocol version", "incompatible_version")
    string(input.instanceId, 128, /^[A-Za-z0-9-]+$/)
    if (context.instanceId && input.instanceId !== context.instanceId) fail("Wrong extension instance", "invalid_instance")
    choice(input.kind, ["request", "response", "event"])
    var value = {}, body
    Object.keys(input).forEach(function(k) { value[k] = input[k] })
    if (input.kind === "request") {
      keys(input, ["protocol", "version", "kind", "instanceId", "id", "method", "params"], ["id", "method", "params"])
      string(input.id, 128, /^[A-Za-z0-9-]+$/); choice(input.method, methods)
      if (!map(input.params)) fail("Request params must be an object")
      body = input.params
    } else if (input.kind === "response") {
      keys(input, ["protocol", "version", "kind", "instanceId", "id", "result", "error"], ["id"])
      string(input.id, 128, /^[A-Za-z0-9-]+$/)
      if (own(input, "result") === own(input, "error")) fail("Response needs one result or error")
      if (own(input, "error")) {
        keys(input.error, ["code", "message", "retryable"], ["code", "message", "retryable"])
        string(input.error.code, 64, /^[a-z][a-z0-9_]*$/); string(input.error.message, 1000)
        if (typeof input.error.retryable !== "boolean") fail("Invalid error retry flag")
      } else { if (!map(input.result)) fail("Result must be an object"); body = input.result }
    } else {
      keys(input, ["protocol", "version", "kind", "instanceId", "event", "params"], ["event", "params"])
      choice(input.event, events)
      if (!map(input.params)) fail("Event params must be an object")
      body = input.params
    }
    // Content has its own byte ceiling. It must not consume the small control-message budget.
    if (body && own(body, "content")) {
      content(body.content, context.maxContentBytes || (input.kind === "request" || context.method === "save" ? limits.nativeBytes : limits.exportBytes))
      var control = {}
      Object.keys(body).forEach(function(k) { control[k] = k === "content" ? { encoding: body.content.encoding } : body[k] })
      value[own(input, "result") ? "result" : "params"] = control
    }
    safe(value)
    if (bytes(JSON.stringify(value)) > limits.controlBytes) fail("Control message exceeds 64 KiB", "payload_too_large")
    if (input.kind === "event") {
      var p = input.params
      if (input.event === "dirtyChanged") { keys(p, ["dirty", "editSequence"], ["dirty", "editSequence"]); if (typeof p.dirty !== "boolean") fail("Invalid dirty state"); integer(p.editSequence, 0, 9007199254740991) }
      if (input.event === "commit") { keys(p, ["revision", "editSequence"], ["revision", "editSequence"]); integer(p.revision, 1, 9007199254740991); integer(p.editSequence, 0, 9007199254740991) }
      if (input.event === "saveRequested" || input.event === "closeRequested") keys(p, [])
      if (input.event === "error") { keys(p, ["code", "message"], ["code", "message"]); string(p.code, 64, /^[a-z][a-z0-9_]*$/); string(p.message, 1000) }
      if (input.event === "selectionChanged") { keys(p, ["ids", "region"]); if (own(p, "ids")) list(p.ids, 0, 256, function(v) { string(v, 128) }); if (own(p, "region")) { keys(p.region, ["x", "y", "width", "height"], ["x", "y", "width", "height"]); Object.keys(p.region).forEach(function(k) { if (typeof p.region[k] !== "number" || !isFinite(p.region[k])) fail("Invalid selection region") }) } }
    }
    if (input.kind === "request") operation(input.method, input.params, false)
    if (input.kind === "response" && own(input, "result") && context.method) operation(context.method, input.result, true)
    return input
  }
  function negotiate(versions) { list(versions, 1, 8, function(v) { string(v, 16, /^[1-9][0-9]*\.[0-9]+$/) }); if (versions.indexOf("1.0") < 0) fail("No compatible extension API version", "incompatible_version"); return "1.0" }
  return { schema: schema, protocol: protocol, versions: ["1.0"], limits: limits, capabilities: capabilities, permissions: permissions, methods: methods, events: events, own: own, map: map, safe: safe, keys: keys, bytes: bytes, path: path, mime: mime, integer: integer, content: content, operation: operation, negotiate: negotiate, validateManifest: manifest, manifest: manifest, validateMessage: message, message: message, fail: fail }
})()
if (typeof module !== "undefined" && module.exports) module.exports = MiniAWebExtensionContract
