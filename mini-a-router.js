// Adaptive tool routing for Mini-A
// Keeps route selection explainable and rule-based.

var MiniAToolRouter = function(config) {
  this.configure(config)
}

MiniAToolRouter.ROUTES = {
  DIRECT_LOCAL_TOOL : "direct_local_tool",
  MCP_DIRECT_CALL   : "mcp_direct_call",
  MCP_PROXY_PATH    : "mcp_proxy_path",
  SHELL_EXECUTION   : "shell_execution",
  UTILITY_WRAPPER   : "utility_wrapper",
  DELEGATED_SUBTASK : "delegated_subtask"
}

MiniAToolRouter.DEFAULT_ORDER = [
  MiniAToolRouter.ROUTES.DIRECT_LOCAL_TOOL,
  MiniAToolRouter.ROUTES.MCP_DIRECT_CALL,
  MiniAToolRouter.ROUTES.MCP_PROXY_PATH,
  MiniAToolRouter.ROUTES.UTILITY_WRAPPER,
  MiniAToolRouter.ROUTES.SHELL_EXECUTION,
  MiniAToolRouter.ROUTES.DELEGATED_SUBTASK
]

MiniAToolRouter.prototype.configure = function(config) {
  var cfg = isMap(config) ? config : {}
  this._enabled = toBoolean(cfg.enabled) === true
  this._preferredOrder = isArray(cfg.preferredOrder) && cfg.preferredOrder.length > 0
    ? cfg.preferredOrder.slice(0)
    : MiniAToolRouter.DEFAULT_ORDER.slice(0)
  this._allow = isArray(cfg.allow) ? cfg.allow.slice(0) : []
  this._deny = isArray(cfg.deny) ? cfg.deny.slice(0) : []
  this._proxyThreshold = isNumber(cfg.proxyThreshold) ? cfg.proxyThreshold : 0
}

MiniAToolRouter.prototype._normalizeRouteName = function(route) {
  if (!isString(route)) return ""
  return route.trim().toLowerCase()
}

MiniAToolRouter.prototype._applyAllowDeny = function(routes) {
  var allowMap = {}
  var denyMap = {}
  this._allow.forEach(r => allowMap[this._normalizeRouteName(r)] = true)
  this._deny.forEach(r => denyMap[this._normalizeRouteName(r)] = true)

  return (isArray(routes) ? routes : []).filter(route => {
    var normalized = this._normalizeRouteName(route)
    if (normalized.length === 0) return false
    if (isObject(denyMap) && denyMap[normalized] === true) return false
    if (this._allow.length > 0) return allowMap[normalized] === true
    return true
  })
}

MiniAToolRouter.prototype._orderRoutes = function(routes) {
  var order = this._preferredOrder
  var ordered = []
  var routeSet = {}
  ;(isArray(routes) ? routes : []).forEach(route => {
    var normalized = this._normalizeRouteName(route)
    if (normalized.length > 0) routeSet[normalized] = route
  })

  order.forEach(route => {
    var normalized = this._normalizeRouteName(route)
    if (isDef(routeSet[normalized])) ordered.push(routeSet[normalized])
  })

  Object.keys(routeSet).forEach(normalized => {
    if (ordered.indexOf(routeSet[normalized]) < 0) ordered.push(routeSet[normalized])
  })

  return ordered
}

MiniAToolRouter.prototype._routeFromToolHints = function(intent) {
  var i = isMap(intent) ? intent : {}
  var toolName = isString(i.toolName) ? i.toolName.toLowerCase() : ""
  var routeHints = isMap(i.routeHints) ? i.routeHints : {}

  if (toolName === "shell") return MiniAToolRouter.ROUTES.SHELL_EXECUTION
  if (toolName === "proxy-dispatch" || routeHints.proxy === true) return MiniAToolRouter.ROUTES.MCP_PROXY_PATH
  if (toolName.indexOf("delegate") >= 0 || toolName.indexOf("subtask") >= 0 || routeHints.delegation === true) {
    return MiniAToolRouter.ROUTES.DELEGATED_SUBTASK
  }
  if (routeHints.utility === true || toolName.indexOf("filesystem") >= 0 || toolName.indexOf("markdown") >= 0 || toolName.indexOf("memory") >= 0 || toolName.indexOf("time") >= 0) {
    return MiniAToolRouter.ROUTES.UTILITY_WRAPPER
  }
  if (routeHints.directLocal === true) return MiniAToolRouter.ROUTES.DIRECT_LOCAL_TOOL
  return MiniAToolRouter.ROUTES.MCP_DIRECT_CALL
}

