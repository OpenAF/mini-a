(function() {
  // Rebuild from existing Markdown and verify opt-in and resumable phase checkpoints.
  load("js/core/mini-a-common.js")
  load("js/wiki/mini-a-wiki.js")
  var dir = String(io.createTempDir("wiki-full-rebuild-")), wm
  var assert = function(value, message) {
    if (!value) throw new Error(message)
  }
  try {
    io.writeFileString(dir + "/page.md", "---\ntitle: Example\ntags: [cache]\n---\n# Cache\nPersistent cache avoids repeated work.")
    wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw", usegraph: true, wikiretrievalv2: true }, function() {})
    assert(wm.fullRebuild({}).ok === false, "expensive opt-in required")
    var paused = wm.fullRebuild({ confirmExpensive: true, isCancelled: function() { return true } })
    assert(paused.complete === false && paused.phase === "index", "cancel before work and retain journal")
    var result = wm.fullRebuild({ confirmExpensive: true, modelHelp: "off" })
    assert(result.ok && result.complete, "complete deterministic rebuild: " + stringify(result))
    assert(wm.search("Persistent").length > 0, "rebuilt search index finds existing content")
    assert(io.readFileString(dir + "/page.md").indexOf("Persistent cache") > 0, "source Markdown retained")
    // An interruption after index publication must resume graph work without republishing the index.
    var originalGraph = wm.graph, originalReindex = wm.reindex, builds = 0
    wm.reindex = function(options) {
      builds++
      return originalReindex.call(wm, options)
    }
    wm.graph = function() { throw new Error("simulated interruption") }
    try { wm.fullRebuild({ confirmExpensive: true, modelHelp: "off" }) } catch(expected) {}
    assert(builds === 1, "publish index before graph work")
    wm.graph = originalGraph
    result = wm.fullRebuild({ confirmExpensive: true, modelHelp: "off" })
    assert(result.complete && builds === 1, "resume reuses completed index phase")
    wm.graph = function() { throw new Error("simulated interruption") }
    try { wm.fullRebuild({ confirmExpensive: true, modelHelp: "off" }) } catch(expected) {}
    io.writeFileString(dir + "/new.md", "# New\nchangedsourcefreshness")
    wm.graph = originalGraph
    result = wm.fullRebuild({ confirmExpensive: true, modelHelp: "off" })
    assert(result.complete && builds === 3, "source edits invalidate previous index checkpoint")
    assert(wm.search("changedsourcefreshness").length > 0, "resumed index includes external edits")
    // Exercise the same dispatcher used by wikiman and Studio workers.
    load("js/wiki/mini-a-wikiops.js")
    var runner = new MiniAWikiOps({ wikiroot: dir, wikiaccess: "rw", usewikigraph: true, wikiretrievalv2: true }, function() {})
    var dispatched = runner.execute(runner.spec("dream.rebuild", { modelHelp: "off" }), { confirm: true })
    assert(dispatched.ok && dispatched.complete, "wikiman/Dream dispatcher completes: " + stringify(dispatched))
    // Budget-limited model enrichment resumes after restart without repeating completed calls.
  io.writeFileString(dir + "/one.md", "TLS uses HTTP.")
  io.writeFileString(dir + "/two.md", "TLS uses HTTPS.")
  io.writeFileString(dir + "/three.md", "TCP supports TLS.")
  var modelCalls = 0
  var models = [{ role: "lc", fingerprint: "rebuild-fixture", extract: function() {
    modelCalls++
    return { relationships: [] }
  } }]
  wm._graph._cfg.modelExtractors = models
  result = wm.fullRebuild({ confirmExpensive: true, modelHelp: "auto", maxCalls: 1 })
  assert(result.partial && result.resumable && modelCalls === 1, "model budget leaves a resumable rebuild")
  wm.close()
  wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw", skipBootstrap: true, usegraph: true, wikiretrievalv2: true }, function() {})
  wm._graph._cfg.modelExtractors = models
  result = wm.fullRebuild({ confirmExpensive: true, modelHelp: "auto", maxCalls: 100 })
  assert(result.complete && result.graph.cached >= 1, "restart reuses completed model work")
  assert(result.graph.calls === modelCalls - 1, "resumed calls exclude previous completed work")
  // Read-only managers must refuse the same operation.
    wm.close()
    wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro", usegraph: true, wikiretrievalv2: true }, function() {})
    assert(wm.fullRebuild({ confirmExpensive: true }).ok === false, "read-only rebuild refused")
    print("Full rebuild tests passed")
  } finally {
    if (wm) wm.close()
    io.rm(dir)
  }
})()
