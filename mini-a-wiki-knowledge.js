// Author: OpenAF
// License: Apache 2.0
// Description: Wiki incremental knowledge primitives. Kept dependency-free so it can run
//              on every Mini-A wiki backend; mutable state always lives in the index cache.

var MINI_A_WIKI_KNOWLEDGE = { manifest: 2, chunker: 2, semantic: 1, prompt: 1, ranking: 1 }

var MiniAWikiKnowledgeBudget = function(args, scope) {
  args = isMap(args) ? args : {}
  var total = Number(args.wikillmbudget)
  var local = Number(args[scope === "dream" ? "wikidreambudget" : "wikiingestbudget"])
  this.limit = !isNaN(local) && local >= 0 ? local : (!isNaN(total) && total >= 0 ? total : -1)
  this.maxPrompt = !isNaN(Number(args.wikimaxprompttokens)) && Number(args.wikimaxprompttokens) > 0 ? Number(args.wikimaxprompttokens) : 24000
  this.used = 0; this.estimatedInput = 0; this.estimatedOutput = 0
  this.attempted = 0; this.executed = 0; this.deferred = []
}
MiniAWikiKnowledgeBudget.prototype.reserve = function(candidate, input, output) {
  input = Math.max(0, Number(input) || 0); output = Math.max(0, Number(output) || 0)
  this.attempted++; this.estimatedInput += input; this.estimatedOutput += output
  if (input > this.maxPrompt || (this.limit >= 0 && this.used + input + output > this.limit)) {
    this.deferred.push({ candidate: candidate, input_tokens: input, output_tokens: output, reason: input > this.maxPrompt ? "max-prompt-tokens" : "budget" })
    return false
  }
  this.used += input + output; this.executed++; return true
}
MiniAWikiKnowledgeBudget.prototype.stats = function() { return { limit: this.limit, remaining: this.limit < 0 ? -1 : Math.max(0, this.limit - this.used), estimated_input_tokens: this.estimatedInput, estimated_output_tokens: this.estimatedOutput, calls_attempted: this.attempted, calls_executed: this.executed, calls_deferred: this.deferred.length, deferred: this.deferred } }

