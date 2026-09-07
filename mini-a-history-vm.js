// Author: Nuno Aguiar
// License: Apache 2.0
// Description: Durable, bounded virtual history for Mini-A conversations.

var MiniAHistoryVM = function(options) {
  var opts = isMap(options) ? options : {}
  this.schemaVersion = 1
  this.normalizerVersion = 1
  this.policyVersion = 1
  this.contextSchemaVersion = 2
  this.representationVersion = 2
  this.summarizerVersion = isString(opts.summarizerVersion) ? opts.summarizerVersion : "deterministic-v1"
  this.semanticCompression = opts.semanticCompression === true && isFunction(opts.semanticCompressor)
  this.semanticCompressor = this.semanticCompression ? opts.semanticCompressor : __
  this.semanticCompressionMinTokens = isNumber(opts.semanticCompressionMinTokens) ? Math.max(500, Math.floor(opts.semanticCompressionMinTokens)) : 4000
  this.enabled = opts.enabled === true
  this.shadow = opts.shadow === true
  this.contextVirtualization = opts.contextVirtualization === true && this.enabled
  this.contextVirtualizationShadow = opts.contextVirtualizationShadow === true && this.contextVirtualization
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
  this.contextGraph = { outgoing: {}, incoming: {} }
  this.supersededBy = {}
  this.contextWorkingSets = {}
  this.contextPrefixCache = {}
  this.contextVirtualizationShadowLast = __
  this.contextVirtualizationActiveLast = __
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
    json_path_reads: 0,
    context_assemblies: 0,
    context_materialized_tokens: 0,
    addressable_relevant_tokens: 0,
    effective_context_ratio: 0,
    context_budget_utilization: 0,
    dependency_prefetches: 0,
    budget_overflows: 0,
    graph_edges: 0,
    graph_retrievals: 0,
    graph_nodes_visited: 0,
    superseded_objects: 0,
    stale_suppressed: 0,
    heat_propagations: 0,
    consumer_views_executor: 0,
    consumer_views_planner: 0,
    consumer_views_advisor: 0,
    consumer_views_validator: 0,
    consumer_views_delegate: 0,
    consumer_views_summarizer: 0,
    consumer_views_dreamer: 0,
    consumer_policy_fallbacks: 0,
    context_deltas: 0,
    context_delta_added: 0,
    context_delta_removed: 0,
    context_delta_promoted: 0,
    context_delta_demoted: 0,
    context_delta_modified: 0,
    context_delta_unchanged: 0,
    context_serialization_cache_hits: 0,
    context_serialization_cache_misses: 0,
    stable_prefix_tokens: 0,
    context_virtualization_shadow_assemblies: 0,
    context_virtualization_shadow_actual_tokens: 0,
    context_virtualization_shadow_projected_tokens: 0,
    context_virtualization_shadow_expected_savings: 0,
    context_virtualization_shadow_object_differences: 0,
    context_virtualization_active_assemblies: 0,
    context_virtualization_active_input_tokens: 0,
    context_virtualization_active_output_tokens: 0,
    context_virtualization_active_tokens_saved: 0,
    context_virtualization_active_references: 0,
    structural_compressions: 0,
    structural_json_compressions: 0,
    structural_code_compressions: 0,
    structural_log_compressions: 0,
    semantic_compressions: 0,
    semantic_compression_failures: 0,
    summary_reuse: 0
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
    if (text.indexOf("[CONTEXT_OBJECT ") === 0) continue
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
    edges: this._normalizeContextEdges(meta),
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
    obsolete: false,
    supersededBy: __,
    content: event.content,
    event: event
  }
  this.objects.push(object)
  this.objectById[object.id] = object
  this.objectByHandle[object.handle] = object
  if (this.contextVirtualization) this._linkHierarchyObject(object)
  if (this.contextVirtualization) this._indexContextObject(object, serialized)
  if (this.contextVirtualization) this._indexGraphObject(object)
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
  this.contextGraph = { outgoing: {}, incoming: {} }
  this.supersededBy = {}
  this.contextWorkingSets = {}
  this.contextPrefixCache = {}
  this._pendingChildren = {}
  this._providerCaptureCount = 0
  this.metrics.estimated_original_tokens = 0
  this.metrics.hierarchy_roots = 0
  this.metrics.hierarchy_links = 0
  this.metrics.graph_edges = 0
  this.metrics.superseded_objects = 0
  for (var i = 0; i < this.events.length; i++) this._indexEvent(this.events[i])
}

MiniAHistoryVM.prototype._resolveObject = function(id) {
  return this.objectById[id] || this.objectByHandle[id]
}

MiniAHistoryVM.prototype._normalizeContextEdges = function(metadata) {
  var meta = isMap(metadata) ? metadata : {}
  var allowed = ["depends_on", "derived_from", "supports", "contradicts", "supersedes", "produced", "references", "resolved_by", "parent_of", "related_to"]
  var edges = []
  var seen = {}
  var add = function(type, target, details) {
    var normalizedType = isString(type) ? type.toLowerCase().trim() : ""
    if (allowed.indexOf(normalizedType) < 0 || !isString(target) || target.trim().length === 0) return
    var normalizedTarget = target.trim()
    var key = normalizedType + "|" + normalizedTarget
    if (seen[key]) return
    seen[key] = true
    edges.push({
      type: normalizedType,
      target: normalizedTarget,
      confidence: isMap(details) && isNumber(details.confidence) ? Math.max(0, Math.min(1, details.confidence)) : 1,
      provenance: isMap(details) && isMap(details.provenance) ? merge({}, details.provenance, true) : __
    })
  }
  if (isArray(meta.edges)) for (var e = 0; e < meta.edges.length; e++) if (isMap(meta.edges[e])) add(meta.edges[e].type, meta.edges[e].target, meta.edges[e])
  var mappings = [
    { keys: ["dependencies", "dependencyRefs"], type: "depends_on" },
    { keys: ["related"], type: "related_to" },
    { keys: ["derivedFrom", "derived_from"], type: "derived_from" },
    { keys: ["supports"], type: "supports" },
    { keys: ["contradicts"], type: "contradicts" },
    { keys: ["supersedes"], type: "supersedes" },
    { keys: ["produced"], type: "produced" },
    { keys: ["references"], type: "references" },
    { keys: ["resolvedBy", "resolved_by"], type: "resolved_by" }
  ]
  for (var m = 0; m < mappings.length; m++) for (var k = 0; k < mappings[m].keys.length; k++) {
    var refs = meta[mappings[m].keys[k]]
    if (isString(refs)) refs = [refs]
    if (isArray(refs)) for (var r = 0; r < refs.length; r++) add(mappings[m].type, refs[r])
  }
  return edges
}

MiniAHistoryVM.prototype._addGraphEdge = function(source, edge) {
  if (!isMap(source) || !isMap(edge) || !isString(edge.target)) return false
  var targetObject = this._resolveObject(edge.target)
  var target = isMap(targetObject) ? targetObject.handle : edge.target
  var normalized = { type: edge.type, source: source.handle, target: target, confidence: edge.confidence, provenance: edge.provenance }
  if (!isArray(this.contextGraph.outgoing[source.handle])) this.contextGraph.outgoing[source.handle] = []
  var outgoing = this.contextGraph.outgoing[source.handle]
  for (var i = 0; i < outgoing.length; i++) if (outgoing[i].type === normalized.type && outgoing[i].target === normalized.target) return false
  outgoing.push(normalized)
  if (!isArray(this.contextGraph.incoming[target])) this.contextGraph.incoming[target] = []
  this.contextGraph.incoming[target].push(normalized)
  this.metrics.graph_edges++
  if (normalized.type === "supersedes" && (!isMap(targetObject) || targetObject.branchId === source.branchId)) {
    this.supersededBy[target] = source.handle
    if (isMap(targetObject) && !targetObject.obsolete) {
      targetObject.obsolete = true
      targetObject.supersededBy = source.handle
      this.metrics.superseded_objects++
    }
  }
  return true
}

