(function() {
  load("js/core/mini-a-common.js"); load("js/wiki/mini-a-wiki.js"); load("js/wiki/mini-a-wikiops.js")
  var temporary = function() { var p = java.io.File.createTempFile("wiki-export-test-", "").getCanonicalPath(); io.rm(p); io.mkdir(p); return p }
  var make = function(root, extra) { return new MiniAWikiManager(merge({ backend: "fs", root: root, access: "rw", wikiretrievalv2: true, wikiretrievalconfig: { passageChars: 256 } }, extra || {}), function() {}) }
  var entries = function(zipPath) {
    var zip = new java.util.zip.ZipFile(zipPath), en = zip.entries(), out = []
    try { while (en.hasMoreElements()) out.push(String(en.nextElement().getName())) } finally { zip.close() }
    return out.sort()
  }
  var seed = function(dir) {
    var wm = make(dir)
    wm.write("answer.md", { title: "Answer" }, "# Answer\nexportneedle is preserved across instances.")
    wm.write("sub/deep.md", { title: "Deep" }, "# Deep\ndeepneedle lives in a folder.")
    io.writeFileString(dir + "/logo.png", "not-really-a-png")
    ow.test.assert(wm.reindex().ok, true, "seed index builds")
    return wm
  }
  var fresh = function(path) { io.mkdir(path); return path }

  exports.testExportBundleMode = function() {
    var dir = temporary(), wm, reader, hydrated
    try {
      fresh(dir + "/wiki"); fresh(dir + "/out"); fresh(dir + "/cache"); fresh(dir + "/cache2")
      wm = seed(dir + "/wiki")
      var out = dir + "/out/export.zip", result = wm.exportWiki(out)
      ow.test.assert(result.ok, true, "export succeeds: " + stringify(result, __, ""))
      ow.test.assert(result.mode, "bundle", "default mode nests the index bundle")
      var names = entries(out)
      ow.test.assert(names.indexOf("mini-a-wiki-index.zip") >= 0, true, "nested mini-a-wiki-index.zip present")
      ow.test.assert(names.indexOf("answer.md") >= 0 && names.indexOf("sub/deep.md") >= 0 && names.indexOf("logo.png") >= 0, true, "pages and attachments present")
      ow.test.assert(names.filter(function(n) { return n.charAt(0) === "." }).length, 0, "no hidden folders outside the nested bundle")
      // The nested bundle is exactly what S3/HTTP hydration consumes.
      var zip = new java.util.zip.ZipFile(out), inner = dir + "/inner.zip"
      try { java.nio.file.Files.copy(zip.getInputStream(zip.getEntry("mini-a-wiki-index.zip")), new java.io.File(inner).toPath()) } finally { zip.close() }
      hydrated = make(dir + "/wiki", { access: "ro", indexdir: dir + "/cache" })
      ow.test.assert(hydrated._hydrateArtifactBundle(function() { return { etag: "x" } }, function() { return new java.io.FileInputStream(inner) }, "test", "inner"), true, "nested bundle hydrates into a fresh cache")
      ow.test.assert(hydrated.agenticSearch("deepneedle").results.length, 1, "hydrated nested bundle answers searches")
      // And the whole export opens directly as an archive wiki.
      reader = make(out, { access: "ro", indexdir: dir + "/cache2" })
      ow.test.assert(reader.agenticSearch("exportneedle").results.length, 1, "default export opens as an archive root")
    } finally { if (reader) reader.close(); if (hydrated) hydrated.close(); if (wm) wm.close(); io.rm(dir) }
  }

  exports.testExportFolderMode = function() {
    var dir = temporary(), wm, reader
    try {
      fresh(dir + "/wiki"); fresh(dir + "/out"); fresh(dir + "/cache")
      wm = seed(dir + "/wiki")
      var out = dir + "/out/export.zip", result = wm.exportWiki(out, { nobundle: true })
      ow.test.assert(result.ok, true, "loose export succeeds: " + stringify(result, __, ""))
      ow.test.assert(result.mode, "folders", "nobundle stores index folders")
      var names = entries(out)
      ow.test.assert(names.indexOf("mini-a-wiki-index.zip"), -1, "no nested bundle in loose mode")
      ow.test.assert(names.indexOf(".mini-a-wiki-serving/current.json") >= 0, true, "serving pointer stored loose")
      ow.test.assert(names.filter(function(n) { return /^\.mini-a-wiki-(meta|state|ingest|bundles|lucene)/.test(n) }).length, 0, "engine-internal state never exported")
      ow.test.assert(names.indexOf(".mini-a-wiki-graph/graph.json") >= 0, result.graph === true, "graph included when it exists")
      reader = make(out, { access: "ro", indexdir: dir + "/cache" })
      ow.test.assert(reader.agenticSearch("deepneedle").results.length, 1, "loose export opens as an archive root")
      ow.test.assert(reader.list("").indexOf("answer.md") >= 0, true, "pages listed from the export")
    } finally { if (reader) reader.close(); if (wm) wm.close(); io.rm(dir) }
  }

  exports.testExportReadOnlyAndOps = function() {
    var dir = temporary(), wm, ro
    try {
      fresh(dir + "/wiki"); fresh(dir + "/out")
      wm = seed(dir + "/wiki"); wm.close(); wm = __
      ro = make(dir + "/wiki", { access: "ro" })
      var lockFile = new java.io.File(dir + "/wiki/.mini-a-wiki-ingest/writer.lock"), lockStamp = lockFile.exists() ? Number(lockFile.lastModified()) : -1
      java.lang.Thread.sleep(1100)
      ow.test.assert(ro.exportWiki(dir + "/out/ro.zip").ok, true, "read-only manager can export")
      ow.test.assert(lockFile.exists() ? Number(lockFile.lastModified()) : -1, lockStamp, "read-only export never touches the writer lock")
      var ops = new MiniAWikiOps({ wikiroot: dir + "/wiki", wikiaccess: "ro" }), spec = ops.spec("wiki.export", { output: dir + "/out/ops.zip", nobundle: "true" })
      ow.test.assert(spec.params.nobundle, true, "nobundle coerced to boolean")
      ow.test.assert(MiniAWikiOps.mutates(spec), false, "export is not a mutation")
      ow.test.assert(ops.unavailable(spec), "", "available on a local read-only wiki")
      var first = ops.execute(spec, {})
      ow.test.assert(first.ok !== false && first.mode === "folders", true, "operation exports: " + stringify(first, __, ""))
      var second = ops.execute(spec, {})
      ow.test.assert(second.ok, false, "operation refuses to overwrite an existing file")
    } finally { if (ro) ro.close(); if (wm) wm.close(); io.rm(dir) }
  }

  exports.testExportRefusals = function() {
    var dir = temporary(), wm
    try {
      fresh(dir + "/wiki"); fresh(dir + "/out")
      wm = seed(dir + "/wiki")
      var out = dir + "/out/x.zip"
      ow.test.assert(wm.exportWiki("relative.zip").code, "invalid-export-destination", "relative path rejected")
      ow.test.assert(wm.exportWiki(dir + "/out/x.txt").code, "invalid-export-destination", "non-zip name rejected")
      ow.test.assert(wm.exportWiki(dir + "/wiki/inside.zip").code, "export-destination-inside-wiki", "destination inside the wiki rejected")
      ow.test.assert(wm.exportWiki(dir + "/missing/x.zip").code, "invalid-export-destination", "missing parent rejected")
      io.writeFileString(out, "existing")
      ow.test.assert(wm.exportWiki(out).code, "export-destination-exists", "existing destination never overwritten")
      ow.test.assert(io.readFileString(out), "existing", "existing file untouched")
      io.rm(out)
      var original = wm._knowledgeJournalPending
      wm._knowledgeJournalPending = function() { return true }
      var pending = wm.exportWiki(out)
      ow.test.assert(pending.code, "ingest-pending", "pending ingestion refused")
      ow.test.assert(isString(pending.hint) && pending.hint.length > 0, true, "pending refusal carries a hint")
      wm._knowledgeJournalPending = original
      // A page changing while the index is exported must abort without output.
      var engine = wm._retrievalV2, exportBundle = engine.exportBundle
      engine.exportBundle = function() { io.writeFileString(dir + "/wiki/answer.md", "# Answer\nmutated during export"); return exportBundle.apply(this, arguments) }
      var drift = wm.exportWiki(out)
      engine.exportBundle = exportBundle
      ow.test.assert(drift.code, "wiki-changed-during-export", "page drift detected: " + stringify(drift, __, ""))
      ow.test.assert(io.fileExists(out), false, "no output on drift")
      ow.test.assert(io.listFiles(dir + "/out").files.length, 0, "no temporary files left behind")
      io.writeFileString(dir + "/wiki/mini-a-wiki-index.zip", "collides")
      ow.test.assert(wm.exportWiki(out).code, "name-collision", "page named like the bundle rejected in bundle mode")
      io.rm(dir + "/wiki/mini-a-wiki-index.zip")
      // No published index: refuse with a reindex hint.
      fresh(dir + "/empty"); io.writeFileString(dir + "/empty/a.md", "# A\nbody")
      var cold = make(dir + "/empty", { access: "ro" })
      try { var cr = cold.exportWiki(out); ow.test.assert(cr.code, "no-retrieval-publication", "unindexed wiki refused: " + stringify(cr, __, "")) } finally { cold.close() }
    } finally { if (wm) wm.close(); io.rm(dir) }
  }
})()
