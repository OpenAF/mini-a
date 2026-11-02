(function() {
  loadLib("wiki-studio-api.js")
  loadLib("wiki-studio-pages.js")
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
})()
