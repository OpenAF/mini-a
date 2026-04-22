// Mini-A working memory manager.
// Provides an interactive TUI to inspect and maintain global/session memory
// stores configured through usememory/memorych/memorysessionch arguments.
plugin("Console")

var args = isDef(global._args) ? global._args : processExpr(" ")

__initializeCon()
loadLib("mini-a-common.js")
loadLib("mini-a-memory.js")

if (isDef(args.libs) && args.libs.length > 0) {
  __miniALoadLibraries(args.libs, log, logErr)
}

function _safeString(v) {
  if (isUnDef(v) || v === null) return ""
  return String(v)
}

function _trim(v) {
  return _safeString(v).trim()
}

function _parseDateInput(raw) {
  var text = _trim(raw)
  if (text.length === 0) return __

  var rel = text.match(/^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)$/i)
  if (isArray(rel) && rel.length >= 3) {
    var amount = Number(rel[1])
    if (!isNaN(amount) && amount > 0) {
      var unit = rel[2].toLowerCase()
      var mul = 60000
      if (unit.indexOf("h") === 0 || unit.indexOf("hour") === 0 || unit === "hr" || unit === "hrs") mul = 3600000
      if (unit.indexOf("d") === 0 || unit.indexOf("day") === 0) mul = 86400000
      if (unit.indexOf("w") === 0 || unit.indexOf("week") === 0) mul = 7 * 86400000
      return new Date(Date.now() - (amount * mul))
    }
  }

  if (/^\d+$/.test(text)) {
    var epoch = Number(text)
    if (!isNaN(epoch) && epoch > 0) {
      if (text.length <= 10) epoch = epoch * 1000
      return new Date(epoch)
    }
  }

  var parsed = new Date(text)
  if (!isNaN(parsed.getTime())) return parsed
  return __
}

function _formatAge(iso) {
  if (!isString(iso) || iso.length === 0) return "-"
  var t = new Date(iso).getTime()
  if (isNaN(t)) return "-"
  var delta = Date.now() - t
  if (delta < 60000) return Math.max(0, Math.round(delta / 1000)) + "s"
  if (delta < 3600000) return Math.round(delta / 60000) + "m"
  if (delta < 86400000) return Math.round(delta / 3600000) + "h"
  return Math.round(delta / 86400000) + "d"
}

function _parseChannelDef(rawValue, fallbackName, fallbackType) {
  if (!isString(rawValue) || rawValue.trim().length === 0) return __
  var parsed = af.fromJSSLON(rawValue)
  if (!isMap(parsed)) return __

  var cName = _trim(parsed.name)
  if (cName.length === 0) cName = fallbackName
  var cType = _trim(parsed.type)
  if (cType.length === 0) cType = fallbackType || "simple"
  var cOpts = isMap(parsed.options) ? parsed.options : {}

  var exists = false
  try { exists = $ch().list().indexOf(cName) >= 0 } catch(ignoreList) {}
  if (!exists) $ch(cName).create(cType, cOpts)

  return {
    name: cName,
    type: cType,
    options: cOpts,
    created: !exists
  }
}

function _resolveMemoryArgs(baseArgs) {
  var cfg = merge({}, isObject(baseArgs) ? baseArgs : {})
  cfg.usememory = toBoolean(cfg.usememory) === true
  cfg.memoryuser = toBoolean(cfg.memoryuser) === true
  cfg.memoryusersession = toBoolean(cfg.memoryusersession) === true
  __miniAApplyMemoryUserDefaults(cfg)

  if (!cfg.usememory && (isDef(cfg.memorych) || isDef(cfg.memorysessionch))) cfg.usememory = true

  var memoryScope = _trim(cfg.memoryscope)
  if (memoryScope.length === 0) memoryScope = _trim(cfg.memoryScope)
  memoryScope = memoryScope.toLowerCase()
  if (["session", "global", "both"].indexOf(memoryScope) < 0) memoryScope = "both"

  var sid = _trim(cfg.memorysessionid)
  if (sid.length === 0) sid = _trim(cfg.conversation)
  if (sid.length === 0) sid = "default"

  cfg._memoryScope = memoryScope
  cfg._memorySessionId = sid
  return cfg
}

