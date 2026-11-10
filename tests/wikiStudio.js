(function() {
  loadLib(String(new java.io.File("js/studio/wiki-studio-api.js").getCanonicalPath()))
  loadLib(String(new java.io.File("js/studio/wiki-studio-pages.js").getCanonicalPath()))
  loadLib(String(new java.io.File("js/studio/wiki-studio-graph.js").getCanonicalPath()))
  loadLib(String(new java.io.File("js/studio/wiki-studio-jobs.js").getCanonicalPath()))
  loadLib(String(new java.io.File("js/studio/wiki-studio-sources.js").getCanonicalPath()))
  loadLib(String(new java.io.File("js/studio/wiki-studio-operations.js").getCanonicalPath()))
  loadLib(String(new java.io.File("js/studio/wiki-studio-backups.js").getCanonicalPath()))
  loadLib(String(new java.io.File("js/studio/wiki-studio-ingestion.js").getCanonicalPath()))
  function fixture(fn) {
    var temp = WikiStudio.canonical(String(io.createTempDir("wiki-studio-test-")))
    var config = { home: temp + "/state", roots: [temp + "/wikis"], base: WikiStudio.canonical("."), port: 18891, host: "127.0.0.1", token: "test-token-with-more-than-32-characters", maxPageBytes: 1048576, maxBodyBytes: 2097152, workers: 2 }
    WikiStudio.privateDir(config.home); WikiStudio.privateDir(temp + "/wikis"); WikiStudio.privateDir(temp + "/wikis/existing")
    var server = new WikiStudioServer(config)
    try { fn(server, temp) } finally { io.rm(temp) }
  }
  var assert = function(actual, expected, note) { ow.test.assert(actual, expected, note) }
  function rejects(fn, code) { var error; try { fn() } catch(e) { error = e.code } assert(error, code, "Expected rejection: " + code) }
  function add(s, temp, access) { return s.registry.add({ id: "alpha", name: "Alpha", root: temp + "/wikis/existing", access: access || "rw" }) }
  exports.testSourceIsolationAndMigration = function() { fixture(function(s,t) {
    var w = add(s,t), other = merge(w,{id:"alpha--part"})
    function upload(text) { var id=WikiStudio.id();s.streamUpload({role:"admin",headers:{"x-upload-id":id,"x-upload-path":"doc.md"}},new java.io.ByteArrayInputStream(WikiStudio.bytes(text)));return id }
    var first = s.sourceAdd(w,{id:"part--docs",name:"First",type:"upload",uploadId:upload("first")})
    var second = s.sourceAdd(other,{id:"docs",name:"Second",type:"upload",uploadId:upload("second")})
    assert(s.sourceList(w).length,1,"Wiki enumerates only its directory")
    assert(s.sourceGet(w,first.id).revision,first.revision,"Colliding legacy filename retains first owner")
    assert(s.sourceGet(other,second.id).revision,second.revision,"Colliding legacy filename retains second owner")
    var old = s.sourceGet(w,first.id), nextUpload=upload("new")
    WikiStudio.sourceLock(s.config.home,w.id,first.id,function(){rejects(function(){s.sourceAdd(w,{id:first.id,name:"New",type:"upload",uploadId:nextUpload})},"busy")})
    var updated=s.sourceAdd(w,{id:first.id,name:"New",type:"upload",uploadId:nextUpload})
    assert(s.sourceUpdateRun(w,{id:"old-job",params:{sourceId:first.id,revision:old.revision,dryrun:false}}, {ok:true}),false,"Older job cannot overwrite newer registration")
    assert(s.sourceGet(w,first.id).revision,updated.revision,"New revision remains published")
    assert(s.sourceUpdateRun(w,{id:"new-job",params:{sourceId:first.id,revision:updated.revision,dryrun:true}}, {ok:true}),true,"Matching revision receives run status")
    assert(s.sourceGet(w,first.id).lastRun,"new-job","Run update persisted")
    WikiStudio.atomic(s.sourcePath(w,"foreign"),{id:"foreign",wikiId:other.id})
    rejects(function(){s.sourceGet(w,"foreign")},"foreign_source");rejects(function(){s.sourceList(w)},"foreign_source")
    new java.io.File(s.sourcePath(w,"foreign")).delete()
    // Legacy registration is identified by embedded IDs, and a valid new record wins.
    WikiStudio.atomic(s.config.home+"/sources/"+w.id+"--"+first.id+".json",old)
    WikiStudio.atomic(s.config.home+"/sources/misleading.json",{wikiId:w.id,id:"legacy",revision:"legacy-upload",staging:"retained"})
    WikiStudio.atomic(s.config.home+"/sources/z-last.json",{wikiId:other.id,id:"last",revision:"last-upload"})
    var original=WikiStudio.atomic, interrupted=false
    WikiStudio.atomic=function(path,value){if(/\/last\.json$/.test(path)&&!interrupted){interrupted=true;throw new Error("simulated interruption")}return original(path,value)}
    try { try{s.migrateSources()}catch(e){assert(String(e).indexOf("simulated interruption")>=0,true,"Migration interruption fixture")} } finally {WikiStudio.atomic=original}
    assert(s.sourceGet(w,"legacy").revision,"legacy-upload","Already published migration record survives interruption")
    io.writeFileString(s.config.home+"/sources/corrupt.json","{invalid")
    var report=s.migrateSources()
    assert(report.warnings.some(function(warning){return warning.code==="invalid_legacy_source"&&warning.file==="corrupt.json"}),true,"Malformed legacy record is reported without stopping valid migrations")
    assert(s.sourceGet(other,"last").revision,"last-upload","Restart migrates remaining record")
    assert(s.sourceGet(w,first.id).revision,updated.revision,"New layout record takes precedence over legacy")
    assert(io.fileExists(s.config.home+"/sources/misleading.json"),true,"Legacy files retained")
    assert(report.warnings.some(function(warning){return warning.code==="legacy_name_mismatch"}),true,"Ambiguous filenames are reported without reconstruction")
    var missing=WikiStudio.id();WikiStudio.atomic(s.config.home+"/sources/uploads/"+missing+"/sealed.json",{wikiId:"missing",sourceId:"overwritten"})
    var corruptUpload=WikiStudio.id();WikiStudio.privateDir(s.config.home+"/sources/uploads/"+corruptUpload);io.writeFileString(s.config.home+"/sources/uploads/"+corruptUpload+"/sealed.json","{invalid")
    report=s.migrateSources()
    assert(report.warnings.some(function(warning){return warning.code==="invalid_upload_owner"&&warning.upload===corruptUpload}),true,"Malformed upload seal is reported without aborting migration")
    assert(report.warnings.some(function(warning){return warning.code==="missing_source_registration"&&warning.sourceId==="overwritten"}),true,"Missing overwritten registration reported from seal")
    assert(s.sourceGet({id:"missing"},"overwritten"),null,"Missing registration is never guessed")
    var spec=s.sourceOperation(w,"ingestions",{sourceId:first.id,revision:updated.revision,preview:true,options:{mode:"raw"}})
    assert(spec.params.sourceId,first.id,"Public source ID preserved")
    assert(spec.params.revision,updated.revision,"Upload revision preserved")
  }) }
  exports.testInventoryAndNamespaces = function() { fixture(function(s,t) {
    var w=add(s,t), originalHash=WikiStudio.hash, hashes=0
    for(var i=0;i<60;i++)io.writeFileString(w.root+"/page-"+i+".md","# Page "+i)
    WikiStudio.privateDir(w.root+"/.hidden");io.writeFileString(w.root+"/.hidden/ignore.md","hidden");io.writeFileString(w.root+"/AGENTS.md","instructions")
    WikiStudio.hash=function(bytes){hashes++;return originalHash(bytes)}
    var originalKeys=Object.keys, enumerations=0
    Object.keys=function(value){enumerations++;return originalKeys(value)}
    try {var metadata=WikiStudio.scan(w.root,true,true);assert(enumerations,1,"Scan enumerates link accounting once, never the growing file inventory");assert(Object.keys(metadata).length,62,"Metadata inventory includes all files");assert(hashes,0,"Metadata quota traversal never reads bodies for hashes")}
    finally {WikiStudio.hash=originalHash;Object.keys=originalKeys}
    var scans=0, originalScan=WikiStudio.scan
    WikiStudio.scan=function(root,all,metadataOnly){scans++;return originalScan(root,all,metadataOnly)}
    try {var overview=s.wikiRoute({method:"GET",query:{}},w,["overview"],"admin");assert(overview.studio.pageCount,60,"Overview counts public Markdown from full post-engine inventory");assert(scans,2,"Overview uses pre-engine safety and one post-engine scan")}
    finally {WikiStudio.scan=originalScan}
    ;["queue","registry","audit","server","source-migration"].forEach(function(id){
      WikiStudio.wikiLock(s.config.home,id,function(){WikiStudio.lock(s.config.home,id,function(){});rejects(function(){WikiStudio.wikiLock(s.config.home,id,function(){})},"busy")})
    })
    var upload=WikiStudio.id(), req={role:"admin",headers:{"x-upload-id":upload,"x-upload-path":"first.md"}}
    s.streamUpload(req,new java.io.ByteArrayInputStream(WikiStudio.bytes("existing-body")))
    var priorUpload=WikiStudio.path(s.config.home+"/sources/uploads/"+upload+"/files/first.md")
    java.nio.file.Files.setPosixFilePermissions(priorUpload,java.nio.file.attribute.PosixFilePermissions.fromString("---------"))
    hashes=0;WikiStudio.hash=function(bytes){hashes++;return originalHash(bytes)}
    try {req.headers["x-upload-path"]="second.md";s.streamUpload(req,new java.io.ByteArrayInputStream(WikiStudio.bytes("new-body")));assert(hashes,1,"Upload hashes only the newly received file")}
    finally {WikiStudio.hash=originalHash;java.nio.file.Files.setPosixFilePermissions(priorUpload,java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"))}
    assert(WikiStudio.scan(s.config.home+"/sources/uploads/"+upload+"/files",true)["first.md"].hash,originalHash(WikiStudio.bytes("existing-body")),"Full sealing inventory retains body hashing")
  }) }
  exports.testOversizedOutcomes = function() { fixture(function(s,t) {
    var w=add(s,t);WikiStudio.privateDir(s.config.home+"/jobs");s.jobs=new WikiStudioJobs(s.config)
    var original=wikiStudioExecute, large=new Array(1048578).join("x")
    var cases=[{ok:true,partial:true,expected:"partial"},{ok:true,sync_complete:false,expected:"partial"},{ok:true,status:"cancelled",expected:"cancelled"},{ok:true,result:{status:"cancelled"},expected:"cancelled"},{ok:false,expected:"recovery-required"},{ok:true,result:{partial:true},expected:"partial"},{ok:true,result:{sync_complete:false},expected:"partial"},{ok:true,result:{ok:false},expected:"recovery-required"}]
    try {cases.forEach(function(result,index){
      var j=s.jobs.submit(w,"graph.build",{dryrun:false},"large-result-"+index,"admin");s.jobs.update(j.id,{status:"acquiring-lock"})
      wikiStudioExecute=function(){return merge(result,{large:large})};wikiStudioRunWorker(s.config,j.id)
      var stored=WikiStudio.json(s.jobs.dir(j.id)+"/result.json"),finished=s.jobs.get(j.id)
      assert(finished.status,result.expected,"Oversized result preserves outcome "+index)
      assert(stored.truncated,true,"Result retention remains bounded")
      assert(stored.terminalStatus,result.expected,"Retained summary states terminal status")
      if(result.partial)assert(s.jobs.deletion(finished,w,s.jobs.list()).allowed,false,"Partial result is protected from cleanup")
    })}finally{wikiStudioExecute=original}
  }) }
  // Full rebuild uses the shared worker, snapshots, and strict opt-in validation.
  exports.testFullRebuild = function() { fixture(function(s, t) {
    WikiStudio.privateDir(s.config.home + "/jobs")
    s.jobs = new WikiStudioJobs(s.config)
    var w = add(s, t)
    io.writeFileString(w.root + "/page.md", "# Existing\nReconstruct derived artifacts from this page.")
    rejects(function() {
      s.jobWikiRoute({ method: "POST", headers: {}, body: { mode: "rebuild" } }, w, ["dreams"], "admin")
    }, "offline_required")
    var job = s.jobWikiRoute({ method: "POST", headers: { "idempotency-key": "full-rebuild" }, body: {
      mode: "rebuild", options: { rebuild: { modelHelp: "off", maxCalls: 2 } }, confirmation: { externalProcessesStopped: true }
    } }, w, ["dreams"], "admin")
    assert(job.operation, "dream.rebuild", "Studio queues shared Dream mode")
    assert(job.params.rebuild.maxCalls, 2, "Budget is retained")
    s.jobs.update(job.id, { status: "acquiring-lock" })
    wikiStudioRunWorker(s.config, job.id)
    var finished = s.jobs.get(job.id)
    assert(finished.status, "completed", "Full rebuild worker succeeds")
    assert(!!finished.backupId, true, "Verified snapshot precedes full rebuild")
    var result = WikiStudio.json(s.jobs.dir(job.id) + "/result.json")
    assert(result.complete, true, "Worker reports complete reconstruction")
    assert(io.readFileString(w.root + "/page.md").indexOf("Reconstruct derived") >= 0, true, "Markdown remains authoritative")
  }) }
  exports.testRegistry = function() { fixture(function(s, t) {
    var w = add(s, t); assert(w.access, "rw", "Registered wiki")
    assert(new WikiStudioRegistry(s.config).get("alpha").root, w.root, "Registry survives reopen")
    rejects(function() { add(s, t) }, "duplicate_wiki")
    rejects(function() { s.registry.add({ id: "beta", name: "Beta", root: w.root + "/nested", access: "rw" }) }, "duplicate_wiki")
    assert(WikiStudioRegistry.capabilities(merge(w, { access: "ro" })).canEdit, false, "Read-only capabilities")
    s.registry.update("alpha", {}, true); assert(io.fileExists(w.root), true, "Unregister preserves data")
    assert(s.registry.list().length, 0, "Unregistered")
  }) }
  // Root picker lists allowroots, child directories with badges, virtual paths, and refuses escapes.
  exports.testRootBrowse = function() { fixture(function(s, t) {
    var top = s.registry.browse({})
    assert(top.allowRoots.length, 1, "Allowroots listed without a path")
    assert(top.allowRoots[0].selectable, false, "An allowroot itself is not a selectable wiki root")
    WikiStudio.privateDir(t + "/wikis/.hidden"); WikiStudio.privateDir(t + "/wikis/plain"); WikiStudio.privateDir(t + "/wikis/plain/deeper")
    io.writeFileString(t + "/wikis/plain/index.md", "# Plain\n"); io.writeFileString(t + "/wikis/notes.txt", "x")
    add(s, t)
    var listing = s.registry.browse({ path: t + "/wikis" })
    var names = listing.items.map(function(i) { return i.name })
    assert(names.join(","), "existing,plain", "Only visible child directories, sorted")
    assert(listing.parent, null, "Allowroot has no browsable parent")
    var existing = listing.items[0], plain = listing.items[1]
    assert(existing.registeredAs, "alpha", "Registered wiki badge")
    assert(existing.selectable, false, "Registered root is not selectable")
    assert(plain.looksLikeWiki, true, "index.md marks a wiki-looking folder")
    assert(plain.selectable, true, "Free folder is selectable")
    var nested = s.registry.browse({ path: t + "/wikis/existing" })
    assert(nested.current.code, "duplicate_wiki", "Browsing inside a registered wiki explains the overlap")
    var virtual = s.registry.browse({ path: t + "/wikis/new-one/child" })
    assert(virtual.current.exists, false, "Virtual new folder reported as missing")
    assert(virtual.current.selectable, true, "Virtual new folder is selectable")
    assert(virtual.items.length, 0, "Virtual folder has no children")
    assert(io.fileExists(t + "/wikis/new-one"), false, "Browsing never creates directories")
    rejects(function() { s.registry.browse({ path: t }) }, "root_not_allowed")
    rejects(function() { s.registry.browse({ path: t + "/wikis/../state" }) }, "invalid_root")
    rejects(function() { s.registry.browse({ path: "relative/path" }) }, "invalid_root")
    java.nio.file.Files.createSymbolicLink(WikiStudio.path(t + "/wikis/link"), WikiStudio.path(t + "/state"))
    rejects(function() { s.registry.browse({ path: t + "/wikis/link" }) }, "unsafe_path")
    assert(s.registry.browse({ path: t + "/wikis" }).items.some(function(i) { return i.name === "link" }), false, "Symlinked directories are hidden")
    var routed = s.dispatch({ method: "GET", path: "/api/v1/roots/browse", query: { path: t + "/wikis" }, headers: {}, role: "admin" })
    assert(routed.items.length, 2, "Browse route dispatches to the registry")
    var created = s.registry.add({ id: "fresh", name: "Fresh", root: virtual.current.path, access: "rw", create: true })
    assert(new java.io.File(created.root).isDirectory(), true, "Nested virtual folders are created on registration")
  }) }
  // Change root re-points a moved wiki, refreshes identity, excludes its own old root and needs an existing folder.
  exports.testChangeRoot = function() { fixture(function(s, t) {
    var w = add(s, t)
    io.writeFileString(w.root + "/index.md", "# Existing\n")
    var picker = s.registry.browse({ path: t + "/wikis", for: "alpha" })
    var own = picker.items.filter(function(i) { return i.name === "existing" })[0]
    assert(own.currentRoot, true, "Picker marks the wiki's current root")
    assert(own.selectable, true, "Own root does not clash when re-pointing")
    var detail = s.registry.browse({ path: w.root }).current.contents
    assert(detail.hasIndex, true, "Contents pre-check sees index.md")
    assert(detail.markdownFiles, 1, "Contents pre-check counts Markdown pages")
    java.nio.file.Files.move(WikiStudio.path(w.root), WikiStudio.path(t + "/wikis/moved"))
    assert(s.registry.rootState(s.registry.get("alpha")), "missing", "Moved root reported as missing")
    rejects(function() { s.registry.verify(s.registry.get("alpha")) }, "root_missing")
    var listed = s.dispatch({ method: "GET", path: "/api/v1/wikis", query: {}, headers: {}, role: "admin" })
    assert(listed.items[0].rootState, "missing", "Dashboard list carries root state")
    rejects(function() { s.dispatch({ method: "PATCH", path: "/api/v1/wikis/alpha", query: {}, body: { root: t + "/wikis/not-there" }, headers: {}, role: "admin" }) }, "invalid_root")
    rejects(function() { s.registry.update("alpha", { root: t + "/wikis" }, false) }, "root_not_allowed")
    s.assertIdle = function() { WikiStudio.fail(423, "wiki_maintenance", "busy") }
    rejects(function() { s.dispatch({ method: "PATCH", path: "/api/v1/wikis/alpha", query: {}, body: { root: t + "/wikis/moved" }, headers: {}, role: "admin" }) }, "wiki_maintenance")
    delete s.assertIdle
    var result = s.dispatch({ method: "PATCH", path: "/api/v1/wikis/alpha", query: {}, body: { root: t + "/wikis/moved" }, headers: {}, role: "admin" })
    assert(result.wiki.root, t + "/wikis/moved", "Root re-pointed through the API")
    assert(s.registry.rootState(s.registry.get("alpha")), "ok", "Identity refreshed so verify passes")
    assert(s.registry.get("alpha").previousRoot, w.root, "Previous root kept for audit")
    WikiStudio.privateDir(t + "/wikis/other")
    s.registry.add({ id: "beta", name: "Beta", root: t + "/wikis/other", access: "rw" })
    rejects(function() { s.registry.update("alpha", { root: t + "/wikis/other" }, false) }, "duplicate_wiki")
  }) }
  // Index, graph and combined search modes, including graph-unavailable coverage and the all-wikis fan-out.
  exports.testSearchModes = function() { fixture(function(s, t) {
    var w = add(s, t)
    io.writeFileString(w.root + "/kafka.md", "---\ntitle: Kafka streaming\n---\n# Kafka streaming\nApache Kafka streams events. See [[zookeeper]].\n")
    io.writeFileString(w.root + "/zookeeper.md", "# Zookeeper\nCoordination used by Kafka clusters.\n")
    io.writeFileString(w.root + "/cooking.md", "# Cooking\nPasta.\n")
    var ops = new MiniAWikiOps({ wikiroot: w.root, wikiaccess: "rw", usewikigraph: true })
    ops.execute(ops.spec("wiki.reindex", {}), { confirm: true })
    var search = function(mode) { return s.wikiRoute({ method: "GET", query: { q: "kafka", mode: mode } }, w, ["search"], "admin") }
    var before = search("graph")
    assert(before.coverage.graph.outcome, "unavailable", "Graph search without a snapshot reports unavailable instead of failing")
    assert(before.results.length, 0, "No graph hits without a snapshot")
    ops.execute(ops.spec("graph.build", { extraction: "structural", modelHelp: "off" }), { confirm: true })
    var index = search("index")
    assert(index.results[0].path, "kafka.md", "Index search ranks the Kafka page first")
    var graph = search("graph")
    assert(graph.results.some(function(r) { return r.path === "kafka.md" && r.matchedBy.join() === "graph" }), true, "Graph search returns grounded pages")
    var combined = search("combined")
    assert(combined.results[0].path, "kafka.md", "Combined search ranks pages found by both engines first")
    assert(combined.results[0].matchedBy.join(","), "index,graph", "Combined hit records both engines")
    assert(combined.results.some(function(r) { return r.path === "cooking.md" }), false, "Unrelated pages are not returned")
    assert(combined.outcome, "complete", "Index outcome 'hits' is not treated as partial")
    rejects(function() { s.wikiRoute({ method: "GET", query: { q: "kafka", mode: "magic" } }, w, ["search"], "admin") }, "invalid_mode")
    var all = s.dispatch({ method: "GET", path: "/api/v1/search", query: { q: "kafka", mode: "combined" }, headers: {}, role: "admin" })
    assert(all.items[0].wikiId, "alpha", "All-wikis search passes the mode through")
    assert(isDef(all.items[0].matchedBy), true, "All-wikis combined hits keep engine provenance")
    s.registry.update("alpha", { graph: { enabled: false } }, false)
    var disabled = s.wikiRoute({ method: "GET", query: { q: "kafka", mode: "graph" } }, s.registry.get("alpha"), ["search"], "admin")
    assert(disabled.coverage.graph.warning.indexOf("disabled") >= 0, true, "Disabled graph is explained")
  }) }
  exports.testAuth = function() { fixture(function(s) {
    rejects(function() { s.auth({ host: "127.0.0.1:18891" }, "GET") }, "unauthorized")
    var h = { host: "127.0.0.1:18891", authorization: "Bearer " + s.config.token }
    assert(s.auth(h, "GET"), "admin", "Bearer auth")
    rejects(function() { s.auth(merge(h, { origin: "https://evil.invalid" }), "POST") }, "invalid_origin")
    rejects(function() { s.auth(merge(h, { host: "evil.invalid" }), "GET") }, "invalid_host")
    rejects(function() { WikiStudio.authorize("viewer", "editor") }, "forbidden")
    rejects(function() { WikiStudio.authorize("admin", "editor", {access:"ro"}) }, "read_only")
  }) }
  exports.testPaths = function() { fixture(function(s, t) {
    ["../secret.md", "/etc/passwd.md", "a/%2e%2e/x.md", "AGENTS.md", ".git/config.md", "a\\b.md", "x.txt", "a/.mini-a-x/foo.md"].forEach(function(p) { rejects(function() { WikiStudio.safeFile(t, p) }, "unsafe_path") })
    var w = add(s, t)
    java.nio.file.Files.createSymbolicLink(WikiStudio.path(w.root + "/escape.md"), WikiStudio.path(t))
    rejects(function() { WikiStudio.safeFile(w.root, "escape.md") }, "unsafe_path")
    new java.io.File(w.root + "/escape.md").delete()
    WikiStudio.privateDir(w.root + "/.index")
    io.writeFileString(w.root + "/.index/a", "immutable")
    java.nio.file.Files.createLink(WikiStudio.path(w.root + "/.index/b"), WikiStudio.path(w.root + "/.index/a"))
    assert(WikiStudio.scan(w.root, true)[".index/b"].size, 9, "Inventory accepts internal index links")
    assert(Object.keys(WikiStudio.scan(w.root, false)).length, 0, "Page inventory excludes index state")
    rejects(function() { WikiStudio.noLinks(w.root + "/.index/a") }, "unsafe_path")
    java.nio.file.Files.createLink(WikiStudio.path(t + "/outside"), WikiStudio.path(w.root + "/.index/a"))
    rejects(function() { WikiStudio.scan(w.root, true) }, "unsafe_path")
    new java.io.File(t + "/outside").delete()
    new java.io.File(w.root).renameTo(new java.io.File(w.root + "-old")); io.mkdir(w.root)
    rejects(function() { s.registry.verify(w) }, "root_changed")
    assert(s.registry.rootState(w), "changed", "Replaced folder at the same path is reported as changed")
  }) }
  exports.testAtomicAndLocks = function() { fixture(function(s, t) {
    var file = s.config.home + "/example.json"; WikiStudio.atomic(file, {one:1}); WikiStudio.atomic(file, {two:2})
    assert(WikiStudio.json(file).two, 2, "Atomic replacement")
    WikiStudio.lock(s.config.home, "test", function() { rejects(function() { WikiStudio.lock(s.config.home, "test", function(){}) }, "busy") })
    io.writeFileString(file, "{bad"); rejects(function() { WikiStudio.json(file) }, "invalid_state")
    rejects(function() { s.registry.add({ id: "alpha", name: "A", root: t, access: "rw", model: "injected" }) }, "unknown_field")
  }) }
  exports.testPages = function() { fixture(function(s, t) {
    var w = add(s, t), raw = "---\r\ntitle: 'Original' # preserve comment\r\ncustom: [one, two]\r\n---\r\n# Original\r\nLast line\r\n"
    io.writeFileString(w.root + "/original.md", raw)
    var p = s.wikiRoute({method:"GET",query:{path:"original.md"}}, w, ["page"], "admin")
    assert(p.content, raw, "Complete raw bytes and newlines")
    var saved = s.wikiRoute({method:"PUT", query:{path:"original.md"}, body:{content:raw + "More\r\n",expectedRevision:p.revision}}, w, ["page"], "admin")
    assert(saved.content, raw + "More\r\n", "Preserve frontmatter comments")
    rejects(function() { s.wikiRoute({method:"PUT",query:{path:"original.md"},body:{content:"lost update",expectedRevision:p.revision}},w,["page"],"admin") }, "revision_conflict")
    rejects(function() { s.wikiRoute({method:"PUT",query:{path:"original.md"},body:{content:"no",expectedRevision:saved.revision}},merge(w,{access:"ro"}),["page"],"admin") }, "read_only")
    var moved = s.wikiRoute({method:"POST",body:{source:"original.md",destination:"moved.md",expectedRevision:saved.revision}},w,["pages","move"],"admin")
    assert(moved.path,"moved.md","Supported move")
    s.wikiRoute({method:"DELETE",query:{path:"moved.md"},body:{expectedRevision:moved.revision,confirmation:"moved.md"}},w,["page"],"admin")
    assert(io.fileExists(w.root + "/moved.md"),false,"Delete")
    io.writeFileString(w.root + "/large.md", "0123456789"); s.config.maxPageBytes=4; rejects(function(){s.readPage(w,"large.md")},"page_too_large")
  }) }
  exports.testFolders = function() { fixture(function(s,t) {
    var w=add(s,t);WikiStudio.privateDir(s.config.home+"/jobs");s.jobs=new WikiStudioJobs(s.config)
    io.mkdir(w.root+"/old/empty");io.writeFileString(w.root+"/old/index.md","# Folder\n")
    var route=function(action,body,role,key){return s.wikiRoute({method:"POST",headers:{"idempotency-key":key||"folder-request-123"},body:body},w,["folders",action],role||"admin")}
    rejects(function(){route("preview",{source:"old"},"editor")},"forbidden")
    var preview=route("preview",{source:"old",destination:"new"})
    assert(preview.folders,2,"Preview includes empty folders")
    var body={source:"old",destination:"new",expectedRevision:preview.revision}
    var job=route("move",body)
    assert(route("move",body).id,job.id,"Request deduplicated")
    rejects(function(){route("preview",{source:"old"})},"wiki_maintenance")
    io.writeFileString(w.root+"/old/late.md","# Late change")
    s.jobs.update(job.id,{status:"acquiring-lock"});wikiStudioRunWorker(s.config,job.id)
    assert(s.jobs.get(job.id).status,"failed","Stale preview fails without recovery claim")
    assert(io.fileExists(w.root+"/new"),false,"Stale preview never moves files")
    assert(WikiStudio.pending(w.root).length,0,"No journal for rejected preview")
    preview=route("preview",{source:"old",destination:"new"})
    job=route("move",{source:"old",destination:"new",expectedRevision:preview.revision},"admin","folder-request-456")
    s.jobs.update(job.id,{status:"acquiring-lock"});wikiStudioRunWorker(s.config,job.id)
    assert(s.jobs.get(job.id).status,"completed","Worker publishes recursive move")
    assert(!!s.jobs.get(job.id).backupId,true,"Activity retains verified backup")
    assert(io.fileExists(w.root+"/new/empty"),true,"Worker moves empty directories")
    var blocked=route("preview",{source:"new"})
    rejects(function(){route("delete",{source:"new",expectedRevision:blocked.revision,confirmation:"New"})},"confirmation_required")
    // Persisted interruption is visible to activity/maintenance guards.
    WikiStudio.atomic(w.root+"/.mini-a-wiki-folders/pending.json",{phase:"publishing"})
    assert(WikiStudio.pending(w.root)[0].kind,"folder","Folder recovery surfaced")
    rejects(function(){route("preview",{source:"new"})},"folder_preflight")
  }) }
  exports.testSelections = function() { fixture(function(s,t) {
    var w=add(s,t);WikiStudio.privateDir(s.config.home+"/jobs");s.jobs=new WikiStudioJobs(s.config)
    io.mkdir(w.root+"/a");io.mkdir(w.root+"/b");io.mkdir(w.root+"/dest")
    io.writeFileString(w.root+"/a/one.md","# One\n[Two](../b/two.md)\n");io.writeFileString(w.root+"/b/two.md","# Two\n");io.writeFileString(w.root+"/home.md","# Home\n[One](a/one.md)\n")
    var route=function(action,body,role,key){return s.wikiRoute({method:"POST",headers:{"idempotency-key":key||"selection-request-123"},body:body},w,["selection",action],role||"admin")}
    var run=function(job){s.jobs.update(job.id,{status:"acquiring-lock"});wikiStudioRunWorker(s.config,job.id);return s.jobs.get(job.id)}
    rejects(function(){route("preview",{items:["a/one.md"],destination:"dest"},"editor")},"forbidden")
    rejects(function(){route("preview",{items:[],destination:"dest"})},"invalid_items")
    rejects(function(){route("preview",{items:["../x"],destination:"dest"})},"unsafe_path")
    rejects(function(){route("preview",{items:["a/one.md","a/one.md"],destination:"dest"})},"selection_preflight")
    var preview=route("preview",{items:["a/one.md","b/two.md"],destination:"dest"})
    assert(preview.entries.length,2,"Selection preview lists entries")
    rejects(function(){route("move",{items:["a/one.md","b/two.md"],destination:"dest"})},"preview_required")
    var job=route("move",{items:["a/one.md","b/two.md"],destination:"dest",expectedRevision:preview.revision})
    var done=run(job)
    assert(done.status,"completed","Worker publishes selection move: "+JSON.stringify(done))
    assert(!!done.backupId,true,"Selection move retains a verified backup")
    assert(io.fileExists(w.root+"/dest/one.md")&&io.fileExists(w.root+"/dest/two.md"),true,"Items moved")
    assert(io.readFileString(w.root+"/home.md").indexOf("dest/one.md")>=0,true,"Incoming link rewritten")
    var del=route("preview",{items:["dest/one.md","dest/two.md"]})
    assert(del.operation,"selection-delete","Missing destination previews deletion")
    rejects(function(){route("delete",{items:["dest/one.md","dest/two.md"],expectedRevision:del.revision,confirmation:"dest/one.md"})},"confirmation_required")
    done=run(route("delete",{items:["dest/one.md","dest/two.md"],expectedRevision:del.revision,confirmation:"delete 2 items"},"admin","selection-request-456"))
    assert(done.status,"completed","Worker deletes selection")
    assert(io.fileExists(w.root+"/dest/one.md"),false,"Selection deleted")
  }) }
  exports.testCreateFolder = function() { fixture(function(s,t) {
    var w=add(s,t)
    var make=function(path,role,wiki){return s.wikiRoute({method:"POST",body:{path:path}},wiki||w,["folders"],role||"editor")}
    var made=make("topics/new")
    assert(made.index,"topics/new/index.md","Folder created as a section")
    assert(io.fileExists(w.root+"/topics/new/index.md"),true,"index.md written")
    rejects(function(){make("topics/new")},"folder_exists")
    rejects(function(){make("../x")},"unsafe_path")
    rejects(function(){make("x","viewer")},"forbidden")
    rejects(function(){make("y","editor",merge(w,{access:"ro"}))},"read_only")
  }) }
  // Saved settings remain isolated and queued overrides are independent snapshots.
  exports.testWorkflowSettings = function() { fixture(function(s,t) {
    var w = add(s,t)
    function request(method, body) { return s.dispatch({method:method,path:"/api/v1/wikis/alpha/settings/ingestion",role:"admin",body:body,headers:{}}) }
    assert(request("GET").effective.wikiingestmaxcalls,32,"Built-in call limit")
    request("PUT",{wikiingestmaxcalls:0,wikiingestbudget:0})
    var frozen = s.resolveTuning(w,"ingestion",{concurrency:2})
    request("PUT",{wikiingestmaxcalls:7})
    assert(frozen.wikiingestmaxcalls,0,"Existing submission retains explicit zero")
    assert(frozen.concurrency,2,"Run override wins")
    assert(s.resolveTuning(w,"absorption",{}).absorbmaxpages,100,"Workflow isolation")
    assert(s.resolveTuning(merge(w,{identity:"different"}),"ingestion",{}).wikiingestmaxcalls,32,"Root identity isolation")
    rejects(function(){request("PUT",{maxfiles:2001})},"invalid_options")
    rejects(function(){request("PUT",{model:"secret"})},"unknown_field")
    rejects(function(){request("PUT",{concurrency:1.5})},"invalid_options")
  }) }
  exports.testGraphBuildSettings = function() { fixture(function(s,t) {
    WikiStudio.privateDir(s.config.home+"/jobs")
    var w=add(s,t), route=["graph","settings"]
    var saved=s.jobWikiRoute({method:"PUT",body:{extraction:"semantic",modelHelp:"off",maxCalls:9,maxTokens:5000,maxMinutes:1}},w,route,"admin")
    assert(saved.effective.maxCalls,9,"Studio saves defaults")
    var reopened=new WikiStudioServer(s.config)
    assert(reopened.jobWikiRoute({method:"GET"},w,route,"viewer").effective.maxCalls,9,"Studio defaults survive restart")
    var runner=new MiniAWikiOps({wikiroot:w.root,wikiaccess:"ro",usewikigraph:true,wikiretrievalv2:false})
    assert(runner.execute(runner.spec("graph.settings",{}),{}).effective.maxCalls,9,"Manager reads Studio defaults")
    var request={method:"POST",headers:{"idempotency-key":"graph-options-test"},body:{extraction:"semantic",modelHelp:"off",maxCalls:2}}
    var job=s.jobWikiRoute(request,w,["graph","rebuild"],"admin")
    assert(job.params.maxCalls,2,"Studio run override")
    assert(s.jobWikiRoute({method:"GET"},w,route,"viewer").effective.maxCalls,9,"Studio override not saved")
    assert(s.jobWikiRoute(request,w,["graph","rebuild"],"admin").id,job.id,"Graph job replay idempotent")
    rejects(function(){s.jobWikiRoute({method:"POST",headers:{"idempotency-key":"invalid-options"},body:{extraction:"semantic",strategy:"resume",force:true}},w,["graph","rebuild"],"admin")},"invalid_options")
    rejects(function(){s.jobWikiRoute({method:"PUT",body:{maxCalls:3}},merge(w,{access:"ro"}),route,"admin")},"read_only")
  }) }
  exports.testGraph = function() { fixture(function(s, t) {
    var w = add(s, t)
    io.writeFileString(w.root + "/one.md", "# One\n[[two]]\n<script>alert(1)</script>")
    io.writeFileString(w.root + "/two.md", "# Two\n")
    assert(s.wikiRoute({method:"GET",query:{}},w,["graph","stats"],"admin").source,"markdown-links-fallback","A fresh wiki can show graph status without a snapshot")
    var html = s.graphHtml(w).studioHtml
    assert(html.indexOf("Markdown page links") >= 0, true, "Fallback source is explicit")
    assert(html.indexOf("mini-a-wiki-graph-node") >= 0, true, "Versioned node bridge")
    assert(html.indexOf("connect-src 'none'") >= 0, true, "Embedded graph denies network")
    assert(s.graphHtml(w).studioHtml, html, "Cache reuse without overwrite")
    io.writeFileString(w.root + "/two.md", "# Two changed\n")
    assert(s.graphHtml(w).studioHtml !== html, true, "External changes invalidate cache")
  }) }
  exports.testJobs = function() { fixture(function(s,t) {
    WikiStudio.privateDir(s.config.home + "/jobs"); var w = add(s,t), jobs = s.jobs = new WikiStudioJobs(s.config)
    var j = jobs.submit(w,"dream.plan",{semantic:false},"test-key-123","admin")
    var eventsFile=jobs.dir(j.id)+"/events.ndjson",append=new java.io.FileOutputStream(eventsFile,true);append.write(WikiStudio.bytes('{"seq":999'));append.close()
    jobs.event(j.id,"test","Recover an incomplete final event")
    var recoveredEvents=io.readFileString(eventsFile).trim().split("\n").map(function(line){return JSON.parse(line)})
    assert(recoveredEvents[1].seq,2,"Interrupted event append recovers without duplicate sequence")
    assert(jobs.submit(w,"dream.plan",{semantic:false},"test-key-123","admin").id,j.id,"Exact idempotent replay")
    rejects(function(){jobs.submit(w,"dream.plan",{semantic:true},"test-key-123","admin")},"idempotency_conflict")
    rejects(function(){s.assertIdle(w.id)},"wiki_maintenance")
    jobs.update(j.id,{status:"acquiring-lock"}); wikiStudioRunWorker(s.config,j.id)
    assert(jobs.get(j.id).status,"completed","Plan worker finishes: " + JSON.stringify(WikiStudio.json(jobs.dir(j.id)+"/result.json")) + " " + JSON.stringify(jobs.get(j.id)))
    var before = io.readFileString(jobs.dir(j.id) + "/job.json"); wikiStudioRunWorker(s.config,j.id)
    assert(io.readFileString(jobs.dir(j.id)+"/job.json"),before,"Terminal worker cannot run twice")
    assert(new WikiStudioJobs(s.config).get(j.id).status,"completed","Job durable after reopen")
    assert(WikiStudio.json(jobs.dir(j.id)+"/changes.json").changedPageCount,0,"Plan has no page mutation")
  }) }
  exports.testSources = function() { fixture(function(s,t) {
    var w=add(s,t),id=WikiStudio.id()
    WikiStudio.privateDir(s.config.home+"/sources")
    var req={role:"admin",headers:{"x-upload-id":id,"x-upload-path":"nested%2Fsource.md"}}
    s.streamUpload(req,new java.io.ByteArrayInputStream(WikiStudio.bytes("# Staged\n")))
    var source=s.sourceAdd(w,{id:"docs",name:"Documents",type:"upload",uploadId:id})
    assert(source.files["nested/source.md"].size,9,"Preserve directory paths")
    ;[{}, {section:""}, {section:"guides/reference"}].forEach(function(options) {
      var spec=s.sourceOperation(w,"ingestions",{sourceId:source.id,revision:source.revision,options:options})
      assert(spec.params.section,options.section||"docs","Default section uses source ID and preserves explicit overrides")
    })
    rejects(function(){s.streamUpload(req,new java.io.ByteArrayInputStream(WikiStudio.bytes("x")))},"upload_sealed")
    rejects(function(){s.sourceAdd(w,{id:"remote",name:"Remote",type:"url",uploadId:WikiStudio.id()})},"adapter_unavailable")
    rejects(function(){s.sourceAdd(w,{id:"web",name:"Web",type:"web",url:"http://127.0.0.1/"})},"outbound_blocked")
    rejects(function(){s.sourceAdd(w,{id:"web",name:"Web",type:"web",url:"http://169.254.169.254/latest"})},"outbound_blocked")
    rejects(function(){s.sourceAdd(w,{id:"web",name:"Web",type:"web",url:"https://example.com:8443/"})},"invalid_url")
    rejects(function(){s.sourceAdd(w,{id:"yt",name:"YT",type:"youtube",video:"https://evil.example/watch?v=l6ZcFa8pybE"})},"invalid_video")
    function archive(name,entry){var out=new java.util.zip.ZipOutputStream(new java.io.FileOutputStream(t+"/"+name));out.putNextEntry(new java.util.zip.ZipEntry(entry));out.write(WikiStudio.bytes("safe content"));out.closeEntry();out.close();return t+"/"+name}
    rejects(function(){WikiStudio.validateZip(archive("slip.zip","../escape.md"))},"unsafe_path")
    var good=archive("good.zip","folder/page.md"); WikiStudio.extractZip(good,t+"/expanded")
    assert(io.readFileString(t+"/expanded/folder/page.md"),"safe content","Safe ZIP extraction")
    req.headers["x-upload-id"]=WikiStudio.id();req.headers["x-upload-path"]="..%2Fescape.md"
    rejects(function(){s.streamUpload(req,new java.io.ByteArrayInputStream(WikiStudio.bytes("x")))},"unsafe_path")
    WikiStudio.privateDir(t+"/checkout");io.writeFileString(t+"/checkout/doc.md","# Local checkout\n")
    s.config.directories=[{id:"checkout",path:t+"/checkout",identity:WikiStudio.identity(t+"/checkout")}]
    var local=s.sourceAdd(w,{id:"local",name:"Local",type:"git",directoryId:"checkout"})
    assert(local.type,"git","Allowlisted local checkout adapter")
    assert(!!local.files["doc.md"],true,"Directory snapshot inventory")
    // YouTube captions: the operator chooses the Markdown (page) file name.
    assert(WikiStudio.markdownFileName("My Talk.md"),"my-talk.md","File names use page slug rules")
    rejects(function(){WikiStudio.markdownFileName("index")},"invalid_filename")
    rejects(function(){WikiStudio.markdownFileName("../")},"invalid_filename")
    var realYoutube=WikiStudioOutbound.youtube
    WikiStudioOutbound.youtube=function(){return {name:"youtube-abc.md",markdown:"# Talk\n\nTranscript\n",origin:"https://www.youtube.com/watch?v=abc"}}
    try {
      var named=s.sourceAdd(w,{id:"talk",name:"Talk",type:"youtube",video:"abc",filename:"Keynote 2026"})
      assert(Object.keys(named.files).join(),"keynote-2026.md","Chosen caption file name is staged")
      var unnamed=s.sourceAdd(w,{id:"talk2",name:"Talk 2",type:"youtube",video:"abc"})
      assert(Object.keys(unnamed.files).join(),"youtube-abc.md","Default caption file name kept")
      rejects(function(){s.sourceAdd(w,{id:"talk3",name:"Talk 3",type:"youtube",video:"abc",filename:"log"})},"invalid_filename")
      rejects(function(){s.sourceAdd(w,{id:"web2",name:"Web",type:"web",url:"https://example.com/",filename:"x"})},"invalid_source")
      var spec=s.sourceOperation(w,"ingestions",{sourceId:"talk",revision:named.revision,options:{section:"talks/2026"}})
      assert(spec.params.section,"talks/2026","Chosen wiki folder reaches the engine")
    } finally { WikiStudioOutbound.youtube=realYoutube }

    // Deleting a source removes its record and every sealed upload revision
    var second=WikiStudio.id()
    s.streamUpload({role:"admin",headers:{"x-upload-id":second,"x-upload-path":"source.md"}},new java.io.ByteArrayInputStream(WikiStudio.bytes("# Second\n")))
    var updated=s.sourceAdd(w,{id:"docs",name:"Documents",type:"upload",uploadId:second})
    assert(updated.lineage.join(),id,"Update keeps prior revision in lineage")
    rejects(function(){s.sourceDelete(w,"docs",{})},"confirmation_required")
    rejects(function(){s.sourceDelete(w,"missing",{confirmation:"missing"})},"source_not_found")
    s.jobs={list:function(){return [{wikiId:w.id,operation:"ingest.run",params:{sourceId:"docs"},status:"running"}]}}
    rejects(function(){s.sourceDelete(w,"docs",{confirmation:"docs"})},"source_busy")
    delete s.jobs
    var deleted=s.sourceDelete(w,"docs",{confirmation:"docs"})
    assert(deleted.revisionsRemoved,2,"Both upload revisions removed")
    assert(s.sourceGet(w,"docs"),null,"Source record removed")
    assert(io.fileExists(s.config.home+"/sources/uploads/"+id),false,"Old revision files removed")
    assert(io.fileExists(s.config.home+"/sources/uploads/"+second),false,"Current revision files removed")
    assert(s.sourceList(w).some(function(x){return x.id==="docs"}),false,"Library no longer lists the source")
    assert(s.sourceList(w).some(function(x){return x.id==="local"}),true,"Other sources remain")
  }) }
  exports.testHydration = function() { fixture(function(s,t) {
    var w=add(s,t),id=WikiStudio.id();WikiStudio.privateDir(s.config.home+"/sources");WikiStudio.privateDir(s.config.home+"/jobs")
    s.jobs=new WikiStudioJobs(s.config)
    s.streamUpload({role:"admin",headers:{"x-upload-id":id,"x-upload-path":"lesson.md"}},new java.io.ByteArrayInputStream(WikiStudio.bytes("# Lesson\n\nUseful facts about the library.\n")))
    s.sourceAdd(w,{id:"lessons",name:"Lessons",type:"upload",uploadId:id})
    function run(preview,key){var spec=s.sourceOperation(w,"ingestions",{sourceId:"lessons",revision:id,preview:preview,options:{mode:"raw",semantic:false}});var j=s.jobs.submit(w,spec.operation,spec.params,key,"admin");s.jobs.update(j.id,{status:"acquiring-lock"});wikiStudioRunWorker(s.config,j.id);return s.jobs.get(j.id)}
    var preview=run(true,"preview-key-123");assert(preview.status,"completed","Ingest dry run")
    assert(Object.keys(WikiStudio.scan(w.root,false)).length,0,"Preview leaves pages unchanged")
    var applied=run(false,"apply-key-123");assert(applied.status,"completed","Real raw ingestion: "+JSON.stringify(applied))
    assert(!!applied.backupId,true,"Ingestion backup recorded")
    var files=WikiStudio.scan(w.root,false);assert(Object.keys(files).length>0,true,"Engine produced pages")
    assert(!!files["lessons/lesson.md"],true,"Source ID sets the actual destination section")
    assert(Object.keys(files).some(function(p){return /^files\//.test(p)}),false,"Staging directory does not become a wiki section")
    var repeated=run(false,"rerun-key-123");assert(repeated.status,"completed","Idempotent engine rerun")
    var unchanged=WikiStudio.scan(w.root,false);assert(Object.keys(files).filter(function(p){return p!=="log.md"}).every(function(p){return unchanged[p]&&files[p].hash===unchanged[p].hash}),true,"Stable source ID does not duplicate pages")
    var managed=Object.keys(unchanged).filter(function(p){return !/(^|\/)(index|log|AGENTS)\.md$/.test(p)})[0]
    var edited=io.readFileString(w.root+"/"+managed)+"\nManual operator edit\n";io.writeFileString(w.root+"/"+managed,edited)
    run(false,"manual-conflict-123");assert(io.readFileString(w.root+"/"+managed),edited,"Ingestion never silently overwrites manual source-page edits")

    // Ad-hoc imports cannot take over a library source ID
    var clash=WikiStudio.id()
    s.streamUpload({role:"admin",headers:{"x-upload-id":clash,"x-upload-path":"x.md"}},new java.io.ByteArrayInputStream(WikiStudio.bytes("# X\n")))
    rejects(function(){s.sourceAdd(w,{id:"lessons",name:"Lessons",type:"upload",uploadId:clash,adhoc:true})},"source_exists")
    rejects(function(){s.sourceAdd(w,{id:"bad",name:"Bad",type:"upload",uploadId:clash,adhoc:"yes"})},"invalid_source")

    // Ad-hoc import: a preview keeps the source, a successful import discards it
    var once=WikiStudio.id()
    s.streamUpload({role:"admin",headers:{"x-upload-id":once,"x-upload-path":"note.md"}},new java.io.ByteArrayInputStream(WikiStudio.bytes("# Note\n\nA one-off note.\n")))
    var adhoc=s.sourceAdd(w,{id:"once",name:"Once",type:"upload",uploadId:once,adhoc:true})
    assert(adhoc.adhoc,true,"Ad-hoc flag recorded")
    function runOnce(preview,key){var spec=s.sourceOperation(w,"ingestions",{sourceId:"once",revision:once,preview:preview,options:{mode:"raw",semantic:false,section:"notes"}});var j=s.jobs.submit(w,spec.operation,spec.params,key,"admin");s.jobs.update(j.id,{status:"acquiring-lock"});wikiStudioRunWorker(s.config,j.id);return s.jobs.get(j.id)}
    assert(runOnce(true,"adhoc-preview-1").status,"completed","Ad-hoc preview")
    assert(!!s.sourceGet(w,"once"),true,"Preview keeps the ad-hoc source")
    var onceApplied=runOnce(false,"adhoc-apply-1");assert(onceApplied.status,"completed","Ad-hoc import: "+JSON.stringify(onceApplied))
    assert(!!WikiStudio.scan(w.root,false)["notes/note.md"],true,"Ad-hoc import produced the page")
    assert(s.sourceGet(w,"once"),null,"Ad-hoc source discarded after import")
    assert(io.fileExists(s.config.home+"/sources/uploads/"+once),false,"Ad-hoc staged files discarded")
    assert(!!s.sourceGet(w,"lessons"),true,"Library sources are kept after import")
  }) }
  exports.testBackups = function() { fixture(function(s,t) {
    var w=add(s,t);WikiStudio.privateDir(s.config.home+"/jobs")
    io.writeFileString(w.root+"/page.md","# Original\n")
    var backup=WikiStudio.snapshot(s.config,w,"test")
    assert(backup.verified,true,"Archive and members verified")
    io.writeFileString(w.root+"/page.md","# Changed\n")
    var current=WikiStudio.fingerprint(WikiStudio.scan(w.root,true)),pre=WikiStudio.snapshot(s.config,w,"before-restore"),id=WikiStudio.id()
    WikiStudio.privateDir(s.config.home+"/jobs/"+id)
    rejects(function(){WikiStudio.restore(s.config,w,{id:id,params:{backupId:backup.id,expectedFingerprint:"wrong",confirmation:"wrong"}},pre)},"restore_conflict")
    assert(io.readFileString(w.root+"/page.md"),"# Changed\n","Failed preflight leaves live wiki untouched")
    WikiStudio.restore(s.config,w,{id:id,params:{backupId:backup.id,expectedFingerprint:current,confirmation:backup.id+":"+current}},pre)
    assert(io.readFileString(w.root+"/page.md"),"# Original\n","Validated sibling swap restores content")
    s.registry.verify(s.registry.get(w.id))
    io.writeFileString(WikiStudio.backupPath(s.config,w,backup.id)+"/snapshot.zip","corruption")
    rejects(function(){WikiStudio.checkBackup(s.config,w,backup.id)},"corrupt_backup")
    rejects(function(){WikiStudio.checkBackup(s.config,merge(w,{id:"other"}),backup.id)},"foreign_backup")
  }) }
  // Bulk snapshot deletion validates the whole selection before removing anything
  exports.testBulkBackupDelete = function() { fixture(function(s,t) {
    var w=add(s,t);WikiStudio.privateDir(s.config.home+"/jobs");s.jobs=new WikiStudioJobs(s.config)
    io.writeFileString(w.root+"/page.md","# Page\n")
    var a=WikiStudio.snapshot(s.config,w,"a"),b=WikiStudio.snapshot(s.config,w,"b"),c=WikiStudio.snapshot(s.config,w,"c")
    function remove(body,role){return s.backupRoute({method:"DELETE",body:body},w,["backups"],role||"admin")}
    rejects(function(){remove({ids:[a.id,b.id],confirmation:"wrong"})},"confirmation_required")
    rejects(function(){remove({ids:[],confirmation:"delete-backups"})},"confirmation_required")
    rejects(function(){remove({ids:[a.id],confirmation:"delete-backups"},"viewer")},"forbidden")
    rejects(function(){remove({ids:[a.id,"not-an-id"],confirmation:"delete-backups"})},"invalid_backup")
    assert(io.fileExists(WikiStudio.backupPath(s.config,w,a.id)),true,"Invalid selection deletes nothing")
    var j=s.jobs.submit(w,"dream.repair",{},"bulk-backup-123","admin");s.jobs.update(j.id,{status:"recovery-required",backupId:c.id})
    rejects(function(){remove({ids:[a.id,c.id],confirmation:"delete-backups"})},"backup_protected")
    assert(io.fileExists(WikiStudio.backupPath(s.config,w,a.id)),true,"Protected member blocks the whole selection")
    s.jobs.update(j.id,{status:"completed"})
    assert(remove({ids:[a.id,b.id,a.id],confirmation:"delete-backups"}).deleted.length,2,"Selected snapshots deleted once each")
    assert(io.fileExists(WikiStudio.backupPath(s.config,w,a.id))||io.fileExists(WikiStudio.backupPath(s.config,w,b.id)),false,"Selected snapshot directories removed")
    assert(io.fileExists(WikiStudio.backupPath(s.config,w,c.id)),true,"Unselected snapshot kept")
    rejects(function(){remove({ids:[c.id],confirmation:"delete-backups"})},"last_backup")
    assert(remove({ids:[c.id],confirmation:"delete-backups",acknowledgeLast:true}).deleted[0],c.id,"Last verified snapshot deleted with acknowledgement")
  }) }
  exports.testExports = function() { fixture(function(s,t) {
    var w=add(s,t);WikiStudio.privateDir(s.config.home+"/jobs");WikiStudio.privateDir(s.config.home+"/audit")
    io.writeFileString(w.root+"/page.md","# Page\nexportroutineneedle\n")
    var wm=new MiniAWikiManager({root:w.root,backend:"fs",access:"rw",wikiretrievalv2:true});try{assert(wm.reindex().ok,true,"fixture index builds")}finally{wm.close()}
    function run(nobundle){var id=WikiStudio.id();return WikiStudio.exportWiki(s.config,w,{id:id,params:{nobundle:nobundle}},function(){})}
    var first=run(false)
    assert(first.ok!==false&&first.mode==="bundle",true,"export job succeeds: "+stringify(first,__,""))
    assert(isUnDef(first.output)&&isUnDef(first.usage),true,"server paths are not returned to the client")
    var list=s.exportRoute({method:"GET",query:{}},w,["exports"],"admin")
    assert(list.total,1,"export listed");assert(list.items[0].id,first.exportId,"listed export matches job")
    rejects(function(){s.exportRoute({method:"GET",query:{}},w,["exports"],"viewer")},"forbidden")
    var status=0,length=-1,headers={},sink=new java.io.ByteArrayOutputStream()
    var ex={getResponseHeaders:function(){return {set:function(k,v){headers[k]=String(v)}}},sendResponseHeaders:function(c,l){status=c;length=Number(l)},getResponseBody:function(){return sink},close:function(){}}
    s.streamExport({path:"/api/v1/wikis/"+w.id+"/exports/"+first.exportId+"/download",requestId:"r1"},ex,"admin")
    assert(status,200,"download streams");assert(headers["Content-Type"],"application/zip","zip content type");assert(Number(sink.size()),length,"all bytes streamed")
    assert(/attachment; filename="Alpha-/.test(headers["Content-Disposition"]),true,"attachment filename uses wiki name")
    rejects(function(){s.streamExport({path:"/api/v1/wikis/"+w.id+"/exports/"+first.exportId+"/download",requestId:"r2"},ex,"viewer")},"forbidden")
    rejects(function(){s.streamExport({path:"/api/v1/wikis/"+w.id+"/exports/"+WikiStudio.id()+"/download",requestId:"r3"},ex,"admin")},"export_not_found")
    io.writeFileString(WikiStudio.exportDir(s.config,w.id,first.exportId)+"/export.zip","tampered")
    rejects(function(){s.streamExport({path:"/api/v1/wikis/"+w.id+"/exports/"+first.exportId+"/download",requestId:"r4"},ex,"admin")},"corrupt_export")
    rejects(function(){s.exportRoute({method:"DELETE",body:{confirmation:"wrong"}},w,["exports",first.exportId],"admin")},"confirmation_required")
    assert(s.exportRoute({method:"DELETE",body:{confirmation:first.exportId}},w,["exports",first.exportId],"admin").deleted,first.exportId,"export deleted")
    assert(s.exportRoute({method:"GET",query:{}},w,["exports"],"admin").total,0,"list empty after delete")
    var loose=run(true);assert(loose.mode,"folders","loose export honours nobundle")
    for(var i=0;i<6;i++)run(false)
    assert(s.exportRoute({method:"GET",query:{limit:"50"}},w,["exports"],"admin").total,WikiStudio.exportKeep,"only the most recent exports are retained")
  }) }
  exports.testDreamSafety = function() { fixture(function(s,t) {
    var w=add(s,t);WikiStudio.privateDir(s.config.home+"/jobs");s.jobs=new WikiStudioJobs(s.config)
    rejects(function(){s.jobWikiRoute({method:"POST",headers:{"idempotency-key":"reorg-key-123"},body:{mode:"reorg",options:{}}},w,["dreams"],"admin")},"confirmation_required")
    io.writeFileString(w.root+"/page.md","# Before\n")
    var j=s.jobs.submit(w,"dream.reorg",{semantic:false,dreammaxsteps:2,organize:"none",instructions:"test"},"fake-reorg-123","admin"),original=wikiStudioExecute
    s.jobs.update(j.id,{status:"acquiring-lock"})
    // A deterministic injected engine verifies worker backup/diff contracts. It
    // does not claim provider or real agent restructuring quality coverage.
    wikiStudioExecute=function(config,wiki,job,log,backup){assert(backup.verified,true,"Fake engine cannot start before verified backup");io.writeFileString(wiki.root+"/page.md","# After fake engine\n");return {ok:true}}
    try{wikiStudioRunWorker(s.config,j.id)}finally{wikiStudioExecute=original}
    assert(s.jobs.get(j.id).status,"completed","Fake restructuring finalizes")
    var diff=WikiStudio.json(s.jobs.dir(j.id)+"/changes.json")
    assert(diff.changedPageCount,1,"Actual changed page count")
    assert(diff.changes[0].unifiedDiff.indexOf("+# After fake engine")>=0,true,"Before/after human-readable diff")
  }) }
  exports.testCleanup = function() { fixture(function(s,t) {
    var w=add(s,t);WikiStudio.privateDir(s.config.home+"/jobs");s.jobs=new WikiStudioJobs(s.config)
    io.writeFileString(w.root+"/one.md","# One")
    var j=s.jobs.submit(w,"dream.plan",{},"cleanup-request-123","admin")
    function remove(ids,role){return s.extraRoute({method:"DELETE",body:{wikiId:w.id,ids:ids,confirmation:"delete-history"}},["api","v1","jobs"],role||"admin")}
    rejects(function(){remove([j.id])},"history_protected")
    rejects(function(){remove([j.id],"viewer")},"forbidden")
    s.jobs.update(j.id,{status:"completed"})
    var backup=WikiStudio.snapshot(s.config,w,j.id)
    var changed=s.jobs.submit(w,"dream.repair",{},"cleanup-other-123","admin")
    s.jobs.update(changed.id,{status:"recovery-required",backupId:backup.id})
    rejects(function(){s.backupRoute({method:"DELETE",body:{confirmation:backup.id,acknowledgeLast:true}},w,["backups",backup.id],"admin")},"backup_protected")
    rejects(function(){remove([changed.id])},"history_protected")
    WikiStudio.privateDir(w.root+"/.mini-a-wiki-ingest");WikiStudio.atomic(w.root+"/.mini-a-wiki-ingest/journal.json",{phase:"applying"})
    rejects(function(){remove([j.id])},"history_protected")
    rejects(function(){s.extraRoute({method:"POST",body:{confirmation:changed.id}},["api","v1","jobs",changed.id,"review-recovery"],"admin")},"recovery_pending")
    new java.io.File(w.root+"/.mini-a-wiki-ingest/journal.json").delete()
    s.extraRoute({method:"POST",body:{confirmation:changed.id}},["api","v1","jobs",changed.id,"review-recovery"],"admin")
    var before=WikiStudio.fingerprint(WikiStudio.scan(w.root,true))
    assert(remove([j.id,changed.id]).deleted.length,2,"Bulk history cleanup")
    assert(s.jobs.list().length,0,"Cleanup frees live inventory capacity")
    rejects(function(){s.jobs.get(j.id)},"job_not_found")
    rejects(function(){s.jobs.submit(w,"dream.plan",{},"cleanup-request-123","admin")},"job_history_deleted")
    rejects(function(){s.jobs.submit(w,"dream.plan",{changed:true},"cleanup-request-123","admin")},"idempotency_conflict")
    assert(WikiStudio.checkBackup(s.config,w,backup.id).verified,true,"History cleanup retains snapshots")
    rejects(function(){s.backupRoute({method:"DELETE",body:{confirmation:backup.id}},w,["backups",backup.id],"admin")},"last_backup")
    s.backupRoute({method:"DELETE",body:{confirmation:backup.id,acknowledgeLast:true}},w,["backups",backup.id],"admin")
    assert(io.fileExists(WikiStudio.backupPath(s.config,w,backup.id)),false,"Snapshot directory removed")
    assert(WikiStudio.fingerprint(WikiStudio.scan(w.root,true)),before,"Cleanup never alters wiki files")
    var foreign=s.jobs.submit(merge(w,{id:"other"}),"dream.plan",{},"foreign-request-123","admin")
    s.jobs.update(foreign.id,{status:"completed"});rejects(function(){remove([foreign.id])},"job_not_found")
    var safe=s.jobs.submit(w,"dream.plan",{},"unsafe-request-123","admin");s.jobs.update(safe.id,{status:"completed"})
    java.nio.file.Files.createSymbolicLink(WikiStudio.path(s.jobs.dir(safe.id)+"/escape"),WikiStudio.path(w.root))
    rejects(function(){remove([safe.id])},"unsafe_path")
  }) }
  exports.testExplorer = function() { fixture(function(s,t) {
    var w=add(s,t);WikiStudio.privateDir(w.root+"/Empty");WikiStudio.privateDir(w.root+"/Folder")
    io.writeFileString(w.root+"/Folder/index.md","# Landing");io.writeFileString(w.root+"/z.md","# Z");io.writeFileString(w.root+"/AGENTS.md","private instructions")
    for(var i=0;i<205;i++)io.writeFileString(w.root+"/Folder/page-"+i+".md","# Page")
    var root=s.wikiRoute({method:"GET",query:{}},w,["children"],"admin")
    assert(root.items.map(function(x){return x.name}).join(","),"Empty,Folder,z.md","Folders first, instructions excluded")
    var children=s.wikiRoute({method:"GET",query:{path:"Folder",limit:100,offset:100}},w,["children"],"admin")
    assert(children.total,206,"No recursive tree truncation");assert(children.items.length,100,"Bounded folder response");assert(children.truncated,true,"More children available")
    assert(s.wikiRoute({method:"GET",query:{path:"Empty"}},w,["children"],"admin").total,0,"Empty folder visible")
    rejects(function(){s.wikiRoute({method:"GET",query:{path:"../"}},w,["children"],"admin")},"unsafe_path")
  }) }
  exports.testAbsorption = function() { fixture(function(s,t) {
    var w=add(s,t);WikiStudio.privateDir(t+"/wikis/beta");io.writeFileString(t+"/wikis/beta/knowledge.md","# Evidence\nA verified fact.\n")
    var source=s.registry.add({id:"beta",name:"Beta",root:t+"/wikis/beta",access:"rw"}),sourceBefore=WikiStudio.fingerprint(WikiStudio.scan(source.root,true))
    WikiStudio.privateDir(s.config.home+"/jobs");s.jobs=new WikiStudioJobs(s.config)
    global.__mini_a_ingest_lib_mode=true;loadLib(String(new java.io.File("js/wiki/mini-a-ingest.js").getCanonicalPath()))
    var original=MiniAIngest.prototype._buildLlm
    MiniAIngest.prototype._buildLlm=function(){return{promptJSONWithStats:function(){return{response:{proposals:[{path:"knowledge.md",classification:"enrichment",edits:[{before:"",after:"# Evidence\nA verified fact.\n",evidence:["beta:knowledge.md"]}],evidence:["beta:knowledge.md"],mappings:[{evidence:"beta:knowledge.md",anchor:""}],dependencies:[]}],findings:[]}}}}}
    function run(body,key){var spec=s.sourceOperation(w,"absorptions",body),j=s.jobs.submit(w,spec.operation,spec.params,key,"admin");s.jobs.update(j.id,{status:"acquiring-lock"});wikiStudioRunWorker(s.config,j.id);return {job:s.jobs.get(j.id),result:WikiStudio.json(s.jobs.dir(j.id)+"/result.json")}}
    var planned
    try{planned=run({action:"plan",sourceWikiIds:["beta"]},"absorb-plan-123")}finally{MiniAIngest.prototype._buildLlm=original}
    assert(planned.job.status,"completed","Real saved plan with injected model: "+JSON.stringify(planned.result))
    s.jobs.removeHistory(w,[planned.job.id])
    assert(s.jobs.list().length,0,"Plan history removed before application")
    var applied=run({action:"apply",planId:planned.result.id,confirmation:{applySavedPlan:true}},"absorb-apply-123")
    assert(applied.job.status,"completed","Saved plan applies without another model: "+JSON.stringify(applied.result))
    assert(io.fileExists(w.root+"/knowledge.md"),true,"Transferred page exists")
    assert(WikiStudio.fingerprint(WikiStudio.scan(source.root,true)),sourceBefore,"Source wiki remains unchanged")
  }) }
})()
