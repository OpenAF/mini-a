(function() {
  load("mini-a-common.js")
  load("mini-a-wiki.js")
  load("mini-a-mcp-wiki.js")

  var createTestDir = function() {
    var testDir = java.io.File.createTempFile("miniwiki-test-", "").getCanonicalPath()
    io.rm(testDir)
    io.mkdir(testDir)
    return testDir
  }

  var cleanupTestDir = function(dir) {
    try { io.rm(dir) } catch(e) {}
  }

  var writePage = function(dir, path, content) {
    var full = dir + java.io.File.separator + path.replace(/\//g, java.io.File.separator)
    var parent = full.substring(0, full.lastIndexOf(java.io.File.separator))
    if (!io.fileExists(parent)) io.mkdir(parent)
    io.writeFileString(full, content)
  }

  var createArchiveWiki = function(dir, ext) {
    var archive = dir + java.io.File.separator + "wiki" + ext
    plugin("ZIP")
    var zip = new ZIP()
    try {
      zip.putFile("index.md", af.fromString2Bytes("---\ntitle: Archive Home\n---\n# Archive Home\narchive-root-keyword"))
      zip.putFile("overview.md", af.fromString2Bytes("---\ntitle: Archive Overview\n---\n# Archive Overview\narchive-root-keyword"))
      zip.putFile("guides/index.md", af.fromString2Bytes("---\ntitle: Guides\n---\n# Guides"))
      zip.putFile("guides/setup.md", af.fromString2Bytes("---\ntitle: Archive Setup\ndescription: nested archive page\n---\n# Setup\narchive-nested-keyword"))
      zip.putFile(".mini-a-wiki-graph/graph.json", af.fromString2Bytes(stringify({
        version: 2,
        nodes: {
          "doc:overview.md": { id: "doc:overview.md", type: "document", props: { path: "overview.md", digest: "Archive overview" } },
          "doc:guides/setup.md": { id: "doc:guides/setup.md", type: "document", props: { path: "guides/setup.md", digest: "Archive setup" } }
        },
        edges: [{ from: "doc:overview.md", to: "doc:guides/setup.md", type: "LINKS_TO", provenance: "EXTRACTED", props: {} }],
        summaries: { pages: {}, communities: {} }, semantic_cache: {}, communities: [], surprise: []
      }, __, "")))
      zip.putFile("notes.txt", af.fromString2Bytes("not a wiki page"))
      zip.putFile("../outside.md", af.fromString2Bytes("must not be exposed"))
      zip.generate2File(archive, { compressionLevel: 9 })
    } finally {
      try { zip.close() } catch(e) {}
    }
    return archive
  }

  // ── Parsefrontmatter ────────────────────────────────────────────────────────

  exports.testParseFrontmatterWithYaml = function() {
    var wm = new MiniAWikiManager({ backend: "fs", root: "." })
    var raw = "---\ntitle: Test Page\ntags:\n  - foo\n---\n# Body\nHello."
    var result = wm.parseFrontmatter(raw)
    ow.test.assert(result.meta.title, "Test Page", "title should be parsed")
    ow.test.assert(isArray(result.meta.tags), true, "tags should be an array")
    ow.test.assert(result.body.indexOf("# Body") >= 0, true, "body should contain heading")
  }

  exports.testParseFrontmatterWithoutBlock = function() {
    var wm = new MiniAWikiManager({ backend: "fs", root: "." })
    var raw = "# Just a page\nNo front-matter here."
    var result = wm.parseFrontmatter(raw)
    ow.test.assert(isObject(result.meta), true, "meta should be empty object")
    ow.test.assert(result.body.indexOf("# Just a page") >= 0, true, "body should be the full content")
  }

  // ── ExtractLinks ─────────────────────────────────────────────────────────────

  exports.testExtractMarkdownLinks = function() {
    var wm = new MiniAWikiManager({ backend: "fs", root: "." })
    var body = "See [intro](intro.md) and [setup](docs/setup.md) for details."
    var links = wm.extractLinks(body)
    ow.test.assert(links.indexOf("intro.md") >= 0, true, "should find intro.md")
    ow.test.assert(links.indexOf("docs/setup.md") >= 0, true, "should find docs/setup.md")
  }

  exports.testExtractWikiStyleLinks = function() {
    var wm = new MiniAWikiManager({ backend: "fs", root: "." })
    var body = "See [[Getting Started]] and [[API Reference]] and [[mini-a/usage.md|Usage]] for more."
    var links = wm.extractLinks(body)
    ow.test.assert(links.indexOf("getting-started.md") >= 0, true, "should find getting-started.md")
    ow.test.assert(links.indexOf("api-reference.md") >= 0, true, "should find api-reference.md")
    ow.test.assert(links.indexOf("mini-a/usage.md") >= 0, true, "should use the target portion of an aliased wiki link")
  }

  exports.testExtractLinksDeduplicates = function() {
    var wm = new MiniAWikiManager({ backend: "fs", root: "." })
    var body = "See [a](page.md) and [b](page.md)."
    var links = wm.extractLinks(body)
    ow.test.assert(links.length, 1, "duplicate links should be deduplicated")
  }

  // ── ResolveLink ──────────────────────────────────────────────────────────────

  exports.testResolveLinkSameDir = function() {
    var wm = new MiniAWikiManager({ backend: "fs", root: "." })
    var resolved = wm.resolveLink("openaf-opencli/page.md", "concepts.md")
    ow.test.assert(resolved, "openaf-opencli/concepts.md", "relative link should resolve to same directory")
  }

  exports.testResolveLinkDotDot = function() {
    var wm = new MiniAWikiManager({ backend: "fs", root: "." })
    var resolved = wm.resolveLink("openaf-opencli/page.md", "../root.md")
    ow.test.assert(resolved, "root.md", "../ link should resolve to parent directory")
  }

  exports.testResolveLinkFromRoot = function() {
    var wm = new MiniAWikiManager({ backend: "fs", root: "." })
    var resolved = wm.resolveLink("index.md", "getting-started.md")
    ow.test.assert(resolved, "getting-started.md", "root-level page link should stay at root")
  }

  exports.testResolveLinkAbsoluteIsRootRelative = function() {
    var wm = new MiniAWikiManager({ backend: "fs", root: "." })
    var resolved = wm.resolveLink("page.md", "/absolute/page.md")
    ow.test.assert(resolved, "absolute/page.md", "absolute path links should resolve as bundle-root-relative")
  }

  exports.testResolveLinkExternalReturnsNull = function() {
    var wm = new MiniAWikiManager({ backend: "fs", root: "." })
    var resolved = wm.resolveLink("page.md", "https://github.com/OpenAF/openaf/blob/master/docs/ojob.md")
    ow.test.assert(resolved, null, "external https links should return null")
  }

  exports.testResolveLinkEscapesRootReturnsNull = function() {
    var wm = new MiniAWikiManager({ backend: "fs", root: "." })
    var resolved = wm.resolveLink("sub/page.md", "../../outside.md")
    ow.test.assert(resolved, null, "links that escape wiki root should return null")
  }



  exports.testNearDuplicateIdentical = function() {
    var wm = new MiniAWikiManager({ backend: "fs", root: "." })
    ow.test.assert(wm._isNearDuplicate("hello world", "hello world"), true, "identical strings are duplicates")
  }

  exports.testNearDuplicateDifferent = function() {
    var wm = new MiniAWikiManager({ backend: "fs", root: "." })
    ow.test.assert(wm._isNearDuplicate("the quick brown fox", "completely different content here"), false, "different strings are not duplicates")
  }

  // ── Filesystem backend ────────────────────────────────────────────────────────

  exports.testFsBackendList = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "index.md", "# Index")
      writePage(dir, "intro.md", "# Intro")
      writePage(dir, "docs/setup.md", "# Setup")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var pages = wm.list()
      ow.test.assert(pages.length >= 3, true, "should list all markdown files")
      ow.test.assert(pages.some(function(p) { return p === "index.md" }), true, "should include index.md")
      ow.test.assert(pages.some(function(p) { return p === "intro.md" }), true, "should include intro.md")
      ow.test.assert(pages.some(function(p) { return p.indexOf("setup.md") >= 0 }), true, "should include docs/setup.md")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testFsBackendListRealFiles = function() {
    var dir = createTestDir()
    try {
      io.writeFileString(dir + java.io.File.separator + "AGENTS.md", "# Agents")
      io.writeFileString(dir + java.io.File.separator + "TestPage.md", "# Test Page")
      io.writeFileString(dir + java.io.File.separator + "TestKnowledge.md", "# Test Knowledge")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var pages = wm.list("")
      ow.test.assert(pages.indexOf("AGENTS.md") >= 0, true, "should include AGENTS.md")
      ow.test.assert(pages.indexOf("TestPage.md") >= 0, true, "should include TestPage.md")
      ow.test.assert(pages.indexOf("TestKnowledge.md") >= 0, true, "should include TestKnowledge.md")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testFsBackendListWithPrefixKeepsPrefix = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "docs/setup.md", "# Setup")
      writePage(dir, "docs/intro.md", "# Intro")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var pages = wm.list("docs")
      ow.test.assert(pages.indexOf("docs/setup.md") >= 0, true, "prefixed list should include docs/setup.md")
      ow.test.assert(pages.indexOf("docs/intro.md") >= 0, true, "prefixed list should include docs/intro.md")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testFsBackendListHandlesNestedListFilesRecursiveShape = function() {
    var dir = createTestDir()
    var originalListFilesRecursive = listFilesRecursive
    try {
      io.writeFileString(dir + java.io.File.separator + "AGENTS.md", "# Agents")
      io.writeFileString(dir + java.io.File.separator + "TestPage.md", "# Test Page")
      listFilesRecursive = function(baseDir) {
        return {
          files: [
            { filename: "AGENTS.md", path: baseDir, isFile: true },
            { filename: "TestPage.md", path: baseDir, isFile: true }
          ]
        }
      }
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var pages = wm.list("")
      ow.test.assert(pages.indexOf("AGENTS.md") >= 0, true, "should include AGENTS.md from nested recursive shape")
      ow.test.assert(pages.indexOf("TestPage.md") >= 0, true, "should include TestPage.md from nested recursive shape")
    } finally {
      listFilesRecursive = originalListFilesRecursive
      cleanupTestDir(dir)
    }
  }

  exports.testFsBackendListHandlesIterableListFilesRecursiveShape = function() {
    var dir = createTestDir()
    var originalListFilesRecursive = listFilesRecursive
    try {
      io.writeFileString(dir + java.io.File.separator + "AGENTS.md", "# Agents")
      io.writeFileString(dir + java.io.File.separator + "index.md", "# Index")
      listFilesRecursive = function(baseDir) {
        var entries = io.listFiles(baseDir).files
        return {
          forEach: function(fn) {
            entries.forEach(function(entry, idx) {
              fn(entry, idx)
            })
          }
        }
      }
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var pages = wm.list("")
      ow.test.assert(pages.indexOf("AGENTS.md") >= 0, true, "should include AGENTS.md from iterable recursive shape")
      ow.test.assert(pages.indexOf("index.md") >= 0, true, "should include index.md from iterable recursive shape")
    } finally {
      listFilesRecursive = originalListFilesRecursive
      cleanupTestDir(dir)
    }
  }

  exports.testArchiveFsBackendZipAndOktReadOnly = function() {
    var dir = createTestDir()
    try {
      [".zip", ".okt"].forEach(function(ext) {
        var archive = createArchiveWiki(dir, ext)
        var wm = new MiniAWikiManager({ backend: "fs", root: archive, access: "rw", usegraph: true })
        var pages = wm.list()
        ow.test.assert(wm._access, "ro", ext + " root must force read-only access")
        ow.test.assert(pages.indexOf("index.md") >= 0, true, ext + " should expose root index")
        ow.test.assert(pages.indexOf("guides/setup.md") >= 0, true, ext + " should expose nested page")
        ow.test.assert(pages.indexOf("../outside.md") >= 0, false, ext + " should hide unsafe entries")
        var page = wm.read("guides/setup.md")
        ow.test.assert(page.meta.title, "Archive Setup", ext + " should parse front matter")
        ow.test.assert(wm.search("archive-nested-keyword", { forceScan: true }).length > 0, true, ext + " should search entries")
        ow.test.assert(wm.tree("", 2).sections[0].path, "guides/", ext + " should build nested tree")
        ow.test.assert(wm.browse("guides").nearest_index.exists, true, ext + " should browse nested index")
        ow.test.assert(wm.graph("stats", {}).nodes, 2, ext + " should load graph state from the archive")
        var graphHints = wm.search("archive-root-keyword", { forceScan: true })
        ow.test.assert(graphHints.some(function(hit) { return hit.path === "guides/setup.md" && String(hit.description).indexOf("[Related pages (graph)]") === 0 }), true, ext + " should use the archive graph for search hints")
        ow.test.assert(wm.write("new.md", { title: "New" }, "# New").ok, false, ext + " should reject writes")
        ow.test.assert(wm.delete("index.md").ok, false, ext + " should reject deletes")
        ow.test.assert(wm.reindex().ok, false, ext + " should reject index rebuilds")
        ow.test.assert(io.fileExists(dir + java.io.File.separator + ".mini-a-wiki-meta"), false, ext + " should not create metadata beside archive")
        ow.test.assert(io.fileExists(dir + java.io.File.separator + ".mini-a-wiki-lucene"), false, ext + " should not create Lucene state beside archive")
        ow.test.assert(io.fileExists(dir + java.io.File.separator + ".mini-a-wiki-graph"), false, ext + " should not create graph state beside archive")

        __miniAMcpWikiInit({ wikibackend: "fs", wikiroot: archive }, { access: "ro", readonly: true })
        ow.test.assert(global.__wikiTool._initialized, true, ext + " MCP helper should initialize against the archive parent directory")
        ow.test.assert(global.__wikiTool.wiki({ operation: "read", path: "guides/setup.md" }).meta.title, "Archive Setup", ext + " MCP helper should read archive pages")
      })
    } finally { cleanupTestDir(dir) }
  }

  exports.testEsRowsToPathsSkipsUndefinedRows = function() {
    var paths = __miniAWikiEsRowsToPaths([
      __,
      { path: "index.md" },
      {},
      { path: 42 },
      { path: "docs/page.md" }
    ])
    ow.test.assert(paths.length, 2, "should keep only rows with string paths")
    ow.test.assert(paths[0], "index.md", "should keep first valid path")
    ow.test.assert(paths[1], "docs/page.md", "should keep second valid path")
  }

  exports.testHttpBundleHelpers = function() {
    ow.test.assert(__miniAWikiUrlJoin("https://wiki.example/", "/index.md"), "https://wiki.example/index.md", "URL joining should use exactly one slash")
    ow.test.assert(isUnDef(__miniAWikiBundleEntryRelative("../outside")), true, "bundle entry paths must reject traversal")
    ow.test.assert(__miniAWikiBundleEntryRelative(".mini-a-wiki-lucene/segments_1"), ".mini-a-wiki-lucene/segments_1", "Lucene entries should be retained")
    ow.test.assert(__miniAWikiBundleChanged({ etag: "new" }, { etag: "old" }), true, "a changed ETag should refresh the bundle")
    ow.test.assert(__miniAWikiBundleChanged({ etag: "same" }, { etag: "same" }), false, "an unchanged ETag should skip refresh")
    ow.test.assert(__miniAWikiBundleChanged({ lastModified: "now" }, { lastModified: "now" }), false, "an unchanged modification time should skip refresh")
    ow.test.assert(__miniAWikiBasicAuth("user", "pass"), "Basic dXNlcjpwYXNz", "HTTP basic auth should be correctly encoded")
  }

  exports.testCliForwardsHttpBundleOptions = function() {
    var job = io.readFileString("mini-a.yaml")
    ;["wikiindexdir", "wikis3artifactprefix", "s3artifactbundle", "wikihttpindexurl", "wikihttptimeout", "wikiartifactrefreshsecs"].forEach(function(option) {
      ow.test.assert((new RegExp("\\b" + option + "\\s*:\\s*" + option + "\\b")).test(job), true, "CLI job should forward " + option + " to Mini-A")
    })
    ow.test.assert(job.indexOf('options  : ["fs", "s3", "s3fs", "es", "http", "https"]') >= 0, true, "CLI job should accept HTTP wiki backends")
  }

  exports.testPeriodicArtifactBundleRefreshReopensCachedRuntime = function() {
    var searchesClosed = 0, graphsClosed = 0, graphsOpened = 0, hydrations = 0
    var fake = {
      _config: { wikiartifactrefreshsecs: 60, s3artifactbundle: true },
      _backendType: "s3",
      _artifactLastCheckAt: 0,
      _searchIndex: { close: function() { searchesClosed++ } },
      _graph: { close: function() { graphsClosed++ } },
      _hydrateS3Artifacts: function() { hydrations++; return true },
      _initializeGraph: function() { graphsOpened++ },
      _logFn: function() {}
    }
    ow.test.assert(MiniAWikiManager.prototype._maybeRefreshArtifactBundle.call(fake), true, "changed S3 bundle should refresh the local runtime")
    ow.test.assert(searchesClosed, 1, "refresh should close the old Lucene reader")
    ow.test.assert(graphsClosed, 1, "refresh should close the old graph reader")
    ow.test.assert(graphsOpened, 1, "refresh should reopen graph state")
    ow.test.assert(hydrations, 1, "refresh should hydrate once")
    ow.test.assert(MiniAWikiManager.prototype._maybeRefreshArtifactBundle.call(fake), false, "refresh interval should suppress an immediate second metadata probe")
    ow.test.assert(hydrations, 1, "suppressed refresh should not hydrate again")

    fake._config.s3artifactbundle = false
    fake._artifactLastCheckAt = 0
    ow.test.assert(MiniAWikiManager.prototype._maybeRefreshArtifactBundle.call(fake), false, "individual S3 artifact trees should not be periodically refreshed")
  }

  exports.testHttpBackendIsReadOnly = function() {
    var hydrate = MiniAWikiManager.prototype._hydrateHttpArtifacts
    try {
      MiniAWikiManager.prototype._hydrateHttpArtifacts = function() {}
      var wm = new MiniAWikiManager({ backend: "https", url: "https://wiki.example", access: "rw" })
      ow.test.assert(wm._backendType, "http", "https should normalize to the HTTP backend")
      ow.test.assert(wm._access, "ro", "HTTP wikis must force read-only access")
      ow.test.assert(wm.write("new.md", { title: "New" }, "# New").ok, false, "HTTP wikis should reject writes")
      ow.test.assert(wm.delete("new.md").ok, false, "HTTP wikis should reject deletes")
    } finally { MiniAWikiManager.prototype._hydrateHttpArtifacts = hydrate }
  }

  exports.testArtifactBundleHydratesAtomically = function() {
    var dir = createTestDir(), archive = dir + "/bundle.zip"
    try {
      var zip = new ZIP()
      try {
        zip.putFile(".mini-a-wiki-lucene/segments_1", af.fromString2Bytes("lucene-binary-fixture"))
        zip.putFile(".mini-a-wiki-graph/graph.json", af.fromString2Bytes("{\"version\":2}"))
        zip.generate2File(archive, { compressionLevel: 0 })
      } finally { try { zip.close() } catch(ignoreZip) {} }
      var fake = { _getIndexRoot: function() { return dir }, _logFn: function() {} }
      var changed = MiniAWikiManager.prototype._hydrateArtifactBundle.call(fake,
        function() { return { etag: "fixture-v1", lastModified: "" } },
        function() { return new java.io.FileInputStream(archive) }, "test", "bundle.zip")
      ow.test.assert(changed, true, "a new bundle should hydrate")
      ow.test.assert(io.readFileString(dir + "/.mini-a-wiki-lucene/segments_1"), "lucene-binary-fixture", "Lucene bundle entries should be extracted")
      ow.test.assert(io.readFileString(dir + "/.mini-a-wiki-graph/graph.json"), "{\"version\":2}", "graph bundle entries should be extracted")
      var unchanged = MiniAWikiManager.prototype._hydrateArtifactBundle.call(fake,
        function() { return { etag: "fixture-v1", lastModified: "" } },
        function() { throw "unchanged bundle must not download" }, "test", "bundle.zip")
      ow.test.assert(unchanged, false, "unchanged bundle metadata should skip download")
    } finally { cleanupTestDir(dir) }
  }

  exports.testFsBackendReadWrite = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      var writeResult = wm.write("test.md", { title: "Test" }, "# Test\nContent here.")
      ow.test.assert(writeResult.ok, true, "write should succeed")
      var page = wm.read("test.md")
      ow.test.assert(isObject(page), true, "read should return an object")
      ow.test.assert(page.meta.title, "Test", "title should be preserved")
      ow.test.assert(page.body.indexOf("# Test") >= 0, true, "body should contain content")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testListSupportsOffsetAndLimitWithoutMeta = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "a.md", "# A")
      writePage(dir, "b.md", "# B")
      writePage(dir, "c.md", "# C")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      var pageList = wm.list("", { offset: 1, limit: 2 })
      ow.test.assert(pageList.length, 2, "offset/limit should slice plain list output")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testWriteIncrementallyUpdatesGraph = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw", usegraph: true })
      var res = wm.write("alpha.md", { title: "Alpha", tags: ["core"] }, "# Alpha\nSee [Beta](beta.md)")
      ow.test.assert(res.ok, true, "write should succeed")
      var stats = wm.graph("stats", {})
      ow.test.assert(stats.nodes > 0, true, "graph should be updated after write")
      var neighbors = wm.graph("neighbors", { path: "alpha.md" })
      ow.test.assert(isArray(neighbors) && neighbors.length > 0, true, "graph neighbors should be available after incremental write")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testDeleteIncrementallyUpdatesGraph = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw", usegraph: true })
      wm.write("alpha.md", { title: "Alpha" }, "# Alpha")
      var before = wm.graph("stats", {})
      wm.delete("alpha.md")
      var after = wm.graph("stats", {})
      ow.test.assert(after.nodes < before.nodes, true, "graph node count should drop after delete")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testBootstrapCreatesAgentsAndIndexForEmptyWritableWiki = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      var pages = wm.list("")
      ow.test.assert(pages.indexOf("AGENTS.md") >= 0, true, "bootstrap should create AGENTS.md")
      ow.test.assert(pages.indexOf("index.md") >= 0, true, "bootstrap should create index.md")

      var agents = wm.read("AGENTS.md")
      var index = wm.read("index.md")
      ow.test.assert(agents.body.indexOf("[Wiki Home](index.md)") >= 0, true, "AGENTS.md should link to index.md")
      ow.test.assert(index.body.indexOf("[AGENTS.md](AGENTS.md)") >= 0, true, "index.md should link to AGENTS.md")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testBootstrapAddsIndexToLegacyAgentsOnlyWiki = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "AGENTS.md", "# Legacy Agents")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      var pages = wm.list("")
      ow.test.assert(pages.indexOf("AGENTS.md") >= 0, true, "legacy AGENTS.md should remain")
      ow.test.assert(pages.indexOf("index.md") >= 0, true, "legacy AGENTS-only wiki should get index.md")

      var agents = wm.read("AGENTS.md")
      ow.test.assert(agents.body.trim(), "# Legacy Agents", "legacy AGENTS.md content should be preserved")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testBootstrapDoesNotModifyNonEmptyWikiWithoutIndex = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "topic.md", "---\ntitle: Topic\n---\n# Topic")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      var pages = wm.list("")
      ow.test.assert(pages.indexOf("topic.md") >= 0, true, "existing page should remain")
      ow.test.assert(pages.indexOf("index.md") >= 0, false, "non-empty wiki should not be auto-upgraded unless legacy AGENTS-only")
      ow.test.assert(pages.indexOf("AGENTS.md") >= 0, false, "non-empty wiki should not get AGENTS.md retroactively")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testFsBackendRejectsTraversalRead = function() {
    var dir = createTestDir()
    var outsideFile = dir + "-outside.md"
    try {
      io.writeFileString(outsideFile, "# Outside")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var result = wm.read("../" + new java.io.File(outsideFile).getName())
      ow.test.assert(isUnDef(result), true, "traversal read should be blocked")
    } finally {
      try { io.rm(outsideFile) } catch(ignoreOutsideCleanup) {}
      cleanupTestDir(dir)
    }
  }

  exports.testFsBackendRejectsTraversalWrite = function() {
    var dir = createTestDir()
    var outsideFile = dir + "-write-outside.md"
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      var result = wm.write("../" + new java.io.File(outsideFile).getName(), "# Outside")
      ow.test.assert(isObject(result) && result.ok === false, true, "traversal write should fail")
      ow.test.assert(io.fileExists(outsideFile), false, "traversal write should not create outside file")
    } finally {
      try { io.rm(outsideFile) } catch(ignoreOutsideCleanup) {}
      cleanupTestDir(dir)
    }
  }

  exports.testFsBackendRejectsTraversalDelete = function() {
    var dir = createTestDir()
    var outsideFile = dir + "-delete-outside.md"
    try {
      io.writeFileString(outsideFile, "# Outside")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      var result = wm.delete("../" + new java.io.File(outsideFile).getName())
      ow.test.assert(isObject(result) && result.ok === false, true, "traversal delete should fail")
      ow.test.assert(io.fileExists(outsideFile), true, "traversal delete should not remove outside file")
    } finally {
      try { io.rm(outsideFile) } catch(ignoreOutsideCleanup) {}
      cleanupTestDir(dir)
    }
  }

  exports.testFsBackendRejectsAbsoluteWrite = function() {
    var dir = createTestDir()
    var outsideFile = dir + "-absolute-write.md"
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      var result = wm.write(outsideFile, "# Outside")
      ow.test.assert(isObject(result) && result.ok === false, true, "absolute write should fail")
      ow.test.assert(io.fileExists(outsideFile), false, "absolute write should not create target")
    } finally {
      try { io.rm(outsideFile) } catch(ignoreOutsideCleanup) {}
      cleanupTestDir(dir)
    }
  }

  exports.testFsBackendRejectsNonMarkdownWrite = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      var result = wm.write("notes.txt", "# Not Markdown")
      ow.test.assert(isObject(result) && result.ok === false, true, "non-markdown write should fail")
      ow.test.assert(io.fileExists(dir + java.io.File.separator + "notes.txt"), false, "non-markdown write should not create file")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testFsBackendRejectsNonMarkdownDelete = function() {
    var dir = createTestDir()
    try {
      io.writeFileString(dir + java.io.File.separator + "notes.txt", "keep me")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      var result = wm.delete("notes.txt")
      ow.test.assert(isObject(result) && result.ok === false, true, "non-markdown delete should fail")
      ow.test.assert(io.fileExists(dir + java.io.File.separator + "notes.txt"), true, "non-markdown delete should not remove file")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testFsBackendReadOnlyWrite = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro" })
      var result = wm.write("test.md", "# Test")
      ow.test.assert(isObject(result) && result.ok === false, true, "write should fail in ro mode")
      var reindexResult = wm.reindex()
      ow.test.assert(isObject(reindexResult) && reindexResult.ok === false, true, "reindex should fail in ro mode")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testFsBackendReadMissing = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var result = wm.read("nonexistent.md")
      ow.test.assert(isUnDef(result), true, "missing page should return undefined")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testFsBackendSearch = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "AGENTS.md", "# Agents\nThe quick brown fox should not be searchable here.")
      writePage(dir, "alpha.md", "---\ntitle: Alpha\n---\nThe quick brown fox.")
      writePage(dir, "beta.md", "---\ntitle: Beta\n---\nSomething else entirely.")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var hits = wm.search("quick brown")
      ow.test.assert(hits.length >= 1, true, "should find matching page")
      ow.test.assert(hits[0].path, "alpha.md", "should return alpha.md")
      ow.test.assert(hits.some(function(hit) { return hit.path === "AGENTS.md" }), false, "search should exclude AGENTS.md")
      var noHits = wm.search("zzznomatchzzz")
      ow.test.assert(noHits.length, 0, "should return empty for no match")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testFsBackendSearchSkipsWikiInternalFiles = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "alpha.md", "---\ntitle: Alpha\n---\nAlpha search term.")
      writePage(dir, ".mini-a-wiki-graph/cache.md", "---\ntitle: Cache\n---\nAlpha search term.")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var hits = wm.search("Alpha search term")
      ow.test.assert(hits.length, 1, "search should only return the knowledge page")
      ow.test.assert(hits[0].path, "alpha.md", "search should ignore hidden wiki internals")
    } finally {
      cleanupTestDir(dir)
    }
  }

  // ── Lint ─────────────────────────────────────────────────────────────────────

  exports.testLintBrokenLink = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "index.md", "---\ntitle: Index\n---\nSee [missing](missing.md).")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var report = wm.lint()
      var brokenLinks = report.issues.filter(function(i) { return i.type === "broken_link" })
      ow.test.assert(brokenLinks.length >= 1, true, "should detect broken link")
      ow.test.assert(brokenLinks[0].target, "missing.md", "should report correct target")
      ow.test.assert(report.summary.errors >= 1, true, "should count as error")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testLintExternalLinkNotBroken = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "index.md", "---\ntitle: Index\n---\nSee [external](https://github.com/OpenAF/openaf/blob/master/docs/ojob.md).")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var report = wm.lint()
      var brokenLinks = report.issues.filter(function(i) { return i.type === "broken_link" })
      ow.test.assert(brokenLinks.length, 0, "external https links should not be broken_link errors")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testLintAliasedWikiLinkNotBroken = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "index.md", "---\ntitle: Index\n---\nSee [[mini-a/usage.md|Usage]].")
      writePage(dir, "mini-a/usage.md", "---\ntitle: Usage\n---\nContent.")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var report = wm.lint()
      var brokenLinks = report.issues.filter(function(i) { return i.type === "broken_link" })
      ow.test.assert(brokenLinks.length, 0, "aliased wiki links should resolve their target path")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testLintAbsolutePathLinkNotBroken = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "wiki/page.md", "---\ntitle: Page\ndescription: desc\ntype: concept\n---\n# Page")
      writePage(dir, "index.md", "---\ntitle: Index\n---\nSee [absolute](/wiki/page.md).")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var report = wm.lint()
      var brokenLinks = report.issues.filter(function(i) { return i.type === "broken_link" })
      ow.test.assert(brokenLinks.length, 0, "absolute path links to existing pages should not be broken_link errors")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testLintRelativeLinkInSubdirValid = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "section/index.md", "---\ntitle: Section Index\n---\nSee [concepts](concepts.md).")
      writePage(dir, "section/concepts.md", "---\ntitle: Concepts\n---\nContent.")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var report = wm.lint()
      var brokenLinks = report.issues.filter(function(i) { return i.type === "broken_link" })
      ow.test.assert(brokenLinks.length, 0, "relative link to sibling page in subdir should not be broken")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testLintRelativeLinkInSubdirBroken = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "section/index.md", "---\ntitle: Section Index\n---\nSee [missing](missing.md).")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var report = wm.lint()
      var brokenLinks = report.issues.filter(function(i) { return i.type === "broken_link" })
      ow.test.assert(brokenLinks.length >= 1, true, "relative link to missing sibling in subdir should be broken")
      ow.test.assert(brokenLinks[0].resolved, "section/missing.md", "resolved path should include subdir prefix")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testLintDotDotLinkValid = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "section/page.md", "---\ntitle: Page\n---\nSee [root](../index.md).")
      writePage(dir, "index.md", "---\ntitle: Index\n---\nContent.")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var report = wm.lint()
      var brokenLinks = report.issues.filter(function(i) { return i.type === "broken_link" })
      ow.test.assert(brokenLinks.length, 0, "../ link to existing page at wiki root should not be broken")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testReadIncludesResolvedLinks = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "section/page.md", "---\ntitle: Page\n---\nSee [concepts](concepts.md) and [root](../index.md) and [[Overview]].")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var page = wm.read("section/page.md")
      ow.test.assert(isArray(page.links), true, "read() should include a links array")
      ow.test.assert(page.links.indexOf("section/concepts.md") >= 0, true, "relative link should be resolved to section/concepts.md")
      ow.test.assert(page.links.indexOf("index.md") >= 0, true, "../ link should be resolved to index.md")
      ow.test.assert(page.links.indexOf("overview.md") >= 0, true, "wiki-style link should appear as root-relative slug")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testLintOrphan = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "index.md", "---\ntitle: Index\n---\nNo links out.")
      writePage(dir, "orphan.md", "---\ntitle: Orphan\n---\nNobody links here.")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var report = wm.lint()
      var orphans = report.issues.filter(function(i) { return i.type === "orphan" })
      ow.test.assert(orphans.some(function(o) { return o.page === "orphan.md" }), true, "should detect orphan page")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testLintMissingFrontmatter = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "nofront.md", "# Page without front-matter\nJust content.")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var report = wm.lint()
      var missing = report.issues.filter(function(i) { return i.type === "missing_frontmatter" && i.page === "nofront.md" && i.field === "title" })
      ow.test.assert(missing.length >= 1, true, "should detect missing title")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testLintHeadingHierarchy = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "badheadings.md", "---\ntitle: Bad\n---\n### Skipped h2\nContent.")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var report = wm.lint()
      var headingIssues = report.issues.filter(function(i) { return i.type === "heading_hierarchy" && i.page === "badheadings.md" })
      ow.test.assert(headingIssues.length >= 1, true, "should detect h3 before h2")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testLintStalePage = function() {
    var dir = createTestDir()
    try {
      var oldDate = new Date(Date.now() - 200 * 86400000).toISOString()
      writePage(dir, "stale.md", "---\ntitle: Stale\nupdated: " + oldDate + "\n---\nOld content.")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var report = wm.lint(__, { staleDays: 90 })
      var staleIssues = report.issues.filter(function(i) { return i.type === "stale" && i.page === "stale.md" })
      ow.test.assert(staleIssues.length >= 1, true, "should detect stale page")
      ow.test.assert(staleIssues[0].age_days > 90, true, "age_days should exceed threshold")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testLintNearDuplicate = function() {
    var dir = createTestDir()
    try {
      var body = "The quick brown fox jumps over the lazy dog every single day without fail whatsoever."
      writePage(dir, "a.md", "---\ntitle: A\n---\n" + body)
      writePage(dir, "b.md", "---\ntitle: B\n---\n" + body)
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var report = wm.lint()
      var dupes = report.issues.filter(function(i) { return i.type === "near_duplicate" })
      ow.test.assert(dupes.length >= 1, true, "should detect near-duplicate pages")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testLintSummaryCountsCorrect = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "index.md", "---\ntitle: Index\n---\nSee [broken](broken.md).")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var report = wm.lint()
      ow.test.assert(report.summary.pages, 1, "pages count should be 1")
      ow.test.assert(report.summary.errors >= 1, true, "errors should include broken link")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testLuceneCompatibilityErrorDetection = function() {
    var wm = new MiniAWikiManager({ backend: "fs", root: "." })
    var msg = "org.apache.lucene.index.IndexFormatTooOldException: Format version is not supported. Could not load codec 'Lucene103'. Did you forget to add lucene-backward-codecs.jar?"
    ow.test.assert(wm._isLuceneIndexCompatibilityError(msg), true, "Lucene codec/index format errors should trigger compatibility recovery")
    ow.test.assert(wm._isLuceneIndexCompatibilityError("LockObtainFailedException: lock held"), false, "Lucene lock errors should keep the normal fallback path")
  }

  exports.testLuceneIncrementalCompatibilityFailureTriggersResetRebuild = function() {
    var wm = new MiniAWikiManager({ backend: "fs", root: ".", access: "rw" })
    var rebuildOptions
    var warnings = []
    wm._rebuildSearchIndex = function(options) { rebuildOptions = options }
    wm._logFn = function(level, msg) { if (level === "warn") warnings.push(msg) }
    wm._handleLuceneIncrementalFailure("update", "Could not load codec 'Lucene103'. The current classpath supports [Lucene104].")
    ow.test.assert(wm._luceneNeedsRebuild, true, "incremental compatibility failure should mark Lucene for rebuild")
    ow.test.assert(isObject(rebuildOptions) && rebuildOptions.resetLucene === true, true, "compatibility failure should request a Lucene index reset")
    ow.test.assert(warnings[0].indexOf("incompatible index") >= 0, true, "warning should explain the reset recovery")
  }

  exports.testLuceneIncrementalGenericFailureDoesNotReset = function() {
    var wm = new MiniAWikiManager({ backend: "fs", root: ".", access: "rw" })
    var rebuildCalled = false
    var warnings = []
    wm._rebuildSearchIndex = function() { rebuildCalled = true }
    wm._logFn = function(level, msg) { if (level === "warn") warnings.push(msg) }
    wm._handleLuceneIncrementalFailure("delete", "LockObtainFailedException: lock held")
    ow.test.assert(wm._luceneNeedsRebuild, true, "generic incremental failure should still mark Lucene for rebuild")
    ow.test.assert(rebuildCalled, false, "generic incremental failures should not reset the Lucene index immediately")
    ow.test.assert(warnings[0].indexOf("Failed incremental Lucene delete:") === 0, true, "generic warning should keep the original wording")
  }

  // ── Serialise round-trip ──────────────────────────────────────────────────────

  exports.testWriteReadRoundTrip = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      var meta = { title: "Round Trip", description: "Test page", tags: ["test"] }
      var body = "# Round Trip\nContent here."
      wm.write("roundtrip.md", meta, body)
      var page = wm.read("roundtrip.md")
      ow.test.assert(page.meta.title, "Round Trip", "title preserved")
      ow.test.assert(page.meta.description, "Test page", "description preserved")
      ow.test.assert(isString(page.meta.updated), true, "updated timestamp set")
      ow.test.assert(page.body.trim().indexOf("# Round Trip") === 0, true, "body preserved")
      var reindexResult = wm.reindex()
      ow.test.assert(isObject(reindexResult) && reindexResult.ok === wm._hasEnhancedLexicalSupport(), true, "reindex should require lexicalEnhanced Lucene support")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testRawWritePreservesCreatedMetadata = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      wm.write("raw.md", { title: "Raw Page", description: "Initial" }, "# Raw Page\nInitial content.")
      var original = wm.read("raw.md")
      wm.write("raw.md", "# Raw Page\nUpdated content.")
      var updated = wm.read("raw.md")
      ow.test.assert(updated.meta.created, original.meta.created, "raw write should preserve created timestamp")
      ow.test.assert(updated.meta.title, "Raw Page", "raw write should preserve or infer title")
      ow.test.assert(isString(updated.meta.updated), true, "raw write should refresh updated timestamp")
    } finally {
      cleanupTestDir(dir)
    }
  }

  // ── Hierarchy ────────────────────────────────────────────────────────────────

  exports.testTreeShowsNestedSectionIndex = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "index.md", "---\ntitle: Home\n---\n# Home")
      writePage(dir, "guides/index.md", "---\ntitle: Guides\n---\n# Guides")
      writePage(dir, "guides/setup.md", "---\ntitle: Setup\n---\n# Setup")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var tree = wm.tree("", 2)
      var guides = tree.sections.filter(function(s) { return s.path === "guides/" })[0]
      ow.test.assert(isObject(guides), true, "tree should include guides section")
      ow.test.assert(guides.index.exists, true, "section index should be marked present")
      ow.test.assert(guides.pages.some(function(p) { return p.path === "guides/setup.md" }), true, "section page should be listed")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testBrowseSuggestsSectionReads = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "index.md", "---\ntitle: Home\n---\n# Home")
      writePage(dir, "guides/index.md", "---\ntitle: Guides\n---\n# Guides")
      writePage(dir, "guides/setup.md", "---\ntitle: Setup\n---\n# Setup")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var browse = wm.browse("guides/")
      ow.test.assert(browse.nearest_index.path, "guides/index.md", "browse should point at section index")
      ow.test.assert(browse.direct_pages.some(function(p) { return p.path === "guides/setup.md" }), true, "browse should include direct pages")
      ow.test.assert(browse.suggested_next_reads.indexOf("guides/index.md") >= 0, true, "browse should suggest reading index")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testLintMissingIndex = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "section/page.md", "---\ntitle: Page\n---\n# Page")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var report = wm.lint()
      var missing = report.issues.filter(function(i) { return i.type === "missing_index" && i.page === "section/index.md" })
      ow.test.assert(missing.length >= 1, true, "folder with pages should require local index.md")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testLintIndexMissingLinks = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "section/index.md", "---\ntitle: Section\n---\n# Section")
      writePage(dir, "section/page.md", "---\ntitle: Page\n---\n# Page")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var report = wm.lint()
      var issues = report.issues.filter(function(i) { return i.type === "index_missing_links" && i.target === "section/page.md" })
      ow.test.assert(issues.length >= 1, true, "section index should link direct pages")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testBacklinksFindsReferences = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "index.md", "---\ntitle: Index\n---\nSee [setup](guides/setup.md).")
      writePage(dir, "guides/setup.md", "---\ntitle: Setup\n---\n# Setup")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var links = wm.backlinks("guides/setup.md")
      ow.test.assert(links.count, 1, "backlinks should count referring pages")
      ow.test.assert(links.backlinks[0].path, "index.md", "backlink should identify source page")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testMoveRewritesLinksAndPreservesCreated = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      wm.write("old.md", { title: "Old", created: "2024-01-01T00:00:00.000Z" }, "# Old\nSee [home](index.md).")
      wm.write("index.md", { title: "Index" }, "# Index\nSee [old](old.md) and [[old.md|Old page]].")
      var result = wm.move("old.md", "guides/new.md")
      ow.test.assert(result.ok, true, "move should succeed")
      ow.test.assert(wm.read("old.md"), __, "old page should be deleted by default")
      var moved = wm.read("guides/new.md")
      ow.test.assert(moved.meta.created, "2024-01-01T00:00:00.000Z", "move should preserve created metadata")
      ow.test.assert(moved.body.indexOf("../index.md") >= 0, true, "moved page relative links should be rebased")
      var index = wm.read("index.md")
      ow.test.assert(index.body.indexOf("guides/new.md") >= 0, true, "incoming links should point to new page")
      ow.test.assert(index.body.indexOf("[[old.md|Old page]]") < 0, true, "aliased wiki links should be rewritten on move")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testMoveRedirectStub = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      wm.write("old.md", { title: "Old" }, "# Old")
      var result = wm.move("old.md", "new.md", { leaveRedirect: true })
      ow.test.assert(result.ok, true, "move with redirect should succeed")
      ow.test.assert(result.redirect_created, true, "redirect stub should be reported")
      var old = wm.read("old.md")
      ow.test.assert(isObject(old), true, "old page should remain as stub")
      ow.test.assert(old.body.indexOf("new.md") >= 0, true, "stub should link to new page")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testInitCreatesSectionIndex = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      var result = wm.init("guides/")
      ow.test.assert(result.ok, true, "section init should succeed")
      ow.test.assert(result.created.indexOf("guides/index.md") >= 0, true, "section index should be created")
      ow.test.assert(isObject(wm.read("guides/index.md")), true, "section index should be readable")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testMcpWikiMetadataIncludesHierarchyTools = function() {
    var raw = io.readFileString("mcps/mcp-wiki.yaml")
    ow.test.assert(raw.indexOf("tree:") >= 0, true, "MCP metadata should expose tree")
    ow.test.assert(raw.indexOf("browse:") >= 0, true, "MCP metadata should expose browse")
    ow.test.assert(raw.indexOf("backlinks:") >= 0, true, "MCP metadata should expose backlinks")
    ow.test.assert(raw.indexOf("move:") >= 0, true, "MCP metadata should expose move")
    ow.test.assert(raw.indexOf("Wiki move page") >= 0, true, "MCP jobs should wire move")
  }

  exports.testMcpWikiSearchSchemasDescribeLexicalRetrieval = function() {
    var wiki = io.readFileString("mcps/mcp-wiki.yaml")
    var safe = io.readFileString("mcps/mcp-wiki-safe.yaml")
    var schemas = [wiki, safe]
    schemas.forEach(function(raw) {
      ow.test.assert(raw.indexOf("lexical keyword retrieval") >= 0, true, "search metadata should identify lexical retrieval")
      ow.test.assert(raw.indexOf("not semantic question answering") >= 0, true, "query metadata should reject semantic-QA expectations")
      ow.test.assert(raw.indexOf("Prefer exact terms, names, aliases, and short phrases") >= 0, true, "query metadata should guide keyword construction")
    })
    ow.test.assert(wiki.indexOf("graph-related pages may be appended as supplemental hints") >= 0, true, "normal wiki metadata should describe optional graph hints")
    ow.test.assert(safe.indexOf("graph-related pages may be returned only as opaque supplemental references") >= 0, true, "safe wiki metadata should describe opaque optional graph hints")
  }

  exports.testMcpWikiSafeIsRestrictedByDefaultWithExplicitOffEscape = function() {
    var mcpWiki = io.readFileString("mcps/mcp-wiki.yaml")
    ow.test.assert(mcpWiki.indexOf("wikirestrict") < 0, true, "mcp-wiki.yaml should no longer reference wikirestrict (moved to mcp-wiki-safe.yaml)")

    var safe = io.readFileString("mcps/mcp-wiki-safe.yaml")
    ow.test.assert(safe.indexOf("name   : mcp-wiki-safe") >= 0, true, "mcp-wiki-safe.yaml should identify itself as mcp-wiki-safe")
    ow.test.assert(safe.indexOf("args.wikirestrict = !restrictOff") >= 0, true, "mcp-wiki-safe.yaml must derive wikirestrict from the profile, not accept it directly as a caller-controlled arg")
    ow.test.assert(/wikirestrict\s*:/.test(safe), false, "mcp-wiki-safe.yaml must not declare wikirestrict as a check.in arg (only wikirestrictprofile=off can disable it)")
    ow.test.assert(safe.indexOf("usewikigraph") >= 0, true, "mcp-wiki-safe.yaml should document the explicit graph-hint opt-in")
    ow.test.assert(safe.indexOf("allowRestrictedGraphHints") >= 0, true, "mcp-wiki-safe.yaml should pass graph hints through only as an explicit restricted opt-in")
    ow.test.assert(safe.indexOf("Maximum results requested; safe-mode policy applies its lower configured cap.") >= 0, true, "mcp-wiki-safe.yaml should document the normal search arguments without weakening its result cap")
    ow.test.assert(safe.indexOf("Opaque reference returned by search, not a wiki page path.") >= 0, true, "mcp-wiki-safe.yaml should document read like mcp-wiki while retaining opaque references")
    ow.test.assert(safe.indexOf("countLines:") >= 0, true, "mcp-wiki-safe.yaml should advertise the compatible read arguments")
    ow.test.assert(safe.indexOf("context:") < 0, true, "mcp-wiki-safe.yaml should not expose context")
    ow.test.assert(safe.indexOf("browse:") < 0, true, "mcp-wiki-safe.yaml should not expose browse")
    ow.test.assert(safe.indexOf("tree:") < 0, true, "mcp-wiki-safe.yaml should not expose tree")
    ow.test.assert(safe.indexOf("backlinks:") < 0, true, "mcp-wiki-safe.yaml should not expose backlinks")
    ow.test.assert(safe.indexOf("list:") < 0, true, "mcp-wiki-safe.yaml should not expose list")

    ow.test.assert(safe.indexOf('wikirestrictprofile.trim().toLowerCase() === "off"') >= 0, true, "mcp-wiki-safe.yaml should recognize wikirestrictprofile=off as the sole opt-in escape hatch")
  }

  exports.testMcpWikiSafeOffProfileDisablesRestriction = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "secret-page.md", "---\ntitle: Target\ndescription: A useful answer\n---\n# Target\nThe distinctive answer is saffron-owl.\nSecond line.")

      // mirrors what mcp-wiki-safe.yaml's Init job computes when wikirestrictprofile=off
      // (String(dir): createTestDir() returns a java.lang.String, and isString() on that is false)
      var info = __miniAMcpWikiInit({ wikirestrict: false, wikiroot: String(dir) }, { access: "ro", readonly: true })
      ow.test.assert(info.restriction.enabled, false, "wikirestrict:false must leave restriction disabled")

      var searchResult = __miniAMcpWikiRestrictedSearch({ query: "saffron", limit: 20 })
      ow.test.assert(isArray(searchResult.results), true, "unrestricted search should return the plain wiki tool's shape")
      ow.test.assert(searchResult.results.length > 0, true, "unrestricted search should find the page")
      ow.test.assert(searchResult.results[0].path, "secret-page.md", "unrestricted search should expose the real path, not an opaque reference")

      var readResult = __miniAMcpWikiRestrictedRead({ path: "secret-page.md" })
      ow.test.assert(isString(readResult.body), true, "unrestricted read should return the plain wiki tool's shape")
      ow.test.assert(readResult.body.indexOf("saffron-owl") >= 0, true, "unrestricted read should return the full page body, not a bounded excerpt")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testMcpWikiRestrictedRetrieval = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "secret-page.md", "---\ntitle: Target\ndescription: A useful answer\n---\n# Target\nThe distinctive answer is saffron-owl.\nSecond line.")
      global.__wikiManager = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro", wikigraphsearchhints: false })
      global.__wikiTool = __miniAMcpWikiCreateTool({ root: dir, access: "ro" }, global.__wikiManager)
      global.__miniAMcpWiki = { restriction: new MiniAMcpWikiRestriction({ wikirestrict: true, wikirestrictminquerychars: 4, wikirestrictpagecooldown: 1 }, { backend: "fs", root: dir }) }
      var rejected = __miniAMcpWikiRestrictedSearch({ query: "*", limit: 20 })
      ow.test.assert(rejected.error, "restricted-query-rejected", "restricted search should reject broad queries")
      var result = __miniAMcpWikiRestrictedSearch({ query: "saffron", limit: 20, regex: true, path: "secret-page.md" })
      ow.test.assert(result.results.length, 1, "restricted search should return the targeted result")
      ow.test.assert(isUnDef(result.results[0].path), true, "restricted search must not disclose page paths")
      ow.test.assert(isString(result.results[0].reference), true, "restricted search should issue an opaque reference")
      var read = __miniAMcpWikiRestrictedRead({ path: result.results[0].reference })
      ow.test.assert(read.content.indexOf("saffron-owl") >= 0, true, "restricted read should return a bounded excerpt")
      ow.test.assert(isUnDef(read.path), true, "restricted read must not disclose page paths")
      var replay = __miniAMcpWikiRestrictedRead({ path: result.results[0].reference })
      ow.test.assert(replay.error, "invalid-or-expired-reference", "restricted references must be single-use")
      ow.test.assert(__miniAMcpWikiDenyRestricted("tree").error, "restricted-operation", "hidden operations must be denied at dispatch")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testMcpWikiRestrictedReadAcceptsReferenceAlias = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "secret-page.md", "---\ntitle: Target\ndescription: A useful answer\n---\n# Target\nThe distinctive answer is saffron-owl.\nSecond line.")
      global.__wikiManager = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro", wikigraphsearchhints: false })
      global.__wikiTool = __miniAMcpWikiCreateTool({ root: dir, access: "ro" }, global.__wikiManager)
      global.__miniAMcpWiki = { restriction: new MiniAMcpWikiRestriction({ wikirestrict: true, wikirestrictminquerychars: 4, wikirestrictpagecooldown: 1 }, { backend: "fs", root: dir }) }
      var result = __miniAMcpWikiRestrictedSearch({ query: "saffron", limit: 20, regex: true, path: "secret-page.md" })
      var ref = result.results[0].reference
      // Models without a native tool-calling schema only ever see the "reference"
      // field in search results, so they frequently call read with {"reference": ref}
      // instead of {"path": ref}. This must resolve the same as {"path": ref}.
      var read = __miniAMcpWikiRestrictedRead({ reference: ref })
      ow.test.assert(read.content.indexOf("saffron-owl") >= 0, true, "read should accept 'reference' as an alias for 'path'")
      ow.test.assert(isUnDef(read.error), true, "read via 'reference' alias should not error")
    } finally {
      cleanupTestDir(dir)
    }
  }


  var assertRestrictedPolicy = function(policy, expected, message) {
    for(var key in expected) {
      ow.test.assert(policy[key], expected[key], message + " should set " + key)
    }
  }

  exports.testMcpWikiRestrictedProfiles = function() {
    var tight = {
      searchLimit: 3, minQueryChars: 4, metaChars: 300, readLines: 40,
      readChars: 6000, refTtl: 120, maxSearches: 30, maxReads: 15,
      maxChars: 60000, window: 3600, pageCooldown: 3600
    }
    var moderate = {
      searchLimit: 5, minQueryChars: 3, metaChars: 600, readLines: 70,
      readChars: 10000, refTtl: 300, maxSearches: 60, maxReads: 30,
      maxChars: 150000, window: 3600, pageCooldown: 900
    }
    var relaxed = {
      searchLimit: 10, minQueryChars: 2, metaChars: 1200, readLines: 100,
      readChars: 16000, refTtl: 600, maxSearches: 120, maxReads: 60,
      maxChars: 400000, window: 3600, pageCooldown: 0
    }

    var implicit = new MiniAMcpWikiRestriction({ wikirestrict: true }, { backend: "fs", root: "." })
    ow.test.assert(implicit.profile, "tight", "omitted restricted profile should default to tight")
    assertRestrictedPolicy(implicit.policy, tight, "omitted restricted profile")

    var explicitTight = new MiniAMcpWikiRestriction({ wikirestrict: true, wikirestrictprofile: "tight" }, { backend: "fs", root: "." })
    ow.test.assert(explicitTight.profile, "tight", "explicit tight profile should remain tight")
    assertRestrictedPolicy(explicitTight.policy, tight, "explicit tight profile")

    var explicitModerate = new MiniAMcpWikiRestriction({ wikirestrict: true, wikirestrictprofile: "moderate" }, { backend: "fs", root: "." })
    ow.test.assert(explicitModerate.profile, "moderate", "moderate profile should be recorded")
    assertRestrictedPolicy(explicitModerate.policy, moderate, "moderate profile")

    var explicitRelaxed = new MiniAMcpWikiRestriction({ wikirestrict: true, wikirestrictprofile: "relaxed" }, { backend: "fs", root: "." })
    ow.test.assert(explicitRelaxed.profile, "relaxed", "relaxed profile should be recorded")
    assertRestrictedPolicy(explicitRelaxed.policy, relaxed, "relaxed profile")

    var mixedCase = new MiniAMcpWikiRestriction({ wikirestrict: true, wikirestrictprofile: "MODERATE" }, { backend: "fs", root: "." })
    ow.test.assert(mixedCase.profile, "moderate", "profile names should be case-insensitive")
    assertRestrictedPolicy(mixedCase.policy, moderate, "mixed-case moderate profile")

    var override = new MiniAMcpWikiRestriction({ wikirestrict: true, wikirestrictprofile: "moderate", wikirestrictreadlines: 90, wikirestrictmaxreads: 25 }, { backend: "fs", root: "." })
    ow.test.assert(override.profile, "moderate", "override should keep selected profile")
    ow.test.assert(override.policy.searchLimit, moderate.searchLimit, "override should preserve profile defaults for unspecified fields")
    ow.test.assert(override.policy.readLines, 90, "explicit read-lines override should win over profile default")
    ow.test.assert(override.policy.maxReads, 25, "explicit max-reads override should win over profile default")

    var falsyOverride = new MiniAMcpWikiRestriction({ wikirestrict: true, wikirestrictprofile: "moderate", wikirestrictpagecooldown: 0 }, { backend: "fs", root: "." })
    ow.test.assert(falsyOverride.policy.pageCooldown, 0, "explicit zero page cooldown should remain zero")

    var invalidThrown = false
    try { new MiniAMcpWikiRestriction({ wikirestrict: true, wikirestrictprofile: "foo" }, { backend: "fs", root: "." }) } catch(e) {
      invalidThrown = String(e).indexOf("Invalid wikirestrictprofile 'foo'. Expected one of: tight, moderate, relaxed.") >= 0
    }
    ow.test.assert(invalidThrown, true, "invalid profile should fail fast with a useful error")

    var ceilingThrown = false
    try { new MiniAMcpWikiRestriction({ wikirestrict: true, wikirestrictprofile: "relaxed", wikirestrictreadlines: 101 }, { backend: "fs", root: "." }) } catch(e) {
      ceilingThrown = String(e).indexOf("wikirestrictreadlines") >= 0
    }
    ow.test.assert(ceilingThrown, true, "explicit values above hard ceilings should still be rejected")
  }

  exports.testMcpWikiRestrictedBudgetAndConfig = function() {
    var r = new MiniAMcpWikiRestriction({ wikirestrict: true, wikirestrictmaxsearches: 1, wikirestrictmaxchars: 10 }, { backend: "fs", root: "." })
    ow.test.assert(r.charge("search", 5), true, "initial restricted charge should fit the budget")
    ow.test.assert(r.charge("search", 1), false, "restricted search budget should be cumulative")
    var denied = __miniAMcpWikiRestrictedBudgetError(r, "search", 0)
    ow.test.assert(denied.error, "restricted-budget-exhausted", "restricted budget errors should retain a stable code")
    ow.test.assert(denied.operation, "search", "restricted budget errors should identify the blocked operation")
    ow.test.assert(denied.budget, "searches", "restricted budget errors should identify the exhausted budget")
    ow.test.assert(denied.used, 1, "restricted budget errors should report current usage")
    ow.test.assert(denied.limit, 1, "restricted budget errors should report the configured limit")
    ow.test.assert(denied.windowSeconds, 3600, "restricted budget errors should report the budget window")
    ow.test.assert(denied.retryAfterSeconds > 0, true, "restricted budget errors should give retry guidance")
    ow.test.assert(denied.message.indexOf("avoid parallel fallback requests") >= 0, true, "restricted budget errors should discourage repeated fallback requests")
    var cfg = __miniAMcpWikiBuildConfig({ usewikigraph: true, wikigraphsearchhints: true, wikis3artifactprefix: "published-cache/", wikiartifactrefreshsecs: 300, wikilexical: "{ language: 'french', synonyms: [['velo', 'bicyclette']] }" }, { access: "ro" })
    ow.test.assert(cfg.wikigraphsearchhints, true, "default configuration must preserve graph search hints")
    ow.test.assert(cfg.s3artifactprefix, "published-cache/", "MCP configuration should pass the S3 artifact prefix to the wiki manager")
    ow.test.assert(cfg.wikiartifactrefreshsecs, 300, "MCP configuration should pass the artifact refresh interval to the wiki manager")
    ow.test.assert(cfg.wikilexical.indexOf("french") >= 0, true, "MCP configuration should pass lexical configuration to the wiki manager")
  }

  exports.testMcpWikiRestrictedGraphHintsAreOptInOpaqueReferences = function() {
    var dir = createTestDir()
    try {
      var base = { wikirestrict: true, wikiroot: dir, usewikigraph: false }
      var disabled = __miniAMcpWikiInit(base, { access: "ro", readonly: true, allowRestrictedGraphHints: false })
      ow.test.assert(disabled.config.wikigraphsearchhints, false, "restricted graph hints should remain disabled by default")

      var enabled = __miniAMcpWikiInit({ wikirestrict: true, wikiroot: dir, usewikigraph: true }, { access: "ro", readonly: true, allowRestrictedGraphHints: true })
      ow.test.assert(enabled.config.wikigraphsearchhints, true, "safe restricted graph hints should require the explicit opt-in")

      global.__wikiManager = {
        search: function() { return [
          { path: "answer.md", title: "Answer", description: "Direct match" },
          { path: "related-secret.md", title: "Related secret", description: "[Related pages (graph)] linked score=1 provenance=link - private digest" }
        ] }
      }
      global.__miniAMcpWiki = { restriction: new MiniAMcpWikiRestriction({ wikirestrict: true, wikirestrictminquerychars: 4, wikirestrictpagecooldown: 1 }, { backend: "fs", root: dir }) }
      var result = __miniAMcpWikiRestrictedSearch({ query: "answer" })
      ow.test.assert(result.results.length, 2, "opted-in graph hints should enrich restricted search")
      ow.test.assert(result.results[1].description, "Related page", "graph hints should not disclose graph relationship metadata")
      ow.test.assert(isString(result.results[1].reference), true, "graph hints should be exposed as opaque read references")
      ow.test.assert(isUnDef(result.results[1].path), true, "graph hints must not disclose their wiki paths")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testS3ArtifactsHydrateLocalSearchAndGraphCache = function() {
    var dir = createTestDir()
    try {
      var payloads = {
        "published/.mini-a-wiki-lucene/segments_1": "lucene-fixture",
        "published/.mini-a-wiki-graph/graph.json": "{\"version\":2}"
      }
      var fake = {
        _backendType: "s3",
        _config: { bucket: "wiki-bucket", s3artifactprefix: "published/", indexdir: dir },
        _getIndexRoot: function() { return dir },
        _backend: { client: {
          listObjects: function(bucket, prefix) {
            ow.test.assert(bucket, "wiki-bucket", "artifact hydration should use the configured bucket")
            ow.test.assert(prefix, "published/", "artifact hydration should use the configured prefix")
            return Object.keys(payloads).map(function(filename) { return { filename: filename } })
          },
          getObjectStream: function(bucket, key) { return af.fromString2InputStream(payloads[key]) }
        } },
        _logFn: function() {}
      }
      MiniAWikiManager.prototype._hydrateS3Artifacts.call(fake)
      ow.test.assert(io.readFileString(dir + "/.mini-a-wiki-lucene/segments_1"), "lucene-fixture", "Lucene artifact should be restored locally")
      ow.test.assert(io.readFileString(dir + "/.mini-a-wiki-graph/graph.json"), "{\"version\":2}", "graph artifact should be restored locally")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testMcpWikiRestrictedRefsAreSharedAcrossReplicasViaChannel = function() {
    var chDef = "(name: '_test_mcp_wiki_refs_" + genUUID().replace(/-/g, "") + "', type: 'simple')"
    var cfg = { backend: "fs", root: "." }
    var baseArgs = { wikirestrict: true, wikirestrictminquerychars: 1, wikirestrictpagecooldown: 3600, wikirestrictrefch: chDef }

    // Each instance below stands in for one Kubernetes replica: they share nothing
    // with each other except the channel, so any cross-instance success here can
    // only come from the channel actually carrying the state.
    var replicaA = new MiniAMcpWikiRestriction(baseArgs, cfg)
    var replicaB = new MiniAMcpWikiRestriction(baseArgs, cfg)
    var replicaC = new MiniAMcpWikiRestriction(baseArgs, cfg)

    var ref = replicaA.issue("shared-page.md")
    ow.test.assert(isString(ref), true, "replica A should issue a reference")

    var grant = replicaB.consume(ref)
    ow.test.assert(isMap(grant), true, "replica B should be able to consume a reference issued by replica A")
    ow.test.assert(grant.path, "shared-page.md", "consumed grant should carry the original path")

    ow.test.assert(isUnDef(replicaC.consume(ref)), true, "a reference already consumed on one replica must not be consumable again from another")

    ow.test.assert(isUnDef(replicaB.issue("shared-page.md")), true, "a page cooldown issued by replica A must block replica B from re-issuing a reference for the same page")
    ow.test.assert(isString(replicaC.issue("other-page.md")), true, "an unrelated page should still be issuable from any replica")
  }

  exports.testMcpWikiRestrictedRefChannelSweepsExpiredEntries = function() {
    var chName = "_test_mcp_wiki_sweep_" + genUUID().replace(/-/g, "")
    var r = new MiniAMcpWikiRestriction({ wikirestrict: true, wikirestrictrefch: "(name: '" + chName + "', type: 'simple')" }, { backend: "fs", root: "." })
    var ref = r.issue("expiring-page.md")
    ow.test.assert(isString(ref), true, "reference should be issued")

    // simulate the TTL having already elapsed and force an immediate sweep
    $ch(chName).set({ kind: "ref", ref: ref }, { path: "expiring-page.md", expires: Date.now() - 1000 })
    r._lastSweep = 0
    r._purge()

    ow.test.assert(isUnDef($ch(chName).get({ kind: "ref", ref: ref })), true, "an expired reference should be swept from the shared channel")
  }

  exports.testMcpWikiOpsMetadataIncludesOpsTools = function() {
    var raw = io.readFileString("mcps/mcp-wiki-ops.yaml")
    ow.test.assert(raw.indexOf("name   : mcp-wiki-ops") >= 0, true, "MCP ops server metadata should expose mcp-wiki-ops name")
    ow.test.assert(raw.indexOf("lint:") >= 0, true, "MCP ops metadata should expose lint")
    ow.test.assert(raw.indexOf("edit:") >= 0, true, "MCP ops metadata should expose edit")
    ow.test.assert(raw.indexOf("maintain:") >= 0, true, "MCP ops metadata should expose maintain")
    ow.test.assert(raw.indexOf("reindex:") >= 0, true, "MCP ops metadata should expose reindex")
    ow.test.assert(raw.indexOf("Wiki reindex") >= 0, true, "MCP ops jobs should wire reindex")
    ow.test.assert(raw.indexOf("Wiki maintain") >= 0, true, "MCP ops jobs should wire maintain")
  }

  // ── Delete ────────────────────────────────────────────────────────────────────

  exports.testFsBackendDelete = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      wm.write("todelete.md", { title: "Delete Me" }, "# Delete Me\nThis page will be deleted.")
      var exists1 = wm._backend.exists("todelete.md")
      ow.test.assert(exists1, true, "file should exist before delete")
      var result = wm.delete("todelete.md")
      ow.test.assert(result.ok, true, "delete should succeed")
      var exists2 = wm._backend.exists("todelete.md")
      ow.test.assert(exists2, false, "file should not exist after delete")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testFsBackendDeleteNonExistent = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      var result = wm.delete("nonexistent.md")
      ow.test.assert(result.ok, false, "delete of non-existent file should fail")
      ow.test.assert(isString(result.error), true, "error message should be provided")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testFsBackendDeleteReadOnly = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      wm.write("readonly.md", { title: "Read Only" }, "# Read Only")
      var wmRo = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro" })
      var result = wmRo.delete("readonly.md")
      ow.test.assert(result.ok, false, "delete in read-only mode should fail")
      ow.test.assert(result.error.indexOf("read-only") > -1, true, "error should mention read-only")
      var exists = wm._backend.exists("readonly.md")
      ow.test.assert(exists, true, "file should still exist after failed delete")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testFsBackendDeleteWithPath = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      wm.write("subdir/nested.md", { title: "Nested" }, "# Nested")
      var exists1 = wm._backend.exists("subdir/nested.md")
      ow.test.assert(exists1, true, "nested file should exist before delete")
      var result = wm.delete("subdir/nested.md")
      ow.test.assert(result.ok, true, "delete nested file should succeed")
      var exists2 = wm._backend.exists("subdir/nested.md")
      ow.test.assert(exists2, false, "nested file should not exist after delete")
    } finally {
      cleanupTestDir(dir)
    }
  }

  // ── Search enhancements ──────────────────────────────────────────────────────

  exports.testSearchReturnsLineNumbers = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      wm.write("page.md", { title: "Page" }, "# Page\n\nFirst line.\nSecond line.\nThird line.")
      var hits = wm.search("Second")
      ow.test.assert(hits.length > 0, true, "should find a hit")
      ow.test.assert(isNumber(hits[0].line), true, "result should have line number")
      ow.test.assert(hits[0].line > 0, true, "line number should be positive")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testSearchWithRegex = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      wm.write("page.md", { title: "Page" }, "# Page\n\nError code 404 returned.\nAll good.")
      var hits = wm.search("\\d+", { regex: true })
      ow.test.assert(hits.length > 0, true, "regex search should find digits")
      var noHits = wm.search("^ZZZZ$", { regex: true })
      ow.test.assert(noHits.length, 0, "regex with no match should return empty")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testSearchScopedToPath = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      wm.write("a.md", { title: "A" }, "# A\n\nTarget keyword here.")
      wm.write("b.md", { title: "B" }, "# B\n\nNothing relevant.")
      var hits = wm.search("Target", { path: "a.md" })
      ow.test.assert(hits.length > 0, true, "should find match in scoped page")
      ow.test.assert(hits[0].path, "a.md", "result should be from scoped page")
      var missHits = wm.search("Target", { path: "b.md" })
      ow.test.assert(missHits.length, 0, "scoped search should not find match in other page")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testSearchWithContextLines = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      wm.write("page.md", { title: "Page" }, "# Page\n\nLine one.\nLine two MATCH.\nLine three.")
      var hits = wm.search("MATCH", { contextLines: 1 })
      ow.test.assert(hits.length > 0, true, "should find match")
      ow.test.assert(isArray(hits[0].contextBefore), true, "should have contextBefore")
      ow.test.assert(isArray(hits[0].contextAfter), true, "should have contextAfter")
      ow.test.assert(hits[0].contextBefore.length > 0, true, "contextBefore should not be empty")
      ow.test.assert(hits[0].contextAfter.length > 0, true, "contextAfter should not be empty")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testSearchBodyOnlySkipsFrontmatter = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      wm.write("page.md", { title: "MySpecialTitle" }, "# Page\n\nBody content only.")
      var allHits  = wm.search("MySpecialTitle", { searchIn: "all" })
      var bodyHits = wm.search("MySpecialTitle", { searchIn: "body" })
      ow.test.assert(allHits.length > 0, true, "all search should find title in front-matter")
      ow.test.assert(bodyHits.length, 0, "body-only search should skip front-matter")
    } finally {
      cleanupTestDir(dir)
    }
  }

  // ── Read enhancements ─────────────────────────────────────────────────────────

  exports.testReadWithLineRange = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      wm.write("page.md", { title: "Page" }, "# Page\n\nLine A.\nLine B.\nLine C.\nLine D.")
      var full = wm.read("page.md")
      var totalLines = full.raw.split("\n").length
      var partial = wm.read("page.md", { lineStart: 1, lineEnd: 3 })
      ow.test.assert(isObject(partial), true, "partial read should return object")
      ow.test.assert(partial.linesTotal, totalLines, "linesTotal should match full file")
      ow.test.assert(partial.linesRead, 3, "linesRead should be 3")
      ow.test.assert(partial.lineStart, 1, "lineStart should be 1")
      ow.test.assert(partial.lineEnd, 3, "lineEnd should be 3")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testReadCountLines = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      wm.write("page.md", { title: "Page" }, "# Page\n\nLine one.\nLine two.")
      var full = wm.read("page.md")
      var totalLines = full.raw.split("\n").length
      var counted = wm.read("page.md", { countLines: true })
      ow.test.assert(isObject(counted), true, "countLines result should be object")
      ow.test.assert(counted.linesTotal, totalLines, "linesTotal should match full file line count")
      ow.test.assert(isUnDef(counted.body) || counted.body === __, true, "body should not be included in countLines result")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testReadSection = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      wm.write("page.md", { title: "Page" }, "# Page\n\n## Overview\n\nOverview content here.\n\n## Details\n\nDetail content here.")
      var section = wm.read("page.md", { section: "Overview" })
      ow.test.assert(isObject(section), true, "section read should return object")
      ow.test.assert(section.body.indexOf("Overview content") >= 0, true, "should contain section content")
      ow.test.assert(section.body.indexOf("Detail content") >= 0, false, "should not contain next section")
      ow.test.assert(section.linesRead > 0, true, "linesRead should be positive")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testReadMaxLines = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      wm.write("page.md", { title: "Page" }, "# Page\n\nA.\nB.\nC.\nD.\nE.")
      var partial = wm.read("page.md", { lineStart: 1, maxLines: 2 })
      ow.test.assert(partial.linesRead, 2, "maxLines should limit lines read")
      ow.test.assert(partial.lineEnd - partial.lineStart, 1, "lineEnd - lineStart should equal maxLines - 1")
    } finally {
      cleanupTestDir(dir)
    }
  }

  // ── Write enhancements ────────────────────────────────────────────────────────

  exports.testWriteAppend = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      wm.write("page.md", { title: "Page" }, "# Page\n\nOriginal content.")
      var result = wm.write("page.md", "Appended content.", __, { append: true })
      ow.test.assert(result.ok, true, "append should succeed")
      var page = wm.read("page.md")
      ow.test.assert(page.body.indexOf("Original content") >= 0, true, "original content should be preserved")
      ow.test.assert(page.body.indexOf("Appended content") >= 0, true, "appended content should be present")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testWriteLineInsert = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      wm.write("page.md", { title: "Page" }, "# Page\n\nLine A.\nLine C.")
      var full = wm.read("page.md")
      var lineCount = full.raw.split("\n").length
      var result = wm.write("page.md", "Line B.", __, { lineInsert: lineCount - 1 })
      ow.test.assert(result.ok, true, "lineInsert should succeed")
      var page = wm.read("page.md")
      var bodyLines = page.body.split("\n").filter(function(l) { return l.trim().length > 0 })
      var aIdx = bodyLines.indexOf("Line A.")
      var bIdx = bodyLines.indexOf("Line B.")
      var cIdx = bodyLines.indexOf("Line C.")
      ow.test.assert(aIdx >= 0, true, "Line A should exist")
      ow.test.assert(bIdx >= 0, true, "Line B should exist after insert")
      ow.test.assert(cIdx >= 0, true, "Line C should exist")
      ow.test.assert(bIdx < cIdx, true, "Line B should appear before Line C")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testWriteReplaceLineRange = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      wm.write("page.md", { title: "Page" }, "# Page\n\nKeep this.\nOld line.\nAlso keep.")
      var full = wm.read("page.md")
      var lines = full.raw.split("\n")
      var oldLineIdx = -1
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].indexOf("Old line") >= 0) { oldLineIdx = i + 1; break }
      }
      ow.test.assert(oldLineIdx > 0, true, "should find old line")
      var result = wm.write("page.md", "New line.", __, { lineStart: oldLineIdx, lineEnd: oldLineIdx })
      ow.test.assert(result.ok, true, "replace range should succeed")
      var page = wm.read("page.md")
      ow.test.assert(page.body.indexOf("Old line") >= 0, false, "old line should be gone")
      ow.test.assert(page.body.indexOf("New line") >= 0, true, "new line should be present")
      ow.test.assert(page.body.indexOf("Keep this") >= 0, true, "other content should be preserved")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testWriteSection = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      wm.write("page.md", { title: "Page" }, "# Page\n\n## Overview\n\nOld overview text.\n\n## Details\n\nDetail text.")
      var result = wm.write("page.md", "\nNew overview text.", __, { section: "Overview" })
      ow.test.assert(result.ok, true, "section write should succeed")
      var page = wm.read("page.md")
      ow.test.assert(page.body.indexOf("Old overview text") >= 0, false, "old section content should be gone")
      ow.test.assert(page.body.indexOf("New overview text") >= 0, true, "new section content should be present")
      ow.test.assert(page.body.indexOf("## Overview") >= 0, true, "section heading should be preserved")
      ow.test.assert(page.body.indexOf("## Details") >= 0, true, "other section should be preserved")
      ow.test.assert(page.body.indexOf("Detail text") >= 0, true, "other section content should be preserved")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testWriteSectionNotFound = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      wm.write("page.md", { title: "Page" }, "# Page\n\n## Overview\n\nContent.")
      var result = wm.write("page.md", "replacement", __, { section: "Nonexistent Section" })
      ow.test.assert(result.ok, false, "write to nonexistent section should fail")
      ow.test.assert(isString(result.error), true, "should return error message")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testWritePartialModesRequireExistingPage = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      var result = wm.write("nonexistent.md", "content", __, { append: true })
      ow.test.assert(result.ok, false, "append to nonexistent page should fail")
    } finally {
      cleanupTestDir(dir)
    }
  }

  // ── New v2 features ──────────────────────────────────────────────────────────

  exports.testBootstrapCreatesLogMd = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      ow.test.assert(io.fileExists(dir + "/log.md"), true, "bootstrap should create log.md")
      var logRaw = io.readFileString(dir + "/log.md")
      ow.test.assert(logRaw.indexOf("Wiki Log") >= 0, true, "log.md should contain 'Wiki Log' heading")
    } finally { cleanupTestDir(dir) }
  }

  exports.testBootstrapAgentsMdV2HasManagedMarkers = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      var raw = io.readFileString(dir + "/AGENTS.md")
      ow.test.assert(raw.indexOf("mini-a:agents managed:start") >= 0, true, "AGENTS.md should have managed:start marker")
      ow.test.assert(raw.indexOf("mini-a:agents managed:end") >= 0, true, "AGENTS.md should have managed:end marker")
      ow.test.assert(raw.indexOf("agentsVersion: " + __MINI_A_WIKI_AGENTS_VERSION) >= 0, true, "AGENTS.md frontmatter should carry the current agentsVersion")
      ow.test.assert(raw.indexOf("## Quick start") >= 0, true, "AGENTS.md should have Quick start section")
    } finally { cleanupTestDir(dir) }
  }

  exports.testUpgradeAgentsNoopWhenCurrent = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      var result = wm.upgradeAgents()
      ow.test.assert(result.ok, true, "upgradeAgents should return ok")
      ow.test.assert(result.action, "noop", "already v2 should be noop")
      ow.test.assert(result.agentsVersion, __MINI_A_WIKI_AGENTS_VERSION, "agentsVersion should be the current version")
    } finally { cleanupTestDir(dir) }
  }

  exports.testUpgradeAgentsWholesaleReplacesStockV1 = function() {
    var dir = createTestDir()
    try {
      // Write a synthetic v1 AGENTS.md (no markers, contains v1 stock phrase)
      var v1Content = "---\ntitle: Wiki Contribution Guidelines\ndescription: desc.\ncreated: 2024-01-01T00:00:00.000Z\nupdated: 2024-01-01T00:00:00.000Z\n---\n\n# Wiki Contribution Guidelines\n\nThis file defines how agents should read, distil, and contribute knowledge to this wiki.\nAll agents that use this wiki **must** read this file before performing any write operation.\n"
      io.writeFileString(dir + "/AGENTS.md", v1Content)
      io.writeFileString(dir + "/index.md", "---\ntitle: x\n---\n# x")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      var result = wm.upgradeAgents()
      ow.test.assert(result.ok, true, "upgradeAgents v1→v2 should succeed")
      ow.test.assert(result.action, "upgraded", "action should be upgraded")
      var newRaw = io.readFileString(dir + "/AGENTS.md")
      ow.test.assert(newRaw.indexOf("mini-a:agents managed:start") >= 0, true, "upgraded AGENTS.md should have markers")
      ow.test.assert(newRaw.indexOf("agentsVersion: " + __MINI_A_WIKI_AGENTS_VERSION) >= 0, true, "upgraded AGENTS.md should carry the current agentsVersion")
      // Should NOT have the v1 stock phrase still active (wholesale replaced)
      ow.test.assert(newRaw.indexOf("This file defines how agents") < 0, true, "v1 stock phrase should be gone after wholesale replace")
    } finally { cleanupTestDir(dir) }
  }

  exports.testUpgradeAgentsPreservesUserEdits = function() {
    var dir = createTestDir()
    try {
      // Write a marker-less AGENTS.md that differs from v1 stock — user-edited
      var userContent = "---\ntitle: Wiki Contribution Guidelines\ndescription: desc.\ncreated: 2024-01-01T00:00:00.000Z\nupdated: 2024-01-01T00:00:00.000Z\n---\n\n# My Custom Rules\n\nWe do things differently here.\n"
      io.writeFileString(dir + "/AGENTS.md", userContent)
      io.writeFileString(dir + "/index.md", "---\ntitle: x\n---\n# x")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      var result = wm.upgradeAgents()
      ow.test.assert(result.ok, true, "upgradeAgents user-edited should succeed")
      ow.test.assert(result.action, "preserved", "action should be preserved")
      var newRaw = io.readFileString(dir + "/AGENTS.md")
      ow.test.assert(newRaw.indexOf("My Custom Rules") >= 0, true, "user content should be preserved")
      ow.test.assert(newRaw.indexOf("mini-a:agents managed:start") >= 0, true, "managed block should be prepended")
    } finally { cleanupTestDir(dir) }
  }

  exports.testAppendLogWritesToLogMd = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      wm.appendLog("write", "Test Page", "test.md")
      var logRaw = io.readFileString(dir + "/log.md")
      ow.test.assert(logRaw.indexOf("write | Test Page — test.md") >= 0, true, "log entry should appear in log.md")
    } finally { cleanupTestDir(dir) }
  }

  exports.testWriteContentPageAppendsToLog = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      wm.write("concepts/foo.md", { title: "Foo", description: "foo page" }, "# Foo\nContent here.")
      var logRaw = io.readFileString(dir + "/log.md")
      ow.test.assert(logRaw.indexOf("foo.md") >= 0, true, "write to content page should append to log.md")
    } finally { cleanupTestDir(dir) }
  }

  exports.testWriteToIndexMdDoesNotAppendToLog = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      var logBefore = io.readFileString(dir + "/log.md")
      wm.write("index.md", { title: "Home", description: "home" }, "# Home")
      var logAfter = io.readFileString(dir + "/log.md")
      ow.test.assert(logBefore, logAfter, "writing index.md should not change log.md")
    } finally { cleanupTestDir(dir) }
  }

  exports.testLogMdExemptFromLintOrphan = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      var result = wm.lint()
      var orphanIssues = result.issues.filter(function(i) { return i.type === "orphan" && i.page === "log.md" })
      ow.test.assert(orphanIssues.length, 0, "log.md should not appear as orphan in lint")
    } finally { cleanupTestDir(dir) }
  }

  exports.testContextOpReturnsSummary = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      writePage(dir, "concepts/foo.md", "---\ntitle: Foo\n---\n# Foo")
      var ctx = wm.context()
      ow.test.assert(isObject(ctx), true, "context should return an object")
      ow.test.assert(isNumber(ctx.pages), true, "context.pages should be a number")
      ow.test.assert(isArray(ctx.sections), true, "context.sections should be an array")
      ow.test.assert(ctx.sections.indexOf("concepts/") >= 0, true, "context.sections should include concepts/")
      ow.test.assert(isArray(ctx.mounts), true, "context.mounts should be an array")
      ow.test.assert(isString(ctx.hint), true, "context.hint should be a string")
    } finally { cleanupTestDir(dir) }
  }

  exports.testListWithMeta = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      writePage(dir, "foo.md", "---\ntitle: Foo Page\ndescription: A foo.\ntype: concept\n---\n# Foo")
      var pages = wm.list("", { withMeta: true })
      ow.test.assert(isArray(pages), true, "list withMeta should return array")
      var fooEntry = pages.filter(function(p) { return p.path === "foo.md" })[0]
      ow.test.assert(isDef(fooEntry), true, "foo.md should appear in withMeta list")
      ow.test.assert(fooEntry.title, "Foo Page", "title should be parsed")
      ow.test.assert(fooEntry.description, "A foo.", "description should be parsed")
      ow.test.assert(fooEntry.type, "concept", "type should be parsed")
    } finally { cleanupTestDir(dir) }
  }

  exports.testSearchCompactByDefault = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      writePage(dir, "bar.md", "---\ntitle: Bar\ndescription: A bar.\n---\n# Bar\nHello world search term here.")
      var hits = wm.search("hello world", { forceScan: true })
      ow.test.assert(isArray(hits), true, "search should return array")
      ow.test.assert(hits.length > 0, true, "search should find bar.md")
      var hit = hits[0]
      ow.test.assert(isDef(hit.path), true, "compact hit should have path")
      ow.test.assert(isDef(hit.title), true, "compact hit should have title")
      ow.test.assert(isDef(hit.description), true, "compact hit should have description")
      ow.test.assert(isUnDef(hit.snippet), true, "compact hit should NOT have snippet")
    } finally { cleanupTestDir(dir) }
  }

  exports.testSearchWithContextLinesReturnsSnippets = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      writePage(dir, "baz.md", "---\ntitle: Baz\n---\n# Baz\nHello world here.")
      var hits = wm.search("hello world", { forceScan: true, contextLines: 1 })
      ow.test.assert(hits.length > 0, true, "search with contextLines should find results")
      ow.test.assert(isDef(hits[0].snippet), true, "contextLines hit should have snippet")
    } finally { cleanupTestDir(dir) }
  }

  exports.testMountWriteRejected = function() {
    var dir1 = createTestDir(), dir2 = createTestDir()
    try {
      var primary = new MiniAWikiManager({ backend: "fs", root: dir1, access: "rw" })
      var secondary = new MiniAWikiManager({ backend: "fs", root: dir2, access: "rw" })
      writePage(dir2, "mounted.md", "---\ntitle: Mounted\n---\n# Mounted")
      primary.attach("team", { backend: "fs", root: dir2 })
      var result = primary.write("@team/foo.md", { title: "Foo" }, "# Foo")
      ow.test.assert(result.ok, false, "write to @mount/ path should fail")
      ow.test.assert(isString(result.error), true, "write failure should have error message")
    } finally { cleanupTestDir(dir1); cleanupTestDir(dir2) }
  }

  exports.testMountReadRouted = function() {
    var dir1 = createTestDir(), dir2 = createTestDir()
    try {
      writePage(dir2, "mounted.md", "---\ntitle: From Mount\ndescription: mounted page\n---\n# From Mount")
      var primary = new MiniAWikiManager({ backend: "fs", root: dir1, access: "rw" })
      primary.attach("team", { backend: "fs", root: dir2 })
      var page = primary.read("@team/mounted.md")
      ow.test.assert(isObject(page), true, "@team/mounted.md should be readable via mount")
      ow.test.assert(page.meta.title, "From Mount", "mounted page title should be read")
    } finally { cleanupTestDir(dir1); cleanupTestDir(dir2) }
  }

  exports.testArchiveMountFederatesAndStaysReadOnly = function() {
    var dir = createTestDir()
    try {
      var archive = createArchiveWiki(dir, ".zip")
      var primary = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      var attached = primary.attach("reference", { backend: "fs", root: archive, access: "rw" })
      ow.test.assert(attached.ok, true, "archive mount should attach")
      ow.test.assert(primary.read("@reference/guides/setup.md").meta.title, "Archive Setup", "archive mount should route reads")
      var hits = primary.search("archive-nested-keyword", { forceScan: true })
      ow.test.assert(hits.some(function(hit) { return hit.path === "@reference/guides/setup.md" }), true, "archive mount should join search")
      ow.test.assert(primary.tree("@reference/", 2).sections[0].path, "guides/", "archive mount should build tree")
      ow.test.assert(primary.browse("@reference/guides").nearest_index.exists, true, "archive mount should browse")
      ow.test.assert(primary.graph("neighbors", { path: "@reference/overview.md" }).length, 1, "archive mount should load graph state")
      var graphHints = primary.search("archive-root-keyword", { forceScan: true })
      ow.test.assert(graphHints.some(function(hit) { return hit.path === "@reference/guides/setup.md" && String(hit.description).indexOf("[Related pages (graph @reference)]") === 0 }), true, "archive mount graph should add search hints")
      ow.test.assert(primary.write("@reference/new.md", { title: "New" }, "# New").ok, false, "archive mount should reject writes")
    } finally { cleanupTestDir(dir) }
  }

  exports.testMountSearchFanout = function() {
    var dir1 = createTestDir(), dir2 = createTestDir()
    try {
      writePage(dir1, "primary.md", "---\ntitle: Primary Page\ndescription: primary\n---\n# Primary\nunique-primary-keyword")
      writePage(dir2, "mounted.md", "---\ntitle: Mounted Page\ndescription: mounted\n---\n# Mounted\nunique-mounted-keyword")
      var primary = new MiniAWikiManager({ backend: "fs", root: dir1, access: "rw" })
      primary.attach("ext", { backend: "fs", root: dir2 })
      var hits = primary.search("unique-mounted-keyword", { forceScan: true })
      ow.test.assert(isArray(hits), true, "search should return array")
      var mountedHit = hits.filter(function(h) { return String(h.path).startsWith("@ext/") })[0]
      ow.test.assert(isDef(mountedHit), true, "mounted page should appear in federated search with @ext/ prefix")
    } finally { cleanupTestDir(dir1); cleanupTestDir(dir2) }
  }

  // ── Scan budget / read cache / gated parallel scan ────────────────────────────

  exports.testSearchScanBudgetCountCutoff = function() {
    var dir = createTestDir()
    try {
      for (var i = 1; i <= 10; i++) {
        var n = i < 10 ? "0" + i : String(i)
        writePage(dir, "n" + n + ".md", "---\ntitle: N" + i + "\n---\nNothing relevant here.")
      }
      writePage(dir, "zzzmatch.md", "---\ntitle: Match\n---\nbudget-cutoff-keyword")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, wikisearchscanbudget: 3 })
      var hits = wm.search("budget-cutoff-keyword", { forceScan: true })
      ow.test.assert(hits.length, 0, "matching page sorts after the budget so it should not be reached")
      ow.test.assert(hits.truncated, true, "result should be marked truncated")
      ow.test.assert(hits.scanned, 3, "should have scanned exactly the budgeted number of pages")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testSearchScanBudgetTimeCutoff = function() {
    var dir = createTestDir()
    try {
      for (var i = 1; i <= 50; i++) {
        var n = i < 10 ? "0" + i : String(i)
        writePage(dir, "p" + n + ".md", "---\ntitle: P" + i + "\n---\nNothing relevant here.")
      }
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, wikisearchscanmaxms: 1 })
      var hits = wm.search("zzznomatchzzz", { forceScan: true })
      ow.test.assert(hits.length, 0, "no matches expected")
      ow.test.assert(hits.truncated, true, "result should be marked truncated by the time budget")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testSearchCacheAvoidsRepeatedBackendRead = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "cachetest.md", "---\ntitle: Cache\n---\ncache-avoid-keyword")
      // wikisearchcache defaults on only for s3/http/es; force it on here to exercise
      // the cache mechanism itself regardless of that fs-specific default
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, wikisearchcache: true })
      var calls = 0
      var orig = wm._backend.read
      wm._backend.read = function(p) { calls++; return orig(p) }
      var hits1 = wm.search("cache-avoid-keyword", { forceScan: true })
      ow.test.assert(hits1.length > 0, true, "first search should find the page")
      var callsAfterFirst = calls
      ow.test.assert(callsAfterFirst > 0, true, "first search should have read the backend")
      var hits2 = wm.search("cache-avoid-keyword", { forceScan: true })
      ow.test.assert(hits2.length > 0, true, "second search should still find the page")
      ow.test.assert(calls, callsAfterFirst, "second search within the TTL window should not re-read the backend")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testSearchCacheInvalidatedOnWrite = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw", wikisearchcache: true })
      wm.write("page.md", { title: "Page" }, "# Page\noriginal-content-keyword")
      var hits1 = wm.search("original-content-keyword", { forceScan: true, path: "page.md" })
      ow.test.assert(hits1.length > 0, true, "should find original content")
      wm.write("page.md", { title: "Page" }, "# Page\nupdated-content-keyword")
      var hits2 = wm.search("updated-content-keyword", { forceScan: true, path: "page.md" })
      ow.test.assert(hits2.length > 0, true, "should find updated content right after write, not a stale cached read")
      var staleHits = wm.search("original-content-keyword", { forceScan: true, path: "page.md" })
      ow.test.assert(staleHits.length, 0, "old content should no longer match after write")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testSearchCacheInvalidatedOnDelete = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw", wikisearchcache: true })
      wm.write("page.md", { title: "Page" }, "# Page\ndelete-me-keyword")
      var hits1 = wm.search("delete-me-keyword", { forceScan: true, path: "page.md" })
      ow.test.assert(hits1.length > 0, true, "should find the page before delete (also populates the read cache)")
      wm.delete("page.md")
      var hits2 = wm.search("delete-me-keyword", { forceScan: true, path: "page.md" })
      ow.test.assert(hits2.length, 0, "should not find stale cached content after delete")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testMountSearchFanoutSharesBudget = function() {
    var dir1 = createTestDir(), dir2 = createTestDir()
    try {
      for (var i = 1; i <= 5; i++) writePage(dir1, "a" + i + ".md", "---\ntitle: A" + i + "\n---\nnothing relevant")
      for (var j = 1; j <= 5; j++) writePage(dir2, "b" + j + ".md", "---\ntitle: B" + j + "\n---\nnothing relevant")
      var primary = new MiniAWikiManager({ backend: "fs", root: dir1, access: "rw", wikisearchscanbudget: 3 })
      primary.attach("ext", { backend: "fs", root: dir2 })
      var hits = primary.search("zzznomatchzzz", { forceScan: true })
      ow.test.assert(hits.length, 0, "no matches expected")
      ow.test.assert(hits.truncated, true, "combined scan should be marked truncated")
      ow.test.assert(hits.scanned, 3, "budget should be exhausted by the primary scan alone, none left for the mount")
    } finally { cleanupTestDir(dir1); cleanupTestDir(dir2) }
  }

  exports.testSearchParallelMatchesSequentialResults = function() {
    var dir = createTestDir()
    try {
      for (var i = 1; i <= 20; i++) {
        var n = i < 10 ? "0" + i : String(i)
        var content = (i % 3 === 0)
          ? "---\ntitle: Page" + i + "\n---\nParallel Match Keyword line " + i + "\nSecond match keyword line " + i
          : "---\ntitle: Page" + i + "\n---\nNothing relevant here " + i
        writePage(dir, "p" + n + ".md", content)
      }
      var wmSeq = new MiniAWikiManager({ backend: "fs", root: dir, wikisearchparallel: false })
      var wmPar = new MiniAWikiManager({ backend: "fs", root: dir, wikisearchparallel: true })

      var seqCompact = wmSeq.search("keyword", { forceScan: true, caseSensitive: false, limit: 100 })
      var parCompact = wmPar.search("keyword", { forceScan: true, caseSensitive: false, limit: 100 })
      ow.test.assert(parCompact.length > 0, true, "parallel compact search should find matches")
      ow.test.assert(parCompact, seqCompact, "compact parallel results should exactly match sequential results")

      var seqSnippets = wmSeq.search("keyword", { forceScan: true, caseSensitive: false, contextLines: 2, limit: 100 })
      var parSnippets = wmPar.search("keyword", { forceScan: true, caseSensitive: false, contextLines: 2, limit: 100 })
      ow.test.assert(parSnippets.length > 0, true, "parallel snippet search should find matches")
      ow.test.assert(parSnippets, seqSnippets, "snippet parallel results should exactly match sequential results")
    } finally {
      cleanupTestDir(dir)
    }
  }

  exports.testAtPrefixRejectedByNormalizePath = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      var result = wm.write("@team/foo.md", { title: "Foo" }, "# Foo")
      ow.test.assert(result.ok, false, "@-prefixed primary paths should be rejected")
    } finally { cleanupTestDir(dir) }
  }

  exports.testDetachRemovesMount = function() {
    var dir1 = createTestDir(), dir2 = createTestDir()
    try {
      var primary = new MiniAWikiManager({ backend: "fs", root: dir1, access: "rw" })
      primary.attach("team", { backend: "fs", root: dir2 })
      ow.test.assert(primary.mounts().length, 1, "should have 1 mount after attach")
      primary.detach("team")
      ow.test.assert(primary.mounts().length, 0, "should have 0 mounts after detach")
      var result = primary.read("@team/anything.md")
      ow.test.assert(isUnDef(result), true, "read on detached mount should return undefined")
    } finally { cleanupTestDir(dir1); cleanupTestDir(dir2) }
  }

  // ── Drift guard ──────────────────────────────────────────────────────────────

  exports.testDriftGuard = function() {
    // Extract invariant core from each file: the AGENTS.md managed block content minus the "Operations" section
    var fs = java.nio.file.Files
    var stripOpsSection = function(text) {
      // Remove the "## Operations in this surface" section (legitimately differs per surface)
      return text.replace(/## Operations in this surface[\s\S]*?(?=## Page schema|## Ingestion|## Retrieval|$)/, "")
    }
    var extractManagedBlock = function(text) {
      var start = text.indexOf("<!-- mini-a:agents managed:start")
      var end   = text.indexOf("<!-- mini-a:agents managed:end -->")
      if (start < 0 || end < 0 || end <= start) return null
      return text.substring(start, end + "<!-- mini-a:agents managed:end -->".length)
    }
    var normalize = function(text) {
      return text.replace(/created: \d{4}-\d{2}-\d{2}T.*?Z/g, "TIMESTAMP")
               .replace(/updated: \d{4}-\d{2}-\d{2}T.*?Z/g, "TIMESTAMP")
               .replace(/agentsVersion: \d+/g, "AGENTSVER")
               .replace(/\r\n/g, "\n").trim()
    }

    // Extract the template from each source
    var wikiJs    = io.readFileString("mini-a-wiki.js")
    var mcpWiki   = io.readFileString("mcps/mcp-wiki.yaml")
    var mcpOps    = io.readFileString("mcps/mcp-wiki-ops.yaml")

    // Get managed blocks from each (using the template helper output)
    var wm = new MiniAWikiManager({ backend: "fs", root: ".", access: "ro" })
    var tplText   = __miniAWikiAgentsTemplate("2000-01-01T00:00:00.000Z")
    var managed   = extractManagedBlock(tplText)
    ow.test.assert(isDef(managed), true, "AGENTS.md template should contain managed block")

    // Verify managed block exists and contains invariant sections
    var stripped = stripOpsSection(managed)
    ow.test.assert(stripped.indexOf("## Quick start") >= 0, true, "managed block should have Quick start")
    ow.test.assert(stripped.indexOf("## Page schema") >= 0, true, "managed block should have Page schema")
    ow.test.assert(stripped.indexOf("## Writing style") >= 0, true, "managed block should have Writing style")
    ow.test.assert(stripped.indexOf("## Ingestion workflow") >= 0, true, "managed block should have Ingestion workflow")

    // Verify __miniAWikiAgentsTemplate is defined consistently in all three files
    ow.test.assert(wikiJs.indexOf("__miniAWikiAgentsTemplate") >= 0,  true, "mini-a-wiki.js should define __miniAWikiAgentsTemplate")
    ow.test.assert(mcpWiki.indexOf("__miniAWikiAgentsTemplate") >= 0, true, "mcp-wiki.yaml should define __miniAWikiAgentsTemplate")
    ow.test.assert(mcpOps.indexOf("__miniAWikiAgentsTemplate") >= 0,  true, "mcp-wiki-ops.yaml should define __miniAWikiAgentsTemplate")
    ow.test.assert(wikiJs.indexOf("__miniAWikiLogTemplate") >= 0,  true, "mini-a-wiki.js should define __miniAWikiLogTemplate")
    ow.test.assert(mcpWiki.indexOf("__miniAWikiLogTemplate") >= 0, true, "mcp-wiki.yaml should define __miniAWikiLogTemplate")
    ow.test.assert(mcpOps.indexOf("__miniAWikiLogTemplate") >= 0,  true, "mcp-wiki-ops.yaml should define __miniAWikiLogTemplate")
    // Verify all three share the v1 stock phrase constant (used for migration detection)
    ow.test.assert(wikiJs.indexOf("__MINI_A_WIKI_V1_STOCK_PHRASE") >= 0,  true, "mini-a-wiki.js should define V1_STOCK_PHRASE")
    ow.test.assert(mcpWiki.indexOf("__MINI_A_WIKI_V1_STOCK_PHRASE") >= 0, true, "mcp-wiki.yaml should define V1_STOCK_PHRASE")
    ow.test.assert(mcpOps.indexOf("__MINI_A_WIKI_V1_STOCK_PHRASE") >= 0,  true, "mcp-wiki-ops.yaml should define V1_STOCK_PHRASE")
  }

  // ── OKF compatibility ─────────────────────────────────────────────────────────

  exports.testTypeAutoFilledOnWrite = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      wm.write("foo.md", { title: "Foo", description: "A foo." }, "# Foo")
      var page = wm.read("foo.md")
      ow.test.assert(page.meta.type, "concept", "type should be auto-filled to concept")
    } finally { cleanupTestDir(dir) }
  }

  exports.testMissingTypeLintInfo = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      writePage(dir, "notype.md", "---\ntitle: No Type\ndescription: desc\n---\n# No Type")
      writePage(dir, "sec/index.md", "---\ntitle: Sec Index\ndescription: desc\n---\n# Sec")
      var result = wm.lint()
      var typeIssues = result.issues.filter(function(i) { return i.type === "missing_frontmatter" && i.field === "type" })
      var notypeIssue = typeIssues.filter(function(i) { return i.page === "notype.md" })
      ow.test.assert(notypeIssue.length, 1, "notype.md should report missing type info")
      ow.test.assert(notypeIssue[0].severity, "info", "missing type should be info severity")
      var indexIssue = typeIssues.filter(function(i) { return i.page === "sec/index.md" })
      ow.test.assert(indexIssue.length, 0, "section index.md should not report missing type")
    } finally { cleanupTestDir(dir) }
  }

  exports.testRootedLinkResolvesAndLints = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      writePage(dir, "tables/customers.md", "---\ntitle: Customers\ndescription: desc\ntype: concept\n---\n# Customers")
      wm.write("foo.md", { title: "Foo", description: "desc" }, "See [c](/tables/customers.md)")
      var page = wm.read("foo.md")
      ow.test.assert(page.links.indexOf("tables/customers.md") >= 0, true, "rooted link should resolve to tables/customers.md")
      var result = wm.lint()
      var broken = result.issues.filter(function(i) { return i.type === "broken_link" && i.page === "foo.md" })
      ow.test.assert(broken.length, 0, "rooted link to existing page should not be broken_link")
    } finally { cleanupTestDir(dir) }
  }

  exports.testTimestampReadAlias = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      writePage(dir, "ts.md", "---\ntitle: Ts\ndescription: desc\ntype: concept\ntimestamp: 2024-01-02T03:04:05.000Z\n---\n# Ts")
      var page = wm.read("ts.md")
      ow.test.assert(isDef(page.meta.updated), true, "updated should be set from timestamp alias")
      ow.test.assert(new Date(String(page.meta.updated)).getTime(), new Date("2024-01-02T03:04:05.000Z").getTime(), "timestamp should be aliased as updated when updated is absent")
    } finally { cleanupTestDir(dir) }
  }

  exports.testTimestampWriteEmit = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      wm.write("foo.md", { title: "Foo", description: "desc" }, "# Foo")
      var page = wm.read("foo.md")
      ow.test.assert(isDef(page.meta.timestamp), true, "timestamp should be emitted on write")
      ow.test.assert(String(page.meta.timestamp), String(page.meta.updated), "timestamp should equal updated")
    } finally { cleanupTestDir(dir) }
  }

  exports.testMovePreservesRootedLinks = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      writePage(dir, "tables/customers.md", "---\ntitle: Customers\ndescription: desc\ntype: concept\n---\n# Customers")
      wm.write("foo.md", { title: "Foo", description: "desc" }, "See [c](/tables/customers.md)")
      writePage(dir, "other.md", "---\ntitle: Other\ndescription: desc\ntype: concept\n---\n# Other")
      var moveResult = wm.move("other.md", "moved.md")
      ow.test.assert(moveResult.ok, true, "move should succeed")
      var page = wm.read("foo.md")
      ow.test.assert(page.body.indexOf("[c](/tables/customers.md)") >= 0, true, "rooted link should remain byte-for-byte unchanged after unrelated move")
    } finally { cleanupTestDir(dir) }
  }

  // ── Read-only index consumption ──────────────────────────────────────────────

  // Recursive path snapshot of a wiki root. Deliberately not using wm.list(), which
  // filters hidden paths and would hide exactly the artifacts these tests hunt for.
  var snapshotTree = function(root) {
    var out = []
    var walk = function(d) {
      var listing = io.listFiles(d)
      if (!isMap(listing) || !isArray(listing.files)) return
      listing.files.forEach(function(f) {
        out.push(String(f.canonicalPath).substring(String(root).length))
        if (f.isDirectory) walk(String(f.canonicalPath))
      })
    }
    walk(root)
    return out.sort()
  }

  var addedPaths = function(before, after) {
    return after.filter(function(p) { return before.indexOf(p) < 0 })
  }

  exports.testLexicalConfigDefaultsAndValidation = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      ow.test.assert(wm._lexicalConfig.language, "english", "lexical search should default to English")
      ow.test.assert(wm._lexicalConfig.synonyms.length, 0, "default lexical search should not add synonyms")
      ow.test.assert(wm._lexicalConfig.shingles, false, "shingles should remain opt-in by default")
      var portuguese = new MiniAWikiManager({ backend: "fs", root: dir, wikilexical: "{ language: 'portuguese', synonyms: [['carro', 'automovel']] }" })
      ow.test.assert(portuguese._lexicalConfig.language, "portuguese", "configured Lucene language should be preserved")
      ow.test.assert(portuguese._lexicalConfig.synonyms[0][1], "automovel", "configured synonym rules should be normalized")
      io.writeFileString(dir + java.io.File.separator + "synonyms.txt", "# Domain aliases\nk8s, kubernetes\nsso, single sign on\n")
      var fromFile = new MiniAWikiManager({ backend: "fs", root: dir, wikilexical: { synonyms: [["js", "javascript"]], synonymsFile: "synonyms.txt" } })
      ow.test.assert(fromFile._lexicalConfig.synonyms.length, 3, "synonym files should add to inline synonym rules")
      ow.test.assert(fromFile._lexicalConfig.synonyms[1][1], "kubernetes", "relative synonym files should resolve from the wiki root")
      var invalid = false
      try { new MiniAWikiManager({ backend: "fs", root: dir, wikilexical: { language: "klingon" } }) } catch(e) { invalid = String(e).indexOf("Invalid wikilexical language") >= 0 }
      ow.test.assert(invalid, true, "invalid lexical languages should fail initialization clearly")
      var missing = false
      try { new MiniAWikiManager({ backend: "fs", root: dir, wikilexical: { synonymsFile: "missing.txt" } }) } catch(e) { missing = String(e).indexOf("synonymsFile: file not found") >= 0 }
      ow.test.assert(missing, true, "missing synonym files should fail initialization clearly")
    } finally { cleanupTestDir(dir) }
  }

  exports.testLexicalManifestUpgradeContract = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      var resetSeen = __
      wm._hasEnhancedLexicalSupport = function() { return true }
      wm._rebuildSearchIndex = function(opts) { resetSeen = opts.resetLucene; return { ok: true } }
      wm._rebuildGraphIndex = function() {}
      var first = wm.reindex()
      ow.test.assert(first.ok, true, "a supported lexical reindex should succeed")
      ow.test.assert(resetSeen, true, "a legacy index without manifest should be reset")
      var manifest = af.fromJson(io.readFileString(wm._getLexicalManifestPath()))
      ow.test.assert(manifest.fingerprint, wm._lexicalFingerprint, "successful reindex should write the lexical manifest")
      resetSeen = __
      wm.reindex()
      ow.test.assert(resetSeen, false, "matching manifests should retain the normal rebuild path")
      var changed = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw", wikilexical: { language: "french" } })
      changed._hasEnhancedLexicalSupport = function() { return true }
      changed._rebuildSearchIndex = function(opts) { resetSeen = opts.resetLucene; return { ok: true } }
      changed._rebuildGraphIndex = function() {}
      ow.test.assert(changed.reindex().ok, true, "changed lexical configuration should reindex")
      ow.test.assert(resetSeen, true, "a changed lexical fingerprint should reset the legacy fields")
    } finally { cleanupTestDir(dir) }
  }

  exports.testReadOnlyConsumesExistingLuceneIndex = function() {
    var dir = createTestDir()
    try {
      var rw = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      rw.write("notes/alpha.md", { title: "Alpha", description: "About alpha" }, "# Alpha\n\nThe quick brown zebrafish jumps.")
      rw.write("notes/beta.md", { title: "Beta", description: "About beta" }, "# Beta\n\nA different marmoset topic.")
      ow.test.assert(rw.reindex().ok, rw._hasEnhancedLexicalSupport(), "rw reindex should require lexicalEnhanced support")
      rw.close()

      var ro = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro" })
      ow.test.assert(ro._searchIndexStatus(), "lucene-readonly", "ro should report a read-only lucene index")
      var hits = ro.search("zebrafish", { limit: 5 })
      ow.test.assert(hits.length > 0, true, "ro search should return index hits")
      ow.test.assert(hits[0].path, "notes/alpha.md", "ro search should find the right page")
      ow.test.assert(isNumber(hits[0].score), true, "real Lucene search should expose a numeric relevance score")
      ro.close()
    } finally { cleanupTestDir(dir) }
  }

  exports.testLuceneSearchPreservesScoresAndOrder = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "alpha.md", "---\ntitle: Alpha\ndescription: Alpha page\n---\nalpha needle")
      writePage(dir, "beta.md", "---\ntitle: Beta\ndescription: Beta page\n---\nbeta needle")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro" })
      var luceneHits = [
        { id: "beta.md", content: "beta needle", payload: { title: "Beta" }, score: 4.25 },
        { id: "alpha.md", content: "alpha needle", payload: { title: "Alpha" }, score: 1.5 }
      ]
      wm._ensureSearchIndex = function() {
        return { type: "lucene", available: function() { return true }, writable: false, exists: function() { return true }, query: function() { return luceneHits } }
      }

      var compact = wm.search("needle", { limit: 5 })
      ow.test.assert(compact.map(function(hit) { return hit.path }).join(","), "beta.md,alpha.md", "Lucene result order should be retained")
      ow.test.assert(isNumber(compact[0].score), true, "compact Lucene results should expose numeric scores")
      ow.test.assert(compact[0].score, 4.25, "compact result should preserve the Lucene score")

      var detailed = wm.search("needle", { limit: 5, compact: false })
      ow.test.assert(detailed.map(function(hit) { return hit.path }).join(","), "beta.md,alpha.md", "detailed Lucene result order should be retained")
      ow.test.assert(isNumber(detailed[1].score), true, "detailed Lucene results should expose numeric scores")
      ow.test.assert(detailed[1].score, 1.5, "detailed result should preserve the Lucene score")
      wm.close()
    } finally { cleanupTestDir(dir) }
  }

  exports.testReadOnlySessionWritesNothingWhenIndexExists = function() {
    var dir = createTestDir()
    try {
      var rw = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      rw.write("notes/alpha.md", { title: "Alpha" }, "# Alpha\n\nThe quick brown zebrafish jumps.")
      rw.reindex()
      rw.close()

      var before = snapshotTree(dir)
      var ro = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro" })
      ro.search("zebrafish", { limit: 5 })
      ro.read("notes/alpha.md")
      ro.list("", { withMeta: true })
      ro.tree("", 3)
      ro.browse("")
      ro.context()
      ro.close()
      var added = addedPaths(before, snapshotTree(dir))
      ow.test.assert(added.length, 0, "ro session must not create files: " + stringify(added, __, ""))
    } finally { cleanupTestDir(dir) }
  }

  exports.testReadOnlySessionWritesNothingWhenNoIndexExists = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "notes/gamma.md", "---\ntitle: Gamma\ndescription: About gamma\n---\n\n# Gamma\n\nA lonely platypus wanders.")

      var before = snapshotTree(dir)
      var ro = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro" })
      ow.test.assert(ro._searchIndexStatus(), "scan", "ro without an index should fall back to scan")
      var hits = ro.search("platypus", { limit: 5 })
      ow.test.assert(hits.length > 0, true, "scan fallback should still find the page")
      ow.test.assert(hits[0].path, "notes/gamma.md", "scan fallback should find the right page")
      ow.test.assert(isDef(hits[0].score), false, "scan fallback should not fabricate a relevance score")
      ro.list("", { withMeta: true })
      ro.tree("", 3)
      ro.browse("")
      ro.close()
      var added = addedPaths(before, snapshotTree(dir))
      ow.test.assert(added.length, 0, "ro session without an index must not create files: " + stringify(added, __, ""))
    } finally { cleanupTestDir(dir) }
  }

  exports.testReadOnlySearchWorksWhileWriterLockHeld = function() {
    var dir = createTestDir()
    try {
      var rw = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      rw.write("notes/alpha.md", { title: "Alpha" }, "# Alpha\n\nThe quick brown zebrafish jumps.")
      rw.reindex()
      rw._openLucene(false)   // keep the IndexWriter (and its lock) open

      var ro = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro" })
      var hits = ro.search("zebrafish", { limit: 5 })
      ow.test.assert(hits.length > 0, true, "ro search must not be blocked by a held writer lock")
      ro.close()
      rw.close()
    } finally { cleanupTestDir(dir) }
  }

  exports.testReadOnlyRejectsIndexBuilds = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "notes/gamma.md", "---\ntitle: Gamma\n---\n# Gamma")
      var ro = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro", usegraph: true })
      ow.test.assert(ro.reindex().ok, false, "reindex should be rejected on a read-only wiki")
      var g = ro.graph("build", {})
      ow.test.assert(g.ok, false, "graph build should be rejected on a read-only wiki")
      ro.close()
    } finally { cleanupTestDir(dir) }
  }

  exports.testIndexBackedSearchReturnsRealSnippets = function() {
    var dir = createTestDir()
    try {
      var rw = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw" })
      rw.write("notes/alpha.md", { title: "Alpha" }, "# Alpha\n\nline one\nThe quick brown zebrafish jumps.\nline three")
      rw.reindex()
      rw.close()

      var ro = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro" })
      var hits = ro.search("zebrafish", { limit: 5, compact: false })
      ow.test.assert(hits.length > 0, true, "should return non-compact hits")
      ow.test.assert(hits[0].snippet.indexOf("zebrafish") >= 0, true, "snippet should be the matching line, not the query echo")
      ow.test.assert(hits[0].line > 1, true, "line number should point at the matching line")
      ro.close()
    } finally { cleanupTestDir(dir) }
  }

  exports.testContextReportsRetrievalCapability = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "notes/gamma.md", "---\ntitle: Gamma\n---\n# Gamma")
      var ro = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro" })
      var ctx = ro.context()
      ow.test.assert(ctx.access, "ro", "context should report access mode")
      ow.test.assert(isMap(ctx.retrieval), true, "context should report retrieval capability")
      ow.test.assert(ctx.retrieval.search, "scan", "context should report the search engine in use")
      ow.test.assert(ctx.retrieval.graph, "none", "context should report graph availability")
      ro.close()
    } finally { cleanupTestDir(dir) }
  }

  exports.testFalkorReadGateAllowsReadOnlyGraphs = function() {
    load("mini-a-graph.js")
    var dir = createTestDir()
    try {
      var g = new MiniAWikiGraph({ graphDir: dir + "/g", readOnly: true, falkor: { host: "localhost", port: 6379 } }, function() {})
      ow.test.assert(g._hasFalkorRead(), true, "read-only graph may query an external FalkorDB")
      ow.test.assert(g._hasFalkor(), false, "read-only graph may not write to an external FalkorDB")

      var gw = new MiniAWikiGraph({ graphDir: dir + "/g2", readOnly: false, falkor: { host: "localhost", port: 6379 } }, function() {})
      ow.test.assert(gw._hasFalkor(), true, "writable graph may write to an external FalkorDB")
    } finally { cleanupTestDir(dir) }
  }

  exports.testReadOnlySkipsGraphWhenNoneExists = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "notes/gamma.md", "---\ntitle: Gamma\n---\n# Gamma")
      var before = snapshotTree(dir)
      var ro = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro", usegraph: true })
      ow.test.assert(isObject(ro._graph), false, "ro should not construct a graph when there is none to consume")
      ro.close()
      var added = addedPaths(before, snapshotTree(dir))
      ow.test.assert(added.length, 0, "ro with usegraph must not create a graph dir: " + stringify(added, __, ""))
    } finally { cleanupTestDir(dir) }
  }

  return exports
})()
