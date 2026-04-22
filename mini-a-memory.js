// Author: Nuno Aguiar
// License: Apache 2.0
// Description: Structured working memory manager for Mini-A runtime.

var MiniAMemoryManager = function(config, loggerFn) {
  this._logFn = isFunction(loggerFn) ? loggerFn : function() {}
  this._onEvent = function() {}
  this.configure(config)
  this._memory = this._createEmptyMemory()
}

MiniAMemoryManager.prototype.configure = function(config) {
  var cfg = isObject(config) ? config : {}
  if (isFunction(cfg.onEvent)) this._onEvent = cfg.onEvent
  this._config = {
    enabled          : toBoolean(cfg.enabled) !== false,
    maxPerSection    : isNumber(cfg.maxPerSection) ? Math.max(5, Math.round(cfg.maxPerSection)) : 80,
    maxTotalEntries  : isNumber(cfg.maxTotalEntries) ? Math.max(20, Math.round(cfg.maxTotalEntries)) : 500,
    compactEvery     : isNumber(cfg.compactEvery) ? Math.max(1, Math.round(cfg.compactEvery)) : 8,
    dedup            : toBoolean(cfg.dedup) !== false,
    debug            : toBoolean(cfg.debug) === true
  }
}

MiniAMemoryManager.prototype._emitEvent = function(type, payload) {
  if (!isFunction(this._onEvent)) return
  try {
    this._onEvent(type, isObject(payload) ? payload : {})
  } catch(ignoreMemoryEventErr) {}
}

MiniAMemoryManager.prototype._sections = function() {
  return ["facts", "evidence", "openQuestions", "hypotheses", "decisions", "artifacts", "risks", "summaries"]
}

MiniAMemoryManager.prototype._createEmptyMemory = function() {
  var nowIso = new Date().toISOString()
  var mem = {
    schemaVersion: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
    revision: 0,
    sections: {
      facts: [],
      evidence: [],
      openQuestions: [],
      hypotheses: [],
      decisions: [],
      artifacts: [],
      risks: [],
      summaries: []
    }
  }
  return mem
}

MiniAMemoryManager.prototype._normalizeEntry = function(entry, defaults) {
  var e = isObject(entry) ? merge({}, entry) : { value: entry }
  var nowIso = new Date().toISOString()
  var val = ""
  if (isString(e.value)) val = e.value.trim()
  else if (isDef(e.value)) val = String(e.value).trim()
  if (val.length === 0 && isString(e.text)) val = e.text.trim()
  if (val.length === 0 && isString(e.summary)) val = e.summary.trim()
  if (val.length === 0) val = "(empty)"

  var id = isString(e.id) && e.id.trim().length > 0 ? e.id.trim() : sha1(val + "::" + nowNano()).substring(0, 16)
  return {
    id         : id,
    value      : val,
    status     : isString(e.status) && e.status.length > 0 ? e.status : (defaults && defaults.status ? defaults.status : "active"),
    provenance : isObject(e.provenance) ? e.provenance : (isObject(defaults && defaults.provenance) ? defaults.provenance : {}),
    evidenceRefs: isArray(e.evidenceRefs) ? e.evidenceRefs.slice() : (isArray(defaults && defaults.evidenceRefs) ? defaults.evidenceRefs.slice() : []),
    tags       : isArray(e.tags) ? e.tags.slice() : [],
    createdAt   : isString(e.createdAt) ? e.createdAt : nowIso,
    updatedAt   : nowIso,
    confirmedAt : isString(e.confirmedAt) ? e.confirmedAt : nowIso,
    confirmCount: isNumber(e.confirmCount) && e.confirmCount > 0 ? e.confirmCount : 1,
    stale       : toBoolean(e.stale) === true,
    supersededBy: isString(e.supersededBy) ? e.supersededBy : __,
    unresolved  : toBoolean(e.unresolved) === true,
    meta        : isObject(e.meta) ? merge({}, e.meta) : {}
  }
}

