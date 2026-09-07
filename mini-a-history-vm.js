// Author: Nuno Aguiar
// License: Apache 2.0
// Description: Durable, bounded virtual history for Mini-A conversations.

var MiniAHistoryVM = function(options) {
  var opts = isMap(options) ? options : {}
  this.schemaVersion = 1
  this.normalizerVersion = 1
  this.policyVersion = 1
  this.contextSchemaVersion = 2
  this.representationVersion = 1
  this.enabled = opts.enabled === true
  this.shadow = opts.shadow === true
  this.contextVirtualization = opts.contextVirtualization === true && this.enabled
  this.mode = "safe"
  this.conversationPath = isString(opts.conversationPath) ? opts.conversationPath.trim() : ""
  this.conversationId = isString(opts.conversationId) && opts.conversationId.length > 0 ? opts.conversationId : sha256(this.conversationPath || String(nowNano())).substring(0, 24)
  this.branchId = isString(opts.branchId) && opts.branchId.length > 0 ? opts.branchId : "main"
  this.sessionId = isString(opts.sessionId) && opts.sessionId.length > 0 ? opts.sessionId : genUUID()
  this.agentId = isString(opts.agentId) && opts.agentId.length > 0 ? opts.agentId : "parent"
  this.writerId = genUUID()
  this.logFn = isFunction(opts.logFn) ? opts.logFn : function() {}
  this.estimateTokens = isFunction(opts.estimateTokens) ? opts.estimateTokens : function(value) {
    var text = isString(value) ? value : stringify(value, __, "")
    return Math.ceil(String(text || "").length / 4)
  }
  this.storePath = this.conversationPath.length > 0 ? this.conversationPath + ".historyvm" : ""
  this.journalPath = this.storePath.length > 0 ? this.storePath + "/events.jsonl" : ""
  this.checkpointPath = this.storePath.length > 0 ? this.storePath + "/checkpoint.json" : ""
  this.representationCachePath = this.storePath.length > 0 ? this.storePath + "/representations.jsonl" : ""
  this.events = []
  this.objects = []
  this.objectById = {}
  this.objectByHandle = {}
  this.representationCache = {}
  this.contextIndexes = { L0: {}, L1: {}, L2: {}, L3: {}, L4: {} }
  this.objectIndexTerms = {}
  this._pendingChildren = {}
  this.expansions = {}
  this._seq = 0
  this._lastHash = ""
  this._indexGeneration = 0
  this._providerCaptureCount = 0
  this.degraded = false
  this.degradedReason = ""
  this.metrics = {
    events: 0,
    objects: 0,
    collapses: 0,
    promotions: 0,
    searches: 0,
    reads: 0,
    checkpoint_hits: 0,
    checkpoint_rebuilds: 0,
    backing_failures: 0,
    estimated_original_tokens: 0,
    estimated_inline_tokens: 0,
    estimated_tokens_saved: 0,
    last_projected_tokens: 0,
    last_baseline_tokens: 0,
    representation_cache_hits: 0,
    representation_cache_misses: 0,
    representation_cache_writes: 0,
    representation_cache_failures: 0,
    representation_l0: 0,
    representation_l1: 0,
    representation_l2: 0,
    representation_l3: 0,
    representation_l4: 0,
    hierarchy_roots: 0,
    hierarchy_links: 0,
    hierarchy_searches: 0,
    hierarchy_depth_total: 0,
    context_objects_considered: 0,
    context_objects_selected: 0,
    context_candidate_tokens: 0,
    context_expansions: 0,
    context_expansion_tokens: 0,
    index_updates: 0,
    range_reads: 0,
    section_reads: 0,
    json_path_reads: 0
  }

  if (this.enabled || this.shadow) this._open()
}

MiniAHistoryVM.prototype._fail = function(reason) {
  this.degraded = true
  this.degradedReason = String(reason || "history backing store unavailable")
  this.enabled = false
  this.metrics.backing_failures++
  try { this.logFn("warn", "History VM inactive: " + this.degradedReason) } catch(ignoreLog) {}
  return false
}

MiniAHistoryVM.prototype._ensureStore = function() {
  if (this.storePath.length === 0) return this._fail("conversation path is required for durable storage")
  try {
    if (!io.fileExists(this.storePath)) io.mkdir(this.storePath)
    if (!io.fileExists(this.storePath) || io.fileInfo(this.storePath).isDirectory !== true) return this._fail("backing path is not a directory")
    return true
  } catch(e) {
    return this._fail(__miniAErrMsg(e))
  }
}

MiniAHistoryVM.prototype._atomicWriteJSON = function(path, value) {
  var tmp = path + ".tmp-" + this.writerId
  io.writeFileJSON(tmp, value, "")
  var source = java.nio.file.Paths.get(tmp)
  var target = java.nio.file.Paths.get(path)
  try {
    java.nio.file.Files.move(source, target, java.nio.file.StandardCopyOption.REPLACE_EXISTING, java.nio.file.StandardCopyOption.ATOMIC_MOVE)
  } catch(ignoreAtomicMove) {
    java.nio.file.Files.move(source, target, java.nio.file.StandardCopyOption.REPLACE_EXISTING)
  }
}

MiniAHistoryVM.prototype._readJournal = function() {
  this.events = []
  this._seq = 0
  this._lastHash = ""
  if (!io.fileExists(this.journalPath)) return
  var lines = io.readFileString(this.journalPath).split(/\r?\n/)
  var validLines = []
  var invalidTail = false
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].trim().length === 0) continue
    var event
    try { event = jsonParse(lines[i], __, __, true) } catch(ignoreLine) { invalidTail = true; break }
    if (!isMap(event) || event.seq !== this._seq + 1 || event.previousHash !== this._lastHash) { invalidTail = true; break }
    var hashInput = stringify(merge({}, event, true), __, "")
    var declaredHash = event.eventHash
    var hashPayload = jsonParse(hashInput, __, __, true)
    delete hashPayload.eventHash
    if (declaredHash !== sha256(stringify(hashPayload, __, ""))) { invalidTail = true; break }
    this.events.push(event)
    validLines.push(lines[i])
    this._seq = event.seq
    this._lastHash = declaredHash
  }
  if (invalidTail) io.writeFileString(this.journalPath, validLines.length > 0 ? validLines.join("\n") + "\n" : "")
}

