(function() {
  load("mini-a-common.js")

  var SERVER_YAML = "tests/mcpAuthServer.yaml"

  var _freshPort = function() {
    var ss = new java.net.ServerSocket(0)
    var p = ss.getLocalPort()
    ss.close()
    return p
  }

  var _spawn = function(port, extraArgs) {
    var cmdArgs = ["ojob", SERVER_YAML, "onport=" + port]
    Object.keys(extraArgs || {}).forEach(function(k) { cmdArgs.push(k + "=" + extraArgs[k]) })
    // ProcessBuilder needs genuine java.lang.String elements, not Rhino ConsString
    var pb = new java.lang.ProcessBuilder(cmdArgs.map(function(s) { return String(s) }))
    pb.redirectErrorStream(true)
    var logFile = String(io.createTempFile("mcpauth-test-", ".log"))
    pb.redirectOutput(new java.io.File(logFile))
    var proc = pb.start()
    return { proc: proc, logFile: logFile, port: port }
  }

  var _waitReady = function(port, maxMs) {
    maxMs = isDef(maxMs) ? maxMs : 8000
    var start = now()
    while ((now() - start) < maxMs) {
      try {
        var h = new ow.obj.http()
        h.setThrowExceptions(false)
        h.exec("http://localhost:" + port + "/healthz", "GET", __, {}, false, 1000)
        if (h.responseCode() == 200) return true
      } catch(e) {}
      sleep(200)
    }
    return false
  }

  var _stop = function(handle) {
    try {
      handle.proc.destroy()
      handle.proc.waitFor(3, java.util.concurrent.TimeUnit.SECONDS)
      if (handle.proc.isAlive()) handle.proc.destroyForcibly()
    } catch(e) {}
    try { io.rm(handle.logFile) } catch(e) {}
  }

  var _header = function(headers, name) {
    if (!isMap(headers)) return __
    var lname = name.toLowerCase()
    var k = Object.keys(headers).filter(function(k) { return k.toLowerCase() == lname })[0]
    return isDef(k) ? headers[k] : __
  }

  var _hasHeader = function(headers, name) {
    return isDef(_header(headers, name))
  }

  var _rpc = function(port, uri, headers, method, params) {
    var body = stringify({ jsonrpc: "2.0", id: 1, method: method, params: params || {} }, __, "")
    var h = new ow.obj.http()
    h.setThrowExceptions(false)
    // exec() already reads and closes the response body once; don't call h.response() again afterward
    var out = h.exec("http://localhost:" + port + uri, "POST", body, merge({ "Content-Type": "application/json" }, headers || {}), false, 5000)
    var res = { status: out.responseCode, headers: h.responseHeaders(), raw: out.response }
    try { res.json = jsonParse(res.raw) } catch(e) {}
    return res
  }

  var _withServer = function(extraArgs, fn) {
    var port = _freshPort()
    var handle = _spawn(port, extraArgs)
    try {
      if (!_waitReady(port)) throw "Test MCP server on port " + port + " did not become ready (log: " + handle.logFile + ")"
      fn(port)
    } finally {
      _stop(handle)
    }
  }

  // ── Tests ──────────────────────────────────────────────────────────────────

  exports.testFailOpenWhenNoToken = function() {
    _withServer({}, function(port) {
      var res = _rpc(port, "/mcp", {}, "initialize", {})
      ow.test.assert(res.status, 200, "initialize should succeed when no auth token is configured (fail-open)")
    })
  }

  exports.testHealthzStaysOpenWithAuth = function() {
    _withServer({ authtoken: "s3cr3t" }, function(port) {
      var h = new ow.obj.http()
      h.setThrowExceptions(false)
      h.exec("http://localhost:" + port + "/healthz", "GET", __, {}, false, 2000)
      ow.test.assert(h.responseCode(), 200, "/healthz should stay open even when auth is configured")
    })
  }

  exports.testMissingHeaderRejected = function() {
    _withServer({ authtoken: "s3cr3t" }, function(port) {
      var res = _rpc(port, "/mcp", {}, "initialize", {})
      ow.test.assert(res.status, 401, "missing Authorization header should be rejected")
      ow.test.assert(_hasHeader(res.headers, "WWW-Authenticate"), true, "401 response should include a WWW-Authenticate challenge")
    })
  }

  exports.testWrongTokenRejected = function() {
    _withServer({ authtoken: "s3cr3t" }, function(port) {
      var res = _rpc(port, "/mcp", { "Authorization": "Bearer wrong" }, "initialize", {})
      ow.test.assert(res.status, 401, "wrong bearer token should be rejected")
    })
  }

  exports.testCorrectTokenAccepted = function() {
    _withServer({ authtoken: "s3cr3t" }, function(port) {
      var res = _rpc(port, "/mcp", { "Authorization": "Bearer s3cr3t" }, "initialize", {})
      ow.test.assert(res.status, 200, "correct bearer token should be accepted")
      ow.test.assert(isDef(res.json) && isDef(res.json.result), true, "response should be a valid JSON-RPC result")
    })
  }

  exports.testAuthHeaderScrubbedFromToolJob = function() {
    _withServer({ authtoken: "s3cr3t" }, function(port) {
      var res = _rpc(port, "/mcp", { "Authorization": "Bearer s3cr3t" }, "tools/call", { name: "echo", arguments: {} })
      ow.test.assert(res.status, 200, "tool call with correct token should succeed")
      var text = res.json.result.content[0].text
      var parsed = jsonParse(text)
      ow.test.assert(parsed.sawAuthHeader, false, "the auth header must be scrubbed from _httprequest before reaching the tool job")
    })
  }

  exports.testSSEUnauthorizedRejectedWithoutStreaming = function() {
    _withServer({ authtoken: "s3cr3t", usestream: "true" }, function(port) {
      var res = _rpc(port, "/mcp", {}, "initialize", {})
      ow.test.assert(res.status, 401, "SSE mode: missing header should be rejected")
      var ct = String(_header(res.headers, "Content-Type") || "")
      ow.test.assert(ct.indexOf("event-stream") < 0, true, "SSE mode: 401 must not be a half-open event-stream")
    })
  }

  exports.testSSEAuthorizedStreams = function() {
    _withServer({ authtoken: "s3cr3t", usestream: "true" }, function(port) {
      var res = _rpc(port, "/mcp", { "Authorization": "Bearer s3cr3t" }, "initialize", {})
      ow.test.assert(res.status, 200, "SSE mode: correct token should be accepted")
      ow.test.assert(String(res.raw).indexOf("event: message") >= 0, true, "SSE mode: body should contain a message event")
    })
  }
})()
