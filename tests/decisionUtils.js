(function() {
  load("mini-a.js")
  load("mini-a-utils.js")

  var request = { state: { ticket: "Charged twice" }, questions: {
    team: { type: "choice", instructions: "Choose the responsible team", criteria: { billing: "Payments", technical: "Software" } },
    urgent: { type: "boolean", instructions: "Needs immediate attention?" }
  } }

  function fixture(handler) {
    var agent = new MiniA()
    agent.fnI = function() {}
    agent._trace = function() {}
    agent._initDecisionRuntime({ usedecide: true })
    var observer = agent._decision._options.observe
    agent._decision = new MiniADecision({ env: function() { return { type: "ollama", model: "fixture" } }, observe: observer,
      clientFactory: function() { return { getCapabilities: function() { return {} }, decideWithStats: handler || function(state, questions) {
        return { response: { answers: { team: { type: "choice", value: "billing" }, urgent: { type: "boolean", value: false } } }, stats: { total_tokens: 11 } }
      } } }
    })
    return agent
  }

  function call(config, payload) {
    var out = config.options.fns.decide(payload)
    return out.error ? out : jsonParse(out.content[0].text)
  }

  exports.testDecisionUtilityGatesAndFilters = function() {
    var agent = fixture()
    var settings = { useutils: true, usedecide: true, utilsallow: "decide" }
    ;[false, true].forEach(function(std) {
      var cfg = agent._createUtilsMcpConfig(merge(settings, { usestdutils: std }))
      ow.test.assert(Object.keys(cfg.options.fns).join(","), "decide", "Tool exposed in ordinary and standard utilities")
      ow.test.assert(agent._createUtilsMcpConfig(merge(settings, { usestdutils: std, utilsdeny: "decide" })), __, "Deny wins")
    })
    ow.test.assert(agent._createUtilsMcpConfig(merge(settings, { usedecide: false })), __, "Explicit opt-out hides utility")
    ow.test.assert(agent._createUtilsMcpConfig({ useutils: true, utilsallow: "decide" }), __, "Tool requires explicit usedecide=true")
    ow.test.assert(agent._createUtilsMcpConfig(merge(settings, { useutils: false })), __, "Decision configuration alone never enables utility")
    agent._decision = new MiniADecision({ env: function() { return __ } })
    ow.test.assert(agent._createUtilsMcpConfig(settings), __, "Missing model hides tool")
    agent._decision = new MiniADecision({ env: function() { return "broken" } })
    ow.test.assert(agent._createUtilsMcpConfig(settings), __, "Invalid model hides tool without exposing configuration")
    ow.test.assert(new MiniUtilsTool({}).decide(request).error, "MINI_A_DECISION_NOT_CONFIGURED", "Standalone utilities do not implicitly initialize decisions")
  }

  exports.testDecisionUtilityBatchUsageAndNoCache = function() {
    var calls = 0, before = 0, tokens = 0
    var agent = fixture(function(state, questions, options) {
      calls++
      ow.test.assert(Object.keys(questions).length, 2, "One call evaluates both questions")
      ow.test.assert(isUnDef(options), true, "No provider overrides forwarded")
      return { response: { answers: { team: { type: "choice", value: "billing" }, urgent: { type: "boolean", value: false } } }, stats: { total_tokens: 11 } }
    })
    agent._decisionToolControls = { beforeCall: function() { before++ }, afterCall: function(value) { tokens += value } }
    var cfg = agent._createUtilsMcpConfig({ useutils: true, usedecide: true, utilsallow: "decide" })
    var answer = call(cfg, request)
    ow.test.assert(answer.response.answers.team.value, "billing", "Typed answer preserved")
    call(cfg, request)
    ow.test.assert(calls, 2, "Repeated requests are fresh calls")
    ow.test.assert(before, 2, "Run rate limiter sees each call")
    ow.test.assert(tokens, 22, "Run rate limiter receives token usage")
    ow.test.assert(agent._decisionMetrics.calls, 2, "Existing decision metrics count utility calls")
    ow.test.assert(agent._decisionMetrics.total_tokens, 22, "Decision usage counted once")
    ow.test.assert(agent._computeToolCacheSettings(cfg.options.fnsMeta.decide, 10000).enabled, false, "Read-only decision is explicitly noncacheable")
  }

  exports.testDecisionUtilityBudgetsAndReset = function() {
    var calls = 0, agent = fixture(function() { calls++; return { response: { answers: {} }, stats: {} } })
    var settings = { useutils: true, usedecide: true, utilsallow: "decide" }
    var cfg = agent._createUtilsMcpConfig(settings)
    var run = agent._createDecisionToolRunner(settings)
    var large = merge(request, { state: "é".repeat(25000) })
    ow.test.assert(run(large).error, "MINI_A_DECISION_REQUEST_BUDGET", "UTF-8 byte budget enforced")
    var many = {}
    for (var i = 0; i < 33; i++) many["q" + i] = request.questions.urgent
    ow.test.assert(run({ state: "ticket", questions: many }).error, "MINI_A_DECISION_REQUEST_BUDGET", "Question cap enforced")
    ow.test.assert(run(merge(request, { options: { model: "override" } })).error, "LLM_DECISION_INVALID_REQUEST", "Provider options rejected")
    ow.test.assert(calls, 0, "Rejected requests make no provider call")
    for (var j = 0; j < 32; j++) call(cfg, request)
    var again = agent._createUtilsMcpConfig(settings)
    ow.test.assert(call(again, request).error.indexOf("MINI_A_DECISION_TOOL_LIMIT") >= 0, true, "Rebuilding tool config cannot reset quota")
    ow.test.assert(calls, 32, "No 33rd provider call")
    // Exercise the public run boundary with an isolated outer-loop stub.
    agent._beginRun = function() {}
    agent._runOuterLoop = function() { return "fixture run" }
    agent._finishRun = function() {}
    agent._finalizeRunMemory = function() {}
    ow.test.assert(agent.start({}), "fixture run", "Public start resets consultation quota")
    call(again, request)
    ow.test.assert(calls, 33, "Next run can consult again")
  }

  exports.testDecisionUtilityErrorsNoFallbackAndCurrentGate = function() {
    var calls = 0, agent = fixture(function() { calls++; throw { code: "LLM_DECISION_PROVIDER_ERROR", status: 429, message: "SECRET provider payload" } })
    var settings = { useutils: true, usedecide: true, utilsallow: "decide" }
    var cfg = agent._createUtilsMcpConfig(settings)
    var out = call(cfg, request)
    ow.test.assert(out.error.indexOf("LLM_DECISION_PROVIDER_ERROR") >= 0, true, "Sanitized error reaches registered wrapper")
    ow.test.assert(stringify(out).indexOf("SECRET"), -1, "Provider payload never disclosed")
    ow.test.assert(calls, 1, "No retry or fallback")
    ow.test.assert(agent._decisionMetrics.failures, 1, "Existing failure metrics updated")
    agent._initDecisionRuntime({ usedecide: false })
    ow.test.assert(call(cfg, request).error.indexOf("MINI_A_DECISION_NOT_CONFIGURED") >= 0, true, "Old tool callback cannot bypass a current opt-out")
    ow.test.assert(calls, 1, "Opt-out makes no provider call")
  }
})()