MiniAWikiManager.prototype._knowledgeStatePath = function() { return this._getIndexRoot() + "/.mini-a-wiki-state/manifest.json" }
MiniAWikiManager.prototype._knowledgeEmptyState = function() { return { version: MINI_A_WIKI_KNOWLEDGE.manifest, versions: MINI_A_WIKI_KNOWLEDGE, sources: {}, chunks: {}, pages: {}, dependencies: {}, derivativeRegistry: { byPage: {} }, facts: {}, summaries: { pages: {}, sections: {} }, telemetry: { queries: {}, zero_results: 0 }, updated: new Date().toISOString() } }
MiniAWikiManager.prototype.knowledgeLoadState = function() {
  if (this._access !== "rw" && !io.fileExists(this._knowledgeStatePath())) return this._knowledgeEmptyState()
  if (!io.fileExists(this._knowledgeStatePath())) return this._knowledgeEmptyState()
  try {
    var v = af.fromJson(io.readFileString(this._knowledgeStatePath()))
    if (!isMap(v) || !isMap(v.sources) || isDef(v.chunks) && !isMap(v.chunks) || isDef(v.dependencies) && !isMap(v.dependencies)) throw new Error("invalid manifest")
    // Merge onto a fresh empty state so a manifest from an older schema version (missing
    // e.g. dependencies/telemetry/summaries) still has every key downstream code
    // dereferences without a guard (knowledgeDirtySet's state.dependencies[id], etc.).
    return merge(this._knowledgeEmptyState(), v)
  } catch(e) { this._logFn("warn", "[wiki] manifest unreadable; starting with safe empty state: " + __miniAErrMsg(e)); var empty = this._knowledgeEmptyState(); empty._corrupt = true; return empty }
}
MiniAWikiManager.prototype.knowledgeSaveState = function(state) {
  if (this._access !== "rw" || state._corrupt) return false
  var p = this._knowledgeStatePath(), dir = p.substring(0, p.lastIndexOf("/")), tmp = p + ".tmp-" + java.util.UUID.randomUUID()
  try {
    if (!io.fileExists(dir)) io.mkdir(dir)
    state.updated = new Date().toISOString()
    io.writeFileString(tmp, stringify(state, __, ""))
    java.nio.file.Files.move(new java.io.File(tmp).toPath(), new java.io.File(p).toPath(), java.nio.file.StandardCopyOption.ATOMIC_MOVE, java.nio.file.StandardCopyOption.REPLACE_EXISTING)
    return true
  } catch(e) {
    try { new java.io.File(tmp).delete() } catch(ignore) {}
    this._logFn("warn", "[wiki] manifest was not saved atomically: " + __miniAErrMsg(e))
    return false
  }
}
MiniAWikiManager.prototype.knowledgeEstimateTokens = function(text) { return Math.max(1, Math.ceil(String(text || "").length / 4)) }
MiniAWikiManager.prototype.knowledgeNormalize = function(text) {
  var s = String(text || "").replace(/\r\n/g, "\n").replace(/^---\n[\s\S]*?\n---\n/, "")
  // Navigation lists are non-knowledge, but retain code fences exactly.
  s = s.replace(/^\s*(\[?table of contents\]?|\[?toc\]?)\s*$/gim, "").replace(/^\s*\[[^\]]+\]\([^)]*\)\s*\|\s*/gm, "")
  return s.replace(/\n{3,}/g, "\n\n").trim() + "\n"
}
MiniAWikiManager.prototype.knowledgeChunks = function(source, text, options) {
  options = isMap(options) ? options : {}; var max = Number(options.maxChars) > 0 ? Number(options.maxChars) : 24000
  var body = this.knowledgeNormalize(text), lines = body.split("\n"), out = [], stack = [], cur = [], ordinal = 0, occurrences = {}, self = this
  var emit = function(parts) { var x = parts.join("\n").trim(); if (!x) return; var section = stack.length ? stack.map(function(h) { return h.text }).join(" > ") : String(source); var anchor = stack.length ? stack[stack.length - 1].anchor : self._headingAnchor(String(source).replace(/\.[^.]+$/, "")); var structural = stack.map(function(h) { return h.text }).join(" > ") || String(source); occurrences[structural] = (occurrences[structural] || 0) + 1; var occurrence = occurrences[structural]; var add = function(t, suffix) { var n = self.knowledgeNormalize(t); if (!n.trim()) return; ordinal++; var ident = String(options.namespace || source) + "#" + structural + "@" + occurrence + (suffix ? "-" + suffix : ""); out.push({ id: sha1(ident), source: source, sourceId: sha1(String(source)), section: section, anchor: anchor, kind: "section", hash: sha1(t), normalizedHash: sha1(n), text: t, chars: t.length, estimatedTokens: self.knowledgeEstimateTokens(t), ordinal: ordinal, identity: ident, ancestry: stack.map(function(h) { return h.text }) }) }
    if (x.length <= max) { add(x, ""); return }
    var paras = x.split(/\n\s*\n/), b = "", ix = 0
    paras.forEach(function(p) { if (b && b.length + p.length + 2 > max) { add(b, String(++ix)); b = p } else b += (b ? "\n\n" : "") + p })
    if (b) { if (b.length <= max) add(b, String(++ix)); else for (var i = 0; i < b.length; i += max) add(b.substring(i, i + max), String(++ix)) }
  }
  lines.forEach(function(line) { var m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/); if (m && cur.length) { emit(cur); cur = [] }; if (m) { var lvl = m[1].length, heading = m[2].trim(); while (stack.length && stack[stack.length - 1].level >= lvl) stack.pop(); stack.push({ level: lvl, text: heading, anchor: self._headingAnchor(heading) }) }; cur.push(line) }); emit(cur)
  return out
}
MiniAWikiManager.prototype.knowledgeNeedsDistillation = function(chunk) {
  var t = String(chunk.text || ""), score = 0
  if (!/^#{1,6}\s/m.test(t)) score += 0.35
  if (/<(?:nav|header|footer|script)\b/i.test(t)) score += 0.35
  if ((t.match(/\[[^\]]+\]\([^)]*\)/g) || []).length > 20) score += 0.2
  if (t.length > 16000 && (t.match(/\n\s*\n/g) || []).length < 6) score += 0.3
  return { score: Math.min(1, score), needs: score >= 0.5 }
}
MiniAWikiManager.prototype.knowledgeDirtySet = function(changed, options) {
  options = isMap(options) ? options : {}; var max = Number(options.maxAffected) || 100, depth = Number(options.maxDepth) || 2, state = this.knowledgeLoadState(), q = [], seen = {}, affected = []
  ;(isArray(changed) ? changed : [changed]).forEach(function(x) { if (x) q.push({ id: String(x), depth: 0, reason: "changed" }) })
  while (q.length && affected.length < max) { var e = q.shift(); if (seen[e.id]) continue; seen[e.id] = true; affected.push(e); if (e.depth >= depth) continue; var ds = state.dependencies[e.id] || []; ds.forEach(function(d) { if (!seen[d]) q.push({ id: d, depth: e.depth + 1, reason: "dependency" }) }) }
  return { dirty: (isArray(changed) ? changed : [changed]).filter(function(x) { return !!x }), affected: affected, bounded: q.length > 0 }
}
// Aggregate only: query text, hashes, paths and document content are not persisted.
MiniAWikiManager.prototype._knowledgeTelemetryPath = function() { return this._getIndexRoot() + "/.mini-a-wiki-state/telemetry.json" }
MiniAWikiManager.prototype._knowledgeLoadTelemetry = function() {
  try { var t = af.fromJson(io.readFileString(this._knowledgeTelemetryPath())); if (isMap(t) && t.version === 1) return t } catch(ignore) {}
  return { version: 1, searches: 0, zero_results: 0, results: 0 }
}
MiniAWikiManager.prototype.knowledgeRecordTelemetry = function(query, hits, enabled) {
  if (enabled !== true || this._access !== "rw") return
  var p = this._knowledgeTelemetryPath(), tmp = p + ".tmp-" + java.util.UUID.randomUUID()
  try {
    var t = this._knowledgeLoadTelemetry(), count = isArray(hits) ? hits.length : 0
    t.searches++; t.results += count; if (!count) t.zero_results++
    io.mkdir(p.substring(0, p.lastIndexOf("/")))
    io.writeFileString(tmp, stringify(t, __, ""))
    java.nio.file.Files.move(new java.io.File(tmp).toPath(), new java.io.File(p).toPath(), java.nio.file.StandardCopyOption.ATOMIC_MOVE, java.nio.file.StandardCopyOption.REPLACE_EXISTING)
  } catch(e) { this._logFn("warn", "[wiki] telemetry not saved: " + __miniAErrMsg(e)) }
  finally { try { new java.io.File(tmp).delete() } catch(ignore) {} }
}
MiniAWikiManager.prototype.knowledgeRank = function(query, hits, debug) {
  var q = String(query || "").toLowerCase(), terms = q.split(/\s+/).filter(function(x) { return x.length > 1 }), self = this, evaluatedAt = new Date().getTime()
  var ranked = (isArray(hits) ? hits : []).map(function(h) {
    if (isFinite(h.rankScore) && isNumber(h.rankScore)) return h
    var path = String(h.path || "").toLowerCase(), title = String(h.title || "").toLowerCase(), meta = self._metaFor(h.path) || {}
    var native = isNumber(h.nativeScore) && isFinite(h.nativeScore) ? h.nativeScore : isNumber(h.score) && isFinite(h.score) ? h.score : __
    var lexical = isNumber(native) ? native : 0, titleScore = terms.some(function(t) { return title.indexOf(t) >= 0 }) ? 1 : 0, pathScore = terms.some(function(t) { return path.indexOf(t) >= 0 }) ? 1 : 0
    // Headings are already in the compact metadata record. Never fetch each body again.
    var heading = (meta.headings || []).some(function(hd) { return terms.some(function(t) { return String(hd.text || "").toLowerCase().indexOf(t) >= 0 }) }) ? 1 : 0
    var updated = new Date(meta.updated).getTime(), recency = isFinite(updated) ? Math.max(0, Math.min(1, 1 - (evaluatedAt - updated) / (365 * 86400000))) : 0
    var components = { lexical: 0.45 * lexical, title: 0.12 * titleScore, path: 0.08 * pathScore, heading: 0.15 * heading, recency: 0.10 * recency }
    var final = components.lexical + components.title + components.path + components.heading + components.recency
    var out = merge(h, { rankScore: final, score: final, scoreComponents: components, retrievalMethod: isNumber(native) ? "lexical" : "explicit-fallback" })
    if (isNumber(native)) out.nativeScore = native
    if (debug === true) out.score_debug = merge(components, { final: final })
    return out
  })
  ranked.sort(function(a, b) { return b.rankScore - a.rankScore })
  if (hits && hits.truncated === true) { ranked.truncated = true; ranked.scanned = hits.scanned; ranked.scanBudget = hits.scanBudget }
  return ranked
}
MiniAWikiManager.prototype.knowledgeStats = function(resetTelemetry) {
  var s = this.knowledgeLoadState()
  if (resetTelemetry === true && this._access === "rw") {
    if (this._retrievalV2) this._retrievalV2._guard(function() { this.telemetry = null; this.telemetryPending = 0 }.bind(this._retrievalV2))
    try { io.rm(this._knowledgeTelemetryPath()) } catch(ignore) {}
  }
  return { versions: MINI_A_WIKI_KNOWLEDGE, sources: Object.keys(s.sources).length, chunks: Object.keys(s.chunks).length, facts: Object.keys(s.facts).length, summaries: Object.keys(s.summaries.pages).length, telemetry: this._knowledgeLoadTelemetry() }
}
MiniAWikiManager.prototype.assembleContext = function(query, options) {
  if (this._retrievalV2) return this._retrievalV2.assemble(query, options)
  options = isMap(options) ? options : {}
  var limit = Number(options.wikicontextchunks || options.chunks || 5), budget = Number(options.wikicontexttokens || options.tokens || 2400)
  var state = this.knowledgeLoadState(), out = [], used = 0, seen = {}, pending = {}, self = this
  var journalPath = this._getIndexRoot() + "/.mini-a-wiki-ingest/journal.json"
  try {
    if (io.fileExists(journalPath)) {
      var journal = af.fromJson(io.readFileString(journalPath))
      if (journal.phase !== "complete") (journal.operations || []).forEach(function(op) { pending[op.path] = true })
    }
  } catch(e) { state._corrupt = true }
  if (state._corrupt) return { ok: false, error: "knowledge-state-unavailable", outcome: "unavailable", query: query, chunks: [], estimatedTokens: 0, budget: budget }
  var hits = this.search(query, { limit: Math.max(limit * 4, 20), debug: true })
  if (!isArray(hits)) return { ok: false, error: hits && hits.error || "search-unavailable", outcome: hits && hits.outcome || "unavailable", query: query, chunks: [], estimatedTokens: 0, budget: budget }
  hits.forEach(function(h) {
    if (pending[h.path]) return
    var raw = self._backend.read(h.path), page = isString(raw) ? self.parseFrontmatter(raw) : __
    var cs = Object.keys(state.chunks).map(function(k) { return state.chunks[k] }).filter(function(c) { return c.page === h.path && self.knowledgeChunkActive(state, c) && (!c.sourceKey || page && page.meta.source_hash === state.sources[c.sourceKey].sourceHash && page.meta.ingest_source_key === c.sourceKey) })
    cs.forEach(function(c) {
      if (out.length >= limit || seen[c.normalizedHash] || used + c.estimatedTokens > budget) return
      seen[c.normalizedHash] = true; used += c.estimatedTokens
      // The path/anchor fields are legacy navigation mappings, not evidence
      // positions in the distilled page. Never invent source quotation locators.
      out.push({ path: c.page, source: c.source, anchor: c.anchor, heading: c.section, text: c.text, estimatedTokens: c.estimatedTokens, score: h.score,
        origin: c.sourceKey ? "original-source" : "unknown", evidenceRole: c.sourceKey ? "ingestion-input" : "legacy-context",
        wikiPath: c.page, quotationStatus: "not-a-verbatim-wiki-quotation", sourceLocatorStatus: "unverified", scoreOrigin: "parent-wiki-page" })
    })
  })
  return { query: query, chunks: out, estimatedTokens: used, budget: budget }
}

