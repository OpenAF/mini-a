(function() {
  load("mini-a-common.js"); load("mini-a-wiki.js")
  var temporary = function() { var p = java.io.File.createTempFile("wiki-v2-test-", "").getCanonicalPath(); io.rm(p); io.mkdir(p); return p }
  var make = function(root, extra) { return new MiniAWikiManager(merge({ backend: "fs", root: root, access: "rw", wikiretrievalv2: true, wikiretrievalconfig: { passageChars: 256 } }, extra || {}), function() {}) }
  // Schema-3 integrity fixtures alter only the routed operations that own the
  // records under test; no flattened catalogue is recreated.
  var patchCatalogue = function(engine, pin, altered) {
    var manifest = clone(pin.manifest), originals = [], maps = ["pages","passages","reverseLinks","moveReverse","blockRefs"]
    maps.forEach(function(name) {
      var before = pin.catalog[name] || {}, after = altered[name] || {}, changed = {}
      Object.keys(before).concat(Object.keys(after)).forEach(function(key) { if (stringify(before[key],__,"") !== stringify(after[key],__,"")) changed[key] = true })
      Object.keys(changed).forEach(function(key) {
        var shard = engine._catalogueShard(key), descriptor = manifest.catalogue.shards[name][shard]
        var path, original, operation
        if (descriptor) { path = pin.dir + "/" + descriptor.path; original = io.readFileString(path); operation = af.fromJson(original); originals.push({ path:path, text:original }) }
        else {
          path = pin.dir + "/catalogue/" + name + "/" + shard + ".json"
          descriptor = { path:"catalogue/" + name + "/" + shard + ".json" }; manifest.catalogue.shards[name][shard] = descriptor
          operation = { schema:1, map:name, shard:shard, upsert:{}, tombstones:[] }; originals.push({ path:path, created:true })
        }
        if (isDef(after[key])) { operation.upsert[key] = after[key]; operation.tombstones = operation.tombstones.filter(function(id) { return id !== key }) }
        else { delete operation.upsert[key]; if (operation.tombstones.indexOf(key) < 0) operation.tombstones.push(key) }
        var text = stringify(operation,__,"")
        io.writeFileString(path,text)
        descriptor.bytes = MiniAWikiRetrievalV2.bytes(text); descriptor.checksum = MiniAWikiRetrievalV2.digestText(text)
        var listed=false; manifest.files.forEach(function(file) { if (file.path === descriptor.path) { file.bytes = descriptor.bytes; file.checksum = descriptor.checksum; listed=true } })
        if (!listed) manifest.files.push({path:descriptor.path,bytes:descriptor.bytes,checksum:descriptor.checksum})
      })
    })
    manifest.merkle = MiniAWikiRetrievalV2.manifestMerkle(manifest)
    return { manifest:manifest, restore:function() { originals.forEach(function(file) { if(file.created)java.nio.file.Files.deleteIfExists(new java.io.File(file.path).toPath());else io.writeFileString(file.path,file.text) }) } }
  }
  exports.testParser = function() {
    var constructorRaw = "---\r\ntitle: API\r\n---\r\n# Constructor\r\nfirst constructor\r\n# Constructor\r\nsecond constructor"
    var constructorParsed = global.MiniAWikiRetrievalV2.parse("constructor.md", constructorRaw, 256)
    ow.test.assert(constructorParsed.outline.map(function(h) { return h.id }).join(","), "constructor,constructor-2", "inherited object properties cannot corrupt repeated heading anchors")
    ow.test.assert(global.MiniAWikiRetrievalV2.parse("prototype.md", "# __proto__\nfirst\n# __proto__\nsecond", 256).outline.map(function(h) { return h.id }).join(","), "__proto__,__proto__-2", "prototype setter names remain ordinary heading keys")
    var constructorRange = MiniAWikiManager.prototype._sliceLines.call({}, constructorRaw.split("\n"), {section:"constructor-2"})
    ow.test.assert(constructorRange.lineStart, 6, "second Constructor resolves in exact raw front-matter revision")
    ow.test.assert(constructorRange.lineEnd, 7, "second Constructor section stops at raw EOF")
    var validator=require("tests/wikiRetrievalEvidence.js"), citationRaw="---\r\ntitle: É\r\n---\r\n# Section\r\nExact 😀 answer", citationStart=citationRaw.indexOf("Exact"), citationEnd=citationRaw.length
    var citation={path:"@last/same.md",content:citationRaw.substring(citationStart),revision:sha1(citationRaw),charStart:citationStart,charEnd:citationEnd,lineStart:5,lineEnd:5}
    citation.passage={page:citation.path,revision:citation.revision,charStart:citationStart,charEnd:citationEnd,startLine:5,endLine:5}
    ow.test.assert(validator.check(citationRaw,citation).correct,true,"evaluation checks exact CRLF Unicode raw revision and mounted reference")
    var damaged=clone(citation);damaged.revision=sha1("changed")
    ow.test.assert(validator.check(citationRaw,damaged).correct,false,"matching quoted text cannot conceal a stale revision")
    damaged=clone(citation);damaged.lineStart=2
    ow.test.assert(validator.check(citationRaw,damaged).correct,false,"evaluation rejects body-relative front-matter positions")
    damaged=clone(citation);damaged.passage.page="same.md"
    ow.test.assert(validator.check(citationRaw,damaged).correct,false,"evaluation rejects lost mount identity")
    damaged=clone(citation);damaged.charEnd++
    ow.test.assert(validator.check(citationRaw,damaged).correct,false,"substring clamping cannot disguise an out-of-revision range")
    var raw = "---\r\ntitle: Positions\r\n---\r\n# Repeated\r\nText é 😀\r\n```sh\r\n# Fake\r\n```\r\n    # Indented\r\n# Repeated\r\nWarning\r\n\r\nSetext\r\n======\r\n| A | B |\r\n|---|---|\r\n| x | y |\r\n" + new Array(800).join("é")
    var parsed = global.MiniAWikiRetrievalV2.parse("positions.md", raw, 256)
    ow.test.assert(parsed.outline.map(function(h) { return h.id }).join(","), "repeated,repeated-2,setext", "fences/indentation excluded and repeated anchors disambiguated")
    ow.test.assert(parsed.outline[0].lineStart, 4, "raw frontmatter offset")
    ow.test.assert(parsed.outline[2].lineEnd, raw.split("\n").length, "raw EOF exact")
    var windowed = global.MiniAWikiRetrievalV2.window(new Array(90).join("context line\n") + "linecapparameter\nending", "linecapparameter", 2000, 3)
    ow.test.assert(windowed.text.indexOf("linecapparameter") >= 0, true, "line-limited passage retains query-bearing line")
    ow.test.assert(windowed.text.split("\n").length <= 3, true, "restricted private selection respects line cap before reads")
    var range = MiniAWikiManager.prototype._sliceLines.call({}, raw.split("\n"), {section:"repeated-2"})
    ow.test.assert(range.lineStart, 10, "legacy section read shares repeated-heading anchor parser")
    ow.test.assert(MiniAWikiManager.prototype._sliceLines.call({}, raw.split("\n"), {section:"fake"}).linesRead, 0, "legacy section read ignores headings inside fences")
    ow.test.assert(MiniAWikiManager.prototype._sliceLines.call({}, raw.split("\n"), {section:"setext"}).lineStart, 13, "legacy section read supports Setext with raw frontmatter positions")
    var ids = {}
    parsed.passages.forEach(function(p) {
      ow.test.assert(raw.substring(p.charStart, p.charEnd), p.text, "passage matches exact raw characters")
      ow.test.assert(global.MiniAWikiRetrievalV2.bytes(raw.substring(0, p.charStart)), p.byteStart, "UTF-8 start differs correctly from UTF-16")
      ow.test.assert(global.MiniAWikiRetrievalV2.bytes(raw.substring(0, p.charEnd)), p.byteEnd, "UTF-8 end exact")
      ow.test.assert(ids[p.passageId] === true, false, "unique structural passage identity")
      ids[p.passageId] = true
    })
    ow.test.assert(parsed.passages.some(function(p) { return p.kind === "fragment" }), true, "oversized structures explicitly fragmented")
    ow.test.assert(parsed.passages[parsed.passages.length - 1].charEnd, raw.length, "last fragment reaches EOF without newline")
    var mergedSupport = global.MiniAWikiRetrievalV2.mergeSupportRanges([
      { kind: "instruction-context", charStart: 8, charEnd: 24, startLine: 2, endLine: 4 },
      { kind: "table-context", charStart: 16, charEnd: 32, startLine: 3, endLine: 5 },
      { kind: "table-header", charStart: 40, charEnd: 48, startLine: 6, endLine: 6 }
    ])
    ow.test.assert(mergedSupport.length, 2, "overlapping structural ranges are served once")
    ow.test.assert(mergedSupport[0].charStart + ":" + mergedSupport[0].charEnd, "8:32", "overlapping support retains the complete raw union")
    ow.test.assert(mergedSupport[0].kind, "structural-context", "multi-purpose support does not pretend to have one role")
    ow.test.assert(mergedSupport[0].kinds.join(","), "instruction-context,table-context", "multi-purpose support preserves every required role")
  }
  exports.testBoundedContextPostings = function() {
    var parser=global.MiniAWikiRetrievalV2
    ;[1,16,256,4096].forEach(function(size) {
      var page={passageIds:[]}, records={}
      for(var i=0;i<size;i++){var id="p"+i;page.passageIds.push(id);records[id]={charStart:i*10,charEnd:(i+1)*10}}
      ;[0,Math.floor(size/2)*10,(size-1)*10+5,size*10,size*10+5].forEach(function(position) {
        var used={}, index=parser.passageAt(page,records,position,used)
        ow.test.assert(index,Math.min(size,Math.floor(position/10)),"binary posting lookup returns exact boundary at size "+size)
        ow.test.assert(used.structuralContextLookupProbes<=Math.ceil(Math.log(size)/Math.LN2)+1,true,"posting comparisons stay logarithmic at size "+size)
      })
    })
    ow.test.assert(parser.passageAt({passageIds:[]},{},0,{}),0,"empty posting lookup reaches EOF")
    var dir=temporary(), wm, pin
    try {
      wm=make(dir,{wikiretrievalconfig:{passageChars:128}})
      var intro=[]
      for(var line=0;line<512;line++)intro.push("Ordinary unrelated paragraph "+line+" "+new Array(100).join("x")+"\n")
      wm.write("long.md",{title:"Long reference"},"# Instructions\n"+intro.join("\n")+"\nWarning: back up settings first.\n\n```sh\npostinglookupanswerparameter --apply\n```")
      ow.test.assert(wm.reindex().ok,true,"real Lucene long-page posting fixture built")
      pin=wm._retrievalV2.acquire()
      var page=pin.catalog.pages["long.md"], reads=0, originalRead=wm._backend.read
      wm._backend.read=function(){reads++;return originalRead.apply(wm._backend,arguments)}
      var result=wm.retrieve("postinglookupanswerparameter",{chunks:1,maxBytes:12000})
      ow.test.assert(result.evidence[0].supportingContext[0].content.indexOf("back up settings")>=0,true,"late real indexed instruction retains exact warning")
      ow.test.assert(result.budget.used.structuralContextLookupProbes<=Math.ceil(Math.log(page.passageIds.length)/Math.LN2)+9,true,"late context lookup avoids preceding page passages")
      ow.test.assert(page.passageIds.length>512,true,"fixture has many unrelated preceding passages")
      ow.test.assert(reads,0,"bounded context lookup fetches no complete candidate Markdown body")
      var forged=clone(pin.catalog), failure="", patched
      try {
        forged.pages["long.md"].passageIds.reverse()
        patched=patchCatalogue(wm._retrievalV2,pin,forged)
        try {wm._retrievalV2._validate(pin.dir,patched.manifest)}catch(e){failure=String(e.message||e)}
      } finally {if(patched)patched.restore()}
      ow.test.assert(failure,"invalid-passage-order","rechecksummed unsorted postings cannot invalidate binary range lookup")
    } finally {if(pin)wm._retrievalV2.release(pin);if(wm)wm.close();io.rm(dir)}
  }
  exports.testOverlappingStructuralSupport = function() {
    var dir=temporary(), wm, originalRanges=global.MiniAWikiRetrievalV2.supportRanges
    try {
      wm=make(dir)
      wm.write("overlap.md",{title:"Overlap"},"# Apply\nWarning: retain both selection reasons.\n\n```sh\noverlapcontextparameter --apply\n```")
      ow.test.assert(wm.reindex().ok,true,"overlapping support fixture builds")
      global.MiniAWikiRetrievalV2.supportRanges=function(page, passages, record) {
        var start=Math.max(0,record.charStart-48), end=record.charStart
        return global.MiniAWikiRetrievalV2.mergeSupportRanges([
          {kind:"instruction-context",charStart:start,charEnd:end,startLine:1,endLine:4},
          {kind:"table-context",charStart:start+8,charEnd:end,startLine:2,endLine:4}
        ])
      }
      var out=wm.retrieve("overlapcontextparameter",{chunks:1,maxBytes:12000}), support=out.evidence[0].supportingContext
      ow.test.assert(support.length,1,"overlapping required support is materialized only once")
      ow.test.assert(support[0].role,"structural-context","merged support does not discard a required role")
      ow.test.assert(support[0].roles.join(","),"instruction-context,table-context","merged support discloses every selected role")
      ow.test.assert(support[0].content.indexOf("retain both selection reasons")>=0,true,"merged support retains its exact raw union")
    } finally {
      global.MiniAWikiRetrievalV2.supportRanges=originalRanges
      if(wm)wm.close()
      io.rm(dir)
    }
  }
  exports.testListStructuralSupport = function() {
    var dir = temporary(), wm
    try {
      wm = make(dir)
      var raw = "# Procedure\r\nWarning: Back up the configuração before these steps.\r\n\r\n" + new Array(50).join("- ordinary setup step with detail\r\n") + "- listcontextparameter enables the final setting.\r\n"
      wm.write("list.md", { title: "Long procedure" }, raw)
      ow.test.assert(wm.reindex().ok, true, "long list fixture publishes")
      raw = wm.read("list.md").raw
      var out = wm.retrieve("listcontextparameter", { chunks: 1, maxBytes: 12000 }), evidence = out.evidence[0]
      ow.test.assert(evidence.structure.kind, "list", "long list is one explicit fragmented structure")
      ow.test.assert(evidence.structure.fragment, true, "late list item is a fragment")
      ow.test.assert(evidence.supportingContext.length, 1, "late list item retains its warning")
      ow.test.assert(evidence.supportingContext[0].role, "instruction-context", "warning has a distinct support role")
      ow.test.assert(evidence.supportingContext[0].content.indexOf("Back up the configuração") >= 0, true, "warning text is preserved")
      ow.test.assert(raw.substring(evidence.supportingContext[0].charStart, evidence.supportingContext[0].charEnd), evidence.supportingContext[0].content, "list support keeps exact CRLF and Unicode positions")
      var limited = wm.retrieve("listcontextparameter", { chunks: 1, maxQueries: 1 })
      ow.test.assert(limited.outcome, "partial", "missing list support is explicit under query budget")
      ow.test.assert(limited.evidence[0].contextOmitted, "structural-context-budget-or-unavailable", "list warning is never silently dropped")
      wm.write("separate.md", { title: "Separate" }, "# Previous\nWarning: Applies only here.\n# Next\n- unrelatedlistparameter is independent.\n")
      ow.test.assert(wm.retrieve("unrelatedlistparameter", { chunks: 1 }).evidence[0].supportingContext, __, "list context does not cross headings")
      wm.write("adjacent.md", { title: "Adjacent" }, "# Steps\nWarning: Only the first list.\n\n- first item\n- another item\n\nIndependent explanation.\n\n- secondlistparameter belongs to the second list.\n")
      ow.test.assert(wm.retrieve("secondlistparameter", { chunks: 1 }).evidence[0].supportingContext, __, "warning from a completed list does not attach to a later list")
    } finally { if (wm) wm.close(); io.rm(dir) }
  }
  exports.testApplicabilityMaintenanceBoundary = function() {
    var dir = temporary(), wm, pin
    try {
      wm = make(dir)
      wm.write("versions.md", { title: "Versions", applicability: { product: "mini-a", version: ["release-A", "release.C"] } }, "# Versions\narrayversionparameter is available here.")
      wm.write("unknown.md", { title: "Unknown" }, "# Unknown\narrayversionparameter has unknown applicability.")
      wm.write("future.md", { title: "Future", validity: { from: "9999-01-01" } }, "# Future\nfutureclaimparameter is not effective yet.")
      ow.test.assert(wm.reindex().ok, true, "applicability matrix publishes")
      var matching = wm.retrieve("arrayversionparameter", { applicability: { product: "mini-a", version: "release.C" } })
      ow.test.assert(matching.evidence.length, 1, "explicit exact array version selects only a confirmed match")
      ow.test.assert(matching.evidence[0].path, "versions.md", "unknown applicability does not satisfy an explicit constraint")
      ow.test.assert(wm.retrieve("arrayversionparameter", { applicability: { version: "release-B" } }).evidence.length, 0, "version strings are matched exactly without guessed ordering")
      var support = matching.evidence[0].passage
      ow.test.assert(wm.knowledgeRecordDerivative("fact", "array-claim", { claimKey: "array-overlap", value: 1, applicability: { product: "mini-a", version: ["release-A", "release.C"] } }, [support]).ok, true, "array applicability can ground a recorded claim")
      ow.test.assert(wm.knowledgeRecordDerivative("fact", "scalar-claim", { claimKey: "array-overlap", value: 2, applicability: { product: "mini-a", version: "release.C" } }, [support]).ok, true, "scalar applicability can ground a peer claim")
      ow.test.assert(wm.knowledgeConflictCandidates({ paths: ["versions.md"] }).candidates.length, 1, "overlapping array and scalar versions remain reviewable")
      pin = wm._retrievalV2.acquire()
      var page = pin.catalog.pages["future.md"], passage = pin.catalog.passages[page.passageIds[0]]
      var ref = { page: page.path, pageId: page.pageId, wikiId: pin.catalog.wikiId, revision: page.revision, passageId: passage.passageId, charStart: passage.charStart, charEnd: passage.charEnd }
      ow.test.assert(wm.knowledgeRecordDerivative("fact", "future", { claimKey: "future", value: true }, [ref], { dryRun: true }).error, "stale-support", "not-yet-effective source cannot ground a derivative")
      ow.test.assert(wm.knowledgeDerivativeCandidates({ paths: ["future.md"] }).candidates.length, 0, "failed registration creates no maintenance dependency")
    } finally { if (pin) wm._retrievalV2.release(pin); if (wm) wm.close(); io.rm(dir) }
  }
  exports.testStructuralContext = function() {
    var dir=temporary(), wm, portugueseManager
    try {
      var parser=global.MiniAWikiRetrievalV2
      var bounded="# Example\r\n```sh\r\n"+new Array(8).join("echo café\r\n")+"```\r\n\n| Name | Value |\r\n|---|---|\r\n| café | "+new Array(55).join("x")+" |\r\n"
      var parsed=parser.parse("example.md",bounded,64)
      ow.test.assert(parsed.passages.filter(function(p){return p.structure&&p.structure.kind==="fenced-code"}).length,1,"soft target retains a complete bounded code example")
      ow.test.assert(parsed.passages.filter(function(p){return p.structure&&p.structure.kind==="table"}).length,1,"soft target retains a complete bounded table")
      var adjacent=parser.parse("adjacent.md","```sh\necho first\n```\n```sh\necho second\n```",128)
      ow.test.assert(adjacent.passages.length,2,"adjacent fenced examples retain separate structure boundaries")
      wm=make(dir,{wikiretrievalconfig:{passageChars:128}})
      var rows=[]
      for(var i=0;i<30;i++)rows.push("| ordinary"+i+" | Linux | generic instructions for normal operation |")
      rows.push("| lateparameter | Solaris | use the platform-specific setting |")
      rows.push("| afterparameter | Linux | subsequent instructions |")
      rows.push("| finalparameter | Linux | final instructions |")
      rows.push("| terminalparameter | Linux | terminal instructions |")
      wm.write("table.md",{title:"Platform reference"},"# Platforms\n| Parameter | Platform | Instruction |\n|---|---|---|\n"+rows.join("\n"))
      wm.reindex()
      var reads=0, originalRead=wm._backend.read
      wm._backend.read=function(){reads++;return originalRead.apply(wm._backend,arguments)}
      var out=wm.retrieve("lateparameter",{chunks:1,maxBytes:8000}), e=out.evidence[0]
      ow.test.assert(out.evidence.length,1,"header support does not displace answer under one-chunk limit")
      ow.test.assert(e.content.indexOf("lateparameter")>=0,true,"late oversized table row selected")
      ow.test.assert(e.structure.kind,"table","evidence identifies table structure")
      ow.test.assert(e.structure.fragment,true,"oversized table fragment explicitly marked")
      ow.test.assert(e.supportingContext.length,1,"late table fragment includes bounded exact header evidence")
      ow.test.assert(e.supportingContext[0].content.indexOf("Parameter | Platform | Instruction")>=0,true,"column labels retained independently of row")
      ow.test.assert(reads,0,"header lookup does not fetch full source or immutable page blocks")
      ow.test.assert(out.budget.used.queries,2,"header lookup charged to same request query budget")
      ow.test.assert(parser.bytes(stringify(out,__,""))<=8000,true,"supporting text and references included in output ceiling")
      wm._backend.read=originalRead
      var raw=wm.read("table.md").raw
      ;[e].concat(e.supportingContext).forEach(function(part){ow.test.assert(raw.substring(part.charStart,part.charEnd),part.content,"header and row each match exact cited raw range");ow.test.assert(part.revision,sha1(raw),"header and row share pinned content revision")})
      ow.test.assert(e.next.reason,"remaining-structure","complete table fragment advertises remaining structure")
      var continuation=wm.agenticRead(e.next.path,e.next)
      ow.test.assert(continuation.body,raw.substring(e.charEnd,e.structure.charEnd),"structural continuation progresses through exact remaining rows")
      var limited=wm.retrieve("lateparameter",{chunks:1,maxQueries:1})
      ow.test.assert(limited.evidence[0].content.indexOf("lateparameter")>=0,true,"exhausted context query budget preserves relevant answer")
      ow.test.assert(limited.evidence[0].contextOmitted,"structural-context-budget-or-unavailable","missing header reported explicitly")
      ow.test.assert(limited.budget.used.queries,1,"context lookup does not reset query budget")
      var assembled=wm.assembleContext("lateparameter",{chunks:1,maxBytes:8000})
      ow.test.assert(assembled.chunks[0].supportingContext.length,1,"assembled context shares exact structural support selector")
      rows[10]="| complementparameter | Windows | complementary platform guidance |"
      wm.write("table.md",{title:"Platform reference"},"# Platforms\n| Parameter | Platform | Instruction |\n|---|---|---|\n"+rows.join("\n"))
      var combined=wm.retrieve("lateparameter complementparameter",{chunks:2,maxQueries:2,maxBytes:16000}), support=[], references=[]
      ow.test.assert(combined.evidence.length,2,"complementary rows remain eligible under shared two-query ceiling")
      combined.evidence.forEach(function(part){support=support.concat(part.supportingContext||[]);references=references.concat(part.contextReferences||[])})
      ow.test.assert(support.length,1,"same table header text emitted only once per selected wiki and revision")
      ow.test.assert(references.length,1,"second row references retained header rather than duplicating text")
      ow.test.assert(references[0].passageId,support[0].passage.passageId,"deduplicated reference resolves to surviving support passage")
      ow.test.assert(combined.budget.used.structuralSupportDuplicatesAvoided,1,"duplicate support is removed before evidence budget charging")
      ow.test.assert(combined.budget.used.queries,2,"repeated header does not consume another exact query")
      ow.test.assert(combined.budget.used.structuralContextCacheHits,1,"request-local header reuse is accounted explicitly")
      ow.test.assert(combined.stopReasons.indexOf("structural-context-budget-or-unavailable"),-1,"reused header does not manufacture exhausted-budget omission")
      var independent=wm.retrieve("lateparameter complementparameter",{chunks:2,maxQueries:2,maxBytes:16000})
      ow.test.assert(independent.budget.used.queries,2,"header reuse never suppresses lookup across unrelated requests")
      ow.test.assert(parser.bytes(stringify(combined,__,""))<=16000,true,"deduplicated support references obey complete-envelope ceiling")
      var changed=make(dir,{access:"ro",wikiretrievalconfig:{passageChars:256}})
      try { ow.test.assert(changed.agenticSearch("lateparameter").sources[0].passageChars,128,"read-only diagnostics report published granularity independently of local build target") } finally {changed.close()}
      wm.write("instructions.md",{title:"Safe launch"},"# Launch\r\n**Prerequisites:**\r\n- Back up the configuration.\r\n\r\n> **Warning:** Stop the old worker before changing settings.\r\n\r\n```sh\r\nlaunchparameter --apply\r\n```\r\n\r\n# Unrelated\r\n```sh\r\notherparameter --apply\r\n```")
      reads=0;wm._backend.read=function(){reads++;return originalRead.apply(wm._backend,arguments)}
      var instructions=wm.retrieve("launchparameter",{chunks:1,maxBytes:12000}), instruction=instructions.evidence[0]
      ow.test.assert(instruction.content.indexOf("launchparameter")>=0,true,"code answer remains the selected passage")
      var supportText=(instruction.supportingContext||[]).map(function(c){return c.content}).join("")
      ow.test.assert(supportText.indexOf("Back up the configuration")>=0,true,"explicit prerequisite list accompanies instruction")
      ow.test.assert(supportText.indexOf("Stop the old worker")>=0,true,"explicit warning accompanies instruction")
      ow.test.assert(reads,0,"instruction context uses direct postings without full page reads")
      wm._backend.read=originalRead
      var instructionRaw=wm.read("instructions.md").raw
      ;[instruction].concat(instruction.supportingContext).forEach(function(c){ow.test.assert(c.content,instructionRaw.substring(c.charStart,c.charEnd),"instruction and prerequisite evidence match exact CRLF raw range");ow.test.assert(c.revision,sha1(instructionRaw),"instruction context remains bound to cited revision")})
      ow.test.assert(instruction.supportingContext.every(function(c){return c.role==="instruction-context"}),true,"context is labelled as instruction support rather than a table header")
      wm.write("admonition.md",{title:"Admonition"},"# Apply\n> [!WARNING]\n> Stop the previous worker before applying this command.\n\n```sh\nadmonitionwarningparameter --apply\n```")
      var admonition=wm.retrieve("admonitionwarningparameter",{chunks:1,maxBytes:12000}).evidence[0]
      ow.test.assert(admonition.content.indexOf("admonitionwarningparameter")>=0,true,"GitHub-style admonition keeps the selected code answer")
      ow.test.assert(admonition.supportingContext.map(function(c){return c.content}).join("").indexOf("[!WARNING]")>=0,true,"GitHub-style warning marker is retained as exact structural support")
      ow.test.assert(admonition.supportingContext.map(function(c){return c.content}).join("").indexOf("Stop the previous worker")>=0,true,"GitHub-style warning body accompanies the instruction")
      ow.test.assert(admonition.supportingContext.every(function(c){return c.role==="instruction-context"}),true,"admonition is labelled as instruction support")
      var noContextBudget=wm.retrieve("launchparameter",{chunks:1,maxQueries:1})
      ow.test.assert(noContextBudget.evidence[0].contextOmitted,"structural-context-budget-or-unavailable","missing prerequisite context is explicit under exhausted budget")
      ow.test.assert(noContextBudget.budget.used.queries,1,"prerequisite lookup never resets request query budget")
      var unrelated=wm.retrieve("otherparameter",{chunks:1})
      ow.test.assert(isDef(unrelated.evidence[0].supportingContext),false,"warnings do not cross a different heading boundary")
      var fencedLabel=parser.parse("fake-warning.md","```text\nWarning: example content\n```\n\n```sh\nfakewarningparameter\n```",128)
      ow.test.assert(fencedLabel.passages.some(function(p){return isDef(p.contextRange)}),false,"warning-looking examples inside fences do not become prerequisites")
      var currentGeneration=wm._retrievalV2.acquire(), legacyManifest=clone(currentGeneration.manifest), legacyError=""
      try {legacyManifest.parser=5;try{wm._retrievalV2._validate(currentGeneration.dir,legacyManifest)}catch(e){legacyError=String(e.message||e)}} finally {wm._retrievalV2.release(currentGeneration)}
      ow.test.assert(legacyError,"incompatible-generation","parser5 artifacts require an explicit writable build for list context")
      wm.write("tight-support.md",{title:"Tight support"},"# Apply\nWarning: "+new Array(90).join("careful ")+"\n\n```sh\ntightcontextparameter --apply\n```")
      var tight=wm.retrieve("tightcontextparameter",{chunks:1,maxBytes:3000})
      ow.test.assert(tight.evidence.length,1,"tight context budget preserves the available instruction")
      ow.test.assert(tight.evidence[0].content.indexOf("tightcontextparameter")>=0,true,"tight quote retains the actual answer")
      ow.test.assert(tight.evidence[0].contextOmitted,"structural-context-output-budget","oversized required warning is explicitly omitted")
      ow.test.assert(tight.outcome,"partial","omitted required warning makes evidence incomplete")
      ow.test.assert(parser.bytes(stringify(tight,__,""))<=3000,true,"partial evidence respects complete output byte ceiling")
      var tightAssembled=wm.assembleContext("tightcontextparameter",{chunks:1,maxBytes:4000})
      ow.test.assert(tightAssembled.outcome,"partial","assembled context preserves incomplete support status")
      ow.test.assert(tightAssembled.chunks[0].contextOmitted,"structural-context-output-budget","assembled context preserves required-warning omission")
      var completeSupport=wm.retrieve("tightcontextparameter",{chunks:1,maxBytes:12000})
      ow.test.assert(completeSupport.outcome,"hits","fitting complete support does not manufacture partial status")
      ow.test.assert(completeSupport.evidence[0].supportingContext.length>0,true,"larger output budget includes exact warning support")
      var envelopeCap=parser.bytes(stringify(completeSupport.evidence[0],__,""))+200
      var envelopePacked=wm.retrieve("tightcontextparameter",{chunks:1,maxBytes:envelopeCap})
      ow.test.assert(envelopePacked.evidence[0].contextOmitted,"structural-context-output-budget","final envelope packing explicitly omits nonfitting required support")
      ow.test.assert(envelopePacked.outcome,"partial","final envelope support loss marks incomplete evidence")
      ow.test.assert(envelopePacked.evidence[0].content.indexOf("tightcontextparameter")>=0,true,"final envelope repacking preserves the available answer")
      ow.test.assert(parser.bytes(stringify(envelopePacked,__,""))<=envelopeCap,true,"final envelope repacking respects the derived byte limit")
      wm.write("prerequisite-section.md",{title:"Procedure"},"# Procedure\r\n## Prerequisites\r\n- Back up the configuração before starting.\r\n\r\n## Launch\r\nRun the following command.\r\n```sh\r\nsectionprerequisiteparameter --apply\r\n```\r\n\r\n## Other\r\n```sh\r\nothersectionparameter --apply\r\n```")
      var beforeSectionRead=wm._backend.read, sectionReads=0
      try {
        wm._backend.read=function(){sectionReads++;return beforeSectionRead.apply(this,arguments)}
        var sectionEvidence=wm.retrieve("sectionprerequisiteparameter",{chunks:1,maxBytes:12000})
        ow.test.assert(sectionEvidence.evidence.length,1,"procedure with a separate prerequisite heading is retrieved")
        ow.test.assert(sectionEvidence.evidence[0].supportingContext.length,1,"immediately preceding sibling prerequisite section is retained")
        ow.test.assert(sectionEvidence.evidence[0].supportingContext[0].role,"prerequisite-section","support identifies the separate prerequisite origin")
        ow.test.assert(sectionEvidence.evidence[0].supportingContext[0].content.indexOf("Back up the configuração")>=0,true,"complete explicit prerequisite instruction is retained")
        ow.test.assert(sectionReads,0,"separate prerequisite lookup uses outline and direct passage postings without reading the page body")
        ow.test.assert(wm.retrieve("othersectionparameter",{chunks:1}).evidence[0].supportingContext,__,"prerequisites do not cross an intervening procedure heading")
        var sectionBudget=wm.retrieve("sectionprerequisiteparameter",{chunks:1,maxQueries:1})
        ow.test.assert(sectionBudget.outcome,"partial","exhausted support-query budget reports incomplete evidence")
        ow.test.assert(sectionBudget.evidence[0].contextOmitted,"structural-context-budget-or-unavailable","missing prerequisite support is explicit")
      } finally {wm._backend.read=beforeSectionRead}
      var sectionRaw=wm.read("prerequisite-section.md").raw, prerequisite=sectionEvidence.evidence[0].supportingContext[0]
      ow.test.assert(sectionRaw.substring(prerequisite.charStart,prerequisite.charEnd),prerequisite.content,"prerequisite quote is the exact raw CRLF/Unicode revision range")
      ow.test.assert(prerequisite.revision,sha1(sectionRaw),"prerequisite reference binds the same current page revision")
      ow.test.assert(prerequisite.lineStart,sectionRaw.substring(0,prerequisite.charStart).split("\n").length,"prerequisite lines include the raw frontmatter offset")
      wm.write("late-prerequisite.md",{title:"Late procedure"},"# Procedure\n## Prerequisites\n- Preserve the backup before starting.\n\n## Execute\n```sh\n"+new Array(90).join("echo ordinary\n")+"lateprerequisiteparameter --apply\n```")
      var latePrerequisite=wm.retrieve("lateprerequisiteparameter",{chunks:1,maxBytes:12000}).evidence[0]
      ow.test.assert(latePrerequisite.lineStart>64,true,"answer lies late in an oversized code structure")
      ow.test.assert(latePrerequisite.structure.fragment,true,"late instruction is an explicitly fragmented code block")
      ow.test.assert(isArray(latePrerequisite.supportingContext),true,"late code fragment does not lose its prerequisite association")
      ow.test.assert(latePrerequisite.supportingContext.length,1,"all code fragments inherit prerequisites associated with the block start")
      ow.test.assert(latePrerequisite.supportingContext[0].content.indexOf("Preserve the backup")>=0,true,"late fragment retains its required prerequisite")
      wm.write("nested-prerequisite.md",{title:"Nested procedure"},"# Procedure\r\n## Prerequisites\r\n### Backup\r\n- Preserve the configuração.\r\n\r\n## Execute\r\n### First step\r\n```sh\r\nnestedprerequisiteparameter --apply\r\n```\r\n\r\n## Unrelated\r\n### Second step\r\n```sh\r\nunrelatednestedparameter --apply\r\n```")
      var nestedEvidence=wm.retrieve("nestedprerequisiteparameter",{chunks:1,maxBytes:16000}).evidence[0]
      ow.test.assert(nestedEvidence.supportingContext.some(function(context){return context.role==="prerequisite-section"&&context.content.indexOf("Preserve the configuração")>=0}),true,"nested procedure inherits the preceding parent prerequisite including its nested heading")
      var nestedRaw=wm.read("nested-prerequisite.md").raw
      nestedEvidence.supportingContext.forEach(function(context){ow.test.assert(context.content,nestedRaw.substring(context.charStart,context.charEnd),"nested prerequisite support preserves exact raw positions")})
      ow.test.assert(wm.retrieve("unrelatednestedparameter",{chunks:1}).evidence[0].supportingContext,__,"nested prerequisite inheritance does not cross an intervening sibling procedure")
      wm.write("table-prerequisite.md",{title:"Required configuration"},"# Procedure\n## Prerequisites\n- Preserve the backup.\n\n## Configure\n| Parameter | Value |\n| --- | --- |\n"+new Array(12).join("| ordinary | default |\n")+"| tableprerequisiteparameter | enabled |\n")
      var tableEvidence=wm.retrieve("tableprerequisiteparameter",{chunks:1,maxBytes:16000,maxQueries:8}).evidence[0]
      ow.test.assert(tableEvidence.supportingContext.some(function(context){return context.role==="prerequisite-section"&&context.content.indexOf("Preserve the backup")>=0}),true,"table fragments retain prerequisite support alongside their header")
      ow.test.assert(tableEvidence.supportingContext.some(function(context){return context.content.indexOf("| Parameter | Value |")>=0}),true,"table prerequisite support does not replace the column header")
      portugueseManager=make(dir+"/pt-support",{wikilexical:{language:"portuguese"}})
      portugueseManager.write("portuguese-prerequisite.md",{title:"Procedimento"},"# Procedimento\r\n## Pré-requisitos\r\n- Preserve a configuração antes de executar.\r\n\r\n## Executar\r\n```sh\r\nportugueseprerequisiteparameter --apply\r\n```")
      ow.test.assert(portugueseManager.reindex().ok,true,"Portuguese prerequisite fixture builds with the actual configured analyzer")
      var portugueseOut=portugueseManager.retrieve("portugueseprerequisiteparameter",{chunks:1,maxBytes:12000}), portugueseEvidence=portugueseOut.evidence[0], portugueseRaw=portugueseManager.read("portuguese-prerequisite.md").raw
      ow.test.assert(portugueseOut.sources[0].analyzer,"portuguese","trusted diagnostics identify the effective Portuguese lexical configuration")
      ow.test.assert(portugueseEvidence.supportingContext.length,1,"Portuguese prerequisite heading is supported through real indexed retrieval")
      ow.test.assert(portugueseEvidence.supportingContext[0].role,"prerequisite-section","Portuguese support retains its evidence role")
      ow.test.assert(portugueseRaw.substring(portugueseEvidence.supportingContext[0].charStart,portugueseEvidence.supportingContext[0].charEnd),portugueseEvidence.supportingContext[0].content,"Portuguese support quotes exact Unicode/CRLF positions")
      ow.test.assert(portugueseEvidence.supportingContext[0].revision,sha1(portugueseRaw),"Portuguese support binds the current indexed source revision")
      wm.write("warning-table.md",{title:"Table warning"},"# Options\r\nWarning: Stop the worker before changing any value.\r\n\r\n| Parameter | Value |\r\n|---|---|\r\n"+new Array(35).join("| ordinary | unchanged |\r\n")+"| warningtableparameter | enabled |\r\n")
      var tableRead=wm._backend.read, warningReads=0
      try {
        wm._backend.read=function(){warningReads++;return tableRead.apply(this,arguments)}
        var warned=wm.retrieve("warningtableparameter",{chunks:1,maxBytes:12000})
        ow.test.assert(warned.evidence[0].supportingContext.length,2,"late table evidence retains both warning and column header")
        ow.test.assert(warned.evidence[0].supportingContext.some(function(c){return c.role==="table-header"&&c.content.indexOf("Parameter | Value")>=0}),true,"table column labels remain exact supporting evidence")
        ow.test.assert(warned.evidence[0].supportingContext.some(function(c){return c.role==="table-context"&&c.content.indexOf("Stop the worker")>=0}),true,"preceding table warning remains exact supporting evidence")
        ow.test.assert(warningReads,0,"combined warning/header lookup reads no full Markdown bodies")
        ow.test.assert(warned.budget.used.queries,3,"both supporting ranges consume the same request query budget")
        var limitedWarning=wm.retrieve("warningtableparameter",{chunks:1,maxQueries:2})
        ow.test.assert(limitedWarning.outcome,"partial","missing table warning under query limits makes evidence incomplete")
        ow.test.assert(limitedWarning.evidence[0].supportingContext[0].role,"table-header","complete header survives an unavailable warning range")
        ow.test.assert(limitedWarning.evidence[0].contextOmitted,"structural-context-budget-or-unavailable","table warning omission is explicit")
      } finally {wm._backend.read=tableRead}
      var warningRaw=wm.read("warning-table.md").raw
      warned.evidence[0].supportingContext.forEach(function(part){ow.test.assert(warningRaw.substring(part.charStart,part.charEnd),part.content,"combined table support uses exact raw CRLF ranges");ow.test.assert(part.revision,sha1(warningRaw),"combined table support binds the same revision")})
      var parserPin=wm._retrievalV2.acquire()
      try {
        [3,4].forEach(function(version){var priorParser=clone(parserPin.manifest), parserError="";priorParser.parser=version;try{wm._retrievalV2._validate(parserPin.dir,priorParser)}catch(e){parserError=String(e.message||e)};ow.test.assert(parserError,"incompatible-generation","prior parser artifacts require explicit writable reindex: "+version)})
        var obsolete=clone(parserPin.manifest),obsoleteError="";delete obsolete.catalogue.transactionFormat
        try{wm._retrievalV2._validate(parserPin.dir,obsolete)}catch(e){obsoleteError=String(e.message||e)}
        ow.test.assert(obsoleteError,"reindex-required","unmarked development schema-3 artifacts require an authorized rebuild")
      }finally{wm._retrievalV2.release(parserPin)}
    } finally {if(portugueseManager)portugueseManager.close();if(wm)wm.close();io.rm(dir)}
  }
  exports.testRetrievalAndPublication = function() {
    var dir = temporary(), wm
    try {
      wm = make(dir)
      wm.write("long.md", { title: "Reference" }, "# Intro\n" + new Array(200).join("Ordinary prose.\n") + "\n# Answer\nwikirestrictrefttl is the reference expiry parameter.")
      wm.write("links.md", { title: "Links" }, "# Navigation\n[reference](long.md)")
      var built = wm.reindex()
      ow.test.assert(built.ok, true, "explicit generation build succeeds under real Lucene")
      var out = wm.retrieve("wikirestrictrefttl", { chunks: 1 })
      ow.test.assert(out.evidence.length, 1, "manual page not in ingest manifest is retrievable")
      ow.test.assert(out.evidence[0].lineStart > 150, true, "answer late in page is selected")
      var raw = wm.read("long.md").raw, evidence = out.evidence[0]
      ow.test.assert(raw.substring(evidence.charStart, evidence.charEnd), evidence.content, "quoted revision/range matches authority")
      ow.test.assert(evidence.origin, "wiki-page", "wiki evidence not source chunks")
      ow.test.assert(isFinite(evidence.nativeScore), true, "actual native score preserved")
      ow.test.assert(evidence.rankScore > 0, true, "separate common rank")
      var original = wm._backend.read, backendReads = 0
      wm._backend.read = function(p) { backendReads++; return original.call(wm._backend,p) }
      wm.agenticSearch("wikirestrictrefttl")
      var opens = wm._retrievalV2.metrics.readerOpens
      wm.agenticSearch("wikirestrictrefttl"); wm.open("long.md"); wm.navigate("long.md", { section: "Answer" }); wm.backlinks("long.md")
      ow.test.assert(backendReads, 0, "warm compact ranking/outlines/backlinks use no source-body fetches")
      ow.test.assert(wm._retrievalV2.metrics.readerOpens, opens, "reader reused within generation")
      ow.test.assert(wm.agenticSearch("genuinelyabsentidentifier").outcome, "zero", "indexed zero is distinct from incomplete search")
      ow.test.assert(backendReads, 0, "zero result does not scan source pages")
      ow.test.assert(wm.backlinks("long.md").count, 1, "reverse links without optional graph")
      wm.write("another.md",{title:"Other"},"# Other\nwikirestrictrefttl also has prerequisites.")
      ow.test.assert(wm.retrieve("wikirestrictrefttl",{maxCandidates:1}).outcome,"partial","candidate truncation reports incomplete search")
      wm.delete("another.md")
      var before = io.readFileString(wm._retrievalV2.root + "/current.json")
      wm._retrievalV2._beforeActivate = function() { throw new Error("injected activation failure") }
      ow.test.assert(wm.reindex().ok, false, "activation failure reported")
      ow.test.assert(io.readFileString(wm._retrievalV2.root + "/current.json"), before, "failed publication leaves current pointer untouched")
      ow.test.assert(wm.retrieve("wikirestrictrefttl").evidence.length, 1, "old working generation remains queryable")
      delete wm._retrievalV2._beforeActivate
      var cursor = wm.agenticRead("long.md", { section: "Answer", maxChars: 10 }).next
      wm.write("long.md", { title: "Reference" }, "# Replacement\nretirementmarker is current.")
      ow.test.assert(wm._lastServingUpdate.ok, true, "incremental page update published")
      ow.test.assert(wm.agenticRead(cursor.path,cursor).error, "stale-reference", "old cursor invalidated on update")
      ow.test.assert(wm.retrieve("wikirestrictrefttl").evidence.length, 0, "retired passage not searchable in new requests")
      ow.test.assert(wm.retrieve("retirementmarker").evidence.length, 1, "new revision searchable")
      wm.delete("long.md")
      ow.test.assert(wm.retrieve("retirementmarker").evidence.length, 0, "deletion removes current evidence")
      wm.close()
      ow.test.assert(wm._retrievalV2.serving.length, 0, "reader resources closed")
      var ro = make(dir,{access:"ro"})
      ow.test.assert(ro.reindex().ok, false, "read-only generation build refused")
      ro.close()
    } finally { if (wm) wm.close(); io.rm(dir) }
  }
  exports.testFederationAndBudgets = function() {
    var dir = temporary(), mounts = [], root
    try {
      for (var i = 0; i < 3; i++) { io.mkdir(dir + "/" + i); mounts.push(make(dir + "/" + i)) }
      mounts[0].write("same.md", {title:"Loose reference"}, "# General\nexpiry references are useful.")
      mounts[1].write("same.md", {title:"Other"}, "# General\nexpiry unrelated content.")
      mounts[2].write("same.md", {title:"Exact"}, "# Expiry\nwikirestrictrefttl controls expiry references.")
      mounts.forEach(function(m) { ow.test.assert(m.reindex().ok,true,"mount fixture generation built") })
      root = mounts[0]
      root.attach("middle",{root:dir+"/1",backend:"fs"}); root.attach("last",{root:dir+"/2",backend:"fs"})
      var out = root.retrieve("wikirestrictrefttl expiry", { wiki:"*",chunks:1,maxCandidates:9 })
      ow.test.assert(out.evidence[0].path,"@last/same.md","last mount wins common reranking despite earlier hits")
      ow.test.assert(out.evidence[0].passage.wiki,"last","passage reference binds selected logical wiki")
      ow.test.assert(root.retrieve("wikirestrictrefttl",{wiki:"primary"}).evidence.length,0,"explicit primary scope excludes other mounts")
      var dispatchSource=io.readFileString("mini-a.js")
      ;["wk","cbWk"].forEach(function(prefix) {
        var mapping=new RegExp("var "+prefix+"SearchOpts = (\\{[\\s\\S]*?\\n\\s*\\})").exec(dispatchSource)
        var options=new Function(prefix+"Params",prefix+"Path","return "+mapping[1])({wiki:"last",maxQueries:1,maxCandidates:4},"")
        var selected=root.agenticSearch("wikirestrictrefttl",options)
        ow.test.assert(selected.results[0].path,"@last/same.md","core dispatch mapping preserves mount-qualified evidence: "+prefix)
        ow.test.assert(selected.sources.length,1,"core explicit mount scope excludes unrelated sources: "+prefix)
      })
      var partial = root.retrieve("expiry",{wiki:"*",maxCandidates:1})
      ow.test.assert(partial.outcome,"partial","insufficient allocation is honest partial coverage")
      ow.test.assert(partial.sources.filter(function(s) {return s.status==="omitted"}).length,2,"budget never resets per mount")
      var unknown = root.retrieve("expiry",{wiki:"unknown"})
      ow.test.assert(unknown.ok,false,"unknown selector rejected")
      root.attach("broken",{root:dir+"/missing",backend:"fs"})
      ow.test.assert(root.retrieve("expiry",{wiki:["last","broken"]}).outcome,"partial","missing artifacts reported independently")
      mounts[2].write("version.md",{title:"Old correct",applicability:{product:"Mini-A",version:"1"}},"# Guide\nversionmarker old instruction")
      mounts[2].write("new.md",{title:"New incompatible",applicability:{product:"Mini-A",version:"2"}},"# Guide\nversionmarker new instruction")
      var applicable = mounts[2].retrieve("versionmarker",{applicability:{version:"1"}})
      ow.test.assert(applicable.evidence[0].path,"version.md","version applicability precedes editorial timestamps")
    } finally { if(root)root.close(); mounts.forEach(function(m){m.close()}); io.rm(dir) }
  }
  exports.testFederatedAliasAndPermissionBoundary = function() {
    var dir = temporary(), root, remote
    try {
      io.mkdir(dir + "/primary"); io.mkdir(dir + "/shared")
      root = make(dir + "/primary")
      remote = make(dir + "/shared")
      remote.write("same.md", {title:"Private alias"}, "# Answer\naliaspermissionparameter is present here.")
      ow.test.assert(remote.reindex().ok, true, "alias fixture has a serving generation")
      ow.test.assert(root.reindex().ok, true, "primary fixture has a serving generation")
      ow.test.assert(root.attach("first", {root:dir+"/shared",backend:"fs"}).ok, true, "first alias attached")
      ow.test.assert(root.attach("second", {root:dir+"/shared",backend:"fs"}).ok, true, "second alias attached")
      var aliased = root.retrieve("aliaspermissionparameter", {wiki:["first","second"],chunks:2,maxCandidates:4})
      ow.test.assert(aliased.evidence.map(function(e) {return e.path}).sort().join(","), "@first/same.md,@second/same.md", "selected aliases keep separate mount-qualified evidence identity")
      ow.test.assert(root.retrieve("aliaspermissionparameter", {wiki:"first"}).evidence[0].path, "@first/same.md", "explicit alias scope cannot return another alias")
      ow.test.assert(root.retrieve("aliaspermissionparameter", {wiki:"primary"}).evidence.length, 0, "primary scope cannot return aliased evidence")
      ow.test.assert(root.agenticSearch("aliaspermissionparameter", {wiki:["first","first"]}).error, "duplicate-wiki", "conflicting explicit selectors are rejected")

      var engine = root._mounts.filter(function(m) {return m.name === "first"})[0].manager._retrievalV2
      var slowQuery = engine._query
      engine._query = function() {java.lang.Thread.sleep(30);return slowQuery.apply(this,arguments)}
      try {
        var slow = root.agenticSearch("aliaspermissionparameter", {wiki:["first","second"],maxMillis:20})
        ow.test.assert(slow.outcome, "partial", "a slow selected mount cannot claim complete federation")
        ow.test.assert(slow.sources[1].status, "omitted", "later mount is honestly omitted after request deadline")
        ow.test.assert(slow.budget.used.queries <= slow.budget.limits.maxQueries, true, "slow mount uses the request-wide query budget")
      } finally {engine._query = slowQuery}
      var originalRank = engine._rank, originalStamp = engine._stamp, permissionChecks = 0, revoked = false
      engine._stamp = function(path) {permissionChecks++; return revoked ? __ : originalStamp.call(this, path)}
      engine._rank = function(hit, query) {var ranked = originalRank.call(this, hit, query); revoked = true; return ranked}
      try {
        var denied = root.agenticSearch("aliaspermissionparameter", {wiki:"first",limit:1})
        ow.test.assert(denied.results.length, 0, "revocation after candidate discovery cannot disclose indexed search metadata")
        ow.test.assert(denied.outcome, "partial", "revoked search reports partial coverage")
        ow.test.assert(denied.sources[0].status, "partial", "revoked source status agrees with request outcome")
        ow.test.assert(denied.stopReasons.indexOf("stale-or-revoked-evidence") >= 0, true, "revoked search reports bounded reason")
        ow.test.assert(permissionChecks >= 2, true, "search rechecks source permission before output")
      } finally {engine._rank = originalRank;engine._stamp = originalStamp}
    } finally {if(root)root.close();if(remote)remote.close();io.rm(dir)}
  }
  exports.testFederatedRetryBudget = function() {
    var dir = temporary(), wm
    try {
      wm = make(dir)
      wm.write("answer.md", {title:"Answer"}, "# Answer\nretrybudgetparameter is available.")
      ow.test.assert(wm.reindex().ok, true, "retry fixture publishes a predecessor")
      wm.write("answer.md", {title:"Answer"}, "# Answer\nretrybudgetparameter is still available.")
      ow.test.assert(wm.reindex().ok, true, "retry fixture publishes a current generation")
      var engine = wm._retrievalV2, originalQuery = engine._query, calls = 0
      engine._query = function() {calls++;if(calls === 1)throw new Error("catalogue-shard-integrity-failure");return originalQuery.apply(this,arguments)}
      try {
        var capped = wm.agenticSearch("retrybudgetparameter", {maxQueries:1})
        ow.test.assert(calls, 1, "predecessor retry cannot bypass the request query budget")
        ow.test.assert(capped.outcome, "partial", "exhausted retry returns partial coverage")
        ow.test.assert(capped.stopReasons.indexOf("query-budget") >= 0, true, "exhausted retry exposes a bounded budget reason")
        ow.test.assert(capped.budget.used.queries, 1, "failed first query remains charged")
      } finally {engine._query = originalQuery}
    } finally {if(wm)wm.close();io.rm(dir)}
  }
  exports.testRestrictedPassages = function() {
    load("mini-a-mcp-wiki.js")
    ow.test.assert(__miniAMcpWikiSafeChars("😀😀x",3),"😀","restricted UTF-16 cap does not split or overallocate surrogate pairs")
    ow.test.assert(__miniAMcpWikiSafeChars("secret description",0),"","zero metadata allowance discloses no remaining text")
    ow.test.assert(__miniAMcpWikiSafeChars("😀😀x",4).length,4,"supplementary characters consume two restricted character units")
    var dir = temporary(), wm
    try {
      wm = make(dir, {wikitelemetry:true,wikisourceurl:"https://private.invalid/{{path}}",wikisourceinline:true,wikisourcefield:"canonical"})
      wm.write("private-path.md", { title: "Answer" }, "# Intro\n" + new Array(100).join("Ordinary text.\n") + "\n# Selected\nopaqueanswerparameter controls expiry.")
      ow.test.assert(wm.reindex().ok, true, "restricted fixture built")
      global.__wikiManager = wm
      var state = new MiniAMcpWikiRestriction({ wikirestrict:true, wikirestrictpagecooldown:60 }, {backend:"fs",root:String(dir)})
      global.__miniAMcpWiki = {restriction:state}
      var found = __miniAMcpWikiRestrictedSearch({query:"opaqueanswerparameter"})
      ow.test.assert(found.results.length,1,"restricted search returns opaque selected page")
      ow.test.assert(isUnDef(__miniAMcpWikiRestrictedSearch({query:"title:*"}).results), true, "restricted search rejects field-based enumeration")
      ow.test.assert(stringify(found).indexOf("private.invalid") < 0, true, "restricted metadata suppresses generated custom-field inline citation URLs")
      ow.test.assert(Object.keys(found.results[0]).sort().join(","),"description,reference,title","no topology/revision/range diagnostics disclosed")
      var granted = state.refs[found.results[0].reference]
      ow.test.assert(isMap(granted.passage),true,"private grant revision/range pinned")
      var read = __miniAMcpWikiRestrictedRead({path:found.results[0].reference})
      ow.test.assert(read.content.indexOf("opaqueanswerparameter") >= 0,true,"restricted default read selects answer instead of prefix")
      ow.test.assert(Object.keys(read).join(","),"content","no paths or hashes in read output")
      ow.test.assert(__miniAMcpWikiRestrictedSearch({query:"opaqueanswerparameter"}).results.length,0,"page cooldown applies across passages")
      var oldState = new MiniAMcpWikiRestriction({wikirestrict:true,wikirestrictpagecooldown:1},{backend:"fs",root:String(dir)})
      global.__miniAMcpWiki={restriction:oldState}
      var stale = __miniAMcpWikiRestrictedSearch({query:"opaqueanswerparameter"})
      wm.write("private-path.md",{title:"Answer"},"# Changed\nreplacementparameter is current")
      var staleRead = __miniAMcpWikiRestrictedRead({path:stale.results[0].reference})
      ow.test.assert(isObject(staleRead.error),false,"stale response contains no internal object")
      ow.test.assert(staleRead.content,__,"first stale reference use never returns revised content")
      wm.write("bare-private-path.md", "# Heading\nbareparameter has no explicit title")
      var bare = __miniAMcpWikiRestrictedSearch({query:"bareparameter"})
      ow.test.assert(bare.results[0].title.indexOf("bare-private-path.md") < 0, true, "raw path fallback cannot leak through restricted title")
      wm.write("private-procedure.md",{title:"Procedure"},"# Procedure\r\n## Prerequisites\r\n- Preserve the configuração.\r\n\r\n## Execute\r\n### Step\r\n```sh\r\nopaquesupportparameter --apply\r\n```")
      var supportSearch=__miniAMcpWikiRestrictedSearch({query:"opaquesupportparameter"}), beforeChars=oldState.usage.chars
      var supportRead=__miniAMcpWikiRestrictedRead({reference:supportSearch.results[0].reference})
      ow.test.assert(supportRead.content.indexOf("Preserve the configuração")>=0,true,"restricted opaque read includes the shared nested prerequisite")
      ow.test.assert(supportRead.content.indexOf("opaquesupportparameter")>=0,true,"restricted support does not displace the answer")
      ow.test.assert(Object.keys(supportRead).join(","),"content","fitting support adds no topology or internal references")
      ow.test.assert(supportRead.content.length<=oldState.policy.readChars,true,"restricted support obeys the existing character ceiling")
      ow.test.assert(supportRead.content.split("\n").length<=oldState.policy.readLines,true,"restricted support obeys the existing line ceiling")
      ow.test.assert(oldState.usage.chars-beforeChars,supportRead.content.length,"restricted support and answer consume the same cumulative character ledger")
      var tightState=new MiniAMcpWikiRestriction({wikirestrict:true,wikirestrictreadchars:128},{backend:"fs",root:String(dir)})
      global.__miniAMcpWiki={restriction:tightState}
      wm.write("private-large-warning.md",{title:"Apply"},"# Apply\nWarning: "+new Array(80).join("Keep a backup. ")+"\n\n```sh\nopaquetightparameter --apply\n```")
      var tightSearch=__miniAMcpWikiRestrictedSearch({query:"opaquetightparameter"})
      var tightRead=__miniAMcpWikiRestrictedRead({reference:tightSearch.results[0].reference})
      ow.test.assert(tightRead.content.indexOf("opaquetightparameter")>=0,true,"restricted tight budget still returns the answer")
      ow.test.assert(tightRead.incomplete,true,"restricted omitted support reports a topology-free incomplete indicator")
      ow.test.assert(tightRead.content.length<=tightState.policy.readChars,true,"oversized warning cannot increase restricted disclosure ceilings")
      var privateMetrics=wm._retrievalV2.telemetry.restricted
      ow.test.assert(privateMetrics.search_rejected,1,"pre-core restricted query rejection is counted privately")
      ow.test.assert(privateMetrics.read_invalid_reference,1,"stale restricted reference is counted without retaining its value")
      ow.test.assert(privateMetrics.read_incomplete,1,"restricted support omission is counted separately from successful reads")
      ow.test.assert(stringify(privateMetrics).indexOf("opaquetightparameter"),-1,"restricted telemetry retains no query text")
      ow.test.assert(stringify(privateMetrics).indexOf("private-procedure"),-1,"restricted telemetry retains no page path")
      var recordRestricted=wm._retrievalV2._recordRestrictedTelemetry
      try {
        wm._retrievalV2._recordRestrictedTelemetry=function(){throw new Error("telemetry fixture unavailable")}
        ow.test.assert(__miniAMcpWikiRestrictedSearch({query:"title:*"}).error,"restricted-query-rejected","telemetry failure cannot alter a policy rejection")
      } finally {wm._retrievalV2._recordRestrictedTelemetry=recordRestricted}
      tightState.usage.searches=tightState.policy.maxSearches
      ow.test.assert(__miniAMcpWikiRestrictedSearch({query:"allowedparameter"}).error,"restricted-budget-exhausted","pre-core quota failure preserves the existing rejection contract")
      ow.test.assert(privateMetrics.search_quota,1,"pre-core quota failure is counted separately")
      var telemetryPath=wm._retrievalV2.manager._getIndexRoot()+"/.mini-a-wiki-state/telemetry.json", persistedBefore=io.fileExists(telemetryPath)?io.readFileString(telemetryPath):null
      var readOnlyMetrics=make(dir,{access:"ro",wikitelemetry:true})
      try {
        readOnlyMetrics._retrievalV2._prepareTelemetry(Date.now())
        var beforeRejected=Number(readOnlyMetrics._retrievalV2.telemetry.restricted&&readOnlyMetrics._retrievalV2.telemetry.restricted.search_rejected||0)
        readOnlyMetrics._retrievalV2._recordRestrictedTelemetry("search","rejected",1,3)
        ow.test.assert(readOnlyMetrics._retrievalV2.telemetry.restricted.search_rejected,beforeRejected+1,"read-only manager records aggregate telemetry in memory")
      } finally {readOnlyMetrics.close()}
      ow.test.assert(io.fileExists(telemetryPath)?io.readFileString(telemetryPath):null,persistedBefore,"read-only telemetry and shutdown never persist state")
    } finally { if(wm)wm.close();io.rm(dir) }
  }
  exports.testLexicalAndEvidenceBudget = function() {
    var dir = temporary(), wm
    try {
      wm = make(dir,{wikilexical:{language:"english",synonyms:[["maintenance window","quiet period"]]}})
      wm.write("syn.md",{title:"Operations"},"# Operations\nA quiet period is the safest time to perform updates.")
      wm.write("huge.md",{title:"Huge"},"# Huge\nlongparameter " + new Array(900).join("é"))
      ow.test.assert(wm.reindex().ok,true,"v2 synonym schema build")
      var expanded = wm.retrieve("maintenance window")
      ow.test.assert(expanded.evidence[0].content.indexOf("quiet period")>=0,true,"real indexed multiword synonym applied")
      ow.test.assert(expanded.sources[0].expansions[0],"quiet period","trusted bounded expansion visible")
      ow.test.assert(expanded.budget.used.queries,2,"expansion charged against shared attempt budget")
      var cut=wm.retrieve("longparameter",{maxBytes:2200,chunks:1,tokens:1000})
      ow.test.assert(cut.ok,true,"oversized evidence returns a fitting excerpt")
      ow.test.assert(global.MiniAWikiRetrievalV2.bytes(stringify(cut,__,"")) <= 2200,true,"complete envelope UTF-8 bytes accounted")
      ow.test.assert(cut.evidence.length,1,"optional timing diagnostics never displace the only fitting evidence")
      ow.test.assert(cut.timingsOmitted,"output-budget","small output explicitly reports omitted optional timings")
      if(cut.evidence[0].next){var n=cut.evidence[0].next, resumed=wm.agenticRead(n.path,n);ow.test.assert(resumed.body.length>0,true,"evidence fragment continuation progresses")}
      var constrained = wm.agenticSearch('title:Missing AND prose:"maintenance window"')
      ow.test.assert(constrained.results.length, 0, "synonym alternatives never broaden explicit field/Boolean constraints")
      ow.test.assert(constrained.budget.used.queries, 1, "explicit syntax does not claim natural-language expansion attempts")
      var fieldQuery = wm.agenticSearch("title:Operations")
      ow.test.assert(fieldQuery.results[0].path, "syn.md", "v2 preserves existing indexed title-field syntax")
      ow.test.assert(wm.agenticSearch("content:longparameter").results[0].path, "huge.md", "legacy content field maps to passage prose")
      ow.test.assert(wm.agenticSearch("title:(").error, "invalid-query", "invalid explicit query returns status rather than empty hits")
      ow.test.assert(isArray(wm.search("title:(")), false, "legacy return adapter does not flatten invalid query into empty array")
      var zero = wm.agenticSearch("genuinelyabsentparameter")
      ow.test.assert(zero.stages.indexOf("rank") < 0, true, "zero-result diagnostics do not advertise a ranking pass")
      ow.test.assert(Number(wm._retrievalV2.analyzers.size()),0,"query/writer analyzers and delegates released")
      var report=wm._retrievalV2.maintenance({limit:4})
      ow.test.assert(report.modelCalls,0,"maintenance report never invokes a model")
      ow.test.assert(report.writes,0,"maintenance report never edits wiki authority")
      var current=wm._retrievalV2.acquire(), bad=clone(af.fromJson(io.readFileString(current.dir+"/manifest.json")))
      bad.files[0].path="../outside"
      var rejected=false;try{wm._retrievalV2._validate(current.dir,bad)}catch(e){rejected=true}
      ow.test.assert(rejected,true,"artifact traversal rejected")
      wm._retrievalV2.release(current)
      io.mkdir(dir+"/pt")
      var portuguese=make(dir+"/pt",{wikilexical:{language:"portuguese"}})
      try {
        portuguese.write("manual.md",{title:"Configuração"},"# Configuração\nOs documentos são importantes. error: [X]")
        ow.test.assert(portuguese.reindex().ok,true,"real Portuguese passage index built")
        ow.test.assert(portuguese.retrieve("documento").evidence.length,1,"real v2 Portuguese stemming")
        ow.test.assert(portuguese.retrieve("Configuração").evidence.length,1,"accented query survives Unicode analysis")
        ow.test.assert(portuguese.retrieve("error: [X]").evidence.length,1,"literal technical query syntax is escaped")
      } finally {portuguese.close()}
    } finally {if(wm)wm.close();io.rm(dir)}
  }
  exports.testEnhancedPassageLexical = function() {
    var dir = temporary(), wm, reader
    try {
      wm = make(dir,{wikilexical:{language:"english",shingles:true,ngrams:true,queryExpansion:true}})
      wm.write("answer.md",{title:"Configuration"},"# Configuration\nwikirestrictrefttl controls reference expiry. A quasar reactor requires twinengine maintenance.")
      for (var i = 0; i < 7; i++) wm.write("support-"+i+".md",{title:"Supporting "+i},"# Supporting\n" + (i === 0 ? "A reactor uses twinengine maintenance safely." : "Unrelated supporting notes number "+i))
      ow.test.assert(wm.reindex().ok,true,"configured enhanced passage index builds with real Lucene")
      var snapshot = wm._retrievalV2.acquire(), L = Packages.org.apache.lucene
      try {
        ow.test.assert(snapshot.manifest.indexContract.analyzer,"org.apache.lucene.analysis.en.EnglishAnalyzer","effective analyzer identity is fingerprinted from the actual factory")
        var incompatible = clone(snapshot.manifest), rejected = false
        incompatible.indexContract.analysisVersion = "unsupported-analysis-contract"
        try {wm._retrievalV2._validate(snapshot.dir,incompatible)} catch(e){rejected=true}
        ow.test.assert(rejected,true,"a contradictory effective analysis contract is rejected even with a copied fingerprint")
        incompatible = clone(snapshot.manifest); delete incompatible.indexContract; rejected = false
        try {wm._retrievalV2._validate(snapshot.dir,incompatible)} catch(e){rejected=true}
        ow.test.assert(rejected,true,"legacy incomplete fingerprints require explicit writable rebuild rather than reader migration")
        ow.test.assert(isDef(L.index.MultiTerms.getTerms(snapshot.reader,"prose__shingle")),true,"actual passage shingle field is populated")
        ow.test.assert(L.index.MultiTerms.getTerms(snapshot.reader,"prose__shingle").iterator().seekExact(new L.util.BytesRef("reference expiry")),true,"configured shingle analyzer stores actual multiword terms")
        ow.test.assert(isDef(L.index.MultiTerms.getTerms(snapshot.reader,"prose__ngram")),true,"actual passage ngram field is populated")
      } finally {wm._retrievalV2.release(snapshot)}
      reader = new MiniAWikiManager({backend:"fs",root:dir,access:"ro",wikiretrievalv2:true,wikilexical:{language:"english",shingles:true,ngrams:true,queryExpansion:true}},function(){})
      var locked = reader._retrievalV2.acquire(), writerLock = locked.directory.obtainLock("write.lock")
      try { ow.test.assert(reader.agenticSearch("wikirestrictref",{maxCandidates:16,maxQueries:8}).results.length > 0,true,"enhanced read-only queries work while the real Lucene writer lock is unavailable") }
      finally {writerLock.close();reader._retrievalV2.release(locked)}
      var out = reader.agenticSearch("wikirestrictref",{maxCandidates:16,maxQueries:8})
      ow.test.assert(out.results.some(function(hit){return hit.path === "answer.md"}),true,"actual character ngram route retrieves a partial identifier")
      ow.test.assert(out.sources[0].routes.indexOf("ngrams") >= 0,true,"effective ngram route is reported")
      ow.test.assert(out.sources[0].routes.indexOf("shingles") >= 0,true,"effective shingle route is reported")
      ow.test.assert(out.sources[0].routes.indexOf("queryExpansion") >= 0,true,"real MoreLikeThis query expansion executes without a writer")
      ow.test.assert(out.budget.used.queries,4,"all enhanced attempts use one shared query budget")
      ow.test.assert(reader.agenticSearch("wikirestrictrefttl",{maxQueries:8,maxCandidates:16}).results[0].path,"answer.md","exact identifier still wins against broad ngram candidates")
      var limited = reader.agenticSearch("wikirestrictref",{maxQueries:1,maxCandidates:16})
      ow.test.assert(limited.outcome,"partial","skipped configured routes report an incomplete search")
      ow.test.assert(limited.budget.used.queries,1,"enhanced routes cannot reset the attempt budget")
      ow.test.assert(limited.sources[0].omittedRoutes.length,3,"trusted diagnostics identify routes omitted due to budget")
      var explicit = reader.agenticSearch('title:Missing AND prose:"reference expiry"',{maxQueries:8,maxCandidates:16})
      ow.test.assert(explicit.results.length,0,"enhanced natural-language routes never broaden explicit Boolean constraints")
      ow.test.assert(explicit.sources[0].routes.join(","),"explicit-lexical","explicit route accurately reports capabilities")
      ow.test.assert(Number(reader._retrievalV2.analyzers.size()),0,"enhanced analyzer delegates are released")
      reader.close(); reader = __; wm.close(); wm = __
      var pointerBefore = io.readFileString(dir+"/.mini-a-wiki-serving/current.json")
      reader = new MiniAWikiManager({backend:"fs",root:dir,access:"ro",wikiretrievalv2:true,wikilexical:{language:"english",shingles:true,ngrams:true,pseudoRelevanceFeedback:true}},function(){})
      var changedQuery = reader.agenticSearch("quasar",{maxQueries:8,maxCandidates:16})
      ow.test.assert(changedQuery.sources[0].routes.indexOf("pseudoRelevanceFeedback") >= 0,true,"query-only feedback configuration can change on a compatible read-only index")
      ow.test.assert(io.readFileString(dir+"/.mini-a-wiki-serving/current.json"),pointerBefore,"query-only lexical changes never migrate or republish the index")
      reader.close();reader = __
      wm = make(dir,{wikilexical:{language:"english",pseudoRelevanceFeedback:true}})
      ow.test.assert(wm.reindex().ok,true,"explicit reindex publishes a compatible feedback contract")
      var feedback = wm.agenticSearch("quasar",{maxQueries:4,maxCandidates:8})
      ow.test.assert(feedback.sources[0].routes.indexOf("pseudoRelevanceFeedback") >= 0,true,"real passage feedback executes from eligible seed text")
      ow.test.assert(feedback.sources[0].feedbackCandidates > 0,true,"feedback seed materialisation is visible")
      ow.test.assert(feedback.results.some(function(hit){return /^support-/.test(hit.path)}),true,"feedback actually retrieves complementary passages absent from the original term query")
      ow.test.assert(feedback.budget.used.candidates <= 8,true,"seeds and final candidates share their bounded allocation")
      ow.test.assert(feedback.budget.used.queries,2,"feedback charges its extra engine query")
      var stored = wm._luceneStoredDoc, failed
      try {
        wm._luceneStoredDoc = function(){throw new Error("injected seed backend failure")}
        failed = wm.agenticSearch("quasar",{maxQueries:4,maxCandidates:8})
      } finally {wm._luceneStoredDoc = stored}
      ow.test.assert(failed.outcome,"partial","feedback backend failure is distinguishable from a successful zero result")
      ow.test.assert(failed.budget.used.queries,2,"failed feedback retains already consumed query attempts")
      ow.test.assert(failed.budget.used.candidates > 0,true,"failed seed fetch retains its candidate materialisation charge")
      var tiny = wm.agenticSearch("quasar",{maxQueries:4,maxCandidates:1})
      ow.test.assert(tiny.sources[0].omittedRoutes[0],"pseudoRelevanceFeedback","no seed inspection occurs without candidate capacity")
      ow.test.assert(tiny.budget.used.candidates <= 1,true,"feedback cannot exceed a single-candidate budget")
      var constrained = wm.agenticSearch("quasar",{maxQueries:4,maxCandidates:8,applicability:{version:"unknown-release"}})
      ow.test.assert(constrained.sources[0].routes.indexOf("pseudoRelevanceFeedback"),-1,"inapplicable seed passages never contribute feedback terms")
      ow.test.assert(constrained.results.length,0,"applicability filtering survives feedback discovery")
      wm.write("answer.md",{title:"Retired configuration",superseded:true},"# Retired\nquasar reactor twinengine maintenance")
      var retired = wm.agenticSearch("quasar",{maxQueries:4,maxCandidates:8})
      ow.test.assert(retired.results.length,0,"superseded evidence cannot seed feedback or appear in a new current request")
    } finally {if(reader)reader.close();if(wm)wm.close();io.rm(dir)}
  }
  exports.testLifecycleAndSuppression = function() {
    load("mini-a-wiki-knowledge.js")
    var dir = temporary(), wm, pin
    try {
      wm = make(dir,{wikitelemetry:true,wikiretrievalconfig:{passageChars:256,telemetryFlushQueries:2}})
      wm.write("evidence.md",{title:"Evidence"},"# Support\npendingparameter is authorised wiki evidence.")
      ow.test.assert(wm.reindex().ok,true,"lifecycle fixture built")
      var state=wm._knowledgeEmptyState()
      state.chunks.unrelated={page:"evidence.md",text:"fabricated source chunk text",active:true}
      wm.knowledgeSaveState(state)
      var authority=io.readFileString(wm._knowledgeStatePath())
      wm.retrieve("pendingparameter");wm.retrieve("pendingparameter")
      ow.test.assert(io.readFileString(wm._knowledgeStatePath()),authority,"v2 telemetry never rewrites authority")
      ow.test.assert(io.readFileString(wm._knowledgeTelemetryPath()).indexOf("pendingparameter"),-1,"aggregate telemetry excludes queries")
      ow.test.assert(wm.retrieve("fabricated").evidence.length,0,"source chunk text never acquires wiki citation positions")
      io.mkdir(dir+"/.mini-a-wiki-ingest")
      io.writeFileString(dir+"/.mini-a-wiki-ingest/journal.json",stringify({phase:"prepared",operations:[{path:"evidence.md"}]},__,""))
      ow.test.assert(wm.retrieve("pendingparameter").evidence.length,0,"pending journal suppresses retrieve")
      ow.test.assert(wm.agenticSearch("pendingparameter").results.length,0,"pending journal suppresses compact search")
      ow.test.assert(wm.assembleContext("pendingparameter").chunks.length,0,"pending journal suppresses context")
      ow.test.assert(wm.open("evidence.md").error,"stale-evidence","pending journal suppresses cached outline")
      ow.test.assert(wm.agenticRead("evidence.md").body,__,"pending journal suppresses reads")
      io.rm(dir+"/.mini-a-wiki-ingest/journal.json")
      load("mini-a-skills.js")
      wm.write("skill.md",{title:"Old skill",type:"skill"},"# Skill\nskillparameter operates the console")
      var provider=new MiniAWikiSkillProvider(wm), selected=provider.open("wiki:skill.md")
      ow.test.assert(selected.title,"Old skill","wiki skill uses serving metadata")
      wm.write("skill.md",{title:"New skill",type:"skill"},"# Skill\nskillparameter is revised")
      ow.test.assert(provider.open("wiki:skill.md").title,"New skill","v2 skill facade cannot serve stale TTL metadata")
      load("mini-a-mcp-wiki.js");load("mini-a-mcp-skills.js")
      global.__wikiManager=wm
      var restriction=new MiniAMcpWikiRestriction({wikirestrict:true},{backend:"fs",root:String(dir)})
      global.__miniAMcpWiki={restriction:restriction}
      var skillGrant=restriction.issue("skill.md")
      ow.test.assert(isString(restriction.refs[skillGrant].revision),true,"restricted skill grant privately pins wiki revision")
      wm.write("skill.md",{title:"Changed again",type:"skill"},"# Skill\nnew private revision")
      ow.test.assert(__miniAMcpSkillsRestrictedRead({ref:skillGrant}).content,__,"restricted skill stale grant cannot serve changed revision")
      pin=wm._retrievalV2.acquire();var documents=Number(pin.reader.numDocs())
      wm.close()
      ow.test.assert(Number(pin.reader.numDocs()),documents,"close defers reader closure while acquired")
      ow.test.assert(wm._retrievalV2.serving.length,1,"pinned generation retained until release")
      wm._retrievalV2.release(pin);pin=null
      ow.test.assert(wm._retrievalV2.serving.length,0,"last release closes retained reader")
    } finally { if(pin)wm._retrievalV2.release(pin);if(wm)wm.close();io.rm(dir) }
    ;["reader","directory"].forEach(function(failedResource) {
      var failureDir=temporary(), manager, snapshot, allowClose=false, readerCalls=0, directoryCalls=0
      try {
        manager=make(failureDir);manager.write("close.md",{title:"Close"},"# Close\nclosefailureparameter is supported.")
        ow.test.assert(manager.reindex().ok,true,"close-failure fixture built with real Lucene")
        var engine=manager._retrievalV2;snapshot=engine.acquire()
        var nativeReader=snapshot.reader, nativeDirectory=snapshot.directory
        snapshot.reader={close:function(){readerCalls++;if(failedResource==="reader"&&!allowClose)throw new java.io.IOException("injected reader close failure");nativeReader.close()},getRefCount:function(){return nativeReader.getRefCount()}}
        snapshot.directory={close:function(){directoryCalls++;if(failedResource==="directory"&&!allowClose)throw new java.io.IOException("injected directory close failure");nativeDirectory.close()}}
        engine.close();manager._logFn=function(){throw new Error("injected warning logger failure")}
        var releaseError=""
        try{engine.release(snapshot)}catch(e){releaseError=String(e.message||e)}
        ow.test.assert(releaseError,"","close failure cannot turn a completed release into an exception")
        ow.test.assert(snapshot.refs,0,"close failure does not lose the released pin")
        ow.test.assert(Number(snapshot.pendingReleases.get()),0,"close failure does not requeue an already released pin")
        ow.test.assert(engine.serving.length,1,"failed resource closure retains its retry handle")
        ow.test.assert(engine.metrics.resourceCloseFailures,1,"actual failed closure attempt is counted")
        ow.test.assert(Number(nativeReader.getRefCount()),failedResource==="reader"?1:0,"resource closure progress matches the failed component")
        ow.test.assert(nativeDirectory.listAll().length>0,true,"directory stays open until reader closes and directory closure succeeds")
        if(failedResource==="reader")ow.test.assert(directoryCalls,0,"reader failure never closes its directory prematurely")
        allowClose=true;engine.close()
        ow.test.assert(engine.serving.length,0,"later shutdown retries and retires the failed closure")
        ow.test.assert(Number(nativeReader.getRefCount()),0,"retried reader is actually closed")
        ow.test.assert(readerCalls,failedResource==="reader"?2:1,"successful reader closure is never repeated")
        ow.test.assert(directoryCalls,failedResource==="directory"?2:1,"directory closure retries only its failed component")
        var directoryClosed=false;try{nativeDirectory.listAll()}catch(e){directoryClosed=true}
        ow.test.assert(directoryClosed,true,"retried directory is actually closed")
        snapshot=null
      } finally {allowClose=true;if(snapshot&&snapshot.refs>0)manager._retrievalV2.release(snapshot);if(manager)manager.close();io.rm(failureDir)}
    })
    var evictionDir=temporary(), evictionManager, held, permitDirectoryClose=false
    try {
      evictionManager=make(evictionDir);evictionManager.write("evict.md",{title:"Evict"},"# Evict\nevictionfirstparameter is current.")
      ow.test.assert(evictionManager.reindex().ok,true,"eviction close-failure fixture built")
      var evictionEngine=evictionManager._retrievalV2;held=evictionEngine.acquire()
      ow.test.assert(evictionManager.write("evict.md",{title:"Evict"},"# Evict\nevictionsecondparameter is current.").ok,true,"second generation retained alongside pinned first")
      var second=evictionEngine.acquire(), secondReader=second.reader, secondDirectory=second.directory, directoryAttempts=0
      second.directory={close:function(){directoryAttempts++;if(!permitDirectoryClose)throw new java.io.IOException("injected eviction directory close failure");secondDirectory.close()}}
      evictionEngine.release(second)
      evictionManager._logFn=function(){throw new Error("injected eviction logger failure")}
      ow.test.assert(evictionManager.write("evict.md",{title:"Evict"},"# Evict\nevictionthirdparameter is current.").ok,true,"publication succeeds even when old-reader retention cleanup is deferred")
      ow.test.assert(evictionEngine.metrics.resourceCloseFailures,directoryAttempts,"every failed eviction/helper cleanup attempt is counted")
      ow.test.assert(af.fromJson(stringify(evictionEngine.metrics,__,"")).resourceCloseFailures,directoryAttempts,"atomic metric remains enumerable in trusted JSON diagnostics")
      ow.test.assert(second._closePending,true,"failed eviction marks its cached generation unavailable for serving")
      ow.test.assert(second._readerClosed,true,"failed directory eviction retains completed reader closure")
      ow.test.assert(Number(secondReader.getRefCount()),0,"evicted reader is actually closed")
      ow.test.assert(evictionEngine.serving.length,2,"failed eviction retains bounded resource handles")
      var opensBefore=evictionEngine.metrics.readerOpens, unavailable=evictionManager.retrieve("evictionthirdparameter")
      ow.test.assert(unavailable.evidence.length,0,"persistent cleanup failure cannot serve a partially closed cached reader")
      ow.test.assert(unavailable.outcome,"partial","exhausted resource cleanup returns explicit incomplete search")
      ow.test.assert(unavailable.sources[0].status,"unavailable","coverage records the unavailable serving source")
      ow.test.assert(evictionEngine.metrics.readerOpens,opensBefore,"persistent eviction failure cannot open unbounded replacement readers")
      ow.test.assert(evictionEngine.metrics.resourceCloseFailures,directoryAttempts,"failed retry attempts remain fully counted")
      ow.test.assert(Number(held.reader.getRefCount()),1,"other pinned generation is never closed during eviction retries")
      permitDirectoryClose=true
      var recovered=evictionManager.retrieve("evictionthirdparameter")
      ow.test.assert(recovered.evidence.length,1,"later request retries cleanup and serves the active generation")
      ow.test.assert(recovered.evidence[0].content.indexOf("evictionthirdparameter")>=0,true,"recovered reader returns current exact evidence")
      ow.test.assert(evictionEngine.serving.length,2,"recovered generation respects the reader pool bound")
      var evictedDirectoryClosed=false;try{secondDirectory.listAll()}catch(e){evictedDirectoryClosed=true}
      ow.test.assert(evictedDirectoryClosed,true,"pending directory handle is actually closed after retry")
      ow.test.assert(Number(held.reader.getRefCount()),1,"recovery preserves the other in-flight reader")
    } finally {permitDirectoryClose=true;if(held)evictionManager._retrievalV2.release(held);if(evictionManager)evictionManager.close();io.rm(evictionDir)}
    ;["initialization","staged"].forEach(function(mode) {
      var resourceDir=temporary(), resourceManager, originalSnapshot, closePermitted=false, nativeHandles=[], readerHook
      try {
        resourceManager=make(resourceDir);resourceManager.write("resource.md",{title:"Resource"},"# Resource\nstagedresourceparameter is supported.")
        ow.test.assert(resourceManager.reindex().ok,true,"unmanaged resource fixture built")
        var resourceEngine=resourceManager._retrievalV2;originalSnapshot=resourceEngine.acquire();readerHook=resourceEngine._openReader
        var badCatalog=clone(originalSnapshot.catalog);badCatalog.passages.phantom={}
        var wrapReader=function(reader){return {numDocs:function(){return reader.numDocs()},getRefCount:function(){return reader.getRefCount()},close:function(){if(!closePermitted)throw new java.io.IOException("injected unmanaged reader close failure");reader.close()}}}
        if(mode==="initialization")resourceEngine._openReader=function(directory){var reader=readerHook.call(this,directory);nativeHandles.push({reader:reader,directory:directory});return wrapReader(reader)}
        for(var attempt=0;attempt<2;attempt++) {
          var openError="", stagedSnapshot
          try {
            stagedSnapshot=resourceEngine._openSnapshot(originalSnapshot.dir,originalSnapshot.manifest,mode==="initialization"?badCatalog:originalSnapshot.catalog)
            nativeHandles.push({reader:stagedSnapshot.reader,directory:stagedSnapshot.directory});stagedSnapshot.reader=wrapReader(stagedSnapshot.reader)
            resourceEngine._closeSnapshot(stagedSnapshot)
          } catch(e){openError=String(e.message||e)}
          ow.test.assert(openError,mode==="initialization"?"generation-index-count-mismatch":"injected unmanaged reader close failure","failed initialization preserves its error and failed cleanup is explicit")
        }
        ow.test.assert(Number(resourceEngine._pendingClosures.size()),2,"failed unmanaged cleanup retains both handles for retry")
        ow.test.assert(Number(resourceEngine._resourceSlots.availablePermits()),0,"serving and failed staged resources share the three-slot ceiling")
        var resourceOpens=resourceEngine.metrics.readerOpens, budgetError=""
        try{resourceEngine._openSnapshot(originalSnapshot.dir,originalSnapshot.manifest,originalSnapshot.catalog)}catch(e){budgetError=String(e.message||e)}
        ow.test.assert(budgetError,"generation-resource-budget","failed cleanup cannot create unbounded new native resources")
        ow.test.assert(resourceEngine.metrics.readerOpens,resourceOpens,"exhausted slots prevent a reader open")
        ow.test.assert(resourceManager.retrieve("stagedresourceparameter").evidence.length,1,"previous valid serving generation remains usable despite failed staging cleanup")
        ow.test.assert(Number(originalSnapshot.reader.getRefCount()),1,"pending unmanaged cleanup never closes the pinned serving reader")
        closePermitted=true;resourceEngine._openReader=readerHook;resourceEngine._guard(function(){})
        ow.test.assert(Number(resourceEngine._pendingClosures.size()),0,"later guarded operation drains failed unmanaged closures")
        ow.test.assert(Number(resourceEngine._resourceSlots.availablePermits()),2,"native slots return exactly once after retry")
        nativeHandles.forEach(function(handle){ow.test.assert(Number(handle.reader.getRefCount()),0,"failed unmanaged reader is actually closed");var closed=false;try{handle.directory.listAll()}catch(e){closed=true};ow.test.assert(closed,true,"failed unmanaged directory is actually closed")})
        resourceEngine.release(originalSnapshot);originalSnapshot=null;resourceEngine.close()
        ow.test.assert(Number(resourceEngine._resourceSlots.availablePermits()),3,"shutdown releases all native resource slots")
        var closedOpenError="";try{resourceEngine._openSnapshot("unused",{}, {})}catch(e){closedOpenError=String(e.message||e)}
        ow.test.assert(closedOpenError,"retrieval-closed","shutdown cannot reopen unmanaged readers")
      } finally {closePermitted=true;if(resourceManager&&readerHook)resourceManager._retrievalV2._openReader=readerHook;if(originalSnapshot)resourceManager._retrievalV2.release(originalSnapshot);if(resourceManager)resourceManager.close();io.rm(resourceDir)}
    })
    ;["success","failure"].forEach(function(finishMode) {
      var closeDir=temporary(), closeManager, servingPin, closeThread, finishNative=new java.util.concurrent.CountDownLatch(1), readyNative=new java.util.concurrent.CountDownLatch(1), closeErrors=new java.util.concurrent.ConcurrentLinkedQueue(), allowNative=false, blockNative=false, readerAttempts=0, directoryAttempts=0
      try {
        closeManager=make(closeDir);closeManager.write("close.md",{title:"Close"},"# Close\nconcurrentcloseparameter is supported.")
        ow.test.assert(closeManager.reindex().ok,true,"concurrent resource close fixture built")
        var closeEngine=closeManager._retrievalV2;servingPin=closeEngine.acquire()
        var pinnedCloseError="";try{closeEngine._closeSnapshot(servingPin)}catch(e){pinnedCloseError=String(e.message||e)}
        ow.test.assert(pinnedCloseError,"generation-reader-in-use","direct cleanup cannot close an acquired reader")
        ow.test.assert(servingPin._closePending===true,false,"rejected acquired-reader cleanup cannot mark it retired")
        var staged=closeEngine._openSnapshot(servingPin.dir,servingPin.manifest,servingPin.catalog), actualReader=staged.reader, actualDirectory=staged.directory
        staged.reader={getRefCount:function(){return actualReader.getRefCount()},close:function(){readerAttempts++;if(blockNative){readyNative.countDown();finishNative.await(2,java.util.concurrent.TimeUnit.SECONDS)}if(!allowNative)throw new java.io.IOException("controlled concurrent close failure");actualReader.close()}}
        staged.directory={close:function(){directoryAttempts++;actualDirectory.close()}}
        try{closeEngine._closeSnapshot(staged)}catch(expectedInitial){}
        ow.test.assert(Number(closeEngine._pendingClosures.size()),1,"failed staged close queues one retry handle")
        blockNative=true;allowNative=finishMode==="success"
        closeThread=new java.lang.Thread(new JavaAdapter(java.lang.Runnable,{run:function(){try{closeEngine._closeSnapshot(staged)}catch(e){closeErrors.add(String(e.message||e))}}}))
        closeThread.start();ow.test.assert(readyNative.await(1,java.util.concurrent.TimeUnit.SECONDS),true,"native retry is active in another JVM thread")
        var beforeBusy=closeEngine.metrics.resourceCloseFailures, closeStart=Number(java.lang.System.nanoTime())
        closeEngine._drainPendingClosures()
        ow.test.assert((Number(java.lang.System.nanoTime())-closeStart)/1000000<400,true,"concurrent cleanup does not wait on an active native close")
        ow.test.assert(closeEngine.metrics.resourceCloseFailures,beforeBusy,"busy cleanup does not invent an executed native close failure")
        ow.test.assert(Number(closeEngine._resourceSlots.availablePermits()),1,"active native close retains its resource slot")
        ow.test.assert(Number(actualReader.getRefCount()),1,"concurrent drain cannot close the active retry's reader")
        finishNative.countDown();closeThread.join(1000);ow.test.assert(closeThread.isAlive(),false,"native close retry thread terminates")
        ow.test.assert(Number(closeErrors.size()),finishMode==="failure"?1:0,"concurrent retry reports only its actual native outcome")
        ow.test.assert(Number(closeEngine._pendingClosures.size()),finishMode==="failure"?1:0,"failed active retry restores the handle consumed by the busy drainer")
        blockNative=false;allowNative=true;closeEngine._drainPendingClosures()
        ow.test.assert(Number(closeEngine._pendingClosures.size()),0,"final successful retry leaves no pending close handle")
        ow.test.assert(Number(actualReader.getRefCount()),0,"final concurrent retry reader is actually closed")
        ow.test.assert(directoryAttempts,1,"concurrent cleanup closes its directory exactly once")
        ow.test.assert(readerAttempts,finishMode==="failure"?3:2,"busy drainer never calls native reader close")
        closeEngine._closeSnapshot(staged)
        ow.test.assert(Number(closeEngine._resourceSlots.availablePermits()),2,"repeated completed close cannot return the slot twice")
        ow.test.assert(directoryAttempts,1,"repeated completed close skips native directory closure")
        ow.test.assert(Number(servingPin.reader.getRefCount()),1,"concurrent staged cleanup preserves the serving pin")
        closeEngine.release(servingPin);servingPin=null;closeEngine.close()
        ow.test.assert(Number(closeEngine._resourceSlots.availablePermits()),3,"concurrent cleanup shutdown returns every slot exactly once")
      } finally {allowNative=true;blockNative=false;finishNative.countDown();if(closeThread)closeThread.join(1000);if(servingPin)closeManager._retrievalV2.release(servingPin);if(closeManager)closeManager.close();io.rm(closeDir)}
    })
  }
  exports.testImmutableIncrementalGenerations = function() {
    var dir = temporary(), wm, old
    try {
      wm=make(dir,{wikiretrievalconfig:{passageChars:256,linkImmutableFiles:true}})
      wm.write("changed.md",{title:"Changed"},"# Changed\noldgenerationparameter is supported.")
      wm.write("stable.md",{title:"Stable"},"# Stable\nstableparameter remains valid. See [guidance](changed.md).")
      ow.test.assert(wm.reindex().ok,true,"immutable reuse fixture published")
      old=wm._retrievalV2.acquire()
      var original=clone(old.manifest), oldText=wm._retrievalV2._query(old,"oldgenerationparameter",5,0).hits[0].text
      var untouched=old.catalog.pages["stable.md"].locator
      wm.write("changed.md",{title:"Changed"},"# Changed\nnewgenerationparameter replaces the old support.")
      ow.test.assert(wm._lastServingUpdate.ok,true,"incremental generation published while old reader pinned")
      var publicationTimings=wm._lastServingUpdate.updateWork.publicationTimingsMillis
      ;["preparation","catalogueFork","fileStaging","writerInitialization","pageUpdates","writerCommitClose","blockStaging","catalogueWrite","manifestWrite","artifactValidation","searcherVerification","activation","readerRetentionExport"].forEach(function(stage){ow.test.assert(isNumber(publicationTimings[stage]) && isFinite(publicationTimings[stage]) && publicationTimings[stage]>=0,true,"publication timing measures actual stage: "+stage)})
      ow.test.assert(wm._lastServingUpdate.updateWork.retiredBlocksNotStaged,1,"changed page's unreferenced prior block is never staged")
      ow.test.assert(wm._lastServingUpdate.updateWork.retiredBlockUnlinksAvoided,1,"never-staged retired block requires no unlink syscall")
      ow.test.assert(wm._lastServingUpdate.updateWork.retiredBlockBytesNotStaged,original.files.filter(function(file){return file.path===old.catalog.pages["changed.md"].locator})[0].bytes,"avoided retired block bytes use the pinned manifest")
      ow.test.assert(wm._lastServingUpdate.updateWork.linkedFiles>0,true,"immutable generation files reused with actual hard links")
      ow.test.assert(wm._lastServingUpdate.updateWork.catalogueKeysCopied,0,"incremental publication copies no prior catalogue keys")
      ow.test.assert(wm._lastServingUpdate.updateWork.catalogueKeyLookups<20,true,"incremental publication resolves only its affected routed keys")
      ow.test.assert(wm._lastServingUpdate.updateWork.bindingBlockReads,1,"incremental semantic validation materializes only the changed page")
      ow.test.assert(wm._lastServingUpdate.updateWork.bindingReusedPages,0,"unchanged parent bindings require no activation-time page validation")
      var current=wm._retrievalV2.acquire()
      ow.test.assert(stringify(current.catalog.pages["stable.md"],__,""),stringify(old.catalog.pages["stable.md"],__,""),"routed inheritance preserves unchanged immutable page value")
      var stableId=old.catalog.pages["stable.md"].passageIds[0]
      ow.test.assert(stringify(current.catalog.passages[stableId],__,""),stringify(old.catalog.passages[stableId],__,""),"routed inheritance preserves unchanged immutable passage value")
      ow.test.assert(io.fileExists(current.dir+"/"+old.catalog.pages["changed.md"].locator),false,"retired block is absent from newly activated generation")
      var inheritedRecord=wm._retrievalV2.lookupBlockReference(current,untouched)
      ow.test.assert(inheritedRecord.ownerGeneration,old.generation,"unchanged generation-local block retains its immutable owner")
      ow.test.assert(wm._retrievalV2._blockFile(current.dir,current.manifest,untouched,inheritedRecord),old.dir+"/"+untouched,"unchanged block resolves through its owner without a new link or copy")
      wm._retrievalV2.release(current)
      original.files.forEach(function(file){ow.test.assert(global.MiniAWikiRetrievalV2.digest(old.dir+"/"+file.path),file.checksum,"old pinned generation file remains byte-identical: "+file.path)})
      ow.test.assert(wm._retrievalV2._query(old,"oldgenerationparameter",5,0).hits[0].text,oldText,"pinned old reader keeps its own committed text")
      ow.test.assert(wm.retrieve("oldgenerationparameter").evidence.length,0,"new current view excludes old evidence")
      ow.test.assert(wm.retrieve("newgenerationparameter").evidence.length,1,"new current view serves replacement")
      var fallback={linkedFiles:0,linkedBytes:0,copiedFiles:0,copiedBytes:0}, link=wm._retrievalV2._linkFile
      wm._retrievalV2._linkFile=function(){throw new java.lang.UnsupportedOperationException("fixture unsupported hard links")}
      var record=original.files.filter(function(f){return f.path===untouched})[0]
      wm._retrievalV2._reuseFile(old.dir+"/"+untouched,dir+"/fallback",record,fallback)
      wm._retrievalV2._linkFile=link
      ow.test.assert(fallback.copiedFiles,1,"unsupported links use copy fallback")
      ow.test.assert(global.MiniAWikiRetrievalV2.digest(dir+"/fallback"),record.checksum,"fallback copy preserves exact bytes")
      // Identical raw content must not truncate a hard-linked old block.
      var writeServing=wm._retrievalV2._writeServingFile, sameRevision, parsedBeforeReuse=wm._retrievalV2.metrics.parsedPages
      try {
        wm._retrievalV2._writeServingFile=function(path,text){if(path.slice(-(untouched.length+1))==="/"+untouched)throw new Error("same-revision block must be reused");return writeServing.call(this,path,text)}
        sameRevision=wm._retrievalV2.build(["stable.md"])
      } finally {wm._retrievalV2._writeServingFile=writeServing}
      ow.test.assert(sameRevision.ok,true,"same-revision explicit update published without rewriting its block")
      ow.test.assert(sameRevision.updateWork.sameRevisionBlocksReused,1,"same-revision reuse counts unique selected blocks")
      ow.test.assert(sameRevision.updateWork.unchangedPagesReused,1,"unchanged update reuses the complete page record")
      ow.test.assert(wm._retrievalV2.metrics.parsedPages,parsedBeforeReuse,"unchanged requested page performs no segmentation or document reconstruction")
      ow.test.assert(sameRevision.updateWork.reverseTargetsVisited,0,"unchanged page does not remove and rebuild incoming-link postings")
      var sameCurrent=wm._retrievalV2.acquire()
      try{var sameRecord=wm._retrievalV2.lookupBlockReference(sameCurrent,untouched);ow.test.assert(sameRecord.ownerGeneration,old.generation,"same-revision update inherits the original immutable block owner")}finally{wm._retrievalV2.release(sameCurrent)}
      ow.test.assert(global.MiniAWikiRetrievalV2.digest(old.dir+"/"+untouched),record.checksum,"same-content write preserves old immutable block")
      ow.test.assert(wm.backlinks("changed.md").count,1,"unchanged-page reuse retains its real incoming-link posting")
      var stableFile=new java.io.File(dir+"/stable.md"), stableStamp=wm._retrievalV2._stamp("stable.md")
      java.nio.file.Files.setLastModifiedTime(stableFile.toPath(),java.nio.file.attribute.FileTime.fromMillis(stableFile.lastModified()+1000))
      var refreshedReuse=wm._retrievalV2.build(["stable.md"]), refreshedCurrent=wm._retrievalV2.acquire()
      try {
        ow.test.assert(refreshedReuse.ok,true,"unchanged raw content with a new source stamp publishes successfully")
        ow.test.assert(refreshedReuse.updateWork.unchangedPagesReused,1,"stamp-only update still avoids page reconstruction")
        ow.test.assert(stringify(refreshedCurrent.catalog.pages["stable.md"].stamp,__,""),stringify(wm._retrievalV2._stamp("stable.md"),__,""),"reused page binds the new authoritative source stamp")
        ow.test.assert(refreshedCurrent.catalog.pages["stable.md"].stamp.modified!==stableStamp.modified,true,"stamp-refresh fixture changes actual filesystem attributes")
      } finally {wm._retrievalV2.release(refreshedCurrent)}
      ow.test.assert(wm.retrieve("stableparameter").evidence.length,1,"stamp-only reuse remains eligible as current evidence")
      var engine=wm._retrievalV2
      var sharedRaw="# Shared\nsharedblockparameter remains supported."
      io.writeFileString(dir+"/shared-a.md",sharedRaw);io.writeFileString(dir+"/shared-b.md",sharedRaw)
      ow.test.assert(engine.build(["shared-a.md","shared-b.md"]).ok,true,"identical raw manual pages share one revision block")
      var sharedLocator="blocks/"+sha1(sharedRaw)+".md"
      ow.test.assert(wm.delete("shared-a.md").ok,true,"first shared page deleted")
      ow.test.assert(wm._lastServingUpdate.updateWork.retiredBlocksNotStaged,0,"block with another active page reference is still staged")
      var sharedCurrent=engine.acquire()
      try{var sharedRecord=engine.lookupBlockReference(sharedCurrent,sharedLocator);ow.test.assert(io.fileExists(engine._blockFile(sharedCurrent.dir,sharedCurrent.manifest,sharedLocator,sharedRecord)),true,"shared block survives through its inherited owner")}finally{engine.release(sharedCurrent)}
      ow.test.assert(wm.retrieve("sharedblockparameter").evidence[0].content.indexOf("sharedblockparameter")>=0,true,"remaining shared page still returns exact evidence")
      ow.test.assert(wm.delete("shared-b.md").ok,true,"last shared page deleted")
      ow.test.assert(wm._lastServingUpdate.updateWork.retiredBlocksNotStaged,1,"last reference removal avoids staging its block")
      sharedCurrent=engine.acquire()
      try{ow.test.assert(io.fileExists(sharedCurrent.dir+"/"+sharedLocator),false,"retired shared block is absent from the new generation")}finally{engine.release(sharedCurrent)}
      ow.test.assert(wm.retrieve("sharedblockparameter").evidence.length,0,"new requests cannot retrieve retired shared evidence")
    } finally {if(old)wm._retrievalV2.release(old);if(wm)wm.close();io.rm(dir)}
  }
  exports.testGenerationEvidenceBindings = function() {
    var dir=temporary(), wm, pin
    try {
      wm=make(dir)
      var raw="---\r\ntitle: Bound\r\ndescription: Revision consistency\r\nversion: 1.0\r\nupdated: 2030-01-01\r\n---\r\n# Bound\r\nquotedparameter é 😀 is evidence.\r\n"
      io.writeFileString(dir+"/bound.md",raw);ow.test.assert(wm.reindex().ok,true,"real Unicode/CRLF binding fixture published")
      var engine=wm._retrievalV2;pin=engine.acquire()
      var id=pin.catalog.pages["bound.md"].passageIds[0]
      var pageShard=pin.manifest.catalogue.shards.pages[engine._catalogueShard("bound.md")]
      ow.test.assert(global.MiniAWikiRetrievalV2.digest(pin.dir+"/"+pageShard.path),pageShard.checksum,"page descriptor binds exact UTF-8 shard bytes including Unicode metadata")
      ow.test.assert(typeof pin.catalog.pages["bound.md"].metadata.updated,"string","prepared catalogue normalizes YAML Date to immutable published JSON value")
      ow.test.assert(pin.catalog.pages["bound.md"].metadata.updated,"2030-01-01T00:00:00.000Z","canonical metadata preserves the published ISO date representation")
      var restartedDateManager=make(dir,{access:"ro"}), restartedDatePin
      try {restartedDatePin=restartedDateManager._retrievalV2.acquire();ow.test.assert(stringify(restartedDatePin.catalog.pages["bound.md"].metadata),stringify(pin.catalog.pages["bound.md"].metadata),"warm and restarted catalogues agree on YAML metadata types")}finally{if(restartedDatePin)restartedDateManager._retrievalV2.release(restartedDatePin);restartedDateManager.close()}
      ow.test.assert(Object.isFrozen(pin.catalog.pages["bound.md"].metadata),true,"serving metadata is immutable below the page record")
      ow.test.assert(Object.isFrozen(pin.catalog.pages["bound.md"].outline[0]),true,"serving outlines are immutable below arrays")
      var originalTitle=pin.catalog.pages["bound.md"].title
      try {pin.catalog.pages["bound.md"].title="forged"}catch(ignoreFrozen){}
      ow.test.assert(pin.catalog.pages["bound.md"].title,originalTitle,"direct mutation cannot invalidate the serving page proof")
      var blockRecord=pin.manifest.files.filter(function(file){return file.path===pin.catalog.pages["bound.md"].locator})[0]
      ow.test.assert(engine._readVerifiedBlock(pin.dir+"/"+blockRecord.path,blockRecord),wm._backend.read("bound.md"),"one verified read preserves exact Unicode raw content")
      var wrongChecksum=clone(blockRecord);wrongChecksum.checksum=new Array(65).join("0")
      var checksumRejected=false
      try {engine._readVerifiedBlock(pin.dir+"/"+blockRecord.path,wrongChecksum)}catch(e){checksumRejected=String(e).indexOf("generation-integrity-failure")>=0}
      ow.test.assert(checksumRejected,true,"combined read still rejects a wrong checksum")
      var invalidFile=dir+"/invalid-utf8-block", invalidBytes=java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE,2)
      invalidBytes[0]=-61;invalidBytes[1]=40;java.nio.file.Files.write(java.nio.file.Paths.get(invalidFile),invalidBytes)
      var encodingRejected=false
      try {engine._readVerifiedBlock(invalidFile,{bytes:2,checksum:global.MiniAWikiRetrievalV2.digest(invalidFile)})}catch(e){encodingRejected=(e.javaException||e) instanceof java.nio.charset.CharacterCodingException}
      ow.test.assert(encodingRejected,true,"malformed UTF-8 cannot be silently normalized into evidence")
      io.rm(invalidFile)
      var sizedFile=dir+"/sized-evidence-block"
      ;["","é","😀",new Array(70001).join("é😀\r\n")].forEach(function(value){
        io.writeFileString(sizedFile,value)
        ow.test.assert(engine._readVerifiedBlock(sizedFile,{bytes:global.MiniAWikiRetrievalV2.bytes(value),checksum:global.MiniAWikiRetrievalV2.digest(sizedFile)}),value,"size-adaptive verified reads preserve empty, tiny and multi-buffer Unicode blocks")
      })
      io.rm(sizedFile)
      var digestBlockCalls=0, combinedBlockCalls=0, digestFunction=global.MiniAWikiRetrievalV2.digest, combinedFunction=engine._readVerifiedBlock
      global.MiniAWikiRetrievalV2.digest=function(path){if(/\/blocks\//.test(path))digestBlockCalls++;return digestFunction(path)}
      engine._readVerifiedBlock=function(path,record){combinedBlockCalls++;return combinedFunction.call(this,path,record)}
      try {engine._validate(pin.dir,pin.manifest)}finally{global.MiniAWikiRetrievalV2.digest=digestFunction;engine._readVerifiedBlock=combinedFunction}
      ow.test.assert(combinedBlockCalls,1,"fresh validation materializes the evidence block in one checksum-bound read")
      ow.test.assert(digestBlockCalls,0,"fresh validation does not open evidence blocks separately for hashing")
      var cases=[
        {name:"text hash",error:"passage-revision-binding-failure",change:function(c){c.passages[id].textHash=sha1("forged evidence")}},
        {name:"character offset",error:"passage-revision-binding-failure",change:function(c){c.passages[id].charStart++}},
        {name:"line offset",error:"passage-revision-binding-failure",change:function(c){c.passages[id].startLine++}},
        {name:"byte offset",error:"passage-revision-binding-failure",change:function(c){c.passages[id].byteEnd++}},
        {name:"outline",error:"page-metadata-binding-failure",change:function(c){c.pages["bound.md"].outline[0].title="Forged heading"}},
        {name:"applicability metadata",error:"page-metadata-binding-failure",change:function(c){c.pages["bound.md"].metadata.version="99"}},
        {name:"locator",error:"invalid-page-record",change:function(c){c.pages["bound.md"].locator="blocks/0000000000000000000000000000000000000000.md"}},
        {name:"raw length",error:"page-revision-binding-failure",change:function(c){c.pages["bound.md"].charLength++}},
        {name:"page identity",error:"invalid-passage-ownership",change:function(c){c.passages[id].pageId="another-page"}},
        {name:"unreferenced passage",error:"catalogue-count-mismatch",change:function(c){c.passages.extra=clone(c.passages[id])}}
      ]
      cases.forEach(function(test){
        var altered=clone(pin.catalog), error="", patched
        test.change(altered);patched=patchCatalogue(engine,pin,altered)
        try {engine._validate(pin.dir,patched.manifest)}catch(e){error=String(e.message||e)}
        finally {patched.restore()}
        ow.test.assert(error,test.error,"valid file checksums do not permit forged "+test.name+" binding")
      })
      var blockPath=pin.dir+"/"+pin.catalog.pages["bound.md"].locator, rawError=""
      try {
        io.writeFileString(blockPath,raw.replace("quotedparameter","xuotedparameter"))
        try {engine._validate(pin.dir,pin.manifest)}catch(e){rawError=String(e.message||e)}
      } finally {io.writeFileString(blockPath,raw)}
      ow.test.assert(rawError,"generation-integrity-failure","a changed immutable block fails before semantic binding")
      var stored=wm._luceneStoredDoc
      try {
        wm._luceneStoredDoc=function(searcher,docId){var doc=stored.call(wm,searcher,docId);doc.getField("text").setStringValue("forged stored evidence");return doc}
        var rejected=wm.agenticSearch("quotedparameter")
        ow.test.assert(rejected.outcome,"partial","indexed stored-text mismatch is unavailable rather than healthy zero")
        ow.test.assert(rejected.sources[0].reason,"generation-index-text-mismatch","indexed text hash checked before ranking and disclosure")
        ow.test.assert(rejected.results.length,0,"forged stored passage cannot appear in compact search")
      } finally {wm._luceneStoredDoc=stored}
      var before=engine.metrics.validationBlockReads, evidence=wm.retrieve("quotedparameter").evidence[0]
      ow.test.assert(evidence.content,raw.substring(evidence.charStart,evidence.charEnd),"restored generation quotes exact raw revision")
      ow.test.assert(engine.metrics.validationBlockReads,before,"warm evidence reads do not repeat generation binding validation")
      ow.test.assert(engine.metrics.validationBlockBytes>0,true,"cold block validation bytes recorded separately from serving body reads")
    } finally {if(pin)wm._retrievalV2.release(pin);if(wm)wm.close();io.rm(dir)}
  }
  exports.testCatalogueStreamRecovery = function() {
    var dir=temporary(), wm, pin
    try {
      wm=make(dir)
      wm.write("supported.md",{title:"Stream É"},"# Support\nstreamfailureparameter remains current. 😀")
      ow.test.assert(wm.reindex().ok,true,"routed shard recovery fixture built with real Lucene")
      var engine=wm._retrievalV2;pin=engine.acquire()
      var write=engine._writeServingFile, pointer=io.readFileString(engine.root+"/current.json"), injected=0, result
      try {
        engine._writeServingFile=function(path,text) {
          if (/\/catalogue\//.test(path)) { injected++; throw new java.io.IOException("injected catalogue shard write") }
          return write.call(this,path,text)
        }
        result=engine.build()
      } finally {engine._writeServingFile=write}
      ow.test.assert(injected,1,"fault reaches a schema-3 routed shard write")
      ow.test.assert(result.ok,false,"routed shard write failure is explicit")
      ow.test.assert(result.localPublished,false,"shard failure never claims local activation")
      ow.test.assert(io.readFileString(engine.root+"/current.json"),pointer,"shard failure preserves exact pointer")
      var reader=make(dir,{access:"ro"})
      try {ow.test.assert(reader.retrieve("streamfailureparameter").evidence.length,1,"fresh reader serves prior evidence after shard failure")}finally{reader.close()}
      ow.test.assert(engine.build().ok,true,"subsequent schema-3 publisher succeeds after shard failure")
    } finally {if(pin)wm._retrievalV2.release(pin);if(wm)wm.close();io.rm(dir)}
  }
  exports.testInsufficientSpacePublicationRecovery = function() {
    var dir=temporary(), wm, pin
    try {
      wm=make(dir)
      wm.write("supported.md",{title:"Support"},"# Support\nspacefailureparameter remains current.")
      ow.test.assert(wm.reindex().ok,true,"insufficient-space fixture built with real Lucene")
      var engine=wm._retrievalV2
      pin=engine.acquire()
      ;["immutable-block","catalogue-shard","manifest","pointer-temp","copy","writer-open","lucene-output"].forEach(function(stage) {
        var write=engine._writeServingFile, reuse=engine._reuseFile, fault=engine._publicationFault, newWriter=engine._newWriter, injected=0, pointer=io.readFileString(engine.root+"/current.json")
        var fail=function(path){injected++;throw new java.nio.file.FileSystemException(String(path),null,"No space left on device (injected fixture)")}
        try {
          engine._writeServingFile=function(path,text) {
            if (stage==="immutable-block" && /\/blocks\//.test(path) || stage==="catalogue-shard" && /\/catalogue\//.test(path) || stage==="manifest" && /\/manifest.json$/.test(path) || stage==="pointer-temp" && /\/current.json.tmp-/.test(path)) fail(path)
            return write.call(this,path,text)
          }
          engine._reuseFile=function(source,target,record,work){if(stage==="copy")fail(target);return reuse.call(this,source,target,record,work)}
          engine._publicationFault=function(step,path){if(stage==="writer-open"&&step==="writer-open")fail(path)}
          engine._newWriter=function(directory,analyzer) {
            if(stage!=="lucene-output")return newWriter.call(this,directory,analyzer)
            var failingDirectory=new JavaAdapter(Packages.org.apache.lucene.store.FilterDirectory,{
              createOutput:function(name,context){return fail(name)},
              createTempOutput:function(prefix,suffix,context){return fail(prefix+suffix)}
            },directory)
            return newWriter.call(this,failingDirectory,analyzer)
          }
          var result=stage==="copy"?engine.build(["supported.md"]):engine.build()
          ow.test.assert(injected,1,"insufficient-space fault reaches "+stage)
          ow.test.assert(result.ok,false,"insufficient-space publication fails explicitly at "+stage)
          ow.test.assert(result.error.indexOf("No space left on device")>=0,true,"filesystem failure remains identifiable at "+stage)
          ow.test.assert(result.activationSucceeded,false,"insufficient-space failure has not activated at "+stage)
          ow.test.assert(result.localPublished,false,"insufficient-space failure is not reported as committed at "+stage)
          ow.test.assert(io.readFileString(engine.root+"/current.json"),pointer,"prior active pointer survives "+stage)
        } finally {engine._writeServingFile=write;engine._reuseFile=reuse;engine._publicationFault=fault;engine._newWriter=newWriter}
        var reopened=make(dir,{access:"ro"})
        try {ow.test.assert(reopened.retrieve("spacefailureparameter").evidence.length,1,"fresh reader serves prior working generation after "+stage)} finally {reopened.close()}
        ow.test.assert(engine.build().ok,true,"subsequent writer acquires released resources after "+stage)
      })
      pin.manifest.files.forEach(function(file){ow.test.assert(global.MiniAWikiRetrievalV2.digest(pin.dir+"/"+file.path),file.checksum,"insufficient-space failures never mutate original pinned artifact")})
      ow.test.assert(Number(pin.reader.numDocs())>0,true,"original reader stays open through consecutive failures and recovery")
    } finally {if(pin)wm._retrievalV2.release(pin);if(wm)wm.close();io.rm(dir)}
  }
  exports.testPublicationFailureRecovery = function() {
    var dir=temporary(), wm, pin
    try {
      wm=make(dir)
      wm.write("supported.md",{title:"Support"},"# Support\nrecoveryparameter is current.")
      ow.test.assert(wm.reindex().ok,true,"failure recovery fixture built")
      pin=wm._retrievalV2.acquire()
      var pointer=io.readFileString(wm._retrievalV2.root+"/current.json"), manifest=clone(pin.manifest)
      ;["_reuseFile","_analyzer","_files","_validatePublication","_openSnapshot","_syncGeneration","_atomic"].forEach(function(stage){
        var original=wm._retrievalV2[stage]
        wm._retrievalV2[stage]=function(){throw new Error("injected failure at "+stage)}
        var failed=wm._retrievalV2.build(["supported.md"])
        wm._retrievalV2[stage]=original
        ow.test.assert(failed.ok,false,"failure reported at "+stage)
        ow.test.assert(io.readFileString(wm._retrievalV2.root+"/current.json"),pointer,"active pointer preserved at "+stage)
        var restarted=make(dir,{access:"ro"})
        try {ow.test.assert(restarted.retrieve("recoveryparameter").evidence.length,1,"fresh manager serves old valid generation after "+stage)} finally {restarted.close()}
      })
      manifest.files.forEach(function(file){ow.test.assert(global.MiniAWikiRetrievalV2.digest(pin.dir+"/"+file.path),file.checksum,"failed staging never mutates published files")})
      var engine=wm._retrievalV2, oldFault=engine._publicationFault
      ;["artifact-file", "generation-directory", "pointer-file", "activation-directory"].forEach(function(stage) {
        var originalSync=engine._syncPath, priorPointer=io.readFileString(engine.root+"/current.json"), rootSyncs=0, injected=0
        try {
          engine._syncPath=function(path,directory) {
            if (directory && path===engine.root) rootSyncs++
            if ((stage==="artifact-file" && !directory && /\/index\//.test(path)) ||
                (stage==="generation-directory" && directory && /\/index$/.test(path)) ||
                (stage==="pointer-file" && !directory && path.indexOf("current.json.tmp-")>=0) ||
                (stage==="activation-directory" && directory && path===engine.root && rootSyncs===3)) {
              injected++;throw new Error("injected synchronization failure: "+stage)
            }
            return originalSync.call(engine,path,directory)
          }
          var failure=engine.build(["supported.md"]), pointerNow=io.readFileString(engine.root+"/current.json")
          ow.test.assert(injected,1,"synchronization failure actually reached: "+stage)
          ow.test.assert(failure.ok,false,"synchronization failure remains explicit: "+stage)
          ow.test.assert(failure.activationSucceeded,stage==="activation-directory","activation status reflects actual rename: "+stage)
          ow.test.assert(failure.localPublished,stage==="activation-directory","local publication status reflects actual rename: "+stage)
          ow.test.assert(pointerNow===priorPointer,stage!=="activation-directory","pre-activation synchronization preserves usable pointer: "+stage)
          var recovered=make(dir,{access:"ro"})
          try {ow.test.assert(recovered.retrieve("recoveryparameter").evidence.length,1,"fresh reader serves consistent generation after synchronization failure: "+stage)}finally{recovered.close()}
        } finally {engine._syncPath=originalSync}
        ow.test.assert(engine.build(["supported.md"]).ok,true,"writer recovers after synchronization failure: "+stage)
      })
      try {
        ;["pointer-renamed","activation-directory-synchronized","pointer-activated"].forEach(function(checkpoint) {
          engine._publicationFault=function(stage){if(stage===checkpoint)throw new Error("injected post-activation failure: "+checkpoint)}
          var committed=engine.build(["supported.md"]), active=io.readFileJSON(engine.root+"/current.json")
          ow.test.assert(committed.ok,false,"post-activation failure remains explicit: "+checkpoint)
          ow.test.assert(committed.activationSucceeded,true,"failure reports completed pointer activation: "+checkpoint)
          ow.test.assert(committed.localPublished,true,"failure does not misreport committed generation as unpublished: "+checkpoint)
          ow.test.assert(committed.generation,active.generation,"failure identifies actual active generation: "+checkpoint)
          ow.test.assert(active.generation!==pin.manifest.generation,true,"post-activation failure preserves new valid generation: "+checkpoint)
          var reopened=make(dir,{access:"ro"})
          try {ow.test.assert(reopened.retrieve("recoveryparameter").evidence.length,1,"fresh reader serves generation despite post-activation failure: "+checkpoint)} finally {reopened.close()}
        })
      } finally {engine._publicationFault=oldFault}
      var oldRetention=engine._retainValidatedSnapshot, oldLogger=wm._logFn
      try {
        engine._retainValidatedSnapshot=function(){throw new Error("injected retention contention")}
        wm._logFn=function(){throw new Error("injected warning logger failure")}
        ow.test.assert(engine.build(["supported.md"]).ok,true,"retention contention and warning failure do not undo successful publication")
        var afterRetention=make(dir,{access:"ro"})
        try {ow.test.assert(afterRetention.retrieve("recoveryparameter").evidence.length,1,"published generation remains usable after deferred reader retention")} finally {afterRetention.close()}
      } finally {engine._retainValidatedSnapshot=oldRetention;wm._logFn=oldLogger}
      ow.test.assert(Number(pin.reader.numDocs())>0,true,"original generation remains pinned through post-activation failures")
      var block=pin.dir+"/"+pin.catalog.pages["supported.md"].locator, raw=io.readFileString(block)
      io.writeFileString(block,"truncated immutable block")
      // Check corruption against that generation explicitly, without confusing it
      // with the newer generations published by the post-activation fixtures.
      var savedPointer=io.readFileString(engine.root+"/current.json")
      io.writeFileString(engine.root+"/current.json",pointer)
      var corrupt=make(dir,{access:"ro"}), rejected
      try {
        rejected=corrupt.retrieve("recoveryparameter")
        ow.test.assert(rejected.evidence.length,1,"checksum failure selects the validated predecessor rather than corrupted evidence")
        var recoveredPin=corrupt._retrievalV2.acquire()
        try {ow.test.assert(recoveredPin.recoveredPointer,true,"corrupt generation never becomes a healthy serving snapshot")} finally {corrupt._retrievalV2.release(recoveredPin)}
      } finally {corrupt.close();io.writeFileString(block,raw);io.writeFileString(engine.root+"/current.json",savedPointer)}
    } finally {if(pin)wm._retrievalV2.release(pin);if(wm)wm.close();io.rm(dir)}
  }
  exports.testPreviousGenerationPointerFallback = function() {
    var dir=temporary(), writer, reader, currentPath
    try {
      writer=make(dir)
      writer.write("guide.md",{title:"Guide"},"# Guide\npointerfallbackparameter is supported.")
      ow.test.assert(writer.reindex().ok,true,"initial generation builds for pointer fallback")
      writer.write("guide.md",{title:"Guide"},"# Guide\npointerfallbackparameter is still supported after an update.")
      ow.test.assert(writer.reindex().ok,true,"updated generation preserves a previous pointer")
      currentPath=writer._retrievalV2.root+"/current.json"
      ow.test.assert(io.fileExists(writer._retrievalV2.root+"/previous.json"),true,"activation retains one durable prior pointer")
      var corrupt=io.readFileString(currentPath)
      io.writeFileString(currentPath,"{not valid json")
      reader=make(dir,{access:"ro"})
      var result=reader.retrieve("pointerfallbackparameter",{chunks:1})
      ow.test.assert(result.evidence.length,1,"corrupt active pointer falls back to the validated previous generation")
      var fallbackPin=reader._retrievalV2.acquire()
      try {ow.test.assert(fallbackPin.recoveredPointer,true,"fallback serves a validated prior generation rather than malformed activation state")} finally {reader._retrievalV2.release(fallbackPin)}
      ow.test.assert(io.readFileString(currentPath),"{not valid json","reader fallback never rewrites the corrupt activation pointer")
      reader.close();reader=__
      io.writeFileString(currentPath,corrupt)
    } finally {if(reader)reader.close();if(writer)writer.close();io.rm(dir)}
  }
  exports.testDirectDerivedPostings = function() {
    var dir=temporary(), wm
    try {
      wm=make(dir)
      wm.write("a.md",{title:"A"},"# Links\n[one](stable.md) [two](stable.md) [other](other.md)")
      wm.write("b.md",{title:"B"},"# Links\n[other](other.md)")
      wm.write("stable.md",{title:"Stable"},"# Stable\nreference")
      io.writeFileString(dir+"/x.md","# Shared\nsharedblockparameter is supported.")
      io.writeFileString(dir+"/y.md","# Shared\nsharedblockparameter is supported.")
      ow.test.assert(wm.reindex().ok,true,"direct postings fixture built")
      var cataloguePin=wm._retrievalV2.acquire()
      try {
        var immutableCatalogue=stringify(cataloguePin.catalog,__,"")
        ow.test.assert(isUnDef(wm._retrievalV2._forkCatalogue),true,"schema-3 publication has no retained-catalogue fork helper")
        var sharedId=cataloguePin.catalog.pages["b.md"].passageIds[0]
        ow.test.assert(isDef(wm._retrievalV2.lookupPassage(cataloguePin,sharedId)),true,"schema-3 fixture resolves an unchanged passage through its routed descriptor")
        wm.write("c.md",{title:"New links"},"# Links\n[stable](stable.md) [other](other.md)")
        ow.test.assert(wm._lastServingUpdate.ok,true,"new inbound postings publish with the shared-record catalogue")
        ow.test.assert(stringify(cataloguePin.catalog,__,""),immutableCatalogue,"appending inbound and move postings never mutates a pinned old catalogue")
        ow.test.assert(wm.backlinks("stable.md").count,2,"new generation contains added inbound links")
        wm.delete("c.md")
        ow.test.assert(stringify(cataloguePin.catalog,__,""),immutableCatalogue,"removing new postings never mutates the pinned old catalogue")
        ow.test.assert(wm._lastServingUpdate.updateWork.catalogueShardWrites>0,true,"publication records immutable routed shard writes")
        ow.test.assert(wm._lastServingUpdate.updateWork.catalogueDeltaBytes>0,true,"publication reports changed descriptor bytes")
      } finally {wm._retrievalV2.release(cataloguePin)}
      ow.test.assert(wm.backlinks("stable.md").count,1,"backlinks count distinct inbound pages")
      wm.write("a.md",{title:"A changed"},"# Links\n[other](other.md)")
      ow.test.assert(wm.backlinks("stable.md").count,0,"old inbound posting removed directly")
      ow.test.assert(wm.backlinks("other.md").count,2,"unrelated inbound posting preserved")
      ow.test.assert(wm._lastServingUpdate.updateWork.copiedFiles>0,true,"portable copy remains default after measured link regression")
      ow.test.assert(wm._lastServingUpdate.updateWork.copiedFiles>0,true,"portable copy remains default after measured link regression")
      ow.test.assert(wm._lastServingUpdate.updateWork.reverseTargetsVisited,3,"only old and new outgoing targets processed")
      ow.test.assert(wm._lastServingUpdate.updateWork.legacyCataloguePagesVisited,0,"current schema avoids unrelated page enumeration for postings")
      var snapshot=wm._retrievalV2.acquire(), locator=snapshot.catalog.pages["x.md"].locator
      ow.test.assert(snapshot.catalog.blockRefs[locator].references,2,"identical page revisions share truthful block reference counts")
      wm._retrievalV2.release(snapshot)
      wm.delete("x.md")
      snapshot=wm._retrievalV2.acquire()
      ow.test.assert(snapshot.catalog.blockRefs[locator].references,1,"deleting one page preserves other page's shared evidence block")
      var retainedRecord=wm._retrievalV2.lookupBlockReference(snapshot,locator)
      ow.test.assert(io.fileExists(wm._retrievalV2._blockFile(snapshot.dir,snapshot.manifest,locator,retainedRecord)),true,"shared immutable block retained through its owner generation")
      wm._retrievalV2.release(snapshot)
      ow.test.assert(wm.retrieve("sharedblockparameter").evidence[0].path,"y.md","remaining page evidence resolves correctly")
      wm.delete("y.md")
      snapshot=wm._retrievalV2.acquire()
      ow.test.assert(io.fileExists(snapshot.dir+"/"+locator),false,"last deletion removes retired block from new current generation")
      wm._retrievalV2.release(snapshot)
      io.mkdir(dir+"/fresh");io.mkdir(dir+"/fresh/deep")
      io.writeFileString(dir+"/fresh/deep/manual.md","# Manual\nserialenumerationparameter")
      io.mkdir(wm._retrievalV2.root+"/unused-retained")
      for(var fileIndex=0;fileIndex<250;fileIndex++)io.writeFileString(wm._retrievalV2.root+"/unused-retained/"+fileIndex+".md","derived block")
      var listed=wm.list("")
      ow.test.assert(listed.indexOf("fresh/deep/manual.md")>=0,true,"serial v2 source enumeration discovers nested manual pages")
      ow.test.assert(wm._backend._lastListWork.directoryListings,3,"serial enumeration never descends into retained derived generations")
      ow.test.assert(wm._backend._lastListWork.derivedEntriesSkipped>0,true,"derived directory pruning is actual measured work")
      ow.test.assert(listed.some(function(path){return path.indexOf("unused-retained")>=0}),false,"retained blocks never become extra wiki pages")
      ow.test.assert(wm.list("fresh/").join(","),"fresh/deep/manual.md","serial prefix enumeration preserves mount-local relative paths")
      ow.test.assert(wm._backend._lastListWork.directoryListings,2,"prefix enumeration stays within selected subtree")
      var pointerBefore=io.readFileString(wm._retrievalV2.root+"/current.json"), enumerate=wm._backend.enumerate
      wm._backend.enumerate=function(){return {ok:false,pages:[],error:"source-enumeration-failed"}}
      try {
        var failedRebuild=wm.reindex()
        ow.test.assert(failedRebuild.ok,false,"failed source enumeration cannot publish an empty rebuild")
        ow.test.assert(stringify(failedRebuild).indexOf("source-enumeration-failed")>=0,true,"source enumeration failure is explicit")
        ow.test.assert(io.readFileString(wm._retrievalV2.root+"/current.json"),pointerBefore,"failed enumeration retains usable generation pointer")
      } finally {wm._backend.enumerate=enumerate}
      ow.test.assert(wm._backend.enumerate("missing-directory/").ok,false,"missing source directory is distinct from an empty directory")
      ow.test.assert(wm.reindex().ok,true,"successful source enumeration recovers after a failed rebuild")
      ow.test.assert(wm.retrieve("serialenumerationparameter").evidence[0].path,"fresh/deep/manual.md","recovered rebuild includes manually maintained nested evidence")
      var oldPointer=io.readFileString(wm._retrievalV2.root+"/current.json"), pageRead=wm._backend.read
      ow.test.assert(wm._backend.sourceStatus("fresh/deep/manual.md").status,"present","actual JVM file attributes distinguish an existing source")
      wm._backend.read=function(path){if(path==="fresh/deep/manual.md")return __;return pageRead.call(this,path)}
      try {
        ow.test.assert(wm.reindex().ok,false,"full rebuild cannot silently omit an unreadable existing page")
        ow.test.assert(io.readFileString(wm._retrievalV2.root+"/current.json"),oldPointer,"failed full page read preserves the serving pointer")
        var failedUpdate=wm._retrievalV2.build(["fresh/deep/manual.md"])
        ow.test.assert(failedUpdate.error.indexOf("source-read-failed")>=0,true,"incremental read failure is distinct from deletion")
        ow.test.assert(io.readFileString(wm._retrievalV2.root+"/current.json"),oldPointer,"failed incremental read preserves the serving pointer")
      } finally {wm._backend.read=pageRead}
      var recoveryReader=make(dir,{access:"ro"})
      try {ow.test.assert(recoveryReader.retrieve("serialenumerationparameter").evidence[0].path,"fresh/deep/manual.md","fresh reader still serves previous valid evidence after failed page reads")} finally {recoveryReader.close()}
      var links=[],outside=temporary()
      try {
        io.writeFileString(outside+"/secret.md","# Outside\nnot-authorized")
        var linkTargets={cycle:dir+"/fresh",outside:outside,derived:wm._retrievalV2.root+"/unused-retained",alias:dir+"/fresh/deep/manual.md"}
        Object.keys(linkTargets).forEach(function(name){var link=java.nio.file.Paths.get(dir+"/fresh/deep/"+name);java.nio.file.Files.createSymbolicLink(link,java.nio.file.Paths.get(linkTargets[name]));links.push(link)})
        var aliasPages=wm.list("")
        ow.test.assert(aliasPages.filter(function(path){return path==="fresh/deep/manual.md"}).length,1,"canonical source aliases are deduplicated")
        ow.test.assert(aliasPages.some(function(path){return /secret|unused-retained/.test(path)}),false,"symlinks cannot enumerate outside scope or hidden derived content")
        ow.test.assert(wm._backend._lastListWork.directoryListings,3,"cycles and aliases do not amplify directory enumeration")
      } finally {links.forEach(function(link){java.nio.file.Files.deleteIfExists(link)});io.rm(outside)}
      io.rm(dir+"/fresh/deep/manual.md")
      ow.test.assert(wm._backend.sourceStatus("fresh/deep/manual.md").status,"missing","missing source is an actual typed JVM outcome")
      ow.test.assert(wm._retrievalV2.build(["fresh/deep/manual.md"]).ok,true,"confirmed incremental deletion still publishes")
      ow.test.assert(wm.retrieve("serialenumerationparameter").evidence.length,0,"confirmed deletion removes evidence from new requests")
    } finally {if(wm)wm.close();io.rm(dir)}
  }
  exports.testApprovedStructuralRepair = function() {
    var dir=temporary(), wm
    try {
      wm=make(dir)
      var raw="---\r\ntitle: Résumé\r\nupdated: 2000-01-01\r\nverified: 1999-01-01\r\n---\r\nstructuralrepairparameter remains supported.\r\n"
      io.writeFileString(dir+"/manual.md",raw)
      ow.test.assert(wm.reindex().ok,true,"manual structural repair fixture published")
      var options={kind:"missing-heading",path:"manual.md",revision:sha1(raw)}
      var proposal=wm.knowledgeRepairStructure(options)
      ow.test.assert(proposal.ok,true,"missing-heading repair is reviewable without a model")
      ow.test.assert(proposal.writes,0,"default proposal writes no wiki content")
      ow.test.assert(wm._backend.read("manual.md"),raw,"dry-run preserves raw CRLF front matter and body")
      ow.test.assert(wm.knowledgeRepairStructure({kind:options.kind,path:options.path,revision:options.revision,dryRun:false}).error,"approval-required","applying repair requires explicit proposal approval")
      var applied=wm.knowledgeRepairStructure({kind:options.kind,path:options.path,revision:options.revision,dryRun:false,approved:true})
      ow.test.assert(applied.ok,true,"approved repair publishes affected page through existing index updates")
      var updated=wm._backend.read("manual.md")
      ow.test.assert(sha1(updated),proposal.proposal.proposedRevision,"applied bytes exactly match the reviewed proposal")
      ow.test.assert(updated.indexOf(raw.substring(0,raw.indexOf("structuralrepairparameter"))),0,"repair preserves editorial and verification dates verbatim")
      ow.test.assert(wm._retrievalV2.open("manual.md",{}).headings[0].title,"Résumé","new heading uses shared parser and published outline")
      ow.test.assert(wm.retrieve("structuralrepairparameter").evidence[0].revision,sha1(updated),"retrieval cites the repaired revision")
      ow.test.assert(wm.knowledgeRepairStructure({kind:options.kind,path:options.path,revision:options.revision,dryRun:false,approved:true}).error,"stale-repair-proposal","old approval cannot overwrite a newer revision")
      ow.test.assert(wm.knowledgeRepairStructure({kind:"missing-heading",path:"AGENTS.md",revision:sha1(raw)}).error,"protected-repair-path","structural repair preserves protected policy pages")
      ow.test.assert(wm.knowledgeRepairStructure({kind:"missing-heading",path:"AGENTS.md",revision:sha1(raw)}).writes,0,"rejected repair never inherits another request's write count")
      io.writeFileString(dir+"/readonly.md",raw);ow.test.assert(wm.reindex().ok,true,"second structural fixture published")
      var ro=make(dir,{access:"ro"})
      try {
        var deniedRepair=ro.knowledgeRepairStructure({kind:"missing-heading",path:"readonly.md",revision:sha1(raw),dryRun:false,approved:true})
        ow.test.assert(deniedRepair.error,"wiki-read-only","approval cannot bypass read-only mount policy")
        ow.test.assert(deniedRepair.writes,0,"read-only rejection reports no page write")
      }finally{ro.close()}
      var previousManager=global.__wikiManager, descriptor=af.fromYAML(io.readFileString("mcps/mcp-wiki-ops.yaml"))
      var maintain=new Function("args",descriptor.jobs.filter(function(job){return job.name==="Wiki maintain"})[0].exec)
      try {
        global.__wikiManager=wm
        var opsProposal=maintain({op:"repair_heading",path:"readonly.md",revision:sha1(raw),dryRun:true,approved:false})
        ow.test.assert(opsProposal.mode,"propose","actual operations MCP maintain job delegates the shared revision-bound repair")
        global.__wikiManager={resolveWikiSelection:function(){return{ok:true,targets:[{name:"primary"}]}}}
        ow.test.assert(maintain({op:"repair_heading"}).error,"v2-required","flag-off operations job reports explicit unavailable capability")
      } finally {global.__wikiManager=previousManager}
    } finally {if(wm)wm.close();io.rm(dir)}
  }
  exports.testGroundedDerivatives = function() {
    var dir = temporary(), wm
    try {
      wm = make(dir)
      ow.test.assert(isFunction(wm.knowledgeGetDerivative), true, "opt-in manager installs extension across module scopes")
      wm.write("manual.md", { title: "Manual" }, "# Setting\nprovenanceparameter controls expiry.")
      wm.write("other.md", { title: "Other" }, "# Other\nunrelated setting.")
      ow.test.assert(wm.reindex().ok, true, "grounded fixture built with real Lucene")
      var ref = wm.retrieve("provenanceparameter", { chunks: 1 }).evidence[0].passage
      var dry = wm.knowledgeRecordDerivative("fact", "expiry", { text: "An expiry setting exists." }, [ref], { dryRun: true })
      ow.test.assert(dry.ok, true, "registration validates exact wiki support")
      ow.test.assert(io.fileExists(wm._knowledgeStatePath()), false, "dry registration writes no authority")
      ow.test.assert(wm.knowledgeRecordDerivative("fact", "expiry", { text: "An expiry setting exists." }, [ref]).ok, true, "fact uses existing manifest map")
      ow.test.assert(wm.knowledgeRecordDerivative("page-summary", "manual-summary", { text: "Expiry navigation." }, [ref]).ok, true, "summary uses existing manifest map")
      var state = wm.knowledgeLoadState()
      ow.test.assert(state.derivativeRegistry.byPage["manual.md"].length, 2, "direct page dependency postings")
      ow.test.assert(state.facts.expiry.passageSupports[0].textHash, sha1(wm.read("manual.md").raw.substring(ref.charStart, ref.charEnd)), "support hash is exact raw range")
      ow.test.assert(wm.knowledgeGetDerivative("fact", "expiry").origin, "derived", "derivative never becomes a quoted passage")
      ow.test.assert(wm.knowledgeGetDerivative("fact", "constructor").error, "invalid-derivative", "prototype identifier denied")
      var malformed = merge(ref, { charEnd: ref.charEnd + 1000 })
      ow.test.assert(wm.knowledgeRecordDerivative("fact", "bad", {}, [malformed]).error, "invalid-support-range", "source chunk cannot inherit wiki positions")
      ow.test.assert(wm.knowledgeRecordDerivative("fact", "bad", {}, [merge(ref, { wiki: "mount" })]).error, "nonlocal-support", "foreign namespace support rejected")
      ow.test.assert(wm.knowledgeRecordDerivative("fact", "bad", {}, [merge(ref, { wikiId: "another-physical-wiki" })]).error, "nonlocal-support", "identical relative paths do not confer namespace identity")
      ow.test.assert(wm._retrievalV2.maintenance({ paths: "manual.md" }).error, "invalid-maintenance-paths", "invalid targeted scope rejected")
      wm.write("other.md", { title: "Other" }, "# Other\nchanged unrelated setting.")
      ow.test.assert(wm.knowledgeGetDerivative("fact", "expiry").ok, true, "unrelated generation change retains support")
      var authority = io.readFileString(wm._knowledgeStatePath())
      wm.write("manual.md", { title: "Manual" }, "# Setting\nreplacementparameter controls replacement.")
      ow.test.assert(wm.knowledgeGetDerivative("fact", "expiry").error, "stale-support", "changed supporting revision invalidates disclosure")
      ow.test.assert(isDef(wm.knowledgeGetDerivative("fact", "expiry").record), false, "stale claim text is not returned")
      var report = wm._retrievalV2.maintenance({ paths: ["manual.md"], limit: 5 })
      ow.test.assert(report.derivatives.candidates.length, 2, "maintenance reports affected grounded derivatives")
      ow.test.assert(report.inspectedPages, 1, "targeted maintenance avoids unrelated pages")
      ow.test.assert(report.derivatives.inspected, 2, "targeted postings inspect only affected records")
      ow.test.assert(io.readFileString(wm._knowledgeStatePath()), authority, "queries and reports do not mutate authority")
      ow.test.assert(wm.knowledgeReconcileDerivatives({ paths: ["manual.md"] }).dryRun, true, "repair defaults to dry run")
      ow.test.assert(wm.knowledgeReconcileDerivatives({ paths: ["manual.md"], dryRun: false }).error, "approval-required", "write requires explicit approved repair")
      var raw = wm.read("manual.md").raw
      var repaired = wm.knowledgeReconcileDerivatives({ paths: ["manual.md"], dryRun: false, approved: true })
      ow.test.assert(repaired.invalidated.length, 2, "approved deterministic repair marks fact and summary")
      ow.test.assert(repaired.modelCalls, 0, "no maintenance LLM")
      ow.test.assert(wm.read("manual.md").raw, raw, "repair never rewrites manual Markdown")
      ow.test.assert(wm.knowledgeGetDerivative("fact", "expiry").error, "invalidated", "repaired derivative unavailable")
      ow.test.assert(wm.knowledgeReconcileDerivatives({ paths: ["manual.md"], dryRun: false, approved: true }).writes, 0, "repair is idempotent")
      state = wm.knowledgeLoadState(); state.summaries.pages.legacy = { text: "Unknown legacy summary." }; wm.knowledgeSaveState(state)
      ow.test.assert(wm.knowledgeGetDerivative("page-summary", "legacy").error, "unknown-provenance", "legacy provenance never invented")
      wm.knowledgeReconcileDerivatives({ dryRun: false, approved: true })
      ow.test.assert(wm.knowledgeLoadState().summaries.pages.legacy.invalidated === true, false, "unknown legacy summary retained for review")
      var current = wm.retrieve("replacementparameter").evidence[0].passage
      ow.test.assert(wm.knowledgeRecordDerivative("fact", "expiry", { text: "Replacement guidance." }, [current]).ok, true, "explicit replacement validates current support")
      wm.delete("manual.md")
      ow.test.assert(wm.knowledgeGetDerivative("fact", "expiry").error, "stale-support", "deleted supporting page cannot disclose claim")
    } finally { if (wm) wm.close(); io.rm(dir) }
  }
  exports.testDerivativeJournalAndIntegrity = function() {
    var dir = temporary(), wm, reader
    try {
      wm = make(dir)
      wm.write("source.md", { title: "Source" }, "# Source\njournalparameter needs support.")
      wm.reindex(); var ref = wm.retrieve("journalparameter").evidence[0].passage
      ow.test.assert(wm.knowledgeRecordDerivative("fact", "claim", { text: "Supported claim." }, [ref]).ok, true, "valid support registration or replacement")
      reader = make(dir, { access: "ro" })
      ow.test.assert(reader.knowledgeGetDerivative("fact", "claim").ok, true, "read-only validates published support")
      ow.test.assert(reader.knowledgeRecordDerivative("fact", "blocked", {}, [ref]).error, "wiki-read-only", "read-only cannot register authority")
      var state = wm.knowledgeLoadState(); state.facts.claim.passageSupports[0].textHash = new Array(41).join("0"); wm.knowledgeSaveState(state)
      ow.test.assert(wm.knowledgeGetDerivative("fact", "claim").error, "invalid-provenance", "disclosure checks actual support hash")
      ow.test.assert(wm.knowledgeDerivativeCandidates({ paths: ["source.md"] }).candidates[0].reason, "invalid-provenance", "targeted maintenance checks the same exact support hash")
      ow.test.assert(wm.knowledgeRecordDerivative("fact", "claim", { text: "Supported claim." }, [ref]).ok, true, "valid support registration or replacement")
      state = wm.knowledgeLoadState(); state.facts.claim.passageSupports = [null]; wm.knowledgeSaveState(state)
      ow.test.assert(wm.knowledgeGetDerivative("fact", "claim").error, "invalid-provenance", "malformed support rejected explicitly")
      ow.test.assert(wm.knowledgeRecordDerivative("fact", "claim", { text: "Supported claim." }, [ref]).ok, true, "valid support registration or replacement")
      var journal = wm._getIndexRoot() + "/.mini-a-wiki-ingest/journal.json"
      io.mkdir(journal.substring(0, journal.lastIndexOf("/"))); io.writeFileString(journal, stringify({ phase: "prepared", operations: [{ path: "source.md", kind: "write" }] }, __, ""))
      var before = io.readFileString(wm._knowledgeStatePath())
      ow.test.assert(wm.knowledgeGetDerivative("fact", "claim").error, "stale-support", "pending evidence suppressed")
      ow.test.assert(wm.knowledgeRecordDerivative("fact", "blocked", {}, [ref]).error, "ingest-pending", "registration does not conflict with journal authority")
      ow.test.assert(wm.knowledgeReconcileDerivatives({ dryRun: false, approved: true }).error, "ingest-pending", "repair cannot change pending journal fingerprint")
      ow.test.assert(io.readFileString(wm._knowledgeStatePath()), before, "pending journal operations leave authority intact")
      io.rm(journal)
      global.__mini_a_ingest_lib_mode = true; load("mini-a-ingest.js")
      var ingest = new MiniAIngest({}, function() {}), result = { planned_derivatives_invalidated: [] }
      ow.test.assert(wm.knowledgeRecordDerivative("page-summary", "supported", { text: "Supported summary." }, [ref]).ok, true, "ingest fixture has real summary postings")
      state = wm.knowledgeLoadState(); state.sources.origin = { page: "source.md", chunks: [] }
      state.summaries.pages.foreign = { text: "Unrelated legacy guidance." }
      ingest._invalidate(state, "origin", result)
      ow.test.assert(state.facts.claim.invalidated, true, "ingest invalidates passage-supported existing facts")
      ow.test.assert(isDef(state.summaries.pages.supported), false, "ingest retains established summary removal semantics")
      ow.test.assert(isDef(state.summaries.pages.foreign), true, "ingest preserves unknown unrelated provenance")
      ow.test.assert(state.derivativeRegistry.byPage["source.md"].join(","), "fact:claim", "deleted summary retires only its direct postings")
      ow.test.assert(state.dependencies["source.md"].join(","), "fact:claim", "deleted summary preserves fact dependencies")
    } finally { if (reader) reader.close(); if (wm) wm.close(); io.rm(dir) }
  }
  exports.testDeadlineAwareCacheGuard = function() {
    var dir=temporary(), wm, pin, holder, reader, releaseLock=new java.util.concurrent.CountDownLatch(1), releaseBackend=new java.util.concurrent.CountDownLatch(1), errors=[]
    try {
      wm=make(dir);wm.write("guard.md",{title:"Guard"},"# Guard\nguardparameter is current.")
      ow.test.assert(wm.reindex().ok,true,"concurrent guard fixture built with real Lucene")
      var engine=wm._retrievalV2, readyLock=new java.util.concurrent.CountDownLatch(1), ran=false
      holder=new java.lang.Thread(new JavaAdapter(java.lang.Runnable,{run:function(){engine.lock.lock();try{readyLock.countDown();releaseLock.await(2,java.util.concurrent.TimeUnit.SECONDS)}catch(e){errors.push(String(e))}finally{engine.lock.unlock()}}}))
      holder.start();ow.test.assert(readyLock.await(1,java.util.concurrent.TimeUnit.SECONDS),true,"another JVM thread holds the cache lock")
      var started=Number(java.lang.System.nanoTime()), guardError=""
      try{engine._guard(function(){ran=true},Date.now()+20)}catch(e){guardError=String(e.message||e)}
      var waited=(Number(java.lang.System.nanoTime())-started)/1000000
      ow.test.assert(["retrieval-busy","request-deadline-exhausted"].indexOf(guardError)>=0,true,"queued request has an explicit deadline/busy outcome")
      ow.test.assert(ran,false,"expired queued request never runs its critical section")
      ow.test.assert(waited<400,true,"short-deadline request does not consume the default one-second lock wait")
      releaseLock.countDown();holder.join(1000);ow.test.assert(holder.isAlive(),false,"lock-holder thread shuts down")
      pin=engine.acquire()
      var raw=wm.read("guard.md").raw, backend=wm._backend, backendType=wm._backendType, readyBackend=new java.util.concurrent.CountDownLatch(1), body
      wm._config.indexdir=dir;wm._backendType="http"
      wm._backend={exists:function(){return true},read:function(){readyBackend.countDown();if(!releaseBackend.await(2,java.util.concurrent.TimeUnit.SECONDS))throw new Error("fixture backend timeout");return raw},close:function(){}}
      try {
        reader=new java.lang.Thread(new JavaAdapter(java.lang.Runnable,{run:function(){try{body=engine._body(pin,pin.catalog.pages["guard.md"],Date.now()+2000,{})}catch(e){errors.push(String(e))}}}))
        reader.start();ow.test.assert(readyBackend.await(1,java.util.concurrent.TimeUnit.SECONDS),true,"remote revision read is blocked in a separate caller")
        var concurrent=engine.acquire(Date.now()+150)
        try{ow.test.assert(Number(concurrent.reader.numDocs())>0,true,"warm reader acquire succeeds while another caller waits on its remote backend")}finally{engine.release(concurrent)}
      } finally {releaseBackend.countDown();if(reader)reader.join(1000);wm._backend=backend;wm._backendType=backendType}
      ow.test.assert(reader.isAlive(),false,"remote validation caller shuts down")
      ow.test.assert(body,raw,"remote caller returns the exact validated revision after release")
      ow.test.assert(errors.length,0,"bounded concurrent callers have no hidden failures")
      engine.close()
      ow.test.assert(pin.refs,1,"shutdown retains the in-flight reader")
      var readyRelease=new java.util.concurrent.CountDownLatch(1), finishRelease=new java.util.concurrent.CountDownLatch(1), releaseError="", retained=pin
      holder=new java.lang.Thread(new JavaAdapter(java.lang.Runnable,{run:function(){try{engine._guard(function(){readyRelease.countDown();finishRelease.await(2,java.util.concurrent.TimeUnit.SECONDS)})}catch(e){errors.push(String(e))}}}))
      try {
        holder.start();ow.test.assert(readyRelease.await(1,java.util.concurrent.TimeUnit.SECONDS),true,"serving operation holds the lock during request completion")
        started=Number(java.lang.System.nanoTime())
        try{engine.release(pin);pin=__}catch(e){releaseError=String(e.message||e)}
        waited=(Number(java.lang.System.nanoTime())-started)/1000000
        ow.test.assert(releaseError,"","completed request cannot lose its reader release under contention")
        ow.test.assert(waited<400,true,"reader release does not wait for the one-second management timeout")
        ow.test.assert(retained.refs,1,"queued release never closes a reader while the serving lock is held")
        ow.test.assert(Number(retained.reader.numDocs())>0,true,"queued reader remains usable until the owning operation finishes")
      } finally {finishRelease.countDown();holder.join(1000)}
      ow.test.assert(holder.isAlive(),false,"deferred-release operation shuts down")
      ow.test.assert(retained.refs,0,"owning operation drains the completed request release")
      ow.test.assert(engine.serving.length,0,"shutdown closes the last reader after its deferred release")
      ow.test.assert(Number(retained.reader.getRefCount()),0,"released shutdown reader is actually closed")
      ow.test.assert(errors.length,0,"deferred release has no hidden JVM thread failures")
      for(var round=0;round<3;round++) {
        wm.close();wm=make(dir);engine=wm._retrievalV2
        var concurrentPins=[], releaseThreads=[], startPeers=new java.util.concurrent.CountDownLatch(1), peerErrors=new java.util.concurrent.ConcurrentLinkedQueue(), closeCount=new java.util.concurrent.atomic.AtomicInteger(0)
        for(var peer=0;peer<16;peer++)concurrentPins.push(engine.acquire())
        retained=concurrentPins[0]
        var originalClose=engine._closeSnapshot
        engine._closeSnapshot=function(snapshot){closeCount.incrementAndGet();return originalClose.call(engine,snapshot)}
        engine.close()
        readyRelease=new java.util.concurrent.CountDownLatch(1);finishRelease=new java.util.concurrent.CountDownLatch(1)
        holder=new java.lang.Thread(new JavaAdapter(java.lang.Runnable,{run:function(){try{engine._guard(function(){readyRelease.countDown();finishRelease.await(3,java.util.concurrent.TimeUnit.SECONDS)})}catch(e){peerErrors.add(String(e))}}}))
        try {
          holder.start();ow.test.assert(readyRelease.await(1,java.util.concurrent.TimeUnit.SECONDS),true,"concurrent release guard acquired")
          concurrentPins.forEach(function(snapshot){
            var thread=new java.lang.Thread(new JavaAdapter(java.lang.Runnable,{run:function(){try{startPeers.await(1,java.util.concurrent.TimeUnit.SECONDS);engine.release(snapshot)}catch(e){peerErrors.add(String(e))}}}))
            releaseThreads.push(thread);thread.start()
          })
          startPeers.countDown()
          releaseThreads.forEach(function(thread){thread.join(1000);ow.test.assert(thread.isAlive(),false,"concurrent completed request does not wait for the serving guard")})
          ow.test.assert(Number(retained.pendingReleases.get()),16,"atomic queue retains every simultaneous release")
          ow.test.assert(retained.refs,16,"reader remains pinned until queued releases are drained")
          ow.test.assert(Number(closeCount.get()),0,"no reader closure while owner holds the guard")
        } finally {startPeers.countDown();finishRelease.countDown();holder.join(1000);releaseThreads.forEach(function(thread){thread.join(1000)})}
        ow.test.assert(holder.isAlive(),false,"concurrent release guard terminates")
        ow.test.assert(Number(peerErrors.size()),0,"simultaneous releases have no hidden failures")
        ow.test.assert(retained.refs,0,"all simultaneous reader pins are released")
        ow.test.assert(Number(retained.pendingReleases.get()),0,"drained release queue is empty")
        ow.test.assert(Number(closeCount.get()),1,"last simultaneous release closes the reader exactly once")
        ow.test.assert(Number(retained.reader.getRefCount()),0,"simultaneously released Lucene reader is actually closed")
        ow.test.assert(engine.serving.length,0,"simultaneous shutdown leaves no retained reader")
      }
    } finally {releaseLock.countDown();releaseBackend.countDown();if(holder)holder.join(1000);if(reader)reader.join(1000);if(pin)wm._retrievalV2.release(pin);if(wm)wm.close();io.rm(dir)}
  }
  exports.testConcurrentRestrictedLedger = function() {
    load("mini-a-mcp-wiki.js")
    var chName = "wiki_v2_quota_" + String(java.util.UUID.randomUUID()).replace(/-/g, ""), old = global.__wikiManager
    global.__wikiManager = __
    try {
      var options = { wikirestrict: true, wikiid: "quota-a", wikirestrictmaxreads: 2, wikirestrictmaxchars: 100, wikirestrictrefch: "(name: '" + chName + "', type: 'simple')" }, cfg = { backend: "fs", root: "." }
      var a = new MiniAMcpWikiRestriction(options, cfg), b = new MiniAMcpWikiRestriction(options, cfg)
      var peers = [a,b,a,b,a,b,a,b]
      var charges = parallel4Array(peers, function(peer) { return peer.charge("read", 10) })
      ow.test.assert(charges.filter(function(ok) { return ok === true }).length, 2, "shared concurrent readers cannot reset cumulative quota")
      ow.test.assert($ch(chName).get({ wiki: "quota-a", kind: "usage" }).usage.chars, 20, "shared disclosure bytes charged once per successful read")
      var other = new MiniAMcpWikiRestriction(merge(options, { wikiid: "quota-b" }), cfg)
      ow.test.assert(other.charge("read", 10), true, "another logical namespace has its own quota")
      var changed = new MiniAMcpWikiRestriction(merge(options, { wikirestrictmaxreads: 3 }), cfg)
      ow.test.assert(changed.charge("read", 10), false, "same namespace cannot silently relax its active policy")
      var ref = a.issue("page.md")
      var grants = parallel4Array(peers, function(peer) { return isMap(peer.consume(ref)) })
      ow.test.assert(grants.filter(function(ok) { return ok === true }).length, 1, "shared reference consumed once across concurrent instances")
      var issued = parallel4Array(peers, function(peer) { return peer.issue("cooldown.md") })
      ow.test.assert(issued.filter(function(value) { return isString(value) }).length, 1, "concurrent issue preserves page cooldown")
      ow.test.assert(isUnDef(other.consume(a.issue("isolated.md"))), true, "reference cannot cross logical namespace")
    } finally { global.__wikiManager = old; if ($ch().list().indexOf(chName) >= 0) $ch(chName).destroy() }
  }
  exports.testSourceRevocationBeforeMaterialization = function() {
    var dir=temporary(), wm
    try {
      wm=make(dir)
      wm.write("answer.md",{title:"Answer"},"# Answer\nrevocationboundaryparameter must never be disclosed after access is revoked.")
      ow.test.assert(wm.reindex().ok,true,"revocation-boundary fixture creates a validated serving generation")
      var existsCalls=0, reads=0, raw=wm.read("answer.md").raw
      wm._backendType="es"
      wm._backend={
        exists:function(path){existsCalls++;return existsCalls===1&&path==="answer.md"},
        read:function(){reads++;return raw},
        close:function(){}
      }
      var result=wm.retrieve("revocationboundaryparameter",{chunks:1,maxCandidates:2})
      ow.test.assert(existsCalls>=2,true,"source permission is rechecked before materializing a selected remote candidate")
      ow.test.assert(reads,0,"revoked source cannot reach a remote body read after candidate selection")
      ow.test.assert(result.evidence.length,0,"revoked source cannot disclose indexed or cached evidence")
      ow.test.assert(result.outcome,"partial","mid-request revocation remains explicit rather than a false zero result")
      ow.test.assert(result.stopReasons.indexOf("stale-or-revoked-evidence")>=0,true,"revocation is retained as the bounded partial-result reason")
    } finally {if(wm)wm.close();io.rm(dir)}
  }
  exports.testSharedBlockStore = function() {
    var dir=temporary(), wm, fresh, first, second, oldPin
    try {
      wm=make(dir,{wikiretrievalconfig:{passageChars:128,sharedBlockStore:true}})
      wm.write("a.md",{title:"A"},"# A\nsharedblockstoreparameter remains immutable.")
      wm.write("b.md",{title:"A"},"# A\nsharedblockstoreparameter remains immutable.")
      first=wm.reindex();ow.test.assert(first.ok,true,"shared block store creates an initial generation")
      var firstPin=wm._retrievalV2.acquire(), locator=firstPin.catalog.pages["a.md"].locator, sibling=firstPin.catalog.pages["b.md"].locator, store=wm._retrievalV2._sharedBlockPath(locator)
      try {
        ow.test.assert(io.fileExists(store),true,"shared block store persists the revision-addressed block")
        ow.test.assert(firstPin.manifest.schema,3,"shared block store publishes manifest-addressed schema-3 blocks")
        ow.test.assert(isUnDef(firstPin.manifest.blocks),true,"schema-3 keeps block metadata out of a manifest-wide array")
        ow.test.assert(firstPin.catalog.blockRefs[sibling].locator,sibling,"each immutable revision has a routed block-reference record")
        ow.test.assert(io.fileExists(firstPin.dir+"/"+sibling),false,"schema-3 generation does not duplicate immutable bytes")
        ow.test.assert(firstPin.catalog.blockRefs[locator].storage,"shared","block record declares its shared storage kind")
      } finally {wm._retrievalV2.release(firstPin)}
      second=wm._retrievalV2.build(["a.md"])
      ow.test.assert(second.ok,true,"unchanged shared-block update publishes a new generation")
      ow.test.assert(second.updateWork.sharedBlocksReferenced>0,true,"unchanged update reuses manifest-addressed immutable blocks without generation links")
      var current=wm._retrievalV2.acquire()
      try {ow.test.assert(io.fileExists(current.dir+"/"+locator),false,"new generation remains free of retained block copies")} finally {wm._retrievalV2.release(current)}
      ow.test.assert(wm.retrieve("sharedblockstoreparameter").evidence.length>0,true,"shared block store preserves current retrieval evidence")
      oldPin=wm._retrievalV2.acquire()
      wm.write("a.md",{title:"A"},"# A\nsharedblockstorechangedparameter is a new immutable revision.")
      var changed=wm._retrievalV2.build(["a.md"])
      ow.test.assert(changed.ok,true,"changed page writes and activates a distinct shared revision")
      try {
        ow.test.assert(oldPin.catalog.pages["a.md"].locator,locator,"pinned old reader retains its original generation block")
        ow.test.assert(io.fileExists(store),true,"pinned old reader retains an immutable manifest target after activation")
      } finally {wm._retrievalV2.release(oldPin);oldPin=__}
      wm.close();wm=__
      fresh=make(dir,{wikiretrievalconfig:{passageChars:128,sharedBlockStore:true}})
      ow.test.assert(fresh.retrieve("sharedblockstorechangedparameter").evidence.length,1,"fresh process validates and serves the changed shared-store generation")
      wm=fresh;fresh=__
      var pointer=io.readFileString(wm._retrievalV2.root+"/current.json")
      var active=wm._retrievalV2.acquire(), activeStore=wm._retrievalV2._sharedBlockPath(active.catalog.pages["a.md"].locator)
      wm._retrievalV2.release(active)
      io.writeFileString(activeStore,"corrupt shared store")
      var corrupt=wm._retrievalV2.build(["a.md"])
      ow.test.assert(corrupt.ok,false,"representative activation probe rejects a selected corrupt inherited block")
      ow.test.assert(["generation-integrity-failure","page-revision-binding-failure","generation-evidence-probe-failed"].indexOf(corrupt.error)>=0,true,"corrupt inherited shared evidence fails before activation")
      ow.test.assert(io.readFileString(wm._retrievalV2.root+"/current.json"),pointer,"corrupt inherited evidence preserves the prior activation pointer")
      var stray=wm._retrievalV2.root+"/.blocks/0000000000000000000000000000000000000000.md"
      io.writeFileString(stray,"interrupted publication residue")
      var cleanup=wm._retrievalV2.reclaimSharedBlocks()
      ow.test.assert(cleanup.ok,true,"conservative shared-store cleanup completes with only valid recoverable generations")
      ow.test.assert(io.fileExists(stray),false,"cleanup reclaims only a block absent from every recoverable manifest")
      ow.test.assert(io.fileExists(activeStore),true,"cleanup retains the active manifest block even after a failed publication")
    } finally {if(oldPin&&wm)wm._retrievalV2.release(oldPin);if(fresh)fresh.close();if(wm)wm.close();io.rm(dir)}
  }
  exports.testPublicationScopedValidation = function() {
    var dir=temporary(), wm
    try {
      wm=make(dir,{wikiretrievalconfig:{passageChars:128}})
      wm.write("changed.md",{title:"Changed"},"# Changed\nfirst scopedpublicationparameter value.")
      wm.write("unchanged.md",{title:"Unchanged"},"# Unchanged\nunchangedpublicationparameter remains valid.")
      ow.test.assert(wm.reindex().ok,true,"scoped validation fixture creates its validated parent")
      var engine=wm._retrievalV2, complete=engine._validate, resolve=engine._resolveCatalogue, blockRecords=engine._blockRecords
      engine._validate=function(){throw new Error("full-closure-validation-must-not-run-at-activation")}
      engine._resolveCatalogue=function(){throw new Error("prior-catalogue-must-not-materialize")}
      engine._blockRecords=function(){throw new Error("prior-block-map-must-not-materialize")}
      wm.write("changed.md",{title:"Changed"},"# Changed\nsecond scopedpublicationparameter value.")
      var published=engine.build(["changed.md"])
      engine._validate=complete;engine._resolveCatalogue=resolve;engine._blockRecords=blockRecords
      ow.test.assert(published.ok,true,"incremental activation validates changed bindings without a full catalogue closure")
      ow.test.assert(published.updateWork.bindingBlockReads<=1,true,"activation performs a bounded changed-binding proof rather than reading the parent closure")
      ow.test.assert(published.updateWork.catalogueKeysCopied,0,"incremental activation copies no prior catalogue records")
      ow.test.assert(published.updateWork.catalogueKeyLookups<20,true,"incremental activation performs bounded routed-key lookups")
      ow.test.assert(wm.retrieve("scopedpublicationparameter").evidence.length,1,"scoped publication serves the changed verified evidence")
      ow.test.assert(wm.retrieve("unchangedpublicationparameter").evidence.length,1,"parent-bound unchanged evidence remains readable after scoped publication")
    } finally {if(wm)wm.close();io.rm(dir)}
  }
  exports.testRoutedCompactionBoundary = function() {
    var dir=temporary(),wm
    try {
      wm=make(dir,{wikiretrievalconfig:{passageChars:128}})
      wm.write("depth.md",{title:"Depth"},"# Depth\ncompactionboundaryparameter remains available.")
      ow.test.assert(wm.reindex().ok,true,"compaction fixture creates a depth-zero routed base")
      for(var i=1;i<=32;i++){
        var update=wm._retrievalV2.build(["depth.md"])
        ow.test.assert(update.ok,true,"bounded routed update succeeds before the lineage limit: "+i)
      }
      var pointer=io.readFileString(wm._retrievalV2.root+"/current.json"),blocked=wm._retrievalV2.build(["depth.md"])
      ow.test.assert(blocked.error,"compaction-required","lineage limit requires explicit compaction instead of hiding corpus work in a small update")
      ow.test.assert(io.readFileString(wm._retrievalV2.root+"/current.json"),pointer,"compaction-required leaves the active pointer unchanged")
      ow.test.assert(wm.reindex().ok,true,"authorized full reindex performs explicit compaction")
      var pin=wm._retrievalV2.acquire()
      try{ow.test.assert(pin.manifest.catalogue.depth,0,"explicit compaction publishes a new routed base")}finally{wm._retrievalV2.release(pin)}
    }finally{if(wm)wm.close();io.rm(dir)}
  }
  exports.testSharedBlockStoreReclamationClosure = function() {
    var dir=temporary(), wm
    try {
      wm=make(dir,{wikiretrievalconfig:{passageChars:128,sharedBlockStore:true}})
      wm.write("a.md",{title:"A"},"# A\nclosurestoreparameter is retained by the active generation.")
      ow.test.assert(wm.reindex().ok,true,"closure fixture publishes a shared-block generation")
      var pin=wm._retrievalV2.acquire(), store=wm._retrievalV2._sharedBlockPath(pin.catalog.pages["a.md"].locator)
      wm._retrievalV2.release(pin)
      var root=wm._retrievalV2.root, stray="blocks/0000000000000000000000000000000000000000.md", strayPath=wm._retrievalV2._sharedBlockPath(stray)
      io.writeFileString(strayPath,"unreachable interrupted block")
      io.writeFileString(root+"/.blocks/reclaim.json",stringify({schema:2,phase:"not-a-phase",candidates:[stray],retainedGenerations:[]},__,""))
      var deferred=wm._retrievalV2.reclaimSharedBlocks()
      ow.test.assert(deferred.error,"reclamation-deferred-invalid-journal","malformed reclamation journal never authorizes a delete")
      ow.test.assert(io.fileExists(strayPath),true,"malformed reclamation journal preserves unmarked candidate bytes")
      io.rm(root+"/.blocks/reclaim.json")
      var originalMark=wm._retrievalV2._markSharedReachability, calls=0
      wm._retrievalV2._markSharedReachability=function(retained) { var marked=originalMark.call(this,retained); if (++calls>1) marked[stray]=true; return marked }
      var remarked=wm._retrievalV2.reclaimSharedBlocks()
      wm._retrievalV2._markSharedReachability=originalMark
      ow.test.assert(remarked.ok,true,"shared reclamation completes after a valid re-mark")
      ow.test.assert(io.fileExists(strayPath),true,"re-mark immediately before unlink retains a newly reachable candidate")
      ow.test.assert(io.fileExists(store),true,"exact closure keeps the active generation block")
      var abandoned=root+"/"+String(java.util.UUID.randomUUID());io.mkdir(abandoned);io.writeFileString(abandoned+"/manifest.json","abandoned")
      var reclaimed=wm._retrievalV2.reclaimSharedBlocks()
      ow.test.assert(reclaimed.ok,true,"closure sweep tolerates and retires an abandoned staging generation")
      ow.test.assert(io.fileExists(abandoned),false,"unreachable generation directory is reclaimed after the block mark")
      ow.test.assert(io.fileExists(store),true,"generation reclamation cannot remove retained shared evidence")
    } finally {if(wm)wm.close();io.rm(dir)}
  }
  exports.testServingBundlesAndRemoteEvidence = function() {
    var dir = temporary(), builder, client, oldPin
    try {
      io.mkdir(dir + "/source"); io.mkdir(dir + "/cache")
      var archive = dir + "/serving.zip"
      builder = make(dir + "/source", { wikiretrievalconfig: { passageChars: 256, bundlePath: archive } })
      builder.write("answer.md", { title: "Answer" }, "# Answer\nremoterevisionparameter is verified.")
      ow.test.assert(builder.reindex().ok, true, "initial generation creates a predecessor candidate for bundle export")
      var published = builder.reindex()
      ow.test.assert(published.bundle.ok, true, "supported reindex streams a serving bundle")
      ow.test.assert(io.fileExists(archive), true, "bundle publication artifact exists")
      client = make(dir + "/cache", { access: "ro" })
      client._backendType = "http"; client._config.indexdir = dir + "/cache"
      var reads = 0, allowed = true, remainingTime = [], current = builder.read("answer.md").raw
      client._backend = { read: function(path, options) { reads++; if(options)remainingTime.push({method:"GET",millis:Number(options.maxMillis)}); return path === "answer.md" ? current : __ }, exists: function(path, options) { if(options)remainingTime.push({method:"HEAD",millis:Number(options.maxMillis)}); return allowed && path === "answer.md" }, close: function() {} }
      var hydrate = function(tag) { return client._hydrateArtifactBundle(function() { return { etag: tag } }, function() { return new java.io.FileInputStream(archive) }, "simulated-http", "serving.zip") }
      ow.test.assert(hydrate("first"), true, "read-only compatible published bundle hydrated")
      ow.test.assert(client.agenticSearch("remoterevisionparameter").results.length, 1, "remote compact search uses real local Lucene")
      ow.test.assert(reads, 0, "remote compact ranking reads no candidate Markdown bodies")
      var answer = client.retrieve("remoterevisionparameter").evidence[0]
      ow.test.assert(current.substring(answer.charStart, answer.charEnd), answer.content, "remote quotation matches verified raw revision")
      ow.test.assert(reads, 0, "static HTTP evidence uses the validated immutable bundle without a nonexistent page endpoint")
      var servingRoot=client._retrievalV2.root, activeServingPointer=io.readFileString(servingRoot+"/current.json")
      ow.test.assert(io.fileExists(servingRoot+"/previous.json"),true,"published bundle carries the validated predecessor pointer")
      io.writeFileString(servingRoot+"/current.json","{invalid pointer")
      var fallbackPin=client._retrievalV2.acquire()
      try {ow.test.assert(fallbackPin.recoveredPointer,true,"hydrated bundle reader can recover through its validated predecessor")} finally {client._retrievalV2.release(fallbackPin);io.writeFileString(servingRoot+"/current.json",activeServingPointer)}
      allowed = false
      ow.test.assert(client.agenticSearch("remoterevisionparameter").results.length, 1, "static HTTP search remains bound to the hydrated bundle rather than a page probe")
      ow.test.assert(client.retrieve("remoterevisionparameter").evidence.length, 1, "static HTTP evidence remains available until its authenticated artifact refresh changes")
      allowed = true
      // Exercise the separately supported remote-source validation path. Static
      // HTTP bundles intentionally have no per-page GET/HEAD contract.
      client._backendType = "es"
      ow.test.assert(client.agenticSearch("remoterevisionparameter").results.length, 1, "restored source access is not negatively cached across requests")
      remainingTime = []
      var readsBefore = reads, backendMeasured = client.retrieve("remoterevisionparameter", {maxMillis:1000})
      ow.test.assert(remainingTime.some(function(call) { return call.method === "HEAD" && call.millis > 0 && call.millis <= 1000 }), true, "remaining request time propagated to permission backend")
      ow.test.assert(remainingTime.some(function(call) { return call.method === "GET" && call.millis > 0 && call.millis <= 1000 }), true, "remaining request time propagated to content backend")
      ow.test.assert(backendMeasured.budget.used.backendReadCalls, reads-readsBefore, "request backend read accounting matches actual remote calls even with a cached serving block")
      ow.test.assert(backendMeasured.budget.used.backendExistsCalls, remainingTime.filter(function(call){return call.method==="HEAD"}).length, "request permission accounting includes every actual remote check")
      ow.test.assert(backendMeasured.budget.used.backendReadBytes, global.MiniAWikiRetrievalV2.bytes(current)*(reads-readsBefore), "remote bytes count complete UTF-8 source validation reads independently of quote size")
      var backendRead=client._backend.read
      try {
        client._backend.read=function(path,options){java.lang.Thread.sleep(35);return backendRead(path,options)}
        var delayed=client.retrieve("remoterevisionparameter",{maxMillis:1000})
        ow.test.assert(delayed.budget.used.backendReadMillis>=30,true,"backend timing measures actual blocking source reads")
        client._backend.read=function(){java.lang.Thread.sleep(35);throw new Error("injected source failure")}
        var failed=client.retrieve("remoterevisionparameter",{maxMillis:1000})
        ow.test.assert(failed.outcome,"partial","backend failure preserves incomplete-search distinction")
        ow.test.assert(failed.budget.used.backendFailures,1,"failed request retains actual backend failure count")
        ow.test.assert(failed.budget.used.backendReadCalls,1,"failed read attempt is charged once")
        ow.test.assert(failed.budget.used.backendReadMillis>=30,true,"failed backend call retains elapsed duration")
      } finally {client._backend.read=backendRead}
      oldPin = client._retrievalV2.acquire()
      var pointer = io.readFileString(dir + "/cache/.mini-a-wiki-bundles/current.json"), oldRaw = current
      current = "# Changed\nremotechangedparameter is current."
      ow.test.assert(client.retrieve("remoterevisionparameter").evidence.length, 0, "cached block cannot bypass remote revision change")
      current = oldRaw
      client._beforeBundleActivate = function() { throw new Error("activation failure") }
      ow.test.assert(hydrate("failed-activation"), false, "bundle activation failure is explicit")
      ow.test.assert(io.readFileString(dir + "/cache/.mini-a-wiki-bundles/current.json"), pointer, "failed activation preserves previous generation")
      ow.test.assert(client.retrieve("remoterevisionparameter").evidence.length, 1, "prior working evidence survives failed refresh")
      delete client._beforeBundleActivate
      client._config.wikiretrievalconfig = { maxArtifactBytes: 64 }
      ow.test.assert(hydrate("oversize"), false, "expanded byte ceiling enforced while streaming")
      ow.test.assert(io.readFileString(dir + "/cache/.mini-a-wiki-bundles/current.json"), pointer, "oversize bundle preserves activation")
      delete client._config.wikiretrievalconfig
      builder.write("answer.md", { title: "Answer" }, "# Answer\nremotechangedparameter is current.")
      current = builder.read("answer.md").raw
      ow.test.assert(hydrate("second"), true, "new immutable remote generation activated")
      ow.test.assert(client.retrieve("remotechangedparameter").evidence.length, 1, "refreshed reader returns new evidence")
      ow.test.assert(client.retrieve("remoterevisionparameter").evidence.length, 0, "retired evidence absent from new requests")
      ow.test.assert(io.fileExists(oldPin.dir + "/manifest.json"), true, "in-flight old generation not deleted")
      client._retrievalV2.release(oldPin); oldPin = __
      var newPointer = io.readFileString(dir + "/cache/.mini-a-wiki-bundles/current.json")
      var bad = dir + "/unsafe.zip", zip = new java.util.zip.ZipOutputStream(new java.io.FileOutputStream(bad))
      zip.putNextEntry(new java.util.zip.ZipEntry("../escape.md")); zip.write(new java.lang.String("escape").getBytes("UTF-8")); zip.closeEntry(); zip.close()
      ow.test.assert(client._hydrateArtifactBundle(function() { return { etag: "unsafe" } }, function() { return new java.io.FileInputStream(bad) }, "simulated-http", "bad.zip"), false, "unsafe paths rejected before extraction")
      ow.test.assert(io.readFileString(dir + "/cache/.mini-a-wiki-bundles/current.json"), newPointer, "unsafe extraction cannot replace serving generation")
      ow.test.assert(io.fileExists(dir + "/cache/.mini-a-wiki-bundles/escape.md"), false, "traversal writes no escaped file")
    } finally { if (oldPin && client) client._retrievalV2.release(oldPin); if (client) client.close(); if (builder) builder.close(); io.rm(dir) }
  }
  exports.testS3BundleHydrationRefresh = function() {
    var dir=temporary(), builder, reader, archive, etag="one", denied=false
    try {
      io.mkdir(dir+"/source");io.mkdir(dir+"/cache");archive=dir+"/serving.zip"
      builder=make(dir+"/source",{wikiretrievalconfig:{bundlePath:archive}})
      builder.write("answer.md",{title:"Answer"},"# Answer\ns3bundleparameter is verified.")
      ow.test.assert(builder.reindex().ok,true,"S3 bundle fixture creates initial generation")
      ow.test.assert(builder.reindex().bundle.ok,true,"S3 bundle fixture exports a validated generation")
      reader=make(dir+"/cache",{access:"ro"})
      reader._backendType="s3"
      reader._config.indexdir=dir+"/cache";reader._config.bucket="fixtures";reader._config.s3artifactprefix="serving";reader._config.s3artifactbundle=true
      var metadataCalls=0,downloadCalls=0
      var audits=[];reader._auditFn=function(event){audits.push(event)}
      var raw=builder.read("answer.md").raw
      reader._backend={client:{
        statObject:function(bucket,key){metadataCalls++;ow.test.assert(bucket,"fixtures","S3 hydration uses configured bucket");ow.test.assert(key,"serving/mini-a-wiki-index.zip","S3 hydration uses immutable bundle key");if(denied)throw new Error("AccessDenied");return {etag:etag,modifiedTime:"fixture"}},
        getObjectStream:function(bucket,key){downloadCalls++;if(denied)throw new Error("AccessDenied");return new java.io.FileInputStream(archive)}
      },exists:function(path){return path==="answer.md"},read:function(path){return path==="answer.md"?raw:__},close:function(){}}
      ow.test.assert(reader._hydrateS3Artifacts(),true,"S3 bundle hydrates through the configured S3 reader path")
      var artifactAudit=audits.filter(function(event){return event.backend==="s3-artifact"&&event.operation==="hydrate"})[0]
      ow.test.assert(artifactAudit.ok,true,"S3 artifact hydration emits a successful transport audit")
      ow.test.assert(artifactAudit.bytes>0&&artifactAudit.expandedBytes>0,true,"S3 artifact audit reports compressed and expanded bytes")
      ow.test.assert(artifactAudit.metadataMillis>=0&&artifactAudit.downloadMillis>=0&&artifactAudit.totalMillis>=artifactAudit.downloadMillis,true,"S3 artifact audit reports monotonic metadata/download durations")
      var pointer=io.readFileString(dir+"/cache/.mini-a-wiki-bundles/current.json")
      ow.test.assert(reader.retrieve("s3bundleparameter",{chunks:1}).evidence.length,1,"hydrated S3 reader serves the validated indexed passage")
      ow.test.assert(reader._hydrateS3Artifacts(),false,"unchanged S3 metadata avoids a duplicate download")
      ow.test.assert(downloadCalls,1,"unchanged S3 bundle performs exactly one download")
      var metadataAudit=audits.filter(function(event){return event.backend==="s3-artifact"&&event.operation==="metadata"})[0]
      ow.test.assert(metadataAudit.ok&&metadataAudit.bytes===0&&metadataAudit.metadataMillis>=0,true,"unchanged S3 metadata probe is measured without invented download bytes")
      etag="two";denied=true
      ow.test.assert(reader._hydrateS3Artifacts(),false,"denied S3 refresh remains explicit")
      ow.test.assert(io.readFileString(dir+"/cache/.mini-a-wiki-bundles/current.json"),pointer,"denied S3 refresh retains the prior hydrated generation")
      ow.test.assert(metadataCalls>=3,true,"S3 metadata is checked before every eligible refresh")
      denied=false;etag="three"
      builder.write("answer.md",{title:"Answer"},"# Answer\ns3bundlereplacementparameter is verified.")
      raw=builder.read("answer.md").raw
      ow.test.assert(builder.reindex().bundle.ok,true,"changed S3 fixture publishes a replacement bundle")
      ow.test.assert(reader._hydrateS3Artifacts(),true,"changed S3 metadata activates a complete replacement generation")
      ow.test.assert(reader.retrieve("s3bundlereplacementparameter",{chunks:1}).evidence.length,1,"replacement S3 generation serves its new validated evidence")
    } finally {if(reader)reader.close();if(builder)builder.close();io.rm(dir)}
  }
  exports.testSourceIoAuditAccounting = function() {
    var dir=temporary(), events=[], wm
    try {
      io.writeFileString(dir+"/unicode.md","# Unicode\né 😀 transport bytes")
      wm=new MiniAWikiManager({backend:"fs",root:dir,access:"rw",wikiretrievalv2:true,wikiretrievalconfig:{passageChars:256}},function(){},function(event){events.push(event)})
      ow.test.assert(wm._backend.read("unicode.md").indexOf("transport")>=0,true,"filesystem source read remains available with I/O auditing")
      var event=events.filter(function(item){return item.backend==="fs"&&item.path==="unicode.md"})[0]
      ow.test.assert(isMap(event),true,"filesystem source read emits one audit event")
      ow.test.assert(event.bytes,Number(new java.lang.String("# Unicode\né 😀 transport bytes").getBytes("UTF-8").length),"source audit bytes use UTF-8 payload length rather than JavaScript character count")
      ow.test.assert(event.operation,"read","source audit identifies the read operation")
      ow.test.assert(event.protocol,"file","filesystem source audit identifies its protocol")
      ow.test.assert(isNumber(event.totalMillis)&&event.totalMillis>=0,true,"source audit records a monotonic boundary duration")
      events=[];ow.test.assert(isUnDef(wm._backend.read("missing.md")),true,"missing filesystem source remains unavailable")
      event=events.filter(function(item){return item.backend==="fs"&&item.path==="missing.md"})[0]
      ow.test.assert(event.ok,false,"failed filesystem source read is audited explicitly")
      ow.test.assert(event.bytes,0,"failed source read reports no payload bytes")
      ow.test.assert(event.totalMillis>=0,true,"failed source read retains its elapsed boundary duration")
      events=[];ow.test.assert(wm._backend.exists("unicode.md"),true,"filesystem existence probe remains available with I/O auditing")
      event=events.filter(function(item){return item.backend==="fs"&&item.path==="unicode.md"&&item.operation==="exists"})[0]
      ow.test.assert(isMap(event),true,"filesystem existence probe emits an audit event")
      ow.test.assert(event.protocol,"file","filesystem existence audit identifies its protocol")
      ow.test.assert(event.bytes,0,"existence probe does not invent a payload byte count")
      ow.test.assert(event.totalMillis>=0,true,"existence probe records a monotonic boundary duration")
      events=[]
      ow.test.assert(wm.reindex().ok,true,"serving-block audit fixture builds a validated generation")
      var syncEvents=events.filter(function(item){return item.backend==="serving-sync"})
      ow.test.assert(syncEvents.some(function(item){return item.ok&&item.target==="file"}),true,"publication audits successful file force requests")
      ow.test.assert(syncEvents.some(function(item){return item.ok&&item.target==="directory"}),true,"publication audits successful directory force requests")
      ow.test.assert(syncEvents.every(function(item){return item.bytes===0&&item.operation==="force"&&item.protocol==="file"&&item.totalMillis>=0}),true,"force events report requests and elapsed time without inventing physical bytes")
      var pin=wm._retrievalV2.acquire()
      try {
        var shard=wm._retrievalV2._catalogueShard("unicode.md"), descriptor=pin.manifest.catalogue.shards.pages[shard]
        events=[];wm._retrievalV2._readCatalogueShard(pin.dir,"pages",shard,descriptor)
        event=events.filter(function(item){return item.backend==="serving-catalogue-shard"})[0]
        ow.test.assert(event.ok,true,"validated catalogue shard read is audited")
        ow.test.assert(event.bytes,descriptor.bytes,"catalogue audit counts the exact UTF-8 payload")
        ow.test.assert(event.verification,"sha256","catalogue audit identifies its checksum pass")
        ow.test.assert(event.totalMillis>=0,true,"catalogue audit includes checksum and decode time")
        events=[]
        var corruptDescriptor=clone(descriptor);corruptDescriptor.checksum=new Array(65).join("0")
        try {wm._retrievalV2._readCatalogueShard(pin.dir,"pages",shard,corruptDescriptor)} catch(ignoreShard) {}
        event=events.filter(function(item){return item.backend==="serving-catalogue-shard"})[0]
        ow.test.assert(event.ok,false,"failed catalogue verification emits a failed audit")
        ow.test.assert(event.bytes,0,"failed catalogue verification does not claim a returned payload")
      } finally {wm._retrievalV2.release(pin)}
      events=[]
      try {wm._retrievalV2._syncPath(dir+"/missing-force-target",false)} catch(ignoreForce) {}
      event=events.filter(function(item){return item.backend==="serving-sync"})[0]
      ow.test.assert(event.ok,false,"failed force request is audited without changing publication status")
      ow.test.assert(event.bytes,0,"failed force request does not invent persisted bytes")
      pin=wm._retrievalV2.acquire()
      try {events=[];ow.test.assert(wm._retrievalV2._body(pin,pin.catalog.pages["unicode.md"]).indexOf("transport")>=0,true,"serving-block audit fixture reads the exact immutable body")} finally {wm._retrievalV2.release(pin)}
      event=events.filter(function(item){return item.backend==="serving-block"&&item.path==="unicode.md"})[0]
      ow.test.assert(isMap(event),true,"immutable serving block emits an audit event")
      ow.test.assert(event.operation,"read","serving block audit identifies the read operation")
      ow.test.assert(event.protocol,"file","serving block audit identifies its local artifact protocol")
      ow.test.assert(event.bytes>0&&event.totalMillis>=0,true,"serving block audit records payload bytes and monotonic duration")
      events=[];ow.test.assert(wm.retrieve("transport",{chunks:1}).evidence.length,1,"stored-passage audit fixture retrieves indexed evidence")
      event=events.filter(function(item){return item.backend==="serving-index-passage"&&item.path==="unicode.md"})[0]
      ow.test.assert(event.protocol,"lucene-stored","stored passage audit identifies its Lucene materialization protocol")
      ow.test.assert(event.operation,"read","stored passage audit identifies its read operation")
      ow.test.assert(event.totalMillis,0,"stored passage audit does not invent blocking filesystem duration")
      pin=wm._retrievalV2.acquire()
      try {events=[];wm._retrievalV2._body(pin,pin.catalog.pages["unicode.md"])} finally {wm._retrievalV2.release(pin)}
      event=events.filter(function(item){return item.backend==="serving-cache"&&item.path==="unicode.md"})[0]
      ow.test.assert(event.protocol,"memory","immutable body cache audit identifies memory rather than source I/O")
      ow.test.assert(event.cacheHit,true,"immutable body cache audit identifies the hit explicitly")
    } finally {if(wm)wm.close();io.rm(dir)}
  }
  exports.testLegacyReadOnlyLexicalFeatures = function() {
    loadLib("mini-a-wiki-knowledge.js")
    var dir = temporary(), writer, reader, lockWriter, directory, analyzer
    try {
      var lexical = { language: "english", synonyms: [["time to live", "reference expiry"]], shingles: true, ngrams: true }
      writer = make(dir, { wikiretrievalv2: false, wikilexical: lexical })
      writer.write("answer.md", { title: "Reference" }, "# Settings\nA running process uses reference expiry. wikirestrictrefttl preserves references.")
      ow.test.assert(writer.reindex().ok, true, "legacy real enhanced index built")
      reader = make(dir, { access: "ro", wikiretrievalv2: false, wikilexical: lexical })
      var L = Packages.org.apache.lucene
      directory = L.store.FSDirectory.open(java.nio.file.Paths.get(writer._getLuceneIndexPath()))
      analyzer = ow.ch.__types.searchdb.__toAnalyzer({ analyzer: "english" })
      lockWriter = new L.index.IndexWriter(directory, new L.index.IndexWriterConfig(analyzer))
      var stemmed = reader._luceneQueryReadOnly("run", 5)
      ow.test.assert(stemmed[0].id, "answer.md", "legacy read-only query uses indexed English stemming while writer lock held")
      var synonyms = reader._luceneQueryReadOnly("time to live", 5)
      ow.test.assert(synonyms[0].id, "answer.md", "installed multiword synonym primitive applied without writer")
      ow.test.assert(isNumber(synonyms[0].rankScore), true, "enhanced fused score is explicit")
      ow.test.assert(isNumber(synonyms[0].nativeScore), true, "native base engine score remains separate")
      ow.test.assert(Object.keys(synonyms[0].scoreComponents).length > 0, true, "only executed contributions reported")
      ow.test.assert(reader._luceneQueryReadOnly("wikirestrictrefttl", 5)[0].id, "answer.md", "technical parameter survives configured analyzers")
      var ngrams = reader._luceneQueryReadOnly("wikirestrictref", 5)
      ow.test.assert(ngrams.some(function(hit) { return hit.scoreComponents.ngram > 0 }), true, "character ngram index fields actually queried")
      ow.test.assert(reader._luceneQueryReadOnly("zzzzxxxxqqqq", 5).length, 0, "healthy enhanced zero stays zero")
      var manager = global.__miniAWikiKnowledge.install(reader), ranked = manager.knowledgeRank("expiry", [{ path: "answer.md", title: "Reference", score: 2 }], true)[0]
      ow.test.assert(isNumber(ranked.rankScore) && isFinite(ranked.rankScore), true, "two-argument OpenAF merge preserves actual ranking fields")
      ow.test.assert(ranked.nativeScore, 2, "compatible legacy ranking preserves underlying score")
      ow.test.assert(manager.knowledgeRank("expiry", [ranked], true)[0].rankScore, ranked.rankScore, "combined score not ranked twice")
    } finally { if (lockWriter) lockWriter.rollback(); if (directory) directory.close(); if (analyzer) analyzer.close(); if (reader) reader.close(); if (writer) writer.close(); io.rm(dir) }
  }
  exports.testExplicitSupersession = function() {
    var dir=temporary(), wm, snapshot
    try {
      wm=make(dir)
      io.writeFileString(dir+"/older.md","---\ntitle: Retired guidance\nupdated: 2035-01-01\nsuperseded_by: current.md\n---\n# Guide\nsupersessionparameter requires disabling safeguards.")
      io.writeFileString(dir+"/current.md","---\ntitle: Current guidance\nupdated: 2000-01-01\n---\n# Guide\nsupersessionparameter requires keeping safeguards enabled.")
      ow.test.assert(wm.reindex().ok,true,"real supersession fixture published")
      var search=wm.agenticSearch("supersessionparameter")
      ow.test.assert(search.results.some(function(hit){return hit.path==="older.md"}),false,"explicit superseded_by guidance is excluded despite a newer editorial date")
      ow.test.assert(wm.retrieve("supersessionparameter",{chunks:2}).evidence[0].path,"current.md","current-view retrieve uses active guidance")
      ow.test.assert(wm.assembleContext("supersessionparameter",{chunks:2,tokens:1000}).chunks.some(function(chunk){return chunk.path==="older.md"}),false,"assembled evidence excludes retired guidance")
      snapshot=wm._retrievalV2.acquire()
      var page=snapshot.catalog.pages["older.md"], passage=snapshot.catalog.passages[page.passageIds[0]]
      var ref={page:page.path,pageId:page.pageId,wikiId:snapshot.catalog.wikiId,revision:page.revision,passageId:passage.passageId,charStart:passage.charStart,charEnd:passage.charEnd}
      ow.test.assert(wm.knowledgeRecordDerivative("fact","retired-support",{text:"Unsafe guidance"},[ref],{dryRun:true}).error,"stale-support","retired guidance cannot ground a new derivative")
      wm._retrievalV2.release(snapshot);snapshot=null
      wm.write("unresolved.md",{title:"Unresolved retirement",superseded_by:"@unselected/hidden.md"},"# Retired\nunresolvedsupersessionmarker")
      ow.test.assert(wm.retrieve("unresolvedsupersessionmarker").evidence.length,0,"explicit retirement does not follow an unselected replacement target")
      wm.write("retired-status.md",{title:"Explicitly retired",status:"retired"},"# Retired\nretiredstatusparameter must not remain answer evidence.")
      ow.test.assert(wm.retrieve("retiredstatusparameter").evidence.length,0,"explicit retired status excludes current evidence without requiring a replacement path")
      wm.write("review-status.md",{title:"Reviewed",status:"review"},"# Current\nreviewstatusparameter remains eligible as declared review metadata.")
      var reviewed=wm.retrieve("reviewstatusparameter")
      ow.test.assert(reviewed.evidence.length,1,"ordinary review status remains descriptive rather than implicit retirement")
      wm.write("rejected-status.md",{title:"Rejected",status:"rejected"},"# Rejected\nrejectedstatusparameter is explicitly ineligible.")
      ow.test.assert(wm.retrieve("rejectedstatusparameter").evidence.length,0,"explicit rejected status excludes answer evidence")
      wm.write("withdrawn-status.md",{title:"Withdrawn",status:"withdrawn"},"# Withdrawn\nwithdrawnstatusparameter is explicitly ineligible.")
      ow.test.assert(wm.retrieve("withdrawnstatusparameter").evidence.length,0,"explicit withdrawn status excludes answer evidence")
      ow.test.assert(wm.open("older.md").headings.length>0,true,"trusted navigation can inspect retired pages independently of answer evidence")
    }finally{if(snapshot)wm._retrievalV2.release(snapshot);if(wm)wm.close();io.rm(dir)}
  }
  exports.testGroundedApplicabilityDisagreements = function() {
    var dir = temporary(), wm
    try {
      wm = make(dir)
      wm.write("old.md", { title: "Old guide", updated: "2030-01-01", applicability: { product: "mini-a", version: "release-A" }, status: "review", authority: "release engineering", verified: "2026-09-15", source_ref: "release-A", ingested: "2026-09-15T00:00:00Z" }, "# Default\nclaimsetting has limit ten for release-A.")
      wm.write("new.md", { title: "New guide", updated: "2000-01-01", applicability: { product: "mini-a", version: "release-B" } }, "# Default\nclaimsetting has limit twenty for release-B.")
      wm.write("bounded.md", {title:"Effective guide", validity:{from:"2024-02-29",until:"2024-03-01"}}, "# Guidance\nvaliditymarker dated instruction")
      wm.write("unknown.md", {title:"Undated guide"}, "# Guidance\nvaliditymarker unknown instruction")
      wm.write("invalid-date.md", {title:"Malformed guide", validity:{from:"2024-02-30"}}, "# Guidance\nvaliditymarker malformed instruction")
      wm.reindex()
      var datedOptions={applicability:{validAt:"2024-02-29"},chunks:2}, originalOptions=stringify(datedOptions)
      var dated=wm.retrieve("validitymarker",datedOptions)
      ow.test.assert(dated.evidence.length,1,"explicit validity excludes unknown and malformed date metadata")
      ow.test.assert(dated.evidence[0].path,"bounded.md","leap-day validity selects exact applicable evidence")
      ow.test.assert(dated.evidence[0].validity.until,"2024-03-01","trusted evidence exposes explicit validity without verification inference")
      ow.test.assert(stringify(datedOptions),originalOptions,"captured request evaluation time never mutates caller options")
      ow.test.assert(wm.retrieve("validitymarker",{applicability:{validAt:"2024-03-01"}}).evidence.length,1,"validity end date is inclusive in UTC")
      ow.test.assert(wm.retrieve("validitymarker",{applicability:{validAt:"2024-03-02"}}).evidence.length,0,"expired evidence is filtered for explicit applicability")
      ow.test.assert(wm.retrieve("validitymarker",{applicability:{validAt:"2024-02-30"}}).error,"invalid-applicability","invalid calendar dates are rejected before discovery")
      var current=wm.retrieve("validitymarker",{})
      ow.test.assert(current.evidence.length,1,"current evaluation excludes expired and malformed records while missing validity remains unknown")
      ow.test.assert(current.evidence[0].path,"unknown.md","undated foundational content is not demoted for editorial age")
      loadLib("mini-a-mcp-wiki.js")
      var trustedTool=__miniAMcpWikiCreateTool({root:dir,access:"ro",agenticRetrieval:true},wm)
      var trusted=trustedTool.wiki({operation:"search",query:"validitymarker",applicability:{validAt:"2024-02-29"}})
      ow.test.assert(trusted.results.length,1,"trusted utility adapter preserves validity applicability")
      ow.test.assert(trusted.results[0].path,"bounded.md","trusted search returns applicable current page")
      ow.test.assert(trustedTool.wiki({operation:"search",query:"validitymarker",applicability:{validAt:"invalid"}}).error,"invalid-applicability","trusted utility preserves explicit applicability errors")
      ow.test.assert(wm.agenticSearch("validitymarker",{regex:true,applicability:{validAt:"2024-02-29"}}).error,"applicability-indexed-search-required","explicit scans cannot silently discard applicability")
      var trustedJob=io.readFileYAML("mcps/mcp-wiki.yaml"), searchJob=trustedJob.jobs.filter(function(j){return j.name==="Wiki search pages"})[0], savedTool=global.__wikiTool
      try {
        global.__wikiTool=trustedTool
        var standalone=new Function("args",searchJob.exec)({query:"validitymarker",limit:20,contextLines:0,applicability:{validAt:"2024-02-29"}})
        ow.test.assert(standalone.results.length,1,"actual standalone MCP job forwards applicability")
        ow.test.assert(standalone.results[0].path,"bounded.md","standalone job retains the applicable page identity")
      } finally {global.__wikiTool=savedTool}
      var coreSource=io.readFileString("mini-a.js")
      ;["wk","cbWk"].forEach(function(prefix) {
        var paramsName=prefix+"Params", pathName=prefix+"Path", queryName=prefix+"Query", optsName=prefix+"SearchOpts"
        var mapping=new RegExp("var "+optsName+" = (\\{[\\s\\S]*?\\n\\s*\\})").exec(coreSource)
        ow.test.assert(mapping!==null,true,"core search mapping located: "+prefix)
        var params={wiki:"primary",applicability:{version:"release-A"},maxQueries:1,maxCandidates:4,maxInspected:4,maxBytes:12000,maxMillis:10000}
        var options=new Function(paramsName,pathName,"return "+mapping[1])(params,"")
        var search=wm.agenticSearch("claimsetting",options)
        ow.test.assert(search.results[0].path,"old.md","actual core mapping selects applicable current page: "+prefix)
        ow.test.assert(search.budget.limits.maxQueries,1,"core search preserves query budget: "+prefix)
        ow.test.assert(search.budget.limits.maxCandidates,4,"core search preserves candidate budget: "+prefix)
        ow.test.assert(search.budget.limits.maxBytes,12000,"core search preserves byte budget: "+prefix)
        var retrieval=new RegExp("this\\._wikiManager\\.retrieve\\(("+queryName+",[^\\n]+)\\)\\)").exec(coreSource)
        ow.test.assert(retrieval!==null,true,"core retrieve mapping located: "+prefix)
        var retrieved=new Function(queryName,paramsName,"return this._wikiManager.retrieve("+retrieval[1]+")").call({_wikiManager:wm},"claimsetting",params)
        ow.test.assert(retrieved.evidence[0].path,"old.md","actual retrieve mapping retains applicability: "+prefix)
        ow.test.assert(retrieved.budget.limits.maxQueries,1,"core retrieve preserves query budget: "+prefix)
        ow.test.assert(retrieved.budget.limits.maxBytes,12000,"core retrieve preserves byte budget: "+prefix)
      })
      var boundedUtility=trustedTool.wiki({operation:"search",query:"claimsetting",wiki:"primary",applicability:{version:"release-A"},maxQueries:1,maxCandidates:4,maxBytes:12000})
      ow.test.assert(boundedUtility.budget.limits.maxQueries,1,"shared utility search retains request query budget")
      ow.test.assert(boundedUtility.budget.limits.maxCandidates,4,"shared utility search retains request candidate budget")
      var savedEngine=wm._retrievalV2
      try {wm._retrievalV2=null;ow.test.assert(trustedTool.wiki({operation:"search",query:"validitymarker",applicability:{version:"release-A"}}).error,"applicability-requires-v2","feature-off adapter never silently claims unsupported filtering")}finally{wm._retrievalV2=savedEngine}
      var old = wm.retrieve("claimsetting", { applicability: { version: "release-A" }, chunks: 1 }).evidence[0]
      var recent = wm.retrieve("claimsetting", { applicability: { version: "release-B" }, chunks: 1 }).evidence[0]
      ow.test.assert(recent.path, "new.md", "explicit release applicability wins over editorial timestamp")
      ow.test.assert(recent.applicability.version, "release-B", "evidence carries explicit applicability without trust inference")
      ow.test.assert(old.provenance.reviewStatus, "review", "trusted evidence exposes an explicit review status without inferring stability")
      ow.test.assert(old.provenance.authority, "release engineering", "trusted evidence carries declared authority separately from rank")
      ow.test.assert(old.provenance.verificationDate, "2026-09-15", "trusted evidence carries declared verification date without treating updated as verification")
      ow.test.assert(old.provenance.sourceRevision, "release-A", "trusted evidence carries an explicit source revision")
      ow.test.assert(wm.knowledgeRecordDerivative("fact", "old-limit", { claimKey: "default-limit", value: 10, applicability: old.applicability }, [old.passage]).ok, true, "operator grounds old version claim")
      ow.test.assert(wm.knowledgeRecordDerivative("fact", "new-limit", { claimKey: "default-limit", value: 20, applicability: recent.applicability }, [recent.passage]).ok, true, "operator grounds new version claim")
      ow.test.assert(wm.knowledgeRecordDerivative("fact", "linux-limit", { claimKey: "platform-limit", value: 1, applicability: { product: "mini-a", platform: "linux" } }, [old.passage]).ok, true, "Linux guidance has a grounded support")
      ow.test.assert(wm.knowledgeRecordDerivative("fact", "mac-limit", { claimKey: "platform-limit", value: 2, applicability: { product: "mini-a", platform: "macos" } }, [recent.passage]).ok, true, "macOS guidance has a grounded support")
      var claimIndex = wm.knowledgeLoadState().derivativeRegistry.byClaim
      ow.test.assert(claimIndex["$default-limit"].length, 2, "claim peers are posted for targeted maintenance")
      var before = io.readFileString(wm._knowledgeStatePath()), report = wm._retrievalV2.maintenance({ limit: 5 })
      ow.test.assert(report.conflicts.candidates.length, 1, "bounded report identifies different recorded guidance")
      var conflict = report.conflicts.candidates[0]
      ow.test.assert(conflict.kind, "version-guidance-divergence", "different versions not mislabeled as simultaneous contradiction")
      ow.test.assert(conflict.applicabilityOverlap, "different-versions", "exact version strings need no semantic-version assumption")
      ow.test.assert(conflict.evidence.length, 2, "reviewable disagreement has identifiable revision-bound evidence")
      ow.test.assert(conflict.resolution, "not-automated", "report does not choose source truth")
      ow.test.assert(io.readFileString(wm._knowledgeStatePath()), before, "conflict proposal writes no derivative authority")
      ow.test.assert(wm.knowledgeConflictCandidates({ paths: ["old.md"] }).candidates.length, 1, "affected support finds a claim peer through the dependency posting")
      ow.test.assert(wm.knowledgeConflictCandidates({ paths: ["new.md"] }).candidates.length, 1, "either affected side reaches the same claim peer")
      wm.delete("old.md")
      ow.test.assert(wm.knowledgeConflictCandidates({ limit: 5 }).candidates.length, 0, "retired evidence cannot ground current conflict")
    } finally { if (wm) wm.close(); io.rm(dir) }
  }
  exports.testTargetedTelemetryRetention = function() {
    var dir = temporary(), wm
    try {
      wm = make(dir, { wikitelemetry: true, wikiretrievalconfig: { telemetryFlushQueries: 1, telemetryRetentionDays: 1, telemetrySampleQueries: true } })
      wm.write("page.md", { title: "Page" }, "# Page\nknownparameter is documented."); wm.reindex()
      wm.knowledgeSaveState(wm.knowledgeLoadState())
      var before = io.readFileString(wm._knowledgeStatePath())
      wm.agenticSearch("missingcoverageparameter"); wm.agenticSearch("missingcoverageparameter")
      var report = wm._retrievalV2.maintenance({ limit: 5 })
      ow.test.assert(report.knowledgeWeaknesses.length, 1, "explicit sampling proposes repeated zero-result weakness")
      ow.test.assert(report.knowledgeWeaknesses[0].query, "missingcoverageparameter", "bounded question sample actionable for alias/coverage review")
      ow.test.assert(report.modelCalls, 0, "targeted report invokes no LLM")
      ow.test.assert(io.readFileString(wm._knowledgeStatePath()), before, "query telemetry never modifies knowledge authority")
      var telemetryPath = dir + "/.mini-a-wiki-state/telemetry.json", stored = af.fromJson(io.readFileString(telemetryPath))
      ow.test.assert(stored.query_samples.length, 1, "samples persisted separately and explicitly")
      ow.test.assert(stored.selected_records, 0, "zero-result telemetry records no selected evidence")
      ow.test.assert(stored.output_bytes > 0, true, "telemetry counts serialized output including envelope")
      ow.test.assert(stored.stage_counts.search, 2, "telemetry counts actual executed search stages")
      ow.test.assert(isDef(stored.stage_counts.rank), false, "zero-result telemetry does not invent ranking stages")
      ow.test.assert(stored.stage_millis.search >= 0, true, "bounded measured search durations aggregate separately")
      ow.test.assert(stored.stage_millis.rank, 0, "zero-result telemetry performs no rank work")
      wm._retrievalV2.config.telemetrySampleQueries = false
      wm.agenticSearch("anothermissingparameter")
      ow.test.assert(isDef(af.fromJson(io.readFileString(telemetryPath)).query_samples), false, "disabled/default sampling removes question samples on next flush")
      ow.test.assert(wm._retrievalV2.maintenance().knowledgeWeaknesses.length, 0, "disabled sampling discloses no private questions")
      wm._retrievalV2.config.telemetrySampleQueries = true; wm._retrievalV2.telemetry.started = "1970-01-01T00:00:00Z"
      wm.agenticSearch("newwindowquestion")
      stored = af.fromJson(io.readFileString(telemetryPath))
      ow.test.assert(stored.searches, 1, "retention rolls over during continued activity")
      ow.test.assert(stored.query_samples.length, 1, "old samples do not survive retention rollover")
      ow.test.assert(stored.query_samples[0].query, "newwindowquestion", "new retention window contains only new sample")
      var query=wm._retrievalV2._query, totalBefore=stored.total_millis, queriesBefore=stored.request_work.queries
      try {
        wm._retrievalV2._query=function(){java.lang.Thread.sleep(40);throw new Error("injected slow backend failure")}
        var slow=wm.agenticSearch("knownparameter",{maxMillis:10})
        stored=af.fromJson(io.readFileString(telemetryPath))
        ow.test.assert(slow.outcome,"partial","non-preemptible delayed failure reports incomplete retrieval")
        ow.test.assert(slow.timings.clock,"monotonic-System.nanoTime","duration diagnostics identify monotonic estimator")
        ow.test.assert(slow.timings.measured.search>=35,true,"stage latency measures actual delayed attempt")
        ow.test.assert(stored.total_millis-totalBefore>=35,true,"total latency is not capped at requested deadline")
        ow.test.assert(stored.request_work.queries-queriesBefore,1,"request work aggregates charged failed attempts")
        ow.test.assert(io.readFileString(wm._knowledgeStatePath()),before,"latency and work telemetry remain separate from authority")
      } finally {wm._retrievalV2._query=query}
      var workBefore=stored.request_work.queries
      var tooSmall=wm.agenticSearch("knownparameter",{maxBytes:1})
      stored=af.fromJson(io.readFileString(telemetryPath))
      ow.test.assert(tooSmall.error,"output-budget-too-small","minimal output cannot accommodate trusted response envelope")
      ow.test.assert(stored.request_work.queries-workBefore,1,"slim budget-error adapter cannot discard privately accounted query work")
      var empty=wm.retrieve("trulyabsentparameter")
      ow.test.assert(empty.timings.measured.citationDecoration,0,"empty retrieval performs no citation decoration")
      ow.test.assert(empty.stages.indexOf("cite"),-1,"empty retrieval does not advertise a citation stage")
      var originalPack=wm._retrievalV2._packEvidence
      stored=af.fromJson(io.readFileString(telemetryPath))
      var packingBefore=stored.stage_millis.envelopePacking, packedBefore=stored.stage_counts.envelopePacking
      try {
        wm._retrievalV2._packEvidence=function(){java.lang.Thread.sleep(35);return originalPack.apply(this,arguments)}
        var packed=wm.retrieve("knownparameter",{maxMillis:1000})
        stored=af.fromJson(io.readFileString(telemetryPath))
        ow.test.assert(packed.evidence.length,1,"timed final packing retains selected evidence")
        ow.test.assert(stored.stage_millis.envelopePacking-packingBefore>=30,true,"private final-packing duration measures actual work")
        ow.test.assert(stored.stage_counts.envelopePacking,packedBefore+1,"private telemetry counts only executed packing passes")
        ow.test.assert(isDef(packed.timings.measured.envelopePacking),false,"post-serialization packing timing does not mutate the budgeted public response")
        ow.test.assert(isDef(packed.envelopePackingExecuted),false,"private packing execution marker is never added to the public response")
        ow.test.assert(global.MiniAWikiRetrievalV2.bytes(stringify(packed,__,""))<=packed.budget.limits.maxBytes,true,"completed timing does not grow the response beyond its byte cap")
        var packingFailure=wm.retrieve("knownparameter",{maxMillis:1000,maxBytes:1})
        stored=af.fromJson(io.readFileString(telemetryPath))
        ow.test.assert(packingFailure.error,"output-budget-too-small","final-packing failure uses the existing slim error adapter")
        ow.test.assert(stored.stage_counts.envelopePacking,packedBefore+2,"failed output packing retains its private execution count")
        ow.test.assert(stored.stage_millis.envelopePacking-packingBefore>=60,true,"failed output packing retains actual elapsed duration")
      } finally {wm._retrievalV2._packEvidence=originalPack}
      var originalClip=wm._retrievalV2._clipEvidence
      try {
        wm._retrievalV2._clipEvidence=function(){java.lang.Thread.sleep(35);return originalClip.apply(this,arguments)}
        var timed=wm.retrieve("knownparameter",{maxMillis:1000})
        stored=af.fromJson(io.readFileString(telemetryPath))
        ow.test.assert(timed.evidence.length,1,"timed citation preserves selected evidence")
        ow.test.assert(timed.timings.measured.citationDecoration>=30,true,"citation timing measures actual decoration work")
        ow.test.assert(timed.timings.measured.evidenceSelection>=30,true,"inclusive evidence-selection timing measures nested citation work")
        ow.test.assert(stored.stage_millis.citationDecoration>=30,true,"citation duration persists in private telemetry")
        ow.test.assert(stored.stage_millis.evidenceSelection>=30,true,"evidence selection duration persists in private telemetry")
        ow.test.assert(timed.stages.indexOf("cite")>=0,true,"actual citation work is advertised")
        ow.test.assert(timed.stages.indexOf("select")<timed.stages.indexOf("cite"),true,"stage order places selection before citation decoration")
        ow.test.assert(global.MiniAWikiRetrievalV2.bytes(stringify(timed,__,""))<=timed.budget.limits.maxBytes,true,"timing diagnostics remain inside output byte budget")
      } finally {wm._retrievalV2._clipEvidence=originalClip}
      var suppressed=wm._retrievalV2.search("knownparameter",{__wikiSuppressSource:true})
      ow.test.assert(suppressed.timings.measured.citationDecoration,0,"source-suppressed search performs no citation decoration")
      ow.test.assert(suppressed.stages.indexOf("cite"),-1,"source-suppressed search does not advertise citation work")
      var decorated=wm._retrievalV2.search("knownparameter")
      ow.test.assert(decorated.timings.measured.citationDecoration>0,true,"trusted compact search measures its actual decoration calls")
      var assembled=wm.assembleContext("knownparameter")
      ow.test.assert(assembled.timings.clock,"monotonic-System.nanoTime","assembled context retains shared engine timing diagnostics")
      ow.test.assert(assembled.timings.measured.evidenceSelection>=0,true,"assembled context uses measured shared evidence selector")
      var searchPack=wm._retrievalV2._packSearch, presentContext=wm._retrievalV2._presentContext
      try {
        stored=af.fromJson(io.readFileString(telemetryPath))
        var searchPackingBefore=stored.stage_millis.envelopePacking
        wm._retrievalV2._packSearch=function(){java.lang.Thread.sleep(35);return searchPack.apply(this,arguments)}
        var packedSearch=wm._retrievalV2.search("knownparameter",{__wikiSuppressSource:true})
        stored=af.fromJson(io.readFileString(telemetryPath))
        ow.test.assert(stored.stage_millis.envelopePacking-searchPackingBefore>=30,true,"compact-search packing records actual private elapsed time")
        ow.test.assert(packedSearch.budget.used.bytes,global.MiniAWikiRetrievalV2.bytes(stringify(packedSearch,__,"")),"compact-search byte accounting converges on the final complete envelope")
        ow.test.assert(isDef(packedSearch.timings.measured.envelopePacking),false,"private compact-search packing duration does not change public output after serialization")
        var searchesBeforeContext=stored.searches, recordsBeforeContext=stored.selected_records, bytesBeforeContext=stored.output_bytes, partialBeforeContext=stored.partial_results
        wm._retrievalV2._presentContext=function(){java.lang.Thread.sleep(35);return presentContext.apply(this,arguments)}
        var measuredContext=wm.assembleContext("knownparameter")
        stored=af.fromJson(io.readFileString(telemetryPath))
        ow.test.assert(measuredContext.chunks.length,1,"timed context adapter returns the shared selected evidence")
        ow.test.assert(stored.searches,searchesBeforeContext+1,"assembled-context presentation is counted as one retrieval request")
        ow.test.assert(stored.selected_records-recordsBeforeContext,measuredContext.chunks.length,"context telemetry counts returned evidence chunks")
        ow.test.assert(stored.output_bytes-bytesBeforeContext,global.MiniAWikiRetrievalV2.bytes(stringify(measuredContext,__,"")),"context telemetry records the final context envelope rather than an intermediate retrieve response")
        ow.test.assert(stored.partial_results,partialBeforeContext,"successful context without an ok field is not misclassified as a failed search")
        ow.test.assert(stored.stage_counts.contextPresentation>=1,true,"private telemetry counts context presentation separately")
        ow.test.assert(stored.stage_millis.contextPresentation>=30,true,"context presentation records actual private elapsed duration")
        ow.test.assert(isDef(measuredContext.timings.measured.contextPresentation),false,"context presentation duration never changes the checked response envelope")
        ow.test.assert(measuredContext.requestBudget.used.estimatedTokens,measuredContext.estimatedTokens,"context request token accounting reflects the final presentation envelope")
      } finally {wm._retrievalV2._packSearch=searchPack;wm._retrievalV2._presentContext=presentContext}
      ow.test.assert(io.readFileString(wm._knowledgeStatePath()),before,"evidence-stage telemetry never modifies authority")
      stored=af.fromJson(io.readFileString(telemetryPath))
      var searchesBeforeEvents=stored.searches
      ow.test.assert(wm.agenticRead("page.md",{revision:new Array(41).join("a")}).error,"stale-reference","stale read revision explicitly restarts")
      var grepStart=wm.grep("page.md","knownparameter",{maxChars:5})
      ow.test.assert(isMap(grepStart.next.cursor),true,"fragment grep supplies a bound continuation")
      ow.test.assert(wm.grep("page.md","differentpattern",grepStart.next).error,"stale-reference","changed grep selection rejects its old cursor")
      stored=af.fromJson(io.readFileString(telemetryPath))
      ow.test.assert(stored.events.stale_reference_restarts,2,"read and grep restarts persist bounded event counts")
      ow.test.assert(stored.searches,searchesBeforeEvents,"cursor restarts are not counted as searches")
      wm._retrievalV2.telemetry.started="1970-01-01T00:00:00Z"
      wm.agenticRead("page.md",{revision:new Array(41).join("c")})
      stored=af.fromJson(io.readFileString(telemetryPath))
      ow.test.assert(stored.events.stale_reference_restarts,1,"event-only activity rolls the shared retention window")
      ow.test.assert(stored.searches,0,"event-only retention rollover does not manufacture searches")
      var readonlyEvents=make(dir,{access:"ro",wikitelemetry:true}), beforeReadonlyEvents=io.readFileString(telemetryPath)
      try {
        ow.test.assert(readonlyEvents.agenticRead("page.md",{revision:new Array(41).join("d")}).error,"stale-reference","read-only reader still rejects stale references")
      } finally {readonlyEvents.close()}
      ow.test.assert(io.readFileString(telemetryPath),beforeReadonlyEvents,"read-only event handling never persists telemetry")
      var eventQuery=wm._retrievalV2._query
      try {
        wm._retrievalV2._query=function(){throw new Error("generation-index-text-mismatch")}
        ow.test.assert(wm.agenticSearch("knownparameter").outcome,"partial","generation mismatch remains an incomplete search")
        stored=af.fromJson(io.readFileString(telemetryPath))
        ow.test.assert(stored.events.generation_mismatch_requests,1,"generation mismatch records one request event")
      } finally {wm._retrievalV2._query=eventQuery}
      var eventActive=wm._retrievalV2._active
      try {
        wm._retrievalV2._active=function(){return false}
        ow.test.assert(wm.agenticSearch("knownparameter").results.length,0,"inactive evidence stays undisclosed")
        stored=af.fromJson(io.readFileString(telemetryPath))
        ow.test.assert(stored.events.evidence_rejected_requests,1,"composite inactive evidence records rejection without inventing a revision mismatch")
        ow.test.assert(isDef(stored.events.revision_mismatch_requests),false,"unknown rejection cause is not called a proven revision mismatch")
      } finally {wm._retrievalV2._active=eventActive}
      wm._retrievalV2._recordEvent("unbounded-private-event-name")
      stored=af.fromJson(io.readFileString(telemetryPath))
      ow.test.assert(isDef(stored.events["unbounded-private-event-name"]),false,"event names use a fixed bounded vocabulary")
      ow.test.assert(io.readFileString(wm._knowledgeStatePath()),before,"event telemetry never modifies knowledge authority")
      var backendWork={backendReadCalls:2,backendExistsCalls:3,backendReadBytes:17,backendReadMillis:35,backendExistsMillis:5,backendFailures:1}
      wm._retrievalV2._recordTelemetry({ok:true,outcome:"partial"},0,40,{budget:{used:backendWork}})
      stored=af.fromJson(io.readFileString(telemetryPath))
      Object.keys(backendWork).forEach(function(key){ow.test.assert(stored.request_work[key],backendWork[key],"backend request telemetry persists charged "+key)})
      ow.test.assert(io.readFileString(wm._knowledgeStatePath()),before,"backend work telemetry never modifies authority")
      var engine = wm._retrievalV2, originalAtomic = engine._atomic, originalLog = wm._logFn
      try {
        engine._atomic = function() { throw "injected telemetry persistence failure" }
        wm._logFn = function() { throw "injected logger failure" }
        var result = wm.agenticSearch("knownparameter")
        ow.test.assert(result.ok, true, "telemetry and logger failures cannot fail retrieval")
        ow.test.assert(result.results.length, 1, "telemetry failure preserves evidence")
        ow.test.assert(wm.agenticRead("page.md",{revision:new Array(41).join("b")}).error,"stale-reference","event persistence and logger failures cannot fail stale-reference handling")
        ow.test.assert(io.readFileString(wm._knowledgeStatePath()), before, "failed telemetry never rewrites authority")
        ow.test.assert(engine.telemetryPending > 0, true, "failed persistence retains bounded aggregate for retry")
      } finally { engine._atomic = originalAtomic; wm._logFn = originalLog }
    } finally { if (wm) wm.close(); io.rm(dir) }
  }
  exports.testArchiveServingAndTruncatedBundle = function() {
    var dir = temporary(), wm, reader, writerZip, inputZip
    try {
      io.mkdir(dir + "/source"); io.mkdir(dir + "/cache")
      wm = make(dir + "/source"); wm.write("answer.md", { title: "Archive" }, "# Archive\narchiveparameter is preserved."); wm.reindex()
      var bundle = dir + "/bundle.zip", archive = dir + "/wiki.zip"
      wm._retrievalV2.exportBundle(bundle)
      writerZip = new java.util.zip.ZipOutputStream(new java.io.FileOutputStream(archive)); inputZip = new java.util.zip.ZipInputStream(new java.io.FileInputStream(bundle))
      var entry, buffer = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE,65536), n
      while ((entry = inputZip.getNextEntry()) !== null) { writerZip.putNextEntry(new java.util.zip.ZipEntry(String(entry.getName()))); while ((n = inputZip.read(buffer)) !== -1) writerZip.write(buffer,0,n); writerZip.closeEntry(); inputZip.closeEntry() }
      inputZip.close(); inputZip = __
      writerZip.putNextEntry(new java.util.zip.ZipEntry("answer.md")); writerZip.write(new java.lang.String(wm.read("answer.md").raw).getBytes("UTF-8")); writerZip.closeEntry(); writerZip.close(); writerZip = __
      var originalDigest = global.MiniAWikiRetrievalV2.digest(archive)
      reader = make(archive, { access: "ro", indexdir: dir + "/cache" })
      ow.test.assert(reader.agenticSearch("archiveparameter").results.length, 1, "archive hydrates explicit compatible cache under OpenAF")
      ow.test.assert(reader.retrieve("archiveparameter").evidence[0].content.indexOf("archiveparameter") >= 0, true, "archive exact raw source revision grounds quotation")
      ow.test.assert(reader.list("").join(","), "answer.md", "serving block Markdown never appears as extra archive pages")
      ow.test.assert(global.MiniAWikiRetrievalV2.digest(archive), originalDigest, "archive source never modified by hydration/read")
      var pointerPath = dir + "/cache/.mini-a-wiki-bundles/current.json", before = io.readFileString(pointerPath), truncated = dir + "/truncated.zip"
      java.nio.file.Files.copy(new java.io.File(bundle).toPath(), new java.io.File(truncated).toPath())
      var file = new java.io.RandomAccessFile(truncated,"rw"); file.setLength(file.length()-22); file.close()
      ow.test.assert(reader._hydrateArtifactBundle(function(){return {etag:"truncated"}},function(){return new java.io.FileInputStream(truncated)},"test","truncated.zip"), false, "missing central directory rejected before activation")
      ow.test.assert(io.readFileString(pointerPath), before, "truncated download retains prior working generation")
      var enginePointer = reader._retrievalV2.root + "/current.json", pinned = reader._retrievalV2.acquire(), original = io.readFileString(enginePointer), value = af.fromJson(original)
      reader._retrievalV2.release(pinned); value.checksum = new Array(65).join("0"); io.writeFileString(enginePointer,stringify(value,__,""))
      ow.test.assert(reader.agenticSearch("archiveparameter").sources[0].reason, "generation-checksum-mismatch", "warm reader rejects changed checksum under same generation identity")
      io.writeFileString(enginePointer,original)
    } finally { if (inputZip) inputZip.close(); if (writerZip) writerZip.close(); if (reader) reader.close(); if (wm) wm.close(); io.rm(dir) }
  }
  exports.testLegacyResetPublicationPreservesGeneration = function() {
    var dir = temporary(), wm, reader, directory, pinned
    try {
      wm = make(dir, { wikiretrievalv2: false }); wm.write("page.md", { title: "Page" }, "# Page\nlegacyresetparameter is committed."); wm.reindex()
      reader = make(dir, { access: "ro", wikiretrievalv2: false })
      var previous = wm._getLuceneIndexPath(), L = Packages.org.apache.lucene
      directory = L.store.FSDirectory.open(java.nio.file.Paths.get(previous)); pinned = L.index.DirectoryReader.open(directory)
      wm._beforeLegacyActivate = function() { throw new Error("injected legacy activation failure") }
      var docs = [{ path: "page.md", title: "Page", raw: wm.read("page.md").raw }]
      ow.test.assert(wm._rebuildLuceneIndex(docs, { resetLucene: true }).ok, false, "failed reset activation reported")
      ow.test.assert(wm._getLuceneIndexPath(), previous, "failed reset does not change current index path")
      ow.test.assert(reader._luceneQueryReadOnly("legacyresetparameter", 5)[0].id, "page.md", "legacy index remains usable after failed reset")
      delete wm._beforeLegacyActivate
      ow.test.assert(wm._rebuildLuceneIndex(docs, { resetLucene: true }).ok, true, "validated reset activates immutable index generation")
      ow.test.assert(wm._getLuceneIndexPath() !== previous, true, "reset publishes new directory instead of destructive replacement")
      ow.test.assert(new L.search.IndexSearcher(pinned).search(new L.search.MatchAllDocsQuery(), 1).scoreDocs.length > 0, true, "in-flight old reader stays open across activation")
      ow.test.assert(io.fileExists(previous), true, "prior usable legacy generation retained for rollback")
      ow.test.assert(reader._luceneQueryReadOnly("legacyresetparameter", 5)[0].id, "page.md", "subsequent legacy reader sees activated generation")
    } finally { if (pinned) pinned.close(); if (directory) directory.close(); if (reader) reader.close(); if (wm) wm.close(); io.rm(dir) }
  }
  exports.testEvidenceWindowsAndRelevancePacking = function() {
    var dir = temporary(), wm
    try {
      wm=make(dir,{wikiretrievalconfig:{passageChars:16000},wikisourceurl:"https://docs.example/{{path}}#L{{startLine}}-L{{endLine}}"})
      wm.write("large.md",{title:"Long reference"},"# Introduction\n"+new Array(250).join("Background without the setting.\n")+"\n# Answer\nwindowparameter has the exact required answer.")
      wm.reindex()
      var result=wm.retrieve("windowparameter",{chunks:1,maxBytes:4000}), evidence=result.evidence[0],raw=wm.read("large.md").raw
      ow.test.assert(evidence.content.indexOf("windowparameter")>=0,true,"output clipping retains query-relevant text")
      ow.test.assert(raw.substring(evidence.charStart,evidence.charEnd),evidence.content,"query-centred clipped quote matches raw range")
      ow.test.assert(evidence.lineStart,raw.substring(0,evidence.charStart).split("\n").length,"clipped raw frontmatter line offset accurate")
      ow.test.assert(evidence.citation.endsWith("#L"+evidence.lineStart+"-L"+evidence.lineEnd),true,"citation template uses final selected range")
      var context=wm.assembleContext("windowparameter",{chunks:1,maxBytes:5000})
      ow.test.assert(isString(context.chunks[0].text),true,"shared assembled evidence retains text under two-argument merge")
      ow.test.assert(raw.substring(context.chunks[0].charStart,context.chunks[0].charEnd),context.chunks[0].text,"assembled quote uses same revision/range contract")
      wm.write("strong.md",{title:"concentrationparameter"},"# First\nconcentrationparameter alpha guidance.\n\n# Second\nconcentrationparameter beta guidance.")
      wm.write("weak.md",{title:"Related"},"# Related\nconcentrationparameter is mentioned.")
      var packed=wm.retrieve("concentrationparameter",{chunks:2})
      ow.test.assert(packed.evidence.map(function(e){return e.path}).join(","),"strong.md,strong.md","relevance wins over forced equal page representation")
      ow.test.assert(isNumber(packed.evidence[1].selectionComponents.utility),true,"actual marginal selection contributions inspectable")
    } finally {if(wm)wm.close();io.rm(dir)}
  }
  exports.testIngestBatchAndDeferredExport = function() {
    var dir = temporary(), wm
    try {
      wm = make(dir)
      wm.write("first.md", {title:"First"}, "# First\ninitialbatchparameter")
      ow.test.assert(wm.reindex().ok, true, "initial serving generation built")
      var original = wm._retrievalV2.build, builds = 0
      wm._retrievalV2.build = function(paths) { builds++; return original.call(this, paths) }
      wm._servingBatchChanges = {}
      wm.write("first.md", {title:"First"}, "# First\nupdatedbatchparameter")
      wm.write("second.md", {title:"Second"}, "# Second\nsecondbatchparameter")
      ow.test.assert(builds, 0, "journal-scoped writes defer passage publication")
      ow.test.assert(Object.keys(wm._servingBatchChanges).sort().join(","), "first.md,second.md", "affected pages tracked directly")
      wm._retrievalV2.config.bundlePath = dir + "/published.zip"
      var pending = true
      wm._knowledgeJournalPending = function() { return pending }
      var publication = wm.reindex()
      ow.test.assert(publication.ok, true, "local journal finalization succeeds with deferred export")
      ow.test.assert(builds, 1, "affected pages published in one batch")
      ow.test.assert(publication.bundle.deferred, true, "pending journal cannot export unsuppressed remote evidence")
      ow.test.assert(io.fileExists(dir + "/published.zip"), false, "no bundle written before completion")
      ow.test.assert(wm._retrievalV2.exportBundle(dir + "/published.zip").error, "ingest-pending", "explicit export also denies pending journal")
      pending = false
      var readerOpens = wm._retrievalV2.metrics.readerOpens
      ow.test.assert(wm._retrievalV2.exportBundle(dir + "/published.zip").ok, true, "completed journal permits validated bundle export")
      ow.test.assert(wm._retrievalV2.metrics.readerOpens, readerOpens, "validated publication searcher reused for export without another reader open")
      global.__mini_a_ingest_lib_mode = true; load("mini-a-ingest.js")
      var ingester = new MiniAIngest({}, function() {}), previousBatch = wm._servingBatchChanges, rejected = false
      try { ingester._applyJournal(wm, {}, dir + "/bad-journal.json", {}) } catch(badJournal) { rejected = true }
      ow.test.assert(rejected, true, "malformed journal rejected before page application")
      ow.test.assert(wm._servingBatchChanges === previousBatch, true, "failed batch setup restores manager scope")
      wm._servingBatchChanges = __
    } finally { if (wm) wm.close(); io.rm(dir) }
  }
  exports.testStandaloneMcpRuntimeCompilation = function() {
    ["mcp-wiki.yaml", "mcp-wiki-safe.yaml", "mcp-wiki-ops.yaml", "mcp-skills.yaml", "mcp-skills-safe.yaml"].forEach(function(name) {
      var job = io.readFileYAML("mcps/" + name), compiled = 0
      job.jobs.forEach(function(entry) {
        if (isString(entry.exec)) { new Function("args", entry.exec); compiled++ }
      })
      ow.test.assert(compiled > 0, true, "standalone " + name + " job bodies compile in OpenAF")
      if (name === "mcp-wiki.yaml") {
        var jobNames = job.jobs.map(function(entry){return entry.name}), mappings = io.readFileString("mcps/"+name), mapped = /^      [a-z]+\s*:\s*(Wiki[^\n]+)$/gm, mapping
        while ((mapping = mapped.exec(mappings)) !== null) ow.test.assert(jobNames.indexOf(mapping[1].trim()) >= 0,true,"advertised trusted tool resolves to job " + mapping[1].trim())
      }
    })
  }
  exports.testProcessCrashPublicationRecovery = function() {
    var dir = temporary(), wm, snapshot
    try {
      wm = make(dir)
      wm.write("answer.md", {title:"Crash answer"}, "# Answer\ncrashrecoveryparameter remains usable")
      ow.test.assert(wm.reindex().ok, true, "crash fixture serving generation built")
      snapshot = wm._retrievalV2.acquire()
      var pointer = io.readFileString(wm._retrievalV2.root + "/current.json")
      var checkpoints = ["staging-created", "writer-open", "writer-closed", "manifest-written", "artifacts-validated", "searcher-verified", "generation-synchronized", "pointer-written", "pointer-synchronized", "pointer-renamed", "activation-directory-synchronized", "pointer-activated"]
      checkpoints.forEach(function(step) {
        var script = dir + "/crash-" + step + ".js", log = dir + "/crash-" + step + ".log"
        var activated=["pointer-renamed","activation-directory-synchronized","pointer-activated"].indexOf(step)>=0
        var recoveryQuery=activated?"newlypublishedparameter":"crashrecoveryparameter"
        if(activated)io.writeFileString(dir+"/newly-published.md","# Published\nnewlypublishedparameter appears only in the activated generation.")
        var cfg = stringify({backend:"fs",root:String(dir),access:"rw",wikiretrievalv2:true,wikiretrievalconfig:{passageChars:256}}, __, "")
        io.writeFileString(script, 'load("mini-a-common.js");load("mini-a-wiki.js");var m=new MiniAWikiManager(' + cfg + ',function(){});m._retrievalV2._publicationFault=function(step){if(step===' + stringify(step) + ')java.lang.Runtime.getRuntime().halt(31)};m.reindex();java.lang.Runtime.getRuntime().halt(32)')
        var command = new java.util.ArrayList()
        command.add(String(getOpenAFPath()) + "/oaf"); command.add("-f"); command.add(script)
        var builder = new java.lang.ProcessBuilder(command)
        builder.directory(new java.io.File(String(java.lang.System.getProperty("user.dir"))))
        builder.redirectErrorStream(true); builder.redirectOutput(new java.io.File(log))
        var child = builder.start()
        if (!child.waitFor(20, java.util.concurrent.TimeUnit.SECONDS)) { child.destroyForcibly(); throw new Error("crash subprocess deadline: " + step) }
        ow.test.assert(Number(child.exitValue()), 31, "actual abrupt JVM halt at " + step + ": " + io.readFileString(log))
        var currentPointer=io.readFileString(wm._retrievalV2.root+"/current.json")
        if(activated)ow.test.assert(currentPointer!==pointer,true,"post-rename halt retains newly validated serving pointer: "+step)
        else ow.test.assert(currentPointer,pointer,"crash leaves active pointer intact at "+step)
        var recovery = dir + "/recover-" + step + ".js", recoveryLog = dir + "/recover-" + step + ".log"
        io.writeFileString(recovery, 'load("mini-a-common.js");load("mini-a-wiki.js");var m=new MiniAWikiManager(' + stringify({backend:"fs",root:String(dir),access:"ro",wikiretrievalv2:true,wikiretrievalconfig:{passageChars:256}}, __, "") + ',function(){});try{var r=m.retrieve('+stringify(recoveryQuery)+');if(!r.ok||!r.evidence.length)java.lang.System.exit(33)}finally{m.close()}java.lang.System.exit(0)')
        builder.command().set(2, recovery); builder.redirectOutput(new java.io.File(recoveryLog))
        var recovered = builder.start()
        if (!recovered.waitFor(20, java.util.concurrent.TimeUnit.SECONDS)) { recovered.destroyForcibly(); throw new Error("recovery subprocess deadline: " + step) }
        ow.test.assert(Number(recovered.exitValue()), 0, "fresh JVM retrieves active evidence after " + step + ": " + io.readFileString(recoveryLog))
        var restarted = make(dir, {access:"ro"})
        try { ow.test.assert(restarted.retrieve(recoveryQuery).evidence.length, 1, "fresh manager opens valid generation after " + step) } finally { restarted.close() }
      })
      ow.test.assert(Number(snapshot.reader.numDocs()),1,"old pinned generation excludes newly published page")
      ow.test.assert(Number(snapshot.reader.numDocs()) > 0, true, "reader pinned before crashes remains open")
    } finally { if(snapshot)wm._retrievalV2.release(snapshot); if(wm)wm.close(); io.rm(dir) }
  }
  exports.testStableSectionAndMoveIdentities = function() {
    var dir = temporary(), wm, pinned
    try {
      wm = make(dir)
      wm.write("original.md", {title:"Stable"}, "# Changed\ninitial material.\n\n# Stable\nidentityparameter answers the question.")
      ow.test.assert(wm.reindex().ok, true, "identity fixture built")
      pinned = wm._retrievalV2.acquire()
      var original = pinned.catalog.pages["original.md"], pageId = original.pageId
      var identity = original.passageIds.filter(function(id) { return pinned.catalog.passages[id].headingId === "stable" })[0]
      wm.write("original.md", {title:"Stable"}, "# Changed\nchanged editorial material.\n\n# Stable\nidentityparameter answers the question.")
      var current = wm._retrievalV2.acquire()
      try { ow.test.assert(current.catalog.pages["original.md"].passageIds.indexOf(identity) >= 0, true, "uniquely unchanged section keeps identity through preceding edits") } finally { wm._retrievalV2.release(current) }
      wm.write("example.md", {title:"Example"}, "# Example\n```md\n[old](original.md#stable)\n```")
      wm.write("unrelated.md", {title:"Unrelated"}, "# Unrelated\nno references here")
      var originalRead = wm._backend.read, unrelatedReads = 0
      wm._backend.read = function(path) { if(path === "unrelated.md")unrelatedReads++; return originalRead.call(this,path) }
      var moved = wm.move("original.md", "nested/moved.md", {leaveRedirect:true})
      ow.test.assert(unrelatedReads, 0, "derived move lookup avoids reading unrelated unchanged page bodies")
      ow.test.assert(wm.read("example.md").body.indexOf("nested/moved.md#stable") >= 0, true, "move still rewrites links inside examples")
      ow.test.assert(moved.link_discovery, "derived-with-changed-page-validation", "move reports actual direct lookup route")
      ow.test.assert(moved.ok, true, "explicit move publishes one consistent affected-page batch")
      current = wm._retrievalV2.acquire()
      try {
        ow.test.assert(isDef(current.catalog.pages["nested/moved.md"]),true,"moved target present in pinned current generation: "+stringify({generation:current.generation,publication:moved.servingPublication,pages:Object.keys(current.catalog.pages)}))
        ow.test.assert(current.catalog.pages["nested/moved.md"].pageId, pageId, "logical page identity survives explicit move")
        ow.test.assert(current.catalog.pages["nested/moved.md"].passageIds.indexOf(identity) >= 0, true, "unchanged evidence identity survives move")
        ow.test.assert(current.catalog.pages["original.md"].pageId === pageId, false, "redirect does not inherit moved page identity")
      } finally { wm._retrievalV2.release(current) }
      var result = wm.retrieve("identityparameter", {chunks:1})
      ow.test.assert(result.evidence[0].path, "nested/moved.md", "moved identity resolves only to current source")
      ow.test.assert(wm.reindex().ok, true, "full rebuild retains logical identities")
      current = wm._retrievalV2.acquire()
      try { ow.test.assert(current.catalog.pages["nested/moved.md"].pageId, pageId, "logical identity retained on subsequent explicit full rebuild") } finally { wm._retrievalV2.release(current) }
      ow.test.assert(isUnDef(wm._servingBatchChanges) && isUnDef(wm._servingMoveOrigins), true, "move scope restored after publication")
    } finally { if(pinned)wm._retrievalV2.release(pinned); if(wm)wm.close(); io.rm(dir) }
  }
  exports.testSchema3CatalogueDelta = function() {
    var dir = temporary(), wm, fresh
    try {
      wm = make(dir)
      wm.write("a.md", {title:"A"}, "# A\nschema3baseparameter")
      ow.test.assert(wm.reindex().ok, true, "schema-3 fixture has an immutable base")
      var base = wm._retrievalV2.acquire(); try { ow.test.assert(base.manifest.schema, 3, "initial local generation is a schema-3 depth-zero base"); ow.test.assert(base.manifest.catalogue.depth, 0, "schema-3 base has no predecessor depth") } finally { wm._retrievalV2.release(base) }
      wm.write("a.md", {title:"A"}, "# A\nschema3changedparameter")
      var changed = wm._lastServingUpdate, pin = wm._retrievalV2.acquire()
      try {
        ow.test.assert(changed.ok, true, "incremental publication succeeds")
        ow.test.assert(pin.manifest.schema, 3, "incremental publication uses a schema-3 delta")
        ow.test.assert(/^[a-f0-9]{64}$/.test(pin.manifest.merkle), true, "schema-3 manifest carries a Merkle root")
        ow.test.assert(pin.manifest.catalogue.stats.pageCount, 1, "schema-3 manifest exposes catalogue counts")
        ow.test.assert(pin.manifest.catalogue.schema, 3, "schema-3 manifest routes immutable catalogue shards")
        ow.test.assert(Object.keys(pin.manifest.catalogue.shards.pages).length > 0, true, "changed page is persisted in a routed shard")
        ow.test.assert(io.fileExists(pin.dir + "/" + pin.manifest.catalogue.shards.pages[Object.keys(pin.manifest.catalogue.shards.pages)[0]].path), true, "catalogue shard is published with its descriptor")
        ow.test.assert(wm._retrievalV2.lookupPage(pin, "a.md").revision, pin.catalog.pages["a.md"].revision, "targeted page lookup resolves the routed delta without a flattened file")
        ow.test.assert(io.fileExists(pin.dir + "/catalog.json"), false, "schema-3 generation does not clone a corpus catalogue")
      } finally { wm._retrievalV2.release(pin) }
      wm.close(); wm = __
      fresh = make(dir, {access:"ro"})
      var resolves = 0, resolve = fresh._retrievalV2._resolveCatalogue, cold = __
      fresh._retrievalV2._resolveCatalogue = function(){ resolves++; return resolve.apply(this,arguments) }
      try { cold = fresh._retrievalV2.acquire(); ow.test.assert(resolves,0,"cold schema-3 reader opens from structural metadata without resolving catalogue shards") } finally { if(cold)fresh._retrievalV2.release(cold); fresh._retrievalV2._resolveCatalogue = resolve }
      ow.test.assert(fresh.retrieve("schema3changedparameter").evidence.length, 1, "fresh reader resolves a schema-3 ancestor chain")
    } finally { if(fresh)fresh.close(); if(wm)wm.close(); io.rm(dir) }
  }
})()
