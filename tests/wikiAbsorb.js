(function() {
  load("mini-a-common.js")
  load("mini-a-absorb.js")
  function assert(value, message) { if (!value) throw new Error(message || "Assertion failed") }
  function fixture(fn) {
    var root = String(io.createTempDir("absorb_test_"))
    try {
      ;["dst", "one", "two"].forEach(function(p) { io.mkdir(root + "/" + p) })
      var args = { wikiroot: root + "/dst", wikiaccess: "rw", absorbspec: root + "/sources.json", absorbop: "plan" }
      io.writeFileString(root + "/sources.json", JSON.stringify({ sources: [{ id: "one", root: "one", all: true }, { id: "two", root: "two", all: true }] }))
      var runner = new MiniAAbsorb(args)
      runner._finalize = function() { return { ok: true, reindexed: true } }
      fn(root, runner, args)
    } finally { io.rm(root) }
  }
  function model(runner, proposals, findings, irrelevant) {
    runner._llm = { promptJSONWithStats: function() { return { response: { proposals: proposals, findings: findings || [], irrelevant: irrelevant || [] } } } }
  }
  function proposal(path, before, after, ids) {
    return { path: path, classification: "enrichment", edits: [{ before: before, after: after, evidence: ids }], evidence: ids, mappings: ids.map(function(id) { return { evidence: id, anchor: "" } }), dependencies: [] }
  }
  function run(r, op, id) { r._args.absorbop = op; r._args.absorbplan = id; return r.run() }
  exports.testModelConfiguration = function() { fixture(function(root, r) {
    io.writeFileString(root + "/one/a.md", "# A")
    var config = { type: "mock", model: "absorb-test" }, received, secretCalls = 0, providerLoads = []
    var registry = { mock: {}, openai: {} }, packPaths = { ghcopilot: "/packs/ghcopilot", AWS: "/packs/AWS", Custom: "/packs/Custom" }
    var ensureProvider = new Function("ow", "getOPackPaths", "getOPackPath", "includeOPack", "loadLib", "return (" + String(__miniAEnsureModelProvider) + ")")(
      { loadAI: function() {}, ai: { __gpttypes: registry } }, function() { return packPaths }, function(name) { return packPaths[name] },
      function(name) { providerLoads.push(name) }, function(path) {
        providerLoads.push(path)
        var type = path.indexOf("/AWS/") >= 0 ? "bedrock" : path.split("/").pop().replace(/\.js$/, "")
        registry[type] = {}
      })
    var mockSec = function(bucket, repo, file, password) {
      assert(bucket === "mini-a" && repo === "models" && password === "test-password")
      return { get: function(key, section) {
        secretCalls++
        assert(section === "models")
        return key === "saved-model" ? config : undefined
      } }
    }
    var mockLlm = function(cfg) {
      var provider = cfg.type.toLowerCase()
      if (provider === "ghcopilot" || provider === "bedrock" || provider === "custom") {
        assert(providerLoads.join(",") === ({ ghcopilot: "ghcopilot,/packs/ghcopilot/ghcopilot.js", bedrock: "AWS,/packs/AWS/aws.js", custom: "Custom,/packs/Custom/custom.js" })[provider], "Provider must be registered before model construction")
      } else assert(providerLoads.length === 0, "Built-in providers must not load optional oPacks")
      received = cfg
      return { promptJSONWithStats: function() {
        return { response: { proposals: [proposal("a.md", "", "# A", ["one:a.md"])], findings: [] } }
      } }
    }
    // OpenAF's global $llm accessor cannot be replaced reliably. Bind the real
    // loader to local provider/secret doubles without invoking a live provider.
    r._ingest._buildLlm = new Function("$llm", "$sec", "__miniAEnsureModelProvider", "return (" + String(MiniAIngest.prototype._buildLlm) + ")")(mockLlm, mockSec, ensureProvider)
    r._ingest._getEnv = new Function("getEnv", "return (" + String(MiniAIngest.prototype._getEnv) + ")")(function(name) {
      assert(name === "OAF_MODEL")
      return "saved-model"
    })
    r._ingest._args.secpass = "test-password"
    ;[undefined, "saved-model", JSON.stringify(config), '(type: mock, model: absorb-test)', config].forEach(function(value) {
      r._ingest._args.model = value
      var result = r.run()
      assert(result.ok && result.plan.complete, "Model configuration did not produce a complete plan: " + JSON.stringify(result))
      assert(result.plan.modelUsage.calls === 1 && received.model === config.model)
    })
    assert(secretCalls === 2, "Explicit definitions must take precedence over the environment reference")
    ;["ghcopilot", "bedrock", "custom", "openai"].forEach(function(type) {
      providerLoads = []
      config.type = type
      // Resolve through OAF_MODEL so registration also follows secret lookup.
      r._ingest._args.model = undefined
      var planned = r.run()
      assert(planned.ok && planned.plan.complete && planned.plan.modelUsage.calls === 1, "Provider plan failed: " + type)
    })
    providerLoads = []
    ensureProvider({ type: "custom" })
    assert(providerLoads.length === 0, "Registered providers must not be reloaded")
    var unknownFailed = false
    try { ensureProvider({ type: "unknown-provider" }) } catch(e) { unknownFailed = String(e).indexOf("libs=") >= 0 }
    assert(unknownFailed && providerLoads.length === 0, "Unknown providers need an actionable error without installing a guessed package")
    r._ingest._args.model = "missing-reference"
    var blocked = r.run()
    assert(!blocked.plan.complete && blocked.plan.modelUsage.calls === 0)
  }) }

  exports.testDeletePlans = function() { fixture(function(root, r) {
    io.writeFileString(root + "/one/a.md", "# A")
    model(r, [])
    var p = r.run(), base = root + "/dst/.mini-a-wiki-absorb", path = base + "/plans/" + p.id
    assert(!p.plan.complete, "fixture must be incomplete")
    r._args.wikiaccess = "ro"
    assert(!run(r, "delete", p.id).ok && io.fileExists(path + ".json"))
    r._args.wikiaccess = "rw"
    assert(!run(r, "delete", "../bad").ok)
    io.mkdir(root + "/dst/.mini-a-wiki-ingest")
    var file = new java.io.RandomAccessFile(root + "/dst/.mini-a-wiki-ingest/writer.lock", "rw"), lock = file.getChannel().tryLock()
    try { assert(!run(r, "delete", p.id).ok && io.fileExists(path + ".json")) } finally { lock.release(); file.close() }
    io.writeFileString(base + "/journal.json", JSON.stringify({ id: p.id }))
    assert(!run(r, "cancel", p.id).ok && io.fileExists(path + ".json"))
    io.rm(base + "/journal.json")
    assert(run(r, "cancel", p.id).status === "deleted")
    assert(!io.fileExists(path + ".json") && !io.fileExists(path + ".md"))
    assert(run(r, "status").plans.indexOf(p.id) < 0)
    assert(run(r, "delete", p.id).status === "noop")
    model(r, [proposal("a.md", "", "# A", ["one:a.md"])])
    p = run(r, "plan"); assert(run(r, "apply", p.id).ok)
    var baseline = io.readFileString(base + "/baseline.json"), receipt = io.readFileString(base + "/receipts/" + p.id + ".json")
    assert(run(r, "delete", p.id).ok)
    assert(io.readFileString(root + "/dst/a.md") === "# A")
    assert(io.readFileString(base + "/baseline.json") === baseline)
    assert(io.readFileString(base + "/receipts/" + p.id + ".json") === receipt)
    r._args.absorboutput = root + "/out"
    p = run(r, "plan"); path = root + "/out/plans/" + p.id
    io.rm(path + ".md")
    java.nio.file.Files.createSymbolicLink(new java.io.File(path + ".md").toPath(), new java.io.File(root + "/one/a.md").toPath())
    assert(!run(r, "delete", p.id).ok && io.fileExists(path + ".json"))
    assert(io.readFileString(root + "/one/a.md") === "# A")
    new java.io.File(path + ".md").delete()
    assert(run(r, "delete", p.id).ok && !io.fileExists(path + ".json"))
  }) }
  exports.testSpecFormats = function() { fixture(function(root, r) {
    io.writeFileString(root + "/one/a.md", "# A\nFacts")
    model(r, [proposal("a.md", "", "# A\nFacts", ["one:a.md"])])
    var formats = {
      json: '{"sources":[{"id":"one","root":"one","paths":["a.md"]}]}',
      yaml: 'sources:\n  - id: one\n    root: one\n    paths:\n      - a.md\n',
      yml: 'sources:\n  - id: one\n    root: one\n    paths: [a.md]\n',
      slon: '(sources: [(id: one, root: one, paths: ["a.md"])])'
    }
    var selected
    Object.keys(formats).concat(["YAML", "SLON", "data"]).forEach(function(ext) {
      r._args.absorbspec = root + "/sources." + ext
      io.writeFileString(r._args.absorbspec, formats[ext.toLowerCase()] || formats.json)
      var p = r.run()
      assert(p.ok && p.plan.complete, ext + ": " + JSON.stringify(p))
      assert(p.plan.operations.length === 1, ext + ": missing proposal")
      if (!selected) selected = JSON.stringify(p.plan.selected)
      assert(JSON.stringify(p.plan.selected) === selected, ext + ": selection differs")
      io.writeFileString(r._args.absorbspec, ext.toLowerCase() === "slon" ? '(sources: [])' : '[]')
      assert(!r.run().ok, ext + ": invalid spec accepted")
    })
  }) }
  exports.testInlineSpecs = function() { fixture(function(root, r) {
    io.writeFileString(root + "/one/a.md", "# A\nFacts")
    model(r, [proposal("a.md", "", "# A\nFacts", ["one:a.md"])])
    var relativeRoot = String(new java.io.File(r._canonical(".")).toPath().relativize(new java.io.File(root + "/one").toPath()))
    var sources = [{ id: "one", root: relativeRoot, paths: ["a.md"] }]
    var slonSources = '[(id: one, root: ' + JSON.stringify(relativeRoot) + ', paths: ["a.md"])]'
    var inputs = [JSON.stringify({ sources: sources }), JSON.stringify(sources), '(sources: ' + slonSources + ')', slonSources, { sources: sources }, sources]
    inputs.forEach(function(input, index) {
      r._args.absorbspec = input
      var p = r.run()
      assert(p.ok && p.plan.complete, index + ": " + JSON.stringify(p))
      assert(p.plan.operations.length === 1 && p.plan.selected[0].id === "one:a.md", "inline selection differs")
      assert(p.plan.sources[0].root === r._canonical(root + "/one"), "inline root is not cwd-relative")
    })
    // A valid existing file wins even when its name looks like an inline map.
    r._args.absorbspec = root + '/{"sources":[]}'
    io.writeFileString(r._args.absorbspec, JSON.stringify([{ id: "one", root: "one", all: true }]))
    assert(r.run().ok, "file precedence or file array failed")
    ;[root + "/missing.json", "[]", "{}", "42", "null", "(sources:", '[{"id":"one"}]'].forEach(function(input) {
      r._args.absorbspec = input
      assert(!r.run().ok, "Invalid inline spec accepted: " + input)
    })
  }) }
  exports.testMultipleSourcesAndRepeat = function() { fixture(function(root, r) {
    io.writeFileString(root + "/one/a.md", "# A\nA facts")
    io.writeFileString(root + "/two/b.md", "# B\nB facts")
    io.writeFileString(root + "/dst/topic.md", "---\ntitle: Mine\n---\n# Topic\nLocal paragraph\n")
    var before = io.readFileString(root + "/dst/topic.md")
    model(r, [proposal("topic.md", "", "\n## Facts\nA facts and B facts\n", ["one:a.md", "two:b.md"]), proposal("other.md", "", "# Other\nA facts\n", ["one:a.md"])])
    var p = r.run(); assert(p.ok, JSON.stringify(p)); assert(io.readFileString(root + "/dst/topic.md") === before, "planning mutated page")
    assert(run(r, "show", p.id).plan.operations.length === 2)
    assert(run(r, "apply", p.id).ok); assert(io.readFileString(root + "/dst/topic.md").indexOf(before) === 0)
    assert(run(r, "plan").plan.operations.length === 0, "rerun not empty")
    assert(run(r, "resume", p.id).ok, "repeated resume")
    io.writeFileString(root + "/one/a.md", "# A\nNew facts")
    model(r, [proposal("topic.md", "## Facts\nA facts and B facts\n", "## Facts\nNew facts and B facts\n", ["one:a.md", "two:b.md"]), proposal("other.md", "A facts", "New facts", ["one:a.md"])])
    var update = run(r, "plan"); assert(update.ok, JSON.stringify(update)); assert(run(r, "apply", update.id).ok)
    assert(io.readFileString(root + "/dst/topic.md").indexOf("New facts") >= 0)
  }) }
  exports.testSelectionsAndBudgets = function() { fixture(function(root, r) {
    io.writeFileString(root + "/one/a.md", "---\ntags: [exact]\n---\n# A\nIntro\n## Pick\nchosen\n## Skip\nsecret")
    io.writeFileString(root + "/one/b.md", "# B\nTopicword")
    io.writeFileString(root + "/one/index.md", "index secret")
    io.writeFileString(root + "/one/AGENTS.md", "instructions")
    io.writeFileString(root + "/sources.json", JSON.stringify({ sources: [{ id: "one", root: "one", paths: ["a.md#pick"], topic: "Topicword", exclude: ["b.md"] }] }))
    model(r, [proposal("chosen.md", "", "# Chosen\nchosen", ["one:a.md#pick"])])
    var p = r.run(); assert(p.ok, JSON.stringify(p)); assert(p.plan.selected.length === 1); assert(p.plan.selected[0].raw.indexOf("secret") < 0)
    r._args.absorbmaxtokens = 1; assert(!r.run().plan.complete)
    delete r._args.absorbmaxtokens
    io.writeFileString(root + "/sources.json", JSON.stringify({ sources: [{ id: "one", root: "one", tags: ["exact"] }] }))
    model(r, [proposal("chosen.md", "", "# Chosen", ["one:a.md"])])
    assert(r.run().plan.selected.length === 1)
    io.writeFileString(root + "/sources.json", JSON.stringify({ sources: [{ id: "one", root: "one", all: true }] }))
    r._args.absorbmaxpages = 1; assert(!r.run().plan.complete)
  }) }
  exports.testConflictsAndEvidence = function() { fixture(function(root, r) {
    io.writeFileString(root + "/one/a.md", "A")
    io.writeFileString(root + "/two/b.md", "B")
    model(r, [proposal("a.md", "", "A", ["one:a.md"]), proposal("b.md", "", "B", ["two:b.md"])], [{ path: "a.md", reason: "contradiction" }])
    var p = r.run(); assert(p.status === "partial", JSON.stringify(p))
    var applied = run(r, "apply", p.id); assert(applied.status === "partial"); assert(!io.fileExists(root + "/dst/a.md")); assert(io.fileExists(root + "/dst/b.md"))
    model(r, [proposal("c.md", "", "invented", ["unknown"])])
    var bad = run(r, "plan"); assert(!bad.ok)
  }) }
  exports.testDuplicatesStaleAndPermissions = function() { fixture(function(root, r) {
    io.writeFileString(root + "/one/a.md", "# Same")
    io.writeFileString(root + "/dst/a.md", "# Same")
    var p = r.run(); assert(p.ok); assert(p.plan.modelUsage.calls === 0); assert(run(r, "apply", p.id).status === "noop")
    assert(run(r, "plan").plan.operations.length === 0)
    io.writeFileString(root + "/one/a.md", "# Changed")
    model(r, [proposal("a.md", "# Same", "# Changed", ["one:a.md"])])
    p = run(r, "plan"); io.writeFileString(root + "/dst/a.md", "# Local")
    assert(run(r, "apply", p.id).status === "stale")
    assert(run(r, "plan").plan.operations[0].blocked)
    r._args.wikiaccess = "ro"; assert(!run(r, "apply", p.id).ok); assert(!run(r, "plan").ok)
    r._args.absorboutput = root + "/out"; assert(run(r, "plan").id)
  }) }
  exports.testRecoveryAndLock = function() { fixture(function(root, r) {
    io.writeFileString(root + "/one/a.md", "# A")
    model(r, [proposal("a.md", "", "# A", ["one:a.md"])])
    var p = r.run(), fail = true
    r._afterWrite = function() { if (fail) { fail = false; throw new Error("injected interruption") } }
    assert(run(r, "apply", p.id).status === "recovery-required")
    var ingestion = new MiniAIngest({ usewiki: true, wikiaccess: "rw", wikiroot: root + "/dst", ingestsource: root + "/one", ingestmode: "raw" }, function() {}).run()
    assert(!ingestion.ok && /unfinished absorption/.test(ingestion.error || ""), JSON.stringify(ingestion))
    assert(!run(r, "apply", p.id).ok)
    r._finalize = function() { throw new Error("injected finalize failure") }
    assert(run(r, "resume", p.id).status === "recovery-required")
    assert(io.fileExists(root + "/dst/.mini-a-wiki-absorb/baseline.json"))
    r._finalize = function() { return { ok: true, reindexed: true } }
    assert(run(r, "resume", p.id).ok); assert(run(r, "resume", p.id).ok)
    io.writeFileString(root + "/one/b.md", "# B")
    model(r, [proposal("b.md", "", "# B", ["one:b.md"])])
    p = run(r, "plan")
    var file = new java.io.RandomAccessFile(root + "/dst/.mini-a-wiki-ingest/writer.lock", "rw"), lock = file.getChannel().tryLock()
    try { assert(!run(r, "apply", p.id).ok) } finally { lock.release(); file.close() }
    io.writeFileString(root + "/dst/.mini-a-wiki-ingest/journal.json", '{"phase":"prepared"}')
    assert(!run(r, "apply", p.id).ok)
  }) }
  exports.testLinksAndSkill = function() { fixture(function(root, r) {
    io.writeFileString(root + "/one/a.md", "# A\n[B](b.md#detail)")
    io.writeFileString(root + "/one/b.md", "# B\n## Detail\nFacts")
    model(r, [proposal("topics/a.md", "", "# A\n[B](b.md#detail)", ["one:a.md"]), proposal("topics/b.md", "", "# B\n## Detail\nFacts", ["one:b.md"])])
    var p = r.run(); assert(p.ok, JSON.stringify(p)); assert(p.plan.operations[0].after.indexOf("/topics/b.md#detail") >= 0, JSON.stringify(p))
    var applied = run(r, "apply", p.id); assert(applied.ok, JSON.stringify(applied))
    io.writeFileString(root + "/two/deploy-skill.md", "---\nschema: mini-a.skill/v1\nname: foo\n---\n# Skill\n{{args}}")
    model(r, [proposal("deploy-skill.md", "", "# Skill", ["two:deploy-skill.md"])])
    p = run(r, "plan"); assert(!p.ok, JSON.stringify(p)); assert(p.plan.operations.some(function(o) { return /intact/.test(o.blocked || "") }), JSON.stringify(p))
  }) }
  exports.testRemovalRelocationAndUnsafe = function() { fixture(function(root, r) {
    io.writeFileString(root + "/dst/a.md", "# Local\nKeep\n")
    io.writeFileString(root + "/one/a.md", "Fact")
    model(r, [proposal("a.md", "", "\n## Fact\nFact\n", ["one:a.md"])])
    var p = r.run(); assert(run(r, "apply", p.id).ok)
    new java.io.File(root + "/one").renameTo(new java.io.File(root + "/moved"))
    io.writeFileString(root + "/sources.json", JSON.stringify({ sources: [{ id: "one", root: "moved", all: true }, { id: "two", root: "two", all: true }] }))
    assert(run(r, "plan").plan.operations.length === 0)
    io.rm(root + "/moved/a.md")
    p = run(r, "plan"); assert(p.ok, JSON.stringify(p)); assert(run(r, "apply", p.id).ok); assert(io.readFileString(root + "/dst/a.md") === "# Local\nKeep\n")
    io.writeFileString(root + "/moved/a.md", "Fact")
    model(r, [proposal("../escape.md", "", "bad", ["one:a.md"])])
    assert(!run(r, "plan").ok)
    io.writeFileString(root + "/sources.json", JSON.stringify({ sources: [{ id: "x", root: "dst", all: true }] }))
    assert(!run(r, "plan").ok)
  }) }
  exports.testUnavailableAndSourceStale = function() { fixture(function(root, r) {
    io.writeFileString(root + "/one/a.md", "# A")
    r._ingest._buildLlm = function() { return undefined }
    var p = r.run(); assert(!p.plan.complete); assert(!run(r, "apply", p.id).ok)
    model(r, [proposal("a.md", "", "# A", ["one:a.md"])])
    p = run(r, "plan"); io.writeFileString(root + "/one/a.md", "# Revised")
    assert(run(r, "apply", p.id).status === "stale")
  }) }

  exports.testRealFinalization = function() { fixture(function(root, r) {
    delete r._finalize
    r._args.usewikigraph = true
    r._args.wikigraphsemantic = true // apply must override this setting
    io.writeFileString(root + "/one/a.md", "# A\nFacts")
    model(r, [proposal("concepts/a.md", "", "# A\nFacts", ["one:a.md"])])
    var p = r.run(); assert(p.ok, JSON.stringify(p))
    r._llm = { prompt: function() { throw new Error("Apply called model") } }
    var result = run(r, "apply", p.id); assert(result.ok, JSON.stringify(result))
    assert(io.fileExists(root + "/dst/index.md")); assert(io.fileExists(root + "/dst/concepts/index.md"))
    assert(io.readFileString(root + "/dst/index.md").indexOf(".mini-a-wiki-absorb") < 0, "private plan leaked into navigation")
    assert(run(r, "plan").plan.operations.length === 0, "finalization changed knowledge inventory")
  }) }
  exports.testMissingLinksAndDependencies = function() { fixture(function(root, r) {
    io.writeFileString(root + "/one/a.md", "# A\n[B](b.md)")
    io.writeFileString(root + "/one/b.md", "# B")
    io.writeFileString(root + "/sources.json", JSON.stringify({ sources: [{ id: "one", root: "one", paths: ["a.md"] }] }))
    model(r, [proposal("a.md", "", "# A", ["one:a.md"])])
    var p = r.run(); assert(p.plan.operations[0].blocked); assert(p.plan.findings.some(function(f) { return f.expansion }))
    io.writeFileString(root + "/sources.json", JSON.stringify({ sources: [{ id: "one", root: "one", all: true }] }))
    var a = proposal("a.md", "", "# A\n[B](/b.md)", ["one:a.md"]), b = proposal("b.md", "", "# B", ["one:b.md"])
    a.dependencies = ["b.md"]
    model(r, [a, b], [{ path: "b.md", reason: "cross-source disagreement" }])
    p = r.run(); assert(p.plan.operations.every(function(o) { return o.blocked }))
  }) }
  exports.testSelectionNarrowingAndSharedSupport = function() { fixture(function(root, r) {
    io.writeFileString(root + "/dst/a.md", "# A\nLocal\n")
    io.writeFileString(root + "/one/a.md", "Fact")
    io.writeFileString(root + "/two/b.md", "Fact")
    model(r, [proposal("a.md", "", "\n## Fact\nFact", ["one:a.md", "two:b.md"])])
    var p = r.run(); assert(run(r, "apply", p.id).ok)
    io.rm(root + "/one/a.md")
    p = run(r, "plan"); assert(p.plan.operations.length === 0); assert(p.plan.findings.length > 0)
    io.writeFileString(root + "/sources.json", JSON.stringify({ sources: [{ id: "two", root: "two", all: true, exclude: ["b.md"] }] }))
    p = run(r, "plan"); assert(p.plan.operations.length === 0); assert(io.readFileString(root + "/dst/a.md").indexOf("Fact") >= 0)
  }) }
  exports.testInvalidSpecsAndIntegrity = function() { fixture(function(root, r) {
    io.writeFileString(root + "/sources.json", JSON.stringify({ sources: [{ id: "one", root: "one" }] }))
    assert(!r.run().ok)
    io.writeFileString(root + "/sources.json", JSON.stringify({ sources: [{ id: "one", root: "one", all: true }, { id: "one", root: "two", all: true }] }))
    assert(!r.run().ok)
    io.writeFileString(root + "/sources.json", JSON.stringify({ sources: [{ id: "one", root: "absent", all: true }] }))
    assert(!r.run().ok)
    io.writeFileString(root + "/sources.json", JSON.stringify({ sources: [{ id: "one", root: "one", all: true }] }))
    io.writeFileString(root + "/one/a.md", "# A")
    model(r, [proposal("a.md", "", "# A", ["one:a.md"])])
    var p = r.run(), file = root + "/dst/.mini-a-wiki-absorb/plans/" + p.id + ".json"
    var envelope = af.fromJson(io.readFileString(file)); envelope.plan.operations[0].after = "tampered"
    io.writeFileString(file, JSON.stringify(envelope)); assert(!run(r, "apply", p.id).ok)
  }) }
  exports.testRecoveryConflictingEditsAndProvenance = function() { fixture(function(root, r) {
    io.writeFileString(root + "/one/a.md", "# A")
    model(r, [proposal("a.md", "", "# A", ["one:a.md"])])
    var p = r.run(), save = r._save, fail = true
    r._save = function(path, value) {
      if (/baseline.json$/.test(path) && fail) { fail = false; throw new Error("Injected provenance persistence failure") }
      return save.call(this, path, value)
    }
    assert(run(r, "apply", p.id).status === "recovery-required")
    io.writeFileString(root + "/dst/a.md", "local edit")
    assert(!run(r, "resume", p.id).ok)
    io.writeFileString(root + "/dst/a.md", "# A")
    assert(run(r, "resume", p.id).ok)
    assert(r._baseline().records[0].evidence[0].raw === "# A")
  }) }
  exports.testModelFailureAndTopic = function() { fixture(function(root, r) {
    io.writeFileString(root + "/one/a.md", "# A\nCandidate topic")
    io.writeFileString(root + "/sources.json", JSON.stringify({ sources: [{ id: "one", root: "one", topic: "candidate" }] }))
    r._llm = { prompt: function() { throw new Error("provider unavailable") } }
    var p = r.run(); assert(p.id && !p.plan.complete)
    model(r, [], [], ["one:a.md"])
    p = r.run(); assert(p.ok && p.plan.operations.length === 0)
    io.writeFileString(root + "/sources.json", JSON.stringify({ sources: [{ id: "one", root: "one", paths: ["a.md#missing"] }] }))
    assert(!r.run().plan.complete)
  }) }

  exports.testDuplicateSectionWithEnrichment = function() { fixture(function(root, r) {
    io.writeFileString(root + "/one/a.md", "## Known\nFact\n")
    io.writeFileString(root + "/two/b.md", "New fact")
    io.writeFileString(root + "/dst/topic.md", "# Topic\n\n## Known\nFact\n")
    model(r, [proposal("topic.md", "", "\n## New\nNew fact\n", ["two:b.md"])])
    var p = r.run(); assert(p.ok, JSON.stringify(p)); assert(p.plan.duplicates.length === 1); assert(p.plan.operations.length === 1)
    assert(p.plan.operations[0].evidence.length === 2); assert(run(r, "apply", p.id).ok)
  }) }
  exports.testPendingContributionAfterPartialUpdate = function() { fixture(function(root, r) {
    io.writeFileString(root + "/one/a.md", "Old fact")
    model(r, [proposal("a.md", "", "# A\nOld fact", ["one:a.md"]), proposal("b.md", "", "# B\nOld fact", ["one:a.md"])])
    var p = r.run(); assert(run(r, "apply", p.id).ok)
    io.writeFileString(root + "/one/a.md", "New fact")
    model(r, [proposal("a.md", "Old fact", "New fact", ["one:a.md"]), proposal("b.md", "Old fact", "New fact", ["one:a.md"])], [{ path: "b.md", reason: "review" }])
    p = run(r, "plan"); assert(run(r, "apply", p.id).status === "partial")
    model(r, [proposal("b.md", "Old fact", "New fact", ["one:a.md"])])
    p = run(r, "plan"); assert(p.plan.operations.length === 1, JSON.stringify(p)); assert(run(r, "apply", p.id).ok)
    assert(run(r, "plan").plan.operations.length === 0)
  }) }
  exports.testRenamedAnchorsAndSymlinks = function() { fixture(function(root, r) {
    io.writeFileString(root + "/one/a.md", "# A\n[B](b.md#old)")
    io.writeFileString(root + "/one/b.md", "## Old\nFact")
    var a = proposal("a.md", "", "# A\n[B](b.md#old)", ["one:a.md"]), b = proposal("b.md", "", "## New\nFact", ["one:b.md"])
    b.mappings.push({ evidence: "one:b.md", sourceAnchor: "old", anchor: "new" })
    model(r, [a, b])
    var p = r.run(); assert(p.ok, JSON.stringify(p)); assert(p.plan.operations[0].after.indexOf("/b.md#new") >= 0)
    var external = root + "/external"; io.mkdir(external)
    java.nio.file.Files.createSymbolicLink(new java.io.File(root + "/dst/escape").toPath(), new java.io.File(external).toPath())
    model(r, [proposal("escape/a.md", "", "# A", ["one:a.md"]), b])
    p = r.run(); assert(!p.ok); assert(!io.fileExists(external + "/a.md"))
  }) }

  exports.testRemovedSelectedHeading = function() { fixture(function(root, r) {
    io.writeFileString(root + "/one/a.md", "# A\nLocal source\n## Removable\nFact")
    io.writeFileString(root + "/dst/a.md", "# Destination\nLocal content\n")
    io.writeFileString(root + "/sources.json", JSON.stringify({ sources: [{ id: "one", root: "one", paths: ["a.md#removable"] }] }))
    model(r, [proposal("a.md", "", "\n## Removable\nFact", ["one:a.md#removable"])])
    var p = r.run(); assert(p.ok, JSON.stringify(p)); assert(run(r, "apply", p.id).ok)
    io.writeFileString(root + "/one/a.md", "# A\nLocal source")
    p = run(r, "plan"); assert(p.ok, JSON.stringify(p)); assert(run(r, "apply", p.id).ok)
    assert(io.readFileString(root + "/dst/a.md") === "# Destination\nLocal content\n")
  }) }

  exports.testBorrowedConsoleManager = function() { fixture(function(root, r) {
    delete r._finalize
    var wm = new MiniAWikiManager({ root: root + "/dst", backend: "fs", access: "rw", usegraph: true, wikigraphsemantic: true, llmExtractFn: function() { throw new Error("Semantic model call during apply") } }, function() {})
    try {
      r._args.wikimanager = wm
      io.writeFileString(root + "/one/a.md", "# A\nBorrowed manager content")
      model(r, [proposal("a.md", "", "# A\nBorrowed manager content", ["one:a.md"])])
      var p = r.run(); assert(p.ok, JSON.stringify(p))
      var result = run(r, "apply", p.id); assert(result.ok, JSON.stringify(result)); assert(result.finalization.graph === "rebuilt")
      assert(wm._config.wikigraphsemantic === true, "console graph preference not restored")
      assert(wm.read("a.md").body.indexOf("Borrowed manager content") >= 0)
    } finally { wm.close() }
  }) }
})()
