(function() {
  exports.testWebPersistence = function() {
    load("mini-a.js")
    var root = String(java.nio.file.Files.createTempDirectory("mini-a-history-s3-").toAbsolutePath())
    var yaml = io.readFileString("mini-a-web.yaml")
    var start = yaml.indexOf("    global._mini_a_web_buildHistoryPayload =")
    var source = yaml.substring(start, yaml.indexOf("\n# ---------------------------------------", start))
    var keys = ["__historypath", "__historys3enabled", "__historys3bucket", "__historys3client", "__conversations", "__res", "maArgs", "__usehistory", "__historykeep", "__lastActivity", "__busy", "__planState", "__subagentState", "_mini_a_web_checkToken", "_mini_a_web_isValidUuid", "_mini_a_web_historyS3Key", "_mini_a_web_uuidFromPath", "_mini_a_web_buildHistoryPayload", "_mini_a_web_storeHistory", "_mini_a_web_saveFile", "_mini_a_web_loadFile", "_mini_a_web_historyExists", "_mini_a_web_deleteHistory"]
    var saved = {}
    keys.forEach(function(key) { saved[key] = global[key] })
    var objects = {}, failGet = false, failPut = false, gets = 0
    var path = root + "/c-test.json"
    var remove = function(file) {
      if (file.isDirectory()) {
        var children = file.listFiles()
        for (var i = 0; isDef(children) && i < children.length; i++) remove(children[i])
      }
      file.delete()
    }
    try {
      global.__historypath = root
      global.__historys3enabled = true
      global.__historys3bucket = "test"
      global.__conversations = {}
      global.__res = {}
      global.maArgs = { historyvm: true }
      global._mini_a_web_historyS3Key = function(uuid) { return "sessions/c-" + uuid + ".json" }
      global._mini_a_web_uuidFromPath = function(file) { return String(file).match(/c-(.*)\.json$/)[1] }
      global.__historys3client = {
        getObjectStream: function(bucket, key) {
          gets++
          if (failGet) throw new Error("AccessDenied")
          if (isUnDef(objects[key])) throw new Error("NoSuchKey")
          return af.fromString2InputStream(objects[key])
        },
        putObjectStream: function(bucket, key, stream) {
          if (failPut) throw new Error("Upload unavailable")
          objects[key] = af.fromInputStream2String(stream)
        },
        removeObject: function(bucket, key) { delete objects[key] }
      }
      eval(source)
      var vm = new MiniAHistoryVM({ enabled: true, contextVirtualization: true, conversationPath: path })
      var history = [{ role: "user", content: "First" }, { role: "assistant", content: "Exact older answer" }]
      vm.captureProviderConversation(history)
      var agent = { _historyVm: vm, llm: { getGPT: function() { return { getConversation: function() { return history } } } }, _writeConversationPayload: MiniA.prototype._writeConversationPayload }
      global.__conversations.test = agent
      vm.captureUserMessage("Next")
      global._mini_a_web_storeHistory("test", "Next")
      var remote = jsonParse(objects["sessions/c-test.json"])
      ow.test.assert(remote.c[remote.c.length - 1].content, "Next", "Prompt checkpoint includes new prompt")
      ow.test.assert(remote.history_vm_snapshot.sequence, vm._seq, "Prompt snapshot includes canonical capture")
      ow.test.assert(gets, 0, "Uploads never read stale remote payloads")
      history.push({ role: "user", content: "Next" }, { role: "assistant", content: "Latest answer" })
      vm.captureProviderConversation(history)
      global._mini_a_web_storeHistory("test")
      remote = jsonParse(objects["sessions/c-test.json"])
      ow.test.assert(remote.c[remote.c.length - 1].content, "Latest answer", "Final checkpoint has latest answer")
      global._mini_a_web_loadFile(path)
      ow.test.assert(gets, 0, "Active VM is never overwritten by remote history")
      delete global.__conversations.test
      io.rm(path)
      vm.deleteOwnedStore()
      global._mini_a_web_loadFile(path)
      var resumed = new MiniAHistoryVM({ enabled: true, contextVirtualization: true, conversationPath: path, conversationId: remote.history_vm.conversationId })
      ow.test.assert(resumed._lastHash, vm._lastHash, "Fresh host recovers canonical history")
      ow.test.assert(resumed.get(resumed._providerObjectForIndex(1).handle, 0, 1000).content.indexOf("Exact older answer") >= 0, true, "Recovered exact content remains retrievable")
      agent._historyVm = resumed
      global.__conversations.test = agent
      resumed.captureUserMessage("Offline prompt")
      failPut = true
      global._mini_a_web_storeHistory("test", "Offline prompt")
      ow.test.assert(MiniAHistoryVM.readLocalSnapshot(path).sequence, resumed._seq, "Failed upload retains latest local checkpoint")
      delete global.__conversations.test
      global._mini_a_web_loadFile(path)
      ow.test.assert(MiniAHistoryVM.readLocalSnapshot(path).sequence, resumed._seq, "Restart does not replace newer local state with stale S3 state")
      failGet = true
      global._mini_a_web_loadFile(path)
      var rejected = false
      try { global._mini_a_web_loadFile(root + "/c-absent.json") } catch(expected) { rejected = true }
      ow.test.assert(rejected, true, "Unreadable remote without local state fails resume")
      rejected = false
      try { global._mini_a_web_historyExists("absent") } catch(expected) { rejected = true }
      ow.test.assert(rejected, true, "Access denial is not mistaken for a missing history object")
      failGet = false
      global._mini_a_web_loadFile(root + "/c-new.json")
      ow.test.assert(io.fileExists(root + "/c-new.json"), false, "Missing S3 object permits a new session")
      io.writeFileString(root + "/c-corrupt.json", "not json")
      rejected = false
      try { global._mini_a_web_loadFile(root + "/c-corrupt.json") } catch(expected) { rejected = true }
      ow.test.assert(rejected, true, "Missing remote cannot silently discard a corrupt local generation")
      objects["sessions/c-bad.json"] = '{"c":[],"history_vm_snapshot":{"version":999}}'
      rejected = false
      try { global._mini_a_web_loadFile(root + "/c-bad.json") } catch(expected) { rejected = true }
      ow.test.assert(rejected, true, "Malformed snapshot cannot become an empty conversation")
      failPut = false
      global.__conversations.test = agent
      global._mini_a_web_storeHistory("test")
      ow.test.assert(jsonParse(objects["sessions/c-test.json"]).history_vm_snapshot.sequence, resumed._seq, "Next checkpoint retries remote upload")
      // Execute the actual clear route with historykeep enabled.
      global.__usehistory = true
      global.__historykeep = true
      global.__busy = {}; global.__lastActivity = {}; global.__planState = {}; global.__subagentState = {}
      global.__lastActivity.test = 0
      var cleanupStart = yaml.indexOf("    var toDelete = []", yaml.indexOf("- name : Periodic cleanup of old sessions"))
      var cleanup = yaml.substring(cleanupStart, yaml.indexOf("    // Clean up stale SSE queues", cleanupStart))
      new Function("args", cleanup)({ historyretention: 1 })
      ow.test.assert(io.fileExists(path) && io.fileExists(path + ".historyvm") && isDef(objects["sessions/c-test.json"]), true, "Automatic expiry retains history when historykeep is enabled")
      global._mini_a_web_checkToken = function() { return true }
      global._mini_a_web_isValidUuid = function() { return true }
      var clear = yaml.split("# Clear a session")[1].split("# Submit a prompt")[0].split("((execURI      )): | #js\n")[1]
      new Function("request", clear)({ files: { postData: '{"uuid":"test","force":true}' } })
      ow.test.assert(io.fileExists(path) || io.fileExists(path + ".historyvm") || isDef(objects["sessions/c-test.json"]), false, "Explicit deletion overrides historykeep for local and remote state")
      objects["sessions/c-legacy.json"] = '{"c":[{"role":"user","content":"legacy"}]}'
      var legacyPath = root + "/c-legacy.json"
      global._mini_a_web_loadFile(legacyPath)
      ow.test.assert(io.readFileJSON(legacyPath).c[0].content, "legacy", "Legacy S3 envelopes still load")
      io.writeFileJSON(legacyPath, { c: [{ role: "assistant", content: "updated legacy" }] }, "")
      global._mini_a_web_storeHistory("legacy")
      ow.test.assert(jsonParse(objects["sessions/c-legacy.json"]).c[0].content, "updated legacy", "VM-disabled upload uses newest local envelope")
    } finally {
      keys.forEach(function(key) { if (isDef(saved[key])) global[key] = saved[key]; else delete global[key] })
      remove(new java.io.File(root))
    }
  }
})()
