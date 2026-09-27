(function() {
  function check(a, b, msg) { ow.test.assert(a, b, msg) }
  function rejects(fn) { var failed = false; try { fn() } catch(e) { failed = true }; check(failed, true, "Expected rejection") }
  var descriptor = io.readFileYAML("mcps/mcp-workiq.yaml")
  var clientJob = descriptor.jobs.filter(function(job) { return job.name === "WorkIQ Client" })[0]
  var WorkIQ = new Function(clientJob.exec + "\nreturn WorkIQ")()
  function fixture(args, env) {
    var state = { calls: [], closed: false }
    var client = new WorkIQ(args || {}, env || {}, function(cfg) {
      state.config = cfg
      return {
        initialize: function() {},
        listTools: function() { return { tools: [
          { name: "fetch", inputSchema: { type: "object", properties: { entityUrls: { type: "array" } } } },
          { name: "ask", inputSchema: { type: "object", properties: { agentId: { type: "string" }, question: { type: "string" } } } },
          { name: "create_entity", annotations: { readOnlyHint: true } },
          { name: "unknown_read", annotations: { readOnlyHint: true } }
        ] } },
        callTool: function(name, args) {
          state.calls.push({ name: name, args: args })
          if (state.fail) throw new Error("Authorization: Bearer secret")
          return { content: [ { type: "text", text: "answer" } ], structuredContent: { value: 42 }, isError: false }
        },
        authenticate: function() { state.authenticated = true; return { authenticated: true } },
        getAuthStatus: function() { return { authenticated: false } },
        clearAuth: function() { state.cleared = true; return { authenticated: false } },
        destroy: function() { state.closed = true }
      }
    })
    return { client: client, state: state }
  }
  exports.testReadOnlyDispatch = function() {
    var f = fixture(); f.client.connect()
    var list = f.client.dispatch({ action: "list" })
    check(list.tools.map(function(t) { return t.name }), [ "fetch", "ask" ], "Only known read tools")
    check(isUnDef(list.tools[1].inputSchema.properties.agentId), true, "Custom agent routing hidden")
    rejects(function() { f.client.dispatch({ action: "call", tool: "create_entity", arguments: {} }) })
    rejects(function() { f.client.dispatch({ action: "call", tool: "unknown_read", arguments: {} }) })
    rejects(function() { f.client.dispatch({ action: "call", tool: "ask", arguments: { agentId: "custom" } }) })
    check(f.state.calls.length, 0, "Blocked calls never dispatched")
    var result = f.client.dispatch({ action: "call", tool: "fetch", arguments: { entityUrls: [ "/me/messages" ] } })
    check(result.structuredContent.value, 42, "Structured content preserved")
    check(result.content[0].text, "answer", "Content preserved")
    check(f.state.calls[0].args.entityUrls, [ "/me/messages" ], "Exact arguments forwarded")
    rejects(function() { f.client.dispatch({ action: "logout" }) })
    f.client.destroy(); check(f.state.closed, true, "Client cleanup")
  }
  exports.testWriteOptInAndErrors = function() {
    var f = fixture({ readwrite: true }); f.client.connect()
    check(f.client.dispatch({ action: "list" }).tools.length, 4, "Full catalog when opted in")
    f.client.dispatch({ action: "call", tool: "create_entity", arguments: { body: "test" } })
    f.state.fail = true
    var result = f.client.dispatch({ action: "call", tool: "create_entity", arguments: {} })
    check(result.isError, true, "Transport failure is MCP error")
    check(stringify(result).indexOf("secret"), -1, "Transport credentials not exposed")
    check(f.state.calls.length, 2, "No retries")
  }
  exports.testConfigurationAndOperator = function() {
    var f = fixture({ op: "login", profile: "alice" })
    check(f.state.config.auth.interactive, true, "Login is interactive")
    check(f.state.config.auth.tokenStore.repo, "mini-a-workiq", "Dedicated SBucket")
    check(f.state.config.auth.tokenStore.key, "alice", "Named profile")
    check(f.state.config.auth.clientId, "ba081686-5d24-4bc6-a0d6-d034ecffed87", "Public client default")
    check(f.state.config.auth.sendResource, false, "Use scopes instead of resource")
    check(f.client.runOperator().authenticated, true, "Login authenticates")
    check(fixture().state.config.auth.interactive, false, "Serve never prompts")
    f = fixture({ op: "logout" }); f.client.runOperator(); check(f.state.cleared, true, "Logout clears cache")
    rejects(function() { fixture({ auth: "token" }) })
    f = fixture({ auth: "token" }, { WORKIQ_ACCESS_TOKEN: "fixture-token" })
    check(f.state.config.auth.type, "bearer", "Explicit token mode")
    check(isUnDef(f.state.config.auth.tokenStore), true, "Supplied token not persisted")
    rejects(function() { fixture({ profile: "../bad" }) })
    rejects(function() { fixture({ tenant: "example.org/evil" }) })
  }
})();
