// Recursive local folder transactions. The journal survives until publication;
// snapshots live beside the wiki so subsequent snapshots never contain themselves.
var __miniAWikiFolder = {
  noLinks: function(path) {
    var file = new java.io.File(String(path)).getAbsoluteFile()
    for (var f = file; f; f = f.getParentFile()) {
      if (java.nio.file.Files.isSymbolicLink(f.toPath())) throw new Error("folder-symlink: " + path)
    }
    return file
  },
  hash: function(file) {
    var input = new java.io.FileInputStream(file), digest = java.security.MessageDigest.getInstance("SHA-256")
    var bytes = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 65536), n
    try { while ((n = input.read(bytes)) !== -1) digest.update(bytes, 0, n) } finally { input.close() }
    return String(new java.math.BigInteger(1, digest.digest()).toString(16))
  },
  scan: function(root) {
    var out = Object.create(null), self = this
    this.noLinks(root)
    function walk(dir, prefix) {
      var entries = dir.listFiles()
      if (entries === null) throw new Error("folder-unreadable: " + prefix)
      for (var i = 0; i < entries.length; i++) {
        var f = entries[i], path = prefix + String(f.getName())
        self.noLinks(String(f))
        if (path === ".mini-a-wiki-folders" || path === ".mini-a-wiki-ingest/writer.lock") continue
        if (f.isDirectory()) { out[path] = { directory: true }; walk(f, path + "/") }
        else if (f.isFile()) out[path] = { hash: self.hash(f), size: Number(f.length()) }
        else throw new Error("folder-special-file: " + path)
      }
    }
    walk(new java.io.File(root), "")
    return out
  },
  revision: function(entries) { return sha1(JSON.stringify(Object.keys(entries).sort().map(function(p) { return [p, entries[p]] }))) },
  path: function(manager, path) {
    if (!isString(path) || !path || /[\\:\x00-\x1f]/.test(path) || path.charAt(0) === "@" || path.split("/").some(function(p) { return !p || p === "." || p === ".." || /^\.mini-a|^\.git$/i.test(p) })) throw new Error("unsafe-folder-path")
    var root = manager._backend.root, f = this.noLinks(root + "/" + path)
    if (String(f.getCanonicalPath()).indexOf(root + "/") !== 0 || manager._isHiddenPath(path)) throw new Error("protected-folder-path")
    manager._fileAccess.assert(String(f))
    return f
  },
  pending: function(manager) {
    var root = manager._backend.root
    return manager._ingestJournalPaths().length || [".mini-a-wiki-absorb/journal.json", ".mini-a-wiki-move/journal.json", ".mini-a-wiki-maintenance/pending.json", ".mini-a-wiki-folders/pending.json"].some(function(p) { return io.fileExists(root + "/" + p) })
  },
  syncDirectory: function(file) {
    var channel = java.nio.channels.FileChannel.open(file.toPath(), java.nio.file.StandardOpenOption.READ)
    try { channel.force(true) } finally { channel.close() }
  },
  copy: function(root, destination, entries) {
    var self = this
    Object.keys(entries).sort().forEach(function(p) {
      var target = self.noLinks(destination + "/" + p)
      if (entries[p].directory) { if (!target.isDirectory() && !target.mkdirs()) throw new Error("folder-copy-directory-failed") }
      else {
        target.getParentFile().mkdirs()
        java.nio.file.Files.copy(self.noLinks(root + "/" + p).toPath(), target.toPath())
        var fd = new java.io.RandomAccessFile(target, "rw")
        try { fd.getFD().sync() } finally { fd.close() }
        if (self.hash(target) !== entries[p].hash) throw new Error("folder-snapshot-verification-failed: " + p)
      }
    })
    Object.keys(entries).filter(function(p) { return entries[p].directory }).sort().reverse().forEach(function(p) { self.syncDirectory(new java.io.File(destination + "/" + p)) })
    this.syncDirectory(new java.io.File(destination))
    this.syncDirectory(new java.io.File(destination).getParentFile())
  },
  remove: function(file) {
    this.noLinks(String(file))
    if (file.isDirectory()) {
      var files = file.listFiles()
      if (files === null) throw new Error("folder-unreadable")
      for (var i = 0; i < files.length; i++) this.remove(files[i])
    }
    java.nio.file.Files.delete(file.toPath())
  }
}