// Passage provenance extends the existing fact/summary authority, never the page store.
MiniAWikiManager.prototype._knowledgeDerivativeMap = function(state, kind) {
  if (kind === "fact") return state.facts
  if (kind === "page-summary") return state.summaries.pages
  if (kind === "section-summary") return state.summaries.sections
  throw new Error("invalid-derivative-kind")
}
MiniAWikiManager.prototype._knowledgeJournalPending = function() {
  var path = this._getIndexRoot() + "/.mini-a-wiki-ingest/journal.json"
  if (!io.fileExists(path)) return false
  try { var journal = af.fromJson(io.readFileString(path)); return !isMap(journal) || !isArray(journal.operations) || journal.phase !== "complete" } catch(e) { return true }
}
MiniAWikiManager.prototype.knowledgeRecordDerivative = function(kind, id, record, supports, options) {
  var opts = isMap(options) ? options : {}, engine = this._retrievalV2, snapshot, self = this
  if (this._access !== "rw" && opts.dryRun !== true) return { ok: false, error: "wiki-read-only" }
  if (!engine) return { ok: false, error: "v2-required" }
  if (!isString(id) || !id.length || id.length > 256 || /^(?:__proto__|constructor|prototype)$/.test(id) || !isMap(record) || !isArray(supports) || !supports.length || supports.length > 16) return { ok: false, error: "invalid-derivative" }
  if (this._knowledgeJournalPending()) return { ok: false, error: "ingest-pending" }
  try {
    var state = this.knowledgeLoadState(), map = this._knowledgeDerivativeMap(state, kind)
    if (state._corrupt || !isMap(map) || !isMap(state.derivativeRegistry) || !isMap(state.derivativeRegistry.byPage)) throw new Error("knowledge-state-unavailable")
    snapshot = engine.acquire(); var pending = engine._pending(), selected = [], seen = {}
    supports.forEach(function(ref) {
      if (!isMap(ref) || !isString(ref.page) || ref.page.startsWith("@") || ref.wiki && ref.wiki !== "primary") throw new Error("nonlocal-support")
      if (ref.wikiId !== snapshot.catalog.wikiId) throw new Error("nonlocal-support")
      var path = self._normalizeRetrievalPath(ref.page), page = snapshot.catalog.pages[path], passage = snapshot.catalog.passages[ref.passageId]
      if (!page || !passage || passage.path !== path || page.revision !== ref.revision || global.MiniAWikiRetrievalV2.retired(page) || !engine._active(page, pending)) throw new Error("stale-support")
      if (!isNumber(ref.charStart) || !isNumber(ref.charEnd) || !isFinite(ref.charStart) || !isFinite(ref.charEnd) || Math.floor(ref.charStart) !== ref.charStart || Math.floor(ref.charEnd) !== ref.charEnd || ref.charStart < passage.charStart || ref.charEnd > passage.charEnd || ref.charEnd <= ref.charStart) throw new Error("invalid-support-range")
      var raw = engine._body(snapshot, page), key = path + ":" + ref.charStart + ":" + ref.charEnd
      if (seen[key]) return
      seen[key] = true
      selected.push({ wikiId: snapshot.catalog.wikiId, pageId: page.pageId, page: path, passageId: ref.passageId, revision: ref.revision, charStart: ref.charStart, charEnd: ref.charEnd, textHash: sha1(raw.substring(ref.charStart, ref.charEnd)) })
    })
    var candidate = merge(record, { origin: "derived", passageSupports: selected, invalidated: false }), key = kind + ":" + id, previous = map[id]
    if (opts.dryRun === true) return { ok: true, dryRun: true, writes: 0, kind: kind, id: id, candidate: candidate }
    ;(isMap(previous) && isArray(previous.passageSupports) ? previous.passageSupports : []).forEach(function(ref) {
      if (!isMap(ref) || !isString(ref.page)) return
      var list = (state.derivativeRegistry.byPage[ref.page] || []).filter(function(k) { return k !== key })
      if (list.length) state.derivativeRegistry.byPage[ref.page] = list; else delete state.derivativeRegistry.byPage[ref.page]
      state.dependencies[ref.page] = (state.dependencies[ref.page] || []).filter(function(k) { return k !== key })
    })
    map[id] = candidate
    selected.forEach(function(ref) {
      if (!state.derivativeRegistry.byPage[ref.page]) state.derivativeRegistry.byPage[ref.page] = []
      if (state.derivativeRegistry.byPage[ref.page].indexOf(key) < 0) state.derivativeRegistry.byPage[ref.page].push(key)
      if (!state.dependencies[ref.page]) state.dependencies[ref.page] = []
      if (state.dependencies[ref.page].indexOf(key) < 0) state.dependencies[ref.page].push(key)
    })
    return this.knowledgeSaveState(state) ? { ok: true, writes: 1, kind: kind, id: id, supports: selected.length } : { ok: false, error: "knowledge-save-failed" }
  } catch(e) { return { ok: false, error: __miniAErrMsg(e) } }
  finally { if (snapshot) engine.release(snapshot) }
}
MiniAWikiManager.prototype._knowledgeDerivativeStatus = function(record, snapshot, pending) {
  if (!isMap(record) || !isArray(record.passageSupports) || !record.passageSupports.length) return { active: false, reason: "unknown-provenance" }
  if (record.passageSupports.length > 16) return { active: false, reason: "invalid-provenance" }
  if (record.invalidated === true) return { active: false, reason: "invalidated" }
  var engine = this._retrievalV2
  for (var i = 0; i < record.passageSupports.length; i++) {
    var ref = record.passageSupports[i]
    if (!isMap(ref) || !isString(ref.page) || !isString(ref.passageId) || !/^[a-f0-9]{40}$/.test(String(ref.textHash)) || !isNumber(ref.charStart) || !isNumber(ref.charEnd) || !isFinite(ref.charStart) || !isFinite(ref.charEnd) || Math.floor(ref.charStart) !== ref.charStart || Math.floor(ref.charEnd) !== ref.charEnd) return { active: false, reason: "invalid-provenance" }
    var page = snapshot.catalog.pages[ref.page], passage = snapshot.catalog.passages[ref.passageId]
    if (!page || ref.wikiId !== snapshot.catalog.wikiId || ref.pageId !== page.pageId || ref.revision !== page.revision || !passage || passage.path !== ref.page || global.MiniAWikiRetrievalV2.retired(page) || !engine._active(page, pending)) return { active: false, reason: "stale-support", page: ref.page }
    if (ref.charStart < passage.charStart || ref.charEnd > passage.charEnd || ref.charEnd <= ref.charStart) return { active: false, reason: "invalid-provenance" }
  }
  return { active: true, reason: "current-support" }
}
MiniAWikiManager.prototype.knowledgeGetDerivative = function(kind, id) {
  var engine = this._retrievalV2, snapshot
  if (!engine) return { ok: false, error: "v2-required" }
  try {
    var state = this.knowledgeLoadState(); if (state._corrupt) throw new Error("knowledge-state-unavailable")
    if (!isString(id) || !id.length || id.length > 256 || /^(?:__proto__|constructor|prototype)$/.test(id)) throw new Error("invalid-derivative")
    var map = this._knowledgeDerivativeMap(state, kind), record = Object.prototype.hasOwnProperty.call(map, id) ? map[id] : __
    if (!record) return { ok: false, error: "derivative-not-found" }
    snapshot = engine.acquire(); var status = this._knowledgeDerivativeStatus(record, snapshot, engine._pending())
    if (status.active) record.passageSupports.forEach(function(ref) { var raw = engine._body(snapshot, snapshot.catalog.pages[ref.page]); if (sha1(raw.substring(ref.charStart, ref.charEnd)) !== ref.textHash) throw new Error("invalid-provenance") })
    return status.active ? { ok: true, origin: "derived", record: clone(record), generation: snapshot.generation, evidence: "navigation-or-claim; not-a-verbatim-quotation" } : { ok: false, error: status.reason, restart: status.reason === "stale-support" }
  } catch(e) { return { ok: false, error: __miniAErrMsg(e) } }
  finally { if (snapshot) engine.release(snapshot) }
}
MiniAWikiManager.prototype.knowledgeDerivativeCandidates = function(options, snapshot) {
  var opts = isMap(options) ? options : {}, limit = Math.min(100, Math.max(1, Math.floor(Number(opts.limit) || 25))), owned = !snapshot, engine = this._retrievalV2, self = this
  if (!engine) return { ok: false, error: "v2-required", candidates: [] }
  try {
    if (!snapshot) snapshot = engine.acquire()
    var state = this.knowledgeLoadState(); if (state._corrupt) throw new Error("knowledge-state-unavailable")
    var keys = [], selected = {}, pending = engine._pending(), inspected = 0, findings = [], discoveryBounded = false
    if (isDef(opts.paths) && !isArray(opts.paths)) throw new Error("invalid-maintenance-paths")
    if (isArray(opts.paths)) {
      discoveryBounded = opts.paths.length > 100
      opts.paths.slice(0, 100).some(function(path) {
        path = self._normalizeRetrievalPath(path)
        var postings = state.derivativeRegistry.byPage[path] || []
        for (var j = 0; j < postings.length; j++) {
          if (keys.length >= limit * 8) { discoveryBounded = true; return true }
          var key = postings[j]; if (!selected[key]) { selected[key] = true; keys.push(key) }
        }
        return false
      })
    } else {
      ;["fact", "page-summary", "section-summary"].forEach(function(kind) { Object.keys(self._knowledgeDerivativeMap(state, kind)).forEach(function(id) { keys.push(kind + ":" + id) }) })
    }
    for (var i = 0; i < keys.length && inspected < limit * 8 && findings.length < limit; i++) {
      var split = keys[i].indexOf(":"), kind = keys[i].substring(0, split), id = keys[i].substring(split + 1), record = this._knowledgeDerivativeMap(state, kind)[id]
      if (!record) continue
      inspected++; var status = this._knowledgeDerivativeStatus(record, snapshot, pending)
      if (!status.active) findings.push({ kind: status.reason === "unknown-provenance" ? "ungrounded-derivative" : "stale-derivative", derivativeKind: kind, id: id, reason: status.reason, action: "propose", origin: "derived" })
    }
    return { ok: true, mode: "report", candidates: findings, inspected: inspected, bounded: discoveryBounded || inspected < keys.length, modelCalls: 0, writes: 0 }
  } catch(e) { return { ok: false, error: __miniAErrMsg(e), candidates: [], writes: 0, modelCalls: 0 } }
  finally { if (owned && snapshot) engine.release(snapshot) }
}