function _createManager(kind, channelCfg, namespace) {
  var mgr = new MiniAMemoryManager({
    enabled: true,
    maxPerSection: 200,
    maxTotalEntries: 2000,
    compactEvery: 10,
    dedup: true,
    debug: false
  })
  mgr.init({})

  var loaded = false
  if (isObject(channelCfg) && isString(channelCfg.name) && channelCfg.name.length > 0) {
    loaded = mgr.loadFromChannel(channelCfg.name, namespace) === true
  }

  return {
    kind: kind,
    manager: mgr,
    channel: channelCfg,
    namespace: namespace,
    loaded: loaded
  }
}

function _persistStore(store) {
  if (!isObject(store) || !isObject(store.manager)) return false
  if (!isObject(store.channel) || !isString(store.channel.name) || store.channel.name.length === 0) return false
  return store.manager.saveToChannel(store.channel.name, store.namespace) === true
}

function _scanSessionNamespaces(channelCfg) {
  if (!isObject(channelCfg) || !isString(channelCfg.name) || channelCfg.name.length === 0) return []
  return MiniAMemoryManager.listChannelNamespaces(channelCfg.name).map(function(entry) {
    var tmpStore = _createManager("session", channelCfg, entry.namespace)
    var stats = _collectStats(tmpStore)
    var meta = isObject(entry.meta) ? entry.meta : {}
    return {
      namespace: entry.namespace,
      total: stats.total,
      stale: stats.stale,
      unresolved: stats.unresolved,
      revision: isNumber(meta.revision) ? meta.revision : stats.revision,
      updatedAt: isString(meta.updatedAt) ? meta.updatedAt : stats.updatedAt,
      createdAt: isString(meta.createdAt) ? meta.createdAt : "-"
    }
  }).sort(function(a, b) {
    return String(b.updatedAt).localeCompare(String(a.updatedAt))
  })
}

function _reloadSessionStore(stores, namespace) {
  if (!isObject(stores) || !isObject(stores.session)) return false
  stores.session = _createManager("session", stores.session.channel, _trim(namespace))
  return true
}

function _printSessionNamespaces(stores) {
  var rows = _scanSessionNamespaces(isObject(stores) && isObject(stores.session) ? stores.session.channel : __)
  if (rows.length === 0) {
    print(ansiColor("FAINT", "No persisted session namespaces found."))
    return []
  }
  var activeNs = isObject(stores) && isObject(stores.session) ? _safeString(stores.session.namespace) : ""
  print(ansiColor("BOLD", "Persisted session namespaces"))
  print(printTable(rows.map(function(entry, idx) {
    return {
      "#": idx + 1,
      active: entry.namespace === activeNs ? "*" : "",
      age: _formatAge(entry.updatedAt),
      entries: entry.total,
      stale: entry.stale,
      unresolved: entry.unresolved,
      revision: entry.revision,
      namespace: entry.namespace
    }
  }), __, true, __conAnsi, __, __, true, false, true))
  print()
  return rows
}

function _chooseSessionNamespace(stores, message) {
  var rows = _scanSessionNamespaces(isObject(stores) && isObject(stores.session) ? stores.session.channel : __)
  if (rows.length === 0) {
    print(ansiColor("FAINT", "No persisted session namespaces found."))
    return __
  }
  var options = rows.map(function(entry) {
    return entry.namespace + " [" + entry.total + " entries, " + _formatAge(entry.updatedAt) + "]"
  })
  options.push("🔙 Cancel")
  var idx = __miniANormalizeChoiceIndex(askChoose(message || "Choose session namespace: ", options, 10), rows.length)
  if (idx < 0 || idx >= rows.length) return __
  return rows[idx].namespace
}

function _deleteSessionNamespace(stores, namespace) {
  var ns = _trim(namespace)
  if (ns.length === 0) return false
  if (!isObject(stores) || !isObject(stores.session) || !isObject(stores.session.channel)) return false
  var deleted = MiniAMemoryManager.deleteChannelNamespace(stores.session.channel.name, ns)
  if (_safeString(stores.session.namespace) === ns) _reloadSessionStore(stores, "")
  if (deleted > 0) print("🗑️ Deleted session namespace '" + ns + "' (" + deleted + " records).")
  else print(ansiColor("FAINT", "No records found for session namespace '" + ns + "'."))
  return deleted > 0
}

function _deleteSessionNamespacesOlderThan(stores, thresholdDate) {
  var rows = _scanSessionNamespaces(isObject(stores) && isObject(stores.session) ? stores.session.channel : __)
  var deleted = 0
  rows.forEach(function(entry) {
    var anchor = isString(entry.updatedAt) ? entry.updatedAt : entry.createdAt
    var ts = new Date(anchor).getTime()
    if (isNaN(ts) || ts >= thresholdDate.getTime()) return
    if (_deleteSessionNamespace(stores, entry.namespace)) deleted++
  })
  if (deleted > 0) print("🧹 Deleted " + deleted + " session namespace" + (deleted === 1 ? "" : "s") + " older than " + thresholdDate.toISOString() + ".")
  else print(ansiColor("FAINT", "No session namespaces older than " + thresholdDate.toISOString() + "."))
  return deleted
}

