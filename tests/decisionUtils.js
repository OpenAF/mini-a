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

  exports.testDecisionUtilityValidationGuidanceAndRecovery = function() {
    var calls = 0, agent = fixture(function() { calls++; return { response: { answers: {} }, stats: {} } })
    var cfg = agent._createUtilsMcpConfig({ useutils: true, usedecide: true, utilsallow: "decide" })
    var first = call(cfg, { question: "Which command?", evidence: "PRIVATE EVIDENCE", model: "override" })
    ow.test.assert(first.error.indexOf("state") >= 0, true, "First captured failure identifies the required evidence field")
    var invalid = [
      { value: { state: "Evidence", questions: [{ question: "Which command?" }] }, hint: "object keyed by question ID" },
      { value: { state: 42, questions: request.questions }, hint: "state: Expected nonempty text" },
      { value: { state: "Evidence", questions: {} }, hint: "at least one named question" },
      { value: { state: "Evidence", questions: { q: { question: "Which?" } } }, hint: "Only type, instructions and criteria" },
      { value: { state: "Evidence", questions: { q: { type: "choice", instructions: "Choose" } } }, hint: "at least two named choices" },
      { value: { state: "Evidence", questions: { q: { type: "score", instructions: "Rate", criteria: ["Only one"] } } }, hint: "ordered array" },
      { value: { state: "Evidence", questions: { q: { type: "boolean", instructions: "Relevant?", criteria: { yes: "Yes", no: "No" } } } }, hint: "exactly false and true" },
      { value: { state: "Evidence", questions: { q: { type: "choice", instructions: "Choose", choices: { a: "A", b: "B" } } } }, hint: "questions.q.choices: Unknown field choices; use criteria" },
      { value: { state: "PRIVATE EVIDENCE", questions: { q: { type: "choice", instructions: "Choose", criteria: { a: { description: "PRIVATE DESCRIPTION" }, b: "B" } } } }, hint: "questions.q.criteria.a: Each choice needs a nonempty ID and a nonempty string value" }
    ]
    invalid.forEach(function(item) {
      var out = call(cfg, item.value)
      ow.test.assert(out.error.indexOf("LLM_DECISION_INVALID_REQUEST") >= 0, true, "Stable error code")
      ow.test.assert(out.error.indexOf(item.hint) >= 0, true, "Actionable validation reason survives the utility wrapper")
      ow.test.assert(out.error.length < 760, true, "Feedback is bounded")
      ow.test.assert(out.error.indexOf("PRIVATE"), -1, "Feedback does not echo evidence or values")
    })
    ow.test.assert(calls, 0, "Invalid requests do not call the provider")
    var run = agent._createDecisionToolRunner({ useutils: true, usedecide: true })
    var rejected = run(invalid[0].value)
    var corrected = { state: "Evidence", questions: rejected.validation.issues[0].example }
    MiniADecision.validateConsultation(corrected)
    call(cfg, corrected)
    var choiceError = run(invalid[4].value)
    ow.test.assert(isString(choiceError.validation.issues[0].example.first), true, "Missing choice criteria gets a choice example")
    ow.test.assert(stringify(choiceError).indexOf('"boolean"'), -1, "Choice correction does not inject unrelated boolean examples")
    call(cfg, request)
    call(cfg, { state: "Evidence", questions: { impact: { type: "score", instructions: "Rate impact", criteria: ["Low", "High"] } } })
    ow.test.assert(calls, 3, "Corrected boolean, choice batch and score requests reach the provider")
  }

  exports.testDecisionUtilityProxySchemaAndErrors = function() {
    var agent = fixture(), cfg = agent._createUtilsMcpConfig({ useutils: true, usedecide: true, utilsallow: "decide" })
    ;[false, true].forEach(function(toon) {
      var proxy = agent._createMcpProxyConfig([cfg], { mcpproxytoon: toon, mcpproxythreshold: 100000 })
      try {
        var dispatch = proxy.options.fns["proxy-dispatch"]
        var schema = dispatch({ action: "search", query: "decide", format: "detail", includeInputSchema: true })
        ow.test.assert(stringify(schema).indexOf("inputSchema") >= 0, true, "Documented discovery request retrieves schema")
        var out = dispatch({ action: "call", tool: "decide", arguments: { state: "Evidence", questions: [{ question: "Which?" }] } })
        ow.test.assert(out.resultFormat, toon ? "toon" : "json", "Exercise both serialization formats")
        ow.test.assert(out.error.indexOf("object keyed by question ID") >= 0, true, "Proxy error retains local validation detail")
        ow.test.assert(stringify(out.content).indexOf("Example:") >= 0, true, "Inline content retains guidance under JSON/TOON")
        ow.test.assert(out.content[0].text.split("Invalid arguments:").length, 2, "Proxy serializes feedback once")
      } finally { MiniA._destroyMcpProxyConnections(agent._id) }
    })
  }

  exports.testDecisionSkillAvailabilityAndLoading = function() {
    ;[false, true].forEach(function(std) {
      var agent = fixture(), settings = { useskills: true, useutils: true, usedecide: true, usestdutils: std }
      agent._agentState = {}; agent._runtime = { context: [] }
      agent._getPluginsDiscovery = function() { return { skillsRoots: [] } }
      agent._resetSkillRuntime(settings)
      agent._createUtilsMcpConfig(settings)
      var available = function() { return agent._skillUtils._listSkills({}).some(function(s) { return s.name === "mini-a-decisions" }) }
      ow.test.assert(available(), true, "Decision skill discovered under both utility naming modes")
      agent._consultSkillsForRun(merge(settings, { skillsautosearch: false, goal: "$local:mini-a-decisions" }))
      var record = agent._skillRuntime.records["local:mini-a-decisions"]
      ow.test.assert(record.state, "active", "Explicit decision skill activation succeeds")
      ow.test.assert(record.content.indexOf('"most_dangerous"') >= 0, true, "Rendered skill includes complete choice example")
      agent._createUtilsMcpConfig(merge(settings, { utilsdeny: "decide" }))
      ow.test.assert(available(), false, "Denied tool hides decision skill")
      agent._createUtilsMcpConfig(merge(settings, { usedecide: false }))
      ow.test.assert(available(), false, "Disabled decision utility hides skill")
      agent._decision = new MiniADecision({ env: function() { return __ } })
      agent._createUtilsMcpConfig(settings)
      ow.test.assert(available(), false, "Missing decision model hides skill")
    })
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
    var calls = 0, agent = fixture(function() { calls++; throw { code: "LLM_DECISION_PROVIDER_ERROR", status: 429, message: "SECRET provider payload", validationMessage: "SECRET forged validation" } })
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

  exports.testDecisionUtilityFailureReleasesLimiter = function() {
    var agent = fixture(function() { throw { code: "LLM_DECISION_PROVIDER_ERROR", status: 429, message: "SECRET" } })
    var limiter = agent._createRateLimiter({ tpm: 100 }), completed = [], admitted = 0
    agent._decisionToolControls = {
      beforeCall: function() { limiter.beforeCall(); admitted++ },
      afterCall: function(tokens) { completed.push(tokens); limiter.afterCall(tokens) }
    }
    var run = agent._createDecisionToolRunner({ useutils: true, usedecide: true })
    var result = run(request)
    ow.test.assert(result.error, "LLM_DECISION_PROVIDER_ERROR", "Provider failure remains sanitized")
    ow.test.assert(result.status, 429, "HTTP status preserved")
    ow.test.assert(completed.length, 1, "Failed call releases limiter exactly once")
    ow.test.assert(completed[0], 0, "Failed call records zero tokens")
    ow.test.assert(limiter.tryBeforeCall(), true, "Optional decisions remain available after failure")
    limiter.afterReservedCall(0)
    agent._decisionToolControls.beforeCall = function() { throw new Error("Admission failed") }
    run(request)
    ow.test.assert(completed.length, 1, "No cleanup for failed admission")
    ow.test.assert(admitted, 1, "Only one request was admitted")
  }
})()