// Deterministic, bounded comparison of explicitly recorded scalar claims. This
// reports disagreement; it does not extract claims or choose a true source.
MiniAWikiManager.prototype.knowledgeConflictCandidates = function(options, snapshot) {
  var opts = isMap(options) ? options : {}, limit = Math.min(100, Math.max(1, Math.floor(Number(opts.limit) || 25))), engine = this._retrievalV2, owned = !snapshot, self = this
  if (!engine) return { ok: false, error: "v2-required", candidates: [] }
  try {
    if (isDef(opts.paths) && !isArray(opts.paths)) throw new Error("invalid-maintenance-paths")
    if (!snapshot) snapshot = engine.acquire()
    var state = this.knowledgeLoadState(); if (state._corrupt) throw new Error("knowledge-state-unavailable")
    var ids = [], seen = {}, bounded = false, inspected = 0, groups = {}, findings = [], pending = engine._pending()
    if (isArray(opts.paths)) {
      bounded = opts.paths.length > 100
      opts.paths.slice(0, 100).some(function(path) {
        var postings = state.derivativeRegistry.byPage[self._normalizeRetrievalPath(path)] || []
        for (var j = 0; j < postings.length; j++) { if (ids.length >= limit * 8) { bounded = true; return true }; if (!String(postings[j]).startsWith("fact:")) continue; var id = String(postings[j]).substring(5); if (!seen[id]) { seen[id] = true; ids.push(id) } }
        return false
      })
    } else ids = Object.keys(state.facts)
    for (var i = 0; i < ids.length && inspected < limit * 8 && findings.length < limit; i++) {
      var id = ids[i], fact = state.facts[id]; inspected++
      if (!isMap(fact) || !isString(fact.claimKey) || !fact.claimKey.length || fact.claimKey.length > 128 || !(isString(fact.value) || isNumber(fact.value) && isFinite(fact.value) || isBoolean(fact.value)) || !self._knowledgeDerivativeStatus(fact, snapshot, pending).active) continue
      var applicability = isMap(fact.applicability) ? fact.applicability : {}, key = "$" + fact.claimKey, peers = groups[key] || []
      for (var k = 0; k < peers.length && findings.length < limit; k++) {
        var peer = peers[k], other = isMap(peer.fact.applicability) ? peer.fact.applicability : {}
        if (stringify(fact.value, __, "") === stringify(peer.fact.value, __, "")) continue
        if (isDef(applicability.product) && isDef(other.product) && applicability.product !== other.product) continue
        var versioned = isString(applicability.version) && isString(other.version) && applicability.version !== other.version
        var known = ["product", "version", "platform", "environment"].every(function(field) { return isString(applicability[field]) && isString(other[field]) && applicability[field] === other[field] })
        findings.push({ kind: versioned ? "version-guidance-divergence" : "recorded-claim-disagreement", claimKey: fact.claimKey, action: "review", reason: "differing-recorded-values", applicabilityOverlap: known ? "exact" : versioned ? "different-versions" : "unknown", evidence: [{ id: peer.id, applicability: clone(other), supports: clone(peer.fact.passageSupports) }, { id: id, applicability: clone(applicability), supports: clone(fact.passageSupports) }], origin: "derived", resolution: "not-automated" })
      }
      peers.push({ id: id, fact: fact }); groups[key] = peers
    }
    return { ok: true, mode: "report", candidates: findings, inspected: inspected, bounded: bounded || inspected < ids.length, writes: 0, modelCalls: 0 }
  } catch(e) { return { ok: false, error: __miniAErrMsg(e), candidates: [], writes: 0, modelCalls: 0 } }
  finally { if (owned && snapshot) engine.release(snapshot) }
}

