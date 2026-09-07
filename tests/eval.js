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
      behavior_patterns: { retries: 0 }, advisor: { calls: 0 }, delegation: { total: 0 }, wiki: { ops_search: 0, ops_read: 0, ops_list: 0 },
      history_vm: { active: false, shadow: false, contextVirtualization: false, contextVirtualizationShadow: false, metrics: {} }
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
    if (isMap(this.values.historyVm)) this.metrics.history_vm = merge(this.metrics.history_vm, this.values.historyVm, true)
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

  exports.testEvalNormalizesHistoryVmShadowMetrics = function() {
    var evaluator = new MiniAEval({ agentFactory: function() { return new FakeAgent("ready", { historyVm: {
      active: true,
      contextVirtualization: true,
      contextVirtualizationShadow: true,
      metrics: {
        context_objects_considered: 82,
        context_objects_selected: 21,
        context_candidate_tokens: 183000,
        context_materialized_tokens: 31000,
        effective_context_ratio: 45,
        context_budget_utilization: 0.72,
        reads: 2,
        context_expansions: 3,
        representation_l0: 4,
        representation_l1: 4,
        representation_l2: 6,
        representation_l3: 7,
        representation_l4: 4,
        context_virtualization_shadow_assemblies: 1,
        context_virtualization_shadow_actual_tokens: 64000,
        context_virtualization_shadow_projected_tokens: 31000,
        context_virtualization_shadow_expected_savings: 33000,
        context_virtualization_shadow_object_differences: 9,
        context_virtualization_active_assemblies: 2,
        context_virtualization_active_input_tokens: 60000,
        context_virtualization_active_output_tokens: 28000,
        context_virtualization_active_tokens_saved: 32000,
        context_virtualization_active_references: 12
      }
    } }) } })
    var result = evaluator.runScenario({ goal: "evaluate context virtualization", expected: { metrics: {
      "history_vm.context_virtualization_shadow": true,
      "history_vm.objects_selected": 21,
      "history_vm.rehydrations": 5,
      "shadow_expected_savings": 33000
    } } })
    ow.test.assert(result.success, true, "Evaluation assertions should address normalized History VM metrics")
    ow.test.assert(result.metrics.history_vm.representation_levels.l4, 4, "Representation-level counters should be preserved")
    ow.test.assert(result.metrics.history_vm.shadow_projection.projected_tokens, 31000, "Latest shadow gauges should not be treated as cumulative deltas")
    ow.test.assert(result.metrics.history_vm.active_projection.tokens_saved === 32000 && result.metrics.history_vm.active_projection.references === 12, true, "Active provider materialization should remain distinct from shadow predictions")
    var comparison = evaluator.compare({ scenarios: [result] }, { scenarios: [{ name: result.name, success: true, metrics: { shadow_expected_savings: 0, effective_context_ratio: 0 } }] })
    ow.test.assert(comparison.comparisons[0].metrics.shadow_expected_savings, 33000, "Baseline comparisons should expose the shadow-predicted token difference")
    ow.test.assert(comparison.comparisons[0].metrics.effective_context_ratio, 45, "Baseline comparisons should expose effective-context amplification")
  }

  exports.testEvalMaterializesAndCleansConversationReplay = function() {
    var observedPath = __
    var observedCount = 0
    var ReplayAgent = function() { FakeAgent.call(this, "replayed", { input: 5000 }) }
    ReplayAgent.prototype = Object.create(FakeAgent.prototype)
    ReplayAgent.prototype.constructor = ReplayAgent
    ReplayAgent.prototype.start = function(args) {
      observedPath = args.conversation
      var payload = io.readFileJSON(observedPath)
      observedCount = payload.c.length
      return FakeAgent.prototype.start.call(this, args)
    }
    var oldOutput = new Array(6001).join("old tool output ")
    var conversation = [
      { role: "system", content: "Preserve exact backing data." },
      { role: "assistant", content: oldOutput },
      { role: "user", content: "Use architecture A." },
      { role: "user", content: "Requirement changed: use architecture B." },
      { role: "assistant", content: "Architecture B is active." }
    ]
    var evaluator = new MiniAEval({ agentFactory: function() { return new ReplayAgent() } })
    var result = evaluator.runScenario({
      name: "long-context-replay",
      goal: "report the active architecture",
      setup: { conversation: conversation },
      expected: { equals: "replayed" }
    })
    ow.test.assert(result.success === true && observedCount === conversation.length, true, "Conversation replay should provide the complete deterministic fixture to the normal agent path")
    ow.test.assert(isString(observedPath) && io.fileExists(observedPath) === false, true, "Evaluator-owned replay files and VM sidecars should be removed after metric capture")
  }

  exports.testEvalExpandsPhaseVariantMatrix = function() {
    var evaluator = new MiniAEval({ agentFactory: function(scenario) {
      var values = scenario.variant === "phase1" ? { input: 60000 } : (scenario.variant === "phase2-shadow" ? { input: 60000 } : { input: 28000 })
      return new FakeAgent("architecture B", values)
    } })
    var report = evaluator.run([{
      name: "changed-requirement",
      goal: "report the active architecture",
      expected: { contains: "architecture B" },
      variants: [
        { name: "phase1", args: { historyvm: true } },
        { name: "phase2-shadow", args: { historyvm: true, contextvirtualization: true, contextvirtualizationshadow: true } },
        { name: "phase2-active", args: { historyvm: true, contextvirtualization: true } }
      ]
    }])
    ow.test.assert(report.scenarios.length === 3 && report.summary.passed === 3, true, "A scenario variant matrix should run all Phase 1, shadow, and active profiles")
    ow.test.assert(report.scenarios[2].name === "changed-requirement [phase2-active]", true, "Variant results should retain stable descriptive names")
    ow.test.assert(report.variant_comparisons.length === 2 && report.variant_comparisons[1].metrics.input_tokens === -32000, true, "Variant comparisons should report deltas against Phase 1 without claiming causal savings")
  }
})()