MiniAHistoryVM.prototype._open = function() {
  if (!this._ensureStore()) return false
  try {
    this._readJournal()
    var checkpoint = __
    if (io.fileExists(this.checkpointPath)) {
      try { checkpoint = io.readFileJSON(this.checkpointPath) } catch(ignoreCorruptCheckpoint) {}
    }
    if (isMap(checkpoint) && checkpoint.lastCommittedSequence === this._seq && checkpoint.sourceHash === this._lastHash) {
      this.metrics.checkpoint_hits++
      this._indexGeneration = isNumber(checkpoint.indexGeneration) ? checkpoint.indexGeneration : 0
      this.branchId = isString(checkpoint.branchHead) ? checkpoint.branchHead : this.branchId
    } else {
      this.metrics.checkpoint_rebuilds++
      this._indexGeneration++
      this._writeCheckpoint()
    }
    this._rebuildObjects()
    if (this.contextVirtualization) this._loadRepresentationCache()
    return true
  } catch(e) {
    return this._fail(__miniAErrMsg(e))
  }
}

MiniAHistoryVM.prototype._loadRepresentationCache = function() {
  this.representationCache = {}
  if (!io.fileExists(this.representationCachePath)) return
  try {
    var validKeys = {}
    for (var o = 0; o < this.objects.length; o++) {
      validKeys[this._representationCacheKey(this.objects[o], "L0")] = true
      validKeys[this._representationCacheKey(this.objects[o], "L1")] = true
      validKeys[this._representationCacheKey(this.objects[o], "L2")] = true
      validKeys[this._representationCacheKey(this.objects[o], "L3")] = true
    }
    var lines = io.readFileString(this.representationCachePath).split(/\r?\n/)
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim().length === 0) continue
      try {
        var record = jsonParse(lines[i], __, __, true)
        if (isMap(record) && isString(record.key) && validKeys[record.key] === true && isMap(record.representation)) this.representationCache[record.key] = record.representation
      } catch(ignoreInvalidCacheRecord) {}
    }
  } catch(ignoreCacheRead) {
    this.metrics.representation_cache_failures++
  }
}

MiniAHistoryVM.prototype._writeCheckpoint = function() {
  this._atomicWriteJSON(this.checkpointPath, {
    schemaVersion: this.schemaVersion,
    normalizerVersion: this.normalizerVersion,
    policyVersion: this.policyVersion,
    conversationId: this.conversationId,
    lastCommittedSequence: this._seq,
    sourceHash: this._lastHash,
    branchHead: this.branchId,
    indexGeneration: this._indexGeneration,
    writerId: this.writerId,
    updatedAt: new Date().toISOString()
  })
}

MiniAHistoryVM.prototype.append = function(sourceKind, content, metadata) {
  if ((!this.enabled && !this.shadow) || this.degraded) return __
  try {
    var diskSeq = 0
    if (io.fileExists(this.checkpointPath)) {
      var diskCheckpoint = io.readFileJSON(this.checkpointPath)
      diskSeq = isMap(diskCheckpoint) && isNumber(diskCheckpoint.lastCommittedSequence) ? diskCheckpoint.lastCommittedSequence : 0
    }
    if (diskSeq !== this._seq) return this._fail("concurrent conversation writer detected")
    var meta = isMap(metadata) ? metadata : {}
    var event = {
      schemaVersion: this.schemaVersion,
      conversationId: this.conversationId,
      branchId: isString(meta.branchId) ? meta.branchId : this.branchId,
      sessionId: this.sessionId,
      agentId: isString(meta.agentId) ? meta.agentId : this.agentId,
      seq: this._seq + 1,
      eventId: isString(meta.eventId) ? meta.eventId : "e" + String(this._seq + 1),
      interactionId: isString(meta.interactionId) ? meta.interactionId : (isString(meta.stepLabel) ? "step-" + meta.stepLabel : "event-" + String(this._seq + 1)),
      sourceKind: String(sourceKind || "unknown"),
      status: isString(meta.status) ? meta.status : "completed",
      createdAt: new Date().toISOString(),
      previousHash: this._lastHash,
      metadata: meta,
      content: content
    }
    event.eventHash = sha256(stringify(event, __, ""))
    io.writeFileString(this.journalPath, stringify(event, __, "") + "\n", __, true)
    this.events.push(event)
    this._seq = event.seq
    this._lastHash = event.eventHash
    this._indexGeneration++
    this._writeCheckpoint()
    this._indexEvent(event)
    return event
  } catch(e) {
    this._fail(__miniAErrMsg(e))
    return __
  }
}

MiniAHistoryVM.prototype.importLegacy = function(payload) {
  if (this.events.length > 0 || !isMap(payload) || !isArray(payload.c)) return __
  return this.append("legacy_import", payload.c, {
    legacyImport: true,
    captureStartedAt: new Date().toISOString(),
    completeness: "legacy_snapshot_only"
  })
}

MiniAHistoryVM.prototype.captureProviderConversation = function(conversation) {
  if (!isArray(conversation)) return 0
  var appended = 0
  for (var i = this._providerCaptureCount; i < conversation.length; i++) {
    var entry = conversation[i]
    var text = isMap(entry) && isString(entry.content) ? entry.content : ""
    if (text.indexOf("[HISTORY_VM_REFERENCE ") === 0) continue
    if (isMap(entry) && entry.__historyVmProjection === true) continue
    if (isDef(this.append("provider_message", entry, { providerIndex: i, role: isMap(entry) ? entry.role : __ }))) appended++
  }
  this._providerCaptureCount = Math.max(this._providerCaptureCount, conversation.length)
  return appended
}

MiniAHistoryVM.prototype.captureToolExchange = function(toolName, params, result, metadata) {
  var meta = merge(isMap(metadata) ? metadata : {}, { toolName: toolName }, true)
  return this.append("tool_exchange", { request: params, result: result }, meta)
}

MiniAHistoryVM.prototype.captureUserMessage = function(message, metadata) {
  return this.append("user_message", message, metadata)
}

MiniAHistoryVM.prototype.captureAssistantMessage = function(message, metadata) {
  return this.append("assistant_message", message, metadata)
}

