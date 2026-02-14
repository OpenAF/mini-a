(function() {
  load("mini-a.js")

  var createAgent = function() {
    return new MiniA()
  }

  exports.testCleanCodeBlocks = function() {
    var agent = createAgent()
    var fenced = "```json\n{\"action\":\"final\"}\n```"
    var result = agent._cleanCodeBlocks(fenced)
    ow.test.assert(result === "{\"action\":\"final\"}", true, "Should strip code fences when present")

    var plain = "no fences here"
    ow.test.assert(agent._cleanCodeBlocks(plain) === plain, true, "Should leave plain text untouched")
  }

  exports.testExtractEmbeddedFinalAction = function() {
    var agent = createAgent()
    var payload = "```json\n{\"action\":\"final\",\"answer\":\"done\",\"thought\":\"logic\"}\n```"
    var extracted = agent._extractEmbeddedFinalAction(payload)
    ow.test.assert(isMap(extracted), true, "Should parse embedded final action payload")
    ow.test.assert(extracted.answer === "done", true, "Should capture embedded answer")
    ow.test.assert(extracted.thought === "logic", true, "Should capture embedded thought")

    var missing = agent._extractEmbeddedFinalAction("{\"action\":\"think\"}")
    ow.test.assert(missing === null, true, "Should ignore non-final embedded payloads")
  }

  exports.testBuildToolCacheKeyRespectsKeyFields = function() {
    var agent = createAgent()
    agent._toolCacheSettings.example = { keyFields: ["id", "region"] }

    var paramsBase = { id: 1, region: "us-east", detail: "first" }
    var keyA = agent._buildToolCacheKey("example", paramsBase)
    var keyB = agent._buildToolCacheKey("example", { id: 1, region: "us-east", detail: "second" })
    ow.test.assert(isString(keyA) && keyA.length > 0, true, "Should build cache key")
    ow.test.assert(keyA === keyB, true, "Key should ignore non-key fields")

    var keyC = agent._buildToolCacheKey("example", { id: 2, region: "us-east", detail: "first" })
    ow.test.assert(keyA !== keyC, true, "Key should change when key fields differ")
  }

  exports.testCategorizeErrorDetection = function() {
    var agent = createAgent()
    var transient = agent._categorizeError("Request timeout occurred", {})
    ow.test.assert(transient.type === "transient", true, "Timeout errors should be transient")

    var permanent = agent._categorizeError({ message: "Invalid parameter provided" }, {})
    ow.test.assert(permanent.type === "permanent", true, "Invalid inputs should be permanent errors")

    var forced = agent._categorizeError("Unknown", { forceCategory: "transient" })
    ow.test.assert(forced.type === "transient", true, "Force category should override detection")
  }

  exports.testUpdateErrorHistoryRetention = function() {
    var agent = createAgent()
    var runtime = { errorHistory: [] }

    for (var i = 0; i < 12; i++) {
      agent._updateErrorHistory(runtime, { category: "test", message: "error " + i })
    }

    ow.test.assert(runtime.errorHistory.length === 10, true, "History should retain last 10 entries")
    ow.test.assert(runtime.errorHistory[0].message === "error 2", true, "Oldest retained entry should be error 2")
    ow.test.assert(runtime.errorHistory[9].message === "error 11", true, "Newest entry should be last error")
    ow.test.assert(agent._errorHistory.length === 10, true, "Agent snapshot should mirror runtime history")
  }

  exports.testNormalizeToolResultVariants = function() {
    var agent = createAgent()

    var textResult = agent._normalizeToolResult({ text: "output", error: "fail?" })
    ow.test.assert(textResult.processed === "output", true, "Should extract text from tool result")
    ow.test.assert(textResult.display === "output", true, "Display should match processed text")
    ow.test.assert(textResult.hasError === true, true, "Presence of error field should flag hasError")

    var emptyResult = agent._normalizeToolResult()
    ow.test.assert(emptyResult.processed === "(no output)", true, "Undefined results should produce placeholder text")
    ow.test.assert(emptyResult.display === "(no output)", true, "Display should indicate missing output")
    ow.test.assert(emptyResult.hasError === false, true, "Missing error field should not flag hasError")
  }

  exports.testUtilsMcpSkillsToggle = function() {
    var agent = createAgent()

    var disabled = agent._createUtilsMcpConfig({ useskills: false })
    ow.test.assert(isMap(disabled) && isMap(disabled.options), true, "Should build utils MCP config with useskills=false")
    ow.test.assert(isUnDef(disabled.options.fns.skills), true, "Should hide skills tool when useskills=false")
    ow.test.assert(isUnDef(disabled.options.fnsMeta.skills), true, "Should hide skills metadata when useskills=false")

    var enabled = agent._createUtilsMcpConfig({ useskills: true })
    ow.test.assert(isMap(enabled) && isMap(enabled.options), true, "Should build utils MCP config with useskills=true")
    ow.test.assert(isDef(enabled.options.fns.skills), true, "Should expose skills tool when useskills=true")
    ow.test.assert(isDef(enabled.options.fnsMeta.skills), true, "Should expose skills metadata when useskills=true")
  }
})()
