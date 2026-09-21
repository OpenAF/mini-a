// Author: Nuno Aguiar
// Description: Normalized capability registry and deterministic selection helpers.

var MiniACapabilityRegistry = function() {
  this._entries = []
}

MiniACapabilityRegistry.prototype.add = function(entry) {
  if (!isObject(entry) || !isString(entry.name) || entry.name.length === 0) return
  this._entries.push(merge({ type: "tool", tags: [], readwrite: "unknown", local: true, costClass: "unknown", latencyClass: "unknown" }, entry))
}

MiniACapabilityRegistry.prototype.list = function() {
  return this._entries.map(function(entry) { return merge({}, entry) })
}

MiniACapabilityRegistry.prototype.select = function(goal, options) {
  var opts = isObject(options) ? options : {}
  var limit = isNumber(opts.limit) ? Math.max(1, Math.min(32, Math.floor(opts.limit))) : 8
  var terms = String(goal || "").toLowerCase().split(/[^a-z0-9_-]+/).filter(function(term) { return term.length > 2 })
  var ranked = this._entries.map(function(entry, index) {
    var text = (entry.name + " " + (entry.description || "") + " " + (isArray(entry.tags) ? entry.tags.join(" ") : "")).toLowerCase()
    var relevance = terms.reduce(function(total, term) { return total + (text.indexOf(term) >= 0 ? 1 : 0) }, 0)
    var cost = entry.costClass === "low" ? 2 : (entry.costClass === "high" ? -2 : 0)
    var latency = entry.latencyClass === "low" ? 1 : (entry.latencyClass === "high" ? -1 : 0)
    return { entry: entry, score: relevance * 10 + cost + latency, components: { relevance: relevance, cost: cost, latency: latency }, index: index }
  }).sort(function(a, b) { return b.score === a.score ? a.index - b.index : b.score - a.score })
  var selected = ranked.filter(function(item) { return item.score > 0 }).slice(0, limit)
  if (selected.length === 0 && opts.fallback !== false) selected = ranked.slice(0, Math.min(limit, ranked.length))
  return { selected: selected.map(function(item) { return { name: item.entry.name, type: item.entry.type, score: item.score, scoreComponents: item.components } }), total: this._entries.length }
}

MiniA.prototype._refreshCapabilityRegistry = function() {
  var registry = new MiniACapabilityRegistry()
  var parent = this
  ;(isArray(this.mcpTools) ? this.mcpTools : []).forEach(function(tool) {
    var text = (tool.name + " " + (tool.description || "")).toLowerCase()
    var isPlugin = isObject(parent._pluginToolNames) && parent._pluginToolNames[tool.name] === true
    registry.add({
      name: tool.name,
      description: tool.description || "",
      type: "mcp-tool",
      inputs: tool.inputSchema || {},
      tags: isPlugin ? ["mcp", "plugin"] : ["mcp"],
      readwrite: /write|delete|create|update|modify|send|deploy/.test(text) ? "write" : "read",
      local: true,
      costClass: "unknown",
      latencyClass: "unknown"
    })
  })
  ;(isArray(this._availableSkills) ? this._availableSkills : []).forEach(function(skill) {
    registry.add({ name: skill.id || skill.name, description: skill.description || "", type: "skill", tags: isArray(skill.tags) ? skill.tags : ["skill"], local: true, costClass: "low", latencyClass: "low" })
  })
  try {
    var manager = this._subtaskManager
    var workers = manager && isFunction(manager.getRegisteredWorkers) ? manager.getRegisteredWorkers() : []
    workers.forEach(function(url) {
      var profile = isObject(manager._workerProfiles) && isObject(manager._workerProfiles[url]) ? manager._workerProfiles[url] : {}
      var workerTags = ["delegation", "remote"]
      if (isArray(profile.capabilities)) workerTags = workerTags.concat(profile.capabilities)
      registry.add({ name: "worker:" + url, description: profile.description || profile.name || "Remote delegated worker", type: "worker", inputs: profile.inputs || {}, outputs: profile.outputs || {}, tags: workerTags, local: false, costClass: profile.costClass || "unknown", latencyClass: profile.latencyClass || "high" })
    })
  } catch(ignoreWorkers) {}
  this._capabilityRegistry = registry
  return registry
}

MiniA.prototype.getCapabilities = function() {
  return isDef(this._capabilityRegistry) && isFunction(this._capabilityRegistry.list) ? this._capabilityRegistry.list() : []
}

MiniA.prototype._selectCapabilities = function(goal, args) {
  var registry = this._refreshCapabilityRegistry()
  var selected = registry.select(goal, { limit: isNumber(args.capabilitylimit) ? args.capabilitylimit : 8 })
  if (isFunction(this._policyDecision)) {
    selected.selected = selected.selected.filter(function(item) {
      var decision = this._policyDecision({ type: "capability", name: item.name })
      return decision.decision === "allow"
    }.bind(this))
  }
  this._trace("capability_selection", { goal: goal, selected: selected.selected, total: selected.total })
  return selected
}