MiniAHistoryVM.prototype.registerContextObject = function(kind, type, content, metadata) {
  if (!this.contextVirtualization) return __
  var meta = merge(isMap(metadata) ? metadata : {}, {
    contextKind: this._contextKind(kind),
    contextType: isString(type) && type.length > 0 ? type : "record"
  }, true)
  return this.append("context_object", content, meta)
}

MiniAHistoryVM.prototype._contextKind = function(kind) {
  var value = isString(kind) ? kind.toLowerCase().trim() : "history"
  var allowed = ["history", "memory", "plan", "decision", "constraint", "artifact", "attachment", "wiki", "skill", "delegation", "recovery", "evidence", "summary"]
  return allowed.indexOf(value) >= 0 ? value : "history"
}

MiniAHistoryVM.prototype._kindPrefix = function(kind) {
  var prefixes = { history: "h", memory: "m", plan: "p", decision: "d", constraint: "c", artifact: "a", attachment: "att", wiki: "w", skill: "sk", delegation: "del", recovery: "r", evidence: "e", summary: "s" }
  return prefixes[this._contextKind(kind)] || "h"
}

MiniAHistoryVM.prototype._eventType = function(event) {
  if (event.sourceKind === "context_object" && isMap(event.metadata) && isString(event.metadata.contextType)) return event.metadata.contextType
  if (event.sourceKind === "tool_exchange") return "tool_exchange"
  if (event.sourceKind === "user_message") return "user_message"
  if (event.sourceKind === "assistant_message") return "assistant_message"
  if (event.sourceKind === "legacy_import") return "session_summary"
  var role = isMap(event.content) && isString(event.content.role) ? event.content.role.toLowerCase() : ""
  if (role === "user") return "user_message"
  if (role === "assistant") return "assistant_message"
  if (role === "tool" || role === "function") return "tool_exchange"
  return "recovery_episode"
}

MiniAHistoryVM.prototype._summary = function(event, text) {
  var value = String(text || "").replace(/\s+/g, " ").trim()
  if (value.length > 180) value = value.substring(0, 180) + "..."
  var label = this._eventType(event).replace(/_/g, " ")
  if (isMap(event.metadata) && isString(event.metadata.toolName)) label += " " + event.metadata.toolName
  return label + (value.length > 0 ? ": " + value : "")
}

MiniAHistoryVM.prototype._indexEvent = function(event) {
  var serialized = isString(event.content) ? event.content : stringify(event.content, __, "")
  var estimatedTokens = this.estimateTokens(serialized)
  var meta = isMap(event.metadata) ? event.metadata : {}
  var kind = event.sourceKind === "context_object" ? this._contextKind(meta.contextKind) : "history"
  var id = this._kindPrefix(kind) + ("000000" + event.seq).slice(-6)
  var object = {
    schemaVersion: this.contextVirtualization ? this.contextSchemaVersion : this.schemaVersion,
    id: id,
    handle: kind + ":" + id,
    conversationId: this.conversationId,
    branchId: event.branchId,
    sessionId: event.sessionId,
    agentId: event.agentId,
    kind: kind,
    type: this._eventType(event),
    source: { kind: event.sourceKind, eventId: event.eventId },
    canonicalRef: { sequence: event.seq, sourceHash: event.eventHash },
    parentId: isString(meta.parentId) ? meta.parentId : __,
    children: isArray(meta.children) ? meta.children.slice(0) : [],
    dependencies: isArray(meta.dependencies) ? meta.dependencies.slice(0) : (isArray(meta.dependencyRefs) ? meta.dependencyRefs.slice(0) : []),
    related: isArray(meta.related) ? meta.related.slice(0) : [],
    keywords: isArray(meta.keywords) ? meta.keywords.slice(0) : [],
    entities: isArray(meta.entities) ? meta.entities.slice(0) : [],
    sourceRefs: [event.eventId],
    createdStep: isMap(event.metadata) ? event.metadata.stepLabel : __,
    completedStep: isMap(event.metadata) ? event.metadata.stepLabel : __,
    lastAccessStep: __,
    accessCount: 0,
    recentAccessSteps: [],
    explicitPin: isMap(event.metadata) && event.metadata.explicitPin === true,
    temporaryPinUntilStep: __,
    unresolved: event.status !== "completed" || (isMap(event.metadata) && event.metadata.unresolved === true),
    dependencyRefs: isArray(meta.dependencyRefs) ? meta.dependencyRefs.slice(0) : [],
    protectionReason: __,
    originalBytes: new java.lang.String(serialized).getBytes(java.nio.charset.StandardCharsets.UTF_8).length,
    estimatedOriginalTokens: estimatedTokens,
    originalTokens: estimatedTokens,
    representation: "hot",
    lastTransitionStep: isMap(event.metadata) ? event.metadata.stepLabel : __,
    artifactRef: this.journalPath + "#" + event.seq,
    sourceHash: event.eventHash,
    summary: this._summary(event, serialized),
    summaryMetadata: { generatedBy: "deterministic", version: 1, coverage: "partial" },
    representations: this.contextVirtualization ? {
      reference: { level: "L0", available: true },
      abstract: { level: "L1", available: true },
      summary: { level: "L2", available: true },
      detailed: { level: "L3", available: true },
      full: { level: "L4", available: true, canonical: true }
    } : __,
    heat: isNumber(meta.heat) ? meta.heat : 0,
    importance: isNumber(meta.importance) ? meta.importance : 0.5,
    lastAccess: __,
    provenance: isMap(meta.provenance) ? merge({}, meta.provenance, true) : { eventId: event.eventId, sourceHash: event.eventHash },
    version: isNumber(meta.version) ? meta.version : 1,
    content: event.content,
    event: event
  }
  this.objects.push(object)
  this.objectById[object.id] = object
  this.objectByHandle[object.handle] = object
  if (this.contextVirtualization) this._linkHierarchyObject(object)
  if (this.contextVirtualization) this._indexContextObject(object, serialized)
  if (event.branchId === this.branchId && event.sourceKind === "provider_message" && isMap(event.metadata) && isNumber(event.metadata.providerIndex)) {
    this._providerCaptureCount = Math.max(this._providerCaptureCount, event.metadata.providerIndex + 1)
  }
  this.metrics.estimated_original_tokens += object.estimatedOriginalTokens
  this.metrics.events = this.events.length
  this.metrics.objects = this.objects.length
  return object
}

