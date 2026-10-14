/* Controlled fixtures for the paired skills example. No provider calls here. */
loadLib("mini-a.js")
loadLib("mini-a-eval.js")
loadLib("mini-a-utils.js")

exports.assertIsolation = function(agent, args, targetPresent) {
  var policy = new MiniAFileAccess(args.fileallow)
  var plugins = agent._getPluginsDiscovery(args)
  if ((plugins.skillsRoots || []).length || (plugins.mcpConfigs || []).length) throw new Error("Skill eval discovered unexpected plugin contributions")
  var utils = agent._skillUtils
  if (!utils || utils._initialized !== true) throw new Error("Skill eval utilities failed to initialize")
  var roots = utils._skillsRoots || []
  if (roots.some(function(root) { return !policy.allows(root) })) throw new Error("Skill eval discovered a root outside fileallow")
  var skills = utils._listSkills({})
  if (skills.length !== (targetPresent ? 1 : 0) || targetPresent && skills[0].name !== "ledger-reconciliation") throw new Error("Skill eval target availability differs from fixture")
  if ((agent._utilsToolNames || []).some(function(name) { return name !== "skills" })) throw new Error("Skill eval exposed an unrelated utility")
  return { roots: roots, available: skills.map(function(skill) { return skill.name }) }
}

exports.withSuite = function(options, fn) {
  options = isMap(options) ? options : {}
  var evaluator = new MiniAEval()
  var root = String(java.nio.file.Files.createTempDirectory("mini-a-eval-skills-").toFile().getCanonicalPath())
  try {
    var baseline = root + "/baseline", treatment = root + "/with-skill"
    ;[baseline, treatment].forEach(function(path) { io.mkdir(path); io.mkdir(path + "/skills") })
    io.mkdir(treatment + "/skills/ledger-reconciliation")
    var target = treatment + "/skills/ledger-reconciliation/SKILL.md"
    io.writeFileString(target, "---\nname: ledger-reconciliation\ndescription: Reconcile invoice ledgers with duplicate IDs, credits and voided rows.\n---\n# Procedure\nKeep the first row for each ID; record duplicate IDs as discrepancies. Exclude voided rows. Subtract credits and add invoices. Recompute the total from the retained rows, then sort discrepancy IDs. Follow the task's output format.\n")
    var shared = {
      useskills: true, skillsautosearch: false, useshell: false, readwrite: false,
      useutils: false, usestdutils: false, usetools: true, usejsontool: true,
      useskillswiki: false, usewiki: false, usememory: false,
      historyvm: false, historyvmshadow: false, historykeep: false, noagentsmd: true,
      useplanning: false, modelstrategy: "default", deepresearch: false, usedelegation: false, usedecide: false,
      mcp: [], plugins: "", pluginsroots: "", extrahooks: "",
      raw: true, maxsteps: 6, skillsmaxchars: 4000, skillsmaxloaded: 1
    }
    var scenarios = []
    ;(options.decide === true ? [false, true] : [false]).forEach(function(decide) {
      var variants = [
        { name: "baseline", args: { extraskills: baseline + "/skills", utilsroot: baseline, homedir: baseline, fileallow: [baseline] } },
        { name: "with-skill", args: { extraskills: treatment + "/skills", utilsroot: treatment, homedir: treatment, fileallow: [treatment] } }
      ]
      if (options.reverse === true) variants.reverse()
      var common = merge({}, shared, true)
      if (decide) { common.usedecide = true; common.skillsautosearch = true }
      scenarios.push({
        name: (decide ? "decide" : "discovery") + " ledger reconciliation",
        goal: "Reconcile this invoice ledger. Keep only the first row per ID; list duplicate IDs as discrepancies, including duplicates of voided rows. Exclude voided rows; subtract credits and add invoices. Sort discrepancy IDs. Rows: INV-01 invoice 100 EUR; INV-02 credit 27 EUR; INV-03 voided invoice 50 EUR; INV-03 invoice 50 EUR; INV-07 invoice 0 EUR; INV-07 invoice 9 EUR. Reply exactly as total=<integer> EUR; discrepancies=<comma-separated IDs>.",
        args: common, variants: variants,
        expected: { equals: "total=73 EUR; discrepancies=INV-03,INV-07" }
      })
      scenarios.push({ name: (decide ? "decide" : "discovery") + " unrelated", goal: "Reply with only the word ready.", args: common, variants: variants, expected: { equals: "ready" } })
    })
    // Check the real agent root/tool wiring, not just our generated arguments.
    evaluator._expandVariants(scenarios).forEach(function(scenario) {
      var agent = new MiniA(), args = scenario.args
      agent.fnI = function() {}; agent._trace = function() {}
      try {
        if (scenario.variant === "baseline" && new MiniAFileAccess(args.fileallow).allows(target)) throw new Error("Baseline can read treatment skill")
        agent._createUtilsMcpConfig(args)
        exports.assertIsolation(agent, args, scenario.variant === "with-skill")
      } finally { agent._stopAgentResources() }
    })
    return fn(scenarios, { root: root, target: target })
  } finally { evaluator._removeOwnedTree(root) }
}
