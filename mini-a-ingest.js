// Author: OpenAF
// License: Apache 2.0
// Description: Wiki ingestion pipeline for Mini-A — turns a docs folder, a git repo or a
//              set of URLs into distilled, linked, indexed wiki pages.
//
// Pipeline: resolve -> discover -> ledger -> chunk -> distill (LLM) -> write -> finalize
// Everything except `distill` is deterministic. One source produces one wiki page;
// cross-page dedup and reorganisation are deliberately left to the wiki dream pass.

var MiniAIngest = function(ingestArgs, logFn) {
  this._args  = isMap(ingestArgs) ? merge({}, ingestArgs) : {}
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
      if (rc !== 0) return { ok: false, error: "git clone failed (exit " + rc + ") for " + s }
      return { ok: true, type: "repo", root: tmp, ref: this._gitHead(tmp), cleanup: tmp, origin: s }
    } catch(e) {
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
  var skippedLarge = []

  var walk = function(dir) {
    var listing
    try { listing = io.listFiles(dir) } catch(e) { return }
    if (!isMap(listing) || !isArray(listing.files)) return
    listing.files.forEach(function(f) {
      var full = String(f.canonicalPath)
      var rel  = full.substring(root.length).replace(/^\//, "")
      if (rel.length === 0) return
      if (self._shouldSkipPath(rel)) return
      if (f.isDirectory) { walk(full); return }
      if (!/\.(md|markdown|mdx|txt|rst|adoc)$/i.test(rel)) return
      var kb = Number(f.size || 0) / 1024
      if (kb > maxKb) {
        // skip rather than silently truncate: a half-read document distills into a lie
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
  return { sources: out, skipped: skippedLarge }
}

// ── phase 3: ledger ──────────────────────────────────────────

MiniAIngest.prototype._ledgerPath = function(wm) {
  if (isString(this._args.ingestledger) && this._args.ingestledger.trim().length > 0) return this._args.ingestledger.trim()
  return wm._ensureIndexRoot() + "/.mini-a-wiki-ingest/ledger.json"
}

MiniAIngest.prototype._loadLedger = function(wm) {
  var p = this._ledgerPath(wm)
  try {
    if (io.fileExists(p)) {
      var parsed = af.fromJson(io.readFileString(p))
      if (isMap(parsed)) return parsed
    }
  } catch(e) {
    this._log("[ingest] Could not read ledger (starting fresh): " + __miniAErrMsg(e))
  }
  return {}
}

MiniAIngest.prototype._saveLedger = function(wm, ledger) {
  var p = this._ledgerPath(wm)
  try {
    var dir = p.substring(0, p.lastIndexOf("/"))
    if (dir.length > 0 && !io.fileExists(dir)) io.mkdir(dir)
    io.writeFileString(p, stringify(ledger, __, ""))
    return true
  } catch(e) {
    this._log("[ingest] Could not persist ledger: " + __miniAErrMsg(e))
    return false
  }
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

MiniAIngest.prototype.run = function() {
  var self = this
  var source = isString(this._args.ingestsource) ? this._args.ingestsource.trim() : ""
  if (source.length === 0) {
    this._log("Usage: mini-a ingest=true ingestsource=<folder|repo-url|page-url> usewiki=true wikiaccess=rw wikiroot=<path>")
    this._log("  ingesttype=      markdown | repo | url (default: auto-detected)")
    this._log("  ingestsection=   Wiki section to write into (default: derived from the source name)")
    this._log("  ingestinclude=   Comma-separated path fragments to include")
    this._log("  ingestexclude=   Comma-separated path fragments to exclude")
    this._log("  ingestchunkchars=Maximum characters per distillation chunk (default: 24000)")
    this._log("  ingestmaxfilekb= Skip sources larger than this (default: 512)")
    this._log("  ingestconcurrency=Parallel distillations (default: 4)")
    this._log("  ingestdryrun=true Report what would be ingested without writing")
    this._log("  ingestforce=true  Re-ingest sources the ledger says are unchanged")
    this._log("  ingestledger=    Override the ledger file path")
    return { ok: false, reason: "no-source" }
  }
  if (toBoolean(this._args.usewiki) !== true) {
    this._log("[ingest] usewiki is not set. Nothing to ingest into.")
    return { ok: false, reason: "usewiki-not-set" }
  }

  var isDryRun = toBoolean(this._args.ingestdryrun) === true || toBoolean(this._args.dryrun) === true
  var force    = toBoolean(this._args.ingestforce) === true

  // ---- resolve ----
  var resolved = this._resolve(source)
  if (resolved.ok !== true) {
    this._log("[ingest] " + resolved.error)
    return { ok: false, reason: "resolve-failed", error: resolved.error }
  }
  this._log("[ingest] Source resolved as " + resolved.type + (isString(resolved.ref) ? " @ " + resolved.ref.substring(0, 8) : ""))

  var result = {
    ok: true,
    type: resolved.type,
    section: "",
    dryrun: isDryRun,
    discovered: 0,
    skipped_unchanged: 0,
    skipped_oversized: [],
    written: [],
    failed: [],
    finalize: __
  }

  try {
    // ---- discover ----
    var sources = []
    if (resolved.type === "url") {
      sources = resolved.urls.map(function(u) { return { id: u, rel: u, url: u } })
    } else {
      var found = this._discover(resolved)
      sources = found.sources
      result.skipped_oversized = found.skipped
    }
    result.discovered = sources.length
    if (sources.length === 0) {
      this._log("[ingest] No ingestable sources found.")
      return merge(result, { ok: false, reason: "no-sources" })
    }
    this._log("[ingest] Discovered " + sources.length + " source(s).")

    // ---- wiki + ledger ----
    var wikiCfg = this._buildWikiConfig()
    if (!isMap(wikiCfg)) return merge(result, { ok: false, reason: "no-wiki-config" })
    loadLib("mini-a-wiki.js")
    var wm = new MiniAWikiManager(wikiCfg, function(level, msg) { self._log("[ingest:wiki] " + msg) })
    if (wm._access !== "rw") {
      wm.close()
      this._log("[ingest] Wiki is read-only. Set wikiaccess=rw to ingest.")
      return merge(result, { ok: false, reason: "wiki-read-only" })
    }

    var section = this._defaultSection(resolved, source)
    result.section = section
    var ledger = this._loadLedger(wm)

    // ---- read + ledger filter ----
    var pending = []
    sources.forEach(function(src) {
      var content = self._readSource(src)
      if (!isString(content) || content.trim().length === 0) {
        result.failed.push({ source: src.rel, error: "unreadable or empty" })
        return
      }
      var hash = sha1(content)
      var key  = sha1(resolved.type + "|" + (resolved.origin || resolved.root || "") + "|" + src.id)
      var prev = ledger[key]
      if (!force && isMap(prev) && prev.sha1 === hash) {
        result.skipped_unchanged++
        return
      }
      pending.push({ src: src, content: content, hash: hash, key: key })
    })

    if (pending.length === 0) {
      this._log("[ingest] Nothing to do — all " + result.skipped_unchanged + " source(s) unchanged (use ingestforce=true to re-ingest).")
      wm.close()
      return result
    }
    this._log("[ingest] " + pending.length + " source(s) to distill (" + result.skipped_unchanged + " unchanged).")

    if (isDryRun) {
      result.written = pending.map(function(p) { return self._wikiPathFor(section, p.src) })
      this._log("[ingest] Dry-run: would write " + result.written.length + " page(s) into '" + section + "/'.")
      wm.close()
      return result
    }

    // ---- distill (LLM, fanned out) ----
    var llm = this._buildLlm()
    if (!isObject(llm)) {
      wm.close()
      this._log("[ingest] No LLM configured (set OAF_MODEL or pass model=).")
      return merge(result, { ok: false, reason: "no-llm" })
    }

    var siblingTitles = pending.map(function(p) { return String(p.src.rel) })
    var concurrency = Math.max(1, Math.round(this._num("ingestconcurrency", 4)))
    var distilled = this._distillAll(llm, pending, siblingTitles, concurrency)

    // ---- write (serial: the wiki manager and its indexes are not thread-safe) ----
    distilled.forEach(function(d) {
      if (d.ok !== true) {
        result.failed.push({ source: d.src.rel, error: d.error })
        return
      }
      var wikiPath = self._wikiPathFor(section, d.src)
      var nowIso   = new Date().toISOString()
      var meta = {
        title      : String(d.page.title).trim(),
        description: isString(d.page.description) ? d.page.description.trim() : "",
        type       : isString(d.page.type) && d.page.type.trim().length > 0 ? d.page.type.trim() : "concept",
        tags       : isArray(d.page.tags) ? d.page.tags.map(function(t) { return String(t) }) : [],
        source     : isString(d.src.url) ? d.src.url : String(d.src.rel),
        source_ref : isString(resolved.ref) ? resolved.ref : (isString(resolved.origin) ? resolved.origin : ""),
        source_hash: d.hash,
        ingested   : nowIso
      }
      try {
        var wr = wm.write(wikiPath, meta, String(d.page.body))
        if (isMap(wr) && wr.ok === true) {
          result.written.push(wikiPath)
          ledger[d.key] = {
            sourceId : d.src.id,
            sha1     : d.hash,
            wikiPath : wikiPath,
            commit   : isString(resolved.ref) ? resolved.ref : "",
            ingestedAt: nowIso
          }
        } else {
          result.failed.push({ source: d.src.rel, error: isMap(wr) && isString(wr.error) ? wr.error : "write failed" })
        }
      } catch(we) {
        result.failed.push({ source: d.src.rel, error: __miniAErrMsg(we) })
      }
    })

    this._log("[ingest] Wrote " + result.written.length + " page(s), " + result.failed.length + " failure(s).")

    // ---- finalize ----
    this._saveLedger(wm, ledger)
    try { wm.appendLog("ingest", section, result.written.length + " page(s) from " + source) } catch(el) {}
    result.finalize = this._finalize(wm)
    wm.close()
    return result
  } catch(e) {
    this._log("[ingest] Error: " + __miniAErrMsg(e))
    return merge(result, { ok: false, reason: "ingest-error", error: __miniAErrMsg(e) })
  } finally {
    if (isString(resolved.cleanup) && resolved.cleanup.length > 0) {
      try { io.rm(resolved.cleanup) } catch(ec) {}
    }
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
        var chunks = self._chunk(p.content)
        var d = self._distill(llm, p.src, chunks, siblings)
        return merge(d, { src: p.src, hash: p.hash, key: p.key })
      })
    } catch(pe) {
      // parallel execution unavailable or failed: fall back to serial
      results = batch.map(function(p) {
        var chunks = self._chunk(p.content)
        var d = self._distill(llm, p.src, chunks, siblings)
        return merge(d, { src: p.src, hash: p.hash, key: p.key })
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
  try { return io.readFileString(src.path) } catch(e) { return __ }
}

// _finalize: reuse the dream finalize pass so an ingested wiki is left indexed and linked.
MiniAIngest.prototype._finalize = function(wm) {
  try {
    global.__mini_a_dreams_lib_mode = true
    loadLib("mini-a-dreams.js")
    var dreams = new MiniADreams(this._args, this._logFn)
    return dreams._finalizeWiki(wm, __)
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
  if (isMap(_ingestResult) && _ingestResult.ok === false && _ingestResult.reason === "no-source") java.lang.System.exit(1)
}
