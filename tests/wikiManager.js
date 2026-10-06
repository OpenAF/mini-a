(function() {
  global.__mini_a_wikiman_lib_mode = true
  load("mini-a-wikiman.js")
  function fixture(fn) {
    var root = String(io.createTempFile("wikiman-test-", ""))
    io.rm(root); io.mkdir(root)
    var runner = new MiniAWikiOps({ wikiroot: root, wikiaccess: "rw", wikiretrievalv2: false, usewikigraph: true })
    try { fn(root, runner) } finally { io.rm(root) }
  }
  function run(runner, id, params, confirm) { return runner.execute(runner.spec(id, params || {}), { confirm: confirm === true }) }
  function assert(value, expected, message) { ow.test.assert(value, expected, message) }
  function throws(fn, text) {
    var message = ""
    try { fn() } catch(e) { message = String(e.message || e) }
    assert(message.indexOf(text) >= 0, true, "Expected error containing " + text + ": " + message)
  }
  exports.testMutationGates = function() {
    fixture(function(root, runner) {
      var before = io.listFiles(root).files.length
      assert(run(runner, "wiki.init").ok, false, "No unconfirmed writes")
      assert(io.listFiles(root).files.length, before, "Gate runs before manager initialization")
      assert(run(runner, "wiki.init", {}, true).ok, true, "Confirmed init succeeds")
      var ro = new MiniAWikiOps({ wikiroot: root, wikiaccess: "ro" })
      assert(run(ro, "dream.apply", {}, true).ok, false, "Dream cannot upgrade read-only access")
      assert(run(ro, "graph.falkor", { query: "CREATE (n)" }, true).ok, false, "Arbitrary queries require write access")
    })
  }
  exports.testConfigurationAndMounts = function() {
    throws(function() { new MiniAWikiOps({}).config() }, "explicit wikiroot")
    throws(function() { new MiniAWikiOps({wikibackend:"oops"}).config() }, "Unsupported")
    fixture(function(root) {
      var runner = new MiniAWikiOps({wikiaccess:"rw", wikimounts:[{name:"docs",root:root,access:"rw"}], wikitarget:"docs"})
      assert(runner.targetConfig().access,"ro","Mounts cannot acquire write access")
      assert(run(runner,"wiki.init",{},true).ok,false,"Mounted writes refused")
      assert(runner.config().__catalog,true,"Mount-only session uses catalog")
      var http = new MiniAWikiOps({wikibackend:"https",wikiurl:"https://example.invalid/wiki",wikiaccess:"rw"})
      assert(run(http,"dream.reorg",{},true).ok,false,"HTTP mutation refused without opening backend")
    })
  }
  exports.testParameterValidation = function() {
    var runner = new MiniAWikiOps({wikiroot:"/tmp"})
    throws(function() { runner.spec("unknown", {}) }, "Unknown")
    throws(function() { runner.spec("wiki.write", {path:"a.md"}) }, "contentfile")
    throws(function() { runner.spec("wiki.context", {wikiaccess:"rw"}) }, "configuration")
    throws(function() { runner.spec("wiki.compact", {dryRun:"maybe"}) }, "boolean")
    throws(function() { runner.spec("wiki.read", {path:"a.md",maxLines:-1}) }, "integer")
    assert(runner.spec("wiki.compact", {dryRun:"true"}).params.dryRun,true,"String booleans normalized before dispatch")
  }
  exports.testFileOperations = function() {
    fixture(function(root, runner) {
      assert(run(runner,"wiki.init",{},true).ok,true,"Init")
      var content = root + "/content.txt"
      io.writeFileString(content,"---\ntitle: Example\n---\n# Example\nline one\nline two\n")
      assert(run(runner,"wiki.write",{path:"example.md",contentfile:content},true).ok,true,"Managed write")
      var read = run(runner,"wiki.read",{path:"example.md",maxLines:2})
      assert(read.lineEnd,2,"Bounded reads")
      assert(run(runner,"wiki.read",{path:"missing.md"}).ok,false,"Missing pages fail")
      assert(isArray(run(runner,"wiki.list")),true,"List")
      assert(run(runner,"wiki.move",{from:"example.md",to:"renamed.md"},true).ok,true,"Move")
      assert(run(runner,"wiki.lint",{limit:1}).issues.length <= 1,true,"Bounded lint")
      assert(run(runner,"wiki.delete",{path:"renamed.md"},true).ok,true,"Delete")
    })
  }
  exports.testGraphAndIndexes = function() {
    fixture(function(root, runner) {
      run(runner,"wiki.init",{},true)
      var built = run(runner,"graph.build",{semantic:false},true)
      assert(built.ok,true,"Structural graph builds without a model")
      assert(isString(run(runner,"graph.export",{format:"mermaid"})),true,"Graph export")
      assert(isMap(run(runner,"graph.stats")),true,"Graph stats")
      assert(run(runner,"wiki.reindex",{},true).ok,true,"Reindex")
      assert(run(runner,"wiki.indexes",{},true).ok,true,"Directory indexes")
      var compact = run(runner,"wiki.compact")
      assert(compact.ok,false,"Legacy compaction disabled")
    })
  }
  exports.testShellReplay = function() {
    var root = "/tmp/a ' wiki $(touch never) `never` á"
    var runner = new MiniAWikiOps({wikiroot:root,wikiaccess:"rw",wikilexical:{language:"portuguese"},model:"local-model",dreamwikireorg:true,dreamwikiapproval:"auto"})
    var spec = runner.spec("dream.reorg",{instructions:"Move only guides\nKeep old links"})
    var replay = runner.command(spec,{confirm:true,backupconfirmed:true})
    var parsed = MiniAWikiMan.editorArgs(replay.command)
    assert(parsed.indexOf("wikiroot="+MiniAWikiOps.absolute(root))>=0,true,"Shell quote round trip")
    assert(parsed.indexOf("params="+JSON.stringify(spec.params))>=0,true,"Multiline JSON round trip")
    assert(parsed.indexOf("dreamwikiapproval=auto")>=0,true,"Replay includes explicit reorg gate")
    assert(parsed.indexOf("backupconfirmed=true")>=0,true,"Replay includes backup acknowledgment")
    assert(parsed.indexOf('wikilexical={"language":"portuguese"}')>=0,true,"Lexical overrides preserved")
    runner.args.dreamwikiapproval = "never"
    assert(runner.command(spec,{confirm:true,backupconfirmed:true}).command.indexOf("dreamwikiapproval=never")>=0,true,"Replay preserves explicit denial rather than granting approval")
  }
  exports.testSecretRedaction = function() {
    var args = {wikiroot:"/tmp/wiki",wikisecret:"SECRET_VALUE",model:{type:"openai",key:"MODEL_SECRET"},wikimounts:[{name:"remote",secret:"MOUNT_SECRET"}]}
    var runner = new MiniAWikiOps(args), replay = runner.command(runner.spec("wiki.context"),{})
    assert(/SECRET_VALUE|MODEL_SECRET|MOUNT_SECRET/.test(replay.command),false,"Replay contains no credentials")
    assert(replay.prerequisites.length,3,"Credential environment prerequisites")
    var sanitized = MiniAWikiOps.sanitize({ok:true,secret:"SECRET_VALUE",message:"failed SECRET_VALUE MODEL_SECRET MOUNT_SECRET"},args)
    assert(sanitized.ok,true,"Sanitization preserves result structure")
    assert(/SECRET_VALUE|MODEL_SECRET|MOUNT_SECRET/.test(JSON.stringify(sanitized)),false,"Error and history redaction")
  }
  exports.testReorgConfirmations = function() {
    var executed = [], printed = [], choices = [], prompts = []
    var man = new MiniAWikiMan({wikiroot:"/tmp/wiki",wikiaccess:"rw",model:"test"},{
      choose:function(prompt) { prompts.push(prompt); return choices.shift() }, ask:function() { return "Keep titles" },print:function(v) { printed.push(v) }
    })
    man.runner = function() {
      var runner = new MiniAWikiOps(man.args)
      runner.execute = function(spec,gates) { executed.push({spec:spec,gates:gates,args:runner.args}); return {ok:true} }
      return runner
    }
    choices = [0]; man.runOperation("dream.reorg")
    assert(executed.length,0,"First confirmation refusal stops execution")
    choices = [1,0]; man.runOperation("dream.reorg")
    assert(executed.length,0,"Second confirmation refusal stops execution")
    choices = [1,1]; man.runOperation("dream.reorg")
    assert(executed.length,1,"Both confirmations execute once")
    assert(executed[0].gates.backupconfirmed,true,"Backup acknowledgement")
    assert(executed[0].args.dreamwikireorg,true,"Existing reorg gate")
    assert(executed[0].args.dreammaxsteps,40,"Effective limits materialized")
    assert(man.history.length,1,"Canceled runs are not recorded")
  }
  exports.testCompactionConfirmations = function() {
    var calls = [], choices = [1,0]
    var man = new MiniAWikiMan({wikiroot:"/tmp/wiki",wikiaccess:"rw"},{choose:function(){return choices.shift()},ask:function(){return ""},print:function(){}})
    man.runner = function() {
      var r = new MiniAWikiOps(man.args)
      r.execute = function(spec,gates) {calls.push({params:clone(spec.params),gates:clone(gates)});return {ok:true}}
      return r
    }
    man.runOperation("wiki.compact")
    assert(calls.length,1,"Refusing offline confirmation performs only preview")
    choices = [1,1]; calls = []
    man.runOperation("wiki.compact")
    assert(calls.length,2,"Preview then apply")
    assert(calls[0].params.dryRun,true,"First call is preview")
    assert(calls[1].params.offline,true,"Offline confirmation forwarded")
  }
  exports.testRecordExport = function() {
    fixture(function(root) {
      var man = new MiniAWikiMan({wikiroot:root},{print:function(){}})
      var source = root+"/reviewed.md", output=root+"/run.json"
      io.writeFileString(source,"reviewed content")
      man.tempFiles.push(source)
      man.history.push({operation:"wiki.write",params:{contentfile:source},command:"ojob x 'params="+JSON.stringify({contentfile:source})+"'",result:{ok:true}})
      man.exportRecord(0,output)
      var saved=io.readFileJSON(output)
      assert(saved.command.indexOf(output+".content.md")>=0,true,"Export points to retained content")
      assert(io.readFileString(output+".content.md"),"reviewed content","Content exported")
      throws(function(){man.exportRecord(0,output)},"exists")
    })
  }
  exports.testLaunchAndGuidance = function() {
    var consoleSource=io.readFileString("mini-a-session.js"), dreamSource=io.readFileString("mini-a-dreams.js")
    assert(consoleSource.indexOf('wikiman=true conflicts with')>=0,true,"Conflicting modes rejected")
    assert(io.readFileString("mini-a-subtask.js").indexOf('"wikiman"')>=0,true,"UI mode excluded from delegation")
    assert(dreamSource.indexOf('dreamArgs.goal += "\\n\\nAdditional operator guidance')>=0,true,"Guidance appended to established goal")
    assert(dreamSource.indexOf('dreamArgs.useshell    = false')>=0,true,"Shell restriction remains")
  }
  exports.testDreamAndIngestion = function() {
    fixture(function(root, runner) {
      runner.args.usewikigraph = false
      run(runner, "wiki.init", {}, true)
      assert(run(runner, "dream.plan").ok, true, "Model-free Dream plan")
      assert(run(runner, "dream.repair", {}, true).ok, true, "Deterministic Dream repair")
      var source = root + "/source"
      io.mkdir(source); io.writeFileString(source + "/guide.md", "# Guide\nA useful guide to ingestion.\n")
      var preview = run(runner, "ingest.run", { source: source, section: "imported", mode: "raw", dryrun: true })
      assert(preview.ok, true, "Model-free ingestion preview")
      var applied = run(runner, "ingest.run", { source: source, section: "imported", mode: "raw", dryrun: false }, true)
      assert(applied.ok, true, "Model-free ingestion apply")
      assert(run(runner, "ingest.recovery").ok, true, "Recovery listing")
      assert(run(runner, "absorb.status").ok, true, "Absorption status")
    })
  }
  exports.testAutoDream = function() {
    fixture(function(root, runner) {
      runner.args.usewikigraph = false
      runner.args.dreamwikillm = false
      io.writeFileString(root + "/page.md", "# Page\n\nA page needing metadata and navigation.\n")
      assert(MiniAWikiOps.operation("dream.auto").group, "Dream", "Auto appears in Dream menu")
      var preview = run(runner, "dream.auto")
      assert(preview.status, "planned", "Manager auto defaults to dry-run")
      assert(io.fileExists(root + "/.mini-a-wiki-maintenance"), false, "Preview has no backups")
      assert(run(runner, "dream.auto", {dryrun:false}).ok, false, "Apply retains operation confirmation")
      var ro = new MiniAWikiOps({wikiroot:root, wikiretrievalv2:false, dreamwikillm:false})
      assert(run(ro, "dream.auto", {dryrun:false}, true).ok, false, "Auto never upgrades implicit read-only access")
      assert(run(ro, "dream.auto").status, "planned", "Read-only preview allowed")
      var result = run(runner, "dream.auto", {dryrun:false}, true)
      assert(result.mode, "auto", "Shared coordinator executes auto")
      assert(result.verification.ok, true, "Repairs verified through fresh reader")
      assert(isString(result.backup_location), true, "Full recovery report returned")
      var mounted = new MiniAWikiOps({wikiroot:root, wikiaccess:"rw", wikimounts:[{name:"docs",root:root}], wikitarget:"docs"})
      assert(run(mounted, "dream.auto").ok, false, "Auto excludes mounted targets")
      var choices = [0, 1], shown = []
      var man = new MiniAWikiMan(runner.args, {choose:function(){return choices.shift()}, print:function(v){shown.push(v)}})
      man.runOperation("dream.auto")
      assert(man.history[0].result.status, "planned", "TUI preview reaches coordinator")
      assert(shown.some(function(v){return isMap(v) && v.mode === "auto" && isDef(v.verification)}), true, "TUI displays complete auto report")
    })
  }
  exports.testV2Compaction = function() {
    fixture(function(root) {
      var runner = new MiniAWikiOps({wikiroot:root,wikiaccess:"rw",wikiretrievalv2:true})
      assert(run(runner,"wiki.init",{},true).ok,true,"V2 init")
      assert(run(runner,"wiki.reindex",{},true).ok,true,"V2 publish")
      assert(run(runner,"wiki.compact").ok,true,"V2 preview")
      var source = root + "/source"
      io.mkdir(source); io.writeFileString(source+"/note.md", "# A source note\n")
      assert(run(runner,"ingest.run",{source:source,mode:"raw",dryrun:true}).ok,true,"V2 reader preview avoids cyclic configuration copies")
      assert(run(runner,"ingest.recovery").ok,true,"V2 recovery listing")
      assert(run(runner,"wiki.compact",{dryRun:false},true).ok,false,"Offline gate enforced by runner")
      assert(run(runner,"wiki.compact",{dryRun:false,offline:true},true).ok,true,"V2 offline compaction")
    })
  }
  exports.testMountedReadTarget = function() {
    fixture(function(root, runner) {
      run(runner,"wiki.init",{},true)
      var mount = root + "/mounted"
      io.mkdir(mount); io.writeFileString(mount+"/unique.md","# Mounted content\n")
      var selected = new MiniAWikiOps({wikiroot:root,wikiaccess:"rw",wikiretrievalv2:false,wikimounts:[{name:"docs",root:mount,wikiretrievalv2:false}],wikitarget:"docs"})
      assert(run(selected,"wiki.read",{path:"unique.md"}).body.indexOf("Mounted content")>=0,true,"Read targets selected mount")
      assert(run(selected,"absorb.status").ok,true,"Mounted absorption status is readable")
      assert(run(selected,"wiki.delete",{path:"unique.md"},true).ok,false,"Mounted deletion refused")
      assert(io.fileExists(mount+"/unique.md"),true,"Mount source remains intact")
    })
  }
  exports.testEditorArgumentsAndFailure = function() {
    assert(MiniAWikiMan.editorArgs('code --wait "file with spaces"'),["code","--wait","file with spaces"],"Editor parsed without a shell")
    throws(function(){MiniAWikiMan.editorArgs('code "unterminated')},"Unbalanced")
    var runner = new MiniAWikiOps({wikiroot:"/tmp",wikiaccess:"rw"})
    assert(runner.execute({operation:"unknown",params:{}},{}).ok,false,"Dispatcher failures remain structured")
    assert(new MiniAWikiOps({wikiroot:"/tmp",dreammaxsteps:"17"}).args.dreammaxsteps,17,"CLI numeric tuning normalized")
  }
  exports.testGraphStatsConsoleParity = function() {
    var source = io.readFileString("mini-a-session.js")
    var start = source.indexOf("  function printGraph("), end = source.indexOf("  function printIngestRecovery(", start)
    var consoleStats = new Function("wm", "capture", 'var getConsoleWikiManager=function(){return wm}, print=function(){}, printTree=function(v){capture(v);return ""};\n' + source.substring(start,end) + '\nprintGraph("stats");')
    fixture(function(root, runner) {
      function compare(label) {
        var wm = __miniAWikiCreatePrimary(runner.config()), expected
        try { consoleStats(wm,function(value){expected=value}) } finally { wm.close() }
        assert(run(runner,"graph.stats"),expected,label)
      }
      compare("Unbuilt writable graph matches /graph stats instead of returning a reader error")
      run(runner,"wiki.init",{},true)
      run(runner,"graph.build",{semantic:false},true)
      compare("Persisted writable graph matches /graph stats")
      runner.args.wikiaccess = "ro"
      compare("Read-only graph matches /graph stats")
      var entries = MiniAWikiOps.catalog.filter(function(op){return op.group === "Graph"})
      assert(entries[0].id,"graph.stats","Console stats is the first graph menu item")
      assert(entries[0].title.indexOf("/graph stats") >= 0,true,"Menu makes console equivalence explicit")
    })
  }
  exports.testSinglePrimarySkipsTargetPicker = function() {
    fixture(function(root) {
      function prompts(args) {
        var seen = []
        var man = new MiniAWikiMan(args, {print:function(){},ask:function(){throw new Error("Unexpected text prompt")},choose:function(prompt){seen.push(prompt);return prompt === "Select wiki" ? 0 : 7}})
        man.run()
        return seen
      }
      assert(prompts({wikiroot:root}),["Wiki operations"],"Single primary opens operations directly")
      assert(prompts({wikiroot:root,wikimounts:[]}),["Wiki operations"],"Empty mount list needs no picker")
      assert(prompts({wikiroot:root,wikimounts:[{name:"docs",root:root}]}),["Select wiki","Wiki operations"],"Configured mounts retain selection")
      assert(prompts({wikiroot:root,wikimounts:[{name:"docs",root:root}],wikitarget:"docs"}),["Wiki operations"],"Explicit mounted target remains selected")
    })
  }
  exports.testCategoryUX = function() {
    var step = 0, calls = [], printed = [], full = {ok:true, rows:[1,2,3,4,5]}
    var man = new MiniAWikiMan({wikiroot:"/tmp/wiki"}, {
      print:function(v) { printed.push(v) },
      choose:function(prompt, labels) {
        step++
        if (step === 1) return 2
        if (step === 2) { assert(labels[0].indexOf("List pages [last used]") >= 0,true,"Last operation retained first"); return labels.length - 3 }
        if (step === 3) return 0
        if (step === 4) return labels.length - 2
        return labels.length - 1
      }
    })
    man.showCurrentWiki = function() {}
    man.runOperation = function(id, advanced) { calls.push([id,advanced]); man.history.push({result:full}) }
    man.category("Inspect")
    assert(calls,[["wiki.list",false],["wiki.list",true]],"Persistent submenu and opt-in advanced settings")
    assert(printed[0],full,"Details retain full output")
    var summary = MiniAWikiMan.summary(full)
    assert(summary.rows.count,5,"Summary retains collection count")
    assert(summary.rows.preview.length,3,"Preview bounded")
    assert(full.rows.length,5,"Summary does not mutate results")
  }
  exports.testReplayPresentation = function() {
    var runner = new MiniAWikiOps({wikiroot:"/tmp/a ' quoted wiki",wikisecret:"DO_NOT_DISPLAY"})
    var replay = runner.command(runner.spec("wiki.read",{path:"a.md"}),{}), original = replay.command
    assert(replay.displayCommand.replace(/\\\n[ ]*/g," ").indexOf("params="+JSON.stringify({startLine:1,maxLines:100,path:"a.md"}))>=0,true,"Continuations preserve complete quoted arguments")
    var formatted = MiniAWikiOps.formatReplay(replay)
    var plain = formatted.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    assert(plain, "💻 Run the same operation from the command line:\n" + replay.displayCommand + "\n" + replay.prerequisites.map(function(note) { return "Prerequisite: " + note }).join("\n"), "Presentation adds no side lines or copy-interfering prefixes")
    assert(replay.command.indexOf("cd "),0,"Raw command has no subshell wrapper")
    assert(replay.displayCommand.indexOf("cd "),0,"Displayed command has no subshell wrapper")
    assert(formatted.indexOf("DO_NOT_DISPLAY"),-1,"Formatting retains secret redaction")
    assert(replay.command,original,"History/export command remains plain and unchanged")
  }
})()
