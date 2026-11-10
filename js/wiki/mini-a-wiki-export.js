// Resolve dependencies from this package before loading other modules.
if (typeof __miniAPath !== "function") loadLib(String(new java.io.File(String(__loadedfrom)).getCanonicalFile().getParentFile().getParent()) + "/mini-a-paths.js")

// Portable wiki export: pages plus the validated search/graph artifacts that
// other Mini-A instances hydrate (S3 artifact bundle, HTTP bundle or archive root).
// The index content always comes from MiniAWikiRetrievalV2.exportBundle so it is
// identical, and verified, in both packaging modes.
var __miniAWikiExport = {
  bundleName: "mini-a-wiki-index.zip",
  fail: function(code, hint) { var e = new Error(code); e.exportCode = code; e.exportHint = hint || ""; throw e },
  hex: function(bytes) { var out = ""; for (var i = 0; i < bytes.length; i++) out += ("0" + (Number(bytes[i]) & 255).toString(16)).slice(-2); return out },
  buffer: function() { return java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 65536) },
  hashFile: function(file) {
    var input = new java.io.FileInputStream(file), md = java.security.MessageDigest.getInstance("SHA-256"), buf = __miniAWikiExport.buffer(), n
    try { while ((n = input.read(buf)) !== -1) md.update(buf, 0, n) } finally { input.close() }
    return __miniAWikiExport.hex(md.digest())
  },
  // Visible content only: no dot-prefixed segments (engine state), no symlinks.
  collect: function(root) {
    var out = {}, rootPath = java.nio.file.Paths.get(root)
    var walk = function(dir) {
      var entries = dir.listFiles()
      if (entries === null) __miniAWikiExport.fail("export-unreadable-root", "A directory in the wiki could not be listed")
      for (var i = 0; i < entries.length; i++) {
        var f = entries[i], name = String(f.getName())
        if (name.charAt(0) === ".") continue
        if (java.nio.file.Files.isSymbolicLink(f.toPath())) continue
        if (f.isDirectory()) walk(f)
        else if (f.isFile()) {
          var rel = String(rootPath.relativize(f.toPath())).replace(/\\/g, "/")
          out[rel] = { size: Number(f.length()), hash: __miniAWikiExport.hashFile(f), file: f }
        }
      }
    }
    walk(new java.io.File(root))
    return out
  },
  fingerprint: function(files) {
    return sha1(JSON.stringify(Object.keys(files).sort().map(function(k) { return [k, files[k].hash] })))
  }
}

