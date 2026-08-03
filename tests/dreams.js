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
  // NOTE: do not declare a local `exports` here — that shadows the module object
  // require() hands us and silently exports nothing (same convention as tests/graph.js).

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

  exports.testDreamMemoryApplyPersistsConsolidatedSections = function() {
    var chName = tempChName()
    $ch(chName).create("simple", {})
    var e1 = makeEntry("pp0001", "Original fact one", "active")
    var e2 = makeEntry("pp0002", "Original fact two", "active")
    var mgr = new MiniAMemoryManager({ dedup: false })
    mgr.init(makeSnap({ facts: [e1, e2], summaries: [makeEntry("ppsum1", "Initial summary", "active")] }))
    mgr.saveToChannel(chName, "")

    var consolidated = makeSnap({
      facts: [makeEntry("pp0001", "Consolidated fact", "active")],
      summaries: [makeEntry("ppsum2", "Fresh summary", "active")]
    })
    var runner = new MiniADreams({ memorych: '{"name":"' + chName + '","type":"simple"}' }, function() {})
    runner._setLlm(makeStubLlm(consolidated))

    var result = runner.dreamMemory()
    ow.test.assert(result.ok, true, "apply mode should persist successfully")
    ow.test.assert(result.results.global.ok, true, "global apply result should be ok")

    var mgr2 = new MiniAMemoryManager({})
    mgr2.loadFromChannel(chName, "")
    var snap = mgr2.snapshot()
    ow.test.assert(snap.sections.facts.length, 1, "facts should be consolidated to one entry")
    ow.test.assert(snap.sections.facts[0].value, "Consolidated fact", "fact content should be persisted")
    ow.test.assert(snap.sections.summaries.length, 1, "summaries section should be persisted")
    ow.test.assert(snap.sections.summaries[0].value, "Fresh summary", "summary content should be persisted")
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
    ow.test.assert(result.ok, false, "dreamMemory should return ok=false when global consolidation fails")
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
    var runner = new MiniADreams({ usewiki: "true", wikiroot: io.createTempDir("dreamwiki_route_"), wikibackend: "fs" }, function() {})
    runner.dreamMemory = function() { calls.memory++; return { ok: true } }
    runner.dreamWiki   = function() { calls.wiki++;   return { ok: true } }

    runner.run()
    ow.test.assert(calls.wiki,   1, "dreamWiki should be called once")
    ow.test.assert(calls.memory, 0, "dreamMemory should not be called when memorych not set")
  }

  exports.testDreamRunPrefersMemoryWhenBothConfigured = function() {
    var calls = { memory: 0, wiki: 0 }
    var runner = new MiniADreams({
      memorych: "{\"name\":\"dummy\",\"type\":\"simple\"}",
      usewiki: "true",
      wikiroot: io.createTempDir("dreamwiki_route_"),
      wikibackend: "fs"
    }, function() {})
    runner.dreamMemory = function() { calls.memory++; return { ok: true } }
    runner.dreamWiki   = function() { calls.wiki++;   return { ok: true } }

    runner.run()
    ow.test.assert(calls.memory, 1, "dreamMemory should be called once by default")
    ow.test.assert(calls.wiki,   0, "dreamWiki should not run by default when memory is configured")
  }

  exports.testDreamRunForceWikiWhenRequested = function() {
    var calls = { memory: 0, wiki: 0 }
    var runner = new MiniADreams({
      memorych: "{\"name\":\"dummy\",\"type\":\"simple\"}",
      usewiki: "true",
      wikiroot: io.createTempDir("dreamwiki_route_"),
      wikibackend: "fs",
      dreamwiki: "true"
    }, function() {})
    runner.dreamMemory = function() { calls.memory++; return { ok: true } }
    runner.dreamWiki   = function() { calls.wiki++;   return { ok: true } }

    runner.run()
    ow.test.assert(calls.memory, 1, "dreamMemory should be called once")
    ow.test.assert(calls.wiki,   1, "dreamWiki should run when dreamwiki=true")
  }

  exports.testDreamMemoryPlanModeReturnsDryRun = function() {
    var chName = tempChName()
    $ch(chName).create("simple", {})
    var e1 = makeEntry("mm0001", "Fact one", "active")
    var mgr = new MiniAMemoryManager({})
    mgr.init(makeSnap({ facts: [e1] }))
    mgr.saveToChannel(chName, "")

    var runner = new MiniADreams({ memorych: '{"name":"' + chName + '","type":"simple"}', dreammemorymode: "plan" }, function() {})
    runner._setLlm(makeStubLlm(makeSnap({ facts: [e1] })))
    var result = runner.dreamMemory()
    ow.test.assert(result.ok, true, "plan mode should succeed")
    ow.test.assert(result.results.global.mode, "plan", "global result mode should be plan")
    ow.test.assert(result.results.global.dryRun, true, "plan mode should be dry-run")
    try { $ch(chName).destroy() } catch(e) {}
  }

  exports.testDreamWikiPlanModeProposalShape = function() {
    var root = io.createTempDir("dreamwiki_plan_")
    io.writeFileString(root + "/index.md", [
      "---",
      "title: Home",
      "description: Home page",
      "created: 2026-01-01T00:00:00.000Z",
      "updated: 2026-01-01T00:00:00.000Z",
      "---",
      "",
      "# Home",
      "",
      "No links yet."
    ].join("\n"))
    io.writeFileString(root + "/topic/page-a.md", [
      "---",
      "title: Page A",
      "description: A",
      "created: 2026-01-01T00:00:00.000Z",
      "updated: 2026-01-01T00:00:00.000Z",
      "---",
      "",
      "# Page A"
    ].join("\n"))

    var runner = new MiniADreams({
      usewiki: "true",
      wikibackend: "fs",
      wikiroot: root,
      dreamwikimode: "plan"
    }, function() {})
    var res = runner.dreamWiki()
    ow.test.assert(res.ok, true, "plan mode should succeed")
    ow.test.assert(isMap(res.proposal), true, "proposal should exist")
    ow.test.assert(isArray(res.proposal.indexes_to_create), true, "proposal.indexes_to_create should exist")
    ow.test.assert(isArray(res.proposal.move_table), true, "proposal.move_table should exist")
    ow.test.assert(isMap(res.lint_before), true, "lint_before should exist")
    ow.test.assert(isMap(res.lint_after), true, "lint_after should exist")
  }

  exports.testDreamWikiDryRunOptsOutOfApply = function() {
    var dir = String(java.io.File.createTempFile("minidream-", "").getCanonicalPath())
    io.rm(dir); io.mkdir(dir)
    try {
      var runner = new MiniADreams({
        usewiki: "true",
        wikibackend: "fs",
        wikiroot: dir,
        dreamwikimode: "apply",
        dreamwikidryrun: "true"
      }, function() {})
      var res = runner.dreamWiki()
      ow.test.assert(res.ok, true, "dry-run should succeed")
      ow.test.assert(res.mode, "plan", "dreamwikidryrun should downgrade apply to a plan run")
      ow.test.assert(isMap(res.proposal), true, "dry-run should still produce a proposal")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testDreamWikiReorgApprovalGate = function() {
    var runner = new MiniADreams({
      usewiki: "true",
      wikibackend: "fs",
      wikiroot: io.createTempDir("dreamwiki_reorg_"),
      dreamwikimode: "reorg",
      dreamwikireorg: "true",
      dreamwikiapproval: "ask"
    }, function() {})
    var res = runner.dreamWiki()
    ow.test.assert(res.ok, false, "reorg with ask approval should require interaction")
    ow.test.assert(res.reason, "approval-required", "reason should be approval-required")
  }

  exports.testCreateChannelFromDefInvalidInput = function() {
    var runner = new MiniADreams({}, function() {})
    ow.test.assert(isUnDef(runner._createChannelFromDef("", "fallback", "simple")), true, "empty string → undefined")
    ow.test.assert(isUnDef(runner._createChannelFromDef("bad\u0000path", "fallback", "simple")), true, "invalid JSSLON and native path → undefined")
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

  exports.testBuildLlmUsesOAFModelFallback = function() {
    var runner = new MiniADreams({}, function() {})
    runner._getEnv = function(name) {
      return name === "OAF_MODEL" ? "(type: ollama, model: test-dream-model, url: 'http://localhost:11434')" : __
    }

    var captured = __
    var origLlm = $llm
    try {
      $llm = function(cfg) {
        captured = cfg
        return { prompt: function() { return "{}" } }
      }
      var llm = runner._buildLlm()
      ow.test.assert(isObject(llm), true, "_buildLlm should create an LLM from OAF_MODEL")
      ow.test.assert(isMap(captured) && captured.type === "ollama", true, "OAF_MODEL type should be parsed")
      ow.test.assert(isMap(captured) && captured.model === "test-dream-model", true, "OAF_MODEL model should be parsed")
    } finally {
      $llm = origLlm
    }
  }

  exports.testBuildLlmPrefersModelArg = function() {
    var runner = new MiniADreams({ model: "(type: openai, model: arg-model, key: test-key)" }, function() {})
    runner._getEnv = function(name) {
      return name === "OAF_MODEL" ? "(type: ollama, model: env-model)" : __
    }

    var captured = __
    var origLlm = $llm
    try {
      $llm = function(cfg) {
        captured = cfg
        return { prompt: function() { return "{}" } }
      }
      var llm = runner._buildLlm()
      ow.test.assert(isObject(llm), true, "_buildLlm should create an LLM from model=")
      ow.test.assert(isMap(captured) && captured.type === "openai", true, "model= should override OAF_MODEL type")
      ow.test.assert(isMap(captured) && captured.model === "arg-model", true, "model= should override OAF_MODEL model")
    } finally {
      $llm = origLlm
    }
  }

  exports.testBuildWikiConfigMatchesRuntimeDefaults = function() {
    var runner = new MiniADreams({
      usewiki: "true",
      wikibackend: "s3",
      wikibucket: "bucket-a",
      wikiaccesskey: "access-a",
      wikisecret: "secret-a",
      wikiregion: "eu-west-1",
      wikiuseversion1: "true",
      wikiignorecertcheck: "true"
    }, function() {})
    var cfg = runner._buildWikiConfig()
    ow.test.assert(cfg.backend, "s3", "backend should be s3")
    ow.test.assert(cfg.access, "rw", "dream wiki config should request write access")
    ow.test.assert(cfg.prefix, "wiki/", "s3 prefix should use runtime default")
    ow.test.assert(cfg.url, "https://s3.amazonaws.com", "s3 url should use runtime default")
    ow.test.assert(cfg.useVersion1, true, "wikiuseversion1 should be forwarded")
    ow.test.assert(cfg.ignoreCertCheck, true, "wikiignorecertcheck should be forwarded")
  }

  // ─── wiki dream apply + finalize ────────────────────────────

  var makeWikiDir = function() {
    var dir = String(java.io.File.createTempFile("minidream-wiki-", "").getCanonicalPath())
    io.rm(dir)
    io.mkdir(dir)
    return dir
  }

  var seedWiki = function(dir, pageCount) {
    load("mini-a-wiki.js")
    var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" }, function() {})
    for (var i = 0; i < (isNumber(pageCount) ? pageCount : 6); i++) {
      wm.write("notes/page" + i + ".md",
               { title: "Page " + i, description: "Description of page " + i, type: "note" },
               "# Page " + i + "\n\nBody content for page " + i + ".")
    }
    wm.close()
    return dir
  }

  exports.testDreamWikiApplyRunsWithoutAnExplicitGate = function() {
    var dir = seedWiki(makeWikiDir())
    try {
      var runner = new MiniADreams({
        usewiki: "true", wikibackend: "fs", wikiroot: dir, dreamwikimode: "apply"
      }, function() {})
      var res = runner.dreamWiki()
      ow.test.assert(res.ok, true, "bare apply must actually run (was a silent no-op)")
      ow.test.assert(res.mode, "apply", "mode should be apply")
      ow.test.assert(isMap(res.finalize), true, "apply should report a finalize step")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testDreamWikiApplyDefaultsWhenNoModeGiven = function() {
    var dir = seedWiki(makeWikiDir())
    try {
      var runner = new MiniADreams({ usewiki: "true", wikibackend: "fs", wikiroot: dir }, function() {})
      var res = runner.dreamWiki()
      ow.test.assert(res.ok, true, "an unset dreamwikimode should default to a working apply")
      ow.test.assert(res.mode, "apply", "default mode should be apply")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testDreamWikiFinalizeRegeneratesIndexAndReindexes = function() {
    var dir = seedWiki(makeWikiDir())
    try {
      var runner = new MiniADreams({
        usewiki: "true", wikibackend: "fs", wikiroot: dir, dreamwikimode: "apply"
      }, function() {})
      var res = runner.dreamWiki()
      ow.test.assert(res.finalize.indexes_regenerated > 0, true, "finalize should regenerate index pages")
      ow.test.assert(res.finalize.reindexed, true, "finalize should rebuild the search index")

      load("mini-a-wiki.js")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro" }, function() {})
      // all seeded pages live under notes/, so the root gets the sections table
      var idx = wm.read("index.md")
      ow.test.assert(idx.body.indexOf("| Section | Pages | Updated |") >= 0, true, "root index should carry the generated sections table")
      ow.test.assert(idx.body.indexOf("notes/index.md") >= 0, true, "root index should link the notes section")
      var sect = wm.read("notes/index.md")
      ow.test.assert(sect.body.indexOf("| Page | Updated | Summary |") >= 0, true, "section index should carry the generated page table")
      ow.test.assert(sect.body.indexOf("Description of page 1") >= 0, true, "section index should carry live page descriptions")
      ow.test.assert(wm._luceneIndexExists(), true, "finalize should leave a populated search index")
      wm.close()
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testDreamWikiFinalizeRunsBelowMinPages = function() {
    var dir = seedWiki(makeWikiDir(), 2)
    try {
      var runner = new MiniADreams({
        usewiki: "true", wikibackend: "fs", wikiroot: dir, dreamwikimode: "apply", dreamwikiminpages: 5
      }, function() {})
      var res = runner.dreamWiki()
      ow.test.assert(res.ok, true, "a small wiki should still complete")
      ow.test.assert(res.finalize.indexes_regenerated > 0, true, "dreamwikiminpages must not block finalization")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testFinalizePreservesAuthoredIndexContent = function() {
    var dir = seedWiki(makeWikiDir())
    try {
      // an index page an author wrote: intro prose, a stale generated section, a custom section
      io.writeFileString(dir + "/index.md",
        "---\ntitle: Postmortems\ndescription: Incident postmortems for team X\n" +
        "created: 2026-01-01T00:00:00.000Z\nupdated: 2026-01-01T00:00:00.000Z\n---\n\n" +
        "# Postmortems\n\nThis wiki tracks incident postmortems for team X.\n\n" +
        "## Sections\n\n- an out-of-date hand-written list\n\n" +
        "## House rules\n\n- Always link the incident ticket.\n")

      new MiniADreams({
        usewiki: "true", wikibackend: "fs", wikiroot: dir, dreamwikimode: "apply"
      }, function() {}).dreamWiki()

      var body = io.readFileString(dir + "/index.md")
      ow.test.assert(body.indexOf("This wiki tracks incident postmortems for team X") >= 0, true, "intro prose must survive regeneration")
      ow.test.assert(body.indexOf("## House rules") >= 0, true, "custom sections must survive regeneration")
      ow.test.assert(body.indexOf("Always link the incident ticket") >= 0, true, "custom section content must survive regeneration")
      ow.test.assert(body.indexOf("| Section | Pages | Updated |") >= 0, true, "generated sections table should be rebuilt")
      ow.test.assert(body.indexOf("an out-of-date hand-written list") < 0, true, "stale generated content should be replaced")
      ow.test.assert(body.indexOf("title: Postmortems") >= 0, true, "authored title must be preserved")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  var seedRepairWiki = function(dir) {
    load("mini-a-wiki.js")
    var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" }, function() {})
    wm.write("section/index.md", { title: "Section", description: "Section index" }, "# Section")
    wm.write("section/one.md", { title: "One", description: "One" }, "# One")
    wm.write("section/two.md", { title: "Two", description: "Two" }, "# Two")
    wm.write("missing/page.md", { title: "Missing index page", description: "Missing" }, "# Missing")
    wm.write("other.md", { title: "Other", description: "Other" }, "# Other\n\n[broken](does-not-exist.md)")
    wm.close()
    io.writeFileString(dir + "/section/index.md", "---\ntitle: Section\ndescription: Section index\ncreated: 2020-01-01T00:00:00.000Z\nupdated: 2020-01-01T00:00:00.000Z\n---\n\n# Section")
  }

  exports.testDreamWikiApplyRepairsCertainLintOnly = function() {
    var dir = makeWikiDir()
    try {
      seedRepairWiki(dir)
      var res = new MiniADreams({ usewiki: "true", wikibackend: "fs", wikiroot: dir, dreamwikimode: "apply" }, function() {}).dreamWiki()
      var fixed = res.repairs.fixed
      ow.test.assert(fixed.some(function(i) { return i.type === "missing_index" && i.page === "missing/index.md" }), true, "apply should create a missing index")
      ow.test.assert(fixed.some(function(i) { return i.type === "index_missing_links" && i.page === "section/index.md" }), true, "apply should add missing index links")
      ow.test.assert(fixed.some(function(i) { return i.type === "stale_index" && i.page === "section/index.md" }), true, "apply should regenerate stale indexes")
      ow.test.assert(res.repairs.skipped.some(function(i) { return i.type === "broken_link" && i.reason === "target-not-resolved-with-certainty" }), true, "broken links must remain explicitly skipped")
      ow.test.assert(res.lint_after.errors >= 1, true, "unresolved broken links must remain in lint output")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testDreamWikiRepairDryRunAndIdempotence = function() {
    var dir = makeWikiDir()
    try {
      seedRepairWiki(dir)
      var before = io.readFileString(dir + "/section/index.md")
      var dry = new MiniADreams({ usewiki: "true", wikibackend: "fs", wikiroot: dir, dreamwikimode: "apply", dreamwikidryrun: "true" }, function() {}).dreamWiki()
      ow.test.assert(dry.repairs.candidates.length >= 3, true, "dry-run should report deterministic repair candidates")
      ow.test.assert(io.readFileString(dir + "/section/index.md"), before, "dry-run must not write indexes")

      new MiniADreams({ usewiki: "true", wikibackend: "fs", wikiroot: dir, dreamwikimode: "apply" }, function() {}).dreamWiki()
      var afterFirst = {
        root: io.readFileString(dir + "/index.md"),
        section: io.readFileString(dir + "/section/index.md"),
        missing: io.readFileString(dir + "/missing/index.md")
      }
      var second = new MiniADreams({ usewiki: "true", wikibackend: "fs", wikiroot: dir, dreamwikimode: "apply" }, function() {}).dreamWiki()
      ow.test.assert(second.repairs.fixed.length, 0, "second identical apply should not repair anything")
      ow.test.assert(io.readFileString(dir + "/index.md"), afterFirst.root, "second apply should not rewrite the root index")
      ow.test.assert(io.readFileString(dir + "/section/index.md"), afterFirst.section, "second apply should not rewrite a section index")
      ow.test.assert(io.readFileString(dir + "/missing/index.md"), afterFirst.missing, "second apply should not rewrite a created index")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testDreamWikiLintModeIsGone = function() {
    var dir = seedWiki(makeWikiDir())
    try {
      var runner = new MiniADreams({
        usewiki: "true", wikibackend: "fs", wikiroot: dir, dreamwikimode: "lint"
      }, function() {})
      var res = runner.dreamWiki()
      ow.test.assert(res.mode, "apply", "the removed 'lint' mode should fall back to the apply default")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  return exports
})()
