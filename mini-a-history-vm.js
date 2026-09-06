// Author: Nuno Aguiar
// License: Apache 2.0
// Description: Durable, bounded virtual history for Mini-A conversations.

var MiniAHistoryVM = function(options) {
  var opts = isMap(options) ? options : {}
  this.schemaVersion = 1
  this.normalizerVersion = 1
  this.policyVersion = 1
  this.enabled = opts.enabled === true
  this.shadow = opts.shadow === true
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
  this.events = []
  this.objects = []
  this.objectById = {}
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
    last_baseline_tokens: 0
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
    return true
  } catch(e) {
    return this._fail(__miniAErrMsg(e))
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

MiniAHistoryVM.prototype._eventType = function(event) {
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
  var object = {
    schemaVersion: this.schemaVersion,
    id: "h" + ("000000" + event.seq).slice(-6),
    conversationId: this.conversationId,
    branchId: event.branchId,
    sessionId: event.sessionId,
    agentId: event.agentId,
    kind: "history",
    type: this._eventType(event),
    sourceRefs: [event.eventId],
    createdStep: isMap(event.metadata) ? event.metadata.stepLabel : __,
    completedStep: isMap(event.metadata) ? event.metadata.stepLabel : __,
    lastAccessStep: __,
    accessCount: 0,
    recentAccessSteps: [],
    explicitPin: isMap(event.metadata) && event.metadata.explicitPin === true,
    temporaryPinUntilStep: __,
    unresolved: event.status !== "completed" || (isMap(event.metadata) && event.metadata.unresolved === true),
    dependencyRefs: isMap(event.metadata) && isArray(event.metadata.dependencyRefs) ? event.metadata.dependencyRefs : [],
    protectionReason: __,
    originalBytes: new java.lang.String(serialized).getBytes(java.nio.charset.StandardCharsets.UTF_8).length,
    estimatedOriginalTokens: this.estimateTokens(serialized),
    representation: "hot",
    lastTransitionStep: isMap(event.metadata) ? event.metadata.stepLabel : __,
    artifactRef: this.journalPath + "#" + event.seq,
    sourceHash: event.eventHash,
    summary: this._summary(event, serialized),
    summaryMetadata: { generatedBy: "deterministic", version: 1, coverage: "partial" },
    content: event.content,
    event: event
  }
  this.objects.push(object)
  this.objectById[object.id] = object
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
  this._providerCaptureCount = 0
  this.metrics.estimated_original_tokens = 0
  for (var i = 0; i < this.events.length; i++) this._indexEvent(this.events[i])
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
    return { id: object.id, type: object.type, summary: object.summary, originalBytes: object.originalBytes, estimatedTokens: object.estimatedOriginalTokens }
  })
  return { query: query || "", results: page, nextCursor: start + cap < candidates.length ? start + cap : __, totalMatches: candidates.length }
}

MiniAHistoryVM.prototype.get = function(id, offset, limit) {
  this.metrics.reads++
  var object = this.objectById[id]
  if (!isMap(object) || object.branchId !== this.branchId) return { error: "History object not found in the active conversation branch." }
  var chars = this._contentCodePoints(object.content)
  var start = isNumber(offset) ? Math.max(0, Math.floor(offset)) : 0
  var cap = isNumber(limit) ? Math.max(1, Math.min(16000, Math.floor(limit))) : 4000
  var end = Math.min(chars.length, start + cap)
  object.accessCount++
  return {
    id: id,
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
  var object = this.objectById[id]
  if (!isMap(object) || object.branchId !== this.branchId) return { error: "History object not found in the active conversation branch." }
  var step = isNumber(currentStep) ? currentStep : 0
  var requested = isMap(range) ? range : {}
  var boundedRange = {
    offset: isNumber(requested.offset) ? Math.max(0, Math.floor(requested.offset)) : 0,
    limit: isNumber(requested.limit) ? Math.max(1, Math.min(12000, Math.floor(requested.limit))) : 12000
  }
  this.expansions[id] = { range: boundedRange, untilStep: step + 2 }
  object.temporaryPinUntilStep = step + 2
  object.lastAccessStep = step
  object.accessCount++
  this.metrics.promotions++
  return { ok: true, id: id, range: boundedRange, untilStep: step + 2 }
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
  return {
    active: this.enabled && !this.degraded,
    shadow: this.shadow,
    mode: this.mode,
    storePath: this.storePath,
    conversationId: this.conversationId,
    branchId: this.branchId,
    degraded: this.degraded,
    degradedReason: this.degradedReason,
    states: states,
    metrics: merge({}, this.metrics, true)
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
