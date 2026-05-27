// Author: Nuno Aguiar
// License: Apache 2.0
// Description: Dynamic MCP tool selection helpers for MiniA.

MiniA.prototype._stemWord = function(word) {
  return __miniAStemWord(word)
}

MiniA.prototype._levenshteinDistance = function(a, b) {
  return __miniALevenshteinDistance(a, b)
}

MiniA.prototype._selectToolsByKeywordMatch = function(goal, allTools) {
  if (!isString(goal) || !isArray(allTools) || allTools.length === 0) {
    return []
  }

  var stopwords = ["the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by", "from", "as", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "should", "could", "may", "might", "must", "can", "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them", "my", "your", "his", "its", "our", "their", "this", "that", "these", "those", "what", "which", "who", "when", "where", "why", "how", "all", "each", "every", "some", "any", "few", "more", "most", "other", "such", "only", "own", "same", "than", "too", "very", "just", "now", "then", "here", "there", "also", "please", "want", "need", "like", "make", "use", "using"]
  var actionVerbs = ["create", "delete", "remove", "update", "modify", "edit", "change", "add", "insert", "fetch", "get", "retrieve", "find", "search", "query", "list", "show", "display", "read", "write", "save", "load", "open", "close", "execute", "run", "build", "compile", "deploy", "install", "download", "upload", "send", "receive", "parse", "convert", "transform", "analyze", "process", "generate", "validate", "check", "test", "debug", "fix", "scan", "browse", "navigate", "connect", "disconnect", "start", "stop", "pause", "resume", "rename", "move", "copy", "sync"]
  var synonymGroups = [
    ["search", "find", "lookup", "query", "locate", "discover"],
    ["create", "make", "generate", "build", "produce", "construct"],
    ["delete", "remove", "erase", "clear", "purge", "destroy"],
    ["update", "modify", "change", "edit", "alter", "revise"],
    ["file", "document", "data", "record"],
    ["folder", "directory", "path"],
    ["read", "view", "open", "display", "show", "see"],
    ["write", "save", "store", "persist"],
    ["list", "enumerate", "catalog", "index"],
    ["run", "execute", "launch", "start", "invoke"],
    ["download", "fetch", "pull", "retrieve"],
    ["upload", "push", "send", "submit"],
    ["web", "internet", "online", "http", "url"],
    ["database", "db", "datastore", "storage"],
    ["analyze", "examine", "inspect", "review", "check"],
    ["convert", "transform", "translate", "encode", "decode"],
    ["image", "picture", "photo", "graphic", "img"],
    ["text", "string", "content", "body"],
    ["code", "script", "program", "source"]
  ]
  var entityPatterns = [
    { pattern: /\.(json|xml|csv|yaml|yml|txt|md|html|css|js|ts|py|java|rb|go|rs|c|cpp|h|sql|sh|bash)/, type: "filetype" },
    { pattern: /\b(python|javascript|typescript|java|ruby|golang|rust|cpp|c\+\+|php|swift|kotlin|scala|perl|shell|bash|powershell)\b/i, type: "language" },
    { pattern: /\b(git|github|gitlab|docker|kubernetes|aws|azure|gcp|jenkins|terraform|ansible)\b/i, type: "devtool" },
    { pattern: /\b(react|vue|angular|svelte|next|nuxt|express|flask|django|spring|rails)\b/i, type: "framework" },
    { pattern: /\b(mysql|postgres|postgresql|mongodb|redis|elasticsearch|sqlite|oracle|mssql)\b/i, type: "database" },
    { pattern: /\b(http|https|api|rest|graphql|websocket|grpc|soap)\b/i, type: "protocol" }
  ]

  var goalLower = goal.toLowerCase()
  var extractedEntities = []
  entityPatterns.forEach(function(ep) {
    var matches = goalLower.match(ep.pattern)
    if (matches) {
      matches.forEach(function(m) { extractedEntities.push({ value: m.toLowerCase().replace(/^\./, ""), type: ep.type }) })
    }
  })

  var tokens = goal
    .toLowerCase()
    .replace(/[^a-z0-9\s.]/g, " ")
    .split(/\s+/)
    .map(function(w, idx) { return { word: w, position: idx } })
    .filter(function(t) { return t.word.length > 2 && stopwords.indexOf(t.word) < 0 })

  var keywords = tokens.map(function(t) {
    var stemmed = __miniAStemWord(t.word)
    var isAction = actionVerbs.indexOf(t.word) >= 0 || actionVerbs.indexOf(stemmed) >= 0
    var positionWeight = 1 + (1 / (t.position + 1)) * 0.5
    return {
      original: t.word,
      stemmed: stemmed,
      isAction: isAction,
      position: t.position,
      positionWeight: positionWeight
    }
  })

  var ngrams = []
  for (var i = 0; i < tokens.length - 1; i++) {
    var bigram = tokens[i].word + " " + tokens[i + 1].word
    ngrams.push({ text: bigram, n: 2, position: tokens[i].position })
    if (i < tokens.length - 2) {
      var trigram = bigram + " " + tokens[i + 2].word
      ngrams.push({ text: trigram, n: 3, position: tokens[i].position })
    }
  }

  if (keywords.length === 0) return []

  var getSynonyms = function(word) {
    var syns = [word]
    for (var i = 0; i < synonymGroups.length; i++) {
      if (synonymGroups[i].indexOf(word) >= 0) return synonymGroups[i]
    }
    return syns
  }

  var scoredTools = allTools.map(function(tool) {
    var score = 0
    var toolNameLower = (tool.name || "").toLowerCase()
    var toolDescLower = (tool.description || "").toLowerCase()
    var toolText = toolNameLower + " " + toolDescLower

    var toolNameWords = toolNameLower.replace(/[^a-z0-9\s]/g, " ").split(/[_\s-]+/).filter(function(w) { return w.length > 2 }).map(function(w) { return __miniAStemWord(w) })
    var toolDescWords = toolDescLower.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(function(w) { return w.length > 2 }).map(function(w) { return __miniAStemWord(w) })

    ngrams.forEach(function(ng) {
      if (toolText.indexOf(ng.text) >= 0) score += ng.n === 3 ? 30 : 20
    })

    extractedEntities.forEach(function(entity) {
      if (toolText.indexOf(entity.value) >= 0) score += 25
      if (isMap(tool.inputSchema) && isMap(tool.inputSchema.properties)) {
        var paramsText = JSON.stringify(tool.inputSchema.properties).toLowerCase()
        if (paramsText.indexOf(entity.value) >= 0) score += 15
      }
    })

    keywords.forEach(function(kw) {
      var kwSynonyms = getSynonyms(kw.stemmed)
      var matchFound = false

      toolNameWords.forEach(function(toolWord) {
        if (toolWord === kw.stemmed || kwSynonyms.indexOf(toolWord) >= 0) {
          var baseScore = kw.isAction ? 20 : 15
          score += baseScore * kw.positionWeight
          matchFound = true
        } else if (toolWord.indexOf(kw.stemmed) >= 0 || kw.stemmed.indexOf(toolWord) >= 0) {
          score += 8 * kw.positionWeight
          matchFound = true
        } else {
          var distance = __miniALevenshteinDistance(toolWord, kw.stemmed)
          if (distance <= 2 && Math.min(toolWord.length, kw.stemmed.length) >= 5) {
            score += 6 * kw.positionWeight
            matchFound = true
          }
        }
      })

      if (!matchFound) {
        toolDescWords.forEach(function(descWord) {
          if (descWord === kw.stemmed || kwSynonyms.indexOf(descWord) >= 0) {
            score += (kw.isAction ? 5 : 4) * kw.positionWeight
            matchFound = true
          }
        })
      }

      if (toolText.indexOf(kw.original) >= 0) score += 3 * kw.positionWeight
    })

    if (isMap(tool.inputSchema) && isMap(tool.inputSchema.properties)) {
      var paramNames = Object.keys(tool.inputSchema.properties).join(" ").toLowerCase()
      keywords.forEach(function(kw) {
        if (paramNames.indexOf(kw.stemmed) >= 0) score += 5
      })
    }

    var matchedKeywordCount = 0
    keywords.forEach(function(kw) {
      if (toolText.indexOf(kw.stemmed) >= 0 || toolText.indexOf(kw.original) >= 0) matchedKeywordCount++
    })
    if (matchedKeywordCount > 1) {
      var coverage = matchedKeywordCount / keywords.length
      score += coverage * 10
    }

    return { tool: tool, score: score }
  })

  return scoredTools.filter(function(st) { return st.score > 0 }).sort(function(a, b) { return b.score - a.score }).map(function(st) { return st.tool.name })
}

