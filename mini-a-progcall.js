// Author: Nuno Aguiar
// License: Apache 2.0
// Description: Per-session HTTP server bridging LLM-generated code to the agent's MCP tool ecosystem.
//
// Loaded lazily by mini-a.js when mcpprogcall=true.
// Requires mini-a-common.js to be loaded first (for __miniABuildCompactToolManifest).

/**
 * MiniAProgCallServer — per-session HTTP bridge for programmatic MCP tool calling.
 *
 * Lifecycle:
 *   var srv = new MiniAProgCallServer(agentInstance)
 *   var info = srv.start({ port, maxBytes, resultTTL, allowedTools, batchMax })
 *   // info = { port, token, tmpDir }
 *   srv.stop()   // on session teardown
 */
var MiniAProgCallServer = function(agent) {
  this._agent       = agent
  this._httpServer  = __
  this._port        = __
  this._token       = __
  this._tmpDir      = __
  this._resultStore = {}   // resultId -> { value: string, expiresAt: number }
  this._maxBytes    = 4096
  this._resultTTL   = 600  // seconds
  this._batchMax    = 10
  this._allowedTools = __  // null/undefined = all tools allowed
}

/**
 * Starts the HTTP server, creates the temp directory, generates the bearer token.
 * @param {Object} options - { port, maxBytes, resultTTL, allowedTools, batchMax }
 * @returns {{ port: number, token: string, tmpDir: string }}
 */
MiniAProgCallServer.prototype.start = function(options) {
  options = isMap(options) ? options : {}
  if (isNumber(options.maxBytes) && options.maxBytes > 0)   this._maxBytes  = options.maxBytes
  if (isNumber(options.resultTTL) && options.resultTTL > 0) this._resultTTL = options.resultTTL
  if (isNumber(options.batchMax) && options.batchMax > 0)   this._batchMax  = options.batchMax
  if (isString(options.allowedTools) && options.allowedTools.trim().length > 0) {
    this._allowedTools = options.allowedTools.split(",").map(function(t) { return t.trim() }).filter(function(t) { return t.length > 0 })
  }

  // Resolve the port to bind on.
  // OpenAF's ow.server.httpd caches servers keyed by the port argument; when
  // port=0 is passed, start() stores the entry under key 0 but stop() deletes
  // it under the actual bound port — so the cache entry at key 0 persists and
  // the next start(0) returns the already-stopped server.  To avoid this, find
  // a free OS port first and pass that explicit port to start().
  var port = isNumber(options.port) && options.port > 0 ? options.port : (function() {
    var ss = new java.net.ServerSocket(0)
    var p  = ss.getLocalPort()
    ss.close()
    return p
  })()

  // Per-session temporary directory
  var tmpDir = String(java.nio.file.Files.createTempDirectory("mini-a-ptc-").toAbsolutePath())
  this._tmpDir = tmpDir

  // Safety-net: also clean up temp dir on JVM shutdown
  var self = this
  if (typeof addOnOpenAFShutdown === "function") {
    addOnOpenAFShutdown(function() {
      try { if (isString(self._tmpDir) && io.fileExists(self._tmpDir)) io.rm(self._tmpDir) } catch(e) {}
    })
  }

  // Generate a per-session UUID bearer token
  this._token = genUUID(true).replace(/-/g, "")

  // Bind HTTP server to 127.0.0.1 only
  ow.loadServer()
  var hs = ow.server.httpd.start(port, "127.0.0.1")
  this._httpServer = hs
  this._port = hs.getPort()

  this._setupRoutes(hs)

  return { port: this._port, token: this._token, tmpDir: this._tmpDir }
}

/**
 * Validates the bearer token from a request's headers.
 * Accepts X-Mini-A-Token or Authorization: Bearer <token>.
 */
MiniAProgCallServer.prototype._authCheck = function(req) {
  var headers = isMap(req.header) ? req.header : {}
  var token
  if (isString(headers["x-mini-a-token"])) {
    token = headers["x-mini-a-token"]
  } else if (isString(headers["authorization"])) {
    var auth = headers["authorization"]
    if (auth.indexOf("Bearer ") === 0) token = auth.substring(7)
  }
  return token === this._token
}

/**
 * Evicts expired result-store entries (lazy sweep).
 */
MiniAProgCallServer.prototype._evictExpired = function() {
  var now = Date.now()
  var store = this._resultStore
  Object.keys(store).forEach(function(id) {
    var entry = store[id]
    if (isObject(entry) && isNumber(entry.expiresAt) && entry.expiresAt < now) delete store[id]
  })
}

