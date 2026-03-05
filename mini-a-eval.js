// Author: Nuno Aguiar
// License: Apache 2.0
// Description: MiniAEval - Evaluation framework for mini-a agent quality measurement.

loadLib("mini-a-common.js")

/**
 * <odoc>
 * <key>MiniAEval</key>
 * Evaluation framework for mini-a. Runs end-to-end LLM evals, judges answers with a
 * separate cheap model, and maintains golden reference files for regression testing.
 * </odoc>
 */
var MiniAEval = function() {
  this._judgeModel    = null
  this._judgeProvider = null
  this._goldenDir     = "evals/golden"
  this._updateGolden  = false
  this._results       = []
  this._defaultAgentArgs = {}
}

/**
 * Initialise the evaluator.
 * @param {Object} args
 * @param {string}  args.judgeModel     - Model id for the judge LLM (cheap, e.g. haiku)
 * @param {string}  [args.judgeProvider]- Provider string if needed (passed as model prefix)
 * @param {string}  [args.goldenDir]    - Directory for golden files (default: evals/golden)
 * @param {boolean} [args.updateGolden] - Overwrite golden files with current answers
 * @param {string}  [args.model]        - Main agent model
 * @param {string}  [args.mcp]          - MCP connection config
 * @param {number}  [args.maxsteps]     - Max agent steps (default: 10)
 */
MiniAEval.prototype.init = function(args) {
  args = args || {}
  this._judgeModel      = args.judgeModel    || null
  this._judgeProvider   = args.judgeProvider || null
  this._goldenDir       = args.goldenDir     || "evals/golden"
  this._updateGolden    = args.updateGolden  === true
  this._defaultAgentArgs = {
    model   : args.model,
    mcp     : args.mcp,
    maxsteps: args.maxsteps || 10,
    silent  : true,
    useshell: false,
    useutils: false
  }
}

/**
 * Run a fresh MiniA agent for a given goal and return its answer + metrics.
 * @param {string} goal
 * @param {Object} [caseAgentArgs] - Per-case agent arg overrides
 * @returns {{ answer: string, metrics: Object }}
 */
MiniAEval.prototype._runAgent = function(goal, caseAgentArgs) {
  loadLib("mini-a.js")
  var agent = new MiniA()
  var agentArgs = merge({}, this._defaultAgentArgs, caseAgentArgs || {}, { goal: goal })
  agent.init(agentArgs)
  var answer = agent.start(agentArgs)
  return {
    answer : isString(answer) ? answer : String(answer || ""),
    metrics: agent.getMetrics()
  }
}

/**
 * Score an agent answer against expected output using the judge LLM.
 * Returns { score: 0.0-1.0, reasoning: string }
 */
MiniAEval.prototype._judgeWithLLM = function(goal, actual, expected) {
  if (!isString(this._judgeModel) || this._judgeModel.trim().length === 0) {
    // No judge model configured — do a simple exact/contains check as fallback
    var norm = function(s) { return String(s || "").toLowerCase().trim() }
    var score = norm(actual).indexOf(norm(expected)) >= 0 ? 1.0 : 0.0
    return { score: score, reasoning: "Fallback: substring match (no judge model configured)" }
  }

  var prompt = [
    "You are an impartial evaluation judge.",
    "Score how well the agent answer fulfills the goal.",
    "",
    "Goal: " + goal,
    isDef(expected) && String(expected).trim().length > 0
      ? "Reference/Expected: " + expected
      : "(no reference provided)",
    "Agent answer: " + actual,
    "",
    "Score from 0.0 (completely wrong/unhelpful) to 1.0 (perfectly correct and complete).",
    'Respond ONLY with valid JSON: {"score": <float>, "reasoning": "<one sentence>"}'
  ].join("\n")

  try {
    var judgeModelId = isString(this._judgeProvider) && this._judgeProvider.trim().length > 0
      ? this._judgeProvider + "/" + this._judgeModel
      : this._judgeModel
    var judgeLLM = $llm(judgeModelId)
    var raw = judgeLLM.promptWithStats(prompt)
    var text = isString(raw) ? raw : (isMap(raw) && isString(raw.response) ? raw.response : String(raw || ""))
    // strip markdown code fences if present
    text = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim()
    var parsed = af.fromJSON(text)
    if (isMap(parsed) && typeof parsed.score === "number") {
      return {
        score    : Math.max(0, Math.min(1, parsed.score)),
        reasoning: isString(parsed.reasoning) ? parsed.reasoning : ""
      }
    }
  } catch (e) {
    // fall through to default
  }
  return { score: 0, reasoning: "Judge parse error — defaulting to 0" }
}

