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
    totalDurationMs: 0,
    maxDepthUsed: 0
  }

  this._running = true

  if (this.remoteDelegation) {
    this._refreshWorkerProfiles()
  }
  
  // Start watchdog for deadlines
  this._startWatchdog()
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

SubtaskManager.prototype._buildChildArgs = function(subtask) {
  var mergedArgs = merge({}, this.parentArgs)

  if (isMap(subtask.args)) {
    Object.keys(subtask.args).forEach(function(key) {
      mergedArgs[key] = subtask.args[key]
    })
  }

  mergedArgs.goal = subtask.goal
  mergedArgs._delegationDepth = subtask.depth
  mergedArgs._parentSubtaskId = subtask.parentId
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
      capabilities: isArray(inlineCard.capabilities) ? ["run-goal", "delegation", "planning"] : ["run-goal", "delegation", "planning"],
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
          capabilities: ["run-goal", "delegation", "planning", "a2a-http-json-rest"],
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
    requiredSkills: isArray(args._requiredSkills) ? args._requiredSkills.map(function(s) { return String(s).trim().toLowerCase() }).filter(function(s) { return s.length > 0 }) : []
  }
}

SubtaskManager.prototype._isWorkerProfileCompatible = function(profile, requirements) {
  var req = isMap(requirements) ? requirements : {}
  var p = isMap(profile) ? profile : {}
  var caps = isArray(p.capabilities) ? p.capabilities : []
  var limits = isMap(p.limits) ? p.limits : {}
  var hasCapsInfo = caps.length > 0

  if (p.status === "ok") {
    // Some providers/bridges can return incomplete capability metadata.
    // Enforce capability flags only when capabilities are actually present.
    if (req.requiresRunGoal === true && hasCapsInfo && caps.indexOf("run-goal") < 0) return false
    if (req.requiresPlanning === true && hasCapsInfo && caps.indexOf("planning") < 0) return false

    // Required skills: ALL listed skill IDs/tags must be present on the worker
    if (isArray(req.requiredSkills) && req.requiredSkills.length > 0) {
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
  try {
    response = method === "GET"
      ? $rest({ requestHeaders: headers }).get(url)
      : $rest({ requestHeaders: headers }).post(url, data || {})
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

SubtaskManager.prototype._remoteRequest = function(workerUrl, path, payload) {
  return this._remoteCall("POST", workerUrl, path, payload)
}

SubtaskManager.prototype._remoteGet = function(workerUrl, path, query) {
  return this._remoteCall("GET", workerUrl, path, query)
}

SubtaskManager.prototype._completeSubtask = function(subtask, prefix, answer, metrics, state) {
  subtask.result = {
    answer: answer,
    metrics: metrics,
    state: state
  }
  subtask.status = "completed"
  subtask.completedAt = new Date().getTime()
  subtask.error = __

  var duration = subtask.completedAt - subtask.startedAt
  this.metrics.totalDurationMs += duration
  this.metrics.completed++
  this.metrics.running--
  this.runningCount--

  this.interactionFn("delegate", prefix + " ✅ Completed in " + Math.round(duration / 1000) + "s")
}

SubtaskManager.prototype._failOrRetrySubtask = function(subtask, prefix, error) {
  subtask.error = error

  if (subtask.attempt < subtask.maxAttempts) {
    subtask.status = "pending"
    subtask.metadata.previousError = error
    this.pendingQueue.push(subtask.id)
    this.metrics.retried++
    this.metrics.running--
    this.runningCount--
    this.interactionFn("delegate", prefix + " ⚠️ Failed (attempt " + subtask.attempt + "/" + subtask.maxAttempts + "), will retry: " + error)
    return "retry"
  }

  if (this.remoteDelegation && isString(subtask.workerUrl) && subtask.workerUrl.length > 0) {
    this._recordWorkerFailure(subtask.workerUrl, "Subtask exhausted max attempts (" + subtask.maxAttempts + ")")
  }

  subtask.status = "failed"
  subtask.completedAt = new Date().getTime()
  this.metrics.failed++
  this.metrics.running--
  this.runningCount--
  this.interactionFn("delegate", prefix + " ❌ Failed after " + subtask.maxAttempts + " attempts: " + error)
  return "failed"
}

SubtaskManager.prototype._startLocalSubtask = function(subtask, prefix) {
  var parent = this

  $doV(function() {
    try {
      var childAgent = new MiniA()
      var mergedArgs = parent._buildChildArgs(subtask)

      childAgent.setInteractionFn(function(event, message) {
        parent.interactionFn(event, prefix + " " + message)
      })

      childAgent.init(mergedArgs)
      var answer = childAgent.start(mergedArgs)
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
    }

    try {
      parent._processQueue()
    } catch(ignoreQueue) {}
  })
}

SubtaskManager.prototype._startRemoteSubtask = function(subtask, prefix) {
  var parent = this

  $doV(function() {
    try {
      var mergedArgs = parent._buildChildArgs(subtask)
      var workerUrl = parent._nextWorkerForSubtask(subtask, mergedArgs)
      if (!isString(workerUrl) || workerUrl.length === 0) {
        throw new Error(isString(parent._lastWorkerSelectionError) && parent._lastWorkerSelectionError.length > 0 ? parent._lastWorkerSelectionError : "No healthy remote workers available")
      }

      subtask.workerUrl = workerUrl
      subtask.remoteEventIndex = 0

      var timeoutSec = Math.max(1, Math.ceil(subtask.deadlineMs / 1000))
      var metadata = merge({}, subtask.metadata || {})
      metadata.parentSubtaskId = subtask.parentId
      metadata.delegationDepth = subtask.depth

      var taskResponse
      if (parent.useA2A) {
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
            args: mergedArgs
          },
          configuration: {
            timeoutSeconds: timeoutSec
          }
        })
      } else {
        taskResponse = parent._remoteRequest(workerUrl, "/task", {
          goal: subtask.goal,
          args: mergedArgs,
          timeout: timeoutSec,
          metadata: metadata
        })
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
      parent.interactionFn("delegate", prefix + " Routed to worker: " + workerUrl)
      if (isMap(parent._lastWorkerSelectionDetails) && parent._lastWorkerSelectionDetails.workerUrl === workerUrl) {
        if (isMap(parent._lastWorkerSelectionDetails.matchedSkill) && isString(parent._lastWorkerSelectionDetails.matchedSkill.name) && parent._lastWorkerSelectionDetails.matchedSkill.name.length > 0) {
          parent.interactionFn("delegate", prefix + " Worker skill match: " + parent._lastWorkerSelectionDetails.matchedSkill.name)
        } else if (parent._lastWorkerSelectionDetails.usedCompatibilityFallback === true) {
          parent.interactionFn("delegate", prefix + " Worker routing used compatibility fallback (no strong skill match)")
        }
      }

      while (subtask.status === "running") {
        sleep(parent.remotePollIntervalMs, true)
        if (subtask.status !== "running") break

        var status
        var remoteStatus = "running"

        if (parent.useA2A) {
          status = parent._remoteGet(workerUrl, "/tasks", { id: subtask.remoteTaskId })
          var remoteState = isMap(status.task) && isMap(status.task.status) && isString(status.task.status.state) ? status.task.status.state.toUpperCase() : "TASK_STATE_WORKING"
          if (remoteState === "TASK_STATE_COMPLETED") remoteStatus = "completed"
          if (remoteState === "TASK_STATE_FAILED") remoteStatus = "failed"
          if (remoteState === "TASK_STATE_CANCELED" || remoteState === "TASK_STATE_CANCELLED") remoteStatus = "cancelled"
        } else {
          status = parent._remoteRequest(workerUrl, "/status", { taskId: subtask.remoteTaskId })
          remoteStatus = isString(status.status) ? status.status.toLowerCase() : "running"

          if (isArray(status.events)) {
            var seenEvents = _$(subtask.remoteEventIndex, "subtask.remoteEventIndex").isNumber().default(0)
            for (var i = seenEvents; i < status.events.length; i++) {
              var evt = status.events[i]
              if (isMap(evt) && isString(evt.message) && evt.message.length > 0) {
                parent.interactionFn("delegate", prefix + " " + evt.message)
              }
            }
            subtask.remoteEventIndex = status.events.length
          }
        }

        if (remoteStatus === "queued" || remoteStatus === "running") continue

        if (remoteStatus === "completed") {
          var resultPayload = __
          var resultErrMsg = __

          // /status can flip to completed slightly before /result is available.
          for (var attempt = 0; attempt < 5; attempt++) {
            try {
              resultPayload = parent._remoteRequest(workerUrl, "/result", { taskId: subtask.remoteTaskId })
              if (isMap(resultPayload) && isMap(resultPayload.result)) break
            } catch (resultErr) {
              resultErrMsg = isDef(resultErr) && isString(resultErr.message) ? resultErr.message : stringify(resultErr, __, "")
            }
            sleep(250, true)
          }

          if (!(isMap(resultPayload) && isMap(resultPayload.result))) {
            throw new Error("Remote task completed but result is not available yet" + (isString(resultErrMsg) ? ": " + resultErrMsg : ""))
          }

          var remoteResult = isMap(resultPayload) && isMap(resultPayload.result) ? resultPayload.result : {}
          var remoteError = isDef(remoteResult.error) ? String(remoteResult.error) : __

          if (isString(remoteError) && remoteError.length > 0) {
            throw new Error(remoteError)
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

        var resultPayload = __
        try {
          resultPayload = parent._remoteRequest(workerUrl, "/result", { taskId: subtask.remoteTaskId })
        } catch(ignoreResultErr) {}

        var failedMsg = "Remote subtask ended with status: " + remoteStatus
        if (isMap(resultPayload) && isMap(resultPayload.result) && isDef(resultPayload.result.error)) {
          failedMsg = String(resultPayload.result.error)
        }
        throw new Error(failedMsg)
      }
    } catch (e) {
      if (subtask.status === "running") {
        var error = isDef(e) && isString(e.message) ? e.message : stringify(e, __, "")
        if (isString(subtask.workerUrl) && subtask.workerUrl.length > 0) {
          parent._recordWorkerFailure(subtask.workerUrl, error)
        }
        parent._failOrRetrySubtask(subtask, prefix, error)
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
    attempt: 0,
    maxAttempts: _$(opts.maxAttempts, "opts.maxAttempts").isNumber().default(this.defaultMaxAttempts),
    depth: depth,
    metadata: opts.metadata || {}
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
  
  // Check concurrency limit
  if (this.runningCount >= this.maxConcurrent) {
    // Keep it pending, will be started by _processQueue
    return
  }
  
  subtask.status = "running"
  subtask.startedAt = new Date().getTime()
  subtask.attempt++
  this.runningCount++
  this.metrics.running++
  
  // Remove from pending queue
  var queueIndex = this.pendingQueue.indexOf(subtaskId)
  if (queueIndex >= 0) {
    this.pendingQueue.splice(queueIndex, 1)
  }
  
  // Emit delegation start event
  var prefix = "[subtask:" + subtaskId.substring(0, 8) + "]"
  this.interactionFn("delegate", prefix + " Starting sub-goal: " + subtask.goal)

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
  
  // Check if already terminal
  if (__isTerminalSubtaskState(subtask.status)) {
    return false
  }
  
  var wasRunning = subtask.status === "running"

  if (wasRunning && this.remoteDelegation && isString(subtask.workerUrl) && isString(subtask.remoteTaskId)) {
    try {
      if (this.useA2A) {
        this._remoteRequest(subtask.workerUrl, "/tasks:cancel", {
          id: subtask.remoteTaskId,
          reason: reason || "Cancelled by user"
        })
      } else {
        this._remoteRequest(subtask.workerUrl, "/cancel", {
          taskId: subtask.remoteTaskId,
          reason: reason || "Cancelled by user"
        })
      }
    } catch(ignoreRemoteCancel) {}
  }
  
  // Mark as cancelled
  subtask.status = "cancelled"
  subtask.completedAt = new Date().getTime()
  subtask.error = reason || "Cancelled by user"
  
  // Update metrics
  if (wasRunning) {
    this.metrics.running--
    this.runningCount--
  }
  this.metrics.cancelled++
  
  // Remove from pending queue if present
  var queueIndex = this.pendingQueue.indexOf(subtaskId)
  if (queueIndex >= 0) {
    this.pendingQueue.splice(queueIndex, 1)
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
    total: this.metrics.total,
    running: this.metrics.running,
    completed: this.metrics.completed,
    failed: this.metrics.failed,
    cancelled: this.metrics.cancelled,
    timedout: this.metrics.timedout,
    retried: this.metrics.retried,
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
  while (this.runningCount < this.maxConcurrent && this.pendingQueue.length > 0) {
    var nextId = this.pendingQueue.shift()
    var subtask = this.subtasks[nextId]
    if (!isDef(subtask) || subtask.status !== "pending") continue
    try {
      this.start(nextId)
    } catch(e) {
      if (isDef(subtask)) {
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
  
  $doV(function() {
    while (parent._running) {
      try {
        var now = new Date().getTime()
        var subtaskIds = Object.keys(parent.subtasks)
        
        subtaskIds.forEach(function(id) {
          var subtask = parent.subtasks[id]
          
          // Check running tasks for timeout
          if (subtask.status === "running" && isDef(subtask.startedAt)) {
            var elapsed = now - subtask.startedAt
            if (elapsed >= subtask.deadlineMs) {
              if (parent.remoteDelegation && isString(subtask.workerUrl) && isString(subtask.remoteTaskId)) {
                try {
                  if (parent.useA2A) {
                    parent._remoteRequest(subtask.workerUrl, "/tasks:cancel", {
                      id: subtask.remoteTaskId,
                      reason: "Deadline exceeded (" + subtask.deadlineMs + "ms)"
                    })
                  } else {
                    parent._remoteRequest(subtask.workerUrl, "/cancel", {
                      taskId: subtask.remoteTaskId,
                      reason: "Deadline exceeded (" + subtask.deadlineMs + "ms)"
                    })
                  }
                } catch(ignoreRemoteCancel) {}
              }

              // Mark as timeout
              subtask.status = "timeout"
              subtask.completedAt = now
              subtask.error = "Deadline exceeded (" + subtask.deadlineMs + "ms)"
              parent.metrics.timedout++
              parent.metrics.running--
              parent.runningCount--
              
              var prefix = "[subtask:" + id.substring(0, 8) + "]"
              parent.interactionFn("delegate", prefix + " ⏱️ Timeout after " + Math.round(elapsed / 1000) + "s")
              
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
      
      // Check every 5 seconds
      sleep(5000, true)
    }
  })
}
