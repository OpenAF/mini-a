(function() {
  load("mini-a.js")
  load("mini-a-subtask.js")
  var assert = function(actual, expected, message) { ow.test.assert(actual, expected, message) }
  var throws = function(fn, fragment) {
    var error = ""
    try { fn() } catch(e) { error = String(e) }
    assert(error.indexOf(fragment) >= 0, true, "Expected error containing " + fragment + "; got " + error)
  }
  var state = function() { return { workingMemory: { facts: [{ v: "deployment access secret is ORCHID", key: "deployment access" }] }, forkedContext: ["recent transaction rollback token is COBALT"] } }
  var fixture = function(args, seed) {
    var a = new MiniA()
    a.fnI = function() {}; a._trace = function() {}
    a._agentState = MiniAForkPolicy.copy(seed || {})
    a._runtime = { context: (seed && seed.forkedContext) || [] }
    a._contextForDelegate = function() { return "" }
    var m = new SubtaskManager(merge({ usememory: true, forkdecide: false }, args || {}), { parentAgent: a })
    m._startWatchdog = function() {}
    return { agent: a, manager: m }
  }
  var submit = function(f, goal, args, opts) {
    var id = f.manager.submit(goal, args || {}, opts || {})
    var task = f.manager.subtasks[id]
    // Exercise the same child-argument boundary as local and remote execution.
    task.status = "running"; task.startedAt = now()
    return { task: task, args: f.manager._buildChildArgs(task) }
  }
  var decision = function(f, answer, options) {
    options = options || {}
    var seen = { calls: 0, usage: 0 }
    f.agent._initDecisionRuntime({ modeldec: options.config || { type: "fixture", model: "choice", key: "DO_NOT_FORWARD", timeout: 9000 } })
    var observe = f.agent._decision._options.observe
    f.manager.parentArgs.forkdecide = true
    f.agent._decisionToolControls = { tryBeforeCall: function() { return options.pressure !== true }, afterReservedCall: function(tokens) { seen.usage += tokens } }
    f.agent._decision = new MiniADecision({ modeldec: options.config || { type: "fixture", model: "choice", key: "DO_NOT_FORWARD", timeout: 9000 },
      supportsBoundedRequests: options.bounded !== false, observe: observe,
      clientFactory: function(config) {
        seen.timeout = config.timeout
        return { getCapabilities: function() { return options.caps || { structured: { implemented: true, contract: "verified", availability: "unknown", questionTypes: ["choice"] } } },
          decideWithStats: function(s, q) {
            seen.calls++; seen.inputBytes = MiniAForkPolicy.bytes({ state: s, questions: q }); seen.questions = q
            if (options.error) throw new Error("private provider response")
            return { response: { answers: isMap(answer) ? answer : { inheritance: { type: "choice", value: answer } } }, stats: { tokens: { total: 7 } } }
          } }
      } })
    return seen
  }

  exports.testDefaultsAndPresence = function() {
    var f = fixture({}, state())
    assert(f.manager.parentArgs.forkpolicy, "auto", "Auto is the manager default")
    var buildSnapshot = f.agent._buildForkState
    f.agent._buildForkState = function() { throw "Clean must not collect a snapshot" }
    var clean = submit(f, "deployment access", {}, { fork: false })
    f.agent._buildForkState = buildSnapshot
    assert(clean.task.forkPolicy.scope, "clean", "Explicit false beats auto")
    assert(clean.task.forkPolicy.effective_policy, "clean", "Effective policy reflects explicit intent")
    assert(isUnDef(clean.args.state), true, "Clean has no inherited state")
    var memory = submit(f, "deployment access", {}, { fork: true })
    assert(isMap(jsonParse(memory.args.state).workingMemory), true, "Explicit true keeps memory default")
    assert(isUnDef(jsonParse(memory.args.state).forkedContext), true, "Explicit true does not add history")
    var alone = submit(f, "unrelated independent arithmetic", {}, { forkscope: ["context"] })
    assert(alone.task.forkPolicy.scope, "clean", "Scope alone does not imply fork")
    f.manager.destroy()
  }
  exports.testOverridesAndConflicts = function() {
    var f = fixture({ forkpolicy: "full" }, state())
    assert(submit(f, "anything", {}, { fork: false }).task.forkPolicy.scope, "clean", "Run default cannot defeat explicit false")
    assert(submit(f, "anything", {}, { forkpolicy: "memory" }).task.forkPolicy.scope, "memory", "Task policy wins")
    throws(function() { f.manager.submit("x", {}, { fork: false, forkpolicy: "full" }) }, "Conflicting")
    throws(function() { f.manager.submit("x", {}, { fork: true, forkpolicy: "context" }) }, "Conflicting")
    throws(function() { f.manager.submit("x", {}, { forkpolicy: "unknown" }) }, "Invalid forkpolicy")
    var r = submit(f, "x", { forkpolicy: "clean" }, { forkpolicy: "memory" })
    assert(r.args.forkpolicy, "clean", "Child outgoing policy is independent")
    f.manager.destroy()
  }
  exports.testExplicitInitialization = function() {
    var f = fixture({}, state()), initialized = '{"custom":"seed"}'
    assert(submit(f, "deployment access", { state: initialized }).args.state, initialized, "Explicit state is preserved exclusively")
    assert(submit(f, "deployment access", { conversation: "own.json" }).args.conversation, "own.json", "Explicit conversation is preserved")
    throws(function() { f.manager.submit("x", { state: initialized }, { fork: true }) }, "conflicts")
    throws(function() { f.manager.submit("x", { conversation: "own.json" }, { forkpolicy: "full" }) }, "conflicts")
    f.manager.parentArgs.forkpolicy = "full"
    assert(submit(f, "x", { state: initialized }).args.state, initialized, "Run defaults do not defeat explicit initialization")
    f.manager.destroy()
  }
  exports.testDependencyEvidence = function() {
    var cases = [
      ["deployment access", state(), "memory"], ["transaction rollback", state(), "context"],
      ["deployment access transaction rollback", state(), "full"],
      ["calculate independent arithmetic", state(), "clean"], ["clean workspace", state(), "clean"],
      ["deployment", state(), "clean"], ["acesso implantação", { workingMemory: { facts: [{ v: "acesso implantação ORQUIDEA" }] } }, "memory"],
      ["取引ロールバック トークン確認", { forkedContext: ["取引ロールバック トークン確認 COBALT"] }, "context"],
      ["deployment access", {}, "clean"], ["deployment access", { workingMemory: { facts: [{ v: "deployment access obsolete", stale: true }] } }, "clean"]
    ]
    cases.forEach(function(c) { var f = fixture({}, c[1]); assert(submit(f, c[0]).task.forkPolicy.scope, c[2], c[0]); f.manager.destroy() })
  }
  exports.testDisabledMemoryAndForcedFailure = function() {
    var f = fixture({ usememory: false }, state())
    assert(submit(f, "deployment access").task.forkPolicy.scope, "clean", "Auto cannot enable memory")
    throws(function() { submit(f, "x", {}, { forkpolicy: "memory" }) }, "Forced forkpolicy")
    assert(submit(f, "transaction rollback").task.forkPolicy.scope, "context", "History remains independently feasible")
    f.manager.destroy()
  }
  exports.testSnapshotImmutabilityAndOnceOnly = function() {
    var f = fixture({}, state()), opts = { forkpolicy: "full" }, args = { knowledge: "explicit facts" }
    var id = f.manager.submit("deployment access transaction rollback", args, opts), task = f.manager.subtasks[id]
    args.knowledge = "changed"; f.agent._agentState.workingMemory.facts[0].v = "changed"; f.agent._runtime.context[0] = "changed"
    task.status = "running"
    var first = f.manager._buildChildArgs(task), child = jsonParse(first.state)
    assert(child.workingMemory.facts[0].v.indexOf("ORCHID") >= 0, true, "Parent mutations cannot change queued seed")
    assert(first.knowledge, "explicit facts", "Explicit arguments are captured too")
    child.workingMemory.facts[0].v = "child changed"
    var second = f.manager._buildChildArgs(task)
    assert(second.state, first.state, "Rebuild/retry reuses prepared state")
    assert(f.manager.forkMetrics.resolutions, 1, "Resolution occurs once")
    f.manager.destroy()
  }
  exports.testCleanAndProjection = function() {
    ;["active", "shadow", "degraded"].forEach(function(mode) {
      var f = fixture({ knowledge: "configured knowledge" }, {})
      f.agent._contextForDelegate = function(g, b, o) { assert(o.forkPolicy, true, "Auto projection is provider-free"); return mode === "active" ? "parent view" : "" }
      var r = submit(f, "x", { knowledge: "explicit knowledge" }, { forkpolicy: "clean" })
      assert(r.args.knowledge, "explicit knowledge", "Clean cannot regain projection in " + mode)
      assert(isUnDef(r.args.state), true, "No hidden state in " + mode)
      f.manager.destroy()
    })
    var f = fixture({}, state())
    f.agent._contextForDelegate = function() { return "BEGIN_UNTRUSTED_CONTEXT\ntransaction rollback COBALT\nEND_UNTRUSTED_CONTEXT" }
    var r = submit(f, "transaction rollback", {}, { forkpolicy: "context" })
    assert(isUnDef(r.args.state), true, "Active projection does not duplicate runtime history")
    assert(r.args._forkInheritedKnowledge.indexOf("COBALT") >= 0, true, "Projection reaches child")
    f.manager.destroy()
  }
  exports.testUtf8BudgetsAndStrictScopes = function() {
    var seed = { workingMemory: { facts: [{ v: repeat(1000, "界") }] }, forkedContext: [repeat(1000, "界")] }
    var f = fixture({ forkstatemaxbytes: 100 }, seed)
    var r = submit(f, "ambiguous task")
    assert(r.task.forkPolicy.inherited_bytes <= 100, true, "Auto handles infeasible optional inheritance")
    throws(function() { submit(f, "x", {}, { forkpolicy: "full" }) }, "Forced forkpolicy")
    throws(function() { submit(f, "x", {}, { fork: true, forkscope: ["memory", "context"], forkpolicy: "full" }) }, "Forced forkpolicy")
    throws(function() { submit(f, "x", {}, { fork: true }) }, "forkstatemaxbytes")
    assert(f.agent._runtime.context.length, 1, "Trimming preserves parent")
    f.manager.destroy()
    f = fixture({ forkstatemaxbytes: 160 }, { workingMemory: { facts: [{ v: "deployment access ORCHID" + repeat(30, "x") }] } })
    f.agent._contextForDelegate = function() { return "\nBEGIN_UNTRUSTED_CONTEXT\ntransaction rollback COBALT" + repeat(30, "y") + "\nEND_UNTRUSTED_CONTEXT" }
    r = submit(f, "deployment access transaction rollback")
    assert(r.task.forkPolicy.scope !== "full", true, "Individually feasible sources cannot bypass the combined byte budget")
    var inherited = MiniAForkPolicy.bytes(r.args.state || "") + MiniAForkPolicy.bytes(r.args._forkInheritedKnowledge || "")
    assert(inherited <= 160, true, "State and projected knowledge share one actual byte ceiling")
    assert(r.task.forkPolicy.inherited_bytes, inherited, "Diagnostics account for the actual inherited bytes")
    throws(function() { submit(f, "x", {}, { forkpolicy: "full" }) }, "Forced forkpolicy")
    f.manager.destroy()
  }
  exports.testDecisionNativeStructuredAndCache = function() {
    ;["native", "structured"].forEach(function(strategy) {
      var f = fixture({}, state()), caps = {}
      caps[strategy] = { implemented: true, contract: "verified", availability: "unknown", questionTypes: ["choice"] }
      var seen = decision(f, "memory", { caps: caps })
      var r = submit(f, "ambiguous handoff")
      assert(r.task.forkPolicy.source, "decision", strategy + " valid choice accepted without probabilities")
      assert(jsonParse(r.args.state).workingMemory.facts[0].v.indexOf("ORCHID") >= 0, true, "Chosen memory reaches child")
      assert(seen.calls, 1, "One provider call")
      assert(seen.timeout <= 2000, true, "Actual transport configuration is capped")
      assert(seen.inputBytes <= 8192, true, "Classifier request is bounded")
      assert(seen.usage, 7, "Usage is charged once")
      var cached = submit(f, "ambiguous handoff")
      assert(cached.task.forkPolicy.cache_hit, true, "Validated decision reused")
      assert(seen.calls, 1, "Cache avoids provider")
      f.agent._agentState.workingMemory.facts[0].v += " revised"
      submit(f, "ambiguous handoff")
      assert(seen.calls, 2, "Source fingerprint invalidates cache")
      f.manager.destroy()
    })
  }
  exports.testDecisionFallbacks = function() {
    var cases = [
      ["abstain", {}, "decision_abstain"], ["arbitrary", {}, "LLM_DECISION_INVALID_RESPONSE"],
      [{ wrong: { type: "choice", value: "memory" } }, {}, "LLM_DECISION_INVALID_RESPONSE"],
      ["memory", { error: true }, "LLM_DECISION_PROVIDER_ERROR"],
      ["memory", { caps: { native: { implemented: false } } }, "decision_unsupported"],
      ["memory", { bounded: false }, "MINI_A_DECISION_RUNTIME_UNSUPPORTED"],
      ["memory", { pressure: true }, "rate_pressure"], ["memory", { config: "invalid" }, "MINI_A_DECISION_INVALID_CONFIG"]
    ]
    cases.forEach(function(c) {
      var f = fixture({}, state()), seen = decision(f, c[0], c[1]), r = submit(f, "ambiguous handoff")
      assert(r.task.forkPolicy.scope, "clean", "Fallback scope is precomputed")
      assert(r.task.forkPolicy.reason, c[2], "Bounded failure reason")
      assert(stringify(r.task.forkPolicy).indexOf("private"), -1, "No provider error body in diagnostics")
      f.manager.destroy()
    })
  }
  exports.testDecisionOptOutsAndRequestLimit = function() {
    ;["usedecide", "forkdecide"].forEach(function(key) {
      var f = fixture({}, state()), seen = decision(f, "memory")
      f.manager.parentArgs[key] = false
      assert(submit(f, "ambiguous handoff").task.forkPolicy.reason, "decision_disabled", "Opt-out " + key)
      assert(seen.calls, 0, "No hidden provider call")
      f.manager.destroy()
    })
    var f = fixture({}, state()), seen = decision(f, "abstain")
    for (var i = 0; i < 10; i++) submit(f, "ambiguous handoff " + i)
    assert(seen.calls, 8, "Per-run allowance is bounded and failures are not cached")
    assert(f.manager.forkMetrics.classifier_attempts, 8, "Attempt metrics match real calls")
    f.manager.destroy()
  }
  exports.testLegacyCompatibility = function() {
    var f = fixture({ forkpolicy: "legacy" }, state())
    f.agent._contextForDelegate = function() { return "legacy projection" }
    assert(submit(f, "x").args._forkInheritedKnowledge, "legacy projection", "Legacy nonfork projection retained")
    var r = submit(f, "x", {}, { fork: true })
    assert(isMap(jsonParse(r.args.state).workingMemory), true, "Legacy true retains default snapshot")
    assert(isUnDef(jsonParse(r.args.state).forkedContext), true, "Legacy default scope remains memory")
    assert(f.manager._buildChildArgs(r.task).state, r.args.state, "Legacy retries reuse serialized snapshot")
    f.manager.destroy()
  }
  exports.testIndependentInputsAndNoisySummary = function() {
    var f = fixture({}, state()), seen = decision(f, "full")
    var r = submit(f, "deployment access transaction rollback", {}, { _forkSelfContained: true })
    assert(r.task.forkPolicy.scope, "clean", "Known complete summary input is clean")
    assert(seen.calls, 0, "No classifier needed")
    f.manager.destroy()
  }
  exports.testRateAdmissionAndCancellation = function() {
    var a = new MiniA(), limiter = a._createRateLimiter({ rpm: 1 })
    assert(limiter.tryBeforeCall(), true, "First optional call reserves RPM")
    assert(limiter.tryBeforeCall(), false, "Pressure skips without waiting")
    var f = fixture({}, state()), seen = decision(f, "memory")
    var id = f.manager.submit("ambiguous handoff", {}, {})
    f.manager.cancel(id)
    assert(seen.calls, 0, "Cancelled queued task never classifies")
    assert(f.manager.subtasks[id].status, "cancelled", "Cancellation remains terminal")
    f.manager.destroy()
  }
  exports.testDefaultGateRemainsOptIn = function() {
    var f = fixture({}, state()), seen = decision(f, "memory")
    assert(isUnDef(f.agent._decisionGate("unrelated", {}, {}, { choice: {} })), true, "Existing gate remains explicit opt-in")
    assert(seen.calls, 0, "No gate provider call")
    f.manager.destroy()
  }
  exports.testLiteralConsoleGoals = function() {
    assert(__miniAParseDelegate("fork report").options.fork, true, "Explicit fork modifier")
    assert(__miniAParseDelegate("clean report").options.forkpolicy, "clean", "Explicit clean modifier")
    assert(__miniAParseDelegate("auto report").options.forkpolicy, "auto", "Explicit auto modifier")
    assert(__miniAParseDelegate("-- clean workspace").goal, "clean workspace", "Literal modifier escaped")
    assert(isUnDef(__miniAParseDelegate("ordinary goal").options.fork), true, "Omission stays omitted")
    var source = io.readFileString("mini-a-session.js"), begin = source.indexOf("  function getDelegateSubcommandCompletions()"), end = source.indexOf("\n  }", begin) + 4
    var complete = new Function("return (" + source.substring(begin, end) + ")")()
    assert(complete().join(","), "fork,clean,auto,--", "Terminal and browser completion inventory includes modifiers and literal escape")
  }
  exports.testGrandchildCleanAndCoveredInputs = function() {
    var f = fixture({ knowledge: "configured", _forkInheritedKnowledge: "parent view" }, state())
    var r = submit(f, "x", {}, { forkpolicy: "clean" })
    assert(r.args.knowledge, "configured", "Clean grandchild does not regain incoming automatic view")
    assert(isUnDef(r.args._forkInheritedKnowledge), true, "Incoming marker does not configure future handoffs")
    f.manager.destroy()
    f = fixture({}, { workingMemory: { facts: [{ v: "deployment access ORCHID" }] } })
    r = submit(f, "deployment access", { knowledge: "deployment access ORCHID" })
    assert(r.task.forkPolicy.scope, "clean", "Already supplied facts do not require a second copy")
    f.manager.destroy()
  }
  exports.testProjectionDoesNotCallModels = function() {
    load("mini-a-history-vm.js")
    var a = new MiniA(), calls = 0, seen
    a._syncContextSources = function() { calls++; throw "Must not refresh model-ranked sources" }
    a._historyVm = { contextVirtualization: true, objects: [
      { handle: "memory", kind: "memory" }, { handle: "knowledge", kind: "evidence", provenance: { source: "provided-knowledge" } }, { handle: "tool", kind: "artifact" }
    ], assembleContext: function(opts) { seen = opts; return { objects: [] } }, serializeContext: function() { return { text: "" } } }
    assert(a._contextForDelegate("goal", 2048, { forkPolicy: true }), "", "Empty views do not invent useful context")
    assert(calls, 0, "Collection is provider-free")
    assert(seen.deterministic, true, "Assembly cannot generate a handoff summary")
    assert(seen.excludeIds.join(","), "memory,knowledge", "Memory and configured knowledge are not projected twice")
    var vm = Object.create(MiniAHistoryVM.prototype)
    vm.contextVirtualization = true; vm.branchId = "b"; vm.metrics = { representation_l2: 0 }
    vm._resolveObject = function() { return { branchId: "b", id: "item" } }
    vm._representationLevel = function() { return "L2" }
    vm._buildRepresentation = function() { return { text: "deterministic excerpt", estimatedTokens: 20 } }
    vm.semanticCompression = true; vm.semanticCompressor = function() { throw "Must not generate" }
    assert(vm.getRepresentation("item", "L2", { deterministic: true, touch: false }).text, "deterministic excerpt", "Deterministic projection bypasses semantic compression")
    vm.representationCache = { cached: { estimatedTokens: 1 } }; vm._representationCacheKey = function() { return "cached" }
    assert(vm._contextRepresentationCost({}, "L2", { deterministic: true }), 20, "Deterministic budgets cannot reuse cheaper semantic representation costs")
    assert(vm._contextRepresentationCost({}, "L2"), 1, "Existing semantic cache behavior is preserved")
  }
  exports.testWorkerPreparedContextAndOperatorLimits = function() {
    var source = io.readFileString("mini-a-worker.yaml"), begin = source.indexOf("var taskArgs = postData.args || {}"), end = source.indexOf("if (isArray(taskArgs._skillHandoff))", begin)
    var accept = new Function("wargs", "postData", source.substring(begin, end) + "\nreturn { args: mergedArgs }")
    var incoming = { version: 1, state: '{"forkedContext":["COBALT"]}', knowledge: "view" }
    var r = accept({ forkdecide: false, usedecide: false, usememory: false }, { args: { forkdecide: true, usedecide: true, knowledge: "explicit", modeldec: "DO_NOT_ACCEPT" }, forkContext: incoming })
    assert(r.args.forkdecide, false, "Worker fork decision opt-out cannot be undone")
    assert(r.args.usedecide, false, "Worker general opt-out cannot be undone")
    assert(isUnDef(r.args.modeldec), true, "Worker does not accept decision credentials")
    assert(r.args.knowledge, "\nexplicit", "Remote knowledge remains literal configured data")
    assert(r.args._forkInheritedKnowledge, "view", "Prepared projection is separate and not duplicated")
    assert(r.args.state, incoming.state, "Incoming state is accepted without reclassification")
    var memory = accept({ usememory: false }, { args: {}, forkContext: { version: 1, state: '{"workingMemory":{"facts":["secret"]}}' } })
    assert(memory.code, 400, "Operator-disabled memory is not made available")
    assert(accept({ forkstatemaxbytes: 10 }, { args: {}, forkContext: incoming }).code, 400, "Worker enforces UTF-8 combined limit")
    var f = fixture({}, state())
    f.manager.remoteDelegation = true; f.manager.workers = ["http://worker"]
    f.manager._workerProfiles["http://worker"] = { capabilities: ["prepared-context-v1"], limits: { forkMemory: false, forkStateMaxBytes: 1000 } }
    assert(submit(f, "deployment access").task.forkPolicy.scope, "clean", "Remote memory eligibility follows worker configuration")
    f.manager.destroy()
  }
  exports.testRemotePreparedParityAndCredentials = function() {
    ;[false, true].forEach(function(a2a) {
      var f = fixture({ modeldec: { key: "DO_NOT_FORWARD" } }, state()), wire
      f.manager.remoteDelegation = true; f.manager.useA2A = a2a; f.manager.workers = ["http://worker"]
      f.manager._workerProfiles["http://worker"] = { capabilities: ["prepared-context-v1"], limits: { forkMemory: true, forkStateMaxBytes: 65536 } }
      f.manager._nextWorkerForSubtask = function() { return "http://worker" }
      f.manager._processQueue = function() {}
      f.manager._remoteRequest = function(url, path, payload) {
        wire = payload
        var task = f.manager.subtasks[Object.keys(f.manager.subtasks)[0]]
        task.status = "cancelled" // End before polling; this test inspects the real submission.
        return a2a ? { task: { id: "remote" } } : { taskId: "remote" }
      }
      f.manager._cancelRemoteSubtask = function() {}
      var id = f.manager.submit("x", {}, { forkpolicy: "full" }), task = f.manager.subtasks[id]
      task.status = "running"; task.startedAt = now(); task.attempt = 1
      var local = f.manager._buildChildArgs(task)
      f.manager._startRemoteSubtask(task, "fixture")
      $doWait(task._executionPromise)
      var context = a2a ? wire.metadata.forkContext : wire.forkContext
      var args = a2a ? wire.metadata.args : wire.args
      assert(context.state, local.state, "Local and remote prepared state match")
      assert(context.diagnostics.snapshot_id, task.forkPolicy.snapshot_id, "Same resolved snapshot is transported")
      assert(isUnDef(args.modeldec), true, "Parent decision credentials are removed from remote arguments")
      assert(isUnDef(args.state), true, "State travels once in the prepared envelope")
      assert(isUnDef(args._forkInheritedKnowledge), true, "Views travel once in the prepared envelope")
      assert(stringify(context).indexOf("DO_NOT_FORWARD"), -1, "Policy wire metadata contains no credentials")
      assert(f.manager.forkMetrics.resolutions, 1, "Remote argument rebuilding does not resolve again")
      f.manager.destroy()
    })
  }
  exports.testActualLocalExecutionAndRetry = function() {
    var f = fixture({}, state()), inputs = []
    f.agent._prepareChildMcpHandoff = function(child) {
      child.init = function(args) { inputs.push(args.state) }
      child.start = function() { if (inputs.length === 1) throw new Error("transient child failure"); return "ready" }
      child.getMetrics = function() { return {} }
    }
    try {
      var id = f.manager.submitAndRun("deployment access", {}, { forkpolicy: "memory", maxAttempts: 2 })
      var task = f.manager.subtasks[id]
      $doWait(task._executionPromise)
      // Queue processing can replace the promise during the first finalizer.
      $doWait(task._executionPromise)
      assert(task.status, "completed", "Existing retry lifecycle completes")
      assert(inputs.length, 2, "Child really executed twice")
      assert(inputs[0], inputs[1], "Actual retries receive identical inheritance")
      assert(f.manager.forkMetrics.resolutions, 1, "Retry never resolves again")
    } finally { f.manager.destroy() }
  }
  exports.testPairedEvaluationContracts = function() {
    load("mini-a-eval.js")
    // Distinct held-out facts/terms from the policy unit fixtures above.
    var scenarios = [
      { name: "memory fact", goal: "release signing", expected: { equals: "MARIGOLD" }, required: "MARIGOLD", decision: "memory" },
      { name: "history fact", goal: "migration receipt", expected: { equals: "AMBER" }, required: "AMBER", decision: "context" },
      { name: "combined facts", goal: "release signing migration receipt", expected: { equals: "MARIGOLD AMBER" }, required: ["MARIGOLD", "AMBER"], decision: "full" },
      { name: "independent", goal: "independent arithmetic", expected: { equals: "ready" }, decision: "clean" },
      { name: "multilingual", goal: "chave implantação", expected: { equals: "VIOLETA" }, required: "VIOLETA", decision: "memory" },
      { name: "irrelevant large memory", goal: "independent arithmetic", expected: { equals: "ready" }, decision: "clean", large: true },
      { name: "noisy tool", goal: "Summarize this supplied log and reply ready.\n" + repeat(128, "noise entry\n"), expected: { equals: "ready" }, decision: "clean", completeInputs: true }
    ]
    scenarios.forEach(function(s) { s.variants = [ { name: "legacy", args: { forkpolicy: "legacy" } }, { name: "deterministic", args: { forkpolicy: "auto", forkdecide: false } }, { name: "assisted", args: { forkpolicy: "auto", forkdecide: true } } ] })
    var evaluator = new MiniAEval({ agentFactory: function(scenario) {
      var f = fixture({}, {}), a = f.agent
      a.getMetrics = function() { return { fork_policy: clone(f.manager.forkMetrics), decisions: clone(a._decisionMetrics || {}) } }
      a.init = function(args) {
        f.manager.parentArgs.forkpolicy = args.forkpolicy
        f.manager.parentArgs.forkdecide = args.forkdecide
        a._agentState = { workingMemory: { facts: [{ key: "release signing", v: "release signing phrase is MARIGOLD" }, { v: "chave implantação VIOLETA" }] }, forkedContext: ["migration receipt reference is AMBER"] }
        if (scenario.large) a._agentState.workingMemory.facts.push({ v: repeat(30000, "irrelevant ") })
        a._runtime.context = a._agentState.forkedContext
        if (args.forkdecide) decision(f, scenario.decision)
      }
      a.start = function(args) {
        try {
          var r = submit(f, args.goal, {}, { _forkSelfContained: scenario.completeInputs === true }), supplied = (r.args.state || "") + (r.args.knowledge || "") + (r.args._forkInheritedKnowledge || "")
          var required = isArray(scenario.required) ? scenario.required : (scenario.required ? [scenario.required] : [])
          return required.length ? (required.every(function(fact) { return supplied.indexOf(fact) >= 0 }) ? required.join(" ") : "missing") : "ready"
        } finally { f.manager.destroy() }
      }
      return a
    } })
    var report = evaluator.run(scenarios)
    assert(report.scenarios.length, 21, "Matched variants use the existing evaluator")
    assert(report.scenarios.filter(function(r) { return r.variant !== "legacy" }).every(function(r) { return r.success }), true, "Automatic fixtures deliver required parent-only facts")
    assert(report.scenarios.some(function(r) { return r.variant === "legacy" && !r.success }), true, "Legacy absence of implicit snapshots is measured")
    assert(report.scenarios.every(function(r) { return r.metrics.fork_resolutions === 1 }), true, "Policy metrics are normalized by MiniAEval")
    assert(report.scenarios.some(function(r) { return r.metrics.decision_calls === 1 && r.metrics.decision_total_tokens === 7 }), true, "Existing decision usage accompanies policy work without duplication")
  }

  exports.testToolAndEntrypointIntent = function() {
    var f = fixture({}, state()), seen
    f.agent._buildChildMcpHandoffArgs = function() { return {} }
    f.manager.submitAndRun = function(goal, args, opts) { seen = opts; return "fixture" }
    f.agent._subtaskManager = f.manager
    var config = f.agent._createDelegationMcpConfig({})
    var schema = config.options.fnsMeta["delegate-subtask"].inputSchema.properties
    assert(isUnDef(schema.fork.default), true, "Tool schema does not fabricate explicit false")
    config.options.fns["delegate-subtask"]({ goal: "independent task", waitForResult: false })
    assert(isUnDef(seen.fork), true, "Core tool preserves omission")
    config.options.fns["delegate-subtask"]({ goal: "independent task", fork: false, waitForResult: false })
    assert(seen.fork, false, "Core tool preserves explicit false")
    ;["mini-a.yaml", "mini-a-web.yaml", "mini-a-worker.yaml"].forEach(function(path) {
      var descriptor = io.readFileYAML(path)
      assert(descriptor.help.expects.some(function(option) { return option.name === "forkpolicy" }), true, path + " documents forkpolicy")
      assert(descriptor.help.expects.some(function(option) { return option.name === "forkdecide" }), true, path + " documents forkdecide")
    })
    f.manager.destroy()
  }
  exports.testConcurrentAllowance = function() {
    var f = fixture({}, state()), seen = decision(f, "abstain"), jobs = []
    for (var i = 0; i < 12; i++) (function(index) { jobs.push($doV(function() { return submit(f, "ambiguous handoff " + index).task.forkPolicy })) })(i)
    jobs.forEach(function(job) { $doWait(job) })
    assert(f.manager.forkMetrics.resolutions, 12, "Concurrent resolutions are recorded once each")
    assert(f.manager.forkMetrics.classifier_attempts, 8, "Concurrent submissions share the run allowance")
    assert(f.agent._decisionMetrics.calls, 8, "Concurrent observed usage is not lost")
    assert(f.agent._decisionMetrics.total_tokens, 56, "Concurrent observed tokens are charged once each")
    f.manager.destroy()
  }
  exports.testSubmissionOptOutAndConfigurationStayBounded = function() {
    var f = fixture({}, state()), seen = decision(f, "memory")
    f.manager.parentArgs.forkdecide = false
    var id = f.manager.submit("ambiguous handoff", {}, {})
    f.manager.parentArgs.forkdecide = true
    var task = f.manager.subtasks[id]; task.status = "running"
    f.manager._buildChildArgs(task)
    assert(seen.calls, 0, "Later settings cannot enable a classifier opted out at submission")
    assert(task.forkPolicy.reason, "decision_disabled", "Submission opt-out is retained")
    id = f.manager.submit("another ambiguous handoff", {}, {})
    f.agent._decision._config.model = "changed"
    task = f.manager.subtasks[id]; task.status = "running"
    f.manager._buildChildArgs(task)
    assert(seen.calls, 0, "Queued snapshots do not silently switch decision configuration")
    assert(task.forkPolicy.reason, "decision_config_changed", "Changed configuration is diagnosed")
    f.manager.destroy()
  }
  exports.testLowerRequestAndDeadlineLimits = function() {
    var f = fixture({ maxcontext: 50 }, state()), seen = decision(f, "memory")
    assert(submit(f, "ambiguous handoff").task.forkPolicy.reason, "request_budget", "Question and constraints are not truncated to fit a tiny token budget")
    assert(seen.calls, 0, "Lower context limits skip classification")
    f.manager.parentArgs.maxcontext = 0
    var id = f.manager.submit("ambiguous handoff", {}, {}), task = f.manager.subtasks[id]
    task.status = "running"; task.totalDeadlineAt = now() - 1
    f.manager._buildChildArgs(task)
    assert(task.forkPolicy.reason, "latency_budget", "Expired deadline prevents an optional request")
    assert(seen.calls, 0, "No request after expiry")
    f.manager.destroy()
  }
  exports.testRunAllowanceAndBootstrapLimiter = function() {
    var a = new MiniA()
    a._forkPolicyRun = "first"
    a._initDecisionRuntime({ usedecide: false })
    var runtime = a._forkDecisionRuntime
    runtime.attempts = 8
    a._initDecisionRuntime({ usedecide: false })
    assert(a._forkDecisionRuntime.attempts, 8, "Init and main-loop decision setup share one allowance")
    a._forkPolicyRun = "second"
    a._initDecisionRuntime({ usedecide: false })
    assert(a._forkDecisionRuntime.attempts, 0, "A new init starts a fresh run allowance")
    var f = fixture({ rpm: 1 }, state()), seen = decision(f, "memory")
    f.agent._decisionToolControls = __
    assert(submit(f, "ambiguous first").task.forkPolicy.source, "decision", "Console bootstrap uses the standard nonwaiting limiter")
    assert(submit(f, "ambiguous second").task.forkPolicy.reason, "rate_pressure", "Bootstrap reservations are retained")
    assert(seen.calls, 1, "Only one request is admitted")
    f.manager.destroy()
    var limiter = a._createRateLimiter({ rpm: 10 })
    limiter.beforeCall()
    assert(limiter.tryBeforeCall(), false, "Optional classifier skips while a normal limited call is in flight")
    limiter.afterCall(0)
    assert(limiter.tryBeforeCall(), true, "Completed call releases conservative admission guard")
  }
  exports.testActualPromptKeepsConfiguredAndInheritedKnowledgeSeparate = function() {
    var file = String(java.nio.file.Files.createTempFile("mini-a-fork-knowledge-", ".txt").toAbsolutePath()), agent = new MiniA(), manager
    agent.fnI = function() {}; agent._trace = function() {}
    io.writeFileString(file, "CONFIGURED_KNOWLEDGE")
    try {
      var args = { goal: "fixture", model: stringify({ type: "ollama", model: "fixture", url: "http://127.0.0.1:1" }),
        useshell: false, usetools: false, useutils: false, usememory: false, usedelegation: false,
        useplanning: false, usedecide: false, llmcomplexity: false, noagentsmd: true,
        knowledge: file, _forkInheritedKnowledge: "\nBEGIN_UNTRUSTED_CONTEXT\nINHERITED_CONTEXT\nEND_UNTRUSTED_CONTEXT" }
      agent.init(args)
      assert(agent._systemInst.indexOf("CONFIGURED_KNOWLEDGE") >= 0, true, "Configured prompt files still resolve before inheritance is added")
      assert(agent._systemInst.split("INHERITED_CONTEXT").length, 2, "Actual child instructions include exactly one inherited view")
      assert(String(agent._promptArgs.knowledge).indexOf("INHERITED_CONTEXT"), -1, "Inherited view never becomes configured knowledge")
      manager = new SubtaskManager(agent._promptArgs, { parentAgent: agent }); manager._startWatchdog = function() {}
      var id = manager.submit("next", {}, { forkpolicy: "clean" }), child = manager._buildChildArgs(manager.subtasks[id])
      assert(isUnDef(child._forkInheritedKnowledge), true, "Actual clean grandchild receives no inherited-view argument")
    } finally { if (manager) manager.destroy(); agent._stopAgentResources(); io.rm(file) }
  }
  exports.testExpiredPreparationCannotStartChild = function() {
    var f = fixture({}, state()), handedOff = false, original = f.manager._buildChildArgs
    f.agent._prepareChildMcpHandoff = function() { handedOff = true }
    f.manager._buildChildArgs = function(task) {
      var args = original.call(this, task)
      task.totalDeadlineAt = now() - 1
      return args
    }
    try {
      var id = f.manager.submitAndRun("deployment access", {}, { forkpolicy: "memory" }), task = f.manager.subtasks[id]
      $doWait(task._executionPromise)
      assert(task.status, "timeout", "Deadline expiry during preparation is terminal")
      assert(handedOff, false, "An expired prepared task never initializes a child")
      assert(f.manager.runningCount, 0, "Expired preparation releases its slot")
    } finally { f.manager.destroy() }
  }
  exports.testStartupTriggerPreservesIntentAndLegacyDefaults = function() {
    var f = fixture({}, state()), records = [], source = io.readFileString("mini-a.js")
    f.agent._agentState.workingMemorySession = { facts: [{ v: "SESSION_ONLY" }] }
    f.agent._startupSubtaskIds = []
    var begin = source.indexOf("      _startupGoals.forEach(function(entry) {"), end = source.indexOf("      if (_startupGoals.length > 0", begin)
    var runStartup = new Function("_startupGoals", "_mgr", "_self", "_startupArgs", source.substring(begin, end))
    var manager = { submitAndRun: function(goal, args, opts) { var r = submit(f, goal, args, opts); records.push(r); return r.task.id } }
    runStartup([
      { goal: "legacy default", fork: true, forkpolicy: "legacy" },
      { goal: "auto explicit default", fork: true },
      { goal: "legacy context", fork: true, forkscope: ["context"], forkpolicy: "legacy" },
      { goal: "explicit clean", fork: false }
    ], manager, f.agent, { usememory: true })
    assert(records.length, 4, "All startup calls use the common submission path")
    assert(isUnDef(jsonParse(records[0].args.state).workingMemorySession), true, "Per-task legacy preserves startup working-memory-only default")
    assert(isUnDef(jsonParse(records[1].args.state).workingMemorySession), true, "Explicit startup fork keeps its established default under auto")
    assert(jsonParse(records[2].args.state).forkedContext.length, 1, "Explicit startup scope requests are honored")
    assert(isUnDef(records[3].args.state), true, "Startup explicit false remains an opt-out")
    f.manager.destroy()
  }
})()
