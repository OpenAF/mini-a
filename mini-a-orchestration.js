// Deterministic execution strategy selection for Mini-A.
// Reuses existing planning, advisor, delegation and verification paths.
// MiniAExecution below owns automatic-mode task state and budget admission.
var MiniAOrchestrator = function(config) {
  this.configure(config)
}

MiniAOrchestrator.prototype.configure = function(config) {
  var cfg = isMap(config) ? config : {}
  this.mode = isString(cfg.mode) && cfg.mode.trim().toLowerCase() === "auto" ? "auto" : "manual"
  this.isExplicit = isFunction(cfg.isExplicit) ? cfg.isExplicit : function() { return false }
}

MiniAOrchestrator.prototype._decision = function(name, selected, signals, reason, budget) {
  return {
    version: 1,
    decision: name,
    selected: selected,
    signals: isMap(signals) ? signals : {},
    reason: reason,
    estimated_impact: {},
    budget_state: isMap(budget) ? budget : {}
  }
}

// Word-boundary match on purpose: the complexity assessment's keyword signals use indexOf
// ("latest" contains "test"), which would send unrelated goals to supervised execution.
MiniAOrchestrator.VERIFICATION_PATTERN = /\b(test|tests|testing|validate|validates|validation|verify|verifies|verification|ensure)\b/i
MiniAOrchestrator.goalIntent = function(goal, input) {
  var question = /^\s*(what|why|how|when|where|who|which|can you explain|explain|describe)\b/i.test(goal)
  var execution = !question && /\b(implement|create|build|write|generate|update|change|fix|refactor|migrate|deploy|produce|modify|run|test)\b/i.test(goal)
  var deliverable = (isString(input.outfile) && input.outfile.length > 0) || /\b(file|files|report|code|implementation|service|services|pipeline|artifact|output|application|app|project|test|tests)\b/i.test(goal)
  return { question: question, execution: execution, deliverable: deliverable, ambiguous: !question && (!execution || !deliverable) }
}

// Resolve modelstrategy=auto to a concrete strategy. First matching rule wins. Pure: all
// runtime facts (low-cost model, resume state, supervised eligibility) arrive through ctx.
MiniAOrchestrator.prototype.resolveModelStrategy = function(assessment, args, ctx) {
  var a = isMap(assessment) ? assessment : { level: "medium", score: 0, signals: [] }
  var input = isMap(args) ? args : {}
  var c = isMap(ctx) ? ctx : {}
  var signalList = isArray(a.signals) ? a.signals : []
  var risk = signalList.some(function(signal) { return String(signal).indexOf("domain:security") === 0 || signal === "lookup" })
  var goal = isString(input.goal) ? input.goal : ""
  var verification = MiniAOrchestrator.VERIFICATION_PATTERN.test(goal) || (isString(input.outfile) && input.outfile.length > 0)
  var context = String(input.orchestrationcontext || "auto").toLowerCase().trim()
  if (context !== "interactive" && context !== "batch") context = /^(mini-a-con|mini-a-web)$/.test(String(input.__interaction_source || "")) ? "interactive" : "batch"
  // A question mentioning verification is not itself an execution request.
  var intent = MiniAOrchestrator.goalIntent(goal, input)
  var execution = intent.execution, deliverable = intent.deliverable
  if (intent.ambiguous && isMap(a.decisionIntent)) { execution = a.decisionIntent.execution === true; deliverable = a.decisionIntent.deliverable === true }
  var lcBudget = Number(input.lcbudget)
  var signals = { complexity: a.level, complexity_score: a.score, goal_signals: signalList, risk: risk, verification: verification,
    low_cost_model: c.lowCostModel === true, complexity_source: a.source || "heuristic", interaction_context: context, execution_intent: execution, deliverable: deliverable }
  var pick = function(selected, reason, rule) {
    signals.rule = rule
    return this._decision("model_strategy", selected, signals, reason, { lc_budget: isNumber(lcBudget) && !isNaN(lcBudget) ? lcBudget : 0 })
  }.bind(this)

  var resume = isMap(c.resumeState) ? c.resumeState : __
  if (isDef(resume) && isMap(resume.supervised)) return pick("supervised", "resumed run is supervised", 1)
  if (isDef(resume) && ["default", "advisor", "delegate", "supervised"].indexOf(resume.model_strategy) >= 0) return pick(resume.model_strategy, "resumed run keeps its recorded strategy", 2)

  var contractIntent = isString(input.contractfile) || isString(input.contractargs) || input.savecontract === true || input.reusecontract === true ||
    String(input.savecontract).toLowerCase() === "true" || String(input.reusecontract).toLowerCase() === "true"
  if (contractIntent) return pick("supervised", "explicit contract options", 3)

  var lock = isString(input.modellock) ? input.modellock.trim().toLowerCase() : "auto"
  if (c.lowCostModel !== true || lock === "main" || lock === "lc") return pick("default", c.lowCostModel !== true ? "no low-cost executor available" : "model lock selected", 4)

  if (a.level === "complex" && context === "batch" && c.supervisedEligible === true && verification && execution && deliverable) return pick("supervised", "complex batch execution with a deliverable and verification requirement", 5)
  if (a.level === "complex") return pick("advisor", "complex goal with low-cost executor", 6)
  if (a.level === "medium" && !risk && isNumber(lcBudget) && lcBudget > 0) return pick("delegate", "medium low-risk goal under an explicit low-cost budget", 7)
  return pick("default", "no strategy-specific signal", 8)
}

