(function() {
  global.__mini_a_ingest_lib_mode = true
  global.__mini_a_dreams_lib_mode = true
  load("mini-a-common.js")
  load("mini-a-memory.js")
  load("mini-a-wiki.js")
  load("mini-a-ingest.js")

  // ─── helpers ────────────────────────────────────────────────

  var makeSourceDir = function() {
    var src = String(io.createTempDir("miniingest_src_"))
    io.writeFileString(src + "/README.md", "# Widget Toolkit\n\nA toolkit for widgets. Install with `npm i widgets`.")
    io.mkdir(src + "/docs")
    io.writeFileString(src + "/docs/setup.md", "# Setup\n\nRun `widgets init` then edit widgets.yaml.")
    io.writeFileString(src + "/docs/api.md", "# API\n\nThe `render()` call takes a widget spec.")
    io.mkdir(src + "/node_modules")
    io.writeFileString(src + "/node_modules/junk.md", "# Junk\n\nshould never be ingested")
    return src
  }

  var cleanup = function() {
    for (var i = 0; i < arguments.length; i++) {
      try { io.rm(arguments[i]) } catch(e) {}
    }
  }

  // Stub LLM: echoes the source name back so assertions can trace page -> source.
  var stubLlm = function() {
    return {
      promptJSONWithStats: function(prompt) {
        var m = String(prompt).match(/## Source\n(.+)\n/)
        var name = m ? m[1] : "unknown"
        return {
          response: {
            title      : "T:" + name,
            description: "D:" + name,
            type       : "concept",
            tags       : ["widget", "toolkit"],
            body       : "# T:" + name + "\n\nDistilled body for " + name + "."
          },
          stats: {}
        }
      }
    }
  }

  var makeIngest = function(src, wiki, extra) {
    var a = merge({
      usewiki: "true", wikiaccess: "rw", wikibackend: "fs",
      wikiroot: wiki, ingestsource: src
    }, isMap(extra) ? extra : {})
    var ing = new MiniAIngest(a, function() {})
    ing._setLlm(stubLlm())
    return ing
  }

  // ─── discovery & filtering ──────────────────────────────────

  exports.testIngestDiscoversMarkdownAndSkipsVendorDirs = function() {
    var src = makeSourceDir(), wiki = String(io.createTempDir("miniingest_wiki_"))
    try {
      var res = makeIngest(src, wiki, { ingestdryrun: "true" }).run()
      ow.test.assert(res.ok, true, "dry-run should succeed")
      ow.test.assert(res.discovered, 3, "should discover README + 2 docs, excluding node_modules")
      ow.test.assert(res.written.filter(function(p) { return p.indexOf("junk") >= 0 }).length, 0, "node_modules must never be ingested")
    } finally { cleanup(src, wiki) }
  }

  exports.testIngestDryRunWritesNoPages = function() {
    var src = makeSourceDir(), wiki = String(io.createTempDir("miniingest_wiki_"))
    try {
      var res = makeIngest(src, wiki, { ingestdryrun: "true" }).run()
      ow.test.assert(res.dryrun, true, "result should be flagged as a dry-run")
      // the planned paths are reported, but no page file exists on disk
      var wrote = res.written.filter(function(p) { return io.fileExists(wiki + "/" + p) })
      ow.test.assert(wrote.length, 0, "dry-run must not write any ingested page")
    } finally { cleanup(src, wiki) }
  }

  exports.testIngestRespectsIncludeAndExclude = function() {
    var src = makeSourceDir(), wiki = String(io.createTempDir("miniingest_wiki_"))
    try {
      var only = makeIngest(src, wiki, { ingestdryrun: "true", ingestinclude: "docs/" }).run()
      ow.test.assert(only.discovered, 2, "ingestinclude should narrow discovery to docs/")
      var without = makeIngest(src, wiki, { ingestdryrun: "true", ingestexclude: "api" }).run()
      ow.test.assert(without.discovered, 2, "ingestexclude should drop matching sources")
    } finally { cleanup(src, wiki) }
  }

  exports.testIngestDiscoversHtmlSources = function() {
    var src = makeSourceDir(), wiki = String(io.createTempDir("miniingest_wiki_"))
    try {
      io.writeFileString(src + "/docs/guide.html", "<html><body><h1>Guide</h1><p>Widgets in the browser.</p></body></html>")
      var res = makeIngest(src, wiki, { ingestdryrun: "true" }).run()
      ow.test.assert(res.discovered, 4, "should discover README + 2 docs + the html guide")
    } finally { cleanup(src, wiki) }
  }

  exports.testIngestSkipsOversizedSources = function() {
    var src = makeSourceDir(), wiki = String(io.createTempDir("miniingest_wiki_"))
    try {
      io.writeFileString(src + "/huge.md", "# Huge\n\n" + repeat(60000, "x"))
      var res = makeIngest(src, wiki, { ingestdryrun: "true", ingestmaxfilekb: 1 }).run()
      ow.test.assert(res.skipped_oversized.length >= 1, true, "oversized sources should be skipped, not truncated")
      ow.test.assert(res.skipped_oversized.join(" ").indexOf("huge.md") >= 0, true, "the skip should name the file")
    } finally { cleanup(src, wiki) }
  }

  // ─── write & provenance ─────────────────────────────────────

  exports.testIngestWritesOnePagePerSourceWithProvenance = function() {
    var src = makeSourceDir(), wiki = String(io.createTempDir("miniingest_wiki_"))
    try {
      var res = makeIngest(src, wiki).run()
      ow.test.assert(res.ok, true, "ingest should succeed")
      ow.test.assert(res.written.length, 3, "one page per source")
      ow.test.assert(res.failed.length, 0, "no distillation should fail")

      var wm = new MiniAWikiManager({ backend: "fs", root: wiki, access: "ro" }, function() {})
      var page = wm.read(res.written[0])
      ow.test.assert(isString(page.meta.title) && page.meta.title.indexOf("T:") === 0, true, "title should come from the distillation")
      ow.test.assert(isString(page.meta.source) && page.meta.source.length > 0, true, "page should record its source")
      ow.test.assert(isString(page.meta.source_hash) && page.meta.source_hash.length, 40, "page should record a sha1 source_hash")
      ow.test.assert(isDef(page.meta.ingested), true, "page should record an ingested timestamp")
      wm.close()
    } finally { cleanup(src, wiki) }
  }

  exports.testIngestFinalizesIndexesAndSearchIndex = function() {
    var src = makeSourceDir(), wiki = String(io.createTempDir("miniingest_wiki_"))
    try {
      var res = makeIngest(src, wiki).run()
      ow.test.assert(isMap(res.finalize), true, "ingest should finalize")
      ow.test.assert(res.finalize.reindexed, true, "finalize should rebuild the search index")
      ow.test.assert(io.fileExists(wiki + "/index.md"), true, "root index should exist")
      ow.test.assert(io.fileExists(wiki + "/" + res.section + "/index.md"), true, "section index should exist")

      var wm = new MiniAWikiManager({ backend: "fs", root: wiki, access: "ro" }, function() {})
      var hits = wm.search("Distilled", { limit: 10 })
      ow.test.assert(hits.length > 0, true, "ingested pages should be searchable straight away")
      wm.close()
    } finally { cleanup(src, wiki) }
  }

  // ─── ledger ─────────────────────────────────────────────────

  exports.testIngestSecondRunIsANoOp = function() {
    var src = makeSourceDir(), wiki = String(io.createTempDir("miniingest_wiki_"))
    try {
      makeIngest(src, wiki).run()
      var second = makeIngest(src, wiki).run()
      ow.test.assert(second.written.length, 0, "unchanged sources must not be re-ingested")
      ow.test.assert(second.skipped_unchanged, 3, "all three sources should be reported as unchanged")
    } finally { cleanup(src, wiki) }
  }

  exports.testIngestForceReIngestsEverything = function() {
    var src = makeSourceDir(), wiki = String(io.createTempDir("miniingest_wiki_"))
    try {
      makeIngest(src, wiki).run()
      var forced = makeIngest(src, wiki, { ingestforce: "true" }).run()
      ow.test.assert(forced.written.length, 3, "ingestforce should re-ingest every source")
    } finally { cleanup(src, wiki) }
  }

  exports.testIngestReIngestsOnlyChangedSources = function() {
    var src = makeSourceDir(), wiki = String(io.createTempDir("miniingest_wiki_"))
    try {
      makeIngest(src, wiki).run()
      io.writeFileString(src + "/docs/api.md", "# API\n\nThe `render()` call takes a widget spec and a theme.")
      var again = makeIngest(src, wiki).run()
      ow.test.assert(again.written.length, 1, "only the changed source should be re-ingested")
      ow.test.assert(again.skipped_unchanged, 2, "the other two should be skipped")
    } finally { cleanup(src, wiki) }
  }

  // ─── chunking ───────────────────────────────────────────────

  exports.testChunkerKeepsSmallSourcesWhole = function() {
    var ing = new MiniAIngest({}, function() {})
    ow.test.assert(ing._chunk("# Small\n\nbody", 5000).length, 1, "a small source is a single chunk")
  }

  exports.testIngestReportsDistillationFailuresAsBatchesComplete = function() {
    var logs = []
    var ing = new MiniAIngest({ ingestconcurrency: 1 }, function(msg) { logs.push(msg) })
    ing._setLlm({
      promptJSONWithStats: function() { throw new Error("model unavailable") }
    })
    var pending = [{
      src: { id: "failed.md", rel: "failed.md" }, content: "# Failed", hash: "hash", key: "key"
    }]
    var result = ing._distillAll(ing._llm, pending, [], 1)
    ow.test.assert(result[0].ok, false, "the failed distillation should be returned")
    ow.test.assert(logs.join("\n").indexOf("Distillation failed for failed.md: model unavailable") >= 0, true,
      "a failed batch should be logged before the write pass")
  }

  exports.testChunkerSplitsOnHeadingsWithinLimit = function() {
    var ing = new MiniAIngest({}, function() {})
    var parts = []
    for (var i = 0; i < 200; i++) parts.push("## Section " + i + "\n\n" + repeat(300, "x"))
    var chunks = ing._chunk(parts.join("\n\n"), 5000)
    ow.test.assert(chunks.length > 1, true, "an oversized source should be split")
    ow.test.assert(chunks.every(function(c) { return c.length <= 5000 }), true, "no chunk may exceed the limit")
  }

  exports.testChunkerHandlesHeadinglessProse = function() {
    var ing = new MiniAIngest({}, function() {})
    var paras = []
    for (var i = 0; i < 100; i++) paras.push(repeat(200, "y"))
    var chunks = ing._chunk(paras.join("\n\n"), 3000)
    ow.test.assert(chunks.length > 1, true, "headingless prose should still split on paragraphs")
    ow.test.assert(chunks.every(function(c) { return c.length <= 3000 }), true, "no chunk may exceed the limit")
  }

  // ─── html conversion ────────────────────────────────────────

  exports.testReadSourceConvertsLocalHtmlToText = function() {
    var dir = String(io.createTempDir("miniingest_html_"))
    try {
      var htmlPath = dir + "/page.html"
      io.writeFileString(htmlPath, "<html><body><h1>Widget Toolkit</h1><p>Install with <code>npm i widgets</code>.</p></body></html>")
      var ing = new MiniAIngest({}, function() {})
      var content = ing._readSource({ path: htmlPath, rel: "page.html" })
      ow.test.assert(isString(content), true, "html source should be readable")
      ow.test.assert(content.indexOf("<h1>") < 0 && content.indexOf("<p>") < 0 && content.indexOf("<body>") < 0, true, "html tags should not leak into the distilled content")
      ow.test.assert(content.indexOf("Widget Toolkit") >= 0, true, "text content should be preserved")
      ow.test.assert(content.indexOf("npm i widgets") >= 0, true, "inline text should be preserved")
    } finally { cleanup(dir) }
  }

  exports.testReadSourceLeavesMarkdownUnconverted = function() {
    var dir = String(io.createTempDir("miniingest_md_"))
    try {
      var mdPath = dir + "/page.md"
      io.writeFileString(mdPath, "# Widget Toolkit\n\nInstall with `npm i widgets`.")
      var ing = new MiniAIngest({}, function() {})
      var content = ing._readSource({ path: mdPath, rel: "page.md" })
      ow.test.assert(content, "# Widget Toolkit\n\nInstall with `npm i widgets`.", "markdown sources must pass through unchanged")
    } finally { cleanup(dir) }
  }

  // ─── resolve ────────────────────────────────────────────────

  exports.testSourceTypeDetection = function() {
    var ing = new MiniAIngest({}, function() {})
    ow.test.assert(ing._resolveSourceType("https://example.com/page"), "url", "http(s) pages are url sources")
    ow.test.assert(ing._resolveSourceType("https://github.com/OpenAF/mini-a"), "repo", "git hosts are repo sources")
    ow.test.assert(ing._resolveSourceType("./docs"), "markdown", "plain folders are markdown sources")
    var forced = new MiniAIngest({ ingesttype: "repo" }, function() {})
    ow.test.assert(forced._resolveSourceType("./docs"), "repo", "ingesttype should override detection")
  }

  exports.testIngestRefusesReadOnlyWiki = function() {
    var src = makeSourceDir(), wiki = String(io.createTempDir("miniingest_wiki_"))
    try {
      var ing = makeIngest(src, wiki, { wikiaccess: "ro" })
      var res = ing.run()
      ow.test.assert(res.ok, false, "ingest into a read-only wiki should be refused")
      ow.test.assert(res.reason, "wiki-read-only", "reason should say the wiki is read-only")
    } finally { cleanup(src, wiki) }
  }

  exports.testIngestRequiresASource = function() {
    var res = new MiniAIngest({ usewiki: "true" }, function() {}).run()
    ow.test.assert(res.ok, false, "no source should not run")
    ow.test.assert(res.reason, "no-source", "reason should be no-source")
  }

  return exports
})()
