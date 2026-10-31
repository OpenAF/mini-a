(function() {
  load("mini-a-common.js")
  load("utils/wikiJobsLib.js")

  var repo = String(new java.io.File(".").getCanonicalPath())
  var quiet = function() {}

  var mkTmp = function(prefix) {
    var d = String(java.io.File.createTempFile(prefix || "miniawikijobs-", "").getCanonicalPath())
    io.rm(d)
    io.mkdir(d)
    return d
  }
  var rmTree = function(d) { try { io.rm(d) } catch(e) {} }

  // A home directory without user mode presets keeps the tests independent of ~/.openaf-mini-a.
  var emptyHome = function() { return mkTmp("miniawikijobs-home-") }

  var throwsLike = function(fn, re, msg) {
    var err
    try { fn() } catch(e) { err = String(e) }
    ow.test.assert(isDef(err) && re.test(err), true, msg + " (got: " + err + ")")
  }

  var fixtureSource = function() {
    var src = mkTmp("miniawikijobs-src-")
    io.mkdir(src + "/sub")
    io.writeFileString(src + "/alpha.md", "# Alpha\n\nAlpha links to [beta](sub/beta.md) and talks about caching.\n")
    io.writeFileString(src + "/sub/beta.md", "# Beta\n\nBeta covers indexing and retrieval.\n")
    return src
  }

  var runJob = function(yaml, params) {
    var cmd = ["ojob", repo + "/utils/" + yaml]
    Object.keys(params).forEach(function(k) { cmd.push(k + "=" + params[k]) })
    // Run from a temporary directory so library loading cannot rely on the current directory.
    var cwd = mkTmp("miniawikijobs-cwd-")
    try {
      return $sh(cmd).pwd(cwd).get(0)
    } finally { rmTree(cwd) }
  }

  var countMd = function(dir) {
    return listFilesRecursive(dir).filter(function(f) { return f.isFile && /\.md$/.test(f.filename) && String(f.filepath).indexOf("/.") < 0 }).length
  }

  exports.testResolveModePreset = function() {
    var home = emptyHome()
    try {
      var r = __miniAResolveModePreset("PowerUser", { basePath: repo, homeDir: home })
      ow.test.assert(r.key, "poweruser", "mode names match case-insensitively")
      ow.test.assert(r.params.useshell, true, "bundled poweruser params are resolved")
      throwsLike(function() { __miniAResolveModePreset("nope", { basePath: repo, homeDir: home }) }, /not found/, "unknown mode throws")

      io.mkdir(home + "/.openaf-mini-a")
      io.writeFileYAML(home + "/.openaf-mini-a/modes.yaml", { modes: {
        base : { params: { wikimaxprompttokens: 1000, alpha: 1 } },
        child: { include: "base", params: [{ alpha: 2 }, { beta: 3 }] },
        loopa: { include: "loopb", params: {} },
        loopb: { include: "loopa", params: {} },
        inline: { description: "inline keys", gamma: 4 }
      } })
      r = __miniAResolveModePreset("child", { basePath: repo, homeDir: home })
      ow.test.assert(r.params.wikimaxprompttokens, 1000, "include params are merged")
      ow.test.assert(r.params.alpha, 2, "own params override included params")
      ow.test.assert(r.params.beta, 3, "array params are merged")
      ow.test.assert(r.includes.join(","), "base", "includes are reported")
      ow.test.assert(__miniAResolveModePreset("inline", { basePath: repo, homeDir: home }).params.gamma, 4, "inline params are supported")
      ow.test.assert(__miniAResolveModePreset("base,child", { basePath: repo, homeDir: home }).key, "base,child", "multi-mode keys are joined")
      throwsLike(function() { __miniAResolveModePreset("loopa", { basePath: repo, homeDir: home }) }, /Circular mode include/, "include cycles throw")
    } finally { rmTree(home) }
  }

  exports.testPrepareSemanticAndLayers = function() {
    var home = emptyHome(), root = mkTmp()
    try {
      var p = wikiJobsPrepare({ wikiroot: root }, { log: quiet, homeDir: home })
      ow.test.assert(p.args.wikigraphsemantic, false, "semantic is an explicit false by default")
      ow.test.assert(p.args.mode, "poweruser", "poweruser is the default mode")
      ow.test.assert(p.args.usewikigraph, true, "graph is on by default")
      ow.test.assert(p.args.wikiretrievalv2, true, "retrieval v2 is on by default")
      ow.test.assert(isString(p.args.wikilexical) && p.args.wikilexical.length > 0, true, "lexical default is set")
      ow.test.assert(p.compact && p.backup && !p.dryrun, true, "compact/backup default on, dryrun off")

      p = wikiJobsPrepare({ wikiroot: root, semantic: "true", mode: "none", wikiaccess: "ro", wikibackend: "s3", usewikigraph: "false", useshell: "true" }, { log: quiet, homeDir: home })
      ow.test.assert(p.args.wikigraphsemantic, true, "semantic=true opts in")
      ow.test.assert(isUnDef(p.args.mode), true, "mode=none skips presets")
      ow.test.assert(p.args.wikiaccess + "/" + p.args.wikibackend, "rw/fs", "access and backend are enforced")
      ow.test.assert(p.args.usewikigraph, "false", "explicit args override job defaults")
      ow.test.assert(isUnDef(p.args.semantic), true, "control keys are not forwarded")

      p = wikiJobsPrepare({ wikiroot: root, wikigraphsemantic: "true", mode: "none" }, { log: quiet, homeDir: home })
      ow.test.assert(p.args.wikigraphsemantic, true, "wikigraphsemantic is accepted as an alias")

      p = wikiJobsPrepare({ wikiroot: new java.io.File(root).getCanonicalPath(), mode: "none" }, { log: quiet, homeDir: home })
      ow.test.assert(p.root, root, "java.lang.String wiki roots are handled")
    } finally { rmTree(home); rmTree(root) }
  }

  exports.testPrepareValidation = function() {
    var home = emptyHome(), root = mkTmp()
    try {
      throwsLike(function() { wikiJobsPrepare({ mode: "none" }, { log: quiet, homeDir: home }) }, /wikiroot is mandatory/, "missing wikiroot throws")
      throwsLike(function() { wikiJobsPrepare({ wikiroot: root + "/missing", mode: "none" }, { log: quiet, homeDir: home }) }, /Hydrate it first/, "dream requires an existing wiki")
      var created = wikiJobsPrepare({ wikiroot: root + "/new", mode: "none" }, { log: quiet, homeDir: home, createRoot: true })
      ow.test.assert(io.fileExists(created.root), true, "hydrate creates a missing wiki root")

      var src = fixtureSource()
      try {
        var p = wikiJobsPrepare({ wikiroot: root, mode: "none" }, { log: quiet, homeDir: home })
        throwsLike(function() { wikiJobsIngestArgs(p, {}) }, /source .* is mandatory/, "missing source throws")
        throwsLike(function() { wikiJobsIngestArgs(p, { source: src + "/none" }) }, /Source directory not found/, "missing source folder throws")
        throwsLike(function() { wikiJobsIngestArgs(p, { source: root + "/.." }) }, /must not contain/, "overlapping source and wiki throw")
        var a = wikiJobsIngestArgs(p, { source: src, prune: "true" })
        ow.test.assert(a.ingestsource, src, "source is canonicalized")
        ow.test.assert(a.ingestmode + "/" + a.ingestlayout + "/" + a.wikimaxprompttokens, "auto/source/200000", "ingest defaults match the hydrate script")
        ow.test.assert(a.ingestprune, true, "prune maps to ingestprune")
        ow.test.assert(wikiJobsIngestArgs(p, { source: "https://example.com/page" }).ingestsource, "https://example.com/page", "URLs pass through")
      } finally { rmTree(src) }
    } finally { rmTree(home); rmTree(root) }
  }

  exports.testDreamArgs = function() {
    var home = emptyHome(), root = mkTmp()
    try {
      var p = wikiJobsPrepare({ wikiroot: root, mode: "none" }, { log: quiet, homeDir: home })
      var a = wikiJobsDreamArgs(p, {})
      ow.test.assert(a.dreamwikimode + "/" + a.dreamwikireorg + "/" + a.dreamwikiapproval, "reorg/true/auto", "reorg is the default and is pre-approved")
      ow.test.assert(a.wikigraphsemantic, false, "dream semantic is an explicit false by default")
      ow.test.assert(a.dreammode, "wiki", "dream mode is wiki")

      p = wikiJobsPrepare({ wikiroot: root, mode: "none", dreamwikimode: "Plan", dryrun: "true" }, { log: quiet, homeDir: home })
      a = wikiJobsDreamArgs(p, { organize: "topics" })
      ow.test.assert(a.dreamwikimode, "plan", "dream modes are normalized")
      ow.test.assert(isUnDef(a.dreamwikireorg), true, "non-reorg modes do not enable reorg")
      ow.test.assert(a.dreamwikidryrun, true, "dryrun maps to dreamwikidryrun")
      ow.test.assert(a.dreamwikiorganize, "topics", "organize maps to dreamwikiorganize")

      p = wikiJobsPrepare({ wikiroot: root, mode: "none", semantic: "true" }, { log: quiet, homeDir: home })
      ow.test.assert(wikiJobsDreamArgs(p, {}).wikigraphsemantic, true, "semantic carries into the dream")
      ow.test.assert(wikiJobsDreamArgs(p, { dreamsemantic: "false" }).wikigraphsemantic, false, "dreamsemantic overrides semantic")

      p = wikiJobsPrepare({ wikiroot: root, mode: "none", dreamwikimode: "bogus" }, { log: quiet, homeDir: home })
      throwsLike(function() { wikiJobsDreamArgs(p, {}) }, /Unknown dreamwikimode/, "unknown dream modes throw")
    } finally { rmTree(home); rmTree(root) }
  }

  exports.testBackupZip = function() {
    var root = mkTmp()
    try {
      io.mkdir(root + "/.mini-a-wiki-state")
      io.mkdir(root + "/topic")
      io.writeFileString(root + "/index.md", "# Index\n")
      io.writeFileString(root + "/topic/page.md", "# Page\n")
      io.writeFileString(root + "/.mini-a-wiki-state/manifest.json", "{}")
      var zip = wikiJobsBackup(root, quiet)
      ow.test.assert(io.fileExists(zip) && zip.indexOf(root + ".predream-") === 0, true, "backup is a sibling zip")
      plugin("ZIP")
      var names = (new ZIP()).list(zip)
      var keys = isMap(names) ? Object.keys(names) : names.map(function(e) { return e.name })
      ow.test.assert(keys.indexOf("topic/page.md") >= 0 && keys.indexOf(".mini-a-wiki-state/manifest.json") >= 0, true, "backup holds pages and hidden state")
      io.rm(zip)
    } finally { rmTree(root) }
  }

  exports.testHydrateAndDreamJobs = function() {
    var base = mkTmp(), src = fixtureSource(), root = base + "/wiki"
    try {
      var r = runJob("wikiHydrate.yaml", { wikiroot: root, source: src, ingestmode: "raw", mode: "none" })
      ow.test.assert(r.exitcode, 0, "hydrate job succeeds: " + r.stderr)
      ow.test.assert(/Compacting the wiki serving index/.test(r.stdout), true, "hydrate compacts")
      ow.test.assert(countMd(root) >= 2, true, "hydrate writes pages")

      var before = countMd(root)
      r = runJob("wikiDream.yaml", { wikiroot: root, dreamwikimode: "plan", mode: "none" })
      ow.test.assert(r.exitcode, 0, "plan dream succeeds: " + r.stderr)
      ow.test.assert(listFilesRecursive(base).filter(function(f) { return /predream/.test(f.filename) }).length, 0, "non-mutating dreams skip the backup")
      ow.test.assert(countMd(root), before, "plan does not change pages")

      r = runJob("wikiDream.yaml", { wikiroot: root, dreamwikimode: "repair", dreamwikillm: "false", mode: "none" })
      ow.test.assert(r.exitcode, 0, "repair dream succeeds: " + r.stderr)
      ow.test.assert(io.listFiles(base).files.filter(function(f) { return /^wiki\.predream-.*\.zip$/.test(f.filename) }).length, 1, "mutating dreams write one backup")

      r = runJob("wikiDream.yaml", { wikiroot: base + "/missing", mode: "none" })
      ow.test.assert(r.exitcode, 1, "dreaming a missing wiki fails")
      ow.test.assert(io.fileExists(base + "/missing"), false, "a missing wiki is not created")
    } finally { rmTree(src); rmTree(base) }
  }
})()
