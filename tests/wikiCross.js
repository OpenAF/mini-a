(function() {
  load("mini-a-common.js")
  load("mini-a-wiki.js")

  var createTestDir = function() {
    var testDir = java.io.File.createTempFile("miniwikicross-test-", "").getCanonicalPath()
    io.rm(testDir)
    io.mkdir(testDir)
    return testDir
  }

  var cleanupTestDir = function(dir) {
    try { io.rm(dir) } catch(e) {}
  }

  // buildWiki: construct a rw+graph-enabled MiniAWikiManager, write the given pages
  // ({path, meta, body}), and reindex so both Lucene and graph.json are persisted to
  // disk — mirroring the sequence a mount's graph is later read back from.
  var buildWiki = function(dir, pages, cfgExtra) {
    var cfg = { backend: "fs", root: dir, access: "rw", usegraph: true }
    var extra = isMap(cfgExtra) ? cfgExtra : {}
    Object.keys(extra).forEach(function(k) { cfg[k] = extra[k] })
    var wm = new MiniAWikiManager(cfg)
    pages.forEach(function(pg) {
      var res = wm.write(pg.path, isMap(pg.meta) ? pg.meta : {}, isString(pg.body) ? pg.body : "")
      if (res.ok !== true) throw "fixture write failed for " + pg.path + ": " + res.error
    })
    var rres = wm.reindex()
    if (rres.ok !== true) throw "fixture reindex failed: " + rres.error
    return wm
  }

  // A local page carrying no tags/aliases, used as filler to keep a shared key's
  // document-frequency below the default maxDf so the join under test isn't
  // itself excluded as "too generic".
  var filler = function(n) { return { path: "filler" + n + ".md", meta: { title: "Filler " + n }, body: "# Filler " + n + "\nnothing relevant" } }

  exports.testCrossExplicitLinkResolvesTitleAndDigest = function() {
    var dir1 = createTestDir(), dir2 = createTestDir()
    try {
      buildWiki(dir2, [
        { path: "setup.md", meta: { title: "Team Setup", description: "how the team sets up" }, body: "# Team Setup\nunique-b-setup-keyword" }
      ])
      var a = buildWiki(dir1, [
        { path: "a.md", meta: { title: "A Page" }, body: "# A Page\nSee [Team Setup](@b/setup.md) for details." }
      ])
      a.attach("b", { backend: "fs", root: dir2 })

      var cross = a._crossWikiExpand(["a.md"], {})
      var entry = cross.filter(function(r) { return r.path === "@b/setup.md" })[0]
      ow.test.assert(isDef(entry), true, "explicit @b/ link should be resolved by cross-wiki expansion")
      ow.test.assert(entry.connection.indexOf("cross_link") >= 0, true, "connection should be cross_link")
      ow.test.assert(entry.title, "Team Setup", "title should be resolved from the mount's own graph, not a slugified path")
      ow.test.assert(entry.digest !== "setup.md", true, "digest should be resolved, not the bare local path")
    } finally { cleanupTestDir(dir1); cleanupTestDir(dir2) }
  }

  exports.testCrossDepthTwoReachesUnlinkedMountPage = function() {
    var dir1 = createTestDir(), dir2 = createTestDir()
    try {
      buildWiki(dir2, [
        { path: "setup.md", meta: { title: "Team Setup" }, body: "# Team Setup\nSee [Deep](deep.md)." },
        { path: "deep.md", meta: { title: "Deep Page" }, body: "# Deep Page\nunique-b-deep-keyword" }
      ])
      var a = buildWiki(dir1, [
        { path: "a.md", meta: { title: "A Page" }, body: "# A Page\nSee [Team Setup](@b/setup.md)." }
      ])
      a.attach("b", { backend: "fs", root: dir2 })

      var depth1 = a._crossWikiExpand(["a.md"], { depth: 1 })
      ow.test.assert(depth1.some(function(r) { return r.path === "@b/deep.md" }), false, "depth=1 should not reach deep.md")

      var depth2 = a._crossWikiExpand(["a.md"], { depth: 2 })
      var deepEntry = depth2.filter(function(r) { return r.path === "@b/deep.md" })[0]
      ow.test.assert(isDef(deepEntry), true, "depth=2 should reach deep.md via setup.md's in-mount related pages")
      ow.test.assert(deepEntry.connection.indexOf("cross_link_depth2") >= 0, true, "connection should record the depth-2 hop")
    } finally { cleanupTestDir(dir1); cleanupTestDir(dir2) }
  }

  exports.testCrossSharedTagJoinsWithLowDf = function() {
    var dir1 = createTestDir(), dir2 = createTestDir()
    try {
      buildWiki(dir2, [
        { path: "widget.md", meta: { title: "Widget Page", tags: ["widget"] }, body: "# Widget Page\nunique-b-widget-keyword" },
        filler(1), filler(2), filler(3), filler(4)
      ])
      var a = buildWiki(dir1, [
        { path: "x.md", meta: { title: "X Page", tags: ["widget"] }, body: "# X Page\nno cross links here" }
      ])
      a.attach("b", { backend: "fs", root: dir2 })

      var cross = a._crossWikiExpand(["x.md"], {})
      var entry = cross.filter(function(r) { return r.path === "@b/widget.md" })[0]
      ow.test.assert(isDef(entry), true, "shared tag below maxDf should join")
      ow.test.assert(entry.connection.indexOf("shared_tag") >= 0, true, "connection should be shared_tag")
    } finally { cleanupTestDir(dir1); cleanupTestDir(dir2) }
  }

  exports.testCrossSharedAliasJoinsWithLowDf = function() {
    var dir1 = createTestDir(), dir2 = createTestDir()
    try {
      buildWiki(dir2, [
        { path: "known.md", meta: { title: "Known Page", aliases: ["uniquealias"] }, body: "# Known Page\nunique-b-alias-keyword" },
        filler(1), filler(2), filler(3), filler(4)
      ])
      var a = buildWiki(dir1, [
        { path: "x.md", meta: { title: "X Page", aliases: ["uniquealias"] }, body: "# X Page\nno cross links here" }
      ])
      a.attach("b", { backend: "fs", root: dir2 })

      var cross = a._crossWikiExpand(["x.md"], {})
      var entry = cross.filter(function(r) { return r.path === "@b/known.md" })[0]
      ow.test.assert(isDef(entry), true, "shared alias below maxDf should join")
      ow.test.assert(entry.connection.indexOf("shared_alias") >= 0, true, "connection should be shared_alias")
    } finally { cleanupTestDir(dir1); cleanupTestDir(dir2) }
  }

  exports.testCrossSharedConceptJoins = function() {
    var dir1 = createTestDir(), dir2 = createTestDir()
    try {
      // Only emit the concept:kubernetes relationship for the one page under test —
      // every other page (the fillers, needed to keep the concept's document
      // frequency under maxDf) gets no relationships at all.
      var extractOnlyFor = function(targetPath, fromTitle) {
        return function(payload) {
          if (!isMap(payload) || payload.path !== targetPath) return { relationships: [] }
          return { relationships: [{ from: fromTitle, to: "Kubernetes", type: "RELATES_TO" }] }
        }
      }
      var b = buildWiki(dir2, [
        { path: "target.md", meta: { title: "Target Page" }, body: "# Target Page\nunique-b-concept-keyword" },
        filler(1), filler(2), filler(3), filler(4)
      ], { llmExtractFn: extractOnlyFor("target.md", "Target Page") })
      b.graph("build", { semantic: true })

      var a = buildWiki(dir1, [
        { path: "x.md", meta: { title: "X Page" }, body: "# X Page\nno cross links here" }
      ], { llmExtractFn: extractOnlyFor("x.md", "X Page") })
      a.graph("build", { semantic: true })
      a.attach("b", { backend: "fs", root: dir2 })

      var cross = a._crossWikiExpand(["x.md"], {})
      var entry = cross.filter(function(r) { return r.path === "@b/target.md" })[0]
      ow.test.assert(isDef(entry), true, "shared concept:kubernetes should join x.md to target.md")
      ow.test.assert(entry.connection.indexOf("shared_concept") >= 0, true, "connection should be shared_concept")
    } finally { cleanupTestDir(dir1); cleanupTestDir(dir2) }
  }

  exports.testCrossMaxDfExcludesGenericTag = function() {
    var dir1 = createTestDir(), dir2 = createTestDir()
    try {
      buildWiki(dir2, [
        { path: "e1.md", meta: { title: "E1", tags: ["everywhere"] }, body: "# E1" },
        { path: "e2.md", meta: { title: "E2", tags: ["everywhere"] }, body: "# E2" },
        { path: "e3.md", meta: { title: "E3", tags: ["everywhere"] }, body: "# E3" },
        { path: "e4.md", meta: { title: "E4", tags: ["everywhere"] }, body: "# E4" }
      ])
      var a = buildWiki(dir1, [
        { path: "x.md", meta: { title: "X Page", tags: ["everywhere"] }, body: "# X Page\nno cross links here" }
      ])
      a.attach("b", { backend: "fs", root: dir2 })

      var cross = a._crossWikiExpand(["x.md"], {})
      ow.test.assert(cross.length, 0, "a tag on 100% of the mount's docs should be excluded by the maxDf filter")
    } finally { cleanupTestDir(dir1); cleanupTestDir(dir2) }
  }

  exports.testCrossExpandsLocalOnlyHitIntoMount = function() {
    var dir1 = createTestDir(), dir2 = createTestDir()
    try {
      buildWiki(dir2, [
        { path: "setup.md", meta: { title: "Team Setup", tags: ["ops"] }, body: "# Team Setup\nno relation to the local keyword" },
        filler(1), filler(2), filler(3), filler(4)
      ])
      var a = buildWiki(dir1, [
        { path: "a.md", meta: { title: "A Page", tags: ["ops"] }, body: "# A Page\nonlyinlocal-keyword" }
      ])
      a.attach("b", { backend: "fs", root: dir2 })

      var hits = a.search("onlyinlocal-keyword", { forceScan: true })
      ow.test.assert(hits.some(function(h) { return h.path === "a.md" }), true, "local page should match lexically")
      var crossHit = hits.filter(function(h) { return isString(h.path) && h.path.indexOf("@b/") === 0 })[0]
      ow.test.assert(isDef(crossHit), true, "a query that only text-matches locally should still surface a mount page via shared graph state")
      ow.test.assert(isString(crossHit.description) && crossHit.description.indexOf("[Related pages (graph @b)]") === 0, true, "cross-wiki hint description must keep the exact mount-graph-hint prefix (mcp-wiki-safe.yaml sniffs on it)")
    } finally { cleanupTestDir(dir1); cleanupTestDir(dir2) }
  }

  exports.testCrossDisabledByWikigraphcrossFalse = function() {
    var dir1 = createTestDir(), dir2 = createTestDir()
    try {
      buildWiki(dir2, [
        { path: "setup.md", meta: { title: "Team Setup" }, body: "# Team Setup" }
      ])
      var a = buildWiki(dir1, [
        { path: "a.md", meta: { title: "A Page" }, body: "# A Page\nSee [Team Setup](@b/setup.md)." }
      ], { wikigraphcross: false })
      a.attach("b", { backend: "fs", root: dir2 })

      ow.test.assert(a._crossWikiExpand(["a.md"], {}).length, 0, "wikigraphcross=false should fully disable cross-wiki expansion")
    } finally { cleanupTestDir(dir1); cleanupTestDir(dir2) }
  }

  exports.testCrossDisabledByWikigraphmountsFalse = function() {
    var dir1 = createTestDir(), dir2 = createTestDir()
    try {
      buildWiki(dir2, [
        { path: "setup.md", meta: { title: "Team Setup" }, body: "# Team Setup" }
      ])
      var a = buildWiki(dir1, [
        { path: "a.md", meta: { title: "A Page" }, body: "# A Page\nSee [Team Setup](@b/setup.md)." }
      ], { wikigraphmounts: false })
      a.attach("b", { backend: "fs", root: dir2 })

      ow.test.assert(a._crossWikiExpand(["a.md"], {}).length, 0, "wikigraphmounts=false should also disable cross-wiki expansion")
    } finally { cleanupTestDir(dir1); cleanupTestDir(dir2) }
  }

  exports.testCrossMountWithoutGraphDegradesSilently = function() {
    var dir1 = createTestDir(), dir2 = createTestDir()
    try {
      // dir2 is a plain rw wiki with usegraph left off — no .mini-a-wiki-graph/graph.json
      // is ever written, matching a mount attached without the graph feature enabled.
      var plain = new MiniAWikiManager({ backend: "fs", root: dir2, access: "rw" })
      plain.write("nograph.md", { title: "No Graph" }, "# No Graph")

      var a = buildWiki(dir1, [
        { path: "a.md", meta: { title: "A Page" }, body: "# A Page\nSee [No Graph](@b/nograph.md)." }
      ])
      a.attach("b", { backend: "fs", root: dir2 })

      var cross
      try { cross = a._crossWikiExpand(["a.md"], {}) } catch(e) { cross = "threw: " + __miniAErrMsg(e) }
      ow.test.assert(isArray(cross), true, "a mount with no graph.json should degrade to an empty/partial result, never throw")
    } finally { cleanupTestDir(dir1); cleanupTestDir(dir2) }
  }

  exports.testCrossExpandDoesNotReadBackend = function() {
    var dir1 = createTestDir(), dir2 = createTestDir()
    try {
      buildWiki(dir2, [
        { path: "setup.md", meta: { title: "Team Setup", tags: ["ops"] }, body: "# Team Setup\nSee [Deep](deep.md)." },
        { path: "deep.md", meta: { title: "Deep Page", tags: ["ops"] }, body: "# Deep Page" },
        filler(1), filler(2), filler(3)
      ])
      var a = buildWiki(dir1, [
        { path: "a.md", meta: { title: "A Page", tags: ["ops"] }, body: "# A Page\nSee [Team Setup](@b/setup.md)." }
      ])
      a.attach("b", { backend: "fs", root: dir2 })

      var localReads = 0, mountReads = 0
      var origLocalRead = a._backend.read
      a._backend.read = function(p) { localReads++; return origLocalRead(p) }
      var mountManager = a._mounts[0].manager
      var origMountRead = mountManager._backend.read
      mountManager._backend.read = function(p) { mountReads++; return origMountRead(p) }

      var cross = a._crossWikiExpand(["a.md"], { depth: 2 })
      ow.test.assert(cross.length > 0, true, "sanity: cross-wiki expansion should still find results")
      ow.test.assert(localReads, 0, "cross-wiki expansion must not read the local backend")
      ow.test.assert(mountReads, 0, "cross-wiki expansion must not read the mount's backend")
    } finally { cleanupTestDir(dir1); cleanupTestDir(dir2) }
  }

  exports.testGraphOpCrossReturnsEntries = function() {
    var dir1 = createTestDir(), dir2 = createTestDir()
    try {
      buildWiki(dir2, [
        { path: "setup.md", meta: { title: "Team Setup" }, body: "# Team Setup" }
      ])
      var a = buildWiki(dir1, [
        { path: "a.md", meta: { title: "A Page" }, body: "# A Page\nSee [Team Setup](@b/setup.md)." }
      ])
      a.attach("b", { backend: "fs", root: dir2 })

      var res = a.graph("cross", { path: "a.md" })
      ow.test.assert(res.ok, true, "graph op=cross should succeed")
      ow.test.assert(isArray(res.entries) && res.entries.some(function(e) { return e.path === "@b/setup.md" }), true, "graph op=cross should return the resolved entry")
    } finally { cleanupTestDir(dir1); cleanupTestDir(dir2) }
  }

  exports.testRelatedIncludesCrossField = function() {
    var dir1 = createTestDir(), dir2 = createTestDir()
    try {
      buildWiki(dir2, [
        { path: "setup.md", meta: { title: "Team Setup" }, body: "# Team Setup" }
      ])
      var a = buildWiki(dir1, [
        { path: "a.md", meta: { title: "A Page" }, body: "# A Page\nSee [Team Setup](@b/setup.md)." }
      ])
      a.attach("b", { backend: "fs", root: dir2 })

      var res = a.related("a.md")
      ow.test.assert(isArray(res.cross) && res.cross.some(function(e) { return e.path === "@b/setup.md" }), true, "related() should include cross-wiki neighbours")
    } finally { cleanupTestDir(dir1); cleanupTestDir(dir2) }
  }

})()