function _collectStats(store) {
  var snap = store.manager.snapshot()
  var sections = store.manager._sections()
  var total = 0
  var stale = 0
  var unresolved = 0
  var rows = []

  sections.forEach(function(section) {
    var entries = isObject(snap.sections) && isArray(snap.sections[section]) ? snap.sections[section] : []
    if (entries.length === 0) return
    var staleCount = 0
    var unresolvedCount = 0
    entries.forEach(function(e) {
      if (toBoolean(e.stale) === true) staleCount++
      if (toBoolean(e.unresolved) === true) unresolvedCount++
    })
    total += entries.length
    stale += staleCount
    unresolved += unresolvedCount
    rows.push({ Section: section, Entries: entries.length, Stale: staleCount, Unresolved: unresolvedCount })
  })

  rows.sort(function(a, b) { return b.Entries - a.Entries })
  return {
    total: total,
    stale: stale,
    unresolved: unresolved,
    rows: rows,
    revision: snap.revision || 0,
    updatedAt: snap.updatedAt || "-"
  }
}

function _printStoreStatus(store) {
  var stats = _collectStats(store)
  var channelLabel = isObject(store.channel) ? store.channel.name + (store.namespace ? " (ns=" + store.namespace + ")" : "") : "in-memory (not persisted)"
  print(ansiColor("BOLD", (store.kind === "global" ? "🌍 Global" : "🧭 Session") + " memory"))
  print("  Channel: " + channelLabel)
  print("  Entries: " + stats.total + " | stale=" + stats.stale + " | unresolved=" + stats.unresolved)
  print("  Revision: " + stats.revision + " | updated: " + stats.updatedAt)
  if (stats.rows.length > 0) print(printTable(stats.rows, __, true, __conAnsi, __, __, true, false, true))
  else print(ansiColor("FAINT", "  (no entries)"))
  print()
}

function _chooseStore(stores, message, includeBoth) {
  var options = []
  var map = []
  Object.keys(stores).forEach(function(name) {
    if (!isObject(stores[name])) return
    options.push((name === "global" ? "🌍 " : "🧭 ") + name)
    map.push(name)
  })
  if (includeBoth === true && map.length > 1) {
    options.push("🔀 both")
    map.push("both")
  }
  options.push("🔙 Cancel")
  var idx = __miniANormalizeChoiceIndex(askChoose(message || "Choose memory scope: ", options, 8), map.length)
  if (idx >= map.length) return __
  return map[idx]
}

function _listEntries(store, opts) {
  var options = isObject(opts) ? opts : {}
  var section = _trim(options.section)
  var onlyStale = toBoolean(options.onlyStale) === true
  var onlyUnresolved = toBoolean(options.onlyUnresolved) === true

  var sections = store.manager._sections()
  if (section.length > 0 && sections.indexOf(section) < 0) {
    printErr("Unknown section: " + section)
    return []
  }

  var results = []
  sections.forEach(function(sec) {
    if (section.length > 0 && sec !== section) return
    var entries = store.manager.getSectionEntries(sec)
    entries.forEach(function(entry) {
      if (onlyStale && toBoolean(entry.stale) !== true) return
      if (onlyUnresolved && toBoolean(entry.unresolved) !== true) return
      results.push({
        scope: store.kind,
        section: sec,
        id: entry.id,
        status: entry.status || "active",
        stale: toBoolean(entry.stale) === true,
        unresolved: toBoolean(entry.unresolved) === true,
        updatedAt: entry.updatedAt,
        value: entry.value
      })
    })
  })

  results.sort(function(a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)) })

  if (results.length === 0) {
    print(ansiColor("FAINT", "No entries match the current filter."))
    return []
  }

  var tableRows = results.map(function(r, idx) {
    return {
      "#": idx + 1,
      section: r.section,
      id: r.id,
      status: r.status,
      stale: r.stale ? "yes" : "no",
      unresolved: r.unresolved ? "yes" : "no",
      age: _formatAge(r.updatedAt),
      value: String(r.value || "").substring(0, 80)
    }
  })
  print(printTable(tableRows, __, true, __conAnsi, __, __, true, false, true))
  return results
}

