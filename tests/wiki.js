(function() {
  load("mini-a-common.js")
  load("mini-a-wiki.js")

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
    var body = "See [[Getting Started]] and [[API Reference]] for more."
    var links = wm.extractLinks(body)
    ow.test.assert(links.indexOf("getting-started.md") >= 0, true, "should find getting-started.md")
    ow.test.assert(links.indexOf("api-reference.md") >= 0, true, "should find api-reference.md")
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

  exports.testResolveLinkAbsoluteReturnsNull = function() {
    var wm = new MiniAWikiManager({ backend: "fs", root: "." })
    var resolved = wm.resolveLink("page.md", "/absolute/page.md")
    ow.test.assert(resolved, null, "absolute path links should return null")
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

  exports.testLintAbsolutePathLinkNotBroken = function() {
    var dir = createTestDir()
    try {
      writePage(dir, "index.md", "---\ntitle: Index\n---\nSee [absolute](/wiki/page.md).")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var report = wm.lint()
      var brokenLinks = report.issues.filter(function(i) { return i.type === "broken_link" })
      ow.test.assert(brokenLinks.length, 0, "absolute path links should not be broken_link errors")
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
      ow.test.assert(isObject(reindexResult) && reindexResult.ok === true, true, "reindex should succeed in rw mode")
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
      wm.write("index.md", { title: "Index" }, "# Index\nSee [old](old.md).")
      var result = wm.move("old.md", "guides/new.md")
      ow.test.assert(result.ok, true, "move should succeed")
      ow.test.assert(wm.read("old.md"), __, "old page should be deleted by default")
      var moved = wm.read("guides/new.md")
      ow.test.assert(moved.meta.created, "2024-01-01T00:00:00.000Z", "move should preserve created metadata")
      ow.test.assert(moved.body.indexOf("../index.md") >= 0, true, "moved page relative links should be rebased")
      var index = wm.read("index.md")
      ow.test.assert(index.body.indexOf("guides/new.md") >= 0, true, "incoming links should point to new page")
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
      ow.test.assert(raw.indexOf("agentsVersion: 2") >= 0, true, "AGENTS.md frontmatter should have agentsVersion: 2")
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
      ow.test.assert(result.agentsVersion, 2, "agentsVersion should be 2")
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
      ow.test.assert(newRaw.indexOf("agentsVersion: 2") >= 0, true, "upgraded AGENTS.md should have v2")
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

  return exports
})()