MiniAOrchestrator.prototype.assess = function(assessment, args, available) {
  var a = isMap(assessment) ? assessment : { level: "medium", score: 0, signals: [] }
  var input = isMap(args) ? args : {}
  var capability = isMap(available) ? available : {}
  var decisions = []
  var auto = this.mode === "auto"
  var complex = a.level === "complex"
  var mediumOrMore = complex || a.level === "medium"
  var risk = isArray(a.signals) && a.signals.some(function(signal) { return String(signal).indexOf("domain:security") === 0 || signal === "lookup" })
  var signals = { complexity: a.level, complexity_score: a.score, goal_signals: a.signals || [], risk: risk }

  var planning = input.useplanning === true
  if (auto && !this.isExplicit("useplanning")) planning = mediumOrMore && input.chatbotmode !== true
  decisions.push(this._decision("planning", planning ? (complex ? "tree" : "simple") : "off", signals,
    auto && !this.isExplicit("useplanning") ? "deterministic complexity assessment" : "explicit configuration preserved"))

  var advisor = input.modelstrategy === "advisor"
  var strategyResolved = input.__modelstrategyrequested === "auto"
  if (auto && !strategyResolved && !this.isExplicit("modelstrategy")) advisor = complex && capability.lowCostModel === true
  decisions.push(this._decision("advisor", advisor ? "enabled" : "disabled", signals,
    advisor ? "complex task with low-cost executor available" : (auto ? "no high-value advisor signal or no low-cost executor" : "explicit configuration preserved"),
    { advisor_max_uses: input.advisormaxuses }))

  var model = capability.lowCostModel === true && !risk && a.level === "simple" ? "low_cost" : "main"
  if (this.isExplicit("modellock")) model = input.modellock || "auto"
  decisions.push(this._decision("model_selection", model, signals,
    model === "low_cost" ? "low complexity and no high-risk signal" : "risk/complexity prefers existing main-model path",
    { low_cost_budget: input.lcbudget }))

  var delegate = input.usedelegation === true
  decisions.push(this._decision("delegation", delegate ? "enabled" : "disabled", signals,
    delegate ? "existing delegation configuration is enabled" : "no configured worker/delegation override", { max_concurrent: input.maxconcurrent }))
  decisions.push(this._decision("retrieval", input.usewiki === true ? "available" : "not_available", signals,
    input.usewiki === true ? "existing Wiki capability is enabled" : "Wiki remains disabled unless explicitly configured"))

  var validation = input.evidencegate === true
  if (auto && !this.isExplicit("evidencegate")) validation = complex || risk
  decisions.push(this._decision("validation", validation ? "enabled" : "disabled", signals,
    validation ? "complexity or risk warrants existing evidence gate" : "no deterministic validation trigger"))
  decisions.push(this._decision("replanning", planning ? "existing-plan-obstacle-gate" : "not_applicable", signals,
    planning ? "reuse existing planning obstacle detection" : "planning is disabled"))
  return decisions
}