MiniA.prototype._selectToolsByLLM = function(goal, allTools, llmInstance) {
  if (!isString(goal) || !isArray(allTools) || allTools.length === 0 || isUnDef(llmInstance)) return []

  try {
    var toolsList = allTools.map(function(tool, idx) {
      return (idx + 1) + ". " + tool.name + ": " + (tool.description || "No description")
    }).join("\n")

    var prompt = "You are a tool selection assistant. Given a user goal and a list of available tools, select which tools are most relevant to achieve the goal.\n\nUser Goal: " + goal + "\n\nAvailable Tools:\n" + toolsList + "\n\nInstructions:\n- Analyze the goal and identify which tools would be helpful\n- Only select tools that are clearly relevant to the goal\n- If the goal is simple and doesn't need any tools, return an empty list\n- Return ONLY a JSON array of tool names, nothing else\n- Format: [\"tool_name1\", \"tool_name2\"]\n- If no tools are relevant, return: []\n\nSelected tools (JSON array only):"
    var response = llmInstance.prompt(prompt)
    if (!isString(response)) return []

    response = response.trim()
    var jsonMatch = response.match(/```(?:json)?\s*(\[[^\]]*\])\s*```/)
    if (jsonMatch) {
      response = jsonMatch[1]
    } else if (response.indexOf("[") >= 0) {
      var startIdx = response.indexOf("[")
      var endIdx = response.lastIndexOf("]")
      if (startIdx >= 0 && endIdx > startIdx) response = response.substring(startIdx, endIdx + 1)
    }

    var selectedTools = JSON.parse(response)
    if (!isArray(selectedTools)) return []
    var validToolNames = allTools.map(function(t) { return t.name })
    return selectedTools.filter(function(name) { return validToolNames.indexOf(name) >= 0 })
  } catch (e) {
    this.fnI("warn", "LLM tool selection failed: " + __miniAErrMsg(e))
    return []
  }
}

