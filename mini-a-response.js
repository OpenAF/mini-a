// Author: Nuno Aguiar
// License: Apache 2.0
// Description: Response parsing and normalization helpers for MiniA.

MiniA.prototype._cleanCodeBlocks = function(text) {
    return __miniACleanCodeBlocks(text)
}

MiniA.prototype._repairJsonString = function(jsonString) {
  return __miniARepairJsonString(jsonString)
}

MiniA.prototype._parseModelJsonResponse = function(rawResponse) {
    if (isMap(rawResponse)) {
        var recoveredDirect = this._extractJsonActionFromPseudoToolCall(rawResponse)
        if (isMap(recoveredDirect) || isArray(recoveredDirect)) return recoveredDirect
        return rawResponse
    }
    if (isArray(rawResponse)) return rawResponse
    if (!isString(rawResponse)) return __

    var candidates = []
    var seen = {}
    var addCandidate = function(value) {
        if (!isString(value)) return
        var candidate = String(value).trim()
        if (candidate.length === 0) return
        if (seen[candidate]) return
        seen[candidate] = true
        candidates.push(candidate)
    }

    var self = this
    var parseCandidate = function(candidate) {
        if (!isString(candidate)) return __
        var parsed = self._parseJsonCandidate(candidate)
        if (!(isMap(parsed) || isArray(parsed))) {
          var repaired = self._repairJsonString(candidate)
          if (repaired !== candidate) parsed = self._parseJsonCandidate(repaired)
        }
        if (!(isMap(parsed) || isArray(parsed))) return parsed
        var recovered = self._extractJsonActionFromPseudoToolCall(parsed)
        if (isMap(recovered) || isArray(recovered)) return recovered
        return parsed
    }

    addCandidate(rawResponse)
    addCandidate(this._cleanCodeBlocks(rawResponse))

    if (rawResponse.indexOf("```") >= 0) {
        var _fencedRe = /```(?:json|js|javascript)?\s*\n([\s\S]*?)\n```/g
        var _fencedMatch
        while ((_fencedMatch = _fencedRe.exec(rawResponse)) !== null) addCandidate(_fencedMatch[1].trim())
    }

    candidates.forEach(function(candidate) {
        if (candidate.indexOf("\n{") >= 0) {
            var objectMatches = candidate.match(/\{[\s\S]*\}/g)
            if (isArray(objectMatches) && objectMatches.length > 0) addCandidate(objectMatches[objectMatches.length - 1])
        }
        if (candidate.indexOf("\n[") >= 0) {
            var arrayMatches = candidate.match(/\[[\s\S]*\]/g)
            if (isArray(arrayMatches) && arrayMatches.length > 0) addCandidate(arrayMatches[arrayMatches.length - 1])
        }
    })

    for (var i = 0; i < candidates.length; i++) {
        var parsed = parseCandidate(candidates[i])
        if (isMap(parsed) || isArray(parsed)) return parsed
    }

    if (isString(rawResponse) && rawResponse.length > 0) {
      var debugMsg = "JSON parsing failed after repair attempts. Raw: " + (rawResponse.length > 300 ? rawResponse.substring(0, 300) + "..." : rawResponse)
      if (isFunction(this._debugOut)) this._debugOut("JSON_PARSE_FAILURE", debugMsg)
    }
    return __
}

MiniA.prototype._extractResponseTextCandidates = function(rawResponse) {
    return __miniAExtractResponseTextCandidates(rawResponse)
}

MiniA.prototype._extractPrimaryResponseText = function(rawResponse) {
    var candidates = this._extractResponseTextCandidates(rawResponse)
    if (isArray(candidates) && candidates.length > 0) return candidates[0]
    return rawResponse
}

MiniA.prototype._extractStructuredThinkingTexts = function(rawResponse) {
    return __miniAExtractStructuredThinkingTexts(rawResponse)
}

MiniA.prototype._parseJsonCandidate = function(rawText) {
    return __miniAParseJsonCandidate(rawText, this._repairJsonString.bind(this))
}

