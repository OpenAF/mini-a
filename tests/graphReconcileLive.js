// Explicit provider smoke test; ordinary suites never invoke configured models.
(function() {
  if (getEnv("MINI_A_GRAPH_LIVE") !== "true") {
    print("Set MINI_A_GRAPH_LIVE=true to test the configured OAF_EMBED_MODEL")
    return
  }
  load("js/core/mini-a-common.js")
  load("js/wiki/mini-a-graph.js")
  if (getEnv("MINI_A_GRAPH_EMBED_OPENAF_SOURCE")) {
    ow.loadAI()
    load(getEnv("MINI_A_GRAPH_EMBED_OPENAF_SOURCE"))
  }
  var root = String(io.createTempDir("graph-live-"))
  var graph
  try {
    var pages = [
      { path: "writer.md", meta: { title: "Response writer" }, body: "The `cacheKey` identifies a stored response.", links: [], revision: "writer-v1" },
      { path: "reader.md", meta: { title: "Response reader" }, body: "Read the response using `cacheKey`.", links: [], revision: "reader-v1" }
    ]
    graph = new MiniAWikiGraph({ graphDir: root, modelExtractors: [] })
    var cold = graph.build(pages, { reconcile: "hybrid", embeddingMaxCalls: 2 }).reconciliation
    var warm = graph.build(pages, { reconcile: "hybrid", embeddingMaxCalls: 2 }).reconciliation
    if (cold.embeddingFallback || cold.embeddingCalls !== 2 || warm.embeddingCalls !== 0 || !warm.complete) throw new Error("Live embedding cache smoke test failed: " + stringify({ fallback: cold.embeddingFallback, coldCalls: cold.embeddingCalls, warmCalls: warm.embeddingCalls, status: warm.status }))
    var result = { ok: true, cold: { calls: cold.embeddingCalls, hits: cold.embeddingHits, elapsedMs: cold.elapsedMs }, warm: { calls: warm.embeddingCalls, hits: warm.embeddingHits, cached: warm.cached, elapsedMs: warm.elapsedMs } }
    if (getEnv("MINI_A_GRAPH_LIVE_LLM") === "true") {
      var prose = [
        { path: "one.md", meta: { title: "Storage Engine" }, body: "Use a persistent cache.", links: [], revision: "one-v1" },
        { path: "two.md", meta: { title: "Storage Engine" }, body: "Maintain a persistent cache.", links: [], revision: "two-v1" }
      ]
      var validated = graph.build(prose, { reconcile: "lexical", reconcileLlm: "auto", reconcileMaxCalls: 1, reconcileMaxMinutes: 2 }).reconciliation
      if (validated.validationFallback || validated.calls !== 1 || !validated.complete) throw new Error("Live pair validator did not complete: " + stringify({ status: validated.status, fallback: validated.validationFallback, calls: validated.calls }))
      result.validation = { calls: validated.calls, acceptedMemberships: validated.added, elapsedMs: validated.elapsedMs }
    }
    print(JSON.stringify(result))
  } finally {
    if (graph) graph.close()
    io.rm(root)
  }
})()
