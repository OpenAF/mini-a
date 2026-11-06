(function() {
  loadLib(String(new java.io.File("js/wiki/mini-a-wiki.js").getCanonicalPath()))
  var assert = function(a,b,m) { ow.test.assert(a,b,m) }
  function fixture(v2, fn) {
    var parent = String(io.createTempDir("wiki-folders-")), root = String(new java.io.File(parent + "/wiki").getCanonicalPath())
    io.mkdir(root)
    var wm = new MiniAWikiManager({backend:"fs",root:root,access:"rw",skipBootstrap:true,wikiretrievalv2:v2,usegraph:true})
    try { fn(wm,root) } finally { wm.close(); io.rm(parent) }
  }
  function seed(wm, root) {
    io.mkdir(root + "/old/nested/empty")
    io.mkdir(root + "/target")
    io.writeFileString(root + "/old/index.md", "# Section\n[Child](nested/café page.md)\n")
    io.writeFileString(root + "/old/nested/café page.md", "---\r\ntitle: Café # keep comment\r\n---\r\n# CobaltQuokka\r\n[Home](../index.md)\r\n![Image](../image.bin)\r\n[Outside](../../outside.md)\r\n[Ref][a]\r\n[a]: ../image.bin\r\n")
    io.writeFileString(root + "/old/image.bin", "\u0000\u0001binary\u00ff")
    io.writeFileString(root + "/outside.md", "# Outside\n[Child](old/nested/caf%C3%A9%20page.md#part)\n![Image](old/image.bin)\n[[old/index.md|Landing]]\n`[example](old/index.md)`\n````\n[code](old/index.md)\n````\n")
    assert(wm.reindex().ok,true,"Initial index")
  }
  exports.testRecursiveFolders = function() {
    ;[false,true].forEach(function(v2) { fixture(v2,function(wm,root) {
      seed(wm,root)
      if (!global.__miniAWikiKnowledge) loadLib(__miniAPath("js/wiki/mini-a-wiki-knowledge.js"))
      global.__miniAWikiKnowledge.install(wm)
      var state = wm.knowledgeLoadState(), old = "old/nested/café page.md", raw = io.readFileString(root + "/" + old)
      state.sources.owner = {page:old,signature:wm.knowledgePageSignature(wm.parseFrontmatter(raw)),chunks:[{id:"chunk",page:old}]}
      state.chunks.chunk = {sourceKey:"owner",page:old}; assert(wm.knowledgeSaveState(state),true,"Save ownership")
      var preview = wm.previewFolder("old","target/新 folder")
      assert(preview.ok,true,"Preview"); assert(preview.pages,2,"Page count"); assert(preview.files,3,"All files"); assert(preview.folders,3,"Empty folder counted"); assert(preview.incomingLinks.length,1,"Incoming page")
      var originalReindex = wm.reindex, publications = 0
      wm.reindex = function() { publications++; return originalReindex.apply(this,arguments) }
      var moved = wm.moveFolder("old","target/新 folder",{expectedRevision:preview.revision})
      assert(moved.ok,true,"Move succeeds: " + JSON.stringify(moved)); assert(publications,1,"Single publication")
      assert(io.fileExists(root + "/old"),false,"Whole source removed")
      assert(new java.io.File(root + "/target/新 folder/nested/empty").isDirectory(),true,"Empty folder moved")
      assert(io.readFileString(root + "/target/新 folder/image.bin"),"\u0000\u0001binary\u00ff","Attachment bytes")
      var after = io.readFileString(root + "/target/新 folder/nested/café page.md")
      assert(after.indexOf("# keep comment\r\n")>=0,true,"Frontmatter and CRLF preserved")
      assert(after.indexOf("[Outside](../../../outside.md)")>=0,true,"External target rebased")
      assert(after.indexOf("![Image](../image.bin)")>=0,true,"Internal attachment stays relative")
      var outside = io.readFileString(root + "/outside.md")
      assert(outside.indexOf("target/%E6%96%B0%20folder/nested/caf%C3%A9%20page.md#part")>=0,true,"Encoded incoming link")
      assert(outside.indexOf("![Image](target/新 folder/image.bin)")>=0,true,"Incoming attachment")
      assert(outside.indexOf("[[target/新 folder/index.md|Landing]]")>=0,true,"Wiki reference mapping")
      assert(outside.indexOf("`[example](old/index.md)`")>=0,true,"Inline code preserved")
      assert(outside.indexOf("[code](old/index.md)")>=0,true,"Fenced code preserved")
      var ownership = wm.knowledgeLoadState()
      assert(ownership.sources.owner.page,"target/新 folder/nested/café page.md","Owner moved")
      assert(ownership.chunks.chunk.page,ownership.sources.owner.page,"Chunk moved")
      assert(ownership.sources.owner.signature,wm.knowledgePageSignature(wm.parseFrontmatter(after)),"Signature advanced only from verified baseline")
      assert(wm.backlinks("target/新 folder/index.md").backlinks.some(function(b) { return b.path === "outside.md" }),true,"Incoming backlinks updated")
      assert(wm.browse("target/新 folder").nearest_index.exists,true,"Browse index")
      assert(JSON.stringify(wm.tree("")).indexOf("café page.md")>=0,true,"Tree includes moved page")
      assert(wm.search("CobaltQuokka").some(function(h) { return h.path === ownership.sources.owner.page }),true,"Search moved path")
      assert(wm._graph._state.nodes["doc:" + ownership.sources.owner.page] !== undefined,true,"Graph moved path")
      var del = wm.previewFolder("target/新 folder")
      assert(wm.deleteFolder(del.source,{expectedRevision:del.revision,confirmation:"wrong"}).ok,false,"Exact confirmation required")
      var deleted = wm.deleteFolder(del.source,{expectedRevision:del.revision,confirmation:del.source})
      assert(deleted.ok,true,"Delete succeeds: " + JSON.stringify(deleted))
      assert(io.fileExists(root + "/target/新 folder"),false,"Complete deletion")
      assert(io.readFileString(root + "/outside.md"),outside,"Surviving links untouched")
      assert(wm.knowledgeLoadState().sources.owner,undefined,"Deleted ownership removed")
      assert(wm.search("CobaltQuokka").some(function(h) { return /café/.test(h.path) }),false,"Deleted path absent from search: " + JSON.stringify(wm.search("CobaltQuokka")))
      assert(wm._graph._state.nodes["doc:target/新 folder/nested/café page.md"],undefined,"Deleted graph node")
      assert(io.fileExists(deleted.snapshot + "/target/新 folder/image.bin"),true,"Verified recovery content retained")
    }) })
  }
  exports.testFolderSemanticAndReferences = function() { fixture(true,function(wm,root) {
    io.mkdir(root + "/old/empty")
    io.writeFileString(root + "/old/unchanged.md", "# Protocol\nTLS uses HTTP and Node.js.\n")
    io.writeFileString(root + "/old/asset.bin", "asset")
    io.writeFileString(root + "/outside.md", '# Outside\n<img src="old/asset.bin">\n[ref]: <old/unchanged.md> "Title"\n[inline](old/unchanged.md "Title")\n')
    assert(wm.reindex().ok,true,"Initial publication")
    var built=wm.graph("build",{extraction:"semantic",modelHelp:"off"})
    assert(built.ok !== false,true,"Deterministic semantic graph")
    var before=wm._graph._state.edges.filter(function(e){return e.type === "MENTIONS" && e.props.page === "old/unchanged.md"}).length
    assert(before>0,true,"Semantic evidence exists")
    var p=wm.previewFolder("old","new"),r=wm.moveFolder("old","new",{expectedRevision:p.revision})
    assert(r.ok,true,"Semantic move: "+JSON.stringify(r))
    var evidence=wm._graph._state.edges.filter(function(e){return e.type === "MENTIONS" && e.props.page === "new/unchanged.md"})
    assert(evidence.length,before,"Valid semantic evidence preserved on unchanged bytes")
    assert(evidence.every(function(e){return wm._graph._currentEvidence(e)}),true,"Moved semantic evidence remains valid")
    var raw=io.readFileString(root+"/outside.md")
    assert(raw.indexOf('src="new/asset.bin"')>=0,true,"HTML attachment rewritten")
    assert(raw.indexOf('[ref]: <new/unchanged.md> "Title"')>=0,true,"Reference definition and title preserved")
    assert(raw.indexOf('[inline](new/unchanged.md "Title")')>=0,true,"Inline link title preserved")
    var del=wm.previewFolder("new"),persist=wm._graph._persist
    wm._graph._persist=function(){return {ok:false,error:"injected graph persistence failure"}}
    var failed=wm.deleteFolder("new",{expectedRevision:del.revision,confirmation:"new"})
    assert(failed.ok,false,"Graph failure rejects operation success");assert(failed.recovery_pending,true,"Graph failure retains journal")
    wm._graph._persist=persist
    assert(wm.restoreFolder(failed.recoveryId).ok,true,"Graph failure can roll back")
  }) }
  exports.testFolderGuardsAndRecovery = function() { fixture(true,function(wm,root) {
    seed(wm,root)
    ;[["","x"],[".","x"],["old","old"],["old","old/nested/x"],["old","target"],["old","../x"],["@mount/old","x"],["old",".mini-a-wiki-state/x"]].forEach(function(pair) { assert(wm.previewFolder(pair[0],pair[1]).ok,false,"Reject " + pair.join(" -> ")) })
    io.mkdir(root + "/old/.mini-a-wiki-state")
    assert(wm.previewFolder("old","new").ok,false,"Protected nested engine state")
    io.rm(root + "/old/.mini-a-wiki-state")
    java.nio.file.Files.createSymbolicLink(new java.io.File(root + "/old/link").toPath(),new java.io.File(root + "/outside.md").toPath())
    assert(wm.previewFolder("old","new").ok,false,"Symlink preflight")
    java.nio.file.Files.delete(new java.io.File(root + "/old/link").toPath())
    var preview = wm.previewFolder("old","new")
    var held = __miniAWikiWriterLock(root), result = new java.util.concurrent.atomic.AtomicReference("")
    try {
      var thread = new java.lang.Thread(function() { var denied = wm.moveFolder("old","new",{expectedRevision:preview.revision}); result.set(denied.error || "unexpected") })
      thread.start(); thread.join(5000)
      assert(String(result.get()).indexOf("wiki-writer-busy") >= 0,true,"Concurrent folder writer rejected")
    } finally { held.release() }
    io.mkdir(root + "/old/another-empty")
    assert(wm.moveFolder("old","new",{expectedRevision:preview.revision}).error,"folder-stale-preview","Directory revision checked")
    preview = wm.previewFolder("old","new")
    wm._access = "ro"
    assert(wm.moveFolder("old","new",{expectedRevision:preview.revision}).ok,false,"Read-only rejected")
    wm._access = "rw"
    var expected = __miniAWikiFolder.revision(__miniAWikiFolder.scan(root)), original = wm.reindex
    wm.reindex = function() { return {ok:false,error:"injected publication failure"} }
    var failed = wm.moveFolder("old","new",{expectedRevision:preview.revision})
    assert(failed.ok,false,"Publication failure not success"); assert(failed.recovery_pending,true,"Recovery retained")
    assert(io.fileExists(root + "/.mini-a-wiki-folders/pending.json"),true,"Persistent journal")
    assert(wm.write("unrelated.md","# Not allowed").ok,false,"Pending transaction blocks writers")
    assert(wm.previewFolder("new","elsewhere").ok,false,"Pending transaction blocks other folders")
    assert(wm.restoreFolder("wrong").ok,false,"Recovery requires exact ID")
    var beforeReject = __miniAWikiFolder.revision(__miniAWikiFolder.scan(root)), savedAsset = io.readFileString(failed.snapshot + "/old/image.bin")
    io.writeFileString(failed.snapshot + "/old/image.bin", "corrupt snapshot")
    assert(wm.restoreFolder(failed.recoveryId).ok,false,"Corrupt snapshot rejected before rollback writes")
    assert(__miniAWikiFolder.revision(__miniAWikiFolder.scan(root)),beforeReject,"Corrupt snapshot rejection preserves live files")
    io.writeFileString(failed.snapshot + "/old/image.bin", savedAsset)
    wm.reindex = original
    var restored = wm.restoreFolder(failed.recoveryId)
    assert(restored.ok,true,"Verified rollback: " + JSON.stringify(restored))
    assert(__miniAWikiFolder.revision(__miniAWikiFolder.scan(root)),expected,"Complete snapshot restored")
    var reader=new MiniAWikiManager({root:root,backend:"fs",access:"ro",wikiretrievalv2:true,usegraph:true})
    try { assert(reader.search("CobaltQuokka").some(function(hit){return hit.path === "old/nested/café page.md"}),true,"Fresh reader searches restored snapshot") } finally { reader.close() }
  }) }
})()
