// Run with: oaf -f tests/agentComms.js (no model credentials or network required).
load("mini-a-subtask.js")
var passed = 0
function check(value, message) { if (!value) throw new Error(message); passed++ }
function throws(fn, message) { var caught = false; try { fn() } catch(e) { caught = true }; check(caught, message) }
var child = { profiles: ["parent-relay", "direct", "pubsub", "shared-state"],
  grants: { send: ["parent", "root", "alice", "bob"], receive: ["parent", "root", "alice", "bob"], publish: ["findings"], subscribe: ["findings"], read: ["work"], write: ["work"] } }
var config = MiniAComms.clone(child)
config.alias = "root"
config.delegate = child
var broker = new MiniAComms(config)
try {
  broker.register("root-id", config)
  var alice = MiniAComms.clone(child); alice.alias = "alice"
  var bob = MiniAComms.clone(child); bob.alias = "bob"
  broker.register("alice-id", alice, "root-id")
  broker.register("bob-id", bob, "root-id")
  check(broker.operate("alice-id", { action: "send", to: "bob", payload: "evidence" }).status === "accepted", "Direct delivery")
  check(broker.drain("bob-id")[0].payload === "evidence", "Inbox payload")
  check(broker.drain("bob-id").length === 0, "Drain exactly once")
  check(broker.operate("alice-id", { action: "send", to: "parent", payload: "question" }).status === "accepted", "Parent relay")
  check(broker.drain("root-id")[0].sender === "alice-id", "Runtime identity")
  check(broker.operate("alice-id", { action: "publish", topic: "findings", payload: "found" }).recipients === 2, "Pubsub fanout")
  broker.drain("root-id"); broker.drain("bob-id")
  check(broker.operate("alice-id", { action: "put", namespace: "work", key: "claim", expectedVersion: 0, value: "alice" }).version === 1, "Create CAS")
  check(broker.operate("bob-id", { action: "put", namespace: "work", key: "claim", expectedVersion: 0, value: "bob" }).status === "conflict", "Competing claimant denied")
  check(broker.operate("bob-id", { action: "get", namespace: "work", key: "claim" }).value === "alice", "Shared read")
  check(broker.operate("alice-id", { action: "delete", namespace: "work", key: "claim", expectedVersion: 1 }).version === 2, "Delete version")
  check(broker.operate("bob-id", { action: "put", namespace: "work", key: "claim", expectedVersion: 0, value: "bob" }).status === "conflict", "No ABA after delete")
  check(broker.operate("bob-id", { action: "get", namespace: "secret", key: "claim" }).status === "denied", "Namespace isolation")
  check(broker.operate("intruder", { action: "send", to: "bob", payload: "x" }).status === "unavailable", "Unknown identity")
  check(broker.operate("alice-id", { action: "send", to: "foreign-run", payload: "x" }).status === "unavailable", "Cross-root blocked")
  var excessive = MiniAComms.clone(child); excessive.grants.read.push("secret")
  throws(function() { broker.register("bad", excessive, "root-id") }, "Child grant ceiling")
  throws(function() { MiniAComms.normalize({ profiles: ["none", "direct"] }) }, "Exclusive none")
  throws(function() { MiniAComms.normalize({ profiles: ["direct"], grants: { send: ["*"] } }) }, "No wildcard")
  var limited = MiniAComms.clone(child); limited.alias = "limited"; limited.limits = { agentPending: 1 }
  broker.register("limited-id", limited, "root-id")
  broker.operate("alice-id", { action: "publish", topic: "findings", payload: "first" })
  var before = broker.metrics.delivered
  check(broker.operate("alice-id", { action: "publish", topic: "findings", payload: "second" }).status === "full", "Fanout admission")
  check(broker.metrics.delivered === before, "Fanout atomic")
  check(broker.operate("alice-id", { action: "send", to: "bob", payload: new Array(9000).join("é") }).status === "too_large", "UTF8 bound")
  broker.revoke("alice-id")
  check(broker.operate("alice-id", { action: "get", namespace: "work", key: "claim" }).status === "unavailable", "Terminal revocation")
} finally { broker.close() }
check($ch().list().indexOf(broker.name) < 0, "Channel cleanup")