MiniAToolRouter.prototype._buildCandidateRoutes = function(intent) {
  var candidates = []
  var primary = this._routeFromToolHints(intent)
  candidates.push(primary)

  if (primary !== MiniAToolRouter.ROUTES.MCP_DIRECT_CALL) candidates.push(MiniAToolRouter.ROUTES.MCP_DIRECT_CALL)
  if (primary !== MiniAToolRouter.ROUTES.MCP_PROXY_PATH) candidates.push(MiniAToolRouter.ROUTES.MCP_PROXY_PATH)
  if (primary !== MiniAToolRouter.ROUTES.SHELL_EXECUTION) candidates.push(MiniAToolRouter.ROUTES.SHELL_EXECUTION)

  var payloadSize = isNumber(intent.payloadSize) ? intent.payloadSize : 0
  if (this._proxyThreshold > 0 && payloadSize >= this._proxyThreshold && candidates.indexOf(MiniAToolRouter.ROUTES.MCP_PROXY_PATH) < 0) {
    candidates.unshift(MiniAToolRouter.ROUTES.MCP_PROXY_PATH)
  }

  return candidates
}

MiniAToolRouter.prototype.select = function(intent, context) {
  var i = isMap(intent) ? intent : {}
  var c = isMap(context) ? context : {}

  var candidates = this._buildCandidateRoutes(i)
  candidates = this._applyAllowDeny(candidates)
  candidates = this._orderRoutes(candidates)

  if (candidates.length === 0) {
    return {
      selectedRoute: "",
      reason: "No route available after allow/deny filtering.",
      fallbackChain: [],
      metadata: { enabled: this._enabled, policyFiltered: true },
      trace: ["route-filter-empty"]
    }
  }

  var selected = candidates[0]
  var trace = []
  trace.push("intent=" + (i.intentType || "tool_action"))
  trace.push("selected=" + selected)

  if (isString(i.accessMode) && i.accessMode.length > 0) trace.push("access=" + i.accessMode)
  if (isString(i.latencySensitivity) && i.latencySensitivity.length > 0) trace.push("latency=" + i.latencySensitivity)
  if (isString(i.riskLevel) && i.riskLevel.length > 0) trace.push("risk=" + i.riskLevel)

  if (isMap(c.history) && isMap(c.history[selected])) {
    var hist = c.history[selected]
    if (isNumber(hist.failures) && hist.failures > 0 && isNumber(hist.successes) && hist.successes === 0 && candidates.length > 1) {
      selected = candidates[1]
      trace.push("history-fallback=" + selected)
    }
  }

  return {
    selectedRoute: selected,
    reason: "Rule-based routing selected '" + selected + "' based on tool hints, policy filters, and history.",
    fallbackChain: candidates.slice(1),
    metadata: {
      enabled: this._enabled,
      payloadSize: isNumber(i.payloadSize) ? i.payloadSize : 0,
      deterministic: toBoolean(i.deterministic) === true,
      structuredOutputPreferred: toBoolean(i.structuredOutputPreferred) === true
    },
    trace: trace
  }
}

MiniAToolRouter.prototype.normalizeResultEnvelope = function(payload) {
  var p = isMap(payload) ? payload : {}
  var routeUsed = isString(p.routeUsed) ? p.routeUsed : ""
  var rawResult = p.rawResult
  var normalizedContent = isDef(p.normalizedContent) ? p.normalizedContent : rawResult
  var durationMs = isNumber(p.durationMs) ? p.durationMs : 0
  var startTs = isDef(p.startTs) ? p.startTs : now()
  var endTs = isDef(p.endTs) ? p.endTs : (startTs + durationMs)
  var errorInfo = isDef(p.errorInfo) ? p.errorInfo : __
  var evidence = isArray(p.evidence) ? p.evidence : []
  var trail = isArray(p.errorTrail) ? p.errorTrail : []

  return {
    routeUsed: routeUsed,
    rawResult: rawResult,
    normalizedContent: normalizedContent,
    timing: {
      startTs: startTs,
      endTs: endTs,
      durationMs: durationMs
    },
    error: errorInfo,
    errorTrail: trail,
    evidence: evidence
  }
}
