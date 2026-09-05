(function() {
  load("mini-a.js")
  load("mini-a-eval.js")

  function FakeAgent(answer, values) {
    this.answer = answer
    this.values = values || {}
    this.metrics = {
      llm_calls: { normal: 0, low_cost: 0, validation: 0, total: 0 },
      actions: { mcp_actions_executed: 0, mcp_actions_failed: 0, shell_commands_executed: 0 },
      planning: { plans_replanned: 0 },
      performance: { steps_taken: 0, llm_normal_input_tokens: 0, llm_lc_input_tokens: 0, llm_val_input_tokens: 0, llm_normal_output_tokens: 0, llm_lc_output_tokens: 0, llm_val_output_tokens: 0, max_context_tokens: 0 },
      behavior_patterns: { retries: 0 }, advisor: { calls: 0 }, delegation: { total: 0 }, wiki: { ops_search: 0, ops_read: 0, ops_list: 0 }
    }
  }
  FakeAgent.prototype.init = function(args) { this.args = args }
  FakeAgent.prototype.start = function() {
    this.metrics.llm_calls.normal = this.values.llm || 1
    this.metrics.llm_calls.total = this.values.llm || 1
    this.metrics.performance.steps_taken = this.values.steps || 1
    this.metrics.performance.llm_normal_input_tokens = this.values.input || 0
    this.metrics.actions.mcp_actions_executed = this.values.tools || 0
    this.metrics.actions.mcp_actions_failed = this.values.failedTools || 0
    return this.answer
  }
  FakeAgent.prototype.getMetrics = function() { return this.metrics }

  exports.testEvalScenarioCollectsMetricsAndAssertions = function() {
    var evaluator = new MiniAEval({ agentFactory: function() { return new FakeAgent("ready", { llm: 2, steps: 3, input: 12, tools: 1 }) }, nowFn: (function() { var tick = 0; return function() { tick += 25; return tick } })() })
    var result = evaluator.runScenario({ name: "ready", goal: "respond", expected: { contains: "ead", metrics: { "llm_calls": 2, "total_steps": { max: 3 } } }, limits: { steps: 3, tokens: 12 } })
    ow.test.assert(result.success, true, "Scenario should pass deterministic answer, metric, and limit assertions")
    ow.test.assert(result.metrics.llm_calls, 2, "LLM calls should come from the existing metrics snapshot")
    ow.test.assert(result.metrics.input_tokens, 12, "Input token metrics should be normalized")
    ow.test.assert(result.metrics.estimated_cost_usd, __, "Unknown provider cost must remain undefined")
    ow.test.assert(result.events.length, 2, "Scenario should emit reusable start/end evaluation events")
  }

  exports.testEvalScenarioReportsFailuresAndOptionalJudge = function() {
    var evaluator = new MiniAEval({ agentFactory: function() { return new FakeAgent("wrong") }, judgeFn: function() { return { passed: false, reason: "deterministic judge" } } })
    var result = evaluator.runScenario({ goal: "respond", expected: { equals: "right" }, llm_judge: true })
    ow.test.assert(result.success, false, "Failed assertions and judge verdicts should fail the scenario")
    ow.test.assert(result.assertions.length, 2, "Result should retain both deterministic and judge failures")
    ow.test.assert(result.judge.reason, "deterministic judge", "Injected judge result should be preserved")
  }

  exports.testEvalSuiteAndBaselineComparison = function() {
    var evaluator = new MiniAEval({ agentFactory: function() { return new FakeAgent("ok", { failedTools: 1 }) } })
    var report = evaluator.run([{ name: "same", goal: "respond", expected: { equals: "ok" } }])
    var baseline = { scenarios: [{ name: "same", success: true, metrics: { elapsed_ms: 0, total_steps: 1, llm_calls: 1, tool_calls: 0, failed_tool_calls: 0, input_tokens: 0, output_tokens: 0 } }] }
    var comparison = evaluator.compare(report, baseline)
    ow.test.assert(report.summary.total, 1, "Suite summary should include every scenario")
    ow.test.assert(comparison.regressions.length, 1, "An increase in failed tool calls should be a regression")
    ow.test.assert(evaluator.format(report).indexOf("Mini-A evaluation: 1/1 passed") >= 0, true, "Terminal formatter should be concise")
  }

  exports.testEvalYamlDefinitionLoads = function() {
    var path = java.nio.file.Files.createTempDirectory("mini-a-eval-test").toFile().getPath() + "/suite.yaml"
    io.writeFileString(path, "scenarios:\n  - name: yaml\n    goal: answer\n    expected:\n      equals: ok\n")
    var evaluator = new MiniAEval()
    var scenarios = evaluator.load(path)
    ow.test.assert(scenarios.length, 1, "YAML suite should load one scenario")
    ow.test.assert(scenarios[0].name, "yaml", "YAML scenario metadata should be retained")
  }
})()