/**
 * Checks if the named tool is permitted by the allowlist (or if no allowlist is set).
 */
MiniAProgCallServer.prototype._isToolAllowed = function(toolName) {
  if (!isArray(this._allowedTools)) return true
  return this._allowedTools.indexOf(toolName) >= 0
}

/**
 * Converts a normalized tool result to a JSON-safe value.
 * Handles plain text, already-parsed objects, and stringified JSON.
 */
MiniAProgCallServer.prototype._toJsonResult = function(normalized) {
  var processed = isObject(normalized) ? normalized.processed : __
  if (isString(processed)) {
    // Try parsing as JSON; fall back to text wrapper
    var parsed = jsonParse(processed.trim(), __, __, false)
    if (isMap(parsed) || isArray(parsed)) return parsed
    return { text: processed }
  }
  if (isMap(processed) || isArray(processed)) return processed
  if (isUnDef(processed) || processed === null) return { text: "" }
  return { text: String(processed) }
}

/**
 * Spills large results to the in-memory result store.
 * Returns a response envelope: either { ok, result } or { ok, resultId, preview, size }.
 */
MiniAProgCallServer.prototype._makeResultResponse = function(jsonResult) {
  var serialized = stringify(jsonResult, __, "")
  if (serialized.length > this._maxBytes) {
    var resultId = genUUID(true).replace(/-/g, "").substring(0, 16)
    this._resultStore[resultId] = {
      value    : serialized,
      expiresAt: Date.now() + this._resultTTL * 1000
    }
    return { ok: true, resultId: resultId, preview: serialized.substring(0, 200), size: serialized.length }
  }
  return { ok: true, result: jsonResult }
}

/**
 * Returns the compact tool list, proxy-aware if mcpproxy is active.
 */
MiniAProgCallServer.prototype._getToolList = function(withSchema) {
  var proxyState = isObject(global.__mcpProxyState__) ? global.__mcpProxyState__ : __
  var agentTools = isArray(this._agent.mcpTools) ? this._agent.mcpTools : []
  return __miniABuildCompactToolManifest(agentTools, proxyState, withSchema)
}

/**
 * Wire up all HTTP routes on the given httpd instance.
 */
