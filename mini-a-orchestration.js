// Deterministic execution strategy selection for Mini-A.
// This layer only selects existing controls; it does not implement alternate
// planning, advisor, delegation, retrieval, or validation mechanisms.
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
  var lcBudget = Number(input.lcbudget)
  var signals = { complexity: a.level, complexity_score: a.score, goal_signals: signalList, risk: risk, verification: verification,
    low_cost_model: c.lowCostModel === true, complexity_source: a.source || "heuristic" }
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

  if (a.level === "complex" && c.supervisedEligible === true && verification) return pick("supervised", "complex goal with a verification requirement", 5)
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