MiniA.prototype._ensureMcpConnectionMetadata = function(connectionId, config, index) {
  if (!isString(connectionId) || connectionId.length === 0) return
  if (!isObject(this._mcpConnectionAliases)) this._mcpConnectionAliases = {}
  if (!isObject(this._mcpConnectionAliasToId)) this._mcpConnectionAliasToId = {}
  if (!isObject(this._mcpConnectionInfo)) this._mcpConnectionInfo = {}

  var alias = this._mcpConnectionAliases[connectionId]
  if (!isString(alias) || alias.length === 0) {
    var nextIndex = Object.keys(this._mcpConnectionAliases).length + 1
    alias = "conn" + nextIndex
    while (isString(this._mcpConnectionAliasToId[alias])) {
      nextIndex += 1
      alias = "conn" + nextIndex
    }
    this._mcpConnectionAliases[connectionId] = alias
    this._mcpConnectionAliasToId[alias] = connectionId
  }

  var info = isObject(this._mcpConnectionInfo[connectionId]) ? this._mcpConnectionInfo[connectionId] : {}
  info.alias = this._mcpConnectionAliases[connectionId]
  info.label = this._deriveMcpConnectionLabel(config, index)
  info.description = this._describeMcpConnection(config)
  this._mcpConnectionInfo[connectionId] = info
}