function _inspectEntry(store, section, id) {
  var entries = store.manager.getSectionEntries(section)
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].id !== id) continue
    print("\n" + ansiColor("BOLD", "Entry details") + "\n")
    print(printTree(entries[i]))
    print()
    return true
  }
  printErr("Entry not found: " + section + "/" + id)
  return false
}

function _deleteById(store, section, id) {
  var ok = store.manager.remove(section, id)
  if (!ok) {
    printErr("Entry not found: " + section + "/" + id)
    return false
  }
  _persistStore(store)
  print("🗑️ Deleted " + section + "/" + id + " from " + store.kind + " memory.")
  return true
}

function _deleteOlderThan(store, thresholdDate, options) {
  var opts = isObject(options) ? options : {}
  var onlySection = _trim(opts.section)
  var sections = store.manager._sections()
  var deleted = 0
  var bySection = {}

  sections.forEach(function(section) {
    if (onlySection.length > 0 && section !== onlySection) return
    var entries = store.manager.getSectionEntries(section)
    entries.forEach(function(entry) {
      var anchor = isString(entry.updatedAt) ? entry.updatedAt : (isString(entry.createdAt) ? entry.createdAt : __)
      if (!isString(anchor)) return
      var ts = new Date(anchor).getTime()
      if (isNaN(ts)) return
      if (ts >= thresholdDate.getTime()) return
      if (store.manager.remove(section, entry.id)) {
        deleted++
        bySection[section] = (bySection[section] || 0) + 1
      }
    })
  })

  if (deleted > 0) {
    _persistStore(store)
    var parts = Object.keys(bySection).sort().map(function(k) { return k + "=" + bySection[k] })
    print("🧹 Deleted " + deleted + " entries older than " + thresholdDate.toISOString() + " (" + parts.join(", ") + ").")
  } else {
    print(ansiColor("FAINT", "No entries older than " + thresholdDate.toISOString() + "."))
  }

  return deleted
}

function _searchEntries(store, query) {
  var q = _trim(query).toLowerCase()
  if (q.length === 0) return []
  var results = []
  store.manager._sections().forEach(function(section) {
    var entries = store.manager.getSectionEntries(section)
    entries.forEach(function(e) {
      var value = _safeString(e.value).toLowerCase()
      var tags = isArray(e.tags) ? e.tags.join(" ").toLowerCase() : ""
      if (value.indexOf(q) >= 0 || tags.indexOf(q) >= 0 || _safeString(e.id).toLowerCase().indexOf(q) >= 0) {
        results.push({ section: section, id: e.id, status: e.status || "active", age: _formatAge(e.updatedAt), value: _safeString(e.value).substring(0, 100) })
      }
    })
  })
  if (results.length > 0) print(printTable(results, __, true, __conAnsi, __, __, true, false, true))
  else print(ansiColor("FAINT", "No matches for query '" + q + "'."))
  return results
}

function _printHelp() {
  print(ansiColor("BOLD", "Memory Manager actions"))
  print("  • 📊 Summary: per-scope section counts + stale/unresolved totals")
  print("  • 🧭 Session namespaces: list every persisted session namespace")
  print("  • 🎯 Switch session namespace: inspect a different persisted session")
  print("  • 📃 List entries: show entries by section with quick metadata")
  print("  • 🔎 Inspect entry: full entry payload (meta, provenance, refs, timestamps)")
  print("  • 🧽 Delete by id: remove one entry by section/id")
  print("  • ⏳ Delete older than: prune entries older than an age/date")
  print("  • 🗑️ Delete session namespace: remove one persisted session namespace")
  print("  • 🧹 Delete old session namespaces: prune whole sessions older than an age/date")
  print("  • 🔍 Search: keyword search across ids, values and tags")
  print("  • 🧰 Maintenance: compact or clear stale flag sweep")
  print("  • 💾 Export snapshot: print full JSON snapshot for backups")
  print()
}

