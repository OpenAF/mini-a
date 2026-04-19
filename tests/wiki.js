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

  // ── NearDuplicate ────────────────────────────────────────────────────────────

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

  exports.testFsBackendReadOnlyWrite = function() {
    var dir = createTestDir()
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro" })
      var result = wm.write("test.md", "# Test")
      ow.test.assert(isObject(result) && result.ok === false, true, "write should fail in ro mode")
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
      writePage(dir, "alpha.md", "---\ntitle: Alpha\n---\nThe quick brown fox.")
      writePage(dir, "beta.md", "---\ntitle: Beta\n---\nSomething else entirely.")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir })
      var hits = wm.search("quick brown")
      ow.test.assert(hits.length >= 1, true, "should find matching page")
      ow.test.assert(hits[0].path, "alpha.md", "should return alpha.md")
      var noHits = wm.search("zzznomatchzzz")
      ow.test.assert(noHits.length, 0, "should return empty for no match")
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

  return exports
})()
