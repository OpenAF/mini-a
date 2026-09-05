(function() {
  load("mini-a.js")

  // Use OpenAF's ow.test.assert instead of custom assert
  var assert = function(aResult, errorMessage, checkValue) {
    ow.test.assert(checkValue, errorMessage, aResult)
  }

  var createAgent = function() {
    var agent = new MiniA()
    agent._enablePlanning = true
    agent.mcpToolNames = []
    return agent
  }

  exports.testGoalAssessment = function() {
    var agent = createAgent()
    var simple = agent._assessGoalComplexity("List two colors")
    ow.test.assert(simple.level === "simple", true, "Simple goal should be simple")
    ow.test.assert(isNumber(simple.score), true, "Simple goal should have a numeric score")
    ow.test.assert(isArray(simple.signals), true, "Simple goal should have a signals array")
    var complexGoal = "Design, implement, and validate a data pipeline with error handling and documentation"
    var complex = agent._assessGoalComplexity(complexGoal)
    ow.test.assert(["medium", "complex"].indexOf(complex.level) >= 0, true, "Complex goal should be flagged")
    ow.test.assert(isNumber(complex.score) && complex.score > 0, true, "Complex goal should have a positive score")
    ow.test.assert(isArray(complex.signals) && complex.signals.length > 0, true, "Complex goal should have signals")
  }

  exports.testGoalAssessmentDomainSignals = function() {
    var agent = createAgent()
    var result = agent._assessGoalComplexity("Refactor and optimize the authentication module")
    ow.test.assert(["medium", "complex"].indexOf(result.level) >= 0, true, "Domain-keyword goal should be flagged")
    ow.test.assert(result.signals.some(function(s) { return s.startsWith("domain:") }), true, "Should detect domain keywords")
  }

  exports.testGoalAssessmentNegationSignals = function() {
    var agent = createAgent()
    var result = agent._assessGoalComplexity("List files without including hidden directories")
    ow.test.assert(result.signals.indexOf("negation-modifier") >= 0, true, "Should detect negation modifier")
  }

  exports.testGoalAssessmentEntityCount = function() {
    var agent = createAgent()
    var result = agent._assessGoalComplexity("Process all 50 files and generate reports")
    ow.test.assert(result.signals.indexOf("entity-count") >= 0, true, "Should detect entity count signal")
  }

  exports.testAutoOrchestrationSelectsExistingControls = function() {
    var agent = createAgent()
    var traces = []
    agent.setTraceFn(function(kind, payload) { traces.push({ kind: kind, payload: payload }) })
    var args = { goal: "Refactor and validate the security pipeline across 20 services", orchestration: "auto", useplanning: false, modelstrategy: "default", evidencegate: false, chatbotmode: false, lcbudget: 0 }
    agent._applyOrchestration(args, { goal: args.goal, orchestration: "auto", __explicitargkeys: ["goal", "orchestration"] })
    ow.test.assert(args.useplanning, true, "Auto orchestration should enable existing planning for complex work")
    ow.test.assert(args.evidencegate, true, "Auto orchestration should enable the existing evidence gate for risk signals")
    ow.test.assert(agent._orchestrationDecisions.length >= 6, true, "Automatic routing should retain structured decision records")
    ow.test.assert(traces.filter(function(record) { return record.kind === "orchestration_decision" }).length >= 6, true, "Automatic decisions should be emitted to the existing trace sink")
  }

  exports.testAutoOrchestrationRespectsExplicitOverrides = function() {
    var agent = createAgent()
    var args = { goal: "Refactor and validate the security pipeline", orchestration: "auto", useplanning: false, modelstrategy: "default", evidencegate: false, chatbotmode: false }
    agent._applyOrchestration(args, { goal: args.goal, orchestration: "auto", useplanning: false, modelstrategy: "default", evidencegate: false, __explicitargkeys: ["goal", "orchestration", "useplanning", "modelstrategy", "evidencegate"] })
    ow.test.assert(args.useplanning, false, "Explicit useplanning=false must override automatic orchestration")
    ow.test.assert(args.modelstrategy, "default", "Explicit model strategy must remain unchanged")
    ow.test.assert(args.evidencegate, false, "Explicit evidencegate=false must remain unchanged")
  }

  exports.testAutoOrchestrationRespectsModeOverrides = function() {
    var agent = createAgent()
    var args = { goal: "Refactor and validate the security pipeline", orchestration: "auto", useplanning: false, modelstrategy: "default", evidencegate: false, chatbotmode: false }
    agent._applyOrchestration(args, { goal: args.goal, orchestration: "auto", useplanning: false, modelstrategy: "default", evidencegate: false, __explicitargkeys: { goal: true, orchestration: true }, __modeargkeys: { useplanning: true, modelstrategy: true, evidencegate: true } })
    ow.test.assert(args.useplanning, false, "A mode-provided useplanning=false must override automatic orchestration")
    ow.test.assert(args.modelstrategy, "default", "A mode-provided model strategy must remain unchanged")
    ow.test.assert(args.evidencegate, false, "A mode-provided evidence-gate setting must remain unchanged")
  }

  exports.testPlanningWithoutExternalPlanIsNotInvalid = function() {
    var agent = createAgent()
    var messages = []
    agent.fnI = function(type, message) { messages.push({ type: type, message: message }) }

    var loaded = agent._preparePreloadedPlan(__, { useplanning: true })

    ow.test.assert(loaded, false, "No external plan should not be reported as loaded")
    ow.test.assert(messages.length, 1, "Auto-planning without an external plan should emit one status message")
    ow.test.assert(messages[0].type, "plan", "Auto-planning without an external plan must not be a warning")
    ow.test.assert(messages[0].message.indexOf("invalid") < 0, true, "Auto-planning without an external plan must not describe a plan as invalid")

    messages = []
    agent._preparePreloadedPlan(__, { useplanning: true, planfile: "missing-plan.md" })
    ow.test.assert(messages.length, 0, "A requested plan should rely on the loader's specific error instead of a generic invalid-plan message")
  }

  exports.testSimplePlanGeneration = function() {
    var agent = createAgent()
    var goal = "Summarize repository README"
    agent._planningAssessment = agent._assessGoalComplexity(goal)
    var plan = agent._generateInitialPlan(goal, "simple", { useshell: false })
    ow.test.assert(plan.version === 3, true, "Default plan style should build version 3 plans")
    ow.test.assert(plan.meta.style === "simple", true, "Default plan style should mark simple metadata")
    ow.test.assert(isArray(plan.steps) && plan.steps.length >= 1, true, "Simple plan should have at least one step")
    ow.test.assert(plan.steps[0].task === goal, true, "Single-part goals should remain a single task")
    var hasChildren = plan.steps.some(s => isArray(s.children) && s.children.length > 0)
    ow.test.assert(hasChildren === false, true, "Simple plan should not have nested children")
  }

  exports.testTreePlanGeneration = function() {
    var agent = createAgent()
    var goal = "Implement feature toggle and write integration tests, then document rollout procedure"
    agent._planningAssessment = agent._assessGoalComplexity(goal)
    var plan = agent._generateInitialPlan(goal, "tree", { useshell: false, planstyle: "legacy" })
    ow.test.assert(plan.strategy === "tree", true, "Should build decomposed plan")
    ow.test.assert(isArray(plan.steps) && plan.steps.length > 0, true, "Tree plan should have steps")
    var first = plan.steps[0]
    ow.test.assert(isArray(first.children) && first.children.length >= 2, true, "Tree plan should include sub-steps")
  }

  exports.testPlanValidation = function() {
    var agent = createAgent()
    var goal = "Run a shell command to gather logs"
    agent._planningAssessment = agent._assessGoalComplexity(goal)
    var plan = agent._buildDecomposedPlan(goal, {})
    var result = agent._validatePlanStructure(plan, { useshell: false })
    ow.test.assert(result.valid === false, true, "Validation should detect missing shell access")
    var blocked = false
    plan.steps.forEach(function(step) {
      if (step.status === "blocked") blocked = true
      if (isArray(step.children)) {
        step.children.forEach(function(child) {
          if (child.status === "blocked") blocked = true
        })
      }
    })
    ow.test.assert(blocked === true, true, "Validation should block unavailable steps")
  }

  exports.testPlanValidationAliasesBashRequirementToShell = function() {
    var agent = createAgent()
    var plan = {
      version: 2,
      steps: [
        {
          id: "1",
          title: "Collect diagnostics",
          status: "pending",
          requires: ["bash"]
        }
      ]
    }

    var result = agent._validatePlanStructure(plan, { useshell: true })
    ow.test.assert(result.valid === true, true, "bash requirement should be satisfied by shell access when no bash tool exists")
    ow.test.assert(plan.steps[0].status !== "blocked", true, "Aliased shell requirement should not block the plan")
  }

  exports.testDynamicReplanning = function() {
    var agent = createAgent()
    var goal = "Draft meeting notes"
    agent._planningAssessment = agent._assessGoalComplexity(goal)
    agent._agentState = { plan: agent._buildSimplePlan(goal, {}) }
    agent._handlePlanningObstacle({ category: "permanent", message: "test obstacle" })
    ow.test.assert(agent._agentState.plan.meta.needsReplan === true, true, "Obstacle should mark plan for replanning")
    var blocked = agent._agentState.plan.steps.some(function(step) {
      if (step.status === "blocked") return true
      if (isArray(step.children)) return step.children.some(function(child) { return child.status === "blocked" })
      return false
    })
    ow.test.assert(blocked === true, true, "A step should be blocked after obstacle handling")
  }
})()