MiniAMemoryManager.prototype._touch = function() {
  this._memory.updatedAt = new Date().toISOString()
  this._memory.revision = (this._memory.revision || 0) + 1
}

MiniAMemoryManager.prototype._fingerprint = function(text) {
  if (!isString(text)) text = String(text || "")
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
}

MiniAMemoryManager.prototype._isNearDuplicate = function(a, b) {
  var fa = this._fingerprint(a)
  var fb = this._fingerprint(b)
  if (fa.length === 0 || fb.length === 0) return false
  if (fa === fb) return true
  if (fa.length > 20 && fb.length > 20) {
    if (fa.indexOf(fb) >= 0 || fb.indexOf(fa) >= 0) return true
  }
  var aw = fa.split(" ")
  var bw = fb.split(" ")
  var seen = {}
  aw.forEach(function(w) { if (w.length > 2) seen[w] = true })
  var overlap = 0
  var denom = 0
  bw.forEach(function(w) {
    if (w.length <= 2) return
    denom++
    if (seen[w]) overlap++
  })
  if (denom === 0) return false
  return (overlap / denom) >= 0.85
}

MiniAMemoryManager.prototype.init = function(seedMemory) {
  this._memory = this._createEmptyMemory()
  if (!isObject(seedMemory)) return this.snapshot()

  var sections = this._sections()
  var srcSections = isObject(seedMemory.sections) ? seedMemory.sections : seedMemory
  for (var i = 0; i < sections.length; i++) {
    var section = sections[i]
    if (!isArray(srcSections[section])) continue
    for (var j = 0; j < srcSections[section].length; j++) {
      this.append(section, srcSections[section][j], { silent: true })
    }
  }
  this._touch()
  return this.snapshot()
}

MiniAMemoryManager.prototype.snapshot = function() {
  return jsonParse(stringify(this._memory, __, ""), __, __, true)
}

// Returns a compact representation for LLM consumption: only non-empty sections,
// entries with short field names, defaults omitted. Pairs with af.toTOON for max token savings.
MiniAMemoryManager.prototype.snapshotCompact = function() {
  var self = this
  var result = {}
  this._sections().forEach(function(section) {
    var list = self._getSection(section) || []
    if (list.length === 0) return
    result[section] = list.map(function(e) {
      var c = { id: e.id, v: e.value }
      if (isString(e.status) && e.status !== "active")   c.st   = e.status
      if (isObject(e.provenance)) {
        if (e.provenance.source) c.src = e.provenance.source
        if (e.provenance.event)  c.ev  = e.provenance.event
      }
      if (isArray(e.evidenceRefs) && e.evidenceRefs.length > 0) c.refs = e.evidenceRefs
      if (e.unresolved === true) c.u    = true
      if (e.stale      === true) c.stale = true
      if (isString(e.supersededBy))                             c.sup  = e.supersededBy
      return c
    })
  })
  return result
}

MiniAMemoryManager.prototype._getSection = function(name) {
  if (!isString(name)) return __
  if (!isArray(this._memory.sections[name])) return __
  return this._memory.sections[name]
}

MiniAMemoryManager.prototype.getSectionEntries = function(name) {
  var list = this._getSection(name)
  if (!isArray(list)) return []
  return jsonParse(stringify(list, __, ""), __, __, true)
}

