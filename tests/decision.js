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

  exports.testModelDecOverride = function() {
    var override = { type: "openai", model: "override", key: "private-override" }
    var d = manager(function() {}, { modeldec: stringify(override) })
    ow.test.assert(d._config.model, "override", "Explicit model overrides environment")
    ow.test.assert(config.model, "fixture", "Environment config remains unchanged")
    var a = new MiniA()
    a._initDecisionRuntime({ modeldec: stringify(override) })
    ow.test.assert(a._decision._config.model, "override", "Runtime forwards override")
    ow.test.assert(a._decisionMetrics.model, "override", "Metrics identify effective model")
    ow.test.assert(a._decisionMetrics.source, "modeldec", "Metrics identify source")
    ow.test.assert(isUnDef(a._decisionMetrics.key), true, "Metrics omit credentials")
    ow.test.assert(a._resolveSkillsAutoSearch({ usedecide: true, modeldec: stringify(override) }, function() { return __ }), true, "Override enables conditional skill search")
    ow.test.assert(manager(function() {}, { enabled: false, modeldec: stringify(override) }).isConfigured(), false, "Opt-out wins")
    expectError(function() { manager(function() {}, { modeldec: "invalid" }).decide({}, {}) }, "MINI_A_DECISION_INVALID_CONFIG")
  }

  exports.testDecisionDebugChannel = function() {
    var a = new MiniA(), attached = [], clients = 0
    a.fnI = function() {}
    var channel = "__mini_a_decision_test_debug"
    try {
      a._initDecisionRuntime({ modeldec: stringify(config), debugdecch: stringify({ name: channel, type: "simple" }) })
      a._decision._options.clientFactory = function() {
        clients++
        return {
          getCapabilities: function() { return caps },
          setDebugCh: function(name) { attached.push(name) },
          decideWithStats: function() { return { response: { answers: {} }, stats: {} } }
        }
      }
      a._decision.decide({}, {})
      a._decision.decide({}, {})
      ow.test.assert(clients, 2, "Decisions keep fresh clients")
      ow.test.assert(attached, [channel, channel], "Every decision client receives the debug channel")
      ow.test.assert($ch().list().indexOf(channel) >= 0, true, "Debug channel is created")
      a._initDecisionRuntime({ modeldec: stringify(config) })
      a._decision._options.clientFactory = function() {
        return { getCapabilities: function() { return caps }, decideWithStats: function() { return {} },
          setDebugCh: function() { throw "Debugging must remain opt-in" } }
      }
      a._decision.decide({}, {})
    } finally {
      if ($ch().list().indexOf(channel) >= 0) $ch(channel).destroy()
    }
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

  // ---- verdict gates: decide may only skip an expensive call; unavailable/failing decide == existing behaviour ----
  var gateAgent = function(handler, llmResponse) {
    var a = new MiniA()
    a.fnI = function() {}
    a._trace = function() {}
    a._memoryAppend = function() {}
    a._convertPlanObject = function() { return "1. Do the thing" }
    a._prepareContextInvocation = function(llm, prompt) { return prompt }
    a._initDecisionRuntime({})
    a._decision = manager(handler || function() {}, { env: handler ? function() { return config } : function() { return __ }, observe: a._decision._options.observe })
    a.llmCalls = 0
    a.llm = { promptJSONWithStats: function() { a.llmCalls++; return { response: llmResponse, stats: {} } } }
    return a
  }
  var answering = function(answers) {
    return function(state, questions) {
      a_lastQuestions = Object.keys(questions)
      return { response: { answers: answers }, stats: { tokens: { prompt: 5, completion: 1, total: 6 } } }
    }
  }
  var a_lastQuestions
  var choice = function(value) { return { type: "choice", value: value } }
  var critiqueReply = { verdict: "REVISE", issues: ["unclear"], missingWork: ["tests"], qualityRisks: [], summary: "needs work" }

  exports.testPlanCritiqueGate = function() {
    var run = function(a, args) { var plan = {}; a._critiquePlanWithLLM({ plan: plan, format: "markdown" }, args || { usedecide: true, goal: "ship" }); return plan.meta.llmCritique }
    var a = gateAgent(__, critiqueReply), c = run(a)
    ow.test.assert(a.llmCalls, 1, "Unconfigured decide runs the existing validator")
    ow.test.assert(c.verdict, "REVISE", "Unconfigured decide keeps the existing critique")
    a = gateAgent(answering({ verdict: choice("pass") }), critiqueReply); c = run(a)
    ow.test.assert(a.llmCalls, 0, "PASS skips the validator call")
    ow.test.assert(c.verdict, "PASS", "PASS is recorded in the existing critique shape")
    ow.test.assert(isArray(c.issues) && isArray(c.missingWork) && isArray(c.qualityRisks), true, "Critique keeps its list fields")
    ow.test.assert(c.raw.source, "decide", "Critique is tagged with its source")
    a = gateAgent(answering({ verdict: choice("revise") }), critiqueReply); c = run(a)
    ow.test.assert(a.llmCalls, 1, "REVISE still runs the full critique")
    ow.test.assert(c.issues[0], "unclear", "REVISE keeps the issues replanning needs")
    a = gateAgent(function() { throw { code: "LLM_DECISION_PROVIDER_ERROR" } }, critiqueReply); c = run(a)
    ow.test.assert(a.llmCalls, 1, "Decision error runs the existing path")
    ow.test.assert(a._decisionMetrics.fallbacks, 1, "Decision error is counted as a fallback")
    a = gateAgent(answering({ verdict: choice("maybe") }), critiqueReply); run(a)
    ow.test.assert(a.llmCalls, 1, "Invalid decision answers fall back")
    a = gateAgent(answering({ verdict: choice("pass") }), critiqueReply); run(a, { goal: "ship" })
    ow.test.assert(a.llmCalls, 1, "Without explicit usedecide=true the gate is inactive")
  }

  exports.testResearchValidationGate = function() {
    var reply = { verdict: "REVISE", feedback: "gaps", score: 0.3, specificIssues: ["i"], suggestions: ["s"] }
    var run = function(a, args) { return a._validateResearchOutcome("findings", "cover X", args || { usedecide: true }) }
    var pass = { verdict: choice("pass"), quality: { type: "score", level: 2 } }
    var a = gateAgent(__, reply), r = run(a)
    ow.test.assert([a.llmCalls, r.verdict, r.score], [1, "REVISE", 0.3], "Unconfigured decide keeps the existing validation")
    a = gateAgent(answering(pass), reply); r = run(a)
    ow.test.assert(a.llmCalls, 0, "Full PASS skips the validator")
    ow.test.assert([r.verdict, r.score, isArray(r.specificIssues), isArray(r.suggestions)], ["PASS", 1, true, true], "Short-circuit keeps the result shape and meets any threshold")
    ow.test.assert(a._checkValidationThreshold(r, "score>=1.0"), true, "Short-circuit meets a maximal score threshold")
    a = gateAgent(answering({ verdict: choice("pass"), quality: { type: "score", level: 1 } }), reply); r = run(a)
    ow.test.assert([a.llmCalls, r.verdict], [1, "REVISE"], "Partial score runs the validator so feedback is produced")
    a = gateAgent(answering({ verdict: choice("revise"), quality: { type: "score", level: 0 } }), reply); run(a)
    ow.test.assert(a.llmCalls, 1, "REVISE runs the validator")
    a = gateAgent(function() { throw { code: "LLM_DECISION_PROVIDER_ERROR" } }, reply); r = run(a)
    ow.test.assert([a.llmCalls, r.verdict, a._decisionMetrics.fallbacks], [1, "REVISE", 1], "Decision error runs the existing path")
    var called = 0
    a = gateAgent(function() { called++; return answering(pass).apply(null, arguments) }, reply); a._oaf_model = {}; run(a, { usedecide: true, valtools: true })
    ow.test.assert(called, 0, "valtools=true never consults decide")
    a = gateAgent(function() { called++; return answering(pass).apply(null, arguments) }, reply); run(a, {})
    ow.test.assert(called, 0, "Without explicit usedecide=true the gate is inactive")
    a = gateAgent(answering(pass), reply)
    var big = new Array(60 * 1024).join("x")
    r = a._validateResearchOutcome(big, "cover X", { usedecide: true })
    ow.test.assert([a.llmCalls, a._decisionMetrics.reasons.request_budget], [1, 1], "Oversized research falls back instead of truncating")
  }

  exports.testLcEscalationGate = function() {
    var runtime = { recentSimilarThoughts: ["a", "b", "c", "d"] }
    var a = gateAgent(__, {})
    ow.test.assert(isUnDef(a._decideLcDeferral({ usedecide: true, goal: "g" }, runtime, "r", "resp")), true, "Unconfigured decide defers to the heuristic")
    a = gateAgent(answering({ progress: choice("progressing") }), {})
    ow.test.assert(a._decideLcDeferral({ usedecide: true, goal: "g" }, runtime, "r", "resp"), true, "Progress defers escalation")
    ow.test.assert(isUnDef(a._decideLcDeferral({ goal: "g" }, runtime, "r", "resp")), true, "Without explicit usedecide=true the gate is inactive")
    a = gateAgent(answering({ progress: choice("stuck") }), {})
    ow.test.assert(a._decideLcDeferral({ usedecide: true, goal: "g" }, runtime, "r", "resp"), false, "Stuck escalates")
    a = gateAgent(function() { throw { code: "LLM_DECISION_PROVIDER_ERROR" } }, {})
    ow.test.assert(isUnDef(a._decideLcDeferral({ usedecide: true, goal: "g" }, runtime, "r", "resp")), true, "Decision error defers to the heuristic")
    ow.test.assert(a._decisionMetrics.fallbacks, 1, "Decision error is counted as a fallback")
    var calls = 0
    a = gateAgent(function() { calls++; throw { code: "LLM_DECISION_UNSUPPORTED" } }, {})
    a._decision._options.clientFactory = function() { return {} }
    a._decideLcDeferral({ usedecide: true }, runtime, "r", "x"); a._decideLcDeferral({ usedecide: true }, runtime, "r", "x")
    ow.test.assert(a._decisionMetrics.fallbacks, 1, "An unsupported runtime disables further gate attempts for the run")
  }

  exports.testAdvisorWorthGate = function() {
    var runtime = { advisorPolicy: { enabled: true, onHardDecision: true, onAmbiguity: true, maxUses: 5, cooldownSteps: 0 }, advisorUses: 0,
      currentStepNumber: 3, advisorLastStep: 0, context: ["[OBS 1] ok", "[OBS 2] ok"] }
    var args = { usedecide: true, goal: "g" }
    var verdict = function(a, signals, runArgs) { return a._shouldConsultAdvisor(runtime, signals || { hardDecision: true }, runArgs || args) }
    var a = gateAgent(__, {})
    ow.test.assert(verdict(a).ok, true, "Unconfigured decide keeps the existing allow")
    a = gateAgent(answering({ worth: { type: "boolean", value: true } }), {})
    ow.test.assert(verdict(a).ok, true, "Worth keeps the consult")
    a = gateAgent(answering({ worth: { type: "boolean", value: false } }), {})
    var v = verdict(a)
    ow.test.assert([v.ok, v.reason], [false, "decision_low_value"], "Low value skips the consult")
    ow.test.assert(verdict(a, __, { goal: "g" }).ok, true, "Without explicit usedecide=true the gate is inactive")
    var called = 0
    a = gateAgent(function() { called++; return answering({ worth: { type: "boolean", value: false } }).apply(null, arguments) }, {})
    ow.test.assert(verdict(a, { risk: true, hardDecision: true }).ok, true, "Risk consults are never vetoed")
    ow.test.assert(verdict(a, { errorRecovery: true }).ok, true, "Error-recovery consults are never vetoed")
    ow.test.assert(called, 0, "Protected signals do not consult decide")
    a = gateAgent(function() { throw { code: "LLM_DECISION_PROVIDER_ERROR" } }, {})
    ow.test.assert([verdict(a).ok, a._decisionMetrics.fallbacks], [true, 1], "Decision error keeps the existing allow")
    runtime.advisorPolicy.enabled = false
    a = gateAgent(answering({ worth: { type: "boolean", value: false } }), {})
    ow.test.assert(verdict(a).reason, "advisor_disabled", "Existing policy reasons are preserved")
  }

  exports.testPlanningStrategyUsesDecision = function() {
    var goal = "Review the ledger and then update the accounts" // heuristic: ambiguous (multi-step)
    var prep = function(a, args) { a._preparePlanning(merge({ goal: goal, useplanning: true }, args || {})); return a._planningStrategy }
    var a = gateAgent(__, {})
    var baseline = prep(a), level = a._planningAssessment.level
    ow.test.assert(level, "medium", "Fixture goal is heuristically ambiguous")
    ow.test.assert(isUnDef(a._planningAssessment.source), true, "Unconfigured decide leaves the heuristic assessment")
    var asking = function(value) { var n = { calls: 0 }; n.fn = function() { n.calls++; return answering({ complexity: choice(value) }).apply(null, arguments) }; return n }
    var h = asking("complex"); a = gateAgent(h.fn, {})
    ow.test.assert([prep(a), a._planningAssessment.source], ["tree", "decide"], "Decision escalates an ambiguous goal to a tree plan")
    prep(a); a._assessComplexityByDecision(goal, "medium", { goal: goal })
    ow.test.assert(h.calls, 1, "One complexity decision per run and goal")
    h = asking("simple"); a = gateAgent(h.fn, {})
    ow.test.assert(prep(a), "off", "Decision can classify an ambiguous goal as simple")
    h = asking("complex"); a = gateAgent(h.fn, {})
    ow.test.assert(prep(a, { useplanning: false }), baseline, "Heuristic strategy when planning is not requested")
    ow.test.assert(h.calls, 0, "Planning off does not consult decide")
    a = gateAgent(function() { throw { code: "LLM_DECISION_PROVIDER_ERROR" } }, {})
    ow.test.assert([prep(a), a._decisionMetrics.fallbacks], [baseline, 1], "Decision error keeps the heuristic strategy")
    h = asking("complex"); a = gateAgent(h.fn, {})
    ow.test.assert(prep(a, { llmcomplexity: false }), baseline, "llmcomplexity=false keeps the heuristic strategy")
  }

  exports.testChildHandoffToolSelection = function() {
    var tools = [
      { name: "ledger", description: "Query payments and invoices" },
      { name: "weather", description: "Forecast temperature" },
      { name: "calendar", description: "Book appointments" }
    ]
    var goal = "payments invoices reconciliation"
    var a = gateAgent(__, {})
    var baseline = a._selectChildMcpHandoffTools(goal, {}, tools)
    ow.test.assert(baseline[0], "ledger", "Keyword fallback picks the lexical match")
    a = gateAgent(ranked([0, 1, 2]), {})
    ow.test.assert(a._selectChildMcpHandoffTools("book something", {}, tools).join(","), "calendar,weather", "Decision ranks semantically relevant tools first")
    ow.test.assert(a._selectChildMcpHandoffTools(goal, { tools: ["weather"] }, tools).join(","), "weather", "Explicit tool requests still win without a decision call")
    ow.test.assert(a._decisionMetrics.calls, 1, "Explicit and name-mention requests never consult decide")
    a = gateAgent(function() { throw { code: "LLM_DECISION_PROVIDER_ERROR" } }, {})
    ow.test.assert([a._selectChildMcpHandoffTools(goal, {}, tools).join(","), a._decisionMetrics.fallbacks], [baseline.join(","), 1], "Decision error keeps the keyword fallback")
    a = gateAgent(ranked([0, 0, 0]), {})
    ow.test.assert(a._selectChildMcpHandoffTools(goal, {}, tools).join(","), baseline.join(","), "An all-irrelevant decision keeps the keyword fallback")
  }

  exports.testRelevantMemoryRerank = function() {
    global.__mini_a_metrics = global.__mini_a_metrics || {}
    var mk = function(key, score) { return { score: score, entry: { k: "preference", key: key, v: "value of " + key } } }
    var agentWithMemory = function(handler) {
      var a = gateAgent(handler, {})
      a._memoryConfig = { enabled: true }
      a._deriveMemoryTaskScope = function() { return "family::task" }
      a._memorySearchScored = function() { return { decisions: [mk("alpha", 3), mk("beta", 2), mk("gamma", 1)] } }
      return a
    }
    var keys = function(a, args) { return a._buildRelevantMemoryBlock(merge({ goal: "pick something" }, args || { usedecide: true })).map(function(m) { return m.key }).join(",") }
    var baseline = keys(agentWithMemory(__))
    ow.test.assert(baseline, "alpha,beta,gamma", "Unconfigured decide keeps the lexical order")
    ow.test.assert(keys(agentWithMemory(ranked([0, 1, 2]))), "gamma,beta", "Decision reorders by relevance and drops irrelevant entries")
    ow.test.assert(keys(agentWithMemory(ranked([0, 1, 2])), {}), "alpha,beta,gamma", "Without explicit usedecide=true the lexical order is kept")
    ow.test.assert(keys(agentWithMemory(function() { throw { code: "LLM_DECISION_PROVIDER_ERROR" } })), baseline, "Decision error keeps the lexical order")
    ow.test.assert(keys(agentWithMemory(ranked([0, 0, 0]))), baseline, "All-irrelevant decision keeps the lexical order")
  }

  exports.testReflectionFilterGate = function() {
    var validated = function() { return { accepted: [{ kind: "preference", value: "durable one", key: "a", tags: [] }, { kind: "preference", value: "oneoff two", key: "b", tags: [] }], rejected: 1 } }
    var run = function(a, args) { return a._decideFilterReflections(args || { usedecide: true }, validated(), "goal", "answer") }
    var yesNo = function(first, second) { return answering({ entry_0: { type: "boolean", value: first }, entry_1: { type: "boolean", value: second } }) }
    var r = run(gateAgent(__, {}))
    ow.test.assert([r.accepted.length, r.rejected], [2, 1], "Unconfigured decide keeps every validated entry")
    r = run(gateAgent(yesNo(true, false), {}))
    ow.test.assert([r.accepted.map(function(e) { return e.key }).join(","), r.rejected], ["a", 2], "Decision drops entries judged one-off and counts them rejected")
    r = run(gateAgent(yesNo(true, true), {}))
    ow.test.assert(r.accepted.length, 2, "All-durable decision keeps everything")
    r = run(gateAgent(yesNo(false, false), {}))
    ow.test.assert(r.accepted.length, 0, "Decision may reject all entries")
    r = run(gateAgent(yesNo(false, false), {}), {})
    ow.test.assert(r.accepted.length, 2, "Without explicit usedecide=true nothing is dropped")
    var a = gateAgent(function() { throw { code: "LLM_DECISION_PROVIDER_ERROR" } }, {})
    ow.test.assert([run(a).accepted.length, a._decisionMetrics.fallbacks], [2, 1], "Decision error keeps every validated entry")
    r = run(gateAgent(answering({ entry_0: { type: "boolean", value: true } }), {}))
    ow.test.assert(r.accepted.length, 2, "Incomplete answers keep every validated entry")
  }

  exports.testGateCachePerRun = function() {
    var calls = 0
    var handler = function() { calls++; return answering({ worth: { type: "boolean", value: false } }).apply(null, arguments) }
    var a = gateAgent(handler, {})
    var args = { usedecide: true, goal: "g" }
    var first = a._decisionGate("advisor_worth", args, { x: 1 }, { worth: { type: "boolean", instructions: "i" } }, function(r) { return r.worth.type === "boolean" })
    var second = a._decisionGate("advisor_worth", args, { x: 1 }, { worth: { type: "boolean", instructions: "i" } }, function(r) { return r.worth.type === "boolean" })
    ow.test.assert([calls, second.worth.value, first.worth.value], [1, false, false], "Identical requests in one run are answered from cache")
    a._decisionGate("advisor_worth", args, { x: 2 }, { worth: { type: "boolean", instructions: "i" } }, function() { return true })
    ow.test.assert(calls, 2, "A different state is a different request")
    a._decisionGate("other_op", args, { x: 1 }, { worth: { type: "boolean", instructions: "i" } }, function() { return true })
    ow.test.assert(calls, 3, "A different operation is a different request")
    second.worth.value = true
    var third = a._decisionGate("advisor_worth", args, { x: 1 }, { worth: { type: "boolean", instructions: "i" } }, function() { return true })
    ow.test.assert(third.worth.value, false, "Cached answers are copies, not shared state")
    a._initDecisionRuntime({})
    ow.test.assert(isUnDef(a._decisionGateCache), true, "A new run clears the cache")
  }
})()
