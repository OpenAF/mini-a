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
MiniAPolicyRuntime.prototype.restricts = function() {
  return this.definition.enabled !== false && Object.keys(this.definition).some(function(k) { return k !== "enabled" })
}

// Independent policy authorities must each allow an operation. An approval
// cannot override another authority's denial, and a disabled policy contributes
// no restrictions without disabling the other policies.
MiniAPolicyRuntime.intersection = function(definitions) {
  if (!isArray(definitions) || definitions.some(function(definition) { return !isMap(definition) })) throw new Error("Invalid policy intersection")
  var policies = definitions.map(function(definition) { return new MiniAPolicyRuntime(definition) })
  return { definitions: clone(definitions), restricts: function() { return policies.some(function(policy) { return policy.restricts() }) }, evaluate: function(operation) {
    var approval
    for (var i = 0; i < policies.length; i++) {
      var decision = policies[i].evaluate(operation)
      if (decision.decision === "deny") return decision
      if (decision.decision === "approval" && !approval) approval = decision
    }
    return approval || { decision: "allow", reason: "all policies allow" }
  } }
}

// Validate a proposed shared-file task against both authorities before it is
// submitted. The worker repeats this at admission, so a preflight is not a grant.
function __miniARemoteScopedFileValidate(contract, worker) {
  if (!isMap(contract) || contract.version !== 1 || !isString(contract.root) || !isArray(contract.reads) || !isArray(contract.writes) ||
      !isArray(contract.policies) || contract.policies.length > 4 || contract.policies.some(function(p) { return !isMap(p) }) ||
      !(contract.parentFileallow === null || isArray(contract.parentFileallow)) ||
      Object.keys(contract).some(function(k) { return ["version", "root", "reads", "writes", "parentFileallow", "policies"].indexOf(k) < 0 }) ||
      contract.reads.length + contract.writes.length === 0 || contract.reads.length > 32 || contract.writes.length > 32) throw new Error("Invalid scoped file contract")
  if (!isMap(worker) || !isString(worker.apitoken) || !worker.apitoken.length || toBoolean(worker.useutils) !== true || toBoolean(worker.usestdutils) !== true || toBoolean(worker.usetools) !== true ||
      (contract.writes.length && toBoolean(worker.readwrite) !== true)) throw new Error("Worker file tools unavailable")
  var parser = Object.create(MiniA.prototype); parser.fnI = function() {}
  var allowed = parser._normalizeUtilsToolList(worker.utilsallow, true), denied = parser._normalizeUtilsToolList(worker.utilsdeny, true)
  var required = contract.writes.length ? ["read", "apply_patch"] : ["read"]
  if (required.some(function(name) { return (allowed.length > 0 && allowed.indexOf(name) < 0) || denied.indexOf(name) >= 0 })) throw new Error("Worker tool filter denies scoped task")
  var rootFile = new java.io.File(contract.root), root = String(rootFile.getCanonicalPath())
  var workerRoot = String(new java.io.File(worker.utilsroot || ".").getCanonicalPath())
  if (!rootFile.isAbsolute() || root !== contract.root || !rootFile.isDirectory() || root !== workerRoot) throw new Error("Shared utility root unavailable")
  var parentAccess = new MiniAFileAccess(contract.parentFileallow === null ? __ : contract.parentFileallow)
  var workerAccess = new MiniAFileAccess(worker.fileallow)
  var scopes = contract.reads.concat(contract.writes)
  scopes.forEach(function(path) {
    if (!isString(path) || path.length > 2048 || path === "*") throw new Error("Invalid file scope")
    var file = new java.io.File(path), canonical = file.getCanonicalFile()
    if (!file.isAbsolute() || String(canonical.getPath()) !== path || !canonical.exists() ||
        !canonical.toPath().startsWith(rootFile.getCanonicalFile().toPath()) || !parentAccess.allows(path) || !workerAccess.allows(path)) throw new Error("File scope not permitted")
  })
  var workerPolicy = worker.policy
  if (isString(workerPolicy) && workerPolicy.trim()) workerPolicy = af.fromJSSLON(workerPolicy)
  if (isString(worker.policyfile) && worker.policyfile.length) {
    var policyPath = workerAccess.assert(worker.policyfile)
    if (!io.fileExists(policyPath)) throw new Error("Worker policy file unavailable")
    workerPolicy = io.readFileJSON(policyPath)
  }
  if (isDef(workerPolicy) && !isMap(workerPolicy)) throw new Error("Invalid worker policy")
  var policies = [isMap(workerPolicy) ? workerPolicy : {}].concat(clone(contract.policies))
  var combined = MiniAPolicyRuntime.intersection(policies)
  if (combined.evaluate({ type: "tool", name: "read", access: "read" }).decision !== "allow" ||
      (contract.writes.length && combined.evaluate({ type: "tool", name: "apply_patch", access: "write" }).decision !== "allow")) throw new Error("Policy denies scoped file tools")
  var parentRoots = contract.parentFileallow === null ? __ : contract.parentFileallow
  var reads = MiniAFileAccess.intersection(MiniAFileAccess.intersection(scopes, parentRoots), worker.fileallow)
  var writes = MiniAFileAccess.intersection(MiniAFileAccess.intersection(contract.writes, parentRoots), worker.fileallow)
  return { root: root, reads: reads || [], writes: writes || [], policies: policies }
}