MiniAHistoryVM.prototype._rebuildObjects = function() {
  this.objects = []
  this.objectById = {}
  this.objectByHandle = {}
  this.contextIndexes = { L0: {}, L1: {}, L2: {}, L3: {}, L4: {} }
  this.objectIndexTerms = {}
  this._pendingChildren = {}
  this._providerCaptureCount = 0
  this.metrics.estimated_original_tokens = 0
  this.metrics.hierarchy_roots = 0
  this.metrics.hierarchy_links = 0
  for (var i = 0; i < this.events.length; i++) this._indexEvent(this.events[i])
}

MiniAHistoryVM.prototype._resolveObject = function(id) {
  return this.objectById[id] || this.objectByHandle[id]
}

MiniAHistoryVM.prototype._addChild = function(parent, childHandle) {
  if (!isMap(parent) || !isString(childHandle) || parent.children.indexOf(childHandle) >= 0) return false
  parent.children.push(childHandle)
  this.metrics.hierarchy_links++
  this._indexContextObject(parent, __, ["L1", "L2"])
  return true
}

MiniAHistoryVM.prototype._linkHierarchyObject = function(object) {
  if (!isString(object.parentId) || object.parentId.length === 0) {
    this.metrics.hierarchy_roots++
  } else {
    var parent = this._resolveObject(object.parentId)
    if (isMap(parent)) this._addChild(parent, object.handle)
    else {
      if (!isArray(this._pendingChildren[object.parentId])) this._pendingChildren[object.parentId] = []
      this._pendingChildren[object.parentId].push(object.handle)
    }
  }
  var aliases = [object.id, object.handle]
  for (var i = 0; i < aliases.length; i++) {
    var waiting = this._pendingChildren[aliases[i]]
    if (!isArray(waiting)) continue
    for (var j = 0; j < waiting.length; j++) this._addChild(object, waiting[j])
    delete this._pendingChildren[aliases[i]]
  }
}

MiniAHistoryVM.prototype._tokenizeIndexText = function(value) {
  var parts = String(value || "").toLowerCase().split(/[^a-z0-9_:-]+/)
  var unique = {}
  for (var i = 0; i < parts.length; i++) if (parts[i].length > 1) unique[parts[i]] = true
  return Object.keys(unique)
}

MiniAHistoryVM.prototype._removeContextIndexObject = function(object, levels) {
  var previous = this.objectIndexTerms[object.handle]
  if (!isMap(previous)) return
  var selectedLevels = isArray(levels) ? levels : Object.keys(previous)
  for (var l = 0; l < selectedLevels.length; l++) {
    var terms = previous[selectedLevels[l]]
    if (!isArray(terms)) continue
    for (var t = 0; t < terms.length; t++) {
      var posting = this.contextIndexes[selectedLevels[l]][terms[t]]
      if (!isMap(posting)) continue
      delete posting[object.handle]
      if (Object.keys(posting).length === 0) delete this.contextIndexes[selectedLevels[l]][terms[t]]
    }
  }
}

MiniAHistoryVM.prototype._indexContextObject = function(object, serialized, requestedLevels) {
  if (!this.contextVirtualization || !isMap(object)) return
  var levels = isArray(requestedLevels) ? requestedLevels : ["L0", "L1", "L2", "L3", "L4"]
  this._removeContextIndexObject(object, levels)
  var extra = object.keywords.join(" ") + " " + object.entities.join(" ")
  var texts = {}
  if (levels.indexOf("L0") >= 0) texts.L0 = this._buildRepresentation(object, "L0").text + " " + extra
  if (levels.indexOf("L1") >= 0) texts.L1 = this._buildRepresentation(object, "L1").text + " " + extra
  if (levels.indexOf("L2") >= 0) texts.L2 = this._buildRepresentation(object, "L2").text + " " + extra
  if (levels.indexOf("L3") >= 0 || levels.indexOf("L4") >= 0) {
    var exact = isString(serialized) ? serialized : (isString(object.content) ? object.content : stringify(object.content, __, ""))
    if (levels.indexOf("L3") >= 0) texts.L3 = this._contentCodePoints(exact).slice(0, 1200).join("") + " " + extra
    if (levels.indexOf("L4") >= 0) texts.L4 = exact + " " + extra
  }
  var indexed = isMap(this.objectIndexTerms[object.handle]) ? this.objectIndexTerms[object.handle] : {}
  for (var l = 0; l < levels.length; l++) {
    var level = levels[l]
    var terms = this._tokenizeIndexText(texts[level])
    indexed[level] = terms
    for (var t = 0; t < terms.length; t++) {
      if (!isMap(this.contextIndexes[level][terms[t]])) this.contextIndexes[level][terms[t]] = {}
      this.contextIndexes[level][terms[t]][object.handle] = true
    }
  }
  this.objectIndexTerms[object.handle] = indexed
  this.metrics.index_updates++
}

MiniAHistoryVM.prototype._representationLevel = function(level) {
  var value = isString(level) ? level.toLowerCase().trim() : "l2"
  var aliases = { l0: "L0", reference: "L0", l1: "L1", abstract: "L1", l2: "L2", summary: "L2", l3: "L3", detailed: "L3", detail: "L3", l4: "L4", full: "L4" }
  return aliases[value] || "L2"
}

MiniAHistoryVM.prototype._representationSourceHash = function(object, level) {
  var source = object.sourceHash
  if ((level === "L1" || level === "L2") && object.children.length > 0) {
    var childVersions = []
    for (var i = 0; i < object.children.length; i++) {
      var child = this._resolveObject(object.children[i])
      if (isMap(child)) childVersions.push(child.handle + ":" + child.version + ":" + child.sourceHash)
    }
    source = sha256(source + "|" + childVersions.join("|"))
  }
  return source
}

MiniAHistoryVM.prototype._representationCacheKey = function(object, level) {
  return object.handle + ":" + level + ":v" + object.version + ":r" + this.representationVersion + ":" + this._representationSourceHash(object, level)
}

