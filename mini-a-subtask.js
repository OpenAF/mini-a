// Author: Nuno Aguiar
// License: Apache 2.0
// Description: SubtaskManager for Mini-A delegation - enables parent agents to spawn child agents for sub-goals

var __SUBTASK_TERMINAL_STATES = new Set(["completed", "failed", "cancelled", "timeout"])
function __isTerminalSubtaskState(status) { return __SUBTASK_TERMINAL_STATES.has(status) }

/**
 * <odoc>
 * <key>SubtaskManager</key>
 * Manages delegation of sub-goals to child Mini-A agent instances.
 * Supports concurrent execution, depth tracking, automatic retries, and deadline enforcement.
 * </odoc>
 */
var SubtaskManager = function(parentArgs, opts) {
  opts = _$(opts, "opts").isMap().default({})
  
  this.parentArgs = parentArgs || {}
  this.maxConcurrent = _$(opts.maxConcurrent, "opts.maxConcurrent").isNumber().default(4)
  this.defaultDeadlineMs = _$(opts.defaultDeadlineMs, "opts.defaultDeadlineMs").isNumber().default(300000)
  this.defaultStallTimeoutMs = _$(opts.defaultStallTimeoutMs, "opts.defaultStallTimeoutMs").isNumber().default(this.defaultDeadlineMs)
  if (this.defaultStallTimeoutMs <= 0) this.defaultStallTimeoutMs = this.defaultDeadlineMs
  this.defaultHardTimeoutMs = _$(opts.defaultHardTimeoutMs, "opts.defaultHardTimeoutMs").isNumber().default(__)
  if (isNumber(this.defaultHardTimeoutMs) && this.defaultHardTimeoutMs <= 0) this.defaultHardTimeoutMs = __
  this.defaultMaxAttempts = _$(opts.defaultMaxAttempts, "opts.defaultMaxAttempts").isNumber().default(2)
  this.maxDepth = _$(opts.maxDepth, "opts.maxDepth").isNumber().default(3)
  this.interactionFn = opts.interactionFn || function() {}
  this.currentDepth = _$(opts.currentDepth, "opts.currentDepth").isNumber().default(0)
  this.workers = this._normalizeWorkers(isDef(opts.workers) ? opts.workers : this.parentArgs.workers)
  this._staticWorkers = this.workers.slice()
  this.remoteDelegation = this.workers.length > 0
  this.useA2A = toBoolean(isDef(opts.useA2A) ? opts.useA2A : this.parentArgs.usea2a) === true
  this.remotePollIntervalMs = _$(opts.remotePollIntervalMs, "opts.remotePollIntervalMs").isNumber().default(1000)
  this._workerCursor = 0
  this._workerGroupCursor = {}
  this._workerProfiles = {}
  this._deadWorkers = {}
  this._deadWorkerInfo = {}
  this._workerFailures = {}
  this._workerLastHeartbeat = {}
  this._lastWorkerSelectionError = __
  this._lastWorkerSelectionDetails = __
  this.workerMaxFailures = _$(opts.workerMaxFailures, "opts.workerMaxFailures").isNumber().default(5)
  this.workerProbeRetries = _$(opts.workerProbeRetries, "opts.workerProbeRetries").isNumber().default(3)
  this.workerProbeRetryDelayMs = _$(opts.workerProbeRetryDelayMs, "opts.workerProbeRetryDelayMs").isNumber().default(250)
  this.workerReviveCooldownMs = _$(opts.workerReviveCooldownMs, "opts.workerReviveCooldownMs").isNumber().default(15000)
  this.workerReviveProbeIntervalMs = _$(opts.workerReviveProbeIntervalMs, "opts.workerReviveProbeIntervalMs").isNumber().default(5000)
  this.workerEvictionTTLMs = _$(opts.workerEvictionTTLMs, "opts.workerEvictionTTLMs").isNumber().default(60000)
  this.onWorkerEvicted = isFunction(opts.onWorkerEvicted) ? opts.onWorkerEvicted : function() {}
  this.parentAgent = isObject(opts.parentAgent) ? opts.parentAgent : __
  this.comms = this.parentAgent ? this.parentAgent._comms : __
  this._lastReviveProbeAt = 0
  
  this.subtasks = {}
  this.runningCount = 0
  this.pendingQueue = []
  
  // Metrics
  this.metrics = {
    total: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    timedout: 0,
    retried: 0,
    remotePollRetries: 0,
    remoteOutcomeUnknown: 0,
    remoteCancelFailures: 0,
    totalDurationMs: 0,
    maxDepthUsed: 0
  }

  this._running = true
  this._watchdogPromise = __
  this._watchdogWakeSignal = new java.lang.Object()
  this._transitionLock = "mini_a_subtask_lock_" + genUUID()

  if (this.remoteDelegation) {
    this._refreshWorkerProfiles()
  }
  
  // Remote workers can need heartbeat eviction before a subtask is submitted.
  // Local delegation starts the watchdog lazily when there is actual work, so
  // an otherwise idle console does not retain a background shutdown thread.
  if (this.remoteDelegation) this._startWatchdog()
}

SubtaskManager.prototype._touchSubtask = function(subtask, reason) {
  if (!isMap(subtask)) return false
  var now = new Date().getTime()
  subtask.lastActivityAt = now
  subtask.lastActivityReason = isString(reason) && reason.length > 0 ? reason : "activity"
  return true
}

SubtaskManager.prototype._claimTerminal = function(subtask, newStatus, nowValue, errorValue, resultValue) {
  if (!isMap(subtask) || !isString(newStatus) || newStatus.length === 0) return false
  var claimed = false
  var parent = this
  sync(function() {
    if (__isTerminalSubtaskState(subtask.status) || subtask.status !== "running") return
    subtask.completedAt = isNumber(nowValue) ? nowValue : new Date().getTime()
    if (newStatus === "completed") {
      subtask.result = resultValue
      subtask.error = __
    } else if (isDef(errorValue)) {
      subtask.error = errorValue
    }
    parent.metrics.running--
    parent.runningCount--
    // Polling parents must never see a terminal state before its result.
    subtask.status = newStatus
    if (subtask.comms) subtask.comms.broker.revoke(subtask.comms.id)
    subtask.commsExchange = __
    claimed = true
  }, this._transitionLock)
  return claimed
}

SubtaskManager.prototype._getSubtaskTimeoutReason = function(subtask, now) {
  if (!isMap(subtask) || subtask.status !== "running") return __
  now = _$(now, "now").isNumber().default(new Date().getTime())

  if (isNumber(subtask.totalDeadlineAt) && now >= subtask.totalDeadlineAt) {
    return {
      type: "total",
      elapsed: now - subtask.startedAt,
      message: "Total timeout exceeded (" + subtask.totalTimeoutMs + "ms)"
    }
  }

  if (isNumber(subtask.hardTimeoutMs) && subtask.hardTimeoutMs > 0 && isDef(subtask.startedAt)) {
    var elapsed = now - subtask.startedAt
    if (elapsed >= subtask.hardTimeoutMs) {
      return {
        type: "hard",
        elapsed: elapsed,
        message: "Hard timeout exceeded (" + subtask.hardTimeoutMs + "ms)"
      }
    }
  }

  var lastActivityAt = isNumber(subtask.lastActivityAt) ? subtask.lastActivityAt : subtask.startedAt
  var stallTimeoutMs = isNumber(subtask.stallTimeoutMs) ? subtask.stallTimeoutMs : this.defaultStallTimeoutMs
  if (isNumber(lastActivityAt) && isNumber(stallTimeoutMs) && stallTimeoutMs > 0) {
    var idleMs = now - lastActivityAt
    if (idleMs >= stallTimeoutMs) {
      return {
        type: "stall",
        idleMs: idleMs,
        message: "Stalled for " + idleMs + "ms" + (isString(subtask.lastActivityReason) ? " after " + subtask.lastActivityReason : "")
      }
    }
  }

  return __
}

/**
 * <odoc>
 * <key>SubtaskManager.destroy()</key>
 * Signals the watchdog thread to stop running.
 * Call this when the SubtaskManager is no longer needed to free the background thread.
 * </odoc>
 */
SubtaskManager.prototype.destroy = function() {
  this._running = false
  // $doV cancellation does not interrupt sleep(..., true), so wake the
  // watchdog explicitly instead of making console shutdown wait for its
  // five-second polling interval.
  if (isDef(this._watchdogWakeSignal)) {
    try {
      sync(function() {
        this._watchdogWakeSignal.notifyAll()
      }.bind(this), this._watchdogWakeSignal)
    } catch(ignoreWatchdogWake) {}
  }
  if (isDef(this._watchdogPromise) && isFunction(this._watchdogPromise.cancel)) {
    try { this._watchdogPromise.cancel("Subtask manager stopped") } catch(ignoreWatchdogCancel) {}
  }
  Object.keys(this.subtasks).forEach(function(subtaskId) {
    var subtask = this.subtasks[subtaskId]
    if (!isMap(subtask)) return
    if (!__isTerminalSubtaskState(subtask.status)) {
      try { this.cancel(subtaskId, "Subtask manager stopped") } catch(ignoreSubtaskCancel) {}
    }
    if (isDef(subtask._executionPromise) && isFunction(subtask._executionPromise.cancel)) {
      try { subtask._executionPromise.cancel("Subtask manager stopped") } catch(ignoreExecutionCancel) {}
    }
  }.bind(this))
}

