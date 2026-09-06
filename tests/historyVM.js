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

  var withVm = function(fn, options) {
    var root = String(java.nio.file.Files.createTempDirectory("mini-a-history-vm-test-").toAbsolutePath())
    var conversation = root + "/conversation.json"
    try {
      var opts = merge({ enabled: true, conversationPath: conversation, conversationId: "test-conversation", sessionId: "test-session" }, isMap(options) ? options : {}, true)
      return fn(new MiniAHistoryVM(opts), conversation)
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

      var invalidPhase2Args = { historyvm: false, historyvmshadow: false, contextvirtualization: true, conversation: conversation }
      agent._initHistoryVm(invalidPhase2Args)
      ow.test.assert(invalidPhase2Args.contextvirtualization === false && isUnDef(agent._historyVm), true, "Phase 2 must not activate without Phase 1 History VM")

      var shadowArgs = { historyvm: false, historyvmshadow: true, historyvmmode: "safe", conversation: conversation }
      agent._initHistoryVm(shadowArgs)
      ow.test.assert(agent._historyVm.shadow === true, true, "Shadow mode should initialize canonical capture")
      ow.test.assert(isUnDef(agent._createHistoryVmMcpConfig(shadowArgs)), true, "Shadow mode must not register retrieval tools")

      var enabledArgs = { historyvm: true, historyvmshadow: true, historyvmmode: "experimental", contextvirtualization: true, conversation: conversation }
      agent._initHistoryVm(enabledArgs)
      var config = agent._createHistoryVmMcpConfig(enabledArgs)
      ow.test.assert(enabledArgs.historyvmshadow === false && enabledArgs.historyvmmode === "safe", true, "Enabled mode should take precedence and normalize the v1 policy")
      ow.test.assert(agent._historyVm.contextVirtualization === true, true, "Explicit Phase 2 mode should extend the active History VM")
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

  exports.testMultiResolutionRepresentationsAndCache = function() {
    withVm(function(vm, conversation) {
      var event = vm.registerContextObject("wiki", "architecture", new Array(1401).join("x"), { importance: 0.9, keywords: ["context"] })
      var object = vm.objects[vm.objects.length - 1]
      ow.test.assert(object.kind === "wiki" && object.handle.indexOf("wiki:w") === 0, true, "Generalized ContextObjects need stable logical handles")
      ow.test.assert(object.representations.reference.level === "L0" && object.representations.full.level === "L4", true, "Phase 2 objects should advertise L0-L4 representations")

      var reference = vm.getRepresentation(object.handle, "reference")
      var detailed = vm.getRepresentation(object.id, "L3")
      var exact = vm.getRepresentation(object.handle, "full")
      ow.test.assert(reference.level === "L0" && reference.text.indexOf("[wiki:") === 0, true, "L0 should be a compact deterministic reference")
      ow.test.assert(detailed.complete === false && detailed.text.indexOf("expand L4") >= 0, true, "L3 should remain bounded and point to exact expansion")
      ow.test.assert(exact.exact === true && exact.content === event.content, true, "L4 must return exact canonical content without a cached copy")
      ow.test.assert(io.fileExists(vm.representationCachePath) === true && vm.metrics.representation_cache_writes === 2, true, "Only derived representations should be cached lazily")

      var resumed = new MiniAHistoryVM({ enabled: true, contextVirtualization: true, conversationPath: conversation, conversationId: "test-conversation" })
      var reused = resumed.getRepresentation(object.handle, "L0")
      ow.test.assert(reused.text === reference.text && resumed.metrics.representation_cache_hits === 1, true, "Versioned representations should be reused after restart")
    }, { contextVirtualization: true })
  }

  exports.testHierarchicalContextObjectsSurviveRestart = function() {
    withVm(function(vm, conversation) {
      vm.registerContextObject("summary", "project", "Project context", { keywords: ["project"] })
      var parent = vm.objects[vm.objects.length - 1]
      vm.registerContextObject("decision", "architecture", "Use hierarchical virtualization", { parentId: parent.handle, dependencies: ["evidence:e42"] })
      var child = vm.objects[vm.objects.length - 1]
      var children = vm.getChildren(parent.handle)
      ow.test.assert(children.total === 1 && children.results[0].handle === child.handle, true, "Parent objects should expose bounded child descriptors")
      ow.test.assert(child.parentId === parent.handle && child.dependencies[0] === "evidence:e42", true, "Hierarchy and dependency metadata should remain attached to the child")

      var resumed = new MiniAHistoryVM({ enabled: true, contextVirtualization: true, conversationPath: conversation, conversationId: "test-conversation" })
      var rebuilt = resumed.getChildren(parent.handle)
      ow.test.assert(rebuilt.total === 1 && rebuilt.results[0].handle === child.handle, true, "Hierarchy links should rebuild deterministically from canonical events")
      ow.test.assert(resumed.metrics.hierarchy_roots === 1 && resumed.metrics.hierarchy_links === 1, true, "Hierarchy diagnostics should report roots and links")
    }, { contextVirtualization: true })
  }

  exports.testPhaseOneDoesNotCreateRepresentationCache = function() {
    withVm(function(vm) {
      vm.captureUserMessage("phase one only")
      ow.test.assert(vm.contextVirtualization === false && io.fileExists(vm.representationCachePath) === false, true, "Phase 1 should not pay Phase 2 cache overhead")
      ow.test.assert(isUnDef(vm.objects[0].representations), true, "Phase 1 object shape should remain compatible")
      ow.test.assert(isUnDef(vm.registerContextObject("wiki", "page", "not active")), true, "Phase 2 object registration should remain gated")
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