MiniA.prototype._extractThinkingBlocksFromResponse = function(rawResponse) {
    var candidates = this._extractResponseTextCandidates(rawResponse)
    var contentMatches = []
    var seen = {}
    var normalizeThinkingContent = function(value) {
        var text = (value || "").toString().trim()
        if (text.length === 0) return ""
        var wrappedMatch = text.match(/^<\s*([a-zA-Z0-9_-]+)(?:\s[^>]*)?>([\s\S]*?)<\/\s*\1\s*>$/)
        if (isArray(wrappedMatch) && wrappedMatch.length >= 3 && _MINI_A_THINKING_TAGS[_MINI_A_TAG_NORM(wrappedMatch[1])]) text = (wrappedMatch[2] || "").toString().trim()
        return text
    }

    var structured = this._extractStructuredThinkingTexts(rawResponse)
    structured.forEach(function(block) {
        var trimmed = normalizeThinkingContent(block)
        if (trimmed.length > 0 && !seen[trimmed]) { seen[trimmed] = true; contentMatches.push(trimmed) }
    })

    if (isArray(candidates) && candidates.length > 0) {
        var tagPattern = /<\s*([a-zA-Z0-9_-]+)(?:\s[^>]*)?>([\s\S]*?)<\/\s*\1\s*>/g
        candidates.join("\n").replace(tagPattern, function(match, tag, content) {
            if (!_MINI_A_THINKING_TAGS[_MINI_A_TAG_NORM(tag)]) return match
            var trimmed = normalizeThinkingContent(content)
            if (trimmed.length > 0 && !seen[trimmed]) { seen[trimmed] = true; contentMatches.push(trimmed) }
            return match
        })
    }

    return contentMatches
}

MiniA.prototype._logThinkingBlocks = function(rawResponse) {
    var blocks = this._extractThinkingBlocksFromResponse(rawResponse)
    if (!isArray(blocks) || blocks.length === 0) return
    blocks.forEach(function(block) {
        this._logMessageWithCounter("thought", block)
        if (isObject(global.__mini_a_metrics) && isObject(global.__mini_a_metrics.thoughts_made)) global.__mini_a_metrics.thoughts_made.inc()
    }.bind(this))
}

MiniA.prototype._stripThinkingTagsFromString = function(text) {
    return __miniAStripThinkingTagsFromString(text, _MINI_A_THINKING_TAGS, _MINI_A_TAG_NORM)
}

MiniA.prototype._extractEmbeddedFinalAction = function(answerPayload) {
    return __miniAExtractEmbeddedFinalAction(answerPayload, this._cleanCodeBlocks.bind(this))
}

// Keep recovery calls consistent with the initial turn's provider constraints.
MiniA.prototype._promptJsonRecovery = function(llm, prompt, args, modelConfig, noJsonPrompt) {
  var jsonFlag = !noJsonPrompt && !this._shouldDisableStreamingForOllamaToolCallTurn(modelConfig, this._useToolsActual === true, !noJsonPrompt)
  if (args.showthinking) {
    if (jsonFlag && isFunction(llm.promptJSONWithStatsRaw)) return llm.promptJSONWithStatsRaw(prompt)
    if (isFunction(llm.rawPromptWithStats)) return llm.rawPromptWithStats(prompt, __, __, jsonFlag)
  }
  if (jsonFlag && isFunction(llm.promptJSONWithStats)) return llm.promptJSONWithStats(prompt)
  return llm.promptWithStats(prompt)
}

MiniA.prototype._buildJsonRetryPrompt = function(prompt) {
  return prompt + '\n\n[JSON RETRY NOTE] The previous response could not be parsed. Return one complete JSON object only, with "thought" and one "action". For a final answer use {"thought":"done","action":"final","answer":"your answer"}. For a tool action use an available action name and an object in "params"; shell uses top-level "command". Include only fields needed for the chosen action. Escape quotes, backslashes and newlines inside strings. No trailing commas, markdown fences or extra prose. Keep the response concise.'
}