MiniAHistoryVM.prototype._buildRepresentation = function(object, level) {
  var serialized = isString(object.content) ? object.content : stringify(object.content, __, "")
  var text = ""
  var complete = true
  if (level === "L0") text = "[" + object.handle + "] " + object.type.replace(/_/g, " ")
  if (level === "L1") {
    text = String(object.summary || "")
    if (text.length > 96) {
      text = text.substring(0, 96) + "..."
      complete = false
    }
    if (object.children.length > 0) {
      var childHandles = object.children.slice(0, 8)
      text += " Children: " + childHandles.join(", ")
      if (object.children.length > childHandles.length) text += " (and " + (object.children.length - childHandles.length) + " more)"
    }
  }
  if (level === "L2") {
    text = object.summary
    if (object.children.length > 0) {
      var childLines = []
      for (var c = 0; c < object.children.length && c < 8; c++) {
        var child = this._resolveObject(object.children[c])
        if (isMap(child)) childLines.push("- [" + child.handle + "] " + child.summary)
      }
      if (childLines.length > 0) text += "\nChildren:\n" + childLines.join("\n")
      if (object.children.length > childLines.length) text += "\n- ... " + (object.children.length - childLines.length) + " more children"
      var summaryChars = this._contentCodePoints(text)
      if (summaryChars.length > 1200) {
        text = summaryChars.slice(0, 1200).join("") + "\n[" + object.handle + " child summary truncated]"
        complete = false
      }
    }
  }
  if (level === "L3") {
    var chars = this._contentCodePoints(serialized)
    text = chars.slice(0, 1200).join("")
    if (chars.length > 1200) {
      text += "\n[" + object.handle + " detail truncated; expand L4 for exact content]"
      complete = false
    }
  }
  return {
    level: level,
    text: text,
    estimatedTokens: this.estimateTokens(text),
    sourceHash: object.sourceHash,
    representationSourceHash: this._representationSourceHash(object, level),
    objectVersion: object.version,
    representationVersion: this.representationVersion,
    generatedBy: "deterministic",
    complete: complete
  }
}

MiniAHistoryVM.prototype.getRepresentation = function(id, level) {
  if (!this.contextVirtualization) return { error: "Context virtualization is not enabled." }
  var object = this._resolveObject(id)
  if (!isMap(object) || object.branchId !== this.branchId) return { error: "Context object not found in the active conversation branch." }
  var normalized = this._representationLevel(level)
  this.metrics["representation_" + normalized.toLowerCase()]++
  object.lastAccess = new Date().toISOString()
  object.accessCount++
  if (normalized === "L4") return { id: object.id, handle: object.handle, level: normalized, content: object.content, estimatedTokens: object.estimatedOriginalTokens, exact: true, canonicalRef: object.canonicalRef }
  var key = this._representationCacheKey(object, normalized)
  var representation = this.representationCache[key]
  if (isMap(representation)) {
    this.metrics.representation_cache_hits++
  } else {
    this.metrics.representation_cache_misses++
    representation = this._buildRepresentation(object, normalized)
    this.representationCache[key] = representation
    try {
      io.writeFileString(this.representationCachePath, stringify({ key: key, representation: representation }, __, "") + "\n", __, true)
      this.metrics.representation_cache_writes++
    } catch(ignoreCacheWrite) {
      this.metrics.representation_cache_failures++
    }
  }
  return merge({ id: object.id, handle: object.handle }, representation, true)
}

MiniAHistoryVM.prototype.getChildren = function(id, limit, cursor) {
  if (!this.contextVirtualization) return { error: "Context virtualization is not enabled." }
  var object = this._resolveObject(id)
  if (!isMap(object) || object.branchId !== this.branchId) return { error: "Context object not found in the active conversation branch." }
  var cap = isNumber(limit) ? Math.max(1, Math.min(50, Math.floor(limit))) : 20
  var start = isNumber(cursor) ? Math.max(0, Math.floor(cursor)) : 0
  var children = []
  for (var i = 0; i < object.children.length; i++) {
    var child = this._resolveObject(object.children[i])
    if (isMap(child) && child.branchId === this.branchId) children.push({ id: child.id, handle: child.handle, kind: child.kind, type: child.type, summary: child.summary })
  }
  return { parent: object.handle, results: children.slice(start, start + cap), nextCursor: start + cap < children.length ? start + cap : __, total: children.length }
}

MiniAHistoryVM.prototype._indexedCandidates = function(terms, levels) {
  var scores = {}
  var matchedLevels = {}
  for (var l = 0; l < levels.length; l++) {
    var level = levels[l]
    var weight = level === "L0" ? 5 : (level === "L1" ? 4 : (level === "L2" ? 3 : (level === "L3" ? 2 : 1)))
    for (var t = 0; t < terms.length; t++) {
      var posting = this.contextIndexes[level][terms[t]]
      if (!isMap(posting)) continue
      Object.keys(posting).forEach(function(handle) {
        scores[handle] = (scores[handle] || 0) + weight
        if (!isString(matchedLevels[handle])) matchedLevels[handle] = level
      })
    }
  }
  return { scores: scores, matchedLevels: matchedLevels }
}

MiniAHistoryVM.prototype._contextPath = function(object) {
  var path = []
  var current = object
  var seen = {}
  while (isMap(current) && !seen[current.handle]) {
    seen[current.handle] = true
    path.unshift(current.handle)
    current = isString(current.parentId) ? this._resolveObject(current.parentId) : __
  }
  return path
}

MiniAHistoryVM.prototype._collectDescendants = function(object, maxDepth, target, depths) {
  var queue = [{ object: object, depth: 0 }]
  var seen = {}
  var targetCount = Object.keys(target).length
  while (queue.length > 0 && targetCount < 200) {
    var entry = queue.shift()
    if (!isMap(entry.object) || seen[entry.object.handle]) continue
    seen[entry.object.handle] = true
    if (!isMap(target[entry.object.handle])) targetCount++
    target[entry.object.handle] = entry.object
    depths[entry.object.handle] = entry.depth
    if (entry.depth >= maxDepth) continue
    for (var i = 0; i < entry.object.children.length; i++) {
      var child = this._resolveObject(entry.object.children[i])
      if (isMap(child) && child.branchId === this.branchId) queue.push({ object: child, depth: entry.depth + 1 })
    }
  }
}