// Resolve every reference against its original page before applying the mapping.
// Code examples are left intact; inline, reference-style, image and wiki links
// share the same mapping, including links from outside the moved subtree.
MiniAWikiManager.prototype._rewriteFolderLinks = function(raw, page, nextPage, mapping, incoming) {
  var self = this
  function target(value, wiki) {
    if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|@)/i.test(value)) return value
    var suffix = value.search(/[?#]/), tail = suffix < 0 ? "" : value.substring(suffix), clean = suffix < 0 ? value : value.substring(0, suffix)
    var decoded
    try { decoded = decodeURIComponent(clean) } catch(e) { return value }
    var absolute = decoded.charAt(0) === "/", path
    if (wiki) path = self._wikiLinkTarget(decoded)
    else {
      var segments = (absolute ? decoded.substring(1) : self._pageDir(page) + decoded).split("/"), normalized = []
      for (var i = 0; i < segments.length; i++) {
        if (segments[i] === "..") { if (!normalized.length) return value; normalized.pop() }
        else if (segments[i] && segments[i] !== ".") normalized.push(segments[i])
      }
      path = normalized.join("/")
    }
    if (Object.prototype.hasOwnProperty.call(mapping, path) && incoming) incoming[path] = true
    var mapped = Object.prototype.hasOwnProperty.call(mapping, path) ? mapping[path] : path
    if (mapped === null || mapped === path && (wiki || page === nextPage || absolute)) return value
    var result = wiki ? mapped : absolute ? "/" + mapped : self._relativePath(nextPage, mapped)
    if (/\/$/.test(clean) && !/\/$/.test(result)) result += "/"
    return (/%[a-f0-9]{2}/i.test(clean) ? encodeURI(result).replace(/#/g, "%23").replace(/\?/g, "%3F") : result) + tail
  }
  var fenced = false, fence = ""
  return raw.split(/(\r?\n)/).map(function(line) {
    var marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (marker) { if (!fenced) { fenced = true; fence = marker[1] } else if (marker[1].charAt(0) === fence.charAt(0) && marker[1].length >= fence.length) fenced = false; return line }
    if (fenced) return line
    return line.split(/(`+[^`]*`+)/g).map(function(part) {
      if (part.charAt(0) === "`") return part
      part = part.replace(/\[\[([^\]|]+)(\|[^\]]*)?\]\]/g, function(full, url, label) { return "[[" + target(url, true) + (label || "") + "]]" })
      // Match delimiters once. The old nested-quantifier regex backtracked
      // exponentially on unfinished links in imported Markdown, holding the
      // Studio request/lock indefinitely even for a deletion preview.
      var brackets = [], parentheses = [], closes = Object.create(null), titles = Object.create(null), angle = false
      for (var i = 0; i < part.length; i++) {
        var ch = part.charAt(i)
        if (ch === "\\") { i++; continue }
        if (angle) { if (ch === ">") angle = false; continue }
        if (ch === "<" && part.charAt(i - 1) === "(" && part.charAt(i - 2) === "]") { angle = true; continue }
        if ((ch === '"' || ch === "'") && parentheses.length && /\s/.test(part.charAt(i - 1))) {
          var titleOpen = i, quote = ch
          for (i++; i < part.length; i++) {
            if (part.charAt(i) === "\\") { i++; continue }
            if (part.charAt(i) === quote) break
          }
          if (i < part.length) titles[parentheses[parentheses.length - 1]] = {start:titleOpen,end:i}
          continue
        }
        if (ch === "[") brackets.push(i)
        else if (ch === "]" && brackets.length) closes[brackets.pop()] = i
        else if (ch === "(") parentheses.push(i)
        else if (ch === ")" && parentheses.length) closes[parentheses.pop()] = i
      }
      var rewritten = [], copied = 0
      for (var i = 0; i < part.length; i++) {
        if (part.charAt(i) !== "[" || !Object.prototype.hasOwnProperty.call(closes, i)) continue
        var labelEnd = closes[i], open = labelEnd + 1, end = closes[open]
        if (part.charAt(open) !== "(" || !isNumber(end)) continue
        var dest = part.substring(open + 1, end), url = dest, title = "", wrapped = dest.charAt(0) === "<"
        if (wrapped) {
          var angleEnd = dest.indexOf(">")
          if (angleEnd < 0) continue
          url = dest.substring(1, angleEnd); title = dest.substring(angleEnd + 1)
        } else {
          var quoted = titles[open]
          if (quoted && quoted.end === end - 1) {
            var titleStart = quoted.start - open - 1
            while (titleStart > 0 && /\s/.test(dest.charAt(titleStart - 1))) titleStart--
            url = dest.substring(0, titleStart); title = dest.substring(titleStart)
          }
        }
        var revised = target(url, false)
        rewritten.push(part.substring(copied, open + 1), wrapped ? "<" + revised + ">" : revised, title, ")")
        copied = end + 1; i = end
      }
      rewritten.push(part.substring(copied)); part = rewritten.join("")
      part = part.replace(/<(?:a|img|video|audio|source)\b[^>]*>/gi, function(tag) {
        return tag.replace(/(\s(?:href|src|poster)\s*=\s*)(["'])(.*?)\2/gi, function(full, prefix, quote, url) { return prefix + quote + target(url, false) + quote })
      })
      return part.replace(/^(\s{0,3}\[[^\]]+\]:\s*)(<[^>]+>|\S+)(.*)$/, function(full, start, url, rest) { var angle = url.charAt(0) === "<"; return start + (angle ? "<" + target(url.slice(1,-1), false) + ">" : target(url, false)) + rest })
    }).join("")
  }).join("")
}

// A transfer is a list of {from, to|null} entries; each source is a file or a folder.
// "folder" keeps the historical single-folder error codes, "selection" is used for batches.
MiniAWikiManager.prototype._transferPlan = function(entries, opts) {
  var prefix = opts && opts.codePrefix || "selection", fail = function(code, extra) { return new Error(prefix + "-" + code + (extra ? ": " + extra : "")) }
  if (this._catalog || this._backendType !== "fs" || this._archiveRoot) throw fail("operations-require-local-filesystem")
  if (!isArray(entries) || !entries.length) throw fail("empty")
  var deleting = entries[0].to === null, sources = Object.create(null), targets = Object.create(null), self = this
  entries.forEach(function(e) {
    if ((e.to === null) !== deleting) throw fail("mixed-operations")
    var src = __miniAWikiFolder.path(self, e.from), dst = e.to === null ? null : __miniAWikiFolder.path(self, e.to)
    if (!src.exists()) throw fail("not-found", prefix === "folder" ? __ : e.from)
    if (prefix === "folder" && !src.isDirectory()) throw fail("not-found")
    if (src.isFile() && (/(^|\/)(AGENTS|index|log)\.md$/i.test(e.from))) throw fail("protected", e.from)
    if (sources[e.from]) throw fail("overlap", e.from)
    sources[e.from] = true
    if (dst) {
      if (e.to === e.from || e.to.indexOf(e.from + "/") === 0) throw fail("destination-inside-source", prefix === "folder" ? __ : e.to)
      if (dst.exists()) throw fail("destination-exists", prefix === "folder" ? __ : e.to)
      if (!dst.getParentFile().isDirectory()) throw fail("destination-parent-not-found", prefix === "folder" ? __ : e.to)
      if (targets[e.to]) throw fail("destination-collision", e.to)
      targets[e.to] = true
    }
  })
  Object.keys(sources).forEach(function(p) { entries.forEach(function(e) { if (e.from !== p && e.from.indexOf(p + "/") === 0) throw fail("overlap", e.from) }) })
  if (!deleting) Object.keys(targets).forEach(function(t) { var parent = t.indexOf("/") < 0 ? "" : t.substring(0, t.lastIndexOf("/")); for (var d = parent; d; d = d.indexOf("/") < 0 ? "" : d.substring(0, d.lastIndexOf("/"))) if (sources[d]) throw fail("destination-in-selection", t) })
  if (__miniAWikiFolder.pending(this)) throw fail("recovery-pending")
  var inventory = __miniAWikiFolder.scan(this._backend.root), mapping = Object.create(null), pages = [], updates = Object.create(null), incoming = [], files = 0, folders = 0
  var target = Object.create(null); entries.forEach(function(e) { target[e.from] = e.to })
  var owner = function(p) { for (var d = p; d; d = d.indexOf("/") < 0 ? "" : d.substring(0, d.lastIndexOf("/"))) if (d in target) return d; return null }
  Object.keys(inventory).sort().forEach(function(p) {
    var from = owner(p)
    if (from === null) return
    if (p.split("/").some(function(s) { return /^\.mini-a|^\.git$/i.test(s) }) || self._isHiddenPath(p)) throw prefix === "folder" ? new Error("protected-folder-content: " + p) : fail("protected", p)
    mapping[p] = target[from] === null ? null : target[from] + p.substring(from.length)
    if (inventory[p].directory) folders++
    else { files++; if (/\.md$/i.test(p)) pages.push(p) }
  })
  Object.keys(inventory).sort().forEach(function(p) {
    if (inventory[p].directory || !/\.md$/i.test(p) || self._isHiddenPath(p) || /^\.mini-a/.test(p)) return
    var raw = io.readFileString(self._backend.root + "/" + p), refs = Object.create(null), next = mapping[p] || p
    var after = self._rewriteFolderLinks(raw, p, next, mapping, refs)
    if (!Object.prototype.hasOwnProperty.call(mapping, p) && Object.keys(refs).length) incoming.push({path:p, targets:Object.keys(refs).sort()})
    if (!deleting && raw !== after) updates[p] = {path:next, before:raw, raw:after}
  })
  var revisionInventory = {}
  Object.keys(inventory).forEach(function(p) { if (!/^\.mini-a/.test(p)) revisionInventory[p] = inventory[p] })
  var preview = prefix === "folder"
    ? {ok:true, operation:deleting ? "delete" : "move", source:entries[0].from, destination:entries[0].to, pages:pages.length, files:files, folders:folders, incomingLinks:incoming, revision:__miniAWikiFolder.revision(revisionInventory)}
    : {ok:true, operation:deleting ? "selection-delete" : "selection-move", entries:entries.map(function(e) { return {from:e.from, to:e.to, kind:inventory[e.from] && inventory[e.from].directory ? "folder" : "file"} }), pages:pages.length, files:files, folders:folders, incomingLinks:incoming, revision:__miniAWikiFolder.revision(revisionInventory), confirmation:deleting ? "delete " + entries.length + (entries.length === 1 ? " item" : " items") : ""}
  return { preview: preview, inventory:inventory, mapping:mapping, pages:pages, updates:updates, entries:entries }
}
MiniAWikiManager.prototype._folderPlan = function(from, to) {
  return this._transferPlan([{from:from, to:to}], {codePrefix:"folder"})
}
MiniAWikiManager.prototype.previewFolder = function(from, to) {
  try { return this._folderPlan(from, isDef(to) ? to : null).preview } catch(e) { return {ok:false,error:__miniAErrMsg(e)} }
}
MiniAWikiManager.prototype.moveFolder = function(from, to, options) { return this._changeFolder(from, to, options) }
MiniAWikiManager.prototype.deleteFolder = function(from, options) { return this._changeFolder(from, null, options) }
MiniAWikiManager.prototype._changeFolder = function(from, to, options) { return this._changeTransfer([{from:from, to:to}], options, "folder") }

// Selections: several files and/or folders moved or deleted in one verified transaction.
MiniAWikiManager.prototype._selectionEntries = function(items, destination) {
  var self = this
  if (!isArray(items) || !items.length) throw new Error("selection-empty")
  if (items.length > 500) throw new Error("selection-too-large")
  var list = items.map(function(i) { if (!isString(i)) throw new Error("selection-invalid-item"); return i.trim().replace(/\/+$/, "") })
  if (destination === null || !isDef(destination)) return list.map(function(from) { return {from:from, to:null} })
  var dest = String(destination).trim().replace(/^\/+|\/+$/g, "")
  if (dest) {
    var folder = __miniAWikiFolder.path(this, dest)
    if (!folder.isDirectory()) throw new Error("selection-destination-not-found: " + dest)
    list.forEach(function(from) { if (dest === from || dest.indexOf(from + "/") === 0) throw new Error("selection-destination-inside-source: " + from) })
  }
  return list.map(function(from) { return {from:from, to:(dest ? dest + "/" : "") + from.substring(from.lastIndexOf("/") + 1)} })
}
MiniAWikiManager.prototype.previewSelection = function(items, destination) {
  try { return this._transferPlan(this._selectionEntries(items, destination), {codePrefix:"selection"}).preview } catch(e) { return {ok:false,error:__miniAErrMsg(e)} }
}
MiniAWikiManager.prototype.moveSelection = function(items, destination, options) {
  try { if (!isString(destination)) throw new Error("selection-destination-required"); return this._changeTransfer(this._selectionEntries(items, destination), options, "selection") } catch(e) { return {ok:false,error:__miniAErrMsg(e)} }
}
MiniAWikiManager.prototype.deleteSelection = function(items, options) {
  try { return this._changeTransfer(this._selectionEntries(items, null), options, "selection") } catch(e) { return {ok:false,error:__miniAErrMsg(e)} }
}
// A folder is a section: <folder>/index.md. Works on any writable backend.
MiniAWikiManager.prototype.createFolder = function(path, options) {
  if (this._access !== "rw") return { ok: false, error: this._readOnlyError("wiki is read-only (wikiaccess=ro)") }
  try {
    var section = this._normalizeSectionPath(path)
    var folder = section.replace(/\/$/, "")
    if (!folder || /^\.mini-a|(^|\/)\.(mini-a|git)/i.test(folder) || this._isHiddenPath(section + "index.md")) throw new Error("protected-folder-path")
    if (this._backend.exists(section + "index.md")) throw new Error("folder-exists: " + folder)
    var done = this.init(folder)
    if (!done || done.ok !== true) return done || { ok: false, error: "folder-create-failed" }
    return { ok: true, path: folder, index: section + "index.md", created: done.created }
  } catch(e) { return { ok: false, error: __miniAErrMsg(e) } }
}
MiniAWikiManager.prototype._changeTransfer = function(entries, options, codePrefix) {
  var opts = options || {}, lock, journal, root = this._backend && this._backend.root, priorBatch, priorOrigins, stateCaptured = false
  var from = entries[0].from, to = entries[0].to, prefix = codePrefix || "selection"
  try {
    if (this._access !== "rw") throw new Error(prefix + "-wiki-read-only")
    if (this._backendType !== "fs" || this._catalog || this._archiveRoot) throw new Error("folder-operations-require-local-filesystem")
    lock = __miniAWikiWriterLock(root)
    priorBatch = this._servingBatchChanges; priorOrigins = this._servingMoveOrigins; stateCaptured = true
    var plan = this._transferPlan(entries, {codePrefix:prefix}), self = this
    if (!opts.expectedRevision || opts.expectedRevision !== plan.preview.revision) throw new Error(prefix + "-stale-preview")
    if (to === null && opts.confirmation !== (prefix === "folder" ? from : plan.preview.confirmation)) throw new Error(prefix === "folder" ? "folder-exact-source-confirmation-required" : "selection-confirmation-required")
    if (isMap(priorBatch)) throw new Error("folder-conflicting-batch")
    if (!global.__miniAWikiKnowledge) loadLib(__miniAPath("js/wiki/mini-a-wiki-knowledge.js"))
    global.__miniAWikiKnowledge.install(this)
    var state = this.knowledgeLoadState()
    if (state._corrupt) throw new Error("folder-corrupt-ownership")
    if (prefix !== "folder" && to !== null) {
      // Mirrors knowledgeMove: never land on a path an ingestion source still owns.
      var targetPaths = Object.create(null)
      Object.keys(plan.mapping).forEach(function(p) { if (plan.mapping[p]) targetPaths[plan.mapping[p]] = true })
      Object.keys(state.sources).forEach(function(key) { var owned = state.sources[key].page; if (targetPaths[owned] && !Object.prototype.hasOwnProperty.call(plan.mapping, owned)) throw new Error("selection-target-owned-by-ingestion: " + owned) })
    }
    var owners = {}
    Object.keys(state.sources).forEach(function(key) {
      var owner = state.sources[key], old = owner.page, next = plan.mapping[old], update = plan.updates[old]
      if (Object.prototype.hasOwnProperty.call(plan.mapping, old)) {
        if (owners[old]) throw new Error("folder-ambiguous-ownership")
        owners[old] = true
        if (next === null) { delete state.sources[key]; Object.keys(state.chunks).forEach(function(id) { if (state.chunks[id].sourceKey === key) delete state.chunks[id] }); return }
        owner.page = next
        ;(owner.chunks || []).forEach(function(chunk) { chunk.page = next })
        Object.keys(state.chunks).forEach(function(id) { if (state.chunks[id].sourceKey === key) state.chunks[id].page = next })
      }
      if (update && owner.signature === self.knowledgePageSignature(self.parseFrontmatter(update.before))) owner.signature = self.knowledgePageSignature(self.parseFrontmatter(update.raw))
    })
    // Drop affected derivatives; untouched enrichment remains reusable.
    var affected = function(p) { return Object.prototype.hasOwnProperty.call(plan.mapping, p) || !!plan.updates[p] }
    ;[state.pages, state.summaries.pages, state.summaries.sections].forEach(function(map) { Object.keys(map || {}).forEach(function(p) { if (affected(p) || p === "" || p === "index.md" || entries.some(function(en) { var sec = p.replace(/\/$/, "") + "/"; return en.from.indexOf(sec) === 0 || en.to !== null && en.to.indexOf(sec) === 0 }) || (map[p].passageSupports || []).some(function(ref) { return affected(ref.page) })) delete map[p] }) })
    ;["facts", "concepts"].forEach(function(kind) { Object.keys(state[kind] || {}).forEach(function(k) { if ((state[kind][k].passageSupports || []).some(function(ref) { return affected(ref.page) })) state[kind][k].invalidated = true }) })
    ;[state.dependencies, state.derivativeRegistry.byPage].forEach(function(map) { Object.keys(map || {}).forEach(function(p) { if (affected(p)) delete map[p] }) })
    var id = String(java.util.UUID.randomUUID()), snapshot = root + ".mini-a-folder-recovery/" + id
    __miniAWikiFolder.noLinks(snapshot)
    new java.io.File(snapshot).mkdirs()
    java.nio.file.Files.setPosixFilePermissions(new java.io.File(root + ".mini-a-folder-recovery").toPath(), java.nio.file.attribute.PosixFilePermissions.fromString("rwx------"))
    java.nio.file.Files.setPosixFilePermissions(new java.io.File(snapshot).toPath(), java.nio.file.attribute.PosixFilePermissions.fromString("rwx------"))
    if (isFunction(opts.onProgress)) opts.onProgress("Creating and verifying recovery snapshot")
    __miniAWikiFolder.copy(root, snapshot, plan.inventory)
    if (__miniAWikiFolder.revision(__miniAWikiFolder.scan(snapshot)) !== __miniAWikiFolder.revision(plan.inventory)) throw new Error("folder-snapshot-incomplete")
    var backup = isFunction(opts.snapshot) ? opts.snapshot() : null
    if (this._transferPlan(entries, {codePrefix:prefix}).preview.revision !== plan.preview.revision || __miniAWikiFolder.revision(__miniAWikiFolder.scan(root)) !== __miniAWikiFolder.revision(plan.inventory)) throw new Error("folder-changed-during-snapshot")
    journal = {version:1,id:id,root:root,source:from,destination:to,entries:entries,snapshot:snapshot,backupId:backup && backup.id,phase:"prepared",inventory:plan.inventory,mapping:plan.mapping,preview:plan.preview}
    var journalPath = root + "/.mini-a-wiki-folders/pending.json"
    __miniAWikiMaintenanceJson(journalPath, journal)
    if (isFunction(opts.onProgress)) opts.onProgress("Applying recursive folder changes")
    entries.slice().sort(function(x, y) { return x.from < y.from ? -1 : 1 }).forEach(function(en) {
      if (en.to === null) __miniAWikiFolder.remove(new java.io.File(root + "/" + en.from))
      else java.nio.file.Files.move(new java.io.File(root + "/" + en.from).toPath(), new java.io.File(root + "/" + en.to).toPath())
    })
    Object.keys(plan.updates).forEach(function(p) { var update = plan.updates[p]; self._backend.write(update.path, update.raw) })
    if (!this.knowledgeSaveState(state)) throw new Error("folder-ownership-save-failed")
    this._invalidateReadCache()
    this._servingBatchChanges = {}; this._servingMoveOrigins = {}
    plan.pages.forEach(function(p) { self._metaRemove(p); self._servingBatchChanges[p] = true; if (to !== null) { self._servingBatchChanges[plan.mapping[p]] = true; self._servingMoveOrigins[plan.mapping[p]] = p } })
    Object.keys(plan.updates).forEach(function(p) { self._servingBatchChanges[plan.updates[p].path] = true })
    // Existing Markdown indexes are content: move rewrites their references, and
    // deletion retains dangling links for lint. Derived tree/browse indexes are
    // rebuilt from the final complete inventory in the single publication below.
    journal.phase = "publishing"; __miniAWikiMaintenanceJson(journalPath, journal)
    if (isFunction(opts.onProgress)) opts.onProgress("Publishing navigation, search and graph indexes")
    var savedGraph = this._graph, publication
    try { this._graph = __; publication = this.reindex({resetLucene:true}) } finally { this._graph = savedGraph }
    if (!publication || publication.ok !== true) throw new Error("folder-publication-failed: " + JSON.stringify(publication))
    if (this._graph) {
      var graph = this._graph, mapping = plan.mapping
      // Retarget old evidence before the structural rebuild; hash checks discard
      // evidence on pages whose Markdown actually changed.
      ;[graph._state.summaries.pages, graph._state.semantic_cache, graph._state.enrichment || {}].forEach(function(map) { Object.keys(mapping).forEach(function(p) { if (map[p]) { if (mapping[p]) map[mapping[p]] = map[p]; delete map[p] } }) })
      graph._state.edges.forEach(function(edge) { if (edge.props && mapping[edge.props.page]) edge.props.page = mapping[edge.props.page]; ["from","to"].forEach(function(k) { var p = String(edge[k]).replace(/^doc:/, ""); if (mapping[p]) edge[k] = "doc:" + mapping[p] }) })
      var graphResult = graph.buildStructural(this._graphPages(), {preview:true})
      // Dangling references stay in Markdown/lint, never as searchable documents.
      var missing = {}
      Object.keys(graph._state.nodes).forEach(function(id) { var node = graph._state.nodes[id]; if (node.type === "document" && node.props && !self._backend.exists(node.props.path)) { missing[id] = true; delete graph._state.nodes[id] } })
      graph._state.edges = graph._state.edges.filter(function(edge) { return !missing[edge.from] && !missing[edge.to] })
      graph._reindexEdges(); graph._markDerivedDirty(); graph._ensureDerived()
      var persisted = graph._persist()
      if (persisted && persisted.ok === false) throw new Error("folder-graph-publication-failed: " + persisted.error)
      if (graphResult && graphResult.ok === false) throw new Error("folder-graph-publication-failed")
    }
    Object.keys(this._metaDirty || {}).forEach(function(k) { self._saveMetaShard(k) })
    journal.phase = "complete"; __miniAWikiMaintenanceJson(root + "/.mini-a-wiki-folders/last.json", journal)
    java.nio.file.Files.delete(new java.io.File(journalPath).toPath())
    return merge(plan.preview, {ok:true, snapshot:snapshot, recoveryId:id, backupId:journal.backupId, publication:publication, recovery_pending:false, redirect_created:false})
  } catch(e) { return {ok:false,error:__miniAErrMsg(e),recovery_pending:!!journal,recoveryId:journal && journal.id,snapshot:journal && journal.snapshot} }
  finally { if (stateCaptured) { this._servingBatchChanges = priorBatch; this._servingMoveOrigins = priorOrigins } if (lock) lock.release() }
}

// Explicit rollback restores the verified full snapshot, including old indexes.
// Callers must close other readers first; the shared writer lock excludes writers.
MiniAWikiManager.prototype.restoreFolder = function(id) {
  var lock
  try {
    if (this._access !== "rw" || this._backendType !== "fs" || this._catalog) throw new Error("folder-restore-requires-writable-local-wiki")
    var root = this._backend.root
    lock = __miniAWikiWriterLock(root, {folderRecovery:true})
    var path = root + "/.mini-a-wiki-folders/pending.json", j = af.fromJson(io.readFileString(path))
    if (j.id !== id || !/^[a-f0-9-]{36}$/.test(id) || j.root !== root || j.snapshot !== root + ".mini-a-folder-recovery/" + id) throw new Error("folder-recovery-confirmation-mismatch")
    if (__miniAWikiFolder.revision(__miniAWikiFolder.scan(j.snapshot)) !== __miniAWikiFolder.revision(j.inventory)) throw new Error("folder-recovery-snapshot-corrupt")
    __miniAWikiFolder.scan(root)
    j.phase = "restoring"; __miniAWikiMaintenanceJson(path, j)
    this.close()
    this._metaDirty = {}; this._metaShards = {}; this._graph = __; this._searchIndex = __
    this._retrievalV2 = __; this._legacyRetrievalV2 = __
    var files = new java.io.File(root).listFiles()
    for (var i = 0; i < files.length; i++) {
      var name = String(files[i].getName())
      if (name === ".mini-a-wiki-folders") continue
      if (name === ".mini-a-wiki-ingest") { var children = files[i].listFiles(); for (var k = 0; k < children.length; k++) if (String(children[k].getName()) !== "writer.lock") __miniAWikiFolder.remove(children[k]); continue }
      __miniAWikiFolder.remove(files[i])
    }
    __miniAWikiFolder.copy(j.snapshot, root, j.inventory)
    if (__miniAWikiFolder.revision(__miniAWikiFolder.scan(root)) !== __miniAWikiFolder.revision(j.inventory)) throw new Error("folder-restore-verification-failed")
    java.nio.file.Files.delete(new java.io.File(path).toPath())
    this._invalidateReadCache()
    return {ok:true,restored:true,recoveryId:id,warning:"Reopen the wiki to use restored indexes"}
  } catch(e) { return {ok:false,error:__miniAErrMsg(e),recovery_pending:true} }
  finally { if (lock) lock.release() }
}
