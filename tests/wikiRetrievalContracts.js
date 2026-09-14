(function() {
  load("mini-a-common.js")
  load("mini-a-wiki.js")
  exports.testContracts = function() {
    var wm = new MiniAWikiManager({ backend: "fs", root: "/tmp", access: "ro" })
    var raw = "---\ntitle: Test\n---\n# Section\n" + new Array(90).join("é") + "\n# Next\nsecret"
    wm.read = function() { return { path: "@last/test.md", raw: raw, body: raw, meta: {} } }
    var first = wm.agenticRead("test.md", { section: "Section", maxChars: 17 })
    var joined = first.body, next = first.next, calls = 0
    while (next && calls++ < 30) {
      var part = wm.agenticRead(next.path, next)
      joined += part.body; next = part.next
    }
    ow.test.assert(joined, "# Section\n" + new Array(90).join("é"), "continuations preserve every character inside section")
    ow.test.assert(first.path, "@last/test.md", "mount identity retained")
    ow.test.assert(first.lineStart, 4, "raw frontmatter lines counted")
    raw += "changed"
    ow.test.assert(wm.agenticRead(first.next.path, first.next).error, "stale-reference", "revision changes reject cursor")
    var searched = 0
    wm._ensureSearchIndex = function() { return { available: function() { return true }, writable: false, exists: function() { return true }, query: function() { return [] } } }
    wm.list = function() { searched++; return [] }
    wm._searchMounts = function() { return [] }
    ow.test.assert(wm.search("absent").length, 0, "healthy zero result")
    ow.test.assert(searched, 0, "healthy zero result never lists corpus")
    wm.agenticSearch = function(q, opts) { ow.test.assert(opts.wiki, ["last"], "retrieve propagates requested scope"); return { results: [] } }
    ow.test.assert(wm.retrieve("q", { wiki: ["last"] }).stages.indexOf("synthesize"), -1, "no invented synthesis")
    wm.read = function(path) { return { path: path, raw: "a.b\nother\na.b\na.b", meta: {} } }
    var grepFirst = wm.grep("matches.md", "a.b", { limit: 1 }), grepNext = grepFirst.next, seen = [grepFirst.matches[0].line]
    while (grepNext) {
      var fragment = wm.grep(grepNext.path, grepNext.pattern, grepNext)
      fragment.matches.forEach(function(match) { seen.push(match.line) }); grepNext = fragment.next
    }
    ow.test.assert(seen, [1, 3, 4], "grep continuation consumes every match once and escapes literal dots")
    ow.test.assert(wm.grep("matches.md", "changed-pattern", grepFirst.next).error, "stale-reference", "grep cursor binds pattern")
    wm.read = function(path) { return { path: path, raw: "edited", meta: {} } }
    ow.test.assert(wm.grep("matches.md", "a.b", grepFirst.next).error, "stale-reference", "grep cursor binds raw revision")
    var longLine = "a.b " + new Array(60).join("😀é")
    wm.read = function(path) { return { path: path, raw: longLine, meta: {} } }
    var longFirst = wm.grep("matches.md", "a.b", {limit:1,maxChars:17}), longNext = longFirst.next, longText = longFirst.matches[0].text, fragmentCalls = 0
    while (longNext && fragmentCalls++ < 100) {
      var longPart = wm.grep(longNext.path,longNext.pattern,longNext)
      ow.test.assert(longPart.matches[0].matchId, longFirst.matches[0].matchId, "grep fragments identify the same logical match")
      ow.test.assert(longPart.matches[0].matchContinuation,true,"fragment continuation is not advertised as another match")
      longText += longPart.matches[0].text; longNext = longPart.next
    }
    ow.test.assert(longText,longLine,"long-line grep resumes every UTF-16 character without loss")
    var originalIdentity = wm._getBackendIdentity
    wm._getBackendIdentity = function(){return "another-logical-wiki"}
    ow.test.assert(wm.grep("matches.md","a.b",longFirst.next).error,"stale-reference","grep cursors cannot cross logical wiki identity")
    wm._getBackendIdentity = originalIdentity
    var pageBodies = {"a.md":"a.b", "b.md":"a.b\na.b"}
    wm.list = function(){return ["a.md","b.md"]}
    wm.read = function(path){return {path:path,raw:pageBodies[path],meta:{}}}
    var multiFirst = wm.grep("", "a.b", {limit:2}), multiNext = multiFirst.next
    pageBodies["a.md"] = "changed earlier page"
    ow.test.assert(wm.grep("", "a.b", multiNext).error,"stale-reference","grep rejects changes to previously visited pages")
    wm.read = function(path){return {path:path,raw:longLine+"\na.b\n"+longLine,meta:{}}}
    var contextual = wm.grep("matches.md","^a\\.b$",{regex:true,maxChars:17,contextLines:1}).matches[0]
    ow.test.assert(contextual.contextBefore[0].length <= 17,true,"grep preceding context does not bypass fragment cap")
    ow.test.assert(contextual.contextAfter[0].length <= 17,true,"grep following context does not bypass fragment cap")
    ow.test.assert(contextual.contextTruncated,true,"bounded surrounding context reports omission")
    load("mini-a-utils.js")
    var forwarded, utility = {_ensureInitialized:function(){},_wikiAgenticRetrieval:true,_wikiManager:{agenticRead:function(path,opts){forwarded=opts;return {path:path,body:"fragment"}},grep:function(path,pattern,opts){forwarded=opts;return {matches:[]}}}}
    MiniUtilsTool.prototype.wiki.call(utility,{operation:"read",path:"example.md",charOffset:7,revision:"bound",maxChars:9})
    ow.test.assert(forwarded.charOffset,7,"shared utility read preserves continuation position")
    ow.test.assert(forwarded.revision,"bound","shared utility read preserves pinned revision")
    ow.test.assert(forwarded.maxChars,9,"shared utility read preserves character budget")
    MiniUtilsTool.prototype.wiki.call(utility,{operation:"grep",path:"example.md",pattern:"term",maxChars:17})
    ow.test.assert(forwarded.maxChars,17,"shared utility grep forwards fragment budget")
    load("mini-a-skills.js")
    var skillManager = { _getBackendIdentity: function() { return "cursor-test" }, open: function() { return {frontmatter:{type:"skill"}} }, agenticRead: function(ref, opts) { return {body:String(opts.charOffset || 0)} } }
    var provider = new MiniAWikiSkillProvider(skillManager)
    ow.test.assert(provider.read("wiki:skill.md",{revision:"pinned",charOffset:0}).body,"0","skill cursor first fragment")
    ow.test.assert(provider.read("wiki:skill.md",{revision:"pinned",charOffset:8}).body,"8","legacy skill cache cannot repeat previous cursor fragment")
    wm.close()
  }
  exports.testIndexedLanguageAndTelemetry = function() {
    load("mini-a-wiki-knowledge.js")
    var dir = java.io.File.createTempFile("wiki-contract-", "").getCanonicalPath()
    io.rm(dir); io.mkdir(dir)
    try {
      var wm = new MiniAWikiManager({ backend: "fs", root: dir, access: "rw", wikilexical: { language: "english" } })
      wm.write("english.md", { title: "Language" }, "# Language\nThe runners were running. wikirestrictrefttl")
      ow.test.assert(wm.search("run", { __wikiNoMounts: true }).some(function(h) { return h.path === "english.md" }), true, "real indexed English stemming")
      ow.test.assert(wm.search("wikirestrictrefttl", { __wikiNoMounts: true }).some(function(h) { return h.path === "english.md" }), true, "technical identifier survives analysis")
      wm.knowledgeSaveState(wm._knowledgeEmptyState())
      var before = io.readFileString(wm._knowledgeStatePath())
      wm.knowledgeRecordTelemetry("private query", [], true)
      ow.test.assert(io.readFileString(wm._knowledgeStatePath()), before, "telemetry never changes authority manifest")
      ow.test.assert(wm.knowledgeStats().telemetry.zero_results, 1, "separate aggregate telemetry")
      ow.test.assert(io.readFileString(wm._knowledgeTelemetryPath()).indexOf("private"), -1, "no raw queries")
      wm.close()
      var ptDir = dir + "/pt"; io.mkdir(ptDir)
      var pt = new MiniAWikiManager({ backend: "fs", root: ptDir, access: "rw", wikilexical: { language: "portuguese" } })
      pt.write("pt.md", { title: "Português" }, "# Configuração\nOs documentos são importantes.")
      ow.test.assert(pt.search("documento", { __wikiNoMounts: true }).some(function(h) { return h.path === "pt.md" }), true, "real indexed Portuguese stemming")
      pt.close()
    } finally { io.rm(dir) }
  }
})()