MiniAHistoryVM.prototype.contextSearch = function(query, limit, cursor, options) {
  if (!this.contextVirtualization) return { error: "Context virtualization is not enabled." }
  this.metrics.hierarchy_searches++
  var opts = isMap(options) ? options : {}
  var q = isString(query) ? query.toLowerCase().trim() : ""
  var terms = this._tokenizeIndexText(q)
  var cap = isNumber(limit) ? Math.max(1, Math.min(50, Math.floor(limit))) : 10
  var start = isNumber(cursor) ? Math.max(0, Math.floor(cursor)) : 0
  var maxDepth = isNumber(opts.maxDepth) ? Math.max(0, Math.min(8, Math.floor(opts.maxDepth))) : 3
  var indexed = this._indexedCandidates(terms, ["L0", "L1", "L2"])
  var stage = "coarse"
  if (Object.keys(indexed.scores).length === 0 && terms.length > 0) {
    indexed = this._indexedCandidates(terms, ["L3", "L4"])
    stage = "detailed_fallback"
  }
  if (q.length > 0 && terms.length === 0) {
    stage = "detailed_scan"
    for (var e = this.objects.length - 1; e >= 0; e--) {
      var exactObject = this.objects[e]
      var exactText = isString(exactObject.content) ? exactObject.content : stringify(exactObject.content, __, "")
      if (exactObject.branchId === this.branchId && exactText.toLowerCase().indexOf(q) >= 0) {
        indexed.scores[exactObject.handle] = 1
        indexed.matchedLevels[exactObject.handle] = "L4"
      }
    }
  } else if (terms.length === 0) {
    for (var r = this.objects.length - 1; r >= 0; r--) {
      var root = this.objects[r]
      if (root.branchId === this.branchId && (!isString(root.parentId) || root.parentId.length === 0)) indexed.scores[root.handle] = 1
    }
  }

  var pool = {}
  var depths = {}
  var handles = Object.keys(indexed.scores).sort(function(a, b) { return indexed.scores[b] - indexed.scores[a] || a.localeCompare(b) })
  for (var h = 0; h < handles.length && h < 50; h++) {
    var candidate = this._resolveObject(handles[h])
    if (isMap(candidate) && candidate.branchId === this.branchId) this._collectDescendants(candidate, maxDepth, pool, depths)
  }

  var ranked = []
  var poolHandles = Object.keys(pool)
  var candidateTokens = 0
  for (var p = 0; p < poolHandles.length; p++) {
    var object = pool[poolHandles[p]]
    candidateTokens += object.estimatedOriginalTokens
    var serialized = isString(object.content) ? object.content : stringify(object.content, __, "")
    var lower = serialized.toLowerCase()
    var exactMatch = q.length > 0 && lower.indexOf(q) >= 0
    var termMatches = 0
    for (var x = 0; x < terms.length; x++) if (lower.indexOf(terms[x]) >= 0) termMatches++
    var score = indexed.scores[object.handle] || 0
    if (exactMatch) score += 20
    score += termMatches * 2
    if (q.length === 0 || score > 0 || depths[object.handle] > 0) ranked.push({ object: object, score: score, exactMatch: exactMatch, depth: depths[object.handle] || 0, matchedLevel: indexed.matchedLevels[object.handle] || "branch" })
  }
  ranked.sort(function(a, b) { return b.score - a.score || a.depth - b.depth || b.object.event.seq - a.object.event.seq })
  var selected = ranked.slice(start, start + cap)
  this.metrics.context_objects_considered += ranked.length
  this.metrics.context_objects_selected += selected.length
  this.metrics.context_candidate_tokens += candidateTokens
  for (var d = 0; d < selected.length; d++) this.metrics.hierarchy_depth_total += selected[d].depth
  var results = selected.map(function(item) {
    return {
      id: item.object.id,
      handle: item.object.handle,
      kind: item.object.kind,
      type: item.object.type,
      summary: item.object.summary,
      path: this._contextPath(item.object),
      matchedLevel: item.matchedLevel,
      exactMatch: item.exactMatch,
      score: item.score,
      estimatedTokens: item.object.estimatedOriginalTokens
    }
  }, this)
  return { query: query || "", stage: stage, results: results, nextCursor: start + cap < ranked.length ? start + cap : __, totalMatches: ranked.length, objectsConsidered: ranked.length, candidateTokens: candidateTokens }
}

MiniAHistoryVM.prototype._boundedTextResult = function(object, mode, text, metadata) {
  var chars = this._contentCodePoints(text)
  var cap = 16000
  var resultText = chars.slice(0, cap).join("")
  var result = merge({
    id: object.id,
    handle: object.handle,
    mode: mode,
    content: resultText,
    truncated: chars.length > cap,
    estimatedTokens: this.estimateTokens(resultText),
    provenance: "untrusted context object " + object.type
  }, isMap(metadata) ? metadata : {}, true)
  this.metrics.context_expansions++
  this.metrics.context_expansion_tokens += result.estimatedTokens
  object.accessCount++
  object.lastAccess = new Date().toISOString()
  return result
}