MiniAHistoryVM.prototype._indexGraphObject = function(object) {
  if (!this.contextVirtualization || !isMap(object)) return
  var replacement = this.supersededBy[object.handle] || this.supersededBy[object.id]
  var replacementObject = this._resolveObject(replacement)
  if (isString(replacement) && isMap(replacementObject) && replacementObject.branchId === object.branchId && !object.obsolete) {
    object.obsolete = true
    object.supersededBy = replacement
    this.metrics.superseded_objects++
  }
  for (var i = 0; i < object.edges.length; i++) this._addGraphEdge(object, object.edges[i])
}

MiniAHistoryVM.prototype._graphEdgesForObject = function(object, direction, edgeTypes) {
  var edges = []
  var seen = {}
  var accept = function(edge) {
    if (!isMap(edge) || isArray(edgeTypes) && edgeTypes.length > 0 && edgeTypes.indexOf(edge.type) < 0) return
    var key = edge.type + "|" + edge.source + "|" + edge.target
    if (!seen[key]) { seen[key] = true; edges.push(edge) }
  }
  if (direction !== "incoming") {
    var outgoing = this.contextGraph.outgoing[object.handle]
    if (isArray(outgoing)) for (var o = 0; o < outgoing.length; o++) accept(outgoing[o])
  }
  if (direction !== "outgoing") {
    var aliases = [object.handle, object.id]
    for (var a = 0; a < aliases.length; a++) {
      var incoming = this.contextGraph.incoming[aliases[a]]
      if (isArray(incoming)) for (var i = 0; i < incoming.length; i++) accept(incoming[i])
    }
  }
  return edges
}

MiniAHistoryVM.prototype.getRelated = function(id, options) {
  if (!this.contextVirtualization) return { error: "Context virtualization is not enabled." }
  var start = this._resolveObject(id)
  if (!isMap(start) || start.branchId !== this.branchId) return { error: "Context object not found in the active conversation branch." }
  var opts = isMap(options) ? options : {}
  var direction = opts.direction === "incoming" || opts.direction === "outgoing" ? opts.direction : "both"
  var edgeTypes = isArray(opts.edgeTypes) ? opts.edgeTypes.map(function(type) { return String(type).toLowerCase() }) : []
  var maxDepth = isNumber(opts.maxDepth) ? Math.max(1, Math.min(4, Math.floor(opts.maxDepth))) : 2
  var limit = isNumber(opts.limit) ? Math.max(1, Math.min(50, Math.floor(opts.limit))) : 20
  var includeObsolete = opts.includeObsolete === true
  var queue = [{ object: start, depth: 0, path: [start.handle] }]
  var seen = {}
  seen[start.handle] = true
  var results = []
  while (queue.length > 0 && results.length < limit) {
    var current = queue.shift()
    if (current.depth >= maxDepth) continue
    var edges = this._graphEdgesForObject(current.object, direction, edgeTypes)
    for (var e = 0; e < edges.length && results.length < limit; e++) {
      var neighborRef = edges[e].source === current.object.handle ? edges[e].target : edges[e].source
      var neighbor = this._resolveObject(neighborRef)
      if (!isMap(neighbor) || neighbor.branchId !== this.branchId || seen[neighbor.handle]) continue
      seen[neighbor.handle] = true
      var path = current.path.concat([neighbor.handle])
      if (!neighbor.obsolete || includeObsolete) {
        results.push({
          id: neighbor.id,
          handle: neighbor.handle,
          kind: neighbor.kind,
          type: neighbor.type,
          summary: neighbor.summary,
          obsolete: neighbor.obsolete,
          supersededBy: neighbor.supersededBy,
          depth: current.depth + 1,
          via: { type: edges[e].type, source: edges[e].source, target: edges[e].target, confidence: edges[e].confidence, provenance: edges[e].provenance },
          path: path,
          provenance: neighbor.provenance
        })
        queue.push({ object: neighbor, depth: current.depth + 1, path: path })
      } else {
        this.metrics.stale_suppressed++
      }
    }
  }
  this.metrics.graph_retrievals++
  this.metrics.graph_nodes_visited += Object.keys(seen).length
  this._touchObject(start, 0.5, 1)
  return { id: start.id, handle: start.handle, direction: direction, edgeTypes: edgeTypes, results: results, truncated: queue.length > 0 }
}

MiniAHistoryVM.prototype._touchObject = function(object, amount, maxDepth) {
  if (!isMap(object)) return
  var base = isNumber(amount) ? Math.max(0, amount) : 1
  var depthLimit = isNumber(maxDepth) ? Math.max(0, Math.min(2, Math.floor(maxDepth))) : 2
  object.heat = Math.min(100, object.heat + base)
  object.lastAccess = new Date().toISOString()
  object.accessCount++
  if (!this.contextVirtualization || depthLimit === 0 || base === 0) return
  var queue = [{ object: object, depth: 0, heat: base }]
  var seen = {}
  seen[object.handle] = true
  while (queue.length > 0) {
    var current = queue.shift()
    if (current.depth >= depthLimit) continue
    var edges = this._graphEdgesForObject(current.object, "both", [])
    for (var i = 0; i < edges.length; i++) {
      var neighborRef = edges[i].source === current.object.handle ? edges[i].target : edges[i].source
      var neighbor = this._resolveObject(neighborRef)
      if (!isMap(neighbor) || neighbor.branchId !== this.branchId || neighbor.obsolete || seen[neighbor.handle]) continue
      seen[neighbor.handle] = true
      var propagated = current.heat * 0.5 * (isNumber(edges[i].confidence) ? edges[i].confidence : 1)
      if (propagated <= 0) continue
      neighbor.heat = Math.min(100, neighbor.heat + propagated)
      this.metrics.heat_propagations++
      queue.push({ object: neighbor, depth: current.depth + 1, heat: propagated })
    }
  }
}

MiniAHistoryVM.prototype._addChild = function(parent, childHandle) {
  if (!isMap(parent) || !isString(childHandle)) return false
  var added = parent.children.indexOf(childHandle) < 0
  if (added) {
    parent.children.push(childHandle)
    this.metrics.hierarchy_links++
  }
  var parentEdge = { type: "parent_of", target: childHandle, confidence: 1, provenance: __ }
  var hasParentEdge = false
  for (var i = 0; i < parent.edges.length; i++) if (parent.edges[i].type === "parent_of" && parent.edges[i].target === childHandle) { hasParentEdge = true; break }
  if (!hasParentEdge) parent.edges.push(parentEdge)
  this._addGraphEdge(parent, parentEdge)
  if (added || !hasParentEdge) this._indexContextObject(parent, __, ["L1", "L2"])
  return added
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
  return object.handle + ":" + level + ":v" + object.version + ":r" + this.representationVersion + ":s" + this.summarizerVersion + ":" + this._representationSourceHash(object, level)
}

