// Invoked only by forkPolicyTransport.py against its synthetic loopback server.
var fixtureUrl = getEnv("MINI_A_FORK_FIXTURE_URL")
if (!isString(fixtureUrl) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(fixtureUrl)) throw new Error("Use tests/forkPolicyTransport.py")
load("mini-a.js")
load("mini-a-subtask.js")
;["native", "structured", "timeout"].forEach(function(kind) {
  var agent = new MiniA()
  agent.fnI = function() {}; agent._trace = function() {}
  agent._agentState = { workingMemory: { facts: [{ v: "private parent-only ORCHID" }] } }
  agent._runtime = { context: ["unrelated recent history COBALT"] }
  var config = { type: kind === "structured" ? "openai" : "ollama", model: kind === "timeout" ? "slow" : "fixture", key: "synthetic", timeout: kind === "timeout" ? 150 : 2000,
    url: fixtureUrl + (kind === "structured" ? "/v1" : ""), decisionTransport: "chat" }
  agent._initDecisionRuntime({ modeldec: config })
  var limiter = agent._createRateLimiter({})
  agent._decisionToolControls = { tryBeforeCall: limiter.tryBeforeCall, afterReservedCall: limiter.afterReservedCall }
  var manager = new SubtaskManager({ usememory: true }, { parentAgent: agent })
  manager._startWatchdog = function() {}
  try {
    var id = manager.submit("ambiguous handoff", {}, {}), task = manager.subtasks[id]
    task.status = "running"; task.startedAt = now()
    var args = manager._buildChildArgs(task)
    if (kind === "timeout") {
      if (task.forkPolicy.scope !== "clean" || agent._decisionMetrics.calls !== 1 || agent._decisionMetrics.failures !== 1) throw new Error("Real timeout must keep the deterministic fallback")
    } else {
      if (task.forkPolicy.source !== "decision" || task.forkPolicy.scope !== "memory" || args.state.indexOf("ORCHID") < 0) throw new Error("Real adapter failed to inherit selected memory: " + stringify(task.forkPolicy))
      if (agent._decisionMetrics.calls !== 1 || agent._decisionMetrics.total_tokens !== 14) throw new Error("Real usage was not accounted once")
    }
    print("PASS fork policy real " + kind + " adapter")
  } finally { manager.destroy() }
})
