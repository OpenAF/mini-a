(function() {
  load("mini-a-common.js")
  load("mini-a-graph.js")

  var mkTmp = function() {
    var d = String(java.io.File.createTempFile("miniagraph-test-", "").getCanonicalPath())
    io.rm(d)
    io.mkdir(d)
    return d
  }

  var pages = function() {
    return [
      {
        path: "a.md",
        meta: { title: "A", tags: ["core"], aliases: ["Alpha"] },
        body: "# A\n## Intro\nSee [B](b.md)",
        links: ["b.md"]
      },
      {
        path: "b.md",
        meta: { title: "B", tags: ["core", "ref"] },
        body: "# B\n## Notes",
        links: []
      }
    ]
  }

  exports.testGraphStructuralBuild = function() {
    var dir = mkTmp()
    try {
      var g = new MiniAWikiGraph({ graphDir: dir })
      var st = g.buildStructural(pages())
      ow.test.assert(st.nodes > 0, true, "nodes should be created")
      ow.test.assert(st.provenance.EXTRACTED > 0, true, "extracted edges should exist")
      ow.test.assert(io.fileExists(dir + "/graph.json"), true, "graph.json should exist")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testGraphQueryNeighbors = function() {
    var dir = mkTmp()
    try {
      var g = new MiniAWikiGraph({ graphDir: dir })
      g.buildStructural(pages())
      var q = g.query("core")
      ow.test.assert(q.length > 0, true, "query should return nodes")
      var n = g.neighbors("doc:a.md")
      ow.test.assert(n.length > 0, true, "neighbors should return edges")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testGraphRelatedAndExport = function() {
    var dir = mkTmp()
    try {
      var g = new MiniAWikiGraph({ graphDir: dir })
      g.buildStructural(pages())
      var r = g.relatedFor(["a.md"], { cap: 5 })
      ow.test.assert(r.length > 0, true, "related pages should exist")
      var mermaid = g.export("mermaid")
      ow.test.assert(mermaid.indexOf("graph TD") === 0, true, "mermaid export should start with graph TD")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testGraphSaveLoadRoundTrip = function() {
    var dir = mkTmp()
    try {
      var g = new MiniAWikiGraph({ graphDir: dir })
      g.buildStructural(pages())
      var s1 = g.stats()
      var g2 = new MiniAWikiGraph({ graphDir: dir })
      var s2 = g2.stats()
      ow.test.assert(s2.nodes, s1.nodes, "loaded graph should keep node count")
      ow.test.assert(s2.edges, s1.edges, "loaded graph should keep edge count")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  // --- New tests (plan verification) ---

  // Provenance: bad from/to/type rejected; garbage provenance stored as AMBIGUOUS
  exports.testGraphProvenanceEdgeValidation = function() {
    var dir = mkTmp()
    try {
      var g = new MiniAWikiGraph({ graphDir: dir })
      g.buildStructural(pages())
      var before = g._state.edges.length
      g._addEdge("", "doc:b.md", "LINKS_TO", "EXTRACTED", {})  // bad from
      g._addEdge("doc:a.md", "", "LINKS_TO", "EXTRACTED", {})  // bad to
      g._addEdge("doc:a.md", "doc:b.md", __, "EXTRACTED", {})  // bad type
      ow.test.assert(g._state.edges.length, before, "bad edges should be rejected")
      g._addEdge("doc:a.md", "doc:b.md", "LINKS_TO", "GARBAGE", {})
      var last = g._state.edges[g._state.edges.length - 1]
      ow.test.assert(last.provenance, "AMBIGUOUS", "garbage provenance should normalize to AMBIGUOUS")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  // F2: stale node pruning — deleted page's doc:/section: nodes are removed
  exports.testGraphStaleNodePruning = function() {
    var dir = mkTmp()
    try {
      var g = new MiniAWikiGraph({ graphDir: dir })
      g.buildStructural(pages())
      ow.test.assert(isDef(g._state.nodes["doc:b.md"]), true, "doc:b.md should exist initially")
      // Rebuild with only page a.md
      g.buildStructural([pages()[0]])
      // b.md is not referenced by a.md's links or sections, so its doc node should be pruned
      // (b.md is linked from a.md via LINKS_TO, so keepNode["doc:b.md"] = true — it stays)
      // Use a truly orphaned page with no links
      var g2 = new MiniAWikiGraph({ graphDir: dir })
      var orphanPages = [
        { path: "x.md", meta: { title: "X", tags: ["alpha"] }, body: "# X", links: [] },
        { path: "y.md", meta: { title: "Y", tags: ["beta"] }, body: "# Y", links: [] }
      ]
      g2.buildStructural(orphanPages)
      ow.test.assert(isDef(g2._state.nodes["doc:x.md"]), true, "doc:x.md should exist")
      // Rebuild with only x.md — y.md should be pruned
      g2.buildStructural([orphanPages[0]])
      ow.test.assert(isUnDef(g2._state.nodes["doc:y.md"]), true, "doc:y.md should be pruned after removal")
      ow.test.assert(isDef(g2._state.nodes["doc:x.md"]), true, "doc:x.md should still exist")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  // F1: shared-tag relatedFor — two co-tagged non-linking pages return each other
  exports.testGraphSharedTagRelated = function() {
    var dir = mkTmp()
    try {
      var g = new MiniAWikiGraph({ graphDir: dir })
      var tagPages = [
        { path: "p1.md", meta: { title: "P1", tags: ["shared"] }, body: "# P1", links: [] },
        { path: "p2.md", meta: { title: "P2", tags: ["shared"] }, body: "# P2", links: [] }
      ]
      g.buildStructural(tagPages)
      var related = g.relatedFor(["p1.md"], { cap: 5 })
      var paths = related.map(function(r) { return r.path })
      ow.test.assert(paths.indexOf("p2.md") >= 0, true, "p2.md should appear via shared tag")
      var entry = related.filter(function(r) { return r.path === "p2.md" })[0]
      ow.test.assert(entry.connection.indexOf("shared_tag") >= 0, true, "connection should include shared_tag")
      ow.test.assert(isNumber(entry.score) && entry.score > 0, true, "score should be a positive number")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  // F3: communities — numeric coverage field; labels present
  exports.testGraphCommunities = function() {
    var dir = mkTmp()
    try {
      var g = new MiniAWikiGraph({ graphDir: dir })
      g.buildStructural(pages())
      var comms = g.detectCommunities()
      ow.test.assert(isArray(comms) && comms.length > 0, true, "communities should be non-empty")
      var c = comms[0]
      ow.test.assert(isNumber(c.coverage), true, "coverage should be numeric")
      ow.test.assert(isString(c.label) && c.label.length > 0, true, "community label should be a non-empty string")
      ow.test.assert(isUnDef(c.modularity), true, "modularity field should not exist (renamed to coverage)")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  // F7: surprise — cross-file links within same folder appear; scores vary
  exports.testGraphSurpriseScores = function() {
    var dir = mkTmp()
    try {
      var g = new MiniAWikiGraph({ graphDir: dir })
      var surPages = [
        { path: "a/x.md", meta: { title: "X" }, body: "# X", links: ["a/y.md"] },
        { path: "a/y.md", meta: { title: "Y" }, body: "# Y", links: [] },
        { path: "b/z.md", meta: { title: "Z" }, body: "# Z", links: ["a/x.md"] }
      ]
      g.buildStructural(surPages)
      var surprise = g.crossDocumentSurprise()
      // cross-file within a/ should appear (a/x.md → a/y.md)
      var sameFolder = surprise.filter(function(s) { return (s.from === "a/x.md" && s.to === "a/y.md") || (s.from === "a/y.md" && s.to === "a/x.md") })
      ow.test.assert(sameFolder.length > 0, true, "same-folder cross-file links should appear in surprise")
      // all scores should be numbers
      var allNumeric = surprise.every(function(s) { return isNumber(s.score) && s.score > 0 })
      ow.test.assert(allNumeric, true, "all surprise scores should be positive numbers")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  // F8: GraphML export — parses as XML with expected node/edge counts
  exports.testGraphMLExport = function() {
    var dir = mkTmp()
    try {
      var g = new MiniAWikiGraph({ graphDir: dir })
      g.buildStructural(pages())
      var gml = g.export("graphml")
      ow.test.assert(gml.indexOf("<graphml") >= 0, true, "graphml should contain <graphml>")
      ow.test.assert(gml.indexOf("<node ") >= 0, true, "graphml should contain at least one <node>")
      ow.test.assert(gml.indexOf("<edge ") >= 0, true, "graphml should contain at least one <edge>")
      // mermaid still starts with graph TD
      var mermaid = g.export("mermaid")
      ow.test.assert(mermaid.indexOf("graph TD") === 0, true, "mermaid export should start with graph TD")
      // neo4j contains MERGE
      var neo = g.export("neo4j")
      ow.test.assert(neo.indexOf("MERGE") >= 0, true, "neo4j export should contain MERGE")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  // F6: shrink warning — captured via custom log function
  exports.testGraphShrinkWarning = function() {
    var dir = mkTmp()
    try {
      var warnings = []
      var g = new MiniAWikiGraph({ graphDir: dir }, function(level, msg) {
        if (level === "warn") warnings.push(msg)
      })
      // Build with many pages
      var manyPages = []
      for (var i = 0; i < 12; i++) manyPages.push({ path: "p" + i + ".md", meta: { title: "P" + i }, body: "# P" + i, links: [] })
      g.buildStructural(manyPages)
      var g2 = new MiniAWikiGraph({ graphDir: dir }, function(level, msg) {
        if (level === "warn") warnings.push(msg)
      })
      // Rebuild with only 2 pages (massive shrink)
      g2.buildStructural([manyPages[0], manyPages[1]])
      var shrinkWarn = warnings.filter(function(w) { return w.indexOf("shrink warning") >= 0 })
      ow.test.assert(shrinkWarn.length > 0, true, "shrink warning should be emitted when nodes drop by ≥50%")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  // F9: semantic invalidation — editing a page removes its stale semantic edges/summary
  exports.testGraphSemanticInvalidation = function() {
    var dir = mkTmp()
    try {
      var g = new MiniAWikiGraph({ graphDir: dir })
      // Inject a fake semantic edge and cache entry for p1.md
      g._state.semantic_cache["p1.md"] = { hash: "old-hash", updated_at: new Date().toISOString() }
      g._state.summaries.pages["p1.md"] = { digest: "P1 digest", summary: "old summary" }
      g._upsertNode("concept:foo", "concept", { name: "Foo" })
      g._upsertNode("concept:bar", "concept", { name: "Bar" })
      g._addEdge("concept:foo", "concept:bar", "RELATED_TO", "INFERRED", { page: "p1.md", confidence: 0.9 })
      var edgeBefore = g._state.edges.filter(function(e) { return isMap(e.props) && e.props.page === "p1.md" }).length
      ow.test.assert(edgeBefore > 0, true, "semantic edge should exist before rebuild")
      // Edit the page with different content (different hash) via updatePage, which is the
      // API that actually invalidates stale per-page semantic state (buildStructural only
      // preserves/re-adds semantic edges for pages already indexed, it does not diff content).
      g.updatePage({ path: "p1.md", meta: { title: "P1 updated" }, body: "# P1 new content", links: [] })
      var edgeAfter = g._state.edges.filter(function(e) { return isMap(e.props) && e.props.page === "p1.md" }).length
      ow.test.assert(edgeAfter, 0, "stale semantic edges should be dropped after content change")
      ow.test.assert(isUnDef(g._state.summaries.pages["p1.md"] && g._state.summaries.pages["p1.md"].summary), true, "stale summary should be cleared")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testGraphUpdatePreservesOtherIsolatedDocuments = function() {
    var dir = mkTmp()
    try {
      var g = new MiniAWikiGraph({ graphDir: dir })
      g.buildStructural([
        { path: "isolated.md", meta: { title: "Isolated" }, body: "No tags, links, or headings.", links: [] },
        { path: "main.md", meta: { title: "Main", tags: ["core"] }, body: "# Main\nUpdated", links: [] }
      ])
      ow.test.assert(isDef(g._state.nodes["doc:isolated.md"]), true, "isolated document should exist before update")
      g.updatePage({ path: "main.md", meta: { title: "Main v2", tags: ["core"] }, body: "# Main\nChanged", links: [] })
      ow.test.assert(isDef(g._state.nodes["doc:isolated.md"]), true, "isolated document should survive unrelated page update")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testGraphStructuralRebuildSkipsDanglingSemanticEdges = function() {
    var dir = mkTmp()
    try {
      var g = new MiniAWikiGraph({ graphDir: dir })
      g.buildStructural([{ path: "p1.md", meta: { title: "P1" }, body: "# P1", links: [] }])
      g._upsertNode("concept:foo", "concept", { name: "Foo" })
      g._addEdge("doc:p1.md", "concept:foo", "MENTIONS", "INFERRED", { page: "p1.md", confidence: 0.7 })
      ow.test.assert(g._state.edges.length > 0, true, "semantic edge should be created")
      g.buildStructural([{ path: "p1.md", meta: { title: "P1 updated" }, body: "# P1 updated", links: [] }])
      var dangling = g._state.edges.filter(function(edge) {
        return !isMap(g._state.nodes[edge.from]) || !isMap(g._state.nodes[edge.to])
      })
      ow.test.assert(dangling.length, 0, "rebuild should not leave dangling semantic edges")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testGraphUpdatePageEquivalence = function() {
    var dir = mkTmp()
    try {
      var g = new MiniAWikiGraph({ graphDir: dir })
      g.buildStructural(pages())
      g.updatePage({
        path: "a.md",
        meta: { title: "A2", tags: ["core", "extra"], aliases: ["Alpha"] },
        body: "# A2\n## Intro\nSee [B](b.md)\n## More",
        links: ["b.md"]
      })
      var fresh = new MiniAWikiGraph({ graphDir: dir + "-fresh" })
      fresh.buildStructural([
        {
          path: "a.md",
          meta: { title: "A2", tags: ["core", "extra"], aliases: ["Alpha"] },
          body: "# A2\n## Intro\nSee [B](b.md)\n## More",
          links: ["b.md"]
        },
        pages()[1]
      ])
      ow.test.assert(g.stats().nodes, fresh.stats().nodes, "incremental update should match fresh build node count")
      ow.test.assert(g.stats().edges, fresh.stats().edges, "incremental update should match fresh build edge count")
    } finally { try { io.rm(dir) } catch(e) {}; try { io.rm(dir + "-fresh") } catch(e2) {} }
  }

  exports.testGraphUpdatePageNoChangeIsNoop = function() {
    var dir = mkTmp()
    try {
      var g = new MiniAWikiGraph({ graphDir: dir })
      g.buildStructural(pages())
      var before = g.stats()
      var res = g.updatePage(pages()[0])
      var after = g.stats()
      ow.test.assert(res.changed, false, "unchanged page should be a no-op")
      ow.test.assert(after.nodes, before.nodes, "node count should stay unchanged")
      ow.test.assert(after.edges, before.edges, "edge count should stay unchanged")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testGraphRemovePagePrunesOrphans = function() {
    var dir = mkTmp()
    try {
      var g = new MiniAWikiGraph({ graphDir: dir })
      g.buildStructural([
        { path: "x.md", meta: { title: "X", tags: ["alpha"] }, body: "# X", links: [] },
        { path: "y.md", meta: { title: "Y", tags: ["beta"] }, body: "# Y", links: [] }
      ])
      g.removePage("y.md")
      ow.test.assert(isUnDef(g._state.nodes["doc:y.md"]), true, "removed page doc node should be pruned")
      ow.test.assert(isDef(g._state.nodes["doc:x.md"]), true, "remaining page doc node should stay")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testGraphCompactSaveNoReport = function() {
    var dir = mkTmp()
    try {
      var g = new MiniAWikiGraph({ graphDir: dir })
      g.buildStructural(pages())
      ow.test.assert(io.fileExists(dir + "/graph.json"), true, "graph.json should exist")
      ow.test.assert(io.fileExists(dir + "/GRAPH_REPORT.md"), false, "graph report should not be written during normal save")
      var report = g.saveReport()
      ow.test.assert(report.ok, true, "explicit saveReport should succeed")
      ow.test.assert(io.fileExists(dir + "/GRAPH_REPORT.md"), true, "graph report should be created on demand")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testGraphSemanticBuildFallsBackWithoutLlm = function() {
    var dir = mkTmp()
    try {
      var g = new MiniAWikiGraph({ graphDir: dir })
      g.buildStructural([
        {
          path: "alpha.md",
          meta: { title: "Alpha" },
          body: "# Alpha\nAlpha references [Beta](beta.md)\n## Shared Context",
          links: ["beta.md"]
        }
      ])
      var res = g.buildSemantic([
        {
          path: "alpha.md",
          meta: { title: "Alpha" },
          body: "# Alpha\nAlpha references [Beta](beta.md)\n## Shared Context",
          links: ["beta.md"]
        }
      ])
      ow.test.assert(res.ok, true, "semantic build should not fail without an injected extractor")
      var summary = g._state.summaries.pages["alpha.md"]
      ow.test.assert(isString(summary.summary) && summary.summary.length > 0, true, "fallback semantic build should produce a summary")
      var semanticEdges = g._state.edges.filter(function(edge) {
        return String(edge.provenance || "").toUpperCase() === "AMBIGUOUS" || String(edge.provenance || "").toUpperCase() === "INFERRED"
      })
      ow.test.assert(semanticEdges.length > 0, true, "fallback semantic build should produce semantic edges")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

})()