MiniA.prototype._deriveMcpConnectionLabel = function(config, index) {
  if (isMap(config)) {
    var candidates = []
    if (isString(config.name) && config.name.trim().length > 0) candidates.push(config.name.trim())
    if (isString(config.id) && config.id.trim().length > 0) candidates.push(config.id.trim())
    if (isObject(config.serverInfo)) {
      if (isString(config.serverInfo.title) && config.serverInfo.title.trim().length > 0) candidates.push(config.serverInfo.title.trim())
      else if (isString(config.serverInfo.name) && config.serverInfo.name.trim().length > 0) candidates.push(config.serverInfo.name.trim())
    }
    if (isString(config.description) && config.description.trim().length > 0) candidates.push(config.description.trim())
    if (isString(config.cmd) && config.cmd.trim().length > 0) candidates.push(config.cmd.trim())
    if (isString(config.url) && config.url.trim().length > 0) candidates.push(config.url.trim())
    if (isString(config.path) && config.path.trim().length > 0) candidates.push(config.path.trim())
    if (candidates.length > 0) return candidates[0]
  }
  return "Connection #" + (index + 1)
}

MiniA.prototype._describeMcpConnection = function(config) {
  if (!isMap(config)) return ""
  var details = []
  if (isObject(config.serverInfo)) {
    if (isString(config.serverInfo.name) && config.serverInfo.name.trim().length > 0) details.push("server=" + config.serverInfo.name.trim())
    if (isString(config.serverInfo.title) && config.serverInfo.title.trim().length > 0) details.push("title=" + config.serverInfo.title.trim())
    if (isString(config.serverInfo.version) && config.serverInfo.version.trim().length > 0) details.push("version=" + config.serverInfo.version.trim())
  }
  if (isString(config.description) && config.description.trim().length > 0) details.push(config.description.trim())
  if (isString(config.cmd) && config.cmd.trim().length > 0) details.push("cmd=" + config.cmd.trim())
  if (isString(config.url) && config.url.trim().length > 0) details.push("url=" + config.url.trim())
  if (isString(config.path) && config.path.trim().length > 0) details.push("path=" + config.path.trim())
  var summary = details.join(", ")
  if (summary.length > 200) summary = summary.substring(0, 197) + "..."
  return summary
}