MiniAWikiManager.prototype.exportWiki = function(output, options) {
  var X = __miniAWikiExport, opts = isMap(options) ? options : {}, nobundle = toBoolean(opts.nobundle) === true
  var lock, zip, zout, temporary, bundleTmp, stage = "preflight"
  try {
    if (this._catalog || this._backendType !== "fs" || this._archiveRoot) X.fail("export-requires-local-filesystem", "Export works on a local filesystem wiki")
    if (!isString(output) || !output.trim().length || output.length > 4096) X.fail("invalid-export-destination", "Provide an output .zip path")
    var target = new java.io.File(output.trim())
    if (!target.isAbsolute() || !/\.zip$/i.test(String(target.getName()))) X.fail("invalid-export-destination", "Output must be an absolute path ending in .zip")
    if (target.exists() || java.nio.file.Files.isSymbolicLink(target.toPath())) X.fail("export-destination-exists", "Choose a new file name; existing files are never overwritten")
    var parent = target.getParentFile()
    if (parent === null || !parent.isDirectory()) X.fail("invalid-export-destination", "The output directory does not exist")
    var targetPath = String(new java.io.File(String(parent.getCanonicalPath()), String(target.getName())).getPath())
    var root = String(new java.io.File(this._backend.root).getCanonicalPath())
    if ((targetPath + "/").indexOf(root + "/") === 0) X.fail("export-destination-inside-wiki", "Write the export outside the wiki folder")
    var engine = this._retrievalV2
    if (!engine || !this._hasRetrievalPublication(engine)) X.fail("no-retrieval-publication", "Run wiki.reindex (Retrieval V2) first so there is an index to export")
    if (isFunction(this._knowledgeJournalPending) && this._knowledgeJournalPending()) X.fail("ingest-pending", "Resume or discard the pending ingestion recovery, then export")

    if (this._access === "rw") lock = __miniAWikiWriterLock(root)

    stage = "pages"
    var before = X.collect(root), fingerprint = X.fingerprint(before)
    if (nobundle !== true && before[X.bundleName]) X.fail("name-collision", "The wiki contains a page named " + X.bundleName)

    stage = "index"
    bundleTmp = targetPath + ".index-" + java.util.UUID.randomUUID() + ".zip"
    var exported = engine.exportBundle(bundleTmp, { includeGraph: true })
    if (!isMap(exported) || exported.ok !== true) {
      var code = isMap(exported) && isString(exported.code) ? exported.code : "index-export-failed"
      X.fail(code, isMap(exported) && isString(exported.error) ? exported.error : "Index export failed")
    }

    stage = "archive"
    temporary = targetPath + ".tmp-" + java.util.UUID.randomUUID()
    zout = new java.io.FileOutputStream(temporary)
    zip = new java.util.zip.ZipOutputStream(new java.io.BufferedOutputStream(zout))
    var expected = {}, buf = X.buffer(), n, md
    var copy = function(name, input) {
      md = java.security.MessageDigest.getInstance("SHA-256")
      zip.putNextEntry(new java.util.zip.ZipEntry(name))
      try { while ((n = input.read(buf)) !== -1) { md.update(buf, 0, n); zip.write(buf, 0, n) } } finally { input.close() }
      zip.closeEntry()
      expected[name] = X.hex(md.digest())
    }
    Object.keys(before).sort().forEach(function(rel) {
      copy(rel, new java.io.FileInputStream(before[rel].file))
      if (expected[rel] !== before[rel].hash) X.fail("wiki-changed-during-export", "A page changed while exporting; stop writers and retry")
    })
    var pageCount = Object.keys(before).length, indexFiles = 0
    if (nobundle === true) {
      var source = new java.util.zip.ZipFile(bundleTmp), entries = source.entries()
      try {
        while (entries.hasMoreElements()) {
          var entry = entries.nextElement()
          if (entry.isDirectory()) continue
          copy(String(entry.getName()), source.getInputStream(entry)); indexFiles++
        }
      } finally { source.close() }
    } else {
      copy(X.bundleName, new java.io.FileInputStream(bundleTmp)); indexFiles = 1
    }
    zip.close(); zip = null; zout = null

    stage = "verify"
    var check = new java.util.zip.ZipFile(temporary), seen = {}, listed = check.entries()
    try {
      while (listed.hasMoreElements()) {
        var item = listed.nextElement(), itemName = String(item.getName())
        if (seen[itemName] || !expected[itemName]) X.fail("export-entry-mismatch", "Unexpected archive entry " + itemName)
        seen[itemName] = true
        var stream = check.getInputStream(item), digest = java.security.MessageDigest.getInstance("SHA-256"), k
        try { while ((k = stream.read(buf)) !== -1) digest.update(buf, 0, k) } finally { stream.close() }
        if (X.hex(digest.digest()) !== expected[itemName]) X.fail("export-checksum-failure", "Archive entry failed verification: " + itemName)
      }
    } finally { check.close() }
    if (Object.keys(seen).length !== Object.keys(expected).length) X.fail("export-entry-mismatch", "Archive is missing entries")
    if (X.fingerprint(X.collect(root)) !== fingerprint) X.fail("wiki-changed-during-export", "A page changed while exporting; stop writers and retry")

    java.nio.file.Files.move(new java.io.File(temporary).toPath(), new java.io.File(targetPath).toPath(), java.nio.file.StandardCopyOption.ATOMIC_MOVE)
    temporary = null
    var prefix = isString(this._config.prefix) ? this._config.prefix : "<prefix>"
    return {
      ok: true, output: targetPath, mode: nobundle === true ? "folders" : "bundle", pages: pageCount, indexFiles: indexFiles,
      bytes: Number(new java.io.File(targetPath).length()), generation: exported.generation, fallbackGeneration: exported.fallbackGeneration, graph: exported.graph === true,
      usage: nobundle === true
        ? ["Use directly as an archive wiki: wikiroot=" + targetPath + " wikiindexdir=<cache dir> wikiretrievalv2=true", "Or unzip it and serve the folder with wikiroot=<folder>"]
        : ["S3: unzip, upload all files to one prefix, then wikibackend=s3 wikiprefix=<prefix> wikis3artifactprefix=<prefix> s3artifactbundle=true", "HTTP: publish the unzipped files and set wikiurl=<base> (index at <base>/" + X.bundleName + ")"]
    }
  } catch(e) {
    var message = isString(e.exportCode) ? e.exportCode : __miniAErrMsg(e)
    return { ok: false, error: message, code: message.split(":")[0], hint: isString(e.exportHint) ? e.exportHint : "", stage: stage }
  } finally {
    try { if (zip) zip.close(); else if (zout) zout.close() } catch(ignoreZip) {}
    ;[temporary, bundleTmp].forEach(function(f) { try { if (f) java.nio.file.Files.deleteIfExists(new java.io.File(f).toPath()) } catch(ignoreFile) {} })
    try { if (lock) lock.release() } catch(ignoreLock) {}
  }
}
