// Run with oaf -f tests/mcpFeatures.js. Set MINIA_TEST_PILOT to a stdio launch
// command to also exercise the report-preview server with a current OpenAF.
load("mini-a.js")

// Assert the protocol and session behavior without a model.
function checkMcpFeature(condition, message) {
  if (!condition) throw new Error(message)
}

function mcpFeatureAgent(replies) {
  var agent = new MiniA()
  agent.fnI = function() {}
  agent._trace = function() {}
  agent._logToolUsage = function() {}
  agent._mcpInteractionArgs = { __interaction_source: "mini-a-web" }
  agent.setUserInputFn(function(request) {
    checkMcpFeature(request.private === true, "MCP interaction must stay private")
    return replies.shift()
  })
  return agent
}

function testMcpFeatures() {
  var agent = mcpFeatureAgent([0, 1, "0", 0])
  var result = agent._answerMcpElicitation({ __miniAMcpLabel: "Fixture" }, {
    message: "Choose values",
    requestedSchema: { type: "object", required: ["enable", "count"], properties: {
      enable: { type: "boolean" },
      count: { type: "integer", minimum: 0 }
    } }
  })
  checkMcpFeature(result.action === "accept" && result.content.enable === false && result.content.count === 0, "Form must retain false and zero")
  var shown = []
  agent.setUserInputFn(function(request) {
    shown.push(request)
    return 0
  })
  result = agent._answerMcpElicitation({ __miniAMcpLabel: "Fixture" }, {
    mode: "url", message: "Continue externally", url: "https://example.test/authorize"
  })
  checkMcpFeature(result.action === "accept" && shown.length === 2 &&
    shown[0].label.indexOf("example.test") >= 0 && isUnDef(shown[0].url) &&
    shown[1].url === "https://example.test/authorize", "The link must follow consent")
  result = agent._answerMcpElicitation({ __miniAMcpLabel: "Fixture" }, {
    mode: "url", message: "Bad URL", url: "https://someone@example.test/authorize"
  })
  checkMcpFeature(result.action === "decline" && shown.length === 2, "Reject misleading URLs")
  agent._mcpInteractionArgs = { workermode: true }
  checkMcpFeature(agent._answerMcpElicitation({}, {}).action === "cancel", "Unattended runs cannot answer")

  // Task controls must never become model tool results or trigger a second call.
  var root = String(java.nio.file.Files.createTempDirectory("mini-a-mcp-feature-test"))
  try {
    var calls = 0, polls = 0
    var server = {
      __miniAMcpIdentity: "fixture",
      __miniAMcpLocal: true,
      __miniAMcpLabel: "Fixture",
      callTool: function() {
        calls++
        return { resultType: "task", taskId: "t-1", status: "working", pollIntervalMs: 1 }
      },
      getTask: function() {
        polls++
        if (polls === 1) throw new Error("Transient transport failure")
        return { resultType: "complete", taskId: "t-1", status: "completed", result: { content: [{ type: "text", text: "preview" }] } }
      }
    }
    var tool = { name: "preview" }
    agent._beginRun({ runroot: root, goal: "Preview" })
    result = agent._invokeMcpTool("fixture", server, tool, {})
    checkMcpFeature(calls === 1 && polls === 2 && result.content[0].text === "preview", "Task result must survive a failed poll")
    var runId = agent._runState.runId
    checkMcpFeature(isUnDef(agent.getRunStatus(runId, { runroot: root }).state.mcp_tasks), "Public run status must omit task handles")

    var resumed = mcpFeatureAgent([])
    resumed._mcpConnections = { fixture: server }
    var args = { runroot: root, resumerun: runId }
    resumed._beginRun(args)
    var recovered = resumed._recoverMcpTasks(args)
    checkMcpFeature(recovered.length === 1 && recovered[0].result.content[0].text === "preview", "Resume must recover the terminal observation")
    result = resumed._invokeMcpTool("fixture", server, tool, {})
    checkMcpFeature(calls === 1 && polls === 2 && result.content[0].text === "preview", "Resume must avoid reissuing a task-backed call")
  } finally {
    io.rm(root)
  }

  // A standalone MCP form continues the same tool with its opaque request state.
  agent = mcpFeatureAgent([0])
  var initialCalls = 0, continued = 0
  var inline = {
    callTool: function() {
      initialCalls++
      return { resultType: "input_required", requestState: { token: "opaque" }, inputRequests: {} }
    },
    continueRequest: function(method, params, control) {
      continued++
      checkMcpFeature(method === "tools/call" && params.name === "inline" && params.arguments.count === 0 &&
        control.requestState.token === "opaque", "Preserve the original call and opaque state")
      return { content: [{ type: "text", text: "continued" }] }
    }
  }
  result = agent._invokeMcpTool("inline", inline, { name: "inline" }, { count: 0 })
  checkMcpFeature(initialCalls === 1 && continued === 1 && result.content[0].text === "continued", "Use MRTR continuation once")

  // Run Stop sends a cooperative cancellation and reports the server's actual final state.
  agent = mcpFeatureAgent([])
  var cancels = 0
  var cancellable = {
    __miniAMcpLabel: "Fixture",
    cancelTask: function() { cancels++ },
    getTask: function(taskId) {
      agent.requestStop("Stop", { releaseResources: false })
      return { taskId: taskId, status: "completed", result: { content: [{ type: "text", text: "finished during cancellation" }] } }
    }
  }
  result = agent._waitMcpTask(cancellable, { id: "cancel", taskId: "t-cancel", tool: "preview" })
  checkMcpFeature(cancels === 1 && result.content[0].text === "finished during cancellation", "A cooperative cancellation can race with completion")

  // Catalog discovery is lazy and mismatched resource bytes never enter context.
  agent = mcpFeatureAgent([0])
  agent._resetSkillRuntime({})
  var reads = 0
  var uri = "skill://fixture/SKILL.md"
  var body = "---\nname: fixture\ndescription: Test fixture\n---\nFixture skill body\n"
  var entry = { uri: uri, frontmatter: { name: "fixture", description: "Test fixture" },
    resources: [{ uri: uri, digest: "sha256:" + sha256(body), size: af.fromString2Bytes(body).length }] }
  agent._mcpConnections = { fixture: {
    __miniAMcpIdentity: sha256("fixture"),
    __miniAMcpLabel: "Fixture",
    getCapabilities: function() { return { extensions: { "io.modelcontextprotocol/skills": {} } } },
    listSkills: function() { return { skills: [entry] } },
    readResource: function() {
      reads++
      return { contents: [{ uri: uri, text: body + (reads > 1 ? "changed" : "") }] }
    }
  } }
  var bareTools = agent._listMcpToolCatalog(agent._mcpConnections.fixture)
  checkMcpFeature(bareTools.tools.length === 0, "A skills-only server need not implement tools/list")
  var catalog = agent._remoteSkillCatalog()
  checkMcpFeature(catalog.length === 1 && reads === 0, "Discover a skills-only server without loading files")
  checkMcpFeature(/Fixture skill body/.test(agent._loadRemoteSkill(catalog[0], {}).body), "Load approved, verified skill bytes")
  var rejected = false
  try { agent._loadRemoteSkill(catalog[0], {}) }
  catch(e) { rejected = String(e).indexOf("integrity-check") >= 0 }
  checkMcpFeature(rejected && reads === 2, "Reject modified skill bytes")
}

