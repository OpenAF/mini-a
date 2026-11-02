(function() {
  loadLib("wiki-studio-api.js")
  loadLib("wiki-studio-pages.js")
  loadLib("wiki-studio-graph.js")
  loadLib("wiki-studio-jobs.js")
  loadLib("wiki-studio-sources.js")
  loadLib("wiki-studio-operations.js")
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
  exports.testGraph = function() { fixture(function(s, t) {
    var w = add(s, t)
    io.writeFileString(w.root + "/one.md", "# One\n[[two]]\n<script>alert(1)</script>")
    io.writeFileString(w.root + "/two.md", "# Two\n")
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
    function archive(name,entry){var out=new java.util.zip.ZipOutputStream(new java.io.FileOutputStream(t+"/"+name));out.putNextEntry(new java.util.zip.ZipEntry(entry));out.write(WikiStudio.bytes("safe content"));out.closeEntry();out.close();return t+"/"+name}
    rejects(function(){WikiStudio.validateZip(archive("slip.zip","../escape.md"))},"unsafe_path")
    var good=archive("good.zip","folder/page.md"); WikiStudio.extractZip(good,t+"/expanded")
    assert(io.readFileString(t+"/expanded/folder/page.md"),"safe content","Safe ZIP extraction")
    req.headers["x-upload-id"]=WikiStudio.id();req.headers["x-upload-path"]="..%2Fescape.md"
    rejects(function(){s.streamUpload(req,new java.io.ByteArrayInputStream(WikiStudio.bytes("x")))},"unsafe_path")
  }) }
})()
