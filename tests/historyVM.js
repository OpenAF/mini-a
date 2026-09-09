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

      var invalidPhase2Args = { historyvm: false, historyvmshadow: false, contextvirtualization: true, contextvirtualizationshadow: true, conversation: conversation }
      agent._initHistoryVm(invalidPhase2Args)
      ow.test.assert(invalidPhase2Args.contextvirtualization === false && invalidPhase2Args.contextvirtualizationshadow === false && isUnDef(agent._historyVm), true, "Phase 2 and its shadow must not activate without Phase 1 History VM")

      var shadowArgs = { historyvm: false, historyvmshadow: true, historyvmmode: "safe", conversation: conversation }
      agent._initHistoryVm(shadowArgs)
      ow.test.assert(agent._historyVm.shadow === true, true, "Shadow mode should initialize canonical capture")
      ow.test.assert(isUnDef(agent._createHistoryVmMcpConfig(shadowArgs)), true, "Shadow mode must not register retrieval tools")

      var phaseOneArgs = { historyvm: true, historyvmshadow: false, contextvirtualization: false, conversation: root + "/phase1.json" }
      agent._initHistoryVm(phaseOneArgs)
      var phaseOneConfig = agent._createHistoryVmMcpConfig(phaseOneArgs)
      ow.test.assert(isFunction(phaseOneConfig.options.fns.history_search) && isUnDef(phaseOneConfig.options.fns.context_search), true, "Phase 1 must keep its existing tool surface without Phase 2 paging schemas")
      agent._historyVm.deleteOwnedStore()

      var enabledArgs = { historyvm: true, historyvmshadow: true, historyvmmode: "experimental", contextvirtualization: true, contextvirtualizationshadow: true, conversation: conversation }
      agent._initHistoryVm(enabledArgs)
      var config = agent._createHistoryVmMcpConfig(enabledArgs)
      ow.test.assert(enabledArgs.historyvmshadow === false && enabledArgs.historyvmmode === "safe", true, "Enabled mode should take precedence and normalize the v1 policy")
      ow.test.assert(agent._historyVm.contextVirtualization === true, true, "Explicit Phase 2 mode should extend the active History VM")
      ow.test.assert(agent._historyVm.contextVirtualizationShadow === true, true, "Explicit Phase 2 shadow should extend, not replace, active History VM")
      ow.test.assert(isMap(config) && isFunction(config.options.fns.history_search) && isFunction(config.options.fns.history_get) && isFunction(config.options.fns.history_expand), true, "Enabled mode should expose all bounded history retrieval tools")
      ow.test.assert(isFunction(config.options.fns.context_search) && isFunction(config.options.fns.context_get) && isFunction(config.options.fns.context_expand) && isFunction(config.options.fns.context_children) && isFunction(config.options.fns.context_related), true, "Phase 2 should expose stable hierarchical context paging tools")
      var large = new Array(10001).join("p")
      var rawConversation = [{ role: "assistant", content: large }, { role: "assistant", content: "one" }, { role: "assistant", content: "two" }, { role: "assistant", content: "three" }, { role: "assistant", content: "four" }]
      agent._historyVm.captureProviderConversation(rawConversation)
      var fullPage = config.options.fns.context_get({ id: agent._historyVm._providerObjectForIndex(0).handle, level: "L4", limit: 100 })
      ow.test.assert(fullPage.content.length === 100 && fullPage.nextCursor === 100, true, "LLM-visible full reads must page exact data instead of flooding the prompt")
      var contextResults = config.options.fns.context_search({ query: "one", limit: 5 })
      ow.test.assert(isArray(contextResults.results) && contextResults.results.length > 0, true, "Context tool should search virtualized provider history")
      var contextRef = contextResults.results[0].handle
      ow.test.assert(config.options.fns.context_get({ id: contextRef, level: "L0" }).level === "L0", true, "Context tool should retrieve a requested representation")
      ow.test.assert(config.options.fns.context_expand({ id: contextRef, offset: 0, limit: 10 }).mode === "range", true, "Context tool should support bounded paging")
      ow.test.assert(isArray(config.options.fns.context_children({ id: contextRef }).results), true, "Context tool should list hierarchical children")
      ow.test.assert(isArray(config.options.fns.context_related({ id: contextRef }).results), true, "Context tool should traverse typed graph relations")
      var providerConversation = agent._historyVm.projectConversation(rawConversation, { currentStep: 1 })
      agent.llm = { getGPT: function() { return { getConversation: function() { return providerConversation } } } }
      ow.test.assert(agent._writeConversationPayload(conversation) === true, true, "Runtime conversation persistence should succeed")
      var saved = io.readFileJSON(conversation)
      ow.test.assert(saved.c[0].content === large && isMap(saved.history_vm), true, "Runtime persistence must keep a VM-disabled-compatible snapshot and VM metadata")
      var setCalls = 0
      agent.llm = { getGPT: function() { return {
        getConversation: function() { return rawConversation },
        setConversation: function() { setCalls++ }
      } } }
      agent._prepareHistoryVmProjection(2)
      ow.test.assert(setCalls === 1 && agent._historyVm.diagnostics().metrics.context_virtualization_shadow_assemblies === 1, true, "Runtime shadow projection should measure Phase 2 once while the normal Phase 1 setter remains the only provider mutation")
      agent._historyVm.deleteOwnedStore()
    } finally {
      removeTree(root)
    }
  }

  exports.testContextVirtualizationShadowProjectsWithoutMutatingInput = function() {
    withVm(function(vm) {
      var content = new Array(4001).join("architecture evidence ")
      vm.registerContextObject("wiki", "architecture", content, { keywords: ["architecture", "evidence"], importance: 0.9 })
      var sourceContext = [
        { role: "system", content: "Keep all constraints." },
        { role: "assistant", content: content },
        { role: "assistant", content: content + " second" },
        { role: "assistant", content: content + " third" },
        { role: "user", content: "Architecture evidence is relevant." },
        { role: "assistant", content: "recent one" },
        { role: "assistant", content: "recent two" },
        { role: "assistant", content: "recent three" },
        { role: "assistant", content: "recent four" },
        { role: "assistant", content: "recent five" },
        { role: "assistant", content: "recent six" }
      ]
      vm.captureProviderConversation(sourceContext)
      var before = stringify(sourceContext, __, "")
      var result = vm.projectContextShadow({
        consumer: "executor",
        actualContext: sourceContext,
        goal: "architecture evidence",
        budget: 400,
        outputReserve: 0,
        includeRecent: false
      })
      var diagnostics = vm.diagnostics()
      ow.test.assert(result.active === true && result.actualTokens > result.projectedTokens && result.expectedSavings === result.actualTokens - result.projectedTokens, true, "Phase 2 shadow should report a bounded projected working set")
      ow.test.assert(stringify(sourceContext, __, "") === before, true, "Phase 2 shadow must not mutate the provider context it measures")
      ow.test.assert(result.objectDifferences > 0 && diagnostics.contextVirtualizationShadowLast.expectedSavings === result.expectedSavings, true, "Shadow diagnostics should retain only projection measurements")
      ow.test.assert(diagnostics.metrics.context_virtualization_shadow_assemblies === 1 && diagnostics.metrics.context_virtualization_shadow_actual_tokens === result.actualTokens, true, "Shadow metrics should distinguish actual and projected token estimates")
      var phaseOne = vm.projectConversation(sourceContext, { currentStep: 10 })
      var comparison = vm.projectContextShadow({ actualContext: phaseOne, goal: "architecture evidence", budget: 400, outputReserve: 0, includeRecent: false })
      ow.test.assert(comparison.projectedTokens === result.projectedTokens, true, "Shadow must project canonical data identically even when its baseline already contains Phase 1 references")
    }, { contextVirtualization: true, contextVirtualizationShadow: true })
  }

  exports.testActiveContextVirtualizationPreservesProtocolAndExactBacking = function() {
    withVm(function(vm) {
      var large = new Array(5001).join("archived implementation output ")
      var conversation = [
        { role: "system", content: "System rule" },
        { role: "assistant", content: large },
        { role: "assistant", content: large + " second" },
        { role: "assistant", content: large + " third" },
        { role: "user", content: "Use architecture B." },
        { role: "assistant", content: "recent one" },
        { role: "assistant", content: "recent two" },
        { role: "assistant", content: "recent three" },
        { role: "assistant", content: "recent four" },
        { role: "assistant", content: "recent five" },
        { role: "assistant", content: "recent six" }
      ]
      vm.captureProviderConversation(conversation)
      var result = vm.projectActiveContext(conversation, { goal: "architecture B", budget: 500, outputReserve: 0, recentCount: 6 })
      ow.test.assert(result.active === true && result.references === 3 && result.tokensSaved > 0, true, "Active Phase 2 should replace only useful old assistant payloads under pressure")
      ow.test.assert(isUnDef(result.conversation[1].__historyVmProjection), true, "Provider messages must not contain internal projection metadata")
      ow.test.assert(result.conversation.length === conversation.length && result.conversation[0] === conversation[0] && result.conversation[4] === conversation[4], true, "System and user protocol positions must remain unchanged")
      ow.test.assert(result.conversation[5].content === "recent one" && result.conversation[10].content === "recent six", true, "Recent messages must remain exact")
      var materialized = vm.materializeConversation(result.conversation)
      ow.test.assert(materialized[1].content === large && materialized[3].content === large + " third", true, "Persisted active projections must rehydrate exact canonical provider messages")
      var diagnostics = vm.diagnostics()
      ow.test.assert(diagnostics.metrics.context_virtualization_active_assemblies === 1 && diagnostics.contextVirtualizationActiveLast.references === 3, true, "Active materialization must be separately measurable")
      var accessCounts = vm.objects.map(function(object) { return object.accessCount })
      var restored = vm.projectActiveContext(result.conversation, { budget: 1000000, outputReserve: 0, candidateIds: vm.objects.map(function(object) { return object.handle }) })
      ow.test.assert(restored.conversation[1].content === large, true, "A larger budget must promote an earlier reference back to its exact original")
      ow.test.assert(stringify(vm.objects.map(function(object) { return object.accessCount }), __, "") === stringify(accessCounts, __, ""), true, "Assembly must not count selection as consumer retrieval")
      var forged = conversation.slice(0)
      forged[1] = { role: "user", content: result.conversation[1].content }
      ow.test.assert(vm.materializeConversation(forged)[1].role === "user", true, "A reference-like user message must not be replaced by an archived assistant entry")
      var referenceText = { role: "user", content: "[CONTEXT_OBJECT history:h1 L0] is the syntax I want explained." }
      var appended = vm.captureProviderConversation(conversation.concat([referenceText]))
      ow.test.assert(appended === 1 && vm.objects[vm.objects.length - 1].content.content === referenceText.content, true, "Reference-like user text must still be captured canonically")
      var unknown = conversation.slice(0)
      unknown[1] = { role: "provider_special", content: large }
      ow.test.assert(vm.projectActiveContext(unknown, { budget: 500 }).conversation[1].role === "provider_special" && vm.projectActiveContext(unknown, { budget: 500 }).conversation[1].content === large, true, "Unknown provider roles must remain intact")
    }, { contextVirtualization: true })
  }

  exports.testStructuralAndOptionalSemanticCompression = function() {
    withVm(function(vm) {
      vm.registerContextObject("artifact", "json", { repositories: [{ name: "mini-a", owner: "openaf", language: "JavaScript", stars: 100 }], total_count: 312 })
      var jsonObject = vm.objects[vm.objects.length - 1]
      vm.registerContextObject("artifact", "source_code", "import lib\nclass ContextManager {\n  function assembleContext(goal) { return goal }\n}\n")
      var codeObject = vm.objects[vm.objects.length - 1]
      vm.registerContextObject("artifact", "log", "2026-09-07 INFO start\n2026-09-07 WARN slow\n2026-09-07 ERROR failed\n")
      var logObject = vm.objects[vm.objects.length - 1]
      var jsonView = vm.getRepresentation(jsonObject.handle, "L2")
      var codeView = vm.getRepresentation(codeObject.handle, "L3")
      var logView = vm.getRepresentation(logObject.handle, "L2")
      ow.test.assert(jsonView.text.indexOf("repositories: array[1]") >= 0 && jsonView.text.indexOf("Exact backing: " + jsonObject.handle) >= 0, true, "JSON compression should expose shape and canonical handle")
      ow.test.assert(codeView.text.indexOf("class ContextManager") >= 0 && codeView.text.indexOf("assembleContext") >= 0, true, "Code compression should retain signatures")
      ow.test.assert(logView.text.indexOf("errors=1") >= 0 && logView.text.indexOf("ERROR failed") >= 0, true, "Log compression should retain counts and important events")
      ow.test.assert(vm.metrics.structural_json_compressions === 1 && vm.metrics.structural_code_compressions === 1 && vm.metrics.structural_log_compressions === 1, true, "Structural compression types should be independently measurable")
    }, { contextVirtualization: true })

    var calls = 0
    withVm(function(vm) {
      vm.registerContextObject("wiki", "document", new Array(6001).join("semantic source material "))
      var object = vm.objects[vm.objects.length - 1]
      var first = vm.getRepresentation(object.handle, "L2")
      var second = vm.getRepresentation(object.handle, "L2")
      ow.test.assert(first.generatedBy === "semantic" && first.text.indexOf("decision and constraint summary") >= 0, true, "An explicit semantic compressor may provide a cheaper derived representation")
      ow.test.assert(calls === 1 && second.text === first.text && vm.metrics.summary_reuse === 1, true, "Semantic summaries should be versioned and reused from the representation cache")
      ow.test.assert(vm.getRepresentation(object.handle, "L4").content === object.content, true, "Semantic compression must never replace exact L4 backing")
      vm.semanticCompressor = function() { return new Array(1001).join("expensive summary ") }
      var rejected = vm.getRepresentation(object.handle, "L3")
      ow.test.assert(rejected.generatedBy === "deterministic", true, "Semantic output exceeding the scheduled deterministic representation budget must fall back")
    }, {
      contextVirtualization: true,
      semanticCompression: true,
      semanticCompressionMinTokens: 500,
      summarizerVersion: "fake-v1",
      semanticCompressor: function() { calls++; return "decision and constraint summary" }
    })
  }

  exports.testRuntimeUsesActiveContextVirtualizationOnlyWhenNotShadowing = function() {
    var root = String(java.nio.file.Files.createTempDirectory("mini-a-context-active-runtime-").toAbsolutePath())
    try {
      load("mini-a.js")
      var agent = new MiniA()
      agent.setInteractionFn(function() {})
      var args = { historyvm: true, contextvirtualization: true, contextvirtualizationshadow: false, conversation: root + "/conversation.json", maxcontext: 500, goal: "architecture" }
      agent._sessionArgs = args
      agent._initHistoryVm(args)
      var large = new Array(5001).join("archived architecture output ")
      var conversation = [
        { role: "assistant", content: large },
        { role: "assistant", content: large + " second" },
        { role: "assistant", content: large + " third" },
        { role: "user", content: "Current requirement" },
        { role: "assistant", content: "one" },
        { role: "assistant", content: "two" },
        { role: "assistant", content: "three" },
        { role: "assistant", content: "four" },
        { role: "assistant", content: "five" },
        { role: "assistant", content: "six" }
      ]
      var sent = __
      agent.llm = { getGPT: function() { return {
        getConversation: function() { return conversation },
        setConversation: function(value) { sent = value }
      } } }
      ow.test.assert(agent._prepareHistoryVmProjection(1) === true, true, "Runtime projection should complete")
      ow.test.assert(isArray(sent) && sent[0].content.indexOf("[CONTEXT_OBJECT ") === 0, true, "Explicit active Phase 2 should send a multi-resolution provider projection")
      ow.test.assert(agent._historyVm.metrics.collapses === 0 && agent._historyVm.metrics.context_virtualization_active_assemblies === 1, true, "Active Phase 2 should not also run the Phase 1 collapse policy")
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

  exports.testHierarchicalSummariesInvalidateByChildVersion = function() {
    withVm(function(vm) {
      vm.registerContextObject("summary", "project", "Mini-A project")
      var parent = vm.objects[vm.objects.length - 1]
      var parentFullIndex = stringify(vm.objectIndexTerms[parent.handle].L4, __, "")
      var before = vm.getRepresentation(parent.handle, "L2")
      vm.registerContextObject("decision", "architecture", "Named wiki mounts were selected", { parentId: parent.handle })
      var child = vm.objects[vm.objects.length - 1]
      var after = vm.getRepresentation(parent.handle, "L2")
      ow.test.assert(before.text.indexOf(child.handle) < 0 && after.text.indexOf(child.handle) >= 0, true, "Parent summaries should disclose new children")
      ow.test.assert(before.representationSourceHash !== after.representationSourceHash, true, "A child change should deterministically invalidate the parent representation")
      ow.test.assert(vm.metrics.representation_cache_misses === 2, true, "Changed hierarchy summaries should not reuse stale cache entries")
      ow.test.assert(stringify(vm.objectIndexTerms[parent.handle].L4, __, "") === parentFullIndex, true, "Adding a child should refresh only hierarchy-sensitive parent index levels")
    }, { contextVirtualization: true })
  }

  exports.testCoarseToFineContextSearch = function() {
    withVm(function(vm) {
      vm.registerContextObject("summary", "topic", "Storage architecture", { keywords: ["redis"] })
      var parent = vm.objects[vm.objects.length - 1]
      vm.registerContextObject("wiki", "page", "Named mounts isolate tenants", { parentId: parent.handle })
      var child = vm.objects[vm.objects.length - 1]
      var branch = vm.contextSearch("redis", 10, 0, { maxDepth: 2 })
      var branchHandles = branch.results.map(function(item) { return item.handle })
      ow.test.assert(branch.stage === "coarse" && branchHandles.indexOf(parent.handle) >= 0 && branchHandles.indexOf(child.handle) >= 0, true, "Coarse search should descend only into matching hierarchy branches")

      var hidden = new Array(1301).join("x") + " uniquedeepneedle"
      vm.registerContextObject("artifact", "log", hidden)
      var fallback = vm.contextSearch("uniquedeepneedle", 5)
      ow.test.assert(fallback.stage === "detailed_fallback" && fallback.results[0].kind === "artifact" && fallback.results[0].exactMatch === true, true, "Search should fall back to the exact index when cheap representations miss")
      vm.registerContextObject("memory", "note", "ação")
      var unicode = vm.contextSearch("ção", 5)
      ow.test.assert(unicode.stage === "detailed_scan" && unicode.results[0].kind === "memory", true, "Queries outside the lightweight index alphabet should retain exact retrieval")
      var diagnostics = vm.diagnostics()
      ow.test.assert(diagnostics.metrics.hierarchy_searches === 3 && diagnostics.metrics.index_terms.L4 > 0, true, "Hierarchical and multi-resolution index work should be measurable")
    }, { contextVirtualization: true })
  }

  exports.testSectionRangeAndJsonPathReads = function() {
    withVm(function(vm) {
      vm.registerContextObject("wiki", "document", "# Intro\nfirst\n## Architecture\nline one\nline two\n# End\nlast")
      var document = vm.objects[vm.objects.length - 1]
      var section = vm.readContext(document.handle, { section: "Architecture" })
      var lines = vm.readContext(document.handle, { lines: { start: 2, end: 4 } })
      ow.test.assert(section.content === "## Architecture\nline one\nline two", true, "Section reads should stop at the next peer or parent heading")
      ow.test.assert(lines.content === "first\n## Architecture\nline one" && lines.startLine === 2 && lines.endLine === 4, true, "Line reads should use bounded one-based ranges")

      vm.registerContextObject("artifact", "json", { repositories: [{ name: "one" }, { name: "two" }], total_count: 2 })
      var jsonObject = vm.objects[vm.objects.length - 1]
      var jsonValue = vm.readContext(jsonObject.handle, { jsonPath: "repositories[1].name" })
      var grep = vm.readContext(document.handle, { query: "line" })
      ow.test.assert(jsonValue.content === "two", true, "JSON path reads should retrieve a selected exact value without evaluating code")
      ow.test.assert(grep.matches === 2 && grep.content.indexOf("4:line one") >= 0, true, "Context grep should return bounded line-numbered matches")
      ow.test.assert(vm.metrics.context_expansions === 4 && vm.metrics.context_expansion_tokens > 0, true, "Range expansion cost should be tracked separately")
    }, { contextVirtualization: true })
  }

  exports.testContextIndexesUpdateIncrementally = function() {
    withVm(function(vm) {
      for (var i = 0; i < 20; i++) vm.registerContextObject("memory", "note", "entry " + i)
      var before = vm.metrics.index_updates
      vm.registerContextObject("memory", "note", "one additional entry")
      ow.test.assert(vm.metrics.index_updates === before + 1, true, "Appending an unrelated root should update only its index entries")
    }, { contextVirtualization: true })
  }

  exports.testAdaptiveBudgetAndRepresentationSelection = function() {
    withVm(function(vm) {
      vm.registerContextObject("wiki", "architecture", "architecture " + new Array(1201).join("a"), { importance: 1 })
      var relevant = vm.objects[vm.objects.length - 1]
      vm.registerContextObject("artifact", "log", "unrelated " + new Array(1201).join("b"), { importance: 0.1 })
      var unrelated = vm.objects[vm.objects.length - 1]

      var focused = vm.assembleContext({ goal: "architecture", budget: 200, outputReserve: 20, fixedTokens: { system: 30, tools: 20 }, includeRecent: false })
      var focusedHandles = focused.objects.map(function(item) { return item.handle })
      ow.test.assert(focusedHandles.indexOf(relevant.handle) >= 0 && focusedHandles.indexOf(unrelated.handle) < 0, true, "Goal assembly should avoid unrelated objects before spending tokens")
      ow.test.assert(focused.materializedTokens <= focused.budget.materialization && focused.overflow === false, true, "Optional representations should remain inside the materialization budget")
      ow.test.assert(focused.budget.fixedTotal === 50 && focused.budget.materialization === 130, true, "ContextObject allocation should account for fixed system/tool tokens and output reserve")

      vm.registerContextObject("memory", "note", "ação especial")
      var unicodeObject = vm.objects[vm.objects.length - 1]
      var unicodeGoal = vm.assembleContext({ goal: "ção", budget: 100, outputReserve: 10, includeRecent: false })
      ow.test.assert(unicodeGoal.objects[0].handle === unicodeObject.handle, true, "Adaptive assembly should preserve exact matching for goals outside the lightweight index alphabet")

      var pressured = vm.assembleContext({ candidateIds: [relevant.handle, unrelated.handle], budget: 40, outputReserve: 0, includeRecent: false })
      var generous = vm.assembleContext({ candidateIds: [relevant.handle, unrelated.handle], budget: 1000, outputReserve: 100, includeRecent: false })
      var order = { L0: 0, L1: 1, L2: 2, L3: 3, L4: 4 }
      var pressuredRelevant = pressured.objects.filter(function(item) { return item.handle === relevant.handle })[0]
      var generousRelevant = generous.objects.filter(function(item) { return item.handle === relevant.handle })[0]
      ow.test.assert(order[generousRelevant.level] >= order[pressuredRelevant.level], true, "Representation detail should increase only when the budget permits")
      ow.test.assert(isMap(generous.budget.categories) && generous.utilization <= 1, true, "Assembly should expose adaptive category allocations and utilization")
      var selectedTokens = generous.objects.reduce(function(total, item) { return total + item.tokenCost }, 0)
      ow.test.assert(selectedTokens === generous.materializedTokens, true, "Reported materialization must equal the selected representation costs")
    }, { contextVirtualization: true })
  }

  exports.testConsumerSpecificContextViews = function() {
    withVm(function(vm) {
      var historyIds = []
      for (var i = 0; i < 30; i++) {
        vm.registerContextObject("history", "tool_exchange", "task history " + i + " " + new Array(101).join("h"))
        historyIds.push(vm.objects[vm.objects.length - 1].handle)
      }
      var delegated = vm.assembleContext({ consumer: "delegate", candidateIds: historyIds, budget: 5000, outputReserve: 0, includeRecent: false })
      var executed = vm.assembleContext({ consumer: "executor", candidateIds: historyIds, budget: 5000, outputReserve: 0, includeRecent: false })
      ow.test.assert(delegated.objectsSelected === 25 && executed.objectsSelected === 30, true, "Delegated views should project a smaller task-specific working set than executor views")
      ow.test.assert(delegated.objects.every(function(item) { return ["L0", "L1", "L2"].indexOf(item.level) >= 0 }), true, "Delegated history should remain bounded to summary detail even under a generous budget")
      ow.test.assert(executed.objects.some(function(item) { return item.level === "L4" }), true, "Executor views should be able to materialize exact task history when budget permits")

      vm.registerContextObject("artifact", "source", "shared planning input " + new Array(801).join("a"), { importance: 1 })
      var artifact = vm.objects[vm.objects.length - 1]
      vm.registerContextObject("decision", "architecture", "shared planning input " + new Array(801).join("d"), { importance: 1 })
      var decision = vm.objects[vm.objects.length - 1]
      var planned = vm.assembleContext({ consumer: "planner", candidateIds: [artifact.handle, decision.handle], budget: 5000, outputReserve: 0, includeRecent: false })
      var plannedArtifact = planned.objects.filter(function(item) { return item.handle === artifact.handle })[0]
      var plannedDecision = planned.objects.filter(function(item) { return item.handle === decision.handle })[0]
      ow.test.assert(plannedArtifact.level === "L2" && plannedDecision.level === "L4", true, "Planner views should retain decision detail while bounding implementation artifacts")
      ow.test.assert(planned.consumerPolicy.categoryWeights.plan > planned.consumerPolicy.categoryWeights.artifacts, true, "Consumer diagnostics should expose the applied category allocation policy")

      var consumers = ["advisor", "validator", "summarizer", "dreamer"]
      for (var c = 0; c < consumers.length; c++) {
        var view = vm.assembleContext({ consumer: consumers[c], candidateIds: [], budget: 100, outputReserve: 10, includeRecent: false })
        ow.test.assert(view.consumer === consumers[c] && vm.metrics["consumer_views_" + consumers[c]] === 1, true, "Each supported consumer should use and measure its own context policy")
      }
      var fallback = vm.assembleContext({ consumer: "unknown-consumer", candidateIds: [], budget: 100, outputReserve: 10, includeRecent: false })
      ow.test.assert(fallback.consumer === "executor" && vm.metrics.consumer_policy_fallbacks === 1, true, "Unknown consumers should fail safely to the executor policy and remain observable")
    }, { contextVirtualization: true })
  }

  exports.testContextDeltasAndStablePrefixReuse = function() {
    withVm(function(vm) {
      vm.registerContextObject("constraint", "user_requirement", "retain this exact requirement")
      var constraint = vm.objects[vm.objects.length - 1]
      vm.registerContextObject("wiki", "architecture", "virtual context design " + new Array(801).join("w"))
      var wiki = vm.objects[vm.objects.length - 1]
      var first = vm.assembleContext({ consumer: "executor", candidateIds: [wiki.handle], budget: 5000, outputReserve: 0, includeRecent: false })
      var firstSerialized = vm.serializeContext(first)
      var second = vm.assembleContext({ consumer: "executor", candidateIds: [wiki.handle], budget: 5000, outputReserve: 0, includeRecent: false })
      var secondSerialized = vm.serializeContext(second)
      ow.test.assert(first.delta.added.length === 2 && first.stablePrefixTokens > 0, true, "The first working-set assembly should report added mandatory and dynamic objects")
      ow.test.assert(second.delta.unchanged.length === 2 && second.delta.added.length === 0, true, "Repeated assembly should identify an unchanged working set")
      ow.test.assert(firstSerialized.cacheHit === false && secondSerialized.cacheHit === true, true, "Stable prefix serialization should be locally reused without provider delta assumptions")
      ow.test.assert(firstSerialized.stablePrefix.indexOf(constraint.handle) >= 0 && firstSerialized.dynamicWorkingSet.indexOf(wiki.handle) >= 0, true, "Mandatory knowledge should form a stable prefix and task material should remain dynamic")

      var removed = vm.assembleContext({ consumer: "executor", candidateIds: [], budget: 5000, outputReserve: 0, includeRecent: false })
      ow.test.assert(removed.delta.removed.indexOf(wiki.handle) >= 0 && removed.delta.unchanged.indexOf(constraint.handle) >= 0, true, "Working-set deltas should distinguish removed dynamic context from retained stable context")
    }, { contextVirtualization: true })

    withVm(function(vm) {
      vm.registerContextObject("wiki", "architecture", "representation pressure " + new Array(1601).join("x"))
      var wiki = vm.objects[vm.objects.length - 1]
      var low = vm.assembleContext({ candidateIds: [wiki.handle], budget: 20, outputReserve: 0, includeRecent: false })
      var high = vm.assembleContext({ candidateIds: [wiki.handle], budget: 2000, outputReserve: 0, includeRecent: false })
      var lowAgain = vm.assembleContext({ candidateIds: [wiki.handle], budget: 20, outputReserve: 0, includeRecent: false })
      ow.test.assert(high.delta.promoted.indexOf(wiki.handle) >= 0 && lowAgain.delta.demoted.indexOf(wiki.handle) >= 0, true, "Delta tracking should classify representation promotions and demotions")
    }, { contextVirtualization: true })

    withVm(function(vm) {
      vm.registerContextObject("summary", "project", "project hierarchy", {})
      var parent = vm.objects[vm.objects.length - 1]
      vm.assembleContext({ candidateIds: [parent.handle], budget: 200, outputReserve: 0, includeRecent: false, levelCeilings: { summary: "L1" } })
      vm.registerContextObject("wiki", "section", "child section", { parentId: parent.handle })
      var updated = vm.assembleContext({ candidateIds: [parent.handle], budget: 200, outputReserve: 0, includeRecent: false, levelCeilings: { summary: "L1" } })
      ow.test.assert(updated.delta.modified.indexOf(parent.handle) >= 0, true, "Delta tracking should detect hierarchy-driven representation changes")
    }, { contextVirtualization: true })
  }

  exports.testDependencyPrefetchAndHardConstraintOverflow = function() {
    withVm(function(vm) {
      vm.registerContextObject("evidence", "conversation", "supporting evidence")
      var evidence = vm.objects[vm.objects.length - 1]
      vm.registerContextObject("decision", "architecture", "selected architecture", { dependencies: [evidence.handle], importance: 1 })
      var decision = vm.objects[vm.objects.length - 1]
      var assembled = vm.assembleContext({ candidateIds: [decision.handle], budget: 200, outputReserve: 20, includeRecent: false })
      var prefetched = assembled.objects.filter(function(item) { return item.handle === evidence.handle })[0]
      ow.test.assert(isMap(prefetched) && prefetched.prefetched === true && prefetched.level === "L0", true, "Dependencies should be prefetched as cheap addressable references")
      ow.test.assert(vm.metrics.dependency_prefetches === 1, true, "Dependency-aware prefetch should be measurable")

      vm.registerContextObject("constraint", "user_requirement", new Array(401).join("must "))
      var constraint = vm.objects[vm.objects.length - 1]
      var overflow = vm.assembleContext({ candidateIds: [], budget: 20, outputReserve: 5, includeRecent: false })
      var required = overflow.objects.filter(function(item) { return item.handle === constraint.handle })[0]
      ow.test.assert(overflow.overflow === true && isMap(required) && required.level === "L4", true, "Exact hard constraints should report an unsatisfied budget instead of being silently dropped")
      ow.test.assert(overflow.materializedTokens > overflow.budget.materialization && vm.metrics.budget_overflows === 1, true, "Protected-set overflow should remain visible in diagnostics")
    }, { contextVirtualization: true })
  }

  exports.testTypedGraphTraversalAndHeatPropagation = function() {
    withVm(function(vm) {
      vm.registerContextObject("evidence", "test_result", "validation evidence", { provenance: { source: "test" } })
      var evidence = vm.objects[vm.objects.length - 1]
      vm.registerContextObject("decision", "architecture", "selected design", {
        edges: [
          { type: "derived_from", target: evidence.handle, confidence: 0.8, provenance: { event: "review" } },
          { type: "not_allowed", target: evidence.handle }
        ]
      })
      var decision = vm.objects[vm.objects.length - 1]
      var related = vm.getRelated(decision.handle, { direction: "outgoing", edgeTypes: ["derived_from"], maxDepth: 1 })
      ow.test.assert(related.results.length === 1 && related.results[0].handle === evidence.handle, true, "Typed graph traversal should resolve only requested edge types")
      ow.test.assert(related.results[0].via.confidence === 0.8 && related.results[0].via.provenance.event === "review" && related.results[0].provenance.source === "test", true, "Graph results should retain edge and object provenance")
      ow.test.assert(decision.edges.length === 1 && vm.metrics.graph_edges === 1, true, "Unknown graph edge types should be ignored deterministically")

      var heatBefore = evidence.heat
      vm.getRepresentation(decision.handle, "L1")
      ow.test.assert(evidence.heat > heatBefore && vm.metrics.heat_propagations > 0, true, "Consumer access should propagate bounded decaying heat to graph neighbors")
      ow.test.assert(vm.metrics.graph_retrievals === 1 && vm.metrics.graph_nodes_visited === 2, true, "Graph traversal cost should be measurable")
    }, { contextVirtualization: true })
  }

  exports.testSupersessionSuppressesStaleContext = function() {
    withVm(function(vm, conversation) {
      vm.registerContextObject("decision", "architecture", "uniqueoldchoice architecture A")
      var oldDecision = vm.objects[vm.objects.length - 1]
      vm.registerContextObject("decision", "architecture", "architecture B is current", { supersedes: [oldDecision.handle] })
      var currentDecision = vm.objects[vm.objects.length - 1]
      ow.test.assert(oldDecision.obsolete === true && oldDecision.supersededBy === currentDecision.handle, true, "A supersedes edge should mark the older object obsolete without deleting it")

      var search = vm.contextSearch("uniqueoldchoice", 5)
      ow.test.assert(search.results.length === 1 && search.results[0].handle === currentDecision.handle, true, "Default context search should redirect stale matches to their current replacement")
      var historical = vm.contextSearch("uniqueoldchoice", 5, 0, { includeObsolete: true })
      ow.test.assert(historical.results[0].handle === oldDecision.handle && historical.results[0].obsolete !== false, true, "Historical reasoning should be able to request obsolete objects explicitly")
      var assembled = vm.assembleContext({ goal: "uniqueoldchoice", budget: 100, outputReserve: 10, includeRecent: false })
      ow.test.assert(assembled.objects[0].handle === currentDecision.handle, true, "Adaptive assembly should suppress superseded information by default")
      var currentGraph = vm.getRelated(currentDecision.handle, { direction: "outgoing", edgeTypes: ["supersedes"], maxDepth: 1 })
      ow.test.assert(currentGraph.results.length === 0, true, "Graph traversal should suppress obsolete nodes unless historical retrieval is explicit")

      var resumed = new MiniAHistoryVM({ enabled: true, contextVirtualization: true, conversationPath: conversation, conversationId: "test-conversation" })
      var resumedOld = resumed._resolveObject(oldDecision.handle)
      ow.test.assert(resumedOld.obsolete === true && resumedOld.supersededBy === currentDecision.handle, true, "Supersession state should rebuild from canonical graph edges")
      var graph = resumed.getRelated(currentDecision.handle, { direction: "outgoing", edgeTypes: ["supersedes"], includeObsolete: true, maxDepth: 1 })
      ow.test.assert(graph.results.length === 1 && graph.results[0].handle === oldDecision.handle, true, "Supersession provenance should remain traversable after restart")
    }, { contextVirtualization: true })
  }

  exports.testSupersessionDoesNotCrossBranches = function() {
    withVm(function(vm) {
      vm.registerContextObject("decision", "architecture", "decision on the original branch")
      var original = vm.objects[vm.objects.length - 1]
      vm.rewind(0)
      vm.registerContextObject("decision", "architecture", "decision on the active branch", { supersedes: [original.handle] })
      var active = vm.objects[vm.objects.length - 1]
      ow.test.assert(original.branchId !== active.branchId, true, "The regression fixture should create decisions on separate branches")
      ow.test.assert(original.obsolete === false && isUnDef(original.supersededBy), true, "Supersession must not mutate historical state across branch boundaries")
      ow.test.assert(isUnDef(vm.supersededBy[original.handle]), true, "Cross-branch supersession must not enter the active replacement map")
    }, { contextVirtualization: true })
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