MiniAHistoryVM.prototype._structuralRepresentation = function(object, level, serialized) {
  var type = isString(object.type) ? object.type.toLowerCase() : ""
  var source = isString(serialized) ? serialized : ""
  var parsed = __
  var jsonLike = type.indexOf("json") >= 0 || source.match(/^\s*[\[{]/) && (object.kind === "artifact" || object.kind === "attachment" || type === "tool_exchange")
  if (jsonLike) {
    try { parsed = jsonParse(source, __, __, true) } catch(ignoreJson) {}
    if (isMap(parsed) || isArray(parsed)) {
      var root = isArray(parsed) ? "array[" + parsed.length + "]" : "object"
      var values = isArray(parsed) ? parsed.slice(0, level === "L3" ? 3 : 1) : parsed
      var keys = isMap(values) ? Object.keys(values).slice(0, level === "L3" ? 30 : 15) : []
      var schema = []
      for (var k = 0; k < keys.length; k++) {
        var value = values[keys[k]]
        schema.push(keys[k] + ": " + (isArray(value) ? "array[" + value.length + "]" : (isMap(value) ? "object{" + Object.keys(value).slice(0, 8).join(", ") + "}" : typeof value)))
      }
      var jsonText = "JSON " + object.handle + " " + root + (schema.length > 0 ? "\nSchema:\n- " + schema.join("\n- ") : "")
      if (level === "L3" && isArray(parsed) && parsed.length > 0) jsonText += "\nRepresentative records:\n" + stringify(parsed.slice(0, 3), __, "")
      return { kind: "json", text: jsonText }
    }
  }
  var codeLike = type.indexOf("code") >= 0 || type.indexOf("source") >= 0 || source.match(/(?:^|\n)\s*(?:function|class|var|let|const|def|import|package|public|private)\b/)
  if (codeLike) {
    var codeLines = source.split(/\r?\n/)
    var signatures = []
    for (var c = 0; c < codeLines.length && signatures.length < (level === "L3" ? 40 : 20); c++) {
      var line = codeLines[c].trim()
      if (line.match(/^(?:import|package|class|interface|function|def|public\s+|private\s+|protected\s+|[A-Za-z_$][\w$]*\s*=\s*function\b)/)) signatures.push((c + 1) + ": " + line.substring(0, 240))
    }
    if (signatures.length > 0) return { kind: "code", text: "Code " + object.handle + " (" + codeLines.length + " lines)\nImports/signatures:\n- " + signatures.join("\n- ") }
  }
  var logLike = type.indexOf("log") >= 0 || source.match(/(?:^|\n).*(?:ERROR|WARN|FATAL|Exception)/)
  if (logLike) {
    var logLines = source.split(/\r?\n/)
    var errors = [], warnings = []
    for (var l = 0; l < logLines.length; l++) {
      if (/(?:ERROR|FATAL|Exception)/i.test(logLines[l]) && errors.length < 12) errors.push((l + 1) + ": " + logLines[l].substring(0, 240))
      else if (/WARN/i.test(logLines[l]) && warnings.length < 8) warnings.push((l + 1) + ": " + logLines[l].substring(0, 240))
    }
    var logText = "Log " + object.handle + " (" + logLines.length + " lines; errors=" + errors.length + "; warnings=" + warnings.length + ")"
    var samples = errors.concat(level === "L3" ? warnings : []).slice(0, level === "L3" ? 20 : 8)
    if (samples.length > 0) logText += "\nImportant events:\n- " + samples.join("\n- ")
    return { kind: "log", text: logText }
  }
  return __
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
    if (object.edges.length > 0) text += " Links: " + object.edges.length
  }
  if (level === "L2") {
    var structuralSummary = this._structuralRepresentation(object, level, serialized)
    text = isMap(structuralSummary) ? structuralSummary.text : object.summary
    if (object.children.length > 0) {
      var childLines = []
      for (var c = 0; c < object.children.length && c < 8; c++) {
        var child = this._resolveObject(object.children[c])
        if (isMap(child)) childLines.push("- [" + child.handle + "] " + child.summary)
      }
      if (childLines.length > 0) text += "\nChildren:\n" + childLines.join("\n")
      if (object.children.length > childLines.length) text += "\n- ... " + (object.children.length - childLines.length) + " more children"
    }
    if (object.edges.length > 0) {
      var edgeLines = []
      for (var e = 0; e < object.edges.length && e < 8; e++) edgeLines.push("- " + object.edges[e].type + " -> " + object.edges[e].target)
      text += "\nRelations:\n" + edgeLines.join("\n")
      if (object.edges.length > edgeLines.length) text += "\n- ... " + (object.edges.length - edgeLines.length) + " more relations"
    }
    var summaryChars = this._contentCodePoints(text)
    if (summaryChars.length > 1200) {
      text = summaryChars.slice(0, 1200).join("") + "\n[" + object.handle + " summary truncated]"
      complete = false
    }
  }
  if (level === "L3") {
    var structuralDetail = this._structuralRepresentation(object, level, serialized)
    if (isMap(structuralDetail)) text = structuralDetail.text
    else {
      var chars = this._contentCodePoints(serialized)
      text = chars.slice(0, 1200).join("")
      if (chars.length > 1200) {
        text += "\n[" + object.handle + " detail truncated; expand L4 for exact content]"
        complete = false
      }
    }
  }
  if (isMap(structuralSummary) || isMap(structuralDetail)) {
    var structural = isMap(structuralDetail) ? structuralDetail : structuralSummary
    if (this.estimateTokens(text) < object.estimatedOriginalTokens) complete = false
    if (!complete || level !== "L4") text += "\nExact backing: " + object.handle
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
    structuralKind: isMap(structuralSummary) || isMap(structuralDetail) ? structural.kind : __,
    complete: complete
  }
}

MiniAHistoryVM.prototype.getRepresentation = function(id, level) {
  if (!this.contextVirtualization) return { error: "Context virtualization is not enabled." }
  var object = this._resolveObject(id)
  if (!isMap(object) || object.branchId !== this.branchId) return { error: "Context object not found in the active conversation branch." }
  var normalized = this._representationLevel(level)
  this.metrics["representation_" + normalized.toLowerCase()]++
  this._touchObject(object, 1, 2)
  if (normalized === "L4") return { id: object.id, handle: object.handle, level: normalized, content: object.content, estimatedTokens: object.estimatedOriginalTokens, exact: true, canonicalRef: object.canonicalRef }
  var key = this._representationCacheKey(object, normalized)
  var representation = this.representationCache[key]
  if (isMap(representation)) {
    this.metrics.representation_cache_hits++
    this.metrics.summary_reuse++
  } else {
    this.metrics.representation_cache_misses++
    representation = __
    if (this.semanticCompression && (normalized === "L2" || normalized === "L3") && object.estimatedOriginalTokens >= this.semanticCompressionMinTokens) {
      try {
        var semantic = this.semanticCompressor({ id: object.id, handle: object.handle, kind: object.kind, type: object.type, level: normalized, content: object.content, summary: object.summary, provenance: object.provenance })
        var semanticText = isString(semantic) ? semantic : (isMap(semantic) && isString(semantic.text) ? semantic.text : "")
        if (semanticText.trim().length > 0 && this.estimateTokens(semanticText) < object.estimatedOriginalTokens) {
          representation = this._buildRepresentation(object, normalized)
          representation.text = semanticText + "\nExact backing: " + object.handle
          representation.estimatedTokens = this.estimateTokens(representation.text)
          representation.generatedBy = "semantic"
          representation.complete = false
          this.metrics.semantic_compressions++
        }
      } catch(ignoreSemanticCompression) { this.metrics.semantic_compression_failures++ }
    }
    if (!isMap(representation)) representation = this._buildRepresentation(object, normalized)
    if (isString(representation.structuralKind)) {
      this.metrics.structural_compressions++
      this.metrics["structural_" + representation.structuralKind + "_compressions"]++
    }
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
    if (isMap(candidate) && candidate.obsolete && opts.includeObsolete !== true) {
      var staleHandle = candidate.handle
      var redirects = 0
      while (isMap(candidate) && candidate.obsolete && redirects++ < 8) {
        candidate = this._resolveObject(candidate.supersededBy)
        this.metrics.stale_suppressed++
      }
      if (isMap(candidate) && candidate.handle !== staleHandle) {
        indexed.scores[candidate.handle] = Math.max(indexed.scores[candidate.handle] || 0, indexed.scores[staleHandle] || 0)
        indexed.matchedLevels[candidate.handle] = indexed.matchedLevels[staleHandle] || "supersession"
      }
    }
    if (isMap(candidate) && candidate.branchId === this.branchId) this._collectDescendants(candidate, maxDepth, pool, depths)
  }

  var ranked = []
  var poolHandles = Object.keys(pool)
  var candidateTokens = 0
  for (var p = 0; p < poolHandles.length; p++) {
    var object = pool[poolHandles[p]]
    if (object.obsolete && opts.includeObsolete !== true) {
      this.metrics.stale_suppressed++
      continue
    }
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
  for (var touch = 0; touch < selected.length; touch++) this._touchObject(selected[touch].object, 0.1, 1)
  var results = selected.map(function(item) {
    return {
      id: item.object.id,
      handle: item.object.handle,
      kind: item.object.kind,
      type: item.object.type,
      summary: item.object.summary,
      obsolete: item.object.obsolete,
      supersededBy: item.object.supersededBy,
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
  this._touchObject(object, 1, 2)
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

MiniAHistoryVM.prototype._contextCategory = function(object) {
  if (object.kind === "constraint") return "constraints"
  if (object.kind === "plan" || object.kind === "decision") return "plan"
  if (object.kind === "memory") return "memory"
  if (object.kind === "history" || object.kind === "delegation" || object.kind === "recovery") return "history"
  if (object.kind === "wiki" || object.kind === "summary" || object.kind === "evidence") return "knowledge"
  if (object.kind === "skill") return "skills"
  if (object.kind === "artifact" || object.kind === "attachment") return "artifacts"
  return "other"
}

MiniAHistoryVM.prototype._contextConsumerPolicy = function(consumer) {
  var name = isString(consumer) ? consumer.toLowerCase().trim() : "executor"
  var profiles = {
    executor: {
      categoryWeights: { constraints: 5, plan: 3, memory: 2, history: 4, knowledge: 2, skills: 1, artifacts: 4, other: 1 },
      kindUtility: { constraint: 1.4, plan: 1.2, recovery: 1.35, artifact: 1.35, attachment: 1.25, history: 1.15 },
      recentLimit: 6,
      maxObjects: 50,
      candidateLimit: 100,
      levelCeilings: {}
    },
    planner: {
      categoryWeights: { constraints: 5, plan: 6, memory: 3, history: 2, knowledge: 4, skills: 2, artifacts: 1, other: 1 },
      kindUtility: { constraint: 1.4, plan: 1.5, decision: 1.55, memory: 1.2, wiki: 1.2, summary: 1.2, artifact: 0.7, attachment: 0.6 },
      recentLimit: 4,
      maxObjects: 40,
      candidateLimit: 80,
      levelCeilings: { artifact: "L2", attachment: "L1" }
    },
    advisor: {
      categoryWeights: { constraints: 5, plan: 5, memory: 4, history: 2, knowledge: 5, skills: 1, artifacts: 1, other: 1 },
      kindUtility: { constraint: 1.45, decision: 1.55, memory: 1.35, evidence: 1.35, recovery: 1.25, history: 0.85, artifact: 0.7, attachment: 0.6 },
      recentLimit: 4,
      maxObjects: 40,
      candidateLimit: 80,
      levelCeilings: { artifact: "L2", attachment: "L1" }
    },
    validator: {
      categoryWeights: { constraints: 5, plan: 3, memory: 1, history: 2, knowledge: 6, skills: 1, artifacts: 5, other: 1 },
      kindUtility: { constraint: 1.4, decision: 1.3, evidence: 1.8, artifact: 1.55, recovery: 1.25, summary: 0.8, history: 0.9 },
      recentLimit: 4,
      maxObjects: 40,
      candidateLimit: 80,
      levelCeilings: {}
    },
    delegate: {
      categoryWeights: { constraints: 6, plan: 5, memory: 2, history: 1, knowledge: 4, skills: 4, artifacts: 3, other: 1 },
      kindUtility: { constraint: 1.55, plan: 1.45, skill: 1.5, wiki: 1.25, artifact: 1.2, history: 0.65, delegation: 0.7 },
      recentLimit: 2,
      maxObjects: 25,
      candidateLimit: 50,
      levelCeilings: { history: "L2", delegation: "L2", memory: "L2", attachment: "L1" }
    },
    summarizer: {
      categoryWeights: { constraints: 4, plan: 3, memory: 2, history: 6, knowledge: 4, skills: 1, artifacts: 2, other: 1 },
      kindUtility: { constraint: 1.3, history: 1.45, delegation: 1.35, recovery: 1.35, summary: 1.3, decision: 1.2 },
      recentLimit: 8,
      maxObjects: 60,
      candidateLimit: 120,
      levelCeilings: { artifact: "L3", attachment: "L2" }
    },
    dreamer: {
      categoryWeights: { constraints: 4, plan: 4, memory: 6, history: 2, knowledge: 5, skills: 2, artifacts: 1, other: 1 },
      kindUtility: { constraint: 1.3, memory: 1.55, summary: 1.45, wiki: 1.35, decision: 1.25, history: 0.8, artifact: 0.65 },
      recentLimit: 3,
      maxObjects: 35,
      candidateLimit: 70,
      levelCeilings: { history: "L2", delegation: "L2", artifact: "L2", attachment: "L1" }
    }
  }
  if (!isMap(profiles[name])) {
    name = "executor"
    this.metrics.consumer_policy_fallbacks++
  }
  var policy = merge({}, profiles[name], true)
  policy.consumer = name
  return policy
}

MiniAHistoryVM.prototype._contextBudgetPolicy = function(totalBudget, outputReserve, candidates, options) {
  var fixed = {}
  var fixedTotal = 0
  if (isMap(options.fixedTokens)) Object.keys(options.fixedTokens).forEach(function(category) {
    if (isNumber(options.fixedTokens[category]) && options.fixedTokens[category] > 0) {
      fixed[category] = Math.floor(options.fixedTokens[category])
      fixedTotal += fixed[category]
    }
  })
  var materializationBudget = Math.max(0, totalBudget - outputReserve - fixedTotal)
  var weights = { constraints: 4, plan: 3, memory: 2, history: 3, knowledge: 3, skills: 1, artifacts: 2, other: 1 }
  if (isMap(options.categoryWeights)) Object.keys(options.categoryWeights).forEach(function(category) {
    if (isNumber(options.categoryWeights[category]) && options.categoryWeights[category] >= 0) weights[category] = options.categoryWeights[category]
  })
  var demand = {}
  for (var i = 0; i < candidates.length; i++) demand[candidates[i].category] = (demand[candidates[i].category] || 0) + candidates[i].utility
  var weighted = {}
  var totalWeight = 0
  Object.keys(weights).forEach(function(category) {
    weighted[category] = weights[category] * (demand[category] > 0 ? 1 + Math.min(2, demand[category]) : 0.25)
    totalWeight += weighted[category]
  })
  var budgets = {}
  Object.keys(weighted).forEach(function(category) {
    budgets[category] = totalWeight > 0 ? Math.floor(materializationBudget * weighted[category] / totalWeight) : 0
  })
  return { total: totalBudget, outputReserve: outputReserve, fixed: fixed, fixedTotal: fixedTotal, materialization: materializationBudget, categories: budgets }
}

MiniAHistoryVM.prototype._contextUtility = function(object, relevance, mandatory) {
  var importance = isNumber(object.importance) ? Math.max(0, Math.min(1, object.importance)) : 0.5
  var probability = Math.max(0.05, Math.min(1, 0.15 + relevance * 0.7 + Math.min(0.15, object.accessCount * 0.03)))
  var confidence = isMap(object.event.metadata) && isNumber(object.event.metadata.confidence) ? Math.max(0, Math.min(1, object.event.metadata.confidence)) : 0.8
  return (mandatory ? 10 : 0) + Math.max(0.001, relevance * importance * probability * confidence)
}

MiniAHistoryVM.prototype._contextRepresentationCost = function(object, level) {
  if (level === "L4") return object.estimatedOriginalTokens
  return this._buildRepresentation(object, level).estimatedTokens
}

MiniAHistoryVM.prototype._contextAssemblyItemKey = function(item) {
  var object = isMap(item) ? this._resolveObject(item.handle) : __
  if (!isMap(object)) return ""
  return object.handle + ":" + item.level + ":" + this._representationCacheKey(object, item.level)
}

MiniAHistoryVM.prototype._contextWorkingSetDelta = function(consumer, items) {
  var scope = this.branchId + ":" + consumer
  var previous = isMap(this.contextWorkingSets[scope]) ? this.contextWorkingSets[scope] : { items: {} }
  var current = { items: {}, order: [] }
  var delta = { added: [], removed: [], promoted: [], demoted: [], modified: [], unchanged: [] }
  var levels = ["L0", "L1", "L2", "L3", "L4"]
  for (var i = 0; i < items.length; i++) {
    var item = items[i]
    var key = this._contextAssemblyItemKey(item)
    current.items[item.handle] = { level: item.level, key: key, tokenCost: item.tokenCost }
    current.order.push(item.handle)
    var old = previous.items[item.handle]
    if (!isMap(old)) delta.added.push(item.handle)
    else if (levels.indexOf(item.level) > levels.indexOf(old.level)) delta.promoted.push(item.handle)
    else if (levels.indexOf(item.level) < levels.indexOf(old.level)) delta.demoted.push(item.handle)
    else if (old.key !== key) delta.modified.push(item.handle)
    else delta.unchanged.push(item.handle)
  }
  Object.keys(previous.items).forEach(function(handle) {
    if (!isMap(current.items[handle])) delta.removed.push(handle)
  })
  this.contextWorkingSets[scope] = current
  this.metrics.context_deltas++
  this.metrics.context_delta_added += delta.added.length
  this.metrics.context_delta_removed += delta.removed.length
  this.metrics.context_delta_promoted += delta.promoted.length
  this.metrics.context_delta_demoted += delta.demoted.length
  this.metrics.context_delta_modified += delta.modified.length
  this.metrics.context_delta_unchanged += delta.unchanged.length
  return delta
}

MiniAHistoryVM.prototype._serializeContextAssemblyItems = function(items) {
  var lines = []
  for (var i = 0; i < items.length; i++) {
    var item = items[i]
    var representation = isMap(item.representation) ? item.representation : {}
    var value = isString(representation.text) ? representation.text : (isDef(representation.content) ? (isString(representation.content) ? representation.content : stringify(representation.content, __, "")) : "")
    lines.push("[" + item.handle + " " + item.level + "]\n" + value)
  }
  return lines.join("\n\n")
}

MiniAHistoryVM.prototype.serializeContext = function(assembly) {
  if (!this.contextVirtualization) return { error: "Context virtualization is not enabled." }
  if (!isMap(assembly) || !isArray(assembly.objects)) return { error: "A ContextAssembler result is required." }
  var stable = []
  var dynamic = []
  for (var i = 0; i < assembly.objects.length; i++) (assembly.objects[i].stable === true ? stable : dynamic).push(assembly.objects[i])
  var signature = isString(assembly.stablePrefixSignature) ? assembly.stablePrefixSignature : stable.map(function(item) { return this._contextAssemblyItemKey(item) }, this).join("|")
  var prefix = this.contextPrefixCache[signature]
  var cacheHit = isString(prefix)
  if (cacheHit) this.metrics.context_serialization_cache_hits++
  else {
    prefix = this._serializeContextAssemblyItems(stable)
    this.contextPrefixCache[signature] = prefix
    this.metrics.context_serialization_cache_misses++
  }
  var dynamicText = this._serializeContextAssemblyItems(dynamic)
  var text = prefix.length > 0 && dynamicText.length > 0 ? prefix + "\n\n--- DYNAMIC WORKING SET ---\n\n" + dynamicText : prefix + dynamicText
  this.metrics.stable_prefix_tokens = isNumber(assembly.stablePrefixTokens) ? assembly.stablePrefixTokens : 0
  return { stablePrefix: prefix, dynamicWorkingSet: dynamicText, text: text, stablePrefixTokens: this.metrics.stable_prefix_tokens, cacheHit: cacheHit }
}

// Build a Phase 2 working-set projection for diagnostics only. The caller keeps
// ownership of its provider conversation; this method never serializes or changes it.
MiniAHistoryVM.prototype.projectContextShadow = function(options) {
  if (!this.contextVirtualizationShadow) return { active: false, reason: "Context virtualization shadow is not enabled." }
  var opts = isMap(options) ? options : {}
  var actualTokens = isNumber(opts.actualTokens) && opts.actualTokens >= 0
    ? Math.floor(opts.actualTokens)
    : this.estimateTokens(stringify(isDef(opts.actualContext) ? opts.actualContext : [], __, ""))
  var assemblyOptions = merge({}, opts, true)
  delete assemblyOptions.actualTokens
  delete assemblyOptions.actualContext
  var dryRun = isArray(opts.actualContext) ? this.projectActiveContext(opts.actualContext, merge(assemblyOptions, { shadowProjection: true, projectionOnly: true }, true)) : __
  var assembly = isMap(dryRun) && dryRun.active === true ? dryRun.assembly : this.assembleContext(assemblyOptions)
  if (!isMap(assembly) || !isArray(assembly.objects)) return { active: false, reason: isMap(assembly) ? assembly.error : "Context assembly failed." }
  var delta = isMap(assembly.delta) ? assembly.delta : {}
  var differences = ["added", "removed", "promoted", "demoted", "modified"].reduce(function(total, key) {
    return total + (isArray(delta[key]) ? delta[key].length : 0)
  }, 0)
  var projectedTokens = isMap(dryRun) && dryRun.active === true && isNumber(dryRun.outputTokens) ? dryRun.outputTokens : (isNumber(assembly.materializedTokens) ? assembly.materializedTokens : 0)
  var result = {
    active: true,
    consumer: assembly.consumer,
    actualTokens: actualTokens,
    projectedTokens: projectedTokens,
    expectedSavings: actualTokens - projectedTokens,
    objectDifferences: differences,
    objectsConsidered: assembly.objectsConsidered,
    objectsSelected: assembly.objectsSelected,
    stablePrefixTokens: assembly.stablePrefixTokens,
    effectiveContextRatio: assembly.effectiveContextRatio,
    assembly: assembly
  }
  this.contextVirtualizationShadowLast = {
    consumer: result.consumer,
    actualTokens: result.actualTokens,
    projectedTokens: result.projectedTokens,
    expectedSavings: result.expectedSavings,
    objectDifferences: result.objectDifferences,
    objectsConsidered: result.objectsConsidered,
    objectsSelected: result.objectsSelected,
    stablePrefixTokens: result.stablePrefixTokens,
    effectiveContextRatio: result.effectiveContextRatio,
    addressableTokens: assembly.addressableTokens,
    materializedTokens: assembly.materializedTokens,
    categoryUsage: merge({}, assembly.categoryUsage, true),
    budget: merge({}, assembly.budget, true)
  }
  this.metrics.context_virtualization_shadow_assemblies++
  this.metrics.context_virtualization_shadow_actual_tokens = actualTokens
  this.metrics.context_virtualization_shadow_projected_tokens = projectedTokens
  this.metrics.context_virtualization_shadow_expected_savings = result.expectedSavings
  this.metrics.context_virtualization_shadow_object_differences = differences
  return result
}

MiniAHistoryVM.prototype.projectActiveContext = function(conversation, options) {
  var opts = isMap(options) ? options : {}
  if (!this.contextVirtualization || this.contextVirtualizationShadow && opts.shadowProjection !== true) return { active: false, reason: "Active context virtualization is not enabled.", conversation: conversation }
  if (!isArray(conversation)) return { active: false, reason: "A provider conversation array is required.", conversation: conversation }
  var recentCount = isNumber(opts.recentCount) ? Math.max(2, Math.min(20, Math.floor(opts.recentCount))) : 6
  var protectedTokens = 0
  var replaceable = {}
  var isProtected = function(entry, index) {
    if (!isMap(entry)) return true
    var role = isString(entry.role) ? entry.role.toLowerCase() : ""
    if (role === "system" || role === "developer" || role === "user" || role === "tool" || role === "function") return true
    if (!isString(entry.content) || index >= conversation.length - recentCount) return true
    if (isArray(entry.tool_calls) || isDef(entry.tool_call_id) || isDef(entry.function_call)) return true
    return false
  }
  for (var i = 0; i < conversation.length; i++) {
    if (isProtected(conversation[i], i)) protectedTokens += this.estimateTokens(stringify(conversation[i], __, ""))
    else replaceable[i] = true
  }
  var totalBudget = isNumber(opts.budget) && opts.budget > 0 ? Math.floor(opts.budget) : Math.max(1, this.estimateTokens(stringify(conversation, __, "")))
  var assemblyOptions = merge({}, opts, true)
  assemblyOptions.budget = totalBudget
  assemblyOptions.outputReserve = isNumber(opts.outputReserve) ? opts.outputReserve : 0
  assemblyOptions.fixedTokens = merge(isMap(opts.fixedTokens) ? opts.fixedTokens : {}, { provider_protected: protectedTokens }, true)
  delete assemblyOptions.recentCount
  delete assemblyOptions.shadowProjection
  delete assemblyOptions.projectionOnly
  var assembly = this.assembleContext(assemblyOptions)
  if (!isMap(assembly) || !isArray(assembly.objects)) return { active: false, reason: isMap(assembly) ? assembly.error : "Context assembly failed.", conversation: conversation }
  var selected = {}
  for (var s = 0; s < assembly.objects.length; s++) selected[assembly.objects[s].handle] = assembly.objects[s]
  var output = []
  var references = 0
  for (var ci = 0; ci < conversation.length; ci++) {
    var entry = conversation[ci]
    if (replaceable[ci] !== true) {
      output.push(entry)
      continue
    }
    var object = this._providerObjectForIndex(ci)
    if (!isMap(object) || object.branchId !== this.branchId) {
      output.push(entry)
      continue
    }
    var selectedItem = selected[object.handle]
    var level = isMap(selectedItem) ? selectedItem.level : "L0"
    if (level === "L4") {
      output.push(entry)
      continue
    }
    var representation = isMap(selectedItem) ? selectedItem.representation : this.getRepresentation(object.handle, level)
    var value = isMap(representation) && isString(representation.text)
      ? representation.text
      : (isMap(representation) && isDef(representation.content) ? (isString(representation.content) ? representation.content : stringify(representation.content, __, "")) : object.summary)
    var replacement = merge({}, entry, true)
    replacement.content = "[CONTEXT_OBJECT " + object.handle + " " + level + "]\n" + value + "\nExact backing: " + object.handle + ". Use history_get for bounded exact reads."
    if (this.estimateTokens(stringify(replacement, __, "")) >= this.estimateTokens(stringify(entry, __, ""))) {
      output.push(entry)
      continue
    }
    output.push(replacement)
    references++
  }
  var inputTokens = this.estimateTokens(stringify(conversation, __, ""))
  var outputTokens = this.estimateTokens(stringify(output, __, ""))
  var result = {
    active: true,
    consumer: assembly.consumer,
    inputTokens: inputTokens,
    outputTokens: outputTokens,
    tokensSaved: inputTokens - outputTokens,
    references: references,
    objectsConsidered: assembly.objectsConsidered,
    objectsSelected: assembly.objectsSelected,
    effectiveContextRatio: assembly.effectiveContextRatio,
    assembly: assembly,
    conversation: output
  }
  this.contextVirtualizationActiveLast = {
    consumer: result.consumer,
    inputTokens: inputTokens,
    outputTokens: outputTokens,
    tokensSaved: result.tokensSaved,
    references: references,
    objectsConsidered: result.objectsConsidered,
    objectsSelected: result.objectsSelected,
    effectiveContextRatio: result.effectiveContextRatio,
    addressableTokens: assembly.addressableTokens,
    materializedTokens: assembly.materializedTokens,
    categoryUsage: merge({}, assembly.categoryUsage, true),
    budget: merge({}, assembly.budget, true)
  }
  if (opts.projectionOnly !== true) {
    this.metrics.context_virtualization_active_assemblies++
    this.metrics.context_virtualization_active_input_tokens = inputTokens
    this.metrics.context_virtualization_active_output_tokens = outputTokens
    this.metrics.context_virtualization_active_tokens_saved += result.tokensSaved
    this.metrics.context_virtualization_active_references = references
  } else {
    this.contextVirtualizationActiveLast = __
  }
  return result
}

MiniAHistoryVM.prototype.assembleContext = function(options) {
  if (!this.contextVirtualization) return { error: "Context virtualization is not enabled." }
  var opts = isMap(options) ? options : {}
  var consumerPolicy = this._contextConsumerPolicy(opts.consumer)
  if (isNumber(opts.recentLimit)) consumerPolicy.recentLimit = Math.max(0, Math.min(50, Math.floor(opts.recentLimit)))
  if (isNumber(opts.candidateLimit)) consumerPolicy.candidateLimit = Math.max(1, Math.min(500, Math.floor(opts.candidateLimit)))
  if (isMap(opts.levelCeilings)) Object.keys(opts.levelCeilings).forEach(function(kind) {
    var level = String(opts.levelCeilings[kind]).toUpperCase()
    if (["L0", "L1", "L2", "L3", "L4"].indexOf(level) >= 0) consumerPolicy.levelCeilings[kind] = level
  })
  var totalBudget = isNumber(opts.budget) ? Math.max(1, Math.floor(opts.budget)) : 32000
  var outputReserve = isNumber(opts.outputReserve) ? Math.max(0, Math.min(totalBudget, Math.floor(opts.outputReserve))) : Math.min(4096, Math.floor(totalBudget * 0.2))
  var goal = isString(opts.goal) ? opts.goal.toLowerCase().trim() : ""
  var goalTerms = this._tokenizeIndexText(goal)
  var pinned = {}
  if (isArray(opts.pinned)) for (var pi = 0; pi < opts.pinned.length; pi++) pinned[String(opts.pinned[pi])] = true
  var stableIds = {}
  if (isArray(opts.stableIds)) for (var sti = 0; sti < opts.stableIds.length; sti++) stableIds[String(opts.stableIds[sti])] = true
  var candidateMap = {}
  var candidateReasons = {}
  var addCandidate = function(object, reason) {
    if (!isMap(object) || object.branchId !== this.branchId) return
    if (object.obsolete && opts.includeObsolete !== true) {
      var redirects = 0
      while (object.obsolete && redirects++ < 8) {
        var replacement = this._resolveObject(object.supersededBy)
        if (!isMap(replacement) || replacement.handle === object.handle) return
        object = replacement
        this.metrics.stale_suppressed++
      }
      if (object.obsolete) return
      reason = "supersession_redirect"
    }
    candidateMap[object.handle] = object
    if (!isArray(candidateReasons[object.handle])) candidateReasons[object.handle] = []
    if (candidateReasons[object.handle].indexOf(reason) < 0) candidateReasons[object.handle].push(reason)
  }.bind(this)

  if (isArray(opts.candidateIds)) {
    for (var ci = 0; ci < opts.candidateIds.length; ci++) addCandidate(this._resolveObject(opts.candidateIds[ci]), "explicit_candidate")
  } else if (goalTerms.length > 0) {
    var indexed = this._indexedCandidates(goalTerms, ["L0", "L1", "L2"])
    if (Object.keys(indexed.scores).length === 0) indexed = this._indexedCandidates(goalTerms, ["L3", "L4"])
    var indexedHandles = Object.keys(indexed.scores).sort(function(a, b) { return indexed.scores[b] - indexed.scores[a] || a.localeCompare(b) })
    for (var ih = 0; ih < indexedHandles.length && ih < consumerPolicy.candidateLimit; ih++) addCandidate(this._resolveObject(indexedHandles[ih]), "goal_match")
  } else if (goal.length > 0) {
    for (var gi = this.objects.length - 1; gi >= 0; gi--) {
      var goalObject = this.objects[gi]
      var goalText = isString(goalObject.content) ? goalObject.content : stringify(goalObject.content, __, "")
      if (goalObject.branchId === this.branchId && goalText.toLowerCase().indexOf(goal) >= 0) addCandidate(goalObject, "goal_match")
    }
  } else {
    for (var ri = this.objects.length - 1; ri >= 0 && Object.keys(candidateMap).length < consumerPolicy.candidateLimit; ri--) {
      var root = this.objects[ri]
      if (!isString(root.parentId) || root.parentId.length === 0) addCandidate(root, "root")
    }
  }

  for (var oi = 0; oi < this.objects.length; oi++) {
    var active = this.objects[oi]
    var isPinned = pinned[active.id] === true || pinned[active.handle] === true
    var activePlan = active.kind === "plan" && isMap(active.event.metadata) && active.event.metadata.active === true
    if (active.kind === "constraint" || active.explicitPin || active.unresolved || activePlan || isPinned) addCandidate(active, "mandatory")
  }
  if (opts.includeRecent !== false) {
    var recentAdded = 0
    for (var recent = this.objects.length - 1; recent >= 0 && recentAdded < consumerPolicy.recentLimit; recent--) {
      if (this.objects[recent].branchId === this.branchId) {
        addCandidate(this.objects[recent], "recent")
        recentAdded++
      }
    }
  }

  var initialHandles = Object.keys(candidateMap)
  for (var dh = 0; dh < initialHandles.length; dh++) {
    var dependent = candidateMap[initialHandles[dh]]
    var prefetchEdges = this._graphEdgesForObject(dependent, "both", ["depends_on", "derived_from", "supports", "references", "resolved_by", "produced"])
    for (var di = 0; di < prefetchEdges.length; di++) {
      var dependencyRef = prefetchEdges[di].source === dependent.handle ? prefetchEdges[di].target : prefetchEdges[di].source
      var dependency = this._resolveObject(dependencyRef)
      if (isMap(dependency)) {
        var wasCandidate = isMap(candidateMap[dependency.handle])
        addCandidate(dependency, "graph_prefetch")
        if (!wasCandidate) this.metrics.dependency_prefetches++
      }
    }
  }

  var cheapScores = goalTerms.length > 0 ? this._indexedCandidates(goalTerms, ["L0", "L1", "L2"]).scores : {}
  var candidates = []
  var handles = Object.keys(candidateMap)
  for (var h = 0; h < handles.length; h++) {
    var object = candidateMap[handles[h]]
    var reasons = candidateReasons[object.handle]
    var mandatory = reasons.indexOf("mandatory") >= 0
    var prefetched = reasons.length === 1 && reasons[0] === "graph_prefetch"
    var relevance = goalTerms.length > 0 ? Math.min(1, (cheapScores[object.handle] || 0) / Math.max(1, goalTerms.length * 3)) : 0.5
    if (reasons.indexOf("goal_match") >= 0) relevance = Math.max(relevance, 0.6)
    if (reasons.indexOf("explicit_candidate") >= 0) relevance = Math.max(relevance, 0.8)
    if (reasons.indexOf("recent") >= 0) relevance = Math.max(relevance, 0.25)
    if (mandatory) relevance = Math.max(relevance, 0.75)
    if (prefetched) relevance = Math.max(relevance, 0.1)
    var utility = this._contextUtility(object, relevance, mandatory)
    if (!mandatory && isNumber(consumerPolicy.kindUtility[object.kind])) utility *= consumerPolicy.kindUtility[object.kind]
    candidates.push({ object: object, reasons: reasons, mandatory: mandatory, prefetched: prefetched, relevance: relevance, category: this._contextCategory(object), utility: utility })
  }

  var budgetOptions = merge({}, opts, true)
  budgetOptions.categoryWeights = merge({}, consumerPolicy.categoryWeights, true)
  if (isMap(opts.categoryWeights)) Object.keys(opts.categoryWeights).forEach(function(category) { budgetOptions.categoryWeights[category] = opts.categoryWeights[category] })
  var policy = this._contextBudgetPolicy(totalBudget, outputReserve, candidates, budgetOptions)
  var selected = {}
  var used = 0
  var categoryUsage = {}
  var levels = ["L0", "L1", "L2", "L3", "L4"]
  var levelValue = { L0: 0.2, L1: 0.4, L2: 0.65, L3: 0.85, L4: 1 }
  var maxObjects = isNumber(opts.maxObjects) ? Math.max(1, Math.min(200, Math.floor(opts.maxObjects))) : consumerPolicy.maxObjects

  for (var m = 0; m < candidates.length; m++) {
    var forced = candidates[m]
    if (!forced.mandatory) continue
    var minimumLevel = forced.object.kind === "constraint" ? "L4" : "L2"
    var forcedCost = this._contextRepresentationCost(forced.object, minimumLevel)
    selected[forced.object.handle] = merge({}, forced, true)
    selected[forced.object.handle].level = minimumLevel
    selected[forced.object.handle].tokenCost = forcedCost
    used += forcedCost
    categoryUsage[forced.category] = (categoryUsage[forced.category] || 0) + forcedCost
  }

  var baseOffers = []
  for (var b = 0; b < candidates.length; b++) {
    var base = candidates[b]
    if (isMap(selected[base.object.handle])) continue
    var baseCost = this._contextRepresentationCost(base.object, "L0")
    baseOffers.push({ candidate: base, cost: baseCost, efficiency: base.utility * levelValue.L0 / Math.max(1, baseCost) })
  }
  baseOffers.sort(function(a, b) { return b.efficiency - a.efficiency || a.candidate.object.handle.localeCompare(b.candidate.object.handle) })
  for (var pass = 0; pass < 2; pass++) {
    for (var bo = 0; bo < baseOffers.length && Object.keys(selected).length < maxObjects; bo++) {
      var offer = baseOffers[bo]
      if (isMap(selected[offer.candidate.object.handle]) || used + offer.cost > policy.materialization) continue
      var categoryRoom = (categoryUsage[offer.candidate.category] || 0) + offer.cost <= (policy.categories[offer.candidate.category] || 0)
      if (pass === 0 && !categoryRoom) continue
      selected[offer.candidate.object.handle] = merge({}, offer.candidate, true)
      selected[offer.candidate.object.handle].level = "L0"
      selected[offer.candidate.object.handle].tokenCost = offer.cost
      used += offer.cost
      categoryUsage[offer.candidate.category] = (categoryUsage[offer.candidate.category] || 0) + offer.cost
    }
  }

  while (used <= policy.materialization) {
    var upgradeOffers = []
    Object.keys(selected).forEach(function(handle) {
      var item = selected[handle]
      if (item.prefetched || item.level === "L4") return
      var currentIndex = levels.indexOf(item.level)
      var nextLevel = levels[currentIndex + 1]
      var ceiling = consumerPolicy.levelCeilings[item.object.kind]
      if (isString(ceiling) && levels.indexOf(nextLevel) > levels.indexOf(ceiling)) return
      var nextCost = this._contextRepresentationCost(item.object, nextLevel)
      var deltaCost = nextCost - item.tokenCost
      var deltaUtility = item.utility * (levelValue[nextLevel] - levelValue[item.level])
      upgradeOffers.push({ item: item, level: nextLevel, cost: nextCost, deltaCost: deltaCost, efficiency: deltaUtility / Math.max(1, deltaCost) })
    }, this)
    if (upgradeOffers.length === 0) break
    upgradeOffers.sort(function(a, b) { return b.efficiency - a.efficiency || a.item.object.handle.localeCompare(b.item.object.handle) })
    var accepted = __
    for (var up = 0; up < upgradeOffers.length; up++) if (used + upgradeOffers[up].deltaCost <= policy.materialization) { accepted = upgradeOffers[up]; break }
    if (!isMap(accepted)) break
    used += accepted.deltaCost
    categoryUsage[accepted.item.category] = (categoryUsage[accepted.item.category] || 0) + accepted.deltaCost
    accepted.item.level = accepted.level
    accepted.item.tokenCost = accepted.cost
  }

  var selectedItems = Object.keys(selected).map(function(handle) { return selected[handle] })
  selectedItems.sort(function(a, b) { return a.object.event.seq - b.object.event.seq || a.object.handle.localeCompare(b.object.handle) })
  var materialized = []
  for (var si = 0; si < selectedItems.length; si++) {
    var item = selectedItems[si]
    var representation = this.getRepresentation(item.object.handle, item.level)
    materialized.push({
      id: item.object.id,
      handle: item.object.handle,
      kind: item.object.kind,
      type: item.object.type,
      category: item.category,
      level: item.level,
      tokenCost: item.tokenCost,
      utility: item.utility,
      efficiency: item.utility * levelValue[item.level] / Math.max(1, item.tokenCost),
      mandatory: item.mandatory,
      prefetched: item.prefetched,
      reasons: item.reasons,
      stable: item.mandatory || stableIds[item.object.id] === true || stableIds[item.object.handle] === true,
      representation: representation
    })
  }

  var stablePrefixTokens = 0
  var stablePrefixKeys = []
  for (var sp = 0; sp < materialized.length; sp++) if (materialized[sp].stable === true) {
    stablePrefixTokens += materialized[sp].tokenCost
    stablePrefixKeys.push(this._contextAssemblyItemKey(materialized[sp]))
  }
  var delta = this._contextWorkingSetDelta(consumerPolicy.consumer, materialized)

  var addressableTokens = 0
  for (var at = 0; at < candidates.length; at++) addressableTokens += candidates[at].object.estimatedOriginalTokens
  var overflow = used > policy.materialization
  var utilization = policy.materialization > 0 ? used / policy.materialization : (used > 0 ? 1 : 0)
  var effectiveRatio = used > 0 ? addressableTokens / used : 0
  this.metrics.context_assemblies++
  this.metrics.context_objects_considered += candidates.length
  this.metrics.context_objects_selected += materialized.length
  this.metrics.context_candidate_tokens += addressableTokens
  this.metrics.context_materialized_tokens = used
  this.metrics.addressable_relevant_tokens = addressableTokens
  this.metrics.effective_context_ratio = effectiveRatio
  this.metrics.context_budget_utilization = utilization
  this.metrics.stable_prefix_tokens = stablePrefixTokens
  this.metrics["consumer_views_" + consumerPolicy.consumer]++
  if (overflow) this.metrics.budget_overflows++
  return {
    consumer: consumerPolicy.consumer,
    consumerPolicy: { recentLimit: consumerPolicy.recentLimit, maxObjects: maxObjects, candidateLimit: consumerPolicy.candidateLimit, categoryWeights: budgetOptions.categoryWeights, kindUtility: consumerPolicy.kindUtility, levelCeilings: consumerPolicy.levelCeilings },
    goal: isString(opts.goal) ? opts.goal : "",
    budget: policy,
    categoryUsage: categoryUsage,
    materializedTokens: used,
    addressableTokens: addressableTokens,
    effectiveContextRatio: effectiveRatio,
    utilization: utilization,
    overflow: overflow,
    delta: delta,
    stablePrefixTokens: stablePrefixTokens,
    stablePrefixSignature: stablePrefixKeys.join("|"),
    objectsConsidered: candidates.length,
    objectsSelected: materialized.length,
    objects: materialized
  }
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
    var match = entry.content.match(/^\[HISTORY_VM_REFERENCE (h\d+)\]/) || entry.content.match(/\[HISTORY_VM_RANGE (h\d+) /) || entry.content.match(/^\[CONTEXT_OBJECT history:(h\d+) L[0-4]\]/)
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
    // Mini-A's own ReAct step loop re-sends a deterministic, fully reconstructible
    // scaffolding prompt (SYSTEM REMINDER / BEGIN_UNTRUSTED_GOAL / CURRENT STATE /
    // "What's your next step?") as a fresh "user" message every single step. That
    // is not an ambiguous end-user requirement -- treating it the same as genuine
    // free-form user content (which must stay protected, see the "unclassified
    // user requirements" policy below) means the one thing responsible for most
    // of a long run's growth can never be collapsed. Recognize it by its stable
    // literal markers so real user messages remain fully protected.
    var isSyntheticStepPrompt = role === "user" && isString(entry.content) &&
      entry.content.indexOf("SYSTEM REMINDER:") >= 0 &&
      entry.content.indexOf("BEGIN_UNTRUSTED_GOAL") >= 0 &&
      entry.content.indexOf("CURRENT STATE:") >= 0
    // Keep unclassified user messages intact (conservative policy); only the
    // recognized synthetic step prompt above is exempt from that protection.
    var protectedEntry = role === "system" || role === "developer" || (role === "user" && !isSyntheticStepPrompt) || !isString(entry.content) || i >= conversation.length - 4 || isArray(entry.tool_calls) || isDef(entry.tool_call_id) && i >= conversation.length - 6
    var expanded = isMap(object) && isMap(this.expansions[object.id]) && this.expansions[object.id].untilStep >= currentStep
    // Synthetic step prompts are individually small (a few hundred tokens) but
    // repeat every step, so the general 2000-token single-object floor (tuned for
    // large tool results) would never trigger for them; use a much lower floor
    // since the content is deterministic and safely reconstructible from live state.
    var eligibleSizeFloor = isSyntheticStepPrompt ? 200 : 2000
    var eligible = isMap(object) && object.estimatedOriginalTokens > eligibleSizeFloor && conversation.length - i > 2 && !protectedEntry && !expanded
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
    contextVirtualizationShadow: this.contextVirtualizationShadow,
    contextSchemaVersion: this.contextSchemaVersion,
    representationVersion: this.representationVersion,
    mode: this.mode,
    storePath: this.storePath,
    conversationId: this.conversationId,
    branchId: this.branchId,
    degraded: this.degraded,
    degradedReason: this.degradedReason,
    states: states,
    contextVirtualizationShadowLast: isMap(this.contextVirtualizationShadowLast) ? merge({}, this.contextVirtualizationShadowLast, true) : __,
    contextVirtualizationActiveLast: isMap(this.contextVirtualizationActiveLast) ? merge({}, this.contextVirtualizationActiveLast, true) : __,
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
