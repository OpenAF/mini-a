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
  exports.testRegistry = function() { fixture(function(s, t) {
    var w = add(s, t); assert(w.access, "rw", "Registered wiki")
    assert(new WikiStudioRegistry(s.config).get("alpha").root, w.root, "Registry survives reopen")
    rejects(function() { add(s, t) }, "duplicate_wiki")
    rejects(function() { s.registry.add({ id: "beta", name: "Beta", root: w.root + "/nested", access: "rw" }) }, "duplicate_wiki")
    assert(WikiStudioRegistry.capabilities(merge(w, { access: "ro" })).canEdit, false, "Read-only capabilities")
    s.registry.update("alpha", {}, true); assert(io.fileExists(w.root), true, "Unregister preserves data")
    assert(s.registry.list().length, 0, "Unregistered")
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
    var repeated=run(false,"rerun-key-123");assert(repeated.status,"completed","Idempotent engine rerun")
    var unchanged=WikiStudio.scan(w.root,false);assert(Object.keys(files).filter(function(p){return p!=="log.md"}).every(function(p){return unchanged[p]&&files[p].hash===unchanged[p].hash}),true,"Stable source ID does not duplicate pages")
    var managed=Object.keys(unchanged).filter(function(p){return !/(^|\/)(index|log|AGENTS)\.md$/.test(p)})[0]
    var edited=io.readFileString(w.root+"/"+managed)+"\nManual operator edit\n";io.writeFileString(w.root+"/"+managed,edited)
    run(false,"manual-conflict-123");assert(io.readFileString(w.root+"/"+managed),edited,"Ingestion never silently overwrites manual source-page edits")
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
