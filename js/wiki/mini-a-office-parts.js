// Report parser failures without exposing server paths or workbook contents from stderr.
function __miniAOfficeParserError(failure, exitCode) {
  var exceptionLine = /^(?:Exception in thread "[^"\r\n]+" |[ \t]*Caused by: )([\w.$]+)(?::[^\r\n]*)?\r?$/gm
  var causes = [], errors = [], match
  while ((match = exceptionLine.exec(failure)) !== null) {
    causes.push(match[1])
    errors.push(match[0].trim())
  }
  var detail = errors.join("\n")
  if (causes.indexOf("java.lang.OutOfMemoryError") >= 0) return "Office parser exceeded its 256 MiB heap"
  if (/staging (byte|part) limit exceeded/.test(detail)) return "Office staging limit exceeded"
  if (causes.indexOf("org.apache.poi.EncryptedDocumentException") >= 0 || /: Encrypted spreadsheet$/m.test(detail)) return "Office document is encrypted"
  if (/Module jdk\.compiler (?:not found|not in boot Layer)|JDK source launcher not available/.test(failure)) {
    return "Office parser requires a Java 17 or newer JDK with the jdk.compiler module"
  }
  if (causes.some(function(cause) {
    return /^java\.lang\.(?:ClassNotFoundException|NoClassDefFoundError|NoSuchMethodError|NoSuchFieldError|UnsupportedClassVersionError)$/.test(cause)
  }) || /^error: compilation failed\r?$/im.test(failure)) {
    return "Office parser could not load its Java dependencies. Check the Studio server's Java, OpenAF and Tika oPack versions" +
      (causes.length ? " (" + causes[causes.length - 1] + ")" : "")
  }
  if (/: Office document yielded no text$/m.test(detail)) return "Office document contains no extractable text"
  if (/: Zip bomb detected!/m.test(detail)) return "Office parser rejected an unusually compressed document entry"
  return "Cannot extract Office document (" + (causes.length ? causes[causes.length - 1] + ", " : "") + "parser exit " + exitCode + ")"
}

