// Author: Nuno Aguiar
// Description: Small centralized, fail-closed-on-match policy evaluator.

var MiniAPolicyRuntime = function(definition) {
  this.definition = isObject(definition) ? definition : {}
}

MiniAPolicyRuntime.prototype.evaluate = function(operation) {
  var op = isObject(operation) ? operation : {}
  var rules = this.definition
  var type = String(op.type || "").toLowerCase()
  var deny = function(reason) { return { decision: "deny", reason: reason } }
  if (rules.enabled === false) return { decision: "allow", reason: "policy disabled" }
  if (rules[type] === "deny" || rules[type] === false) return deny(type + " denied by policy")
  if (rules[type] === "approval") return { decision: "approval", reason: type + " requires approval" }
  var name = String(op.name || "")
  var deniedTools = isArray(rules.deniedTools) ? rules.deniedTools : (isObject(rules.tools) && isArray(rules.tools.deny) ? rules.tools.deny : [])
  if ((type === "tool" || type === "capability") && deniedTools.indexOf(name) >= 0) return deny("capability denied by policy")
  if (type === "tool" && rules.mcp === "deny") return deny("MCP tools denied by policy")
  if (type === "tool" && rules.plugins === "deny" && op.plugin === true) return deny("plugin tools denied by policy")
  if (type === "shell" && rules.shell === "deny") return deny("shell denied by policy")
  if (type === "delegation" && rules.delegation === "deny") return deny("delegation denied by policy")
  if (type === "wiki_write" && (rules.wiki === "deny" || (isObject(rules.wiki) && rules.wiki.write === "deny"))) return deny("Wiki writes denied by policy")
  var fileRules = isObject(rules.filesystem) ? rules.filesystem : {}
  var fileAccess = String(op.access || "").toLowerCase()
  if ((type === "filesystem" || type === "tool") && (rules.filesystem === "deny" || fileRules[fileAccess] === "deny" || fileRules[fileAccess] === false)) return deny("filesystem " + (fileAccess || "access") + " denied by policy")
  var url = isString(op.url) ? op.url : ""
  var allowedDomains = isObject(rules.network) && isArray(rules.network.allowDomains) ? rules.network.allowDomains : []
  if (url.length > 0 && allowedDomains.length > 0) {
    var host = url.replace(/^https?:\/\//i, "").split(/[/?#]/)[0].replace(/:\d+$/, "").toLowerCase()
    if (!allowedDomains.some(function(domain) { return host === domain || host.endsWith("." + domain) })) return deny("network domain denied by policy")
  }
  return { decision: "allow", reason: "no restrictive policy matched" }
}

MiniA.prototype._initPolicyRuntime = function(args) {
  var raw = args.policy
  if (isString(raw) && raw.trim().length > 0) raw = af.fromJSSLON(raw)
  if (isString(args.policyfile) && args.policyfile.length > 0 && io.fileExists(args.policyfile)) raw = io.readFileJSON(args.policyfile)
  this._policyRuntime = new MiniAPolicyRuntime(raw)
  return this._policyRuntime
}

MiniA.prototype._policyDecision = function(operation) {
  if (!isObject(this._policyRuntime)) return { decision: "allow", reason: "no policy configured" }
  var decision = this._policyRuntime.evaluate(operation)
  this._trace("policy_decision", { operation: { type: operation.type, name: operation.name }, decision: decision.decision, reason: decision.reason })
  return decision
}
