/*
 * Lightweight, provider-neutral evaluation support for Mini-A.
 *
 * This deliberately sits beside MiniA rather than changing its execution
 * policy. Later orchestration and tracing work can reuse the normalized
 * scenario result, metric snapshot, and event records produced here.
 */
(function() {
  var MiniAEval = function(options) {
    this.options = isMap(options) ? options : {}
    this.agentFactory = isFunction(this.options.agentFactory) ? this.options.agentFactory : function() { return new MiniA() }
    this.judgeFn = isFunction(this.options.judgeFn) ? this.options.judgeFn : __
    this.nowFn = isFunction(this.options.nowFn) ? this.options.nowFn : function() { return new Date().getTime() }
  }

  MiniAEval.prototype._readDefinition = function(path) {
    var text = io.readFileString(path)
    var trimmed = isString(text) ? text.trim() : ""
    if (trimmed.length === 0) throw new Error("Evaluation definition is empty: " + path)
    try {
      return (trimmed.charAt(0) === "{" || trimmed.charAt(0) === "[") ? af.fromJson(trimmed) : af.fromYAML(trimmed)
    } catch(e) {
      throw new Error("Unable to parse evaluation definition '" + path + "': " + e)
    }
  }

  MiniAEval.prototype._removeOwnedTree = function(path) {
    if (!isString(path) || path.length === 0) return
    var root = new java.io.File(path)
    if (!root.exists()) return
    var remove = function(file) {
      if (file.isDirectory()) {
        var children = file.listFiles()
        for (var i = 0; children !== null && i < children.length; i++) remove(children[i])
      }
      if (!file.delete()) throw new Error("Unable to remove evaluation fixture " + String(file.getAbsolutePath()))
    }
    remove(root)
  }

  MiniAEval.prototype.load = function(path) {
    var file = new java.io.File(path)
    if (!file.exists()) throw new Error("Evaluation definition not found: " + path)
    var definitions = []
    if (file.isDirectory()) {
      var files = file.listFiles()
      for (var i = 0; files !== null && i < files.length; i++) {
        var name = String(files[i].getName()).toLowerCase()
        if (files[i].isFile() && (name.endsWith(".yaml") || name.endsWith(".yml") || name.endsWith(".json"))) definitions.push(this._readDefinition(String(files[i].getPath())))
      }
    } else {
      definitions.push(this._readDefinition(path))
    }
    var scenarios = []
    definitions.forEach(function(definition) {
      if (isArray(definition)) scenarios = scenarios.concat(definition)
      else if (isMap(definition) && isArray(definition.scenarios)) scenarios = scenarios.concat(definition.scenarios)
      else if (isMap(definition)) scenarios.push(definition)
    })
    return scenarios
  }

  MiniAEval.prototype._numberAt = function(obj, path) {
    var value = obj
    String(path || "").split(".").forEach(function(part) { if (isDef(value) && value !== null) value = value[part] })
    return value
  }

  MiniAEval.prototype._metricSnapshot = function(agent) {
    if (!agent || !isFunction(agent.getMetrics)) return {}
    try {
      // getMetrics returns ordinary nested objects. Snapshot by value because
      // test agents and future live metric implementations may mutate them.
      var metrics = agent.getMetrics() || {}
      return af.fromJson(stringify(metrics, __, ""))
    } catch(ignoreMetrics) { return {} }
  }

  MiniAEval.prototype._metricDelta = function(before, after) {
    var self = this
    var out = {}
    Object.keys(after || {}).forEach(function(key) {
      var value = after[key]
      if (isMap(value)) out[key] = self._metricDelta(isMap(before) ? before[key] : {}, value)
      else if (isNumber(value)) out[key] = value - (isMap(before) && isNumber(before[key]) ? before[key] : 0)
      else out[key] = value
    })
    return out
  }

  MiniAEval.prototype._normalizeMetrics = function(delta, elapsedMs, after) {
    var perf = delta.performance || {}
    var llm = delta.llm_calls || {}
    var actions = delta.actions || {}
    var delegation = delta.delegation || {}
    var wiki = delta.wiki || {}
    var historyVmDelta = isMap(delta.history_vm) && isMap(delta.history_vm.metrics) ? delta.history_vm.metrics : {}
    var historyVmAfter = isMap(after) && isMap(after.history_vm) ? after.history_vm : {}
    var historyVmMetrics = isMap(historyVmAfter.metrics) ? historyVmAfter.metrics : {}
    var historyVmRehydrations = (historyVmDelta.reads || 0) + (historyVmDelta.context_expansions || 0)
    return {
      elapsed_ms: elapsedMs,
      total_steps: perf.steps_taken,
      llm_calls: llm.total,
      model_calls: { main: llm.normal, low_cost: llm.low_cost, validation: llm.validation },
      advisor_calls: delta.advisor ? delta.advisor.calls : 0,
      delegations: delegation.total,
      replans: delta.planning ? delta.planning.plans_replanned : 0,
      tool_calls: (actions.mcp_actions_executed || 0) + (actions.shell_commands_executed || 0),
      failed_tool_calls: actions.mcp_actions_failed || 0,
      retries: delta.behavior_patterns ? delta.behavior_patterns.retries : 0,
      retrieval_operations: wiki ? (wiki.ops_search || 0) + (wiki.ops_read || 0) + (wiki.ops_list || 0) : 0,
      input_tokens: (perf.llm_normal_input_tokens || 0) + (perf.llm_lc_input_tokens || 0) + (perf.llm_val_input_tokens || 0),
      output_tokens: (perf.llm_normal_output_tokens || 0) + (perf.llm_lc_output_tokens || 0) + (perf.llm_val_output_tokens || 0),
      context_tokens: perf.max_context_tokens,
      context_candidate_tokens: historyVmDelta.context_candidate_tokens || 0,
      context_materialized_tokens: historyVmMetrics.context_materialized_tokens || 0,
      effective_context_ratio: historyVmMetrics.effective_context_ratio || 0,
      history_vm_rehydrations: historyVmRehydrations,
      shadow_actual_tokens: historyVmMetrics.context_virtualization_shadow_actual_tokens || 0,
      shadow_projected_tokens: historyVmMetrics.context_virtualization_shadow_projected_tokens || 0,
      shadow_expected_savings: historyVmMetrics.context_virtualization_shadow_expected_savings || 0,
      active_context_input_tokens: historyVmMetrics.context_virtualization_active_input_tokens || 0,
      active_context_output_tokens: historyVmMetrics.context_virtualization_active_output_tokens || 0,
      active_context_tokens_saved: historyVmDelta.context_virtualization_active_tokens_saved || 0,
      history_vm: {
        active: historyVmAfter.active === true,
        shadow: historyVmAfter.shadow === true,
        context_virtualization: historyVmAfter.contextVirtualization === true,
        context_virtualization_shadow: historyVmAfter.contextVirtualizationShadow === true,
        objects_considered: historyVmDelta.context_objects_considered || 0,
        objects_selected: historyVmDelta.context_objects_selected || 0,
        candidate_tokens: historyVmDelta.context_candidate_tokens || 0,
        materialized_tokens: historyVmMetrics.context_materialized_tokens || 0,
        effective_context_ratio: historyVmMetrics.effective_context_ratio || 0,
        budget_utilization: historyVmMetrics.context_budget_utilization || 0,
        rehydrations: historyVmRehydrations,
        representation_levels: {
          l0: historyVmDelta.representation_l0 || 0,
          l1: historyVmDelta.representation_l1 || 0,
          l2: historyVmDelta.representation_l2 || 0,
          l3: historyVmDelta.representation_l3 || 0,
          l4: historyVmDelta.representation_l4 || 0
        },
        shadow_projection: {
          assemblies: historyVmDelta.context_virtualization_shadow_assemblies || 0,
          actual_tokens: historyVmMetrics.context_virtualization_shadow_actual_tokens || 0,
          projected_tokens: historyVmMetrics.context_virtualization_shadow_projected_tokens || 0,
          expected_savings: historyVmMetrics.context_virtualization_shadow_expected_savings || 0,
          object_differences: historyVmMetrics.context_virtualization_shadow_object_differences || 0
        },
        active_projection: {
          assemblies: historyVmDelta.context_virtualization_active_assemblies || 0,
          input_tokens: historyVmMetrics.context_virtualization_active_input_tokens || 0,
          output_tokens: historyVmMetrics.context_virtualization_active_output_tokens || 0,
          tokens_saved: historyVmDelta.context_virtualization_active_tokens_saved || 0,
          references: historyVmMetrics.context_virtualization_active_references || 0
        }
      },
      estimated_cost_usd: __,
      raw: delta
    }
  }

  MiniAEval.prototype._modelName = function(config) {
    if (isMap(config) && isString(config.model)) return config.model
    if (isString(config)) {
      var match = config.match(/(?:^|[,\s(])model\s*[:=]\s*['\"]?([^,'\")\s]+)/i)
      return isArray(match) && match.length > 1 ? match[1] : __
    }
    return __
  }

  MiniAEval.prototype._expandVariants = function(scenarios) {
    var expanded = []
    ;(scenarios || []).forEach(function(scenario) {
      if (!isMap(scenario) || !isArray(scenario.variants) || scenario.variants.length === 0) {
        expanded.push(scenario)
        return
      }
      scenario.variants.forEach(function(variant, index) {
        if (!isMap(variant)) return
        var item = merge({}, scenario, true)
        delete item.variants
        var variantName = isString(variant.name) && variant.name.trim().length > 0 ? variant.name.trim() : "variant-" + (index + 1)
        item.scenarioName = scenario.name || scenario.goal
        item.variant = variantName
        item.name = item.scenarioName + " [" + variantName + "]"
        item.args = merge(isMap(scenario.args) ? scenario.args : {}, isMap(variant.args) ? variant.args : {}, true)
        ;["expected", "assertions", "limits", "maximum", "regression", "llm_judge", "setup"].forEach(function(key) {
          if (isDef(variant[key])) item[key] = isMap(variant[key]) && isMap(item[key]) ? merge(item[key], variant[key], true) : variant[key]
        })
        expanded.push(item)
      })
    })
    return expanded
  }

  MiniAEval.prototype._assert = function(answer, result, assertion) {
    var actual = isString(assertion.path) ? this._numberAt({ answer: answer, metrics: result.metrics, result: result }, assertion.path) : answer
    var label = assertion.name || assertion.path || "answer"
    if (isDef(assertion.equals)) return { passed: actual === assertion.equals, assertion: label, actual: actual, expected: assertion.equals }
    if (isDef(assertion.contains)) return { passed: String(actual).indexOf(String(assertion.contains)) >= 0, assertion: label, actual: actual, expected: assertion.contains }
    if (isDef(assertion.notContains)) return { passed: String(actual).indexOf(String(assertion.notContains)) < 0, assertion: label, actual: actual, expected: assertion.notContains }
    if (isDef(assertion.matches)) return { passed: new RegExp(assertion.matches).test(String(actual)), assertion: label, actual: actual, expected: assertion.matches }
    if (isDef(assertion.max)) return { passed: isNumber(actual) && actual <= assertion.max, assertion: label, actual: actual, expected: "<= " + assertion.max }
    if (isDef(assertion.min)) return { passed: isNumber(actual) && actual >= assertion.min, assertion: label, actual: actual, expected: ">= " + assertion.min }
    return { passed: false, assertion: label, actual: actual, expected: "recognized assertion" }
  }

  MiniAEval.prototype._buildAssertions = function(scenario) {
    var expected = isMap(scenario.expected) ? scenario.expected : {}
    var assertions = isArray(scenario.assertions) ? scenario.assertions.slice() : []
    ;["equals", "contains", "notContains", "matches"].forEach(function(key) {
      if (isDef(expected[key])) { var a = {}; a[key] = expected[key]; a.path = "answer"; assertions.push(a) }
    })
    if (isMap(expected.metrics)) Object.keys(expected.metrics).forEach(function(path) {
      var spec = expected.metrics[path]
      var a = isMap(spec) ? merge({ path: "metrics." + path }, spec, true) : { path: "metrics." + path, equals: spec }
      assertions.push(a)
    })
    return assertions
  }

  MiniAEval.prototype._runDefaultJudge = function(scenario, result) {
    var judge = isMap(scenario.llm_judge) ? scenario.llm_judge : {}
    var judgeArgs = merge({ useshell: false, usetools: false, useutils: false, useplanning: false }, isMap(judge.args) ? judge.args : {}, true)
    judgeArgs.goal = "Evaluate this Mini-A result against the stated expectation. Return exactly PASS or FAIL, followed by one concise reason.\n\nGoal: " + result.goal + "\nExpected: " + stringify(scenario.expected || {}, __, "") + "\nAnswer: " + String(result.answer)
    try {
      var agent = this.agentFactory({ name: result.name + " judge", goal: judgeArgs.goal, args: judgeArgs })
      if (isFunction(agent.init)) agent.init(judgeArgs)
      var answer = String(agent.start(judgeArgs))
      return { passed: /^\s*PASS\b/i.test(answer), answer: answer }
    } catch(e) {
      return { passed: false, error: String(e) }
    }
  }

  MiniAEval.prototype.runScenario = function(scenario, sharedArgs) {
    if (!isMap(scenario) || !isString(scenario.goal) || scenario.goal.trim().length === 0) throw new Error("Each evaluation scenario requires a non-empty goal")
    var started = this.nowFn()
    var events = [{ version: 1, type: "eval_scenario_start", timestamp_ms: started, scenario: scenario.name || scenario.goal }]
    var agent = this.agentFactory(scenario)
    var before = this._metricSnapshot(agent)
    var answer = __, error = __, fixtureRoot = __
    var runArgs = merge(merge({}, sharedArgs || {}, true), isMap(scenario.args) ? scenario.args : (isMap(scenario.mode) ? scenario.mode : {}), true)
    runArgs.goal = scenario.goal
    if (isMap(scenario.setup)) {
      if (isString(scenario.setup.context)) runArgs.knowledge = isString(runArgs.knowledge) ? runArgs.knowledge + "\n" + scenario.setup.context : scenario.setup.context
      if (isMap(scenario.setup.args)) runArgs = merge(runArgs, scenario.setup.args, true)
      if (isArray(scenario.setup.conversation) || isMap(scenario.setup.conversation)) {
        var fixtureConversation = isArray(scenario.setup.conversation)
          ? { u: new Date(), c: scenario.setup.conversation }
          : merge({}, scenario.setup.conversation, true)
        if (!isArray(fixtureConversation.c)) throw new Error("setup.conversation must be an array or a conversation envelope with a c array")
        if (isMap(scenario.setup.repeatHistory)) {
          var repeat = scenario.setup.repeatHistory
          if (!isArray(repeat.messages) || !isNumber(repeat.count) || repeat.count < 1 || repeat.count > 1000) throw new Error("repeatHistory requires messages and a count from 1 to 1000")
          var expandedHistory = []
          for (var ri = 0; ri < Math.floor(repeat.count); ri++) repeat.messages.forEach(function(message) {
            expandedHistory.push(jsonParse(stringify(message, __, "").replace(/\{\{iteration\}\}/g, String(ri)), __, __, true))
          })
          fixtureConversation.c = expandedHistory.concat(fixtureConversation.c)
        }
        fixtureRoot = String(java.nio.file.Files.createTempDirectory("mini-a-eval-conversation-").toAbsolutePath())
        runArgs.conversation = fixtureRoot + "/conversation.json"
        try {
          io.writeFileJSON(runArgs.conversation, fixtureConversation, "")
        } catch(fixtureError) {
          try { this._removeOwnedTree(fixtureRoot) } catch(ignoreFixtureCleanup) {}
          fixtureRoot = __
          throw fixtureError
        }
      }
    }
    try {
      if (isFunction(agent.init)) agent.init(runArgs)
      if (isMap(scenario.setup) && isArray(scenario.setup.contextObjects) && isObject(agent._historyVm) && agent._historyVm.contextVirtualization) {
        scenario.setup.contextObjects.forEach(function(source) {
          var count = isNumber(source.count) ? Math.max(1, Math.min(1000, Math.floor(source.count))) : 1
          for (var ci = 0; ci < count; ci++) agent._historyVm.upsertContextSource(source.kind, String(source.key || "fixture") + ":" + ci, source.content, source.metadata)
        })
        agent._historyVm.rollupSession()
      }
      answer = agent.start(runArgs)
    } catch(e) { error = String(e) }
    var elapsed = this.nowFn() - started
    var after = this._metricSnapshot(agent)
    if (isString(fixtureRoot)) {
      try { this._removeOwnedTree(fixtureRoot) } catch(cleanupError) { if (isUnDef(error)) error = String(cleanupError) }
    }
    var metrics = this._normalizeMetrics(this._metricDelta(before, after), elapsed, after)
    metrics.model_usage = {
      main: { calls: metrics.model_calls.main, model: this._modelName(agent._oaf_model) },
      low_cost: { calls: metrics.model_calls.low_cost, model: this._modelName(agent._oaf_lc_model) },
      validation: { calls: metrics.model_calls.validation, model: this._modelName(agent._oaf_val_model) }
    }
    var result = { version: 1, name: scenario.name || scenario.goal, scenario: scenario.scenarioName || scenario.name || scenario.goal, variant: scenario.variant, goal: scenario.goal, answer: answer, error: error, metrics: metrics, assertions: [], events: events, regression: isMap(scenario.regression) ? scenario.regression : {} }
    this._buildAssertions(scenario).forEach(function(assertion) { result.assertions.push(this._assert(answer, result, assertion)) }, this)
    var limits = isMap(scenario.limits) ? scenario.limits : (isMap(scenario.maximum) ? scenario.maximum : {})
    var limitPaths = { cost: "metrics.estimated_cost_usd", tokens: "metrics.input_tokens", steps: "metrics.total_steps", time: "metrics.elapsed_ms" }
    Object.keys(limitPaths).forEach(function(key) { if (isNumber(limits[key])) result.assertions.push(this._assert(answer, result, { path: limitPaths[key], max: limits[key], name: "maximum " + key })) }, this)
    if (scenario.llm_judge === true || isMap(scenario.llm_judge)) {
      if (isFunction(this.judgeFn)) result.judge = this.judgeFn(scenario, result)
      else if (isMap(scenario.llm_judge) && scenario.llm_judge.enabled === true) result.judge = this._runDefaultJudge(scenario, result)
      else result.judge = { skipped: true, reason: "No LLM judge configured" }
      if (isMap(result.judge) && result.judge.passed === false) result.assertions.push({ passed: false, assertion: "llm_judge", actual: result.judge, expected: "pass" })
    }
    result.success = isUnDef(error) && result.assertions.every(function(assertion) { return assertion.passed })
    events.push({ version: 1, type: "eval_scenario_end", timestamp_ms: this.nowFn(), status: result.success ? "passed" : "failed", metrics: metrics })
    return result
  }

  MiniAEval.prototype.compare = function(current, baseline) {
    var byName = {}
    ;(baseline.scenarios || []).forEach(function(item) { byName[item.name] = item })
    var regressions = [], comparisons = []
    ;(current.scenarios || []).forEach(function(item) {
      var base = byName[item.name]
      if (!base) return
      var comparison = { name: item.name, success_changed: item.success !== base.success, metrics: {} }
      ;["elapsed_ms", "total_steps", "llm_calls", "tool_calls", "failed_tool_calls", "input_tokens", "output_tokens", "context_candidate_tokens", "context_materialized_tokens", "effective_context_ratio", "history_vm_rehydrations", "shadow_actual_tokens", "shadow_projected_tokens", "shadow_expected_savings", "active_context_input_tokens", "active_context_output_tokens", "active_context_tokens_saved"].forEach(function(key) {
        comparison.metrics[key] = (item.metrics[key] || 0) - (base.metrics[key] || 0)
      })
      if (base.success && !item.success) regressions.push({ name: item.name, reason: "success regressed" })
      if ((comparison.metrics.failed_tool_calls || 0) > 0) regressions.push({ name: item.name, reason: "tool failures increased" })
      if (isMap(item.regression)) Object.keys(item.regression).forEach(function(key) {
        if (isNumber(item.regression[key]) && isNumber(comparison.metrics[key]) && comparison.metrics[key] > item.regression[key]) regressions.push({ name: item.name, reason: key + " increased by " + comparison.metrics[key] })
      })
      comparisons.push(comparison)
    })
    return { regressions: regressions, comparisons: comparisons }
  }

  MiniAEval.prototype.run = function(scenarios, options) {
    options = isMap(options) ? options : {}
    var report = { version: 1, type: "mini-a-evaluation", started_at: new Date().toISOString(), scenarios: [], summary: {} }
    this._expandVariants(scenarios).forEach(function(scenario) { report.scenarios.push(this.runScenario(scenario, options.args || {})) }, this)
    return this._finishReport(report)
  }

  MiniAEval.prototype._variantComparisons = function(report) {
    var groups = {}
    ;(report.scenarios || []).forEach(function(item) {
      if (!isString(item.variant)) return
      var key = item.scenario || item.goal
      if (!isArray(groups[key])) groups[key] = []
      groups[key].push(item)
    })
    var metricKeys = ["elapsed_ms", "total_steps", "llm_calls", "tool_calls", "failed_tool_calls", "input_tokens", "output_tokens", "context_materialized_tokens", "effective_context_ratio", "history_vm_rehydrations", "shadow_projected_tokens", "active_context_output_tokens", "active_context_tokens_saved"]
    var comparisons = []
    Object.keys(groups).sort().forEach(function(key) {
      var items = groups[key]
      if (items.length < 2) return
      var baseline = items.filter(function(item) { return item.variant === "phase1" || item.variant === "baseline" })[0] || items[0]
      items.forEach(function(item) {
        if (item === baseline) return
        var deltas = {}
        metricKeys.forEach(function(metric) { deltas[metric] = (item.metrics[metric] || 0) - (baseline.metrics[metric] || 0) })
        comparisons.push({ scenario: key, baseline: baseline.variant, variant: item.variant, success_changed: item.success !== baseline.success, metrics: deltas })
      })
    })
    return comparisons
  }

  MiniAEval.prototype._finishReport = function(report) {
    report.summary = {
      total: report.scenarios.length,
      passed: report.scenarios.filter(function(item) { return item.success }).length,
      failed: report.scenarios.filter(function(item) { return !item.success }).length,
      elapsed_ms: report.scenarios.reduce(function(total, item) { return total + (item.metrics.elapsed_ms || 0) }, 0),
      llm_calls: report.scenarios.reduce(function(total, item) { return total + (item.metrics.llm_calls || 0) }, 0),
      tool_failures: report.scenarios.reduce(function(total, item) { return total + (item.metrics.failed_tool_calls || 0) }, 0)
    }
    report.variant_comparisons = this._variantComparisons(report)
    report.finished_at = new Date().toISOString()
    return report
  }

  // Use inside an existing oJob Test / ow.test.test callback without registering
  // a nested test. Keep assertion evaluation in runScenario as the single source.
  MiniAEval.prototype.assertResult = function(result) {
    ow.loadTest()
    var failures = (result.assertions || []).filter(function(item) { return !item.passed }).map(function(item) {
      return item.assertion + ": expected " + stringify(item.expected, __, "") + ", actual " + stringify(item.actual, __, "")
    })
    if (isDef(result.error)) failures.unshift(result.error)
    ow.test.assert(result.success, true, result.name + ": " + failures.join("; "), true)
    return result
  }

  // Register one OpenAF test per scenario, preserving other tests and letting
  // OpenAF own counters, profiling, failure history and report generation.
  MiniAEval.prototype.runTests = function(scenarios, options) {
    options = isMap(options) ? options : {}
    if (!isArray(scenarios) || scenarios.length === 0) throw new Error("Evaluation tests require a non-empty scenario array")
    ow.loadTest()
    var self = this
    var suite = isString(options.suite) ? options.suite : "Mini-A evaluations"
    var report = { version: 1, type: "mini-a-evaluation", started_at: new Date().toISOString(), scenarios: [], summary: {} }
    this._expandVariants(scenarios).forEach(function(scenario, index) {
      var name = isMap(scenario) ? (scenario.name || scenario.goal) : __
      name = isString(name) ? name : "Scenario " + (index + 1)
      ow.test.test(suite + "::" + name, function() {
        var result
        try {
          result = self.runScenario(scenario, options.args || {})
        } catch(e) {
          // Definition/factory/assertion errors must fail a test and still allow
          // the remaining scenarios to run and a complete report to be written.
          result = { version: 1, name: name, goal: isMap(scenario) ? scenario.goal : __, success: false, error: String(e), metrics: {}, assertions: [], events: [] }
        }
        report.scenarios.push(result)
        self.assertResult(result)
      })
    })
    self._finishReport(report)
    if (isDef(options.baseline)) {
      report.comparison = self.compare(report, options.baseline)
      ow.test.test(suite + "::Baseline comparison", function() {
        ow.test.assert(report.comparison.regressions.length, 0, "Evaluation regressions: " + stringify(report.comparison.regressions, __, ""), true)
      })
    }
    return report
  }

  MiniAEval.prototype.format = function(report) {
    var lines = ["Mini-A evaluation: " + report.summary.passed + "/" + report.summary.total + " passed"]
    report.scenarios.forEach(function(item) { lines.push((item.success ? "PASS" : "FAIL") + "  " + item.name + " (" + item.metrics.elapsed_ms + "ms, " + item.metrics.llm_calls + " LLM calls)") })
    if (isMap(report.comparison) && report.comparison.regressions.length > 0) lines.push("Regressions: " + report.comparison.regressions.map(function(item) { return item.name + " (" + item.reason + ")" }).join(", "))
    return lines.join("\n")
  }

  global.MiniAEval = MiniAEval
})()