MiniAProgCallServer.prototype._setupRoutes = function(hs) {
  var self = this

  var _replyJSON = function(code, payload) {
    return ow.server.httpd.reply(stringify(payload, __, ""), code, ow.server.httpd.mimes.JSON)
  }

  var routes = {}

  // ── GET /list-tools ───────────────────────────────────────────────────────
  routes["/list-tools"] = function(req) {
    if (!self._authCheck(req))          return _replyJSON(403, { error: "Forbidden" })
    if (req.method !== "GET")           return _replyJSON(405, { error: "Method not allowed" })
    self._evictExpired()
    var withSchema = isMap(req.params) && req.params.schema === "1"
    return _replyJSON(200, { tools: self._getToolList(withSchema) })
  }

  // ── GET /search-tools?q=QUERY ─────────────────────────────────────────────
  routes["/search-tools"] = function(req) {
    if (!self._authCheck(req))          return _replyJSON(403, { error: "Forbidden" })
    if (req.method !== "GET")           return _replyJSON(405, { error: "Method not allowed" })
    var q = (isMap(req.params) && isString(req.params.q)) ? req.params.q.toLowerCase().trim() : ""
    var tools = self._getToolList(false)
    if (q.length > 0) {
      tools = tools.filter(function(t) {
        return t.name.toLowerCase().indexOf(q) >= 0 ||
               (isString(t.description) && t.description.toLowerCase().indexOf(q) >= 0)
      })
    }
    return _replyJSON(200, { tools: tools })
  }

  // ── POST /call-tool ───────────────────────────────────────────────────────
  routes["/call-tool"] = function(req) {
    if (!self._authCheck(req))          return _replyJSON(403, { error: "Forbidden" })
    if (req.method !== "POST")          return _replyJSON(405, { error: "Method not allowed" })
    self._evictExpired()
    var body = {}
    try { body = jsonParse(req.files.postData) } catch(e) {
      return _replyJSON(400, { error: "Invalid JSON in request body" })
    }
    var toolName = isString(body.name) ? body.name.trim() : ""
    var params   = isMap(body.params)  ? body.params       : {}
    if (toolName.length === 0) return _replyJSON(400, { error: "Missing required field: name" })
    if (!self._isToolAllowed(toolName)) return _replyJSON(403, { error: "Tool not in allowlist: " + toolName })
    try {
      var callResult = self._agent._callMcpTool(toolName, params)
      if (callResult.error) {
        return _replyJSON(200, { ok: false, error: callResult.normalized.display || "tool error" })
      }
      return _replyJSON(200, self._makeResultResponse(self._toJsonResult(callResult.normalized)))
    } catch(e) {
      return _replyJSON(200, { ok: false, error: __miniAErrMsg(e) })
    }
  }

  // ── POST /call-tools-batch ────────────────────────────────────────────────
  routes["/call-tools-batch"] = function(req) {
    if (!self._authCheck(req))          return _replyJSON(403, { error: "Forbidden" })
    if (req.method !== "POST")          return _replyJSON(405, { error: "Method not allowed" })
    self._evictExpired()
    var body = {}
    try { body = jsonParse(req.files.postData) } catch(e) {
      return _replyJSON(400, { error: "Invalid JSON in request body" })
    }
    if (!isArray(body.calls)) return _replyJSON(400, { error: "Missing required field: calls" })
    var calls = body.calls.slice(0, self._batchMax)
    var results = calls.map(function(call) {
      var callId   = isString(call.id)   ? call.id          : ""
      var toolName = isString(call.name) ? call.name.trim() : ""
      var params   = isMap(call.params)  ? call.params      : {}
      if (toolName.length === 0) return { id: callId, ok: false, error: "Missing required field: name" }
      if (!self._isToolAllowed(toolName)) return { id: callId, ok: false, error: "Tool not in allowlist: " + toolName }
      try {
        var callResult = self._agent._callMcpTool(toolName, params)
        if (callResult.error) return { id: callId, ok: false, error: callResult.normalized.display || "tool error" }
        var envelope = self._makeResultResponse(self._toJsonResult(callResult.normalized))
        return merge({ id: callId }, envelope)
      } catch(e) {
        return { id: callId, ok: false, error: __miniAErrMsg(e) }
      }
    })
    return _replyJSON(200, { results: results })
  }

  // ── Default route — handles /result/{id} and unknown paths ───────────────
  var defaultRoute = function(req) {
    var path = isString(req.uri) ? req.uri.split("?")[0] : ""
    var m = path.match(/^\/result\/([a-f0-9]+)$/)
    if (m) {
      if (!self._authCheck(req)) return _replyJSON(403, { error: "Forbidden" })
      if (req.method !== "GET") return _replyJSON(405, { error: "Method not allowed" })
      self._evictExpired()
      var resultId = m[1]
      var entry = self._resultStore[resultId]
      if (!isObject(entry) || !isString(entry.value)) {
        return _replyJSON(404, { error: "Result not found or expired: " + resultId })
      }
      var raw    = entry.value
      var params = isMap(req.params) ? req.params : {}
      var wantText = params.format === "text"
      var offset = parseInt(params.offset, 10); if (isNaN(offset) || offset < 0) offset = 0
      var limit  = parseInt(params.limit,  10); if (isNaN(limit)  || limit  < 0) limit  = -1
      if (offset > 0 || limit > 0) {
        var sliced = raw.substring(offset, limit > 0 ? offset + limit : raw.length)
        if (wantText) return ow.server.httpd.reply(sliced, 200, ow.server.httpd.mimes.TXT)
        return _replyJSON(200, { ok: true, resultId: resultId, data: sliced, offset: offset, limit: limit, totalSize: raw.length })
      }
      if (wantText) return ow.server.httpd.reply(raw, 200, ow.server.httpd.mimes.TXT)
      var parsed = jsonParse(raw.trim(), __, __, false)
      return _replyJSON(200, { ok: true, result: (isMap(parsed) || isArray(parsed)) ? parsed : { text: raw } })
    }
    return _replyJSON(404, { error: "Not found" })
  }

  ow.server.httpd.route(hs, routes, defaultRoute)
}

/**
 * Stops the HTTP server, clears the result store, and removes the temp directory.
 */
MiniAProgCallServer.prototype.stop = function() {
  if (isDef(this._httpServer)) {
    try {
      if (isObject(ow) && isObject(ow.server) && isObject(ow.server.httpd) && typeof ow.server.httpd.stop === "function") {
        ow.server.httpd.stop(this._httpServer)
      }
    } catch(e) {}
    this._httpServer = __
  }
  this._resultStore = {}
  if (isString(this._tmpDir)) {
    try { if (io.fileExists(this._tmpDir)) io.rm(this._tmpDir) } catch(e) {}
    this._tmpDir = __
  }
  this._port  = __
  this._token = __
}