MiniAMemoryManager.prototype.append = function(section, entry, options) {
  if (this._config.enabled !== true) return __
  var list = this._getSection(section)
  if (!isArray(list)) return __
  var opts = isObject(options) ? options : {}
  var beforeLength = list.length
  var normalized = this._normalizeEntry(entry, opts)

  if (this._config.dedup === true) {
    for (var i = list.length - 1; i >= 0; i--) {
      if (this._isNearDuplicate(list[i].value, normalized.value)) {
        list[i].updatedAt = new Date().toISOString()
        if (isArray(normalized.evidenceRefs) && normalized.evidenceRefs.length > 0) {
          list[i].evidenceRefs = (list[i].evidenceRefs || []).concat(normalized.evidenceRefs)
        }
        this._touch()
        this._emitEvent("dedup", { section: section, id: list[i].id, totalEntries: beforeLength })
        return list[i]
      }
    }
  }

  list.push(normalized)
  this._touch()
  this._boundedMaintenance(opts)
  this._emitEvent("append", { section: section, id: normalized.id, totalEntries: beforeLength + 1 })
  return normalized
}

MiniAMemoryManager.prototype.update = function(section, id, patch) {
  if (this._config.enabled !== true) return false
  var list = this._getSection(section)
  if (!isArray(list)) return false
  for (var i = 0; i < list.length; i++) {
    if (list[i].id !== id) continue
    var p = isObject(patch) ? patch : {}
    Object.keys(p).forEach(function(k) { list[i][k] = p[k] })
    list[i].updatedAt = new Date().toISOString()
    this._touch()
    return true
  }
  return false
}

MiniAMemoryManager.prototype.remove = function(section, id) {
  if (this._config.enabled !== true) return false
  var list = this._getSection(section)
  if (!isArray(list)) return false
  var before = list.length
  this._memory.sections[section] = list.filter(function(item) { return item.id !== id })
  if (this._memory.sections[section].length !== before) {
    this._touch()
    return true
  }
  return false
}

MiniAMemoryManager.prototype.mark = function(section, id, marker, value) {
  var patch = {}
  patch[marker] = isUnDef(value) ? true : value
  if (marker === "status" && value === "superseded") {
    patch.stale = true
  }
  return this.update(section, id, patch)
}

MiniAMemoryManager.prototype.attachEvidenceRef = function(section, id, evidenceId) {
  var list = this._getSection(section)
  if (!isArray(list)) return false
  for (var i = 0; i < list.length; i++) {
    if (list[i].id !== id) continue
    if (!isArray(list[i].evidenceRefs)) list[i].evidenceRefs = []
    if (list[i].evidenceRefs.indexOf(evidenceId) < 0) list[i].evidenceRefs.push(evidenceId)
    list[i].updatedAt = new Date().toISOString()
    this._touch()
    return true
  }
  return false
}

MiniAMemoryManager.prototype.findNearDuplicate = function(section, value) {
  var list = this._getSection(section)
  if (!isArray(list)) return __
  for (var i = list.length - 1; i >= 0; i--) {
    if (this._isNearDuplicate(list[i].value, value)) return list[i]
  }
  return __
}

MiniAMemoryManager.prototype.refresh = function(section, id) {
  var list = this._getSection(section)
  if (!isArray(list)) return false
  var nowIso = new Date().toISOString()
  for (var i = 0; i < list.length; i++) {
    if (list[i].id !== id) continue
    list[i].confirmedAt  = nowIso
    list[i].updatedAt    = nowIso
    list[i].confirmCount = (isNumber(list[i].confirmCount) ? list[i].confirmCount : 1) + 1
    list[i].stale        = false
    this._touch()
    return true
  }
  return false
}

MiniAMemoryManager.prototype.sweepStale = function(thresholdDays) {
  if (!isNumber(thresholdDays) || thresholdDays <= 0) return 0
  var thresholdMs = thresholdDays * 86400000
  var now = Date.now()
  var marked = 0
  var self = this
  this._sections().forEach(function(section) {
    var list = self._getSection(section) || []
    list.forEach(function(entry) {
      if (entry.stale === true) return
      var anchor = isString(entry.confirmedAt) ? entry.confirmedAt : (isString(entry.createdAt) ? entry.createdAt : null)
      if (!anchor) return
      if (now - new Date(anchor).getTime() > thresholdMs) {
        entry.stale = true
        marked++
      }
    })
  })
  if (marked > 0) self._touch()
  return marked
}