/** Return path for a golden file given a case id. */
MiniAEval.prototype._goldenPath = function(caseId) {
  return this._goldenDir + "/" + caseId + ".txt"
}

/** Load golden content for a case, or null if absent. */
MiniAEval.prototype._loadGolden = function(caseId) {
  var p = this._goldenPath(caseId)
  if (!io.fileExists(p)) return null
  try { return io.readFileString(p) } catch (e) { return null }
}

/** Save golden content for a case. Creates directories as needed. */
MiniAEval.prototype._saveGolden = function(caseId, answer) {
  var p = this._goldenPath(caseId)
  io.mkdirs(this._goldenDir)
  io.writeFileString(p, answer)
}

/**
 * Run a single eval case.
 * @param {Object} evalCase
 * @param {string}  evalCase.id           - Unique case identifier
 * @param {string}  [evalCase.goal]       - Direct goal string (mutually exclusive with skill)
 * @param {string}  [evalCase.skill]      - Skill name to render (requires utils)
 * @param {string}  [evalCase.skillArgs]  - Args string for skill render
 * @param {string}  [evalCase.judge]      - "llm" | "golden" | "both" (default: "llm")
 * @param {string}  [evalCase.expected]   - Expected answer (for llm judge)
 * @param {number}  [evalCase.threshold]  - Pass threshold 0-1 (default: 0.7)
 * @param {Object}  [evalCase.agentArgs]  - Per-case agent arg overrides
 * @param {number}  [evalCase.maxsteps]   - Per-case maxsteps override
 * @param {string[]} [evalCase.tags]      - Tags for filtering
 * @returns {Object} result object
 */