/**
 * Returns the environment variables to inject into shell subprocesses.
 * @returns {{ MINI_A_PTC_PORT: string, MINI_A_PTC_TOKEN: string, MINI_A_PTC_DIR: string }}
 */
MiniAProgCallServer.prototype.envVars = function() {
  return {
    MINI_A_PTC_PORT : String(this._port),
    MINI_A_PTC_TOKEN: this._token,
    MINI_A_PTC_DIR  : this._tmpDir
  }
}

/**
 * Returns the system-prompt section to inject once at session start.
 * Must be called after start() so that port and token are known.
 */
MiniAProgCallServer.prototype.promptSnippet = function() {
  var port  = this._port
  var tmpDir = this._tmpDir
  return (
    "\n\n## Programmatic Tool Calling\n\n" +
    "You can invoke MCP tools from generated code (bash, Python, JS, etc.) via a local\n" +
    "HTTP API. Use the `shell` action to execute scripts and, if available, `write_file`\n" +
    "to create script files.\n\n" +
    "Environment variables available in every shell subprocess:\n" +
    "  MINI_A_PTC_PORT  — HTTP server port (" + port + ")\n" +
    "  MINI_A_PTC_TOKEN — bearer token (required on every request)\n" +
    "  MINI_A_PTC_DIR   — per-session temp directory (writable; cleaned up after session)\n\n" +
    "Base URL: http://127.0.0.1:" + port + "\n\n" +
    "Endpoints:\n" +
    "  GET  /list-tools            list all tools (add ?schema=1 for parameter details)\n" +
    "  GET  /search-tools?q=QUERY  search tools by keyword\n" +
    "  POST /call-tool             { \"name\": \"…\", \"params\": {…} }\n" +
    "  POST /call-tools-batch      { \"calls\": [{ \"id\":\"…\",\"name\":\"…\",\"params\":{…} }] }\n" +
    "  GET  /result/{id}           retrieve a stored oversized result\n" +
    "  GET  /result/{id}?offset=N&limit=M  paginate a large result\n\n" +
    "All requests require header: X-Mini-A-Token: $MINI_A_PTC_TOKEN\n\n" +
    "Responses:\n" +
    "  { \"ok\": true,  \"result\": {…} }\n" +
    "  { \"ok\": true,  \"resultId\": \"…\", \"preview\": \"…\", \"size\": N }  ← result too large\n" +
    "  { \"ok\": false, \"error\": \"…\" }\n\n" +
    "When to use programmatic tool calling:\n" +
    "- When you need to call many tools in a loop or conditionally\n" +
    "- When you need to process/transform tool results with code\n" +
    "- When a task is more naturally expressed as a script than a sequence of individual actions\n\n" +
    "Workflow:\n" +
    "1. Write your script to $MINI_A_PTC_DIR (using shell heredoc or write_file)\n" +
    "2. Execute it via the shell action\n" +
    "3. The script reads env vars for port/token/dir and calls the HTTP API\n\n" +
    "Example (bash — inline):\n" +
    "  curl -s -X POST http://127.0.0.1:$MINI_A_PTC_PORT/call-tool \\\n" +
    "    -H \"X-Mini-A-Token: $MINI_A_PTC_TOKEN\" \\\n" +
    "    -H \"Content-Type: application/json\" \\\n" +
    "    -d '{\"name\":\"tool_name\",\"params\":{}}'\n\n" +
    "Example (Python — multi-step):\n" +
    "  cat > $MINI_A_PTC_DIR/task.py << 'PYEOF'\n" +
    "  import requests, os, json\n" +
    "  base = f\"http://127.0.0.1:{os.environ['MINI_A_PTC_PORT']}\"\n" +
    "  hdrs = {\"X-Mini-A-Token\": os.environ[\"MINI_A_PTC_TOKEN\"],\n" +
    "          \"Content-Type\": \"application/json\"}\n" +
    "  r = requests.post(f\"{base}/call-tool\", headers=hdrs,\n" +
    "      json={\"name\": \"tool_name\", \"params\": {}}).json()\n" +
    "  print(json.dumps(r, indent=2))\n" +
    "  PYEOF\n" +
    "  python3 $MINI_A_PTC_DIR/task.py"
  )
}
