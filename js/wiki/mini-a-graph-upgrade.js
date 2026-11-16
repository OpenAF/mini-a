// Rebuild derived graph state in a private directory before replacing the usable graph.
var __miniAGraphUpgrade = function(wm, options) {
  var opts = options || {}
  var preview = opts.preview === true
  if (wm._backendType !== "fs" || wm._catalog || !wm._graph) return { ok: false, error: "Graph upgrade requires a filesystem wiki with graph enabled" }
  if (!preview && wm._access !== "rw") return { ok: false, error: "wiki is read-only" }
  if (!preview && opts.confirmExpensive !== true) return { ok: false, error: "Confirm the expensive full rebuild explicitly" }
  var effective = preview ? wm.graphBuildSettings(opts).effective : null
  if (!preview && wm.knowledgeMovePending()) return { ok: false, error: "structural-move-recovery-required" }
  var pages = wm._graphPages()
  var inventory = sha256(stringify(pages.map(function(page) { return [page.path, page.revision] }).sort(function(a, b) { return a[0].localeCompare(b[0]) }), __, ""))
  var live = wm._graph
  if (preview) {
    return { ok: true, preview: true, pagesInspected: pages.length, existing: live.stats({ detailed: true }), expected: live.build(pages, merge(effective, { strategy: "full", preview: true })), modelCalls: 0, estimates: { embeddingCalls: effective.reconcile === "hybrid" ? [0, Math.min(effective.embeddingMaxCalls, pages.length)] : [0, 0], modelCalls: [0, (effective.reconcileLlm === "auto" ? effective.reconcileMaxCalls : 0) + (effective.extraction === "semantic" && effective.modelHelp === "auto" ? effective.maxCalls : 0)], diskBytes: Number(new java.io.File(live._graphDir + "/graph.json").length()) * 3, uncertain: true } }
  }
  var lock = __miniAWikiWriterLock(wm._backend.root)
  var journalPath = wm._getIndexRoot() + "/.mini-a-wiki-full-rebuild.json"
  var graphFile = live._graphDir + "/graph.json"
  var remoteMarker = live._graphDir + "/remote-sync.json"
  var stage
  var state

  // Persist every publication boundary using the existing durable JSON helper.
  function checkpoint() {
    __miniAWikiMaintenanceJson(journalPath, state)
    if (isFunction(opts.onProgress)) opts.onProgress({ operation: "full-rebuild", id: state.id, phase: state.phase })
  }

  // The inventory includes raw-page revisions, not only filenames or timestamps.
  function currentInventory() {
    return sha256(stringify(wm._graphPages().map(function(page) { return [page.path, page.revision] }).sort(function(a, b) { return a[0].localeCompare(b[0]) }), __, ""))
  }

  // A paused run must not overwrite independently committed graph evidence.
  function graphChecksum() {
    return io.fileExists(graphFile) ? sha256(io.readFileString(graphFile)) : "missing"
  }

  // Keep the live graph and staged work available for inspection after a conflict.
  function conflict() {
    return { ok: false, complete: false, partial: true, resumable: false, status: "graph-conflict", error: "Live graph changed during upgrade; start a new graph upgrade to include the current evidence", phase: state.phase, id: state.id }
  }

  try {
    state = io.fileExists(journalPath) ? io.readFileJSON(journalPath) : null
    if (state && state.version !== 1 && state.version !== 2) throw new Error("unsupported-rebuild-journal")
    if (state && state.destination && state.destination !== String(new java.io.File(wm._backend.root).getCanonicalPath())) throw new Error("rebuild-destination-mismatch")
    if (state && state.version === 1) {
      if (!/^[a-f0-9-]{36}$/.test(state.id || "")) throw new Error("unsupported-rebuild-journal")
      __miniAWikiMaintenanceJson(journalPath + ".v1-" + state.id, state)
      state = { version: 2, id: state.id, phase: "inventory", migratedFrom: 1, legacyPhase: state.phase }
    }
    if (opts.resumeOnly === true && (!state || state.phase === "complete")) return { ok: false, error: "no-pending-graph-upgrade" }
    if (state && state.baseGraphChecksum && ["inventory", "index", "structure", "graph", "ready"].indexOf(state.phase) >= 0) {
      var currentGraph = graphChecksum()
      if (currentGraph !== state.baseGraphChecksum && currentGraph !== state.checksum) {
        if (opts.resumeOnly === true) return conflict()
        // An explicit new upgrade starts from the newer live graph; the old stage is retained.
        state = null
      }
    }
    if (!state || state.phase === "complete" || state.source && state.source !== inventory) state = { version: 2, id: String(java.util.UUID.randomUUID()), phase: "inventory" }
    if (!/^[a-f0-9-]{36}$/.test(state.id || "") || ["inventory", "index", "structure", "graph", "ready", "published", "remote-sync"].indexOf(state.phase) < 0) throw new Error("unsupported-rebuild-journal")
    state.destination = String(new java.io.File(wm._backend.root).getCanonicalPath())
    if (!state.baseGraphChecksum) state.baseGraphChecksum = graphChecksum()
    if (opts.runId && opts.runId !== state.id) throw new Error("rebuild-run-id-mismatch")
    state.source = inventory
    if (state.settings) {
      var resumed = MiniAGraphBuild.resolve(merge(state.settings, opts))
      if (["ready"].indexOf(state.phase) >= 0 && ["extraction", "modelHelp", "reconcile", "reconcileLlm", "reconcileMaxEdges", "reconcileMaxDf"].some(function(key) { return resumed[key] !== state.settings[key] })) state.phase = "graph"
      effective = resumed
    } else effective = wm.graphBuildSettings(opts).effective
    state.settings = clone(effective)
    state.settings.retryFailed = false
    state.settings.reconcileRetryFailed = false
    var stageDir = live._graphDir + "/staging/" + state.id
    if (String(new java.io.File(stageDir).getCanonicalPath()) !== String(new java.io.File(stageDir).getAbsolutePath())) throw new Error("unsafe-graph-staging-path")
    var stageFile = stageDir + "/graph.json"
    checkpoint()
    if (isFunction(opts.isCancelled) && opts.isCancelled()) return { ok: true, complete: false, partial: true, resumable: true, status: "cancelled", phase: state.phase, id: state.id }
    if (state.phase === "inventory") {
      state.phase = opts.graphOnly === true ? "structure" : "index"
      checkpoint()
    }
    if (state.phase === "index") {
      var indexed = wm.reindex({ authoritative: true, resetLucene: true, skipGraph: true })
      if (!indexed || indexed.ok !== true) return { ok: false, phase: "index", result: indexed }
      state.phase = "structure"
      checkpoint()
    }
    if (["structure", "graph"].indexOf(state.phase) >= 0) {
      if (!io.fileExists(stageFile)) {
        var seed = io.fileExists(graphFile) ? io.readFileJSON(graphFile) : live._state
        var legacySnapshot = graphFile + ".before-full-rebuild-" + state.id
        if (state.migratedFrom && io.fileExists(legacySnapshot)) {
          // Retain both the predecessor and proven work completed after a v1 reset.
          seed = io.readFileJSON(legacySnapshot)
          seed.nodes = merge(seed.nodes || {}, live._state.nodes)
          seed.edges = live._state.edges.concat(seed.edges || [])
          seed.summaries = seed.summaries || { pages: {}, communities: {} }
          seed.summaries.pages = merge(seed.summaries.pages || {}, live._state.summaries.pages)
          ;["semantic_cache", "semantic_carry"].forEach(function(key) {
            seed[key] = merge(seed[key] || {}, live._state[key] || {})
          })
          seed.enrichment = seed.enrichment || {}
          Object.keys(live._state.enrichment || {}).forEach(function(path) {
            var prior = seed.enrichment[path]
            var current = live._state.enrichment[path]
            if (prior && prior.hash === current.hash) {
              var completed = merge(prior.completed || {}, current.completed || {})
              seed.enrichment[path] = merge(prior, current)
              seed.enrichment[path].completed = completed
            } else seed.enrichment[path] = current
          })
          if (live._state.reconciliation) seed.reconciliation = live._state.reconciliation
        }
        __miniAWikiMaintenanceJson(stageFile, seed)
      }
      var cfg = merge(live._cfg, { graphDir: stageDir, embeddingCacheDir: live._graphDir, reconcileIndexDir: live._graphDir + "/reconcile", graphRaw: __, falkor: __, readOnly: false, autosave: "always", __privateReader: true })
      stage = new MiniAWikiGraph(cfg, live._log)
      if (state.phase === "structure") {
        stage.buildStructural(pages, { preview: true })
        if (stage._state.reconciliation) stage._state.reconciliation.completed = {}
        stage.save()
        state.phase = "graph"
        checkpoint()
      }
      var result
      try {
        wm._graph = stage
        result = wm.graph("build", merge(effective, { force: opts.force === true, onProgress: opts.onProgress, isCancelled: opts.isCancelled, formatModelError: opts.formatModelError }))
      } finally {
        wm._graph = live
      }
      state.graph = result
      state.calls = (state.calls || 0) + (result.calls || 0)
      state.validationCalls = (state.validationCalls || 0) + (result.reconciliation && result.reconciliation.calls || 0)
      state.embeddingCalls = (state.embeddingCalls || 0) + (result.reconciliation && result.reconciliation.embeddingCalls || 0)
      checkpoint()
      if (result.ok === false || result.partial || result.failed || effective.modelHelp === "auto" && result.pending) return { ok: result.ok !== false, complete: false, partial: true, resumable: result.resumable !== false, retryRequired: result.retryRequired === true, status: result.status || "partial", phase: state.phase, graph: result, id: state.id }
      // Known stale legacy evidence cannot become current merely by surviving a rebuild.
      stage._state.edges.slice().forEach(function(edge) {
        var props = edge.props || {}
        if (!props.page || !props.sourceHash) return
        var owner = stage._state.nodes["doc:" + props.page]
        if (!owner || owner.props.hash !== props.sourceHash || props.revision && owner.props.revision !== props.revision) stage._removeEdge(edge)
      })
      stage._markDerivedDirty()
      stage._ensureDerived()
      stage.save()
      state.graph.stats = stage.stats()
      var saved = io.readFileJSON(stageFile)
      var invalid = saved.edges.some(function(edge) { return !saved.nodes[edge.from] || !saved.nodes[edge.to] })
      if (invalid) throw new Error("staged-graph-dangling-endpoints")
      var roundTrip = new MiniAWikiGraph({ graphDir: stageDir, readOnly: true, __privateReader: true })
      try {
        if (roundTrip.stats().edges !== stage.stats().edges) throw new Error("staged-graph-roundtrip-mismatch")
      } finally { roundTrip.close() }
      if (currentInventory() !== state.source) throw new Error("stale-stage: wiki changed during graph rebuild")
      __miniAWikiMaintenanceJson(stageFile, saved)
      state.checksum = sha256(io.readFileString(stageFile))
      state.phase = "ready"
      checkpoint()
    }
    if (state.phase === "ready") {
      if (isFunction(opts.isCancelled) && opts.isCancelled()) return { ok: true, complete: false, partial: true, resumable: true, status: "cancelled", phase: state.phase, id: state.id }
      if (!io.fileExists(stageFile) || sha256(io.readFileString(stageFile)) !== state.checksum) throw new Error("staged-graph-checksum-mismatch")
      if (currentInventory() !== state.source) throw new Error("stale-stage: wiki changed before publication")
      var published = io.fileExists(graphFile) && sha256(io.readFileString(graphFile)) === state.checksum
      if (!published) {
        if (graphChecksum() !== state.baseGraphChecksum) return conflict()
        state.previous = graphFile + ".before-full-rebuild-" + state.id
        if (!io.fileExists(state.previous)) __miniAWikiMaintenanceJson(state.previous, io.fileExists(graphFile) ? io.readFileJSON(graphFile) : live._state)
        state.previousChecksum = sha256(io.readFileString(state.previous))
        checkpoint()
        if (graphChecksum() !== state.baseGraphChecksum) return conflict()
        if (live._hasFalkor()) __miniAWikiMaintenanceJson(remoteMarker, { version: 1, id: state.id, checksum: state.checksum })
        __miniAWikiMaintenanceJson(graphFile, io.readFileJSON(stageFile))
        if (sha256(io.readFileString(graphFile)) !== state.checksum) throw new Error("published-graph-checksum-mismatch")
      }
      state.phase = "published"
      checkpoint()
    }
    if (["published", "remote-sync"].indexOf(state.phase) >= 0) {
      live._state = merge(live._emptyState(), io.readFileJSON(graphFile))
      live._reindexEdges()
      live._markDerivedDirty()
      live._pendingSave = false
      if (live._hasFalkor()) {
        state.phase = "remote-sync"
        checkpoint()
        var synced = live.falkorSync()
        if (!synced || synced.ok !== true) return { ok: false, complete: false, partial: true, resumable: true, status: "remote-sync-pending", phase: state.phase, id: state.id, graph: state.graph }
        if (io.fileExists(remoteMarker)) io.rm(remoteMarker)
      }
      state.phase = "complete"
      checkpoint()
    }
    return { ok: true, complete: true, partial: false, resumable: false, status: "complete", phase: state.phase, retryRequired: false, id: state.id, graph: state.graph, previous: state.previous, calls: state.calls || 0, validationCalls: state.validationCalls || 0, embeddingCalls: state.embeddingCalls || 0 }
  } finally {
    wm._graph = live
    if (stage) stage.close()
    lock.release()
  }
}

