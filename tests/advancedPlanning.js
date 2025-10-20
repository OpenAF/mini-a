(function() {
  load("mini-a.js")

  var assert = function(condition, message, value) {
    if (!condition) {
      var extra = isDef(value) ? " => " + stringify(value, __, "") : ""
      throw new Error(message + extra)
    }
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
    assert(["trivial", "easy"].indexOf(simple.level) >= 0, "Simple goal should be trivial or easy", simple.level)
    var complexGoal = "Design, implement, and validate a data pipeline with error handling and documentation"
    var complex = agent._assessGoalComplexity(complexGoal)
    assert(["complex", "very_complex"].indexOf(complex.level) >= 0, "Complex goal should be flagged", complex.level)
  }

  exports.testSimplePlanGeneration = function() {
    var agent = createAgent()
    var goal = "Summarize repository README"
    agent._planningAssessment = agent._assessGoalComplexity(goal)
    var plan = agent._generateInitialPlan(goal, "simple", { useshell: false })
    assert(plan.strategy === "simple", "Should build simple strategy plan", plan.strategy)
    assert(isArray(plan.steps) && plan.steps.length >= 3, "Simple plan should have steps", plan.steps)
    var hasChildren = plan.steps.some(s => isArray(s.children) && s.children.length > 0)
    assert(hasChildren === false, "Simple plan should not have nested children", plan.steps)
  }

  exports.testTreePlanGeneration = function() {
    var agent = createAgent()
    var goal = "Implement feature toggle and write integration tests, then document rollout procedure"
    agent._planningAssessment = agent._assessGoalComplexity(goal)
    var plan = agent._generateInitialPlan(goal, "tree", { useshell: false })
    assert(plan.strategy === "tree", "Should build decomposed plan", plan.strategy)
    assert(isArray(plan.steps) && plan.steps.length > 0, "Tree plan should have steps", plan.steps)
    var first = plan.steps[0]
    assert(isArray(first.children) && first.children.length >= 2, "Tree plan should include sub-steps", first)
  }

  exports.testPlanValidation = function() {
    var agent = createAgent()
    var goal = "Run a shell command to gather logs"
    agent._planningAssessment = agent._assessGoalComplexity(goal)
    var plan = agent._buildDecomposedPlan(goal, {})
    var result = agent._validatePlanStructure(plan, { useshell: false })
    assert(result.valid === false, "Validation should detect missing shell access", result)
    var blocked = false
    plan.steps.forEach(function(step) {
      if (step.status === "blocked") blocked = true
      if (isArray(step.children)) {
        step.children.forEach(function(child) {
          if (child.status === "blocked") blocked = true
        })
      }
    })
    assert(blocked === true, "Validation should block unavailable steps", plan)
  }

  exports.testDynamicReplanning = function() {
    var agent = createAgent()
    var goal = "Draft meeting notes"
    agent._planningAssessment = agent._assessGoalComplexity(goal)
    agent._agentState = { plan: agent._buildSimplePlan(goal, {}) }
    agent._handlePlanningObstacle({ category: "permanent", message: "test obstacle" })
    assert(agent._agentState.plan.meta.needsReplan === true, "Obstacle should mark plan for replanning", agent._agentState.plan.meta)
    var blocked = agent._agentState.plan.steps.some(function(step) {
      if (step.status === "blocked") return true
      if (isArray(step.children)) return step.children.some(function(child) { return child.status === "blocked" })
      return false
    })
    assert(blocked === true, "A step should be blocked after obstacle handling", agent._agentState.plan)
  }
})()
