(function() {
  global.__mini_a_dreams_lib_mode = true
  global.__mini_a_ingest_lib_mode = true
  load("mini-a-dreams.js")
  load("mini-a-ingest.js")
  function fixture(fn) {
    var root = String(new java.io.File(io.createTempDir("dream_auto_test_")).getCanonicalPath()), wm
    try {
      wm = new MiniAWikiManager({ root: root, backend: "fs", access: "rw", wikiretrievalv2: true }, function() {})
      wm.write("alpha.md", { title: "Alpha installation", description: "Installation procedure", type: "concept" }, "# Alpha installation\n\nInstall the package and set the environment. Read [Beta](beta.md).\n")
      wm.write("beta.md", { title: "Beta networking", description: "Networking procedure", type: "concept" }, "# Beta networking\n\nConfigure the network address and port. See [Alpha](alpha.md).\n")
      wm.regenerateIndexes(); wm.reindex(); wm.close(); wm = null
      fn(root)
    } finally { if (wm) wm.close(); io.rm(root) }
  }
  function runner(root, opts, logFn) { return new MiniADreams(merge({ usewiki: true, wikiaccess: "rw", wikiroot: root, dreamwikimode: "auto", dreamwikillm: false }, opts || {}), logFn || function() {}) }
  function bytes(root) { return JSON.stringify(runner(root)._autoHashes(runner(root)._autoInventory(root))) }
  function evidence(prompt) { return af.fromJson(prompt.substring(prompt.indexOf('\n') + 1)) }
  function breakDescription(root) {
    var p = root + "/alpha.md", raw = io.readFileString(p).replace(/^description:.*\n/m, "")
    io.writeFileString(p, raw)
  }
  exports.testAutoAuthorityAndDryRun = function() {
    fixture(function(root) {
      breakDescription(root)
      var before = bytes(root), r = runner(root, { wikiaccess: "ro" }).dreamWiki()
      ow.test.assert(r.reason, "explicit-wikiaccess-rw-required", "auto never inherits forced write access")
      r = runner(root, { wikiaccess: "ro", dryrun: true }).dreamWiki()
      ow.test.assert(r.status, "planned", "dry-run diagnoses")
      ow.test.assert(bytes(root), before, "dry-run preserves all authoritative and state bytes")
      ow.test.assert(io.fileExists(root + "/.mini-a-wiki-maintenance"), false, "dry-run creates no backups")
      ow.test.assert(r.diagnosed_issues.length > 0, true, "dry-run reports source issues")
      ow.test.assert(r.attempted_actions.length, 0, "dry-run executes nothing")
    })
  }
  exports.testAutoManifestRecoveryAndIdempotence = function() {
    fixture(function(root) {
      var serving = root + "/.mini-a-wiki-serving", pointer = io.readFileJSON(serving + "/current.json")
      var manifestPath = serving + "/" + pointer.generation + "/manifest.json"
      io.writeFileString(manifestPath, io.readFileString(manifestPath) + " ")
      var r = runner(root).dreamWiki()
      ow.test.assert(r.verification.ok, true, "corrupt manifest rebuilt and verified by fresh reader: " + r.reason)
      ow.test.assert(r.diagnosed_issues.some(function(i) { return i.type === "derived_index_failure" }), true, "reports derived corruption")
      ow.test.assert(r.verified_fixes.some(function(i) { return i.type === "derived_index_failure" }), true, "recovery requires verification")
      ow.test.assert(io.fileExists(r.backup_location + "/backup.json"), true, "recoverable backup remains")
      var before = bytes(root), pointerBefore = io.readFileString(serving + "/current.json")
      var second = runner(root).dreamWiki()
      ow.test.assert(bytes(root), before, "repeat does not rewrite pages/state")
      ow.test.assert(io.readFileString(serving + "/current.json"), pointerBefore, "repeat does not republish healthy retrieval")
      ow.test.assert(second.verification.ok, true, "repeat reader still verified")
    })
  }
  exports.testAutoDeterministicSourceAndGraph = function() {
    fixture(function(root) {
      io.writeFileString(root + "/alpha.md", "# Alpha installation\n\nRead [Beta](beta).\n")
      var r = runner(root, { usewikigraph: true, wikigraphautosave: "off" }).dreamWiki()
      ow.test.assert(r.verification.ok, true, "graph and retrieval freshly verified: " + JSON.stringify(r.verification))
      ow.test.assert(r.verification.graph, "verified", "enabled graph built and checked")
      ow.test.assert(io.readFileString(root + "/alpha.md").indexOf("(beta.md)") >= 0, true, "deterministic link repair")
      ow.test.assert(r.llm_steps, 0, "disabled model makes no calls")
      ow.test.assert(r.unresolved_issues.some(function(i) { return i.field === "description" }), true, "semantic issue stays explicit")
    })
  }
  exports.testAutoModelRepairAndBudget = function() {
    fixture(function(root) {
      breakDescription(root)
      var r = runner(root, { dreamwikillm: true, dreammaxsteps: 1 }), calls = 0, output = []
      r._logFn = function(v) { if (isMap(v)) output.push(v) }
      r._setLlm({ prompt: function(prompt) {
        calls++
        var e = evidence(prompt), i = e.issues.findIndex(function(i) { return i.page === "alpha.md" && i.field === "description" })
        return { actions: [{ op: "write", issue: i, path: "alpha.md", expectedHash: e.pages["alpha.md"].hash,
          body: "# Alpha installation\n\nInstall the package and set the environment. Read [Beta](beta.md).\n", meta: { description: "Installation procedure" } }], summary: "Restored the missing description from the page." }
      } })
      var result = r.dreamWiki()
      ow.test.assert(calls, 1, "total step budget honored")
      ow.test.assert(result.verification.ok, true, "model edit verified")
      ow.test.assert(result.unresolved_issues.some(function(i) { return i.page === "alpha.md" && i.field === "description" }), false, "semantic repair checked with lint")
      ow.test.assert(output.length > 0, true, "model output forwarded")
    })
  }
  exports.testAutoModelRejectsUnrelatedEdits = function() {
    fixture(function(root) {
      breakDescription(root)
      var before = io.readFileString(root + "/beta.md"), r = runner(root, { dreamwikillm: true })
      r._setLlm({ prompt: function(prompt) {
        var e = evidence(prompt)
        return { actions: [{ op: "delete", issue: 0, path: "../../outside.md", expectedHash: "x" }] }
      } })
      var result = r.dreamWiki()
      ow.test.assert(result.ok, false, "invalid proposal cannot succeed")
      ow.test.assert(io.readFileString(root + "/beta.md"), before, "unrelated page unchanged")
      ow.test.assert(result.unresolved_issues.some(function(i) { return i.type === "model-repair-failed" }), true, "invalid proposal explicitly reported")
      ow.test.assert(result.verification.ok, true, "invalid model response does not discard deterministic recovery")
    })
  }
  exports.testAutoModelNoProgressAndUnavailable = function() {
    fixture(function(root) {
      breakDescription(root)
      var r = runner(root, { dreamwikillm: true }), calls = 0
      r._setLlm({ prompt: function() { calls++; return { actions: [] } } })
      var result = r.dreamWiki()
      ow.test.assert(calls <= 3, true, "at most three model cycles")
      ow.test.assert(result.ok, false, "no-progress cannot claim recovery")
      r = runner(root, { dreamwikillm: true }); r._buildLlm = function() { return __ }
      result = r.dreamWiki()
      ow.test.assert(result.model_status, "unavailable", "missing model reported")
      ow.test.assert(result.verification.ok, true, "deterministic recovery completes without model")
    })
  }
  exports.testAutoBackupsCancellationAndReconciliation = function() {
    fixture(function(root) {
      breakDescription(root)
      var r = runner(root), before = bytes(root), original = __miniAWikiMaintenanceJson
      // Block backup persistence with a regular file at the maintenance path.
      io.writeFileString(root + "/.mini-a-wiki-maintenance", "blocked")
      var result = r.dreamWiki()
      ow.test.assert(result.ok, false, "backup failure blocks writes")
      ow.test.assert(bytes(root), before, "backup failure preserved pages")
      io.rm(root + "/.mini-a-wiki-maintenance")
      r = runner(root, {}, function(msg) { if (String(msg).indexOf("Deterministic repair") >= 0) r.requestStop() })
      result = r.dreamWiki()
      ow.test.assert(result.status, "cancelled", "cancellation at safe boundary")
      ow.test.assert(io.fileExists(root + "/.mini-a-wiki-maintenance/pending.json"), true, "cancel retains journal")
      var next = runner(root).dreamWiki()
      ow.test.assert(next.reconciled_run, result.run_id, "repeat reconciles interrupted run")
      ow.test.assert(next.verification.ok, true, "reconciled run verified")
    })
  }
  exports.testAutoExternalChangesConflict = function() {
    fixture(function(root) {
      breakDescription(root)
      var r = runner(root, { dreamwikillm: true })
      r._setLlm({ prompt: function() { io.writeFileString(root + "/beta.md", "# External edit\n"); return { actions: [] } } })
      var result = r.dreamWiki()
      ow.test.assert(String(result.reason).indexOf("external-change-conflict") >= 0, true, "external modification fails closed")
      ow.test.assert(io.readFileString(root + "/beta.md"), "# External edit\n", "external work preserved")
      var next = runner(root).dreamWiki()
      ow.test.assert(next.status, "blocked", "unreconciled conflict blocks next pass")
    })
  }
  exports.testAutoRecoveryBlockersAndOwnership = function() {
    fixture(function(root) {
      io.mkdir(root + "/.mini-a-wiki-ingest")
      io.writeFileString(root + "/.mini-a-wiki-ingest/journal.json", "not json")
      var before = bytes(root), result = runner(root).dreamWiki()
      ow.test.assert(result.unresolved_issues.some(function(i) { return i.type === "ingestion-recovery-blocked" }), true, "corrupt journal explicit")
      ow.test.assert(bytes(root), before, "corrupt recovery not altered")
      io.rm(root + "/.mini-a-wiki-ingest/journal.json")
      io.mkdir(root + "/.mini-a-wiki-absorb")
      io.writeFileString(root + "/.mini-a-wiki-absorb/journal.json", "{}")
      result = runner(root).dreamWiki()
      ow.test.assert(result.unresolved_issues.some(function(i) { return i.type === "absorption-pending" }), true, "absorption requires its recovery flow")
      io.rm(root + "/.mini-a-wiki-absorb/journal.json")
      io.writeFileString(root + "/alpha.md", "---\ntitle: Owned\nsource: original.md\n---\n# Owned\n\n[Beta](beta.md)\n")
      before = io.readFileString(root + "/alpha.md")
      result = runner(root).dreamWiki()
      ow.test.assert(io.readFileString(root + "/alpha.md"), before, "ingestion provenance is never rewritten")
      ow.test.assert(result.ok, false, "owned issue remains unresolved")
    })
  }
  exports.testAutoSharedWriterLock = function() {
    fixture(function(root) {
      var first = __miniAWikiWriterLock(root), second = __miniAWikiWriterLock(root), thread
      try {
        second.release()
        var outcome = new java.util.concurrent.atomic.AtomicReference("")
        thread = new java.lang.Thread(function() {
          try { var other = __miniAWikiWriterLock(root); other.release(); outcome.set("unexpected") }
          catch(e) { outcome.set(String(e)) }
          var competing = new MiniAWikiManager({ root: root, access: "ro" }, function() {})
          try {
            competing._access = "rw"
            var denied = competing.write("denied.md", {}, "# Must not write")
            if (denied.ok || String(denied.error).indexOf("wiki-writer-busy") < 0) outcome.set("manager escaped lock")
            var publish = competing._retrievalV2.build()
            if (publish.ok || String(publish.error).indexOf("wiki-writer-busy") < 0) outcome.set("publisher escaped lock")
          } finally { competing.close() }
        })
        thread.start(); thread.join(5000)
        ow.test.assert(String(outcome.get()).indexOf("wiki-writer-busy") >= 0, true, "competing thread cannot inherit ownership")
        var wm = new MiniAWikiManager({ root: root, access: "rw" }, function() {})
        ow.test.assert(wm.write("under-lock.md", {}, "# Nested\n").ok, true, "manager mutations reenter same owner")
        wm.close()
      } finally { first.release() }
      var after = __miniAWikiWriterLock(root); after.release()
    })
  }

  exports.testAutoResumesJournalWithoutSource = function() {
    fixture(function(root) {
      var source = String(io.createTempDir("auto_ingest_source_"))
      try {
        io.writeFileString(source + "/resume.md", "# Journal source\n\nA recovery test page.")
        var ingest = new MiniAIngest({ usewiki: true, wikiaccess: "rw", wikiroot: root, ingestsource: source, ingestsection: "imports", ingestmode: "raw" }, function() {})
        ingest._applyJournal = function() { throw new Error("injected interruption before page application") }
        ow.test.assert(ingest.run().ok, false, "prepared journal retained")
        io.rm(source)
        var result = runner(root).dreamWiki()
        ow.test.assert(result.attempted_actions.some(function(a) { return a.action.indexOf("ingestion-resume:") === 0 && a.status === "applied" }), true, "valid journal resumed: " + result.reason)
        ow.test.assert(io.fileExists(root + "/imports/resume.md"), true, "page recovered without original input")
        ow.test.assert(io.fileExists(root + "/.mini-a-wiki-ingest/journal.json"), false, "recovery finalized")
        ow.test.assert(result.verification.ok, true, "recovered serving verified")
      } finally { if (io.fileExists(source)) io.rm(source) }
    })
  }
  exports.testAutoMetadataBindingRecovery = function() {
    fixture(function(root) {
      var wm = new MiniAWikiManager({ root: root, backend: "fs", access: "ro" }, function() {})
      var engine = wm._retrievalV2, pin = engine.acquire(), manifest = clone(pin.manifest), serving = engine.root
      try {
        var descriptor = manifest.catalogue.shards.pages[engine._catalogueShard("alpha.md")]
        var path = pin.dir + "/" + descriptor.path, shard = io.readFileJSON(path)
        shard.upsert["alpha.md"].metadata.description = "Forged metadata"
        var raw = JSON.stringify(shard); io.writeFileString(path, raw)
        descriptor.bytes = MiniAWikiRetrievalV2.bytes(raw); descriptor.checksum = MiniAWikiRetrievalV2.digestText(raw)
        manifest.files.forEach(function(f) { if (f.path === descriptor.path) { f.bytes = descriptor.bytes; f.checksum = descriptor.checksum } })
        manifest.merkle = MiniAWikiRetrievalV2.manifestMerkle(manifest)
        io.writeFileString(pin.dir + "/manifest.json", JSON.stringify(manifest))
        var pointer = io.readFileJSON(serving + "/current.json")
        pointer.checksum = MiniAWikiRetrievalV2.digest(pin.dir + "/manifest.json")
        io.writeFileString(serving + "/current.json", JSON.stringify(pointer))
      } finally { engine.release(pin); wm.close() }
      var result = runner(root).dreamWiki()
      ow.test.assert(result.diagnosed_issues.some(function(i) { return i.type === "derived_index_failure" && JSON.stringify(i.detail).indexOf("metadata-binding") >= 0 }), true, "binding failure distinguished: " + JSON.stringify(result.diagnosed_issues))
      ow.test.assert(result.verification.ok, true, "intact Markdown recovers metadata bindings: " + result.reason)
    })
  }
  exports.testAutoBoundedSearchCoverage = function() {
    fixture(function(root) {
      var original = MiniAWikiManager.prototype.search
      // Simulate a result budget that retains one valid hit for a shared title.
      var wm = new MiniAWikiManager({ root: root, access: "rw" }, function() {})
      wm.write("beta.md", { title: "Alpha installation", description: "Another installation procedure" }, "# Alpha installation\n\nInstall a second package.\n")
      wm.reindex(); wm.close()
      try {
        MiniAWikiManager.prototype.search = function() { return original.apply(this, arguments).slice(0, 1) }
        var cfg = { root: root, access: "ro", wikiretrievalv2: true }
        var result = runner(root)._autoVerify(cfg, ["alpha.md", "beta.md"])
        ow.test.assert(result.ok, true, "bounded ranking does not mark an indexed page corrupt")
        ow.test.assert(result.searches.some(function(p) { return !p.found && p.indexed && p.indexed_passages > 0 }), true, "omitted hit checked against actual Lucene page postings")
        MiniAWikiManager.prototype.search = function() { return [] }
        result = runner(root)._autoVerify(cfg, ["alpha.md", "beta.md"])
        ow.test.assert(result.ok, false, "an entirely empty search still fails verification")
      } finally { MiniAWikiManager.prototype.search = original }
    })
  }
  exports.testAutoJustifiedMerge = function() {
    fixture(function(root) {
      var wm = new MiniAWikiManager({ root: root, access: "rw" }, function() {})
      wm.write("copy.md", { title: "Alpha installation", description: "Installation procedure", type: "concept" }, wm.read("alpha.md").body)
      wm.regenerateIndexes(); wm.reindex(); wm.close()
      var r = runner(root, { dreamwikillm: true, dreammaxsteps: 1 })
      r._setLlm({ prompt: function(prompt) {
        var e = evidence(prompt), index = e.issues.findIndex(function(i) { return i.type === "near_duplicate" }), issue = e.issues[index]
        if (!issue) return { actions: [] }
        var body = "# Alpha installation\n\nInstall the package and set the environment. Read [Beta](beta.md).\n"
        return { actions: [{ op: "merge", issue: index, path: issue.similar, to: issue.page,
          expectedHash: e.pages[issue.similar].hash, targetHash: e.pages[issue.page].hash, body: body }] }
      } })
      var result = r.dreamWiki()
      ow.test.assert(result.attempted_actions.some(function(a) { return a.action === "model-repair" && a.status === "applied" }), true, "identified duplicate merged: " + result.reason)
      ow.test.assert(result.verification.ok, true, "merged page opens and searches")
      var backup = io.readFileJSON(result.backup_location + "/backup.json")
      ow.test.assert(isString(backup.files["copy.md"]) && isString(backup.files["alpha.md"]), true, "both originals preserved")
    })
  }

  exports.testAutoMalformedMetadataIsPreserved = function() {
    fixture(function(root) {
      var malformed = "---\ntitle: [unclosed\nsource: important-original\n---\n# Original\nDo not discard this text.\n"
      io.writeFileString(root + "/alpha.md", malformed)
      var result = runner(root).dreamWiki()
      ow.test.assert(result.ok, false, "malformed source cannot be reported healthy")
      ow.test.assert(result.diagnosed_issues.some(function(i) { return i.type === "malformed_frontmatter" }), true, "source metadata diagnosed separately")
      ow.test.assert(io.readFileString(root + "/alpha.md"), malformed, "unknown provenance remains byte-for-byte intact")
    })
  }
  exports.testAutoCurrentGenerationProof = function() { fixture(function(root) {
    var wm = new MiniAWikiManager({ root: root, access: 'rw', wikiretrievalv2: true }, function() {})
    try { wm.reindex(); io.writeFileString(wm._retrievalV2.root + '/current.json', '{broken') } finally { wm.close() }
    var preview = runner(root, { dryrun: true }).dreamWiki()
    ow.test.assert(preview.diagnosed_issues.some(function(i) { return i.type === 'derived_index_failure' }), true, 'healthy predecessor cannot mask corrupt current')
    var result = runner(root).dreamWiki()
    ow.test.assert(result.verification.ok, true, JSON.stringify(result))
    ow.test.assert(result.verification.serving.current_only, true, 'repaired current publication verified')
  }) }
  exports.testAutoMoveOnlyRecovery = function() { fixture(function(root) {
    var wm = new MiniAWikiManager({ root: root, access: 'rw', wikiretrievalv2: true }, function() {})
    try {
      wm._retrievalV2.build = function() { return { ok: false, error: 'injected publication failure' } }
      ow.test.assert(wm.move('alpha.md', 'topics/alpha.md').ok, false, 'move leaves recovery authority')
    } finally { wm.close() }
    var result = runner(root).dreamWiki()
    ow.test.assert(result.attempted_actions.some(function(a) { return a.action === 'move-resume' && a.status === 'applied' }), true, JSON.stringify(result))
    ow.test.assert(result.verification.ok, true, 'move-only recovery verified')
    ow.test.assert(io.fileExists(root + '/.mini-a-wiki-move/journal.json'), false, 'move journal completed')
    var backup = io.readFileJSON(result.backup_location + '/backup.json')
    ow.test.assert(isString(backup.files['.mini-a-wiki-move/journal.json']), true, 'move authority included in backup')
  }) }
  exports.testAutoAbsorptionRecovery = function() { fixture(function(root) {
    load('mini-a-absorb.js')
    var src = String(new java.io.File(io.createTempDir('auto_absorb_source_')).getCanonicalPath())
    try {
      io.writeFileString(src + '/new.md', '# New\n\nAbsorbed recovery evidence.')
      var absorber = new MiniAAbsorb({ wikiroot: root, wikiaccess: 'rw', absorbspec: { sources: [{ id: 'origin', root: src, all: true }] }, absorbop: 'plan' })
      absorber._setLlm({ promptJSONWithStats: function() { return { response: { proposals: [{ path: 'new.md', classification: 'enrichment', edits: [{ before: '', after: '# New\n\nAbsorbed recovery evidence.', evidence: ['origin:new.md'] }], evidence: ['origin:new.md'], mappings: [{ evidence: 'origin:new.md', anchor: '' }], dependencies: [] }], findings: [], irrelevant: [] } } } })
      var plan = absorber.run()
      ow.test.assert(plan.ok, true, JSON.stringify(plan))
      absorber._args.absorbop = 'apply'; absorber._args.absorbplan = plan.id
      absorber._afterWrite = function() { throw new Error('injected absorption interruption') }
      ow.test.assert(absorber.run().status, 'recovery-required', 'absorption leaves a valid journal')
      var result = runner(root).dreamWiki()
      ow.test.assert(result.attempted_actions.some(function(a) { return a.action === 'absorption-resume:' + plan.id && a.status === 'applied' }), true, JSON.stringify(result))
      ow.test.assert(result.verification.ok, true, 'absorption publication verified')
      ow.test.assert(io.fileExists(root + '/.mini-a-wiki-absorb/journal.json'), false, 'absorption journal cleared')
      ow.test.assert(io.readFileString(root + '/new.md').indexOf('Absorbed recovery evidence.') >= 0, true, 'saved operation preserved')
    } finally { io.rm(src) }
  }) }
  function breakAnchor(root) {
    var path = root + "/alpha.md"
    io.writeFileString(path, io.readFileString(path).replace("(beta.md)", "(beta.md#obsolete-route)"))
  }
  function fakeDecision(r, fn) {
    r._createWikiDecision = function() { return { isConfigured: function() { return true }, decide: fn } }
  }
  function choice(value) { return { response: { answers: { repair: { type: "choice", value: value } } } } }
  exports.testAutoDecisionAnchorAndFreshFallback = function() {
    fixture(function(root) {
      breakAnchor(root); breakDescription(root)
      var logs = [], r = runner(root, { dreamwikillm: true, dreammaxsteps: 2 }, function(v) { logs.push(String(v)) }), calls = 0
      fakeDecision(r, function(state, questions) {
        calls++
        ow.test.assert(questions.repair.criteria.candidate_0, "beta.md#beta-networking", "only existing heading supplied")
        return choice("candidate_0")
      })
      r._setLlm({ prompt: function(prompt) {
        var e = evidence(prompt)
        ow.test.assert(e.pages["alpha.md"].raw.indexOf("beta.md#beta-networking") >= 0, true, "fallback uses repaired source")
        return { actions: [] }
      } })
      var res = r.dreamWiki()
      ow.test.assert(calls, 1, "one decision call")
      ow.test.assert(res.llm_steps, 2, "decision and fallback share budget")
      ow.test.assert(res.decision.selected, 1, "selected counted")
      ow.test.assert(res.verified_fixes.some(function(i) { return i.type === "invalid_anchor" }), true, "fresh lint verifies anchor")
      ow.test.assert(res.verification.ok, true, "fresh retrieval verifies changes")
      ow.test.assert(logs.some(function(v) { return v.indexOf("dreamwikimode=auto dreamwikillm=true wikiaccess=rw") >= 0 }), true, "semantic hint names options")
    })
  }
  exports.testAutoDecisionFailuresFallback = function() {
    ["defer", "invalid", "provider"].forEach(function(mode) {
      fixture(function(root) {
        breakAnchor(root)
        var r = runner(root, { dreamwikillm: true, dreammaxsteps: 2 }), calls = 0
        fakeDecision(r, function() {
          if (mode === "provider") throw new Error("secret provider message")
          return choice(mode === "invalid" ? "invented-target" : "defer")
        })
        r._setLlm({ prompt: function(prompt) {
          calls++
          ow.test.assert(evidence(prompt).pages["alpha.md"].raw.indexOf("obsolete-route") >= 0, true, "fallback retains unresolved link")
          return { actions: [] }
        } })
        var res = r.dreamWiki()
        ow.test.assert(calls, 1, mode + " falls back once")
        ow.test.assert(res.decision.fallbacks, 1, "fallback counted")
        ow.test.assert(JSON.stringify(res.decision).indexOf("secret provider") < 0, true, "errors sanitized")
        ow.test.assert(res.verified_fixes.some(function(i) { return i.type === "invalid_anchor" }), false, "unresolved selection never fixed")
      })
    })
  }
  exports.testAutoDecisionOptOutAndBudget = function() {
    [{ usedecide: false }, { dreamwikillm: false }, { dryrun: true }, { dreammaxsteps: 1 }].forEach(function(opts) {
      fixture(function(root) {
        breakAnchor(root)
        var r = runner(root, merge({ dreamwikillm: true, dreammaxsteps: 3 }, opts))
        r._createWikiDecision = function() { throw new Error("decision must not initialize") }
        r._setLlm({ prompt: function() { return { actions: [] } } })
        var res = r.dreamWiki()
        ow.test.assert(res.decision.calls, 0, "opt-out/dry-run/budget skips decide: " + JSON.stringify(opts))
        ow.test.assert(isUnDef(res.reason), true, "no unexpected failure: " + JSON.stringify(res))
      })
    })
  }
  exports.testAutoDecisionAmbiguousLink = function() {
    fixture(function(root) {
      var wm = new MiniAWikiManager({ root: root, backend: "fs", access: "rw", wikiretrievalv2: true }, function() {})
      try {
        wm.write("install/topic.md", { title: "Package setup", description: "Installation reference", type: "concept" }, "# Package setup\n\nUnpack archives and verify installed checksums.\n")
        wm.write("network/topic.md", { title: "Network routing", description: "Router reference", type: "concept" }, "# Network routing\n\nRoute packets through the configured gateway.\n")
        var pg = wm.read("alpha.md")
        wm.write("alpha.md", pg.meta, pg.body.replace("(beta.md)", "(topic.md)"))
        wm.regenerateIndexes(); wm.reindex()
      } finally { wm.close() }
      var r = runner(root, { dreamwikillm: true, dreammaxsteps: 2 })
      fakeDecision(r, function(state, questions) {
        var id = Object.keys(questions.repair.criteria).filter(function(k) { return questions.repair.criteria[k] === "install/topic.md" })[0]
        ow.test.assert(isString(id), true, "existing alternatives supplied")
        return choice(id)
      })
      r._setLlm({ prompt: function() { return { actions: [] } } })
      var res = r.dreamWiki()
      ow.test.assert(res.decision.selected, 1, "ambiguous link selected")
      ow.test.assert(io.readFileString(root + "/alpha.md").indexOf("(install/topic.md)") >= 0, true, "canonical selected path written")
      ow.test.assert(res.verification.ok, true, "publication verified")
    })
  }
  exports.testAutoDecisionConflictsAndOwnership = function() {
    fixture(function(root) {
      breakAnchor(root)
      var r = runner(root, { dreamwikillm: true, dreammaxsteps: 2 }), calls = 0
      fakeDecision(r, function() {
        io.writeFileString(root + "/beta.md", io.readFileString(root + "/beta.md") + "\nConcurrent edit\n")
        return choice("candidate_0")
      })
      r._setLlm({ prompt: function() { calls++; return { actions: [] } } })
      var res = r.dreamWiki()
      ow.test.assert(res.reason.indexOf("external-change-conflict") >= 0, true, "changed target blocks repair")
      ow.test.assert(calls, 0, "conflict never falls back to writes")
      ow.test.assert(io.readFileString(root + "/alpha.md").indexOf("obsolete-route") >= 0, true, "source untouched")
    })
    fixture(function(root) {
      breakAnchor(root)
      var path = root + "/alpha.md"
      io.writeFileString(path, io.readFileString(path).replace("\n---\n", "\nsource: owned-source\n---\n"))
      var r = runner(root, { dreamwikillm: true }), before = io.readFileString(path)
      r._createWikiDecision = function() { throw new Error("owned source must not be judged") }
      r._setLlm({ prompt: function() { return { actions: [] } } })
      var res = r.dreamWiki()
      ow.test.assert(res.decision.calls, 0, "owned source skipped")
      ow.test.assert(io.readFileString(path), before, "owned source preserved")
    })
  }
  exports.testAutoDecisionConfiguration = function() {
    var cfg = { type: "openai", model: "fixture-decision" }, r = new MiniADreams({ modeldec: cfg })
    ow.test.assert(r._createWikiDecision()._config.model, cfg.model, "modeldec takes precedence over environment")
    r = new MiniADreams({ modeldec: cfg, usedecide: false })
    ow.test.assert(r._createWikiDecision().isConfigured(), false, "explicit opt-out overrides configuration")
    var dec = new MiniADecision({ env: function() { return "" } })
    ow.test.assert(dec.isConfigured(), false, "no configuration remains disabled")
    loadLib("mini-a-wikiops.js")
    var settings = MiniAWikiOps.settings({ modeldec: cfg, usedecide: false })
    ow.test.assert(settings.modeldec.model, cfg.model, "Wiki Manager forwards decision configuration")
    ow.test.assert(settings.usedecide, false, "Wiki Manager forwards opt-out")
    ow.test.assert(MiniAWikiOps.sensitive("modeldec", cfg), true, "decision configuration is redacted")
    var rejected = false
    try { new MiniAWikiOps({}).spec("dream.auto", { modeldec: cfg }) } catch(e) { rejected = String(e).indexOf("Use configuration arguments") >= 0 }
    ow.test.assert(rejected, true, "decision model remains configuration, not operation data")
  }
  exports.testAutoDecisionBoundsAndRepeat = function() {
    var r = runner("/tmp", { dreamwikillm: true }), calls = 0
    fakeDecision(r, function() { calls++; return choice("defer") })
    r._wikiDecisionTried = {}
    var report = { llm_steps: 0, decision: { calls: 0, selected: 0, fallbacks: 0, duration_ms: 0, reasons: {} } }
    var issue = { type: "broken_link", page: "source.md", target: "topic.md" }
    var pages = { "source.md": { raw: "Source context" }, "one.md": { raw: "First target" }, "two.md": { raw: "Second target" } }
    var wm = { read: function(p) { return pages[p] }, _backend: { read: function(p) { return pages[p].raw } } }
    var choices = [{ candidate: { path: "one.md" }, anchor: "" }, { candidate: { path: "two.md" }, anchor: "" }]
    r._autoDecideLink(wm, issue, choices, {}, report, 10)
    r._autoDecideLink(wm, issue, choices, {}, report, 10)
    ow.test.assert(calls, 1, "identical deferred evidence not retried")
    r._autoDecideLink(wm, issue, choices, { "one.md": true }, report, 10)
    ow.test.assert(calls, 1, "owned candidate never judged")
    pages["source.md"].raw = "x".repeat(18000)
    pages["one.md"].raw = "y".repeat(18000)
    pages["two.md"].raw = "z".repeat(18000)
    r._autoDecideLink(wm, issue, choices, {}, report, 10)
    ow.test.assert(calls, 1, "oversized request bypasses decide without truncation")
    r._autoDecideLink(wm, issue, Array(65).fill(choices[0]), {}, report, 10)
    ow.test.assert(calls, 1, "oversized candidate catalogue bypasses decide")
    delete pages["one.md"]
    r._autoDecideLink(wm, issue, choices, {}, report, 10)
    ow.test.assert(calls, 1, "missing candidate evidence bypasses decide")
    r._wikiDecision = { isConfigured: function() { return false }, decide: function() { throw new Error("must not call") } }
    r._autoDecideLink(wm, issue, choices, {}, report, 10)
    ow.test.assert(report.llm_steps, 1, "skips and repeat do not consume steps")
    pages["one.md"] = { raw: "First target" }
    pages["source.md"].raw = "Source context"; pages["two.md"].raw = "Second target"
    r._wikiDecisionTried = {}
    r._wikiDecision = { isConfigured: function() { return true }, decide: function() { r._autoCancelled = true; return choice("candidate_0") } }
    var cancelled = false
    try { r._autoDecideLink(wm, issue, choices, {}, report, 10) } catch(e) { cancelled = String(e).indexOf("auto-cancelled") >= 0 }
    ow.test.assert(cancelled, true, "cancellation after decide stops before any repair")
  }
  exports.testDeterministicSemanticLogs = function() {
    fixture(function(root) {
      breakAnchor(root)
      var logs = [], r = runner(root), wm = new MiniAWikiManager({ root: root, backend: "fs", access: "rw" }, function() {})
      r._logFn = function(v) { logs.push(String(v)) }
      r._createWikiDecision = function() { throw new Error("deterministic repair must not initialize model") }
      try { r._repairWikiLint(wm, wm.lint()) } finally { wm.close() }
      ow.test.assert(logs.some(function(v) { return v.indexOf("dreamwikimode=auto dreamwikillm=true wikiaccess=rw") >= 0 }), true, "invalid anchor discovered during repair has semantic option hint")
      ow.test.assert(logs.some(function(v) { return v.indexOf("dreamwikireorg=true dreamwikiapproval=auto") >= 0 }), true, "broader reorg gates named")
      ow.test.assert(logs.some(function(v) { return v.indexOf("disabled by dreamwikillm=false") >= 0 }), true, "disabled semantic repair explained")
    })
  }
})()