// Read large Office sources in a bounded parser process and keep completed parts for Preview and Apply.
MiniAIngest.prototype._officeStage = function(src, maximum) {
  var self = this, files = java.nio.file.Files
  var source = new java.io.File(this._fileAccess.assert(src.path)).toPath()
  var extension = src.rel.match(/\.[^.]+$/)[0].toLowerCase()
  var digest = function() {
    var stream = files.newInputStream(source)
    try { return String(sha256(stream)) } finally { stream.close() }
  }
  var hash = digest(), tika = getOPackPath("Tika")
  if (!isString(tika) || !tika.length) throw new Error("Structured Office ingestion requires the Tika oPack")
  var program = __miniAPath("js/wiki/MiniAOfficeParts.java")
  var tikaManifest = tika + "/.package.yaml"
  var tikaVersion = io.fileExists(tikaManifest) ? sha256(io.readFileString(tikaManifest)) : tika
  var cacheKey = sha256(sha256(io.readFileString(program)) + "|" + tikaVersion + "|" + hash + "|" + extension + "|" + maximum)
  var root = java.nio.file.Paths.get(String(java.lang.System.getProperty("java.io.tmpdir")))
  var stage
  // Pick the newest valid stage by key. Unique directories allow safe concurrent writers.
  var completed = [], entries = root.toFile().listFiles()
  var owner = files.getOwner(java.nio.file.Paths.get(String(java.lang.System.getProperty("user.home"))))
  if (entries !== null) Array.prototype.forEach.call(entries, function(entry) {
    var name = String(entry.getName()), path = entry.toPath()
    if (!/^minia-office-[a-f0-9]{64}-[0-9]+$/.test(name) || files.isSymbolicLink(path) || !entry.isDirectory() ||
        !files.getOwner(path).equals(owner)) return
    if (files.getFileStore(path).supportsFileAttributeView("posix") &&
        String(java.nio.file.attribute.PosixFilePermissions.toString(files.getPosixFilePermissions(path))) !== "rwx------") return
    if (entry.lastModified() + 86400000 < Date.now()) {
      // Readers refresh the directory timestamp before consuming bounded parts.
      try { io.rm(String(entry)) } catch(ignoreCleanup) {}
      return
    }
    if (name.startsWith("minia-office-" + cacheKey + "-") && files.isRegularFile(path.resolve("parts.done"), java.nio.file.LinkOption.NOFOLLOW_LINKS)) {
      completed.push(entry)
    }
  })
  completed.sort(function(left, right) { return Number(right.lastModified()) - Number(left.lastModified()) })
  if (completed.length) {
    stage = completed[0].toPath()
    files.setLastModifiedTime(stage, java.nio.file.attribute.FileTime.fromMillis(Date.now()))
    self._log("[ingest] Reusing staged Office parts for " + src.rel)
  }
  else {
    stage = files.createTempDirectory(root, "minia-office-" + cacheKey + "-")
    var scratch = files.createDirectory(stage.resolve("scratch"))
    var separator = String(java.io.File.pathSeparator)
    var binary = String(java.lang.System.getProperty("java.home")) + "/bin/java"
    var command = [binary, "-Xmx256m", "-Djava.io.tmpdir=" + scratch, "-cp", tika + "/*" + separator + getOpenAFJar(),
      "--source", "17", program, String(source), String(stage), String(maximum)]
    var logFile = stage.resolve("parser.log").toFile(), process, success = false
    try {
      self._log("[ingest] Extracting Office parts from " + src.rel)
      var processArgs = new java.util.ArrayList()
      command.forEach(function(arg) { processArgs.add(new java.lang.String(String(arg))) })
      var builder = new java.lang.ProcessBuilder(processArgs)
      // Keep model credentials and JVM overrides out of the document reader.
      builder.environment().clear()
      process = builder.redirectErrorStream(true).redirectOutput(logFile).start()
      var deadline = Date.now() + 600000, progressAt = Date.now() + 3000
      while (!process.waitFor(250, java.util.concurrent.TimeUnit.MILLISECONDS)) {
        if (isFunction(self._officeCancelled) && self._officeCancelled()) throw new Error("Office extraction cancelled")
        if (Date.now() > deadline) throw new Error("Office extraction timed out")
        var used = 0, walk = files.walk(stage)
        try {
          var iterator = walk.iterator()
          while (iterator.hasNext()) {
            var item = iterator.next()
            if (files.isRegularFile(item)) used += Number(files.size(item))
            if (used > maximum) throw new Error("Office staging byte limit exceeded")
          }
        } finally { walk.close() }
        if (Date.now() >= progressAt) {
          progressAt = Date.now() + 3000
          self._log("[ingest] Office staging for " + src.rel + ": " + used + " bytes")
        }
      }
      var exitCode = Number(process.exitValue())
      if (exitCode !== 0) {
        var failure = logFile.length() <= 65536 ? io.readFileString(String(logFile)) : ""
        throw new Error(__miniAOfficeParserError(failure, exitCode))
      }
      if (digest() !== hash) throw new Error("Office source changed while extracting")
      success = true
    } finally {
      if (process && process.isAlive()) {
        process.destroyForcibly()
        process.waitFor()
      }
      if (success) {
        if (io.fileExists(String(scratch))) io.rm(String(scratch))
        logFile.delete()
        files.move(stage.resolve("parts.tsv"), stage.resolve("parts.done"), java.nio.file.StandardCopyOption.ATOMIC_MOVE)
      } else io.rm(String(stage))
    }
  }
  var manifest = stage.resolve("parts.done")
  if (!files.isRegularFile(manifest) || Number(files.size(manifest)) > 4194304) throw new Error("Invalid Office parts manifest")
  var parts = io.readFileString(String(manifest)).trim().split("\n").map(function(line, idx) {
    var field = line.split("\t")
    if (field[0] !== String(idx + 1) || field.length !== 3 || !/^[a-f0-9]{64}$/.test(field[2])) throw new Error("Invalid Office part entry")
    var label = String(new java.lang.String(java.util.Base64.getDecoder().decode(field[1]), "UTF-8"))
    return { ordinal: idx + 1, path: stage.resolve(field[0] + ".txt"), label: label, hash: field[2] }
  })
  var usedBytes = Number(files.size(manifest))
  parts.forEach(function(part) {
    if (!files.isRegularFile(part.path, java.nio.file.LinkOption.NOFOLLOW_LINKS)) throw new Error("Invalid staged Office part")
    usedBytes += Number(files.size(part.path))
    if (usedBytes > maximum) throw new Error("Office staging byte limit exceeded")
  })
  return { hash: hash, parts: parts, verify: digest, bytes: usedBytes }
}