// Shared automatic execution state. No providers, tools, or permissions are created here.
var MiniAExecution = function(options, saved) {
  options = options || {}
  this.clock = options.clock || function() { return Date.now() }
  this.copy = clone
  this.state = saved ? this.copy(saved) : { version: 1, revision: 0, tasks: {}, evidence: [], seen: {}, progress: 0,
    lastProgress: 0, idle: 0, recoveries: 0, outcome: "running", reason: "", budget: {
      cap: Number(options.tokens) || 0, timeCap: Number(options.time) || 0, elapsed: 0,
      spent: 0, estimated: 0, reservations: {}, sequence: 0 } }
  this.started = this.clock()
  this.validate()
}
MiniAExecution.prototype.validate = function() {
  var s = this.state
  if (!s || s.version !== 1 || !s.tasks || !s.budget || !s.budget.reservations || !Array.isArray(s.evidence)) throw new Error("Invalid execution checkpoint")
  ;[s.budget.cap, s.budget.timeCap, s.budget.spent, s.budget.estimated, s.budget.elapsed].forEach(function(n) {
    if (typeof n !== "number" || !isFinite(n) || n < 0) throw new Error("Invalid execution budget")
  })
  Object.keys(s.budget.reservations).forEach(function(id) {
    var r = s.budget.reservations[id]
    if (!r || typeof r.tokens !== "number" || !isFinite(r.tokens) || r.tokens < 0) throw new Error("Invalid execution reservation")
  })
  var visiting = {}, done = {}, self = this
  var visit = function(id) {
    if (visiting[id]) throw new Error("Cyclic task dependencies")
    if (done[id]) return
    var t = s.tasks[id]
    if (!t || t.id !== id || !Array.isArray(t.dependencies) || !Array.isArray(t.criteria)) throw new Error("Invalid execution task")
    visiting[id] = true
    t.dependencies.forEach(function(dep) { if (!s.tasks[dep]) throw new Error("Unknown dependency: " + dep); visit(dep) })
    delete visiting[id]; done[id] = true
  }
  Object.keys(s.tasks).forEach(visit)
}
MiniAExecution.prototype.snapshot = function() {
  var s = this.copy(this.state)
  s.budget.elapsed += Math.max(0, this.clock() - this.started)
  return s
}
MiniAExecution.prototype.available = function(finalizing) {
  var b = this.state.budget, reserved = 0
  Object.keys(b.reservations).forEach(function(id) { reserved += b.reservations[id].tokens })
  if (b.timeCap > 0 && b.elapsed + this.clock() - this.started >= b.timeCap) return 0
  return b.cap > 0 ? Math.max(0, Math.floor(b.cap * (finalizing ? 1 : 0.85)) - b.spent - reserved) : Infinity
}
MiniAExecution.prototype.reserve = function(tokens, owner, finalizing) {
  tokens = Math.max(1, Math.ceil(Number(tokens) || 1))
  if (tokens > this.available(finalizing)) {
    this.state.budget.denied = true
    this.state.budget.deniedTokens = tokens
    var error = new Error("RUN_BUDGET_EXHAUSTED")
    error.permanent = true
    throw error
  }
  var b = this.state.budget, id = "allocation-" + (++b.sequence)
  b.reservations[id] = { tokens: tokens, owner: owner || "model" }
  return id
}
MiniAExecution.prototype.settle = function(id, tokens, estimated) {
  var b = this.state.budget
  if (!b.reservations[id]) return false
  delete b.reservations[id]
  tokens = Math.max(0, Number(tokens) || 0)
  b.spent += tokens
  if (estimated) b.estimated += tokens
  return true
}
MiniAExecution.prototype.observe = function(kind, key, value, taskId) {
  if (value === undefined || value === null || value === "") return false
  var signature = kind + ":" + key + ":" + JSON.stringify(value)
  // Callers supply a digest, never raw tool output, to bound the durable ledger.
  if (this.state.seen[signature]) return false
  this.state.seen[signature] = true
  var keys = Object.keys(this.state.seen)
  if (keys.length > 512) delete this.state.seen[keys[0]]
  this.state.evidence.push({ id: "E" + (++this.state.progress), kind: kind, key: key, digest: value, task: taskId || "", at: this.clock() })
  if (this.state.evidence.length > 128) this.state.evidence.shift()
  return true
}
MiniAExecution.prototype.tick = function(waiting) {
  var s = this.state
  if (waiting) return "wait"
  if (s.progress !== s.lastProgress) { s.lastProgress = s.progress; s.idle = 0; s.recoveries = 0; return "progress" }
  if (++s.idle < 4) return "continue"
  s.idle = 0
  if (++s.recoveries <= 2) return "recover"
  s.outcome = "blocked"; s.reason = "No verified progress after two strategy changes"
  return "blocked"
}
MiniAExecution.prototype.put = function(spec) {
  if (!spec || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(spec.id || "") || ["__proto__", "constructor", "prototype"].indexOf(spec.id) >= 0) throw new Error("Invalid task id")
  if (!spec.objective || typeof spec.objective !== "string") throw new Error("Task objective required")
  if (!this.state.tasks[spec.id] && Object.keys(this.state.tasks).length >= 256) throw new Error("Execution task limit reached")
  var old = this.state.tasks[spec.id], next = this.copy({ id: spec.id, objective: spec.objective, dependencies: spec.dependencies || [],
    criteria: spec.criteria || [], resources: spec.resources || { reads: [], writes: ["*"] }, parent: spec.parent,
    approach: spec.approach || "", idempotent: spec.idempotent === true, required: spec.required !== false })
  next.dependencies = next.dependencies || []; next.criteria = next.criteria || []
  if (!Array.isArray(next.dependencies) || !Array.isArray(next.criteria) || next.criteria.length > 64) throw new Error("Invalid task contract")
  var ids = {}
  next.criteria.forEach(function(c) {
    if (!c.id || ids[c.id] || !c.requirement || ["answer", "artifact", "schema", "semantic"].indexOf(c.method) < 0) throw new Error("Invalid task criterion")
    if (c.method === "schema" && !isMap(c.schema)) throw new Error("Schema criterion requires schema")
    if (c.method !== "semantic" && c.method !== "schema") {
      if (!isMap(c.assertion)) throw new Error("Assertion must be an object, e.g. {equals: '19'}, never an expression")
      var operators = ["equals", "contains", "notContains", "matches", "min", "max"].filter(function(key) { return isDef(c.assertion[key]) })
      if (operators.length !== 1) throw new Error("Assertion requires exactly one supported comparison operator")
      if (c.method === "answer" && !c.format && isDef(c.assertion.equals) && typeof c.assertion.equals !== "string") throw new Error("Answer equals compares strings; quote the expected value or declare format=json")
    }
    ids[c.id] = true
  })
  next.resources = next.resources || { reads: [], writes: ["*"] }
  ;["reads", "writes"].forEach(function(k) { if (!Array.isArray(next.resources[k]) || next.resources[k].some(function(v) { return typeof v !== "string" || !v.length })) throw new Error("Invalid resource scope") })
  if (old && (old.status === "running" || old.status === "unknown")) throw new Error("Cannot revise an active or unreconciled task")
  if (old && old.required !== false && next.required === false) throw new Error("Cannot drop a required task")
  if (old && old.criteria.some(function(c) { return !next.criteria.some(function(n) { return JSON.stringify(n) === JSON.stringify(c) }) })) throw new Error("Cannot weaken existing task criteria")
  next.status = old ? old.status : "pending"; next.acceptance = old ? old.acceptance : "pending"
  next.revision = old ? old.revision + 1 : 1
  this.state.tasks[next.id] = next
  try { this.validate() } catch(e) { if (old) this.state.tasks[next.id] = old; else delete this.state.tasks[next.id]; throw e }
  this.state.revision++
  if (old) this.invalidate(next.id, "Task approach revised")
  return next
}
MiniAExecution.prototype.invalidate = function(id, reason) {
  var self = this, affected = {}
  var visit = function(key) {
    if (affected[key]) return
    affected[key] = true
    var t = self.state.tasks[key]
    t.acceptance = "pending"; t.reason = reason
    if (t.status !== "running") { t.status = "pending"; delete t.owner }
    else t.invalidated = true
    Object.keys(self.state.tasks).forEach(function(other) { if (self.state.tasks[other].dependencies.indexOf(key) >= 0) visit(other) })
  }
  visit(id)
  this.state.revision++
  return Object.keys(affected)
}
MiniAExecution.prototype.ready = function(id) {
  var t = this.state.tasks[id], self = this
  return !!t && t.status === "pending" && t.dependencies.every(function(dep) { return self.state.tasks[dep].acceptance === "accepted" })
}
MiniAExecution.prototype.conflicts = function(a, b) {
  var overlap = function(x, y) { return x === "*" || y === "*" || x === y || x.indexOf(y.replace(/\/$/, "") + "/") === 0 || y.indexOf(x.replace(/\/$/, "") + "/") === 0 }
  var ar = a.resources, br = b.resources
  return ar.writes.some(function(x) { return br.reads.concat(br.writes).some(function(y) { return overlap(x, y) }) }) ||
    br.writes.some(function(x) { return ar.reads.some(function(y) { return overlap(x, y) }) })
}
MiniAExecution.prototype.canStart = function(id) {
  var self = this, t = this.state.tasks[id]
  return this.ready(id) && !Object.keys(this.state.tasks).some(function(key) {
    var other = self.state.tasks[key]
    return key !== id && (other.status === "running" || other.status === "unknown") && self.conflicts(t, other)
  })
}
MiniAExecution.prototype.priority = function(id) {
  var self = this, seen = {}
  var visit = function(key) { Object.keys(self.state.tasks).forEach(function(k) { if (!seen[k] && self.state.tasks[k].dependencies.indexOf(key) >= 0) { seen[k] = true; visit(k) } }) }
  visit(id); return Object.keys(seen).length
}
MiniAExecution.prototype.finish = function(id, outcome, checks) {
  var t = this.state.tasks[id]
  if (!t) throw new Error("Unknown execution task")
  t.outcome = outcome; t.status = "finished"; t.checks = checks || []
  var self = this
  t.acceptance = outcome === "succeeded" && !t.invalidated && t.dependencies.every(function(id) { return self.state.tasks[id].acceptance === "accepted" }) && t.criteria.length > 0 && t.criteria.every(function(c) {
    return t.checks.some(function(k) { return k.id === c.id && k.outcome === "met" })
  }) ? "accepted" : t.checks.some(function(k) { return k.outcome === "unmet" }) ? "rejected" : "pending"
  delete t.invalidated
  if (t.acceptance === "accepted") this.observe("accepted", id, t.revision, id)
  this.state.revision++
  return t
}
