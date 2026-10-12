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
      setup: { conversation: conversation, repeatHistory: { count: 64, messages: [{ role: "assistant", content: "Revision {{iteration}}" }] } },
      expected: { equals: "replayed" }
    })
    ow.test.assert(result.success === true && observedCount === conversation.length + 64, true, "Conversation replay should expand a long deterministic fixture on the normal agent path")
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

  exports.testEvalSkillCountersAndIsolation = function() {
    var fixtures = require("examples/eval-skills.js")
    var ownedRoot
    fixtures.withSuite({}, function(scenarios, fixture) {
      ownedRoot = fixture.root
      var treatment = scenarios[0].variants[1].args
      var baseline = scenarios[0].variants[0].args
      ow.test.assert(new MiniAFileAccess(baseline.fileallow).allows(fixture.target), false, "Baseline cannot read treatment skill")
      var make = function(standard, jsonTool) {
        var agent = new MiniA()
        agent.fnI = function() {}; agent._trace = function() {}
        agent.init = function(args) {
          this._resetSkillRuntime(args)
          this.cfg = this._createUtilsMcpConfig(merge(merge({}, treatment, true), { useskills: true, useutils: false, usestdutils: standard, usejsontool: jsonTool, skillsmaxchars: 4000 }))
        }
        agent.start = function(args) {
          var tool = this.cfg.options.fns[standard ? "skill" : "skills"]
          tool({ operation: "list" })
          ow.test.assert(this._skillRuntime.snapshot().loads, 0, "Metadata discovery does not load bodies")
          tool({ operation: "get", name: "ledger-reconciliation" })
          ow.test.assert(this._skillRuntime.snapshot().loads, 1, "Read alias consumes once")
          tool({ operation: "run", name: "ledger-reconciliation" })
          ow.test.assert(this._skillRuntime.snapshot().loads, 2, "Invocation alias consumes once")
          tool({ operation: "read", name: "missing" })
          ow.test.assert(this._skillRuntime.snapshot().loads, 2, "Missing skill is not a successful load")
          this._skillRuntime.maxChars = this._skillRuntime.chars
          tool({ operation: "read", name: "ledger-reconciliation" })
          ow.test.assert(this._skillRuntime.snapshot().loads, 2, "Budget failure is not a successful load")
          return "ok"
        }
        return agent
      }
      ;[false, true].forEach(function(standard) {
        ;[false, true].forEach(function(jsonTool) {
          var agent = make(standard, jsonTool)
          try {
            var result = new MiniAEval({ agentFactory: function() { return agent } }).runScenario({ goal: "read", expected: { metrics: { "skills.loads": 2, "skills.telemetry_available": true } } })
            ow.test.assert(result.success, true, "Registered native/JSON utility boundary normalizes loads")
            ow.test.assert(result.metrics.skills.returned_chars > 0, true, "Content size comes from runtime consumption")
            ow.test.assert(isArray(result.skill_activity.consulted), true, "Legacy snapshot identities are preserved")
          } finally { agent._stopAgentResources() }
        })
      })
      var disabled = new MiniA()
      disabled.fnI = function() {}; disabled._trace = function() {}
      disabled.init = function(args) { this._resetSkillRuntime(args); this._createUtilsMcpConfig(merge(merge({}, baseline, true), { useskills: false, useutils: false })) }
      disabled.start = function() { this._consultSkillsForRun({ goal: "ready", useskills: false, skillsautosearch: false }); return "ready" }
      try {
        var result = new MiniAEval({ agentFactory: function() { return disabled } }).runScenario({ goal: "ready" })
        ow.test.assert(result.metrics.skills.loads, 0, "Disabled skill runtime reports measured zero")
        ow.test.assert(result.metrics.skills.telemetry_available, true, "Disabled differs from unavailable telemetry")
      } finally { disabled._stopAgentResources() }
    })
    ow.test.assert(io.fileExists(ownedRoot), false, "Example removes owned fixtures")
    try { fixtures.withSuite({}, function(scenarios, fixture) { ownedRoot = fixture.root; throw new Error("fixture failure") }) } catch(ignoreFixtureFailure) {}
    ow.test.assert(io.fileExists(ownedRoot), false, "Example also cleans fixtures when evaluation throws")
  }

  exports.testEvalWikiMetadataAndRetrieval = function() {
    loadLib("mini-a-skills.js")
    var fixtures = require("examples/eval-skills.js")
    fixtures.withSuite({}, function(scenarios, fixture) {
      var wiki = fixture.root + "/wiki"
      io.mkdir(wiki)
      io.writeFileString(wiki + "/report.md", "---\ntype: skill\nschema: mini-a.skill/v1\nname: report\ndescription: Report checks\n---\n# Checks\nVerify the total.\n")
      var agent = new MiniA()
      agent.fnI = function() {}; agent._trace = function() {}
      agent.init = function(args) {
        this._resetSkillRuntime(args)
        this._skillWikiManager = new MiniAWikiManager({ backend: "fs", root: wiki, access: "ro", wikiretrievalv2: false })
        this.cfg = this._createUtilsMcpConfig({ utilsroot: wiki, fileallow: [wiki], useutils: false, useskillswiki: true })
      }
      agent.start = function() {
        var fn = this.cfg.options.fns.skillwiki
        var metadata = fn({ operation: "open", ref: "wiki:report.md" })
        ow.test.assert(isUnDef(metadata.error), true, "Real wiki metadata opens successfully")
        ow.test.assert(this._skillRuntime.snapshot().loads, 0, "Wiki open is metadata-only")
        ow.test.assert(this._skillRuntime.snapshot().consulted.length, 1, "Consulted includes metadata opens")
        var body = fn({ operation: "read", ref: "wiki:report.md", section: "Checks" })
        ow.test.assert(isUnDef(body.error), true, "Real wiki section reads successfully")
        return "ok"
      }
      try {
        var result = new MiniAEval({ agentFactory: function() { return agent } }).runScenario({ goal: "read", expected: { metrics: { "skills.loads": 1 } } })
        ow.test.assert(result.success, true, "Wiki retrieval normalizes shared consumption exactly once")
      } finally { agent._stopAgentResources() }
    })
  }

  exports.testEvalSkillDeltasAndUnavailable = function() {
    var agent = new FakeAgent("ok")
    agent._skillRuntime = new MiniASkillRuntime({})
    agent.getMetrics = function() { this.metrics.skills = this._skillRuntime.snapshot(); return this.metrics }
    agent.start = function() { this._skillRuntime.consume("local:test", 10); return "ok" }
    var evaluator = new MiniAEval({ agentFactory: function() { return agent } })
    var first = evaluator.runScenario({ goal: "first" }), second = evaluator.runScenario({ goal: "second" })
    ow.test.assert([first.metrics.skills.loads, second.metrics.skills.loads, second.metrics.skills.returned_chars], [1, 1, 10], "Shared runtime counters use per-scenario deltas")
    agent.init = function() { this._skillRuntime = new MiniASkillRuntime({}) }
    var reset = evaluator.runScenario({ goal: "replacement" })
    ow.test.assert(reset.metrics.skills.returned_chars, 10, "New runtime uses its own origin, not a previous run's counts")
    ow.test.assert(reset.metrics.raw.skills.max_chars, 12000, "Raw skill limits remain final gauges rather than numeric deltas")
    var unavailable = new MiniAEval({ agentFactory: function() { return new FakeAgent("ok") } }).runScenario({ goal: "missing" })
    ow.test.assert(unavailable.metrics.skills.loads, null, "Missing telemetry is not zero")
    ow.test.assert(unavailable.metrics.skills.telemetry_available, false, "Missing telemetry is explicitly unavailable")
    var compared = evaluator.compare({ scenarios: [reset] }, { scenarios: [{ name: reset.name, success: true, metrics: {} }] })
    ow.test.assert(compared.comparisons[0].metrics.skills.loads, null, "Legacy reports do not invent a measured comparison")
    var comparison = evaluator._variantComparisons({ scenarios: [
      { scenario: "same", variant: "baseline", metrics: first.metrics, success: true },
      { scenario: "same", variant: "with-skill", metrics: second.metrics, success: true }
    ] })
    ow.test.assert(comparison[0].metrics.skills.loads, 0, "Nested scalar comparisons reuse report variants")
    agent.init = function() {}
    agent.start = function() { this._skillRuntime.chars = 0; return "ok" }
    ow.test.assert(evaluator.runScenario({ goal: "unexpected decrease" }).metrics.skills.returned_chars, null, "An unexplained decrease is unavailable rather than a negative count")
    agent.getMetrics = function() { throw new Error("unavailable") }
    ow.test.assert(evaluator.runScenario({ goal: "snapshot failed" }).metrics.skills.telemetry_available, false, "Snapshot errors remain unavailable")
  }

  exports.testEvalDecideJudge = function() {
    var calls = 0, seenState, config = { type: "openai", model: "judge-fixture", key: "secret-fixture" }
    var evaluator = new MiniAEval({
      agentFactory: function() { return new FakeAgent("ready", { input: 12 }) },
      nowFn: (function() { var tick = 0; return function() { return ++tick } })(),
      decisionClientFactory: function(c) {
        ow.test.assert(c.model, "judge-fixture", "Judge reuses explicit decision configuration")
        return { getCapabilities: function() { return {} }, decideWithStats: function(state, questions) {
          calls++; seenState = state
          var answers = {}
          Object.keys(questions).forEach(function(key) { answers[key] = { type: "boolean", value: true } })
          return { response: { answers: answers }, stats: { tokens: { prompt: 9, completion: 2, total: 11 } } }
        } }
      }
    })
    var scenario = { name: "private-variant-label", goal: "Respond", args: { usedecide: true, modeldec: config }, expected: { contains: "ead", metrics: { input_tokens: 12 } }, assertions: [{ equals: "ready" }], llm_judge: { enabled: true, backend: "decide" } }
    var result = evaluator.runScenario(scenario)
    ow.test.assert(result.success, true, "Typed Decide judge composes with deterministic assertions")
    ow.test.assert(calls, 1, "All judge questions use one request")
    ow.test.assert(Object.keys(seenState.expectations).length, 2, "Only answer expectations enter the judge")
    ow.test.assert(Object.keys(seenState).sort().join(","), "answer,expectations,goal", "Judge excludes variant names and activation telemetry")
    ow.test.assert(result.metrics.input_tokens, 12, "Judge usage is excluded from agent tokens")
    ow.test.assert(result.judge.usage.total_tokens, 11, "Judge usage is reported separately")
    ow.test.assert(result.metrics.llm_calls, 1, "Judge does not increase agent call counts")
    scenario.llm_judge.args = { modeldec: config }
    scenario.args.modeldec = { type: "openai", model: "unused-run-model" }
    ow.test.assert(evaluator.runScenario(scenario).success, true, "Judge-specific model overrides the run configuration")
    scenario.args.modeldec = config
    delete scenario.llm_judge.args
    ow.test.assert(stringify(result).indexOf("secret-fixture") < 0, true, "Report contains no configuration secrets")
    scenario.llm_judge.enabled = false
    evaluator.runScenario(scenario)
    delete scenario.llm_judge
    evaluator.runScenario(scenario)
    ow.test.assert(calls, 2, "Decide configuration alone adds no judge calls")
    scenario.llm_judge = { enabled: true, backend: "decide" }
    scenario.args.usedecide = false
    result = evaluator.runScenario(scenario)
    ow.test.assert(result.judge.error, "MINI_A_DECISION_NOT_CONFIGURED", "Explicit opt-out disables Decide judging")
    ow.test.assert(calls, 2, "Opt-out makes no provider calls")
    evaluator.judgeFn = function() { return { passed: true, injected: true } }
    ow.test.assert(evaluator.runScenario(scenario).judge.injected, true, "Existing judgeFn overrides backend selection")
    var legacy = new MiniAEval({ agentFactory: function(scenario) {
      return scenario.name === "legacy judge" ? new FakeAgent("PASS verified", { input: 100 }) : new FakeAgent("ready", { input: 12 })
    }, decisionClientFactory: function() { throw new Error("Default judge must not use Decide") } }).runScenario({ name: "legacy", goal: "Respond", expected: { equals: "ready" }, llm_judge: { enabled: true } })
    ow.test.assert(legacy.success && legacy.judge.answer === "PASS verified", true, "Omitting backend preserves the existing agent judge")
    ow.test.assert(legacy.metrics.input_tokens, 12, "Legacy judge usage stays outside evaluated-agent metrics")
  }

  exports.testEvalDecideJudgeFailures = function() {
    var config = { type: "openai", model: "fixture", key: "fixture" }
    var check = function(handler, expected, scenarioOverrides) {
      var calls = 0
      var evaluator = new MiniAEval({ agentFactory: function() { return new FakeAgent("ok") }, decisionClientFactory: function() {
        return { getCapabilities: function() { return {} }, decideWithStats: function() { calls++; return handler.apply(null, arguments) } }
      } })
      var scenario = merge({ goal: "Respond", args: { modeldec: config }, expected: { equals: "ok" }, llm_judge: { enabled: true, backend: "decide" } }, scenarioOverrides || {}, true)
      if (scenarioOverrides && isDef(scenarioOverrides.expected)) scenario.expected = scenarioOverrides.expected
      var result = evaluator.runScenario(scenario)
      ow.test.assert(result.success, false, "Judge failure fails the scenario")
      if (expected) ow.test.assert(result.judge.error, expected, "Judge failures have sanitized codes")
      ow.test.assert(calls <= 1, true, "No fallback or retries")
      return result
    }
    check(function() { return { response: { answers: {} } } }, "LLM_DECISION_INVALID_RESPONSE")
    check(function() { return { response: { answers: { check_0: { type: "boolean", value: "true" } } } } }, "LLM_DECISION_INVALID_RESPONSE")
    check(function() { return { response: { answers: { extra: { type: "boolean", value: true } } } } }, "LLM_DECISION_INVALID_RESPONSE")
    check(function() { throw MiniADecision.error("LLM_DECISION_UNSUPPORTED") }, "LLM_DECISION_UNSUPPORTED")
    check(function() { throw new Error("provider key=secret") }, "LLM_DECISION_PROVIDER_ERROR")
    var rejected = check(function() { return { response: { answers: { check_0: { type: "boolean", value: false } } } } })
    ow.test.assert(rejected.judge.checks.check_0, false, "False is a verdict, not a malformed response")
    ow.test.assert(rejected.judge.usage.input_tokens, null, "Unavailable usage is not zero")
    check(function() { throw new Error("should not call") }, "MINI_A_DECISION_REQUEST_BUDGET", { goal: new Array(50001).join("x") })
    check(function() { throw new Error("should not call") }, "LLM_DECISION_INVALID_REQUEST", { expected: {}, assertions: [] })
  }

  exports.testEvalSkillExamplePairs = function() {
    var fixtures = require("examples/eval-skills.js")
    fixtures.withSuite({ decide: true, reverse: true }, function(scenarios) {
      var evaluator = new MiniAEval()
      ow.test.assert(scenarios.length, 4, "Normal and Decide policies have separate relevant/unrelated pairs")
      var expanded = evaluator._expandVariants(scenarios)
      ow.test.assert(expanded.length, 8, "Each experiment has an unavailable and available target")
      scenarios.forEach(function(scenario) {
        ow.test.assert(scenario.variants[0].name, "with-skill", "Pair order can alternate")
        ow.test.assert(isUnDef(scenario.llm_judge), true, "Example adds no automatic judge calls")
      })
      ow.test.assert(scenarios[2].args.usedecide && scenarios[2].args.skillsautosearch, true, "Decide selection is explicitly enabled only for its experiment")
    })
  }

  exports.testEvalSkillExampleExecution = function() {
    var fixtures = require("examples/eval-skills.js")
    fixtures.withSuite({}, function(scenarios) {
      var agents = []
      try {
        var evaluator = new MiniAEval({ agentFactory: function(scenario) {
          var agent = new MiniA(), init = agent.init, create = agent._createBareLlmInstance, turns = 0
          agents.push(agent)
          agent.fnI = function() {}; agent._trace = function() {}
          var respond = function() {
            turns++
            var relevant = scenario.scenarioName.indexOf("ledger reconciliation") >= 0
            if (relevant && scenario.variant === "with-skill" && turns === 1) return {
              response: { action: "skills", params: { operation: "read", name: "ledger-reconciliation" } }, stats: {}
            }
            return { response: { action: "final", answer: relevant ? "total=73 EUR; discrepancies=INV-03,INV-07" : "ready" }, stats: {} }
          }
          var inject = function(client) {
            ;["promptJSONWithStats", "promptWithStats", "promptJSONWithStatsRaw", "rawPromptWithStats", "promptStreamWithStats", "promptStreamJSONWithStats"].forEach(function(method) { client[method] = respond })
            return client
          }
          // Context assembly may replace the working client after init. Intercept
          // every newly-created client as well as the initial model channels.
          agent._createBareLlmInstance = function() { return inject(create.apply(this, arguments)) }
          agent.init = function(args) {
            args.model = "(type: openai, model: fixture, key: fixture)"
            args.modellc = args.model
            args.modelval = args.model
            args.llmcomplexity = false
            args.usestream = false
            args.showthinking = false
            args.raw = true
            var initialized = init.call(this, args)
            fixtures.assertIsolation(this, args, scenario.variant === "with-skill")
            inject(this.llm)
            if (this.lc_llm) inject(this.lc_llm)
            if (this.val_llm) inject(this.val_llm)
            return initialized
          }
          return agent
        } })
        var report = evaluator.run(scenarios)
        ow.test.assert(report.summary.passed, 4, "Example tasks run through real init/start with injected provider responses: " + stringify(report.scenarios.map(function(result) { return { name: result.name, error: result.error, answer: result.answer } })))
        var loaded = report.scenarios.filter(function(result) { return result.metrics.skills.loads > 0 })
        ow.test.assert(loaded.length, 1, "Only relevant treatment retrieves through real JSON dispatch")
        ow.test.assert(loaded[0].metrics.skills.loads, 1, "JSON dispatch counts successful retrieval exactly once")
        ow.test.assert(report.variant_comparisons.length, 2, "Real example results retain paired comparisons")
      } finally { agents.forEach(function(agent) { agent._stopAgentResources() }) }
    })
  }

  exports.testEvalDecideSkillSelection = function() {
    var fixtures = require("examples/eval-skills.js")
    fixtures.withSuite({ decide: true }, function(scenarios) {
      var agents = []
      try {
        var evaluator = new MiniAEval({ agentFactory: function(scenario) {
          var agent = new MiniA()
          agents.push(agent)
          agent.fnI = function() {}; agent._trace = function() {}
          agent.init = function(args) {
            this._resetSkillRuntime(args)
            this._createUtilsMcpConfig(args)
            this._initDecisionRuntime({ usedecide: true, modeldec: { type: "openai", model: "fixture" } })
            var observe = this._decision._options.observe
            this._decision = new MiniADecision({ modeldec: { type: "openai", model: "fixture" }, observe: observe, clientFactory: function() {
              return { getCapabilities: function() { return {} }, decideWithStats: function(state, questions) {
                var answers = {}
                Object.keys(questions).forEach(function(key) { answers[key] = { type: "boolean", value: scenario.scenarioName.indexOf("ledger reconciliation") >= 0 } })
                return { response: { answers: answers }, stats: { tokens: { prompt: 10, completion: 2, total: 12 } } }
              } }
            } })
          }
          agent.start = function(args) {
            this._consultSkillsForRun(args)
            return scenario.scenarioName.indexOf("ledger reconciliation") >= 0 ? "total=73 EUR; discrepancies=INV-03,INV-07" : "ready"
          }
          return agent
        } })
        var report = evaluator.run(scenarios.slice(2))
        ow.test.assert(report.summary.passed, 4, "Decide-assisted pair keeps identical outcome checks")
        var treatment = report.scenarios.filter(function(result) { return result.variant === "with-skill" && result.scenario.indexOf("ledger reconciliation") >= 0 })[0]
        ow.test.assert(treatment.metrics.skills.loads, 1, "Real Decide selection activates the available relevant skill")
        ow.test.assert(treatment.metrics.skills.selection_calls, 1, "Skill selection request is counted")
        ow.test.assert(treatment.metrics.decision_calls, 1, "Existing decision metrics count the same request")
        ow.test.assert(treatment.metrics.decision_total_tokens, 12, "Existing decision usage is reused")
        ow.test.assert(report.scenarios.filter(function(result) { return result.variant === "baseline" }).every(function(result) { return result.metrics.skills.loads === 0 && result.metrics.skills.selection_calls === 0 }), true, "No target or other candidates leak into the baseline")
        ow.test.assert(report.scenarios.filter(function(result) { return result.scenario.indexOf("unrelated") >= 0 }).every(function(result) { return result.metrics.skills.loads === 0 }), true, "Unrelated tasks do not activate the skill")
      } finally { agents.forEach(function(agent) { agent._stopAgentResources() }) }
    })
  }
  exports.testEvalSupervisedWorkspaceAndWarmup = function() {
    var starts = 0, paths = []
    var evaluator = new MiniAEval({ agentFactory: function() {
      var agent = new FakeAgent("ready")
      agent.start = function(args) {
        starts++; paths.push(args.homedir)
        var result = FakeAgent.prototype.start.call(this, args)
        ow.test.assert(io.readFileString(args.homedir + "/input.txt"), "fresh", "Each attempt starts from identical fixture")
        io.writeFileString(args.homedir + "/output.json", '{"ok":true}')
        if (args.savecontract) { io.mkdir(args.homedir + "/.openaf-mini-a"); io.writeFileString(args.homedir + "/.openaf-mini-a/receipt", "saved") }
        if (args.reusecontract) ow.test.assert(io.fileExists(args.homedir + "/.openaf-mini-a/receipt"), true, "Warmup store retained")
        this._supervised = { accepted: true }
        return result
      }
      return agent
    } })
    var result = evaluator.runScenario({ goal: "fixture", args: { reusecontract: true }, setup: { warmup: true, workspace: { files: { "input.txt": "fresh" } } },
      artifact_assertions: [{ file: "{{workspace}}/output.json", format: "json", assertion: { path: "ok", equals: true } }] })
    ow.test.assert(starts, 2, "Cold warmup and isolated warm attempt")
    ow.test.assert(result.success, true, "Independent artifact acceptance passes")
    ow.test.assert(result.warmup.success, true, "Warmup independently checked")
    ow.test.assert(result.total_with_warmup.estimated_cost_usd, null, "Unknown combined cost stays unknown")
    ow.test.assert(io.fileExists(paths[0]), false, "Owned fixtures cleaned after checking")
  }
  exports.testEvalLcBaselineAndIncorrectCompletion = function() {
    var evaluator = new MiniAEval({ agentFactory: function() {
      var agent = new FakeAgent("wrong")
      agent._supervised = { accepted: true }
      return agent
    } })
    var report = evaluator.run([{ goal: "independent", audit_all: true, expected: { equals: "right" } }])
    ow.test.assert(report.summary.incorrect_automatic_completions, 1, "Runtime acceptance is not independent success")
    ow.test.assert(report.summary.audit_required, 1, "Automatic acceptance selected for audit")
    var noJudge = evaluator.runScenario({ goal: "no independent judge" })
    ow.test.assert(noJudge.success, false, "Runtime decider cannot be sole evaluation judge")
    var agent = { llm: { promptWithStats: function() {} }, lc_llm: {}, _prepareContextInvocation: function() {} }
    evaluator._guardLcBaseline(agent)
    var denied = false
    try { agent.llm.promptWithStats("fallback") } catch(e) { denied = true }
    ow.test.assert(denied, true, "LC baseline blocks hidden main dispatch")
  }
})()
