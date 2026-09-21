// Author: OpenAF
// License: Apache 2.0
// Description: Wiki ingestion pipeline for Mini-A — turns a docs folder, a git repo or a
//              set of URLs into distilled, linked, indexed wiki pages.
//
// Pipeline: resolve -> inventory -> manifest/plan -> full-source transform -> journal -> finalize
// Everything except `distill` is deterministic. One source produces one wiki page;
// cross-page dedup and reorganisation are deliberately left to the wiki dream pass.

var MiniAIngest = function(ingestArgs, logFn) {
  this._args  = isMap(ingestArgs) ? merge({}, ingestArgs) : {}
  if (isObject(ingestArgs) && isObject(ingestArgs.wikimanager)) this._args.wikimanager = ingestArgs.wikimanager
  this._logFn = isFunction(logFn) ? logFn : log
  this._llm   = __   // injectable for tests
}

MiniAIngest.prototype._log = function(msg) {
  var out = isDef(msg) ? String(msg) : ""
  try { this._logFn(out) } catch(ignoreLog) {}
}

MiniAIngest.prototype._setLlm = function(llmInstance) {
  this._llm = llmInstance
}

MiniAIngest.prototype._getEnv = function(name) {
  try { return String(java.lang.System.getenv(name) || "") } catch(e) { return "" }
}

MiniAIngest.prototype._buildLlm = function() {
  if (isObject(this._llm)) return this._llm
  var raw = isString(this._args.model) && this._args.model.trim().length > 0 ? this._args.model.trim() : this._getEnv("OAF_MODEL")
  if (!isString(raw) || raw.trim().length === 0) return __
  try {
    var cfg = raw.trim().charAt(0) === "{" ? jsonParse(raw, __, __, true) : af.fromSLON(raw)
    if (!isMap(cfg)) return __
    return $llm(cfg)
  } catch(e) {
    this._log("[ingest] Could not build LLM: " + __miniAErrMsg(e))
    return __
  }
}

// ── configuration helpers ────────────────────────────────────

MiniAIngest.prototype._num = function(name, dflt) {
  var v = this._args[name]
  if (isNumber(v)) return v
  var n = Number(v)
  return isNaN(n) ? dflt : n
}

MiniAIngest.prototype._csv = function(name) {
  var v = this._args[name]
  if (!isString(v) || v.trim().length === 0) return []
  return v.split(",").map(function(s) { return String(s).trim() }).filter(function(s) { return s.length > 0 })
}

// ── phase 1: resolve ─────────────────────────────────────────