MiniAMemoryManager.prototype.clear = function() {
  this._memory = this._createEmptyMemory()
  this._touch()
  return true
}

MiniAMemoryManager.prototype._boundedMaintenance = function(options) {
  var opts = isObject(options) ? options : {}
  var rev = this._memory.revision || 0
  var shouldCompact = opts.forceCompact === true || (rev > 0 && (rev % this._config.compactEvery) === 0)
  if (shouldCompact) this.compact()
}

MiniAMemoryManager.prototype._priority = function(section) {
  var map = {
    decisions: 100,
    evidence: 90,
    risks: 80,
    facts: 70,
    summaries: 60,
    hypotheses: 50,
    openQuestions: 40,
    artifacts: 30
  }
  return map[section] || 10
}

MiniAMemoryManager.prototype.compact = function() {
  var self = this
  var sections = this._sections()
  var droppedEntries = 0
  var sectionDrops = {}

  sections.forEach(function(section) {
    var list = self._getSection(section) || []
    if (list.length <= self._config.maxPerSection) return
    list.sort(function(a, b) {
      var ast = (a.status === "active" ? 1 : 0) + (a.stale === true ? -1 : 0)
      var bst = (b.status === "active" ? 1 : 0) + (b.stale === true ? -1 : 0)
      if (ast !== bst) return bst - ast
      return String(b.updatedAt).localeCompare(String(a.updatedAt))
    })
    var kept = list.slice(0, self._config.maxPerSection)
    var dropped = list.slice(self._config.maxPerSection)
    self._memory.sections[section] = kept
    if (dropped.length > 0) {
      droppedEntries += dropped.length
      sectionDrops[section] = (sectionDrops[section] || 0) + dropped.length
      self._memory.sections.summaries.push(self._normalizeEntry({
        value: "Compacted " + dropped.length + " older " + section + " entr" + (dropped.length === 1 ? "y" : "ies"),
        status: "active",
        provenance: { source: "compaction", section: section }
      }, { silent: true }))
    }
  })

  var all = []
  sections.forEach(function(section) {
    var list = self._getSection(section) || []
    list.forEach(function(item) {
      all.push({ section: section, item: item, priority: self._priority(section) })
    })
  })

  if (all.length > this._config.maxTotalEntries) {
    all.sort(function(a, b) {
      if (a.priority !== b.priority) return b.priority - a.priority
      return String(b.item.updatedAt).localeCompare(String(a.item.updatedAt))
    })
    var allowed = all.slice(0, this._config.maxTotalEntries)
    var trimmedByTotal = Math.max(0, all.length - allowed.length)
    droppedEntries += trimmedByTotal
    var allowedById = {}
    allowed.forEach(function(e) { allowedById[e.item.id] = true })
    sections.forEach(function(section) {
      self._memory.sections[section] = (self._getSection(section) || []).filter(function(item) {
        return allowedById[item.id] === true
      })
    })
  }

  this._touch()
  this._emitEvent("compact", { droppedEntries: droppedEntries, sectionDrops: sectionDrops })
  return this.snapshot()
}

MiniAMemoryManager.prototype.saveToChannel = function(channelName, namespace) {
  if (this._config.enabled !== true) return false
  if (!isString(channelName) || channelName.length === 0) return false
  var ns = isString(namespace) && namespace.length > 0 ? namespace : ""
  try {
    var snap = this.snapshot()
    $ch(channelName).set({ section: "_meta", ns: ns }, {
      schemaVersion: snap.schemaVersion,
      revision     : snap.revision,
      createdAt    : snap.createdAt,
      updatedAt    : snap.updatedAt
    })
    var sections = this._sections()
    for (var i = 0; i < sections.length; i++) {
      $ch(channelName).set({ section: sections[i], ns: ns }, snap.sections[sections[i]] || [])
    }
    this._emitEvent("save", { channel: channelName, namespace: ns, ok: true })
    return true
  } catch(e) {
    this._emitEvent("save", { channel: channelName, namespace: ns, ok: false, error: String(e) })
    return false
  }
}

