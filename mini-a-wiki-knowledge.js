// Author: OpenAF
// License: Apache 2.0
// Description: Wiki incremental knowledge primitives. Kept dependency-free so it can run
//              on every Mini-A wiki backend; mutable state always lives in the index cache.

var MINI_A_WIKI_KNOWLEDGE = { manifest: 1, chunker: 1, semantic: 1, prompt: 1, ranking: 1 }

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

MiniAWikiManager.prototype._knowledgeStatePath = function() { return this._ensureIndexRoot() + "/.mini-a-wiki-state/manifest.json" }
MiniAWikiManager.prototype._knowledgeEmptyState = function() { return { version: MINI_A_WIKI_KNOWLEDGE.manifest, versions: MINI_A_WIKI_KNOWLEDGE, sources: {}, chunks: {}, pages: {}, dependencies: {}, facts: {}, summaries: { pages: {}, sections: {} }, telemetry: { queries: {}, zero_results: 0 }, updated: new Date().toISOString() } }
MiniAWikiManager.prototype.knowledgeLoadState = function() {
  if (this._access !== "rw" && !io.fileExists(this._knowledgeStatePath())) return this._knowledgeEmptyState()
  try { var v = af.fromJson(io.readFileString(this._knowledgeStatePath())); return isMap(v) && isMap(v.sources) ? v : this._knowledgeEmptyState() } catch(e) { this._logFn("warn", "[wiki] manifest unreadable; starting with safe empty state: " + __miniAErrMsg(e)); return this._knowledgeEmptyState() }
}
MiniAWikiManager.prototype.knowledgeSaveState = function(state) {
  if (this._access !== "rw") return false
  var p = this._knowledgeStatePath(), dir = p.substring(0, p.lastIndexOf("/")), tmp = p + ".tmp-" + new Date().getTime()
  try { if (!io.fileExists(dir)) io.mkdir(dir); state.updated = new Date().toISOString(); io.writeFileString(tmp, stringify(state, __, "")); var f = new java.io.File(tmp), t = new java.io.File(p); if (!f.renameTo(t)) { io.writeFileString(p, io.readFileString(tmp)); f.delete() }; return true } catch(e) { try { new java.io.File(tmp).delete() } catch(ignore) {}; this._logFn("warn", "[wiki] manifest was not saved: " + __miniAErrMsg(e)); return false }
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
  var body = this.knowledgeNormalize(text), lines = body.split("\n"), out = [], stack = [], cur = [], ordinal = 0, self = this
  var emit = function(parts) { var x = parts.join("\n").trim(); if (!x) return; var section = stack.length ? stack.map(function(h) { return h.text }).join(" > ") : String(source); var anchor = stack.length ? stack[stack.length - 1].anchor : self._headingAnchor(String(source).replace(/\.[^.]+$/, "")); var add = function(t, suffix) { var n = self.knowledgeNormalize(t); if (!n.trim()) return; ordinal++; var ident = String(source) + "#" + anchor + (suffix ? "-" + suffix : ""); out.push({ id: sha1(ident), source: source, sourceId: sha1(String(source)), section: section, anchor: anchor, kind: "section", hash: sha1(t), normalizedHash: sha1(n), text: t, chars: t.length, estimatedTokens: self.knowledgeEstimateTokens(t), ordinal: ordinal, identity: ident, ancestry: stack.map(function(h) { return h.text }) }) }
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
MiniAWikiManager.prototype.knowledgeRecordTelemetry = function(query, hits, enabled) { if (enabled !== true || this._access !== "rw") return; var s = this.knowledgeLoadState(), k = sha1(String(query || "").toLowerCase().replace(/\s+/g, " ").trim()), e = s.telemetry.queries[k] || { frequency: 0 }; e.frequency++; e.last_used = new Date().toISOString(); e.results = (isArray(hits) ? hits : []).map(function(h) { return h.chunkId || h.path }); s.telemetry.queries[k] = e; if (!e.results.length) s.telemetry.zero_results++; this.knowledgeSaveState(s) }
MiniAWikiManager.prototype.knowledgeRank = function(query, hits, debug) {
  var q = String(query || "").toLowerCase(), terms = q.split(/\s+/).filter(function(x) { return x.length > 1 }), self = this
  var ranked = (isArray(hits) ? hits : []).map(function(h, i) {
    var path = String(h.path || "").toLowerCase(), title = String(h.title || "").toLowerCase(), meta = self._metaFor(h.path) || {}, lexical = isNumber(h.score) ? h.score : Math.max(0, 1 - i / Math.max(1, hits.length)), titleScore = terms.some(function(t) { return title.indexOf(t) >= 0 }) ? 1 : 0, pathScore = terms.some(function(t) { return path.indexOf(t) >= 0 }) ? 1 : 0, heading = 0
    try { var p = self.read(h.path); heading = isMap(p) && terms.some(function(t) { return String(p.body || "").toLowerCase().match(new RegExp("^#+\\s+.*" + t, "m")) }) ? 1 : 0 } catch(ignore) {}
    var recency = meta.updated ? Math.max(0, 1 - (new Date().getTime() - new Date(meta.updated).getTime()) / (365 * 86400000)) : 0
    var final = 0.45 * lexical + 0.12 * titleScore + 0.08 * pathScore + 0.15 * heading + 0.10 * recency
    var out = merge({}, h, { score: final }); if (debug === true) out.score_debug = { lexical: 0.45 * lexical, title: 0.12 * titleScore, path: 0.08 * pathScore, heading: 0.15 * heading, graph: 0, recency: 0.10 * recency, semantic: 0, final: final }; return out
  })
  ranked.sort(function(a, b) { return b.score - a.score }); return ranked
}
MiniAWikiManager.prototype.knowledgeStats = function(resetTelemetry) { var s = this.knowledgeLoadState(); if (resetTelemetry === true && this._access === "rw") { s.telemetry = { queries: {}, zero_results: 0 }; this.knowledgeSaveState(s) }; return { versions: MINI_A_WIKI_KNOWLEDGE, sources: Object.keys(s.sources).length, chunks: Object.keys(s.chunks).length, facts: Object.keys(s.facts).length, summaries: Object.keys(s.summaries.pages).length, telemetry: s.telemetry } }
MiniAWikiManager.prototype.assembleContext = function(query, options) { options = isMap(options) ? options : {}; var limit = Number(options.wikicontextchunks || options.chunks || 5), budget = Number(options.wikicontexttokens || options.tokens || 2400), hits = this.search(query, { limit: Math.max(limit * 4, 20), debug: true }), state = this.knowledgeLoadState(), out = [], used = 0, seen = {}; hits.forEach(function(h) { var cs = Object.keys(state.chunks).map(function(k) { return state.chunks[k] }).filter(function(c) { return c.page === h.path }); cs.forEach(function(c) { if (out.length >= limit || seen[c.normalizedHash] || used + c.estimatedTokens > budget) return; seen[c.normalizedHash] = true; used += c.estimatedTokens; out.push({ path: c.page, source: c.source, anchor: c.anchor, heading: c.section, text: c.text, estimatedTokens: c.estimatedTokens, score: h.score }) }) }); return { query: query, chunks: out, estimatedTokens: used, budget: budget } }