// Real channel adapter exchange, with injected transport (no provider required).
var root = new MiniAComms(config), adapter = new MiniAComms(child)
try {
  root.register("root-id", config)
  var binding = root.register("remote-id", child, "root-id")
  adapter.register("remote-id", child); adapter.asRemote()
  var task = { comms: binding, remoteTaskId: "task", workerUrl: "http://worker", commsToken: "test" }
  var manager = Object.create(SubtaskManager.prototype)
  manager._remoteRequest = function(url, path, data) { return adapter.exchange(data) }
  var pending = adapter.operate("remote-id", { action: "put", namespace: "work", key: "remote", expectedVersion: 0, value: "ok" })
  check(pending.status === "pending", "Remote state pending")
  manager._exchangeComms(task)
  check(root.operate("root-id", { action: "get", namespace: "work", key: "remote" }).value === "ok", "Root authority")
  manager._exchangeComms(task)
  var results = adapter.drain("remote-id")
  check(results.length === 1 && results[0].correlationId === pending.operationId, "Correlated remote result")
  manager._exchangeComms(task)
  check(adapter.drain("remote-id").length === 0, "No duplicate result")
} finally { root.close(); adapter.close() }

load("mini-a.js")
var agent = new MiniA(), beforeChannels = $ch().list().length
agent._initComms({})
agent._initComms({ agentcomms: { profiles: ["none"] } })
check(!agent._comms && $ch().list().length === beforeChannels, "Disabled creates no channels")
check(!agent._createCommsMcpConfig(), "Disabled exposes no tools")
agent._fnI = function() {}
agent._initComms({ agentcomms: config })
try {
  agent._policyDecision = function() { return { decision: "allow" } }
  var tools = agent._createCommsMcpConfig().options.fns
  var response = jsonParse(tools["agent-state"]({ action: "put", namespace: "work", key: "a", value: 1, expectedVersion: 0 }).content[0].text)
  check(response.version === 1, "Tool integration")
  agent._policyDecision = function() { return { decision: "deny" } }
  response = jsonParse(tools["agent-state"]({ action: "put", namespace: "work", key: "a", value: 2, expectedVersion: 1 }).content[0].text)
  check(response.status === "denied", "Policy integration")
  check(agent._comms.broker.operate(agent._id, { action: "get", namespace: "work", key: "a" }).value === 1, "Denial has no mutation")
  check(MiniA._isCommsTool("proxy-dispatch", { tool: "agent-comms" }), "Proxy classification")
  var manager = new SubtaskManager({ agentcomms: config }, { parentAgent: agent })
  try {
    var args = manager._buildChildArgs({ goal: "isolated", args: {}, depth: 1 })
    check(isUnDef(args.agentcomms), "No implicit child grants")
    check(!manager._isWorkerProfileCompatible({ status: "ok", capabilities: [] }, { requiresComms: true }), "Missing remote capability denied")
    check(manager._isWorkerProfileCompatible({ status: "ok", capabilities: [] }, {}), "Legacy compatibility preserved")
  } finally { manager.destroy() }
} finally { agent._comms.broker.close() }

var concurrent = new MiniAComms(config)
try {
  concurrent.register("root-id", config)
  var results = parallel4Array([1, 2, 3, 4], function(n) {
    return concurrent.operate("root-id", { action: "put", namespace: "work", key: "race", expectedVersion: 0, value: n }).status
  })
  check(results.filter(function(s) { return s === "ok" }).length === 1, "Concurrent CAS has one winner")
} finally { concurrent.close() }

