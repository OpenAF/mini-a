(function() {
  load("mini-a.js")

  var createAgent = function() {
    var agent = new MiniA()
    agent.fnI = function() {}
    return agent
  }

  exports.testCapabilityRegistrySelectsBoundedRelevantSubset = function() {
    var agent = createAgent()
    agent.mcpTools = [
      { name: "database_query", description: "Query a SQL database", inputSchema: {} },
      { name: "image_resize", description: "Resize an image", inputSchema: {} },
      { name: "calendar_list", description: "List calendar events", inputSchema: {} }
    ]
    var selected = agent._selectCapabilities("query the database", { capabilitylimit: 1 })
    ow.test.assert(selected.total, 3, "registry should normalize all MCP tools")
    ow.test.assert(selected.selected.length, 1, "capability selection must honor the exposure limit")
    ow.test.assert(selected.selected[0].name, "database_query", "selection should prefer the relevant capability")
  }

  exports.testPolicyDeniesShellAndCapabilityAndNetwork = function() {
    var agent = createAgent()
    agent._initPolicyRuntime({ policy: { shell: "deny", deniedTools: ["dangerous_tool"], filesystem: { write: "deny" }, network: { allowDomains: ["example.com"] } } })
    var shell = agent._runCommand({ command: "echo should-not-run" })
    ow.test.assert(shell.output.indexOf("[blocked by policy]") === 0, true, "shell policy must block before execution")
    ow.test.assert(agent._policyDecision({ type: "tool", name: "dangerous_tool" }).decision, "deny", "tool policy must deny named capabilities")
    ow.test.assert(agent._policyDecision({ type: "tool", name: "http_request", url: "https://untrusted.example.net/x" }).decision, "deny", "network policy must deny unapproved domains")
    ow.test.assert(agent._policyDecision({ type: "tool", name: "file_write", access: "write" }).decision, "deny", "filesystem policy must deny classified writes")
  }

  exports.testPolicyDefaultsToAllowForCompatibility = function() {
    var agent = createAgent()
    agent._initPolicyRuntime({})
    ow.test.assert(agent._policyDecision({ type: "tool", name: "existing_tool" }).decision, "allow", "empty policy must preserve existing behavior")
  }

  exports.testIndependentPoliciesIntersect = function() {
    var combined = MiniAPolicyRuntime.intersection([
      { shell: "approval", filesystem: { write: "deny" }, network: { allowDomains: ["example.com"] } },
      { shell: "deny", filesystem: { read: "deny" }, network: { allowDomains: ["api.example.com"] } }
    ])
    ow.test.assert(combined.evaluate({ type: "shell" }).decision, "deny", "Worker denial wins over parent approval")
    ow.test.assert(combined.evaluate({ type: "filesystem", access: "read" }).decision, "deny", "Worker read restriction remains active")
    ow.test.assert(combined.evaluate({ type: "filesystem", access: "write" }).decision, "deny", "Parent write restriction remains active")
    ow.test.assert(combined.evaluate({ type: "tool", url: "https://www.example.com" }).decision, "deny", "Network domains must satisfy both policies")
    ow.test.assert(combined.evaluate({ type: "tool", url: "https://api.example.com" }).decision, "allow", "Shared network domains remain allowed")
    var disabled = MiniAPolicyRuntime.intersection([{ enabled: false, shell: "deny" }, { shell: "approval" }])
    ow.test.assert(disabled.evaluate({ type: "shell" }).decision, "approval", "Disabled policy cannot disable another authority")
    var agent = createAgent()
    agent._initPolicyRuntime({ policy: { filesystem: { read: "deny" } }, _inheritedPolicies: [{ filesystem: { write: "deny" } }] })
    ow.test.assert(agent._policyDecision({ type: "filesystem", access: "read" }).decision, "deny", "Local policy remains enforced")
    ow.test.assert(agent._policyDecision({ type: "filesystem", access: "write" }).decision, "deny", "Inherited policy is also enforced")
    agent._initPolicyRuntime({ policy: { enabled: false }, _inheritedPolicies: [{ shell: "deny" }] })
    ow.test.assert(agent._policyDecision({ type: "shell" }).decision, "deny", "Local opt-out cannot disable inherited policy")
    var failed = false
    try { MiniAPolicyRuntime.intersection([{}, "not a policy"]) } catch(e) { failed = true }
    ow.test.assert(failed, true, "Invalid inherited policy fails closed")
  }

  exports.testPolicyProtectsDirectAndProxyToolCalls = function() {
    var agent = createAgent(), calls = 0
    agent._mcpConnections = { fixture: { callTool: function() { calls++; return { content: [{ type: "text", text: "ok" }] } } } }
    agent._initPolicyRuntime({ policy: { deniedTools: ["blocked"], filesystem: { write: "deny" }, network: { allowDomains: ["example.com"] } } })
    var invoke = function(name, params) { return agent._executeToolWithCache("fixture", name, params) }
    ow.test.assert(invoke("blocked", {}).policy, "deny", "Direct denied capability is not dispatched")
    ow.test.assert(invoke("proxy-dispatch", { action: "call", tool: "blocked", arguments: {} }).policy, "deny", "Proxy cannot hide the denied capability")
    ow.test.assert(invoke("filesystemModify", { operation: "write" }).policy, "deny", "Write operation is denied")
    ow.test.assert(invoke("proxy-dispatch", { action: "call", tool: "filesystemQuery", arguments: { operation: "delete" } }).policy, "deny", "Proxy operation is classified")
    ow.test.assert(invoke("filesystemQuery", { operation: "deleteFile" }).policy, "deny", "Camel-case write operation is classified")
    ow.test.assert(invoke("http_request", { url: "https://untrusted.invalid" }).policy, "deny", "Direct network policy is enforced")
    ow.test.assert(invoke("proxy-dispatch", { action: "call", tool: "http_request", argumentsFile: "/tmp/input" }).policy, "deny", "Opaque proxy arguments cannot bypass policy")
    ow.test.assert(calls, 0, "Rejected calls never reach the MCP client")
    agent._initPolicyRuntime({})
    invoke("proxy-dispatch", { action: "call", tool: "http_request", argumentsFile: "/tmp/input" })
    ow.test.assert(calls, 1, "Unrestricted proxy file handoff remains available")
  }

  exports.testPolicyCoversPluginMcpAndDelegationBoundaries = function() {
    var agent = createAgent()
    agent._initPolicyRuntime({ policy: { mcp: "deny", delegation: "deny", wiki: { write: "deny" } } })
    ow.test.assert(agent._policyDecision({ type: "tool", name: "remote_call" }).decision, "deny", "MCP policy must prevent proxy and plugin transport calls")
    agent._initPolicyRuntime({ policy: { plugins: "deny" } })
    ow.test.assert(agent._policyDecision({ type: "tool", name: "plugin_tool", plugin: true }).decision, "deny", "plugin policy must deny plugin capabilities")
    agent._initPolicyRuntime({ policy: { delegation: "deny", wiki: { write: "deny" } } })
    ow.test.assert(agent._policyDecision({ type: "delegation", name: "delegation" }).decision, "deny", "delegation policy must prevent nested agents")
    ow.test.assert(agent._policyDecision({ type: "wiki_write", name: "notes/page.md" }).decision, "deny", "Wiki mutation policy must protect all write operations")
  }
})()