// This MCP accepts data only. Execution remains in the normal Mini-A dispatcher.
MiniA.prototype._createReplyCaptureMcpConfig = function(args, capture) {
  var actions = String(this._actionsList || "think | final").replace(/\s*\(.*$/, "").split("|").map(function(s) { return s.trim() }).filter(function(s) { return s.length > 0 })
  if (args.useshell !== true) actions = actions.filter(function(s) { return s !== "shell" })
  var props = {
    thought: { type: "string" },
    action: { type: "string", enum: actions },
    answer: { type: "string" },
    params: { type: "object" },
    state: { type: "object" }
  }
  if (args.useshell === true) props.command = { type: "string" }
  return { type: "dummy", shared: false, options: {
    name: "mini-a-reply-capture",
    fnsMeta: { submit_reply: { name: "submit_reply", description: "Submit one Mini-A reply. This tool does not execute actions.", inputSchema: {
      type: "object", properties: props, required: ["thought", "action"], additionalProperties: false
    } } },
    fns: { submit_reply: function(payload) {
      if (!isMap(payload) || !isString(payload.thought) || !isString(payload.action) || actions.indexOf(payload.action) < 0) throw new Error("Invalid reply action")
      if (Object.keys(payload).some(function(k) { return !Object.prototype.hasOwnProperty.call(props, k) })) throw new Error("Unexpected reply field")
      if (isDef(payload.params) && !isMap(payload.params)) throw new Error("Reply params must be an object")
      if (isDef(payload.state) && !isMap(payload.state)) throw new Error("Reply state must be an object")
      if (isDef(payload.answer) && !isString(payload.answer)) throw new Error("Reply answer must be a string")
      if (isDef(payload.command) && !isString(payload.command)) throw new Error("Reply command must be a string")
      if (payload.action === "final" && (!isString(payload.answer) || !payload.answer.trim())) throw new Error("Final reply needs an answer")
      if (payload.action === "shell" && (!isString(payload.command) || !payload.command.trim())) throw new Error("Shell reply needs a command")
      if (["think", "final", "shell"].indexOf(payload.action) < 0 && !isMap(payload.params)) throw new Error("Tool reply needs params")
      if (capture.accepted) throw new Error("Only one reply is allowed")
      capture.payload = jsonParse(stringify(payload, __, ""), __, __, true)
      capture.accepted = true
      return { content: [{ type: "text", text: "Reply captured." }] }
    } }
  } }
}

MiniA.prototype._promptLcReplyTool = function(prompt, args, modelConfig) {
  // The adapter hook below is deliberately limited to the two inspected adapters.
  // Return undefined before any request when unsupported, preserving text recovery.
  if (!isMap(modelConfig) || ["openai", "ollama"].indexOf(modelConfig.type) < 0) return __
  var config = jsonParse(stringify(modelConfig, __, ""), __, __, true)
  config.params = isMap(config.params) ? config.params : {}
  delete config.params.tools
  delete config.params.response_format
  config.params.stream = false
  if (config.type === "openai") {
    config.params.tool_choice = { type: "function", function: { name: "submit_reply" } }
    config.params.parallel_tool_calls = false
  } else {
    delete config.params.tool_choice
    delete config.params.format
  }
  var llm = this._createBareLlmInstance(config, this._debuglcchConfig, "__mini_a_lc_reply_debug", "LC reply recovery")
  if (!isObject(llm) || !isFunction(llm.getGPT) || !isFunction(llm.withMcpTools) || !isFunction(llm.rawPromptWithStats)) return __
  if (isString(this._systemInst) && isFunction(llm.withInstructions)) {
    llm.withInstructions(this._systemInst + "\nFor this recovery turn, submit the reply through submit_reply instead of emitting JSON text. All existing goal and permission rules still apply.")
  }
  var adapter = llm.getGPT().model
  if (!isObject(adapter) || !isFunction(adapter._request)) return __
  var capture = { accepted: false }
  var client = $mcp(this._createReplyCaptureMcpConfig(args, capture))
  var request = adapter._request
  var requested = false
  try {
    client.initialize()
    llm.withMcpTools(client, ["submit_reply"])
    // Intercept the raw response before OpenAF's automatic tool loop. Capture only
    // a single named call, then hide tool calls from the isolated adapter so it
    // records the original usage without issuing a follow-up model request.
    adapter._request = function() {
      if (requested) throw new Error("Reply recovery allows only one provider request")
      requested = true
      global.__mini_a_metrics.lc_reply_tool_attempts.inc()
      var raw = request.apply(adapter, arguments)
      var response = jsonParse(stringify(raw, __, ""), __, __, true)
      var calls = []
      if (config.type === "openai" && isMap(response) && isArray(response.choices)) {
        response.choices.forEach(function(choice) {
          if (isMap(choice.message) && isArray(choice.message.tool_calls)) calls = calls.concat(choice.message.tool_calls)
          choice.message = { role: "assistant", content: "" }
          choice.finish_reason = "stop"
        })
      } else if (config.type === "ollama" && isMap(response) && isMap(response.message)) {
        if (isArray(response.message.tool_calls)) calls = response.message.tool_calls
        response.message = { role: "assistant", content: "" }
      }
      if (calls.length === 1 && isMap(calls[0].function) && calls[0].function.name === "submit_reply") {
        var payload = calls[0].function.arguments
        if (isString(payload)) { try { payload = JSON.parse(payload) } catch(ignoreInvalidJson) { payload = __ } }
        try { client.callTool("submit_reply", payload) } catch(ignoreInvalidReply) {}
      }
      return response
    }
    var result = llm.rawPromptWithStats(prompt + '\n\n[REPLY TOOL RECOVERY] Submit the next reply by calling submit_reply exactly once. Use one action, not an array. Do not execute tools or commands. Put the complete final answer in the answer string, or the chosen action inputs in params (shell uses command).', __, __, false)
    if (capture.accepted) global.__mini_a_metrics.lc_reply_tool_successes.inc()
    return { response: capture.accepted ? capture.payload : "", stats: result.stats }
  } finally {
    adapter._request = request
    try { client.destroy() } catch(ignoreDestroy) {}
  }
}
