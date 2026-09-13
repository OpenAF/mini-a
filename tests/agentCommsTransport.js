// Real HTTP transport using the worker's /comms route and authentication code.
// No model calls. Run: oaf -f tests/agentCommsTransport.js
load("mini-a-subtask.js")
ow.loadServer()
var spec = io.readFileYAML("mini-a-worker.yaml")
var route = spec.todo.filter(function(r) { return isMap(r) && r["((uri       ))"] === "/comms" })[0]
if (!route) throw new Error("Worker communication route not found")
var handler = new Function("request", route["((execPre   ))"] + "\n" + route["((execURI   ))"])
var grants = { profiles: ["direct", "shared-state"], grants: { send: ["alice", "bob"], receive: ["alice", "bob"], read: ["work"], write: ["work"] } }
var config = MiniAComms.clone(grants); config.delegate = grants
var root = new MiniAComms(config), adapters = [], servers = [], tasks = [], checks = 0
function check(v, msg) { if (!v) throw new Error(msg); checks++ }
global.__worker_args = { apitoken: "transport-test-token" }
global.__worker_ipallow = []
global.__worker_tasks = {}
try {
  root.register("root", config)
  ;["alice", "bob"].forEach(function(alias) {
    var c = MiniAComms.clone(grants); c.alias = alias
    var binding = root.register(alias + "-id", c, "root")
    var adapter = new MiniAComms(c); adapter.register(binding.id, c); adapter.asRemote(); adapters.push(adapter)
    global.__worker_tasks[alias] = { comms: adapter, commsToken: "task-token-" + alias }
    var server = ow.server.httpd.start(__, "127.0.0.1"); servers.push(server)
    ow.server.httpd.route(server, { "/comms": handler })
    tasks.push({ comms: binding, remoteTaskId: alias, workerUrl: "http://127.0.0.1:" + server.getPort(), commsToken: "task-token-" + alias })
  })
  var manager = Object.create(SubtaskManager.prototype)
  manager.parentArgs = { apitoken: "transport-test-token" }
  check(adapters[0].operate("alice-id", { action: "send", to: "bob", payload: "shared evidence" }).status === "pending", "Remote send queued")
  manager._exchangeComms(tasks[0]); manager._exchangeComms(tasks[1])
  check(adapters[1].drain("bob-id")[0].payload === "shared evidence", "Two worker HTTP delivery")
  manager._exchangeComms(tasks[1]); manager._exchangeComms(tasks[1])
  check(adapters[1].drain("bob-id").length === 0, "HTTP acknowledgement deduplication")
  var failures = 0
  manager.parentArgs.apitoken = "wrong"
  try { manager._exchangeComms(tasks[0]) } catch(e) { failures++ }
  manager.parentArgs.apitoken = "transport-test-token"
  tasks[0].commsToken = "wrong"
  try { manager._exchangeComms(tasks[0]) } catch(e) { failures++ }
  check(failures === 2, "Both bearer and task authentication enforced")
  print("agentCommsTransport: " + checks + " assertions passed")
} finally {
  servers.forEach(function(s) { ow.server.httpd.stop(s) })
  adapters.forEach(function(a) { a.close() }); root.close()
}
