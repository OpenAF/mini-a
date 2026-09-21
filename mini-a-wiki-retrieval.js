// Author: OpenAF
// License: Apache 2.0
// Derived, opt-in passage serving. Markdown remains the only editable authority.
var MiniAWikiRetrievalV2 = function(manager, config) {
  this.manager = manager
  loadLib("mini-a-wiki-knowledge.js")
  global.__miniAWikiKnowledge.install(manager)
  this.config = MiniAWikiRetrievalV2.config(config)
  this.root = manager._getIndexRoot() + "/.mini-a-wiki-serving"
  this.lock = new java.util.concurrent.locks.ReentrantLock()
  this._resourceSlots=new java.util.concurrent.Semaphore(3)
  this._pendingClosures=new java.util.concurrent.ConcurrentLinkedQueue()
  this.serving = []; this.cache = {}; this.cacheOrder = []; this.cacheSizes = {}; this.cacheBytes = 0
  this.analyzers = java.util.Collections.synchronizedMap(new java.util.IdentityHashMap())
  this.closed = false
  this.metrics = { readerOpens: 0, resourceCloseFailures: 0, cacheHits: 0, cacheMisses: 0, bodyReads: 0, bytesRead: 0, parsedPages: 0, validationBlockReads: 0, validationBlockBytes: 0, validationReusedPages: 0, catalogueShardReads: 0, catalogueShardBytes: 0, catalogueLookups: 0 }
  this.metrics.catalogueCacheHits = 0; this.metrics.catalogueCacheMisses = 0; this.metrics.cacheEvictions = 0
  var closeFailures=new java.util.concurrent.atomic.AtomicLong(0)
  this._closeFailures=closeFailures
  Object.defineProperty(this.metrics,"resourceCloseFailures",{enumerable:true,get:function(){return Number(closeFailures.get())}})
  var fields = ["prose", "title", "heading", "exact"]
  if (manager._lexicalConfig.shingles) fields.push("prose__shingle")
  if (manager._lexicalConfig.ngrams) fields.push("prose__ngram")
  var analysis
  try {
    analysis = this._analyzer()
    var effective = ow.ch.__types.searchdb.__lexicalOptions(manager._luceneLexicalOptions())
    this.indexContract = { analyzer: String(this.analyzers.get(analysis).get(0).getClass().getName()), exactAnalyzer: "org.apache.lucene.analysis.standard.StandardAnalyzer", analysisVersion: String(Packages.org.apache.lucene.util.Version.LATEST), enhancedAsciiFolding: effective.asciiFolding, shingles: {enabled:effective.shingles.enabled,minSize:effective.shingles.minSize,maxSize:effective.shingles.maxSize}, characterNGrams: {enabled:effective.characterNGrams.enabled,minGram:effective.characterNGrams.minGram,maxGram:effective.characterNGrams.maxGram} }
  } catch(capabilityError) { this.capabilityError = __miniAErrMsg(capabilityError); this.indexContract = { unavailable: true } }
  finally { if (analysis) this._closeAnalyzer(analysis) }
  this.fingerprint = sha1(stringify({ schema: 1, parser: 6, fields: fields, indexContract: this.indexContract }, __, ""))
}
MiniAWikiRetrievalV2.config = function(value) {
  if (isString(value)) value = af.fromJSSLON(value)
  if (isUnDef(value)) value = {}
  if (!isMap(value)) throw new Error("wikiretrievalconfig must be a SLON/JSON object")
  var defaults = { passageChars: 1400, cacheBytes: 8388608, maxArtifactBytes: 268435456, maxArtifactFiles: 100000, maxMillis: 15000, telemetryFlushQueries: 16, telemetryRetentionDays: 30, linkImmutableFiles: true, sharedBlockStore: false, telemetrySampleQueries: false }
  Object.keys(value).forEach(function(k) {
    if (k === "bundlePath") { if (!isString(value[k]) || !value[k].trim().length || value[k].length > 4096) throw new Error("Invalid wikiretrievalconfig option: " + k); defaults[k] = value[k]; return }
    if (k === "linkImmutableFiles" || k === "sharedBlockStore" || k === "telemetrySampleQueries") { if (!isBoolean(value[k])) throw new Error("Invalid wikiretrievalconfig option: " + k); defaults[k] = value[k]; return }
    if (isUnDef(defaults[k]) || !isFinite(Number(value[k])) || Number(value[k]) !== Math.floor(Number(value[k])) || Number(value[k]) < 1) throw new Error("Invalid wikiretrievalconfig option: " + k)
    defaults[k] = Number(value[k])
  })
  if (defaults.telemetryFlushQueries > 1000 || defaults.telemetryRetentionDays > 365 || defaults.passageChars < 64 || defaults.passageChars > 16000 || defaults.cacheBytes > 268435456 || defaults.maxArtifactBytes > 2147483647 || defaults.maxArtifactFiles > 1000000 || defaults.maxMillis > 120000) throw new Error("wikiretrievalconfig exceeds supported bounds")
  return defaults
}
MiniAWikiRetrievalV2.bytes = function(text) { return Number(new java.lang.String(String(text)).getBytes("UTF-8").length) }
MiniAWikiRetrievalV2.digestText = function(text) {
  var bytes = java.security.MessageDigest.getInstance("SHA-256").digest(new java.lang.String(String(text)).getBytes("UTF-8")), out = ""
  for (var i = 0; i < bytes.length; i++) out += ("0" + ((Number(bytes[i]) + 256) % 256).toString(16)).slice(-2)
  return out
}
MiniAWikiRetrievalV2.immutable = function(value) {
  var pending = [value]
  while (pending.length) {
    var record = pending.pop()
    if (!record || typeof record !== "object" || Object.isFrozen(record)) continue
    Object.keys(record).forEach(function(key) { var child = record[key]; if (child && typeof child === "object") pending.push(child) })
    Object.freeze(record)
  }
  return value
}
MiniAWikiRetrievalV2.digest = function(path) {
  var digest = java.security.MessageDigest.getInstance("SHA-256"), stream = new java.io.FileInputStream(path)
  var buf = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 65536), n
  try { while ((n = stream.read(buf)) !== -1) digest.update(buf, 0, n) } finally { stream.close() }
  var bytes = digest.digest(), out = ""
  for (var i = 0; i < bytes.length; i++) out += ("0" + ((Number(bytes[i]) + 256) % 256).toString(16)).slice(-2)
  return out
}
// The serving manifest is signed by a deterministic, content-addressed root.
// Do not include `merkle` itself: callers must be able to recompute it before
// opening a Lucene reader or following an ancestor.
MiniAWikiRetrievalV2.manifestMerkle = function(manifest) {
  var copy = {}, keys = Object.keys(manifest).filter(function(key) { return key !== "merkle" }).sort()
  keys.forEach(function(key) { copy[key] = manifest[key] })
  return MiniAWikiRetrievalV2.digestText(stringify(copy, __, ""))
}
MiniAWikiRetrievalV2.slug = function(text) {
  return String(new java.lang.String(String(text).toLowerCase()).replaceAll("[^\\p{L}\\p{N} _-]", "")).trim().replace(/\s+/g, "-") || "section"
}
MiniAWikiRetrievalV2.positions = function(raw) {
  raw=String(raw)
  var lines=raw.split("\n"), starts=[], byteStarts=[], chars=0, bytes=0
  lines.forEach(function(line,index){starts.push(chars);byteStarts.push(bytes);var text=line+(index<lines.length-1?"\n":"");chars+=text.length;bytes+=MiniAWikiRetrievalV2.bytes(text)})
  var lineFor=function(position){var lo=0,hi=starts.length-1;while(lo<hi){var mid=Math.ceil((lo+hi)/2);if(starts[mid]<=position)lo=mid;else hi=mid-1}return lo+1}
  return {lines:lines,starts:starts,byteStarts:byteStarts,lineFor:lineFor,byteAt:function(position){var line=lineFor(position)-1;return byteStarts[line]+MiniAWikiRetrievalV2.bytes(raw.substring(starts[line],position))}}
}
// Bounded Markdown interpretation; raw UTF-16/UTF-8 positions are never normalized.
MiniAWikiRetrievalV2.contextLabel = function(line) {
  return /^ {0,3}(?:>\s*)?(?:\[!(?:warning|caution|important)\]\s*$|(?:\*\*|__)?(?:warnings?|caution|important|prerequisites?|aviso|atenção|pré[- ]requisitos?)(?:\s*:\s*(?:\*\*|__)?(?:\s|$)|\s*$))/i.test(String(line))
}
MiniAWikiRetrievalV2.fenceMarker = function(line) { return /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(String(line).replace(/\r$/, "")) }
MiniAWikiRetrievalV2.isIndentedCode = function(line) { return /^( {4}|\t)/.test(String(line)) }
// Page postings are validated in raw-position order. Locate the first possible
// overlap without enumerating preceding passages or unrelated corpus records.
MiniAWikiRetrievalV2.passageAt = function(page, passages, position, used) {
  var lo = 0, hi = page.passageIds.length
  while (lo < hi) {
    var mid = Math.floor((lo + hi) / 2), passage = passages[page.passageIds[mid]]
    if (used) used.structuralContextLookupProbes = (Number(used.structuralContextLookupProbes) || 0) + 1
    if (passage.charEnd <= position) lo = mid + 1
    else hi = mid
  }
  return lo
}
MiniAWikiRetrievalV2.prerequisiteRange = function(page, passages, record, used) {
  if (!record.structure) return null
  var outline = page.outline || [], low = 0, high = outline.length, structureLine = record.structure.startLine
  var charge = function() { if (used) used.structuralContextLookupProbes = (Number(used.structuralContextLookupProbes) || 0) + 1 }
  while (low < high) { charge(); var middle = Math.floor((low + high) / 2); if (outline[middle].lineStart <= structureLine) low = middle + 1; else high = middle }
  var current = outline[low - 1], previous = null, cursor = low - 1, probes = 0
  if (!current || current.id !== record.headingId) return null
  // A nested step inherits the prerequisite immediately preceding its parent
  // procedure. Never cross an intervening sibling procedure to find support.
  while (cursor >= 0 && probes < 64) {
    current = outline[cursor]
    var preceding = cursor - 1
    while (preceding >= 0 && outline[preceding].level > current.level && probes < 64) { charge(); probes++; preceding-- }
    if (preceding < 0 || probes >= 64) return null
    var candidate = outline[preceding]; charge(); probes++
    if (structureLine - candidate.lineStart > 64) return null
    if (candidate.level === current.level && candidate.lineEnd === current.lineStart - 1 && /^(?:prerequisites?|pré-requisitos?)\s*:?$/i.test(candidate.title.trim())) { previous = candidate; break }
    while (preceding >= 0 && outline[preceding].level >= current.level && probes < 64) { charge(); probes++; preceding-- }
    cursor = preceding
  }
  if (!previous) return null
  var startFor = function(line) {
    var begin = 0, end = page.passageIds.length
    while (begin < end) { charge(); var index = Math.floor((begin + end) / 2), passage = passages[page.passageIds[index]]; if (passage.startLine < line) begin = index + 1; else end = index }
    var found = passages[page.passageIds[begin]]
    return found && found.startLine === line ? found.charStart : null
  }
  var start = startFor(previous.lineStart), end = startFor(current.lineStart)
  if (start === null || end === null || end <= start) return null
  return { kind: "prerequisite-section", charStart: start, charEnd: end, startLine: previous.lineStart, endLine: previous.lineEnd }
}
MiniAWikiRetrievalV2.supportRanges = function(page, passages, record, selectedStart, used) {
  var nearest = record.contextRange || (record.structure && record.structure.headerRange && selectedStart >= record.structure.headerRange.charEnd ? record.structure.headerRange : null)
  return MiniAWikiRetrievalV2.mergeSupportRanges([nearest, record.structure && record.structure.warningRange, MiniAWikiRetrievalV2.prerequisiteRange(page, passages, record, used)])
}
// Required structural spans can partially overlap after a parser improvement or
// when a page combines labels. Serve their raw union once, retaining every role
// so a caller never pays twice or loses why the context was selected.
MiniAWikiRetrievalV2.mergeSupportRanges = function(ranges) {
  var ordered = (ranges || []).filter(function(range) {
    return isMap(range) && isFinite(range.charStart) && isFinite(range.charEnd) && range.charStart >= 0 && range.charEnd > range.charStart
  }).map(function(range) {
    var copy = clone(range)
    copy.kinds = isArray(copy.kinds) ? copy.kinds.slice() : (isString(copy.kind) ? [copy.kind] : [])
    return copy
  })
  var merged = []
  ordered.forEach(function(range) {
    // Preserve caller priority for disjoint support (for example, a complete
    // table header before a warning) while collapsing truly overlapping spans.
    var target = merged.filter(function(previous) { return range.charStart < previous.charEnd && previous.charStart < range.charEnd })[0]
    if (!target) { merged.push(range); return }
    target.charStart = Math.min(target.charStart, range.charStart)
    target.charEnd = Math.max(target.charEnd, range.charEnd)
    target.startLine = Math.min(target.startLine, range.startLine)
    target.endLine = Math.max(target.endLine, range.endLine)
    range.kinds.forEach(function(kind) { if (target.kinds.indexOf(kind) < 0) target.kinds.push(kind) })
    target.kind = target.kinds.length === 1 ? target.kinds[0] : "structural-context"
    // A later range can bridge two earlier spans. Collapse that union without
    // reordering unrelated contexts.
    for (var i = merged.length - 1; i >= 0; i--) {
      var other = merged[i]
      if (other === target || !(target.charStart < other.charEnd && other.charStart < target.charEnd)) continue
      target.charStart = Math.min(target.charStart, other.charStart); target.charEnd = Math.max(target.charEnd, other.charEnd)
      target.startLine = Math.min(target.startLine, other.startLine); target.endLine = Math.max(target.endLine, other.endLine)
      other.kinds.forEach(function(kind) { if (target.kinds.indexOf(kind) < 0) target.kinds.push(kind) })
      target.kind = target.kinds.length === 1 ? target.kinds[0] : "structural-context"
      merged.splice(i,1)
    }
  })
  return merged
}
MiniAWikiRetrievalV2.parse = function(path, raw, target, outlineOnly, mappedPositions) {
  raw = String(raw); target = Number(target) || 1400
  var positions=mappedPositions||MiniAWikiRetrievalV2.positions(raw), lines=positions.lines, starts=positions.starts, byteStarts=positions.byteStarts, frontEnd=0
  if (/^---\r?$/.test(lines[0])) for (var f = 1; f < lines.length; f++) if (/^(---|\.\.\.)\r?$/.test(lines[f])) { frontEnd = f + 1; break }
  var headings = [], occurrences = Object.create(null), stack = [], fence = null, code = {}, section = {}, searchable = [], fenced = {}
  for (var l = frontEnd; l < lines.length; l++) {
    var line = lines[l].replace(/\r$/, ""), fm = MiniAWikiRetrievalV2.fenceMarker(line)
    if (fence) {
      code[l] = true
      fenced[l] = fence.id + 1
      if (fm && fm[1].charAt(0) === fence.char && fm[1].length >= fence.length && !fm[2].trim()) fence = null
      continue
    }
    if (fm) { fence = { id: l, char: fm[1].charAt(0), length: fm[1].length }; code[l] = true; fenced[l] = fence.id + 1; continue }
    if (MiniAWikiRetrievalV2.isIndentedCode(line)) { code[l] = true; continue }
    var atx = /^ {0,3}(#{1,6})(?:\s+|$)(.*?)\s*#*\s*\r?$/.exec(line), text = __, level = __, headingLine = l
    if (atx) { level = atx[1].length; text = atx[2].trim() }
    else if (/^ {0,3}(=+|-+)\s*\r?$/.test(line) && l > frontEnd && lines[l - 1].trim() && !code[l - 1] && !/^\s*(#|[-*+]>?|\||\d+\.)/.test(lines[l - 1])) {
      level = line.trim().charAt(0) === "=" ? 1 : 2; text = lines[l - 1].trim(); headingLine = l - 1
    }
    if (isDef(level)) {
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
      var base = MiniAWikiRetrievalV2.slug(text); occurrences[base] = (Object.prototype.hasOwnProperty.call(occurrences, base) ? occurrences[base] : 0) + 1
      var h = { id: base + (occurrences[base] > 1 ? "-" + occurrences[base] : ""), title: text, level: level, lineStart: headingLine + 1, lineEnd: lines.length }
      headings.push(h); stack.push(h); section[headingLine] = stack.map(function(x) { return { id: x.id, title: x.title, level: x.level } })
    }
    searchable.push(line)
  }
  headings.forEach(function(h, i) { for (var j = i + 1; j < headings.length; j++) if (headings[j].level <= h.level) { h.lineEnd = headings[j].lineStart - 1; break } })
  if (outlineOnly === true) return {revision:sha1(raw),outline:headings,linesTotal:lines.length,linkText:searchable.join("\n"),bodyStart:frontEnd<starts.length?starts[frontEnd]:raw.length}
  var revision = sha1(raw), passages = [], ancestry = [], begin = frontEnd, lastBoundary = frontEnd, lastStructureEnd = frontEnd, ordinals = {}
  var lineFor = positions.lineFor
  var instructionContext = function(start, kind) {
    var label = -1
    for (var before = start - 1; before >= Math.max(frontEnd, kind === "list" ? lastStructureEnd : frontEnd, start - 64); before--) {
      if (section[before] || code[before]) break
      if (MiniAWikiRetrievalV2.contextLabel(lines[before])) label = before
    }
    if (label < 0) return __
    return { kind: "instruction-context", charStart: starts[label], charEnd: starts[start], startLine: label + 1, endLine: start }
  }
  var emit = function(start, end, lineage, fragment, structure) {
    var startChar = starts[start], endChar = end < lines.length ? starts[end] : raw.length
    if (isUnDef(startChar) || endChar <= startChar) return
    for (var pos = startChar, piece = 0; pos < endChar;) {
      // A soft target may retain a complete bounded Markdown structure.
      var stop = structure && endChar - startChar <= target * 2 ? endChar : Math.min(endChar, pos + Math.max(target, 64))
      if (stop < endChar) {
        var nl = raw.lastIndexOf("\n", stop - 1)
        if (nl >= pos) stop = nl + 1
        // Never separate a UTF-16 surrogate pair.
        if (stop > pos && /[\uD800-\uDBFF]/.test(raw.charAt(stop - 1))) stop--
      }
      var text = raw.substring(pos, stop)
      if (text.trim()) {
        var identity = path + "#" + lineage.map(function(h) { return h.id }).join("/")
        var ordinal = ordinals[identity] || 0; ordinals[identity] = ordinal + 1
        var id = sha1(identity + "@" + ordinal)
        var record = { passageId: id, revision: revision, kind: fragment || pos > startChar || stop < endChar ? "fragment" : "passage", headingId: lineage.length ? lineage[lineage.length - 1].id : "", headingAncestry: lineage.map(function(h) { return h.title }), startLine: lineFor(pos), endLine: lineFor(Math.max(pos, stop - 1)), charStart: pos, charEnd: stop, byteStart: byteStarts[lineFor(pos) - 1] + MiniAWikiRetrievalV2.bytes(raw.substring(starts[lineFor(pos) - 1], pos)), byteEnd: byteStarts[lineFor(stop - 1) - 1] + MiniAWikiRetrievalV2.bytes(raw.substring(starts[lineFor(stop - 1) - 1], stop)), estimatedTokens: Math.ceil(text.length / 4), text: text, origin: "wiki-page" }
        if (structure) {
          record.structure = { kind: structure.kind, charStart: startChar, charEnd: endChar, startLine: start + 1, endLine: lineFor(Math.max(startChar,endChar - 1)), fragment: record.kind === "fragment" }
          if (structure.headerEnd) record.structure.headerRange = { kind: "table-header", charStart: startChar, charEnd: starts[structure.headerEnd], startLine: start + 1, endLine: structure.headerEnd }
          if (structure.headerEnd && pos >= starts[structure.headerEnd]) record.contextRange = { kind: "table-header", charStart: startChar, charEnd: starts[structure.headerEnd], startLine: start + 1, endLine: structure.headerEnd }
          if (structure.contextRange) record.contextRange = clone(structure.contextRange)
          if (structure.warningRange) record.structure.warningRange = clone(structure.warningRange)
        }
        passages.push(record)
      }
      pos = stop; piece++
    }
  }
  for (var p = frontEnd; p < lines.length; p++) {
    if (section[p]) { emit(begin, p, ancestry, false); begin = p; ancestry = section[p]; lastBoundary = p }
    var structure = null, structureEnd = p
    if (code[p]) {
      structure = { kind: fenced[p] ? "fenced-code" : "indented-code" }
      while (structureEnd < lines.length && code[structureEnd] && fenced[structureEnd] === fenced[p]) structureEnd++
    } else if (p + 1 < lines.length && /\|/.test(lines[p]) && /^ {0,3}\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*\r?$/.test(lines[p + 1])) {
      structure = { kind: "table", headerEnd: p + 2 }; structureEnd = p + 2
      while (structureEnd < lines.length && !code[structureEnd] && lines[structureEnd].trim() && /\|/.test(lines[structureEnd]) && !section[structureEnd]) structureEnd++
    } else if (!section[p - 1] && /^ {0,3}(?:[-*+]|\d+[.)])\s+/.test(lines[p])) {
      structure = { kind: "list" }; structureEnd = p + 1
      while (structureEnd < lines.length && !section[structureEnd] && !MiniAWikiRetrievalV2.fenceMarker(lines[structureEnd])) {
        var item = lines[structureEnd]
        if (/^ {0,3}(?:[-*+]|\d+[.)])\s+/.test(item) || /^ {2,}\S/.test(item)) { structureEnd++; continue }
        if (!item.trim() && structureEnd + 1 < lines.length && (/^ {0,3}(?:[-*+]|\d+[.)])\s+/.test(lines[structureEnd + 1]) || section[structureEnd + 1])) { structureEnd++; continue }
        break
      }
    }
    if (structure) {
      if (structure.kind !== "table") structure.contextRange = instructionContext(p, structure.kind)
      else { var tableContext = instructionContext(p, structure.kind); if (tableContext) { tableContext.kind = "table-context"; structure.warningRange = tableContext } }
      emit(begin,p,ancestry,false)
      emit(p,structureEnd,ancestry,false,structure)
      begin=structureEnd; lastBoundary=structureEnd; lastStructureEnd=structureEnd; p=structureEnd-1
      continue
    }
    if (!code[p] && !lines[p].trim()) lastBoundary = p + 1
    var next = p + 1 < lines.length ? starts[p + 1] : raw.length
    if (next - starts[begin] >= target && lastBoundary > begin) { emit(begin, lastBoundary, ancestry, false); begin = lastBoundary }
  }
  emit(begin, lines.length, ancestry, false)
  return { revision: revision, outline: headings, passages: passages, linkText: searchable.join("\n"), linesTotal: lines.length }
}
MiniAWikiRetrievalV2.prototype._guard = function(fn, deadline) {
  var remaining = isNumber(deadline) ? Math.floor(deadline - Date.now()) : 1000
  if (remaining <= 0) throw new Error("request-deadline-exhausted")
  if (!this.lock.tryLock(Math.min(1000, remaining), java.util.concurrent.TimeUnit.MILLISECONDS)) throw new Error(isNumber(deadline) && Date.now() >= deadline ? "request-deadline-exhausted" : "retrieval-busy")
  try {
    this._drainReleases()
    if (isNumber(deadline) && Date.now() >= deadline) throw new Error("request-deadline-exhausted")
    return fn()
  } finally {
    try { this._drainReleases() } finally { this.lock.unlock(); this._flushReleases() }
  }
}
// Releases cannot time out behind cold artifact or immutable-block reads.
// Only the serving lock owner changes refs or closes a managed reader.
MiniAWikiRetrievalV2.prototype._drainReleases = function() {
  this._drainPendingClosures()
  for (var i=this.serving.length-1;i>=0;i--) {
    var snapshot=this.serving[i]
    snapshot.refs-=Number(snapshot.pendingReleases.getAndSet(0))
    if((this.closed || snapshot._closePending) && snapshot.refs===0) {
      try { this._closeSnapshot(snapshot);this.serving.splice(i,1) }
      catch(closeError) {
        try{this.manager._logFn("warn","[wiki] serving resource closure deferred")}catch(ignoreLog){}
      }
    }
  }
}
MiniAWikiRetrievalV2.prototype._drainPendingClosures = function() {
  var count=Math.min(3,Number(this._pendingClosures.size()))
  for(var i=0;i<count;i++) {
    var snapshot=this._pendingClosures.poll();if(!snapshot)break
    snapshot._closeQueued.set(false)
    try{this._closeSnapshot(snapshot)}catch(e){try{this.manager._logFn("warn","[wiki] staged resource closure deferred")}catch(ignoreLog){}}
  }
}
MiniAWikiRetrievalV2.prototype._flushReleases = function() {
  // Recheck after unlocking: a release may arrive between the last drain and
  // unlock. If another owner wins the lock, its finally block drains the queue.
  do {
    if(!this.lock.tryLock())return
    try { this._drainReleases() } finally { this.lock.unlock() }
  } while(this.serving.some(function(snapshot){return snapshot.pendingReleases.get()>0}))
}
MiniAWikiRetrievalV2.prototype._path = function(base, relative) {
  if (!isString(relative) || !/^(catalogue\/(?:pages|passages|reverseLinks|moveReverse|blockRefs)\/[a-f0-9]{2}\.json|index\/[A-Za-z0-9_.-]+|blocks\/[a-f0-9]{40}\.md)$/.test(relative) || relative.indexOf("..") >= 0) throw new Error("unsafe-artifact-path")
  var file = new java.io.File(base, relative), canonical = String(file.getCanonicalPath())
  if (canonical.indexOf(String(new java.io.File(base).getCanonicalPath()) + "/") !== 0 || java.nio.file.Files.isSymbolicLink(file.toPath())) throw new Error("unsafe-artifact-path")
  return canonical
}
MiniAWikiRetrievalV2.prototype._writeServingFile = function(path, text) {
  if (isFunction(text)) return text(path)
  io.writeFileString(path, text)
}
MiniAWikiRetrievalV2.prototype._syncPath = function(path, directory) {
  var started = Number(java.lang.System.nanoTime()), channel, ok = false
  try {
    channel = java.nio.channels.FileChannel.open(new java.io.File(path).toPath(), directory ? java.nio.file.StandardOpenOption.READ : java.nio.file.StandardOpenOption.WRITE)
    channel.force(true)
    channel.close(); channel = null
    ok = true
  } finally {
    try { if (channel) channel.close() } finally {
      // force requests are observable here; the number of bytes written by the
      // kernel or persisted by the device is not available from FileChannel.
      this.manager._auditRetrieval("serving-sync", directory ? "directory" : "file", "", ok, 0, { operation: "force", protocol: "file", target: directory ? "directory" : "file", totalMillis: Math.max(0, (Number(java.lang.System.nanoTime()) - started) / 1000000) })
    }
  }
}
MiniAWikiRetrievalV2.prototype._syncGeneration = function(dir, manifest) {
  var self = this
  manifest.files.forEach(function(file) { self._syncPath(self._path(dir, file.path), false) })
  this._syncPath(dir + "/manifest.json", false)
  var directories = [dir + "/index"]
  manifest.files.forEach(function(file) { if (/^catalogue\//.test(file.path)) directories.push(String(new java.io.File(self._path(dir, file.path)).getParent())) })
  if (manifest.files.some(function(file) { return /^blocks\//.test(file.path) })) directories.push(dir + "/blocks")
  // The global block-store directory gains entries before a generation links
  // to them. Persist those names too, while keeping empty-store builds valid.
  if (this.config.sharedBlockStore && io.fileExists(this.root + "/.blocks")) directories.push(this.root + "/.blocks")
  directories.filter(function(path,index,all){return all.indexOf(path)===index}).concat([dir, this.root, String(new java.io.File(this.root).getParent())]).forEach(function(path) { self._syncPath(path, true) })
  this._publicationCheckpoint("generation-synchronized", dir)
}
MiniAWikiRetrievalV2.prototype._atomic = function(path, value, durable, quiet) {
  var tmp = path + ".tmp-" + java.util.UUID.randomUUID(), parent = String(new java.io.File(path).getParent()), moved = false
  try {
    this._writeServingFile(tmp, stringify(value, __, ""))
    if (durable === true) {
      if (quiet !== true) this._publicationCheckpoint("pointer-written", parent)
      this._syncPath(tmp, false)
      if (quiet !== true) this._publicationCheckpoint("pointer-synchronized", parent)
      // Probe directory synchronization before changing the usable pointer.
      if (quiet !== true) this._syncPath(parent, true)
    }
    java.nio.file.Files.move(new java.io.File(tmp).toPath(), new java.io.File(path).toPath(), java.nio.file.StandardCopyOption.ATOMIC_MOVE, java.nio.file.StandardCopyOption.REPLACE_EXISTING)
    moved = true
    if (durable === true) {
      if (quiet !== true) this._publicationCheckpoint("pointer-renamed", parent)
      // The following active-pointer directory sync also persists a quiet
      // predecessor-pointer rename performed immediately beforehand.
      if (quiet !== true) this._syncPath(parent, true)
      if (quiet !== true) this._publicationCheckpoint("activation-directory-synchronized", parent)
    }
  } catch(e) {
    if (moved && durable === true) {
      var failure = new Error("activation-directory-sync-failed: " + __miniAErrMsg(e))
      failure._pointerActivated = true
      throw failure
    }
    throw e
  } finally { try { new java.io.File(tmp).delete() } catch(ignore) {} }
}
MiniAWikiRetrievalV2.prototype._files = function(dir, reused, work) {
  var out = [], self = this
  // Serving layout is fixed. Avoid recursively discovering a staged tree:
  // publication must not accidentally turn a small catalogue delta into a
  // corpus walk just to construct its manifest.
  var add = function(file, name) {
    if (java.nio.file.Files.isSymbolicLink(file.toPath())) throw new Error("unsafe-artifact-path")
    if (!file.isFile() || name === "index/write.lock") return
    var size=Number(file.length()), prior=reused&&reused[name], checksum
    if (prior && prior.bytes===size) {
      self._path(dir,name); checksum=prior.checksum
      if(work){work.reusedChecksums++;work.reusedChecksumBytes+=size}
    } else checksum=MiniAWikiRetrievalV2.digest(self._path(dir,name))
    out.push({path:name,bytes:size,checksum:checksum})
    if (out.length > self.config.maxArtifactFiles) throw new Error("artifact-file-budget")
  }
  var visitKnown = function(base, prefix, oneMoreLevel) {
    var files = new java.io.File(base).listFiles()
    for (var i = 0; files && i < files.length; i++) {
      var name = prefix + String(files[i].getName())
      if (java.nio.file.Files.isSymbolicLink(files[i].toPath())) throw new Error("unsafe-artifact-path")
      if (files[i].isDirectory()) { if (oneMoreLevel) visitKnown(String(files[i].getPath()), name + "/", false); else throw new Error("unsafe-artifact-path") }
      else add(files[i], name)
    }
  }
  visitKnown(dir + "/index", "index/", false)
  if (io.fileExists(dir + "/blocks")) visitKnown(dir + "/blocks", "blocks/", false)
  if (io.fileExists(dir + "/catalogue")) visitKnown(dir + "/catalogue", "catalogue/", true)
  out.sort(function(a,b) { return a.path < b.path ? -1 : 1 }); return out
}
MiniAWikiRetrievalV2.prototype._readVerifiedBlock = function(path, record) {
  var digest = java.security.MessageDigest.getInstance("SHA-256")
  var stream = new java.security.DigestInputStream(new java.io.FileInputStream(path), digest), reader
  try {
    var decoder = java.nio.charset.StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT).onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
    reader = new java.io.InputStreamReader(stream, decoder)
    // Valid UTF-8 contains no more UTF-16 code units than source bytes.
    // Tiny blocks do not need a 128 KiB char array; larger blocks stay bounded.
    var capacity = Math.max(1, Math.min(65536, record.bytes))
    var buffer = java.lang.reflect.Array.newInstance(java.lang.Character.TYPE, capacity), text = new java.lang.StringBuilder(), n
    while ((n = reader.read(buffer)) !== -1) {
      if (Number(text.length()) + n > record.bytes) throw new Error("generation-integrity-failure")
      text.append(buffer, 0, n)
    }
    var bytes = digest.digest(), checksum = ""
    for (var i = 0; i < bytes.length; i++) checksum += ("0" + ((Number(bytes[i]) + 256) % 256).toString(16)).slice(-2)
    if (checksum !== record.checksum) throw new Error("generation-integrity-failure")
    return String(text.toString())
  } finally { try { if (reader) reader.close() } finally { stream.close() } }
}
// A delta is deliberately a record-level operation log, rather than an
// inherited JavaScript map.  Tombstones make removal unambiguous when a base
// contains a key that a newer generation no longer exposes.
MiniAWikiRetrievalV2.prototype._catalogueDelta = function(base, next) {
  var maps = ["pages", "passages", "reverseLinks", "moveReverse", "blockRefs"], delta = { schema: 1, maps: {} }
  maps.forEach(function(name) {
    var before = isMap(base[name]) ? base[name] : {}, after = isMap(next[name]) ? next[name] : {}, upsert = {}, tombstones = []
    Object.keys(after).forEach(function(key) { if (!before[key] || stringify(before[key], __, "") !== stringify(after[key], __, "")) upsert[key] = after[key] })
    Object.keys(before).forEach(function(key) { if (!after[key]) tombstones.push(key) })
    delta.maps[name] = { upsert: upsert, tombstones: tombstones.sort() }
  })
  return delta
}
// Schema-3 records are partitioned by a stable digest prefix.  A shard is an
// immutable operation set, so an update writes only the keys it changed and a
// reader can follow one shard through its ancestry without opening a catalogue
// file (or an unrelated shard).
MiniAWikiRetrievalV2.prototype._catalogueShard = function(key) { return sha1(String(key)).substring(0, 2) }
MiniAWikiRetrievalV2.prototype._writeCatalogueShards = function(dir, delta, work) {
  var self = this, maps = ["pages", "passages", "reverseLinks", "moveReverse", "blockRefs"], descriptors = {}
  maps.forEach(function(name) {
    var shards = {}
    Object.keys(delta.maps[name].upsert).forEach(function(key) {
      var shard = self._catalogueShard(key)
      if (!shards[shard]) shards[shard] = { upsert: {}, tombstones: [] }
      shards[shard].upsert[key] = delta.maps[name].upsert[key]
    })
    delta.maps[name].tombstones.forEach(function(key) {
      var shard = self._catalogueShard(key)
      if (!shards[shard]) shards[shard] = { upsert: {}, tombstones: [] }
      shards[shard].tombstones.push(key)
    })
    descriptors[name] = {}
    Object.keys(shards).sort().forEach(function(shard) {
      var operation = shards[shard], relative = "catalogue/" + name + "/" + shard + ".json", path = self._path(dir, relative)
      operation.tombstones.sort()
      // A key cannot both remove and replace a record in one generation.
      operation.tombstones.forEach(function(key) { if (Object.prototype.hasOwnProperty.call(operation.upsert, key)) throw new Error("invalid-catalogue-delta") })
      var text = stringify({ schema: 1, map: name, shard: shard, upsert: operation.upsert, tombstones: operation.tombstones }, __, "")
      var parent = new java.io.File(path).getParentFile(); if (!parent.exists()) java.nio.file.Files.createDirectories(parent.toPath())
      self._writeServingFile(path, text)
      descriptors[name][shard] = { path: relative, bytes: MiniAWikiRetrievalV2.bytes(text), checksum: MiniAWikiRetrievalV2.digestText(text) }
      if (work) { work.catalogueShardWrites = (Number(work.catalogueShardWrites) || 0) + 1; work.catalogueShardBytes = (Number(work.catalogueShardBytes) || 0) + MiniAWikiRetrievalV2.bytes(text) }
    })
  })
  return descriptors
}
MiniAWikiRetrievalV2.prototype._readCatalogueShard = function(dir, name, shard, descriptor) {
  if (!isMap(descriptor) || descriptor.path !== "catalogue/" + name + "/" + shard + ".json" || !/^[a-f0-9]{64}$/.test(descriptor.checksum) || !isFinite(descriptor.bytes) || descriptor.bytes < 0) throw new Error("invalid-catalogue-shard")
  var started = Number(java.lang.System.nanoTime()), path = this._path(dir, descriptor.path), file = new java.io.File(path), raw, operation
  try {
    if (!file.isFile() || Number(file.length()) !== descriptor.bytes || MiniAWikiRetrievalV2.digest(path) !== descriptor.checksum) throw new Error("catalogue-shard-integrity-failure")
    raw = io.readFileString(path)
    operation = af.fromJson(raw)
    if (!isMap(operation) || operation.schema !== 1 || operation.map !== name || operation.shard !== shard || !isMap(operation.upsert) || !isArray(operation.tombstones)) throw new Error("invalid-catalogue-shard")
    operation.tombstones.forEach(function(key) { if (!isString(key) || sha1(key).substring(0,2) !== shard || Object.prototype.hasOwnProperty.call(operation.upsert, key)) throw new Error("invalid-catalogue-tombstone") })
    Object.keys(operation.upsert).forEach(function(key) { if (sha1(key).substring(0,2) !== shard) throw new Error("invalid-catalogue-shard") })
    this.metrics.catalogueShardReads++; this.metrics.catalogueShardBytes += Number(descriptor.bytes)
    this.manager._auditRetrieval("serving-catalogue-shard", name, "", true, Number(descriptor.bytes), { operation: "read", protocol: "file", verification: "sha256", totalMillis: Math.max(0, (Number(java.lang.System.nanoTime()) - started) / 1000000) })
    return operation
  } catch(e) {
    this.manager._auditRetrieval("serving-catalogue-shard", name, "", false, 0, { operation: "read", protocol: "file", verification: "sha256", totalMillis: Math.max(0, (Number(java.lang.System.nanoTime()) - started) / 1000000) })
    throw e
  }
}
// Bodies and decoded metadata share the configured payload-byte allowance.
// Call under _guard; entries are immutable and eviction releases their roots.
MiniAWikiRetrievalV2.prototype._cachePut = function(key, value, size) {
  if (Object.prototype.hasOwnProperty.call(this.cacheSizes,key)) {
    this.cacheBytes -= this.cacheSizes[key]; delete this.cache[key]; delete this.cacheSizes[key]
    this.cacheOrder.splice(this.cacheOrder.indexOf(key),1)
  }
  if (size > this.config.cacheBytes || this.closed) return
  while (this.cacheOrder.length && this.cacheBytes + size > this.config.cacheBytes) {
    var old = this.cacheOrder.shift(); this.cacheBytes -= this.cacheSizes[old]
    delete this.cache[old]; delete this.cacheSizes[old]; this.metrics.cacheEvictions++
  }
  this.cache[key] = value; this.cacheSizes[key] = size; this.cacheOrder.push(key); this.cacheBytes += size
}
MiniAWikiRetrievalV2.prototype._cachedCatalogueShard = function(dir, name, shard, descriptor) {
  if (!isMap(descriptor) || descriptor.path !== "catalogue/" + name + "/" + shard + ".json" || !/^[a-f0-9]{64}$/.test(descriptor.checksum) || !isFinite(descriptor.bytes) || descriptor.bytes < 0) throw new Error("invalid-catalogue-shard")
  var self = this
  return this._guard(function() {
    if (self.closed) throw new Error("retrieval-closed")
    var path = self._path(dir,descriptor.path), attrs
    try { attrs = java.nio.file.Files.readAttributes(new java.io.File(path).toPath(),java.nio.file.attribute.BasicFileAttributes) }
    catch(missingShard) { throw new Error("catalogue-shard-integrity-failure") }
    var token = String(attrs.fileKey()) + ":" + String(attrs.lastModifiedTime()) + ":" + Number(attrs.size())
    var key = "catalogue:" + path + ":" + descriptor.checksum, cached = self.cache[key]
    if (attrs.isRegularFile() && Number(attrs.size()) === descriptor.bytes && cached && cached.token === token) {
      self.metrics.catalogueCacheHits++; return cached.value
    }
    self.metrics.catalogueCacheMisses++
    // Full validators deliberately call _readCatalogueShard directly. Serving
    // reuse binds to the immutable descriptor and current file identity/stamp.
    var value = MiniAWikiRetrievalV2.immutable(self._readCatalogueShard(dir,name,shard,descriptor))
    self._cachePut(key,{token:token,value:value},Number(descriptor.bytes) + MiniAWikiRetrievalV2.bytes(key + token))
    return value
  })
}
MiniAWikiRetrievalV2.prototype._catalogueDescriptor = function(manifest) {
  var c = manifest.catalogue, maps = ["pages", "passages", "reverseLinks", "moveReverse", "blockRefs"]
  if (Object.isFrozen(manifest) && manifest._validatedCatalogue === c) return c
  if (!isMap(c) || !isFinite(c.depth) || c.depth < 0 || c.depth > 32) throw new Error("invalid-catalogue-lineage")
  if (c.base !== true && (!isMap(c.parent) || !/^[a-f0-9-]{36}$/.test(c.parent.generation) || !/^[a-f0-9]{64}$/.test(c.parent.checksum))) throw new Error("invalid-catalogue-lineage")
  if (c.base === true && c.depth !== 0) throw new Error("invalid-catalogue-lineage")
  if (c.schema !== 3 || c.transactionFormat !== "routed-delta-v1") throw new Error("reindex-required")
  if (!isMap(c.shards) || !isMap(c.stats) || !isFinite(c.stats.pageCount) || c.stats.pageCount < 0 || !isFinite(c.stats.passageCount) || c.stats.passageCount < 0) throw new Error("invalid-catalogue-lineage")
  maps.forEach(function(name) { if (!isMap(c.shards[name])) throw new Error("invalid-catalogue-lineage"); Object.keys(c.shards[name]).forEach(function(shard) { if (!/^[a-f0-9]{2}$/.test(shard)) throw new Error("invalid-catalogue-lineage") }) })
  return c
}
MiniAWikiRetrievalV2.prototype._sameCatalogue = function(left, right) {
  var maps = ["pages", "passages", "reverseLinks", "moveReverse", "blockRefs"]
  if (!left || !right || left.generation !== right.generation || left.wikiId !== right.wikiId || left.schema !== right.schema) return false
  return maps.every(function(name) {
    var a = isMap(left[name]) ? Object.keys(left[name]).sort() : [], b = isMap(right[name]) ? Object.keys(right[name]).sort() : []
    return a.length === b.length && a.every(function(key, index) { return key === b[index] && stringify(left[name][key], __, "") === stringify(right[name][key], __, "") })
  })
}
MiniAWikiRetrievalV2.prototype._resolveCatalogue = function(dir, manifest, seen) {
  if (manifest.schema !== 3) throw new Error("reindex-required")
  var descriptor = this._catalogueDescriptor(manifest)
  seen = seen || {}
  if (seen[manifest.generation]) throw new Error("cyclic-catalogue-lineage")
  seen[manifest.generation] = true
  var catalog
  if (descriptor.base === true) catalog = { schema: 1, generation: manifest.generation, wikiId: manifest.catalogue.wikiId, pages: {}, passages: {}, reverseLinks: {}, moveReverse: {}, blockRefs: {} }
  else {
    var parentDir = this.root + "/" + manifest.catalogue.parent.generation, parentManifestPath = parentDir + "/manifest.json"
    if (!io.fileExists(parentManifestPath) || java.nio.file.Files.isSymbolicLink(new java.io.File(parentDir).toPath()) || MiniAWikiRetrievalV2.digest(parentManifestPath) !== manifest.catalogue.parent.checksum) throw new Error("catalogue-parent-unavailable")
    var parentManifest = af.fromJson(io.readFileString(parentManifestPath)); catalog = this._resolveCatalogue(parentDir, parentManifest, seen)
  }
  var self = this
  ;["pages", "passages", "reverseLinks", "moveReverse", "blockRefs"].forEach(function(name) {
    Object.keys(descriptor.shards[name]).forEach(function(shard) {
      var operation = self._readCatalogueShard(dir, name, shard, descriptor.shards[name][shard])
      operation.tombstones.forEach(function(key) { if (!Object.prototype.hasOwnProperty.call(catalog[name], key)) throw new Error("invalid-catalogue-tombstone"); delete catalog[name][key] })
      Object.keys(operation.upsert).forEach(function(key) { catalog[name][key] = operation.upsert[key] })
    })
  })
  catalog.generation = manifest.generation
  return catalog
}
// Targeted resolver used by serving paths that only need one catalogue key.
// It intentionally verifies just the selected shard at first use.  Full
// catalogue materialization remains available for lint/export and legacy APIs.
MiniAWikiRetrievalV2.prototype._lookupCatalogue = function(dir, manifest, name, key, seen, requestShards) {
  var maps = ["pages", "passages", "reverseLinks", "moveReverse", "blockRefs"]
  if (maps.indexOf(name) < 0 || !isString(key)) throw new Error("invalid-catalogue-lookup")
  this.metrics.catalogueLookups++
  if (manifest.schema !== 3) throw new Error("reindex-required")
  var descriptor = this._catalogueDescriptor(manifest), lineage = seen || {}
  if (lineage[manifest.generation]) throw new Error("cyclic-catalogue-lineage")
  lineage[manifest.generation] = true
  var value
  if (descriptor.base === true) value = __
  else {
    var parentDir = this.root + "/" + descriptor.parent.generation, parentManifestPath = parentDir + "/manifest.json"
    if (!io.fileExists(parentManifestPath) || MiniAWikiRetrievalV2.digest(parentManifestPath) !== descriptor.parent.checksum) throw new Error("catalogue-parent-unavailable")
    var parentManifest = af.fromJson(io.readFileString(parentManifestPath)); value = this._lookupCatalogue(parentDir, parentManifest, name, key, lineage, requestShards)
  }
  var shard = this._catalogueShard(key), record = descriptor.shards[name][shard]
  if (!record) return value
  // A request may reuse a verified immutable shard across its selected keys.
  var requestKey = dir + ":" + name + ":" + shard
  var operation = requestShards && requestShards[requestKey]
  if (!operation) {
    operation = this._cachedCatalogueShard(dir, name, shard, record)
    if (requestShards) requestShards[requestKey] = operation
  }
  if (operation.tombstones.indexOf(key) >= 0) return __
  return Object.prototype.hasOwnProperty.call(operation.upsert, key) ? operation.upsert[key] : value
}
MiniAWikiRetrievalV2.prototype.lookupPage = function(snapshot, path) { return this._lookupCatalogue(snapshot.dir, snapshot.manifest, "pages", path) }
MiniAWikiRetrievalV2.prototype.lookupPassage = function(snapshot, id) { return this._lookupCatalogue(snapshot.dir, snapshot.manifest, "passages", id) }
MiniAWikiRetrievalV2.prototype.lookupBacklinks = function(snapshot, path) { return this._lookupCatalogue(snapshot.dir, snapshot.manifest, "reverseLinks", path) || [] }
MiniAWikiRetrievalV2.prototype.lookupMoveLinks = function(snapshot, path) { return this._lookupCatalogue(snapshot.dir, snapshot.manifest, "moveReverse", path) || [] }
MiniAWikiRetrievalV2.prototype.lookupBlockReference = function(snapshot, locator) { return this._lookupCatalogue(snapshot.dir, snapshot.manifest, "blockRefs", locator) }
MiniAWikiRetrievalV2.prototype._validate = function(dir, manifest, validatedParent, prepared) {
  if (!isMap(manifest) || manifest.schema !== 3) throw new Error("reindex-required")
  if (manifest.parser !== 6 || manifest.fingerprint !== this.fingerprint || stringify(manifest.indexContract,__,"") !== stringify(this.indexContract,__,"") || !isArray(manifest.files) || manifest.files.length > this.config.maxArtifactFiles) throw new Error("incompatible-generation")
  this._catalogueDescriptor(manifest)
  if (!/^[a-f0-9]{64}$/.test(manifest.merkle || "") || MiniAWikiRetrievalV2.manifestMerkle(manifest) !== manifest.merkle) throw new Error("manifest-merkle-failure")
  var count = 0, seen = {}, checksums={}, blockRecords={}, verifiedBlocks={}, self = this
  manifest.files.forEach(function(record) {
    if (!isMap(record) || seen[record.path] || !isFinite(record.bytes) || record.bytes < 0 || !/^[a-f0-9]{64}$/.test(record.checksum)) throw new Error("invalid-generation-manifest")
    seen[record.path] = true; count += record.bytes
    checksums[record.path]=record.checksum
    if (count > self.config.maxArtifactBytes) throw new Error("artifact-byte-budget")
    var p = self._path(dir, record.path), f = new java.io.File(p)
    if (!f.isFile() || Number(f.length()) !== record.bytes) throw new Error("generation-integrity-failure")
    if (/^blocks\//.test(record.path)) blockRecords[record.path] = record
    else if (MiniAWikiRetrievalV2.digest(p) !== record.checksum) throw new Error("generation-integrity-failure")
  })
  if (!Object.keys(seen).some(function(k) { return /^index\/segments_/.test(k) })) throw new Error("generation-files-missing")
  var catalog = prepared ? prepared.catalog : this._resolveCatalogue(dir, manifest)
  if (manifest.schema === 3 && prepared) {
    var resolved = this._resolveCatalogue(dir, manifest)
    if (!this._sameCatalogue(resolved, catalog)) throw new Error("catalogue-delta-binding-failure")
  }
  if (!isMap(catalog) || catalog.schema !== 1 || catalog.generation !== manifest.generation || !isMap(catalog.pages) || !isMap(catalog.passages) || !isMap(catalog.reverseLinks)) throw new Error("invalid-generation-catalog")
  Object.keys(catalog.blockRefs || {}).forEach(function(locator) {
    var record = catalog.blockRefs[locator]
    if (!isMap(record) || record.locator !== locator) throw new Error("invalid-block-postings")
    blockRecords[locator] = record; checksums[locator] = record.checksum
  })
  if (manifest.schema === 3 && (Object.keys(catalog.pages).length !== Number(manifest.catalogue.stats.pageCount) || Object.keys(catalog.passages).length !== Number(manifest.catalogue.stats.passageCount))) throw new Error("catalogue-count-mismatch")
  var blockRefs = {}, passageRefs={}, parentChecksums={}
  if(validatedParent)validatedParent.manifest.files.forEach(function(file){parentChecksums[file.path]=file.checksum})
  Object.keys(catalog.pages).forEach(function(path) {
    var page = catalog.pages[path]
    if (path !== self.manager._normalizeRetrievalPath(path) || !isMap(page) || page.path !== path || !/^[a-f0-9]{40}$/.test(page.revision) || page.locator!=="blocks/"+page.revision+".md" || !blockRecords[page.locator] || !isArray(page.passageIds)) throw new Error("invalid-page-record")
    blockRefs[page.locator] = (blockRefs[page.locator] || 0) + 1
    page.passageIds.forEach(function(id){var p=catalog.passages[id];if(passageRefs[id] || !p || p.passageId!==id || p.path!==path || p.pageId!==page.pageId || p.wikiId!==page.wikiId || page.wikiId!==catalog.wikiId)throw new Error("invalid-passage-ownership");passageRefs[id]=true})
    var previous=validatedParent&&validatedParent.catalog.pages[path]
    var sameRecords = previous && (prepared ? Object.isFrozen(previous) && page === previous && page.passageIds.every(function(id) { return Object.isFrozen(catalog.passages[id]) && catalog.passages[id] === validatedParent.catalog.passages[id] }) : stringify(page,__,"")===stringify(previous,__,"") && page.passageIds.every(function(id){return stringify(catalog.passages[id],__,"")===stringify(validatedParent.catalog.passages[id],__,"")}))
    if(sameRecords && checksums[page.locator]===parentChecksums[page.locator]){
      if (!verifiedBlocks[page.locator] && MiniAWikiRetrievalV2.digest(self._blockFile(dir,manifest,page.locator)) !== checksums[page.locator]) throw new Error("generation-integrity-failure")
      verifiedBlocks[page.locator] = true
      // In-process publication proof only: the complete immutable records are
      // unchanged and their staged block bytes passed the parent's checksum.
      // Fresh/read-only readers never receive this shortcut.
      self.metrics.validationReusedPages++;return
    }
    // Validate the semantic bindings as well as file integrity. A checksummed
    // catalogue must not attach a different text hash or range to a raw revision.
    // Keep one page's positional map at a time; never retain a corpus body copy.
    var raw=self._readVerifiedBlock(self._blockFile(dir,manifest,page.locator),blockRecords[page.locator]), positions=MiniAWikiRetrievalV2.positions(raw), lines=positions.lines
    verifiedBlocks[page.locator] = true
    self.metrics.validationBlockReads++; self.metrics.validationBlockBytes+=MiniAWikiRetrievalV2.bytes(raw)
    if(sha1(raw)!==page.revision || raw.length!==page.charLength || lines.length!==page.linesTotal)throw new Error("page-revision-binding-failure")
    var parsed=MiniAWikiRetrievalV2.parse(path,raw,manifest.passageChars,true,positions), metadata=af.fromJson(stringify(self.manager.parseFrontmatter(raw).meta,__,""))
    if(stringify(parsed.outline,__,"")!==stringify(page.outline,__,"") || stringify(metadata,__,"")!==stringify(page.metadata,__,"") || page.title!==(metadata.title||path) || page.description!==(metadata.description||""))throw new Error("page-metadata-binding-failure")
    var lineFor=positions.lineFor
    var ids = {}
    page.passageIds.forEach(function(id) { var passage = catalog.passages[id]; if (ids[id] || !passage || passage.path !== path || passage.revision !== page.revision || !isFinite(passage.charStart) || !isFinite(passage.charEnd) || passage.charStart < 0 || passage.charEnd <= passage.charStart || passage.charEnd > page.charLength || passage.startLine < 1 || passage.endLine > page.linesTotal) throw new Error("invalid-passage-record"); ids[id] = true })
    page.passageIds.forEach(function(id){
      var passage=catalog.passages[id], startLine=lineFor(passage.charStart), endLine=lineFor(passage.charEnd-1)
      if(passage.charStart!==Math.floor(passage.charStart) || passage.charEnd!==Math.floor(passage.charEnd) || passage.startLine!==startLine || passage.endLine!==endLine || passage.textHash!==sha1(raw.substring(passage.charStart,passage.charEnd)) || passage.byteStart!==positions.byteAt(passage.charStart) || passage.byteEnd!==positions.byteAt(passage.charEnd))throw new Error("passage-revision-binding-failure")
    })
    var postingEnd = -1
    page.passageIds.forEach(function(id) { var passage = catalog.passages[id]; if (passage.charStart < postingEnd) throw new Error("invalid-passage-order"); postingEnd = passage.charEnd })
    page.passageIds.forEach(function(id) {
      var passage=catalog.passages[id], structure=passage.structure
      if (isDef(structure) && (!isMap(structure) || ["table","list","fenced-code","indented-code"].indexOf(structure.kind)<0 || !isFinite(structure.charStart) || !isFinite(structure.charEnd) || structure.charStart<0 || structure.charStart>passage.charStart || structure.charEnd<passage.charEnd || structure.charEnd>page.charLength || structure.startLine!==lineFor(structure.charStart) || structure.endLine!==lineFor(structure.charEnd-1))) throw new Error("invalid-structure-record")
      ;[passage.contextRange,structure&&structure.headerRange,structure&&structure.warningRange].forEach(function(range) {
        if (!range) return
        if (!isMap(range) || !structure || !isFinite(range.charStart) || !isFinite(range.charEnd) || range.charStart!==Math.floor(range.charStart) || range.charEnd!==Math.floor(range.charEnd) || range.charStart<0 || range.charEnd<=range.charStart || range.startLine!==lineFor(range.charStart) || range.endLine!==lineFor(range.charEnd-1)) throw new Error("invalid-context-range")
        if (range.kind === "table-header") {
          if (structure.kind!=="table" || range.charStart!==structure.charStart || range.charEnd>structure.charEnd) throw new Error("invalid-context-range")
        } else if (range.kind === "instruction-context" || range.kind === "table-context") {
          if ((range.kind === "table-context" ? structure.kind!=="table" : structure.kind==="table") || range.charEnd!==structure.charStart || range.charStart!==positions.starts[range.startLine-1] || range.endLine-range.startLine>=64 || !MiniAWikiRetrievalV2.contextLabel(lines[range.startLine-1])) throw new Error("invalid-context-range")
          for(var contextLine=range.startLine-1;contextLine<range.endLine;contextLine++) if(MiniAWikiRetrievalV2.fenceMarker(lines[contextLine]) || MiniAWikiRetrievalV2.isIndentedCode(lines[contextLine]) || parsed.outline.some(function(h){return h.lineStart===contextLine+1})) throw new Error("invalid-context-range")
        } else throw new Error("invalid-context-range")
      })
    })
  })
  var expectedReverse = {}
  Object.keys(catalog.pages).forEach(function(path) {
    var page = catalog.pages[path], targets = {}
    page.links.forEach(function(link) { if (!targets[link.resolved]) targets[link.resolved] = []; targets[link.resolved].push(link) })
    Object.keys(targets).forEach(function(target) {
      if (!expectedReverse[target]) expectedReverse[target] = []
      expectedReverse[target].push({path:path,title:page.title,links:targets[target],stamp:page.stamp})
    })
  })
  if (Object.keys(expectedReverse).length !== Object.keys(catalog.reverseLinks).length || !Object.keys(expectedReverse).every(function(target) {
    var actual = catalog.reverseLinks[target]
    if (!isArray(actual) || expectedReverse[target].length !== actual.length) return false
    var byPath = function(left,right) { return left.path < right.path ? -1 : left.path > right.path ? 1 : 0 }
    var expected = expectedReverse[target].sort(byPath), sorted = actual.slice().sort(byPath)
    return expected.every(function(posting,index) { return stringify(posting,__,"") === stringify(sorted[index],__,"") })
  })) throw new Error("invalid-backlink-postings")
  if(Object.keys(passageRefs).length!==Object.keys(catalog.passages).length)throw new Error("unreferenced-passage-record")
  if (isDef(catalog.blockRefs) && (!isMap(catalog.blockRefs) || Object.keys(catalog.blockRefs).length !== Object.keys(blockRefs).length || !Object.keys(blockRefs).every(function(locator) {
    var record = catalog.blockRefs[locator]
    return isMap(record) && record.locator === locator && record.references === blockRefs[locator] &&
      (record.storage === "shared" || record.storage === "generation") && isFinite(record.bytes) && record.bytes >= 0 && /^[a-f0-9]{64}$/.test(record.checksum)
  }))) throw new Error("invalid-block-postings")
  Object.keys(blockRecords).forEach(function(locator) {
    if (!verifiedBlocks[locator] && MiniAWikiRetrievalV2.digest(self._blockFile(dir,manifest,locator)) !== checksums[locator]) throw new Error("generation-integrity-failure")
  })
  return MiniAWikiRetrievalV2.immutable(catalog)
}
// Cold open checks only the immutable envelope and reader contract.  Shard and
// block bytes are intentionally left for the resolver/body paths so opening a
// reader never walks a corpus-sized catalogue.
MiniAWikiRetrievalV2.prototype._validateStructural = function(dir, manifest) {
  if (!isMap(manifest) || manifest.schema !== 3 || manifest.parser !== 6 || manifest.fingerprint !== this.fingerprint || stringify(manifest.indexContract,__,'') !== stringify(this.indexContract,__, '') || !isArray(manifest.files) || manifest.files.length > this.config.maxArtifactFiles) throw new Error('incompatible-generation')
  this._catalogueDescriptor(manifest)
  if (!/^[a-f0-9]{64}$/.test(manifest.merkle || '') || MiniAWikiRetrievalV2.manifestMerkle(manifest) !== manifest.merkle) throw new Error('manifest-merkle-failure')
  var seen={}, total=0, self=this
  manifest.files.forEach(function(record) {
    if (!isMap(record) || seen[record.path] || !isFinite(record.bytes) || record.bytes < 0 || !/^[a-f0-9]{64}$/.test(record.checksum)) throw new Error('invalid-generation-manifest')
    seen[record.path]=true; total+=Number(record.bytes); if(total>self.config.maxArtifactBytes)throw new Error('artifact-byte-budget')
    var file=new java.io.File(self._path(dir,record.path)); if(!file.isFile() || Number(file.length())!==Number(record.bytes))throw new Error('generation-integrity-failure')
  })
  if (!Object.keys(seen).some(function(path){return /^index\/segments_/.test(path)})) throw new Error('generation-files-missing')
  // Validate the complete routing lineage without opening data shards.  This
  // makes a cold open reject missing, cyclic and over-depth ancestry while
  // preserving first-use checksum validation for the selected data only.
  var cursor = manifest, cursorDir = dir, lineage = {}, depth = 0
  while (true) {
    if (lineage[cursor.generation]) throw new Error('cyclic-catalogue-lineage')
    lineage[cursor.generation] = true
    var descriptor = this._catalogueDescriptor(cursor)
    if (descriptor.base === true) break
    if (++depth > 32) throw new Error('catalogue-lineage-depth')
    var parentDir = this.root + '/' + descriptor.parent.generation, parentPath = parentDir + '/manifest.json'
    if (!io.fileExists(parentPath) || java.nio.file.Files.isSymbolicLink(new java.io.File(parentDir).toPath()) || MiniAWikiRetrievalV2.digest(parentPath) !== descriptor.parent.checksum) throw new Error('catalogue-parent-unavailable')
    cursor = af.fromJson(io.readFileString(parentPath)); cursorDir = parentDir
    if (!isMap(cursor) || cursor.schema !== 3 || cursor.parser !== 6 || cursor.fingerprint !== this.fingerprint || !/^[a-f0-9]{64}$/.test(cursor.merkle || '') || MiniAWikiRetrievalV2.manifestMerkle(cursor) !== cursor.merkle) throw new Error('invalid-catalogue-lineage')
  }
  return __
}
// Activation is intentionally narrower than lint/export validation.  The
// parent generation is immutable and was validated before its pointer became
// eligible for retention; publication only proves bytes and semantic bindings
// introduced by this transaction.  `_validate` remains the explicit complete
// closure validator used by lint/export and diagnostic callers.
MiniAWikiRetrievalV2.prototype._validatePublication = function(dir, manifest, prepared) {
  this._validateStructural(dir, manifest)
  if (!prepared || !isMap(prepared.changedPaths)) throw new Error("invalid-publication-proof")
  var self = this, catalog = prepared.catalog, transaction=prepared.transaction, changed = prepared.changedPaths, seen = {}
  // Every transaction-produced routed shard is checked now.  Parent shards are
  // checked when a reader resolves their selected key.
  ;["pages","passages","reverseLinks","moveReverse","blockRefs"].forEach(function(name) {
    Object.keys(manifest.catalogue.shards[name] || {}).forEach(function(shard) {
      var record = manifest.catalogue.shards[name][shard]
      self._readCatalogueShard(dir, name, shard, record)
    })
  })
  Object.keys(changed).forEach(function(path) {
    var page = transaction ? self._lookupCatalogue(dir,manifest,"pages",path) : catalog.pages[path]
    // A tombstoned page has no new byte binding. Lucene's page delete is
    // checked by the post-open probe below.
    if (!page) return
    if (!isMap(page) || page.path !== path || !isArray(page.passageIds)) throw new Error("invalid-page-record")
    var block = transaction ? self._lookupCatalogue(dir,manifest,"blockRefs",page.locator) : catalog.blockRefs[page.locator]
    if (!isMap(block) || block.locator !== page.locator || !isFinite(block.bytes) || !/^[a-f0-9]{64}$/.test(block.checksum)) throw new Error("invalid-block-postings")
    var raw = self._readVerifiedBlock(self._blockFile(dir, manifest, page.locator,block), block), positions = MiniAWikiRetrievalV2.positions(raw)
    self.metrics.validationBlockReads++; self.metrics.validationBlockBytes += MiniAWikiRetrievalV2.bytes(raw)
    if (sha1(raw) !== page.revision || raw.length !== page.charLength || positions.lines.length !== page.linesTotal) throw new Error("page-revision-binding-failure")
    var parsed = MiniAWikiRetrievalV2.parse(path, raw, manifest.passageChars, true, positions), metadata = af.fromJson(stringify(self.manager.parseFrontmatter(raw).meta, __, ""))
    if (stringify(parsed.outline, __, "") !== stringify(page.outline, __, "") || stringify(metadata, __, "") !== stringify(page.metadata, __, "") || page.title !== (metadata.title || path) || page.description !== (metadata.description || "")) throw new Error("page-metadata-binding-failure")
    page.passageIds.forEach(function(id) {
      if (seen[id]) throw new Error("invalid-passage-record")
      seen[id] = true
      var passage = transaction ? self._lookupCatalogue(dir,manifest,"passages",id) : catalog.passages[id]
      if (!isMap(passage) || passage.path !== path || passage.revision !== page.revision || passage.charStart < 0 || passage.charEnd <= passage.charStart || passage.charEnd > raw.length || passage.textHash !== sha1(raw.substring(passage.charStart, passage.charEnd)) || passage.startLine !== positions.lineFor(passage.charStart) || passage.endLine !== positions.lineFor(passage.charEnd - 1) || passage.byteStart !== positions.byteAt(passage.charStart) || passage.byteEnd !== positions.byteAt(passage.charEnd)) throw new Error("passage-revision-binding-failure")
    })
  })
  return catalog ? MiniAWikiRetrievalV2.immutable(catalog) : __
}
MiniAWikiRetrievalV2.prototype._openDirectory = function(dir) { return Packages.org.apache.lucene.store.FSDirectory.open(java.nio.file.Paths.get(dir+"/index")) }
MiniAWikiRetrievalV2.prototype._openReader = function(directory) { return Packages.org.apache.lucene.index.DirectoryReader.open(directory) }
MiniAWikiRetrievalV2.prototype._openSnapshot = function(dir, manifest, catalog) {
  if(this.closed)throw new Error("retrieval-closed")
  if (!this.manager._ensureLucene()) throw new Error("lucene-unavailable")
  this._drainPendingClosures()
  var L = Packages.org.apache.lucene, directory, reader, snapshot={refs:0,pendingReleases:new java.util.concurrent.atomic.AtomicInteger(0),_slotHeld:new java.util.concurrent.atomic.AtomicBoolean(false),_closeQueued:new java.util.concurrent.atomic.AtomicBoolean(false),_closeLock:new java.util.concurrent.locks.ReentrantLock(),_managed:false}
  if(!this._resourceSlots.tryAcquire())throw new Error("generation-resource-budget")
  snapshot._slotHeld.set(true)
  try {
    // A snapshot's manifest cannot change. Validate routing once, then retain
    // the proof outside its serialized/Merkle fields for repeated key lookups.
    var routing = this._catalogueDescriptor(manifest)
    if (!Object.isFrozen(manifest)) Object.defineProperty(manifest,"_validatedCatalogue",{value:routing,enumerable:false})
    MiniAWikiRetrievalV2.immutable(manifest)
    snapshot.generation=manifest.generation;snapshot.dir=dir;snapshot.manifest=manifest
    if (catalog) snapshot.catalog=catalog
    else {
      var self=this, hydrated=false
      Object.defineProperty(snapshot,'catalog',{enumerable:true,get:function(){
        if(!hydrated){ snapshot._catalog=self._validate(dir,manifest);hydrated=true }
        return snapshot._catalog
      }})
    }
    directory = this._openDirectory(dir);snapshot.directory=directory
    reader = this._openReader(directory);snapshot.reader=reader;this.metrics.readerOpens++
    var expected = catalog ? Object.keys(catalog.passages).length : Number(manifest.catalogue && manifest.catalogue.stats && manifest.catalogue.stats.passageCount)
    if (!isFinite(expected) || Number(reader.numDocs()) !== expected) throw new Error("generation-index-count-mismatch")
    if (Number(reader.numDocs()) > 0) {
      var infos = L.index.FieldInfos.getMergedFieldInfos(reader), required = ["id","page","recordType","prose","exact","title","heading","text"]
      if (this.manager._lexicalConfig.shingles) required.push("prose__shingle")
      if (this.manager._lexicalConfig.ngrams) required.push("prose__ngram")
      required.forEach(function(field){var info = infos.fieldInfo(field); if (!info || field !== "text" && String(info.getIndexOptions()) === "NONE") throw new Error("generation-index-field-missing: " + field)})
    }
    snapshot.manifestChecksum=MiniAWikiRetrievalV2.digest(dir+"/manifest.json");snapshot.searcher=new L.search.IndexSearcher(reader)
    return snapshot
  } catch(e) { try{this._closeSnapshot(snapshot)}catch(ignoreClose){};throw e }
}
MiniAWikiRetrievalV2.prototype._closeSnapshot = function(snapshot) {
  if(snapshot.refs>0)throw new Error("generation-reader-in-use")
  snapshot._closePending=true
  if(!snapshot._closeLock.tryLock())throw new Error("resource-close-busy")
  try {
    var failure
    if(!snapshot.reader)snapshot._readerClosed=true
    if(!snapshot.directory)snapshot._directoryClosed=true
    if(!snapshot._readerClosed) {
      try { snapshot.reader.close();snapshot._readerClosed=true }
      catch(e) {
        // Lucene may report a close error after its reference count reached zero.
        try{if(Number(snapshot.reader.getRefCount())===0)snapshot._readerClosed=true}catch(ignoreRef){}
        failure=e
      }
    }
    if(snapshot._readerClosed && !snapshot._directoryClosed) {
      try { snapshot.directory.close();snapshot._directoryClosed=true }
      catch(directoryError){if(!failure)failure=directoryError}
    }
    if(snapshot._readerClosed && snapshot._directoryClosed) {
      if(snapshot._slotHeld.compareAndSet(true,false))this._resourceSlots.release()
      this._pendingClosures.remove(snapshot);snapshot._closeQueued.set(false)
    }
    if(failure){
      this._closeFailures.incrementAndGet()
      if(!snapshot._managed && snapshot._slotHeld.get() && snapshot._closeQueued.compareAndSet(false,true))this._pendingClosures.add(snapshot)
      throw failure
    }
  } finally {snapshot._closeLock.unlock()}
}
// Transfer the validated publication searcher to the managed generation pool.
// A pinned old reader is never evicted to retain the new one.
MiniAWikiRetrievalV2.prototype._retainValidatedSnapshot = function(snapshot) {
  var self = this
  return this._guard(function() {
    if (self.closed || snapshot._closePending || self.serving.some(function(existing) { return existing.generation === snapshot.generation })) return false
    for (var i=self.serving.length-1;i>=0;i--) if (!self.serving[i].refs && self.serving.length>=2) { self._closeSnapshot(self.serving[i]); self.serving.splice(i,1) }
    if(self.serving.length>=2)return false
    snapshot._managed=true;self.serving.push(snapshot); return true
  })
}
MiniAWikiRetrievalV2.prototype.acquire = function(deadline, preferPrevious) {
  var self = this
  return this._guard(function() {
    if (self.closed) throw new Error("retrieval-closed")
    if (isFunction(self.manager._maybeRefreshArtifactBundle)) self.manager._maybeRefreshArtifactBundle()
    if (self.manager._access !== "rw" && isFunction(self.manager._activeBundleRoot)) self.root = self.manager._activeBundleRoot() + "/.mini-a-wiki-serving"
    var currentPath = self.root + "/current.json", previousPath = self.root + "/previous.json"
    if (!io.fileExists(currentPath)) throw new Error("v2-build-required")
    // `previous.json` is a validated rollback candidate written before a new
    // pointer becomes active. It is only a read fallback: corruption must not
    // silently rewrite activation state or bypass normal writer recovery.
    var candidates = [{ path: currentPath, fallback: false }]
    if (io.fileExists(previousPath)) candidates.push({ path: previousPath, fallback: true })
    if (preferPrevious === true && candidates.length === 2) candidates.reverse()
    var primaryFailure
    for (var candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
      var candidate = candidates[candidateIndex]
      try {
        if (java.nio.file.Files.isSymbolicLink(new java.io.File(candidate.path).toPath())) throw new Error("unsafe-generation-pointer")
        var pointer = af.fromJson(io.readFileString(candidate.path))
        if (!pointer || pointer.schema !== 1 || !/^[a-f0-9-]{36}$/.test(pointer.generation)) throw new Error("invalid-generation-pointer")
        var cached = self.serving.filter(function(s) { return s.generation === pointer.generation && !s._closePending })[0]
        if (cached && cached.manifestChecksum !== pointer.checksum) throw new Error("generation-checksum-mismatch")
        if (!cached) {
          // Never evict a pinned reader. Retain at most two open generations.
          for (var i = self.serving.length - 1; i >= 0; i--) if (!self.serving[i].refs && self.serving.length >= 2) { self._closeSnapshot(self.serving[i]); self.serving.splice(i, 1) }
          if (self.serving.length >= 2) throw new Error("generation-reader-budget")
          var dir = self.root + "/" + pointer.generation, manifestPath = dir + "/manifest.json"
          if (java.nio.file.Files.isSymbolicLink(new java.io.File(dir).toPath()) || java.nio.file.Files.isSymbolicLink(new java.io.File(manifestPath).toPath()) || String(new java.io.File(dir).getCanonicalPath()).indexOf(String(new java.io.File(self.root).getCanonicalPath()) + "/") !== 0) throw new Error("unsafe-generation-path")
          if (MiniAWikiRetrievalV2.digest(manifestPath) !== pointer.checksum) throw new Error("generation-integrity-failure")
          var manifest = af.fromJson(io.readFileString(manifestPath)), catalog = self._validateStructural(dir, manifest)
          cached = self._openSnapshot(dir, manifest, catalog); cached._managed = true; cached.recoveredPointer = candidate.fallback === true; self.serving.push(cached)
        }
        cached.refs++; return cached
      } catch(e) {
        if (!candidate.fallback) primaryFailure = e
      }
    }
    throw (primaryFailure || new Error("generation-fallback-unavailable"))
  }, deadline)
}
MiniAWikiRetrievalV2.prototype.release = function(snapshot) {
  snapshot.pendingReleases.incrementAndGet()
  this._flushReleases()
}
MiniAWikiRetrievalV2.prototype.close = function() {
  var self = this
  this._guard(function() { self._flushTelemetry(); self.closed = true; self.cache = {}; self.cacheOrder = []; self.cacheSizes = {}; self.cacheBytes = 0 })
}
MiniAWikiRetrievalV2.prototype._pending = function() {
  var m = this.manager, path = m._getIndexRoot() + "/.mini-a-wiki-ingest/journal.json", state = m._getIndexRoot() + "/.mini-a-wiki-state/manifest.json", pending = {}, token = ""
  var stamp = function(p) { var f = new java.io.File(p); return f.isFile() ? String(java.nio.file.Files.getLastModifiedTime(f.toPath())) + ":" + Number(f.length()) : "missing" }
  token = stamp(path) + "|" + stamp(state)
  if (this.suppression && this.suppression.token === token) return this.suppression.pending
  try {
    if (io.fileExists(path)) { var j = af.fromJson(io.readFileString(path)); if (!isMap(j) || !isArray(j.operations)) throw new Error("corrupt-journal"); if (j.phase !== "complete") j.operations.forEach(function(op) { pending[op.path] = true }) }
    if (io.fileExists(state)) {
      var authority = af.fromJson(io.readFileString(state))
      if (!isMap(authority) || !isMap(authority.sources)) throw new Error("corrupt-state")
      Object.keys(authority.sources).forEach(function(k) { var source = authority.sources[k]; if (source.active === false) pending[source.page] = true })
    }
  } catch(e) { pending._all = true }
  this.suppression = { token: token, pending: pending }
  return pending
}
MiniAWikiRetrievalV2.prototype._stamp = function(path, canonicalRoot) {
  if (this.manager._archiveRoot || ["fs", "s3fs"].indexOf(this.manager._backendType) < 0) return __
  var file = new java.io.File(this.manager._backend.root, path), filePath = file.toPath()
  var root = canonicalRoot || String(new java.io.File(this.manager._backend.root).getCanonicalPath()), attrs
  try { attrs = java.nio.file.Files.readAttributes(filePath, java.nio.file.attribute.BasicFileAttributes, java.nio.file.LinkOption.NOFOLLOW_LINKS) }
  catch(missingSource) { return __ }
  if (!attrs.isRegularFile() || !java.nio.file.Files.isReadable(filePath) || String(file.getCanonicalPath()).indexOf(root + "/") !== 0) return __
  return { modified: String(attrs.lastModifiedTime()), size: Number(attrs.size()), fileKey: String(attrs.fileKey()) }
}
MiniAWikiRetrievalV2.prototype._backendCall = function(method, path, deadline, used) {
  var started = Number(java.lang.System.nanoTime()), result, failed = true
  try {
    result = this.manager._backend[method](path, isNumber(deadline) ? {maxMillis:Math.max(1,deadline-Date.now())} : __)
    failed = false
    return result
  } finally {
    if (isMap(used)) {
      var key = method === "read" ? "backendRead" : "backendExists"
      used[key + "Calls"] = (Number(used[key + "Calls"]) || 0) + 1
      used[key + "Millis"] = (Number(used[key + "Millis"]) || 0) + Math.max(0,(Number(java.lang.System.nanoTime())-started)/1000000)
      if (method === "read" && isString(result)) used.backendReadBytes = (Number(used.backendReadBytes) || 0) + MiniAWikiRetrievalV2.bytes(result)
      if (failed) used.backendFailures = (Number(used.backendFailures) || 0) + 1
    }
  }
}
MiniAWikiRetrievalV2.prototype._active = function(page, pending, permissions, deadline, used, canonicalRoot, snapshot) {
  if (!page || this.closed || pending._all || pending[page.path] || this.manager._isSearchExcludedPath(page.path)) return false
  if (this.manager._archiveRoot) return true
  // A static HTTP wiki is served solely from the validated pinned bundle; it
  // has no page endpoint against which an additional source permission probe
  // could be made.
  if (this.manager._backendType === "http") return true
  if (["fs", "s3fs"].indexOf(this.manager._backendType) < 0) {
    permissions = isMap(permissions) ? permissions : {}
    if (isNumber(deadline) && deadline <= Date.now()) return false
    if (!isDef(permissions[page.path])) {
      var allowed = false
      try { allowed = this._backendCall("exists", page.path, deadline, used) === true } catch(permissionError) {}
      permissions[page.path] = allowed
      this.metrics.permissionChecks = Number(this.metrics.permissionChecks || 0) + 1
      this.manager._auditRetrieval("source-permission", page.path, page.path, allowed, 0)
    }
    return permissions[page.path]
  }
  var stamp = this._stamp(page.path, canonicalRoot)
  if (!stamp || !page.stamp) return false
  if (stamp.modified === page.stamp.modified && stamp.size === page.stamp.size && stamp.fileKey === page.stamp.fileKey) return true
  return this._verifySource(page, stamp, snapshot, canonicalRoot, deadline, used)
}
// A remount or copy can change file identity without changing authoritative bytes.
// Keep proofs in the bounded process cache; never rewrite a pinned generation.
MiniAWikiRetrievalV2.prototype._verifySource = function(page, stamp, snapshot, canonicalRoot, deadline, used) {
  var self = this, stream, verified = false, cacheHit = false, readStarted = false, bytes = 0, started = Number(java.lang.System.nanoTime())
  var expired = function() { return isNumber(deadline) && Date.now() >= deadline }
  if (!snapshot || expired()) return false
  try {
    if (!page.locator) page = this.lookupPage(snapshot, page.path)
    if (!page) return false
    var record = this.lookupBlockReference(snapshot, page.locator)
    if (!record || !isString(record.checksum) || !/^[a-f0-9]{64}$/.test(record.checksum) || stamp.size !== record.bytes) return false
    var key = "source-proof:" + stringify([snapshot.generation,page.path,page.revision,record.checksum,stamp],__,"")
    cacheHit = this._guard(function() { return self.cache[key] === true }, deadline)
    if (!cacheHit) {
      if (expired()) return false
      readStarted = true
      stream = io.readFileStream(String(new java.io.File(this.manager._backend.root, page.path)))
      var checksum = sha256(stream)
      bytes = stamp.size
      stream.close(); stream = __
      if (checksum !== record.checksum || expired()) return false
    }
    var after = this._stamp(page.path, canonicalRoot), pending = this._pending()
    if (!after || stringify(after,__,"") !== stringify(stamp,__,"") || this.closed || pending._all || pending[page.path] || this.manager._isSearchExcludedPath(page.path) || expired()) return false
    if (!cacheHit) this._guard(function() { self._cachePut(key,true,MiniAWikiRetrievalV2.bytes(key) + 8) },deadline)
    verified = true
    return true
  } catch(e) { return false }
  finally {
    if (stream) try { stream.close() } catch(closeError) {}
    var elapsed = Math.max(0,(Number(java.lang.System.nanoTime())-started)/1000000)
    this.metrics.sourceVerificationReads = Number(this.metrics.sourceVerificationReads || 0) + (readStarted ? 1 : 0)
    this.metrics.sourceVerificationBytes = Number(this.metrics.sourceVerificationBytes || 0) + bytes
    this.metrics.sourceVerificationMillis = Number(this.metrics.sourceVerificationMillis || 0) + elapsed
    this.metrics.sourceVerificationCacheHits = Number(this.metrics.sourceVerificationCacheHits || 0) + (cacheHit ? 1 : 0)
    if (isMap(used)) {
      used.sourceVerificationBytes = Number(used.sourceVerificationBytes || 0) + bytes
      used.sourceVerificationMillis = Number(used.sourceVerificationMillis || 0) + elapsed
    }
    this.manager._auditRetrieval("source-verification",page ? page.path : "",page ? page.path : "",verified,bytes,{operation:"read",protocol:"file",verification:"sha256",cacheHit:cacheHit,totalMillis:elapsed})
  }
}
MiniAWikiRetrievalV2.prototype._body = function(snapshot, page, deadline, used) {
  var key = snapshot.generation + ":" + page.revision, self = this
  if (isNumber(deadline) && deadline <= Date.now()) throw new Error("request-deadline-exhausted")
  if (!self._active(page, self._pending(), __, deadline, used, __, snapshot)) throw new Error("stale-or-revoked-evidence")
  if (self.manager._archiveRoot || ["fs", "s3fs"].indexOf(self.manager._backendType) < 0) {
    if (isNumber(deadline) && deadline <= Date.now()) throw new Error("request-deadline-exhausted")
    var current = self._backendCall("read", page.path, deadline, used)
    if (!isString(current)) throw new Error("source-read-unavailable")
    if (sha1(current) !== page.revision) throw new Error("stale-evidence")
  }
  return this._guard(function() {
    if (self.closed) throw new Error("retrieval-closed")
  if (isDef(self.cache[key])) { self.metrics.cacheHits++; self.manager._auditRetrieval("serving-cache", key, page.path, true, 0, { operation: "read", protocol: "memory", cacheHit: true, totalMillis: 0 }); return self.cache[key] }
    self.metrics.cacheMisses++
    var started = Number(java.lang.System.nanoTime()), text, size
    try {
      var record = self.lookupBlockReference(snapshot,page.locator)
      text = self._readVerifiedBlock(self._blockFile(snapshot.dir, snapshot.manifest, page.locator,record), record)
      if (sha1(text) !== page.revision || text.length !== page.charLength) throw new Error("page-revision-binding-failure")
    }
    catch(readError) {
      self.manager._auditRetrieval("serving-block", page.locator, page.path, false, 0, { operation: "read", protocol: "file", totalMillis: Math.max(0,(Number(java.lang.System.nanoTime())-started)/1000000) })
      throw readError
    }
    size = MiniAWikiRetrievalV2.bytes(text)
    self.metrics.bodyReads++; self.metrics.bytesRead += size
    self.manager._auditRetrieval("serving-block", page.locator, page.path, true, size, { operation: "read", protocol: "file", totalMillis: Math.max(0,(Number(java.lang.System.nanoTime())-started)/1000000) })
    if (sha1(text) !== page.revision) throw new Error("stale-evidence")
    self._cachePut(key,text,size)
    return text
  }, deadline)
}
MiniAWikiRetrievalV2.prototype._analyzer = function() {
  if (!this.manager._ensureLucene()) throw new Error("lucene-unavailable")
  var adapter = ow.ch.__types.searchdb
  if (!isFunction(adapter.__toAnalyzer) || !isFunction(adapter.__lexicalOptions) || (this.manager._lexicalConfig.shingles || this.manager._lexicalConfig.ngrams) && !isFunction(adapter.__customAnalyzer)) throw new Error("analyzer-capability-unavailable")
  var primary = adapter.__toAnalyzer({ analyzer: this.manager._lexicalConfig.language }), fields = new java.util.HashMap(), exact = new Packages.org.apache.lucene.analysis.standard.StandardAnalyzer()
  fields.put("exact", exact)
  var delegates = new java.util.ArrayList(), wrapper
  delegates.add(primary); delegates.add(exact)
  try {
    var options = adapter.__lexicalOptions(this.manager._luceneLexicalOptions())
    if (options.shingles.enabled) { var shingle = adapter.__customAnalyzer("shingle", options); fields.put("prose__shingle", shingle); delegates.add(shingle) }
    if (options.characterNGrams.enabled) { var ngram = adapter.__customAnalyzer("ngram", options); fields.put("prose__ngram", ngram); delegates.add(ngram) }
    wrapper = new Packages.org.apache.lucene.analysis.miscellaneous.PerFieldAnalyzerWrapper(primary, fields)
    this.analyzers.put(wrapper, delegates)
    return wrapper
  } catch(e) { for (var i = 0; i < delegates.size(); i++) delegates.get(i).close(); throw e }
}
MiniAWikiRetrievalV2.prototype._closeAnalyzer = function(analyzer) {
  var delegates = this.analyzers.remove(analyzer)
  try { analyzer.close() } finally { for (var i = 0; delegates && i < delegates.size(); i++) delegates.get(i).close() }
}
// Publication keeps old generations and legacy artifacts. Cleanup is deliberately explicit.
// Lucene committed segment files and revision blocks are immutable. A new writer
// creates new segment/commit names and unlinks retired files in its own directory.
MiniAWikiRetrievalV2.prototype._linkFile = function(source, target) {
  java.nio.file.Files.createLink(new java.io.File(target).toPath(), new java.io.File(source).toPath())
}
MiniAWikiRetrievalV2.prototype._reuseFile = function(source, target, record, work) {
  var immutable = /^blocks\//.test(record.path) || /^index\/(segments_[A-Za-z0-9]+|_[A-Za-z0-9_.-]+)$/.test(record.path)
  if (this.config.linkImmutableFiles && immutable) {
    try {
      this._linkFile(source, target)
      work.linkedFiles++; work.linkedBytes += record.bytes; return immutable
    } catch(linkError) {
      // Cross-device, unsupported and denied hard links use the portable copy path.
      if (new java.io.File(target).exists()) throw linkError
    }
  }
  java.nio.file.Files.copy(new java.io.File(source).toPath(), new java.io.File(target).toPath())
  work.copiedFiles++; work.copiedBytes += record.bytes
  return immutable
}
MiniAWikiRetrievalV2.prototype._sharedBlockPath = function(locator) {
  if (!/^blocks\/[a-f0-9]{40}\.md$/.test(locator)) throw new Error("unsafe-artifact-path")
  var root = this.root + "/.blocks", path = root + "/" + locator.substring("blocks/".length)
  if (String(new java.io.File(path).getCanonicalPath()).indexOf(String(new java.io.File(root).getCanonicalPath()) + "/") !== 0) throw new Error("unsafe-artifact-path")
  return path
}
MiniAWikiRetrievalV2.prototype._stageSharedText = function(locator, text) {
  var path = this._sharedBlockPath(locator), parent = new java.io.File(path).getParentFile(), checksum = MiniAWikiRetrievalV2.digestText(text)
  if (!parent.exists()) java.nio.file.Files.createDirectories(parent.toPath())
  if (io.fileExists(path)) { if (MiniAWikiRetrievalV2.digest(path) !== checksum) throw new Error("immutable-block-conflict"); return { bytes: MiniAWikiRetrievalV2.bytes(text), checksum: checksum } }
  var temporary = path + ".tmp-" + java.util.UUID.randomUUID()
  try {
    this._writeServingFile(temporary, text)
    if (MiniAWikiRetrievalV2.digest(temporary) !== checksum) throw new Error("immutable-block-integrity-failure")
    this._syncPath(temporary, false)
    try { java.nio.file.Files.move(new java.io.File(temporary).toPath(), new java.io.File(path).toPath(), java.nio.file.StandardCopyOption.ATOMIC_MOVE) }
    catch(raced) { if (!io.fileExists(path) || MiniAWikiRetrievalV2.digest(path) !== checksum) throw raced }
    this._syncPath(String(parent.getPath()), true)
  } finally { try { java.nio.file.Files.deleteIfExists(new java.io.File(temporary).toPath()) } catch(ignore) {} }
  return { bytes: MiniAWikiRetrievalV2.bytes(text), checksum: checksum }
}
// Schema 3 keeps shared immutable revision bytes outside a generation. Routed
// block-reference records, rather than links in every generation directory,
// are the ownership edges.
MiniAWikiRetrievalV2.prototype._blockRecords = function(manifest) {
  var records = {}
  if (manifest.schema !== 3) throw new Error("reindex-required")
  // Schema 3 keeps ownership beside the routed page records.  A block is not
  // a manifest-wide list: that would make every publication rediscover the
  // corpus merely to describe an unchanged immutable byte sequence.
  var catalog = this._resolveCatalogue(this.root + "/" + manifest.generation, manifest)
  Object.keys(catalog.blockRefs || {}).forEach(function(locator) {
    var record = catalog.blockRefs[locator]
    if (isMap(record) && record.locator === locator) { record = clone(record); record.path = locator; records[locator] = record }
  })
  return records
}
MiniAWikiRetrievalV2.prototype._blockPath = function(dir, manifest, locator, record) {
  if (!record) throw new Error("generation-block-missing")
  if (!isFinite(record.bytes) || record.bytes < 0 || !/^[a-f0-9]{64}$/.test(record.checksum)) throw new Error("invalid-generation-manifest")
  if (record.storage === "shared") return this._sharedBlockPath(locator)
  if (record.storage !== "generation") throw new Error("invalid-generation-manifest")
  var owner = record.ownerGeneration || manifest.generation
  if (!/^[a-f0-9-]{36}$/.test(String(owner))) throw new Error("invalid-generation-manifest")
  return this._path(owner===manifest.generation?dir:this.root + "/" + owner, locator)
}
MiniAWikiRetrievalV2.prototype._blockFile = function(dir, manifest, locator, record) {
  if (!record) record = this._lookupCatalogue(dir, manifest, "blockRefs", locator)
  return this._blockPath(dir, manifest, locator, record)
}
// Return the exact recoverable generation closure.  A schema-3 child only owns
// a delta, so every parent named by its catalogue descriptor is part of the
// reader contract too.  Do not use "all directories" as a retention policy:
// that makes reclamation permanently ineffective and hides abandoned staging
// generations after a crash.
MiniAWikiRetrievalV2.prototype._retentionClosure = function() {
  var retained = {}, expected = {}, queue = [], self = this
  var add = function(generation, checksum) {
    if (!/^[a-f0-9-]{36}$/.test(String(generation || "")) || retained[generation]) return
    retained[generation] = true; if (checksum) expected[generation] = checksum; queue.push(String(generation))
  }
  ;["current.json", "previous.json"].forEach(function(name) {
    var path = self.root + "/" + name
    if (!io.fileExists(path)) return
    var pointer = af.fromJson(io.readFileString(path))
    if (!isMap(pointer) || pointer.schema !== 1 || !/^[a-f0-9-]{36}$/.test(String(pointer.generation || ""))) throw new Error("invalid-generation-pointer")
    if (!/^[a-f0-9]{64}$/.test(String(pointer.checksum || ""))) throw new Error("invalid-generation-pointer")
    add(pointer.generation, pointer.checksum)
  })
  this.serving.forEach(function(snapshot) { if (snapshot && snapshot.manifest) add(snapshot.manifest.generation, snapshot.manifestChecksum) })
  while (queue.length) {
    var generation = queue.shift(), manifestPath = self.root + "/" + generation + "/manifest.json"
    if (!io.fileExists(manifestPath)) throw new Error("reclamation-deferred-missing-generation")
    if (expected[generation] && MiniAWikiRetrievalV2.digest(manifestPath) !== expected[generation]) throw new Error("generation-integrity-failure")
    var manifest = af.fromJson(io.readFileString(manifestPath)), descriptor = self._catalogueDescriptor(manifest)
    if (manifest.schema !== 3) throw new Error("reindex-required")
    if (descriptor.base !== true) {
      add(descriptor.parent.generation, descriptor.parent.checksum)
    }
  }
  return retained
}
// Mark only the retained closure. This deliberately resolves complete
// block-reference maps during maintenance; publication and serving paths do
// not call it. A collector is re-run immediately before every delete.
MiniAWikiRetrievalV2.prototype._markSharedReachability = function(retained) {
  var reachable = {}, self = this
  Object.keys(retained).forEach(function(generation) {
    var manifestPath = self.root + "/" + generation + "/manifest.json", manifest = af.fromJson(io.readFileString(manifestPath))
    if (manifest.schema !== 3) throw new Error("reindex-required")
    Object.keys(self._blockRecords(manifest)).forEach(function(locator) { reachable[locator] = true })
  })
  return reachable
}
// Shared immutable blocks are reclaimed with a journalled mark/sweep. A
// malformed or interrupted journal never authorizes deletion. The final mark
// is made from disk while the publication lock is held, immediately before
// each unlink, so a stale candidate list cannot race a recovered pointer.
MiniAWikiRetrievalV2.prototype.reclaimSharedBlocks = function() {
  if (!this.config.sharedBlockStore) return { ok: true, skipped: "shared-block-store-disabled", removed: 0 }
  var store = this.root + "/.blocks", journal = store + "/reclaim.json", reachable = {}, removed = 0, removedGenerations = 0, self = this, channel, lock
  try {
    if (!io.fileExists(store)) return { ok: true, removed: 0 }
    if (io.fileExists(journal)) {
      var recovery = af.fromJson(io.readFileString(journal))
      // Schema 1 journals predate the exact-closure list. They contain no
      // authority to delete: recover by discarding their candidate set and
      // making a fresh mark below. Schema 2 records the retained roots too.
      if (!isMap(recovery) || [1,2].indexOf(recovery.schema) < 0 || ["planned","marked","deleting","complete"].indexOf(recovery.phase) < 0 || !isArray(recovery.candidates) || recovery.schema === 2 && !isArray(recovery.retainedGenerations)) return { ok: false, error: "reclamation-deferred-invalid-journal", removed: 0, recoveryJournal: true }
    }
    // Publication and sweep share one OS lock.  A failed or interrupted sweep
    // is conservative: its journal is retained and later runs re-mark first.
    channel = new java.io.RandomAccessFile(this.root + "/publish.lock", "rw").getChannel()
    lock = channel.tryLock(); if (!lock) throw new Error("publication-busy")
    var retained = this._retentionClosure(); reachable = this._markSharedReachability(retained)
    var candidates = [], blocks = new java.io.File(store).listFiles() || []
    for (var b=0; b<blocks.length; b++) if (blocks[b].isFile() && /^[a-f0-9]{40}\.md$/.test(String(blocks[b].getName()))) {
      var locator = "blocks/" + String(blocks[b].getName())
      if (!reachable[locator]) candidates.push(locator)
    }
    this._atomic(journal, { schema: 2, phase: "planned", candidates: candidates, retainedGenerations: Object.keys(retained).sort() }, true, true)
    this._atomic(journal, { schema: 2, phase: "marked", candidates: candidates, retainedGenerations: Object.keys(retained).sort() }, true, true)
    candidates.forEach(function(locator) {
      self._atomic(journal, { schema: 2, phase: "deleting", candidates: candidates, retainedGenerations: Object.keys(retained).sort(), deleting: locator }, true, true)
      reachable = self._markSharedReachability(self._retentionClosure())
      if (!reachable[locator]) { java.nio.file.Files.deleteIfExists(new java.io.File(self._sharedBlockPath(locator)).toPath()); removed++ }
    })
    // Generation directories outside the exact retention closure have no
    // recovery role once their blocks have been marked from retained roots.
    var children = new java.io.File(this.root).listFiles() || []
    for (var i=0; i<children.length; i++) {
      var child = children[i], generation = String(child.getName())
      if (child.isDirectory() && /^[a-f0-9-]{36}$/.test(generation) && !retained[generation]) { io.rm(String(child.getPath())); removedGenerations++ }
    }
    this._atomic(journal, { schema: 2, phase: "complete", candidates: candidates, retainedGenerations: Object.keys(retained).sort(), removed: removed, removedGenerations: removedGenerations }, true, true)
    java.nio.file.Files.deleteIfExists(new java.io.File(journal).toPath())
    return { ok: true, removed: removed, retained: Object.keys(reachable).length, removedGenerations: removedGenerations }
  } catch(e) { return { ok: false, error: __miniAErrMsg(e), removed: removed, recoveryJournal: io.fileExists(journal) } }
  finally { try { if(lock)lock.release() } catch(ignoreLock) {}; try { if(channel)channel.close() } catch(ignoreChannel) {} }
}
MiniAWikiRetrievalV2.prototype._publicationCheckpoint = function(step, dir) {
  if (isFunction(this._publicationFault)) this._publicationFault(step, dir)
}
MiniAWikiRetrievalV2.prototype._newWriter = function(directory, analyzer) {
  var L = Packages.org.apache.lucene
  return new L.index.IndexWriter(directory, new L.index.IndexWriterConfig(analyzer))
}
// A publication mutates an isolated view of catalogue records.  Keeping this
// behind a transaction boundary is important: readers only ever see immutable
// shard operations and future callers must not reach into a retained snapshot
// and modify one of its maps directly.
var RoutedCatalogueTransaction = function(engine, parent, generation, work) {
  this.engine=engine;this.parent=parent;this.generation=generation;this.work=work
  this.maps=["pages","passages","reverseLinks","moveReverse","blockRefs"]
  this.operations={};this.cache={};this.pageDelta=0;this.passageDelta=0
  var self=this;this.maps.forEach(function(name){self.operations[name]={upsert:{},tombstones:[]};self.cache[name]={}})
}
RoutedCatalogueTransaction.prototype.get=function(map,key){
  var op=this.operations[map]
  if(!op)throw new Error("invalid-catalogue-map")
  if(Object.prototype.hasOwnProperty.call(op.upsert,key))return op.upsert[key]
  if(op.tombstones.indexOf(key)>=0)return __
  if(Object.prototype.hasOwnProperty.call(this.cache[map],key))return this.cache[map][key]
  var value=this.engine._lookupCatalogue(this.parent.dir,this.parent.manifest,map,key)
  this.cache[map][key]=value;this.work.catalogueKeyLookups=(Number(this.work.catalogueKeyLookups)||0)+1
  return value
}
RoutedCatalogueTransaction.prototype.put=function(map,key,value){
  var op=this.operations[map], existed=isDef(this.get(map,key))
  op.tombstones=op.tombstones.filter(function(item){return item!==key});op.upsert[key]=value
  if(!existed){if(map==="pages")this.pageDelta++;if(map==="passages")this.passageDelta++}
  return value
}
RoutedCatalogueTransaction.prototype.tombstone=function(map,key){
  var op=this.operations[map], existed=isDef(this.get(map,key))
  delete op.upsert[key];if(existed&&op.tombstones.indexOf(key)<0)op.tombstones.push(key)
  if(existed){if(map==="pages")this.pageDelta--;if(map==="passages")this.passageDelta--}
}
RoutedCatalogueTransaction.prototype.delta=function(){var self=this;this.maps.forEach(function(name){self.operations[name].tombstones.sort()});return{schema:1,maps:this.operations}}
RoutedCatalogueTransaction.prototype.stats=function(){return{pageCount:Number(this.parent.manifest.catalogue.stats.pageCount)+this.pageDelta,passageCount:Number(this.parent.manifest.catalogue.stats.passageCount)+this.passageDelta}}
MiniAWikiRetrievalV2.prototype.build = function(changes) {
  var m = this.manager, self = this
  if (this.capabilityError) return {ok:false,error:this.capabilityError}
  if (m._access !== "rw") return { ok: false, error: "wiki is read-only" }
  if (["fs", "s3fs"].indexOf(m._backendType) < 0 || m._archiveRoot) return { ok: false, error: "v2-backend-unsupported" }
  var work = { linkedFiles: 0, linkedBytes: 0, copiedFiles: 0, copiedBytes: 0, reusedChecksums: 0, reusedChecksumBytes: 0, reverseTargetsVisited: 0, legacyCataloguePagesVisited: 0, catalogueKeysCopied: 0, sharedPageRecords: 0, sharedPassageRecords: 0, retiredBlocksNotStaged: 0, retiredBlockBytesNotStaged: 0, retiredBlockUnlinksAvoided: 0, sameRevisionBlocksReused: 0 }, reused={}, oldBlocks={}, reusedPageBlocks={}, transaction
  work.publicationTimingsMillis={}
  var stageStarted=Number(java.lang.System.nanoTime()), finishStage=function(name){var now=Number(java.lang.System.nanoTime());work.publicationTimingsMillis[name]=(now-stageStarted)/1000000;stageStarted=now}
  var generation = String(java.util.UUID.randomUUID()), dir = this.root + "/" + generation, writer, directory, analyzer, old, snapshot, fileLock, channel, activated = false, cleanupAfterActivation = false
  try {
    io.mkdir(this.root)
    channel = new java.io.RandomAccessFile(this.root + "/publish.lock", "rw").getChannel()
    fileLock = channel.tryLock(); if (!fileLock) throw new Error("publication-busy")
    io.mkdir(dir); io.mkdir(dir + "/index"); if (!this.config.sharedBlockStore) io.mkdir(dir + "/blocks")
    this._publicationCheckpoint("staging-created", dir)
    var catalog = { schema: 1, generation: generation, wikiId: sha1(m._getBackendIdentity()), pages: {}, passages: {}, reverseLinks: {}, moveReverse: {}, blockRefs: {} }
    finishStage("preparation")
    if (isArray(changes)) {
      old = this.acquire()
      if(Number(old.manifest.catalogue.depth)>=32)throw new Error("compaction-required")
      transaction = new RoutedCatalogueTransaction(this,old,generation,work)
      finishStage("catalogueFork")
      old.manifest.files.forEach(function(file) {
        // Block retention is determined after applying the affected page set.
        if (/^index\//.test(file.path) && self._reuseFile(self._path(old.dir, file.path), self._path(dir, file.path), file, work)) reused[file.path]=file
      })
      finishStage("fileStaging")
    }
    // Stable logical identities are derived from the prior compatible catalogue.
    // An explicit full rebuild can repair missing/incompatible artifacts without
    // reading them as a serving generation.
    if (!old && io.fileExists(this.root + "/current.json")) {
      try { old = this.acquire() } catch(identityUnavailable) {}
    }
    analyzer = this._analyzer()
    var L = Packages.org.apache.lucene
    directory = L.store.FSDirectory.open(java.nio.file.Paths.get(dir + "/index"))
    writer = this._newWriter(directory, analyzer)
    this._publicationCheckpoint("writer-open", dir)
    finishStage("writerInitialization")
    var paths
    if (isArray(changes)) paths = changes.filter(function(p,i,a) { return a.indexOf(p) === i })
    else if (isFunction(m._backend.enumerate)) {
      var enumeration = m._backend.enumerate("")
      if (!enumeration || enumeration.ok !== true || !isArray(enumeration.pages)) throw new Error("source-enumeration-failed")
      paths = enumeration.pages.filter(function(path) { return !m._isHiddenPath(path) })
    } else paths = m.list("")
    var affectedBlocks = {}, writtenBlocks = {}, changedPaths = {}
    var getRecord=function(map,key){return transaction?transaction.get(map,key):catalog[map][key]}
    var putRecord=function(map,key,value){if(transaction)return transaction.put(map,key,value);catalog[map][key]=value;return value}
    var removeRecord=function(map,key){if(transaction)return transaction.tombstone(map,key);delete catalog[map][key]}
    var adjustBlock=function(locator,amount){
      var state=affectedBlocks[locator]
      if(!state){var prior=getRecord("blockRefs",locator);state=affectedBlocks[locator]={prior:prior,count:(prior?Number(prior.references):0)}}
      state.count+=amount;return state
    }
    var moveIdentityPages={},moveIdentityPassages={}
    if(transaction&&isMap(m._servingMoveOrigins))Object.keys(m._servingMoveOrigins).forEach(function(target){
      var origin=m._servingMoveOrigins[target], page=getRecord("pages",origin)
      if(!page)return
      moveIdentityPages[target]=page
      page.passageIds.forEach(function(id){var passage=getRecord("passages",id);if(passage)moveIdentityPassages[id]=passage})
    })
    paths.forEach(function(path) {
      path = self.manager._normalizeRetrievalPath(path)
      var previous = getRecord("pages",path)
      var excluded = m._isSearchExcludedPath(path), raw, sourceMissing = false, stamp
      if (!excluded) {
        var beforeRead = self._stamp(path)
        raw = m._backend.read(path)
        if (!isString(raw)) {
          var sourceStatus = isFunction(m._backend.sourceStatus) ? m._backend.sourceStatus(path) : __
          if (isArray(changes) && sourceStatus && sourceStatus.status === "missing") sourceMissing = true
          else throw new Error("source-read-failed")
        } else {
          stamp = self._stamp(path)
          if (stringify(beforeRead, __, "") !== stringify(stamp, __, "")) throw new Error("source-changed-during-build")
          if (previous && old && old.manifest.passageChars === self.config.passageChars && !m._servingMoveOrigins && sha1(raw) === previous.revision) {
            // A requested update with identical authoritative bytes needs no
            // parser, postings churn or Lucene delete/add. Keep the revision's
            // immutable records; only refresh the validated source stamp.
            if (stringify(previous.stamp, __, "") !== stringify(stamp, __, "")) {
              var refreshed = {}; Object.keys(previous).forEach(function(key) { refreshed[key] = previous[key] }); refreshed.stamp = stamp; putRecord("pages",path,refreshed)
              var refreshedTargets = {}
              previous.links.forEach(function(link) { refreshedTargets[link.resolved] = true })
              Object.keys(refreshedTargets).forEach(function(target) {
                var postings = getRecord("reverseLinks",target) || []
                putRecord("reverseLinks",target,postings.map(function(entry) {
                  if (entry.path !== path) return entry
                  return { path: entry.path, title: entry.title, links: entry.links, stamp: stamp }
                }))
                work.reverseTargetsVisited++
              })
            }
            work.unchangedPagesReused = Number(work.unchangedPagesReused || 0) + 1
            if (!reusedPageBlocks[previous.locator]) { reusedPageBlocks[previous.locator] = true; work.sameRevisionBlocksReused++ }
            var unchangedBlock=getRecord("blockRefs",previous.locator)
            if(unchangedBlock&&unchangedBlock.storage==="shared")work.sharedBlocksReferenced=(Number(work.sharedBlocksReferenced)||0)+1
            return
          }
        }
      }
      // This is the publication proof scope. It contains only source entries
      // whose binding, postings or deletion is emitted by this transaction.
      changedPaths[path] = true
      var previousPassages={}
      if (previous) {
        if (isMap(catalog.moveReverse)) (previous.moveTargets || []).forEach(function(target) {
          var posting = (getRecord("moveReverse",target) || []).filter(function(source) { return source !== path })
          if(posting.length)putRecord("moveReverse",target,posting)
          else removeRecord("moveReverse",target)
        })
        previous.passageIds.forEach(function(id) { var priorPassage=getRecord("passages",id);if(priorPassage){previousPassages[id]=priorPassage;if(priorPassage.path===path)removeRecord("passages",id)} })
        adjustBlock(previous.locator,-1)
        var priorTargets = {}
        previous.links.forEach(function(link) {
          if (priorTargets[link.resolved]) return
          priorTargets[link.resolved] = true; work.reverseTargetsVisited++
          var posting = (getRecord("reverseLinks",link.resolved) || []).filter(function(entry) { return entry.path !== path })
          if (posting.length) putRecord("reverseLinks",link.resolved,posting)
          else removeRecord("reverseLinks",link.resolved)
        })
      }
      var remove = java.lang.reflect.Array.newInstance(L.index.Term, 1); remove[0] = new L.index.Term("page", path)
      writer.deleteDocuments(remove); removeRecord("pages",path)
      if (excluded || sourceMissing) return
      var parsed = MiniAWikiRetrievalV2.parse(path, raw, self.config.passageChars), meta = af.fromJson(stringify(m.parseFrontmatter(raw).meta, __, ""))
      self.metrics.parsedPages++
      var locator = "blocks/" + parsed.revision + ".md"
      var blockPath = self.config.sharedBlockStore ? self._sharedBlockPath(locator) : self._path(dir, locator)
      var existingBlock=getRecord("blockRefs",locator)
      if(existingBlock) {
        // Raw source hashes to the existing immutable block. Defer its reuse
        // until retained-block staging, which still undergoes full validation.
        if(!reusedPageBlocks[locator]) { reusedPageBlocks[locator]=true;work.sameRevisionBlocksReused++ }
      } else {
        if (self.config.sharedBlockStore) {
          var staged = self._stageSharedText(locator, raw), sharedRecord = { path: locator, bytes: staged.bytes, checksum: staged.checksum }
          // Schema-2 generations reference this immutable store entry directly.
          // Do not recreate a generation-local hard link for every retained page.
          reused[locator] = sharedRecord
        } else if (!io.fileExists(blockPath)) self._writeServingFile(blockPath, raw)
        else if (sha1(io.readFileString(blockPath)) !== parsed.revision) throw new Error("immutable-block-conflict")
        writtenBlocks[locator]=true
      }
      var movedFrom = isMap(m._servingMoveOrigins) ? m._servingMoveOrigins[path] : __
      var identityPrevious = old ? (transaction?(movedFrom?moveIdentityPages[path]:previous):old.catalog.pages[movedFrom || path]) : __
      if (!movedFrom && isMap(m._servingMoveOrigins) && Object.keys(m._servingMoveOrigins).some(function(target) { return m._servingMoveOrigins[target] === path })) identityPrevious = __
      var stablePageId = identityPrevious ? identityPrevious.pageId : sha1(catalog.wikiId + ":" + path + (m._servingMoveOrigins ? ":" + parsed.revision : ""))
      var oldKeys = {}, newKeys = {}, oldRaw
      if (identityPrevious) {
        identityPrevious.passageIds.forEach(function(id) {
          var record = transaction?(previousPassages[id]||moveIdentityPassages[id]):old.catalog.passages[id]
          if (!record.textHash) {
            if (isUnDef(oldRaw)) oldRaw = io.readFileString(self._blockFile(old.dir, old.manifest, identityPrevious.locator))
            if (sha1(oldRaw) !== identityPrevious.revision) throw new Error("identity-block-mismatch")
          }
          var key = (record.textHash || sha1(oldRaw.substring(record.charStart, record.charEnd))) + ":" + stringify(record.headingAncestry, __, "") + ":" + record.kind
          if (!oldKeys[key]) oldKeys[key] = []
          oldKeys[key].push(id)
        })
      }
      parsed.passages.forEach(function(record) {
        record.textHash = sha1(record.text)
        var key = record.textHash + ":" + stringify(record.headingAncestry, __, "") + ":" + record.kind
        newKeys[key] = (newKeys[key] || 0) + 1
      })
      var page = { wikiId: catalog.wikiId, pageId: stablePageId, path: path, revision: parsed.revision, title: meta.title || path, description: meta.description || "", metadata: meta, outline: parsed.outline, linesTotal: parsed.linesTotal, charLength: raw.length, links: [], passageIds: [], locator: locator, stamp: stamp }
      m._extractLinkEntries(parsed.linkText).forEach(function(entry) { var resolved = entry.type === "wiki" ? entry.raw : m.resolveLink(path, entry.raw); if (resolved) page.links.push({ target: entry.raw, resolved: resolved }) })
      parsed.passages.forEach(function(passage) {
        var text = passage.text; delete passage.text
        var identityKey = passage.textHash + ":" + stringify(passage.headingAncestry, __, "") + ":" + passage.kind
        passage.passageId = oldKeys[identityKey] && oldKeys[identityKey].length === 1 && newKeys[identityKey] === 1 ? oldKeys[identityKey][0] : sha1(page.pageId + ":" + passage.passageId + ":" + passage.textHash + ":" + parsed.revision)
        passage.path = path; passage.pageId = page.pageId; passage.wikiId = catalog.wikiId; passage.generation = generation
        putRecord("passages",passage.passageId,passage); page.passageIds.push(passage.passageId)
        var doc = new L.document.Document()
        doc.add(new L.document.StringField("id", passage.passageId, L.document.Field.Store.YES))
        doc.add(new L.document.StringField("page", path, L.document.Field.Store.YES))
        doc.add(new L.document.StringField("recordType", "passage", L.document.Field.Store.YES))
        doc.add(new L.document.TextField("prose", text, L.document.Field.Store.NO))
        if (m._lexicalConfig.shingles) doc.add(new L.document.TextField("prose__shingle", text, L.document.Field.Store.NO))
        if (m._lexicalConfig.ngrams) doc.add(new L.document.TextField("prose__ngram", text, L.document.Field.Store.NO))
        doc.add(new L.document.TextField("exact", text, L.document.Field.Store.NO))
        doc.add(new L.document.StoredField("text", text))
        doc.add(new L.document.TextField("title", String(page.title) + " " + String(meta.aliases || "") + " " + String(meta.tags || ""), L.document.Field.Store.NO))
        doc.add(new L.document.TextField("heading", passage.headingAncestry.join(" "), L.document.Field.Store.NO))
        writer.addDocument(doc)
      })
      page.moveTargets = []
      // Preserve legacy move rewrites inside examples/front matter independently
      // of prose-only navigation links.
      m._extractLinkEntries(raw).forEach(function(entry) {
        var target = entry.raw.split("#")[0], resolved = entry.type === "wiki" ? target : m.resolveLink(path, target)
        if (resolved && page.moveTargets.indexOf(resolved) < 0) page.moveTargets.push(resolved)
      })
      page.moveTargets.forEach(function(target) {
        putRecord("moveReverse",target,(getRecord("moveReverse",target) || []).concat([path]))
      })
      putRecord("pages",path,page)
      adjustBlock(locator,1)
      var targets = {}
      page.links.forEach(function(link) { if (!targets[link.resolved]) targets[link.resolved] = []; targets[link.resolved].push(link) })
      Object.keys(targets).forEach(function(target) {
        work.reverseTargetsVisited++
        putRecord("reverseLinks",target,(getRecord("reverseLinks",target) || []).concat([{ path: path, title: page.title, links: targets[target], stamp: stamp }]))
      })
    })
    // Direct reference counts remove only newly retired immutable blocks.
    Object.keys(affectedBlocks).forEach(function(locator) {
      var state=affectedBlocks[locator]
      if(state.count<=0){removeRecord("blockRefs",locator);if(state.prior){work.retiredBlocksNotStaged++;work.retiredBlockBytesNotStaged+=Number(state.prior.bytes)||0}if(writtenBlocks[locator]&&!self.config.sharedBlockStore)java.nio.file.Files.deleteIfExists(new java.io.File(self._path(dir,locator)).toPath());else work.retiredBlockUnlinksAvoided++;return}
      var prior=state.prior||reused[locator], blockPath=self.config.sharedBlockStore?self._sharedBlockPath(locator):self._path(dir,locator)
      if(!prior)prior={bytes:Number(new java.io.File(blockPath).length()),checksum:MiniAWikiRetrievalV2.digest(blockPath)}
      putRecord("blockRefs",locator,{locator:locator,bytes:Number(prior.bytes),checksum:prior.checksum,storage:self.config.sharedBlockStore?"shared":"generation",ownerGeneration:self.config.sharedBlockStore?__:((prior&&prior.ownerGeneration)||generation),references:state.count})
    })
    finishStage("pageUpdates")
    writer.commit(); writer.close(); writer = null; directory.close(); directory = null; this._closeAnalyzer(analyzer); analyzer = null
    finishStage("writerCommitClose")
    this._publicationCheckpoint("writer-closed", dir)
    if(isArray(changes))finishStage("blockStaging")
    // Do not publish or enumerate a flattened catalogue.  Schema-3 shards
    // are written from the transaction below; the in-memory view is retained
    // only until the newly-written generation has been bound to Lucene.
    var catalogueChecksum
    finishStage("catalogueWrite")
    // Schema 3 is the sole local serving format.  A full reindex is a
    // depth-zero base; an incremental build is a delta over its predecessor.
    var schema = 3
    var manifest = { schema: schema, parser: 6, passageChars: this.config.passageChars, generation: generation, fingerprint: this.fingerprint, lexical: m._lexicalConfig, indexContract: this.indexContract, files: [] }
    // Turn publication-local reachability counters into immutable routed
    // descriptors only after all page mutations have completed.  This keeps
    // updates bounded while making every reference independently verifiable.
    if(!transaction)Object.keys(catalog.blockRefs).forEach(function(locator) {
      var references = isMap(catalog.blockRefs[locator]) ? Number(catalog.blockRefs[locator].references) : Number(catalog.blockRefs[locator])
      var prior = reused[locator], path = self.config.sharedBlockStore ? self._sharedBlockPath(locator) : self._path(dir, locator)
      if (!prior) prior = { bytes: Number(new java.io.File(path).length()), checksum: MiniAWikiRetrievalV2.digest(path) }
      catalog.blockRefs[locator] = { locator: locator, bytes: Number(prior.bytes), checksum: prior.checksum, storage: self.config.sharedBlockStore ? "shared" : "generation", ownerGeneration:self.config.sharedBlockStore?__:generation, references: references }
    })
    if (this.config.sharedBlockStore) manifest.files = manifest.files.filter(function(file) { return !/^blocks\//.test(file.path) })
    if (manifest.schema === 3) {
      var delta = transaction ? transaction.delta() : this._catalogueDelta({ pages:{}, passages:{}, reverseLinks:{}, moveReverse:{}, blockRefs:{} }, catalog), shards = this._writeCatalogueShards(dir, delta, work)
      // The schema-3 manifest is the immutable routing table.  The data
      // shards are deliberately not represented by a monolithic catalogue
      // record, which lets a cold reader validate metadata before touching
      // page/passages it will not serve.
      manifest.files = this._files(dir,reused,work)
      var stats=transaction?transaction.stats():{pageCount:Object.keys(catalog.pages).length,passageCount:Object.keys(catalog.passages).length}
      manifest.catalogue = { schema: 3, transactionFormat:"routed-delta-v1", base: !transaction, wikiId: catalog.wikiId, shards: shards, depth: transaction ? Number(old.manifest.catalogue.depth) + 1 : 0, stats: stats }
      if (transaction) manifest.catalogue.parent = { generation: old.generation, checksum: MiniAWikiRetrievalV2.digest(old.dir + "/manifest.json") }
      manifest.merkle = MiniAWikiRetrievalV2.manifestMerkle(manifest)
      work.catalogueDeltaRecords = Object.keys(delta.maps.pages.upsert).length + delta.maps.pages.tombstones.length
      work.catalogueDeltaBytes = Number(work.catalogueShardBytes) || 0
    }
    this._writeServingFile(dir + "/manifest.json", stringify(manifest, __, ""))
    finishStage("manifestWrite")
    this._publicationCheckpoint("manifest-written", dir)
    var bindingReads=this.metrics.validationBlockReads, bindingReused=this.metrics.validationReusedPages
    var validated = this._validatePublication(dir, manifest, {catalog:transaction?__:catalog,transaction:transaction,changedPaths:changedPaths,checksum:catalogueChecksum})
    finishStage("artifactValidation")
    work.bindingBlockReads=this.metrics.validationBlockReads-bindingReads;work.bindingReusedPages=this.metrics.validationReusedPages-bindingReused
    this._publicationCheckpoint("artifacts-validated", dir)
    snapshot = this._openSnapshot(dir, manifest, transaction?__:validated)
    var probe = snapshot.searcher.search(new L.search.MatchAllDocsQuery(), 2)
    for (var sample = 0; sample < probe.scoreDocs.length; sample++) {
      var stored = m._luceneStoredDoc(snapshot.searcher, probe.scoreDocs[sample].doc), passage = this.lookupPassage(snapshot,String(stored.get("id")))
      if (!passage || String(stored.get("recordType")) !== "passage") throw new Error("generation-probe-failed")
      var probePage=this.lookupPage(snapshot,passage.path), probeBlock=this.lookupBlockReference(snapshot,probePage.locator)
      var block = io.readFileString(self._blockFile(dir, manifest, probePage.locator,probeBlock))
      if (sha1(block) !== passage.revision || block.substring(passage.charStart, passage.charEnd) !== String(stored.get("text"))) throw new Error("generation-evidence-probe-failed")
    }
    this._publicationCheckpoint("searcher-verified", dir)
    finishStage("searcherVerification")
    // Fault hook is used only by local regression fixtures, never configuration.
    if (isFunction(this._beforeActivate)) this._beforeActivate(dir)
    this._syncGeneration(dir, manifest)
    finishStage("generationSynchronization")
    var pointerPath = this.root + "/current.json"
    // Keep exactly one prior, already-active pointer for safe reader recovery.
    // The backup is durable before activation; it never changes source content.
    if (io.fileExists(pointerPath)) {
      if (java.nio.file.Files.isSymbolicLink(new java.io.File(pointerPath).toPath())) throw new Error("unsafe-generation-pointer")
      var priorPointer = af.fromJson(io.readFileString(pointerPath))
      if (!priorPointer || priorPointer.schema !== 1 || !/^[a-f0-9-]{36}$/.test(priorPointer.generation)) throw new Error("invalid-generation-pointer")
      this._atomic(this.root + "/previous.json", priorPointer, true, true)
    }
    this._atomic(pointerPath, { schema: 1, generation: generation, checksum: MiniAWikiRetrievalV2.digest(dir + "/manifest.json") }, true)
    activated = true
    cleanupAfterActivation = this.config.sharedBlockStore === true && !isArray(changes)
    finishStage("activation")
    this._publicationCheckpoint("pointer-activated", dir)
    if(old){this.release(old);old=null}
    try { if (this._retainValidatedSnapshot(snapshot)) snapshot = null } catch(retentionBusy) { try { this.manager._logFn("warn", "[wiki] validated searcher retention deferred") } catch(ignoreLog) {} }
    if(snapshot){this._closeSnapshot(snapshot);snapshot=null}
    var pendingExport = this.manager._knowledgeJournalPending && this.manager._knowledgeJournalPending()
    var exported = this.config.bundlePath ? (pendingExport ? { ok: false, deferred: true, error: "ingest-pending" } : this.exportBundle(this.config.bundlePath)) : __
    finishStage("readerRetentionExport")
    return { ok: !exported || exported.ok || exported.deferred === true, activationSucceeded: true, localPublished: true, bundle: exported, generation: generation, pages: Number(manifest.catalogue.stats.pageCount), passages: Number(manifest.catalogue.stats.passageCount), updatedPages: paths.length, updateWork: work }
  } catch(e) { activated = activated || e._pointerActivated === true; return { ok: false, error: __miniAErrMsg(e), previousGenerationPreserved: true, activationSucceeded: activated, localPublished: activated, generation: activated ? generation : __, updateWork: work } }
  finally {
    try { if (snapshot) this._closeSnapshot(snapshot) } catch(ignoreS) {}
    try { if (writer) writer.rollback() } catch(ignoreW) {}
    try { if (directory) directory.close() } catch(ignoreD) {}
    try { if (analyzer) this._closeAnalyzer(analyzer) } catch(ignoreA) {}
    try { if (old) this.release(old) } catch(ignoreO) {}
    try { if (fileLock) fileLock.release(); if (channel) channel.close() } catch(ignoreL) {}
    // Full reindex is an explicit maintenance boundary. Incremental updates
    // must not pay for full-catalogue reachability scans in this finally block.
    // Deferred residue remains until full reindex or explicit reclamation.
    // The sweeper reacquires the publication lock and preserves recovery roots.
    if (cleanupAfterActivation) try { this.reclaimSharedBlocks() } catch(ignoreCleanup) {}
  }
}
MiniAWikiRetrievalV2.terms = function(query) {
  var matcher = java.util.regex.Pattern.compile("[\\p{L}\\p{N}_-]+", java.util.regex.Pattern.UNICODE_CHARACTER_CLASS).matcher(String(query).toLowerCase()), out = []
  while (matcher.find() && out.length < 32) { var term = String(matcher.group()); if (out.indexOf(term) < 0) out.push(term) }
  return out
}
MiniAWikiRetrievalV2.prototype._query = function(snapshot, query, limit, expansionBudget, request) {
  var L = Packages.org.apache.lucene, analyzer = this._analyzer()
  try {
    var options = ow.ch.__types.searchdb.__lexicalOptions(this.manager._luceneLexicalOptions())
    var routes = ["lexical", "exact"], omitted = [], extraAttempts = 0, seedCount = 0
    var checkDeadline = function() { if (request && Date.now() >= request.deadline) throw new Error("request-deadline-exhausted") }
    var typedQuery = function(value) { var typed = new L.search.BooleanQuery.Builder(); typed.add(value, L.search.BooleanClause.Occur.MUST); typed.add(new L.search.TermQuery(new L.index.Term("recordType", "passage")), L.search.BooleanClause.Occur.FILTER); return typed.build() }
    snapshot.searcher.setSimilarity(new L.search.similarities.BM25Similarity(Number(options.bm25.k1), Number(options.bm25.b)))
    var fields = java.lang.reflect.Array.newInstance(java.lang.String, 3); fields[0] = "prose"; fields[1] = "title"; fields[2] = "heading"
    var boosts = new java.util.HashMap(); boosts.put("prose", java.lang.Float.valueOf(1)); boosts.put("title", java.lang.Float.valueOf(2)); boosts.put("heading", java.lang.Float.valueOf(2))
    var escaped = String(L.queryparser.classic.QueryParser.escape(String(query)))
    var parser = new L.queryparser.classic.MultiFieldQueryParser(fields, analyzer, boosts), builder = new L.search.BooleanQuery.Builder()
    var syntax = /(^|\s)(?:title|heading|prose|content|exact):/i.test(query) || /\s(?:AND|OR|NOT)\s/.test(query) || /^"[\s\S]*"$/.test(query)
    var effectiveQuery = syntax ? String(query).replace(/(^|\s)content:/gi, "$1prose:") : escaped
    if (syntax) routes = ["explicit-lexical"]
    var natural
    try { natural = parser.parse(effectiveQuery) } catch(queryError) { if ((queryError.javaException || queryError) instanceof Packages.org.apache.lucene.queryparser.classic.ParseException) throw new Error("invalid-query"); throw queryError }
    builder.add(natural, L.search.BooleanClause.Occur.SHOULD)
    var exact = new L.queryparser.classic.QueryParser("exact", analyzer)
    if (!syntax) builder.add(new L.search.BoostQuery(exact.parse("\"" + escaped + "\""), java.lang.Float.valueOf(8)), L.search.BooleanClause.Occur.SHOULD)
    // Deterministic, bounded whole-rule alternatives support multiword synonyms.
    var remainingAttempts = Math.max(0, Number(expansionBudget) || 0)
    var expansionLimit = Math.min(8, remainingAttempts)
    var charge = function() { extraAttempts++; remainingAttempts--; if (request && request.used) request.used.queries++ }
    // Explicit Lucene constraints must not be broadened by escaped alternatives.
    var expansions = [], alternatives = [], q = String(query).toLowerCase(), rules = syntax ? [] : this.manager._lexicalConfig.synonyms
    for (var r = 0; r < rules.length && alternatives.length < 8; r++) {
      for (var t = 0; t < rules[r].length && alternatives.length < 8; t++) {
        var term = String(rules[r][t]).toLowerCase()
        var matcher = java.util.regex.Pattern.compile("(?<![\\p{L}\\p{N}_])" + java.util.regex.Pattern.quote(term) + "(?![\\p{L}\\p{N}_])").matcher(q)
        if (matcher.find()) {
          for (var a = 0; a < rules[r].length && alternatives.length < 8; a++) if (a !== t) {
            var expanded = q.substring(0, matcher.start()) + String(rules[r][a]).toLowerCase() + q.substring(matcher.end())
            if (expanded !== q && alternatives.indexOf(expanded) < 0) alternatives.push(expanded)
          }
        }
      }
    }
    if (alternatives.length > expansionLimit) omitted.push("synonyms")
    alternatives.slice(0,expansionLimit).forEach(function(expanded) { checkDeadline(); charge(); expansions.push(expanded); builder.add(parser.parse(String(L.queryparser.classic.QueryParser.escape(expanded))),L.search.BooleanClause.Occur.SHOULD) })
    if (expansions.length) routes.push("synonyms")
    var specs = [{enabled:options.shingles.enabled,field:"prose__shingle",route:"shingles",boost:0.6},{enabled:options.characterNGrams.enabled,field:"prose__ngram",route:"ngrams",boost:0.3}]
    specs.forEach(function(spec) {
      if (!spec.enabled || syntax) return
      if (remainingAttempts < 1) { omitted.push(spec.route); return }
      checkDeadline()
      charge()
      var parsed = new L.queryparser.classic.QueryParser(spec.field, analyzer).parse(escaped)
      builder.add(new L.search.BoostQuery(parsed, java.lang.Float.valueOf(spec.boost)), L.search.BooleanClause.Occur.SHOULD)
      routes.push(spec.route)
    })
    var combined = builder.build(), hits, finalLimit = limit
    var feedback = !syntax && (options.queryExpansion.enabled || options.pseudoRelevanceFeedback.enabled)
    if (feedback) {
      var feedbackRoute = options.pseudoRelevanceFeedback.enabled ? "pseudoRelevanceFeedback" : "queryExpansion"
      if (remainingAttempts < 1 || options.pseudoRelevanceFeedback.enabled && limit < 2) omitted.push(feedbackRoute)
      else {
        checkDeadline()
        charge()
        var mlt, feedbackFields = java.lang.reflect.Array.newInstance(java.lang.String, 1)
        try { mlt = new L.queries.mlt.MoreLikeThis(snapshot.reader) } catch(feedbackError) { throw new Error("feedback-capability-unavailable: " + __miniAErrMsg(feedbackError)) }
        feedbackFields[0] = "prose"; mlt.setFieldNames(feedbackFields); mlt.setAnalyzer(analyzer); mlt.setMinTermFreq(1)
        mlt.setMinDocFreq(Number(options.queryExpansion.minDocFreq)); mlt.setMaxQueryTerms(Math.min(32,Number(options.queryExpansion.maxTerms)))
        mlt.setMaxDocFreq(Math.max(Number(options.queryExpansion.minDocFreq),Math.floor(Number(snapshot.reader.numDocs()) * Number(options.queryExpansion.maxDocFreqRatio))))
        var expandedQuery
        if (options.pseudoRelevanceFeedback.enabled) {
          var seeds = snapshot.searcher.search(typedQuery(combined), Math.min(5,Number(options.pseudoRelevanceFeedback.topDocuments),Math.floor(limit/2))), feedbackBuilder = new L.search.BooleanQuery.Builder(), eligible = 0
          seedCount = seeds.scoreDocs.length; finalLimit -= seedCount
          if (request && request.used) { request.used.candidates += seedCount; request.used.materializedPassages += seedCount }
          mlt.setMinTermFreq(Number(options.pseudoRelevanceFeedback.minTermFreq)); mlt.setMinDocFreq(Number(options.pseudoRelevanceFeedback.minDocFreq)); mlt.setMaxQueryTerms(Math.min(32,Number(options.pseudoRelevanceFeedback.maxTerms)))
          for (var si = 0; si < seedCount; si++) {
            checkDeadline()
            var seed = this.manager._luceneStoredDoc(snapshot.searcher,seeds.scoreDocs[si].doc), seedRecord=this.lookupPassage(snapshot,String(seed.get("id"))), seedPage = this.lookupPage(snapshot,String(seed.get("page")))
            if(!seedRecord || seedRecord.path!==String(seed.get("page")) || seedRecord.textHash!==sha1(String(seed.get("text")||"")))throw new Error("generation-index-text-mismatch")
            if (!this._active(seedPage,request ? request.pending : this._pending(),request && request.permissions,request && request.deadline,request && request.used, __, snapshot) || !this._constraints(seedPage,request ? request.options : {})) continue
            // Prose is not a stored field. Use bounded stored passage text; never a source chunk or full page.
            feedbackBuilder.add(mlt.like("prose",new java.io.StringReader(String(seed.get("text") || ""))),L.search.BooleanClause.Occur.SHOULD); eligible++
          }
          if (eligible) expandedQuery = feedbackBuilder.build()
        } else expandedQuery = mlt.like("prose",new java.io.StringReader(String(query)))
        if (expandedQuery) {
          var enriched = new L.search.BooleanQuery.Builder(); enriched.add(combined,L.search.BooleanClause.Occur.SHOULD); enriched.add(new L.search.BoostQuery(expandedQuery,java.lang.Float.valueOf(Number(options.pseudoRelevanceFeedback.enabled ? options.pseudoRelevanceFeedback.boost : options.queryExpansion.boost))),L.search.BooleanClause.Occur.SHOULD)
          combined = enriched.build(); routes.push(feedbackRoute)
        }
      }
    }
    checkDeadline()
    hits = snapshot.searcher.search(typedQuery(combined), finalLimit)
    var out = []
    for (var i = 0; i < hits.scoreDocs.length; i++) {
      var doc = this.manager._luceneStoredDoc(snapshot.searcher, hits.scoreDocs[i].doc), id = String(doc.get("id")), record = this.lookupPassage(snapshot,id)
      if (!record) throw new Error("generation-record-missing")
      if(record.path!==String(doc.get("page")) || String(doc.get("recordType"))!=="passage" || record.textHash!==sha1(String(doc.get("text")||"")))throw new Error("generation-index-text-mismatch")
      out.push({ record: record, nativeScore: Number(hits.scoreDocs[i].score), text: String(doc.get("text") || ""), sourceRank: i + 1 })
    }
    return { hits: out, expansions: expansions, routes: routes, omittedRoutes: omitted, extraAttempts: extraAttempts, seedCount: seedCount, totalHits: Number(isFunction(hits.totalHits.value) ? hits.totalHits.value() : hits.totalHits.value) }
  } finally { this._closeAnalyzer(analyzer) }
}
// Select one query-ranked stored passage from a discovered page without a body scan.
MiniAWikiRetrievalV2.prototype._graphHit = function(snapshot, path, query) {
  var L = Packages.org.apache.lucene, analyzer = this._analyzer()
  try {
    var builder = new L.search.BooleanQuery.Builder()
    builder.add(new L.search.TermQuery(new L.index.Term("recordType","passage")),L.search.BooleanClause.Occur.FILTER)
    builder.add(new L.search.TermQuery(new L.index.Term("page",path)),L.search.BooleanClause.Occur.FILTER)
    builder.add(new L.search.MatchAllDocsQuery(),L.search.BooleanClause.Occur.MUST)
    var parser = new L.queryparser.classic.QueryParser("prose",analyzer)
    builder.add(parser.parse(String(L.queryparser.classic.QueryParser.escape(query))),L.search.BooleanClause.Occur.SHOULD)
    var found = snapshot.searcher.search(builder.build(),1)
    if (!found.scoreDocs.length) return null
    var doc = this.manager._luceneStoredDoc(snapshot.searcher,found.scoreDocs[0].doc), record = this.lookupPassage(snapshot,String(doc.get("id"))), text = String(doc.get("text") || "")
    if (!record || record.path !== path || String(doc.get("page")) !== path || record.textHash !== sha1(text)) throw new Error("generation-index-text-mismatch")
    return {record:record,text:text,nativeScore:Number(found.scoreDocs[0].score),sourceRank:1}
  } finally {this._closeAnalyzer(analyzer)}
}
MiniAWikiRetrievalV2.prototype._graphActive = function(hit, deadline, used) {
  var self = this
  if (hit.graphRoutes && !hit.graphRoutes.every(function(route) {var resolved=route.owner._resolveMountPath(route.path);return !!resolved && !!resolved.mount && resolved.mount.manager === route.manager})) return false
  return !hit.graphSupports || hit.graphSupports.every(function(support) {return self._authorised(support) && support.engine._active(support.page,support.engine._pending(),__,deadline,used,__,support.snapshot)})
}

MiniAWikiRetrievalV2.prototype._rank = function(hit, query) {
  var text = hit.text.toLowerCase(), page = hit.page, title = String(page.title).toLowerCase(), heading = hit.record.headingAncestry.join(" ").toLowerCase(), q = String(query).toLowerCase(), terms = MiniAWikiRetrievalV2.terms(query)
  var fraction = function(value) { return terms.length ? terms.filter(function(t) { return value.indexOf(t) >= 0 }).length / terms.length : 0 }
  var components = { phrase: text.indexOf(q) >= 0 ? 4 : 0, coverage: 3 * fraction(text), title: fraction(title), heading: 1.5 * fraction(heading), sourceRankFusion: 1 / (60 + hit.sourceRank), expansionAgreement: (hit.expansions || []).some(function(q) { return text.indexOf(q.toLowerCase()) >= 0 }) ? 3 : 0 }
  hit.scoreComponents = components
  hit.rankScore = components.phrase + components.coverage + components.title + components.heading + components.sourceRankFusion + components.expansionAgreement
  hit.retrievalMethod = components.phrase > 0 && /[_-]|[A-Z]/.test(String(query)) ? "exact" : "lexical"
  return hit
}
MiniAWikiRetrievalV2.retired = function(page) {
  var metadata = page && page.metadata || {}
  var status = isString(metadata.status) ? metadata.status.trim().toLowerCase() : ""
  return metadata.retired === true || ["retired", "superseded", "withdrawn", "rejected"].indexOf(status) >= 0 || metadata.superseded === true || isString(metadata.superseded_by) && metadata.superseded_by.trim().length > 0
}
// These fields are descriptive provenance for trusted evidence, never a claim
// that a page is current or factually verified. Restricted adapters must keep
// applying their opaque-reference projection before returning a record.
MiniAWikiRetrievalV2.trustedProvenance = function(metadata) {
  var source = isMap(metadata) ? metadata : {}, out = {}, fields = {
    status: "reviewStatus",
    authority: "authority",
    verified: "verificationDate",
    source_ref: "sourceRevision",
    ingested: "ingestedAt"
  }
  Object.keys(fields).forEach(function(field) {
    if (isString(source[field]) && source[field].trim().length) out[fields[field]] = source[field]
  })
  return out
}
MiniAWikiRetrievalV2.prototype._constraints = function(page, options) {
  if (MiniAWikiRetrievalV2.retired(page)) return false
  var requested = options.applicability
  var validity = page.metadata.validity, at = requested && requested.validAt
  if (isDef(validity)) {
    if (!isMap(validity) || Object.keys(validity).some(function(k) { return k !== "from" && k !== "until" })) return false
    var from = isDef(validity.from) ? MiniAWikiRetrievalV2.validityDate(validity.from) : null
    var until = isDef(validity.until) ? MiniAWikiRetrievalV2.validityDate(validity.until) : null
    if (isDef(at) && from === null && until === null) return false
    if ((isDef(validity.from) && from === null) || (isDef(validity.until) && until === null) || (from !== null && until !== null && from > until)) return false
    var day = isDef(at) ? MiniAWikiRetrievalV2.validityDate(at) : Math.floor((isDef(options._evaluationTime) ? options._evaluationTime : new Date().getTime()) / 86400000)
    if (day === null || (from !== null && day < from) || (until !== null && day > until)) return false
  } else if (isDef(at)) return false
  if (isUnDef(requested)) return true
  if (!isMap(requested)) throw new Error("invalid-applicability")
  var actual = isMap(page.metadata.applicability) ? page.metadata.applicability : {}
  return Object.keys(requested).every(function(key) {
    if (key === "validAt") return MiniAWikiRetrievalV2.validityDate(requested[key]) !== null
    if (["product", "version", "platform", "environment"].indexOf(key) < 0 || !isString(requested[key])) throw new Error("invalid-applicability")
    // Missing information remains unknown; an explicit filter cannot confirm it.
    return isArray(actual[key]) ? actual[key].indexOf(requested[key]) >= 0 : actual[key] === requested[key]
  })
}
MiniAWikiRetrievalV2.validityDate = function(value) {
  if (!isString(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  try { return Number(java.time.LocalDate.parse(value).toEpochDay()) } catch(e) { return null }
}
// Expand only within the already-selected and pinned federation. Graph discovery
// never opens a new wiki, and each support keeps its own reader/permission scope.
MiniAWikiRetrievalV2.prototype._expandGraph = function(candidates, contexts, opts, budget, used, deadline, stopReasons, measure) {
  var self = this, cfg = this.manager._config, work = {used:0,limit:budget.maxGraphEdges,truncated:false}, known = {}, seeded = {}, secondHop = []
  var number = function(value, fallback, max) {return isFinite(Number(value)) && isDef(value) ? Math.max(0,Math.min(max,Math.floor(Number(value)))) : fallback}
  var crossCap = number(cfg.wikigraphcrosscap,5,10), crossUsed = 0, depth = number(cfg.wikigraphcrossdepth,1,2)
  var maxDf = isDef(cfg.wikigraphcrossmaxdf) && isFinite(Number(cfg.wikigraphcrossmaxdf)) ? Math.max(0,Math.min(1,Number(cfg.wikigraphcrossmaxdf))) : 0.25
  var minKeyLen = number(cfg.wikigraphcrossminkeylen,3,2048), kinds = {}
  String(isString(cfg.wikigraphcrossjoin) ? cfg.wikigraphcrossjoin : "link,tag,alias,concept").split(",").forEach(function(kind){kinds[kind.trim().toLowerCase()] = true})
  var enabled = function(context) {var c=context.engine.manager._config;return crossCap > 0 && depth > 0 && cfg.wikigraphcross !== false && cfg.wikigraphmounts !== false && c.wikigraphcross !== false && c.wikigraphmounts !== false}
  var partial = function(context, reason) {context.source.status="partial";context.source.reason=reason;if(stopReasons.indexOf(reason)<0)stopReasons.push(reason)}
  var publicPath = function(context,path) {return context.target.name === "primary" ? path : "@" + context.target.name + "/" + path}
  var authorised = function(context,path) {return self._authorised({wiki:context.target.name,path:publicPath(context,path),engine:context.engine})}
  var sameWiki = function(a,b) {return a === b || a._backendType === b._backendType && a._getBackendIdentity() === b._getBackendIdentity() && String(a._config.url || a._config.esurl || "") === String(b._config.url || b._config.esurl || "")}
  var resolve = function(context,path) {
    if (path.indexOf("@") !== 0) return {context:context,path:path,routes:[]}
    if (!enabled(context) || !kinds.link) return null
    var owner=context.engine.manager, mounted=owner._resolveMountPath(path)
    if (!mounted || !mounted.mount) return null
    var target=contexts.filter(function(candidate) {
      // Root aliases must themselves be selected. A mounted wiki's private alias
      // can route only to a wiki already selected in the requesting federation.
      return owner === self.manager ? candidate.engine.manager === mounted.mount.manager : sameWiki(candidate.engine.manager,mounted.mount.manager)
    })[0]
    if (!target) return null
    return {context:target,path:mounted.localPath.split("#")[0],routes:[{owner:owner,path:path,manager:mounted.mount.manager}],cross:true,explicit:true}
  }
  var exhausted = function() {return used.graphExpansion >= budget.maxGraphExpansion || used.candidates >= budget.maxCandidates || used.queries >= budget.maxQueries || Date.now() >= deadline}
  var bind = function(context,support) {return {context:context,path:support.path,revision:support.revision}}
  var admit = function(entry, origin) {
    var target=entry.context, path=publicPath(target,entry.path)
    if (known[path] || opts.path && path !== opts.path || !authorised(target,entry.path)) return
    if (entry.cross && crossUsed >= crossCap || exhausted()) {partial(origin,"graph-budget");return}
    used.graphExpansion++;if(entry.cross)crossUsed++
    var page=target.engine.lookupPage(target.pin,entry.path)
    if (!page || !target.engine._constraints(page,opts)) return
    var supports=[], valid=entry.supports.every(function(support) {
      var context=support.context, source=context.engine.lookupPage(context.pin,support.path)
      if (!authorised(context,support.path) || !source || !support.revision || source.revision !== support.revision || !context.engine._active(source,context.pending,context.permissions,deadline,used,__,context.pin) || !context.engine._constraints(source,opts)) return false
      supports.push({engine:context.engine,snapshot:context.pin,wiki:context.target.name,path:publicPath(context,support.path),page:source});return true
    })
    if (!valid) {partial(origin,"stale-graph-evidence");return}
    if (!target.engine._active(page,target.pending,target.permissions,deadline,used,__,target.pin)) {partial(target,"stale-or-pending-evidence");return}
    used.queries++
    var hit=measure("search",function(){return target.engine._graphHit(target.pin,entry.path,opts.query)})
    if (!hit) return
    used.candidates++;used.materializedPassages++;target.source.candidates++
    hit.page=page;hit.engine=target.engine;hit.snapshot=target.pin;hit.wiki=target.target.name;hit.path=path;hit.graphSupports=supports;hit.graphRoutes=entry.routes || [];hit.expansions=[]
    measure("rank",function(){target.engine._rank(hit,opts.query)})
    hit.scoreComponents.graph=0.25;hit.rankScore+=0.25;hit.retrievalMethod="graph"
    candidates.push(hit);known[path]=true
    if (entry.explicit && depth >= 2) secondHop.push({hit:hit,context:target,supports:entry.supports,routes:hit.graphRoutes})
  }
  var seeds=candidates.slice().sort(function(a,b){return b.rankScore-a.rankScore || (a.path<b.path?-1:a.path>b.path?1:0)})
  seeds.forEach(function(hit){known[hit.path]=true})
  var discover = function(seed, context, previous) {
    var graph=context.engine.manager._graph
    if (!graph || !isFunction(graph.expansionCandidates)) {partial(context,"graph-unavailable");return}
    var base=(previous ? previous.supports : []).concat([bind(context,{path:seed.record.path,revision:seed.page.revision})])
    var accept=function(path){var route=previous && path.indexOf("@")===0 ? null : resolve(context,path);return !!route && !known[publicPath(route.context,route.path)] && (!route.cross || crossUsed<crossCap)}
    var related=graph.expansionCandidates(seed.record.path,{cap:budget.maxGraphExpansion-used.graphExpansion,budget:work,deadline:deadline,accept:accept})
    for(var i=0;i<related.length;i++) {
      if(exhausted()){partial(context,"graph-budget");return}
      var suggestion=related[i], route=resolve(context,suggestion.path)
      if(!route || previous && route.cross)continue
      route.supports=base.concat(suggestion.supports.map(function(s){return bind(context,s)}))
      if(previous){route.cross=true;route.routes=previous.routes}
      admit(route,context)
    }
    if(previous || !enabled(context) || crossUsed>=crossCap || exhausted())return
    var keys=graph.expansionJoinKeys(seed.record.path,{kinds:kinds,minKeyLen:minKeyLen,budget:work,deadline:deadline})
    for(var t=0;t<contexts.length && keys.length;t++) {
      var target=contexts[t], targetGraph=target.engine.manager._graph
      if(sameWiki(context.engine.manager,target.engine.manager) || !targetGraph || !authorised(target,""))continue
      if(exhausted() || crossUsed>=crossCap){partial(context,"graph-budget");break}
      var matches=targetGraph.expansionMatches(keys,{cap:Math.min(crossCap-crossUsed,budget.maxGraphExpansion-used.graphExpansion),maxDf:maxDf,pageCount:target.pin.manifest.catalogue.stats.pageCount,budget:work,deadline:deadline,accept:function(path){return !known[publicPath(target,path)]}})
      for(var m=0;m<matches.length;m++) {
        var match=matches[m]
        admit({context:target,path:match.path,cross:true,supports:base.concat([bind(context,match.sourceSupport),bind(target,match.targetSupport)])},context)
        if(exhausted() || crossUsed>=crossCap)break
      }
    }
  }
  for(var s=0;s<seeds.length;s++) {
    var seed=seeds[s], context=contexts.filter(function(entry){return entry.engine===seed.engine && entry.target.name===seed.wiki})[0]
    if(!context || seeded[seed.path])continue
    seeded[seed.path]=true
    if(exhausted()){partial(context,"graph-budget");break}
    try{discover(seed,context)}catch(error){partial(context,Date.now()>=deadline?"graph-budget":"graph-unavailable")}
    if(work.truncated)partial(context,"graph-budget")
  }
  // Compatibility with crossdepth=2: one local hop after an explicit cross link,
  // never another cross link or an unbounded recursive walk.
  for(var h=0;h<secondHop.length;h++) {
    var next=secondHop[h]
    if(exhausted() || crossUsed>=crossCap){partial(next.context,"graph-budget");break}
    try{discover(next.hit,next.context,next)}catch(error){partial(next.context,Date.now()>=deadline?"graph-budget":"graph-unavailable")}
    if(work.truncated)partial(next.context,"graph-budget")
  }
  used.graphEdges=work.used
}

MiniAWikiRetrievalV2.prototype._collect = function(query, options, materialize, present) {
  var started = Number(java.lang.System.nanoTime())
  var opts = {}, evaluationTime = new Date().getTime()
  if (isMap(options)) Object.keys(options).forEach(function(k) { opts[k] = options[k] })
  opts._evaluationTime = evaluationTime
  var selection = this.manager.resolveWikiSelection(opts.wiki)
  if (!selection.ok) return selection
  if (!isString(query) || !query.trim()) return { ok: false, error: "query-required" }
  if (query.length > 2048) return { ok: false, error: "query-too-long" }
  if (isDef(opts.applicability) && (!isMap(opts.applicability) || !Object.keys(opts.applicability).every(function(k) { return k === "validAt" ? MiniAWikiRetrievalV2.validityDate(opts.applicability[k]) !== null : ["product", "version", "platform", "environment"].indexOf(k) >= 0 && isString(opts.applicability[k]) }))) return { ok: false, error: "invalid-applicability" }
  var finite = function(value, fallback, max) { if (isUnDef(value)) return fallback; if (!isFinite(Number(value)) || Number(value) < 1) throw new Error("invalid-budget"); return Math.min(max, Math.floor(Number(value))) }
  var graphLimit = function(value, fallback, max) { if (isUnDef(value)) return fallback; if (!isFinite(Number(value)) || Number(value) < 0 || Math.floor(Number(value)) !== Number(value)) throw new Error("invalid-graph-budget"); return Math.min(max, Number(value)) }
  var budget
  try { budget = { maxCandidates: finite(opts.maxCandidates, 32, 512), maxQueries: finite(opts.maxQueries, 16, 64), maxInspected: finite(opts.maxInspected, 32, 512), maxBytes: finite(opts.maxBytes, 16000, 64000), maxMillis: finite(opts.maxMillis, this.config.maxMillis, this.config.maxMillis), maxGraphExpansion: opts.expandGraph === true ? graphLimit(opts.maxGraphExpansion, 5, 10) : 0, maxGraphEdges: opts.expandGraph === true ? graphLimit(opts.maxGraphEdges, 256, 4096) : 0 } } catch(e) { return { ok: false, error: String(e) } }
  var used = { queries: 0, candidates: 0, inspected: 0, materializedPassages: 0, bytes: 0, graphExpansion: 0, graphEdges: 0 }, deadline = evaluationTime + budget.maxMillis, vector = {}, sources = [], candidates = [], pins = [], stopReasons = [], stages = ["validate"], self = this
  var elapsed = function(at) { return Math.max(0,(Number(java.lang.System.nanoTime())-at)/1000000) }
  var timings = { validation: elapsed(started), pin: 0, search: 0, rank: 0, candidateOrdering: 0, evidenceSelection: 0, citationDecoration: 0 }
  var graphSources = []
  var packingMillis = 0, packingExecuted = false, presentationMillis = 0, presentationExecuted = false
  var measure = function(stage, fn) {
    var at = Number(java.lang.System.nanoTime())
    try { return fn() } finally {
      if (stage === "envelopePacking") { packingMillis += elapsed(at); packingExecuted = true }
      else if (stage === "contextPresentation") { presentationMillis += elapsed(at); presentationExecuted = true }
      else timings[stage] += elapsed(at)
    }
  }
  try {
    for (var i = 0; i < selection.targets.length; i++) {
      var target = selection.targets[i], remaining = budget.maxCandidates - used.candidates, source = { wiki: target.name, status: "omitted", candidates: 0 }
      sources.push(source)
      if (remaining < 1 || used.queries >= budget.maxQueries || new Date().getTime() >= deadline) { source.reason = "budget"; if (stopReasons.indexOf("budget") < 0) stopReasons.push("budget"); continue }
      var engine = target.manager._retrievalV2
      if (!engine) { source.status = "unavailable"; source.reason = "v2-build-required"; continue }
      if (engine.capabilityError) { source.status = "unavailable"; source.reason = engine.capabilityError.substring(0,160); continue }
      var pin
      try {
        if (stages.indexOf("pin") < 0) stages.push("pin")
        pin = measure("pin", function() { return engine.acquire(deadline) }); pins.push({ engine: engine, snapshot: pin }); vector[target.name] = pin.generation
        var allocation = Math.max(1, Math.floor(remaining / (selection.targets.length - i))), pending = engine._pending(), permissions = {}
        used.queries++
        if (stages.indexOf("search") < 0) stages.push("search")
        var queryRequest = {pending:pending,permissions:permissions,deadline:deadline,options:opts,used:used}, found
        try {
          found = measure("search", function() { return engine._query(pin, query, allocation, Math.max(0, budget.maxQueries - used.queries - (selection.targets.length - i - 1)), queryRequest) })
        } catch(firstUseFailure) {
          var firstUseReason = __miniAErrMsg(firstUseFailure)
          // A structural cold open may discover a corrupt selected shard only
          // while resolving a hit. Re-run the complete Lucene/query binding on
          // the already-published predecessor; never mix generations.
          if (!/^(catalogue-(?:shard-)?integrity-failure|invalid-catalogue|generation-integrity-failure|generation-record-missing|generation-index-text-mismatch)/.test(firstUseReason)) throw firstUseFailure
          if (used.queries >= budget.maxQueries || Date.now() >= deadline) throw new Error("query-budget-exhausted")
          used.queries++
          engine.release(pin); pins.pop()
          pin = measure("pin", function(){ return engine.acquire(deadline,true) })
          pins.push({ engine: engine, snapshot: pin }); vector[target.name] = pin.generation
          found = measure("search", function() { return engine._query(pin, query, allocation, Math.max(0, budget.maxQueries - used.queries - (selection.targets.length - i - 1)), queryRequest) })
          source.recoveredPointer = true
        }
        source.status = "searched"; source.expansions = found.expansions; source.candidates = found.hits.length
        source.routes = found.routes; source.omittedRoutes = found.omittedRoutes; source.feedbackCandidates = found.seedCount
        source.analyzer = engine.manager._lexicalConfig.language
        source.passageChars = pin.manifest.passageChars
        source.requestedRoutes = ["shingles","ngrams","queryExpansion","pseudoRelevanceFeedback"].filter(function(key){return engine.manager._lexicalConfig[key] === true})
        if (engine.manager._lexicalConfig.synonyms.length) source.requestedRoutes.push("synonyms")
        if (found.omittedRoutes.length) { source.status = "partial"; source.reason = "query-budget"; stopReasons.push("query-budget") }
        if (found.totalHits > found.hits.length) { source.candidateLimitReached = true; source.status = "partial"; source.reason = "candidate-budget"; stopReasons.push("candidate-budget") }
        used.candidates += found.hits.length
        graphSources.push({engine:engine,pin:pin,target:target,source:source,pending:pending,permissions:permissions})
        found.hits.forEach(function(hit) {
          if (new Date().getTime() >= deadline) { source.status = "partial"; source.reason = "inspection-budget"; stopReasons.push("inspection-budget"); return }
          used.materializedPassages++
          hit.page = engine.lookupPage(pin,hit.record.path)
          if (!engine._active(hit.page, pending, permissions, deadline, used, __, pin)) { source.status = "partial"; source.reason = "stale-or-pending-evidence"; stopReasons.push("stale-or-pending-evidence"); return }
          if (!engine._constraints(hit.page, opts)) return
          hit.expansions = found.expansions; hit.engine = engine; hit.snapshot = pin; hit.wiki = target.name; hit.path = target.name === "primary" ? hit.record.path : "@" + target.name + "/" + hit.record.path
          if (stages.indexOf("rank") < 0) stages.push("rank")
          candidates.push(measure("rank", function() { return engine._rank(hit, query) }))
        })
      } catch(e) { source.reason = __miniAErrMsg(e).substring(0, 160); source.status = source.reason === "invalid-query" ? "invalid-query" : source.reason === "query-budget-exhausted" ? "partial" : "unavailable"; stopReasons.push(source.status === "invalid-query" ? "invalid-query" : source.status === "partial" ? "query-budget" : "source-unavailable") }
    }
    if (budget.maxGraphExpansion > 0 && candidates.length) {
      stages.push("graph")
      this._expandGraph(candidates,graphSources,merge(opts,{query:query}),budget,used,deadline,stopReasons,measure)
    }
    measure("candidateOrdering", function() { candidates.sort(function(a,b) { return b.rankScore - a.rankScore || (a.path < b.path ? -1 : a.path > b.path ? 1 : a.record.charStart - b.record.charStart) }) })
    var complete = sources.every(function(s) { return s.status === "searched" })
    var out = { ok: true, query: query, effectiveMode: "passage-v2", outcome: complete ? candidates.length ? "hits" : "zero" : "partial", generations: vector, sources: sources, stages: stages, timings: { unit: "milliseconds", clock: "monotonic-System.nanoTime", measured: timings }, stopReasons: stopReasons.filter(function(r,i,a) { return a.indexOf(r) === i }), budget: { limits: budget, used: used } }
    if (sources.length && sources.every(function(source) { return source.status === "invalid-query" })) { out.ok = false; out.error = "invalid-query" }
    var result = materialize(candidates, out, deadline, measure)
    if (isFunction(present)) result = present(result, measure)
    // Public diagnostics may be omitted to preserve evidence under a small cap.
    // Keep the actual measured work independently for private accounting.
    var privateTimings = merge({}, timings)
    if (packingExecuted) privateTimings.envelopePacking = packingMillis
    if (presentationExecuted) privateTimings.contextPresentation = presentationMillis
    this._recordTelemetry(result, candidates.length, elapsed(started), { budget: out.budget, stopReasons: out.stopReasons, sources: out.sources, stages: out.stages, envelopePackingExecuted: packingExecuted, contextPresentationExecuted: presentationExecuted, timings: { measured: privateTimings } })
    return result
  } finally { pins.forEach(function(pin) { pin.engine.release(pin.snapshot) }) }
}
MiniAWikiRetrievalV2.prototype._authorised = function(hit) {
  if (hit.wiki === "primary") return !this.closed
  var mounted = this.manager._resolveMountPath(hit.path)
  return !!mounted && !!mounted.mount && mounted.mount.manager === hit.engine.manager && !hit.engine.closed
}
MiniAWikiRetrievalV2.prototype._reference = function(hit) {
  return { wiki: hit.wiki, wikiId: hit.record.wikiId, page: hit.path, revision: hit.record.revision, passageId: hit.record.passageId, generation: hit.snapshot.generation, startLine: hit.record.startLine, endLine: hit.record.endLine, charStart: hit.record.charStart, charEnd: hit.record.charEnd, positionConvention: "raw-1-based-inclusive-lines;utf16-character-offsets" }
}
MiniAWikiRetrievalV2.prototype.search = function(query, options) {
  var self = this, opts = isMap(options) ? options : {}, limit = Math.min(100, Math.max(1, Number(opts.limit) || 8))
  return this._collect(query, opts, function(candidates, out, deadline, measure) {
    var seen = {}, results = []
    candidates.forEach(function(hit) {
      if (results.length >= limit || seen[hit.path] || !self._authorised(hit)) return
      // Permission can change after candidate discovery. Recheck immediately
      // before indexed title/description and passage metadata are disclosed.
      var stillActive = false
      try { stillActive = self._graphActive(hit,deadline,out.budget.used) && hit.engine._active(hit.page, hit.engine._pending(), __, deadline, out.budget.used, __, hit.snapshot) } catch(permissionFailure) {}
      if (!stillActive) {
        out.outcome = "partial"
        if (out.stopReasons.indexOf("stale-or-revoked-evidence") < 0) out.stopReasons.push("stale-or-revoked-evidence")
        out.sources.forEach(function(source) {if (source.wiki === hit.wiki) {source.status = "partial";source.reason = "stale-or-revoked-evidence"}})
        return
      }
      seen[hit.path] = true
      var result = { path: hit.path, ref: self.manager._agenticRef(hit.path), wiki: hit.wiki, title: String(hit.page.title).substring(0, 512), description: String(hit.page.description).substring(0, 256), summary: String(hit.page.description).substring(0, 256), nativeScore: hit.nativeScore, rankScore: hit.rankScore, score: hit.rankScore, scoreComponents: hit.scoreComponents, retrievalMethod: hit.retrievalMethod, passage: self._reference(hit) }
      if (isNumber(opts.evidenceChars) && opts.evidenceChars > 0) {
        var selected = MiniAWikiRetrievalV2.window(hit.text, query, opts.evidenceChars, opts.evidenceLines)
        result.passage.charStart += selected.start; result.passage.charEnd = hit.record.charStart + selected.end
        result.passage.startLine += (hit.text.substring(0,selected.start).match(/\n/g)||[]).length
        result.passage.endLine = result.passage.startLine + (selected.text.replace(/\n$/,"").match(/\n/g)||[]).length
      }
      if (opts.__wikiSuppressSource !== true) {
        if (out.stages.indexOf("cite") < 0) out.stages.push("cite")
        measure("citationDecoration", function() { self.manager._decorateEntry(result) })
      }
      results.push(result)
    })
    if (opts.__wikiSuppressSource !== true && results.length) measure("citationDecoration", function() { self.manager._applyInlineSource(results, "description") })
    results.forEach(function(r) { r.summary = r.description })
    out.results = results; out.truncated = out.outcome === "partial" || candidates.length > results.length
    return measure("envelopePacking", function() { return self._packSearch(out) })
  })
}
MiniAWikiRetrievalV2.prototype._packSearch = function(out) {
  var size = function() {
    for (var account = 0; account < 4; account++) out.budget.used.bytes = MiniAWikiRetrievalV2.bytes(stringify(out, __, ""))
    return MiniAWikiRetrievalV2.bytes(stringify(out, __, ""))
  }
  // Preserve the highest-ranked complete candidates and their source diagnostics.
  // A large result set must not turn a successful search into a total failure.
  while (size() > out.budget.limits.maxBytes && out.results.length > 0) {
    out.results.pop()
    out.outcome = "partial"; out.truncated = true
    if (out.stopReasons.indexOf("output-budget") < 0) out.stopReasons.push("output-budget")
  }
  if (size() > out.budget.limits.maxBytes) return { ok: false, error: "output-budget-too-small" }
  return out
}
// A bounded query-centred raw view. Offsets are relative UTF-16 positions; it
// never normalises or reconstructs source text.
MiniAWikiRetrievalV2.window = function(text, query, size, maxLines) {
  text = String(text); size = Math.max(0, Math.min(text.length, Math.floor(size)))
  var lower = text.toLowerCase(), anchor = lower.indexOf(String(query).toLowerCase())
  if (anchor < 0) {
    var terms = MiniAWikiRetrievalV2.terms(query).sort(function(a,b) { return b.length-a.length })
    for (var i=0;i<terms.length;i++) { anchor=lower.indexOf(terms[i]); if(anchor>=0)break }
  }
  if (anchor < 0) anchor = 0
  var start = Math.max(0, Math.min(text.length-size,anchor-Math.floor(size/3))), end = start+size
  if (isNumber(maxLines) && maxLines > 0) {
    var lineStarts = [start], cursor = start, newline
    while ((newline = text.indexOf("\n", cursor)) >= 0 && newline < end) { lineStarts.push(newline + 1); cursor = newline + 1 }
    var anchorLine = 0
    while (anchorLine + 1 < lineStarts.length && lineStarts[anchorLine + 1] <= anchor) anchorLine++
    var firstLine = Math.max(0, Math.min(lineStarts.length - Math.floor(maxLines), anchorLine - Math.floor(maxLines / 3)))
    start = lineStarts[firstLine]
    if (firstLine + Math.floor(maxLines) < lineStarts.length) end = lineStarts[firstLine + Math.floor(maxLines)] - 1
  }
  if (/[\uDC00-\uDFFF]/.test(text.charAt(start))) start++
  if (/[\uD800-\uDBFF]/.test(text.charAt(end-1))) end--
  return { start: start, end: Math.max(start,end), text: text.substring(start,Math.max(start,end)) }
}
MiniAWikiRetrievalV2.prototype._clipEvidence = function(record, window, query, chars) {
  var selected = MiniAWikiRetrievalV2.window(window.text, query, chars)
  record.content = selected.text; record.charStart = window.charStart + selected.start; record.charEnd = window.charStart + selected.end
  record.lineStart = window.startLine + (window.text.substring(0,selected.start).match(/\n/g)||[]).length
  record.lineEnd = record.lineStart + (record.content.replace(/\n$/,"").match(/\n/g)||[]).length
  record.passage.charStart = record.charStart; record.passage.charEnd = record.charEnd; record.passage.startLine = record.lineStart; record.passage.endLine = record.lineEnd
  delete record.next; delete record.before
  if(record.charEnd<window.charEnd)record.next={path:record.ref,revision:record.revision,charStart:record.charEnd,charEnd:window.charEnd,maxChars:8000}
  if(record.structure&&record.charEnd<record.structure.charEnd)record.next={path:record.ref,revision:record.revision,charStart:record.charEnd,charEnd:record.structure.charEnd,maxChars:8000,reason:"remaining-structure"}
  if(record.charStart>window.charStart)record.before={path:record.ref,revision:record.revision,charStart:window.charStart,charEnd:record.charStart,maxChars:8000,reason:"omitted-prefix-output-budget"}
  delete record[this.manager._sourceField]; delete record.citation
  this.manager._decorateEntry(record,{section:window.headingId,lineStart:record.lineStart,lineEnd:record.lineEnd,startLine:record.lineStart,endLine:record.lineEnd,revision:record.revision})
  if(record[this.manager._sourceField])record.citation=record[this.manager._sourceField]
}

MiniAWikiRetrievalV2.prototype.retrieve = function(query, options, present) {
  var opts = isMap(options) ? options : {}, self = this, limit = Math.min(64, Math.max(1, Number(opts.chunks || opts.wikicontextchunks || opts.maxInspected) || 5)), tokenLimit = Number(opts.tokens || opts.wikicontexttokens) > 0 ? Number(opts.tokens || opts.wikicontexttokens) : 4000
  return this._collect(query, opts, function(candidates, out, deadline, measure) {
    var evidence = [], citations = [], perPage = {}, seenText = {}, tokens = 0, bytes = 0, stop = [], windows = {}, inspectedBodies = {}, requestBodies = {}, requestContexts = {}, selectedSupport = {}
    var clip = function(record, window, query, chars) {
      if (out.stages.indexOf("cite") < 0) out.stages.push("cite")
      return measure("citationDecoration", function() { return self._clipEvidence(record, window, query, chars) })
    }
    out.stages.push("deduplicate", "select")
    measure("evidenceSelection", function() {
      // Relevance plus marginal query contribution, rather than one result per page.
      var pending = candidates.slice(), ordered = [], covered = {}, queryTerms = MiniAWikiRetrievalV2.terms(query)
      while (pending.length && ordered.length < 64 && new Date().getTime() < deadline) {
        var best = -1, utility = -Infinity, details
        pending.forEach(function(hit,index) {
          var text = hit.text.toLowerCase(), novelty = queryTerms.length ? 2 * queryTerms.filter(function(term) { return !covered[term] && text.indexOf(term) >= 0 }).length / queryTerms.length : 0
          var pagePenalty = Math.min(1.5, (perPage[hit.path] || 0) * 0.5)
          var duplicatePenalty = ordered.some(function(previous) { return previous.text.trim().toLowerCase() === text.trim() }) ? 1 : 0
          var score = hit.rankScore + novelty - pagePenalty - duplicatePenalty
          if (score > utility) { best=index; utility=score; details={novelQueryCoverage:novelty,pageConcentrationPenalty:pagePenalty,identicalTextPenalty:duplicatePenalty,utility:score} }
        })
        var next = pending.splice(best,1)[0]; next.selectionComponents=details; ordered.push(next); perPage[next.path]=(perPage[next.path]||0)+1
        queryTerms.forEach(function(term) { if(next.text.toLowerCase().indexOf(term)>=0)covered[term]=true })
      }
      if (pending.length && new Date().getTime() >= deadline) stop.push("deadline")
      ordered.forEach(function(hit) {
        if (evidence.length >= limit || new Date().getTime() >= deadline || !self._authorised(hit)) return
        var r = hit.record, raw, text, bodyKey = hit.engine.manager._instanceNonce + ":" + r.pageId + ":" + r.revision
        if (!inspectedBodies[bodyKey] && out.budget.used.inspected >= out.budget.limits.maxInspected) { stop.push("inspection-budget"); return }
        if (!inspectedBodies[bodyKey]) { inspectedBodies[bodyKey] = true; out.budget.used.inspected++ }
        try {
          if (!self._graphActive(hit,deadline,out.budget.used) || !hit.engine._active(hit.page, hit.engine._pending(), __, deadline, out.budget.used, __, hit.snapshot)) throw new Error("stale-or-revoked-evidence")
          if (!hit.engine.manager._archiveRoot && ["fs","s3fs","http"].indexOf(hit.engine.manager._backendType) >= 0 && r.textHash && sha1(hit.text) === r.textHash) {
            // The immutable generation validated these stored fields and positions.
            // Current source stat/access was checked above; no full page is needed.
            text = hit.text
            out.budget.used.indexedEvidencePassages = Number(out.budget.used.indexedEvidencePassages || 0) + 1
            hit.engine.manager._auditRetrieval("serving-index-passage", r.passageId, hit.path, true, MiniAWikiRetrievalV2.bytes(text), { operation: "read", protocol: "lucene-stored", totalMillis: 0 })
          } else {
            if (Object.prototype.hasOwnProperty.call(requestBodies, bodyKey)) raw = requestBodies[bodyKey]
            else { raw = hit.engine._body(hit.snapshot, hit.page, deadline, out.budget.used); requestBodies[bodyKey] = raw }
            text = raw.substring(r.charStart, r.charEnd)
          }
        } catch(e) { out.outcome = "partial"; var reason = __miniAErrMsg(e); stop.push(["stale-evidence","source-read-unavailable","request-deadline-exhausted","stale-or-revoked-evidence"].indexOf(reason) >= 0 ? reason : "evidence-read-failure"); return }
        var hash = sha1(text)
        var key = hit.path + ":" + r.pageId + ":" + r.revision + ":" + hash
        if (seenText[key]) return
        var record = { path: hit.path, ref: self.manager._agenticRef(hit.path), wiki: hit.wiki, title: hit.page.title, content: text, selectionComponents: hit.selectionComponents, lineStart: r.startLine, lineEnd: r.endLine, charStart: r.charStart, charEnd: r.charEnd, revision: r.revision, passage: self._reference(hit), origin: "wiki-page", applicability: clone(hit.page.metadata.applicability || {}), validity: isMap(hit.page.metadata.validity) ? clone(hit.page.metadata.validity) : null, nativeScore: hit.nativeScore, rankScore: hit.rankScore, score: hit.rankScore, scoreComponents: hit.scoreComponents, retrievalMethod: hit.retrievalMethod }
        var provenance = MiniAWikiRetrievalV2.trustedProvenance(hit.page.metadata)
        if (Object.keys(provenance).length) record.provenance = provenance
        var window = { text: text, charStart: r.charStart, charEnd: r.charEnd, startLine: r.startLine, headingId: r.headingId }
        windows[r.wikiId + ":" + r.passageId] = window
        if (r.structure) record.structure = clone(r.structure)
        clip(record, window, query, text.length)
        var pagePassages = {}; hit.page.passageIds.forEach(function(id){ pagePassages[id] = hit.engine.lookupPassage(hit.snapshot,id) })
        var requiredContexts = MiniAWikiRetrievalV2.supportRanges(hit.page, pagePassages, r, record.charStart, out.budget.used)
        if (requiredContexts.length) record.supportingContext = []
        requiredContexts.forEach(function(contextRange) {
          var supportStart = record.supportingContext.length, contextPosition = contextRange.charStart
          var contextKey = bodyKey + ":" + hit.path + ":" + contextRange.charStart + ":" + contextRange.charEnd
          if (Object.prototype.hasOwnProperty.call(requestContexts,contextKey)) {
            record.supportingContext=record.supportingContext.concat(clone(requestContexts[contextKey])); contextPosition=contextRange.charEnd
            out.budget.used.structuralContextCacheHits=Number(out.budget.used.structuralContextCacheHits||0)+1
            hit.engine.manager._auditRetrieval("request-context-cache",r.passageId,hit.path,true,0)
          } else {
          // Direct page posting, followed by bounded exact index lookups. No full
          // page body or unrelated corpus passage enumeration is needed.
          var contextPosting = MiniAWikiRetrievalV2.passageAt(hit.page, pagePassages, contextPosition, out.budget.used)
          hit.page.passageIds.slice(contextPosting, contextPosting + 8).some(function(id) {
            var context = pagePassages[id]
            out.budget.used.structuralContextLookupProbes = (Number(out.budget.used.structuralContextLookupProbes) || 0) + 1
            if (!context || context.charEnd <= contextPosition || context.charStart >= contextRange.charEnd) return false
            if (context.charStart > contextPosition || Date.now() >= deadline || out.budget.used.queries >= out.budget.limits.maxQueries || out.budget.used.candidates >= out.budget.limits.maxCandidates || record.supportingContext.length >= 8) return true
            out.budget.used.queries++; out.budget.used.candidates++; out.budget.used.materializedPassages++
            try {
              var L = Packages.org.apache.lucene, foundContext = hit.snapshot.searcher.search(new L.search.TermQuery(new L.index.Term("id", id)), 1)
              if (foundContext.scoreDocs.length !== 1) return true
              var contextDoc = hit.engine.manager._luceneStoredDoc(hit.snapshot.searcher,foundContext.scoreDocs[0].doc), contextText = String(contextDoc.get("text") || "")
              if (sha1(contextText) !== context.textHash) return true
              var end = Math.min(context.charEnd,contextRange.charEnd), selectedText = contextText.substring(contextPosition-context.charStart,end-context.charStart)
              var selectedLine = context.startLine + (contextText.substring(0,contextPosition-context.charStart).match(/\n/g)||[]).length
              var contextRecord = { path: hit.path, ref: record.ref, wiki: hit.wiki, revision: r.revision, origin: "wiki-page", role: contextRange.kind, content: selectedText, charStart: contextPosition, charEnd: end, lineStart: selectedLine, lineEnd: selectedLine + (selectedText.replace(/\n$/,"").match(/\n/g)||[]).length, passage: self._reference({wiki:hit.wiki,snapshot:hit.snapshot,path:hit.path,record:context}) }
              if (contextRange.kinds && contextRange.kinds.length > 1) contextRecord.roles = contextRange.kinds.slice()
              clip(contextRecord,{text:selectedText,charStart:contextPosition,charEnd:end,startLine:selectedLine,headingId:context.headingId},"",selectedText.length)
              record.supportingContext.push(contextRecord); contextPosition=end
              out.budget.used.structuralContextPassages=Number(out.budget.used.structuralContextPassages||0)+1
              hit.engine.manager._auditRetrieval("serving-index-context",id,hit.path,true,MiniAWikiRetrievalV2.bytes(selectedText))
            } catch(contextFailure) { return true }
            return contextPosition >= contextRange.charEnd
          })
          if (contextPosition >= contextRange.charEnd) requestContexts[contextKey]=clone(record.supportingContext.slice(supportStart))
          }
          if (contextPosition < contextRange.charEnd) {
            // Partial headers can mislabel columns. Return an explicit omission
            // instead of presenting an incomplete header as sufficient context.
            record.supportingContext = record.supportingContext.slice(0,supportStart); record.contextOmitted = "structural-context-budget-or-unavailable"
            stop.push(record.contextOmitted)
          }
        })
        // Earlier selected records are retained before later ones during final
        // packing. Reuse only their exact support ranges; different wiki aliases,
        // revisions and provenance remain distinct. Charge the reference wrapper.
        if (record.supportingContext) record.supportingContext = record.supportingContext.filter(function(context) {
          var supportKey = record.wiki + ":" + record.path + ":" + context.revision + ":" + context.charStart + ":" + context.charEnd
          if (!selectedSupport[supportKey]) return true
          if (!record.contextReferences) record.contextReferences = []
          record.contextReferences.push(clone(selectedSupport[supportKey]))
          out.budget.used.structuralSupportDuplicatesAvoided = Number(out.budget.used.structuralSupportDuplicatesAvoided || 0) + 1
          return false
        })
        var remainingBytes = out.budget.limits.maxBytes - bytes, remainingChars = Math.floor((tokenLimit - tokens) * 4)
        var originalText = text
        // Count JSON wrappers/citations too. Keep at least a progressing fragment.
        while ((MiniAWikiRetrievalV2.bytes(stringify(record, __, "")) > remainingBytes || stringify(record, __, "").length > remainingChars) && record.content.length) {
          var reduce = Math.max(1, Math.ceil(record.content.length / 8))
          clip(record, window, query, record.content.length - reduce)
          if (!record.content && record.supportingContext && record.supportingContext.length) {
            record.supportingContext = []; record.contextOmitted = "structural-context-output-budget"
            out.outcome = "partial"
            stop.push(record.contextOmitted); clip(record,window,query,text.length)
          }
        }
        if (!record.content) { stop.push("output-budget"); return }
        var cost = MiniAWikiRetrievalV2.bytes(stringify(record, __, "")), tokenCost = Math.ceil(stringify(record, __, "").length / 4)
        bytes += cost; tokens += tokenCost; seenText[key] = true; evidence.push(record)
        if (record.citation && citations.indexOf(record.citation) < 0) citations.push(record.citation)
        ;(record.supportingContext || []).forEach(function(context) {
          selectedSupport[record.wiki + ":" + record.path + ":" + context.revision + ":" + context.charStart + ":" + context.charEnd] = context.passage
          if (context.citation && citations.indexOf(context.citation) < 0) citations.push(context.citation)
        })
        if (record.content !== originalText) stop.push("output-budget")
      })
    })
    out.evidence = evidence; out.citations = citations; out.estimatedTokens = tokens; out.tokenEstimator = "utf16-characters-divided-by-four-ceiling"; out.budget.used.bytes = bytes; out.budget.used.estimatedTokens = tokens; out.budget.limits.tokens = tokenLimit
    out.stopReasons = out.stopReasons.concat(stop).filter(function(s,i,a) { return a.indexOf(s) === i }); out.truncated = out.outcome === "partial" || stop.length > 0 || evidence.length < candidates.length
    if (stop.indexOf("structural-context-budget-or-unavailable")>=0) out.outcome="partial"
    if (out.truncated && (out.outcome === "zero" || !evidence.length)) out.outcome = "partial"
    return measure("envelopePacking", function() { return self._packEvidence(out, windows, query, tokenLimit, clip) })
  }, present)
}

MiniAWikiRetrievalV2.prototype._packEvidence = function(out, windows, query, tokenLimit, clip) {
  var evidence = out.evidence
  // Final accounting includes the entire envelope, not just passage records.
  var serialized = stringify(out, __, ""), cap = out.budget.limits.maxBytes
  if ((MiniAWikiRetrievalV2.bytes(serialized) > cap || Math.ceil(serialized.length / 4) > tokenLimit) && evidence.length) {
    // Diagnostics are optional; do not discard the only useful quote merely
    // to retain timing fields. The private request record still has them.
    delete out.timings; out.timingsOmitted = "output-budget"
    serialized = stringify(out, __, "")
  }
  while ((MiniAWikiRetrievalV2.bytes(serialized) > cap || Math.ceil(serialized.length / 4) > tokenLimit) && evidence.length) {
    var last = evidence[evidence.length - 1], decrease = Math.max(1, Math.ceil(last.content.length / 4))
    clip(last, windows[last.passage.wikiId + ":" + last.passage.passageId], query, last.content.length - decrease)
    if (!last.content && last.supportingContext && last.supportingContext.length) {
      last.supportingContext=[]; last.contextOmitted="structural-context-output-budget"
      out.outcome = "partial"
      if (out.stopReasons.indexOf(last.contextOmitted)<0)out.stopReasons.push(last.contextOmitted)
      var retainedWindow=windows[last.passage.wikiId+":"+last.passage.passageId]
      clip(last,retainedWindow,query,retainedWindow.text.length)
    }
    if (!last.content) evidence.pop()
    var retainedCitations=[]
    evidence.forEach(function(e) { if(e.citation)retainedCitations.push(e.citation); (e.supportingContext||[]).forEach(function(context){if(context.citation)retainedCitations.push(context.citation)}) })
    out.citations = retainedCitations.filter(function(c,i,a) { return a.indexOf(c) === i })
    out.truncated = true
    if (out.stopReasons.indexOf("output-budget") < 0) out.stopReasons.push("output-budget")
    if (!evidence.length) out.outcome = "partial"
    serialized = stringify(out, __, "")
  }
  if (MiniAWikiRetrievalV2.bytes(serialized) > cap || Math.ceil(serialized.length / 4) > tokenLimit) return { ok: false, error: "output-budget-too-small", minimumEnvelopeBytes: MiniAWikiRetrievalV2.bytes(serialized) }
  // Deduplicate only after output clipping/removal: references must always
  // point to support text that actually survives in this response.
  var retainedSupport={}
  evidence.forEach(function(record) {
    if (!record.supportingContext) return
    record.supportingContext=record.supportingContext.filter(function(context) {
      var identity=record.wiki+":"+record.path+":"+context.revision+":"+context.charStart+":"+context.charEnd
      if (retainedSupport[identity]) {
        if (!record.contextReferences) record.contextReferences=[]
        record.contextReferences.push(clone(retainedSupport[identity])); return false
      }
      retainedSupport[identity]=context.passage; return true
    })
  })
  for (var account = 0; account < 4; account++) {
    out.budget.used.bytes = MiniAWikiRetrievalV2.bytes(stringify(out, __, ""))
    out.estimatedTokens = Math.ceil(stringify(out, __, "").length / 4); out.budget.used.estimatedTokens = out.estimatedTokens
  }
  if (MiniAWikiRetrievalV2.bytes(stringify(out, __, "")) > cap || Math.ceil(stringify(out, __, "").length / 4) > tokenLimit) return { ok: false, error: "output-budget-too-small" }
  return out
}
MiniAWikiRetrievalV2.prototype.assemble = function(query, options) {
  var self = this
  return this.retrieve(query, options, function(out, measure) {
    if (!out.ok) return out
    return measure("contextPresentation", function() { return self._presentContext(out) })
  })
}
MiniAWikiRetrievalV2.prototype._presentContext = function(out) {
  var query = out.query
  var context = { query: query, chunks: out.evidence.map(function(e) { var c = merge(e, { text: e.content, estimatedTokens: Math.ceil(e.content.length / 4) }); delete c.content; return c }), estimatedTokens: out.estimatedTokens, budget: out.budget.limits.tokens, requestBudget: out.budget, effectiveMode: out.effectiveMode, outcome: out.outcome, citations: out.citations, generations: out.generations, sources: out.sources, stages: out.stages, timings: out.timings, stopReasons: out.stopReasons, truncated: out.truncated, tokenEstimator: out.tokenEstimator }
  if (out.timingsOmitted) context.timingsOmitted = out.timingsOmitted
  for (var i = 0; i < 4; i++) { context.requestBudget.used.bytes = MiniAWikiRetrievalV2.bytes(stringify(context, __, "")); context.estimatedTokens = Math.ceil(stringify(context, __, "").length / 4); context.requestBudget.used.estimatedTokens = context.estimatedTokens }
  var serialized = stringify(context, __, "")
  if (MiniAWikiRetrievalV2.bytes(serialized) > out.budget.limits.maxBytes || Math.ceil(serialized.length / 4) > context.budget) return { ok: false, error: "context-presentation-budget" }
  return context
}
MiniAWikiRetrievalV2.prototype._validatePageMetadata = function(snapshot, page) {
  var self = this, key = "page-metadata:" + snapshot.dir + ":" + page.path
  if (this._guard(function() { return !!self.cache[key] && self.cache[key].page === page })) return
  if (!isMap(page) || page.path !== self.manager._normalizeRetrievalPath(page.path) || page.locator !== "blocks/" + page.revision + ".md" || !isArray(page.outline) || !isArray(page.links)) throw new Error("invalid-page-record")
  // Metadata comes from the selected immutable block even for bundle/remote
  // readers. Source permission/activity is checked by open before and after;
  // opening an outline does not fetch a candidate source Markdown body.
  var raw, started = Number(java.lang.System.nanoTime()), bytes = 0, verified = false
  try {
    var block = this.lookupBlockReference(snapshot,page.locator)
    raw = this._readVerifiedBlock(this._blockFile(snapshot.dir,snapshot.manifest,page.locator,block),block)
    bytes = MiniAWikiRetrievalV2.bytes(raw); verified = true
    this.metrics.validationBlockReads++; this.metrics.validationBlockBytes += bytes
  } finally {
    this.manager._auditRetrieval("serving-block",page.locator,page.path,verified,bytes,{operation:"read",protocol:"file",totalMillis:Math.max(0,(Number(java.lang.System.nanoTime())-started)/1000000)})
  }
  var positions = MiniAWikiRetrievalV2.positions(raw)
  if (sha1(raw) !== page.revision || raw.length !== page.charLength || positions.lines.length !== page.linesTotal) throw new Error("page-revision-binding-failure")
  var parsed = MiniAWikiRetrievalV2.parse(page.path,raw,snapshot.manifest.passageChars,true,positions)
  var metadata = af.fromJson(stringify(self.manager.parseFrontmatter(raw).meta,__,""))
  if (stringify(parsed.outline,__,"") !== stringify(page.outline,__,"") || stringify(metadata,__,"") !== stringify(page.metadata,__,"") || page.title !== (metadata.title || page.path) || page.description !== (metadata.description || "")) throw new Error("page-metadata-binding-failure")
  this._guard(function() { self._cachePut(key,{page:page},MiniAWikiRetrievalV2.bytes(key + stringify(page,__,""))) })
}
MiniAWikiRetrievalV2.prototype.open = function(path, options) {
  var snapshot, self = this
  try {
    snapshot = this.acquire(); var page = this.lookupPage(snapshot,path)
    if (!page) return { path: path, error: "page-not-found" }
    if (page.path !== path) throw new Error("invalid-page-record")
    if (!this._active(page, this._pending(), __, __, __, __, snapshot)) return { path: path, error: "stale-evidence", restart: true }
    this._validatePageMetadata(snapshot,page)
    if (!this._active(page, this._pending(), __, __, __, __, snapshot)) return { path: path, error: "stale-evidence", restart: true }
    var limit = Math.min(100, Math.max(1, Number(options && options.maxHeadings) || 40))
    return { path: path, ref: this.manager._agenticRef(path), title: page.title, description: page.description, revision: page.revision, generation: snapshot.generation, frontmatter: clone(page.metadata), headings: clone(page.outline.slice(0, limit)), headingsTruncated: page.outline.length > limit, links: page.links.map(function(l) { return l.resolved }), size: page.stamp.size }
  } catch(e) { return { path: path, error: __miniAErrMsg(e) } }
  finally { if (snapshot) this.release(snapshot) }
}
MiniAWikiRetrievalV2.prototype.backlinks = function(path) {
  var snapshot
  try {
    snapshot = this.acquire(); var pending = this._pending(), self = this
    var root = ["fs", "s3fs"].indexOf(this.manager._backendType) >= 0 && !this.manager._archiveRoot ? String(new java.io.File(this.manager._backend.root).getCanonicalPath()) : __
    var links = this.lookupBacklinks(snapshot,path).filter(function(link) {
      if (!isMap(link.stamp) || !isString(link.path) || !isArray(link.links)) throw new Error("reindex-required")
      return self._active({path:link.path,stamp:link.stamp},pending,__,__,__,root,snapshot)
    })
    return { target: path, count: links.length, backlinks: links.map(function(link) { return {path:link.path,title:link.title,links:clone(link.links)} }), generation: snapshot.generation }
  } catch(e) { return { target: path, error: __miniAErrMsg(e), backlinks: [], count: 0 } }
  finally { if (snapshot) this.release(snapshot) }
}
MiniAWikiRetrievalV2.prototype.maintenance = function(options) {
  var limit = Math.min(100, Math.max(1, Number(options && options.limit) || 25)), snapshot, findings = [], self = this, inspectedPages = 0, inspectedPassages = 0, exhausted = false
  try {
    snapshot = this.acquire()
    if (options && isDef(options.paths) && !isArray(options.paths)) throw new Error("invalid-maintenance-paths")
    if (options && isArray(options.paths) && options.paths.length > 100) exhausted = true
    var paths = options && isArray(options.paths) ? options.paths.slice(0, 100).map(function(path) { return self.manager._normalizeRetrievalPath(path) }) : Object.keys(snapshot.catalog.pages)
    var visited = {}
    paths.some(function(path) {
      if (visited[path] || !snapshot.catalog.pages[path]) return false
      visited[path] = true
      if (++inspectedPages > limit * 8) { exhausted = true; return true }
      var page = snapshot.catalog.pages[path]
      if (!page.outline.length) findings.push({ path: path, kind: "missing-heading", action: "propose", revision: page.revision })
      page.passageIds.some(function(id) { if (inspectedPassages >= limit * 16) { exhausted = true; return true }; inspectedPassages++; var p = snapshot.catalog.passages[id]; if (p.kind === "fragment" && findings.length < limit) findings.push({ path: path, kind: "oversized-structure", action: "propose", passageId: id, revision: p.revision }) })
      page.links.forEach(function(link) { if (/\.md$/.test(link.resolved) && !String(link.resolved).startsWith("@") && !snapshot.catalog.pages[link.resolved] && !self.manager._backend.exists(link.resolved) && findings.length < limit) findings.push({ path: path, kind: "broken-link", target: link.resolved, action: "propose", revision: page.revision }) })
      return exhausted || findings.length >= limit
    })
    var derivativeReport = isFunction(self.manager.knowledgeDerivativeCandidates) ? self.manager.knowledgeDerivativeCandidates({ limit: limit, paths: options && options.paths }, snapshot) : { ok: false, error: "knowledge-extension-unavailable", candidates: [] }
    var telemetry = self.telemetry
    if (!telemetry && toBoolean(self.manager._config.wikitelemetry) === true) { try { telemetry = af.fromJson(io.readFileString(self.manager._getIndexRoot() + "/.mini-a-wiki-state/telemetry.json")) } catch(ignoreTelemetry) {} }
    var weaknesses = []
    if (!(options && isDef(options.paths)) && isMap(telemetry) && self.config.telemetrySampleQueries === true && Date.now() - new Date(telemetry.started || telemetry.updated).getTime() <= self.config.telemetryRetentionDays * 86400000) {
      ;(isArray(telemetry.query_samples) ? telemetry.query_samples : []).slice(0,64).forEach(function(sample) { if (weaknesses.length < limit && isMap(sample) && Number(sample.count) >= 2) weaknesses.push({ kind: "repeated-zero-result-query", query: String(sample.query).substring(0,256), count: Number(sample.count), action: "review-aliases-or-coverage", resolution: "not-automated" }) })
    }
    var conflicts = self.manager.knowledgeConflictCandidates({ limit: limit, paths: options && options.paths }, snapshot)
    return { ok: true, mode: "report", knowledgeWeaknesses: weaknesses, conflicts: conflicts, derivatives: derivativeReport, modelCalls: 0, writes: 0, generation: snapshot.generation, candidates: findings.slice(0, limit), bounded: exhausted || findings.length >= limit, inspectedPages: inspectedPages, inspectedPassages: inspectedPassages }
  } catch(e) { return { ok: false, error: __miniAErrMsg(e), modelCalls: 0, writes: 0 } }
  finally { if (snapshot) this.release(snapshot) }
}
// Caller holds the bounded engine guard. Query and cursor telemetry share the
// same retention window, without treating a cursor restart as another search.
MiniAWikiRetrievalV2.prototype._prepareTelemetry = function(now) {
  var self = this
  if (!self.telemetry) {
    try { self.telemetry = af.fromJson(io.readFileString(self.manager._getIndexRoot() + "/.mini-a-wiki-state/telemetry.json")) } catch(ignore) {}
    if (!isMap(self.telemetry) || self.telemetry.version !== 1 || !self.telemetry.updated) self.telemetry = { version: 1, searches: 0, zero_results: 0, partial_results: 0, results: 0, total_millis: 0 }
  }
  var started = new Date(self.telemetry.started || self.telemetry.updated).getTime()
  if (!isFinite(started) || now - started > self.config.telemetryRetentionDays * 86400000) self.telemetry = { version: 1, started: new Date(now).toISOString(), searches: 0, zero_results: 0, partial_results: 0, results: 0, total_millis: 0 }
  if (!self.telemetry.started) self.telemetry.started = new Date(started).toISOString()
  if (self.config.telemetrySampleQueries !== true) delete self.telemetry.query_samples
}
MiniAWikiRetrievalV2.prototype._incrementTelemetryEvent = function(event) {
  if (["stale_reference_restarts", "revision_mismatch_requests", "generation_mismatch_requests", "evidence_rejected_requests"].indexOf(event) < 0) return
  if (!isMap(this.telemetry.events)) this.telemetry.events = {}
  this.telemetry.events[event] = (Number(this.telemetry.events[event]) || 0) + 1
  return true
}
MiniAWikiRetrievalV2.prototype._recordEvent = function(event) {
  if (toBoolean(this.manager._config.wikitelemetry) !== true || this.manager._access !== "rw") return
  var self = this
  try { this._guard(function() {
    var now = Date.now(); self._prepareTelemetry(now)
    if (!self._incrementTelemetryEvent(event)) return
    self.telemetry.updated = new Date(now).toISOString(); self.telemetryPending = (self.telemetryPending || 0) + 1
    if (self.telemetryPending >= self.config.telemetryFlushQueries) self._flushTelemetry()
  }) } catch(e) { try { self.manager._logFn("warn", "[wiki] event telemetry unavailable") } catch(ignoreLog) {} }
}
MiniAWikiRetrievalV2.prototype._recordRestrictedTelemetry = function(operation, outcome, millis, outputBytes) {
  if (toBoolean(this.manager._config.wikitelemetry) !== true || ["search","read"].indexOf(operation) < 0 || ["success","zero","incomplete","rejected","quota","invalid_reference","unavailable","error"].indexOf(outcome) < 0) return
  var self = this
  try { this._guard(function() {
    var now = Date.now(); self._prepareTelemetry(now)
    if (!isMap(self.telemetry.restricted)) self.telemetry.restricted = {}
    var key = operation + "_" + outcome
    self.telemetry.restricted[key] = (Number(self.telemetry.restricted[key]) || 0) + 1
    self.telemetry.restricted.total_millis = (Number(self.telemetry.restricted.total_millis) || 0) + (isFinite(millis) && millis >= 0 ? millis : 0)
    self.telemetry.restricted.output_bytes = (Number(self.telemetry.restricted.output_bytes) || 0) + (isFinite(outputBytes) && outputBytes >= 0 ? outputBytes : 0)
    self.telemetry.updated = new Date(now).toISOString()
    if (self.manager._access === "rw") {
      self.telemetryPending = (self.telemetryPending || 0) + 1
      if (self.telemetryPending >= self.config.telemetryFlushQueries) self._flushTelemetry()
    }
  }) } catch(ignoreTelemetry) {}
}
MiniAWikiRetrievalV2.prototype._recordTelemetry = function(result, count, millis, requestRecord) {
  if (toBoolean(this.manager._config.wikitelemetry) !== true || this.manager._access !== "rw") return
  var self = this
  try { this._guard(function() {
    var now = Date.now(); self._prepareTelemetry(now)
    if (self.config.telemetrySampleQueries === true && result.outcome === "zero" && isString(result.query)) {
      var samples = isArray(self.telemetry.query_samples) ? self.telemetry.query_samples : [], text = result.query.substring(0, 256), matched = false
      samples.forEach(function(sample) { if (sample.query === text) { sample.count++; sample.at = now; matched = true } })
      if (!matched) { if (samples.length >= 64) samples.shift(); samples.push({ query: text, count: 1, at: now }) }
      self.telemetry.query_samples = samples
    }
    self.telemetry.searches = (Number(self.telemetry.searches) || 0) + 1; self.telemetry.results = (Number(self.telemetry.results) || 0) + count; self.telemetry.total_millis = (Number(self.telemetry.total_millis) || 0) + millis
    var selected = isArray(result.evidence) ? result.evidence.length : isArray(result.results) ? result.results.length : isArray(result.chunks) ? result.chunks.length : 0
    self.telemetry.selected_records = (Number(self.telemetry.selected_records) || 0) + selected
    var accounting=isMap(requestRecord)?requestRecord:result, requestUsed=accounting.budget&&accounting.budget.used
    var reasons = isArray(accounting.stopReasons) ? accounting.stopReasons : [], sources = isArray(accounting.sources) ? accounting.sources : []
    if (reasons.indexOf("stale-evidence") >= 0) self._incrementTelemetryEvent("revision_mismatch_requests")
    if (reasons.indexOf("stale-or-revoked-evidence") >= 0 || sources.some(function(source) { return source.reason === "stale-or-pending-evidence" })) self._incrementTelemetryEvent("evidence_rejected_requests")
    if (sources.some(function(source) { return /^(generation-(index-(text-mismatch|count-mismatch)|evidence-probe-failed|record-missing)|passage-revision-binding-failure|page-revision-binding-failure)$/.test(String(source.reason || "")) })) self._incrementTelemetryEvent("generation_mismatch_requests")
    if(isMap(requestUsed)) {
      if(!isMap(self.telemetry.request_work))self.telemetry.request_work={}
      ;["queries","candidates","inspected","materializedPassages","indexedEvidencePassages","structuralContextPassages","structuralContextCacheHits","structuralContextLookupProbes","graphExpansion","graphEdges","backendReadCalls","backendExistsCalls","backendReadBytes","backendReadMillis","backendExistsMillis","backendFailures"].forEach(function(key){
        var amount=Number(requestUsed[key])
        if(isFinite(amount)&&amount>=0)self.telemetry.request_work[key]=(Number(self.telemetry.request_work[key])||0)+amount
      })
    }
    self.telemetry.output_bytes = (Number(self.telemetry.output_bytes) || 0) + MiniAWikiRetrievalV2.bytes(stringify(result, __, ""))
    if (isFinite(Number(result.estimatedTokens))) {
      self.telemetry.estimated_tokens = (Number(self.telemetry.estimated_tokens) || 0) + Number(result.estimatedTokens)
      self.telemetry.token_estimator = "utf16-characters-divided-by-four-ceiling"
    }
    if (!isMap(self.telemetry.stage_counts)) self.telemetry.stage_counts = {}
    if (!isMap(self.telemetry.stage_millis)) self.telemetry.stage_millis = {}
    if (isMap(accounting.timings) && isMap(accounting.timings.measured)) ["validation", "pin", "search", "rank", "candidateOrdering", "evidenceSelection", "citationDecoration", "envelopePacking", "contextPresentation"].forEach(function(stage) {
      var duration = Number(accounting.timings.measured[stage])
      if (isFinite(duration) && duration >= 0) self.telemetry.stage_millis[stage] = (Number(self.telemetry.stage_millis[stage]) || 0) + duration
    })
    if (accounting.envelopePackingExecuted === true) self.telemetry.stage_counts.envelopePacking = (Number(self.telemetry.stage_counts.envelopePacking) || 0) + 1
    if (accounting.contextPresentationExecuted === true) self.telemetry.stage_counts.contextPresentation = (Number(self.telemetry.stage_counts.contextPresentation) || 0) + 1
    ;["validate", "pin", "search", "rank", "deduplicate", "select", "cite"].forEach(function(stage) {
      if (isArray(accounting.stages) && accounting.stages.indexOf(stage) >= 0) self.telemetry.stage_counts[stage] = (Number(self.telemetry.stage_counts[stage]) || 0) + 1
    })
    if (result.outcome === "zero") self.telemetry.zero_results++
    if (result.ok === false || result.outcome === "partial") self.telemetry.partial_results = (Number(self.telemetry.partial_results) || 0) + 1
    self.telemetry.updated = new Date().toISOString(); self.telemetryPending = (self.telemetryPending || 0) + 1
    if (self.telemetryPending >= self.config.telemetryFlushQueries) self._flushTelemetry()
  }) } catch(e) { try { this.manager._logFn("warn", "[wiki] retrieval telemetry unavailable") } catch(ignoreLog) {} }
}
MiniAWikiRetrievalV2.prototype._flushTelemetry = function() {
  if (!this.telemetryPending) return
  try {
    var dir = this.manager._getIndexRoot() + "/.mini-a-wiki-state"; io.mkdir(dir)
    this.telemetry.reader_opens = this.metrics.readerOpens; this.telemetry.body_reads = this.metrics.bodyReads; this.telemetry.bytes_read = this.metrics.bytesRead; this.telemetry.cache_hits = this.metrics.cacheHits; this.telemetry.cache_misses = this.metrics.cacheMisses
    this._atomic(dir + "/telemetry.json", this.telemetry); this.telemetryPending = 0
  } catch(e) { try { this.manager._logFn("warn", "[wiki] retrieval telemetry not persisted") } catch(ignoreLog) {} }
}
// Export materializes each selected closure as an independent schema-3 base.
// The resulting archive never depends on an ancestor generation or .blocks.
MiniAWikiRetrievalV2.prototype._bundleBase = function(manifest, catalog) {
  if (!manifest || manifest.schema !== 3 || !catalog) throw new Error("bundle-schema3-required")
  var self = this, maps = ["pages","passages","reverseLinks","moveReverse","blockRefs"], shards = {}, texts = {}, bundleCatalog = clone(catalog)
  Object.keys(bundleCatalog.blockRefs || {}).forEach(function(locator) { bundleCatalog.blockRefs[locator].storage = "generation";bundleCatalog.blockRefs[locator].ownerGeneration=manifest.generation })
  maps.forEach(function(name) {
    var grouped = {}; shards[name] = {}
    Object.keys(bundleCatalog[name] || {}).forEach(function(key) { var shard = self._catalogueShard(key); if (!grouped[shard]) grouped[shard] = {}; grouped[shard][key] = bundleCatalog[name][key] })
    Object.keys(grouped).sort().forEach(function(shard) {
      var path = "catalogue/" + name + "/" + shard + ".json", text = stringify({ schema:1, map:name, shard:shard, upsert:grouped[shard], tombstones:[] },__,"")
      texts[path] = text; shards[name][shard] = { path:path, bytes:MiniAWikiRetrievalV2.bytes(text), checksum:MiniAWikiRetrievalV2.digestText(text) }
    })
  })
  var base = clone(manifest)
  base.files = manifest.files.filter(function(file) { return /^index\//.test(file.path) }).map(function(file) { return clone(file) })
  maps.forEach(function(name) { Object.keys(shards[name]).forEach(function(shard) { base.files.push(clone(shards[name][shard])) }) })
  Object.keys(bundleCatalog.blockRefs || {}).sort().forEach(function(locator) { var record = bundleCatalog.blockRefs[locator]; base.files.push({path:locator,bytes:record.bytes,checksum:record.checksum}) })
  base.files.sort(function(a,b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0 })
  base.catalogue = { schema:3, transactionFormat:"routed-delta-v1", base:true, wikiId:bundleCatalog.wikiId, shards:shards, depth:0, stats:{pageCount:Object.keys(bundleCatalog.pages || {}).length,passageCount:Object.keys(bundleCatalog.passages || {}).length} }
  delete base.catalogue.parent; base.merkle = MiniAWikiRetrievalV2.manifestMerkle(base)
  return { manifest:base, texts:texts }
}
MiniAWikiRetrievalV2.prototype.exportBundle = function(destination) {
  var snapshot, zip, output, temporary = String(destination) + ".tmp-" + java.util.UUID.randomUUID(), self = this
  try {
    if (this.manager._knowledgeJournalPending && this.manager._knowledgeJournalPending()) throw new Error("ingest-pending")
    if (!isString(destination) || !destination.trim().length || destination.length > 4096) throw new Error("invalid-bundle-destination")
    snapshot = this.acquire()
    var target = new java.io.File(destination).getCanonicalFile()
    if (target.exists() && !target.isFile()) throw new Error("invalid-bundle-destination")
    output = new java.io.FileOutputStream(temporary); zip = new java.util.zip.ZipOutputStream(output)
    var prefix = ".mini-a-wiki-serving/", buffer = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 65536), activeBundle = this._bundleBase(snapshot.manifest, snapshot.catalog)
    var pointer = stringify({ schema: 1, generation: snapshot.generation, checksum: MiniAWikiRetrievalV2.digestText(stringify(activeBundle.manifest, __, "")) }, __, "")
    zip.putNextEntry(new java.util.zip.ZipEntry(prefix + "current.json")); zip.write(new java.lang.String(pointer).getBytes("UTF-8")); zip.closeEntry()
    var generations = [{ generation: snapshot.generation, dir: snapshot.dir, manifest: snapshot.manifest, bundle:activeBundle }], previousPath = this.root + "/previous.json"
    // A published bundle must retain the same bounded read-recovery contract as
    // its local source. Validate the predecessor before exposing it remotely.
    if (io.fileExists(previousPath)) {
      if (java.nio.file.Files.isSymbolicLink(new java.io.File(previousPath).toPath())) throw new Error("unsafe-generation-pointer")
      var previousPointer = af.fromJson(io.readFileString(previousPath))
      if (!previousPointer || previousPointer.schema !== 1 || !/^[a-f0-9-]{36}$/.test(previousPointer.generation)) throw new Error("invalid-generation-pointer")
      if (previousPointer.generation !== snapshot.generation) {
        var previousDir = this.root + "/" + previousPointer.generation, previousManifestPath = previousDir + "/manifest.json"
        if (java.nio.file.Files.isSymbolicLink(new java.io.File(previousDir).toPath()) || java.nio.file.Files.isSymbolicLink(new java.io.File(previousManifestPath).toPath()) || String(new java.io.File(previousDir).getCanonicalPath()).indexOf(String(new java.io.File(this.root).getCanonicalPath()) + "/") !== 0) throw new Error("unsafe-generation-path")
        if (MiniAWikiRetrievalV2.digest(previousManifestPath) !== previousPointer.checksum) throw new Error("generation-integrity-failure")
        var previousManifest = af.fromJson(io.readFileString(previousManifestPath))
        this._validate(previousDir, previousManifest)
        var previousCatalog = this._resolveCatalogue(previousDir, previousManifest)
        var previousBundle = this._bundleBase(previousManifest, previousCatalog)
        generations.push({ generation: previousPointer.generation, dir: previousDir, manifest: previousManifest, bundle:previousBundle })
        previousPointer.checksum = MiniAWikiRetrievalV2.digestText(stringify(previousBundle.manifest, __, ""))
        zip.putNextEntry(new java.util.zip.ZipEntry(prefix + "previous.json")); zip.write(new java.lang.String(stringify(previousPointer, __, "")).getBytes("UTF-8")); zip.closeEntry()
      }
    }
    var fileCount = 1
    generations.forEach(function(generation) {
      var records = generation.bundle.manifest.files
      zip.putNextEntry(new java.util.zip.ZipEntry(prefix + generation.generation + "/manifest.json")); zip.write(new java.lang.String(stringify(generation.bundle.manifest, __, "")).getBytes("UTF-8")); zip.closeEntry(); fileCount++
      records.forEach(function(record) {
        if (generation.bundle.texts[record.path]) { zip.putNextEntry(new java.util.zip.ZipEntry(prefix + generation.generation + "/" + record.path)); zip.write(new java.lang.String(generation.bundle.texts[record.path]).getBytes("UTF-8")); zip.closeEntry(); fileCount++; return }
        var path = /^blocks\//.test(record.path) ? self._blockFile(generation.dir, generation.manifest, record.path) : self._path(generation.dir, record.path)
        zip.putNextEntry(new java.util.zip.ZipEntry(prefix + generation.generation + "/" + record.path))
        var stream = new java.io.FileInputStream(path), n
        try { while ((n = stream.read(buffer)) !== -1) zip.write(buffer, 0, n) } finally { stream.close() }
        zip.closeEntry(); fileCount++
      })
    })
    zip.close(); zip = null; output = null
    java.nio.file.Files.move(new java.io.File(temporary).toPath(), target.toPath(), java.nio.file.StandardCopyOption.ATOMIC_MOVE, java.nio.file.StandardCopyOption.REPLACE_EXISTING)
    return { ok: true, generation: snapshot.generation, fallbackGeneration: generations.length > 1 ? generations[1].generation : __, files: fileCount + (generations.length > 1 ? 1 : 0), bytes: Number(target.length()) }
  } catch(e) { return { ok: false, error: __miniAErrMsg(e) } }
  finally { try { if (zip) zip.close(); else if (output) output.close() } catch(ignoreZip) {}; try { java.nio.file.Files.deleteIfExists(new java.io.File(temporary).toPath()) } catch(ignoreFile) {}; if (snapshot) this.release(snapshot) }
}

global.MiniAWikiRetrievalV2 = MiniAWikiRetrievalV2
