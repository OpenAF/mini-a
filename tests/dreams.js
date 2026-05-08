(function() {
  global.__mini_a_dreams_lib_mode = true
  load("mini-a-common.js")
  load("mini-a-memory.js")
  load("mini-a-dreams.js")

  // ─── helpers ────────────────────────────────────────────────

  var makeEntry = function(id, value, status, extra) {
    var base = {
      id: id, value: value, status: status || "active",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString(), confirmCount: 1,
      stale: false, supersededBy: __, unresolved: false,
      provenance: {}, evidenceRefs: [], tags: [], meta: {},
      truncated: false
    }
    if (isMap(extra)) Object.keys(extra).forEach(function(k) { base[k] = extra[k] })
    return base
  }

  var makeSnap = function(sections) {
    var now = new Date().toISOString()
    var snap = {
      schemaVersion: 1, createdAt: now, updatedAt: now, revision: 1,
      sections: {
        facts: [], evidence: [], openQuestions: [], hypotheses: [],
        decisions: [], artifacts: [], risks: [], summaries: []
      }
    }
    if (isMap(sections)) Object.keys(sections).forEach(function(k) { snap.sections[k] = sections[k] })
    return snap
  }

  var makeStubLlm = function(responseObj) {
    return {
      promptJSONWithStats: function() { return { response: responseObj, stats: {} } }
    }
  }

  var tempChName = function() {
    return "_dreams_test_ch_" + String(now()).replace(/\D/g, "") + "_" + Math.floor(Math.random() * 99999)
  }

  // ─── tests ──────────────────────────────────────────────────

  var exports = {}

  exports.testDreamMemoryMergesDuplicates = function() {
    var chName = tempChName()
    $ch(chName).create("simple", {})
    // Use dedup:false so two similar entries can coexist in the channel before dreaming
    var e1 = makeEntry("aaaa0001", "The server runs on port 8080", "active")
    var e2 = makeEntry("aaaa0002", "App listens on port 8080", "active")
    var mgr = new MiniAMemoryManager({ dedup: false })
    mgr.init(makeSnap({ facts: [e1, e2] }))
    mgr.saveToChannel(chName, "")

    // LLM merges the two into one
    var consolidated = makeSnap({ facts: [makeEntry("aaaa0001", "The server/app runs on port 8080", "active")] })
    var runner = new MiniADreams({ memorych: '{"name":"' + chName + '","type":"simple"}' }, function() {})
    runner._setLlm(makeStubLlm(consolidated))

    var result = runner.dreamMemory()
    ow.test.assert(result.ok, true, "dreamMemory should return ok=true")
    ow.test.assert(result.results.global.before, 2, "before count should be 2")
    ow.test.assert(result.results.global.after, 1, "after count should be 1 (merged)")

    var mgr2 = new MiniAMemoryManager({})
    mgr2.loadFromChannel(chName, "")
    ow.test.assert(mgr2.snapshot().sections.facts.length, 1, "channel should have 1 fact after dream")
    try { $ch(chName).destroy() } catch(e) {}
  }

  exports.testDreamMemoryMarksStale = function() {
    var chName = tempChName()
    $ch(chName).create("simple", {})
    var old  = makeEntry("bb0001", "Auth uses MD5 passwords", "active")
    var newE = makeEntry("bb0002", "Auth uses bcrypt passwords", "active")
    var mgr = new MiniAMemoryManager({})
    mgr.init(makeSnap({ facts: [old, newE] }))
    mgr.saveToChannel(chName, "")

    var consolidated = makeSnap({ facts: [
      makeEntry("bb0001", "Auth uses MD5 passwords", "active", { stale: true, supersededBy: "bb0002" }),
      makeEntry("bb0002", "Auth uses bcrypt passwords", "active")
    ]})
    var runner = new MiniADreams({ memorych: '{"name":"' + chName + '","type":"simple"}' }, function() {})
    runner._setLlm(makeStubLlm(consolidated))

    var result = runner.dreamMemory()
    ow.test.assert(result.ok, true, "dreamMemory should return ok=true")
    ow.test.assert(result.results.global.staleMarked >= 1, true, "at least 1 entry should be stale-marked")

    var mgr2 = new MiniAMemoryManager({})
    mgr2.loadFromChannel(chName, "")
    var facts = mgr2.snapshot().sections.facts
    var staleEntry = facts.filter(function(e) { return e.id === "bb0001" })[0]
    ow.test.assert(isMap(staleEntry) && staleEntry.stale === true, true, "bb0001 should be stale")
    ow.test.assert(isMap(staleEntry) && staleEntry.supersededBy === "bb0002", true, "bb0001 supersededBy should be bb0002")
    try { $ch(chName).destroy() } catch(e) {}
  }

  exports.testDreamMemoryPreservesIds = function() {
    var chName = tempChName()
    $ch(chName).create("simple", {})
    var e1 = makeEntry("cc0001", "System uses Redis", "active")
    var e2 = makeEntry("cc0002", "Deploy target is AWS", "active")
    var mgr = new MiniAMemoryManager({})
    mgr.init(makeSnap({ facts: [e1, e2] }))
    mgr.saveToChannel(chName, "")

    var runner = new MiniADreams({ memorych: '{"name":"' + chName + '","type":"simple"}' }, function() {})
    runner._setLlm(makeStubLlm(makeSnap({ facts: [e1, e2] })))
    runner.dreamMemory()

    var mgr2 = new MiniAMemoryManager({})
    mgr2.loadFromChannel(chName, "")
    var ids = mgr2.snapshot().sections.facts.map(function(e) { return e.id }).sort()
    ow.test.assert(ids[0] === "cc0001" && ids[1] === "cc0002", true, "entry IDs should be preserved")
    try { $ch(chName).destroy() } catch(e) {}
  }

  exports.testDreamMemoryDryRunDoesNotWrite = function() {
    var chName = tempChName()
    $ch(chName).create("simple", {})
    var e1 = makeEntry("dd0001", "Fact one", "active")
    var e2 = makeEntry("dd0002", "Fact two", "active")
    var mgr = new MiniAMemoryManager({})
    mgr.init(makeSnap({ facts: [e1, e2] }))
    mgr.saveToChannel(chName, "")

    // LLM says drop e2 — but dry-run should NOT write this
    var runner = new MiniADreams({ memorych: '{"name":"' + chName + '","type":"simple"}', dryrun: "true" }, function() {})
    runner._setLlm(makeStubLlm(makeSnap({ facts: [e1] })))

    var result = runner.dreamMemory()
    ow.test.assert(result.ok, true, "dreamMemory should return ok=true")
    ow.test.assert(result.results.global.dryRun, true, "result should indicate dry-run")

    var mgr2 = new MiniAMemoryManager({})
    mgr2.loadFromChannel(chName, "")
    ow.test.assert(mgr2.snapshot().sections.facts.length, 2, "dry-run must not modify channel")
    try { $ch(chName).destroy() } catch(e) {}
  }

  exports.testDreamMemoryRejectsInvalidSchema = function() {
    var chName = tempChName()
    $ch(chName).create("simple", {})
    var e1 = makeEntry("ee0001", "Valid fact", "active")
    var mgr = new MiniAMemoryManager({})
    mgr.init(makeSnap({ facts: [e1] }))
    mgr.saveToChannel(chName, "")

    // LLM returns garbage
    var runner = new MiniADreams({ memorych: '{"name":"' + chName + '","type":"simple"}' }, function() {})
    runner._setLlm(makeStubLlm({ schemaVersion: 1 }))   // missing sections

    var result = runner.dreamMemory()
    ow.test.assert(result.results.global.ok, false, "invalid schema should cause ok=false")
    ow.test.assert(result.results.global.reason, "invalid-schema", "reason should be invalid-schema")

    var mgr2 = new MiniAMemoryManager({})
    mgr2.loadFromChannel(chName, "")
    ow.test.assert(mgr2.snapshot().sections.facts.length, 1, "channel should be untouched after rejection")
    try { $ch(chName).destroy() } catch(e) {}
  }

  exports.testDreamRunRoutesMemoryOnly = function() {
    var chName = tempChName()
    $ch(chName).create("simple", {})
    var e1 = makeEntry("ff0001", "A fact", "active")
    var mgr = new MiniAMemoryManager({})
    mgr.init(makeSnap({ facts: [e1] }))
    mgr.saveToChannel(chName, "")

    var calls = { memory: 0, wiki: 0 }
    var runner = new MiniADreams({ memorych: '{"name":"' + chName + '","type":"simple"}' }, function() {})
    runner._setLlm(makeStubLlm(makeSnap({ facts: [e1] })))
    var origMemory = runner.dreamMemory.bind(runner)
    runner.dreamMemory = function() { calls.memory++; return origMemory() }
    runner.dreamWiki   = function() { calls.wiki++;   return { ok: true } }

    runner.run()
    ow.test.assert(calls.memory, 1, "dreamMemory should be called once")
    ow.test.assert(calls.wiki,   0, "dreamWiki should not be called when usewiki not set")
    try { $ch(chName).destroy() } catch(e) {}
  }

  exports.testDreamRunRoutesWikiOnly = function() {
    var calls = { memory: 0, wiki: 0 }
    var runner = new MiniADreams({ usewiki: "true", wikiroot: "/tmp", wikibackend: "fs" }, function() {})
    runner.dreamMemory = function() { calls.memory++; return { ok: true } }
    runner.dreamWiki   = function() { calls.wiki++;   return { ok: true } }

    runner.run()
    ow.test.assert(calls.wiki,   1, "dreamWiki should be called once")
    ow.test.assert(calls.memory, 0, "dreamMemory should not be called when memorych not set")
  }

  exports.testCreateChannelFromDefInvalidInput = function() {
    var runner = new MiniADreams({}, function() {})
    ow.test.assert(isUnDef(runner._createChannelFromDef("", "fallback", "simple")), true, "empty string → undefined")
    ow.test.assert(isUnDef(runner._createChannelFromDef("not{valid", "fallback", "simple")), true, "invalid JSSLON → undefined")
  }

  exports.testValidateMemorySchemaValid = function() {
    var runner = new MiniADreams({}, function() {})
    ow.test.assert(isUnDef(runner._validateMemorySchema(makeSnap())), true, "valid snapshot should pass validation")
  }

  exports.testValidateMemorySchemaMissingSection = function() {
    var runner = new MiniADreams({}, function() {})
    var bad = { schemaVersion: 1, sections: { facts: [] } }
    ow.test.assert(isString(runner._validateMemorySchema(bad)), true, "missing section → validation error string")
  }

  return exports
})()