MiniA.prototype._initPolicyRuntime = function(args) {
  var raw = args.policy
  if (isString(raw) && raw.trim().length > 0) raw = af.fromJSSLON(raw)
  if (isString(args.policyfile) && args.policyfile.length > 0 && io.fileExists(args.policyfile)) raw = io.readFileJSON(this._filePath(args.policyfile))
  if (isDef(args._inheritedPolicies)) {
    if (!isArray(args._inheritedPolicies) || args._inheritedPolicies.length > 5 || args._inheritedPolicies.some(function(p) { return !isMap(p) })) throw new Error("Invalid inherited policies")
    this._policyRuntime = MiniAPolicyRuntime.intersection([isMap(raw) ? raw : {}].concat(args._inheritedPolicies))
  } else this._policyRuntime = new MiniAPolicyRuntime(raw)
  return this._policyRuntime
}

MiniA.prototype._policyDecision = function(operation) {
  if (!isObject(this._policyRuntime)) return { decision: "allow", reason: "no policy configured" }
  var decision = this._policyRuntime.evaluate(operation)
  this._trace("policy_decision", { operation: { type: operation.type, name: operation.name }, decision: decision.decision, reason: decision.reason })
  return decision
}

// Apply policy to the underlying call, including proxy-dispatched operations.
MiniA.prototype._policyToolOperation = function(toolName, params) {
  var name = String(toolName || ""), input = isMap(params) ? params : {}
  if (name === "proxy-dispatch" && input.action === "call" && isString(input.tool)) {
    name = input.tool
    input = isMap(input.arguments) ? input.arguments : {}
  }
  var op = isString(input.operation) ? input.operation : (isString(input.op) ? input.op : (isString(input.action) ? input.action : ""))
  var write = /write|delete|create|update|modify|send|deploy|upload|remove|patch|append|edit|move|rename/i.test(name) ||
    /^(write|delete|create|update|modify|send|deploy|upload|remove|patch|append|edit|move|rename|put|post)/i.test(op) ||
    /^(POST|PUT|PATCH|DELETE)$/i.test(String(input.method || ""))
  return { type: "tool", name: name, access: write ? "write" : "read",
    url: isString(input.url) ? input.url : (isString(input.uri) ? input.uri : input.endpoint),
    plugin: (isObject(this._pluginToolNames) && this._pluginToolNames[name] === true) || /^plugin[._:-]/i.test(name) }
}
