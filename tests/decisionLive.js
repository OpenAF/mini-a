// Bounded live smoke test: two decisions, no main-model run or tools executed.
load("mini-a.js")
var agent = new MiniA()
agent.fnI = function() {}
agent._trace = function() {}
agent._initDecisionRuntime({})
if (!agent._decision.isConfigured()) throw new Error("OAF_DECIDE_MODEL is required")
// Bound this smoke test without changing the stored configuration.
agent._decision._options.clientFactory = function(config) {
  config.timeout = 10000
  return $llm(config)
}
var selected = agent._selectByDecision("A customer reports being billed twice. Identify the relevant available tool.", [
  { name: "calendar_schedule", description: "Schedule appointments and calendar meetings." },
  { name: "ledger_lookup", description: "Inspect account payments, duplicate charges and refunds." }
])
var complexity = agent._assessComplexityByDecision("Compare invoice entries with settlement records and explain the discrepancy.", "medium", {})
var passed = isArray(selected) && selected.length > 0 && selected[0].name === "ledger_lookup" && isDef(complexity)
print(stringify({ passed: passed, selected: isArray(selected) ? selected.map(function(e) { return e.name }) : [],
  complexity: complexity, metrics: agent._decisionMetrics }))
if (!passed) exit(1)