MiniAMemoryManager.prototype.loadFromChannel = function(channelName, namespace) {
  if (!isString(channelName) || channelName.length === 0) return false
  var ns = isString(namespace) && namespace.length > 0 ? namespace : ""
  try {
    var meta = $ch(channelName).get({ section: "_meta", ns: ns })
    if (!isObject(meta)) {
      this._emitEvent("load", { channel: channelName, namespace: ns, ok: false, reason: "missing-meta" })
      return false
    }
    var sections = this._sections()
    var seedData = { sections: {} }
    for (var i = 0; i < sections.length; i++) {
      var entries = $ch(channelName).get({ section: sections[i], ns: ns })
      seedData.sections[sections[i]] = isArray(entries) ? entries : []
    }
    this.init(seedData)
    if (isString(meta.createdAt)) this._memory.createdAt = meta.createdAt
    if (isNumber(meta.revision)) this._memory.revision = meta.revision
    this._emitEvent("load", { channel: channelName, namespace: ns, ok: true })
    return true
  } catch(e) {
    this._emitEvent("load", { channel: channelName, namespace: ns, ok: false, error: String(e) })
    return false
  }
}

MiniAMemoryManager.parseChannelKey = function(rawKey) {
  if (isMap(rawKey)) return rawKey
  if (!isString(rawKey)) return __
  var text = rawKey.trim()
  if (text.length === 0) return __
  var parsed = __
  try { parsed = jsonParse(text, __, __, true) } catch(ignoreJsonParse) {}
  if (!isMap(parsed)) {
    try { parsed = af.fromJSSLON(text) } catch(ignoreJSSLONParse) {}
  }
  return isMap(parsed) ? parsed : __
}

MiniAMemoryManager.listChannelNamespaces = function(channelName) {
  if (!isString(channelName) || channelName.length === 0) return []
  var keys = []
  try { keys = $ch(channelName).getKeys() } catch(ignoreGetKeys) { return [] }

  var namespaces = {}
  keys.forEach(function(rawKey) {
    var key = MiniAMemoryManager.parseChannelKey(rawKey)
    if (!isMap(key)) return
    var ns = isString(key.ns) ? key.ns.trim() : ""
    if (ns.length === 0) return
    if (!isObject(namespaces[ns])) namespaces[ns] = { namespace: ns, sections: {} }
    if (isString(key.section) && key.section.length > 0) namespaces[ns].sections[key.section] = true
  })

  return Object.keys(namespaces).sort().map(function(ns) {
    var meta = __
    try { meta = $ch(channelName).get({ section: "_meta", ns: ns }) } catch(ignoreMeta) {}
    return {
      namespace: ns,
      sections: Object.keys(namespaces[ns].sections).sort(),
      meta: isMap(meta) ? meta : __
    }
  })
}

MiniAMemoryManager.deleteChannelNamespace = function(channelName, namespace) {
  if (!isString(channelName) || channelName.length === 0) return 0
  var ns = isString(namespace) ? namespace.trim() : ""
  if (ns.length === 0) return 0
  var keys = []
  try { keys = $ch(channelName).getKeys() } catch(ignoreGetKeys) { return 0 }

  var deleted = 0
  keys.forEach(function(rawKey) {
    var key = MiniAMemoryManager.parseChannelKey(rawKey)
    if (!isMap(key)) return
    if ((isString(key.ns) ? key.ns.trim() : "") !== ns) return
    try {
      if (isFunction($ch(channelName).unset)) {
        if ($ch(channelName).unset(key) === true) deleted++
      } else if (isFunction($ch(channelName).set)) {
        $ch(channelName).set(key, __)
        deleted++
      }
    } catch(ignoreDelete) {}
  })
  return deleted
}