MiniAHistoryVM.prototype.readContext = function(id, request) {
  if (!this.contextVirtualization) return { error: "Context virtualization is not enabled." }
  var object = this._resolveObject(id)
  if (!isMap(object) || object.branchId !== this.branchId) return { error: "Context object not found in the active conversation branch." }
  var opts = isMap(request) ? request : {}
  var serialized = isString(object.content) ? object.content : stringify(object.content, __, "")
  var lines = serialized.split(/\r?\n/)

  if (isMap(opts.lines)) {
    this.metrics.range_reads++
    var start = isNumber(opts.lines.start) ? Math.max(1, Math.floor(opts.lines.start)) : 1
    var end = isNumber(opts.lines.end) ? Math.max(start, Math.floor(opts.lines.end)) : start + 99
    end = Math.min(lines.length, start + 399, end)
    return this._boundedTextResult(object, "lines", lines.slice(start - 1, end).join("\n"), { startLine: start, endLine: end, totalLines: lines.length })
  }

  if (isString(opts.section) && opts.section.trim().length > 0) {
    this.metrics.section_reads++
    var wanted = opts.section.toLowerCase().trim()
    var sectionStart = -1
    var sectionDepth = 7
    var sectionEnd = lines.length
    for (var i = 0; i < lines.length; i++) {
      var heading = lines[i].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
      if (!heading) continue
      if (sectionStart < 0 && heading[2].toLowerCase().trim() === wanted) {
        sectionStart = i
        sectionDepth = heading[1].length
      } else if (sectionStart >= 0 && heading[1].length <= sectionDepth) {
        sectionEnd = i
        break
      }
    }
    if (sectionStart < 0) return { error: "Section not found.", id: object.id, handle: object.handle }
    return this._boundedTextResult(object, "section", lines.slice(sectionStart, sectionEnd).join("\n"), { section: opts.section, startLine: sectionStart + 1, endLine: sectionEnd })
  }

  if (isString(opts.jsonPath) && opts.jsonPath.trim().length > 0) {
    this.metrics.json_path_reads++
    var value
    try { value = isString(object.content) ? jsonParse(object.content, __, __, true) : object.content } catch(ignoreInvalidJson) { return { error: "Context object does not contain valid JSON." } }
    var normalizedPath = opts.jsonPath.replace(/\[(\d+)\]/g, ".$1")
    var segments = normalizedPath.split(".").filter(function(segment) { return segment.length > 0 })
    for (var s = 0; s < segments.length; s++) {
      if (!segments[s].match(/^[A-Za-z0-9_$-]+$/)) return { error: "Invalid JSON path." }
      if (!(isMap(value) || isArray(value)) || !Object.prototype.hasOwnProperty.call(value, segments[s])) return { error: "JSON path not found." }
      value = value[segments[s]]
    }
    return this._boundedTextResult(object, "json_path", isString(value) ? value : stringify(value, __, ""), { jsonPath: opts.jsonPath })
  }

  if (isString(opts.query) && opts.query.length > 0) {
    this.metrics.range_reads++
    var needle = opts.query.toLowerCase()
    var matches = []
    for (var m = 0; m < lines.length && matches.length < 50; m++) if (lines[m].toLowerCase().indexOf(needle) >= 0) matches.push((m + 1) + ":" + lines[m])
    return this._boundedTextResult(object, "grep", matches.join("\n"), { query: opts.query, matches: matches.length })
  }

  this.metrics.range_reads++
  var offset = isNumber(opts.offset) ? Math.max(0, Math.floor(opts.offset)) : 0
  var limit = isNumber(opts.limit) ? Math.max(1, Math.min(16000, Math.floor(opts.limit))) : 4000
  var chars = this._contentCodePoints(serialized)
  var endOffset = Math.min(chars.length, offset + limit)
  return this._boundedTextResult(object, "range", chars.slice(offset, endOffset).join(""), { offset: offset, limit: limit, total: chars.length, nextCursor: endOffset < chars.length ? endOffset : __ })
}

MiniAHistoryVM.prototype._contentCodePoints = function(value) {
  var text = isString(value) ? value : stringify(value, __, "")
  var chars = []
  for (var i = 0; i < text.length; i++) {
    var first = text.charCodeAt(i)
    if (first >= 0xD800 && first <= 0xDBFF && i + 1 < text.length) chars.push(text.substring(i, ++i + 1))
    else chars.push(text.charAt(i))
  }
  return chars
}

MiniAHistoryVM.prototype.search = function(query, limit, cursor) {
  this.metrics.searches++
  var q = isString(query) ? query.toLowerCase().trim() : ""
  var cap = isNumber(limit) ? Math.max(1, Math.min(50, Math.floor(limit))) : 10
  var start = isNumber(cursor) ? Math.max(0, Math.floor(cursor)) : 0
  var candidates = []
  for (var i = this.objects.length - 1; i >= 0; i--) {
    var object = this.objects[i]
    if (object.branchId !== this.branchId) continue
    var haystack = (object.summary + "\n" + (isString(object.content) ? object.content : stringify(object.content, __, ""))).toLowerCase()
    if (q.length === 0 || haystack.indexOf(q) >= 0) candidates.push(object)
  }
  var page = candidates.slice(start, start + cap).map(function(object) {
    return { id: object.id, handle: object.handle, kind: object.kind, type: object.type, summary: object.summary, originalBytes: object.originalBytes, estimatedTokens: object.estimatedOriginalTokens }
  })
  return { query: query || "", results: page, nextCursor: start + cap < candidates.length ? start + cap : __, totalMatches: candidates.length }
}

MiniAHistoryVM.prototype.get = function(id, offset, limit) {
  this.metrics.reads++
  var object = this._resolveObject(id)
  if (!isMap(object) || object.branchId !== this.branchId) return { error: "History object not found in the active conversation branch." }
  var chars = this._contentCodePoints(object.content)
  var start = isNumber(offset) ? Math.max(0, Math.floor(offset)) : 0
  var cap = isNumber(limit) ? Math.max(1, Math.min(16000, Math.floor(limit))) : 4000
  var end = Math.min(chars.length, start + cap)
  object.accessCount++
  return {
    id: object.id,
    handle: object.handle,
    type: object.type,
    units: "unicode_code_points",
    offset: start,
    limit: cap,
    total: chars.length,
    content: chars.slice(start, end).join(""),
    truncated: end < chars.length,
    nextCursor: end < chars.length ? end : __,
    provenance: "untrusted historical " + object.type
  }
}

MiniAHistoryVM.prototype.expand = function(id, range, currentStep) {
  var object = this._resolveObject(id)
  if (!isMap(object) || object.branchId !== this.branchId) return { error: "History object not found in the active conversation branch." }
  var step = isNumber(currentStep) ? currentStep : 0
  var requested = isMap(range) ? range : {}
  var boundedRange = {
    offset: isNumber(requested.offset) ? Math.max(0, Math.floor(requested.offset)) : 0,
    limit: isNumber(requested.limit) ? Math.max(1, Math.min(12000, Math.floor(requested.limit))) : 12000
  }
  this.expansions[object.id] = { range: boundedRange, untilStep: step + 2 }
  object.temporaryPinUntilStep = step + 2
  object.lastAccessStep = step
  object.accessCount++
  this.metrics.promotions++
  return { ok: true, id: object.id, handle: object.handle, range: boundedRange, untilStep: step + 2 }
}

MiniAHistoryVM.prototype._expandedProviderEntry = function(object, expansion) {
  if (!isMap(object) || !isMap(object.content)) return __
  var entry = merge({}, object.content, true)
  if (!isString(entry.content)) return __
  var range = isMap(expansion) && isMap(expansion.range) ? expansion.range : {}
  var chars = this._contentCodePoints(entry.content)
  var offset = isNumber(range.offset) ? Math.max(0, Math.floor(range.offset)) : 0
  var limit = isNumber(range.limit) ? Math.max(1, Math.min(12000, Math.floor(range.limit))) : 12000
  var end = Math.min(chars.length, offset + limit)
  entry.content = chars.slice(offset, end).join("")
  if (offset > 0 || end < chars.length) {
    entry.content += "\n[HISTORY_VM_RANGE " + object.id + " offset=" + offset + " next=" + (end < chars.length ? end : "end") + "]"
  }
  return entry
}