MiniA.prototype._selectConnectionAndToolsByLLM = function(goal, allTools, llmInstance) {
  if (!isString(goal) || goal.trim().length === 0 || !isArray(allTools) || allTools.length === 0 || isUnDef(llmInstance)) return []

  var parent = this
  var groupedByConnection = {}
  var connectionOrder = []

  allTools.forEach(function(tool) {
    var connectionId = parent.mcpToolToConnection[tool.name]
    if (!isString(connectionId) || connectionId.length === 0) return
    if (isUnDef(groupedByConnection[connectionId])) {
      groupedByConnection[connectionId] = []
      connectionOrder.push(connectionId)
    }
    groupedByConnection[connectionId].push(tool)
  })

  if (connectionOrder.length === 0) return []

  var connectionSummaries = connectionOrder.map(function(connectionId, idx) {
    var info = isObject(parent._mcpConnectionInfo) ? parent._mcpConnectionInfo[connectionId] : {}
    var alias = isString(info.alias) && info.alias.length > 0
      ? info.alias
      : (isObject(parent._mcpConnectionAliases) && isString(parent._mcpConnectionAliases[connectionId]) ? parent._mcpConnectionAliases[connectionId] : connectionId.substring(0, 8))
    var label = isString(info.label) && info.label.length > 0 ? info.label : "Connection #" + (idx + 1)
    var description = isString(info.description) && info.description.length > 0 ? info.description : ""

    var header = (idx + 1) + ". Connection " + alias + " — " + label + " (id: " + connectionId.substring(0, 8) + ")"
    var lines = [header]
    if (description.length > 0) lines.push("   Summary: " + description)
    lines.push("   Tools:")
    groupedByConnection[connectionId].forEach(function(tool) {
      var toolDesc = isString(tool.description) && tool.description.trim().length > 0 ? tool.description.trim() : "No description provided"
      lines.push("   - " + tool.name + ": " + toolDesc)
    })
    return lines.join("\n")
  }).join("\n\n")

  var prompt = "You are helping Mini-A choose which MCP connection and tool(s) to register for a user's goal.\n\nGoal:\n" + goal + "\n\nAvailable connections and tools:\n" + connectionSummaries + "\n\nInstructions:\n- Choose the single connection that best supports the goal.\n- Only include tools that belong to the selected connection.\n- If no connection is useful, respond with connection set to null and tools as [].\n- Respond ONLY with valid JSON following this schema:\n{\n  \"connection\": \"<connection alias or id>\",\n  \"tools\": [\"tool_name1\", \"tool_name2\"]\n}\n\nJSON response:"
  var response = llmInstance.prompt(prompt)
  if (!isString(response)) return []

  response = response.trim()
  var jsonMatch = response.match(/```(?:json)?\s*({[\s\S]*})\s*```/)
  if (jsonMatch) {
    response = jsonMatch[1]
  } else {
    var startIdx = response.indexOf("{")
    var endIdx = response.lastIndexOf("}")
    if (startIdx >= 0 && endIdx > startIdx) response = response.substring(startIdx, endIdx + 1)
  }

  var parsed
  try {
    parsed = JSON.parse(response)
  } catch (e) {
    this.fnI("warn", "Connection-level LLM selection returned invalid JSON: " + __miniAErrMsg(e))
    return []
  }
  if (!isMap(parsed)) return []

  var selectedConnectionKey = parsed.connection
  var selectedConnectionId = __

  if (isString(selectedConnectionKey) && selectedConnectionKey.trim().length > 0) {
    var normalized = selectedConnectionKey.trim()
    if (isObject(this._mcpConnectionAliasToId) && isString(this._mcpConnectionAliasToId[normalized])) selectedConnectionId = this._mcpConnectionAliasToId[normalized]
    if (isUnDef(selectedConnectionId) && isDef(groupedByConnection[normalized])) selectedConnectionId = normalized

    if (isUnDef(selectedConnectionId)) {
      normalized = normalized.toLowerCase()
      connectionOrder.some(function(connectionId) {
        if (isDef(selectedConnectionId)) return true
        if (connectionId.toLowerCase() === normalized || connectionId.substring(0, normalized.length).toLowerCase() === normalized) {
          selectedConnectionId = connectionId
          return true
        }
        var info = isObject(parent._mcpConnectionInfo) ? parent._mcpConnectionInfo[connectionId] : {}
        if (isString(info.alias) && info.alias.toLowerCase() === normalized) {
          selectedConnectionId = connectionId
          return true
        }
        if (isString(info.label) && info.label.toLowerCase() === normalized) {
          selectedConnectionId = connectionId
          return true
        }
        return false
      })
    }
  }

  if (isUnDef(selectedConnectionId) || isUnDef(groupedByConnection[selectedConnectionId])) return []

  var candidateTools = isArray(parsed.tools) ? parsed.tools : []
  var validToolNames = groupedByConnection[selectedConnectionId].map(function(tool) { return tool.name })
  var filteredTools = candidateTools.filter(function(name) { return validToolNames.indexOf(name) >= 0 })
  if (filteredTools.length === 0) filteredTools = validToolNames
  return filteredTools
}

