// Full Mini-A run against the loopback providers started by decisionMcp.py.
if (getEnv("MINI_A_DECISION_FIXTURE") !== "true") throw new Error("Run this fixture through tests/decisionMcp.py")
load("mini-a.js")
var agent = new MiniA(), thresholds = "", events = []
agent.fnI = function(type, message) {
  if (String(message).indexOf("Escalation thresholds:") >= 0) thresholds = String(message)
}
agent._traceFn = function(kind, payload) {
  if (kind === "decision_selection" || kind === "decision_complexity") events.push({ kind: kind, payload: payload })
}
var args = {
  goal: "Look up the weather in Porto and explain tomorrow's forecast.",
  useshell: false, usetools: true, useutils: false, useplanning: false,
  usejsontool: true, mcpdynamic: true, debug: true, maxsteps: 2, nosetmcpwd: true,
  mcp: { cmd: "ojob evals/fixtures/decision-catalog.yaml", timeout: 10000 }
}
try {
  agent.init(args)
  var answer = agent.start(args)
  if (String(answer).indexOf("fixture ready") < 0) throw new Error("Fixture final answer missing")
  var metrics = agent.getMetrics()
  if (metrics.decisions.calls !== 2 || metrics.decisions.failures !== 0 || metrics.decisions.fallbacks !== 0) throw new Error("Selection and complexity must execute once each")
  if (metrics.llm_calls.total !== metrics.llm_calls.normal + 2) throw new Error("Decision calls missing from total")
  if (thresholds.indexOf("errors=3") < 0) throw new Error("Decision complexity did not set simple escalation thresholds")
  if (events.length !== 2) throw new Error("Decision trace events missing")
  print("PASS full Mini-A selection, automatic complexity, thresholds, final answer and metric totals")
} finally {
  agent._stopAgentResources()
}
