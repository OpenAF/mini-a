(function() {
  load("mini-a.js")

  var createAgent = function() {
    var a = new MiniA()
    a.fnI = function() {}
    return a
  }

  var mkTempDir = function() {
    var d = java.io.File.createTempFile("mini-a-outerloop-", "").getCanonicalPath()
    io.rm(d)
    io.mkdir(d)
    return d
  }

  var rmTempDir = function(d) {
    try { io.rm(d) } catch(e) {}
  }

  // ─── _initOuterLoop ─────────────────────────────────────────────────────────

  exports.testOuterLoopInitDisabledWhenFlagFalse = function() {
    var a = createAgent()
    var tmpDir = mkTempDir()
    try {
      var st = a._initOuterLoop({ outerloop: false, homedir: tmpDir })
      ow.test.assert(st === null, true, "_initOuterLoop should return null when outerloop is false")
    } finally { rmTempDir(tmpDir) }
  }

  exports.testOuterLoopInitMaxTimeZeroDisablesLimit = function() {
    var a = createAgent()
    var tmpDir = mkTempDir()
    try {
      var st = a._initOuterLoop({ outerloop: true, homedir: tmpDir, outerloopmaxtime: 0 })
      ow.test.assert(isMap(st), true, "_initOuterLoop should return a map")
      ow.test.assert(st.maxTime === 0, true, "outerloopmaxtime=0 should disable the time limit, got: " + st.maxTime)
    } finally { rmTempDir(tmpDir) }
  }

  exports.testOuterLoopInitMaxTimeNegativeClampedToZero = function() {
    var a = createAgent()
    var tmpDir = mkTempDir()
    try {
      var st = a._initOuterLoop({ outerloop: true, homedir: tmpDir, outerloopmaxtime: -99 })
      ow.test.assert(st.maxTime === 0, true, "Negative outerloopmaxtime should clamp to 0 (disabled), got: " + st.maxTime)
    } finally { rmTempDir(tmpDir) }
  }

  exports.testOuterLoopInitCustomSessionId = function() {
    var a = createAgent()
    var tmpDir = mkTempDir()
    try {
      var st = a._initOuterLoop({ outerloop: true, homedir: tmpDir, outerloopsessionid: "my-session-123" })
      ow.test.assert(st.sessionId === "my-session-123", true, "Custom sessionid should be used as-is, got: " + st.sessionId)
      ow.test.assert(io.fileExists(st.sessionDir), true, "Session directory should be created")
      ow.test.assert(st.sessionDir.indexOf("my-session-123") >= 0, true, "Session dir should contain the custom id")
    } finally { rmTempDir(tmpDir) }
  }

  exports.testOuterLoopInitAutoSessionId = function() {
    var a = createAgent()
    var tmpDir = mkTempDir()
    try {
      var st = a._initOuterLoop({ outerloop: true, homedir: tmpDir })
      ow.test.assert(isString(st.sessionId), true, "Session id should be auto-generated as a string")
      ow.test.assert(/^session-\d{8}-\d{6}-/.test(st.sessionId), true, "Auto-generated id should match pattern session-YYYYMMDD-HHmmss-<id>, got: " + st.sessionId)
      ow.test.assert(io.fileExists(st.sessionDir), true, "Session directory should be created")
    } finally { rmTempDir(tmpDir) }
  }

  exports.testOuterLoopInitDefaultMaxCycles = function() {
    var a = createAgent()
    var tmpDir = mkTempDir()
    try {
      var st = a._initOuterLoop({ outerloop: true, homedir: tmpDir })
      ow.test.assert(st.maxCycles === 5, true, "Default maxCycles should be 5, got: " + st.maxCycles)
    } finally { rmTempDir(tmpDir) }
  }

  // ─── _padOuterLoopCycle ──────────────────────────────────────────────────────

  exports.testOuterLoopPadCycle = function() {
    var a = createAgent()
    ow.test.assert(a._padOuterLoopCycle(1) === "0001", true, "Cycle 1 should pad to '0001'")
    ow.test.assert(a._padOuterLoopCycle(42) === "0042", true, "Cycle 42 should pad to '0042'")
    ow.test.assert(a._padOuterLoopCycle(1234) === "1234", true, "Cycle 1234 should stay '1234'")
    ow.test.assert(a._padOuterLoopCycle(99999) === "99999", true, "Cycle > 9999 should not truncate")
    ow.test.assert(a._padOuterLoopCycle(-1) === "0000", true, "Negative cycle should clamp to '0000'")
  }

  // ─── _collectOuterLoopChangedFiles ───────────────────────────────────────────

  exports.testOuterLoopCollectChangedFilesDetectsNewFiles = function() {
    var trackDir = mkTempDir()
    try {
      var a = createAgent()
      io.writeFileString(trackDir + "/a.txt", "content a")
      var result = a._collectOuterLoopChangedFiles(trackDir, {})
      ow.test.assert(isMap(result), true, "Result should be a map")
      ow.test.assert(isArray(result.changed), true, "Result.changed should be an array")
      ow.test.assert(result.changed.length > 0, true, "New file should appear in changed list")
      var fp = Object.keys(result.snapshot)[0]
      ow.test.assert(isMap(result.snapshot[fp]), true, "Snapshot should record file metadata")
    } finally { rmTempDir(trackDir) }
  }

  exports.testOuterLoopCollectChangedFilesDetectsDeletedFiles = function() {
    var trackDir = mkTempDir()
    try {
      var a = createAgent()
      var fakePrev = {}
      fakePrev[trackDir + "/deleted.txt"] = { size: 10, mtime: 1000 }
      var result = a._collectOuterLoopChangedFiles(trackDir, fakePrev)
      ow.test.assert(result.changed.indexOf(trackDir + "/deleted.txt") >= 0, true, "Deleted file should appear in changed list")
    } finally { rmTempDir(trackDir) }
  }

  exports.testOuterLoopCollectChangedFilesUnchangedFilesOmitted = function() {
    var trackDir = mkTempDir()
    try {
      var a = createAgent()
      io.writeFileString(trackDir + "/stable.txt", "hello")
      var first = a._collectOuterLoopChangedFiles(trackDir, {})
      var second = a._collectOuterLoopChangedFiles(trackDir, first.snapshot)
      ow.test.assert(second.changed.length === 0, true, "Unchanged files should not appear in changed list, got: " + JSON.stringify(second.changed))
    } finally { rmTempDir(trackDir) }
  }

  // ─── _runOuterLoop ───────────────────────────────────────────────────────────

  exports.testOuterLoopStructuredOutputSerialized = function() {
    var a = createAgent()
    var tmpDir = mkTempDir()
    var callCount = 0
    a._startInternal = function() {
      callCount++
      return { action: "final", answer: "structured" }
    }
    a._validateResearchOutcome = function(outStr) {
      ow.test.assert(outStr.indexOf("[object Object]") < 0, true, "Structured output must not become '[object Object]', got: " + outStr)
      ow.test.assert(outStr.indexOf("structured") >= 0, true, "Serialized output should contain the answer value, got: " + outStr)
      return { verdict: "PASS", feedback: "ok" }
    }
    try {
      a._runOuterLoop({
        outerloop: true,
        homedir: tmpDir,
        outerloopsessionid: "test-structured",
        outerloopmaxcycles: 1,
        validationgoal: "check output",
        trackchanges: false
      }, now())
      ow.test.assert(callCount === 1, true, "Should run exactly one cycle, got: " + callCount)
    } finally { rmTempDir(tmpDir) }
  }

  exports.testOuterLoopValidationPassCompletesSession = function() {
    var a = createAgent()
    var tmpDir = mkTempDir()
    a._startInternal = function() { return "cycle output" }
    a._validateResearchOutcome = function() { return { verdict: "PASS", feedback: "looks good" } }
    try {
      a._runOuterLoop({
        outerloop: true,
        homedir: tmpDir,
        outerloopsessionid: "test-pass",
        outerloopmaxcycles: 5,
        validationgoal: "check something",
        trackchanges: false
      }, now())
      var statePath = tmpDir + "/.openaf-mini-a/sessions/test-pass/state.json"
      var state = io.readFileJSON(statePath)
      ow.test.assert(state.status === "complete", true, "State status should be 'complete' when validation passes, got: " + state.status)
      ow.test.assert(state.cycle_number === 1, true, "Should stop after 1 cycle on immediate PASS, got: " + state.cycle_number)
    } finally { rmTempDir(tmpDir) }
  }

  exports.testOuterLoopStopOnNoChange = function() {
    var a = createAgent()
    var tmpDir = mkTempDir()
    var emptyTrackDir = mkTempDir()
    var cycles = 0
    a._startInternal = function() { cycles++; return "no output" }
    a._validateResearchOutcome = function() { return { verdict: "REVISE", feedback: "not done" } }
    try {
      a._runOuterLoop({
        outerloop: true,
        homedir: tmpDir,
        outerloopsessionid: "test-nochange",
        outerloopmaxcycles: 10,
        outerloopmaxnochange: 2,
        validationgoal: "check something",
        trackchanges: true,
        changetrackroot: emptyTrackDir
      }, now())
      var statePath = tmpDir + "/.openaf-mini-a/sessions/test-nochange/state.json"
      var state = io.readFileJSON(statePath)
      ow.test.assert(state.status === "stopped", true, "Should stop when no files change repeatedly, got: " + state.status)
      ow.test.assert(cycles <= 4, true, "Should not run more than maxNoChange+2 cycles, got: " + cycles)
    } finally { rmTempDir(tmpDir); rmTempDir(emptyTrackDir) }
  }

  exports.testOuterLoopStopOnRepeatValidationFailure = function() {
    var a = createAgent()
    var tmpDir = mkTempDir()
    var cycles = 0
    var fixedVerdict = { verdict: "REVISE", feedback: "always fails" }
    a._startInternal = function() { cycles++; return "some output" }
    a._validateResearchOutcome = function() { return fixedVerdict }
    try {
      a._runOuterLoop({
        outerloop: true,
        homedir: tmpDir,
        outerloopsessionid: "test-repeat",
        outerloopmaxcycles: 10,
        outerloopstoponrepeat: true,
        outerloopmaxnochange: 100,
        validationgoal: "check something",
        trackchanges: false
      }, now())
      var statePath = tmpDir + "/.openaf-mini-a/sessions/test-repeat/state.json"
      var state = io.readFileJSON(statePath)
      ow.test.assert(state.status === "stopped", true, "Should stop on repeated identical validation failures, got: " + state.status)
      ow.test.assert(cycles <= 3, true, "Should stop quickly on repeated identical failures, got: " + cycles)
    } finally { rmTempDir(tmpDir) }
  }

  exports.testOuterLoopValidationGoalFilePathExpansion = function() {
    var a = createAgent()
    var tmpDir = mkTempDir()
    var validationFile = tmpDir + "/criteria.txt"
    var criteria = "All tests must pass"
    io.writeFileString(validationFile, criteria)
    var capturedGoal = ""
    a._startInternal = function() { return "some output" }
    a._validateResearchOutcome = function(outStr, goal) {
      capturedGoal = goal
      return { verdict: "PASS", feedback: "ok" }
    }
    try {
      a._runOuterLoop({
        outerloop: true,
        homedir: tmpDir,
        outerloopsessionid: "test-fileval",
        outerloopmaxcycles: 1,
        validationgoal: validationFile,
        trackchanges: false
      }, now())
      ow.test.assert(capturedGoal === criteria, true, "Validation goal file path should be expanded to file contents, got: " + capturedGoal)
    } finally { rmTempDir(tmpDir) }
  }

  exports.testOuterLoopMaxTimeZeroNeverTimesOut = function() {
    var a = createAgent()
    var tmpDir = mkTempDir()
    var cycles = 0
    a._startInternal = function() { cycles++; return "output" }
    a._validateResearchOutcome = function() { return { verdict: "PASS", feedback: "ok" } }
    try {
      a._runOuterLoop({
        outerloop: true,
        homedir: tmpDir,
        outerloopsessionid: "test-notime",
        outerloopmaxcycles: 3,
        outerloopmaxtime: 0,
        validationgoal: "check",
        trackchanges: false
      }, now())
      ow.test.assert(cycles >= 1, true, "At least one cycle should run with maxtime=0, got: " + cycles)
    } finally { rmTempDir(tmpDir) }
  }

  exports.testOuterLoopStopsWhenMaxCyclesReached = function() {
    var a = createAgent()
    var tmpDir = mkTempDir()
    var cycles = 0
    a._startInternal = function() { cycles++; return "output" }
    a._validateResearchOutcome = function() { return { verdict: "REVISE", feedback: "still failing" } }
    try {
      a._runOuterLoop({
        outerloop: true,
        homedir: tmpDir,
        outerloopsessionid: "test-maxcycles-stop",
        outerloopmaxcycles: 2,
        validationgoal: "check",
        trackchanges: false
      }, now())
      var statePath = tmpDir + "/.openaf-mini-a/sessions/test-maxcycles-stop/state.json"
      var state = io.readFileJSON(statePath)
      ow.test.assert(cycles === 2, true, "Should run exactly max cycles, got: " + cycles)
      ow.test.assert(state.status === "stopped", true, "State status should be 'stopped' after max-cycle exhaustion, got: " + state.status)
    } finally { rmTempDir(tmpDir) }
  }

})()