// Restore only a checksum-verified predecessor from the current rebuild journal.
var __miniAGraphRollback = function(wm, options) {
  var opts = options || {}
  if (wm._access !== "rw" && opts.preview !== true || wm._backendType !== "fs" || !wm._graph || wm._catalog) return { ok: false, error: "Rollback requires a writable filesystem wiki" }
  var lock = opts.preview === true ? null : __miniAWikiWriterLock(wm._backend.root)
  try {
    var path = wm._getIndexRoot() + "/.mini-a-wiki-full-rebuild.json"
    var state = io.readFileJSON(path)
    if (state.version !== 2 || !/^[a-f0-9-]{36}$/.test(state.id || "") || opts.runId !== state.id) return { ok: false, error: "Specify the current upgrade runId to restore its predecessor" }
    var graph = wm._graph
    var previous = graph._graphDir + "/graph.json.before-full-rebuild-" + state.id
    if (state.previous !== previous || !io.fileExists(previous) || sha256(io.readFileString(previous)) !== state.previousChecksum) return { ok: false, error: "Previous graph snapshot is unavailable or corrupt" }
    if (opts.preview === true) return { ok: true, preview: true, runId: state.id, previousChecksum: state.previousChecksum }
    var marker = graph._graphDir + "/remote-sync.json"
    if (graph._hasFalkor()) __miniAWikiMaintenanceJson(marker, { version: 1, id: state.id, rollback: true })
    __miniAWikiMaintenanceJson(graph._graphDir + "/graph.json", io.readFileJSON(previous))
    graph._state = merge(graph._emptyState(), io.readFileJSON(previous))
    graph._reindexEdges()
    graph._markDerivedDirty()
    graph._pendingSave = false
    state.rolledBack = true
    state.phase = "complete"
    __miniAWikiMaintenanceJson(path, state)
    if (graph._hasFalkor()) {
      var synced = graph.falkorSync()
      if (!synced || synced.ok !== true) return { ok: false, status: "remote-sync-pending", restored: true }
      io.rm(marker)
    }
    return { ok: true, restored: true, runId: state.id }
  } finally { if (lock) lock.release() }
}
