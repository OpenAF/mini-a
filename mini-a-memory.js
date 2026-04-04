// Author: Nuno Aguiar
// License: Apache 2.0
// Description: Structured working memory manager for Mini-A runtime.

var MiniAMemoryManager = function(config, loggerFn) {
  this._logFn = isFunction(loggerFn) ? loggerFn : function() {}
  this.configure(config)
  this._memory = this._createEmptyMemory()
}

MiniAMemoryManager.prototype.configure = function(config) {
  var cfg = isObject(config) ? config : {}
  this._config = {
    enabled          : toBoolean(cfg.enabled) !== false,
    maxPerSection    : isNumber(cfg.maxPerSection) ? Math.max(5, Math.round(cfg.maxPerSection)) : 80,
    maxTotalEntries  : isNumber(cfg.maxTotalEntries) ? Math.max(20, Math.round(cfg.maxTotalEntries)) : 500,
    compactEvery     : isNumber(cfg.compactEvery) ? Math.max(1, Math.round(cfg.compactEvery)) : 8,
    dedup            : toBoolean(cfg.dedup) !== false,
    debug            : toBoolean(cfg.debug) === true
  }
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
    createdAt  : isString(e.createdAt) ? e.createdAt : nowIso,
    updatedAt  : nowIso,
    stale      : toBoolean(e.stale) === true,
    supersededBy: isString(e.supersededBy) ? e.supersededBy : __,
    unresolved : toBoolean(e.unresolved) === true,
    meta       : isObject(e.meta) ? merge({}, e.meta) : {}
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
  var normalized = this._normalizeEntry(entry, opts)

  if (this._config.dedup === true) {
    for (var i = list.length - 1; i >= 0; i--) {
      if (this._isNearDuplicate(list[i].value, normalized.value)) {
        list[i].updatedAt = new Date().toISOString()
        if (isArray(normalized.evidenceRefs) && normalized.evidenceRefs.length > 0) {
          list[i].evidenceRefs = (list[i].evidenceRefs || []).concat(normalized.evidenceRefs)
        }
        this._touch()
        return list[i]
      }
    }
  }

  list.push(normalized)
  this._touch()
  this._boundedMaintenance(opts)
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
    var allowedById = {}
    allowed.forEach(function(e) { allowedById[e.item.id] = true })
    sections.forEach(function(section) {
      self._memory.sections[section] = (self._getSection(section) || []).filter(function(item) {
        return allowedById[item.id] === true
      })
    })
  }

  this._touch()
  return this.snapshot()
}

MiniAMemoryManager.prototype.saveToChannel = function(channelName, key) {
  if (this._config.enabled !== true) return false
  if (!isString(channelName) || channelName.length === 0) return false
  var chKey = isString(key) && key.length > 0 ? key : "snapshot"
  try {
    $ch(channelName).set({ key: chKey }, this.snapshot())
    return true
  } catch(e) {
    return false
  }
}

MiniAMemoryManager.prototype.loadFromChannel = function(channelName, key) {
  if (!isString(channelName) || channelName.length === 0) return false
  var chKey = isString(key) && key.length > 0 ? key : "snapshot"
  try {
    var data = $ch(channelName).get({ key: chKey })
    if (!isObject(data)) return false
    this.init(data)
    return true
  } catch(e) {
    return false
  }
}
