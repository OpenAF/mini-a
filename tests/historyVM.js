(function() {
  load("mini-a-history-vm.js")

  var removeTree = function(path) {
    var file = new java.io.File(path)
    if (!file.exists()) return
    if (file.isDirectory()) {
      var children = file.listFiles()
      for (var i = 0; isDef(children) && i < children.length; i++) removeTree(String(children[i].getAbsolutePath()))
    }
    file.delete()
  }

  var withVm = function(fn) {
    var root = String(java.nio.file.Files.createTempDirectory("mini-a-history-vm-test-").toAbsolutePath())
    var conversation = root + "/conversation.json"
    try {
      return fn(new MiniAHistoryVM({ enabled: true, conversationPath: conversation, conversationId: "test-conversation", sessionId: "test-session" }), conversation)
    } finally {
      removeTree(root)
    }
  }

  exports.testDisabledCreatesNoStore = function() {
    var root = String(java.nio.file.Files.createTempDirectory("mini-a-history-vm-disabled-").toAbsolutePath())
    try {
      var conversation = root + "/conversation.json"
      var vm = new MiniAHistoryVM({ enabled: false, conversationPath: conversation })
      ow.test.assert(io.fileExists(conversation + ".historyvm") === false, true, "Disabled VM must not create files")
      ow.test.assert(vm.append("user_message", "ignored") === __, true, "Disabled VM must not append events")
    } finally {
      removeTree(root)
    }
  }

  exports.testRuntimeFlagsAndToolRegistration = function() {
    var root = String(java.nio.file.Files.createTempDirectory("mini-a-history-vm-runtime-").toAbsolutePath())
    try {
      load("mini-a.js")
      var conversation = root + "/conversation.json"
      var agent = new MiniA()
      agent.setInteractionFn(function() {})
      var disabledArgs = { historyvm: false, historyvmshadow: false, conversation: conversation }
      agent._initHistoryVm(disabledArgs)
      ow.test.assert(isUnDef(agent._historyVm), true, "Disabled runtime mode must not initialize VM storage")
      ow.test.assert(isUnDef(agent._createHistoryVmMcpConfig(disabledArgs)), true, "Disabled runtime mode must not register retrieval tools")

      var shadowArgs = { historyvm: false, historyvmshadow: true, historyvmmode: "safe", conversation: conversation }
      agent._initHistoryVm(shadowArgs)
      ow.test.assert(agent._historyVm.shadow === true, true, "Shadow mode should initialize canonical capture")
      ow.test.assert(isUnDef(agent._createHistoryVmMcpConfig(shadowArgs)), true, "Shadow mode must not register retrieval tools")

      var enabledArgs = { historyvm: true, historyvmshadow: true, historyvmmode: "experimental", conversation: conversation }
      agent._initHistoryVm(enabledArgs)
      var config = agent._createHistoryVmMcpConfig(enabledArgs)
      ow.test.assert(enabledArgs.historyvmshadow === false && enabledArgs.historyvmmode === "safe", true, "Enabled mode should take precedence and normalize the v1 policy")
      ow.test.assert(isMap(config) && isFunction(config.options.fns.history_search) && isFunction(config.options.fns.history_get) && isFunction(config.options.fns.history_expand), true, "Enabled mode should expose all bounded retrieval tools")
      var large = new Array(10001).join("p")
      var rawConversation = [{ role: "assistant", content: large }, { role: "assistant", content: "one" }, { role: "assistant", content: "two" }, { role: "assistant", content: "three" }, { role: "assistant", content: "four" }]
      agent._historyVm.captureProviderConversation(rawConversation)
      var providerConversation = agent._historyVm.projectConversation(rawConversation, { currentStep: 1 })
      agent.llm = { getGPT: function() { return { getConversation: function() { return providerConversation } } } }
      ow.test.assert(agent._writeConversationPayload(conversation) === true, true, "Runtime conversation persistence should succeed")
      var saved = io.readFileJSON(conversation)
      ow.test.assert(saved.c[0].content === large && isMap(saved.history_vm), true, "Runtime persistence must keep a VM-disabled-compatible snapshot and VM metadata")
      agent._historyVm.deleteOwnedStore()
    } finally {
      removeTree(root)
    }
  }

  exports.testAppendResumeAndDistinctEqualEvents = function() {
    withVm(function(vm, conversation) {
      var first = vm.captureUserMessage("same 😀")
      var second = vm.captureUserMessage("same 😀")
      ow.test.assert(first.eventId !== second.eventId, true, "Repeated equal payloads need distinct event IDs")
      var resumed = new MiniAHistoryVM({ enabled: true, conversationPath: conversation, conversationId: "test-conversation" })
      ow.test.assert(resumed.events.length === 2, true, "Committed journal events should resume")
      ow.test.assert(resumed.events[0].content === "same 😀", true, "Unicode content should round trip exactly")
      ow.test.assert(resumed.metrics.checkpoint_hits === 1, true, "Valid checkpoint should be used")
    })
  }

  exports.testLegacyImportMarksCompletenessBoundary = function() {
    withVm(function(vm) {
      vm.importLegacy({ c: [{ role: "assistant", content: "already summarized" }] })
      ow.test.assert(vm.events.length === 1, true, "Legacy snapshot should import once")
      ow.test.assert(vm.events[0].metadata.legacyImport === true, true, "Legacy import should be explicit")
      ow.test.assert(vm.events[0].metadata.completeness === "legacy_snapshot_only", true, "Legacy import must not claim missing originals")
      vm.importLegacy({ c: [] })
      ow.test.assert(vm.events.length === 1, true, "Legacy import should be idempotent")
    })
  }

  exports.testSearchAndExactPagedRead = function() {
    withVm(function(vm) {
      var event = vm.captureToolExchange("lookup", { q: "small" }, "prefix hiddenneedle-suffix 😀", { stepLabel: 1 })
      var id = "h" + ("000000" + event.seq).slice(-6)
      var search = vm.search("needle", 5, 0)
      ow.test.assert(search.results.length === 1 && search.results[0].id === id, true, "Search should inspect exact content beyond the descriptor")
      var offset = 0
      var reconstructed = ""
      do {
        var page = vm.get(id, offset, 5)
        reconstructed += page.content
        offset = page.nextCursor
      } while (isDef(offset))
      var expected = stringify({ request: { q: "small" }, result: "prefix hiddenneedle-suffix 😀" }, __, "")
      ow.test.assert(reconstructed === expected, true, "Bounded reads should reconstruct the exact serialized object")
    })
  }

  exports.testProjectionProtectsRequirementsAndCollapsesOldLargeOutput = function() {
    withVm(function(vm) {
      var large = new Array(10001).join("x")
      var conversation = [
        { role: "system", content: "system rule" },
        { role: "user", content: large },
        { role: "assistant", content: large },
        { role: "assistant", content: "later one" },
        { role: "assistant", content: "later two" },
        { role: "assistant", content: "later three" },
        { role: "assistant", content: "latest" }
      ]
      vm.captureProviderConversation(conversation)
      var projected = vm.projectConversation(conversation, { currentStep: 9 })
      ow.test.assert(projected[0].content === "system rule", true, "System messages must remain exact")
      ow.test.assert(projected[1].content === large, true, "Unclassified user requirements must remain exact")
      ow.test.assert(projected[2].content.indexOf("[HISTORY_VM_REFERENCE ") === 0, true, "Old large assistant content should collapse to a durable reference")
      ow.test.assert(vm.metrics.last_projected_tokens < vm.metrics.last_baseline_tokens, true, "Projection should reduce estimated request tokens")
      var idMatch = projected[2].content.match(/HISTORY_VM_REFERENCE (h\d+)/)
      var exact = vm.get(idMatch[1], 0, 16000)
      ow.test.assert(exact.content.indexOf(large) >= 0, true, "Collapsed content must remain exactly retrievable")
      var compatible = vm.materializeConversation(projected)
      ow.test.assert(compatible[2].content === large, true, "Persisted legacy history must materialize references for VM-disabled reopening")
    })
  }

  exports.testCorruptTrailingWriteRebuildsSafely = function() {
    withVm(function(vm, conversation) {
      vm.captureUserMessage("committed")
      io.writeFileString(vm.journalPath, "{broken trailing write\n", __, true)
      var resumed = new MiniAHistoryVM({ enabled: true, conversationPath: conversation, conversationId: "test-conversation" })
      ow.test.assert(resumed.events.length === 1, true, "Incomplete journal tail must not become a committed event")
      ow.test.assert(resumed.events[0].content === "committed", true, "Committed prefix should survive corrupt tail")
    })
  }

  exports.testCorruptCheckpointRebuildsFromJournal = function() {
    withVm(function(vm, conversation) {
      vm.captureUserMessage("survives corrupt checkpoint")
      io.writeFileString(vm.checkpointPath, "{not json")
      var resumed = new MiniAHistoryVM({ enabled: true, conversationPath: conversation, conversationId: "test-conversation" })
      ow.test.assert(resumed.degraded === false, true, "A corrupt checkpoint should rebuild from the committed journal")
      ow.test.assert(resumed.events.length === 1 && resumed.events[0].content === "survives corrupt checkpoint", true, "Checkpoint rebuild must preserve committed events")
      ow.test.assert(resumed.metrics.checkpoint_rebuilds === 1, true, "Checkpoint rebuild should be visible in metrics")
    })
  }

  exports.testConcurrentWriterFailsClosed = function() {
    withVm(function(vm, conversation) {
      var stale = new MiniAHistoryVM({ enabled: true, conversationPath: conversation, conversationId: "test-conversation" })
      vm.captureUserMessage("writer one")
      var result = stale.captureUserMessage("stale writer")
      ow.test.assert(result === false, true, "A stale concurrent writer must not append")
      ow.test.assert(stale.degraded === true && stale.enabled === false, true, "A stale concurrent writer must visibly fail closed")
      var resumed = new MiniAHistoryVM({ enabled: true, conversationPath: conversation, conversationId: "test-conversation" })
      ow.test.assert(resumed.events.length === 1 && resumed.events[0].content === "writer one", true, "Concurrent rejection must leave the journal intact")
    })
  }

  exports.testExpansionIsBoundedAndExpires = function() {
    withVm(function(vm) {
      var large = new Array(20001).join("z")
      var conversation = [
        { role: "assistant", content: large },
        { role: "assistant", content: "one" },
        { role: "assistant", content: "two" },
        { role: "assistant", content: "three" },
        { role: "assistant", content: "four" }
      ]
      vm.captureProviderConversation(conversation)
      var cold = vm.projectConversation(conversation, { currentStep: 1 })
      var id = cold[0].content.match(/HISTORY_VM_REFERENCE (h\d+)/)[1]
      vm.expand(id, { offset: 100, limit: 50 }, 2)
      var expanded = vm.projectConversation(cold, { currentStep: 3 })
      ow.test.assert(expanded[0].content.length < 200, true, "Expansion must honor its bounded range")
      ow.test.assert(expanded[0].content.indexOf("HISTORY_VM_RANGE " + id) >= 0, true, "A partial expansion should retain paging provenance")
      ow.test.assert(vm.materializeConversation(expanded)[0].content === large, true, "Legacy persistence must materialize bounded expansions back to exact content")
      var expired = vm.projectConversation(cold, { currentStep: 5 })
      ow.test.assert(expired[0].content.indexOf("[HISTORY_VM_REFERENCE " + id + "]") === 0, true, "Expansion must expire after its short TTL")
    })
  }

  exports.testUnknownStructuredContentStaysInline = function() {
    withVm(function(vm) {
      var unknown = { role: "assistant", content: [{ type: "image", data: "opaque" }], providerMeta: { keep: true } }
      var conversation = [unknown, { role: "assistant", content: "one" }, { role: "assistant", content: "two" }, { role: "assistant", content: "three" }, { role: "assistant", content: "four" }]
      vm.captureProviderConversation(conversation)
      var projected = vm.projectConversation(conversation, { currentStep: 8 })
      ow.test.assert(stringify(projected[0], __, "") === stringify(unknown, __, ""), true, "Unknown or multimodal provider shapes must stay intact")
    })
  }

  exports.testRewindUsesNewBranchScope = function() {
    withVm(function(vm) {
      vm.captureUserMessage("abandoned requirement")
      vm.rewind(0)
      vm.captureUserMessage("active requirement")
      ow.test.assert(vm.search("abandoned", 10, 0).results.length === 0, true, "Default retrieval should exclude abandoned branches")
      ow.test.assert(vm.search("active", 10, 0).results.length === 1, true, "Default retrieval should include the active branch")
    })
  }

  exports.testUnavailableBackingDisablesCollapse = function() {
    var vm = new MiniAHistoryVM({ enabled: true, conversationPath: "/dev/null/conversation.json" })
    ow.test.assert(vm.enabled === false && vm.degraded === true, true, "Unwritable storage should visibly disable VM")
    var original = [{ role: "assistant", content: new Array(10001).join("x") }]
    ow.test.assert(stringify(vm.projectConversation(original), __, "") === stringify(original, __, ""), true, "Degraded VM must not collapse inline content")
  }
})()
