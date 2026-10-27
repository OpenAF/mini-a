(function() {
  load("mini-a.js")
  load("mini-a-subtask.js")
  var assert = function(actual, expected, message) { ow.test.assert(actual, expected, message) }
  var throws = function(fn) { var caught = false; try { fn() } catch(e) { caught = true }; assert(caught, true, "Must fail closed") }
  var task = function(id, dependencies, writes) { return { id: id, objective: "Return ready", dependencies: dependencies || [], resources: { reads: [], writes: writes || [] }, criteria: [{ id: "ready", requirement: "Return ready", method: "answer", assertion: { equals: "ready" } }] } }
  var fixture = function(fn) {
    var a = new MiniA()
    a.fnI = function() {}; a._recordRunEvent = function() {}; a._checkpointRun = function() {}
    a._execution = new MiniAExecution(); a._executionLock = genUUID(); a._lastStartArgs = { goal: "Return ready", orchestration: "auto" }
    a._runtime = { context: [] }; a._agentState = {}
    var m = new SubtaskManager(a._lastStartArgs, { parentAgent: a, maxConcurrent: 3 })
    a._subtaskManager = m
    m._startWatchdog = function() {}; m._startLocalSubtask = function() {}
    try { fn(a, m) } finally { m.destroy() }
  }
  exports.testProgressDeduplicatesAndBoundsRecovery = function() {
    var e = new MiniAExecution()
    assert(e.observe("tool", "read", "digest"), true, "New evidence progresses")
    assert(e.observe("tool", "read", "digest"), false, "Repeated successful reads do not progress")
    assert(e.tick(), "progress", "Evidence recognized")
    for (var i = 0; i < 3; i++) assert(e.tick(), "continue", "Allow active steps")
    assert(e.tick(), "recover", "Change strategy after four steps")
    for (var i = 0; i < 10; i++) assert(e.tick(true), "wait", "Waiting consumes no stagnation allowance")
    for (var i = 0; i < 4; i++) e.tick()
    for (var i = 0; i < 3; i++) e.tick()
    assert(e.tick(), "blocked", "Two recoveries bound an unchanged blocker")
  }
  exports.testDecisionAcceptanceAndFallback = function() { fixture(function(a) {
    var calls = 0, mode = "met"
    a._lastStartArgs = { goal: "Explain the documentation", orchestration: "auto", usedecide: true }
    a._runtime.toolsUsed = { readFile: 1 }
    a._runtime.executionReadEvidence = ["Documentation content"]
    a._decision = { _config: { type: "test", model: "test" }, bounded: function() { return { decide: function(state, questions) {
      calls++
      return { response: { answers: { v0: { type: "choice", value: mode }, e0: { type: "choice", value: "e0" } } }, stats: {} }
    } } } }
    var criterion = [{ id: "complete", method: "semantic", requirement: "Explain the documentation" }]
    var spec = { objective: a._lastStartArgs.goal, criteria: criterion }
    var checks = a._executionDecisionAcceptance(spec, "An explanation", ["[OBS 1] Documentation content"], criterion)
    assert(checks[0].outcome, "met", "Supported read-only result uses decision")
    a._executionDecisionAcceptance(spec, "An explanation", ["[OBS 1] Documentation content"], criterion)
    assert(calls, 1, "Unchanged decision is cached")
    mode = "insufficient"
    assert(a._executionDecisionAcceptance(spec, "Another answer", ["[OBS 1] Documentation content"], criterion), __, "Insufficient evidence falls back")
    a._runtime.executionReadEvidence = ["[TRUNCATED]"]
    assert(a._executionDecisionAcceptance(spec, "Another answer", ["[OBS 1] [TRUNCATED]"], criterion), __, "Truncated evidence is ineligible")
    a._runtime.toolsUsed = { shell: 1 }
    assert(a._executionDecisionAcceptance(spec, "Another answer", ["[OBS 1] Documentation content"], criterion), __, "Unknown or mutating tools are ineligible")
  }) }
  exports.testAcceptanceDecisionRequestHasValidSingleEvidenceChoice = function() { fixture(function(a) {
    a._lastStartArgs = { goal: "Explain the documentation", orchestration: "auto", usedecide: true }
    a._runtime.toolsUsed = { read: 1 }; a._runtime.executionReadEvidence = ["Documentation content"]
    a._decision = { _config: { type: "ollama", model: "fixture" } }
    a._orchestrationDecision = function(operation, args, state, questions, validate) {
      ow.loadAI()
      ow.ai.__decision.request(state, questions, {}, "fixture", "ollama")
      assert(Object.keys(questions.e0.criteria).length, 2, "One evidence item still has a valid abstention choice")
      var answers = { v0: { type: "choice", value: "met" }, e0: { type: "choice", value: "none" } }
      assert(validate(answers), true, "Abstention is a valid response")
      return answers
    }
    var criteria = [{ id: "complete", method: "semantic", requirement: "Explain the documentation" }]
    assert(a._executionDecisionAcceptance({ objective: a._lastStartArgs.goal }, "An explanation", [], criteria), __, "No-evidence choice falls back")
  }) }
  exports.testDecisionGateBudgetAndFailedCache = function() { fixture(function(a) {
    var calls = 0
    a._decision = { _config: { type: "test", model: "test" }, bounded: function() { return { decide: function() { calls++; throw new Error("failure") } } } }
    var args = { usedecide: true }, q = { x: { type: "boolean", instructions: "test" } }
    a._orchestrationDecision("test", args, { v: 1 }, q)
    a._orchestrationDecision("test", args, { v: 1 }, q)
    assert(calls, 1, "A failed identical decision is not retried")
    a._orchestrationDecision("test", args, { v: 2 }, q)
    a._orchestrationDecision("test", args, { v: 3 }, q)
    assert(calls, 2, "Two failures disable the optional decisions")
    a._orchestrationGateState = __
    a._execution = new MiniAExecution({ tokens: 100 })
    a._orchestrationDecision("test", args, { v: 4 }, q)
    assert(calls, 2, "Budget admission avoids dispatch")
  }) }
  exports.testBoundedDecisionUsesFinalizationReserve = function() { fixture(function(a) {
    var receivedTimeout, calls = 0
    a._execution = new MiniAExecution({ tokens: 10000 })
    a._execution.state.budget.spent = 8000
    a._decision = new MiniADecision({ modeldec: { type: "fixture", model: "fixture", timeout: 2000 }, supportsBoundedRequests: true,
      clientFactory: function(config) { receivedTimeout = config.timeout; return {
        getCapabilities: function() { return {} },
        decideWithStats: function() { calls++; return { response: { answers: { x: { type: "boolean", value: true } } }, stats: { tokens: { total: 23 } } } }
      } } })
    var q = { x: { type: "boolean", instructions: "test" } }, args = { usedecide: true }
    assert(a._orchestrationDecision("normal", args, {}, q), __, "Normal work cannot use reserve")
    var result = a._orchestrationDecision("acceptance", args, {}, q, function(v) { return v.x.value === true }, true)
    assert(result.x.value, true, "Acceptance may use reserve")
    assert(receivedTimeout, 2000, "Shorter configured timeout is preserved")
    assert(calls, 1, "Only admitted request reaches provider")
    assert(a._execution.state.budget.spent, 8023, "Provider usage is settled once")
  }) }
  exports.testBudgetReservationAndSettlement = function() {
    var time = 0, e = new MiniAExecution({ tokens: 10000, time: 100, clock: function() { return time } })
    var id = e.reserve(6000, "child")
    throws(function() { e.reserve(3000, "other") })
    assert(e.available(true), 4000, "Integration reserve remains available")
    e.settle(id, 2000, false)
    assert(e.available(false), 6500, "Unused child allocation reclaimed")
    assert(e.settle(id, 5000), false, "Duplicate settlement cannot charge twice")
    time = 101
    throws(function() { e.reserve(1) })
  }
  exports.testDependencyAcceptanceAndInvalidation = function() {
    var e = new MiniAExecution()
    e.put(task("a")); e.put(task("b", ["a"]))
    assert(e.ready("b"), false, "Execution alone is not acceptance")
    e.finish("a", "partial", [{ id: "ready", outcome: "met" }])
    assert(e.ready("b"), false, "Partial work does not unblock")
    e.finish("a", "succeeded", [{ id: "ready", outcome: "met" }])
    assert(e.ready("b"), true, "Accepted predecessor unblocks")
    e.finish("b", "succeeded", [{ id: "ready", outcome: "met" }])
    e.put(task("a"))
    assert(e.state.tasks.b.acceptance, "pending", "Revision invalidates downstream evidence")
    var weak = task("a"); weak.criteria = []
    throws(function() { e.put(weak) })
    throws(function() { e.put(task("a", ["b"])) })
    assert(e.state.tasks.a.dependencies.length, 0, "Rejected cycle is atomic")
  }
  exports.testResourceScopesAndUnknownOwnership = function() {
    var e = new MiniAExecution()
    e.put(task("a", [], ["/repo/src"])); e.put(task("b", [], ["/repo/src/a.js"])); e.put(task("c", [], ["/repo/docs"]))
    e.state.tasks.a.status = "running"
    assert(e.canStart("b"), false, "Parent path overlaps child path")
    assert(e.canStart("c"), true, "Independent writes parallelize")
    e.state.tasks.a.status = "unknown"
    assert(e.canStart("b"), false, "Unknown remote outcomes retain resource ownership")
  }
  exports.testQueueSkipsBlockedDependencies = function() { fixture(function(a, m) {
    var first = m.submit("Return ready", {}, { task: task("a", [], ["/a"]) })
    var second = m.submit("Return ready", {}, { task: task("b", ["a"], ["/b"]) })
    var third = m.submit("Return ready", {}, { task: task("c", [], ["/c"]) })
    m._processQueue()
    assert(m.subtasks[first].status, "running", "Prerequisite starts")
    assert(m.subtasks[second].status, "pending", "Dependent waits without queue spin")
    assert(m.subtasks[third].status, "running", "Independent work starts")
    m._completeSubtask(m.subtasks[first], "test", "ready", {}, { execution: { outcome: "succeeded" } })
    m._processQueue()
    assert(m.subtasks[second].status, "running", "Accepted result releases dependency")
  }) }
  exports.testDecisionRanksOnlyReadyTies = function() { fixture(function(a, m) {
    a._lastStartArgs.usedecide = true; m.maxConcurrent = 1
    var first = m.submit("First", {}, { task: task("first", [], ["/first"]) })
    var second = m.submit("Second", {}, { task: task("second", [], ["/second"]) })
    a._orchestrationDecision = function() { return { task_0: { type: "score", level: 0 }, task_1: { type: "score", level: 2 } } }
    m._processQueue()
    assert(m.subtasks[second].status, "running", "Decision can rank equally ready tasks")
    assert(m.subtasks[first].status, "pending", "Remaining task waits for a slot")
  }) }
  exports.testDecisionQueueRankingDiscardedOnRevision = function() { fixture(function(a, m) {
    a._lastStartArgs.usedecide = true
    m.submit("First", {}, { task: task("first", [], ["/first"]) })
    m.submit("Second", {}, { task: task("second", [], ["/second"]) })
    a._orchestrationDecision = function() {
      a._execution.state.revision++
      return { task_0: { type: "score", level: 0 }, task_1: { type: "score", level: 2 } }
    }
    assert(Object.keys(m._decisionQueueRanks()).length, 0, "Stale ranking cannot be applied")
  }) }
  exports.testAutomaticBatchIsAtomic = function() { fixture(function(a, m) {
    a._execution.state.decomposition = { status: "planning" }
    var one = task("one", [], ["/repo/a"]), two = task("two", ["one"], ["/repo/b"])
    var ids = m.submitExecutionBatch([two, one], a._execution.state.revision)
    assert(ids.length, 2, "Forward dependency graph is registered")
    assert(a._execution.state.tasks.two.owner, ids[0], "Pending task has its owner")
    assert(m.subtasks[ids[0]].args.modelstrategy, "default", "Generated work does not automatically enable supervised strategy")
    m._processQueue()
    assert(m.subtasks[ids[0]].status, "pending", "Dependent waits for acceptance")
    assert(m.subtasks[ids[1]].status, "running", "Ready task starts")
  }) }
  exports.testAutomaticBatchRejectsCyclesAndDuplicates = function() { fixture(function(a, m) {
    a._execution.state.decomposition = { status: "planning" }
    throws(function() { m.submitExecutionBatch([task("a", ["b"]), task("b", ["a"])], 0) })
    assert(Object.keys(a._execution.state.tasks).length, 0, "Rejected graph leaves no tasks")
    assert(m.pendingQueue.length, 0, "Rejected graph leaves no queued work")
    throws(function() { m.submitExecutionBatch([task("a"), task("a")], 0) })
    assert(Object.keys(a._execution.state.tasks).length, 0, "Duplicate IDs leave no tasks")
  }) }
  exports.testAutomaticBatchRollsBackSubmissionFailure = function() { fixture(function(a, m) {
    a._execution.state.decomposition = { status: "attempted" }
    var submit = m.submit, calls = 0
    m.submit = function() { if (++calls === 2) throw new Error("injected submission failure"); return submit.apply(this, arguments) }
    throws(function() { m.submitExecutionBatch([task("a"), task("b", ["a"])], 0) })
    assert(Object.keys(a._execution.state.tasks).length, 0, "Failed submission rolls back the whole graph")
    assert(m.pendingQueue.length, 0, "Failed submission leaves no queued task")
    assert(Object.keys(m.subtasks).length, 0, "Failed submission removes staged subtask")
    assert(a._execution.state.decomposition.status, "attempted", "The one-attempt marker is retained")
  }) }
  exports.testAutomaticBatchResumeDoesNotReplayRunningTask = function() { fixture(function(a, m) {
    a._execution.state.decomposition = { status: "planning" }
    var ids = m.submitExecutionBatch([task("one"), task("two", ["one"])], a._execution.state.revision)
    m._processQueue()
    var saved = a._execution.snapshot()
    assert(m.subtasks[ids[0]].status, "running", "First task was handed off")
    a._execution = new MiniAExecution({}, saved)
    var resumed = new SubtaskManager(a._lastStartArgs, { parentAgent: a, maxConcurrent: 3 })
    resumed._startWatchdog = function() {}; resumed._startLocalSubtask = function() {}
    try {
      a._subtaskManager = resumed
      resumed._restoreExecutionTasks()
      assert(a._execution.state.tasks.one.status, "unknown", "Running task requires reconciliation")
      assert(a._execution.state.tasks.two.status, "pending", "Undispatched dependent remains pending")
      assert(resumed.pendingQueue.length, 1, "Only the undispatched task is requeued")
      resumed._processQueue()
      assert(resumed.subtasks[resumed.pendingQueue[0]].taskId, "two", "Dependent cannot bypass unknown prerequisite")
    } finally { resumed.destroy(); a._subtaskManager = m }
  }) }
  exports.testAutomaticDecompositionStagesAndFallsBack = function() { fixture(function(a, m) {
    var calls = 0, decisions = 0, goal = "Create a report and update the project files"
    a._oaf_model = { type: "fixture", model: "main" }
    a._decision = { _config: { type: "fixture", model: "decision" } }
    a._assessGoalComplexity = function() { return { level: "complex", signals: [] } }
    a._orchestrationDecision = function() { decisions++; return { useful: { type: "boolean", value: true } } }
    a._orchestrationPlannerFactory = function() { return { promptJSONWithStats: function() {
      calls++
      var first = task("first", [], ["/report"]), second = task("second", ["first"], ["/project"])
      first.covers = ["goal"]; second.covers = []
      return { response: { tasks: [first, second] }, stats: { tokens: { total: 5 } } }
    } } }
    var args = { goal: goal, usedecide: true, usedelegation: true, modelstrategy: "default" }
    assert(a._tryAutomaticDecomposition(merge(args, { goal: "Explain how to create a report and update files" })), __, "Question bypasses decomposition")
    var result = a._tryAutomaticDecomposition(args)
    assert(result.ids.length, 2, "Decision and main planner create a batch")
    assert(a._execution.state.decomposition.status, "scheduled", "Scheduled marker is durable state")
    assert(a._tryAutomaticDecomposition(args), __, "Unchanged goal is not planned twice")
    assert(decisions, 1, "One decision attempt")
    assert(calls, 1, "One main planning call")
    assert(a._execution.state.budget.spent, 5, "Planning usage enters aggregate accounting")
  }) }
  exports.testAutomaticDecompositionInvalidProposalLeavesNoTasks = function() { fixture(function(a, m) {
    a._oaf_model = { type: "fixture", model: "main" }; a._decision = { _config: { type: "fixture", model: "decision" } }
    a._assessGoalComplexity = function() { return { level: "complex", signals: [] } }
    a._orchestrationDecision = function() { return { useful: { type: "boolean", value: true } } }
    a._orchestrationPlannerFactory = function() { return { promptJSONWithStats: function() {
      var first = task("first", ["second"]), second = task("second", ["first"])
      first.covers = ["goal"]; second.covers = []
      return { response: { tasks: [first, second] }, stats: {} }
    } } }
    var args = { goal: "Create a report and update the project", usedecide: true, usedelegation: true, modelstrategy: "default" }
    assert(a._tryAutomaticDecomposition(args), __, "Cycle falls back")
    assert(Object.keys(a._execution.state.tasks).length, 0, "No partial graph")
    assert(m.pendingQueue.length, 0, "No queued tasks")
    assert(a._execution.state.decomposition.status, "attempted", "Attempt remains recorded")
  }) }
  exports.testAutomaticDecompositionGuardsAndBudget = function() { fixture(function(a, m) {
    var calls = 0
    a._oaf_model = { type: "fixture", model: "main" }; a._decision = { _config: { type: "fixture", model: "decision" } }
    a._assessGoalComplexity = function() { return { level: "complex", signals: [] } }
    a._orchestrationDecision = function() { calls++; return { useful: { type: "boolean", value: true } } }
    a._orchestrationPlannerFactory = function() { throw new Error("Planner must not be started") }
    var args = { goal: "Create a report and update the project", usedecide: true, usedelegation: true, modelstrategy: "default" }
    assert(a._tryAutomaticDecomposition(merge(args, { usedelegation: false })), __, "Delegation opt-out wins")
    assert(a._tryAutomaticDecomposition(merge(args, { usedecide: false })), __, "Decision opt-out wins")
    assert(a._tryAutomaticDecomposition(merge(args, { _delegationDepth: 1 })), __, "Child cannot recursively decompose")
    m.remoteDelegation = true
    assert(a._tryAutomaticDecomposition(args), __, "Unnegotiated remote workers cannot run generated work")
    m.remoteDelegation = false
    assert(calls, 0, "Ineligible runs make no decision calls")
    a._execution = new MiniAExecution({ tokens: 100 })
    assert(a._tryAutomaticDecomposition(args), __, "Insufficient planning budget falls back")
    assert(Object.keys(a._execution.state.tasks).length, 0, "No tasks are registered on budget failure")
  }) }
  exports.testAutomaticDecompositionRequiresGoalCoverage = function() { fixture(function(a, m) {
    a._oaf_model = { type: "fixture", model: "main" }; a._decision = { _config: { type: "fixture", model: "decision" } }
    a._assessGoalComplexity = function() { return { level: "complex", signals: [] } }
    a._orchestrationDecision = function() { return { useful: { type: "boolean", value: true } } }
    a._orchestrationPlannerFactory = function() { return { promptJSONWithStats: function() {
      var first = task("first"), second = task("second"); first.covers = []; second.covers = []
      return { response: { tasks: [first, second] }, stats: {} }
    } } }
    var args = { goal: "Create a report and update the project", usedecide: true, usedelegation: true, modelstrategy: "default" }
    assert(a._tryAutomaticDecomposition(args), __, "Missing root coverage falls back")
    assert(Object.keys(a._execution.state.tasks).length, 0, "Root coverage failure leaves graph unchanged")
  }) }
  exports.testRemoteAutomaticDecompositionRequiresComputeOnlyGraph = function() { fixture(function(a, m) {
    a._oaf_model = { type: "fixture", model: "main" }; a._decision = { _config: { type: "fixture", model: "decision" } }
    a._assessGoalComplexity = function() { return { level: "complex", signals: [] } }
    a._orchestrationDecision = function() { return { useful: { type: "boolean", value: true } } }
    a._skillHandoffForGoal = function() { return [] }
    m.remoteDelegation = true; m.workers = ["http://worker.invalid"]
    m._workerProfiles[m.workers[0]] = { status: "ok", capabilities: ["run-goal", "compute-only-v1", "prepared-context-v1", "task-outcome-v1"] }
    var writes = true
    a._orchestrationPlannerFactory = function() { return { promptJSONWithStats: function() {
      var first = task("first", [], writes ? ["/forbidden"] : []), second = task("second", ["first"], [])
      first.covers = ["goal"]; second.covers = []
      return { response: { tasks: [first, second] }, stats: {} }
    } } }
    var args = { goal: "Create calculations and combine the results", usedecide: true, usedelegation: true, modelstrategy: "default" }
    assert(a._tryAutomaticDecomposition(args), __, "A remote graph requesting resources is rejected")
    assert(m.pendingQueue.length, 0, "No remote resource access is scheduled")
    writes = false; args.goal += " again"
    var result = a._tryAutomaticDecomposition(args)
    assert(result.ids.length, 2, "A supported compute-only graph is scheduled")
    var req = m._buildWorkerRequirements(m.subtasks[result.ids[0]], {})
    assert(req.requiresComputeOnly, true, "Generated task requires the negotiated worker contract")
  }) }
  exports.testCappedRemoteDecompositionRequiresBudgetCapability = function() { fixture(function(a, m) {
    a._execution = new MiniAExecution({ tokens: 10000 })
    a._decision = { _config: { type: "fixture", model: "decision" } }
    a._assessGoalComplexity = function() { return { level: "complex", signals: [] } }
    var decisions = 0; a._orchestrationDecision = function() { decisions++; return __ }
    m.remoteDelegation = true; m.workers = ["http://worker.invalid"]
    m._workerProfiles[m.workers[0]] = { status: "ok", capabilities: ["run-goal", "compute-only-v1", "prepared-context-v1", "task-outcome-v1"] }
    var args = { goal: "Create calculations and combine the results", usedecide: true, usedelegation: true, modelstrategy: "default" }
    assert(a._tryAutomaticDecomposition(args), __, "Capped run skips a worker without budget enforcement")
    assert(decisions, 0, "Capability rejection precedes planning")
  }) }
  exports.testRemoteScopedFilePreflightAndResume = function() { fixture(function(a, m) {
    var root = String(java.nio.file.Files.createTempDirectory("mini-a-preflight-").toFile().getCanonicalPath())
    var read = root + "/read", write = root + "/write"
    io.mkdir(read); io.mkdir(write)
    try {
      var args = { goal: "Update a report", apitoken: "fixture-token", useutils: true, usestdutils: true, usetools: true, readwrite: true, utilsroot: root, fileallow: [root] }
      m.parentArgs.apitoken = args.apitoken
      a._lastStartArgs = args; a._configureFileAccess(args); a._initPolicyRuntime({ policy: { shell: "deny" } }); a._utilsToolNames = ["read", "apply_patch"]
      m.remoteDelegation = true; m.workers = ["http://worker.invalid"]
      m._workerProfiles[m.workers[0]] = { status: "ok", workerInstanceId: "instance-1", capabilities: ["scoped-files-v1", "task-outcome-v1", "prepared-context-v1"] }
      var calls = 0
      m._remoteRequest = function(url, path, scope) { calls++; assert(path, "/execution-scope", "Preflight uses the worker endpoint"); assert(scope.policies[0].shell, "deny", "Parent policy is transmitted"); return { ok: true, workerInstanceId: "instance-1" } }
      var first = task("first", [], [write]), second = task("second", ["first"], [])
      first.resources.reads = [read]
      var prepared = a._prepareRemoteScopedTasks(args, [first, second])
      assert(calls, 1, "Only file-bearing task needs preflight")
      assert(prepared[0].allowedWorkers[0].instance, "instance-1", "Task is pinned to the verified instance")
      a._execution.state.decomposition = { status: "attempted" }
      var ids = m.submitExecutionBatch(prepared, a._execution.state.revision)
      assert(m.subtasks[ids[0]].metadata.remoteScope.root, root, "Contract reaches the subtask")
      var saved = a._execution.snapshot(); a._execution = new MiniAExecution({}, saved)
      var resumed = new SubtaskManager(args, { parentAgent: a }); resumed._startWatchdog = function() {}; resumed._startLocalSubtask = function() {}
      try {
        a._subtaskManager = resumed; resumed._restoreExecutionTasks()
        assert(a._execution.state.tasks.first.auto_remote_scope.root, root, "Contract persists through resume")
        assert(resumed.subtasks[a._execution.state.tasks.first.owner].metadata.allowedWorkers[0].instance, "instance-1", "Worker pin persists through resume")
      } finally { resumed.destroy(); a._subtaskManager = m }
      m._remoteRequest = function() { return { ok: true, workerInstanceId: "other" } }
      var failed = false; try { a._prepareRemoteScopedTasks(args, [first, second]) } catch(e) { failed = true }
      assert(failed, true, "Changed worker instance cannot authorize the contract")
    } finally { io.rm(root) }
  }) }
  exports.testAutomaticDecompositionPlannerFailureIsNotRetried = function() { fixture(function(a, m) {
    var calls = 0
    a._oaf_model = { type: "fixture", model: "main" }; a._decision = { _config: { type: "fixture", model: "decision" } }
    a._assessGoalComplexity = function() { return { level: "complex", signals: [] } }
    a._orchestrationDecision = function() { return { useful: { type: "boolean", value: true } } }
    a._orchestrationPlannerFactory = function() { return { promptJSONWithStats: function() { calls++; throw new Error("fixture failure") } } }
    var args = { goal: "Create a report and update the project", usedecide: true, usedelegation: true, modelstrategy: "default" }
    assert(a._tryAutomaticDecomposition(args), __, "Planner failure falls back")
    assert(a._tryAutomaticDecomposition(args), __, "Unchanged failed attempt is not repeated")
    assert(calls, 1, "Only one planner request is made")
    assert(Object.keys(a._execution.state.tasks).length, 0, "Failure leaves no graph")
  }) }
  exports.testChildPartialAndAcceptance = function() { fixture(function(a, m) {
    var id = m.submitAndRun("Return ready", {}, { task: task("a") })
    m._completeSubtask(m.subtasks[id], "test", "ready", {}, { execution: { outcome: "partial" } })
    assert(m.result(id).outcome, "partial", "Child exhaustion preserved")
    assert(m.result(id).acceptance, "pending", "Child return not automatically accepted")
    assert(m.status(id).status, "completed", "Legacy execution status retained")
  }) }
  exports.testDeterministicAcceptanceReusesAssertions = function() { fixture(function(a, m) {
    var id = m.submitAndRun("Return ready", {}, { task: task("a") })
    m._completeSubtask(m.subtasks[id], "test", "wrong", {}, { execution: { outcome: "succeeded" } })
    assert(m.result(id).acceptance, "rejected", "Claimed success fails actual answer assertion")
    assert(m.result(id).outcome, "partial", "Rejected success reported partial")
  }) }
  exports.testUnknownWorkerCannotEnforceCap = function() { fixture(function(a, m) {
    assert(m._isWorkerProfileCompatible({ status: "ok", capabilities: ["run-goal"] }, { requiresBudget: true }), false, "Legacy worker excluded for capped work")
    assert(m._isWorkerProfileCompatible({ status: "ok", capabilities: ["run-goal", "execution-budget-v1"] }, { requiresBudget: true }), true, "Capable worker allowed")
    assert(m._isWorkerProfileCompatible({ status: "ok", capabilities: ["run-goal", "task-outcome-v1", "prepared-context-v1"] }, { requiresComputeOnly: true }), false, "Legacy worker cannot run generated task")
    assert(m._isWorkerProfileCompatible({ status: "ok", capabilities: ["run-goal", "task-outcome-v1", "prepared-context-v1", "compute-only-v1"] }, { requiresComputeOnly: true }), true, "Worker must explicitly support confinement")
  }) }
  exports.testProviderAccountingAndAdmission = function() { fixture(function(a) {
    a._execution = new MiniAExecution({ tokens: 5000 })
    var calls = 0
    var client = a._instrumentStartupLlm({ promptJSONWithStats: function() { calls++; return { response: "ready", stats: { tokens: { total: 3500 } } } } }, "main")
    client.promptJSONWithStats("hello")
    assert(a._execution.state.budget.spent, 3500, "Provider usage preferred")
    throws(function() { client.promptJSONWithStats("hello") })
    assert(calls, 1, "Exhausted budget prevents new provider request")
  }) }
  exports.testCheckpointUnknownTasksNotResubmitted = function() { fixture(function(a, m) {
    a._execution.put(task("a", [], ["/repo"]))
    a._execution.state.tasks.a.status = "running"
    var snapshot = a._execution.snapshot()
    a._execution = new MiniAExecution({}, snapshot)
    m._restoreExecutionTasks()
    assert(a._execution.state.tasks.a.status, "unknown", "Resume reconciles instead of repeating mutations")
    assert(m.pendingQueue.length, 0, "No duplicate submission")
  }) }
  exports.testManualModeHasNoNewAdmission = function() { fixture(function(a, m) {
    a._execution = __
    var id = m.submitAndRun("Return ready", {})
    m._completeSubtask(m.subtasks[id], "test", "ready", {}, {})
    assert(m.result(id).answer, "ready", "Manual answer shape preserved")
    assert(m.result(id).error, __, "Manual completion unchanged")
  }) }
  exports.testArtifactFreshnessInvalidatesDependents = function() { fixture(function(a) {
    var path = String(java.nio.file.Files.createTempFile("mini-a-evidence-", ".json"))
    try {
      io.writeFileString(path, '{"ok":true}')
      var t = task("artifact")
      t.criteria = [{ id: "ok", requirement: "ok is true", method: "artifact", path: path, format: "json", assertion: { path: "ok", equals: true } }]
      a._execution.put(t); a._execution.put(task("dependent", ["artifact"]))
      var checks = a._executionCheck(t, "done", [], "succeeded")
      assert(checks[0].outcome, "met", "Existing bounded artifact reader and assertion certify the file")
      a._execution.finish("artifact", "succeeded", checks)
      var timestamp = new java.io.File(path).lastModified()
      io.writeFileString(path, '{"ok":null}')
      new java.io.File(path).setLastModified(timestamp)
      a._executionRefresh()
      assert(a._execution.state.tasks.artifact.acceptance, "pending", "Same-size edit with preserved mtime invalidates acceptance")
      assert(a._execution.ready("dependent"), false, "Dependent cannot use stale artifact")
    } finally { io.rm(path) }
  }) }
  exports.testSelectiveReviewAndBatchedParentPlan = function() { fixture(function(a) {
    var calls = 0
    a._supervisedClientFactory = function() { return { promptJSONWithStats: function(prompt) {
      calls++
      var input = af.fromJson(prompt.substring(prompt.indexOf("\n") + 1))
      return { response: { checks: input.criteria.map(function(c) { return { id: c.id, outcome: "met" } }) }, stats: { tokens: { total: 20 } } }
    } } }
    assert(a._executionFinal("ready", { goal: "Return ready" }), true, "Simple response requires no reviewer")
    assert(calls, 0, "No unnecessary semantic call")
    a._execution.put(task("parent-work"))
    assert(a._executionFinal("ready", { goal: "Return ready", useplanning: true }), true, "Parent work can satisfy plan criteria")
    assert(calls, 1, "Batch root review once; deterministic criteria do not require review")
    assert(a._execution.state.tasks["parent-work"].acceptance, "accepted", "Plan step acceptance verified")
    assert(a._executionFinal("ready", { goal: "Return ready", useplanning: true }), true, "Same final result reuses acceptance")
    assert(calls, 1, "Unchanged final result is not reviewed twice")
  }) }
  exports.testAcceptanceTimeoutAndProgress = function() { fixture(function(a) {
    var configs = [], events = [], messages = []
    a._oaf_model = { type: "openai", timeout: 900000 }
    a.fnI = function(level, message) { messages.push(message) }
    a._trace = function(kind, payload) { events.push({ kind: kind, payload: payload }) }
    a._supervisedClientFactory = function(config) {
      configs.push(config)
      return { promptJSONWithStats: function() { throw new Error("Transport timed out") } }
    }
    var spec = { objective: "Return ready", criteria: [{ id: "review", method: "semantic", requirement: "Return ready" }] }
    var checks = a._executionCheck(spec, "ready", [], "succeeded")
    assert(configs[0].timeout, 30000, "Acceptance transport has a thirty-second cap")
    assert(a._oaf_model.timeout, 900000, "Main model configuration is unchanged")
    assert(checks[0].outcome, "insufficient_evidence", "A timeout cannot certify acceptance")
    assert(messages.some(function(m) { return m.indexOf("Reviewing task acceptance") >= 0 }), true, "Review start is visible")
    assert(events.some(function(e) { return e.payload.operation === "acceptance_review" && e.payload.phase === "finish" && e.payload.succeeded === false }), true, "Failed review timing is recorded")
    a._oaf_model.timeout = 1200
    a._executionCheck(spec, "ready", [], "succeeded")
    assert(configs[1].timeout, 1200, "Shorter caller timeout remains authoritative")
  }) }
  exports.testTimingCannotInterruptCleanup = function() { fixture(function(a) {
    a._lastStartArgs.debug = true
    a._trace = function() { throw new Error("Trace unavailable") }
    a.fnI = function() { throw new Error("Output unavailable") }
    assert(a._timeExecution("cleanup", function() { return "closed" }), "closed", "Diagnostics preserve the operation's result")
    var failure = new Error("Original failure"), caught
    try { a._timeExecution("cleanup", function() { throw failure }) } catch(e) { caught = e }
    assert(caught === failure, true, "Diagnostics preserve the original failure")
  }) }
  exports.testAutomaticCleanupRecordsStagesOnce = function() { fixture(function(a) {
    var destroyed = 0, closed = 0, stages = []
    a._traceFn = function(kind, payload) {
      if (kind === "execution_timing" && payload.phase === "finish") stages.push(payload.operation)
    }
    a._mcpConnections = { test: { destroy: function() { destroyed++ } } }
    a._wikiManager = { close: function() { closed++ } }
    a._stopAgentResources()
    a._stopAgentResources()
    assert(destroyed, 1, "Timed MCP teardown remains once-only")
    assert(closed, 1, "Timed wiki teardown remains once-only")
    assert(stages.indexOf("mcp_cleanup") >= 0, true, "MCP cleanup has a timing event")
    assert(stages.indexOf("wiki_cleanup") >= 0, true, "Wiki cleanup has a timing event")
  }) }
  exports.testAcceptanceCacheTracksEvidence = function() { fixture(function(a) {
    var calls = 0, evidence = ["first result"]
    a._executionEvidence = function() { return evidence }
    a._supervisedClientFactory = function() { return { promptJSONWithStats: function(prompt) {
      calls++
      var input = af.fromJson(prompt.substring(prompt.indexOf("\n") + 1))
      return { response: { checks: input.criteria.map(function(c) { return { id: c.id, outcome: "met" } }) } }
    } } }
    var args = { goal: "Return ready", useplanning: true }
    assert(a._executionFinal("ready", args), true, "Initial evidence reviewed")
    assert(a._executionFinal("ready", args), true, "Unchanged evidence reuses verdict")
    assert(calls, 1, "No repeated review for identical evidence")
    evidence = ["changed result"]
    assert(a._executionFinal("ready", args), true, "Changed evidence reviewed")
    assert(calls, 2, "Evidence change invalidates cached verdict even without ledger progress")
  }) }
  exports.testInFlightReviewCannotAcceptRevisedTask = function() { fixture(function(a) {
    a._execution.put(task("changing"))
    a._supervisedClientFactory = function() { return { promptJSONWithStats: function(prompt) {
      var revised = task("changing")
      revised.objective = "Return ready using the revised approach"
      a._execution.put(revised)
      var input = af.fromJson(prompt.substring(prompt.indexOf("\n") + 1))
      return { response: { checks: input.criteria.map(function(c) { return { id: c.id, outcome: "met" } }) } }
    } } }
    assert(a._executionFinal("ready", { goal: "Return ready", useplanning: true }), false, "Review for old revision cannot certify new revision")
    assert(a._execution.state.tasks.changing.acceptance, "pending", "Revised task remains pending")
    assert(a._autoFinalCheck, __, "Stale verdict is not cached")
  }) }
  exports.testArtifactHashingOutsideLockAndDeduplicated = function() { fixture(function(a) {
    var original = MiniASupervised.prototype.fingerprint, hashes = 0, locked = false
    var sync = a._executionSync
    a._executionSync = function(fn) { return sync.call(a, function(e) { locked = true; try { return fn(e) } finally { locked = false } }) }
    ;["one", "two"].forEach(function(id) {
      var t = task(id)
      t.criteria = [{ id: "file", method: "artifact", requirement: "File is current", path: "/shared", assertion: { equals: "ready" } }]
      a._execution.put(t)
      a._execution.finish(id, "succeeded", [{ id: "file", outcome: "met", path: "/shared", evidence: "current" }])
    })
    MiniASupervised.prototype.fingerprint = function() {
      assert(locked, false, "File hashing never holds the execution monitor")
      hashes++
      return { fingerprint: "current" }
    }
    try {
      a._executionRefresh()
      assert(hashes, 1, "Shared path is hashed once per refresh")
      MiniASupervised.prototype.fingerprint = function() {
        var revised = clone(a._execution.state.tasks.one)
        revised.objective = "Revised approach"
        a._execution.put(revised)
        a._execution.finish("one", "succeeded", [{ id: "file", outcome: "met", path: "/shared", evidence: "changed" }])
        return { fingerprint: "changed" }
      }
      a._executionRefresh()
      assert(a._execution.state.tasks.one.acceptance, "accepted", "Old fingerprint cannot invalidate a replacement task")
      assert(a._execution.state.tasks.two.acceptance, "pending", "Unchanged revision with stale evidence is invalidated")
    } finally { MiniASupervised.prototype.fingerprint = original }
  }) }
  exports.testInvalidReviewCannotCertifyChild = function() { fixture(function(a, m) {
    a._supervisedClientFactory = function() { return { promptJSONWithStats: function() { return { response: { checks: [] }, stats: {} } } } }
    var t = task("a"); t.criteria = [{ id: "proof", requirement: "Actually execute the task", method: "semantic" }]
    var id = m.submitAndRun("Perform work", {}, { task: t })
    m._completeSubtask(m.subtasks[id], "test", "Done", {}, { execution: { outcome: "succeeded" } })
    assert(m.result(id).acceptance, "pending", "Missing reviewer check is insufficient evidence")
  }) }
  exports.testLiveTasksAreNotMistakenForResumedTasks = function() { fixture(function(a, m) {
    var id = m.submitAndRun("Return ready", {}, { task: task("live") })
    m._restoreExecutionTasks()
    assert(a._execution.state.tasks.live.status, "running", "Reconciliation only touches prior executions")
    assert(m.list()[0].acceptance, "pending", "Status view includes acceptance")
    assert(a._executionParentBusy("shell"), true, "Parent unknown writes serialize against child readers")
    assert(a._executionParentBusy("subtask-status"), false, "Coordination remains available")
  }) }
  exports.testUnknownUsageRetainsReservation = function() { fixture(function(a, m) {
    a._execution = new MiniAExecution({ tokens: 10000 })
    var id = m.submitAndRun("Return ready", {}, { task: task("a") })
    var allocation = m.subtasks[id].allocation
    assert(isDef(a._execution.state.budget.reservations[allocation]), true, "Child allocation reserved")
    m._failRemoteOutcomeUnknown(m.subtasks[id], "test", "lost response")
    assert(a._execution.state.tasks.a.status, "unknown", "Ambiguous outcome retains ownership")
    assert(isDef(a._execution.state.budget.reservations[allocation]), true, "Ambiguous usage cannot create more budget")
  }) }
  exports.testWorkerSubmissionRecoveryUsesReceipt = function() { fixture(function(a, m) {
    a._execution.put(task("a")); var t = a._execution.state.tasks.a
    t.status = "running"; t.remote = { url: "https://worker", submissionId: "receipt", instance: "instance" }
    var paths = []
    m._remoteRequest = function(url, path, payload) {
      paths.push(path)
      return path === "/submission/status" ? { workerInstanceId: "instance", taskId: "existing" } : { status: "completed", result: { answer: "ready", outcome: "succeeded" } }
    }
    m._restoreExecutionTasks()
    assert(paths, ["/submission/status", "/result"], "Only observes existing submission")
    assert(t.acceptance, "accepted", "Recovered result is checked before acceptance")
  }) }
  exports.testLedgerBounds = function() {
    var e = new MiniAExecution()
    for (var i = 0; i < 600; i++) e.observe("tool", "read", "digest" + i)
    assert(e.state.evidence.length, 128, "Evidence remains bounded")
    assert(Object.keys(e.state.seen).length, 512, "Deduplication remains bounded")
    var saved = e.snapshot(); saved.budget.reservations.bad = { tokens: -1 }
    throws(function() { new MiniAExecution({}, saved) })
  }
  exports.testNativeContinuationBudgetBoundsSingleStep = function() { fixture(function(a) {
    a._execution = new MiniAExecution({ tokens: 3500 })
    var calls = 0, model = { conversation: [] }
    model.rawPrompt = function() { calls++; return calls < 20 ? model.rawPrompt([]) : "ready" }
    var client = a._instrumentStartupLlm({ getGPT: function() { return { model: model, getConversation: function() { return model.conversation } } }, promptWithStats: function() {
      return { response: model.rawPrompt("hello"), stats: { tokens: { total: 20 } } }
    } }, "main")
    throws(function() { client.promptWithStats("hello") })
    assert(calls < 4, true, "Native continuation loop cannot bypass admission within a single main step")
    assert(a._execution.state.budget.estimated > 0, true, "Unreported intermediate native usage labeled estimated")
  }) }
  exports.testConcurrentBudgetReservations = function() { fixture(function(a) {
    a._execution = new MiniAExecution({ tokens: 10000 })
    var allocations = pForEach([1, 2, 3, 4, 5, 6, 7, 8], function() {
      try { return a._executionSync(function(e) { return e.reserve(3000, "child") }) } catch(e) { return "rejected" }
    })
    assert(allocations.filter(function(id) { return id !== "rejected" }).length, 2, "Concurrent children cannot oversubscribe the ledger")
  }) }
  exports.testRequiredAndUnknownTasksCannotBeDropped = function() {
    var e = new MiniAExecution(), t = task("a")
    e.put(t)
    var optional = clone(t); optional.required = false
    throws(function() { e.put(optional) })
    e.state.tasks.a.status = "unknown"
    throws(function() { e.put(t) })
    assert(e.state.tasks.a.status, "unknown", "Revising approach cannot erase unresolved side effects")
  }
  exports.testExecutionEvalMetrics = function() {
    load("mini-a-eval.js")
    var e = new MiniAExecution()
    e.put(task("a")); e.state.outcome = "partial"; e.state.budget.spent = 99
    var metrics = new MiniAEval()._normalizeMetrics({}, 20, { execution: e.snapshot() })
    assert(metrics.verified_completion, 0, "Incomplete answers are not counted as verified completion")
    assert(metrics.unaccepted_tasks, 1, "Unaccepted work visible to evaluation")
    assert(metrics.aggregate_tokens, 99, "Tree usage reported separately from shared process counters")
  }
  exports.testAutomaticNativeFinalThroughRealExecutor = function() {
    var agent = new MiniA(), requests = 0
    agent.fnI = function() {}
    var args = { goal: "Return ready", raw: true, format: "raw", maxsteps: 2, maxtotalsteps: 3,
      orchestration: "auto", useplanning: false, evidencegate: false, usememory: false,
      usedecide: false, llmcomplexity: false, useskills: false, useutils: false,
      usetools: true, usejsontool: false, usestream: true }
    try {
      agent.init(args)
      agent._use_lc = false
      agent._supportsPromptStreamWithStatsCompat = function() { return true }
      agent._prepareContextInvocation = function(llm, prompt) { return prompt }
      agent._promptStreamWithStatsCompat = function() {
        requests++; agent._useToolsActual = true; agent._runtime.modelToolCallDetected = true
        return { response: 'ready', stats: {} }
      }
      assert(agent.start(merge({}, args)), "ready", "Automatic result uses the real native executor and finalization")
      assert(agent._execution.state.outcome, "succeeded", "Simple native output accepted")
      assert(requests, 1, "Simple response incurs no extra executor calls")
    } finally { agent._stopAgentResources() }
  }
  exports.testDurableExecutionCheckpointAndResume = function() {
    var root = String(java.nio.file.Files.createTempDirectory("mini-a-execution-run-")), a = new MiniA()
    a.fnI = function() {}
    var args = { goal: "Return ready", orchestration: "auto", durable: true, runid: "fixture", runroot: root }
    try {
      a._beginRun(args)
      var client = a._instrumentStartupLlm({ promptWithStats: function() {
        var admitted = io.readFileJSON(root + "/fixture/state.json")
        assert(Object.keys(admitted.execution.budget.reservations).length, 1, "Durable reservation is written before provider dispatch")
        return { response: "ready", stats: { tokens: { total: 20 } } }
      } }, "main")
      client.promptWithStats("hello")
      assert(io.readFileJSON(root + "/fixture/state.json").execution.budget.spent, 20, "Durable usage reconciled after provider return")
      a._execution.put(task("a")); a._execution.state.tasks.a.status = "running"
      a._execution.state.outcome = "partial"
      a._checkpointRun("fixture")
      var saved = io.readFileJSON(root + "/fixture/state.json")
      assert(saved.execution.tasks.a.criteria[0].requirement, "Return ready", "Authoritative contract is not a truncated diagnostic snapshot")
      a._beginRun({ goal: "Return ready", orchestration: "auto", resumerun: "fixture", runroot: root })
      assert(a._execution.state.outcome, "running", "Resume can continue a partial run")
      assert(a._execution.state.tasks.a.status, "running", "Prior task identity remains available for reconciliation")
    } finally {
      var remove = function(file) { var children = file.isDirectory() ? file.listFiles() : null; for (var i = 0; children !== null && i < children.length; i++) remove(children[i]); file.delete() }
      remove(new java.io.File(root))
    }
  }
  exports.testAutomaticModeReusesProtectedContractAcceptance = function() { fixture(function(a) {
    a._supervised = { accepted: true }
    a._agentState.plan = { steps: [{ id: "S1", title: "Inspect report" }] }
    a._executionImportPlan()
    assert(Object.keys(a._execution.state.tasks).length, 0, "Protected contract steps do not create duplicate unverified task criteria")
    assert(a._executionFinal("ready", { goal: "Return ready", modelstrategy: "supervised" }), true, "Existing supervised verifier remains authoritative")
    a._supervised.accepted = false; a._autoFinalCheck = __
    assert(a._executionFinal("ready", { goal: "Return ready", modelstrategy: "supervised" }), false, "Unaccepted protected contract cannot complete")
  }) }
  exports.testPlanHierarchyAndNumericStepCompatibility = function() { fixture(function(a) {
    a._agentState.plan = { version: 3, steps: [{ id: 1, task: "Inspect input" }, { id: 2, task: "Write result", dependencies: [1] }] }
    a._executionImportPlan()
    assert(a._execution.state.tasks["1"].objective, "Inspect input", "Existing numeric simple-plan IDs and task labels are normalized")
    assert(a._execution.state.tasks["2"].dependencies, ["1"], "Explicit numeric dependencies preserved")
    a._execution = new MiniAExecution()
    a._agentState.plan = { steps: [{ id: "phase", children: [{ id: "a", title: "Inspect" }] }, { id: "b", title: "Write", dependencies: ["phase"] }] }
    a._executionImportPlan()
    assert(a._execution.state.tasks.a.dependencies, [], "Hierarchy does not create parent prerequisites")
    assert(a._execution.state.tasks.b.dependencies, ["a"], "Explicit phase prerequisite expands to its leaf work")
  }) }
  exports.testNativeLoopStagnationReturnsToPlanner = function() { fixture(function(a) {
    var calls = 0, model = { conversation: [] }
    model.rawPrompt = function() { calls++; return calls < 20 ? model.rawPrompt([]) : "ready" }
    var client = a._instrumentStartupLlm({ getGPT: function() { return { model: model, getConversation: function() { return [] } } }, promptWithStats: function() { return { response: model.rawPrompt("hello"), stats: {} } } }, "main")
    throws(function() { client.promptWithStats("hello") })
    assert(calls, 4, "An uncapped native loop also yields after four unchanged rounds")
    assert(a._execution.state.recoveries, 1, "Recovery reuses the shared progress policy")
    assert(a._execution.state.outcome, "running", "First stagnation returns control for a changed strategy")
  }) }
  exports.testNativeEvidenceUsesExistingConversation = function() { fixture(function(a) {
    a._getActiveConversationLLM = function() { return { getGPT: function() { return { getConversation: function() { return [
      { role: "user", content: "Unproven claim" },
      { role: "assistant", tool_calls: [{ function: { name: "filesystemQuery", arguments: '{"path":"output.json"}' } }] },
      { role: "tool", content: '{"content":"{\\"total\\":15}"}' }
    ] } } } } }
    var evidence = a._executionEvidence().join("\n")
    assert(evidence.indexOf("filesystemQuery") >= 0, true, "Native tool identity retained without duplicating results")
    assert(evidence.indexOf("total") >= 0, true, "Native returned content is available to the reviewer")
    assert(evidence.indexOf("Unproven claim"), -1, "User prose is not substituted for execution proof")
  }) }
  exports.testAutomaticEvidenceGateUsesNativeObservations = function() { fixture(function(a) {
    assert(a._hasEvidenceForStep(a._runtime, "final report", "medium"), false, "No proof means unsupported")
    a._execution.observe("tool", "filesystemQuery", "returned-content-digest")
    assert(a._hasEvidenceForStep(a._runtime, "final report", "medium"), true, "Native evidence works without synthetic context markers")
    a._execution = __
    assert(a._hasEvidenceForStep(a._runtime, "final report", "medium"), false, "Manual gate behavior preserved")
  }) }
  exports.testStartupModelUsageRetainedAtRunStart = function() { fixture(function(a) {
    a._executionActive = false
    var args = { goal: "Return ready", orchestration: "auto", runmaxtokens: 5000 }
    a._prepareExecution(args)
    var client = a._instrumentStartupLlm({ promptWithStats: function() { return { response: "ready", stats: { tokens: { total: 20 } } } } }, "main")
    client.promptWithStats("classify goal")
    a._beginRun(args)
    assert(a._execution.state.budget.spent, 20, "Startup classification work is included, not discarded when the loop begins")
    assert(a._execution.state.budget.cap, 5000, "Startup and executor use the same allocation")
  }) }
  exports.testDelegationEvalIgnoresPreviousProcessTotals = function() {
    load("mini-a-eval.js")
    var total = 9, owned = 0, manager
    var evaluator = new MiniAEval({ agentFactory: function() { return {
      init: function() { total = 0; manager = "new-manager" },
      start: function() { total = 2; owned = 2; return "ready" },
      getMetrics: function() { return { delegation: { total: total, owned_total: owned, manager_id: manager } } }
    } } })
    var result = evaluator.runScenario({ name: "ownership", goal: "Return ready", expected: { contains: "ready", metrics: { delegated_tasks: 2 } } })
    assert(result.success, true, "Previous scenario process totals cannot produce negative delegated-task metrics")
  }
  exports.testMalformedTaskAssertionsFailBeforeSubmission = function() { fixture(function(a, m) {
    var spec = task("bad")
    spec.criteria[0].assertion = "answer == ready"
    throws(function() { m.submit("Return ready", {}, { task: spec }) })
    assert(m.pendingQueue.length, 0, "Malformed criteria cannot leave an unfulfillable queued task")
    assert(Object.keys(a._execution.state.tasks).length, 0, "Contract rejection is atomic")
    spec = task("numeric"); spec.criteria[0].assertion = { equals: 19 }
    throws(function() { m.submit("Return 19", {}, { task: spec }) })
    spec.criteria[0].format = "json"
    var id = m.submitAndRun("Return 19", {}, { task: spec })
    m._completeSubtask(m.subtasks[id], "fixture", "19", {}, { execution: { outcome: "succeeded" } })
    assert(m.result(id).acceptance, "accepted", "Explicit JSON parsing permits a numeric response criterion")
  }) }
  exports.testProgressIgnoresVolatileResultMetadata = function() { fixture(function(a) {
    a._lastStartArgs.goal = "Read report contents"
    var event = function(time) { return { name: "filesystemQuery", params: { path: "report.json" }, result: { routeUsed: "direct", timing: time,
      rawResult: { content: [{ type: "text", text: stringify({ path: "report.json", content: "same report", lastModified: time }) }] } } } }
    a._trace("tool_result", event(1)); a._trace("tool_result", event(2))
    assert(a._execution.state.progress, 1, "Changed timing or mtime alone is not new evidence")
    a._trace("tool_result", { name: "proxy-dispatch", params: { tool: "subtask-status", arguments: {} }, result: { status: "running" } })
    assert(a._execution.state.progress, 1, "Proxy coordination also leaves progress unchanged")
  }) }
  exports.testToolModeRecoveryRetainsAcceptedResults = function() { fixture(function(a) {
    var t = task("done"); a._execution.put(t)
    a._execution.state.tasks.done.answer = "ready"
    a._execution.finish("done", "succeeded", [{ id: "ready", outcome: "met" }])
    a._hasToolInterfaceForModel = function() { return false }
    var rebuilt = false
    a._restoreNoToolsModels = function() { rebuilt = true }
    a._fallbackFromToolCallingFailure(a._runtime, { stepLabel: 1, useLowCost: false, reason: "native parser failed" })
    assert(rebuilt, true, "Existing action-mode recovery is reused")
    assert(a._runtime.context.join("\n").indexOf("ready") >= 0, true, "Accepted child output survives discarding native conversation")
    assert(a._runtime.context.join("\n").indexOf("RETAINED EVIDENCE") >= 0, true, "Recovery context explicitly labels retained observations")
  }) }
  exports.testExplicitChildCapsAndUnknownRetryAllowance = function() { fixture(function(a, m) {
    a._execution = new MiniAExecution({ tokens: 60000, time: 60000 })
    var id = m.submitAndRun("Return ready", { runmaxtokens: 3000, runmaxtimems: 5000 }, { task: task("capped") })
    assert(m.subtasks[id].args.runmaxtokens, 3000, "Parent allocation preserves a smaller caller-selected child cap")
    assert(m.subtasks[id].args.runmaxtimems <= 5000, true, "Caller-selected child deadline remains a ceiling")
    assert(m._failOrRetrySubtask(m.subtasks[id], "fixture", "Startup outcome unavailable"), "failed", "Unsettled capped allowance cannot be replayed as a fresh full allowance")
    assert(Object.keys(a._execution.state.budget.reservations).length, 1, "Unknown usage retains its allocation")
  }) }
})()
