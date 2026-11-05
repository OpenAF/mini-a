// Author: Nuno Aguiar
// Bounded, provider-free inheritance preparation shared by every delegation trigger.
var MiniAForkPolicy = {
  version: 1,
  policies: ["auto", "legacy", "clean", "memory", "context", "full"],
  copy: function(value) { return isDef(value) ? jsonParse(stringify(value, __, "")) : __ },
  bytes: function(value) { return af.fromString2Bytes(isString(value) ? value : stringify(value, __, "")).length },
  policy: function(value) {
    var policy = isDef(value) ? String(value).trim().toLowerCase() : "auto"
    if (this.policies.indexOf(policy) < 0) throw new Error("Invalid forkpolicy: expected auto|legacy|clean|memory|context|full")
    return policy
  },
  scope: function(state) {
    var memory = this.hasMemory(state), context = isMap(state) && isArray(state.forkedContext) && state.forkedContext.length > 0
    return memory ? (context ? "full" : "memory") : (context ? "context" : "clean")
  },
  hasMemory: function(state) {
    return isMap(state) && ["workingMemory", "workingMemorySession"].some(function(key) {
      var value = state[key]
      return isMap(value) && Object.keys(value).some(function(k) { return isArray(value[k]) ? value[k].length > 0 : isDef(value[k]) })
    })
  },
  normalize: function(parentArgs, args, opts) {
    opts = opts || {}; args = args || {}; parentArgs = parentArgs || {}
    var hasFork = isDef(opts.fork), policy = this.policy(isDef(opts.forkpolicy) ? opts.forkpolicy : parentArgs.forkpolicy)
    var fork = hasFork ? toBoolean(opts.fork) : __
    if (hasFork && fork !== true && fork !== false) throw new Error("fork must be true or false")
    var scope = isArray(opts.forkscope) ? opts.forkscope.slice() : (isString(opts.forkscope) ? [opts.forkscope] : ["memory"])
    if (scope.length === 0 || scope.some(function(s) { return ["memory", "context"].indexOf(s) < 0 })) throw new Error("forkscope must contain memory and/or context")
    var explicitScope = fork === false ? "clean" : (scope.indexOf("memory") >= 0 ? (scope.indexOf("context") >= 0 ? "full" : "memory") : "context")
    if (fork === true && isMap(opts.forkState) && !isDef(opts.forkscope)) explicitScope = this.scope(opts.forkState)
    if (hasFork && isDef(opts.forkpolicy) && ["auto", "legacy"].indexOf(policy) < 0 && explicitScope !== policy) {
      throw new Error("Conflicting fork and per-task forkpolicy")
    }
    var initialized = isDef(args.state) || isDef(args.conversation)
    if (initialized && (fork === true || (!hasFork && isDef(opts.forkpolicy) && ["memory", "context", "full"].indexOf(policy) >= 0))) {
      throw new Error("Explicit state/conversation conflicts with parent inheritance")
    }
    return { policy: policy, hasFork: hasFork, fork: fork, scope: scope, explicitScope: explicitScope,
      strictPolicy: isDef(opts.forkpolicy) && ["memory", "context", "full"].indexOf(policy) >= 0,
      initialized: initialized, selfContained: opts._forkSelfContained === true, legacy: policy === "legacy" }
  },
  // Multi-token lexical evidence is deliberately conservative and language-independent.
  // A shared repository name, a single word, complexity, and nonempty storage do not qualify.
  tokens: function(text) {
    var seen = {}, stop = "the and for with from this that what which using task goal please parent child repository repo project workspace directory file files code summarize summary read write review analyze analyse inspect repositório projeto arquivo para como uma das dos los las por que con les des une dans sur die der und mit den dem"
    ;(String(text || "").toLowerCase().match(/[a-z0-9_\u00c0-\uffff]{3,}/g) || []).forEach(function(t) {
      if (stop.split(" ").indexOf(t) < 0) seen[t] = true
    })
    return Object.keys(seen)
  },
  relevant: function(goal, text) {
    var query = this.tokens(goal), source = this.tokens(text)
    var hits = query.filter(function(t) { return source.indexOf(t) >= 0 }).length
    return hits >= 2 && hits / Math.max(1, query.length) >= 0.5
  },
  capture: function(manager, goal, args, opts) {
    var capturedAt = now()
    var intent = this.normalize(manager.parentArgs, args, opts), parent = manager.parentAgent
    var state = {}, projected = "", limit = manager.parentArgs.forkstatemaxbytes
    limit = isNumber(limit) && limit > 0 ? limit : 65536
    var explicitMaxBytes = limit
    if (isNumber(args.forkstatemaxbytes) && args.forkstatemaxbytes > 0) limit = Math.min(limit, args.forkstatemaxbytes)
    var remoteProfiles = manager.remoteDelegation ? manager.workers.map(function(url) { return manager._workerProfiles[url] || {} }) : []
    var remoteProjection = !manager.remoteDelegation || remoteProfiles.length > 0 && remoteProfiles.every(function(profile) {
      return isArray(profile.capabilities) && profile.capabilities.indexOf("prepared-context-v1") >= 0
    })
    remoteProfiles.forEach(function(profile) {
      var remoteLimit = profile.limits && profile.limits.forkStateMaxBytes
      limit = Math.min(limit, isNumber(remoteLimit) && remoteLimit > 0 ? remoteLimit : 65536)
    })
    var memoryEnabled = toBoolean(isDef(args.usememory) ? args.usememory : manager.parentArgs.usememory) === true
    if (manager.remoteDelegation && (!remoteProfiles.length || !remoteProfiles.every(function(profile) { return profile.limits && profile.limits.forkMemory === true }))) memoryEnabled = false
    var needsSources = !intent.initialized && (intent.legacy || intent.fork === true || !intent.hasFork && intent.policy !== "clean")
    var captureScope = intent.hasFork ? intent.scope : (intent.policy === "memory" ? ["memory"] : (intent.policy === "context" ? ["context"] : ["memory", "context"]))
    if (needsSources && isMap(opts.forkState) && intent.fork === true) state = this.copy(opts.forkState)
    else if (needsSources && (!intent.legacy || intent.fork === true) && parent && isFunction(parent._buildForkState)) state = this.copy(parent._buildForkState(captureScope)) || {}
    if (needsSources && intent.legacy && parent && isFunction(parent._contextForDelegate)) projected = parent._contextForDelegate(goal, 2048)
    // The active VM view is a bounded alternative history representation. It is never
    // delivered alongside forkedContext. Shadow/degraded modes use runtime history.
    if (needsSources && !intent.legacy && !intent.hasFork && intent.policy !== "memory" && remoteProjection && parent && isFunction(parent._contextForDelegate)) {
      projected = parent._contextForDelegate(goal, 2048, { forkPolicy: true })
      if (projected) delete state.forkedContext
    }
    if (!intent.legacy && (!intent.hasFork || intent.strictPolicy) && !memoryEnabled) { delete state.workingMemory; delete state.workingMemorySession }
    var explicitText = goal + "\n" + (isString(args.knowledge) ? args.knowledge : "")
    var evidence = { memory: false, context: false, memoryTokens: [], contextTokens: [] }, self = this
    var markEvidence = function(category, text) {
      if (!self.relevant(goal, text) || explicitText.indexOf(text) >= 0) return
      evidence[category] = true
      var sourceTokens = self.tokens(text)
      self.tokens(goal).forEach(function(token) {
        if (sourceTokens.indexOf(token) >= 0 && evidence[category + "Tokens"].indexOf(token) < 0) evidence[category + "Tokens"].push(token)
      })
    }
    ;["workingMemory", "workingMemorySession"].forEach(function(key) {
      var memory = state[key]
      if (!isMap(memory)) return
      Object.keys(memory).forEach(function(section) {
        if (!isArray(memory[section])) return
        // Expired/superseded records cannot become automatic dependency evidence.
        if (intent.legacy || intent.fork === true) return
        memory[section] = memory[section].filter(function(entry) {
          var expiry = isMap(entry) ? (entry.exp || entry.expiresAt) : __
          var expiryMs = isNumber(expiry) ? expiry : (isString(expiry) ? new Date(expiry).getTime() : NaN)
          var value = isMap(entry) ? (entry.v || entry.value) : entry
          var covered = intent.policy === "auto" && isString(value) && value.length > 0 && explicitText.indexOf(value) >= 0
          return !covered && (!isMap(entry) || (entry.stale !== true && entry.status !== "superseded" && !(isString(entry.sup) && entry.sup.length) && !(expiryMs <= now())))
        })
      })
      Object.keys(memory).forEach(function(section) {
        var entries = isArray(memory[section]) ? memory[section] : [memory[section]]
        entries.forEach(function(entry) {
          var text = isString(entry) ? entry : stringify(entry, __, "")
          markEvidence("memory", text)
        })
      })
    })
    if (!intent.legacy && !intent.hasFork && intent.policy === "auto" && isArray(state.forkedContext)) {
      state.forkedContext = state.forkedContext.filter(function(entry) { return !isString(entry) || !entry.length || explicitText.indexOf(entry) < 0 })
    }
    ;(state.forkedContext || []).forEach(function(entry) {
      var text = isString(entry) ? entry : stringify(entry, __, "")
      markEvidence("context", text)
    })
    if (projected) markEvidence("context", projected)
    var contextBudget = parent && isFunction(parent._getEffectiveContextBudget) ? parent._getEffectiveContextBudget(merge(merge({}, manager.parentArgs), args)) : (args.maxcontext || manager.parentArgs.maxcontext)
    var parentBudget = parent && isFunction(parent._getEffectiveContextBudget) ? parent._getEffectiveContextBudget(manager.parentArgs) : manager.parentArgs.maxcontext
    if (isNumber(parentBudget) && parentBudget > 0) contextBudget = isNumber(contextBudget) && contextBudget > 0 ? Math.min(contextBudget, parentBudget) : parentBudget
    remoteProfiles.forEach(function(profile) {
      var remoteTokens = profile.limits && profile.limits.maxContextTokens
      if (isNumber(remoteTokens) && remoteTokens > 0) contextBudget = isNumber(contextBudget) && contextBudget > 0 ? Math.min(contextBudget, remoteTokens) : remoteTokens
    })
    // Snapshots and projections are cloned now, before parent/child execution can mutate them.
    return { id: genUUID(), version: this.version, intent: intent, state: state, projected: projected,
      evidence: evidence, providedState: isMap(opts.forkState), maxBytes: limit, explicitMaxBytes: explicitMaxBytes, goal: goal, explicitKnowledge: isString(args.knowledge) ? args.knowledge : "",
      parentKnowledge: manager.parentArgs.knowledge,
      parentGoal: isString(manager.parentArgs.goal) ? manager.parentArgs.goal.substring(0, 512) : "",
      contextBudget: contextBudget,
      decisionDisabled: toBoolean(manager.parentArgs.forkdecide) === false || toBoolean(manager.parentArgs.usedecide) === false,
      decisionConfigured: !!(parent && parent._decision && parent._decision._config && !parent._decision._error),
      decisionFingerprint: parent && parent._decision && parent._decision._config ? sha256(stringify(parent._decision._config, __, "")) : __,
      decisionRuntime: parent ? parent._forkDecisionRuntime : __,
      capture_latency_ms: now() - capturedAt,
      activeProjection: !!(parent && parent._historyVm && parent._historyVm.contextVirtualization && !parent._historyVm.contextVirtualizationShadow && !parent._historyVm.degraded), createdAt: now() }
  },
  materialize: function(input, scope, strict) {
    var state = {}, projected = "", source = input.state, self = this
    if (scope === "memory" || scope === "full") ["workingMemory", "workingMemorySession"].forEach(function(key) {
      if (isMap(source[key])) state[key] = self.copy(source[key])
    })
    if (scope === "context" || scope === "full") {
      if (isArray(source.forkedContext) && source.forkedContext.length > 0) state.forkedContext = this.copy(source.forkedContext)
      else projected = input.projected || ""
    }
    var before = stringify(state, __, "") + projected
    var maxBytes = input.maxBytes
    var total = function() { return (Object.keys(state).length ? self.bytes(state) : 0) + self.bytes(projected) }
    var maxTokens = isNumber(input.contextBudget) && input.contextBudget > 0 ? input.contextBudget : Infinity
    var fits = function() { return total() <= maxBytes && Math.ceil((stringify(state, __, "").length + projected.length) / 4) <= maxTokens }
    while (!fits() && isArray(state.forkedContext) && state.forkedContext.length > 0) state.forkedContext.shift()
    if (!fits() && projected) projected = "" // Never cut an untrusted-context delimiter in half.
    if (!fits()) delete state.workingMemorySession
    if (!fits() && isMap(state.workingMemory)) {
      Object.keys(state.workingMemory).sort().forEach(function(key) {
        var values = state.workingMemory[key]
        if (isArray(values)) while (!fits() && values.length) values.shift()
        if (!fits()) delete state.workingMemory[key]
      })
    }
    if (isArray(state.forkedContext) && !state.forkedContext.length) delete state.forkedContext
    ;["workingMemory", "workingMemorySession"].forEach(function(key) {
      if (isMap(state[key]) && !self.hasMemory((function() { var s = {}; s[key] = state[key]; return s })())) delete state[key]
    })
    var effective = this.scope(state)
    if (projected) effective = effective === "memory" ? "full" : "context"
    if (!fits()) { state = {}; projected = ""; effective = "clean" }
    if (strict && effective !== scope) throw new Error("Forced forkpolicy=" + scope + " is unavailable or exceeds inheritance budgets")
    var bytes = Object.keys(state).length ? this.bytes(state) : 0
    return { state: Object.keys(state).length ? stringify(state, __, "") : __, knowledge: projected,
      scope: effective, inherited_bytes: bytes + this.bytes(projected), estimated_tokens: Math.ceil(((bytes ? stringify(state, __, "").length : 0) + projected.length) / 4),
      truncated: before !== stringify(state, __, "") + projected }
  },
  prepare: function(input, manager, task) {
    var started = now(), intent = input.intent, chosen, source = "heuristic", reason = "dependency_evidence"
    var result = { requested_policy: intent.policy, effective_policy: intent.legacy ? "legacy" : (intent.hasFork ? intent.explicitScope : (intent.initialized ? "clean" : intent.policy)), version: this.version, snapshot_id: input.id,
      classifier_latency_ms: 0, cache_hit: false, classifier_attempted: false }
    if (intent.legacy) {
      if (intent.fork === true) {
        result.explicit_state = {}
        if (intent.scope.indexOf("memory") >= 0) ["workingMemory", "workingMemorySession"].forEach(function(k) { if (isMap(input.state[k])) result.explicit_state[k] = MiniAForkPolicy.copy(input.state[k]) })
        if (intent.scope.indexOf("context") >= 0) result.explicit_state.forkedContext = MiniAForkPolicy.copy(input.state.forkedContext || [])
        // Caller-prepared legacy snapshots are authoritative, including trigger-specific defaults.
        if (input.providedState) result.explicit_state = MiniAForkPolicy.copy(input.state)
      }
      return merge(result, { legacy: true, suppressProjection: intent.initialized, source: "legacy", reason: "legacy", scope: intent.fork === true ? intent.explicitScope : "clean", latency_ms: now() - started })
    }
    var available = ["clean"], self = this
    ;["memory", "context", "full"].forEach(function(scope) { if (self.materialize(input, scope, false).scope === scope) available.push(scope) })
    result.unavailable = ["memory", "context", "full"].filter(function(s) { return available.indexOf(s) < 0 })
    if (intent.hasFork) { chosen = intent.explicitScope; source = "explicit"; reason = "explicit_fork" }
    else if (intent.initialized) { chosen = "clean"; source = "explicit"; reason = "explicit_initialization" }
    else if (intent.policy !== "auto") { chosen = intent.policy; source = "explicit"; reason = "forced_policy" }
    else {
      var e = input.evidence
      var complementary = e.memory && e.context &&
        e.memoryTokens.filter(function(token) { return e.contextTokens.indexOf(token) < 0 }).length >= 2 &&
        e.contextTokens.filter(function(token) { return e.memoryTokens.indexOf(token) < 0 }).length >= 2
      chosen = e.memory ? (e.context ? "full" : "memory") : (e.context ? "context" : "clean")
      if (e.memory && e.context && !complementary) chosen = "unresolved"
      if (available.indexOf(chosen) < 0) {
        chosen = ["memory", "context"].filter(function(s) { return e[s] && available.indexOf(s) >= 0 }).sort(function(a, b) {
          return self.materialize(input, a, false).inherited_bytes - self.materialize(input, b, false).inherited_bytes
        })[0] || "clean"
      }
      if (intent.selfContained) { chosen = "clean"; reason = "explicit_inputs_complete" }
      else if (available.length === 1) reason = "no_available_sources"
      else if (chosen !== "clean" && (complementary && chosen === "full" || available.length === 2)) reason = "bounded_dependency_evidence"
      else {
        // Relevance suggests a fallback, not proof of semantic necessity. Ambiguity
        // may use exactly one bounded parent-side decision; all failures keep it.
        source = "fallback"; reason = "deterministic_fallback"
        if (manager.parentAgent && isFunction(manager.parentAgent._decideForkPolicy)) {
          var decision = manager.parentAgent._decideForkPolicy(input, available, manager.parentArgs, task)
          result.classifier_latency_ms = decision.latency_ms || 0
          result.cache_hit = decision.cache_hit === true
          result.classifier_attempted = decision.attempted === true
          reason = decision.reason
          if (available.indexOf(decision.scope) >= 0) { chosen = decision.scope; source = "decision" }
        }
      }
    }
    // Existing explicit forks retain their historical overflow/error contract.
    if (intent.fork === true && !intent.strictPolicy) {
      var explicitState = {}
      if (chosen === "memory" || chosen === "full") ["workingMemory", "workingMemorySession"].forEach(function(k) { if (isMap(input.state[k])) explicitState[k] = self.copy(input.state[k]) })
      if (chosen === "context" || chosen === "full") explicitState.forkedContext = self.copy(input.state.forkedContext || [])
      result.explicit_state = explicitState
      result.scope = chosen
    } else {
      var material = this.materialize(input, chosen, source === "explicit" && chosen !== "clean")
      Object.keys(material).forEach(function(k) { result[k] = material[k] })
    }
    result.source = source; result.reason = reason; result.latency_ms = now() - started + (input.capture_latency_ms || 0)
    return result
  },
  diagnostics: function(prepared) {
    var out = {}
    ;["requested_policy", "effective_policy", "scope", "source", "reason", "version", "snapshot_id", "latency_ms", "classifier_latency_ms", "classifier_attempted", "cache_hit", "inherited_bytes", "estimated_tokens", "truncated", "unavailable", "omitted"].forEach(function(k) {
      if (isDef(prepared[k])) out[k] = MiniAForkPolicy.copy(prepared[k])
    })
    return out
  }
}
