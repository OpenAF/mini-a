(function() {
  load("mini-a.js")
  load("mini-a-subtask.js")
  var check = function(value, expected, message) { ow.test.assert(value, expected, message) }
  var config = { type: "fixture", model: "risk" }
  var fixture = function(risk, options) {
    var a = new MiniA(), seen = { calls: 0, prompts: 0, execution: 0, traces: [] }
    a.fnI = function() {}
    a._trace = function(name, data) { seen.traces.push({ name: name, data: clone(data) }) }
    a._initDecisionRuntime(merge({ modeldec: config, goal: "Inspect fixtures" }, options || {}))
    a._decision = new MiniADecision({ modeldec: config, supportsBoundedRequests: true,
      clientFactory: function(c) { return { getCapabilities: function() { return {} }, decideWithStats: function(state) {
        seen.calls++; seen.state = state; seen.timeout = c.timeout
        if (risk === "failure") throw new Error("private provider details")
        return { response: { answers: { risk: { type: "choice", value: risk } } } }
      } } } })
    a.setConfirmFn(function(label, choices) { seen.prompts++; seen.label = label; seen.choices = choices; return 0 })
    a._runHook = function(name) { if (name === "before_shell") { seen.execution++; return { blocked: true } }; return {} }
    a._alwaysExec = true
    return { a: a, seen: seen }
  }
  exports.riskThresholds = function() {
    ;["low", "medium", "high", "critical", "unknown", "bogus", "failure"].forEach(function(risk) {
      var f = fixture(risk)
      f.a._runCommand({ command: "echo fixture", readwrite: true })
      check(f.seen.calls, 1, risk + " assessed")
      check(f.seen.execution, risk === "low" ? 1 : 0, risk + " execution")
      check(f.seen.prompts, ["low", "critical"].indexOf(risk) >= 0 ? 0 : 1, risk + " approval")
      check(f.seen.timeout, 5000, "bounded transport")
      check(f.seen.traces.some(function(t) { return t.name === "shell_guard" && isNumber(t.data.duration_ms) }), true, "audit")
    })
    var custom = fixture("medium", { shellguardask: "low", shellguarddeny: "medium" })
    custom.a._runCommand({ command: "echo fixture", readwrite: true })
    check(custom.seen.prompts, 0, "deny threshold wins")
    check(custom.seen.execution, 0, "custom denial")
  }
  exports.hardChecksFirst = function() {
    var f = fixture("low")
    f.a._runCommand({ command: "rm fixture", readwrite: false })
    check(f.seen.calls, 0, "readwrite denial precedes assessment")
    f.a._initPolicyRuntime({ policy: { shell: "deny" } })
    f.a._runCommand({ command: "echo fixture", readwrite: true })
    check(f.seen.calls, 0, "policy denial precedes assessment")
  }
  exports.approvalPrecedence = function() {
    var f = fixture("low")
    f.a._runCommand({ command: "echo fixture", readwrite: true, checkall: true })
    check(f.seen.prompts, 1, "checkall overrides Always")
    f.a._initPolicyRuntime({ policy: { shell: "approval" } })
    f.a._runCommand({ command: "echo fixture", readwrite: true })
    check(f.seen.prompts, 2, "policy approval overrides Always")
    check(f.seen.choices.join(","), "Deny,Allow once", "no persistent grant")
    check(f.seen.execution, 0, "refused")
    var off = fixture("low", { shellguard: "off" })
    off.a._runCommand({ command: "echo fixture", readwrite: true, checkall: true })
    check(off.seen.prompts, 1, "explicit approval fixed even with guard off")
    check(off.seen.calls, 0, "disabled guard skips provider")
  }
  exports.onceAndBatch = function() {
    var f = fixture("high")
    f.a.setConfirmFn(function() { f.seen.prompts++; return 1 })
    for (var i = 0; i < 2; i++) f.a._runCommand({ command: "echo fixture", readwrite: true })
    check(f.seen.calls, 2, "no assessment cache")
    check(f.seen.prompts, 2, "no approval cache")
    check(f.seen.execution, 2, "approved commands reach hook")
    f.a._shellBatch = true
    f.a._runCommand({ command: "echo fixture", readwrite: true })
    check(f.seen.prompts, 2, "headless cannot ask")
    check(f.seen.execution, 2, "headless blocks")
    f.a._decision = undefined
    f.a._runCommand({ command: "echo fixture", readwrite: true })
    check(f.seen.execution, 2, "required missing worker model blocks")
  }
  exports.contextAndOversize = function() {
    var f = fixture("medium")
    f.a._shellPrefix = "docker exec fixture"
    f.a._runCommand({ command: "echo fixture", readwrite: true, shellprefix: "custom prefix", sandboxnonetwork: true })
    check(f.seen.state.prefix, "custom prefix", "effective prefix")
    check(f.seen.state.restrictions.sandboxnonetwork, true, "network restriction")
    check(f.seen.state.directory, String(new java.io.File(".").getCanonicalPath()), "directory")
    check(f.seen.label.indexOf("custom prefix") >= 0, true, "approval context")
    f.a._runCommand({ command: "echo " + "x".repeat(50000), readwrite: true })
    check(f.seen.calls, 1, "oversized input never truncated and sent")
    check(f.seen.prompts, 2, "oversized input asks")
  }
  exports.configurationAndInheritance = function() {
    check(MiniAShellGuard.resolve({ modeldec: "" }).enabled, false, "no model leaves guard disabled")
    check(MiniAShellGuard.resolve({ modeldec: config }).enabled, true, "auto enabled")
    ;[{ shellguard: "bad" }, { shellguardask: "bad" }, { shellguarddeny: "bad" }, { shellguardtimeout: 0 }].forEach(function(args) {
      var threw = false
      try { MiniAShellGuard.resolve(args) } catch(e) { threw = true }
      check(threw, true, "invalid guard options rejected")
    })
    check(MiniAShellGuard.resolve({ modeldec: config, usedecide: false }).enabled, false, "opt out")
    var invalid = false
    try { MiniAShellGuard.resolve({ shellguard: "decide", usedecide: false }) } catch(e) { invalid = true }
    check(invalid, true, "explicit conflicting configuration rejected")
    var inherited = { enabled: true, ask: "low", deny: "high", timeout: 1000 }
    var resolved = MiniAShellGuard.resolve({ shellguard: "off", _shellGuardRequired: inherited })
    check(resolved, inherited, "cannot disable inherited restriction")
    var f = fixture("low")
    var m = new SubtaskManager({ modeldec: config, forkpolicy: "legacy", shellguardask: "low" }, { parentAgent: f.a })
    m._startWatchdog = function() {}
    var id = m.submit("Inspect", { shellguard: "off", shellguardask: "critical", usedecide: false, modeldec: "", _shellGuardRequired: inherited })
    var args = m._buildChildArgs(m.subtasks[id])
    check(MiniAShellGuard.resolve(args).ask, "low", "child cannot weaken parent")
    check(args.modeldec, config, "child cannot replace required assessor")
    check(args.usedecide !== false, true, "child cannot disable required assessor")
    check(args._shellGuardRequired.deny, "high", "child may only tighten inherited contract")
  }
  exports.rateLimitAndTransportFailure = function() {
    var f = fixture("low")
    f.a._decisionToolControls = { tryBeforeCall: function() { return false } }
    f.a._runCommand({ command: "echo fixture", readwrite: true })
    check(f.seen.calls, 0, "rate-limited guard never calls provider")
    check(f.seen.prompts, 1, "rate pressure requires approval")
    f.a._decisionToolControls = undefined
    f.a._decision.bounded = function() { throw new Error("timeout") }
    f.a._runCommand({ command: "echo fixture", readwrite: true })
    check(f.seen.prompts, 2, "transport failure requires approval")
    f.a._shellBatch = true
    f.a._runCommand({ command: "echo fixture", readwrite: true })
    check(f.seen.execution, 0, "transport failure never runs headless")
  }
  exports.entrypointSettings = function() {
    ["mini-a.yaml", "mini-a-web.yaml"].forEach(function(path) {
      var spec = io.readFileYAML(path)
      check(isMap(spec), true, "valid YAML " + path)
    })
    var f = fixture("low")
    f.a._shellCheckAll = true
    f.a._runCommand({ command: "echo fixture", readwrite: true, checkall: false })
    check(f.seen.prompts, 1, "per-command arguments cannot bypass run checkall")
  }
  exports.builtInShellTools = function() {
    ;[false, true].forEach(function(standard) {
      var f = fixture("critical")
      var config = f.a._createShellMcpConfig({ useshell: true, readwrite: true, usestdutils: standard })
      var result = config.options.fns[standard ? "bash" : "shell"]({ command: "echo fixture", description: "fixture", shellguard: "off" })
      check(result.content[0].text.indexOf("[blocked]") === 0, true, "built-in shell tool guarded")
      check(f.seen.calls, 1, "tool arguments cannot disable assessment")
      check(f.seen.execution, 0, "tool denial cannot execute")
    })
  }
  exports.auditMetadata = function() {
    var f = fixture("critical"), records = []
    f.a.fnI = function(event, message) { records.push({ event: event, meta: this._pendingAuditMeta }); this._pendingAuditMeta = undefined }
    f.a._runCommand({ command: "echo PRIVATE-COMMAND-FIXTURE", readwrite: true })
    check(records.some(function(r) { return r.event === "shell_guard" && r.meta.shell_guard.risk === "critical" }), true, "classification audit metadata")
    check(records.some(function(r) { return r.event === "shell_guard_approval" && r.meta.shell_guard_approval.approved === false }), true, "denial audit metadata")
    check(stringify(records).indexOf("PRIVATE-COMMAND-FIXTURE") < 0, true, "no additional raw command logging")
  }
  exports.harmlessExecution = function() {
    var f = fixture("low")
    f.a._runHook = function() { return {} }
    var result = f.a._runCommand({ command: "echo shell-guard-fixture", readwrite: true })
    check(result.output.indexOf("shell-guard-fixture") >= 0, true, "allowed shell actually runs")
  }
})()
