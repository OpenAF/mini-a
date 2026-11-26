// Run with oaf -f tests/mcpTest.js. Exercises the MCP tester against stub clients; no model or network needed.
// Set MINIA_TEST_PILOT to a stdio launch command to also run report mode against the report-preview server.
global.__miniAMcpTestNoMain = true
global._args = {}
load("mini-a.js")
loadLib(__miniAPath("js/session/mini-a-mcptest.js"), true)

// Assert and fail loudly.
function checkMcpTest(condition, message) {
  if (!condition) throw new Error(message)
}

// Build a stub client with only the requested methods.
function stubMcpClient(parts) {
  return merge({
    getInfo: function() { return { protocolVersion: parts.version || "2026-07-28", serverInfo: { name: "Stub" } } },
    getCapabilities: function() { return clone(parts.caps || {}) }
  }, parts.fns || {})
}

// Build a skill entry with a valid manifest for the given SKILL.md text.
function stubSkill(text, extraFiles) {
  var uri = "skill://example/report-preview/SKILL.md"
  var bytes = function(value) { return new java.lang.String(value).getBytes("UTF-8") }
  var resources = [{ uri: uri, size: bytes(text).length, digest: "sha256:" + sha256(bytes(text)) }]
  var texts = {}
  texts[uri] = text
  Object.keys(extraFiles || {}).forEach(function(key) {
    var ref = "skill://example/report-preview/" + key
    texts[ref] = extraFiles[key]
    resources.push({ uri: ref, size: bytes(extraFiles[key]).length, digest: "sha256:" + sha256(bytes(extraFiles[key])) })
  })
  return { entry: { uri: uri, frontmatter: { name: "report-preview", description: "Demo" }, resources: resources }, texts: texts }
}

var goodSkillText = "---\nname: report-preview\ndescription: Demo\n---\nBody"

function testFeatureRows() {
  var modern = stubMcpClient({ caps: { tools: {}, extensions: { "io.modelcontextprotocol/tasks": {}, "io.modelcontextprotocol/skills": {} } },
    fns: { getTask: function() {}, listSkills: function() {}, onElicitationRequest: function() {}, listTools: function() {} } })
  modern.__miniATesterPrompt = true
  var info = mcpFeatureRows(modern)
  var byName = {}
  info.rows.forEach(function(row) { byName[row.feature] = row.state })
  checkMcpTest(byName.tasks === "available" && byName.skills === "available" && byName.elicitation === "form and URL", "Modern server must report every feature")

  var oldRuntime = stubMcpClient({ caps: { extensions: { "io.modelcontextprotocol/tasks": {} } }, fns: {} })
  info = mcpFeatureRows(oldRuntime)
  byName = {}
  info.rows.forEach(function(row) { byName[row.feature] = row.state })
  checkMcpTest(byName.tasks.indexOf("runtime lacks getTask") >= 0, "A runtime without getTask must say so")
  checkMcpTest(byName.elicitation.indexOf("onElicitationRequest") >= 0, "A runtime without elicitation support must say so")

  var legacy = stubMcpClient({ version: "2025-03-26", caps: {}, fns: { onElicitationRequest: function() {} } })
  byName = {}
  mcpFeatureRows(legacy).rows.forEach(function(row) { byName[row.feature] = row.state })
  checkMcpTest(byName.elicitation.indexOf("not supported") >= 0 && byName.skills.indexOf("unavailable") === 0, "Legacy protocol must not claim elicitation")
}

function testConnectOrder() {
  var calls = []
  var factory = function(opts) {
    calls.push("create:" + (opts.protocolVersion || "none"))
    return { onElicitationRequest: function() { calls.push("handler") }, initialize: function() { calls.push("initialize") } }
  }
  var connected = connectMCP({ cmd: "echo" }, { showtimeelapsed: false }, factory)
  checkMcpTest(calls.join(",") === "create:auto,handler,initialize", "Handler must be registered before initialize: " + calls.join(","))
  checkMcpTest(isUnDef(connected.raw.protocolVersion) && isUnDef(connected.raw.tasks), "The raw snapshot must not hold injected defaults")
  calls = []
  connectMCP({ cmd: "echo", protocolVersion: "2025-06-18" }, {}, factory)
  checkMcpTest(calls[0] === "create:2025-06-18", "A pinned protocol version must win")
  calls = []
  connectMCP({ type: "dummy", options: {} }, {}, factory)
  checkMcpTest(calls[0] === "create:none", "Dummy connections must not get negotiation defaults")
}