// Use the real OpenAF client and oJob-common workflow to verify both dispatch routes.
function testMcpPilot(command) {
  ;[false, true].forEach(function(proxy) {
    var agent = mcpFeatureAgent([0, 0, 1, 0])
    var descriptor = { id: "report", type: "stdio", cmd: command }
    var client
    try {
      if (proxy) {
        agent._useMcpProxy = true
        var config = agent._createMcpProxyConfig([descriptor], {})
        checkMcpFeature(isMap(config), "Create the embedded MCP proxy")
        client = agent._newStartupMcpClient(config, {})
      } else {
        client = agent._newStartupMcpClient(descriptor, {})
        agent._mcpConnections.report = client
      }
      client.initialize()
      agent._resetSkillRuntime({})
      var skill = agent._remoteSkillCatalog()[0]
      checkMcpFeature(skill && agent._loadRemoteSkill(skill, {}).body.indexOf("report_preview") >= 0, "Load the report skill")
      var result = proxy ? client.callTool("proxy-dispatch", { action: "call", tool: "report_preview", arguments: {} }) :
        agent._invokeMcpTool("report", client, client.listTools().tools[0], {})
      checkMcpFeature(/Received: 12/.test(stringify(result)), "Receive the detailed report from the task")
    } finally {
      if (proxy && client) client.destroy()
      agent._stopAgentResources()
    }
  })
}

// Restart both the client and its stdio server with a task waiting for input.
function testMcpPilotResume(command) {
  var root = String(java.nio.file.Files.createTempDirectory("mini-a-mcp-pilot-resume"))
  var descriptor = { id: "report", type: "stdio", cmd: command }
  var first = mcpFeatureAgent([]), second = mcpFeatureAgent([0, 0, 0])
  var client
  try {
    first._beginRun({ runroot: root, goal: "Preview" })
    client = first._newStartupMcpClient(descriptor, {})
    client.initialize()
    var tool = client.listTools().tools[0]
    var originalWait = first._waitMcpTask
    first._waitMcpTask = function(c, record) {
      for (var poll = 0; poll < 30; poll++) {
        var status = c.getTask(record.taskId)
        if (status.status === "input_required") return { interrupted: true }
        sleep(100)
      }
      throw Error("The server did not reach its input checkpoint")
    }
    var interrupted = first._invokeMcpTool("report", client, tool, {})
    checkMcpFeature(interrupted.interrupted === true, "Interrupt the original call after the server stored its request")
    first._waitMcpTask = originalWait
    client.destroy()

    var args = { runroot: root, resumerun: first._runState.runId }
    second._beginRun(args)
    client = second._newStartupMcpClient(descriptor, {})
    second._mcpConnections.report = client
    client.initialize()
    var recovered = second._recoverMcpTasks(args)
    checkMcpFeature(recovered.length === 1 && /9 of 12/.test(stringify(recovered[0].result)), "Resume the report without starting another task")
    var same = second._invokeMcpTool("report", client, tool, {})
    checkMcpFeature(/9 of 12/.test(stringify(same)) && second._runState.state.mcp_tasks.length === 1,
      "Return the original task result for the resumed call")
  } finally {
    if (client) client.destroy()
    io.rm(root)
  }
}

try {
  testMcpFeatures()
  var command = getEnv("MINIA_TEST_PILOT")
  if (isString(command) && command.length) {
    testMcpPilot(command)
    testMcpPilotResume(command)
  }
  print("MCP feature checks passed")
  exit(0)
} catch(e) {
  printErr(String(e) + "\n" + (e.stack || ""))
  exit(1)
}