// Only explicit approved reconciliation mutates derivative authority; reports never do.
MiniAWikiManager.prototype.knowledgeReconcileDerivatives = function(options) {
  var opts = isMap(options) ? options : {}, report = this.knowledgeDerivativeCandidates(opts), snapshot, engine = this._retrievalV2
  if (!report.ok) return report
  if (opts.dryRun !== false) return merge(report, { dryRun: true })
  if (opts.approved !== true) return { ok: false, error: "approval-required", candidates: report.candidates, writes: 0, modelCalls: 0 }
  if (this._access !== "rw") return { ok: false, error: "wiki-read-only", writes: 0 }
  if (this._knowledgeJournalPending()) return { ok: false, error: "ingest-pending", writes: 0 }
  try {
    var state = this.knowledgeLoadState(); if (state._corrupt) throw new Error("knowledge-state-unavailable")
    snapshot = engine.acquire(); var pending = engine._pending(), invalidated = [], self = this
    report.candidates.forEach(function(candidate) {
      var record = self._knowledgeDerivativeMap(state, candidate.derivativeKind)[candidate.id]
      if (!record || record.invalidated === true) return
      var status = self._knowledgeDerivativeStatus(record, snapshot, pending)
      // Never infer support or automatically delete an ungrounded legacy summary.
      if (status.reason === "stale-support" || status.reason === "invalid-provenance") { record.invalidated = true; invalidated.push({ kind: candidate.derivativeKind, id: candidate.id }) }
    })
    if (invalidated.length && !this.knowledgeSaveState(state)) throw new Error("knowledge-save-failed")
    return { ok: true, mode: "deterministic-repair", writes: invalidated.length ? 1 : 0, modelCalls: 0, invalidated: invalidated, bounded: report.bounded }
  } catch(e) { return { ok: false, error: __miniAErrMsg(e), writes: 0, modelCalls: 0 } }
  finally { if (snapshot) engine.release(snapshot) }
}