function _maintenance(store) {
  var options = [
    "Run compact()",
    "Mark stale entries (sweep by days)",
    "Clear entire store",
    "🔙 Back"
  ]
  var act = __miniANormalizeChoiceIndex(askChoose("Maintenance action for " + store.kind + " memory: ", options, 8), 3)
  if (act < 0) return
  if (act === 0) {
    store.manager.compact()
    _persistStore(store)
    print("🧰 Compaction completed.")
  } else if (act === 1) {
    var d = ask("Days since last confirmation to mark stale (e.g. 30): ")
    var days = Number(d)
    if (isNaN(days) || days <= 0) {
      printErr("Invalid number of days.")
      return
    }
    var marked = store.manager.sweepStale(days)
    _persistStore(store)
    print("🧰 Marked " + marked + " stale entr" + (marked === 1 ? "y" : "ies") + ".")
  } else if (act === 2) {
    var confirm = _trim(ask("Type 'delete all' to clear this memory store: "))
    if (confirm.toLowerCase() !== "delete all") {
      print(ansiColor("FAINT", "Cancelled."))
      return
    }
    store.manager.clear()
    _persistStore(store)
    print("🧨 Cleared " + store.kind + " memory store.")
  }
}

function mainMemoryManager(rawArgs) {
  var cfg = _resolveMemoryArgs(rawArgs)
  var accentColor = "FG(218)"
  var promptColor = "FG(41)"

  const logo = ` ._ _ ${ansiColor(promptColor, "o")}._ ${ansiColor(promptColor, "o")}   _\n | | ||| ||~~(_|`
  print(ansiColor("BOLD", logo) + ansiColor(accentColor, " Working memory manager"))
  print()

  if (cfg.usememory !== true) {
    print(ansiColor("FG(214)", "⚠ usememory is not enabled. Opening manager anyway using provided channels/state."))
  }

  var globalChannel = __
  var sessionChannel = __
  try { globalChannel = _parseChannelDef(cfg.memorych, "_mini_a_memory_channel", "simple") } catch(eGlobalCh) { printErr("Failed to parse memorych: " + eGlobalCh.message) }
  try { sessionChannel = _parseChannelDef(cfg.memorysessionch, "_mini_a_session_memory_channel", "simple") } catch(eSessionCh) { printErr("Failed to parse memorysessionch: " + eSessionCh.message) }

  var effectiveSessionChannel = isObject(sessionChannel) ? sessionChannel : globalChannel

  var stores = {}
  stores.global = _createManager("global", globalChannel, "")
  stores.session = _createManager("session", effectiveSessionChannel, cfg._memorySessionId)

  if (!isObject(globalChannel) && !isObject(effectiveSessionChannel)) {
    print(ansiColor("FG(214)", "⚠ No memory channel provided. Changes will be in-memory only for this run."))
    print()
  }

  _printHelp()

  var shouldExit = false
  while (!shouldExit) {
    var action = __miniANormalizeChoiceIndex(askChoose("Choose an action: ", [
      "📊 Summary",
      "🧭 List session namespaces",
      "🎯 Switch active session namespace",
      "📃 List entries",
      "🔎 Inspect entry",
      "🧽 Delete by id",
      "⏳ Delete entries older than...",
      "🗑️ Delete session namespace",
      "🧹 Delete session namespaces older than...",
      "🔍 Search entries",
      "🧰 Maintenance",
      "💾 Export snapshot",
      "❓ Help",
      "🔙 Exit"
    ], 12), 13)

    if (action < 0) {
      shouldExit = true
      continue
    }

    if (action === 0) {
      _printStoreStatus(stores.global)
      _printStoreStatus(stores.session)
      continue
    }

    if (action === 1) {
      _printSessionNamespaces(stores)
      continue
    }

    if (action === 2) {
      var selectedNamespace = _chooseSessionNamespace(stores, "Switch active session namespace to:")
      if (!isString(selectedNamespace)) continue
      _reloadSessionStore(stores, selectedNamespace)
      print("🎯 Active session namespace set to " + selectedNamespace)
      continue
    }

    if (action === 3) {
      var chosenStore = _chooseStore(stores, "List entries from which memory scope?", false)
      if (!isString(chosenStore)) continue
      var section = _trim(ask("Optional section filter (facts/evidence/openQuestions/hypotheses/decisions/artifacts/risks/summaries): "))
      var staleOnly = toBoolean(ask("Only stale entries? (true/false, default false): ")) === true
      var unresolvedOnly = toBoolean(ask("Only unresolved entries? (true/false, default false): ")) === true
      _listEntries(stores[chosenStore], { section: section, onlyStale: staleOnly, onlyUnresolved: unresolvedOnly })
      continue
    }

    if (action === 4) {
      var scopeInspect = _chooseStore(stores, "Inspect entry from which scope?", false)
      if (!isString(scopeInspect)) continue
      var sectionInspect = _trim(ask("Section: "))
      var idInspect = _trim(ask("Entry id: "))
      _inspectEntry(stores[scopeInspect], sectionInspect, idInspect)
      continue
    }

    if (action === 5) {
      var scopeDelete = _chooseStore(stores, "Delete from which scope?", false)
      if (!isString(scopeDelete)) continue
      var sectionDelete = _trim(ask("Section: "))
      var idDelete = _trim(ask("Entry id: "))
      _deleteById(stores[scopeDelete], sectionDelete, idDelete)
      continue
    }

    if (action === 6) {
      var scopeOld = _chooseStore(stores, "Prune old entries from which scope?", true)
      if (!isString(scopeOld)) continue
      var thresholdRaw = ask("Delete entries older than (e.g. '30d', '12h', '2026-01-15', epoch): ")
      var parsedThreshold = _parseDateInput(thresholdRaw)
      if (!isDate(parsedThreshold) && !(parsedThreshold instanceof Date)) {
        printErr("Could not parse date/age value.")
        continue
      }
      var sectionOnly = _trim(ask("Optional section filter (blank = all): "))
      var confirmOld = _trim(ask("Type 'yes' to delete entries older than " + parsedThreshold.toISOString() + ": "))
      if (confirmOld.toLowerCase() !== "yes") {
        print(ansiColor("FAINT", "Cancelled."))
        continue
      }
      if (scopeOld === "both") {
        _deleteOlderThan(stores.global, parsedThreshold, { section: sectionOnly })
        _deleteOlderThan(stores.session, parsedThreshold, { section: sectionOnly })
      } else {
        _deleteOlderThan(stores[scopeOld], parsedThreshold, { section: sectionOnly })
      }
      continue
    }

    if (action === 7) {
      var namespaceDelete = _chooseSessionNamespace(stores, "Delete which persisted session namespace?")
      if (!isString(namespaceDelete)) continue
      var confirmDeleteNs = _trim(ask("Type 'delete session' to remove '" + namespaceDelete + "': "))
      if (confirmDeleteNs.toLowerCase() !== "delete session") {
        print(ansiColor("FAINT", "Cancelled."))
        continue
      }
      _deleteSessionNamespace(stores, namespaceDelete)
      continue
    }

    if (action === 8) {
      var thresholdSessionRaw = ask("Delete session namespaces older than (e.g. '30d', '12h', '2026-01-15', epoch): ")
      var parsedSessionThreshold = _parseDateInput(thresholdSessionRaw)
      if (!isDate(parsedSessionThreshold) && !(parsedSessionThreshold instanceof Date)) {
        printErr("Could not parse date/age value.")
        continue
      }
      var confirmSessionOld = _trim(ask("Type 'yes' to delete session namespaces older than " + parsedSessionThreshold.toISOString() + ": "))
      if (confirmSessionOld.toLowerCase() !== "yes") {
        print(ansiColor("FAINT", "Cancelled."))
        continue
      }
      _deleteSessionNamespacesOlderThan(stores, parsedSessionThreshold)
      continue
    }

    if (action === 9) {
      var scopeSearch = _chooseStore(stores, "Search which scope?", true)
      if (!isString(scopeSearch)) continue
      var query = ask("Query: ")
      if (scopeSearch === "both") {
        print(ansiColor("BOLD", "\nGlobal matches\n"))
        _searchEntries(stores.global, query)
        print(ansiColor("BOLD", "\nSession matches\n"))
        _searchEntries(stores.session, query)
      } else {
        _searchEntries(stores[scopeSearch], query)
      }
      continue
    }

    if (action === 10) {
      var scopeMaint = _chooseStore(stores, "Maintenance scope:", false)
      if (!isString(scopeMaint)) continue
      _maintenance(stores[scopeMaint])
      continue
    }

    if (action === 11) {
      var scopeExport = _chooseStore(stores, "Export snapshot from which scope?", true)
      if (!isString(scopeExport)) continue
      if (scopeExport === "both") {
        print("\n" + ansiColor("BOLD", "Global snapshot") + "\n")
        print(stringify(stores.global.manager.snapshot(), __, "  "))
        print("\n" + ansiColor("BOLD", "Session snapshot") + "\n")
        print(stringify(stores.session.manager.snapshot(), __, "  "))
      } else {
        print("\n" + ansiColor("BOLD", scopeExport + " snapshot") + "\n")
        print(stringify(stores[scopeExport].manager.snapshot(), __, "  "))
      }
      print()
      continue
    }

    if (action === 12) {
      _printHelp()
      continue
    }

    shouldExit = true
  }

  print(ansiColor("FG(41)", "👋 Exiting memory manager."))
}

mainMemoryManager(args)