var profileManager = Object.create(SubtaskManager.prototype)
profileManager.parentArgs = {}
check(profileManager._fetchWorkerProfile("unused", { name: "enabled", additionalInterfaces: ["agent-comms-v1"] }).capabilities.indexOf("agent-comms-v1") >= 0, "AgentCard capability survives registration")
check(profileManager._fetchWorkerProfile("unused", { name: "legacy" }).capabilities.indexOf("agent-comms-v1") < 0, "Legacy AgentCard stays isolated")

// Replay a lost exchange response: the root must not repeat a CAS mutation.
var replayRoot = new MiniAComms(config), replayAdapter = new MiniAComms(child)
try {
  replayRoot.register("root-id", config)
  var replayBinding = replayRoot.register("remote-id", child, "root-id")
  replayAdapter.register("remote-id", child); replayAdapter.asRemote()
  var replayTask = { comms: replayBinding }
  var replayManager = Object.create(SubtaskManager.prototype), lose = false
  replayManager._remoteRequest = function(url, path, data) {
    var reply = replayAdapter.exchange(data)
    if (lose) { lose = false; throw new Error("Simulated lost response") }
    return reply
  }
  replayAdapter.operate("remote-id", { action: "put", namespace: "work", key: "once", expectedVersion: 0, value: 1 })
  replayManager._exchangeComms(replayTask)
  lose = true
  throws(function() { replayManager._exchangeComms(replayTask) }, "Transport failure observable")
  replayManager._exchangeComms(replayTask)
  check(replayRoot.metrics.accepted === 1, "Lost response does not repeat state mutation")
  check(replayAdapter.drain("remote-id").length === 1, "Lost response delivers one result")
} finally { replayRoot.close(); replayAdapter.close() }

var nestedConfig = MiniAComms.clone(child); nestedConfig.delegate = child
var nestedRootConfig = MiniAComms.clone(config); nestedRootConfig.delegate = nestedConfig
var nestedRoot = new MiniAComms(nestedRootConfig), nestedAdapter = new MiniAComms(nestedConfig)
try {
  nestedRoot.register("root-id", nestedRootConfig)
  var remote = nestedRoot.register("remote-id", nestedConfig, "root-id")
  nestedAdapter.register("remote-id", nestedConfig); nestedAdapter.asRemote()
  var descendant = nestedAdapter.register("remote-id/grandchild", child, "remote-id")
  var nestedManager = Object.create(SubtaskManager.prototype)
  nestedManager._remoteRequest = function(url, path, data) { return nestedAdapter.exchange(data) }
  var nestedTask = { comms: remote }
  nestedManager._exchangeComms(nestedTask)
  nestedManager._exchangeComms(nestedTask)
  check(!!nestedRoot.members[descendant.id], "Remote descendant registered at root")
  nestedAdapter.operate(descendant.id, { action: "put", namespace: "work", key: "nested", expectedVersion: 0, value: "claimed" })
  nestedManager._exchangeComms(nestedTask); nestedManager._exchangeComms(nestedTask)
  check(nestedRoot.operate("root-id", { action: "get", namespace: "work", key: "nested" }).value === "claimed", "Remote descendant shares root state")
  nestedAdapter.revoke(descendant.id)
  nestedManager._exchangeComms(nestedTask)
  check(nestedRoot.members[descendant.id].active === false, "Remote descendant revocation")
} finally { nestedRoot.close(); nestedAdapter.close() }

var limitsConfig = MiniAComms.clone(config); limitsConfig.limits = { perMinute: 1, ttlMs: 1 }
var limitedBroker = new MiniAComms(limitsConfig)
try {
  limitedBroker.register("root-id", limitsConfig)
  var ttlChild = MiniAComms.clone(child); ttlChild.alias = "alice"
  limitedBroker.register("alice-id", ttlChild, "root-id")
  check(limitedBroker.operate("root-id", { action: "send", to: "alice", payload: "expires" }).status === "accepted", "TTL admission")
  sleep(5, true)
  check(limitedBroker.drain("alice-id").length === 0 && limitedBroker.metrics.expired === 1, "Expired inbox is not delivered")
  check(limitedBroker.operate("root-id", { action: "get", namespace: "work", key: "anything" }).status === "rate_limited", "Rate budget enforced")
} finally { limitedBroker.close() }

