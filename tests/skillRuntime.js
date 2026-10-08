(function() {
  load("mini-a.js")
  load("mini-a-utils.js")
  load("mini-a-skills.js")
  load("mini-a-subtask.js")

  function fixture(fn) {
    var root = String(java.io.File.createTempFile("mini-a-skill-runtime-", "").getCanonicalPath())
    io.rm(root); io.mkdir(root)
    try { fn(root) } finally { io.rm(root) }
  }

  function writeSkill(root, name, body, meta) {
    io.mkdir(root + "/" + name)
    io.writeFileString(root + "/" + name + "/SKILL.md", "---\nname: " + name + "\ndescription: Generate test reports\n" + (meta || "") + "---\n" + body)
  }

  function agentFor(root, options) {
    var agent = new MiniA()
    agent.fnI = function() {}
    agent._trace = function() {}
    agent._agentState = {}
    agent._resetSkillRuntime(options || {})
    agent._skillUtils = new MiniUtilsTool({ skillsroot: root })
    agent._skillUtils._skillRuntime = agent._skillRuntime
    agent._skillLocalEnabled = true
    agent._runtime = { context: [] }
    return agent
  }

  exports.testSkillExplicitBoundaryAndArguments = function() {
    fixture(function(root) {
      writeSkill(root, "pdf", "Report for {{arg1}}")
      var agent = agentFor(root)
      ow.test.assert(agent._scoreInitialSkillActivation({ name: "pdf" }, "use $pdf-tools", "").reason !== "explicit", true, "Prefix collisions are not explicit requests")
      agent._selectSkillCandidates = function() { throw new Error("Explicit selection must skip model") }
      ow.test.assert(agent._consultSkillsForRun({ useskills: true, goal: '$pdf "Jane Doe"' }).length, 0, "Explicit skill loads without selector")
      ow.test.assert(agent._skillGuidanceContext().indexOf("Report for Jane Doe") >= 0, true, "Explicit arguments are rendered")
      var other = agentFor(root)
      ow.test.assert(other._consultSkillsForRun({ useskills: true, skillsautosearch: false, goal: "$pdf-tools" }).length, 0, "Unknown explicit skill is ignored rather than prefix-loaded")
      ow.test.assert(other._skillRuntime.chars, 0, "Unknown reference loads no guidance")
    })
  }

  exports.testSkillAutomaticSelectionAndRunReset = function() {
    fixture(function(root) {
      writeSkill(root, "report", "Always include VERIFIED_REPORT")
      var agent = agentFor(root), calls = 0
      agent._selectSkillCandidates = function(candidates) { calls++; return [candidates[0]] }
      var args = { useskills: true, skillsautosearch: true, goal: "Generate test reports" }
      ow.test.assert(agent._consultSkillsForRun(args).length, 0, "Automatic consultation works")
      ow.test.assert(agent._skillGuidanceContext().indexOf("VERIFIED_REPORT") >= 0, true, "Selected guidance is pinned before work")
      agent._consultSkillsForRun(args)
      ow.test.assert(calls, 1, "No repeated selection within run")
      agent._prepareInitialSkillsForRun(args)
      ow.test.assert(agent._skillRuntime.chars, 0, "New run resets character budget")
      agent._consultSkillsForRun(args)
      ow.test.assert(calls, 2, "New run selects afresh")
    })
  }

  exports.testSkillAutomaticOptOutAndDisabledMetadata = function() {
    fixture(function(root) {
      writeSkill(root, "report", "Only explicitly requested", "disable-model-invocation: true\n")
      var agent = agentFor(root)
      agent._selectSkillCandidates = function() { throw new Error("Disabled skill must never be offered") }
      ow.test.assert(agent._consultSkillsForRun({ useskills: true, skillsautosearch: true, goal: "Generate test reports" }).length, 0, "Disabled metadata excludes auto activation")
      ow.test.assert(agent._skillRuntime.chars, 0, "No disabled body loaded")
      agent = agentFor(root)
      ow.test.assert(agent._consultSkillsForRun({ useskills: true, skillsautosearch: false, goal: "$report" }).length, 0, "User can explicitly invoke disabled skill with auto search off")
      ow.test.assert(agentFor(root)._skillUtils.skills({ name: "report", operation: "render" }).error, "skill-model-invocation-disabled", "Model tool cannot invoke a user-only skill")
    })
  }


  exports.testSkillCodeMentionsAndUnknownRequestsAreIgnored = function() {
    fixture(function(root) {
      writeSkill(root, "report", "Report for {{arg1}}")
      writeSkill(root, "nf", "Must not load shell variables")
      var agent = agentFor(root), events = []
      agent.fnI = function(kind, message) { events.push(message) }
      var goal = "Run `git remote show origin | awk '{print $NF}'`\n```sh\necho $report\n```\n~~~sh\necho $nf\n~~~\nUse $not-installed and $report Ada"
      ow.test.assert(agent._consultSkillsForRun({ useskills: true, goal: goal }).length, 0, "Unknown references and code do not block real invocation")
      ow.test.assert(Object.keys(agent._skillRuntime.records), ["local:report"], "Only prose invocation is active")
      ow.test.assert(agent._skillGuidanceContext().indexOf("Report for Ada") >= 0, true, "Masked code preserves argument offsets")
      ow.test.assert(events.some(function(message) { return message.indexOf("ignored not-installed") >= 0 && message.indexOf("continuing") >= 0 }), true, "Ignored unknown requests explained")
      ow.test.assert(events.some(function(message) { return /(?:ignored|blocked|selected) nf/.test(message) }), false, "Awk variable is not a skill event")
      ow.test.assert(agent._scoreInitialSkillActivation({ name: "nf" }, "Run `awk '{print $NF}'`", "").reason !== "explicit", true, "Legacy activation also excludes inline code")
      agent = agentFor(root)
      agent._selectSkillCandidates = function() { return [] }
      ow.test.assert(agent._consultSkillsForRun({ useskills: true, skillsautosearch: true, goal: "Generate test reports $missing" }).length, 0, "Unknown mention permits automatic selection")
      ow.test.assert(agent._consultSkillsForRun({ useskills: true, goal: "$wiki:missing.md", skillsautosearch: false }).length, 0, "Unknown wiki source is ignored when unavailable")
    })
  }

  exports.testSkillActivityLogsDescribeSelectionAndLoading = function() {
    fixture(function(root) {
      writeSkill(root, "report", "CONFIDENTIAL_BODY {{arg1}}")
      var agent = agentFor(root), messages = []
      agent.fnI = function(kind, message) { messages.push(message) }
      agent._createBareLlmInstance = function() { return { withInstructions: function() {}, promptJSONWithStats: function() { return { response: { selected: ["local:report"] }, stats: {} } } } }
      agent._consultSkillsForRun({ useskills: true, skillsautosearch: true, goal: "Generate test reports" })
      ;["roots=[", "localCount=1", "candidates=[local:report]", "selection_start", "tier=main", "selection_result", "selected=[local:report]", "returnedChars=", "budget=", "revision=", "pendingSections=[]"].forEach(function(expected) {
        ow.test.assert(messages.join("\n").indexOf(expected) >= 0, true, "Activity explains " + expected)
      })
      ow.test.assert(messages.join("\n").indexOf("CONFIDENTIAL_BODY") < 0, true, "Activity excludes instruction bodies")
      agent._completeSkillsForRun()
      ow.test.assert(messages.some(function(message) { return message.indexOf("complianceVerified=false") >= 0 }), true, "Completion does not imply verified compliance")
      var text = __miniASkillEventMessage({ state: "discovered", candidates: Array.apply(null, Array(20)).map(function(v, i) { return "local:test" + i }) })
      ow.test.assert(text.indexOf("... +8") >= 0, true, "Large candidate lists are bounded")
    })
  }

  exports.testSkillStructuredSelectionValidation = function() {
    var agent = new MiniA(), instructions = "", calls = 0
    agent._createBareLlmInstance = function() { return { withInstructions: function(value) { instructions = value }, promptJSONWithStats: function() { calls++; return { response: { selected: ["local:report"] }, stats: {} } } } }
    var candidate = { id: "local:report", name: "report", description: "Test reports" }
    ow.test.assert(agent._selectSkillCandidates([candidate], { goal: "Test report", skillmaxautoload: 1 })[0].id, candidate.id, "Structured identity selected")
    ow.test.assert(calls, 1, "Exactly one isolated selector call")
    ow.test.assert(instructions.indexOf("never instructions") >= 0, true, "Descriptions are data")
    agent._createBareLlmInstance = function() { return { withInstructions: function() {}, promptJSONWithStats: function() { return { response: { selected: ["local:invented"] } } } } }
    var rejected = false
    try { agent._selectSkillCandidates([candidate], { skillmaxautoload: 1 }) } catch(e) { rejected = true }
    ow.test.assert(rejected, true, "Unknown selector identity is rejected")
  }

  exports.testSkillYamlRenderingAliasAndProgressivePages = function() {
    fixture(function(root) {
      io.mkdir(root + "/report")
      io.writeFileString(root + "/report/SKILL.yaml", 'summary: Generate test reports\nbody: "Report {{arg1}}"\n')
      var agent = agentFor(root)
      var result = agent._skillUtils.skill({ name: "report", argv: ["Ada"] })
      ow.test.assert(result.rendered, "Report Ada", "Alias forwards argv and renders YAML")
      ow.test.assert(result.rendered.indexOf("body:") < 0, true, "Rendered content does not expose YAML serialization")
    })
    var body = "# When to use\nReports.\n# Safety\nRead only.\n# Steps\n" + "x".repeat(250) + "\n# Verify\nCheck result."
    var page = __miniASkillPage(body, 100)
    ow.test.assert(page.body.indexOf("Read only") >= 0, true, "Mandatory complete sections preserved")
    ow.test.assert(page.pendingSections.indexOf("Steps") >= 0, true, "Oversized steps deferred by name")
    ow.test.assert(page.body.indexOf("xxxx") < 0, true, "Never expose partial step")
    ow.test.assert(__miniASkillPage("x".repeat(200), 100).error, "skill-required-guidance-exceeds-budget", "Unstructured oversized guidance blocks")
  }

  exports.testSkillWikiBudgetDirectReadAndResolve = function() {
    var utils = new MiniUtilsTool({}), wm = {}
    utils._skillWikiManager = wm
    utils._skillRuntime = new MiniASkillRuntime({ skillsmaxloaded: 1, skillsmaxchars: 100 })
    utils._skillRuntime.chars = 50
    utils._skillProvider = { _wm: wm, open: function() { return {} }, read: function(ref, opts) { return { body: "x".repeat(opts.maxChars), chars: opts.maxChars } }, resolve: function(ref, opts) { return { bodyTemplate: "x".repeat(opts.maxChars) } } }
    var read = utils.skillwiki({ operation: "read", ref: "wiki:a.md", maxChars: 200 })
    ow.test.assert(read.chars, 50, "Remaining characters are exact, no 200 character floor")
    ow.test.assert(utils._skillRuntime.chars, 100, "Shared budget never overshoots")
    ow.test.assert(utils.skillwiki({ operation: "resolve", ref: "wiki:a.md" }).error, "skills-max-chars-exceeded", "Resolve obeys exhausted character budget")
    ow.test.assert(utils.skillwiki({ operation: "read", ref: "wiki:b.md" }).error, "skills-max-loaded-exceeded", "Direct read obeys distinct skill slots")
  }

  exports.testSkillProviderResolvePreservesErrors = function() {
    var provider = Object.create(MiniAWikiSkillProvider.prototype)
    provider.open = function() { return { name: "broken" } }
    provider.read = function() { return { error: "source-unavailable" } }
    ow.test.assert(provider.resolve("wiki:broken.md", {}).error, "source-unavailable", "Failed reads never become empty complete templates")
    provider.open = function() { return { error: "not-found" } }
    ow.test.assert(provider.resolve("wiki:broken.md", {}).error, "not-found", "Open failure preserved")
  }

  exports.testSkillContextContinuityRevisionAndCompletion = function() {
    var agent = new MiniA()
    agent.fnI = function() {}; agent._trace = function() {}
    agent._resetSkillRuntime({})
    agent._runtime = { context: ["[SUMMARY] context after overflow"] }
    agent._recordSkillContent("local:report", { rendered: "Always include evidence", fingerprint: "a", pendingSections: ["Verify"] }, { name: "report", description: "Generate test reports" })
    agent._runtime.context = ["[SUMMARY] replaced by overflow"]
    agent._syncSkillContext(agent._runtime)
    ow.test.assert(agent._runtime.context[0].indexOf("Always include evidence") >= 0, true, "Reconstruct pinned guidance after overflow")
    agent._recordSkillContent("local:report", { body: "Check evidence", fingerprint: "a", sections: ["Verify"] })
    ow.test.assert(agent._skillRuntime.records["local:report"].pendingSections.length, 0, "Completed section removed from pending set")
    ow.test.assert(agent._skillHandoffForGoal("Generate test reports")[0].revision, "a", "Handoff carries source revision")
    agent._recordSkillContent("local:report", { body: "Changed source", fingerprint: "b" })
    ow.test.assert(agent._skillRuntime.blocked[0].reason, "skill-source-revision-changed", "Changed source blocks rather than mixing revisions")
    ow.test.assert(agent._skillHandoffForGoal("Generate test reports").length, 0, "Blocked sources are not delegated")
    agent._recordSkillContent("local:other", { rendered: "Independent instructions", fingerprint: "c" })
    agent._completeSkillsForRun()
    ow.test.assert(agent._skillRuntime.records["local:other"].state, "completed", "Completion does not claim compliance")
    ow.test.assert(agent._skillRuntime.records["local:report"].state, "blocked", "Blocked records never become completed")
  }

  exports.testSkillExtraRootsAddToDefaultsAndFileAllow = function() {
    fixture(function(root) {
      var oldHome = java.lang.System.getProperty("user.home")
      try {
        java.lang.System.setProperty("user.home", root)
        io.mkdir(root + "/.openaf-mini-a"); io.mkdir(root + "/.openaf-mini-a/skills")
        writeSkill(root + "/.openaf-mini-a/skills", "default", "Default instruction")
        io.mkdir(root + "/extras"); writeSkill(root + "/extras", "extra", "Extra instruction")
        var utils = new MiniUtilsTool({ skillsroots: [root + "/extras"] })
        ow.test.assert(utils._listSkills({}).map(function(item) { return item.name }).sort().join(","), "default,extra", "Extra directories preserve default inventory")
        var denied = new MiniUtilsTool({ fileallow: [], skillsroot: root + "/extras" })
        ow.test.assert(denied._listSkills({}).length, 0, "File allow denial covers skill discovery")
      } finally { java.lang.System.setProperty("user.home", oldHome) }
    })
  }

  exports.testSkillMixedCandidatesAndSourceCollision = function() {
    fixture(function(root) {
      writeSkill(root, "report", "Local report")
      io.mkdir(root + "/wiki")
      io.writeFileString(root + "/wiki/report.md", "---\ntype: skill\nname: report\ndescription: Generate test reports\n---\n# When to use\nGenerate reports.\n# Steps\nInclude WIKI_REPORT.\n")
      var agent = agentFor(root)
      agent._skillWikiManager = new MiniAWikiManager({ root: root + "/wiki", backend: "fs", access: "ro", wikiretrievalv2: false })
      agent._skillUtils._skillWikiManager = agent._skillWikiManager
      agent._skillWikiEnabled = true
      var offered = []
      agent._selectSkillCandidates = function(candidates) { offered = candidates; return [candidates.filter(function(item) { return item.source === "wiki" })[0]] }
      var args = { useskills: true, useskillswiki: true, skillsautosearch: true, goal: "Generate test reports", skillsautolimit: 5 }
      ow.test.assert(agent._consultSkillsForRun(args).length, 0, "Mixed consultation succeeds")
      ow.test.assert(offered.some(function(item) { return item.id === "local:report" }), true, "Local source represented")
      ow.test.assert(offered.some(function(item) { return item.id === "wiki:report.md" }), true, "Wiki source represented")
      ow.test.assert(agent._skillGuidanceContext().indexOf("WIKI_REPORT") >= 0, true, "Selected wiki body is loaded")
      agent._resetSkillRuntime(args)
      args.goal = "$report"
      ow.test.assert(agent._consultSkillsForRun(args)[0].reason, "ambiguous-skill-use-source-qualified-id", "Cross-source ambiguity is explicit")
    })
  }

  exports.testSkillWikiProgressiveResolution = function() {
    fixture(function(root) {
      io.writeFileString(root + "/long.md", "---\ntype: skill\nname: long\n---\n# When to use\nReports.\n# Safety\nRead only.\n# Steps\n" + "x".repeat(500) + "\n# Verify\nCheck result.\n")
      var wm = new MiniAWikiManager({ root: root, backend: "fs", access: "ro", wikiretrievalv2: false })
      var provider = new MiniAWikiSkillProvider(wm, {})
      var result = provider.resolve("wiki:long.md", { progressive: true, maxChars: 120 })
      ow.test.assert(isUnDef(result.error), true, "Structured long wiki skill loads progressively")
      ow.test.assert(result.bodyTemplate.indexOf("Read only") >= 0, true, "Safety section complete")
      ow.test.assert(result.pendingSections.indexOf("Steps") >= 0, true, "Steps deferred without partial execution")
      ow.test.assert(result.bodyTemplate.length <= 120, true, "Progressive output respects exact budget")
    })
  }

  exports.testSkillSelectorNoneAndFailure = function() {
    fixture(function(root) {
      writeSkill(root, "report", "Instructions")
      var agent = agentFor(root)
      agent._selectSkillCandidates = function() { return [] }
      ow.test.assert(agent._consultSkillsForRun({ useskills: true, skillsautosearch: true, goal: "Generate test reports" }).length, 0, "None relevant is valid")
      ow.test.assert(agent._skillRuntime.chars, 0, "None selection loads no body")
      agent._resetSkillRuntime({})
      agent._selectSkillCandidates = function() { throw new Error("invalid-skill-selection") }
      ow.test.assert(agent._consultSkillsForRun({ useskills: true, skillsautosearch: true, goal: "Generate test reports" })[0].ref, "selection", "Selector failures visibly block dependent work")
    })
  }

  exports.testSkillStartLoadsBeforeExecutionAndBlocksMissing = function() {
    fixture(function(root) {
      writeSkill(root, "report", "Include VERIFIED_REPORT in your final response.")
      var agent = new MiniA(), selections = 0, turns = 0
      agent.fnI = function() {}
      agent._selectSkillCandidates = function(candidates) { selections++; return [candidates[0]] }
      // Explicit synthetic model configuration; initialization does not contact it.
      var args = { model: "(type: openai, model: fixture, key: fixture)", usedecide: false, useskills: true, skillsautosearch: true, extraskills: root, useutils: false, usetools: false, usejsontool: true, usememory: false, useplanning: false, goal: "Generate test reports", raw: true, maxsteps: 3 }
      try {
        agent.init(args)
        agent.llm.promptJSONWithStats = agent.llm.promptWithStats = function(prompt) {
          turns++
          ow.test.assert(agent._skillGuidanceContext().indexOf("VERIFIED_REPORT") >= 0, true, "Instructions active before first execution call")
          ow.test.assert(prompt.indexOf("VERIFIED_REPORT") >= 0 || stringify(agent.llm.getGPT().getConversation()).indexOf("VERIFIED_REPORT") >= 0, true, "Actual model request includes skill guidance")
          return { response: { action: "final", answer: "VERIFIED_REPORT" }, stats: {} }
        }
        ow.test.assert(agent.start(merge({}, args)), "VERIFIED_REPORT", "Actual agent run completes")
        ow.test.assert(selections, 1, "One selection before execution")
        ow.test.assert(turns, 1, "One execution turn")
        var blocked = agent.start(merge(args, { goal: "$missing-report", _skillHandoff: [{ ref: "local:missing-report", required: true }] }))
        ow.test.assert(blocked.indexOf("blocked") >= 0, true, "Missing required handoff returns actionable blocked result")
        ow.test.assert(turns, 1, "Blocked run does not call execution model")
        ow.test.assert(agent.start(merge(args, { goal: "$missing-report", _skillHandoff: [] })), "VERIFIED_REPORT", "Unknown goal mention permits normal task execution")
        ow.test.assert(turns, 2, "Ignored unknown reference does not prevent execution")
      } finally { agent._stopAgentResources() }
    })
  }

  exports.testSkillSharedLocalWikiBudgetAndSupportingReferences = function() {
    fixture(function(root) {
      writeSkill(root, "report", "Read [reference](reference.md).\nReport {{arg1}}.")
      io.writeFileString(root + "/report/reference.md", "# Details\nReference evidence.")
      var agent = agentFor(root, { skillsmaxchars: 120, skillsmaxloaded: 1 })
      var rendered = agent._skillUtils.skills({ operation: "render", name: "report", argv: ["Ada"] })
      ow.test.assert(rendered.rendered.indexOf("Reference evidence") < 0, true, "Supporting body deferred")
      var support = agent._skillUtils.skills({ operation: "read", name: "report", reference: "reference.md" })
      ow.test.assert(support.body.indexOf("Reference evidence") >= 0, true, "Declared supporting file can be loaded under same budget")
      ow.test.assert(agent._skillUtils.skills({ operation: "read", name: "report", reference: "../arbitrary.md" }).error, "skill-reference-not-declared", "Unrelated file is not a supporting reference")
      agent._skillUtils._skillWikiManager = {}
      agent._skillUtils._skillProvider = { _wm: agent._skillUtils._skillWikiManager, open: function() { return {} } }
      ow.test.assert(agent._skillUtils.skillwiki({ operation: "open", ref: "wiki:other.md" }).error, "skills-max-loaded-exceeded", "Local and wiki share distinct skill slots")
    })
  }

  exports.testSkillHandoffRespectsChildPermissionsAndRevision = function() {
    fixture(function(root) {
      writeSkill(root, "report", "Generate test reports.")
      var parent = agentFor(root)
      parent._consultSkillsForRun({ useskills: true, goal: "$report" })
      var manager = new SubtaskManager({ useskills: true, fileallow: [root], extraskills: root }, { parentAgent: parent })
      try {
        manager.parentAgent = parent
        var child = manager._buildChildArgs({ goal: "Generate test reports", args: { useskills: false }, depth: 1 })
        ow.test.assert(child.useskills, false, "Explicit child opt-out is preserved")
        ow.test.assert(child._skillHandoff[0].ref, "local:report", "Relevant source-qualified ref handed off")
        ow.test.assert(child.fileallow[0], root, "Parent file ceiling retained")
        var childAgent = agentFor(root)
        var blocked = childAgent._consultSkillsForRun({ useskills: false, goal: child.goal, _skillHandoff: child._skillHandoff })
        ow.test.assert(blocked[0].reason, "requested-skill-unavailable", "Child cannot silently ignore inaccessible required skill")
        writeSkill(root, "report", "Changed guidance")
        childAgent = agentFor(root)
        blocked = childAgent._consultSkillsForRun({ useskills: true, goal: child.goal, _skillHandoff: child._skillHandoff })
        ow.test.assert(blocked[0].reason, "skill-source-revision-changed", "Child cannot silently use a different source revision")
      } finally { manager.destroy() }
    })
  }

  exports.testSkillSelectorDefaultsAndFallbacks = function() {
    var agent = new MiniA(), candidate = { id: "local:report", name: "report" }, calls = [], events = []
    var configuredEnv = function() { return "(type: openai, model: fixture)" }, emptyEnv = function() { return "" }
    ow.test.assert(agent._resolveSkillsAutoSearch({}, configuredEnv), false, "Decision use must be explicitly enabled")
    ow.test.assert(agent._resolveSkillsAutoSearch({ usedecide: true }, configuredEnv), true, "Configured decision enables default search")
    ow.test.assert(agent._resolveSkillsAutoSearch({ usedecide: true, skillsautosearch: false }, configuredEnv), false, "Explicit opt-out wins")
    ow.test.assert(agent._resolveSkillsAutoSearch({ usedecide: true }, emptyEnv), false, "No decision config defaults off")
    ow.test.assert(agent._resolveSkillsAutoSearch({ skillsautosearch: true }, emptyEnv), true, "Explicit opt-in works without decision config")
    agent._resetSkillRuntime({})
    agent._skillRuntime.eventFn = function(event) { events.push(event) }
    agent._use_lc = true
    agent._oaf_lc_model = { model: "lc" }
    agent._oaf_model = { model: "main" }
    agent._decision = { isConfigured: function() { return true }, decide: function(state, questions) {
      calls.push("decide")
      ow.test.assert(state.candidates[0].id, candidate.id, "Source identity preserved")
      ow.test.assert(questions.candidate_0.type, "boolean", "Bounded relevance question")
      return { response: { answers: { candidate_0: { type: "boolean", value: false } } }, stats: { total_tokens: 4 } }
    } }
    agent._createBareLlmInstance = function(config) {
      calls.push(config.model)
      return { withInstructions: function() {}, promptJSONWithStats: function() {
        if (config.model === "lc") throw new Error("fixture-lc-failure")
        return { response: { selected: [candidate.id] }, stats: {} }
      } }
    }
    var usage = [], controls = { beforeCall: function() { usage.push("before") }, afterCall: function(tokens, tier) { usage.push(tier) } }
    ow.test.assert(agent._selectSkillCandidates([candidate], { usedecide: true }, controls), [], "Valid none stops fallback")
    ow.test.assert(calls, ["decide"], "No slower calls for irrelevant task")
    ow.test.assert(usage, ["before", "decide"], "Decision call participates in rate limits")
    calls = []
    agent._decision.decide = function() { calls.push("decide"); return { response: { answers: { candidate_0: { type: "boolean", value: true } } } } }
    ow.test.assert(agent._selectSkillCandidates([candidate], { usedecide: true })[0].id, candidate.id, "Relevant decision loads the original candidate")
    ow.test.assert(calls, ["decide"], "Successful decision skips chat selectors")
    calls = []
    agent._decision.decide = function() { calls.push("decide"); return { response: { answers: { candidate_0: { type: "boolean", value: "invalid" } } } } }
    ow.test.assert(agent._selectSkillCandidates([candidate], { usedecide: true })[0].id, candidate.id, "Invalid decision and failed LC fall back to main")
    ow.test.assert(calls, ["decide", "lc", "main"], "Fallback order is decide then LC then main")
    ow.test.assert(events.filter(function(event) { return event.state === "selection_fallback" }).length, 2, "Fallbacks are visible")
    calls = []
    agent._createBareLlmInstance = function(config) { calls.push(config.model); return { withInstructions: function() {}, promptJSONWithStats: function() { return { response: { selected: [] } } } } }
    ow.test.assert(agent._selectSkillCandidates([candidate], { usedecide: false }), [], "LC can return none")
    ow.test.assert(calls, ["lc"], "Decision disabled skips decide and valid LC stops main")
    calls = []
    var blocked = false
    try { agent._selectSkillCandidates([candidate], { usedecide: true }, { beforeCall: function() { throw new Error("rate-limit") } }) } catch(e) { blocked = true }
    ow.test.assert(blocked, true, "Rate-limit failure aborts selection")
    ow.test.assert(calls, [], "Rate limits do not cause provider fallback")
    fixture(function(root) {
      writeSkill(root, "report", "Report")
      var localAgent = agentFor(root)
      localAgent._selectSkillCandidates = function() { throw new Error("Default must avoid selection") }
      localAgent._consultSkillsForRun({ useskills: true, goal: "Generate test reports" })
      ow.test.assert(localAgent._skillRuntime.metrics.selection_calls, 0, "Default has no selection inference")
      ow.test.assert(localAgent._skillRuntime.chars, 0, "Default has no automatic load")
    })
  }

})()
