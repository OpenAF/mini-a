(function() {
  load("mini-a.js")
  load("mini-a-subtask.js")
  var assert = function(actual, expected, text) { ow.test.assert(actual, expected, text) }
  var throws = function(fn) { var caught = false; try { fn() } catch(e) { caught = true }; assert(caught, true, "Must fail closed") }
  var withFixture = function(fn) {
    var root = String(java.nio.file.Files.createTempDirectory("mini-a-supervised-")), agent = new MiniA()
    agent.fnI = function() {}
    agent._agentState = {}
    agent._runtime = { context: [] }
    agent._oaf_model = { type: "openai", model: "main-fixture" }
    agent._oaf_lc_model = { type: "openai", model: "lc-fixture" }
    agent.mcpTools = []
    var args = { goal: "Verify the report.", modelstrategy: "supervised", homedir: root, contractargs: root + "/report.json", usedecide: false }
    io.writeFileString(root + "/report.json", '{"ok":true}')
    var s = new MiniASupervised(agent, args)
    agent._supervised = s
    var contract = { schema: MiniASupervised.schema, id: "report", revision: 1, goal: args.goal, constraints: ["Read only"],
      scope: { workspace: s.workspace }, requirements_hash: s.requirementsHash(),
      inputs: { report: { position: 1, kind: "file", required: true, variability: "variable" } },
      capabilities: ["artifact-read"], preconditions: [], assumptions: [], steps: [{ id: "S1", section: "Inspect" }],
      criteria: [{ id: "C1", requirement: "Report ok is true" }],
      checks: [{ id: "K1", criterion: "C1", method: "assertion", source: { input: "report", format: "json" },
        assertion: { path: "result.ok", equals: true }, required_evidence: ["report"], mandatory: true }],
      escalation: { local_repairs: 2 }, instructions: "# Report\n\n## Inspect\nRead {{arg1}} and verify ok.\n" }
    agent._supervisedClientFactory = function(config, role, purpose) { return { promptJSONWithStats: function() {
      return { response: purpose === "planning" ? { contract: clone(contract) } : { applicable: true, checks: [{ id: "K1", outcome: "met" }] }, stats: { tokens: { prompt: 5, completion: 2, total: 7 } } }
    } } }
    try { fn(s, contract, root, agent, args) }
    finally {
      var remove = function(file) { var list = file.isDirectory() ? file.listFiles() : null; for (var i = 0; list !== null && i < list.length; i++) remove(list[i]); file.delete() }
      remove(new java.io.File(root))
    }
  }
  exports.testStrategyAndConflicts = function() {
    var a = new MiniA()
    assert(a._normalizeModelStrategy("supervised"), "supervised", "Recognize opt-in strategy")
    assert(a._normalizeModelStrategy("delegate"), "delegate", "Keep delegate semantics")
    ;["modellock", "useplanning", "chatbotmode", "outerloop", "deepresearch", "usedelegation", "planmode"].forEach(function(key) {
      var args = { modelstrategy: "supervised" }; args[key] = key === "modellock" ? "lc" : key === "useplanning" ? false : true
      throws(function() { a._validateSupervisedArgs(args) })
    })
    throws(function() { a._validateSupervisedArgs({ savecontract: true }) })
    var args = { modelstrategy: "supervised" }; a._validateSupervisedArgs(args)
    assert(args.useplanning, true, "Unspecified planning enabled")
    a._preparePlanning(args)
    assert(a._enablePlanning, true, "Trivial goals keep contract planning")
  }
  exports.testAutoStrategyHandlesContractOptions = function() {
    var a = new MiniA()
    a.fnI = function() {}
    a._use_lc = true
    assert(a._normalizeModelStrategy("auto"), "auto", "Recognize auto strategy")
    var args = { modelstrategy: "auto", goal: "Verify the report.", contractargs: "report.json", usedecide: false }
    a._validateSupervisedArgs(args)
    a._resolveModelStrategy(args, { goal: args.goal, modelstrategy: "auto", contractargs: "report.json" })
    assert(args.modelstrategy, "supervised", "Contract options select supervised")
    assert(args.useplanning, true, "Resolved supervised forces planning")
    assert(a._supervisedConflicts({ chatbotmode: true, modellock: "lc" }).length, 2, "Conflict helper lists every conflict")
    var conflicting = { modelstrategy: "auto", goal: "Verify the report.", contractargs: "report.json", chatbotmode: true, usedecide: false }
    throws(function() { a._resolveModelStrategy(conflicting, { goal: conflicting.goal, modelstrategy: "auto" }) })
  }
  exports.testAutoStrategyResumesSupervisedRun = function() {
    var root = String(java.nio.file.Files.createTempDirectory("mini-a-auto-resume-"))
    try {
      io.mkdir(root + "/run-1")
      io.writeFileString(root + "/run-1/state.json", stringify({ supervised: { contract: {} }, status: "running" }, __, ""))
      var a = new MiniA()
      a.fnI = function() {}
      a._use_lc = true
      var args = { modelstrategy: "auto", goal: "Anything", resumerun: "run-1", runroot: root, usedecide: false }
      a._resolveModelStrategy(args, { goal: args.goal, modelstrategy: "auto" })
      assert(args.modelstrategy, "supervised", "Resuming a supervised run keeps supervised")
    } finally {
      var remove = function(file) { var list = file.isDirectory() ? file.listFiles() : null; for (var i = 0; list !== null && i < list.length; i++) remove(list[i]); file.delete() }
      remove(new java.io.File(root))
    }
  }
  exports.testAutoStrategyForwardsToSubtasks = function() {
    var manager = new SubtaskManager({ modelstrategy: "advisor", __modelstrategyrequested: "auto" }, {})
    var inherited = manager._buildChildArgs({ goal: "child goal", args: {}, depth: 1, parentId: "parent" })
    assert(inherited.modelstrategy, "auto", "Children of an auto run resolve for their own goal")
    var explicit = manager._buildChildArgs({ goal: "child goal", args: { modelstrategy: "delegate" }, depth: 1, parentId: "parent" })
    assert(explicit.modelstrategy, "delegate", "An explicit child strategy is kept")
    manager.destroy()
    var plain = new SubtaskManager({ modelstrategy: "advisor" }, {})
    assert(plain._buildChildArgs({ goal: "child goal", args: {}, depth: 1, parentId: "parent" }).modelstrategy, "advisor", "Non-auto parents keep inheritance unchanged")
    plain.destroy()
  }
  exports.testSchemaAndMarkdown = function() { withFixture(function(s, c) {
    assert(s.hash(s.parse(s.render(c))), s.hash(c), "Markdown preserves exact meaningful content")
    var invalid = clone(c); invalid.schema = "mini-a.contract/v2"; throws(function() { s.validate(invalid) })
    invalid = clone(c); invalid.checks = []; throws(function() { s.validate(invalid) })
    invalid = clone(c); invalid.checks[0].mandatory = false; throws(function() { s.validate(invalid) })
    invalid = clone(c); invalid.checks[0].id = "C1"; throws(function() { s.validate(invalid) })
    throws(function() { s.parse("---\ninvalid: [\n---\ntext") })
  }) }
  exports.testPlanRoundTrips = function() { withFixture(function(s, c, root, a) {
    c.instructions += "x".repeat(4000)
    var plan = { version: 3, goal: c.goal, steps: [{ id: 1, task: "Inspect", status: "done" }], contract: c }
    ;["markdown", "json", "yaml"].forEach(function(format) {
      var text = a._convertPlanObject(plan, format), parsed = a._loadPlanContent(text, format)
      assert(s.hash(parsed.plan.contract), s.hash(c), "Contract survives " + format)
      assert(s.hash(a._importPlanForExecution(parsed).plan.contract), s.hash(c), "Contract survives import " + format)
    })
  }) }
  exports.testColdPreparation = function() { withFixture(function(s, c, root, a) {
    s.prepare()
    assert(s.metrics.planning_calls, 1, "Cold preparation uses main exactly once")
    assert(a._agentState.plan.contract.goal, c.goal, "Contract installed in existing plan")
    assert(s.boundInstructions.indexOf(root + "/report.json") >= 0, true, "Existing positional bindings reused")
  }) }
  exports.testDeterministicBeforeReview = function() { withFixture(function(s, c, root, a) {
    s.install(c)
    io.writeFileString(root + "/report.json", '{"ok":false}')
    assert(s.verify("done").accepted, false, "Incorrect artifact rejected")
    assert(s.results[0].outcome, "unmet", "Explicit failure outcome")
    assert(s.metrics.review_calls, 0, "No model judgment before failed deterministic check")
    io.rm(root + "/report.json")
    assert(s.verify("done").accepted, false, "Missing evidence rejected")
    assert(s.results[0].outcome, "insufficient_evidence", "Missing is not success")
  }) }
  exports.testGenerativeAcceptanceAndSave = function() { withFixture(function(s, c, root, a, args) {
    s.install(c)
    assert(s.verify("The report is ok.").accepted, true, "Configured review accepts current evidence")
    s.save()
    assert(io.fileExists(s.store), false, "Save disabled creates no store")
    args.savecontract = true
    s.save()
    assert(s.metrics.saves, 1, "Only accepted contracts saved")
    var item = s.candidates()[0]
    assert(s.validated(item.contract), true, "Saved content association is valid")
    assert(item.contract.provenance.acceptance_kind, "mixed", "Acceptance records actual criterion methods")
    assert(s.metrics.review_calls, 1, "Saving does not add main review")
    assert(s.render(item.contract).indexOf("The report is ok."), -1, "No stale final answer persisted")
  }) }
  exports.testReuseFreshEvidenceAndEdits = function() { withFixture(function(s, c, root, a, args) {
    s.install(c); s.verify("ok"); args.savecontract = true; s.save()
    var path = s.candidates()[0].path
    args.contractfile = path; args.savecontract = false
    var next = new MiniASupervised(a, args); a._supervised = next; next.prepare()
    assert(next.metrics.initial_generation_skipped, true, "Valid reuse skips generation")
    assert(next.metrics.review_calls, 0, "Valid reuse skips unconditional critique")
    assert(next.results.length, 0, "Historical outcomes reset")
    assert(a._agentState.plan.steps[0].status, "pending", "Historical done reset")
    io.writeFileString(root + "/report.json", '{"ok":false}')
    assert(next.verify("old success").accepted, false, "Current failure beats history")
    io.writeFileString(root + "/report.json", '{"ok":true}')
    var edited = next.parse(next.read(path).value); edited.instructions += "Human edit\n"
    assert(next.validated(edited), false, "Human edit invalidates content association")
    io.writeFileString(path, next.render(edited))
    var candidate = new MiniASupervised(a, args); a._supervised = candidate; candidate.prepare()
    assert(candidate.metrics.hits, 0, "Edited instructions are not a cache hit")
    assert(candidate.metrics.planning_calls, 1, "Edited candidate gets main preparation")
    assert(io.readFileString(path).indexOf("Human edit") >= 0, true, "User edits preserved")
  }) }
  exports.testApplicabilityAndBindings = function() { withFixture(function(s, c, root, a, args) {
    s.install(c)
    var wrong = clone(c); wrong.scope.workspace = root
    assert(s.applicability(wrong).reason, "wrong_scope", "Reject wrong workspace")
    wrong = clone(c); wrong.goal = c.goal.toLowerCase()
    assert(s.applicability(wrong).reason, "goal_mismatch", "Preserve meaningful case")
    args.rules = "New constraint"
    assert(s.applicability(c).reason, "requirements_changed", "Cover current constraints")
    delete args.rules
    args.contractargs = ""
    assert(s.applicability(c).reason, "input_binding", "Missing bindings rejected")
  }) }
  exports.testAtomicAndAccess = function() { withFixture(function(s, c, root, a) {
    var path = root + "/new/CONTRACT.md"
    s.atomic(path, "human")
    throws(function() { s.atomic(path, "replace") })
    assert(io.readFileString(path), "human", "Never overwrite existing content")
    s.access = new MiniAFileAccess([root + "/report.json"])
    throws(function() { s.atomic(root + "/denied/CONTRACT.md", "x") })
    assert(io.fileExists(root + "/denied"), false, "Denied path never created")
  }) }
  exports.testToolProvenanceAndCache = function() { withFixture(function(s, c, root) {
    c.checks[0].method = "tool-result"
    c.checks[0].source = { tool: "run_test", params: {} }
    c.checks[0].artifacts = [{ input: "report" }]
    c.checks[0].assertion = { path: "result.exitcode", equals: 0 }
    s.install(c)
    assert(s.verify("done").accepted, false, "Stale log alone is not tool proof")
    s.observe("run_test", {}, { exitcode: 0 }, false, true)
    assert(s.verify("done").accepted, false, "Cached test is insufficient")
    s.observe("run_test", {}, { exitcode: 0 }, false, false)
    assert(s.verify("done").accepted, true, "Current successful test and artifact accepted")
    io.writeFileString(root + "/report.json", '{"ok":false}')
    assert(s.verify("done").accepted, false, "Changed artifact invalidates tool proof")
  }) }
  exports.testResumeLosslessAndBudgets = function() { withFixture(function(s, c, root, a, args) {
    c.instructions += "x".repeat(4500); s.install(c); s.interventions = 2; s.decisionCalls = 7; s.takeover = 1; s.progress({ steps: [{ id: 1, status: "done" }] })
    var saved = s.checkpoint(), resumed = new MiniASupervised(a, args, {}, saved)
    a._supervised = resumed; resumed.prepare()
    assert(resumed.hash(resumed.contract), s.hash(c), "Resume contract not truncated")
    assert(resumed.interventions, 2, "Intervention budget preserved")
    assert(resumed.decisionCalls, 7, "Decision budget preserved")
    assert(resumed.results.length, 0, "Resume acceptance reset")
    assert(a._agentState.plan.steps[0].status, "done", "Resume retains progress as a hint")
    assert(resumed.takeover, 1, "Resume retains bounded segment remainder")
    assert(resumed.epoch !== s.epoch, true, "New evidence epoch")
    resumed.intervene("review", {})
    throws(function() { resumed.intervene("question", {}) })
    args.contractargs = "changed"
    throws(function() { new MiniASupervised(a, args, {}, saved).prepare() })
  }) }
  exports.testForcedFinalCannotSucceed = function() { withFixture(function(s, c, root, a, args) {
    s.install(c)
    var before = global.__mini_a_metrics.goals_achieved.get()
    var answer = a._processFinalAnswer("LC says done", args)
    assert(answer.indexOf("incomplete") >= 0, true, "Unverified final reports incomplete")
    assert(global.__mini_a_metrics.goals_achieved.get(), before, "Incomplete final does not increment success")
    assert(s.metrics.saves, 0, "Incomplete final cannot promote")
  }) }
  exports.testActualExecutorColdAndWarm = function() { withFixture(function(s, c, root, a, args) {
    args.model = stringify({ type: "ollama", model: "supervised-fixture-main", key: "fixture", url: "http://127.0.0.1:1" })
    args.modellc = stringify({ type: "ollama", model: "supervised-fixture-lc", key: "fixture", url: "http://127.0.0.1:1" })
    args.useshell = false; args.usetools = false; args.useutils = false; args.raw = true; args.maxtotalsteps = 3; args.usestream = true
    args.savecontract = true
    a.init(args)
    var executorCalls = 0
    a._prepareContextInvocation = function(client, prompt) { return prompt }
    a.llm.promptJSONWithStats = a.llm.promptWithStats = function() { throw new Error("Main must not execute ordinary steps") }
    a.lc_llm.promptJSONWithStats = a.lc_llm.promptWithStats = function() {
      executorCalls++
      return { response: { action: "final", answer: "The report is ok.", state: { plan: { contract: { checks: [] } } } }, stats: {} }
    }
    try {
      assert(a.start(args), "The report is ok.", "Real loop accepts reviewed result")
      assert(executorCalls, 1, "LC executes the first turn")
      assert(a._supervised.metrics.planning_calls, 1, "Main prepares cold contract")
      assert(a._supervised.metrics.review_calls, 1, "Main reviews acceptance")
      assert(a._agentState.plan.contract.checks.length, 1, "LC cannot erase required checks")
      var file = a._supervised.candidates()[0].path
      var warmArgs = merge({}, args); warmArgs.contractfile = file; warmArgs.savecontract = false
      assert(a.start(warmArgs), "The report is ok.", "Warm run uses existing executor")
      assert(a._supervised.metrics.planning_calls, 0, "Warm run skips main generation")
      assert(a._supervised.metrics.review_calls, 1, "Warm run obtains fresh review")
      assert(a._supervised.results.length, 1, "Warm run checks fresh evidence")
      io.writeFileString(root + "/report.json", '{"ok":false}')
      var repairTurns = 0
      a.lc_llm.promptJSONWithStats = a.lc_llm.promptWithStats = function() {
        repairTurns++
        if (repairTurns === 2) io.writeFileString(root + "/report.json", '{"ok":true}')
        return { response: { action: "final", answer: "The report is ok." }, stats: {} }
      }
      assert(a.start(warmArgs), "The report is ok.", "Failed current evidence resumes the same LC loop")
      assert(repairTurns, 2, "LC gets a bounded repair turn")
      assert(a._supervised.metrics.lc_repair_calls, 1, "Actual repair dispatch counted")
      assert(a._supervised.metrics.planning_calls, 0, "Transient execution failure keeps reusable contract")
      var stoppedArgs = merge({}, warmArgs); stoppedArgs.maxtotalsteps = 1
      io.writeFileString(root + "/report.json", '{"ok":false}')
      a.lc_llm.promptJSONWithStats = a.lc_llm.promptWithStats = function() { return { response: { action: "final", answer: "done" }, stats: {} } }
      var beforeStopped = global.__mini_a_metrics.goals_achieved.get()
      assert(a.start(stoppedArgs).indexOf("incomplete") >= 0, true, "Execution limit cannot bypass acceptance")
      assert(a._supervised.accepted, false, "Budget exhaustion is not completion")
      assert(global.__mini_a_metrics.goals_achieved.get(), beforeStopped, "Forced final does not increment success")
    } finally { a._stopAgentResources() }
  }) }
  exports.testDecisionFailureFallsBackAndSelectiveAcceptance = function() { withFixture(function(s, c, root, a, args) {
    args.usedecide = true
    c.criteria.push({ id: "C2", requirement: "Answer agrees with report" })
    c.checks.push({ id: "K2", criterion: "C2", method: "semantic", rubric: "Answer confirms ok without inventing details", required_evidence: ["report", "final_answer"], mandatory: true })
    a._initDecisionRuntime(args)
    a._decision = { isConfigured: function() { return true }, decide: function() { throw new Error("provider unavailable") } }
    a._supervisedClientFactory = function(config, role, purpose) { return { promptJSONWithStats: function() {
      return { response: { applicable: true, checks: [{ id: "K1", outcome: "met" }, { id: "K2", outcome: "met" }] }, stats: {} }
    } } }
    s.install(c)
    assert(s.verify("ok").accepted, true, "Decision failure runs generative fallback")
    assert(s.metrics.review_calls, 1, "Fallback uses reviewer")
    assert(s.results[1].method, "generative-review", "Actual acceptance method recorded")
    var selective = new MiniASupervised(a, args); a._supervised = selective; selective.install(c)
    a._decision = { isConfigured: function() { return true }, decide: function() {
      a._decisionMetrics.calls++
      return { response: { answers: { verdict: { type: "choice", value: "met" } } }, stats: {} }
    } }
    a._decisionGateCache = {}
    assert(selective.verify("ok").accepted, true, "Selective policy accepts supported semantic evidence")
    assert(selective.metrics.review_calls, 0, "No unconditional generative review")
    assert(selective.metrics.decision_calls, 1, "Actual decision dispatch counted")
    assert(selective.results[1].method, "decision", "Provider capability not represented as probability")
  }) }
  exports.testAlreadySatisfiedAndChangedProof = function() { withFixture(function(s, c, root, a, args) {
    s.install(c); s.preflight()
    assert(s.alreadySatisfied, true, "Existing goal requires no repeated mutation")
    assert(a._runtime.finalAnswerOnly, true, "Executor requests synthesis")
    throws(function() { a._runCommand({ command: "true" }) })
    assert(s.verify("ok").accepted, true, "Existing evidence still reviewed")
    args.savecontract = true
    io.writeFileString(root + "/report.json", '{"ok":false}')
    s.save()
    assert(s.metrics.saves, 0, "Changed proof cannot be promoted")
    assert(s.currentAcceptance(), false, "Artifact version checked again at publication")
  }) }
  exports.testStableInputsDependenciesAndInvalidation = function() { withFixture(function(s, c, root, a, args) {
    c.inputs.report.variability = "stable"
    c.dependencies = [{ path: root + "/report.json", sha256: s.read(root + "/report.json").fingerprint }]
    s.install(c); s.verify("ok"); args.savecontract = true; s.save()
    var saved = s.candidates()[0].contract
    io.writeFileString(root + "/report.json", '{"ok":false}')
    assert(s.applicability(saved).reason, "dependency_changed", "Material dependencies reject reuse")
    delete saved.dependencies
    assert(s.applicability(saved).reason, "stable_input_changed", "Stable input must retain validated fingerprint")
    args.reusecontract = true
    s.contract = s.candidates()[0].contract
    s.invalidateContract("dependency_changed")
    assert(s.invalidated(s.contract), true, "Disproved assumptions get a rejection receipt")
  }) }
  exports.testBadReviewAndBoundedRepair = function() { withFixture(function(s, c, root, a, args) {
    s.install(c)
    a._supervisedClientFactory = function() { return { promptJSONWithStats: function() { return { response: { applicable: true, checks: [{ id: "K1", outcome: "met" }, { id: "K1", outcome: "met" }] } } } } }
    assert(s.verify("ok").accepted, false, "Duplicate verdicts cannot count as complete review")
    io.writeFileString(root + "/report.json", '{"ok":false}')
    var routes = 0
    s.route = function() { routes++; this.stopped = true; this.reason = "bounded blocker" }
    for (var i = 0; i < 8; i++) s.proposeFinal("done")
    assert(routes, 1, "Repeated local failure reaches bounded escalation")
    assert(s.accepted, false, "Escalation is not successful completion")
    assert(s.metrics.lc_repair_calls, 0, "Rejected proposals are not execution calls")
  }) }
  exports.testCurrentShellExitEvidence = function() { withFixture(function(s, c, root, a, args) {
    c.checks[0].method = "tool-result"
    c.checks[0].source = { tool: "shell", params: { command: "true" } }
    c.checks[0].artifacts = [{ input: "report" }]
    c.checks[0].assertion = { path: "result.exitcode", equals: 0 }
    s.install(c)
    s.observe("shell", { command: "true" }, { output: "old PASS", exitcode: 1 }, false, false)
    assert(s.verify("done").accepted, false, "Current failing exit status overrides historical output")
    s.observe("shell", { command: "true" }, { output: "PASS" }, false, false)
    assert(s.verify("done").accepted, false, "Missing exit status is not success")
  }) }
  exports.testVariableInputRebindingAndUnsafePersistence = function() { withFixture(function(s, c, root, a, args) {
    s.install(c); s.verify("ok"); args.savecontract = true; s.save()
    var path = s.candidates()[0].path
    args.contractfile = path; args.contractargs = root + "/today.json"
    io.writeFileString(root + "/today.json", '{"ok":false}')
    var next = new MiniASupervised(a, args); a._supervised = next; next.prepare()
    assert(next.metrics.initial_generation_skipped, true, "Parameterized input changes retain eligibility")
    assert(next.verify("old result").accepted, false, "New input is resolved and checked")
    delete args.contractfile; args.contractargs = root + "/report.json"
    s.install(c); s.contract.instructions += root + "/report.json"
    assert(s.reusableBindings(s.contract), false, "Hardcoded variable input is not reusable")
    s.install(c); s.contract.instructions += " api_key=abcdefgh12345678"
    s.verify("ok")
    throws(function() { s.save() })
  }) }
  exports.testReviewedEvidenceAndExecutorBudget = function() { withFixture(function(s, c, root, a, args) {
    s.install(c)
    a._supervisedClientFactory = function() { return { promptJSONWithStats: function() {
      io.writeFileString(root + "/report.json", '{"ok":false}')
      return { response: { applicable: true, checks: [{ id: "K1", outcome: "met" }] } }
    } } }
    assert(s.verify("ok").accepted, false, "Changed evidence during review cannot pass")
    args.maxtotalsteps = 1
    s.executionCall("lc")
    throws(function() { s.executionCall("main") })
    assert(s.stopped, true, "Dispatch cap cannot be bypassed by retries or takeover")
    assert(s.metrics.lc_execution_calls, 1, "Only permitted actual dispatch counted")
    var checkpoint = s.checkpoint()
    assert(checkpoint.executedTurns, 1, "Consumed execution calls persisted")
  }) }
  exports.testMultipleCurrentTestsAndSchemaValidation = function() { withFixture(function(s, c, root, a) {
    c.criteria.push({ id: "C2", requirement: "Two current tests pass" })
    c.checks[0].method = "tool-result"; c.checks[0].source = { tool: "test_one", params: {} }
    c.checks[0].artifacts = [{ input: "report" }]; c.checks[0].assertion = { path: "result.exitcode", equals: 0 }
    c.checks.push({ id: "K2", criterion: "C2", method: "tool-result", source: { tool: "test_two", params: {} }, artifacts: [{ input: "report" }],
      assertion: { path: "result.exitcode", equals: 0 }, required_evidence: ["report"], mandatory: true })
    s.install(c)
    s.observe("test_one", {}, { exitcode: 0 }, false, false)
    s.observe("test_two", {}, { exitcode: 0 }, false, false)
    assert(s.check(c.checks[0], "ok").outcome, "met", "Independent current artifact-bound results coexist")
    assert(s.check(c.checks[1], "ok").outcome, "met", "Second test retains provenance")
    io.writeFileString(root + "/large.bin", "x".repeat(70000))
    c.checks[0].artifacts = [{ path: root + "/large.bin" }]
    s.install(c); s.observe("test_one", {}, { exitcode: 0 }, false, false)
    assert(s.source(c.checks[0].source, "").artifacts[0].fingerprint, s.fingerprint(root + "/large.bin").fingerprint, "Large artifacts use existing streaming hashing without entering review context")
    var k = { id: "K3", criterion: "C1", mandatory: true, method: "schema", source: { input: "report", format: "json" }, required_evidence: ["report"],
      schema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } } }
    assert(s.check(k, "ok").outcome, "met", "Existing OpenAF schema validator used")
  }) }
  exports.testBoundedReconnaissanceAndMissingEvidenceEscalation = function() { withFixture(function(s, c, root, a, args) {
    a.mcpTools = [{ name: "filesystemQuery", inputSchema: {} }, { name: "wiki", inputSchema: {} }]
    var retrievals = 0, evidenceDelivered = false
    a._executeParallelToolBatch = function(batch) { retrievals++; return [{ result: { raw: "exact source evidence" } }] }
    a._supervisedClientFactory = function(config, role, purpose) { return { promptJSONWithStats: function(prompt) {
      if (purpose === "reconnaissance") return { response: { actions: [{ tool: "filesystemQuery", params: { operation: "read", path: root + "/report.json" } },
        { tool: "wiki", params: { op: "read", path: "page.md" } }, { tool: "filesystemModify", params: {} }] } }
      if (purpose === "planning") { evidenceDelivered = prompt.indexOf("exact source evidence") >= 0; return { response: { contract: clone(c) } } }
      return { response: { action: "block", guidance: "Required output cannot be found" } }
    } } }
    s.prepare()
    assert(retrievals, 2, "Reconnaissance uses two existing readonly dispatches")
    assert(evidenceDelivered, true, "Main receives raw source evidence")
    assert(s.readOnly("filesystemModify", {}), false, "Reconnaissance cannot mutate")
    io.rm(root + "/report.json")
    assert(s.inputEvidence().report.unavailable, true, "Missing source can be described to main")
    assert(s.route({ reason: "missing_evidence" }), false, "External blocker is reported through bounded question")
    assert(s.stopped, true, "Unresolved blocker is never success")
  }) }
})()
