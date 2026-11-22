// Exercise real graph persistence, corpus-wide grounding and resumable publication.
load("js/core/mini-a-common.js")
load("js/wiki/mini-a-wiki.js")
load("js/wiki/mini-a-graph.js")
var checks = 0
var root = String(new java.io.File(String(io.createTempDir("graph-reconcile-"))).getCanonicalPath())
var manager

// Count assertions so a prematurely terminated harness is visible.
function assert(value, message) {
  if (!value) throw new Error(message)
  checks++
}

// Supply stable raw revisions for graph fixtures.
function page(path, body, title) {
  return { path: path, body: body, meta: { title: title || path }, links: [], revision: sha1(body) }
}

try {
  var graph = new MiniAWikiGraph({ graphDir: root + "/graph", modelExtractors: [] })
  var pages = [page("old.md", "The `cacheKey` identifies stored responses."), page("unrelated.md", "Flowers grow near rivers.")]
  graph.build(pages, {})
  var unchangedProgress = []
  var unchangedSnapshot = io.readFileString(root + "/graph/graph.json")
  graph.build(pages, { reconcile: "lexical", onProgress: function(progress) { unchangedProgress.push(progress) } })
  assert(unchangedProgress[0].stage === "structural" && unchangedProgress[unchangedProgress.length - 1].stage === "complete", "unchanged reconciled builds preserve structural and completion progress")
  assert(unchangedProgress[unchangedProgress.length - 1].processed === pages.length && io.readFileString(root + "/graph/graph.json") === unchangedSnapshot, "unchanged progress completes without rewriting the graph")
  assert(!graph._state.edges.some(function(edge) { return edge.type === "MENTIONS" }), "legacy structural build is unchanged")
  graph._upsertNode("concept:id:cachekey", "concept", { name: "cacheKey", joinable: true })
  graph._addEdge("doc:old.md", "concept:id:cachekey", "MENTIONS", "EXTRACTED", { page: "old.md", section: "", sourceHash: "obsolete", revision: "obsolete", evidenceLayer: "grounded", evidence: { quote: "cacheKey" } })
  pages.push(page("new.md", "Use `cacheKey` to retrieve responses."))
  var built = graph.build(pages, { reconcile: "lexical" })
  assert(built.reconciliation.complete, "lexical reconciliation completes")
  var mentions = graph._state.edges.filter(function(edge) { return edge.type === "MENTIONS" })
  assert(mentions.length === 2 && mentions[0].to === mentions[1].to, "new batch connects to grounded old page")
  assert(mentions.every(function(edge) { return graph._currentEvidence(edge) }), "stale legacy assertions are replaced without duplicate edge-key collisions")
  assert(graph._state.edges.every(function(edge) { return edge.type !== "RELATED_TO" }), "similarity never generates document relationships")
  var remoteGraph = new MiniAWikiGraph({ graphDir: root + "/incremental-remote", modelExtractors: [] })
  var sawVerifiedLocal = false
  remoteGraph._hasFalkor = function() { return true }
  remoteGraph.falkorSync = function() {
    var saved = io.readFileJSON(remoteGraph._graphDir + "/graph.json")
    sawVerifiedLocal = isMap(saved.reconciliation) && io.fileExists(remoteGraph._graphDir + "/remote-sync.json")
    return { ok: false, error: "simulated backend failure" }
  }
  var remoteResult = remoteGraph.build(pages, { reconcile: "lexical" })
  assert(sawVerifiedLocal && remoteResult.publication.remoteSyncPending, "incremental remote publication starts from a usable local graph")
  remoteGraph.falkorSync = function() { return { ok: true } }
  remoteGraph._persist()
  assert(!io.fileExists(remoteGraph._graphDir + "/remote-sync.json"), "successful incremental synchronization clears its durable marker")
  var before = io.readFileString(root + "/graph/graph.json")
  built = graph.build(pages, { reconcile: "lexical" })
  assert(built.reconciliation.cached === 3 && !built.reconciliation.changed, "completed signatures are reused")
  assert(io.readFileString(root + "/graph/graph.json") === before, "unchanged reconciliation does not rewrite graph")
  var preview = graph.build([page("preview.md", "Use `otherKey`.")], { reconcile: "lexical", preview: true, strategy: "full", __privatePreview: true })
  assert(preview.ok && graph._state.nodes["doc:old.md"] && !graph._state.nodes["doc:preview.md"], "preview isolates in-memory state")
  assert(io.readFileString(root + "/graph/graph.json") === before, "preview does not write artifacts")
  pages[0] = page("old.md", "Responses are no longer indexed.")
  graph.updatePage(pages[0])
  assert(graph.stats({ detailed: true }).connectivity.enrichment.status === "pending", "manual writes expose pending reconciliation without starting providers")
  graph.build(pages, { reconcile: "lexical" })
  assert(!graph._state.edges.some(function(edge) { return edge.type === "MENTIONS" && edge._deleted !== true }), "editing peer removes unsupported shared membership")
  pages.splice(0, 1)
  graph.build(pages, { reconcile: "lexical" })
  assert(!graph._state.reconciliation.pages["old.md"], "deleted pages leave discovery index")
  var many = []
  for (var i = 0; i < 5; i++) many.push(page("p" + i + ".md", "Use `sharedKey`."))
  var limited = graph.build(many, { reconcile: "lexical", reconcileMaxPages: 2, reconcileMaxDf: 1 })
  // The first run indexes at most reconcileMaxPages; one build repeats larger runs until the corpus settles.
  assert(!limited.partial && limited.reconciliation.runs >= 2 && limited.reconciliation.indexed === 5, "indexing has bounded durable work per run")
  graph = new MiniAWikiGraph({ graphDir: root + "/graph", modelExtractors: [] })
  for (var attempt = 0; attempt < 5; attempt++) {
    limited = graph.build(many, { reconcile: "lexical", reconcileMaxPages: 2, reconcileMaxDf: 1 })
    if (!limited.partial) break
  }
  assert(!limited.partial, "bounded work resumes after restart")
  var embeddingCalls = 0
  var hybrid = new MiniAWikiGraph({ graphDir: root + "/hybrid", modelExtractors: [], reconcileEmbeddingModel: { type: "ollama", model: "fixture" }, reconcileEmbeddingRequest: function() {
    embeddingCalls++
    return [1, 2, 3]
  } })
  var pair = [page("one.md", "Use `bucketKey`."), page("two.md", "Read `bucketKey`.")]
  var hybridResult = hybrid.build(pair, { reconcile: "hybrid", embeddingMaxCalls: 1 })
  assert(hybridResult.partial && embeddingCalls === 1, "embedding misses obey their separate budget")
  hybridResult = hybrid.build(pair, { reconcile: "hybrid", embeddingMaxCalls: 1 })
  assert(!hybridResult.partial && embeddingCalls === 2, "hybrid resumes from cached vectors")
  hybridResult = hybrid.build(pair, { reconcile: "hybrid", embeddingMaxCalls: 1 })
  assert(embeddingCalls === 2 && hybridResult.reconciliation.cached === 2, "warm hybrid performs no provider calls")
  var vectorRefresh = new MiniAGraphReconciler(hybrid).refreshEmbeddings(pair, { embeddingMaxCalls: 0 })
  assert(vectorRefresh.complete && vectorRefresh.calls === 0 && vectorRefresh.hits === 2, "embedding-only refresh reuses the same inputs")
  var budgetedHybrid = new MiniAWikiGraph({ graphDir: root + "/budgeted-hybrid", modelExtractors: [], reconcileEmbeddingModel: { type: "ollama", model: "fixture" }, reconcileEmbeddingRequest: function() { return [1, 2, 3] } })
  var trio = pair.concat([page("three.md", "Find `bucketKey`.")])
  new MiniAGraphReconciler(budgetedHybrid).refreshEmbeddings(trio, { embeddingMaxCalls: 3 })
  var budgeted = budgetedHybrid.build(trio, { reconcile: "hybrid", reconcileMaxPages: 1, reconcileMaxDf: 1, embeddingMaxComparisons: 2 })
  assert(budgeted.partial && budgeted.reconciliation.runs > 1 && budgeted.reconciliation.comparisons === 2 && budgeted.reconciliation.embeddingCalls === 0, "cached vectors share one comparison budget across reconciliation runs")
  var originalClose = MiniAWikiEmbeddings.prototype.close
  var closeFailure = new MiniAWikiGraph({ graphDir: root + "/close-failure", modelExtractors: [], reconcileEmbeddingModel: { type: "ollama", model: "fixture" }, reconcileEmbeddingRequest: function() { return [1, 2, 3] } })
  try {
    MiniAWikiEmbeddings.prototype.close = function() {
      originalClose.call(this)
      throw new Error("simulated provider close failure")
    }
    var closeResult = closeFailure.build(pair, { reconcile: "hybrid", embeddingMaxCalls: 2 })
    assert(closeResult.partial && closeResult.reconciliation.embeddingFallback === "embedding-cache-finalization-failed", "cache close failures remain explicit optional enrichment failures")
  } finally { MiniAWikiEmbeddings.prototype.close = originalClose }
  closeResult = closeFailure.build(pair, { reconcile: "hybrid", embeddingMaxCalls: 2 })
  assert(!closeResult.partial && closeResult.reconciliation.embeddingCalls === 0, "cache failure recovery releases locks and reuses committed vectors")
  var modelCalls = 0
  var validated = new MiniAWikiGraph({ graphDir: root + "/validated", modelExtractors: [], reconcileValidators: [{ fingerprint: "pair-v1", extract: function() {
    modelCalls++
    return { concepts: [{ name: "persistent cache", sourceQuote: "persistent cache", targetQuote: "persistent cache" }] }
  } }] })
  var prose = [page("one.md", "Use a persistent cache.", "Storage Engine"), page("two.md", "Maintain a persistent cache.", "Storage Engine")]
  validated.build(prose, { reconcile: "lexical" })
  assert(modelCalls === 0, "LLM availability never authorizes validation")
  var modelResult = validated.build(prose, { reconcile: "lexical", reconcileLlm: "auto" })
  assert(!modelResult.partial && modelCalls === 1, "one grounded pair validation supports both document memberships")
  modelResult = validated.build(prose, { reconcile: "lexical", reconcileLlm: "auto" })
  assert(modelCalls === 1 && modelResult.reconciliation.cached === 2, "pair results are durable no-op work")
  validated._cfg.reconcileValidators = [{ fingerprint: "failing-pair-v2", extract: function() { throw new Error("provider unavailable") } }]
  modelResult = validated.build(prose, { reconcile: "lexical", reconcileLlm: "auto" })
  assert(modelResult.partial && validated._state.edges.filter(function(edge) { return edge.type === "MENTIONS" && !edge._deleted }).length === 2, "provider failures retain valid prior grounded memberships")
  validated.build(prose, { reconcile: "lexical", reconcileLlm: "auto" })
  modelResult = validated.build(prose, { reconcile: "lexical", reconcileLlm: "auto" })
  assert(modelResult.reconciliation.retryRequired && !modelResult.resumable && modelResult.reconciliation.calls === 0, "failed pair work defers without silently repeating calls")
  validated._cfg.reconcileValidators[0].extract = function() { return { concepts: [] } }
  modelResult = validated.build(prose, { reconcile: "lexical", reconcileLlm: "auto", reconcileRetryFailed: true })
  assert(!modelResult.partial && modelResult.reconciliation.calls === 1, "pair validation retries independently of semantic extraction")
  var disconnected = prose.concat([page("three.md", "A separate flower.", "Storage Engine")])
  validated.build(disconnected, { reconcile: "lexical", reconcileLlm: "auto" })
  assert(!validated._state.edges.some(function(edge) { return edge.from === "doc:three.md" && edge.type === "MENTIONS" }), "shared metadata cannot validate an absent quote")
  var stats = graph.stats({ detailed: true, maxDf: 1 })
  assert(stats.connectivity.components === 1 && stats.connectivity.actualPages === 5, "grounded projection has one component")
  var degree = graph.stats({ detailed: true, maxDf: 1, maxVisits: 1 }).connectivity
  assert(degree.partial && degree.averageMeaningfulNeighbors === null, "exhausted diagnostics never fabricate exact degrees")
  var sparse = new MiniAWikiGraph({ graphDir: root + "/sparse", autosave: "off" })
  sparse.build([page("a.md", Array(1000).join("# Heading\n")), page("b.md", "# Other")], {})
  stats = sparse.stats({ detailed: true })
  assert(stats.connectivity.components === 2 && stats.connectivity.averageMeaningfulNeighbors === 0, "sections cannot conceal disconnected documents")
  var natural = new MiniAWikiGraph({ graphDir: root + "/natural", modelExtractors: [{ role: "lc", fingerprint: "natural-fixture", extract: function(payload) {
    var target = payload.body.indexOf("energy") >= 0 ? "energy" : "concentration"
    return { relationships: [{ from: "coffee", to: target, type: "SUPPORTS", provenance: "EXTRACTED", evidence: { quote: payload.body } }] }
  } }] })
  natural.build([page("a.md", "coffee enables energy."), page("b.md", "coffee encourages concentration.")], { extraction: "semantic", modelHelp: "auto" })
  assert(natural.stats({ detailed: true }).connectivity.documentsWithGroundedConcepts === 2, "model-grounded shared concepts count without deterministic mentions")
  var legacyEvidence = clone(natural._state)
  var unversioned = legacyEvidence.edges.filter(function(edge) { return edge.props && edge.props.evidence })[0]
  delete unversioned.props.revision
  assert(MiniAGraphConnectivity(legacyEvidence, {}).unverifiableRelationships === 1, "legacy evidence without revisions is identified separately")
  ;[{ reconcile: "invalid" }, { reconcile: "off", reconcileLlm: "auto" }, { reconcile: "lexical", reconcileMaxCandidates: 129 }, { reconcile: "hybrid", embeddingMaxCalls: -1 }].forEach(function(options) {
    var failed = false
    try { MiniAGraphBuild.resolve(options) } catch(error) { failed = true }
    assert(failed, "invalid configuration fails clearly")
  })
  var wiki = root + "/wiki"
  io.mkdir(wiki)
  io.writeFileString(wiki + "/a.md", "---\ntitle: A\n---\nUse `cacheKey`.")
  io.writeFileString(wiki + "/b.md", "---\ntitle: B\n---\nInspect `cacheKey`.")
  manager = new MiniAWikiManager({ backend: "fs", root: wiki, access: "rw", usegraph: true, skipBootstrap: true }, function() {})
  manager.graph("build", {})
  var liveFile = wiki + "/.mini-a-wiki-graph/graph.json"
  var liveBefore = io.readFileString(liveFile)
  var original = manager.graph
  manager.graph = function() { throw new Error("test interruption") }
  var interrupted = false
  try { manager.fullRebuild({ graphOnly: true, confirmExpensive: true, modelHelp: "off", reconcile: "lexical" }) } catch(error) { interrupted = true }
  manager.graph = original
  assert(interrupted && io.readFileString(liveFile) === liveBefore, "interrupted upgrade retains the usable live graph")
  var upgraded = manager.fullRebuild({ graphOnly: true, confirmExpensive: true, modelHelp: "off", reconcile: "lexical" })
  assert(upgraded.complete && io.fileExists(upgraded.previous), "resume publishes verified replacement and recovery snapshot")
  assert(manager.graph("stats", { detailed: true }).connectivity.documentsWithGroundedConcepts === 2, "upgrade needs only current Markdown")
  var edgeCount = manager.graph("stats").edges
  upgraded = manager.fullRebuild({ graphOnly: true, confirmExpensive: true, modelHelp: "off", reconcile: "lexical" })
  assert(upgraded.complete && manager.graph("stats").edges === edgeCount, "second upgrade preserves identities without duplicates")
  var boundaryBefore = io.readFileString(liveFile)
  var stoppedAtReady = false
  try {
    manager.graph("upgrade", { confirmExpensive: true, reconcile: "lexical", onProgress: function(progress) {
      if (progress.phase === "ready") throw new Error("interrupt before publication")
    } })
  } catch(error) { stoppedAtReady = true }
  assert(stoppedAtReady && io.readFileString(liveFile) === boundaryBefore, "ready checkpoint precedes any live replacement")
  upgraded = manager.graph("resume", { confirmExpensive: true, reconcile: "lexical" })
  assert(upgraded.complete, "ready publication resumes without reconstruction")
  var stoppedAfterPublication = false
  try {
    manager.graph("upgrade", { confirmExpensive: true, reconcile: "lexical", onProgress: function(progress) {
      if (progress.phase === "published") throw new Error("interrupt after publication")
    } })
  } catch(error) { stoppedAfterPublication = true }
  upgraded = manager.graph("resume", { confirmExpensive: true, reconcile: "lexical" })
  assert(stoppedAfterPublication && upgraded.complete, "publication bookkeeping recovers after atomic replacement")
  var rollback = manager.graph("rollback", { runId: upgraded.id, preview: true })
  assert(rollback.ok && rollback.preview, "rollback verifies its predecessor without writes")
  assert(!manager.graph("rollback", { runId: "unknown" }).ok, "rollback refuses an unverified run")
  assert(manager.graph("rollback", { runId: upgraded.id }).restored, "explicit rollback restores the verified predecessor")
  var remoteSyncs = 0
  manager._graph._hasFalkor = function() { return true }
  manager._graph.falkorSync = function() {
    remoteSyncs++
    return { ok: remoteSyncs > 1 }
  }
  upgraded = manager.graph("upgrade", { confirmExpensive: true, reconcile: "lexical" })
  assert(upgraded.status === "remote-sync-pending" && io.fileExists(manager._graph._graphDir + "/remote-sync.json"), "remote failure retains a durable local-read marker")
  upgraded = manager.graph("resume", { confirmExpensive: true, reconcile: "lexical" })
  assert(upgraded.complete && remoteSyncs === 2 && !io.fileExists(manager._graph._graphDir + "/remote-sync.json"), "remote sync resumes without repeating enrichment")
  manager.graphBuildSettings({ reconcile: "hybrid", embeddingMaxCalls: 0 }, true)
  var savedHybrid = manager.graph("reconcile", {})
  assert(savedHybrid.partial && savedHybrid.reconciliation.embeddingCalls === 0, "manual reconciliation honors saved hybrid preferences without authorizing extra calls")
  var beforeOff = io.readFileString(liveFile)
  assert(manager.graph("reconcile", { reconcile: "off" }).status === "off" && io.readFileString(liveFile) === beforeOff, "explicit off overrides saved preferences without rewriting graph state")
  manager.graphBuildSettings({ reconcile: "lexical", embeddingMaxCalls: 8 }, true)
  manager.close()
  manager = new MiniAWikiManager({ backend: "fs", root: wiki, access: "ro", usegraph: true, skipBootstrap: true }, function() {})
  assert(manager.graph("upgrade", { preview: true, reconcile: "lexical" }).ok, "read-only upgrade preview works")
  assert(!manager.graph("upgrade", { confirmExpensive: true }).ok, "read-only graph mutation is refused")
  // Pending semantic work survives changed defaults; live evidence conflicts fail closed.
  var resumeRoot = root + "/resume"
  io.mkdir(resumeRoot)
  io.writeFileString(resumeRoot + "/a.md", "---\ntitle: A\n---\nAlpha and Beta are related. Alpha and Gamma are related.")
  var resumeManager = new MiniAWikiManager({ backend: "fs", root: resumeRoot, access: "rw", usegraph: true, skipBootstrap: true }, function() {})
  try {
    var resumeCalls = 0
    var resumeExtra = false
    resumeManager._graph._cfg.modelExtractors = [{ role: "main", fingerprint: "resume-fixture", extract: function() {
      resumeCalls++
      var relationships = [{ from: "Alpha", to: "Beta", type: "RELATES_TO", provenance: "EXTRACTED", confidence: 0.9, evidence: { quote: "Alpha and Beta are related." } }]
      if (resumeExtra) relationships.push({ from: "Alpha", to: "Gamma", type: "RELATES_TO", provenance: "EXTRACTED", confidence: 0.9, evidence: { quote: "Alpha and Gamma are related." } })
      return { relationships: relationships }
    } }]
    resumeManager.graph("build", { reconcile: "off" })
    try {
      resumeManager.graph("upgrade", { confirmExpensive: true, extraction: "semantic", modelHelp: "auto", reconcile: "off", onProgress: function(progress) {
        if (progress.phase === "graph") throw new Error("pause semantic work")
      } })
    } catch(error) {}
    assert(resumeManager._graphResumeSettings({ maxCalls: 1 }).modelHelp === "auto", "resume validation uses the pending model assistance")
    var resumed = resumeManager.graph("resume", { confirmExpensive: true, maxCalls: 1 })
    assert(resumed.complete && resumeCalls === 1 && resumed.graph.effective.extraction === "semantic", "resume keeps semantic extraction and applies only explicit budgets")
    // Begin a structural stage before adding independently supported live model work.
    var resumeGraphFile = resumeManager._graph._graphDir + "/graph.json"
    try {
      resumeManager.graph("upgrade", { confirmExpensive: true, extraction: "structural", reconcile: "off", onProgress: function(progress) {
        if (progress.phase === "ready") throw new Error("pause publication")
      } })
    } catch(error) {}
    resumeExtra = true
    var externalManager = new MiniAWikiManager({ backend: "fs", root: resumeRoot, access: "rw", usegraph: true, skipBootstrap: true }, function() {})
    try {
      externalManager._graph._cfg.modelExtractors = resumeManager._graph._cfg.modelExtractors
      externalManager.graph("build", { extraction: "semantic", modelHelp: "auto", reconcile: "off", force: true })
    } finally { externalManager.close() }
    var newerGraph = io.readFileString(resumeGraphFile)
    var journalFile = resumeRoot + "/.mini-a-wiki-full-rebuild.json"
    var pendingJournal = io.readFileString(journalFile)
    resumed = resumeManager.graph("resume", { confirmExpensive: true })
    assert(!resumed.ok && resumed.status === "graph-conflict" && !resumed.resumable, "resume rejects publication over independently committed graph changes")
    assert(io.readFileString(resumeGraphFile) === newerGraph && io.readFileString(journalFile) === pendingJournal, "conflict leaves live evidence and paused journal unchanged")
    var conflictId = resumed.id
    resumed = resumeManager.graph("upgrade", { confirmExpensive: true, extraction: "structural", reconcile: "off" })
    assert(resumed.complete && resumed.id !== conflictId && resumeManager._graph._state.edges.filter(function(edge) { return edge.props && edge.props.method === "model" }).length === 2, "a new upgrade includes current evidence and retains the old stage")
  } finally { resumeManager.close() }
  var legacyRoot = root + "/legacy"
  io.mkdir(legacyRoot)
  io.writeFileString(legacyRoot + "/a.md", "---\ntitle: A\n---\nTLS uses HTTP.")
  io.writeFileString(legacyRoot + "/b.md", "---\ntitle: B\n---\nTCP uses UDP.")
  var legacyManager = new MiniAWikiManager({ backend: "fs", root: legacyRoot, access: "rw", usegraph: true, skipBootstrap: true }, function() {})
  try {
    legacyManager.graph("build", {})
    var legacyGraphFile = legacyManager._graph._graphDir + "/graph.json"
    var predecessor = io.readFileString(legacyGraphFile)
    var legacyCalls = 0
    legacyManager._graph._cfg.modelExtractors = [{ role: "lc", fingerprint: "legacy-fixture", extract: function() {
      legacyCalls++
      return { relationships: [] }
    } }]
    var legacyPartial = legacyManager.graph("build", { extraction: "semantic", modelHelp: "auto", maxCalls: 1 })
    assert(legacyPartial.partial && legacyCalls === 1, "legacy fixture contains one completed model checkpoint")
    var legacyId = String(java.util.UUID.randomUUID())
    io.writeFileString(legacyGraphFile + ".before-full-rebuild-" + legacyId, predecessor)
    __miniAWikiMaintenanceJson(legacyRoot + "/.mini-a-wiki-full-rebuild.json", { version: 1, id: legacyId, phase: "graph", destination: legacyRoot })
    var migrated = legacyManager.graph("resume", { confirmExpensive: true, extraction: "semantic", modelHelp: "auto", reconcile: "lexical" })
    assert(migrated.complete && legacyCalls === 2 && migrated.graph.cached >= 1, "v1 journal migration preserves active work as well as the old predecessor")
  } finally { legacyManager.close() }
  global.__mini_a_ingest_lib_mode = true
  load("js/wiki/mini-a-ingest.js")
  var sources = root + "/sources"
  var ingestWiki = root + "/ingested"
  io.mkdir(sources)
  io.mkdir(ingestWiki)
  io.writeFileString(sources + "/a.md", "# Writer\nUse `cacheKey` to write responses.")
  var ingestArgs = { usewiki: true, usewikigraph: true, wikiaccess: "rw", wikiroot: ingestWiki, ingestsource: sources, ingestmode: "raw", ingestsection: "docs", wikigraphsemantic: false, wikigraphreconcile: "lexical", wikiretrievalv2: true }
  var ingestion = new MiniAIngest(ingestArgs, function() {})
  assert(ingestion.run().ok, "raw ingestion enables reconciliation without source transformation models")
  io.writeFileString(sources + "/b.md", "# Reader\nRead using `cacheKey`.")
  ingestion = new MiniAIngest(ingestArgs, function() {})
  assert(ingestion.run().ok, "second ingestion batch succeeds")
  var ingestGraphFile = ingestWiki + "/.mini-a-wiki-graph/graph.json"
  var ingested = io.readFileJSON(ingestGraphFile)
  assert(ingested.edges.filter(function(edge) { return edge.type === "MENTIONS" && edge.to === "concept:id:cachekey" }).length === 2, "ingestion discovers existing pages across batches")
  var unchanged = io.readFileString(ingestGraphFile)
  ingestion = new MiniAIngest(ingestArgs, function() {})
  var ingestRepeat = ingestion.run()
  assert(ingestRepeat.ok && ingestRepeat.reconciliation.reconciliation.calls === 0 && io.readFileString(ingestGraphFile) === unchanged, "unchanged ingestion completes graph maintenance without calls or rewrites")
  io.writeFileString(sources + "/a.md", "# Writer\nUnrelated revised prose.")
  ingestion = new MiniAIngest(ingestArgs, function() {})
  var atomic = ingestion._atomicJson
  ingestion._atomicJson = function(path, value) {
    atomic.call(this, path, value)
    if (value.phase === "pages-applied") throw new Error("interrupt before ownership commit")
  }
  var interruptedIngest = ingestion.run()
  assert(!interruptedIngest.ok && io.readFileString(ingestGraphFile) === unchanged, "incomplete ingestion cannot publish changed graph state")
  ingestion = new MiniAIngest(ingestArgs, function() {})
  assert(ingestion.run().ok, "ingestion recovers and finishes reconciliation")
  ingested = io.readFileJSON(ingestGraphFile)
  assert(!ingested.edges.some(function(edge) { return edge.type === "MENTIONS" && edge.to === "concept:id:cachekey" }), "recovered edits invalidate the affected relationship")
  print("PASS graph reconciliation: " + checks + " assertions")
} finally {
  if (manager) manager.close()
  io.rm(root)
}