MiniA.prototype._selectMcpToolsDynamically = function(goal, allTools) {
  if (!isArray(allTools) || allTools.length === 0) return []

  this.fnI("mcp", "Analyzing goal to dynamically select relevant tools from " + allTools.length + " available...")
  if (isObject(global.__mini_a_metrics) && isObject(global.__mini_a_metrics.tool_selection_dynamic_used)) global.__mini_a_metrics.tool_selection_dynamic_used.inc()

  var keywordSelected = this._selectToolsByKeywordMatch(goal, allTools)
  if (keywordSelected.length > 0) {
    if (isObject(global.__mini_a_metrics) && isObject(global.__mini_a_metrics.tool_selection_keyword)) global.__mini_a_metrics.tool_selection_keyword.inc()
    this.fnI("done", "Selected " + keywordSelected.length + " tool(s) via keyword matching: " + keywordSelected.join(", "))
    return keywordSelected
  }

  this.fnI("mcp", "Keyword matching found no clear matches, trying LLM-based selection...")

  if (this._use_lc && isDef(this.lc_llm)) {
    try {
      var lcSelected = this._selectToolsByLLM(goal, allTools, this.lc_llm)
      if (lcSelected.length > 0) {
        if (isObject(global.__mini_a_metrics) && isObject(global.__mini_a_metrics.tool_selection_llm_lc)) global.__mini_a_metrics.tool_selection_llm_lc.inc()
        this.fnI("done", "Selected " + lcSelected.length + " tool(s) via low-cost LLM: " + lcSelected.join(", "))
        return lcSelected
      }
    } catch (e) {
      this.fnI("warn", "Low-cost LLM tool selection failed: " + __miniAErrMsg(e))
    }
  }

  if (isDef(this.llm)) {
    try {
      var llmSelected = this._selectToolsByLLM(goal, allTools, this.llm)
      if (llmSelected.length > 0) {
        if (isObject(global.__mini_a_metrics) && isObject(global.__mini_a_metrics.tool_selection_llm_main)) global.__mini_a_metrics.tool_selection_llm_main.inc()
        this.fnI("done", "Selected " + llmSelected.length + " tool(s) via main LLM: " + llmSelected.join(", "))
        return llmSelected
      }
    } catch (e) {
      this.fnI("warn", "Main LLM tool selection failed: " + __miniAErrMsg(e))
    }
  }

  this.fnI("mcp", "LLM tool shortlist is empty, evaluating connection-level fallback...")
  var connectionFallbackSelection = []

  if (this._use_lc && isDef(this.lc_llm)) {
    try {
      this.fnI("mcp", "Requesting low-cost LLM to choose the best MCP connection and tools...")
      connectionFallbackSelection = this._selectConnectionAndToolsByLLM(goal, allTools, this.lc_llm)
      if (connectionFallbackSelection.length > 0) {
        if (isObject(global.__mini_a_metrics) && isObject(global.__mini_a_metrics.tool_selection_connection_chooser_lc)) global.__mini_a_metrics.tool_selection_connection_chooser_lc.inc()
        this.fnI("done", "Selected " + connectionFallbackSelection.length + " tool(s) via low-cost connection chooser: " + connectionFallbackSelection.join(", "))
        return connectionFallbackSelection
      }
    } catch (e) {
      this.fnI("warn", "Low-cost LLM connection chooser failed: " + __miniAErrMsg(e))
    }
  }

  if (isDef(this.llm)) {
    try {
      this.fnI("mcp", "Requesting primary LLM to choose the best MCP connection and tools...")
      connectionFallbackSelection = this._selectConnectionAndToolsByLLM(goal, allTools, this.llm)
      if (connectionFallbackSelection.length > 0) {
        if (isObject(global.__mini_a_metrics) && isObject(global.__mini_a_metrics.tool_selection_connection_chooser_main)) global.__mini_a_metrics.tool_selection_connection_chooser_main.inc()
        this.fnI("done", "Selected " + connectionFallbackSelection.length + " tool(s) via connection chooser: " + connectionFallbackSelection.join(", "))
        return connectionFallbackSelection
      }
    } catch (e) {
      this.fnI("warn", "Primary LLM connection chooser failed: " + __miniAErrMsg(e))
    }
  }

  if (isObject(global.__mini_a_metrics) && isObject(global.__mini_a_metrics.tool_selection_fallback_all)) global.__mini_a_metrics.tool_selection_fallback_all.inc()
  this.fnI("warn", "Dynamic tool selection returned no results, registering all " + allTools.length + " tools as fallback")
  return allTools.map(function(t) { return t.name })
}

MiniA.prototype._normalizeToolNameList = function(value) {
  var list = []
  var add = function(v) {
    if (!isString(v)) return
    var trimmed = v.trim()
    if (trimmed.length > 0 && list.indexOf(trimmed) < 0) list.push(trimmed)
  }

  if (isArray(value)) value.forEach(add)
  else if (isString(value) && value.trim().length > 0) value.split(",").forEach(add)
  return list
}

MiniA.prototype._getProxyCatalogTools = function() {
  var tools = []
  var state = isObject(global.__mcpProxyState__) ? global.__mcpProxyState__ : __
  if (!isObject(state) || !isArray(state.catalog)) return tools

  state.catalog.forEach(function(entry) {
    if (isMap(entry) && isMap(entry.tool) && isString(entry.tool.name) && entry.tool.name.length > 0) tools.push(entry.tool)
  })
  return tools
}