// Keep large recovery payloads and source evidence out of the JSON journal and manifest.
MiniAIngest.prototype._officeBlob = function(wm, value) {
  var hash = String(sha256(value)), dir = new java.io.File(wm._getIndexRoot() + "/.mini-a-wiki-ingest/office-blobs")
  if (java.nio.file.Files.isSymbolicLink(dir.toPath()) || !dir.isDirectory() && !dir.mkdirs()) throw new Error("Cannot create Office payload directory")
  var target = new java.io.File(dir, hash + ".txt")
  if (target.isFile() && !java.nio.file.Files.isSymbolicLink(target.toPath()) && String(sha256(io.readFileString(String(target)))) === hash) return hash
  var temp = java.nio.file.Files.createTempFile(dir.toPath(), "part-", ".tmp")
  try {
    io.writeFileString(String(temp), value)
    this._syncState(String(temp), false)
    java.nio.file.Files.move(temp, target.toPath(), java.nio.file.StandardCopyOption.ATOMIC_MOVE, java.nio.file.StandardCopyOption.REPLACE_EXISTING)
    this._syncState(String(dir), true)
  } finally { java.nio.file.Files.deleteIfExists(temp) }
  return hash
}

// Plan a single document revision. Each staged part is held only while its page is prepared.
MiniAIngest.prototype._planOffice = function(wm, src, stage, context) {
  var self = this, state = context.state, result = context.result, paths = context.paths
  var key = src.sourceKey, previous = state.sources[key], changes = []
  var index = previous && previous.page || this._wikiPathFor(context.section, src)
  if (!previous && (/(^|\/)(index|AGENTS|log)\.md$/i.test(index) || paths[index] || this._page(wm, index))) {
    index = index.replace(/\.md$/, "-" + key.substring(0, 12) + ".md")
  }
  var folder = index.replace(/\.md$/, "-parts")
  var title = src.rel.split("/").pop()
  var retained = {}, seen = {}
  var labelFor = function(label) {
    return String(label).replace(/[\r\n\x00-\x1f]/g, " ").replace(/[<>&]/g, function(c) {
      return { "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]
    }).replace(/[\\\x60*_[\]()]/g, "\\$&")
  }
  var describe = function(id, proposed, label, body, content) {
    var partKey = id === "" ? key : sha1(key + "|office|" + id)
    var prev = state.sources[partKey], path = prev && prev.page || proposed
    var page = self._page(wm, path), before = self._signature(page)
    if (seen[path] || paths[path] && paths[path] !== partKey || page && !prev ||
        prev && (prev.scopeId !== context.scope || prev.source !== src.rel || !prev.signature || page && prev.signature !== before)) {
      throw new Error("Office page ownership or local edit conflict: " + path)
    }
    seen[path] = true
    retained[partKey] = true
    var hash = String(sha1(body)), meta = {
      title: label, description: "Imported from " + title, type: "reference", tags: [], source: src.rel,
      source_ref: context.origin, source_hash: hash, ingest_scope: context.scope, ingest_source_key: partKey
    }
    if (id !== "") meta.source_locator = label
    var after = self._signature({ meta: meta, body: body })
    if (prev && prev.officeParent === key && prev.officeDigest === stage.hash && before === after && prev.officeFingerprint === context.fingerprint && !context.force) return
    var change = { key: partKey, path: path, before: before, after: after, meta: meta, hash: hash, chunks: [] }
    if (!context.dry) change.bodyRef = self._officeBlob(wm, body)
    if (isString(content)) {
      var unit = { id: id, rel: src.rel, sourceKey: partKey }
      var chunks = self._chunkRecords(wm, unit, content), prior = Object.create(null)
      ;(prev && prev.chunks || []).forEach(function(chunk) { prior[chunk.id] = chunk.hash })
      result.chunks_discovered += chunks.length
      chunks.forEach(function(chunk) {
        if (prior[chunk.id] === chunk.hash) result.chunks_reused++
        else if (prior[chunk.id]) result.chunks_changed++
        else result.chunks_added++
        if (!context.dry) {
          chunk.textRef = self._officeBlob(wm, chunk.text)
          chunk.sourceLocator = label
          delete chunk.text
          change.chunks.push(chunk)
        }
      })
    }
    changes.push(change)
  }
  // Preserve original source provenance while using predictable child paths.
  var links = [], continuations = Object.create(null)
  stage.parts.forEach(function(part) {
    var unit = part.label.replace(/, (rows|paragraphs) [0-9]+–[0-9]+$/, "")
    var ordinal = (continuations[unit] || 0) + 1
    continuations[unit] = ordinal
    var slug = unit.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").substring(0, 50) || "part"
    var id = slug + "-" + sha1(unit).substring(0, 10) + "-" + ordinal
    var partKey = sha1(key + "|office|" + id)
    var path = state.sources[partKey] ? state.sources[partKey].page : folder + "/" + id + ".md"
    if (java.nio.file.Files.isSymbolicLink(part.path) || Number(java.nio.file.Files.size(part.path)) > 65536) throw new Error("Invalid staged Office part")
    var text = io.readFileString(String(part.path))
    if (String(sha256(text)) !== part.hash) throw new Error("Office staged part checksum mismatch")
    var heading = String(part.label).substring(0, 500)
    var fence = String(text).match(/`+/g) || []
    var longest = fence.reduce(function(n, value) { return Math.max(n, value.length) }, 2)
    var delimiter = new Array(longest + 2).join("`")
    describe(id, path, heading, "# " + labelFor(heading) + "\n\n" + delimiter + "text\n" + text + "\n" + delimiter + "\n", text)
    links.push({ title: heading, path: path })
  })
  var link = function(from, target, label) { return "- [" + labelFor(label) + "](" + wm._relativePath(from, target) + ")\n" }
  var indexBody = "# " + labelFor(title) + "\n\n"
  for (var offset = 0; offset < links.length; offset += 100) {
    var group = links.slice(offset, offset + 100)
    if (links.length <= 100) {
      group.forEach(function(item) { indexBody += link(index, item.path, item.title) })
    } else {
      var id = "contents-" + (Math.floor(offset / 100) + 1), pageKey = sha1(key + "|office|" + id)
      var path = state.sources[pageKey] ? state.sources[pageKey].page : folder + "/" + id + ".md"
      var label = "Parts " + (offset + 1) + "–" + (offset + group.length)
      var body = "# " + label + "\n\n"
      group.forEach(function(item) { body += link(path, item.path, item.title) })
      describe(id, path, label, body)
      indexBody += link(index, path, label)
    }
  }
  describe("", index, title, indexBody)
  var retired = []
  if (context.prune) Object.keys(state.sources).forEach(function(id) {
    var old = state.sources[id]
    if (old.officeParent !== key || retained[id]) return
    var page = self._page(wm, old.page), before = self._signature(page)
    if (page && before !== old.signature || Object.keys(state.sources).some(function(other) { return other !== id && state.sources[other].page === old.page })) {
      throw new Error("Office child page ownership or local edit conflict: " + old.page)
    }
    retired.push({ kind: "delete", path: old.page, before: before, key: id })
  })
  if (stage.verify() !== stage.hash) throw new Error("Office source changed during reconciliation")
  changes.forEach(function(change) {
    paths[change.path] = change.key
    result.planned_writes.push(change.path)
  })
  retired.forEach(function(op) { result.planned_removals.push(op.path) })
  if (changes.length || retired.length) result.sources_changed++
  else result.skipped_unchanged++
  if (result.eligible_sources) result.eligible_sources.push(src.rel)
  if (!result.office_documents) result.office_documents = []
  result.office_documents.push({ source: src.rel, index: index, parts: stage.parts.length, extraction: "structured", mode: "normalize" })
  return { path: index, changes: changes, retired: retired, verify: stage.verify, hash: stage.hash, key: key, source: src.rel }
}

// Commit prepared Office metadata and page references through the normal ingestion journal.
MiniAIngest.prototype._appendOfficeOperations = function(state, plan, operations, oldIds, generation, scope, fingerprint, discoveryConfig, result, allowPrune) {
  var self = this
  var revoke = function(key) {
    self._invalidate(state, key, result)
    ;(state.sources[key] && state.sources[key].chunks || []).forEach(function(c) { oldIds.push(c.id) })
  }
  plan.changes.forEach(function(change) {
    revoke(change.key)
    change.chunks.forEach(function(chunk) {
      chunk.page = change.path
      chunk.sourceKey = change.key
      chunk.generation = generation
      state.chunks[chunk.id] = chunk
    })
    state.sources[change.key] = { scopeId: scope, sourceKey: change.key, source: plan.source, sourceId: plan.source,
      officeParent: plan.key, officeDigest: plan.hash, officeFingerprint: fingerprint,
      sourceHash: change.hash, fingerprint: fingerprint, discoveryConfig: discoveryConfig, page: change.path,
      chunks: change.chunks, generation: generation, signature: change.after, active: true }
    operations.push({ kind: "write", path: change.path, before: change.before, after: change.after, meta: change.meta, bodyRef: change.bodyRef })
  })
  plan.retired.forEach(function(op) {
    if (!allowPrune) {
      result.prune_blocked.push({ page: op.path, reason: "reconciliation has failures, deferrals or conflicts" })
      return
    }
    revoke(op.key)
    delete state.sources[op.key]
    delete state.pages[op.path]
    delete state.dependencies[op.path]
    operations.push(op)
  })
}