// Exercise the actual worker submission function without running a provider.
var workerSpec = io.readFileYAML("mini-a-worker.yaml")
var workerInit = workerSpec.jobs.filter(function(j) { return j.name === "Init" })[0].exec
var begin = workerInit.indexOf("global.__worker_submitTask = function")
var end = workerInit.indexOf("global.__worker_taskManager = new SubtaskManager", begin)
eval(workerInit.substring(begin, end))
global.__worker_tasks = {}
global.__worker_subtaskToTaskId = {}
global.__worker_subtaskShortToTaskId = {}
global.__worker_logTaskEvent = function() {}
var submitted = 0
global.__worker_taskManager = {
  subtasks: {},
  submit: function(goal, args, opts) { var id = "s" + (++submitted); this.subtasks[id] = { args: args, opts: opts }; return id },
  start: function() {}
}
var workerArgs = { apitoken: "test-bearer", agentcomms: child, defaulttimeout: 1000, maxtimeout: 1000 }
var rejected = global.__worker_submitTask({ goal: "test", communication: { version: 1, id: "remote", token: "0123456789abcdef", config: excessive } }, workerArgs)
check(rejected.code === 403 && submitted === 0, "Worker rejects excess grants before submission")
var normal = global.__worker_submitTask({ goal: "isolated" }, workerArgs)
check(!global.__worker_tasks[normal.taskId].comms && isUnDef(global.__worker_tasks[normal.taskId].args.agentcomms), "Worker opt-in never inherits into ordinary tasks")
var accepted = global.__worker_submitTask({ goal: "enabled", communication: { version: 1, id: "remote", token: "0123456789abcdef", config: child } }, workerArgs)
try {
  check(!!global.__worker_tasks[accepted.taskId].comms.remote, "Worker attaches runtime adapter")
  check(global.__worker_taskManager.subtasks["s2"].comms.id === "remote", "Worker binds supplied authenticated identity")
  check(global.__worker_taskManager.subtasks["s2"].opts.maxAttempts === 1, "Parent owns remote communication retries")
} finally { global.__worker_tasks[accepted.taskId].comms.close() }

ow.loadServer()
var a2aRoute = workerSpec.todo.filter(function(r) { return isMap(r) && r["((uri       ))"] === "/message:send" })[0]
var a2aHandler = new Function("request", a2aRoute["((execURI   ))"])
var captured
// Return an error after capture so the route need not launch an agent.
global.__worker_submitTask = function(payload) { captured = payload; return { error: { error: "test capture" }, code: 400 } }
a2aHandler({ files: { postData: stringify({ message: { parts: [{ text: "goal" }] }, metadata: { communication: { version: 1, id: "identity" } } }) } })
check(captured.communication.id === "identity", "A2A preserves communication metadata")

// Dedicated tool traces never retain communication payloads.
var tracingAgent = new MiniA(), traced
tracingAgent._recordRunEvent = function(kind, payload) { traced = payload }
tracingAgent._trace("tool_result", { name: "agent-comms", params: { action: "send", payload: "private" }, result: "private" })
check(stringify(traced).indexOf("private") < 0, "Communication trace payload filtering")
var isolatedManager = new SubtaskManager({})
try {
  throws(function() { isolatedManager.submit("no escalation", { agentcomms: { profiles: ["none"], delegate: child } }) }, "None cannot smuggle a new delegation allowance")
} finally { isolatedManager.destroy() }
print("agentComms verified: " + passed + " assertions passed")
