(function() {
  load("mini-a-common.js")
  load("mini-a-progcall.js")

  // ─── Mock agent ────────────────────────────────────────────────────────────
  // A minimal agent stub that satisfies MiniAProgCallServer's expectations.
  var makeMockAgent = function(options) {
    options = options || {}
    return {
      mcpTools: isArray(options.mcpTools) ? options.mcpTools : [
        { name: "read_file",  description: "Read a file from disk", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
        { name: "list_files", description: "List files in a directory" },
        { name: "run_query",  description: "Execute SQL query" }
      ],
      mcpToolToConnection: {},
      _callMcpToolImpl: options._callMcpToolImpl || null,
      _callMcpTool: function(toolName, params) {
        if (typeof this._callMcpToolImpl === "function") return this._callMcpToolImpl(toolName, params)
        // Default: echo params back as result
        return {
          rawResult : { result: { toolName: toolName, params: params } },
          normalized: { processed: { toolName: toolName, params: params }, display: stringify({ toolName: toolName, params: params }, __, ""), hasError: false },
          error     : false
        }
      }
    }
  }

  var makeAndStartServer = function(agentOpts, startOpts) {
    var agent = makeMockAgent(agentOpts)
    var srv   = new MiniAProgCallServer(agent)
    var info  = srv.start(startOpts || {})
    return { srv: srv, agent: agent, info: info }
  }

  // ─── HTTP helper (Java HttpURLConnection — works with custom headers) ─────
  var _doRequest = function(method, port, path, token, body) {
    try {
      var url = new java.net.URL("http://127.0.0.1:" + port + path)
      var conn = url.openConnection()
      conn.setRequestMethod(method)
      if (isDef(token)) conn.setRequestProperty("X-Mini-A-Token", token)
      if (method === "POST") {
        conn.setRequestProperty("Content-Type", "application/json")
        conn.setDoOutput(true)
        var postBytes = java.lang.String(isDef(body) ? stringify(body, __, "") : "{}").getBytes("UTF-8")
        var os = conn.getOutputStream()
        os.write(postBytes)
        os.flush()
      }
      var code = conn.getResponseCode()
      var stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream()
      var reader = new java.io.BufferedReader(new java.io.InputStreamReader(stream, "UTF-8"))
      var sb = new java.lang.StringBuilder()
      var line
      while ((line = reader.readLine()) !== null) sb.append(line)
      var parsed = jsonParse(String(sb.toString()), {})
      parsed.__httpStatus = code
      return parsed
    } catch(e) {
      return { __error: String(e) }
    }
  }

  var httpGet  = function(port, path, token)       { return _doRequest("GET",  port, path, token) }
  var httpPost = function(port, path, token, body) { return _doRequest("POST", port, path, token, body) }

  // ─── Tests ────────────────────────────────────────────────────────────────

  exports.testServerStartsAndStopsCleanly = function() {
    var t = makeAndStartServer()
    var srv = t.srv

    ow.test.assert(isNumber(t.info.port) && t.info.port > 0,     true, "Server should bind to a positive port")
    ow.test.assert(isString(t.info.token) && t.info.token.length > 0, true, "Token should be a non-empty string")
    ow.test.assert(isString(t.info.tmpDir) && io.fileExists(t.info.tmpDir), true, "Temp dir should exist after start")
    ow.test.assert(isString(srv._token) && srv._port === t.info.port, true, "Internal state matches start() result")

    srv.stop()

    ow.test.assert(isUnDef(srv._httpServer) || srv._httpServer === __, true, "HTTP server ref should be cleared after stop")
    ow.test.assert(isUnDef(srv._token) || srv._token === __,           true, "Token should be cleared after stop")
    ow.test.assert(!io.fileExists(t.info.tmpDir),                      true, "Temp dir should be removed after stop")
  }

  exports.testTokenRejection = function() {
    var t = makeAndStartServer()
    var port = t.info.port
    var token = t.info.token
    try {
      // No token → 403
      var r1 = httpGet(port, "/list-tools")
      ow.test.assert(isMap(r1) && r1.__httpStatus === 403, true, "Missing token should yield 403")

      // Wrong token → 403
      var r2 = httpGet(port, "/list-tools", "wrong-token-xyz")
      ow.test.assert(isMap(r2) && r2.__httpStatus === 403, true, "Wrong token should yield 403")

      // Correct token → 200
      var r3 = httpGet(port, "/list-tools", token)
      ow.test.assert(isMap(r3) && isArray(r3.tools), true, "Correct token should return tools array")
    } finally {
      t.srv.stop()
    }
  }

  exports.testListToolsReturnsExpectedShape = function() {
    var t = makeAndStartServer()
    var port = t.info.port; var token = t.info.token
    try {
      var r = httpGet(port, "/list-tools", token)
      ow.test.assert(isMap(r) && isArray(r.tools),        true, "/list-tools should return { tools: [...] }")
      ow.test.assert(r.tools.length === 3,                true, "Should have 3 tools")
      var names = r.tools.map(function(t) { return t.name })
      ow.test.assert(names.indexOf("read_file") >= 0,     true, "read_file should be listed")
      ow.test.assert(isString(r.tools[0].description),    true, "Each tool should have a description")
      // No inputSchema by default
      ow.test.assert(isUnDef(r.tools[0].inputSchema),     true, "inputSchema should be absent without ?schema=1")

      // With ?schema=1
      var r2 = httpGet(port, "/list-tools?schema=1", token)
      var rf = r2.tools.filter(function(t) { return t.name === "read_file" })[0]
      ow.test.assert(isMap(rf) && isMap(rf.inputSchema),  true, "?schema=1 should include inputSchema for read_file")
    } finally {
      t.srv.stop()
    }
  }

  exports.testListToolsProxyAware = function() {
    // Simulate mcpproxy global state
    var savedProxy = global.__mcpProxyState__
    global.__mcpProxyState__ = {
      connections: {
        "conn1": {
          alias: "db",
          tools: [
            { name: "run_query", description: "Execute SQL query" },
            { name: "proxy-dispatch", description: "internal" }   // should be excluded
          ]
        }
      }
    }
    var t = makeAndStartServer()
    var port = t.info.port; var token = t.info.token
    try {
      var r = httpGet(port, "/list-tools", token)
      ow.test.assert(isArray(r.tools),                         true, "Should return tools from proxy state")
      var names = r.tools.map(function(t) { return t.name })
      ow.test.assert(names.indexOf("run_query") >= 0,          true, "run_query should be listed from proxy")
      ow.test.assert(names.indexOf("proxy-dispatch") < 0,      true, "proxy-dispatch itself must be excluded")
      var rq = r.tools.filter(function(t) { return t.name === "run_query" })[0]
      ow.test.assert(rq.connection === "db",                   true, "Connection alias should be present in proxy mode")
    } finally {
      t.srv.stop()
      global.__mcpProxyState__ = savedProxy
    }
  }

  exports.testSearchToolsFiltersCorrectly = function() {
    var t = makeAndStartServer()
    var port = t.info.port; var token = t.info.token
    try {
      // Search for "file"
      var r1 = httpGet(port, "/search-tools?q=file", token)
      ow.test.assert(isArray(r1.tools),                          true, "/search-tools should return tools array")
      var names1 = r1.tools.map(function(t) { return t.name })
      ow.test.assert(names1.indexOf("read_file") >= 0,           true, "read_file should match 'file'")
      ow.test.assert(names1.indexOf("list_files") >= 0,          true, "list_files should match 'file'")
      ow.test.assert(names1.indexOf("run_query") < 0,            true, "run_query should not match 'file'")

      // Search for "query"
      var r2 = httpGet(port, "/search-tools?q=query", token)
      var names2 = r2.tools.map(function(t) { return t.name })
      ow.test.assert(names2.length === 1 && names2[0] === "run_query", true, "Only run_query should match 'query'")

      // Empty search → all tools
      var r3 = httpGet(port, "/search-tools", token)
      ow.test.assert(r3.tools.length === 3,                      true, "Empty query should return all tools")
    } finally {
      t.srv.stop()
    }
  }

  exports.testCallToolHappyPath = function() {
    var t = makeAndStartServer()
    var port = t.info.port; var token = t.info.token
    try {
      var r = httpPost(port, "/call-tool", token, { name: "read_file", params: { path: "/etc/hosts" } })
      ow.test.assert(isMap(r) && r.ok === true, true, "/call-tool should return ok:true on success")
      ow.test.assert(isMap(r.result) || isString(r.result) || isDef(r.resultId),
        true, "Response should include result or resultId")
    } finally {
      t.srv.stop()
    }
  }

  exports.testCallToolErrorPath = function() {
    var agent = makeMockAgent({
      _callMcpToolImpl: function(toolName, params) {
        return {
          rawResult : { error: "tool failed" },
          normalized: { processed: "tool failed", display: "tool failed", hasError: true },
          error     : true
        }
      }
    })
    var srv = new MiniAProgCallServer(agent)
    srv.start({})
    var port = srv._port; var token = srv._token
    try {
      var r = httpPost(port, "/call-tool", token, { name: "read_file", params: {} })
      ow.test.assert(isMap(r) && r.ok === false,    true, "Tool error should return ok:false")
      ow.test.assert(isString(r.error),             true, "Tool error should include error message")
    } finally {
      srv.stop()
    }
  }

  exports.testCallToolMissingName = function() {
    var t = makeAndStartServer()
    var port = t.info.port; var token = t.info.token
    try {
      var r = httpPost(port, "/call-tool", token, { params: {} })
      ow.test.assert(isMap(r) && isString(r.error), true, "Missing name should return error")
    } finally {
      t.srv.stop()
    }
  }

  exports.testOversizedResultSpillsToResultStore = function() {
    // Configure a tiny threshold so our result always spills
    var agent = makeMockAgent({
      _callMcpToolImpl: function(toolName, params) {
        var largeText = new Array(200).join("x")  // 199-char string
        return {
          rawResult : { text: largeText },
          normalized: { processed: largeText, display: largeText, hasError: false },
          error     : false
        }
      }
    })
    var srv = new MiniAProgCallServer(agent)
    srv.start({ maxBytes: 50 })   // very small threshold
    var port = srv._port; var token = srv._token
    try {
      var r = httpPost(port, "/call-tool", token, { name: "read_file", params: {} })
      ow.test.assert(isMap(r) && r.ok === true,        true, "Spilled result should still return ok:true")
      ow.test.assert(isString(r.resultId),             true, "Response should include resultId when result is large")
      ow.test.assert(isString(r.preview),              true, "Response should include preview")
      ow.test.assert(isNumber(r.size) && r.size > 50,  true, "Response should include size > threshold")
      ow.test.assert(isUnDef(r.result),                true, "Full result should not be inline when spilled")

      // Retrieve the full result
      var r2 = httpGet(port, "/result/" + r.resultId, token)
      ow.test.assert(isMap(r2) && r2.ok === true,      true, "/result/{id} should return ok:true")
      ow.test.assert(isDef(r2.result),                 true, "/result/{id} should include full result")
    } finally {
      srv.stop()
    }
  }

  exports.testResultPagination = function() {
    var longText = ""
    for (var i = 0; i < 100; i++) longText += "chunk" + i + " "
    var agent = makeMockAgent({
      _callMcpToolImpl: function() {
        return {
          rawResult : { text: longText },
          normalized: { processed: longText, display: longText, hasError: false },
          error     : false
        }
      }
    })
    var srv = new MiniAProgCallServer(agent)
    srv.start({ maxBytes: 10 })   // force spill
    var port = srv._port; var token = srv._token
    try {
      var r = httpPost(port, "/call-tool", token, { name: "list_files", params: {} })
      ow.test.assert(isString(r.resultId), true, "Result should be spilled")
      var id = r.resultId

      // Paginate: offset=0, limit=20
      var p1 = httpGet(port, "/result/" + id + "?offset=0&limit=20", token)
      ow.test.assert(isMap(p1) && p1.ok === true,           true, "Paginated fetch should return ok:true")
      ow.test.assert(isString(p1.data) && p1.data.length <= 20, true, "Paginated data should be at most limit chars")
      ow.test.assert(p1.offset === 0,                       true, "Offset should be echoed")
      ow.test.assert(isNumber(p1.totalSize),                true, "totalSize should be present")

      // Paginate: offset=20, limit=20
      var p2 = httpGet(port, "/result/" + id + "?offset=20&limit=20", token)
      ow.test.assert(isString(p2.data) && p2.data.length <= 20, true, "Second page should also be bounded")
      ow.test.assert(p2.offset === 20,                      true, "Second page offset should be 20")
    } finally {
      srv.stop()
    }
  }

  exports.testResultTTLExpiry = function() {
    var agent = makeMockAgent({
      _callMcpToolImpl: function() {
        var v = new Array(300).join("y")
        return {
          rawResult : { text: v },
          normalized: { processed: v, display: v, hasError: false },
          error     : false
        }
      }
    })
    var srv = new MiniAProgCallServer(agent)
    srv.start({ maxBytes: 10, resultTTL: 1 })   // 1 second TTL
    var port = srv._port; var token = srv._token
    try {
      var r = httpPost(port, "/call-tool", token, { name: "list_files", params: {} })
      ow.test.assert(isString(r.resultId), true, "Result should be spilled")
      var id = r.resultId

      // Still accessible immediately
      var r2 = httpGet(port, "/result/" + id, token)
      ow.test.assert(isMap(r2) && r2.ok === true, true, "Result should be accessible immediately")

      // Expire the entry manually (simulate TTL)
      srv._resultStore[id].expiresAt = Date.now() - 1

      // Trigger eviction via another call
      httpPost(port, "/call-tool", token, { name: "list_files", params: {} })

      // Now fetch the expired result
      var r3 = httpGet(port, "/result/" + id, token)
      ow.test.assert(isMap(r3) && r3.error !== __, true, "Expired result should return error")
    } finally {
      srv.stop()
    }
  }

  exports.testBatchEndpoint = function() {
    var t = makeAndStartServer()
    var port = t.info.port; var token = t.info.token
    try {
      var calls = [
        { id: "a", name: "read_file",  params: { path: "/etc/hosts" } },
        { id: "b", name: "list_files", params: { dir: "/tmp" } },
        { id: "c", name: "run_query",  params: { sql: "SELECT 1" } }
      ]
      var r = httpPost(port, "/call-tools-batch", token, { calls: calls })
      ow.test.assert(isMap(r) && isArray(r.results),           true, "/call-tools-batch should return { results: [...] }")
      ow.test.assert(r.results.length === 3,                   true, "Should return result for each call")
      var ids = r.results.map(function(res) { return res.id })
      ow.test.assert(ids.indexOf("a") >= 0,                    true, "Result 'a' should be present")
      ow.test.assert(ids.indexOf("b") >= 0,                    true, "Result 'b' should be present")
      ow.test.assert(ids.indexOf("c") >= 0,                    true, "Result 'c' should be present")
      r.results.forEach(function(res) {
        ow.test.assert(res.ok === true, true, "Each batch result should be ok:true (mock always succeeds)")
      })
    } finally {
      t.srv.stop()
    }
  }

  exports.testBatchEnforcesMaxCalls = function() {
    var t = makeAndStartServer({}, { batchMax: 2 })
    var port = t.info.port; var token = t.info.token
    try {
      var calls = [
        { id: "a", name: "read_file",  params: {} },
        { id: "b", name: "list_files", params: {} },
        { id: "c", name: "run_query",  params: {} }   // should be truncated
      ]
      var r = httpPost(port, "/call-tools-batch", token, { calls: calls })
      ow.test.assert(isArray(r.results) && r.results.length === 2, true, "Batch should be capped at batchMax")
    } finally {
      t.srv.stop()
    }
  }

  exports.testToolAllowlist = function() {
    var t = makeAndStartServer({}, { allowedTools: "read_file,list_files" })
    var port = t.info.port; var token = t.info.token
    try {
      // Allowed tool → ok
      var r1 = httpPost(port, "/call-tool", token, { name: "read_file", params: {} })
      ow.test.assert(isMap(r1) && r1.ok === true, true, "Allowed tool should succeed")

      // Denied tool → 403 (returned in JSON at HTTP 200 due to design, error in body)
      var r2 = httpPost(port, "/call-tool", token, { name: "run_query", params: {} })
      ow.test.assert(isMap(r2) && isString(r2.error) && r2.error.indexOf("allowlist") >= 0,
        true, "Denied tool should return allowlist error")
    } finally {
      t.srv.stop()
    }
  }

  exports.testTOONResponseNormalization = function() {
    // Simulate a TOON-style (SLON) response that comes back as a string
    var agent = makeMockAgent({
      _callMcpToolImpl: function() {
        return {
          rawResult : { text: "{key:\"value\",num:42}" },
          normalized: { processed: "{key:\"value\",num:42}", display: "{key:\"value\",num:42}", hasError: false },
          error     : false
        }
      }
    })
    var srv = new MiniAProgCallServer(agent)
    srv.start({})
    var port = srv._port; var token = srv._token
    try {
      var r = httpPost(port, "/call-tool", token, { name: "run_query", params: {} })
      ow.test.assert(isMap(r) && r.ok === true, true, "TOON/string response should return ok:true")
      // The string couldn't be JSON-parsed so it should be wrapped in { text: "..." }
      ow.test.assert(isDef(r.result),           true, "Result should be present")
    } finally {
      srv.stop()
    }
  }

  exports.testJSONObjectResultPassedThrough = function() {
    var agent = makeMockAgent({
      _callMcpToolImpl: function() {
        return {
          rawResult : { items: [1, 2, 3] },
          normalized: { processed: { items: [1, 2, 3] }, display: '{"items":[1,2,3]}', hasError: false },
          error     : false
        }
      }
    })
    var srv = new MiniAProgCallServer(agent)
    srv.start({})
    var port = srv._port; var token = srv._token
    try {
      var r = httpPost(port, "/call-tool", token, { name: "run_query", params: {} })
      ow.test.assert(isMap(r) && r.ok === true,        true, "JSON object result should return ok:true")
      ow.test.assert(isMap(r.result),                  true, "Result should be the JSON object")
      ow.test.assert(isArray(r.result.items),          true, "Result items should be an array")
    } finally {
      srv.stop()
    }
  }

  exports.testTempDirCreationAndCleanup = function() {
    var srv = new MiniAProgCallServer(makeMockAgent())
    var info = srv.start({})

    ow.test.assert(isString(info.tmpDir),              true, "tmpDir should be a string path")
    ow.test.assert(io.fileExists(info.tmpDir),         true, "tmpDir should exist after start")

    // Verify it's writable
    var testFile = info.tmpDir + java.io.File.separator + "test.txt"
    io.writeFileString(testFile, "hello")
    ow.test.assert(io.fileExists(testFile),            true, "Temp dir should be writable")

    srv.stop()

    ow.test.assert(!io.fileExists(info.tmpDir),        true, "tmpDir should be removed after stop")
  }

  exports.testEnvVarsAreCorrect = function() {
    var srv = new MiniAProgCallServer(makeMockAgent())
    var info = srv.start({})
    var envs = srv.envVars()
    try {
      ow.test.assert(isString(envs.MINI_A_PTC_PORT) && envs.MINI_A_PTC_PORT === String(info.port),
        true, "MINI_A_PTC_PORT should match the bound port")
      ow.test.assert(isString(envs.MINI_A_PTC_TOKEN) && envs.MINI_A_PTC_TOKEN === info.token,
        true, "MINI_A_PTC_TOKEN should match the session token")
      ow.test.assert(isString(envs.MINI_A_PTC_DIR) && envs.MINI_A_PTC_DIR === info.tmpDir,
        true, "MINI_A_PTC_DIR should match the temp directory path")
    } finally {
      srv.stop()
    }
  }

  exports.testEachInstanceGetsUniquePortAndToken = function() {
    var srv1 = new MiniAProgCallServer(makeMockAgent())
    var srv2 = new MiniAProgCallServer(makeMockAgent())
    var info1 = srv1.start({})
    var info2 = srv2.start({})
    try {
      // Tokens must always be different (UUID-based)
      ow.test.assert(info1.token !== info2.token,   true, "Each instance should get a unique token")
      ow.test.assert(info1.tmpDir !== info2.tmpDir, true, "Each instance should get a unique temp directory")
      // Both servers must be reachable on their respective ports
      var r1 = httpGet(info1.port, "/list-tools", info1.token)
      var r2 = httpGet(info2.port, "/list-tools", info2.token)
      ow.test.assert(isMap(r1) && isArray(r1.tools), true, "Server 1 should respond correctly")
      ow.test.assert(isMap(r2) && isArray(r2.tools), true, "Server 2 should respond correctly")
    } finally {
      srv1.stop()
      srv2.stop()
    }
  }

  exports.testResultNotFoundReturnsError = function() {
    var t = makeAndStartServer()
    var port = t.info.port; var token = t.info.token
    try {
      var r = httpGet(port, "/result/deadbeefcafe1234", token)
      ow.test.assert(isMap(r) && isString(r.error), true, "Unknown resultId should return error message")
    } finally {
      t.srv.stop()
    }
  }

  exports.testCompactToolManifestHelperWithProxy = function() {
    var tools = [
      { name: "tool_a", description: "Tool A\nExtra line" },
      { name: "tool_b", description: "Tool B", inputSchema: { type: "object" } }
    ]
    var proxyState = {
      connections: {
        "c1": {
          alias: "svc",
          tools: [
            { name: "proxy-dispatch", description: "internal" },
            { name: "svc_call",       description: "Service call\nMore details", inputSchema: { type: "object", properties: {} } }
          ]
        }
      }
    }

    // Without schema
    var manifest = __miniABuildCompactToolManifest(tools, proxyState, false)
    ow.test.assert(isArray(manifest) && manifest.length === 1,       true, "Proxy mode should use proxy state, excluding proxy-dispatch")
    ow.test.assert(manifest[0].name === "svc_call",                  true, "Tool name should be svc_call")
    ow.test.assert(manifest[0].connection === "svc",                 true, "Connection alias should be 'svc'")
    ow.test.assert(manifest[0].description === "Service call",       true, "Description should be first line only")
    ow.test.assert(isUnDef(manifest[0].inputSchema),                 true, "inputSchema should be absent without withSchema")

    // With schema
    var manifest2 = __miniABuildCompactToolManifest(tools, proxyState, true)
    ow.test.assert(isMap(manifest2[0].inputSchema),                  true, "inputSchema should be present with withSchema=true")

    // Fallback to tools array when no proxy state
    var manifest3 = __miniABuildCompactToolManifest(tools, __, false)
    ow.test.assert(manifest3.length === 2,                           true, "Fallback should use tools array (2 tools)")
    ow.test.assert(manifest3[0].description === "Tool A",            true, "Description should be first line only")
    ow.test.assert(isUnDef(manifest3[0].connection),                 true, "No connection field without proxy state")
  }

})()
