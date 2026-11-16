// Frozen synthetic quality controls and explicit 100/1000/10000-page scale runs.
load("js/core/mini-a-common.js")
load("js/wiki/mini-a-graph.js")
var fixture = io.readFileJSON("tests/fixtures/graph-connections/benchmark.json")
var root = String(new java.io.File(String(io.createTempDir("graph-reconcile-benchmark-"))).getCanonicalPath())
var sizes = String(getEnv("MINI_A_GRAPH_BENCH_SIZES") || "100,1000,10000").split(",").map(Number)
var rows = []

// Generate unrelated distractors independently of the frozen relationship labels.
function corpus(size) {
  var pages = []
  fixture.topics.forEach(function(topic, index) {
    topic.titles.forEach(function(title, number) {
      var body = "# " + title + "\n\n" + topic.evidence
      pages.push({ path: "topic" + index + "/page" + number + ".md", meta: { title: title }, body: body, revision: sha1(body), links: [] })
    })
  })
  for (var at = pages.length; at < size; at++) {
    var body = "# Unrelated note\nOrdinary prose about an unrelated subject number " + at
    pages.push({ path: "noise/" + at + ".md", meta: { title: "Unrelated note " + at }, body: body, revision: sha1(body), links: [] })
  }
  return pages
}

// Report graph-assisted retrieval separately from lexical document-node matching.
function quality(graph, lexical) {
  var recall = 0
  var reciprocal = 0
  var falseEdges = 0
  var generated = 0
  var latencies = []
  fixture.topics.forEach(function(topic, index) {
    var queryStarted = java.lang.System.nanoTime()
    var paths = lexical ? graph.query(topic.query).filter(function(hit) { return hit.id.indexOf("doc:") === 0 }).slice(0, 10).map(function(hit) { return hit.id.substring(4) }) : graph.retrieve(topic.query, { cap: 10, maxEdges: 256 }).pages.map(function(hit) { return hit.path })
    latencies.push(Number(java.lang.System.nanoTime() - queryStarted) / 1000000)
    var expected = topic.titles.map(function(title, number) { return "topic" + index + "/page" + number + ".md" })
    recall += paths.filter(function(path) { return expected.indexOf(path) >= 0 }).length / expected.length
    var rank = paths.findIndex(function(path) { return expected.indexOf(path) >= 0 })
    if (rank >= 0) reciprocal += 1 / (rank + 1)
  })
  graph._state.edges.forEach(function(edge) {
    if (!edge.props || edge.props.reconcileVersion !== 1 || edge._deleted) return
    generated++
    var pageMatch = String(edge.props.page).match(/^topic([0-9]+)\//)
    var quote = edge.props.evidence && edge.props.evidence.quote
    if (!pageMatch || !quote || fixture.topics[Number(pageMatch[1])].evidence.indexOf(quote) < 0) falseEdges++
  })
  latencies.sort(function(a, b) { return a - b })
  return { recallAt10: recall / fixture.topics.length, mrr: reciprocal / fixture.topics.length, generatedMemberships: generated, falsePositiveMemberships: falseEdges, precision: generated ? (generated - falseEdges) / generated : null, retrievalLatencyMs: { samples: latencies.length, p50: latencies[Math.floor(latencies.length / 2)], p95: latencies[Math.ceil(latencies.length * 0.95) - 1] } }
}

// Count complete derived storage separately from the graph JSON artifact.
function storageBytes(dir) {
  var total = 0
  io.listFiles(dir).files.forEach(function(file) {
    total += file.isDirectory ? storageBytes(file.filepath) : Number(new java.io.File(file.filepath).length())
  })
  return total
}

try {
  if (getEnv("MINI_A_GRAPH_BENCH_AMBIGUOUS_ONLY") !== "true") sizes.forEach(function(size) {
    if (!isFinite(size) || size < 100 || size > 100000) throw new Error("Invalid benchmark size")
    var pages = corpus(size)
    var modes = [
      { name: "lexical", lexical: true, options: {} },
      { name: "structural", options: {} },
      { name: "existing-semantic", options: { extraction: "semantic", modelHelp: "off" } },
      { name: "reconciled-lexical", options: { reconcile: "lexical" } },
      { name: "reconciled-hybrid-simulated", options: { reconcile: "hybrid", embeddingMaxCalls: 64 } },
      { name: "reconciled-validator-simulated", options: { reconcile: "lexical", reconcileLlm: "auto", reconcileMaxCalls: 8 } }
    ]
    var baseline
    modes.forEach(function(mode) {
      java.lang.System.gc()
      var dir = root + "/" + size + "/" + mode.name
      var graph = new MiniAWikiGraph({ graphDir: dir, modelExtractors: [], reconcileEmbeddingModel: { type: "ollama", model: "benchmark-fixture" }, reconcileEmbeddingRequest: function(text) {
        return [1, text.length % 17 + 1, text.length % 31 + 1]
      }, reconcileValidators: [{ fingerprint: "abstaining-fixture-v1", extract: function() { return { concepts: [] } } }] })
      var started = Date.now()
      var result
      var rounds = 0
      var embeddingCalls = 0
      var comparisons = 0
      var validationCalls = 0
      var validationTokens = 0
      do {
        result = graph.build(pages, merge({ reconcileMaxPages: 1000, reconcileMaxMinutes: 2 }, mode.options))
        embeddingCalls += result.reconciliation && result.reconciliation.embeddingCalls || 0
        comparisons += result.reconciliation && result.reconciliation.comparisons || 0
        validationCalls += result.reconciliation && result.reconciliation.calls || 0
        validationTokens += result.reconciliation && result.reconciliation.estimatedTokens || 0
        rounds++
        if (rounds > Math.ceil(size / 1000) * 4 + 4) throw new Error("Unbounded benchmark work: " + mode.name)
      } while (result.partial)
      var elapsed = Date.now() - started
      var measured = quality(graph, mode.lexical)
      if (!baseline) baseline = measured
      if (measured.recallAt10 < baseline.recallAt10 || measured.mrr < baseline.mrr || measured.falsePositiveMemberships > 0) throw new Error("Quality regression: " + mode.name)
      var warmStart = Date.now()
      var warm = graph.build(pages, merge({ reconcileMaxPages: 1000, reconcileMaxMinutes: 2 }, mode.options))
      if (warm.reconciliation && (warm.reconciliation.embeddingCalls || warm.reconciliation.calls)) throw new Error("Warm work repeated provider calls")
      var stats = graph.stats({ detailed: true })
      var runtime = java.lang.Runtime.getRuntime()
      rows.push({ pages: size, mode: mode.name, quality: measured, buildMs: elapsed, warmMs: Date.now() - warmStart, rounds: rounds, embeddingCalls: embeddingCalls, embeddingTokens: null, validationCalls: validationCalls, estimatedValidationTokens: validationTokens, comparisons: comparisons, totalDerivedBytes: storageBytes(dir), graphBytes: Number(new java.io.File(dir + "/graph.json").length()), usedHeapBytes: Number(runtime.totalMemory() - runtime.freeMemory()), components: stats.connectivity.components, neighborCoverage: 1 - stats.connectivity.meaningfullyIsolatedDocuments / size })
      graph.close()
      graph = null
      java.lang.System.gc()
      print(JSON.stringify(rows[rows.length - 1]))
    })
  })
  // Identical non-generic titles exercise ambiguity without quadratic identity lookups.
  var ambiguous = []
  for (var number = 0; number < 10000; number++) {
    ambiguous.push({ path: "ambiguous/" + number + ".md", meta: { title: "SharedTopic" }, body: "SharedTopic is deliberately ambiguous.", links: [], revision: "shared-v1" })
  }
  var ambiguityGraph = new MiniAWikiGraph({ graphDir: root + "/ambiguous", modelExtractors: [] })
  var ambiguityStart = Date.now()
  var ambiguityResult = ambiguityGraph.build(ambiguous, { reconcile: "lexical", reconcileMaxPages: 10000, reconcileMaxMinutes: 2 })
  var ambiguityStats = ambiguityGraph.stats({ detailed: true }).connectivity
  if (ambiguityResult.partial || ambiguityStats.components !== 10000 || ambiguityStats.averageMeaningfulNeighbors !== 0) throw new Error("Ambiguous titles manufactured connectivity or left unbounded work")
  var ambiguityRow = { pages: 10000, mode: "ambiguous-titles", buildMs: Date.now() - ambiguityStart, components: ambiguityStats.components, averageMeaningfulNeighbors: ambiguityStats.averageMeaningfulNeighbors }
  rows.push(ambiguityRow)
  print(JSON.stringify(ambiguityRow))
  ambiguityGraph.close()
  print(JSON.stringify({ ok: true, fixture: "graph-connections-v1", simulatedProviders: true, rows: rows.length }))
} finally { io.rm(root) }