MiniAHistoryVM.prototype._providerObjectForIndex = function(index) {
  for (var i = this.objects.length - 1; i >= 0; i--) {
    var object = this.objects[i]
    if (object.event.sourceKind === "provider_message" && isMap(object.event.metadata) && object.event.metadata.providerIndex === index) return object
  }
  return __
}

MiniAHistoryVM.prototype.materializeConversation = function(conversation) {
  if (!isArray(conversation)) return conversation
  var materialized = []
  for (var i = 0; i < conversation.length; i++) {
    var entry = conversation[i]
    if (!isMap(entry) || !isString(entry.content)) {
      materialized.push(entry)
      continue
    }
    var match = entry.content.match(/^\[HISTORY_VM_REFERENCE (h\d+)\]/) || entry.content.match(/\[HISTORY_VM_RANGE (h\d+) /)
    var object = match ? this.objectById[match[1]] : __
    if (isMap(object) && object.branchId === this.branchId && isMap(object.content)) materialized.push(merge({}, object.content, true))
    else materialized.push(entry)
  }
  return materialized
}

MiniAHistoryVM.prototype.projectConversation = function(conversation, options) {
  if (!isArray(conversation)) return conversation
  var opts = isMap(options) ? options : {}
  var currentStep = isNumber(opts.currentStep) ? opts.currentStep : conversation.length
  var projected = []
  var baselineTokens = this.estimateTokens(stringify(conversation, __, ""))
  for (var i = 0; i < conversation.length; i++) {
    var entry = conversation[i]
    if (!isMap(entry)) { projected.push(entry); continue }
    var role = isString(entry.role) ? entry.role.toLowerCase() : ""
    var contentText = isString(entry.content) ? entry.content : stringify(entry.content, __, "")
    if (contentText.indexOf("[HISTORY_VM_REFERENCE ") === 0) {
      var refMatch = contentText.match(/^\[HISTORY_VM_REFERENCE (h\d+)\]/)
      var refObject = refMatch ? this.objectById[refMatch[1]] : __
      var refExpansion = isMap(refObject) ? this.expansions[refObject.id] : __
      var expandedEntry = isMap(refObject) && refObject.branchId === this.branchId && isMap(refExpansion) && refExpansion.untilStep >= currentStep
        ? this._expandedProviderEntry(refObject, refExpansion)
        : __
      if (isMap(expandedEntry)) {
        projected.push(expandedEntry)
        refObject.representation = "warm"
      } else {
        projected.push(entry)
      }
      continue
    }
    var object = this._providerObjectForIndex(i)
    var protectedEntry = role === "system" || role === "developer" || role === "user" || !isString(entry.content) || i >= conversation.length - 4 || isArray(entry.tool_calls) || isDef(entry.tool_call_id) && i >= conversation.length - 6
    var expanded = isMap(object) && isMap(this.expansions[object.id]) && this.expansions[object.id].untilStep >= currentStep
    var eligible = isMap(object) && object.estimatedOriginalTokens > 2000 && conversation.length - i > 2 && !protectedEntry && !expanded
    if (!eligible) {
      projected.push(entry)
      if (isMap(object)) object.representation = expanded ? "warm" : "hot"
      continue
    }
    var replacement = merge({}, entry, true)
    replacement.content = "[HISTORY_VM_REFERENCE " + object.id + "] " + object.summary + " Use history_get for exact bounded reads."
    projected.push(replacement)
    object.representation = "cold"
    object.lastTransitionStep = currentStep
    this.metrics.collapses++
  }
  var projectedTokens = this.estimateTokens(stringify(projected, __, ""))
  this.metrics.last_baseline_tokens = baselineTokens
  this.metrics.last_projected_tokens = projectedTokens
  this.metrics.estimated_inline_tokens = projectedTokens
  this.metrics.estimated_tokens_saved += baselineTokens - projectedTokens
  return projected
}

MiniAHistoryVM.prototype.diagnostics = function() {
  var states = { hot: 0, warm: 0, cold: 0, frozen: 0 }
  this.objects.forEach(function(object) { states[object.representation] = (states[object.representation] || 0) + 1 })
  var metrics = merge({}, this.metrics, true)
  metrics.hierarchy_depth_avg = metrics.context_objects_selected > 0 ? metrics.hierarchy_depth_total / metrics.context_objects_selected : 0
  metrics.index_terms = {
    L0: Object.keys(this.contextIndexes.L0).length,
    L1: Object.keys(this.contextIndexes.L1).length,
    L2: Object.keys(this.contextIndexes.L2).length,
    L3: Object.keys(this.contextIndexes.L3).length,
    L4: Object.keys(this.contextIndexes.L4).length
  }
  return {
    active: this.enabled && !this.degraded,
    shadow: this.shadow,
    contextVirtualization: this.contextVirtualization,
    contextSchemaVersion: this.contextSchemaVersion,
    representationVersion: this.representationVersion,
    mode: this.mode,
    storePath: this.storePath,
    conversationId: this.conversationId,
    branchId: this.branchId,
    degraded: this.degraded,
    degradedReason: this.degradedReason,
    states: states,
    metrics: metrics
  }
}

MiniAHistoryVM.prototype.rewind = function(sequence) {
  var target = isNumber(sequence) ? Math.max(0, Math.floor(sequence)) : this._seq
  this.branchId = "branch-" + target + "-" + sha1(String(nowNano())).substring(0, 8)
  this._providerCaptureCount = 0
  return this.append("branch_control", { headSequence: target }, { branchId: this.branchId, status: "completed" })
}

MiniAHistoryVM.prototype.deleteOwnedStore = function() {
  if (this.storePath.length === 0 || !io.fileExists(this.storePath)) return true
  var remove = function(file) {
    if (file.isDirectory()) {
      var children = file.listFiles()
      for (var i = 0; isDef(children) && i < children.length; i++) remove(children[i])
    }
    if (!file.delete()) throw new Error("Unable to delete " + String(file.getAbsolutePath()))
  }
  remove(new java.io.File(this.storePath))
  return true
}