SubtaskManager.prototype._normalizeWorkers = function(workers) {
  var list = []
  var parsed = workers

  if (isString(workers) && workers.trim().length > 0) {
    parsed = workers.split(",")
  }

  if (isString(parsed)) parsed = [parsed]
  if (!isArray(parsed)) parsed = []

  parsed.forEach(function(entry) {
    var url = __
    if (isString(entry)) {
      url = entry.trim()
      url = url.replace(/^\[+/, "").replace(/\]+$/, "")
      url = url.replace(/^['"]+/, "").replace(/['"]+$/, "")
    } else if (isMap(entry) && isString(entry.url)) {
      url = entry.url.trim()
    }

    if (!isString(url) || url.length === 0) return
    url = url.replace(/\/+$/, "")
    if (url.match(/^https?:\/\//i) === null) return
    list.push(url)
  })

  return list
}

SubtaskManager._PARENT_ONLY_CHILD_ARG_NAMES = [
  "validationgoal", "valgoal", "deepresearch", "maxcycles", "validationthreshold", "persistlearnings",
  "subtasks", "subtasksfile",
  "state", "conversation", "historyvm", "historyvmmode", "historyvmshadow", "contextvirtualization", "contextvirtualizationshadow", "resume", "resumefailed", "durable", "runid", "resumerun", "runstatus", "runroot", "parentrunid",
  "usehistory", "historypath", "historykeep", "historykeepperiod", "historykeepcount", "historyretention",
  "historys3bucket", "historys3prefix", "historys3url", "historys3accesskey", "historys3secret",
  "historys3region", "historys3useversion1", "historys3ignorecertcheck",
  "planfile", "plancontent", "planmode", "convertplan", "validateplan", "forceplanning",
  "saveplannotes", "planlog", "outfile", "outfileall", "outputfile",
  "mcp", "mcpconfig", "mcpdynamic", "mcpproxy", "mcpproxynative", "mcpproxythreshold",
  "mcpproxytoon", "mcpproxyallow", "mcpproxydeny", "mcplazy", "nosetmcpwd", "noagentsmd", "usejsontool",
  "useutils", "useskills", "utilsroot", "utilsallow", "utilsdeny", "miniadocs", "mini-a-docs",
  "debugfile", "goalprefix",
  "workerreg", "workerregtoken", "workerregurl", "workerreginterval",
  "mcpprogcall", "mcpprogcallport", "mcpprogcallmaxbytes", "mcpprogcallresultttl",
  "mcpprogcalltools", "mcpprogcallbatchmax",
  "onport", "web", "modelman", "mcptest", "memoryman", "workermode", "path"
]

SubtaskManager.prototype._stripInheritedParentOnlyArgs = function(mergedArgs, explicitArgs) {
  if (!isMap(mergedArgs)) return mergedArgs
  explicitArgs = isMap(explicitArgs) ? explicitArgs : {}

  SubtaskManager._PARENT_ONLY_CHILD_ARG_NAMES.forEach(function(key) {
    if (!isDef(explicitArgs[key])) delete mergedArgs[key]
  })

  return mergedArgs
}

SubtaskManager.prototype._buildChildArgs = function(subtask) {
  var mergedArgs = merge({}, this.parentArgs)
  var explicitArgs = isMap(subtask.args) ? subtask.args : {}

  Object.keys(explicitArgs).forEach(function(key) {
    mergedArgs[key] = explicitArgs[key]
  })

  this._stripInheritedParentOnlyArgs(mergedArgs, explicitArgs)

  // Communication declarations never inherit through argument merging.
  mergedArgs.agentcomms = explicitArgs.agentcomms
  mergedArgs.goal = subtask.goal
  mergedArgs._delegationDepth = subtask.depth
  mergedArgs._parentSubtaskId = subtask.parentId
  // Prevent auto-delegation cascades in child agents
  mergedArgs._autoDelegate = false
  if (isObject(this.parentAgent) && isFunction(this.parentAgent._contextForDelegate)) {
    var projectedContext = this.parentAgent._contextForDelegate(subtask.goal, 2048)
    var contextVm = this.parentAgent._historyVm
    if (projectedContext.length > 0 || isObject(contextVm) && contextVm.contextVirtualization && !contextVm.contextVirtualizationShadow && !contextVm.degraded) {
      // Do not inherit the parent's full knowledge field along with the view.
      mergedArgs.knowledge = (isString(explicitArgs.knowledge) ? explicitArgs.knowledge : "") + projectedContext
    }
  }

  if (subtask.fork === true && isMap(subtask.forkState)) {
    var forkStateStr = stringify(subtask.forkState, __, "")
    var maxBytes = isNumber(this.parentArgs.forkstatemaxbytes) ? this.parentArgs.forkstatemaxbytes : 65536
    if (forkStateStr.length > maxBytes) {
      // Truncate oldest forkedContext entries first, then workingMemorySession if still oversized
      var trimmed = merge({}, subtask.forkState)
      if (isArray(trimmed.forkedContext) && trimmed.forkedContext.length > 0) {
        while (trimmed.forkedContext.length > 0) {
          trimmed.forkedContext.shift()
          forkStateStr = stringify(trimmed, __, "")
          if (forkStateStr.length <= maxBytes) break
        }
      }
      if (forkStateStr.length > maxBytes && isObject(trimmed.workingMemorySession)) {
        delete trimmed.workingMemorySession
        forkStateStr = stringify(trimmed, __, "")
      }
    }
    mergedArgs.state = forkStateStr
  }

  return mergedArgs
}

SubtaskManager.prototype._refreshWorkerProfiles = function() {
  var parent = this

  this.workers.forEach(function(workerUrl) {
    var prevSig = isMap(parent._workerProfiles[workerUrl]) ? parent._workerProfiles[workerUrl].signature : __
    var probe = parent._probeWorkerProfile(workerUrl, parent.workerProbeRetries)
    parent._workerProfiles[workerUrl] = probe.profile
    if (probe.ok) {
      parent._markWorkerAlive(workerUrl, "Worker profile probe succeeded")
      if (isString(prevSig) && isMap(probe.profile) && probe.profile.signature !== prevSig) {
        parent._notifyProfileChanged(workerUrl)
      }
      return
    }
    parent._markWorkerDead(workerUrl, "Worker profile probe failed after " + probe.attempts + " attempt(s): " + probe.error)
  })
}

SubtaskManager.prototype._notifyProfileChanged = function(url) {
  try { if (isFunction(this._onProfileChanged)) this._onProfileChanged(url) } catch(ignore) {}
}

SubtaskManager.prototype.addWorker = function(url, inlineCard) {
  if (!isString(url) || url.length === 0) return false
  url = url.replace(/\/+$/, "")
  if (url.match(/^https?:\/\//i) === null) return false

  var existingIdx = this.workers.indexOf(url)
  var nowTs = new Date().getTime()

  if (existingIdx >= 0) {
    this._workerLastHeartbeat[url] = nowTs
    var prevSig = isMap(this._workerProfiles[url]) ? this._workerProfiles[url].signature : __
    var existingProbe = this._probeWorkerProfile(url, this.workerProbeRetries, inlineCard)
    this._workerProfiles[url] = existingProbe.profile
    if (existingProbe.ok) {
      this._markWorkerAlive(url, "Heartbeat re-registration")
    } else {
      this._markWorkerDead(url, "Worker heartbeat received but profile probe failed: " + existingProbe.error)
    }
    if (isString(prevSig) && isMap(existingProbe.profile) && existingProbe.profile.signature !== prevSig) {
      this._notifyProfileChanged(url)
    }
    return true
  }

  this.workers.push(url)
  this._workerLastHeartbeat[url] = nowTs
  this.remoteDelegation = true

  var probe = this._probeWorkerProfile(url, this.workerProbeRetries, inlineCard)
  this._workerProfiles[url] = probe.profile
  if (probe.ok) {
    this._markWorkerAlive(url, "Dynamic registration via /worker-register")
  } else {
    this._markWorkerDead(url, "Worker registered but profile probe failed: " + probe.error)
  }
  this._notifyProfileChanged(url)

  try {
    this.interactionFn("delegate", "[worker] Dynamically registered worker: " + url)
  } catch(ignoreInteractionErr) {}

  return true
}

SubtaskManager.prototype.removeWorker = function(url) {
  if (!isString(url) || url.length === 0) return false
  url = url.replace(/\/+$/, "")

  var idx = this.workers.indexOf(url)
  if (idx < 0) return false

  if (isArray(this._staticWorkers) && this._staticWorkers.indexOf(url) >= 0) {
    return false
  }

  this.workers.splice(idx, 1)
  delete this._workerProfiles[url]
  delete this._deadWorkers[url]
  delete this._deadWorkerInfo[url]
  delete this._workerFailures[url]
  delete this._workerLastHeartbeat[url]

  if (this.workers.length === 0) {
    this.remoteDelegation = false
  }

  try {
    this.interactionFn("delegate", "[worker] Dynamically deregistered worker: " + url)
  } catch(ignoreInteractionErr) {}

  return true
}

SubtaskManager.prototype.getRegisteredWorkers = function() {
  var parent = this
  return this.workers.map(function(url) {
    return {
      url: url,
      static: isArray(parent._staticWorkers) && parent._staticWorkers.indexOf(url) >= 0,
      healthy: parent._deadWorkers[url] !== true,
      lastHeartbeat: parent._workerLastHeartbeat[url] || null,
      profile: parent._workerProfiles[url] || null
    }
  })
}

SubtaskManager.prototype._probeWorkerProfile = function(workerUrl, attempts, inlineCard) {
  var maxAttempts = _$(attempts, "attempts").isNumber().default(1)
  if (maxAttempts < 1) maxAttempts = 1
  var lastProfile = { status: "unknown", name: "", description: "", signature: "unknown", capabilities: [], limits: {} }
  var lastErr = "unknown probe failure"

  // If an inline AgentCard is provided, try it first (single attempt)
  if (isMap(inlineCard) && isString(inlineCard.name) && inlineCard.name.trim().length > 0) {
    var inlineProfile = this._fetchWorkerProfile(workerUrl, inlineCard)
    if (isMap(inlineProfile) && inlineProfile.status === "ok") {
      return { ok: true, profile: inlineProfile, attempts: 1, error: __ }
    }
  }

  for (var i = 0; i < maxAttempts; i++) {
    var profile = this._fetchWorkerProfile(workerUrl)
    lastProfile = profile
    if (isMap(profile) && profile.status === "ok") {
      return { ok: true, profile: profile, attempts: i + 1, error: __ }
    }
    if (isMap(profile) && isString(profile.error) && profile.error.length > 0) {
      lastErr = profile.error
    } else {
      lastErr = "Worker profile endpoint did not return status=ok"
    }
    if (i < maxAttempts - 1) sleep(this.workerProbeRetryDelayMs, true)
  }

  return { ok: false, profile: lastProfile, attempts: maxAttempts, error: lastErr }
}

SubtaskManager.prototype._fetchWorkerProfile = function(workerUrl, inlineCard) {
  var headers = {}
  if (isString(this.parentArgs.apitoken) && this.parentArgs.apitoken.length > 0) {
    headers.Authorization = "Bearer " + this.parentArgs.apitoken
  }

  var parent = this

  // Option A: use inline AgentCard provided at registration time (skips HTTP fetch)
  var response = __
  var usedFallback = false

  if (isMap(inlineCard) && isString(inlineCard.name) && inlineCard.name.trim().length > 0) {
    // Synthesise a response-like map from the inline AgentCard
    response = {
      name: inlineCard.name,
      description: inlineCard.description || "",
      capabilities: ["run-goal", "delegation", "planning"].concat(isArray(inlineCard.additionalInterfaces) && inlineCard.additionalInterfaces.indexOf("agent-comms-v1") >= 0 ? ["agent-comms-v1"] : []),
      skills: isArray(inlineCard.skills) ? inlineCard.skills : [],
      limits: isMap(inlineCard.limits) ? inlineCard.limits : {}
    }
  } else {
    // Option B: fetch /.well-known/agent.json as primary canonical source; fall back to /info for 0.3.x workers
    try {
      var cardResp = $rest({ requestHeaders: headers }).get(workerUrl + "/.well-known/agent.json")
      if (isMap(cardResp) && isString(cardResp.name) && cardResp.name.trim().length > 0) {
        response = {
          name: cardResp.name,
          description: cardResp.description || "",
          capabilities: ["run-goal", "delegation", "planning", "a2a-http-json-rest"].concat(isArray(cardResp.additionalInterfaces) && cardResp.additionalInterfaces.indexOf("agent-comms-v1") >= 0 ? ["agent-comms-v1"] : []),
          skills: isArray(cardResp.skills) ? cardResp.skills : [],
          limits: isMap(cardResp.limits) ? cardResp.limits : {}
        }
        if (isString(cardResp.protocolVersion) && cardResp.protocolVersion !== "0.4.0") {
          // Older worker — log mismatch but continue
        }
      }
    } catch(ignoreAgentCardFetchErr) {}

    if (!isMap(response)) {
      // Fallback to /info for workers that don't expose /.well-known/agent.json (protocol 0.3.x)
      usedFallback = true
      try {
        response = $rest({ requestHeaders: headers }).get(workerUrl + "/info")
      } catch(ignoreInfoErr) {
        var errMsg2 = isDef(ignoreInfoErr) && isString(ignoreInfoErr.message) ? ignoreInfoErr.message : stringify(ignoreInfoErr, __, "")
        return { status: "unknown", name: "", description: "", signature: "unknown", capabilities: [], skills: [], limits: {}, error: errMsg2 }
      }
    }
  }

  try {
    if (!isMap(response)) {
      return { status: "unknown", name: "", description: "", signature: "unknown", capabilities: [], limits: {}, error: "Worker profile response is not a map" }
    }

    var capabilities = []
    if (isArray(response.capabilities)) {
      capabilities = response.capabilities
        .filter(function(cap) { return isString(cap) && cap.trim().length > 0 })
        .map(function(cap) { return cap.trim().toLowerCase() })
        .sort()
    }

    var skills = this._normalizeWorkerSkills(response.skills)
    // For /info fallback on old workers: if skills still empty, try agent.json as secondary
    if (skills.length === 0 && usedFallback) {
      try {
        var agentCard = $rest({ requestHeaders: headers }).get(workerUrl + "/.well-known/agent.json")
        if (isMap(agentCard)) skills = parent._normalizeWorkerSkills(agentCard.skills)
      } catch(ignoreAgentCardErr) {}
    }

    var limits = isMap(response.limits) ? response.limits : {}
    var normalizedLimits = {
      maxConcurrent: isDef(limits.maxConcurrent) ? Number(limits.maxConcurrent) : __,
      defaultTimeoutMs: isDef(limits.defaultTimeoutMs) ? Number(limits.defaultTimeoutMs) : __,
      maxTimeoutMs: isDef(limits.maxTimeoutMs) ? Number(limits.maxTimeoutMs) : __,
      maxSteps: isDef(limits.maxSteps) ? Number(limits.maxSteps) : __
      // useshell removed in protocol 0.4.0 — shell is now declared via the 'shell' A2A skill
    }

    var workerName = isString(response.name) ? response.name.trim() : ""
    var workerDesc = isString(response.description) ? response.description.trim() : ""
    var signatureObj = {
      name: workerName,
      description: workerDesc,
      capabilities: capabilities,
      limits: normalizedLimits,
      skills: skills
    }

    return {
      status: "ok",
      name: workerName,
      description: workerDesc,
      capabilities: capabilities,
      skills: skills,
      limits: normalizedLimits,
      signature: stringify(signatureObj, __, "")
    }
  } catch(ignoreProfileErr) {
    var errMsg = isDef(ignoreProfileErr) && isString(ignoreProfileErr.message) ? ignoreProfileErr.message : stringify(ignoreProfileErr, __, "")
    return { status: "unknown", name: "", description: "", signature: "unknown", capabilities: [], skills: [], limits: {}, error: errMsg }
  }
}

SubtaskManager.prototype._tokenizeWorkerText = function(value) {
  if (!isString(value) || value.trim().length === 0) return []
  var normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
  if (normalized.length === 0) return []

  var stop = {
    "the": true, "and": true, "for": true, "with": true, "that": true, "this": true,
    "from": true, "into": true, "your": true, "their": true, "then": true, "than": true,
    "have": true, "will": true, "would": true, "should": true, "could": true, "about": true,
    "goal": true, "goals": true, "task": true, "tasks": true, "agent": true, "agents": true,
    "worker": true, "workers": true, "using": true, "uses": true, "used": true, "make": true,
    "list": true, "show": true, "give": true, "gets": true, "get": true, "current": true,
    "both": true, "into": true, "each": true
  }

  var seen = {}
  return normalized.split(/\s+/)
    .filter(function(token) {
      if (!isString(token) || token.length < 2) return false
      if (stop[token] === true) return false
      if (seen[token] === true) return false
      seen[token] = true
      return true
    })
}

SubtaskManager.prototype._normalizeWorkerSkills = function(skills) {
  if (!isArray(skills)) return []
  var parent = this
  var normalized = []

  skills.forEach(function(entry, idx) {
    var skill = {}
    if (isString(entry) && entry.trim().length > 0) {
      skill.id = entry.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
      skill.name = entry.trim()
      skill.description = ""
      skill.tags = []
      skill.examples = []
    } else if (isMap(entry)) {
      skill.id = isString(entry.id) ? entry.id.trim() : ""
      skill.name = isString(entry.name) ? entry.name.trim() : ""
      skill.description = isString(entry.description) ? entry.description.trim() : ""
      skill.tags = isArray(entry.tags) ? entry.tags.filter(function(tag) { return isString(tag) && tag.trim().length > 0 }).map(function(tag) { return tag.trim().toLowerCase() }) : []
      skill.examples = isArray(entry.examples) ? entry.examples.filter(function(example) { return isString(example) && example.trim().length > 0 }).map(function(example) { return example.trim() }) : []
    } else {
      return
    }

    if (!isString(skill.id) || skill.id.length === 0) {
      if (isString(skill.name) && skill.name.length > 0) {
        skill.id = skill.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
      } else {
        skill.id = "skill-" + idx
      }
    }
    if (!isString(skill.name) || skill.name.length === 0) skill.name = skill.id
    if (!isString(skill.description)) skill.description = ""
    if (!isArray(skill.tags)) skill.tags = []
    if (!isArray(skill.examples)) skill.examples = []

    var tokenBag = []
    tokenBag = tokenBag.concat(parent._tokenizeWorkerText(skill.id))
    tokenBag = tokenBag.concat(parent._tokenizeWorkerText(skill.name))
    tokenBag = tokenBag.concat(parent._tokenizeWorkerText(skill.description))
    skill.tags.forEach(function(tag) {
      tokenBag = tokenBag.concat(parent._tokenizeWorkerText(tag))
    })
    skill.examples.forEach(function(example) {
      tokenBag = tokenBag.concat(parent._tokenizeWorkerText(example))
    })
    var seenTokens = {}
    skill.tokens = tokenBag.filter(function(token) {
      if (seenTokens[token] === true) return false
      seenTokens[token] = true
      return true
    })

    normalized.push(skill)
  })

  return normalized
}

SubtaskManager.prototype._getHealthyWorkers = function() {
  if (!isArray(this.workers) || this.workers.length === 0) return []
  this._tryReviveDeadWorkers(false)
  var parent = this
  var healthy = this.workers.filter(function(workerUrl) {
    return parent._deadWorkers[workerUrl] !== true
  })
  if (healthy.length === 0 && Object.keys(this._deadWorkers).length > 0) {
    this._tryReviveDeadWorkers(true)
    healthy = this.workers.filter(function(workerUrl) {
      return parent._deadWorkers[workerUrl] !== true
    })
  }
  return healthy
}

SubtaskManager.prototype._tryReviveDeadWorkers = function(force) {
  if (!this.remoteDelegation) return
  var nowTs = new Date().getTime()
  var forceProbe = toBoolean(force) === true
  if (!forceProbe && (nowTs - this._lastReviveProbeAt) < this.workerReviveProbeIntervalMs) return
  this._lastReviveProbeAt = nowTs
  var parent = this

  Object.keys(this._deadWorkers).forEach(function(workerUrl) {
    if (parent._deadWorkers[workerUrl] !== true) return
    var deadInfo = isMap(parent._deadWorkerInfo[workerUrl]) ? parent._deadWorkerInfo[workerUrl] : {}
    var nextProbeAt = _$(deadInfo.nextProbeAt, "deadInfo.nextProbeAt").isNumber().default(0)
    if (!forceProbe && nextProbeAt > nowTs) return

    var probe = parent._probeWorkerProfile(workerUrl, parent.workerProbeRetries)
    parent._workerProfiles[workerUrl] = probe.profile
    if (probe.ok) {
      parent._markWorkerAlive(workerUrl, "Worker recovered via /info probe")
    } else {
      parent._deadWorkerInfo[workerUrl] = {
        deadAt: _$(deadInfo.deadAt, "deadInfo.deadAt").isNumber().default(nowTs),
        reason: isString(probe.error) && probe.error.length > 0 ? probe.error : "Worker remains unavailable",
        nextProbeAt: nowTs + parent.workerReviveCooldownMs
      }
    }
  })
}

SubtaskManager.prototype._markWorkerAlive = function(workerUrl, reason) {
  if (!isString(workerUrl) || workerUrl.length === 0) return
  if (this._deadWorkers[workerUrl] !== true) {
    this._workerFailures[workerUrl] = 0
    return
  }
  delete this._deadWorkers[workerUrl]
  delete this._deadWorkerInfo[workerUrl]
  this._workerFailures[workerUrl] = 0
  var aliveReason = isString(reason) && reason.length > 0 ? reason : "Worker recovered"
  try {
    this.interactionFn("delegate", "[worker] Worker marked healthy again: " + workerUrl + " (" + aliveReason + ")")
  } catch(ignoreInteractionErr) {}
}

SubtaskManager.prototype._markWorkerDead = function(workerUrl, reason) {
  if (!isString(workerUrl) || workerUrl.length === 0) return
  if (this._deadWorkers[workerUrl] === true) return
  this._deadWorkers[workerUrl] = true
  var nowTs = new Date().getTime()
  var deadReason = isString(reason) && reason.length > 0 ? reason : "Marked dead"
  this._deadWorkerInfo[workerUrl] = {
    deadAt: nowTs,
    reason: deadReason,
    nextProbeAt: nowTs + this.workerReviveCooldownMs
  }
  try {
    this.interactionFn("delegate", "[worker] Marking worker as dead for this session: " + workerUrl + " (" + deadReason + ")")
  } catch(ignoreInteractionErr) {}
}

SubtaskManager.prototype._recordWorkerFailure = function(workerUrl, error) {
  if (!isString(workerUrl) || workerUrl.length === 0) return
  var failures = _$(this._workerFailures[workerUrl], "this._workerFailures[workerUrl]").isNumber().default(0) + 1
  this._workerFailures[workerUrl] = failures
  if (failures >= this.workerMaxFailures) {
    var reason = "Repeated transport/runtime failures"
    if (isString(error) && error.length > 0) reason += ": " + error
    this._markWorkerDead(workerUrl, reason)
  }
}

SubtaskManager.prototype._recordWorkerSuccess = function(workerUrl) {
  if (!isString(workerUrl) || workerUrl.length === 0) return
  this._workerFailures[workerUrl] = 0
}

SubtaskManager.prototype._buildWorkerRequirements = function(subtask, mergedArgs) {
  var args = isMap(mergedArgs) ? mergedArgs : {}
  var goalText = isDef(subtask) && isString(subtask.goal) ? subtask.goal.toLowerCase() : ""
  return {
    goalText: goalText,
    goalTokens: this._tokenizeWorkerText(goalText),
    requiresRunGoal: true,
    requiresPlanning: toBoolean(args.useplanning) === true,
    requestedMaxSteps: isDef(args.maxsteps) ? Number(args.maxsteps) : __,
    requestedTimeoutMs: isDef(subtask) && isDef(subtask.deadlineMs) ? Number(subtask.deadlineMs) : __,
    workerHint: isString(args._workerHint) && args._workerHint.trim().length > 0 ? args._workerHint.trim().toLowerCase() : __,
    requiredSkills: isArray(args._requiredSkills) ? args._requiredSkills.map(function(s) { return String(s).trim().toLowerCase() }).filter(function(s) { return s.length > 0 }) : [],
    requiresComms: isDef(args.agentcomms) && (MiniAComms.enabled(MiniAComms.normalize(args.agentcomms)) || isDef(MiniAComms.normalize(args.agentcomms).delegate)),
    requiresShell: toBoolean(args.useshell) === true
  }
}

SubtaskManager.prototype._isWorkerProfileCompatible = function(profile, requirements) {
  var req = isMap(requirements) ? requirements : {}
  var p = isMap(profile) ? profile : {}
  var caps = isArray(p.capabilities) ? p.capabilities : []
  var limits = isMap(p.limits) ? p.limits : {}
  if (req.requiresComms === true && caps.indexOf("agent-comms-v1") < 0) return false
  var hasCapsInfo = caps.length > 0

  if (p.status === "ok") {
    // Some providers/bridges can return incomplete capability metadata.
    // Enforce capability flags only when capabilities are actually present.
    if (req.requiresRunGoal === true && hasCapsInfo && caps.indexOf("run-goal") < 0) return false
    if (req.requiresPlanning === true && hasCapsInfo && caps.indexOf("planning") < 0) return false
    if (req.requiresShell === true) {
      // Protocol 0.4.0 dropped limits.useshell; shell is now declared as the 'shell' A2A skill.
      // Accept the worker if it has either the legacy flag or the 'shell' skill.
      var hasShellSkill = isArray(p.skills) && p.skills.some(function(s) { return isMap(s) && s.id === "shell" })
      if (!hasShellSkill && toBoolean(limits.useshell) !== true) return false
    }

    // Required skills: ALL listed skill IDs/tags must be present on the worker
    if (isArray(req.requiredSkills) && req.requiredSkills.length > 0) {
      var skills = isArray(p.skills) ? p.skills : []
      var skillIds  = skills.map(function(s) { return isString(s.id) ? s.id.toLowerCase() : "" })
      var skillTags = []
      skills.forEach(function(s) { if (isArray(s.tags)) s.tags.forEach(function(t) { skillTags.push(t.toLowerCase()) }) })
      var allPresent = req.requiredSkills.every(function(required) {
        return skillIds.indexOf(required) >= 0 || skillTags.indexOf(required) >= 0
      })
      if (!allPresent) return false
    }

    if (isNumber(req.requestedMaxSteps) && req.requestedMaxSteps > 0 && isNumber(limits.maxSteps) && limits.maxSteps > 0 && limits.maxSteps < req.requestedMaxSteps) {
      return false
    }
    if (isNumber(req.requestedTimeoutMs) && req.requestedTimeoutMs > 0 && isNumber(limits.maxTimeoutMs) && limits.maxTimeoutMs > 0 && limits.maxTimeoutMs < req.requestedTimeoutMs) {
      return false
    }
  }

  return true
}

SubtaskManager.prototype._scoreWorkerProfile = function(profile, requirements) {
  var req = isMap(requirements) ? requirements : {}
  var p = isMap(profile) ? profile : {}
  var caps = isArray(p.capabilities) ? p.capabilities : []
  var skills = isArray(p.skills) ? p.skills : []
  var limits = isMap(p.limits) ? p.limits : {}
  var goalText = isString(req.goalText) ? req.goalText : ""
  var goalTokens = isArray(req.goalTokens) ? req.goalTokens : []
  var nameText = isString(p.name) ? p.name.toLowerCase() : ""
  var descText = isString(p.description) ? p.description.toLowerCase() : ""

  var score = 0
  var skillScore = 0
  if (p.status === "ok") score += 1000
  if (caps.indexOf("run-goal") >= 0) score += 200
  if (req.requiresPlanning === true && caps.indexOf("planning") >= 0) score += 120

  if (isNumber(req.requestedMaxSteps) && req.requestedMaxSteps > 0 && isNumber(limits.maxSteps) && limits.maxSteps > 0) {
    score += Math.max(0, Math.min(100, limits.maxSteps - req.requestedMaxSteps))
  }
  if (isNumber(req.requestedTimeoutMs) && req.requestedTimeoutMs > 0 && isNumber(limits.maxTimeoutMs) && limits.maxTimeoutMs > 0) {
    score += Math.max(0, Math.min(100, Math.floor((limits.maxTimeoutMs - req.requestedTimeoutMs) / 1000)))
  }
  if (isNumber(limits.maxConcurrent) && limits.maxConcurrent > 0) {
    score += Math.min(50, limits.maxConcurrent)
  }

  var bestSkill = __
  skills.forEach(function(skill) {
    if (!isMap(skill)) return
    var current = 0
    var matchedTokens = []
    var nameValue = isString(skill.name) ? skill.name.toLowerCase() : ""
    var idValue = isString(skill.id) ? skill.id.toLowerCase() : ""
    var descValue = isString(skill.description) ? skill.description.toLowerCase() : ""
    var tags = isArray(skill.tags) ? skill.tags : []
    var examples = isArray(skill.examples) ? skill.examples : []
    var tokens = isArray(skill.tokens) ? skill.tokens : []

    if (goalText.length > 0 && nameValue.length > 0 && goalText.indexOf(nameValue) >= 0) current += 140
    if (goalText.length > 0 && idValue.length > 0 && goalText.indexOf(idValue.replace(/-/g, " ")) >= 0) current += 120

    tags.forEach(function(tag) {
      if (!isString(tag)) return
      var tagText = tag.toLowerCase()
      if (goalText.indexOf(tagText) >= 0) current += 90
    })

    tokens.forEach(function(token) {
      if (goalTokens.indexOf(token) < 0) return
      matchedTokens.push(token)
      current += 20
    })

    examples.forEach(function(example) {
      var exampleText = isString(example) ? example.toLowerCase() : ""
      if (exampleText.length > 0 && goalText.length > 0 && (goalText.indexOf(exampleText) >= 0 || exampleText.indexOf(goalText) >= 0)) {
        current += 80
      }
    })

    if (matchedTokens.length > 0 && descValue.length > 0) current += Math.min(60, matchedTokens.length * 10)
    if (current > skillScore) {
      skillScore = current
      bestSkill = {
        id: skill.id,
        name: skill.name,
        matchedTokens: matchedTokens
      }
    }
  })

  score += skillScore
  if (goalText.length > 0 && nameText.length > 0 && goalText.indexOf(nameText) >= 0) {
    score += 80
  }
  if (goalText.length > 0 && descText.length > 0) {
    var tokens = descText.split(/\s+/).filter(function(token) { return token.length > 4 })
    var matched = 0
    tokens.forEach(function(token) {
      if (goalText.indexOf(token) >= 0) matched++
    })
    if (matched > 0) score += Math.min(60, matched * 10)
  }

  return {
    score: score,
    skillScore: skillScore,
    bestSkill: bestSkill
  }
}

SubtaskManager.prototype._nextWorkerForSubtask = function(subtask, mergedArgs) {
  this._lastWorkerSelectionError = __
  this._lastWorkerSelectionDetails = __
  var healthyWorkers = this._getHealthyWorkers()
  if (healthyWorkers.length === 0) {
    var deadReasons = []
    var parent = this
    this.workers.forEach(function(workerUrl) {
      var deadInfo = parent._deadWorkerInfo[workerUrl]
      if (isMap(deadInfo) && isString(deadInfo.reason) && deadInfo.reason.length > 0) {
        deadReasons.push(workerUrl + ": " + deadInfo.reason)
      }
    })
    this._lastWorkerSelectionError = deadReasons.length > 0
      ? "No healthy remote workers available. Last probe reasons: " + deadReasons.join(" | ")
      : "No healthy remote workers available"
    return __
  }

  var req = this._buildWorkerRequirements(subtask, mergedArgs)
  var parent = this
  var evaluations = {}
  var compatible = healthyWorkers.filter(function(workerUrl) {
    return parent._isWorkerProfileCompatible(parent._workerProfiles[workerUrl], req)
  })

  if (compatible.length === 0) {
    // Re-probe once before declaring incompatibility (profiles can become stale).
    this._refreshWorkerProfiles()
    healthyWorkers = this._getHealthyWorkers()
    compatible = healthyWorkers.filter(function(workerUrl) {
      return parent._isWorkerProfileCompatible(parent._workerProfiles[workerUrl], req)
    })
  }

  if (compatible.length === 0) {
    var healthySummary = healthyWorkers.map(function(workerUrl) {
      var profile = parent._workerProfiles[workerUrl] || {}
      var skillIds = isArray(profile.skills) ? profile.skills.map(function(s) { return s.id || "" }).filter(function(s) { return s.length > 0 }).join(",") : ""
      return workerUrl + (skillIds.length > 0 ? "(skills=" + skillIds + ")" : "")
    }).join(", ")
    this._lastWorkerSelectionError = "No compatible remote workers available for current requirements. Healthy workers: " + (healthySummary.length > 0 ? healthySummary : "none")
    return __
  }

  // workerHint soft pre-filter: narrow to workers matching the hint by name/description/URL (falls through if no match)
  if (isString(req.workerHint) && req.workerHint.length > 0) {
    var hint = req.workerHint
    var hinted = compatible.filter(function(workerUrl) {
      var profile = parent._workerProfiles[workerUrl] || {}
      if (isString(profile.name) && profile.name.toLowerCase().indexOf(hint) >= 0) return true
      if (isString(profile.description) && profile.description.toLowerCase().indexOf(hint) >= 0) return true
      if (workerUrl.toLowerCase().indexOf(hint) >= 0) return true
      return false
    })
    try { global.__mini_a_metrics.delegation_worker_hint_used.inc() } catch(ignoreMetric) {}
    if (hinted.length > 0) {
      try { global.__mini_a_metrics.delegation_worker_hint_matched.inc() } catch(ignoreMetric) {}
      compatible = hinted
    } else {
      try { global.__mini_a_metrics.delegation_worker_hint_fallthrough.inc() } catch(ignoreMetric) {}
    }
  }

  var grouped = {}
  compatible.forEach(function(workerUrl) {
    var profile = parent._workerProfiles[workerUrl]
    evaluations[workerUrl] = parent._scoreWorkerProfile(profile, req)
    var signature = isMap(profile) && isString(profile.signature) ? profile.signature : "unknown"
    if (!isArray(grouped[signature])) grouped[signature] = []
    grouped[signature].push(workerUrl)
  })

  var signatures = Object.keys(grouped)
  if (signatures.length === 0) {
    return __
  }

  signatures.sort(function(a, b) {
    var evalA = evaluations[grouped[a][0]] || { score: 0 }
    var evalB = evaluations[grouped[b][0]] || { score: 0 }
    var scoreA = evalA.score
    var scoreB = evalB.score
    if (scoreA === scoreB) return a.localeCompare(b)
    return scoreB - scoreA
  })

  var bestSignature = signatures[0]
  var bestWorkers = grouped[bestSignature]
  if (!isArray(bestWorkers) || bestWorkers.length === 0) {
    return __
  }

  var groupCursor = _$(this._workerGroupCursor[bestSignature], "this._workerGroupCursor[bestSignature]").isNumber().default(0)
  var idx = groupCursor % bestWorkers.length
  this._workerGroupCursor[bestSignature] = groupCursor + 1
  var selectedWorker = bestWorkers[idx]
  var selectedEval = evaluations[selectedWorker] || { score: 0, skillScore: 0 }
  this._lastWorkerSelectionDetails = {
    workerUrl: selectedWorker,
    score: selectedEval.score,
    skillScore: selectedEval.skillScore,
    matchedSkill: selectedEval.bestSkill,
    usedCompatibilityFallback: !(isNumber(selectedEval.skillScore) && selectedEval.skillScore > 0)
  }
  return selectedWorker
}

SubtaskManager.prototype._remoteCall = function(method, workerUrl, path, data) {
  var headers = { "Content-Type": "application/json" }
  if (isString(this.parentArgs.apitoken) && this.parentArgs.apitoken.length > 0) {
    headers.Authorization = "Bearer " + this.parentArgs.apitoken
  }

  var url = workerUrl + path
  if (method === "GET" && isMap(data)) {
    var queryParts = []
    Object.keys(data).forEach(function(key) {
      if (isUnDef(data[key])) return
      queryParts.push(encodeURIComponent(String(key)) + "=" + encodeURIComponent(String(data[key])))
    })
    if (queryParts.length > 0) url += "?" + queryParts.join("&")
  }

  var response
  var requestTimeoutMs = arguments.length > 4 && isNumber(arguments[4]) ? arguments[4] : 30000
  try {
    response = method === "GET"
      ? $rest({ requestHeaders: headers, timeout: requestTimeoutMs }).get(url)
      : $rest({ requestHeaders: headers, timeout: requestTimeoutMs }).post(url, data || {})
  } catch (e) {
    var errMsg = isDef(e) && isString(e.message) ? e.message : stringify(e, __, "")
    throw new Error("Remote worker request failed (" + url + "): " + errMsg)
  }

  if (!isMap(response)) {
    throw new Error("Remote worker response is not a map for endpoint " + path)
  }

  if (isString(response.error) && response.error.length > 0) {
    throw new Error("Remote worker error: " + response.error)
  }

  return response
}

SubtaskManager.prototype._remoteRequest = function(workerUrl, path, payload, timeoutMs) {
  return this._remoteCall("POST", workerUrl, path, payload, timeoutMs)
}

SubtaskManager.prototype._remoteGet = function(workerUrl, path, query, timeoutMs) {
  return this._remoteCall("GET", workerUrl, path, query, timeoutMs)
}

SubtaskManager.prototype._remoteObservationTimeoutMs = function(subtask) {
  var timeoutMs = 30000
  var now = new Date().getTime()
  if (isMap(subtask) && isNumber(subtask.totalDeadlineAt)) {
    timeoutMs = Math.min(timeoutMs, Math.max(1, subtask.totalDeadlineAt - now))
  }
  if (isMap(subtask) && isNumber(subtask.hardTimeoutMs) && subtask.hardTimeoutMs > 0 && isNumber(subtask.startedAt)) {
    timeoutMs = Math.min(timeoutMs, Math.max(1, subtask.startedAt + subtask.hardTimeoutMs - now))
  }
  return Math.round(timeoutMs)
}

SubtaskManager.prototype._completeSubtask = function(subtask, prefix, answer, metrics, state) {
  var completedAt = new Date().getTime()
  var diagnosticsScope = {
    scope: "child_execution",
    subtask_id: subtask.id,
    authority: "child state and instance diagnostics only; not parent conversation status",
    counters: "may include shared process totals"
  }
  if (!this._claimTerminal(subtask, "completed", completedAt, __, {
    answer: answer,
    diagnostics_scope: diagnosticsScope,
    metrics: metrics,
    state: state
  })) return false
  this._touchSubtask(subtask, "completed")

  if (isObject(this.parentAgent) && isObject(this.parentAgent._historyVm) && this.parentAgent._historyVm.contextVirtualization) {
    this.parentAgent._historyVm.upsertContextSource("delegation", subtask.id, {
      goal: subtask.goal, result: answer,
      child_diagnostics: { diagnostics_scope: diagnosticsScope, state: state, metrics: metrics }
    }, { type: "delegation_episode", provenance: { source: "delegated-result", child: subtask.id, coverage: "returned-result-only" } })
  }

  var duration = isDef(subtask.startedAt) ? subtask.completedAt - subtask.startedAt : 0
  this.metrics.totalDurationMs += duration
  this.metrics.completed++

  this.interactionFn("delegate", prefix + " ✅ Completed in " + Math.round(duration / 1000) + "s")
  return true
}

SubtaskManager.prototype._cancelRemoteSubtask = function(subtask, reason) {
  if (!this.remoteDelegation || !isMap(subtask) || !isString(subtask.workerUrl) || !isString(subtask.remoteTaskId)) return false
  try {
    if (this.useA2A) {
      this._remoteRequest(subtask.workerUrl, "/tasks:cancel", { id: subtask.remoteTaskId, reason: reason }, 5000)
    } else {
      this._remoteRequest(subtask.workerUrl, "/cancel", { taskId: subtask.remoteTaskId, reason: reason }, 5000)
    }
    return true
  } catch(ignoreRemoteCancel) {
    this.metrics.remoteCancelFailures++
    return false
  }
}

SubtaskManager.prototype._failRemoteOutcomeUnknown = function(subtask, prefix, error) {
  var message = "Remote outcome unknown: " + error
  if (!this._claimTerminal(subtask, "failed", new Date().getTime(), message)) return false
  this.metrics.failed++
  this.metrics.remoteOutcomeUnknown++
  if (isString(subtask.workerUrl) && subtask.workerUrl.length > 0) this._recordWorkerFailure(subtask.workerUrl, message)
  this._cancelRemoteSubtask(subtask, message)
  this.interactionFn("delegate", prefix + " ❌ " + message)
  return true
}

SubtaskManager.prototype._failOrRetrySubtask = function(subtask, prefix, error) {
  var outcome = "skipped"
  var parent = this
  sync(function() {
    if (subtask.status !== "running") return
    if (subtask.comms) subtask.comms.broker.revoke(subtask.comms.id)
    parent._touchSubtask(subtask, "failed")
    subtask.error = error

    if (subtask.attempt < subtask.maxAttempts) {
      subtask.status = "pending"
      parent._touchSubtask(subtask, "retry queued")
      subtask.metadata.previousError = error
      if (parent.pendingQueue.indexOf(subtask.id) < 0) parent.pendingQueue.push(subtask.id)
      parent.metrics.retried++
      parent.metrics.running--
      parent.runningCount--
      outcome = "retry"
      return
    }

    subtask.status = "failed"
    subtask.completedAt = new Date().getTime()
    parent.metrics.failed++
    parent.metrics.running--
    parent.runningCount--
    outcome = "failed"
  }, this._transitionLock)

  if (outcome === "skipped") return outcome
  if (outcome === "retry") {
    this.interactionFn("delegate", prefix + " ⚠️ Failed (attempt " + subtask.attempt + "/" + subtask.maxAttempts + "), will retry: " + error)
    return outcome
  }

  if (this.remoteDelegation && isString(subtask.workerUrl) && subtask.workerUrl.length > 0) {
    this._recordWorkerFailure(subtask.workerUrl, "Subtask exhausted max attempts (" + subtask.maxAttempts + ")")
  }

  this.interactionFn("delegate", prefix + " ❌ Failed after " + subtask.maxAttempts + " attempts: " + error)
  return outcome
}

SubtaskManager.prototype._startLocalSubtask = function(subtask, prefix) {
  var parent = this

  subtask._executionPromise = $doV(function() {
    var childAgent = __
    try {
      if (subtask.status !== "running") return

      childAgent = new MiniA()
      subtask.childAgent = childAgent
      if (subtask.comms) childAgent._comms = subtask.comms

      var mergedArgs = parent._buildChildArgs(subtask)

      if (isObject(parent.parentAgent) && isFunction(parent.parentAgent._prepareChildMcpHandoff)) {
        parent.parentAgent._prepareChildMcpHandoff(childAgent, mergedArgs, subtask)
      }

      childAgent.setInteractionFn(function(event, message) {
        if (event !== "comms") parent._touchSubtask(subtask, event)
        parent.interactionFn(event, prefix + " " + message)
      })

      if (subtask.status !== "running") return
      parent._touchSubtask(subtask, "initializing child agent")
      childAgent.init(mergedArgs)
      if (subtask.status !== "running") {
        if (isFunction(childAgent.requestStop)) {
          try { childAgent.requestStop(subtask.error || "Subtask cancelled before start", { quiet: true }) } catch(ignorePreStartStop) {}
        } else {
          childAgent.state = "stop"
        }
        return
      }

      parent._touchSubtask(subtask, "running child agent")
      var answer = childAgent.start(mergedArgs)
      parent._touchSubtask(subtask, "child agent returned")
      var childMetrics = childAgent.getMetrics()
      var childState = jsonParse(stringify(childAgent._agentState || {}, __, ""), __, __, true)

      if (subtask.status === "running") {
        parent._completeSubtask(subtask, prefix, answer, childMetrics, childState)
      }
    } catch (e) {
      if (subtask.status === "running") {
        var error = isDef(e) && isString(e.message) ? e.message : stringify(e, __, "")
        parent._failOrRetrySubtask(subtask, prefix, error)
      }
    } finally {
      if (isObject(childAgent) && isFunction(childAgent._stopAgentResources)) {
        try { childAgent._stopAgentResources() } catch(ignoreChildStop) {}
      }
      if (subtask.childAgent === childAgent) subtask.childAgent = __
    }

    try {
      parent._processQueue()
    } catch(ignoreQueue) {}
  })
}

SubtaskManager.prototype._startRemoteSubtask = function(subtask, prefix) {
  var parent = this

  subtask._executionPromise = $doV(function() {
    var submissionAttempted = false
    // Worker identity belongs to one attempt. A retry must never poll or
    // cancel the previous attempt if selection or submission fails.
    subtask.workerUrl = __
    subtask.remoteTaskId = __
    try {
      var mergedArgs = parent._buildChildArgs(subtask)
      var workerUrl = parent._nextWorkerForSubtask(subtask, mergedArgs)
      if (!isString(workerUrl) || workerUrl.length === 0) {
        throw new Error(isString(parent._lastWorkerSelectionError) && parent._lastWorkerSelectionError.length > 0 ? parent._lastWorkerSelectionError : "No healthy remote workers available")
      }

      subtask.workerUrl = workerUrl
      subtask.remoteEventIndex = 0
      parent._touchSubtask(subtask, "remote worker selected")

      var timeoutSec = Math.max(1, Math.ceil(subtask.deadlineMs / 1000))
      var metadata = merge({}, subtask.metadata || {})
      metadata.parentSubtaskId = subtask.parentId
      metadata.delegationDepth = subtask.depth

      var commsWire
      if (subtask.comms) {
        subtask.commsToken = genUUID()
        commsWire = { version: 1, token: subtask.commsToken, id: subtask.comms.id, config: subtask.comms.config }
      }
      var taskResponse
      if (parent.useA2A) {
        submissionAttempted = true
        taskResponse = parent._remoteRequest(workerUrl, "/message:send", {
          message: {
            messageId: "mini-a-" + subtask.id,
            role: "user",
            parts: [
              {
                kind: "text",
                text: subtask.goal
              }
            ]
          },
          contextId: isString(subtask.parentId) ? subtask.parentId : subtask.id,
          metadata: {
            args: mergedArgs,
            communication: commsWire,
            forkState: (subtask.fork === true && isString(mergedArgs.state) && mergedArgs.state.length > 0) ? mergedArgs.state : __
          },
          configuration: {
            timeoutSeconds: timeoutSec
          }
        })
      } else {
        var legacyPayload = {
          goal: subtask.goal,
          args: mergedArgs,
          timeout: timeoutSec,
          metadata: metadata,
          communication: commsWire
        }
        if (subtask.fork === true && isString(mergedArgs.state) && mergedArgs.state.length > 0) {
          legacyPayload.forkState = mergedArgs.state
        }
        submissionAttempted = true
        taskResponse = parent._remoteRequest(workerUrl, "/task", legacyPayload)
      }

      if (parent.useA2A) {
        if (!isMap(taskResponse.task) || !isString(taskResponse.task.id) || taskResponse.task.id.length === 0) {
          throw new Error("Remote worker did not return task.id")
        }
        subtask.remoteTaskId = taskResponse.task.id
      } else {
        if (!isString(taskResponse.taskId) || taskResponse.taskId.length === 0) {
          throw new Error("Remote worker did not return taskId")
        }
        subtask.remoteTaskId = taskResponse.taskId
      }
      // Cancellation can win while the submission request is in flight. Once
      // the worker returns an ID, stop that late-accepted task before exiting.
      if (subtask.status !== "running") {
        parent._cancelRemoteSubtask(subtask, subtask.error || "Cancelled while remote task was submitted")
        return
      }
      parent.interactionFn("delegate", prefix + " Routed to worker: " + workerUrl)
      parent._touchSubtask(subtask, "routed to remote worker")
      if (isMap(parent._lastWorkerSelectionDetails) && parent._lastWorkerSelectionDetails.workerUrl === workerUrl) {
        if (isMap(parent._lastWorkerSelectionDetails.matchedSkill) && isString(parent._lastWorkerSelectionDetails.matchedSkill.name) && parent._lastWorkerSelectionDetails.matchedSkill.name.length > 0) {
          parent.interactionFn("delegate", prefix + " Worker skill match: " + parent._lastWorkerSelectionDetails.matchedSkill.name)
        } else if (parent._lastWorkerSelectionDetails.usedCompatibilityFallback === true) {
          parent.interactionFn("delegate", prefix + " Worker routing used compatibility fallback (no strong skill match)")
        }
      }

      var remotePollFailures = 0
      while (subtask.status === "running") {
        sleep(parent.remotePollIntervalMs, true)
        if (subtask.status !== "running") break

        if (subtask.comms) {
          try { parent._exchangeComms(subtask) }
          catch(exchangeError) { subtask.comms.broker.metrics.remote_retries++ }
        }
        var status
        var remoteStatus = "running"

        try {
        if (parent.useA2A) {
          status = parent._remoteGet(workerUrl, "/tasks", { id: subtask.remoteTaskId }, parent._remoteObservationTimeoutMs(subtask))
          if (isMap(status.task) && isMap(status.task.status) && isString(status.task.status.timestamp)) {
            try {
              var remoteTs = (new Date(status.task.status.timestamp)).getTime()
              if (isNumber(remoteTs) && (!isNumber(subtask.remoteLastActivityAt) || remoteTs > subtask.remoteLastActivityAt)) {
                subtask.remoteLastActivityAt = remoteTs
                parent._touchSubtask(subtask, "remote status update")
              }
            } catch(ignoreRemoteTs) {}
          }
          var remoteState = isMap(status.task) && isMap(status.task.status) && isString(status.task.status.state) ? status.task.status.state.toUpperCase() : "TASK_STATE_WORKING"
          if (remoteState === "TASK_STATE_COMPLETED") remoteStatus = "completed"
          if (remoteState === "TASK_STATE_FAILED") remoteStatus = isMap(status.task) && isMap(status.task.status) && status.task.status.reason === "timeout" ? "timeout" : "failed"
          if (remoteState === "TASK_STATE_CANCELED" || remoteState === "TASK_STATE_CANCELLED") remoteStatus = "cancelled"
        } else {
          status = parent._remoteRequest(workerUrl, "/status", { taskId: subtask.remoteTaskId }, parent._remoteObservationTimeoutMs(subtask))
          remoteStatus = isString(status.status) ? status.status.toLowerCase() : "running"

          if (isNumber(status.lastActivityAt) && (!isNumber(subtask.remoteLastActivityAt) || status.lastActivityAt > subtask.remoteLastActivityAt)) {
            subtask.remoteLastActivityAt = status.lastActivityAt
            parent._touchSubtask(subtask, isString(status.lastActivityReason) ? "remote " + status.lastActivityReason : "remote activity")
          }

          if (isArray(status.events)) {
            var seenEvents = _$(subtask.remoteEventIndex, "subtask.remoteEventIndex").isNumber().default(0)
            for (var i = seenEvents; i < status.events.length; i++) {
              var evt = status.events[i]
              if (isMap(evt) && isString(evt.message) && evt.message.length > 0) {
                if (isNumber(evt.ts)) subtask.remoteLastActivityAt = evt.ts
                parent._touchSubtask(subtask, "remote event")
                parent.interactionFn("delegate", prefix + " " + evt.message)
              }
            }
            subtask.remoteEventIndex = status.events.length
          }
        }
        remotePollFailures = 0
        } catch(pollError) {
          remotePollFailures++
          parent.metrics.remotePollRetries++
          if (remotePollFailures < 3 && subtask.status === "running") {
            parent.interactionFn("delegate", prefix + " ⚠️ Remote status request failed; retrying observation (" + remotePollFailures + "/3)")
            continue
          }
          var pollMessage = isDef(pollError) && isString(pollError.message) ? pollError.message : stringify(pollError, __, "")
          parent._failRemoteOutcomeUnknown(subtask, prefix, "could not observe task " + subtask.remoteTaskId + ": " + pollMessage)
          return
        }

        if (remoteStatus === "queued" || remoteStatus === "running") continue

        var resultPayload = __
        var resultErrMsg = __

        if (remoteStatus === "completed") {
          // /status can flip to completed slightly before /result is available.
          for (var attempt = 0; attempt < 5; attempt++) {
            try {
              resultPayload = parent._remoteRequest(workerUrl, "/result", { taskId: subtask.remoteTaskId }, parent._remoteObservationTimeoutMs(subtask))
              if (isMap(resultPayload) && isMap(resultPayload.result)) break
            } catch (resultErr) {
              resultErrMsg = isDef(resultErr) && isString(resultErr.message) ? resultErr.message : stringify(resultErr, __, "")
            }
            sleep(250, true)
          }

          if (!(isMap(resultPayload) && isMap(resultPayload.result))) {
            parent._failRemoteOutcomeUnknown(subtask, prefix, "task completed but its result is unavailable" + (isString(resultErrMsg) ? ": " + resultErrMsg : ""))
            return
          }

          var remoteResult = isMap(resultPayload) && isMap(resultPayload.result) ? resultPayload.result : {}
          var remoteError = isDef(remoteResult.error) ? String(remoteResult.error) : __

          if (isString(remoteError) && remoteError.length > 0) {
            parent._failOrRetrySubtask(subtask, prefix, remoteError)
            return
          }

          parent._completeSubtask(
            subtask,
            prefix,
            remoteResult.answer,
            isMap(remoteResult.metrics) ? remoteResult.metrics : {},
            isMap(remoteResult.state) ? remoteResult.state : {}
          )
          parent._recordWorkerSuccess(workerUrl)
          return
        }

        resultPayload = __
        try {
          resultPayload = parent._remoteRequest(workerUrl, "/result", { taskId: subtask.remoteTaskId }, parent._remoteObservationTimeoutMs(subtask))
        } catch(ignoreResultErr) {}

        var failedMsg = "Remote subtask ended with status: " + remoteStatus
        if (isMap(resultPayload) && isMap(resultPayload.result) && isDef(resultPayload.result.error)) {
          failedMsg = String(resultPayload.result.error)
        }
        if (remoteStatus === "timeout") {
          if (parent._claimTerminal(subtask, "timeout", new Date().getTime(), failedMsg)) parent.metrics.timedout++
          return
        }
        if (remoteStatus === "cancelled") {
          if (parent._claimTerminal(subtask, "cancelled", new Date().getTime(), failedMsg)) parent.metrics.cancelled++
          return
        }
        parent._failOrRetrySubtask(subtask, prefix, failedMsg)
        return
      }
    } catch (e) {
      if (subtask.status === "running") {
        var error = isDef(e) && isString(e.message) ? e.message : stringify(e, __, "")
        // A failed response does not prove the worker rejected the submission.
        // Without an idempotency contract, replay could duplicate side effects.
        if (submissionAttempted) parent._failRemoteOutcomeUnknown(subtask, prefix, error)
        else parent._failOrRetrySubtask(subtask, prefix, error)
      }
    }

    try {
      parent._processQueue()
    } catch(ignoreQueue) {}
  })
}

/**
 * <odoc>
 * <key>SubtaskManager.submit(goal, childArgs, opts)</key>
 * Creates a subtask entry with status "pending". Validates depth and queues it.
 * Returns the subtask ID.
 * 
 * Parameters:
 * - goal: The sub-goal for the child agent
 * - childArgs: Optional overrides for child agent configuration
 * - opts: Optional { deadlineMs, maxAttempts, metadata }
 * </odoc>
 */
SubtaskManager.prototype.submit = function(goal, childArgs, opts) {
  if (!isString(goal) || goal.trim().length === 0) {
    throw new Error("Goal is required and must be a non-empty string")
  }
  
  opts = _$(opts, "opts").isMap().default({})
  childArgs = _$(childArgs, "childArgs").isMap().default({})
  if (isDef(childArgs.agentcomms)) {
    var declaration = MiniAComms.normalize(childArgs.agentcomms)
    if ((MiniAComms.enabled(declaration) || declaration.delegate) && !this.comms) throw new Error("Parent has no communication delegation allowance")
    if (this.comms) {
      var ceiling = MiniAComms.normalize(this.comms.config.delegate)
      Object.keys(declaration.limits).forEach(function(k) { declaration.limits[k] = Math.min(declaration.limits[k], ceiling.limits[k]) })
      if (!MiniAComms.subset(declaration, ceiling) || (declaration.delegate && !MiniAComms.subset(MiniAComms.normalize(declaration.delegate), ceiling))) throw new Error("Communication declaration exceeds delegation allowance")
    }
  }
  this._startWatchdog()
  
  var depth = this.currentDepth + 1
  if (depth > this.maxDepth) {
    throw new Error("Maximum delegation depth (" + this.maxDepth + ") exceeded")
  }
  
  var subtaskId = sha384(nowNano() + goal).substr(0, 16)
  var now = new Date().getTime()
  
  var subtask = {
    id: subtaskId,
    parentId: this.parentArgs._id || __,
    goal: goal,
    args: childArgs,
    status: "pending",
    result: __,
    error: __,
    metrics: __,
    agentState: __,
    createdAt: now,
    startedAt: __,
    completedAt: __,
    deadlineMs: _$(opts.deadlineMs, "opts.deadlineMs").isNumber().default(this.defaultDeadlineMs),
    stallTimeoutMs: _$(opts.stallTimeoutMs, "opts.stallTimeoutMs").isNumber().default(this.defaultStallTimeoutMs),
    hardTimeoutMs: _$(opts.hardTimeoutMs, "opts.hardTimeoutMs").isNumber().default(this.defaultHardTimeoutMs),
    totalTimeoutMs: _$(opts.totalTimeoutMs, "opts.totalTimeoutMs").isNumber().default(__),
    totalDeadlineAt: __,
    lastActivityAt: now,
    lastActivityReason: "created",
    attempt: 0,
    maxAttempts: _$(opts.maxAttempts, "opts.maxAttempts").isNumber().default(this.defaultMaxAttempts),
    depth: depth,
    metadata: opts.metadata || {},
    fork: toBoolean(opts.fork) === true,
    forkState: (toBoolean(opts.fork) === true && isMap(opts.forkState)) ? opts.forkState : __,
    _executionPromise: __
  }
  
  this.subtasks[subtaskId] = subtask
  this.pendingQueue.push(subtaskId)
  this.metrics.total++
  
  if (depth > this.metrics.maxDepthUsed) {
    this.metrics.maxDepthUsed = depth
  }
  
  return subtaskId
}

/**
 * <odoc>
 * <key>SubtaskManager.start(subtaskId)</key>
 * Spawns a new MiniA agent for the subtask, calls init() + start() inside $doV().
 * Tracks the subtask in the registry and manages concurrency.
 * </odoc>
 */
SubtaskManager.prototype.start = function(subtaskId) {
  var subtask = this.subtasks[subtaskId]
  if (isUnDef(subtask)) {
    throw new Error("Subtask " + subtaskId + " not found")
  }
  
  if (subtask.status !== "pending") {
    throw new Error("Subtask " + subtaskId + " is not in pending state (current: " + subtask.status + ")")
  }

  var started = false
  var manager = this
  sync(function() {
    if (subtask.status !== "pending") return

    // Check concurrency limit
    if (manager.runningCount >= manager.maxConcurrent) {
      if (manager.pendingQueue.indexOf(subtaskId) < 0) manager.pendingQueue.unshift(subtaskId)
      return
    }

    subtask.status = "running"
    subtask.startedAt = new Date().getTime()
    if (isNumber(subtask.totalTimeoutMs) && subtask.totalTimeoutMs > 0 && !isNumber(subtask.totalDeadlineAt)) {
      subtask.totalDeadlineAt = subtask.startedAt + subtask.totalTimeoutMs
    }
    manager._touchSubtask(subtask, "started")
    subtask.attempt++
    manager.runningCount++
    manager.metrics.running++

    // Remove from pending queue
    var queueIndex = manager.pendingQueue.indexOf(subtaskId)
    if (queueIndex >= 0) {
      manager.pendingQueue.splice(queueIndex, 1)
    }
    started = true
  }, this._transitionLock)

  if (!started) return
  
  if (this.comms && isDef(subtask.args.agentcomms) && (MiniAComms.enabled(MiniAComms.normalize(subtask.args.agentcomms)) || MiniAComms.normalize(subtask.args.agentcomms).delegate)) {
    try {
      subtask.comms = this.comms.broker.register((this.comms.broker.remote ? this.comms.id + "/" : "") + subtask.id + ":" + subtask.attempt, subtask.args.agentcomms,
        this.comms.id, Date.now() + (subtask.hardTimeoutMs || subtask.deadlineMs))
    } catch(commsError) {
      this._claimTerminal(subtask, "failed", Date.now(), String(commsError))
      this.metrics.failed++
      this._processQueue()
      return
    }
  }
  // Emit delegation start event
  var prefix = "[subtask:" + subtaskId.substring(0, 8) + "]"
  var _startLabel = subtask.fork === true ? "Starting forked sub-agent" : "Starting sub-agent"
  try { this.interactionFn("subagent", prefix + " " + _startLabel + ": " + subtask.goal.substring(0, 100)) } catch(ignoreInteractionErr) {}

  if (this.remoteDelegation) {
    this._startRemoteSubtask(subtask, prefix)
  } else {
    this._startLocalSubtask(subtask, prefix)
  }
}

/**
 * <odoc>
 * <key>SubtaskManager.submitAndRun(goal, childArgs, opts)</key>
 * Shorthand method that calls submit() then start().
 * Returns the subtask ID.
 * </odoc>
 */
SubtaskManager.prototype.submitAndRun = function(goal, childArgs, opts) {
  var subtaskId = this.submit(goal, childArgs, opts)
  this.start(subtaskId)
  return subtaskId
}

/**
 * <odoc>
 * <key>SubtaskManager.status(subtaskId)</key>
 * Returns the current state of a subtask as a descriptor object.
 * </odoc>
 */
SubtaskManager.prototype.status = function(subtaskId) {
  var subtask = this.subtasks[subtaskId]
  if (isUnDef(subtask)) {
    throw new Error("Subtask " + subtaskId + " not found")
  }
  
  // Return a copy to prevent external modification
  return jsonParse(stringify(subtask, __, ""), __, __, true)
}

/**
 * <odoc>
 * <key>SubtaskManager.result(subtaskId)</key>
 * Returns the final result of a completed subtask.
 * Returns { answer, metrics, state, error } or throws if not in terminal state.
 * </odoc>
 */
SubtaskManager.prototype.result = function(subtaskId) {
  var subtask = this.subtasks[subtaskId]
  if (isUnDef(subtask)) {
    throw new Error("Subtask " + subtaskId + " not found")
  }
  
  if (!__isTerminalSubtaskState(subtask.status)) {
    throw new Error("Subtask " + subtaskId + " is not in terminal state (current: " + subtask.status + ")")
  }
  
  return {
    answer: isDef(subtask.result) ? subtask.result.answer : __,
    diagnostics_scope: isDef(subtask.result) ? subtask.result.diagnostics_scope : __,
    metrics: isDef(subtask.result) ? subtask.result.metrics : __,
    state: isDef(subtask.result) ? subtask.result.state : __,
    error: subtask.error
  }
}

/**
 * <odoc>
 * <key>SubtaskManager.cancel(subtaskId, reason)</key>
 * Cancels a running or pending subtask.
 * Returns true if cancelled, false if already in terminal state.
 * </odoc>
 */
SubtaskManager.prototype.cancel = function(subtaskId, reason) {
  var subtask = this.subtasks[subtaskId]
  if (isUnDef(subtask)) {
    throw new Error("Subtask " + subtaskId + " not found")
  }
  
  // Claim cancellation before stop callbacks or remote requests can complete
  // the task. Read pending/running under the same lock used by start().
  var cancelReason = reason || "Cancelled by user"
  var wasRunning = false
  var cancelled = false
  var parent = this
  sync(function() {
    if (__isTerminalSubtaskState(subtask.status)) return
    wasRunning = subtask.status === "running"
    if (wasRunning) {
      cancelled = parent._claimTerminal(subtask, "cancelled", new Date().getTime(), cancelReason)
    } else if (subtask.status === "pending") {
      subtask.completedAt = new Date().getTime()
      subtask.error = cancelReason
      subtask.status = "cancelled"
      cancelled = true
    }
    if (!cancelled) return
    var queueIndex = parent.pendingQueue.indexOf(subtaskId)
    if (queueIndex >= 0) parent.pendingQueue.splice(queueIndex, 1)
    parent.metrics.cancelled++
  }, this._transitionLock)
  if (!cancelled) return false

  if (wasRunning) this._cancelRemoteSubtask(subtask, cancelReason)

  if (wasRunning && isObject(subtask.childAgent)) {
    try {
      if (isFunction(subtask.childAgent.requestStop)) {
        subtask.childAgent.requestStop(reason || "Cancelled by user", { quiet: true })
      } else {
        subtask.childAgent.state = "stop"
        if (isFunction(subtask.childAgent._stopAgentResources)) subtask.childAgent._stopAgentResources()
      }
    } catch(ignoreLocalCancel) {}
  }

  if (wasRunning && isDef(subtask._executionPromise) && isFunction(subtask._executionPromise.cancel)) {
    try { subtask._executionPromise.cancel(reason || "Cancelled by user") } catch(ignoreExecutionCancel) {}
  }
  
  var prefix = "[subtask:" + subtaskId.substring(0, 8) + "]"
  this.interactionFn("delegate", prefix + " 🛑 Cancelled: " + (reason || "user request"))
  
  // Try to process queue in case this frees up a slot
  try {
    this._processQueue()
  } catch(ignoreQueue) {}
  
  return true
}

/**
 * <odoc>
 * <key>SubtaskManager.waitFor(subtaskId, timeoutMs)</key>
 * Blocking poll-wait until the subtask reaches a terminal state.
 * Returns the result.
 * </odoc>
 */
SubtaskManager.prototype.waitFor = function(subtaskId, timeoutMs) {
  var subtask = this.subtasks[subtaskId]
  if (isUnDef(subtask)) {
    throw new Error("Subtask " + subtaskId + " not found")
  }
  
  timeoutMs = _$(timeoutMs, "timeoutMs").isNumber().default(300000)
  var startTime = new Date().getTime()
  var pollInterval = 500
  
  while (true) {
    if (__isTerminalSubtaskState(subtask.status)) {
      return this.result(subtaskId)
    }
    
    var elapsed = new Date().getTime() - startTime
    if (elapsed >= timeoutMs) {
      throw new Error("Timeout waiting for subtask " + subtaskId)
    }
    
    sleep(pollInterval, true)
  }
}

/**
 * <odoc>
 * <key>SubtaskManager.waitForActive(subtaskId, opts)</key>
 * Waits for a bounded foreground budget. If the task is still running and has
 * not stalled, returns { pending: true } instead of treating it as an error.
 * </odoc>
 */
SubtaskManager.prototype.waitForActive = function(subtaskId, opts) {
  var subtask = this.subtasks[subtaskId]
  if (isUnDef(subtask)) {
    throw new Error("Subtask " + subtaskId + " not found")
  }

  opts = _$(opts, "opts").isMap().default({})
  var waitMs = _$(opts.waitMs, "opts.waitMs").isNumber().default(300000)
  var pollInterval = _$(opts.pollIntervalMs, "opts.pollIntervalMs").isNumber().default(500)
  var startTime = new Date().getTime()

  while (true) {
    if (__isTerminalSubtaskState(subtask.status)) {
      return this.result(subtaskId)
    }

    var now = new Date().getTime()
    var timeoutReason = this._getSubtaskTimeoutReason(subtask, now)
    if (isMap(timeoutReason)) {
      throw new Error(timeoutReason.message)
    }

    var elapsed = now - startTime
    if (elapsed >= waitMs) {
      return {
        pending: true,
        status: subtask.status,
        active: subtask.status === "running",
        lastActivityAt: subtask.lastActivityAt,
        lastActivityReason: subtask.lastActivityReason
      }
    }

    sleep(pollInterval, true)
  }
}

/**
 * <odoc>
 * <key>SubtaskManager.waitForAll(subtaskIds, timeoutMs)</key>
 * Wait for multiple subtasks to complete.
 * Returns an array of results in the same order as the input IDs.
 * </odoc>
 */
SubtaskManager.prototype.waitForAll = function(subtaskIds, timeoutMs) {
  if (!isArray(subtaskIds)) {
    throw new Error("subtaskIds must be an array")
  }
  
  timeoutMs = _$(timeoutMs, "timeoutMs").isNumber().default(300000)
  var results = []
  var startAll = new Date().getTime()
  
  for (var i = 0; i < subtaskIds.length; i++) {
    var elapsed = new Date().getTime() - startAll
    var remainingTime = Math.max(1, timeoutMs - elapsed)
    results.push(this.waitFor(subtaskIds[i], remainingTime))
  }
  
  return results
}

/**
 * <odoc>
 * <key>SubtaskManager.list(filter)</key>
 * Lists all subtasks, optionally filtered by status.
 * Returns an array of subtask descriptors.
 * </odoc>
 */
SubtaskManager.prototype.list = function(filter) {
  var parent = this
  var subtaskIds = Object.keys(this.subtasks)
  var results = []
  
  subtaskIds.forEach(function(id) {
    var subtask = parent.subtasks[id]
    if (isDef(filter) && isString(filter)) {
      if (subtask.status !== filter) return
    }
    results.push(jsonParse(stringify(subtask, __, ""), __, __, true))
  })
  
  return results
}

/**
 * <odoc>
 * <key>SubtaskManager.cleanup(subtaskId)</key>
 * Removes a subtask from the registry.
 * Can only cleanup tasks in terminal states.
 * </odoc>
 */
SubtaskManager.prototype.cleanup = function(subtaskId) {
  var subtask = this.subtasks[subtaskId]
  if (isUnDef(subtask)) {
    throw new Error("Subtask " + subtaskId + " not found")
  }
  
  // Only allow cleanup of terminal states
  if (!__isTerminalSubtaskState(subtask.status)) {
    throw new Error("Cannot cleanup subtask " + subtaskId + " in non-terminal state: " + subtask.status)
  }
  
  delete this.subtasks[subtaskId]
}

/**
 * <odoc>
 * <key>SubtaskManager.getMetrics()</key>
 * Returns aggregated metrics about all subtasks.
 * </odoc>
 */
SubtaskManager.prototype.getMetrics = function() {
  var avgDurationMs = this.metrics.completed > 0 
    ? Math.round(this.metrics.totalDurationMs / this.metrics.completed) 
    : 0
  var staticCount = isArray(this._staticWorkers) ? this._staticWorkers.length : 0
  var dynamicCount = Math.max(0, this.workers.length - staticCount)
  var parent = this
  var healthyCount = this.workers.filter(function(workerUrl) {
    return parent._deadWorkers[workerUrl] !== true
  }).length
  
  return {
    communication: this.comms ? MiniAComms.clone(this.comms.broker.metrics) : __,
    total: this.metrics.total,
    running: this.metrics.running,
    completed: this.metrics.completed,
    failed: this.metrics.failed,
    cancelled: this.metrics.cancelled,
    timedout: this.metrics.timedout,
    retried: this.metrics.retried,
    remotePollRetries: this.metrics.remotePollRetries,
    remoteOutcomeUnknown: this.metrics.remoteOutcomeUnknown,
    remoteCancelFailures: this.metrics.remoteCancelFailures,
    avgDurationMs: avgDurationMs,
    maxDepthUsed: this.metrics.maxDepthUsed,
    workers: {
      total: this.workers.length,
      static: staticCount,
      dynamic: dynamicCount,
      healthy: healthyCount,
      dead: Math.max(0, this.workers.length - healthyCount)
    }
  }
}

/**
 * <odoc>
 * <key>SubtaskManager._processQueue()</key>
 * Internal method to process the pending queue and start new tasks if concurrency allows.
 * </odoc>
 */
SubtaskManager.prototype._processQueue = function() {
  while (this._running === true && this.runningCount < this.maxConcurrent && this.pendingQueue.length > 0) {
    var nextId = this.pendingQueue.shift()
    var subtask = this.subtasks[nextId]
    if (!isDef(subtask) || subtask.status !== "pending") continue
    try {
      this.start(nextId)
      if (isDef(subtask) && subtask.status === "pending" && this.pendingQueue.indexOf(nextId) < 0) {
        this.pendingQueue.unshift(nextId)
      }
    } catch(e) {
      if (isDef(subtask)) {
        // Restore counters if start() already incremented them before throwing
        if (subtask.status === "running") {
          this.runningCount--
          this.metrics.running--
        }
        if (subtask.comms) subtask.comms.broker.revoke(subtask.comms.id)
        subtask.status = "failed"
        subtask.error = "Failed to start: " + (isDef(e) && isString(e.message) ? e.message : stringify(e, __, ""))
        subtask.completedAt = new Date().getTime()
        this.metrics.failed++
      }
    }
  }
}

/**
 * <odoc>
 * <key>SubtaskManager._startWatchdog()</key>
 * Internal method to start a watchdog thread that checks for deadline timeouts.
 * </odoc>
 */
SubtaskManager.prototype._startWatchdog = function() {
  var parent = this
  if (parent._running !== true || isDef(parent._watchdogPromise)) return
  
  this._watchdogPromise = $doV(function() {
    while (parent._running) {
      try {
        var now = new Date().getTime()
        if (parent.comms && !parent.comms.broker.closed) sync(function() { parent.comms.broker._sweep() }, parent.comms.broker.lock)
        var subtaskIds = Object.keys(parent.subtasks)
        
        subtaskIds.forEach(function(id) {
          var subtask = parent.subtasks[id]
          
          // Check running tasks for hard timeout or stall timeout.
          if (subtask.status === "running" && isDef(subtask.startedAt)) {
            var timeoutReason = parent._getSubtaskTimeoutReason(subtask, now)
            if (isMap(timeoutReason)) {
              if (!parent._claimTerminal(subtask, "timeout", now, timeoutReason.message)) return
              parent.metrics.timedout++

              // Best-effort remote cancel after claiming the transition
              if (parent.remoteDelegation && isString(subtask.workerUrl) && isString(subtask.remoteTaskId)) {
                try {
                  if (parent.useA2A) {
                    parent._remoteRequest(subtask.workerUrl, "/tasks:cancel", {
                      id: subtask.remoteTaskId,
                      reason: timeoutReason.message
                    })
                  } else {
                    parent._remoteRequest(subtask.workerUrl, "/cancel", {
                      taskId: subtask.remoteTaskId,
                      reason: timeoutReason.message
                    })
                  }
                } catch(ignoreRemoteCancel) {}
              }

              if (isObject(subtask.childAgent)) {
                try {
                  if (isFunction(subtask.childAgent.requestStop)) {
                    subtask.childAgent.requestStop(subtask.error, { quiet: true })
                  } else {
                    subtask.childAgent.state = "stop"
                    if (isFunction(subtask.childAgent._stopAgentResources)) subtask.childAgent._stopAgentResources()
                  }
                } catch(ignoreLocalTimeoutCancel) {}
              }
              
              var prefix = "[subtask:" + id.substring(0, 8) + "]"
              if (timeoutReason.type === "stall") {
                parent.interactionFn("delegate", prefix + " ⏱️ Stalled after " + Math.round(timeoutReason.idleMs / 1000) + "s")
              } else {
                parent.interactionFn("delegate", prefix + " ⏱️ Timeout after " + Math.round(timeoutReason.elapsed / 1000) + "s")
              }
              
              // Try to process queue
              try {
                parent._processQueue()
              } catch(ignoreQueue) {}
            }
          }
        })

        if (parent.workerEvictionTTLMs > 0) {
          Object.keys(parent._workerLastHeartbeat).forEach(function(workerUrl) {
            if (isArray(parent._staticWorkers) && parent._staticWorkers.indexOf(workerUrl) >= 0) return
            var lastHb = parent._workerLastHeartbeat[workerUrl]
            if (!isNumber(lastHb)) return
            var ageMs = now - lastHb
            if (ageMs <= parent.workerEvictionTTLMs) return
            try {
              parent.interactionFn("delegate", "[worker] Auto-evicting worker (no heartbeat for " + Math.round(ageMs / 1000) + "s): " + workerUrl)
            } catch(ignoreInteractionErr) {}
            if (parent.removeWorker(workerUrl)) {
              try {
                parent.onWorkerEvicted(workerUrl, ageMs)
              } catch(ignoreEvictCbErr) {}
            }
          })
        }
      } catch(e) {
        // Ignore watchdog errors
      }
      
      // Check every 5 seconds, but allow destroy() to wake this wait
      // immediately so an idle delegated console can exit promptly.
      if (parent._running) {
        try {
          sync(function() {
            if (parent._running) parent._watchdogWakeSignal.wait(5000)
          }, parent._watchdogWakeSignal)
        } catch(ignoreWatchdogWake) {}
      }
    }
  })
}

// Run-scoped coordination. Channels store records; callbacks never execute agents.
var MiniAComms = function(config, audit) {
  this.config = MiniAComms.normalize(config)
  this.root = genUUID()
  this.name = "mini_a_comms_" + this.root
  this.stateName = this.name + "_state"
  this.lock = this.name + "_lock"
  this.members = {}
  this.sequence = 0
  this.closed = false
  this.audit = function(event, message) { try { if (isFunction(audit)) audit(event, message) } catch(ignoreAuditError) {} }
  this.metrics = { accepted: 0, rejected: {}, delivered: 0, consumed: 0, expired: 0, discarded: 0, duplicates: 0,
    conflicts: 0, bytes: 0, queue_depth: 0, queue_high_water: 0, state_entries: 0,
    storage_bytes: 0, latency_count: 0, latency_sum_ms: 0, latency_max_ms: 0,
    remote_exchanges: 0, remote_retries: 0, context_tokens: 0 }
  $ch(this.name).create(1, "simple")
  $ch(this.stateName).create(1, "simple")
  var self = this
  this.subscription = $ch(this.name).subscribe(function() { self.dirty = true }, true)
}
MiniAComms.defaults = { valueBytes: 8192, agentPending: 64, rootPending: 512, storageBytes: 4194304,
  perMinute: 60, operations: 1000, batchRecords: 8, batchBytes: 8192, ttlMs: 300000, stateEntries: 128 }
MiniAComms.clone = function(value) { return jsonParse(stringify(value, __, "")) }
MiniAComms.bytes = function(value) { return new java.lang.String(stringify(value, __, "")).getBytes("UTF-8").length }
MiniAComms.normalize = function(value) {
  if (isString(value)) value = af.fromJSSLON(value)
  if (isUnDef(value)) value = {}
  if (!isMap(value)) throw new Error("agentcomms must be a map")
  if (MiniAComms.bytes(value) > 8192) throw new Error("Communication declaration too large")
  var c = MiniAComms.clone(value)
  if (isDef(c.profiles) && !isArray(c.profiles)) throw new Error("Communication profiles must be an array")
  if (isDef(c.grants) && !isMap(c.grants)) throw new Error("Communication grants must be a map")
  if (isDef(c.limits) && !isMap(c.limits)) throw new Error("Communication limits must be a map")
  c.profiles = isArray(c.profiles) ? c.profiles : ["none"]
  var allowed = ["none", "parent-relay", "pubsub", "direct", "shared-state"]
  c.profiles.forEach(function(p) { if (allowed.indexOf(p) < 0) throw new Error("Unknown communication profile") })
  if (c.profiles.indexOf("none") >= 0 && c.profiles.length !== 1) throw new Error("none cannot be combined with communication profiles")
  c.grants = isMap(c.grants) ? c.grants : {}
  Object.keys(c.grants).forEach(function(k) { if (["send", "receive", "publish", "subscribe", "read", "write"].indexOf(k) < 0) throw new Error("Unknown communication grant: " + k) })
  ;["send", "receive", "publish", "subscribe", "read", "write"].forEach(function(k) {
    if (isDef(c.grants[k]) && !isArray(c.grants[k])) throw new Error("Communication grants must be arrays")
    c.grants[k] = c.grants[k] || []
    c.grants[k].forEach(function(v) {
      if (!isString(v) || !v.length || v.indexOf("*") >= 0 || v.length > 128) throw new Error("Communication grants require explicit names")
    })
  })
  c.limits = isMap(c.limits) ? c.limits : {}
  Object.keys(c.limits).forEach(function(k) { if (isUnDef(MiniAComms.defaults[k])) throw new Error("Unknown communication limit: " + k) })
  Object.keys(MiniAComms.defaults).forEach(function(k) {
    var n = isDef(c.limits[k]) ? c.limits[k] : MiniAComms.defaults[k]
    if (!isNumber(n) || !isFinite(n) || n < 1 || Math.floor(n) !== n || n > MiniAComms.defaults[k]) throw new Error("Invalid communication limit: " + k)
    c.limits[k] = n
  })
  if (isDef(c.alias) && (!isString(c.alias) || !/^[a-zA-Z0-9_-]{1,64}$/.test(c.alias) || c.alias === "parent")) throw new Error("Invalid communication alias")
  return c
}
MiniAComms.enabled = function(c) { return c.profiles.length > 0 && c.profiles.indexOf("none") < 0 }
MiniAComms.subset = function(child, ceiling) {
  if (!MiniAComms.enabled(child)) return true
  if (!MiniAComms.enabled(ceiling)) return false
  if (child.profiles.some(function(p) { return ceiling.profiles.indexOf(p) < 0 })) return false
  return Object.keys(child.grants).every(function(k) {
    return child.grants[k].every(function(v) { return ceiling.grants[k].indexOf(v) >= 0 })
  }) && Object.keys(child.limits).every(function(k) { return child.limits[k] <= ceiling.limits[k] })
}
MiniAComms.prototype.register = function(id, config, parentId, expires) {
  var self = this, result
  sync(function() {
    if (self.closed) throw new Error("Communication run is closed")
    var c = MiniAComms.normalize(config)
    if (c.delegate) c.delegate = MiniAComms.normalize(c.delegate)
    if (parentId) {
      var p = self.members[parentId]
      if (!p || !p.active) throw new Error("Communication parent unavailable")
      var ceiling = MiniAComms.normalize(p.config.delegate)
      // Unspecified child limits inherit the tighter ceiling, never root permissions.
      Object.keys(c.limits).forEach(function(k) { c.limits[k] = Math.min(c.limits[k], ceiling.limits[k], self.config.limits[k]) })
      if (!MiniAComms.subset(c, ceiling)) throw new Error("Communication declaration exceeds delegation allowance")
      if (c.delegate && !MiniAComms.subset(MiniAComms.normalize(c.delegate), ceiling)) throw new Error("Communication delegation allowance exceeds parent")
    }
    if (Object.keys(self.members).length >= self.config.limits.operations) throw new Error("Communication member limit exceeded")
    if (self.members[id]) throw new Error("Communication identity already registered")
    if (c.alias && Object.keys(self.members).some(function(k) { return self.members[k].active && self.members[k].config.alias === c.alias })) throw new Error("Communication alias already registered")
    self.members[id] = { config: c, parent: parentId, active: true, expires: expires || Number.MAX_VALUE, rateAt: 0, rate: 0, operations: 0 }
    result = { broker: self, id: id, config: c }
    if (self.remote && parentId) {
      var registered = self.enqueue(parentId, { action: "_register", id: id, config: c, expires: expires })
      if (registered.status !== "pending") { delete self.members[id]; throw new Error("Remote registration queue full") }
    }
  }, this.lock)
  return result
}
MiniAComms.prototype._records = function() { return $ch(this.name).getAll() }
MiniAComms.prototype._sweep = function() {
  var self = this, now = Date.now()
  this._records().forEach(function(r) {
    if (r.expires <= now) { $ch(self.name).unset({ id: r.id }); self.metrics.expired++; if (self.remote && r.remoteDelivery === true) self.receipts.push(r.id); self.audit("comms", stringify({ message: r.id, outcome: "expired" })) }
  })
  var records = this._records(), states = $ch(this.stateName).getAll()
  this.metrics.queue_depth = records.length
  this.metrics.queue_high_water = Math.max(this.metrics.queue_high_water, records.length)
  this.metrics.state_entries = states.length
  this.metrics.storage_bytes = records.concat(states).reduce(function(n, r) { return n + MiniAComms.bytes(r) }, 0)
}
MiniAComms.prototype._resolve = function(member, name) {
  if (name === "parent") return this.members[member].parent
  if (this.members[name] && this.members[name].active) return name
  var self = this
  return Object.keys(this.members).filter(function(id) { return self.members[id].active && self.members[id].config.alias === name })[0]
}
MiniAComms.prototype._matches = function(grants, other, owner) {
  var self = this
  return grants.some(function(name) { return self._resolve(owner, name) === other })
}
MiniAComms.prototype.operate = function(id, request) {
  if (this.remote && request.action !== "receive") return this.enqueue(id, request)
  var self = this, out
  sync(function() {
    out = self._operate(id, request)
  }, this.lock)
  return out
}
MiniAComms.prototype._operate = function(id, request) {
  var self = this, m = this.members[id], p = MiniAComms.clone(request || {}), now = Date.now()
  var reject = function(reason) {
    self.metrics.rejected[reason] = (self.metrics.rejected[reason] || 0) + 1
    self.audit("comms", stringify({ root: self.root, sender: id, action: p.action, outcome: reason }, __, ""))
    return { status: reason }
  }
  if (this.closed || !m || !m.active || m.expires <= now) return reject("unavailable")
  this._sweep()
  var c = m.config, lim = c.limits, g = c.grants
  if (!MiniAComms.enabled(c)) return reject("denied")
  if (MiniAComms.bytes(p) > lim.valueBytes) return reject("too_large")
  if (now - m.rateAt >= 60000) { m.rate = 0; m.rateAt = now }
  if (m.rate >= lim.perMinute || m.operations >= lim.operations || this.metrics.accepted >= this.config.limits.operations) return reject("rate_limited")
  if (p.action === "receive") {
    m.rate++; m.operations++; this.metrics.accepted++
    return { status: "ok", messages: this.drain(id) }
  }
  var recipients = [], stateKey, current, result
  if (p.action === "send") {
    var target = this._resolve(id, p.to), t = this.members[target]
    if (!t || !t.active || t.expires <= now) return reject("unavailable")
    var related = m.parent === target || t.parent === id
    var profile = related ? "parent-relay" : "direct"
    if (c.profiles.indexOf(profile) < 0 || t.config.profiles.indexOf(profile) < 0 ||
        !this._matches(g.send, target, id) || !this._matches(t.config.grants.receive, id, target)) return reject("denied")
    recipients = [target]
  } else if (p.action === "publish") {
    if (c.profiles.indexOf("pubsub") < 0 || g.publish.indexOf(p.topic) < 0) return reject("denied")
    recipients = Object.keys(this.members).filter(function(k) {
      var t = self.members[k]
      return k !== id && t.active && t.expires > now && t.config.profiles.indexOf("pubsub") >= 0 && t.config.grants.subscribe.indexOf(p.topic) >= 0
    })
  } else if (["get", "put", "delete"].indexOf(p.action) >= 0) {
    if (c.profiles.indexOf("shared-state") < 0 || (p.action === "get" ? g.read : g.write).indexOf(p.namespace) < 0) return reject("denied")
    if (!isString(p.key) || !p.key.length || p.key.length > 128) return reject("invalid")
    stateKey = { namespace: p.namespace, key: p.key }
    current = $ch(this.stateName).get(stateKey)
    if (p.action === "get") result = { status: "ok", version: current ? current.version : 0, value: current ? current.value : __ }
    else {
      if (!isNumber(p.expectedVersion) || p.expectedVersion !== (current ? current.version : 0)) { this.metrics.conflicts++; return reject("conflict") }
      if (p.action === "put" && isUnDef(p.value)) return reject("invalid")
      // Keep deletion versions as tombstones to prevent stale writers from passing CAS.
      var next = { namespace: p.namespace, key: p.key, version: (current ? current.version : 0) + 1, value: p.action === "delete" ? __ : p.value }
      if ((!current && this.metrics.state_entries >= Math.min(lim.stateEntries, this.config.limits.stateEntries)) || this.metrics.storage_bytes + MiniAComms.bytes(next) - (current ? MiniAComms.bytes(current) : 0) > Math.min(lim.storageBytes, this.config.limits.storageBytes)) return reject("full")
      if (current) $ch(this.stateName).getSet({ version: p.expectedVersion }, stateKey, next)
      else $ch(this.stateName).set(stateKey, next)
      result = { status: "ok", version: next.version }
    }
  } else return reject("invalid")
  if (!result) {
    if (isUnDef(p.payload)) return reject("invalid")
    var records = this._records(), seq = this.sequence + 1
    var messages = recipients.map(function(to) { return { id: genUUID(), root: self.root, sender: id, to: to,
      topic: p.topic, correlationId: p.correlationId, sequence: seq, ts: now,
      expires: Math.min(now + lim.ttlMs, m.expires, self.members[to].expires), payload: p.payload } })
    if (messages.some(function(r) { return MiniAComms.bytes(r) > self.members[r.to].config.limits.batchBytes })) return reject("too_large")
    var added = messages.reduce(function(n, r) { return n + MiniAComms.bytes(r) }, 0)
    if (records.length + messages.length > Math.min(lim.rootPending, this.config.limits.rootPending) || this.metrics.storage_bytes + added > Math.min(lim.storageBytes, this.config.limits.storageBytes) ||
        recipients.some(function(to) { return records.filter(function(r) { return r.to === to }).length >= self.members[to].config.limits.agentPending })) return reject("full")
    messages.forEach(function(r) { $ch(self.name).set({ id: r.id }, r) })
    this.sequence = seq
    this.metrics.bytes += added
    this.metrics.delivered += messages.length
    result = { status: "accepted", sequence: seq, recipients: recipients.length, messageIds: messages.map(function(r) { return r.id }) }
  }
  m.rate++
  m.operations++
  this.metrics.accepted++
  this._sweep()
  this.audit("comms", stringify({ root: this.root, sender: id, action: p.action, to: p.to, topic: p.topic, namespace: p.namespace, key: p.key, version: result.version, correlationId: p.correlationId, outcome: result.status, sequence: result.sequence, messageIds: result.messageIds, bytes: MiniAComms.bytes(p) }, __, ""))
  return result
}
MiniAComms.prototype.drain = function(id, peek) {
  var self = this, out = []
  sync(function() {
    if (self.closed || !self.members[id] || !self.members[id].active) return
    self._sweep()
    var lim = self.members[id].config.limits, bytes = 0
    self._records().filter(function(r) { return r.to === id }).sort(function(a, b) { return a.sequence - b.sequence }).some(function(r) {
      var size = MiniAComms.bytes(r)
      if (out.length >= lim.batchRecords || bytes + size > lim.batchBytes) return true
      bytes += size
      out.push(MiniAComms.clone(r))
      if (!peek) self.ack(id, [r.id])
      return false
    })
  }, this.lock)
  return out
}
MiniAComms.prototype.ack = function(id, ids) {
  var self = this
  sync(function() {
    if (self.closed) return
    ids.forEach(function(key) {
      var r = $ch(self.name).get({ id: key })
      if (!r || r.to !== id) return
      $ch(self.name).unset({ id: key })
      if (self.remote && r.remoteDelivery === true) self.receipts.push(key)
      var latency = Date.now() - r.ts
      self.metrics.consumed++; self.metrics.latency_count++; self.metrics.latency_sum_ms += latency
      self.metrics.latency_max_ms = Math.max(self.metrics.latency_max_ms, latency)
      self.audit("comms", stringify({ root: self.root, message: key, recipient: id, outcome: "consumed" }, __, ""))
    })
    self._sweep()
  }, this.lock)
}
MiniAComms.prototype.revoke = function(id) {
  var self = this
  sync(function() {
    if (self.closed || !self.members[id]) return
    if (self.remote && self.members[id].parent && self.members[self.members[id].parent].active) {
      self.enqueue(self.members[id].parent, { action: "_revoke", id: id })
    }
    self.members[id].active = false
    Object.keys(self.members).forEach(function(k) { if (self.members[k].parent === id) self.revoke(k) })
    self._records().forEach(function(r) { if (r.to === id || r.sender === id) { $ch(self.name).unset({ id: r.id }); self.metrics.discarded++; self.audit("comms", stringify({ root: self.root, message: r.id, outcome: "discarded" })) } })
    self._sweep()
  }, this.lock)
}
MiniAComms.prototype.close = function() {
  var self = this
  sync(function() {
    if (self.closed) return
    self._sweep()
    self.closed = true
    $ch(self.name).unsubscribe(self.subscription)
    $ch(self.name).destroy(); $ch(self.stateName).destroy()
  }, this.lock)
}

// Worker-side adapter: one bounded exchange batch stays stable until acknowledged.
// This is attached by the authenticated worker runtime, never from agent arguments.
MiniAComms.prototype.asRemote = function() {
  this.remote = true
  this.outgoing = []
  this.batch = __
  this.receipts = []
  this.seen = {}
  this.remoteCounter = 0
}
MiniAComms.prototype.enqueue = function(id, request) {
  var self = this, result
  sync(function() {
    var m = self.members[id]
    self._sweep()
    if (self.closed || !m || !m.active) { result = { status: "unavailable" }; return }
    var size = MiniAComms.bytes(request)
    var queuedBytes = self.outgoing.reduce(function(n, r) { return n + MiniAComms.bytes(r) }, 0)
    if (size > m.config.limits.valueBytes || size + 512 > m.config.limits.batchBytes) { result = { status: "too_large" }; return }
    if (self.outgoing.length + self.metrics.queue_depth >= m.config.limits.agentPending || queuedBytes + self.metrics.storage_bytes + size + 512 > self.config.limits.storageBytes || self.remoteCounter >= self.config.limits.operations) { result = { status: "full" }; return }
    var operationId = self.root + ":" + (++self.remoteCounter)
    self.outgoing.push({ id: operationId, member: id, request: MiniAComms.clone(request), expires: Date.now() + m.config.limits.ttlMs })
    result = { status: "pending", operationId: operationId }
  }, this.lock)
  return result
}
MiniAComms.prototype.exchange = function(data) {
  var self = this, result
  sync(function() {
    if (self.closed) { result = { error: "Communication run closed" }; return }
    if (MiniAComms.bytes(data) > self.config.limits.batchBytes * 4) throw new Error("Communication exchange too large")
    if (isArray(data.ackReceipts)) self.receipts = self.receipts.filter(function(id) { return data.ackReceipts.indexOf(id) < 0 })
    if (self.batch && data.batchId === self.batch.id && isArray(data.results)) {
      data.results.forEach(function(r) {
        var op = self.batch.operations.filter(function(o) { return o.id === r.id })[0]
        if (!op) return
        var record = { id: r.id, to: op.member, sender: "broker", sequence: ++self.sequence, ts: Date.now(),
          expires: op.expires, payload: r.result, correlationId: op.id }
        $ch(self.name).set({ id: record.id }, record)
      })
      var completed = self.batch.operations.map(function(o) { return o.id })
      self.outgoing = self.outgoing.filter(function(o) { return completed.indexOf(o.id) < 0 })
      self.batch = __
    }
    ;(data.messages || []).forEach(function(r) {
      if (!self.members[r.to] || !self.members[r.to].active || self.seen[r.id]) return
      self._sweep()
      if (self.outgoing.length + self.metrics.queue_depth >= self.config.limits.agentPending || self.metrics.storage_bytes + MiniAComms.bytes(r) > self.config.limits.storageBytes) return
      self.seen[r.id] = true
      r.remoteDelivery = true
      $ch(self.name).set({ id: r.id }, r)
    })
    if (!self.batch && self.outgoing.length) {
      var operations = [], size = 0
      self.outgoing.some(function(o) {
        var bytes = MiniAComms.bytes(o)
        if (operations.length >= 1 || size + bytes > self.config.limits.batchBytes) return true
        size += bytes; operations.push(o); return false
      })
      self.batch = { id: genUUID(), operations: operations }
    }
    result = { version: 1, contextTokens: self.metrics.context_tokens, batch: self.batch, receipts: self.receipts.slice(0, self.config.limits.rootPending) }
  }, this.lock)
  return result
}
SubtaskManager.prototype._exchangeComms = function(subtask) {
  if (!subtask.comms) return
  var b = subtask.comms.broker, self = this
  var members = Object.keys(b.members).filter(function(id) {
    var cursor = id
    while (cursor && b.members[cursor]) {
      if (cursor === subtask.comms.id) return true
      cursor = b.members[cursor].parent
    }
    return false
  })
  var messages = [], bytes = 0
  members.forEach(function(id) {
    b.drain(id, true).forEach(function(r) {
      var n = MiniAComms.bytes(r)
      if (messages.length < b.config.limits.batchRecords && bytes + n <= b.config.limits.batchBytes) { messages.push(r); bytes += n }
    })
  })
  var previous = subtask.commsExchange || {}
  var response = this._remoteRequest(subtask.workerUrl, "/comms", {
    taskId: subtask.remoteTaskId, token: subtask.commsToken, version: 1,
    batchId: previous.batchId, results: previous.results, ackReceipts: previous.receipts || [], messages: messages
  })
  if (response.version !== 1) throw new Error("Communication exchange rejected or incompatible")
  b.metrics.remote_exchanges++
  if (isNumber(response.contextTokens) && response.contextTokens >= (subtask.remoteCommsTokens || 0)) {
    b.metrics.context_tokens += response.contextTokens - (subtask.remoteCommsTokens || 0)
    subtask.remoteCommsTokens = response.contextTokens
  }
  var receipts = isArray(response.receipts) ? response.receipts : []
  members.forEach(function(id) { b.ack(id, receipts) })
  var batch = response.batch
  if (batch && batch.id === previous.batchId) { b.metrics.duplicates++; return }
  var results = []
  if (batch) {
    if (!isArray(batch.operations) || batch.operations.length > b.config.limits.batchRecords || MiniAComms.bytes(batch.operations) > b.config.limits.batchBytes) throw new Error("Invalid communication batch")
    batch.operations.forEach(function(op) {
      var r = { status: "denied" }
      if (members.indexOf(op.member) >= 0) {
        if (op.expires <= Date.now()) r = { status: "expired" }
        else if (op.request.action === "_register") {
          try {
            // Descendant identities must remain in this worker's runtime-issued namespace.
            if (op.request.id.indexOf(subtask.comms.id + "/") !== 0) throw new Error("Invalid descendant identity")
            b.register(op.request.id, op.request.config, op.member, op.request.expires)
            members.push(op.request.id); r = { status: "ok" }
          } catch(e) { r = { status: "denied" } }
        } else if (op.request.action === "_revoke") {
          if (b.members[op.request.id] && b.members[op.request.id].parent === op.member) b.revoke(op.request.id)
          r = { status: "ok" }
        } else if (["send", "publish", "get", "put", "delete"].indexOf(op.request.action) >= 0) r = b.operate(op.member, op.request)
      }
      results.push({ id: op.id, result: r })
    })
  }
  subtask.commsExchange = { batchId: batch ? batch.id : __, results: results, receipts: receipts }
}
