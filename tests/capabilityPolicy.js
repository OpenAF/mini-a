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