function testTaskPolling() {
  var polls = 0
  var updated
  var client = stubMcpClient({ fns: {
    getTask: function() {
      polls++
      if (polls === 1) throw new Error("Transient")
      if (polls === 2) return { resultType: "task", taskId: "t", status: "input_required", pollIntervalMs: 1,
        inputRequests: { a: { method: "elicitation/create", params: { message: "Format?", requestedSchema: { type: "object", properties: { format: { type: "string", default: "summary" } } } } } } }
      return { resultType: "complete", taskId: "t", status: "completed", result: { content: [{ type: "text", text: "done" }] } }
    },
    updateTask: function(id, responses) { updated = responses }
  } })
  var result = pollMCPTask(client, { resultType: "task", taskId: "t", status: "working", pollIntervalMs: 1 }, { autoacceptelicitation: true })
  checkMcpTest(result.content[0].text === "done", "Task must complete after a transient failure")
  checkMcpTest(isMap(updated) && updated.a.action === "accept" && updated.a.content.format === "summary", "Task input must be answered once with the defaults")

  var failing = stubMcpClient({ fns: { getTask: function() { throw new Error("down") } } })
  result = pollMCPTask(failing, { resultType: "task", taskId: "t", status: "input_required" }, {})
  checkMcpTest(result.isError === true, "Three poll failures must become an error result")

  var noRuntime = pollMCPTask(stubMcpClient({}), { resultType: "task", taskId: "t" }, {})
  checkMcpTest(noRuntime.taskId === "t", "A runtime without getTask returns the handle")
}

function testInputRequiredContinuation() {
  var continued = 0
  var client = stubMcpClient({ fns: { continueRequest: function(method, request, pending) {
    continued++
    checkMcpTest(method === "tools/call" && request.name === "preview", "Continuation must resend the original call")
    return continued < 2 ? { resultType: "input_required" } : { content: [{ type: "text", text: "final" }] }
  } } })
  var result = resolveMCPResult(client, { name: "preview" }, {}, { resultType: "input_required" }, {})
  checkMcpTest(continued === 2 && result.content[0].text === "final", "Continuation must loop until a final result")
  result = resolveMCPResult(stubMcpClient({}), { name: "preview" }, {}, { resultType: "input_required" }, {})
  checkMcpTest(result.resultType === "input_required", "Without continueRequest the pending result is returned")
}

function testSkillVerification() {
  var fixture = stubSkill(goodSkillText, { "references/data.md": "data" })
  var client = stubMcpClient({ fns: { readResource: function(uri) { return { contents: [{ uri: uri, text: fixture.texts[uri] }] } } } })
  var report = verifyMCPSkill(client, fixture.entry)
  checkMcpTest(report.ok === true && report.files === 2, "A valid manifest must verify")

  var tampered = stubMcpClient({ fns: { readResource: function(uri) { return { contents: [{ uri: uri, text: uri.indexOf("data.md") > 0 ? "DATA" : fixture.texts[uri] }] } } } })
  report = verifyMCPSkill(tampered, fixture.entry)
  checkMcpTest(report.ok === false && report.failures[0].indexOf("integrity") >= 0, "A digest mismatch must fail")

  var badFront = stubSkill("---\nname: other\ndescription: Demo\n---\nBody")
  report = verifyMCPSkill(stubMcpClient({ fns: { readResource: function(uri) { return { contents: [{ uri: uri, text: badFront.texts[uri] }] } } } }), badFront.entry)
  checkMcpTest(report.ok === false && report.failures[0].indexOf("frontmatter") >= 0, "A frontmatter mismatch must fail")

  var oversized = clone(fixture.entry)
  oversized.resources[0].size = 17 * 1024 * 1024
  report = verifyMCPSkill(client, oversized)
  checkMcpTest(report.ok === false && report.failures[0].indexOf("manifest") === 0, "An oversized manifest must fail")

  var noEntry = clone(fixture.entry)
  noEntry.resources = noEntry.resources.slice(1)
  checkMcpTest(verifyMCPSkill(client, noEntry).ok === false || fixture.entry.resources.length === 1, "A manifest without the entry file must fail")
}

function testReport() {
  var fixture = stubSkill(goodSkillText)
  var client = stubMcpClient({ caps: { tools: {}, extensions: { "io.modelcontextprotocol/skills": {} } }, fns: {
    listTools: function() { return { tools: [{ name: "a" }] } },
    listSkills: function() { return { skills: [fixture.entry] } },
    readResource: function(uri) { return { contents: [{ uri: uri, text: fixture.texts[uri] }] } }
  } })
  var report = buildMCPReport(client, {})
  checkMcpTest(report.ok === true && report.counts.tools === 1 && report.counts.skills === 1 && report.skills[0].ok === true, "Report must summarize counts and skills")
  checkMcpTest(isUnDef(report.counts.resources), "Report must not count resources the server does not advertise")
  var broken = stubMcpClient({ caps: { extensions: { "io.modelcontextprotocol/skills": {} } }, fns: {
    listTools: function() { return { tools: [] } },
    listSkills: function() { return { skills: [fixture.entry] } },
    readResource: function(uri) { return { contents: [{ uri: uri, text: "tampered" }] } }
  } })
  checkMcpTest(buildMCPReport(broken, {}).ok === false, "A failing skill must make the report fail")
}

// Optional pilot: run against the report-preview server when a modern OpenAF is available.
function testPilot() {
  var command = getEnv("MINIA_TEST_PILOT")
  if (!isString(command) || command.length === 0) return
  var connected = connectMCP({ cmd: command }, { __noninteractive: true })
  try {
    var report = buildMCPReport(connected.client, connected.config)
    checkMcpTest(report.ok === true && report.skills.length >= 1, "Pilot report must verify the bundled skill")
  } finally {
    connected.client.destroy()
  }
}

testFeatureRows()
testConnectOrder()
testTaskPolling()
testInputRequiredContinuation()
testSkillVerification()
testReport()
testPilot()
print("MCP tester checks passed")
