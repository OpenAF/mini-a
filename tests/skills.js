(function() {
  load("mini-a-common.js")
  load("mini-a-wiki.js")
  load("mini-a-skills.js")
  load("mini-a-mcp-skills.js")

  var mkTmp = function() {
    var d = String(java.io.File.createTempFile("miniaskills-test-", "").getCanonicalPath())
    io.rm(d)
    io.mkdir(d)
    return d
  }

  var writePage = function(dir, relPath, frontmatter, body) {
    var full = dir + "/" + relPath
    var parent = full.substring(0, full.lastIndexOf("/"))
    if (parent.length > 0 && !io.fileExists(parent)) io.mkdir(parent)
    var yaml = ""
    try { yaml = af.toYAML(frontmatter) } catch(e) { yaml = "" }
    io.writeFileString(full, "---\n" + yaml + "---\n" + body)
  }

  var basicSkillWiki = function(dir) {
    writePage(dir, "postgres-index-review.md", {
      type: "skill", schema: "mini-a.skill/v1", name: "postgres-index-review",
      title: "PostgreSQL Index Review",
      description: "Analyze PostgreSQL workloads and identify missing, redundant, or ineffective indexes.",
      tags: ["postgresql", "database", "performance"],
      intent: ["diagnose slow query", "review indexing strategy", "optimize database"],
      applies_to: ["postgres"],
      requires: { tools: ["shell"], capabilities: ["filesystem-read"] },
      risk: "low",
      compatibility: { "mini-a": true, "codex": true, "claude-code": true },
      version: 1
    }, "# When to use\nUse this when a Postgres query is slow.\n\n# Diagnosis\nRun EXPLAIN ANALYZE and look for sequential scans.\n\n# Remediation\nAdd a covering index.\n")

    writePage(dir, "kafka-consumer-rebalance.md", {
      type: "skill", name: "kafka-consumer-rebalance",
      title: "Kafka Consumer Rebalance",
      description: "Diagnose Kafka consumer pauses during rebalances.",
      tags: ["kafka", "streaming"],
      intent: ["diagnose kafka consumer pauses"],
      applies_to: ["kafka"],
      risk: "medium",
      compatibility: { "codex": true }
    }, "# Diagnosis\nCheck rebalance logs.\n")

    writePage(dir, "delete-everything.md", {
      type: "skill", name: "delete-everything",
      title: "Delete Everything",
      description: "Destructive cleanup.",
      tags: ["ops"],
      risk: "high"
    }, "# Steps\nrm -rf.\n")

    writePage(dir, "normal-note.md", {
      title: "Just a normal knowledge page",
      description: "Not a skill, ordinary wiki content."
    }, "# Body\nNothing skill-related here.\n")
  }

  // ── unit tests ────────────────────────────────────────────────────────────

  exports.testSkillMetadataFullFrontmatterParses = function() {
    var dir = mkTmp()
    try {
      basicSkillWiki(dir)
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro" })
      var meta = wm._metaFor("postgres-index-review.md")
      ow.test.assert(meta.type, "skill", "type should be skill")
      ow.test.assert(meta.name, "postgres-index-review", "name should round-trip")
      ow.test.assert(meta.intent.length, 3, "intent array should have 3 entries")
      ow.test.assert(meta.appliesTo.join(","), "postgres", "appliesTo should round-trip from applies_to")
      ow.test.assert(meta.risk, "low", "risk should round-trip")
      ow.test.assert(meta.compatibility["codex"], true, "compatibility map should round-trip")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testSkillMetadataMissingOptionalFieldsDefaultsGracefully = function() {
    var dir = mkTmp()
    try {
      writePage(dir, "minimal.md", { type: "skill", name: "minimal-skill" }, "# Body\nMinimal.\n")
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro" })
      var meta = wm._metaFor("minimal.md")
      ow.test.assert(meta.type, "skill", "type should still be skill")
      ow.test.assert(isArray(meta.intent), true, "intent should default to an array")
      ow.test.assert(meta.intent.length, 0, "intent should default to empty")
      ow.test.assert(isMap(meta.requires), true, "requires should default to a map")
      ow.test.assert(meta.risk, "", "risk should default to empty string")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testSkillSearchDefaultTypeFilterExcludesOrdinaryPages = function() {
    var dir = mkTmp()
    try {
      basicSkillWiki(dir)
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro" })
      var hits = __miniASkillSearch(wm, { query: "normal" })
      ow.test.assert(hits.length, 0, "ordinary page should be excluded by default type=skill filter")
      var hitsAll = __miniASkillSearch(wm, { query: "normal", type: "*" })
      ow.test.assert(hitsAll.length > 0, true, "type=* should include ordinary pages")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testSkillSearchTagFiltering = function() {
    var dir = mkTmp()
    try {
      basicSkillWiki(dir)
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro" })
      var hits = __miniASkillSearch(wm, { query: "diagnose", tags: ["kafka"] })
      ow.test.assert(hits.length, 1, "tag filter should narrow to the kafka skill")
      ow.test.assert(hits[0].name, "kafka-consumer-rebalance", "tag filter should return the right skill")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testSkillSearchAppliesToFiltering = function() {
    var dir = mkTmp()
    try {
      basicSkillWiki(dir)
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro" })
      var hits = __miniASkillSearch(wm, { query: "", appliesTo: ["postgres"] })
      ow.test.assert(hits.length, 1, "appliesTo filter should narrow to postgres skill")
      ow.test.assert(hits[0].name, "postgres-index-review", "appliesTo filter should return the right skill")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testSkillSearchCompatibilityFiltering = function() {
    var dir = mkTmp()
    try {
      basicSkillWiki(dir)
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro" })
      var hits = __miniASkillSearch(wm, { query: "", compatibility: "mini-a" })
      ow.test.assert(hits.length, 1, "compatibility filter should exclude skills without that key set true")
      ow.test.assert(hits[0].name, "postgres-index-review", "only postgres skill declares mini-a compatibility")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testSkillSearchMaxRiskFiltering = function() {
    var dir = mkTmp()
    try {
      basicSkillWiki(dir)
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro" })
      var low = __miniASkillSearch(wm, { query: "", maxRisk: "low" })
      ow.test.assert(low.length, 1, "maxRisk=low should exclude medium/high risk skills")
      var all = __miniASkillSearch(wm, { query: "", maxRisk: "high" })
      ow.test.assert(all.length, 3, "maxRisk=high should include all three skill pages")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testSkillRecommendIntentRankingPrefersMatchingSkill = function() {
    var dir = mkTmp()
    try {
      basicSkillWiki(dir)
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro" })
      var recs = __miniASkillRecommend(wm, { task: "diagnose kafka consumer pauses during rebalances", limit: 5 })
      ow.test.assert(recs.length > 0, true, "recommend should return at least one candidate")
      ow.test.assert(recs[0].name, "kafka-consumer-rebalance", "the intent-matching skill should rank first")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testSkillNormalizedObjectShape = function() {
    var dir = mkTmp()
    try {
      basicSkillWiki(dir)
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro" })
      var hits = __miniASkillSearch(wm, { query: "postgres" })
      ow.test.assert(hits.length > 0, true, "should find the postgres skill")
      var s = hits[0]
      ow.test.assert(s.schema, "mini-a.virtual-skill/v1", "normalized skill should carry the virtual-skill schema")
      ow.test.assert(s.provider, "wiki", "provider should be wiki")
      ow.test.assert(s.ref.indexOf("wiki:") === 0, true, "ref should be a wiki: reference")
      ow.test.assert(isNumber(s.score), true, "score should be numeric")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testSkillOpenNeverReturnsBody = function() {
    var dir = mkTmp()
    try {
      basicSkillWiki(dir)
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro" })
      var opened = __miniASkillOpen(wm, "wiki:postgres-index-review.md", {})
      ow.test.assert(isDef(opened.body), false, "open() must never include the skill body")
      ow.test.assert(opened.headings.length, 3, "open() should list all headings")
      ow.test.assert(opened.requires.tools[0], "shell", "open() should expose requires")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testSkillReadSectionBounded = function() {
    var dir = mkTmp()
    try {
      basicSkillWiki(dir)
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro" })
      var out = __miniASkillRead(wm, "wiki:postgres-index-review.md", { section: "Diagnosis" })
      ow.test.assert(out.body.indexOf("EXPLAIN ANALYZE") >= 0, true, "section read should include the Diagnosis text")
      ow.test.assert(out.body.indexOf("covering index") >= 0, false, "section read should exclude other sections")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testSkillContextReportsCompactSkillCount = function() {
    var dir = mkTmp()
    try {
      basicSkillWiki(dir)
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro" })
      var ctx = __miniASkillContext(wm, { skillCountTtlMs: 0 })
      ow.test.assert(ctx.skillCount, 3, "context should count exactly the 3 type=skill pages, not the ordinary page")
      ow.test.assert(isArray(ctx.wikis), true, "context should list wikis")
      ow.test.assert(ctx.features.search, true, "context should advertise search capability")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testSkillProviderResolveProducesRenderableTemplate = function() {
    var dir = mkTmp()
    try {
      basicSkillWiki(dir)
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "ro" })
      var provider = new MiniAWikiSkillProvider(wm, {})
      var resolved = provider.resolve("wiki:postgres-index-review.md", {})
      ow.test.assert(resolved.format, "wiki", "resolved skill should be tagged format=wiki")
      ow.test.assert(resolved.bodyTemplate.indexOf("EXPLAIN ANALYZE") >= 0, true, "resolve() body should contain the skill content")
      var rendered = __miniARenderSkillTemplate(resolved.bodyTemplate, { raw: "", argv: [], argc: 0 })
      ow.test.assert(isString(rendered), true, "existing skill render machinery should accept the resolved bodyTemplate")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testSkillRiskRankOrdering = function() {
    ow.test.assert(__miniASkillRiskRank("low") < __miniASkillRiskRank("medium"), true, "low should rank below medium")
    ow.test.assert(__miniASkillRiskRank("medium") < __miniASkillRiskRank("high"), true, "medium should rank below high")
    ow.test.assert(__miniASkillRiskRank(""), 0, "missing risk should rank as 0 (never excluded by maxRisk)")
  }

  // ── integration tests (multi-mount) ─────────────────────────────────────────

  exports.testSkillSearchAcrossMounts = function() {
    var primaryDir = mkTmp(), mountDir = mkTmp()
    try {
      basicSkillWiki(primaryDir)
      writePage(mountDir, "kubernetes-debug-pods.md", {
        type: "skill", name: "kubernetes-debug-pods", title: "Kubernetes Debug Pods",
        description: "Diagnose crashing or pending pods.", tags: ["kubernetes"], applies_to: ["kubernetes"], risk: "low"
      }, "# Diagnosis\nkubectl describe pod.\n")
      var wm = new MiniAWikiManager({ backend: "fs", root: primaryDir, access: "ro" })
      wm.attach("devops", { access: "ro", backend: "fs", root: mountDir })
      var hits = __miniASkillSearch(wm, { query: "diagnose", wiki: "*" })
      var wikis = {}
      hits.forEach(function(h) { wikis[h.wiki] = true })
      ow.test.assert(isDef(wikis["primary"]), true, "results should include the primary wiki")
      ow.test.assert(isDef(wikis["devops"]), true, "results should include the mounted devops wiki")
      var mounted = hits.filter(function(h) { return h.wiki === "devops" })[0]
      ow.test.assert(mounted.ref.indexOf("wiki:@devops/") === 0, true, "mounted skill ref should carry the @devops/ prefix")
    } finally { try { io.rm(primaryDir) } catch(e) {} try { io.rm(mountDir) } catch(e) {} }
  }

  exports.testSkillOpenReadAcrossMount = function() {
    var primaryDir = mkTmp(), mountDir = mkTmp()
    try {
      basicSkillWiki(primaryDir)
      writePage(mountDir, "kubernetes-debug-pods.md", {
        type: "skill", name: "kubernetes-debug-pods", title: "Kubernetes Debug Pods",
        description: "Diagnose crashing or pending pods.", tags: ["kubernetes"]
      }, "# Diagnosis\nkubectl describe pod.\n\n# Remediation\nFix the readiness probe.\n")
      var wm = new MiniAWikiManager({ backend: "fs", root: primaryDir, access: "ro" })
      wm.attach("devops", { access: "ro", backend: "fs", root: mountDir })
      var ref = "wiki:@devops/kubernetes-debug-pods.md"
      var opened = __miniASkillOpen(wm, ref, {})
      ow.test.assert(opened.name, "kubernetes-debug-pods", "open() should resolve a mounted skill by its @mount/ ref")
      var read = __miniASkillRead(wm, ref, { section: "Remediation" })
      ow.test.assert(read.body.indexOf("readiness probe") >= 0, true, "read() should resolve a mounted skill's section")
    } finally { try { io.rm(primaryDir) } catch(e) {} try { io.rm(mountDir) } catch(e) {} }
  }

  exports.testSkillRestrictedSearchNeverExposesPathAndIssuesOpaqueRef = function() {
    var dir = mkTmp()
    try {
      basicSkillWiki(dir)
      var args = { wikibackend: "fs", wikiroot: dir, label: "Test", wikirestrictprofile: "relaxed" }
      args.wikirestrict = true
      __miniAMcpSkillsInit(args, { access: "ro", readonly: true, logPrefix: "mcp-skills-safe-test" })
      var result = __miniAMcpSkillsRestrictedSearch({ query: "postgres index" })
      ow.test.assert(result.results.length > 0, true, "restricted search should return at least one hit")
      var hit = result.results[0]
      ow.test.assert(isDef(hit.path), false, "restricted search must never expose a real path")
      ow.test.assert(isString(hit.reference) && hit.reference.length > 0, true, "restricted search should issue an opaque reference")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testSkillRestrictedOneShotRefCannotBeReused = function() {
    var dir = mkTmp()
    try {
      basicSkillWiki(dir)
      var args = { wikibackend: "fs", wikiroot: dir, label: "Test", wikirestrictprofile: "relaxed" }
      args.wikirestrict = true
      __miniAMcpSkillsInit(args, { access: "ro", readonly: true, logPrefix: "mcp-skills-safe-test2" })
      var result = __miniAMcpSkillsRestrictedSearch({ query: "postgres index" })
      var ref = result.results[0].reference
      var first = __miniAMcpSkillsRestrictedOpen({ ref: ref })
      ow.test.assert(isDef(first.error), false, "first use of a fresh reference should succeed")
      var second = __miniAMcpSkillsRestrictedOpen({ ref: ref })
      ow.test.assert(second.error, "invalid-or-expired-reference", "reusing a consumed reference must fail")
    } finally { try { io.rm(dir) } catch(e) {} }
  }

  exports.testSkillRestrictedRejectsTooShortQuery = function() {
    var dir = mkTmp()
    try {
      basicSkillWiki(dir)
      var args = { wikibackend: "fs", wikiroot: dir, label: "Test", wikirestrictprofile: "tight" }
      args.wikirestrict = true
      __miniAMcpSkillsInit(args, { access: "ro", readonly: true, logPrefix: "mcp-skills-safe-test3" })
      var result = __miniAMcpSkillsRestrictedSearch({ query: "ab" })
      ow.test.assert(result.error, "restricted-query-rejected", "a query shorter than the tight profile's minimum should be rejected")
    } finally { try { io.rm(dir) } catch(e) {} }
  }
})()
