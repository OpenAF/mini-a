(function() {
  load("mini-a.js")
  load("mini-a-eval.js")

  var config = { type: "gemini", model: "fixture", key: "private-fixture" }
  var caps = { structured: { implemented: true, contract: "verified", availability: "unknown", questionTypes: ["score", "choice", "boolean"], probabilities: false } }
  var manager = function(handler, options) {
    var settings = { env: function() { return config }, clientFactory: function(c) {
      c.key = "mutated-client-key"
      return { getCapabilities: function() { return clone(caps) }, decideWithStats: handler }
    } }
    return new MiniADecision(merge(settings, options || {}))
  }
  var agent = function(handler) {
    var a = new MiniA()
    a.fnI = function() {}
    a._trace = function() {}
    a._initDecisionRuntime({})
    a._decision = manager(handler, { observe: a._decision._options.observe })
    return a
  }
  var ranked = function(levels, extra) {
    return function(state, questions) {
      var answers = {}
      Object.keys(questions).forEach(function(key, index) { answers[key] = { type: "score", level: levels[index] } })
      if (extra) answers.unexpected = { type: "score", level: 2 }
      return { response: { answers: answers }, stats: { tokens: { prompt: 10, completion: 3, total: 13 } } }
    }
  }
  var entries = [
    { name: "first", description: "An unrelated tool", type: "mcp-tool" },
    { name: "second", description: "A relevant tool", type: "mcp-tool" },
    { name: "third", description: "Another relevant tool", type: "mcp-tool" }
  ]
  var expectError = function(fn, code) {
    var caught
    try { fn() } catch(e) { caught = e }
    ow.test.assert(caught && caught.code, code, "Expected typed error")
    return caught
  }

  exports.testActivationAndErrors = function() {
    var calls = 0
    var factory = function() { calls++; return {} }
    ow.test.assert(new MiniADecision({ env: function() { return __ } }).isConfigured(), false, "Missing environment disables")
    ow.test.assert(new MiniADecision({ enabled: false, env: function() { throw "Do not read" } }).isConfigured(), false, "Opt-out avoids configuration access")
    var invalid = new MiniADecision({ env: function() { return "SECRET broken configuration" }, clientFactory: factory })
    expectError(function() { invalid.decide({}, {} ) }, "MINI_A_DECISION_INVALID_CONFIG")
    ow.test.assert(calls, 0, "Invalid configuration does not initialize a provider")
    var d = manager(function() { throw { code: "LLM_DECISION_PROVIDER_ERROR", status: 429, message: "SECRET" } })
    var error = expectError(function() { d.decide({}, { yes: { type: "boolean", instructions: "Test" } }) }, "LLM_DECISION_PROVIDER_ERROR")
    ow.test.assert(error.status, 429, "Preserve status")
    ow.test.assert(String(error).indexOf("SECRET"), -1, "Do not expose provider payloads")
    ow.test.assert(d._config.key, config.key, "Clients cannot mutate stored configuration")
    expectError(function() { manager(function() {}, { clientFactory: factory }).decide({}, {}) }, "MINI_A_DECISION_RUNTIME_UNSUPPORTED")
    var unsupported = manager(function() {}, { clientFactory: function() {
      return { getCapabilities: function() { return {} }, decideWithStats: function() { throw { code: "LLM_DECISION_UNSUPPORTED" } } }
    } })
    expectError(function() { unsupported.decide({}, {}) }, "LLM_DECISION_UNSUPPORTED")
    ow.test.assert(stringify(d.getCapabilities()).indexOf("private-fixture"), -1, "Capabilities contain no configuration secrets")
  }

  exports.testRankingAndPolicy = function() {
    var a = agent(ranked([1, 2, 2]))
    var selected = a._selectByDecision("goal", entries, 2)
    ow.test.assert(selected.map(function(e) { return e.name }), ["second", "third"], "Rank semantically and keep ties stable")
    ow.test.assert(a._decisionMetrics.total_tokens, 13, "Record usage separately")
    a.mcpTools = entries
    a._availableSkills = [{ id: "skill:test", description: "Useful skill" }]
    a._decision = manager(ranked([0, 2, 1, 2]), { observe: a._decision._options.observe })
    a._initPolicyRuntime({ policy: { deniedTools: ["second"] } })
    var capabilities = a._selectCapabilities("goal", { capabilitylimit: 3 })
    ow.test.assert(capabilities.total, 4, "All registry kinds are candidates")
    ow.test.assert(capabilities.selected.map(function(e) { return e.name }), ["skill:test", "third"], "Policy still filters the selected subset")
    var before = a._decisionMetrics.calls
    a._useTools = false
    a._registerMcpToolsForGoal({ goal: "goal", capabilityselection: true })
    ow.test.assert(a._decisionMetrics.calls, before, "Disabled tools do not invoke selection")
  }

  exports.testFallbacksAndBudgets = function() {
    var a = agent(ranked([0, 0, 0]))
    a._selectToolsByKeywordMatch = function() { return ["first"] }
    ow.test.assert(a._selectMcpToolsDynamically("goal", entries), ["first"], "Valid empty result retains keyword fallback")
    ow.test.assert(a._decisionMetrics.empty_selections, 1, "Empty has its own telemetry")
    a._decision = manager(ranked([2, 2, 2], true))
    ow.test.assert(a._selectByDecision("goal", entries), __, "Reject unknown answer IDs atomically")
    a._decision = manager(function() { throw { code: "LLM_DECISION_INVALID_RESPONSE" } })
    ow.test.assert(a._selectMcpToolsDynamically("goal", entries), ["first"], "Invalid responses retain original selector")
    a._decision = manager(function() { throw "Must not call" })
    ow.test.assert(a._selectByDecision("goal", Array(65).fill(entries[0])), __, "Oversized catalog skips decision")
    ow.test.assert(a._selectByDecision("é".repeat(25000), entries), __, "Budget measures UTF-8 bytes")
    ow.test.assert(a._decisionMetrics.reasons.candidate_limit, 1, "Catalog limit telemetry")
    ow.test.assert(a._decisionMetrics.reasons.request_budget, 1, "Byte limit telemetry")
    a._initDecisionRuntime({ usedecide: false })
    ow.test.assert(a._decision.isConfigured(), false, "Internal opt-out")
    ow.test.assert(a._selectMcpToolsDynamically("goal", entries), ["first"], "Opt-out preserves legacy selection")
  }

  exports.testComplexityAndReuse = function() {
    var seen = 0
    var a = agent(function() { seen++; return { response: { answers: { complexity: { type: "choice", value: "complex" } } } } })
    ow.test.assert(a._assessComplexityByDecision("goal", "medium", {}), "complex", "Automatic ambiguous complexity")
    ow.test.assert(a._assessComplexityByDecision("goal", "medium", { llmcomplexity: false }), __, "Explicit false disables")
    ow.test.assert(a._assessComplexityByDecision("goal", "simple", {}), __, "Deterministic simple result retained")
    ow.test.assert(seen, 1, "No extra calls for opted-out or unambiguous results")
    ow.test.assert(a._decisionMetrics.usage_reports, 0, "Missing usage remains missing")
    var previous = a._decision
    a._initDecisionRuntime({})
    ow.test.assert(a._decision !== previous, true, "Reinitialization replaces decision configuration")
    ow.test.assert(a._decisionMetrics.calls, 1, "Cumulative metrics survive reinitialization")
    a._initDecisionRuntime({ usedecide: false })
    ow.test.assert(a._assessComplexityByDecision("goal", "medium", {}), __, "Opt-out survives agent reuse")
  }

  exports.testRequestIsolationAndOptions = function() {
    var created = new java.util.concurrent.atomic.AtomicInteger(0), reports = new ow.obj.syncArray()
    var d = manager(function() {}, { clientFactory: function() {
      var id = Number(created.incrementAndGet())
      return { getCapabilities: function() { return caps }, decideWithStats: function(state, questions, options) {
        ow.test.assert(options.images[0], "YWJj", "Pass images without filesystem access")
        ow.test.assert(options.model, "override", "Pass request-scoped model override")
        return { response: { id: id, answers: { yes: { type: "boolean", value: true } } }, stats: { tokens: { total: id } } }
      } }
    }, observe: function(e) { reports.add(e.stats.tokens.total) } })
    var requests = pForEach([1, 2, 3], function() { return d.decide("image", { yes: { type: "boolean", instructions: "Visible?" } }, { model: "override", images: ["YWJj"] }) })
    // Every invocation has a private client; returned and observed usage agree.
    ow.test.assert(requests.every(function(r) { return r.response.id === r.stats.tokens.total }), true, "Request-scoped usage")
    ow.test.assert(Number(created.get()), 3, "Fresh client for each invocation")
    ow.test.assert(reports.length(), 3, "One report per invocation")
  }

  exports.testEvalDecisionMetrics = function() {
    var metrics = new MiniAEval()._normalizeMetrics({ llm_calls: { total: 4, normal: 2, decision: 2 }, performance: { llm_normal_input_tokens: 20 },
      decisions: { calls: 2, failures: 1, fallbacks: 1, duration_ms: 12, input_tokens: 10, output_tokens: 3, total_tokens: 13, usage_reports: 1 } }, 40, {})
    ow.test.assert(metrics.llm_calls, 4, "Total includes decision calls once")
    ow.test.assert(metrics.input_tokens, 30, "Total input includes decision usage")
    ow.test.assert(metrics.decision_calls, 2, "Separate decision call count")
    ow.test.assert(metrics.model_calls.decision, 2, "Dedicated model role")
    ow.test.assert(metrics.decision_usage_reports, 1, "Missing usage remains distinguishable")
  }

  exports.testWorkerOperatorOptOut = function() {
    var source = io.readFileString("mini-a-worker.yaml")
    var begin = source.indexOf("var taskArgs = postData.args || {}")
    var end = source.indexOf("// Pass fork state", begin)
    var mergeRemote = new Function("wargs", "postData", source.substring(begin, end) + "\nreturn mergedArgs")
    var merged = mergeRemote({ usedecide: false, llmcomplexity: false, model: "operator-model" }, { args: { usedecide: true, llmcomplexity: true, model: "caller-model", goal: "task" } })
    ow.test.assert(merged.usedecide, false, "Remote caller cannot enable an operator-disabled decision integration")
    ow.test.assert(merged.llmcomplexity, false, "Remote caller cannot undo complexity opt-out")
    ow.test.assert(merged.model, "operator-model", "Remote caller cannot configure model credentials or endpoints")
    var optedOut = mergeRemote({ usedecide: true, llmcomplexity: true }, { args: { usedecide: false, llmcomplexity: false } })
    ow.test.assert(optedOut.usedecide, false, "Remote caller may disable decision integration")
  }

  exports.testPairedEvaluationScenarios = function() {
    var evaluator = new MiniAEval({ agentFactory: function(scenario) {
      var a = new MiniA(), runArgs
      a.fnI = function() {}
      a._trace = function() {}
      a.mcpTools = [
        { name: "forecast", description: "Predicted weather and maximum temperature in Porto tomorrow" },
        { name: "ledger", description: "Account ledger of payments, refunds and duplicate charges for customer Ada" },
        { name: "receipt", description: "Receipt for original purchase by customer Ada" },
        { name: "appointment", description: "Tomorrow's appointment in Porto" }
      ]
      a.llm = { prompt: function() { return "[]" } }
      a.init = function(args) {
        runArgs = args
        a._initDecisionRuntime(args)
        a._decision = manager(function(state, questions) {
          if (questions.complexity) return { response: { answers: { complexity: { type: "choice", value: "complex" } } } }
          var answers = {}
          state.candidates.forEach(function(candidate) {
            var relevant = scenario.scenarioName === "overlapping-billing-tools" ? candidate.name === "ledger"
              : scenario.scenarioName === "irrelevant-catalog" ? false
              : candidate.name === "forecast" || (scenario.scenarioName === "ambiguous-complexity" && candidate.name === "appointment")
            answers[candidate.id] = { type: "score", level: relevant ? 2 : 0 }
          })
          return { response: { answers: answers }, stats: { tokens: { prompt: 10, completion: 3, total: 13 } } }
        }, { enabled: args.usedecide !== false, observe: a._decision._options.observe })
      }
      a.start = function() {
        var names = runArgs.capabilityselection ? a._selectCapabilities(runArgs.goal, runArgs).selected.map(function(e) { return e.name })
          : a._selectMcpToolsDynamically(runArgs.goal, a.mcpTools)
        a._assessComplexityByDecision(runArgs.goal, a._assessGoalComplexity(runArgs.goal).level, runArgs)
        if (scenario.scenarioName === "irrelevant-catalog") return "ready"
        if (scenario.scenarioName === "overlapping-billing-tools") return names.indexOf("ledger") >= 0 ? "19" : "missing ledger"
        if (scenario.scenarioName === "ambiguous-complexity") return names.indexOf("forecast") >= 0 && names.indexOf("appointment") >= 0 ? "22 14:00" : "missing evidence"
        return names.indexOf("forecast") >= 0 ? "22" : "missing forecast"
      }
      a.getMetrics = function() {
        var d = a._decisionMetrics || {}
        return { llm_calls: { total: d.calls || 0, decision: d.calls || 0 }, decisions: d }
      }
      return a
    } })
    var report = evaluator.run(evaluator.load("evals/decide.yaml"))
    ow.test.assert(report.summary.passed, 8, "Paired outcome fixtures retain required evidence in both modes")
    ow.test.assert(report.variant_comparisons.length, 4, "Every scenario compares enabled and disabled behavior")
    ow.test.assert(report.scenarios.filter(function(s) { return s.variant === "baseline" }).every(function(s) { return s.metrics.decision_calls === 0 }), true, "Disabled variants make no decision calls")
    ow.test.assert(report.scenarios.filter(function(s) { return s.variant === "decide" }).every(function(s) { return s.metrics.decision_calls >= 1 }), true, "Enabled variants exercise decision integration")
  }
})()