MiniAEval.prototype.runCase = function(evalCase) {
  if (!isMap(evalCase) || !isString(evalCase.id) || evalCase.id.trim().length === 0) {
    throw new Error("evalCase.id is required")
  }

  var caseId    = evalCase.id.trim()
  var judgeMode = isString(evalCase.judge) ? evalCase.judge.toLowerCase().trim() : "llm"
  var threshold = typeof evalCase.threshold === "number" ? evalCase.threshold : 0.7
  var startTime = now()
  var goal, answer, metrics, score, reasoning, goldenScore, goldenReasoning, llmScore, llmReasoning

  // --- 1. Resolve goal ---
  try {
    if (isString(evalCase.skill) && evalCase.skill.trim().length > 0) {
      // Render skill to get the goal string
      loadLib("mini-a-utils.js")
      var ut = new MiniUtilsTool()
      ut.init({ root: "." })
      var rendered = ut.skills({
        operation: "render",
        name     : evalCase.skill.trim(),
        args     : isString(evalCase.skillArgs) ? evalCase.skillArgs : "",
        compact  : true
      })
      if (isString(rendered)) {
        // Error string returned
        throw new Error("Skill render failed: " + rendered)
      }
      goal = isMap(rendered) && isString(rendered.rendered) ? rendered.rendered : String(rendered)
    } else if (isString(evalCase.goal) && evalCase.goal.trim().length > 0) {
      goal = evalCase.goal.trim()
    } else {
      throw new Error("evalCase must have either 'goal' or 'skill'")
    }
  } catch (e) {
    var result = {
      id       : caseId,
      goal     : goal || "(unknown)",
      answer   : null,
      score    : 0,
      reasoning: "Goal resolution failed: " + __miniAErrMsg(e),
      passed   : false,
      durationMs: now() - startTime,
      error    : __miniAErrMsg(e)
    }
    this._results.push(result)
    return result
  }

  // --- 2. Run agent ---
  var caseAgentArgs = merge({}, evalCase.agentArgs || {})
  if (typeof evalCase.maxsteps === "number") caseAgentArgs.maxsteps = evalCase.maxsteps

  try {
    var run = this._runAgent(goal, caseAgentArgs)
    answer  = run.answer
    metrics = run.metrics
  } catch (e) {
    var result = {
      id       : caseId,
      goal     : goal,
      answer   : null,
      score    : 0,
      reasoning: "Agent run failed: " + __miniAErrMsg(e),
      passed   : false,
      durationMs: now() - startTime,
      error    : __miniAErrMsg(e)
    }
    this._results.push(result)
    return result
  }

  // --- 3. Judge ---
  try {
    if (judgeMode === "golden" || judgeMode === "both") {
      var golden = this._loadGolden(caseId)
      if (golden === null || this._updateGolden) {
        // First run or forced update: save and auto-pass
        this._saveGolden(caseId, answer)
        goldenScore     = 1.0
        goldenReasoning = this._updateGolden && golden !== null
          ? "Golden updated (updateGolden=true)"
          : "First run — golden saved"
      } else {
        // Compare to golden using judge LLM
        var gj = this._judgeWithLLM(goal, answer, golden)
        goldenScore     = gj.score
        goldenReasoning = "Golden compare: " + gj.reasoning
      }
    }

    if (judgeMode === "llm" || judgeMode === "both") {
      var lj = this._judgeWithLLM(goal, answer, evalCase.expected || "")
      llmScore     = lj.score
      llmReasoning = lj.reasoning
    }

    if (judgeMode === "both") {
      score     = Math.min(goldenScore, llmScore)
      reasoning = "golden=" + goldenScore.toFixed(2) + " (" + goldenReasoning + "); llm=" + llmScore.toFixed(2) + " (" + llmReasoning + ")"
    } else if (judgeMode === "golden") {
      score     = goldenScore
      reasoning = goldenReasoning
    } else {
      // default: llm
      score     = llmScore
      reasoning = llmReasoning
    }
  } catch (e) {
    score     = 0
    reasoning = "Judge failed: " + __miniAErrMsg(e)
  }

  var result = {
    id        : caseId,
    goal      : goal,
    answer    : answer,
    score     : score,
    reasoning : reasoning,
    passed    : score >= threshold,
    threshold : threshold,
    judgeMode : judgeMode,
    durationMs: now() - startTime,
    metrics   : metrics
  }
  this._results.push(result)
  return result
}

/** Return all collected results. */
MiniAEval.prototype.getResults = function() {
  return this._results
}

/** Return summary statistics. */
MiniAEval.prototype.getSummary = function() {
  var pass = 0, fail = 0, total = this._results.length, scoreSum = 0
  for (var i = 0; i < this._results.length; i++) {
    scoreSum += (this._results[i].score || 0)
    if (this._results[i].passed) pass++; else fail++
  }
  return {
    total   : total,
    pass    : pass,
    fail    : fail,
    avgScore: total > 0 ? Math.round((scoreSum / total) * 1000) / 1000 : 0
  }
}

/**
 * Write a JSON report to a file.
 * @param {string} outFile - Destination path
 */
MiniAEval.prototype.writeReport = function(outFile) {
  outFile = outFile || "evals/results.json"
  io.mkdirs(String(new java.io.File(outFile).getParent()))
  var report = {
    timestamp: new Date().toISOString(),
    summary  : this.getSummary(),
    results  : this._results
  }
  io.writeFileString(outFile, af.toJSON(report, __, 2))
}
