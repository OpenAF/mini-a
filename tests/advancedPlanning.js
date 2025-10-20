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
    ow.test.assert(["trivial", "easy"].indexOf(simple.level) >= 0, true, "Simple goal should be trivial or easy")
    var complexGoal = "Design, implement, and validate a data pipeline with error handling and documentation"
    var complex = agent._assessGoalComplexity(complexGoal)
    ow.test.assert(["complex", "very_complex"].indexOf(complex.level) >= 0, true, "Complex goal should be flagged")
  }

  exports.testSimplePlanGeneration = function() {
    var agent = createAgent()
    var goal = "Summarize repository README"
    agent._planningAssessment = agent._assessGoalComplexity(goal)
    var plan = agent._generateInitialPlan(goal, "simple", { useshell: false })
    ow.test.assert(plan.strategy === "simple", true, "Should build simple strategy plan")
    ow.test.assert(isArray(plan.steps) && plan.steps.length >= 3, true, "Simple plan should have steps")
    var hasChildren = plan.steps.some(s => isArray(s.children) && s.children.length > 0)
    ow.test.assert(hasChildren === false, true, "Simple plan should not have nested children")
  }

  exports.testTreePlanGeneration = function() {
    var agent = createAgent()
    var goal = "Implement feature toggle and write integration tests, then document rollout procedure"
    agent._planningAssessment = agent._assessGoalComplexity(goal)
    var plan = agent._generateInitialPlan(goal, "tree", { useshell: false })
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
