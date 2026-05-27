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