// Legacy ingestion records are usable only when referenced by their complete source list.
// Other producers retain their existing contract.
MiniAWikiManager.prototype.knowledgeChunkActive = function(state, chunk) {
  var key = chunk.sourceKey
  if (!key) {
    var owners = Object.keys(state.sources).filter(function(k) { return state.sources[k].page === chunk.page })
    if (!owners.length) return true
    return owners.some(function(k) { return (state.sources[k].chunks || []).some(function(c) { return c.id === chunk.id && c.hash === chunk.hash }) })
  }
  var source = state.sources[key]
  return isMap(source) && source.active !== false && source.page === chunk.page && source.generation === chunk.generation && sha1(String(chunk.text || "")) === chunk.hash &&
    (source.chunks || []).some(function(c) { return c.id === chunk.id && c.hash === chunk.hash })
}

// Explicit revision-bound repair; no model, inferred trust or editorial timestamp.
MiniAWikiManager.prototype.knowledgeRepairStructure = function(options) {
  var opts = isMap(options) ? options : {}, engine = this._retrievalV2, snapshot, self = this, wrote = false
  if (!engine) return { ok: false, error: "v2-required", writes: 0, modelCalls: 0 }
  try {
    var path = this._normalizeRetrievalPath(opts.path)
    if (String(opts.path).startsWith("@") || this._isSearchExcludedPath(path)) throw new Error("protected-repair-path")
    if (opts.kind !== "missing-heading") throw new Error("unsupported-structural-repair")
    if (!isString(opts.revision) || !/^[a-f0-9]{40}$/.test(opts.revision)) throw new Error("repair-revision-required")
    snapshot = engine.acquire()
    var page = snapshot.catalog.pages[path]
    if (!page || page.revision !== opts.revision) throw new Error("stale-repair-proposal")
    if (!engine._active(page,engine._pending())) throw new Error("stale-or-pending-evidence")
    var raw = this._backend.read(path)
    if (!isString(raw) || sha1(raw) !== opts.revision) throw new Error("stale-repair-proposal")
    var parsed = global.MiniAWikiRetrievalV2.parse(path,raw,engine.config.passageChars,true)
    if (parsed.outline.length) throw new Error("repair-no-longer-applicable")
    var title = isString(page.metadata.title) ? page.metadata.title.trim() : ""
    if (!title || title.length > 240 || /[\x00-\x1f\x7f#`]/.test(title)) throw new Error("heading-title-required")
    var newline = raw.indexOf("\r\n") >= 0 ? "\r\n" : "\n", offset = parsed.bodyStart
    var insertion = (offset && raw.charAt(offset-1) !== "\n" ? newline : "") + "# " + title + newline + newline
    var proposed = raw.substring(0,offset) + insertion + raw.substring(offset)
    var proposal = { kind: opts.kind, path: path, revision: opts.revision, charOffset: offset, insertedText: insertion, proposedRevision: sha1(proposed) }
    if (opts.dryRun !== false) return { ok: true, mode: "propose", dryRun: true, proposal: proposal, writes: 0, modelCalls: 0 }
    if (opts.approved !== true) return { ok: false, error: "approval-required", proposal: proposal, writes: 0, modelCalls: 0 }
    if (this._access !== "rw") throw new Error("wiki-read-only")
    if (this._knowledgeJournalPending()) throw new Error("ingest-pending")
    return engine._guard(function() {
      if (self._knowledgeJournalPending()) throw new Error("ingest-pending")
      var current = self._backend.read(path)
      if (!isString(current) || sha1(current) !== opts.revision) throw new Error("stale-repair-proposal")
      self._backend.write(path,proposed); wrote = true
      self._invalidateReadCache()
      self._updatePageIndexes(path,proposed,self.parseFrontmatter(proposed))
      self._logWrite(path,page.metadata)
      return { ok: !self._lastServingUpdate || self._lastServingUpdate.ok === true, mode: "deterministic-repair", proposal: proposal, writes: 1, modelCalls: 0, publication: self._lastServingUpdate }
    })
  } catch(e) { return { ok: false, error: __miniAErrMsg(e), writes: wrote ? 1 : 0, modelCalls: 0 } }
  finally { if(snapshot)engine.release(snapshot) }
}

// OpenAF load()/require() callers may hold a constructor from another library scope.
// Install the shared primitives on that instance without opening another manager.
global.__miniAWikiKnowledge = { versions: MINI_A_WIKI_KNOWLEDGE, Budget: MiniAWikiKnowledgeBudget, methods: {} }
Object.keys(MiniAWikiManager.prototype).forEach(function(k) {
  if (/^(knowledge|_knowledge|assembleContext)/.test(k)) global.__miniAWikiKnowledge.methods[k] = MiniAWikiManager.prototype[k]
})

global.__miniAWikiKnowledge.install = function(manager) {
  Object.keys(global.__miniAWikiKnowledge.methods).forEach(function(key) {
    if (!isFunction(manager[key]) || key === "assembleContext" && manager[key] === manager._assembleContextPlaceholder) manager[key] = global.__miniAWikiKnowledge.methods[key]
  })
  return manager
}