// _resolveSourceType: markdown | repo | url, inferred from the source when not given.
MiniAIngest.prototype._resolveSourceType = function(source) {
  var explicit = isString(this._args.ingesttype) ? this._args.ingesttype.trim().toLowerCase() : "auto"
  if (["markdown", "repo", "url"].indexOf(explicit) >= 0) return explicit
  var s = String(source || "").trim()
  if (/^https?:\/\//i.test(s)) return /\.git$/i.test(s) || /github\.com|gitlab\.com|bitbucket\.org/i.test(s) ? "repo" : "url"
  if (io.fileExists(s + "/.git")) return "repo"
  return "markdown"
}

// _resolve: returns { ok, type, root, ref, cleanup } — `root` is a local directory for
// markdown/repo sources, or undefined for url sources.
MiniAIngest.prototype._resolve = function(source) {
  var type = this._resolveSourceType(source)
  var s = String(source || "").trim()

  if (type === "url") return { ok: true, type: "url", urls: [s] }

  if (type === "repo" && /^https?:\/\//i.test(s)) {
    var tmp = ""
    try {
      tmp = io.createTempDir("mini_a_ingest_repo_")
      var cmd = ["git", "clone", "--depth", "1", s, tmp].map(function(x) { return String(x) })
      var pb = new java.lang.ProcessBuilder(cmd)
      pb.redirectErrorStream(true)
      var proc = pb.start()
      var rc = proc.waitFor()
      if (rc !== 0) { io.rm(tmp); return { ok: false, error: "git clone failed (exit " + rc + ") for " + s } }
      return { ok: true, type: "repo", root: tmp, ref: this._gitHead(tmp), cleanup: tmp, origin: s }
    } catch(e) {
      if (tmp) try { io.rm(tmp) } catch(ignoreTmp) {}
      return { ok: false, error: "git clone error: " + __miniAErrMsg(e) }
    }
  }

  if (!io.fileExists(s)) return { ok: false, error: "source not found: " + s }
  var canonical = String(new java.io.File(s).getCanonicalPath())
  return { ok: true, type: type, root: canonical, ref: type === "repo" ? this._gitHead(canonical) : __ }
}

MiniAIngest.prototype._gitHead = function(dir) {
  try {
    var pb = new java.lang.ProcessBuilder(["git", "-C", String(dir), "rev-parse", "HEAD"].map(function(x) { return String(x) }))
    pb.redirectErrorStream(true)
    var proc = pb.start()
    var out = String(af.fromInputStream2String(proc.getInputStream()) || "").trim()
    proc.waitFor()
    return out.length >= 7 ? out : __
  } catch(e) {
    return __
  }
}

// ── phase 2: discover ────────────────────────────────────────

var _INGEST_DEFAULT_EXCLUDES = [
  "/.git/", "/node_modules/", "/target/", "/build/", "/dist/", "/vendor/",
  "/.venv/", "/__pycache__/", "/.idea/", "/.vscode/"
]

MiniAIngest.prototype._shouldSkipPath = function(rel) {
  var probe = "/" + String(rel).replace(/\\/g, "/") + "/"
  for (var i = 0; i < _INGEST_DEFAULT_EXCLUDES.length; i++) {
    if (probe.indexOf(_INGEST_DEFAULT_EXCLUDES[i]) >= 0) return true
  }
  var excludes = this._csv("ingestexclude")
  for (var j = 0; j < excludes.length; j++) {
    if (probe.toLowerCase().indexOf(String(excludes[j]).toLowerCase()) >= 0) return true
  }
  var includes = this._csv("ingestinclude")
  if (includes.length > 0) {
    for (var k = 0; k < includes.length; k++) {
      if (probe.toLowerCase().indexOf(String(includes[k]).toLowerCase()) >= 0) return false
    }
    return true
  }
  return false
}

// _discover: lists candidate source documents under a resolved root.
// Returns [{ id, path, rel, size }] ordered so README/docs come first.
MiniAIngest.prototype._discover = function(resolved) {
  var self = this
  var root = String(resolved.root)
  var maxKb = this._num("ingestmaxfilekb", 512)
  var out = []
  var skippedLarge = [], present = {}, errors = [], complete = true, visited = {}

  var walk = function(dir) {
    if (visited[dir]) { complete = false; errors.push("repeated directory/symlink: " + dir); return }
    visited[dir] = true
    var listing
    try { listing = io.listFiles(dir); if (new java.io.File(dir).list() === null) throw new Error("directory inaccessible") } catch(e) { complete = false; errors.push(String(dir) + ": " + __miniAErrMsg(e)); return }
    if (!isMap(listing) || !isArray(listing.files)) { complete = false; errors.push("invalid listing: " + dir); return }
    listing.files.forEach(function(f) {
      var full = String(f.canonicalPath)
      if (full.indexOf(root + "/") !== 0) { complete = false; errors.push("path outside source root: " + full); return }
      var rel  = full.substring(root.length).replace(/^\//, "")
      if (rel.length === 0) return
      present[rel] = { ignored: self._shouldSkipPath(rel), directory: f.isDirectory, size: Number(f.size || 0), reason: self._shouldSkipPath(rel) ? "filtered" : "" }; if (self._shouldSkipPath(rel)) return
      if (f.isDirectory) { walk(full); return }
      if (!/\.(md|markdown|mdx|txt|rst|adoc|html?)$/i.test(rel)) { present[rel].ignored = true; present[rel].reason = "unsupported extension"; return }
      var kb = Number(f.size || 0) / 1024
      if (kb > maxKb) {
        // skip rather than silently truncate: a half-read document distills into a lie
        present[rel].ignored = true; present[rel].reason = "oversized"
        skippedLarge.push(rel + " (" + Math.round(kb) + "KB > ingestmaxfilekb=" + maxKb + ")")
        return
      }
      out.push({ id: rel, path: full, rel: rel, size: Number(f.size || 0) })
    })
  }
  walk(root)

  // README and docs/ first — they carry the orientation an agent needs most
  var rank = function(rel) {
    var lower = String(rel).toLowerCase()
    if (/^readme\./.test(lower)) return 0
    if (lower.indexOf("docs/") === 0 || lower.indexOf("doc/") === 0) return 1
    return 2
  }
  out.sort(function(a, b) {
    var ra = rank(a.rel), rb = rank(b.rel)
    return ra !== rb ? ra - rb : (a.rel < b.rel ? -1 : (a.rel > b.rel ? 1 : 0))
  })

  skippedLarge.forEach(function(s) { self._log("[ingest] Skipped oversized source: " + s) })
  return { sources: out, skipped: skippedLarge, present: present, complete: complete, errors: errors }
}

// ── phase 3: ledger ──────────────────────────────────────────

MiniAIngest.prototype._ledgerPath = function(wm) {
  if (isString(this._args.ingestledger) && this._args.ingestledger.trim().length > 0) return this._args.ingestledger.trim()
  return wm._getIndexRoot() + "/.mini-a-wiki-ingest/ledger.json"
}

MiniAIngest.prototype._loadLedger = function(wm) {
  var p = this._ledgerPath(wm)
  try {
    if (io.fileExists(p)) {
      var parsed = af.fromJson(io.readFileString(p))
      if (isMap(parsed)) return parsed
      throw new Error("invalid legacy ledger")
    }
  } catch(e) {
    throw new Error("legacy ledger unreadable: " + __miniAErrMsg(e))
  }
  return {}
}

// Compatibility export only; ingestion never uses the ledger as applied-state authority.
MiniAIngest.prototype._saveLedger = function(wm, ledger) {
  if (wm._access !== "rw") return false
  try { this._atomicJson(this._ledgerPath(wm), ledger); return true } catch(e) { return false }
}

// ── phase 4: chunk ───────────────────────────────────────────

// _chunk: heading-aware splitter. Splits on `##`/`###` boundaries into segments no larger
// than ingestchunkchars, falling back to paragraph splits for headingless prose.
MiniAIngest.prototype._chunk = function(text, maxChars) {
  var limit = isNumber(maxChars) && maxChars > 0 ? maxChars : this._num("ingestchunkchars", 24000)
  var body  = isString(text) ? text : ""
  if (body.length <= limit) return [body]

  var lines  = body.split(/\r?\n/)
  var blocks = []
  var current = []
  for (var i = 0; i < lines.length; i++) {
    if (/^#{2,3}\s+/.test(lines[i]) && current.length > 0) {
      blocks.push(current.join("\n"))
      current = []
    }
    current.push(lines[i])
  }
  if (current.length > 0) blocks.push(current.join("\n"))

  // headingless: fall back to paragraph blocks
  if (blocks.length === 1 && blocks[0].length > limit) {
    blocks = body.split(/\n\s*\n/)
  }

  var out = []
  var buf = ""
  blocks.forEach(function(b) {
    var piece = String(b)
    if (piece.length > limit) {
      // a single oversized block: hard-split it, nothing smarter is available
      if (buf.length > 0) { out.push(buf); buf = "" }
      for (var o = 0; o < piece.length; o += limit) out.push(piece.substring(o, o + limit))
      return
    }
    if (buf.length + piece.length + 2 > limit) {
      out.push(buf)
      buf = piece
    } else {
      buf = buf.length === 0 ? piece : (buf + "\n\n" + piece)
    }
  })
  if (buf.length > 0) out.push(buf)
  return out.filter(function(s) { return String(s).trim().length > 0 })
}

// Wiki keeps the source-to-page mapping compatible, but makes the work unit a stable
// heading-aware chunk.  The manager owns the shared implementation used by retrieval too.
MiniAIngest.prototype._chunkRecords = function(wm, source, text) {
  if (isFunction(wm.knowledgeChunks)) return wm.knowledgeChunks(String(source.rel || source.id), text, { maxChars: this._num("ingestchunkchars", 24000), namespace: source.sourceKey })
  return this._chunk(text).map(function(t, i) { return { id: sha1(String(source.id) + "#" + i), hash: sha1(t), normalizedHash: sha1(t), text: t, estimatedTokens: Math.ceil(t.length / 4), ordinal: i + 1 } })
}

MiniAIngest.prototype._ingestMode = function() {
  // An injected test/custom LLM historically meant “distill”; retain that explicit caller
  // intent while production defaults remain deterministic auto.
  var mode = isString(this._args.ingestmode) ? this._args.ingestmode.trim().toLowerCase() : (isObject(this._llm) ? "distill" : "auto")
  return ["auto", "normalize", "distill", "raw"].indexOf(mode) >= 0 ? mode : "auto"
}

MiniAIngest.prototype._normalizedPage = function(wm, source, content, mode) {
  var raw = mode === "raw" ? String(content) : (isFunction(wm.knowledgeNormalize) ? wm.knowledgeNormalize(content) : String(content))
  var title = String(source.rel || source.id || "source").replace(/\.[^.]+$/, "").replace(/[-_]/g, " ")
  var m = raw.match(/^#\s+(.+)$/m); if (m) title = m[1].trim()
  var desc = raw.replace(/^---[\s\S]*?---\s*/m, "").replace(/^#.*$/m, "").replace(/```[\s\S]*?```/g, "").replace(/\s+/g, " ").trim().substring(0, 280)
  if (!/^#\s+/m.test(raw)) raw = "# " + title + "\n\n" + raw
  return { title: title, description: desc, tags: [], type: "reference", body: raw }
}

// ── phase 5: distill ─────────────────────────────────────────

MiniAIngest.prototype._distillPrompt = function(source, chunks, siblings) {
  var sibList = (isArray(siblings) ? siblings : []).slice(0, 30)
    .map(function(s) { return "- " + s }).join("\n")
  return "You are distilling one source document into ONE wiki page for an agent-facing knowledge wiki.\n\n" +
    "Return ONLY a valid JSON object — no commentary, no markdown fences — with exactly these keys:\n" +
    '{ "title": string, "description": string, "tags": [string], "type": string, "body": string }\n\n' +
    "Rules:\n" +
    "- `title`: a short, specific noun phrase. Not the filename.\n" +
    "- `description`: one sentence stating what a reader learns here. This is what search returns.\n" +
    "- `type`: one of concept, procedure, reference, decision, note.\n" +
    "- `tags`: 2-6 lowercase single-word or hyphenated tags.\n" +
    "- `body`: markdown starting at heading level 1 (`# Title`). Distill — do not transcribe. Keep\n" +
    "  concrete facts, commands, names, numbers and constraints; drop boilerplate, badges, licence\n" +
    "  headers, tables of contents and navigation.\n" +
    "- Link to related sources with `[[Wiki Style Links]]` using the titles listed below when relevant.\n" +
    "- Never invent facts that are not in the source.\n\n" +
    "## Source\n" + String(source.rel || source.id) + "\n\n" +
    (sibList.length > 0 ? "## Other sources being ingested (for [[links]])\n" + sibList + "\n\n" : "") +
    "## Content\n" + chunks.join("\n\n---\n\n")
}

MiniAIngest.prototype._distill = function(llm, source, chunks, siblings) {
  var prompt = this._distillPrompt(source, chunks, siblings)
  try {
    var resp = isFunction(llm.promptJSONWithStats) ? llm.promptJSONWithStats(prompt)
             : isFunction(llm.promptWithStats)     ? llm.promptWithStats(prompt)
             : { response: llm.prompt(prompt), stats: {} }
    var raw = isMap(resp) && isDef(resp.response) ? resp.response : resp
    var page = __
    if (isString(raw)) {
      var cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim()
      page = jsonParse(cleaned, __, __, true)
    } else if (isMap(raw)) {
      page = raw
    }
    var err = this._validatePage(page)
    if (isString(err)) return { ok: false, error: err }
    return { ok: true, page: page }
  } catch(e) {
    return { ok: false, error: __miniAErrMsg(e) }
  }
}

MiniAIngest.prototype._validatePage = function(page) {
  if (!isMap(page)) return "response is not an object"
  if (!isString(page.title) || page.title.trim().length === 0) return "missing title"
  if (!isString(page.body) || page.body.trim().length === 0) return "missing body"
  if (isDef(page.tags) && !isArray(page.tags)) return "tags is not an array"
  return __
}

// ── phase 6: write ───────────────────────────────────────────

// _wikiPathFor: <section>/<slug>.md, derived from the source's relative path so that
// re-ingesting the same source targets the same page.
MiniAIngest.prototype._wikiPathFor = function(section, source) {
  var rel = String(source.rel || source.id || "page")
  var slug = rel.replace(/\.[^./]+$/, "")
             .replace(/[^A-Za-z0-9/_-]+/g, "-")
             .replace(/\/+/g, "-")
             .replace(/-+/g, "-")
             .replace(/^-|-$/g, "")
             .toLowerCase()
  if (slug.length === 0) slug = "page"
  var sect = isString(section) && section.trim().length > 0 ? section.trim().replace(/^\/+|\/+$/g, "") + "/" : ""
  return sect + slug + ".md"
}

// _defaultSection: a stable section name derived from the source root or URL host.
MiniAIngest.prototype._defaultSection = function(resolved, source) {
  if (isString(this._args.ingestsection) && this._args.ingestsection.trim().length > 0) {
    return this._args.ingestsection.trim().replace(/^\/+|\/+$/g, "")
  }
  var base = isString(resolved.origin) ? resolved.origin : (isString(resolved.root) ? resolved.root : String(source || ""))
  var name = String(base).replace(/\.git$/i, "").replace(/\/+$/, "").split("/").pop()
  name = String(name).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "").toLowerCase()
  return name.length > 0 ? name : "ingested"
}

// ── main entry ───────────────────────────────────────────────

// Sign meaningful metadata and body; write() maintains these four timestamps.
MiniAIngest.prototype._signature = function(page) {
  if (!isMap(page)) return ""
  var meta = page.meta || {}, stable = {}
  Object.keys(meta).sort().forEach(function(k) { if (["created", "updated", "timestamp", "ingested"].indexOf(k) < 0) stable[k] = meta[k] })
  return sha1(stringify(stable, __, "") + "\n" + String(page.body || "").trim())
}
MiniAIngest.prototype._destinationIdentity = function(wm) {
  if (wm._backendType === "fs") return "fs|" + String(new java.io.File(wm._backend.root).getCanonicalPath())
  return wm._getBackendIdentity()
}
MiniAIngest.prototype._page = function(wm, path) {
  var raw = wm._backend.read(path)
  return isString(raw) ? wm.parseFrontmatter(raw) : __
}
MiniAIngest.prototype._stateFingerprint = function(state) {
  var copy = af.fromJson(stringify(state, __, "")); delete copy.updated
  return sha1(stringify(copy, __, ""))
}
MiniAIngest.prototype._atomicJson = function(path, value) {
  var dir = new java.io.File(path).getParentFile(), tmp = path + ".tmp-" + java.util.UUID.randomUUID()
  try {
    if (!dir.exists() && !dir.mkdirs()) throw new Error("cannot create state directory")
    io.writeFileString(tmp, stringify(value, __, ""))
    java.nio.file.Files.move(new java.io.File(tmp).toPath(), new java.io.File(path).toPath(), java.nio.file.StandardCopyOption.ATOMIC_MOVE, java.nio.file.StandardCopyOption.REPLACE_EXISTING)
  } finally { try { new java.io.File(tmp).delete() } catch(ignore) {} }
}
MiniAIngest.prototype._invalidate = function(state, key, result) {
  var prev = state.sources[key]
  if (!isMap(prev)) return
  var queue = [prev.page].concat((prev.chunks || []).map(function(c) { return c.id })), seen = {}
  // Collect dependents before changing any edges. Preserve records with unknown provenance.
  while (queue.length) {
    var id = queue.shift(); if (seen[id]) continue; seen[id] = true
    ;(state.dependencies[id] || []).forEach(function(d) { if (!seen[d]) queue.push(d) })
  }
  var affected = function(id, record) {
    record = isMap(record) ? record : {}
    var refs = isArray(record.sourceKeys) ? record.sourceKeys : isArray(record.sources) ? record.sources : []
    return (isArray(record.passageSupports) && record.passageSupports.some(function(ref) { return isMap(ref) && ref.page === prev.page })) || seen[id] || record.sourceKey === key || seen[record.page] || refs.indexOf(key) >= 0 || (isArray(record.chunks) && record.chunks.some(function(c) { return seen[isMap(c) ? c.id : c] }))
  }
  Object.keys(state.facts || {}).forEach(function(id) {
    var f = state.facts[id]
    if (affected(id, f)) {
      f.invalidated = true; result.planned_derivatives_invalidated.push(id)
    }
  })
  ;[{ map: state.summaries.pages, kind: "page-summary" }, { map: state.summaries.sections, kind: "section-summary" }].forEach(function(summary) {
    Object.keys(summary.map || {}).forEach(function(id) {
      var record = summary.map[id]
      if (!affected(id, record)) return
      // Remove only this grounded summary's direct postings; preserve other edges.
      if (isMap(record) && isArray(record.passageSupports) && isMap(state.derivativeRegistry) && isMap(state.derivativeRegistry.byPage)) record.passageSupports.forEach(function(ref) {
        if (!isMap(ref) || !isString(ref.page)) return
        var typed = summary.kind + ":" + id, postings = state.derivativeRegistry.byPage[ref.page] || []
        postings = postings.filter(function(k) { return k !== typed })
        if (postings.length) state.derivativeRegistry.byPage[ref.page] = postings; else delete state.derivativeRegistry.byPage[ref.page]
        state.dependencies[ref.page] = (state.dependencies[ref.page] || []).filter(function(k) { return k !== typed })
      })
      delete summary.map[id]; result.planned_derivatives_invalidated.push(id)
    })
  })
}
MiniAIngest.prototype._collectChunks = function(state, oldIds, scope) {
  var referenced = {}
  Object.keys(state.sources).forEach(function(k) { (state.sources[k].chunks || []).forEach(function(c) { referenced[c.id] = true }) })
  Object.keys(state.chunks).forEach(function(id) {
    var c = state.chunks[id]
    if (c.sourceKey && state.sources[c.sourceKey] && state.sources[c.sourceKey].scopeId === scope && state.sources[c.sourceKey].sourceKey === c.sourceKey && !referenced[id]) oldIds.push(id)
  })
  var removed = 0
  oldIds.forEach(function(id) { if (!referenced[id] && state.chunks[id]) { delete state.chunks[id]; delete state.dependencies[id]; Object.keys(state.dependencies).forEach(function(k) { state.dependencies[k] = state.dependencies[k].filter(function(ref) { return ref !== id }) }); removed++ } })
  return removed
}
// A prepared journal contains full replacement pages and their expected preconditions.
// Replaying a write already applied is safe only when its resulting signature matches.
MiniAIngest.prototype._applyJournal = function(wm, journal, path, result) {
  var previous = wm._servingBatchChanges
  try {
    if (wm._retrievalV2) {
      wm._servingBatchChanges = {}
      journal.operations.forEach(function(op) { wm._servingBatchChanges[op.path] = true })
    }
    return this._applyJournalPages(wm, journal, path, result)
  } finally { wm._servingBatchChanges = previous }
}

MiniAIngest.prototype._exportCompletedServing = function(wm, result) {
  if (wm._retrievalV2 && wm._retrievalV2.config.bundlePath) result.finalize.bundle = wm._retrievalV2.exportBundle(wm._retrievalV2.config.bundlePath)
}

MiniAIngest.prototype._applyJournalPages = function(wm, journal, path, result) {
  var self = this
  if (journal.phase === "finalization-pending") {
    result.finalize = self._finalize(wm)
    if (!result.finalize || result.finalize.ok !== true || result.finalize.reindexed !== true || /^failed/.test(String(result.finalize.graph))) throw new Error("finalization failed during recovery")
    journal.phase = "complete"; self._atomicJson(path, journal)
    self._exportCompletedServing(wm, result)
    if (!new java.io.File(path).delete()) throw new Error("journal cleanup failed")
    return
  }
  for (var i = 0; i < journal.operations.length; i++) {
    var op = journal.operations[i]
    if (["write", "delete"].indexOf(op.kind) < 0 || !isString(op.path) || op.path !== __miniAWikiNormalizePath(op.path, { requireMarkdown: true }) || /(^|\/)(\.|@)/.test(op.path) || /(^|\/)(AGENTS|log|index)\.md$/i.test(op.path)) throw new Error("unsafe journal operation")
    var current = self._page(wm, op.path), sig = self._signature(current)
    if (op.kind === "write" && sig === op.after && sig !== op.before) continue
    if (op.kind === "delete" && op.sourceRoot && io.fileExists(op.sourceRoot + "/" + op.sourceRel)) throw new Error("prune source reappeared: " + op.sourceRel)
    if (op.kind === "delete" && !current) continue
    if (op.kind === "delete" && op.sourceRoot) {
      var observed = self._discover({ root: op.sourceRoot })
      if (!observed.complete || !Object.keys(observed.present).length && journal.allowEmptyPrune !== true) throw new Error("prune recovery inventory is incomplete or newly empty")
    }
    if (sig !== op.before) throw new Error("journal ownership conflict: " + op.path)
    var applied = op.kind === "write" ? wm.write(op.path, op.meta, op.body) : wm.delete(op.path)
    if (!isMap(applied) || applied.ok !== true) throw new Error(op.kind + " failed: " + op.path + " " + (applied && applied.error || ""))
    if (op.kind === "write") {
      if (self._signature(self._page(wm, op.path)) !== op.after) throw new Error("written page signature mismatch: " + op.path)
      result.written.push(op.path)
    } else result.removed.push(op.path)
  }
  journal.phase = "pages-applied"; self._atomicJson(path, journal)
  // Reload/check handled under the wiki-local lock. The journal is the recovery authority
  // until this atomic manifest replacement succeeds.
  var currentState = wm.knowledgeLoadState()
  if (currentState._corrupt) throw new Error("manifest unreadable during commit")
  if (currentState.ingestGeneration !== journal.generation) {
    if (journal.baseFingerprint && self._stateFingerprint(currentState) !== journal.baseFingerprint) throw new Error("manifest changed concurrently during application; recovery requires review")
    if (!wm.knowledgeSaveState(journal.state)) throw new Error("manifest persistence failed")
  }
  result.chunks_removed += Number(journal.chunksRemoved || 0)
  result.derivatives_invalidated = result.derivatives_invalidated.concat(journal.derivatives || [])
  result.migrated = result.migrated.concat(journal.migrations || [])
  result.repaired = result.repaired.concat(journal.repairs || [])
  journal.phase = "finalization-pending"; self._atomicJson(path, journal)
  result.finalize = self._finalize(wm)
  if (!isMap(result.finalize) || result.finalize.ok !== true || result.finalize.reindexed !== true || /^failed/.test(String(result.finalize.graph))) throw new Error("finalization failed")
  journal.phase = "complete"; self._atomicJson(path, journal)
  self._exportCompletedServing(wm, result)
  if (!new java.io.File(path).delete()) throw new Error("journal cleanup failed")
}
MiniAIngest.prototype.run = function() {
  var self = this, a = this._args, source = String(a.ingestsource || "").trim()
  var dry = toBoolean(a.ingestdryrun) === true || toBoolean(a.dryrun) === true, prune = toBoolean(a.ingestprune) === true
  var result = { ok: false, status: "failed", sync_complete: false, dryrun: dry, discovered: 0, skipped_unchanged: 0, sources_changed: 0,
    chunks_discovered: 0, chunks_reused: 0, chunks_added: 0, chunks_changed: 0, chunks_removed: 0, planned_chunks_removed: 0, llm_candidates: 0, llm_calls: 0,
    estimated_input_tokens: 0, deferred: [], failed: [], conflicts: [], prune_blocked: [], missing_sources: [], planned_writes: [], planned_removals: [],
    written: [], removed: [], derivatives_invalidated: [], planned_derivatives_invalidated: [], unresolved: [], migrated: [], planned_migrations: [], planned_repairs: [], repaired: [], persistence_failures: [], finalization_failures: [], skipped_oversized: [], finalize: __ }
  var resolved, wm, owns = false, lock, channel, file
  var acquireWriter = function(indexRoot) {
    var lockPath = indexRoot + "/.mini-a-wiki-ingest/writer.lock", parent = new java.io.File(lockPath).getParentFile()
    if (!parent.exists() && !parent.mkdirs()) throw new Error("cannot create ingestion lock directory")
    file = new java.io.RandomAccessFile(lockPath, "rw"); channel = file.getChannel(); lock = channel.tryLock()
    if (!lock) throw new Error("ingestion writer busy")
  }
  try {
    if (isDef(a.ingestmode) && ["auto", "normalize", "distill", "raw"].indexOf(String(a.ingestmode).trim().toLowerCase()) < 0) throw new Error("invalid ingestmode")
    if (!source) { result.reason = "no-source"; return result }
    if (toBoolean(a.usewiki) !== true) { result.reason = "usewiki-not-set"; return result }
    if (String(a.wikiaccess || "").trim().toLowerCase() === "ro" && !dry) { result.reason = "wiki-read-only"; return result }
    resolved = this._resolve(source)
    if (!resolved.ok) { result.reason = "resolve-failed"; result.error = resolved.error; return result }
    if (resolved.type === "url" && prune) { result.reason = "URL prune is unsupported: a URL is not a complete site inventory"; return result }
    result.type = resolved.type
    var found = resolved.type === "url" ? { sources: resolved.urls.map(function(u) { return { id: u, rel: u, url: u } }), present: {}, complete: true, errors: [] } : this._discover(resolved)
    result.discovery = { complete: found.complete === true, errors: found.errors || [], present: found.present || {} }
    result.skipped_oversized = found.skipped || []; result.discovered = found.sources.length
    var cfg = this._buildWikiConfig()
    if (!isMap(cfg)) throw new Error("no wiki config")
    loadLib("mini-a-wiki.js"); loadLib("mini-a-wiki-knowledge.js")
    if (isObject(a.wikimanager)) wm = a.wikimanager
    else if (dry) {
      if (String(cfg.backend || "fs") !== "fs") throw new Error("remote dry-run requires an existing read manager; no destination cache is initialized")
      wm = Object.create(MiniAWikiManager.prototype)
      wm._config = cfg; wm._access = "ro"; wm._backendType = "fs"; wm._logFn = function() {}
      var root = String(new java.io.File(cfg.root || ".").getCanonicalPath())
      wm._backend = { root: root, read: function(p) { var f = root + "/" + __miniAWikiNormalizePath(p, { requireMarkdown: true }); return io.fileExists(f) ? io.readFileString(f) : __ } }
    } else {
      // Lock before constructor bootstrap can mutate indexes or create wiki pages.
      var descriptor = Object.create(MiniAWikiManager.prototype)
      descriptor._config = cfg; descriptor._backendType = String(cfg.backend || "fs"); descriptor._backend = { root: cfg.root || "." }
      if (descriptor._backendType === "http" || descriptor._backendType === "fs" && new java.io.File(String(cfg.root)).isFile()) { result.reason = "wiki-read-only"; return result }
      acquireWriter(descriptor._getIndexRoot())
      wm = new MiniAWikiManager(cfg, function(level, msg) { self._log(msg) }); owns = true }
    global.__miniAWikiKnowledge.install(wm)
    if (!dry && wm._access !== "rw") { result.reason = "wiki-read-only"; return result }
    var journalPath = wm._getIndexRoot() + "/.mini-a-wiki-ingest/journal.json"
    if (!dry && !lock) acquireWriter(wm._getIndexRoot())

    if (io.fileExists(journalPath)) {
      var recovery = af.fromJson(io.readFileString(journalPath))
      if (!isMap(recovery) || !isArray(recovery.operations) || !isMap(recovery.state)) throw new Error("invalid recovery journal")
      result.recovery_pending = true
      var recoveryScope = sha1(self._destinationIdentity(wm) + "|" + resolved.type + "|" + String(a.ingestsourceid || resolved.origin || resolved.root || source) + "|" + this._defaultSection(resolved, source))
      if (recovery.scopeId && recovery.scopeId !== recoveryScope) throw new Error("pending recovery belongs to another ingestion scope; rerun its original source and section")
      if (resolved.root) recovery.operations.forEach(function(op) { if (op.kind === "delete") op.sourceRoot = resolved.root })
      if (dry) {
        result.scope = { id: recoveryScope }
        result.planned_writes = recovery.operations.filter(function(op) { return op.kind === "write" }).map(function(op) { return op.path })
        result.planned_removals = recovery.operations.filter(function(op) { return op.kind === "delete" }).map(function(op) { return op.path })
        result.finalization_pending = recovery.phase === "finalization-pending"
        result.reason = "pending recovery must complete before a new reconciliation plan"
        result.status = "planned"; result.ok = true; return result
      }
      if (recovery.phase !== "complete") this._applyJournal(wm, recovery, journalPath, result)
      else new java.io.File(journalPath).delete()
      result.recovered = true; result.recovery_pending = false
    }
    var manifest = wm.knowledgeLoadState()
    if (manifest._corrupt) throw new Error("corrupt manifest: ownership cannot be reconstructed safely")
    var statePath = wm._knowledgeStatePath(), baselineToken = io.fileExists(statePath) ? io.readFileString(statePath) : "", baseline = stringify(manifest, __, ""), section = this._defaultSection(resolved, source)
    if (/(^|\/)(\.|@)/.test(section)) throw new Error("hidden or mounted ingestion sections are unsupported")
    section = __miniAWikiNormalizePath(section + "/placeholder.md", { requireMarkdown: true }).replace(/\/placeholder.md$/, "")
    var origin = String(a.ingestsourceid || resolved.origin || resolved.root || source)
    var scope = sha1(self._destinationIdentity(wm) + "|" + resolved.type + "|" + origin + "|" + section)
    result.scope = { id: scope, origin: origin, type: resolved.type, section: section }; result.section = section
    var discoveryConfig = sha1(stringify({ include: this._csv("ingestinclude"), exclude: this._csv("ingestexclude"), maxKb: this._num("ingestmaxfilekb", 512), defaults: _INGEST_DEFAULT_EXCLUDES }, __, ""))
    var mode = this._ingestMode(), modelRaw = String(a.model || this._getEnv("OAF_MODEL")), model = {}
    try { model = modelRaw.charAt(0) === "{" ? af.fromJson(modelRaw) : af.fromSLON(modelRaw) } catch(ignoreModel) {}
    var publicModel = {}; ["type", "model", "temperature", "url", "maxTokens"].forEach(function(k) { if (isDef(model[k])) publicModel[k] = model[k] })
    var fingerprint = sha1(mode + "|" + this._num("ingestchunkchars", 24000) + "|" + stringify(global.__miniAWikiKnowledge.versions, __, "") + "|" + stringify(publicModel, __, "") + "|" + this._distillPrompt({ id: "" }, [], []))
    var legacy = this._loadLedger(wm), paths = {}, pending = [], deletions = [], observed = {}, oldIds = [], migration = false
    Object.keys(manifest.sources).forEach(function(k) { var p = manifest.sources[k].page; if (p) paths[p] = k })
    found.sources.forEach(function(src) {
      observed[src.id] = { hash: "" }
      var key = sha1(scope + "|" + src.id), oldKey = sha1(resolved.type + "|" + (resolved.origin || resolved.root || "") + "|" + src.id)
      src.sourceKey = key
      var sourceText = self._readSource(src)
      var prev = manifest.sources[key], old = manifest.sources[oldKey] || legacy[oldKey]
      if (!prev && isMap(old) && !old.scopeId) {
        var oldPath = old.page || old.wikiPath, oldPage = oldPath ? self._page(wm, oldPath) : __
        if (oldPath === self._wikiPathFor(section, src) && oldPage && oldPage.meta.source === src.rel && oldPage.meta.source_hash === (old.sourceHash || old.sha1)) {
          var knownSignature = old.signature || ""
          if (!knownSignature && isString(sourceText) && sha1(sourceText) === (old.sourceHash || old.sha1)) {
            var normalized = self._normalizedPage(wm, src, sourceText, "normalize"), rawPage = self._normalizedPage(wm, src, sourceText, "raw")
            var expected = String(oldPage.body || "").trim() === normalized.body.trim() ? normalized : String(oldPage.body || "").trim() === rawPage.body.trim() ? rawPage : __
            var knownMeta = ["title", "description", "type", "tags", "source", "source_ref", "source_hash", "ingested", "created", "updated", "timestamp", "ingest_scope", "ingest_source_key"]
            if (expected && oldPage.meta.title === expected.title && oldPage.meta.description === expected.description && oldPage.meta.type === expected.type && stringify(oldPage.meta.tags || []) === stringify(expected.tags) && Object.keys(oldPage.meta).every(function(k) { return knownMeta.indexOf(k) >= 0 })) knownSignature = self._signature(oldPage)
          }
          // Historical distillations cannot prove absence of manual edits from source_hash.
          // Associate provenance, but leave replacement blocked without a known signature.
          prev = merge(merge({}, old), { page: oldPath, scopeId: scope, sourceKey: key, signature: knownSignature, legacyRepair: true })
          manifest.sources[key] = prev; delete manifest.sources[oldKey]; paths[oldPath] = key; migration = true; result.planned_migrations.push(src.id)
        } else result.unresolved.push({ source: src.id, reason: "legacy ownership unverified" })
      }
      if (prev && (prev.scopeId !== scope || prev.sourceKey !== key || (prev.sourceId || prev.source) !== src.id || (!prev.signature && !(prev.legacyRepair && !self._page(wm, prev.page))))) {
        result.conflicts.push({ source: src.id, reason: "source ownership state is incomplete or incompatible" }); return
      }
      var content = sourceText
      if (!isString(content) || !content.trim()) { result.failed.push({ source: src.id, error: "unreadable or empty; last applied page preserved" }); return }
      observed[src.id].hash = sha1(content)
      var hash = sha1(content), chunks = self._chunkRecords(wm, src, content), pagePath = prev && prev.page || self._wikiPathFor(section, src)
      // New mappings never occupy structural indexes or pages belonging to another producer.
      if (!prev && (/(^|\/)(index|AGENTS|log)\.md$/i.test(pagePath) || paths[pagePath] && paths[pagePath] !== key || self._page(wm, pagePath))) pagePath = pagePath.replace(/\.md$/, "-" + key.substring(0, 12) + ".md")
      var page = self._page(wm, pagePath)
      if (prev && !page && isFunction(wm._backend.list)) {
        var bindings = wm._backend.list("").filter(function(p) {
          if (!/\.md$/.test(p)) return false
          var candidate = self._page(wm, p)
          return candidate && candidate.meta.ingest_source_key === key && candidate.meta.ingest_scope === scope
        })
        if (bindings.length === 1) { pagePath = bindings[0]; page = self._page(wm, pagePath); prev.bindingRepair = true }
        else if (bindings.length > 1) { result.conflicts.push({ source: src.id, reason: "multiple moved page bindings" }); return }
      }
      if ((paths[pagePath] && paths[pagePath] !== key) || (!prev && page) || (prev && page && (!prev.signature || self._signature(page) !== prev.signature))) {
        result.conflicts.push({ source: src.id, page: pagePath, reason: "page ownership or local edit conflict" }); return
      }
      paths[pagePath] = key
      var legacyRetiredIds = []
      if (prev && prev.legacyRepair) Object.keys(manifest.chunks).forEach(function(id) {
        var c = manifest.chunks[id]
        if (!c.sourceKey && c.page === prev.page && c.source === src.rel && c.sourceId === sha1(src.rel) && c.identity && sha1(c.identity) === id) legacyRetiredIds.push(id)
      })
      var oldChunks = prev && prev.chunks || [], byId = {}; oldChunks.forEach(function(c) { byId[c.id] = c })
      result.chunks_discovered += chunks.length
      chunks.forEach(function(c) { if (byId[c.id] && byId[c.id].hash === c.hash) result.chunks_reused++; else if (byId[c.id]) result.chunks_changed++; else result.chunks_added++ })
      oldChunks.forEach(function(c) { if (!chunks.some(function(n) { return c.id === n.id })) result.planned_chunks_removed++ })
      var intact = prev && oldChunks.length === chunks.length && chunks.every(function(c) { return byId[c.id] && byId[c.id].hash === c.hash && manifest.chunks[c.id] && manifest.chunks[c.id].generation === prev.generation && manifest.chunks[c.id].page === pagePath && manifest.chunks[c.id].sourceKey === key && manifest.chunks[c.id].hash === c.hash && sha1(String(manifest.chunks[c.id].text || "")) === c.hash })
      if (toBoolean(a.ingestforce) !== true && prev && prev.sourceHash === hash && prev.fingerprint === fingerprint && !prev.legacyRepair && !prev.bindingRepair && page && intact) { result.skipped_unchanged++; return }
      result.sources_changed++
      if (prev && (!page || prev.legacyRepair || prev.bindingRepair || !intact)) result.planned_repairs.push(pagePath)
      var needs = mode === "distill" || mode === "auto" && chunks.some(function(c) { return wm.knowledgeNeedsDistillation(c).needs })
      pending.push({ src: src, key: key, hash: hash, content: content, chunks: chunks, path: pagePath, before: self._signature(page), needs: needs, legacyRetiredIds: legacyRetiredIds })
      result.planned_writes.push(pagePath)
    })
    Object.keys(manifest.sources).forEach(function(k) {
      var prev = manifest.sources[k]
      if (prev.scopeId !== scope) { if (!prev.scopeId) { result.unresolved.push({ key: k, reason: "legacy record has no verified scope; automatic removal forbidden" }); if (prune) result.prune_blocked.push({ key: k, reason: "legacy scope ownership unresolved" }) }; return }
      if (observed[prev.source || prev.sourceId]) return
      var rel = prev.source || prev.sourceId
      // Recheck individual known paths: excluded directories need not be traversed.
      if (resolved.type !== "url" && (found.present[rel] || io.fileExists(resolved.root + "/" + rel))) { result.unresolved.push({ source: rel, reason: "present outside eligible selection" }); return }
      result.missing_sources.push(rel)
      if (!prune) return
      var reason = !found.complete ? "incomplete inventory" : prev.discoveryConfig !== discoveryConfig ? "discovery filters or limits changed" : !Object.keys(found.present).length && toBoolean(a.ingestallowemptyprune) !== true ? "empty source requires ingestallowemptyprune=true" : ""
      var page = self._page(wm, prev.page)
      if (Object.keys(manifest.sources).some(function(other) { return other !== k && manifest.sources[other].page === prev.page })) reason = "page has multiple source owners"
      if (!prev.signature || page && self._signature(page) !== prev.signature) { result.conflicts.push({ source: rel, page: prev.page, reason: "prune ownership or local edit conflict" }); reason = "ownership conflict" }
      if (reason) result.prune_blocked.push({ source: rel, reason: reason })
      else { deletions.push({ key: k, kind: "delete", path: prev.page, before: self._signature(page), sourceRoot: resolved.root, sourceRel: rel }); result.planned_removals.push(prev.page) }
    })
    if (!found.complete) result.failed.push({ source: "discovery", error: "incomplete source inventory" })
    var budget = new global.__miniAWikiKnowledge.Budget(a, "ingest"), siblings = pending.map(function(p) { return p.src.rel }), llm
    pending.forEach(function(p) {
      if (p.needs) {
        var estimate = wm.knowledgeEstimateTokens(self._distillPrompt(p.src, p.chunks.map(function(c) { return c.text }), siblings))
        result.llm_candidates++; result.estimated_input_tokens += estimate
        if (!budget.reserve(p.src.rel, estimate, Math.ceil(estimate / 5))) { result.deferred.push({ source: p.src.rel, reason: "full document exceeds prompt/budget limit" }); p.deferred = true }
      }
    })
    result.budget = budget.stats()
    if (dry) { result.status = "planned"; result.ok = result.failed.length === 0 && result.conflicts.length === 0 && result.deferred.length === 0 && result.prune_blocked.length === 0; return result }
    var operations = [], generation = java.util.UUID.randomUUID().toString()
    var llmWork = pending.filter(function(p) { return p.needs && !p.deferred }), llmResults = {}
    if (llmWork.length) {
      llm = self._buildLlm()
      if (isObject(llm)) {
        result.llm_calls = llmWork.length
        self._distillAll(llm, llmWork, siblings, Math.max(1, Math.round(self._num("ingestconcurrency", 4)))).forEach(function(d) { llmResults[d.key] = d })
      }
    }
    for (var i = 0; i < pending.length; i++) {
      var p = pending[i]; if (p.deferred) continue
      var d
      if (p.needs) {
        d = llmResults[p.key] || { ok: false, error: "no LLM configured or distillation result missing" }
      } else d = { ok: true, page: self._normalizedPage(wm, p.src, p.content, mode) }
      if (!d.ok) { result.failed.push({ source: p.src.rel, error: d.error }); continue }
      var meta = { title: d.page.title, description: d.page.description || "", type: d.page.type || "reference", tags: d.page.tags || [], source: p.src.rel,
        source_ref: resolved.ref || resolved.origin || "", source_hash: p.hash, ingest_scope: scope, ingest_source_key: p.key, ingested: new Date().toISOString() }
      var after = self._signature({ meta: meta, body: d.page.body })
      self._invalidate(manifest, p.key, result)
      oldIds = oldIds.concat(p.legacyRetiredIds || [])
      ;(manifest.sources[p.key] && manifest.sources[p.key].chunks || []).forEach(function(c) { oldIds.push(c.id) })
      p.chunks.forEach(function(c) { c.page = p.path; c.sourceKey = p.key; c.generation = generation; manifest.chunks[c.id] = c })
      manifest.sources[p.key] = { scopeId: scope, sourceKey: p.key, source: p.src.rel, sourceId: p.src.id, sourceHash: p.hash, normalizedHash: sha1(wm.knowledgeNormalize(p.content)),
        fingerprint: fingerprint, discoveryConfig: discoveryConfig, page: p.path, chunks: p.chunks, generation: generation, signature: after, active: true }
      operations.push({ kind: "write", path: p.path, before: p.before, after: after, meta: meta, body: d.page.body })
    }
    // No destructive operations after failed/deferred writes or conflicts.
    if (result.failed.length || result.deferred.length || result.conflicts.length) deletions.forEach(function(op) { result.prune_blocked.push({ page: op.path, reason: "reconciliation has failures, deferrals or conflicts" }) })
    else {
      // Re-observe inventory immediately before preparing deletes. This is detection,
      // not a claim of an atomic filesystem snapshot.
      var again = resolved.type === "url" ? found : self._discover(resolved)
      var same = again.complete && stringify(again.present, __, "") === stringify(found.present, __, "") && again.sources.every(function(s) { var original = found.sources.filter(function(o) { return o.id === s.id })[0]; return original && original.size === s.size })
      found.sources.forEach(function(s) { if (sha1(String(self._readSource(s) || "")) !== observed[s.id].hash) same = false })
      deletions.forEach(function(op) {
        if (!same || io.fileExists(resolved.root + "/" + manifest.sources[op.key].source)) { result.prune_blocked.push({ page: op.path, reason: "source changed during reconciliation" }); return }
        self._invalidate(manifest, op.key, result); (manifest.sources[op.key].chunks || []).forEach(function(c) { oldIds.push(c.id) })
        var retiredPage = manifest.sources[op.key].page
        delete manifest.sources[op.key]
        if (!Object.keys(manifest.sources).some(function(k) { return manifest.sources[k].page === retiredPage })) { delete manifest.pages[retiredPage]; delete manifest.dependencies[retiredPage] }
        operations.push(op)
      })
    }
    var removedChunks = self._collectChunks(manifest, oldIds, scope)
    if (operations.length || migration) {
      var liveState = wm.knowledgeLoadState()
      if (liveState._corrupt) throw new Error("manifest became unreadable")
      var currentToken = io.fileExists(statePath) ? io.readFileString(statePath) : ""
      if (currentToken !== baselineToken || self._stateFingerprint(liveState) !== self._stateFingerprint(af.fromJson(baseline))) throw new Error("manifest changed concurrently; replan required")
      if (migration) {
        var backupPath = wm._getIndexRoot() + "/.mini-a-wiki-ingest/pre-migration.json"
        if (!io.fileExists(backupPath)) self._atomicJson(backupPath, af.fromJson(baseline))
        self._atomicJson(backupPath.replace(/\.json$/, "-" + generation + ".json"), af.fromJson(baseline))
      }
      manifest.version = global.__miniAWikiKnowledge.versions.manifest
      manifest.ingestGeneration = generation
      var journal = { version: 1, scopeId: scope, allowEmptyPrune: toBoolean(a.ingestallowemptyprune) === true, generation: generation, phase: "prepared", baseFingerprint: self._stateFingerprint(af.fromJson(baseline)), operations: operations, state: manifest, chunksRemoved: removedChunks, derivatives: result.planned_derivatives_invalidated, migrations: result.planned_migrations, repairs: result.planned_repairs.filter(function(p) { return operations.some(function(op) { return op.kind === "write" && op.path === p }) }) }
      self._atomicJson(journalPath, journal); self._applyJournal(wm, journal, journalPath, result)
    }
    var incomplete = result.failed.length || result.conflicts.length || result.deferred.length || result.prune_blocked.length
    result.ok = !incomplete; result.sync_complete = !incomplete && (result.missing_sources.length === 0 || prune && !Object.keys(manifest.sources).some(function(k) { return manifest.sources[k].scopeId === scope && result.missing_sources.indexOf(manifest.sources[k].source) >= 0 })) && result.unresolved.length === 0
    result.status = incomplete ? result.written.length || result.removed.length ? "partial" : "blocked" : result.written.length || result.removed.length || migration || result.recovered ? "complete" : "noop"
    return result
  } catch(e) {
    result.ok = false; result.sync_complete = false; result.error = __miniAErrMsg(e)
    result.failed.push({ source: "execution/persistence/finalization", error: result.error })
    if (/finaliz/i.test(result.error)) result.finalization_failures.push(result.error)
    else if (/persist|atomic|journal|manifest/i.test(result.error)) result.persistence_failures.push(result.error)
    result.status = result.written.length || result.removed.length ? "partial" : "failed"
    return result
  } finally {
    try { if (lock) lock.release() } catch(ignoreLock) {}
    try { if (channel) channel.close(); if (file) file.close() } catch(ignoreChannel) {}
    try { if (owns && wm) wm.close() } catch(ignoreClose) {}
    if (resolved && resolved.cleanup) try { io.rm(resolved.cleanup) } catch(ignoreCleanup) {}
  }
}

// _distillAll: one LLM call per source, run in parallel batches of `concurrency`.
MiniAIngest.prototype._distillAll = function(llm, pending, siblings, concurrency) {
  var self = this
  var out = []
  for (var i = 0; i < pending.length; i += concurrency) {
    var batch = pending.slice(i, i + concurrency)
    var results = []
    try {
      results = parallel4Array(batch, function(p) {
        var chunks = isArray(p.chunks) ? p.chunks.map(function(c) { return c.text }) : self._chunk(p.content)
        var d = self._distill(llm, p.src, chunks, siblings)
        return merge(d, { src: p.src, hash: p.hash, key: p.key, chunks: p.chunks })
      })
    } catch(pe) {
      // parallel execution unavailable or failed: fall back to serial
      results = batch.map(function(p) {
        var chunks = isArray(p.chunks) ? p.chunks.map(function(c) { return c.text }) : self._chunk(p.content)
        var d = self._distill(llm, p.src, chunks, siblings)
        return merge(d, { src: p.src, hash: p.hash, key: p.key, chunks: p.chunks })
      })
    }
    ;(isArray(results) ? results : []).forEach(function(r) {
      out.push(r)
      if (r.ok !== true) self._log("[ingest] Distillation failed for " + r.src.rel + ": " + r.error)
    })
    self._log("[ingest] Distilled " + Math.min(i + concurrency, pending.length) + "/" + pending.length + " source(s).")
  }
  return out
}

MiniAIngest.prototype._readSource = function(src) {
  if (isString(src.url)) {
    try {
      loadLib("mini-a-utils.js")
      var tool = new MiniUtilsTool({ readwrite: false })
      var res = tool.textUtilities({ operation: "webfetch", url: src.url, format: "markdown" })
      if (isMap(res) && isString(res.content)) return res.content
      if (isString(res)) return res
      return __
    } catch(e) {
      this._log("[ingest] Fetch failed for " + src.url + ": " + __miniAErrMsg(e))
      return __
    }
  }
  var raw
  try { raw = io.readFileString(src.path) } catch(e) { return __ }
  if (/\.html?$/i.test(String(src.rel || src.path))) {
    try {
      loadLib("mini-a-utils.js")
      var tool = new MiniUtilsTool({ readwrite: false })
      return tool._renderWebfetchBody(raw, "markdown")
    } catch(eh) {
      return raw
    }
  }
  return raw
}

// _finalize: reuse the dream finalize pass so an ingested wiki is left indexed and linked.
MiniAIngest.prototype._finalize = function(wm) {
  try {
    global.__mini_a_dreams_lib_mode = true
    loadLib("mini-a-dreams.js")
    var dreams = new MiniADreams(this._args, this._logFn)
    var report = dreams._finalizeWiki(wm, __)
    if (isFunction(wm.lint)) {
      try {
        var lint = wm.lint(__, {})
        report.unresolved_links = (lint.issues || []).filter(function(issue) { return issue.type === "broken_link" || issue.type === "invalid_anchor" })
      } catch(eLint) { report.lint_error = __miniAErrMsg(eLint) }
    }
    return report
  } catch(e) {
    this._log("[ingest] Finalize failed: " + __miniAErrMsg(e))
    return { ok: false, errors: [__miniAErrMsg(e)] }
  }
}

MiniAIngest.prototype._buildWikiConfig = function() {
  try {
    global.__mini_a_dreams_lib_mode = true
    loadLib("mini-a-dreams.js")
    var cfg = new MiniADreams(this._args, this._logFn)._buildWikiConfig()
    // the dream config forces rw; honour an explicit wikiaccess=ro so ingest refuses
    // rather than quietly escalating a wiki the caller marked read-only
    if (isMap(cfg) && String(this._args.wikiaccess || "").toLowerCase().trim() === "ro") cfg.access = "ro"
    return cfg
  } catch(e) {
    this._log("[ingest] Could not build wiki config: " + __miniAErrMsg(e))
    return __
  }
}

// ─────────────────────────────────────────────────────────────
// Standalone entry point — skipped when loaded as a library
// (set global.__mini_a_ingest_lib_mode = true before loadLib to suppress)
// ─────────────────────────────────────────────────────────────

if (!toBoolean(global.__mini_a_ingest_lib_mode)) {
  var _ingest = new MiniAIngest(args, log)
  var _ingestResult = _ingest.run()
  if (isMap(_ingestResult) && _ingestResult.ok === false) java.lang.System.exit(1)
}
