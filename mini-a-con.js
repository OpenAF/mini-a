// Author: Nuno Aguiar
// License: Apache 2.0
// Description: Mini-A interactive console session

try {
  plugin("Console")
  var args = isDef(global._args) ? global._args : processExpr(" ")

  // Helper functions
  // ----------------

  function resolveCanonicalPath(basePath, fileName) {
    return io.fileInfo((basePath || ".") + "/" + fileName).canonicalPath
  }

  function canonicalizePath(path) {
    if (!isString(path) || path.trim().length === 0) return path
    try {
      return io.fileInfo(path).canonicalPath
    } catch (canonicalErr) {
      return path
    }
  }

  function findArgumentValue(map, targetKey) {
    if (!isObject(map)) return undefined
    var loweredTarget = String(targetKey || "").toLowerCase()
    var found
    Object.keys(map).some(function(key) {
      if (String(key).toLowerCase() === loweredTarget) {
        found = map[key]
        return true
      }
      return false
    })
    return found
  }

  function parseBoolean(value) {
    var lowered = ("" + value).trim().toLowerCase()
    if (lowered === "true" || lowered === "1" || lowered === "yes" || lowered === "y" || lowered === "on") return true
    if (lowered === "false" || lowered === "0" || lowered === "no" || lowered === "n" || lowered === "off") return false
    return undefined
  }

  __initializeCon()
  loadLib("mini-a.js")

  ow.loadFormat()
  var con          = new Console()
  var format       = ow.format
  var colorSupport = (typeof colorify === "function")
  var basePrompt   = "mini-a"
  var promptSymbol = "➤"
  var promptColor  = "FG(41)"
  var accentColor  = "FG(218)"
  var hintColor    = "FG(249)"
  var errorColor   = "FG(196)"
  var successColor = "FG(112)"
  var numericColor = "FG(155)"
  var historyFileName       = ".openaf-mini-a_history"
  var historyHome           = isDef(__gHDir) ? __gHDir() : java.lang.System.getProperty("user.home")
  var historyFilePath       = resolveCanonicalPath(historyHome, historyFileName)
  var conversationFileName  = ".openaf-mini-a_session.json"
  var conversationFilePath  = resolveCanonicalPath(historyHome, conversationFileName)
  var consoleReader         = __
  var commandHistory        = __
  var lastConversationStats = __
  var slashCommands         = ["help", "set", "toggle", "unset", "show", "reset", "last", "clear", "context", "compact", "history", "exit", "quit"]
  var resumeConversation    = parseBoolean(findArgumentValue(args, "resume")) === true
  var conversationArgValue  = findArgumentValue(args, "conversation")
  var initialConversationPath = isString(conversationArgValue) && conversationArgValue.trim().length > 0
    ? canonicalizePath(conversationArgValue)
    : conversationFilePath

  if (resumeConversation !== true && isString(initialConversationPath) && initialConversationPath.trim().length > 0) {
    try {
      if (io.fileExists(initialConversationPath) && io.fileInfo(initialConversationPath).isFile) io.rm(initialConversationPath)
      lastConversationStats = __
    } catch (conversationResetError) {
      printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Unable to reset conversation at startup: " + conversationResetError, errorColor))
    }
  }

  try {
    if (isDef(con) && typeof con.getConsoleReader === "function") {
      consoleReader = con.getConsoleReader()
      commandHistory = new Packages.jline.console.history.FileHistory(new java.io.File(historyFilePath))
      consoleReader.setHistory(commandHistory)

      // Set history max size from environment variable if defined
      var historySize = getEnv("OAF_MINI_A_CON_HIST_SIZE")
      if (isDef(historySize) && isString(historySize) && historySize.trim().length > 0) {
        var numericHistorySize = parseInt(historySize, 10)
        if (!isNaN(numericHistorySize) && numericHistorySize > 0) {
          con.getConsoleReader().getHistory().setMaxSize(numericHistorySize)
        }
      }
    }
  } catch (historyError) {
    commandHistory = __
  }

  if (typeof addOnOpenAFShutdown === "function") {
    addOnOpenAFShutdown(function() {
      finalizeSession("shutdown")
    })
  }

  // Utility functions
  // -----------------

  function colorifyText(text, color) {
    if (!colorSupport || isUnDef(color)) return text
    return ansiColor(color, text)
  }

  var parameterDefinitions = {
    verbose        : { type: "boolean", default: false, description: "Print detailed interaction events" },
    debug          : { type: "boolean", default: false, description: "Enable debug logging" },
    raw            : { type: "boolean", default: false, description: "Return raw LLM output without formatting adjustments" },
    useshell       : { type: "boolean", default: false, description: "Allow shell command execution" },
    readwrite      : { type: "boolean", default: false, description: "Allow write operations during shell commands" },
    checkall       : { type: "boolean", default: false, description: "Ask for confirmation before shell commands" },
    shellbatch     : { type: "boolean", default: false, description: "Automatically approve shell commands" },
    shellallowpipes: { type: "boolean", default: false, description: "Allow pipes and redirections" },
    showexecs      : { type: "boolean", default: true, description: "Show shell/exec events in the interaction stream" },
    usetools       : { type: "boolean", default: false, description: "Register MCP tools directly on the model" },
    useutils       : { type: "boolean", default: false, description: "Enable bundled Mini Utils Tool utilities" },
    usediagrams    : { type: "boolean", default: false, description: "Encourage Mermaid diagrams in knowledge prompt" },
    usemermaid     : { type: "boolean", default: false, description: "Alias for usediagrams (Mermaid diagrams guidance)" },
    usecharts      : { type: "boolean", default: false, description: "Encourage Chart.js visuals in knowledge prompt" },
    useascii       : { type: "boolean", default: false, description: "Enable ASCII-based visuals in knowledge prompt" },
    useplanning    : { type: "boolean", default: false, description: "Track and expose task planning" },
    planmode       : { type: "boolean", default: false, description: "Run in plan-only mode without executing actions" },
    convertplan    : { type: "boolean", default: false, description: "Convert plan to requested format and exit" },
    resumefailed   : { type: "boolean", default: false, description: "Attempt to resume the last failed goal on startup" },
    forceplanning  : { type: "boolean", default: false, description: "Force planning even when heuristics would skip it" },
    chatbotmode    : { type: "boolean", default: false, description: "Run Mini-A in chatbot mode" },
    mcplazy        : { type: "boolean", default: false, description: "Defer MCP connection initialization" },
    mcpdynamic     : { type: "boolean", default: false, description: "Select MCP tools dynamically per goal" },
    rpm            : { type: "number", description: "Requests per minute limit" },
    rtm            : { type: "number", description: "Legacy alias for rpm (requests per minute)" },
    tpm            : { type: "number", description: "Tokens per minute limit" },
    maxsteps       : { type: "number", description: "Maximum consecutive non-success steps" },
    maxcontext     : { type: "number", description: "Maximum allowed context tokens" },
    toolcachettl   : { type: "number", description: "Default MCP result cache TTL (ms)" },
    goalprefix     : { type: "string", description: "Optional prefix automatically added to every goal" },
    shellprefix    : { type: "string", description: "Prefix applied to each shell command" },
    shellallow     : { type: "string", description: "Comma-separated shell allow list" },
    shellbanextra  : { type: "string", description: "Comma-separated extra banned commands" },
    mcp            : { type: "string", description: "MCP connection definition (SLON/JSON)" },
    knowledge      : { type: "string", description: "Extra knowledge or context" },
    libs           : { type: "string", description: "Comma-separated libraries to load" },
    conversation   : { type: "string", description: "Conversation history file" },
    outfile        : { type: "string", description: "Save final answer to file" },
    outputfile     : { type: "string", description: "Alias for outfile for plan conversions" },
    planfile       : { type: "string", description: "Plan file to load or save before execution" },
    planformat     : { type: "string", description: "Plan format override (md|json)" },
    plancontent    : { type: "string", description: "Inline plan content (JSON or Markdown) to preload" },
    updatefreq     : { type: "string", default: "auto", description: "Plan update frequency (auto|always|checkpoints|never)" },
    updateinterval : { type: "number", default: 3, description: "Steps between plan updates when updatefreq=auto" },
    forceupdates   : { type: "boolean", default: false, description: "Force plan updates even when actions fail" },
    planlog        : { type: "string", description: "Append plan updates to this log file" },
    saveplannotes  : { type: "boolean", default: false, description: "Append execution learnings to plan notes" },
    rules          : { type: "string", description: "Custom agent rules (JSON or SLON)" },
    state          : { type: "string", description: "Initial agent state (JSON or SLON)" },
    format         : { type: "string", description: "Final answer format (md|json)" },
    model          : { type: "string", description: "Override OAF_MODEL configuration" },
    modellc        : { type: "string", description: "Override OAF_LC_MODEL configuration" },
    auditch        : { type: "string", description: "Audit channel definition" }
  }

  if (isDef(parameterDefinitions.conversation) && !(io.fileExists(conversationFilePath) && io.fileInfo(conversationFilePath).isDirectory)) parameterDefinitions.conversation.default = conversationFilePath
  var sessionParameterNames = Object.keys(parameterDefinitions).sort()

  function coerceDefaultValue(def, rawValue, key) {
    if (!isDef(def) || isUnDef(rawValue)) return undefined
    if (def.type === "boolean") {
      var parsedBool = parseBoolean(rawValue)
      if (isUnDef(parsedBool)) {
        print(colorifyText("Ignored CLI override for " + key + ": expected boolean.", errorColor))
        return undefined
      }
      return parsedBool
    }
    if (def.type === "number") {
      var parsedNum = parseNumber(rawValue)
      if (isUnDef(parsedNum)) {
        print(colorifyText("Ignored CLI override for " + key + ": expected number.", errorColor))
        return undefined
      }
      return parsedNum
    }
    if (def.type === "string") {
      var stringValue = String(rawValue)
      if (key === "conversation") return canonicalizePath(stringValue)
      return stringValue
    }
    return rawValue
  }

  function applyArgumentDefaults(argMap) {
    if (!isObject(argMap)) return {}
    var extraArgs = {}
    Object.keys(argMap).forEach(function(originalKey) {
      var normalizedKey = String(originalKey).toLowerCase()
      if (!Object.prototype.hasOwnProperty.call(parameterDefinitions, normalizedKey)) {
        // Store arguments not in parameterDefinitions for later merging
        extraArgs[normalizedKey] = argMap[originalKey]
        return
      }
      var definition = parameterDefinitions[normalizedKey]
      var rawValue = argMap[originalKey]
      var coerced = coerceDefaultValue(definition, rawValue, normalizedKey)
      if (isDef(coerced)) definition.default = coerced
    })
    return extraArgs
  }

  if (consoleReader) {
    try {
      var slashParameterHints = { set: "=", toggle: "", unset: "", show: "" }
      consoleReader.addCompleter(
        new Packages.openaf.jline.OpenAFConsoleCompleter(function(buf, cursor, candidates) {
          if (isUnDef(buf)) return -1
          var uptoCursor = buf.substring(0, cursor)
          if (uptoCursor.indexOf("/") !== 0) return -1

          var firstSpace = uptoCursor.indexOf(" ")
          if (firstSpace === -1) {
            var partialCommand = uptoCursor.toLowerCase()
            slashCommands.forEach(function(cmd) {
              var candidateCommand = "/" + cmd
              if (candidateCommand.toLowerCase().indexOf(partialCommand) === 0) candidates.add(candidateCommand)
            })
            return candidates.isEmpty() ? -1 : 0
          }

          var commandName = uptoCursor.substring(1, firstSpace)
          var lookupName = commandName.toLowerCase()
          if (!Object.prototype.hasOwnProperty.call(slashParameterHints, lookupName)) return -1

          var remainder = uptoCursor.substring(firstSpace + 1)
          var trimmedRemainder = remainder.replace(/^\s*/, "")
          var insertionPoint = cursor - trimmedRemainder.length

          var suffix = slashParameterHints[lookupName]
          var keyTokenMatch = trimmedRemainder.match(/^[^\s=]*/)
          var keyToken = keyTokenMatch ? keyTokenMatch[0] : ""

          if (trimmedRemainder.length !== keyToken.length) return -1

          sessionParameterNames.forEach(function(name) {
            if (name.indexOf(keyToken) === 0) candidates.add(name + suffix)
          })
          return candidates.isEmpty() ? -1 : Number(insertionPoint)
        })
      )
      if (consoleReader.getCompletionHandler) {
        consoleReader.getCompletionHandler().setPrintSpaceAfterFullCompletion(false)
      }
    } catch (completionError) { }
  }

  var extraCLIArgs = applyArgumentDefaults(args)

  function getConversationPath() {
    if (sessionOptions && Object.prototype.hasOwnProperty.call(sessionOptions, "conversation")) {
      var configured = sessionOptions.conversation
      if (isString(configured)) {
        if (configured.trim().length === 0) return ""
        return configured
      }
    }
    return conversationFilePath
  }

  function loadConversationEntries(path) {
    if (!isString(path) || path.trim().length === 0) return []
    try {
      if (!io.fileExists(path)) return []
      var payload = io.readFileJSON(path)
      if (isObject(payload) && isArray(payload.c)) return payload.c
    } catch (loadError) {
      print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Unable to read conversation file: " + loadError, errorColor))
    }
    return []
  }

  function flattenConversationContent(value, depth) {
    depth = isNumber(depth) ? depth : 0
    if (depth > 6) return ""
    if (isUnDef(value) || value === null) return ""
    if (isString(value)) return value
    if (isNumber(value) || typeof value === "boolean") return String(value)
    if (isArray(value)) {
      var parts = []
      value.forEach(function(segment) {
        var flattened = flattenConversationContent(segment, depth + 1)
        if (flattened.length > 0) parts.push(flattened)
      })
      return parts.join("\n")
    }
    if (isObject(value)) {
      if (isString(value.text)) return value.text
      if (isString(value.content)) return value.content
      if (isArray(value.parts)) return flattenConversationContent(value.parts, depth + 1)
      if (isArray(value.messages)) return flattenConversationContent(value.messages, depth + 1)
      if (isString(value.body)) return value.body
    }
    try {
      return stringify(value, __, "")
    } catch(ignore) {
      return ""
    }
  }

  function analyzeConversationEntries(entries, estimatorFn) {
    var data = {
      system   : { label: "System", tokens: 0, chars: 0, messages: 0 },
      user     : { label: "User", tokens: 0, chars: 0, messages: 0 },
      assistant: { label: "Assistant", tokens: 0, chars: 0, messages: 0 },
      tool     : { label: "Tool", tokens: 0, chars: 0, messages: 0 },
      other    : { label: "Other", tokens: 0, chars: 0, messages: 0 }
    }
    var usedActualStats = false
    var usedEstimator = false
    var safeEstimator = function(text) {
      var content = isString(text) ? text : String(text || "")
      var fallback = Math.ceil(Math.max(0, content.length) / 4)
      if (typeof estimatorFn === "function") {
        try {
          var estimate = estimatorFn(content)
          if (isNumber(estimate) && !isNaN(estimate)) {
            usedEstimator = true
            return Math.max(0, Math.round(estimate))
          }
        } catch(ignoreEstimatorError) { }
      }
      return fallback
    }

    var conversation = isArray(entries) ? entries : []
    conversation.forEach(function(entry) {
      var role = isString(entry.role) ? entry.role.toLowerCase() : ""
      var bucket
      if (role === "system" || role === "developer") bucket = data.system
      else if (role === "user") bucket = data.user
      else if (role === "assistant") bucket = data.assistant
      else if (role === "tool" || role === "function" || role === "observation") bucket = data.tool
      else bucket = data.other

      var content = flattenConversationContent(entry.content)
      var tokens = 0

      // Use actual token stats if available (stored by _attachTokenStatsToConversation)
      if (isObject(entry._tokenStats)) {
        if (isNumber(entry._tokenStats.total_tokens) && entry._tokenStats.total_tokens > 0) {
          tokens = entry._tokenStats.total_tokens
          usedActualStats = true // Mark as using actual API data
        } else if (isNumber(entry._tokenStats.prompt_tokens) || isNumber(entry._tokenStats.completion_tokens)) {
          var prompt = isNumber(entry._tokenStats.prompt_tokens) ? entry._tokenStats.prompt_tokens : 0
          var completion = isNumber(entry._tokenStats.completion_tokens) ? entry._tokenStats.completion_tokens : 0
          tokens = prompt + completion
          usedActualStats = true // Mark as using actual API data
        }
      }

      // Fall back to estimation if no actual stats available
      if (tokens === 0 && content.length > 0) {
        tokens = safeEstimator(content)
      }

      bucket.tokens += tokens
      bucket.chars += content.length
      bucket.messages += 1
    })

    var sections = Object.keys(data).map(function(key) {
      var item = data[key]
      return {
        section : item.label,
        tokens  : item.tokens,
        chars   : item.chars,
        messages: item.messages
      }
    })
    var totalTokens = sections.reduce(function(acc, row) { return acc + row.tokens }, 0)
    var totalChars = sections.reduce(function(acc, row) { return acc + row.chars }, 0)

    var estimateMethod = usedActualStats ? "actual" : (usedEstimator ? "model" : "approx")

    return {
      sections     : sections,
      totalTokens  : totalTokens,
      totalChars   : totalChars,
      messageCount : conversation.length,
      estimateMethod: estimateMethod,
      entries      : conversation
    }
  }

  function refreshConversationStats(agentInstance) {
    var convoPath = getConversationPath()
    var entries = loadConversationEntries(convoPath)
    if ((!isArray(entries) || entries.length === 0) && isObject(agentInstance) && isObject(agentInstance.llm) && typeof agentInstance.llm.getGPT === "function") {
      try {
        var liveConversation = agentInstance.llm.getGPT().getConversation()
        if (isArray(liveConversation)) entries = liveConversation
      } catch(ignoreLiveError) { }
    }
    var estimator = (isObject(agentInstance) && typeof agentInstance._estimateTokens === "function")
      ? function(text) { return agentInstance._estimateTokens(text) }
      : __
    var analysis = analyzeConversationEntries(entries, estimator)
    analysis.path = convoPath
    analysis.updatedAt = new Date()
    lastConversationStats = analysis
    return analysis
  }

  function printContextSummary(agentInstance) {
    var stats = refreshConversationStats(agentInstance)
    if (!isObject(stats) || stats.messageCount === 0) {
      print(colorifyText("No active conversation found. Run a goal first to populate context.", hintColor))
      if (isObject(stats) && isString(stats.path) && stats.path.length > 0) {
        print(colorifyText("Conversation path: " + stats.path, hintColor))
      }
      return
    }

    var rows = stats.sections.map(function(section) {
      var share = stats.totalTokens > 0 ? section.tokens / stats.totalTokens : 0
      return {
        segment : section.section,
        tokens  : section.tokens,
        share   : (share * 100).toFixed(1) + "%",
        messages: section.messages,
        //bar     : ow.format.string.progress(section.tokens, stats.totalTokens, 0, 20, "█", "░")
        bar     : colorifyText(ow.format.string.progress(section.tokens, stats.totalTokens, 0, 35), "RESET")
      }
    })

    print(colorifyText("Conversation context usage", accentColor))
    print(printTable(rows, (__conAnsi ? isDef(__con) && __con.getTerminal().getWidth() : __), true, __conAnsi, (__conAnsi || isDef(this.__codepage) ? "utf" : __), __, true, false, true))
    var methodLabel = stats.estimateMethod === "actual" ? "actual from API" : (stats.estimateMethod === "model" ? "model-based" : "approximate")
    var tokenLabel = stats.estimateMethod === "actual" ? "Total tokens: " : "Estimated tokens: ~"
    print(colorifyText("Total messages: ", hintColor) + colorifyText(String(stats.messageCount), numericColor) + colorifyText(" | " + tokenLabel, hintColor) + colorifyText(String(stats.totalTokens), numericColor) + colorifyText(" (" + methodLabel + ")", hintColor))
    if (isString(stats.path) && stats.path.length > 0) {
      print(colorifyText("Conversation file: " + stats.path, hintColor))
    }
  }

  function truncateText(text, maxLen) {
    var str = isString(text) ? text : String(text || "")
    if (str.length <= maxLen) return str
    return str.substring(0, Math.max(0, maxLen - 1)) + "…"
  }

  function printConversationHistory(limit) {
    var rowsToShow = isNumber(limit) ? Math.max(1, Math.round(limit)) : 10
    var stats = refreshConversationStats()
    if (!isObject(stats) || stats.messageCount === 0) {
      print(colorifyText("No conversation history to display.", hintColor))
      return
    }

    var start = Math.max(0, stats.entries.length - rowsToShow)
    var preview = []
    for (var i = start; i < stats.entries.length; i++) {
      var entry = stats.entries[i]
      var content = flattenConversationContent(entry.content)
      preview.push({
        index  : "#" + (i + 1),
        role   : isString(entry.role) ? entry.role : "(unknown)",
        preview: truncateText(content.replace(/\s+/g, " "), 80)
      })
    }

    print(colorifyText("Recent conversation turns (last " + rowsToShow + ")", accentColor))
    print(printTable(preview, (__conAnsi ? isDef(__con) && __con.getTerminal().getWidth() : __), true, __conAnsi, (__conAnsi || isDef(this.__codepage) ? "utf" : __), __, true, false, true))
    if (stats.entries.length > rowsToShow) {
      print(colorifyText("Showing " + rowsToShow + " of " + stats.entries.length + " messages.", hintColor))
    }
  }

  function clearConversationHistory() {
    var convoPath = getConversationPath()
    if (!isString(convoPath) || convoPath.trim().length === 0) {
      print(colorifyText("Conversation path is not configured. Use /set conversation <path> first.", hintColor))
      return
    }
    try {
      if (io.fileExists(convoPath) && io.fileInfo(convoPath).isFile) io.rm(convoPath)
      lastConversationStats = __
      print(colorifyText("Conversation cleared. Future goals will start fresh.", successColor))
    } catch (clearError) {
      print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Unable to clear conversation: " + clearError, errorColor))
    }
  }

  function compactConversationContext(preserveCount) {
    var stats = refreshConversationStats(activeAgent)
    if (!isObject(stats) || !isArray(stats.entries) || stats.entries.length === 0) {
      print(colorifyText("No conversation context to compact.", hintColor))
      return
    }

    var keepCount = isNumber(preserveCount) ? Math.max(1, Math.floor(preserveCount)) : 6
    var entries = stats.entries.slice()
    var keepSize = Math.min(keepCount, entries.length)
    var keepTail = entries.slice(entries.length - keepSize)
    var summarizeUntil = entries.length - keepTail.length

    var preserved = []
    var summarizeCandidates = []
    for (var i = 0; i < summarizeUntil; i++) {
      var entry = entries[i]
      var role = isString(entry.role) ? entry.role.toLowerCase() : ""
      if (role === "system" || role === "developer") {
        preserved.push(entry)
      } else {
        summarizeCandidates.push(entry)
      }
    }

    if (summarizeCandidates.length === 0) {
      print(colorifyText("No user or assistant messages to summarize from earlier history.", hintColor))
      return
    }

    var summarySource = []
    summarizeCandidates.forEach(function(entry) {
      var role = isString(entry.role) ? entry.role.toUpperCase() : "UNKNOWN"
      var content = flattenConversationContent(entry.content)
      summarySource.push(`${role}: ${content}`)
    })
    var summaryPayload = summarySource.join("\n")
    var summaryText = ""
    if (typeof summarize === "function") {
      try { summaryText = summarize(summaryPayload) } catch(ignoreSummaryError) {}
    }
    if (!isString(summaryText) || summaryText.trim().length === 0) {
      summaryText = summaryPayload.substring(0, 400)
    }
    summaryText = summaryText.trim()

    var summaryEntry = {
      role: "assistant",
      content: `Context summary (${summarizeCandidates.length} messages condensed on ${new Date().toISOString()}): ${summaryText}`
    }

    var newConversation = preserved.concat([summaryEntry]).concat(keepTail)
    var convoPath = getConversationPath()
    if (!isString(convoPath) || convoPath.trim().length === 0) {
      print(colorifyText("Conversation path is not configured. Use /set conversation <path> first.", hintColor))
      return
    }

    try {
      io.writeFileJSON(convoPath, { u: new Date(), c: newConversation }, "")
      if (isObject(activeAgent) && isObject(activeAgent.llm) && typeof activeAgent.llm.getGPT === "function") {
        try { activeAgent.llm.getGPT().setConversation(newConversation) } catch (ignoreSetConversation) { }
      }
      var previousTokens = stats.totalTokens
      var updatedStats = refreshConversationStats(activeAgent)
      var afterTokens = isObject(updatedStats) ? updatedStats.totalTokens : 0
      var reduction = previousTokens > 0 ? Math.max(0, previousTokens - afterTokens) : 0
      print(
        colorifyText("Conversation compacted. Preserved ", successColor) +
        colorifyText(String(keepTail.length), numericColor) +
        colorifyText(" recent message" + (keepTail.length === 1 ? "" : "s") + ".", successColor)
      )
      if (previousTokens > 0) {
        print(
          colorifyText("Estimated tokens: ~", hintColor) +
          colorifyText(String(previousTokens), numericColor) +
          colorifyText(" → ~", hintColor) +
          colorifyText(String(afterTokens), numericColor) +
          colorifyText(" (saved ~", hintColor) +
          colorifyText(String(reduction), numericColor) +
          colorifyText(").", hintColor)
        )
      }
    } catch (compactError) {
      print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Unable to compact conversation: " + compactError, errorColor))
    }
  }

  function resetOptions() {
    var opts = {}
    Object.keys(parameterDefinitions).forEach(function(key) {
      var def = parameterDefinitions[key]
      if (def && Object.prototype.hasOwnProperty.call(def, "default")) {
        opts[key] = def.default
      }
    })
    return opts
  }

  var sessionOptions = resetOptions()
  var lastResult = __
  var internalParameters = { goalprefix: true }
  var activeAgent = __
  var shutdownHandled = false

  function promptLabel() {
    var prefix = colorifyText(basePrompt, accentColor)
    var arrow = colorifyText(promptSymbol, promptColor)
    return prefix + " " + arrow + " "
  }

  var multiLineIntro = colorifyText("Enter multi-line goal. Finish with a line containing only \"\"\".", hintColor)
  var multiLinePrompt = colorifyText("…", hintColor) + " "

  function collectMultiline(initial) {
    var lines = []
    if (isString(initial) && initial.length > 0) lines.push(initial)
    print(multiLineIntro)
    while(true) {
      var nextLine = con.readLinePrompt(multiLinePrompt)
      if (isUnDef(nextLine)) return null
      if (String(nextLine).trim() === '"""') break
      lines.push(nextLine)
    }
    return lines.join("\n")
  }

  function parseNumber(value) {
    var num = Number(value)
    return isNaN(num) ? undefined : num
  }

  function setOption(name, rawValue) {
    var key = name.toLowerCase()
    if (!Object.prototype.hasOwnProperty.call(parameterDefinitions, key)) {
      print(colorifyText("Unknown parameter: " + name, errorColor))
      return
    }
    var def = parameterDefinitions[key]
    var value = rawValue
    if (rawValue === '"""') {
      value = collectMultiline("")
      if (isUnDef(value)) return
    }
    if (def.type === "boolean") {
      var parsedBool = parseBoolean(value)
      if (isUnDef(parsedBool)) {
        printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Unable to parse boolean value for " + key + ". Use true/false.", errorColor))
        return
      }
      value = parsedBool
    } else if (def.type === "number") {
      var parsedNum = parseNumber(value)
      if (isUnDef(parsedNum)) {
        printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Unable to parse numeric value for " + key + ".", errorColor))
        return
      }
      value = parsedNum
    } else if (def.type === "string") {
      if (!isString(value)) value = String(value)
    }
    sessionOptions[key] = value
    if (key === "conversation") lastConversationStats = __
    print(colorifyText("Set " + key + "=" + value, successColor))
  }

  function unsetOption(name) {
    var key = name.toLowerCase()
    if (!Object.prototype.hasOwnProperty.call(parameterDefinitions, key)) {
      printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Unknown parameter: " + name, errorColor))
      return
    }
    if (Object.prototype.hasOwnProperty.call(parameterDefinitions[key], "default")) {
      sessionOptions[key] = parameterDefinitions[key].default
    } else {
      delete sessionOptions[key]
    }
    if (key === "conversation") lastConversationStats = __
    print(colorifyText("Cleared parameter " + key, successColor))
  }

  function toggleOption(name) {
    var key = name.toLowerCase()
    if (!Object.prototype.hasOwnProperty.call(parameterDefinitions, key)) {
      printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Unknown parameter: " + name, errorColor))
      return
    }
    var def = parameterDefinitions[key]
    if (def.type !== "boolean") {
      printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Parameter " + key + " is not boolean.", errorColor))
      return
    }
    var current = sessionOptions[key]
    var toggled = current === true ? false : true
    sessionOptions[key] = toggled
    print(colorifyText("Toggled " + key + " -> " + toggled, successColor))
  }

  /**
   * Prints the current session options in a table format.
   * Each row contains the parameter name, its value, and a description.
   * Optionally filters rows by a case-insensitive prefix.
   */
  function describeOptions(prefix) {
    var normalizedPrefix = isString(prefix) ? prefix.trim().toLowerCase() : ""
    var rows = Object.keys(parameterDefinitions).sort().filter(function(key) {
      if (normalizedPrefix.length === 0) return true
      return key.indexOf(normalizedPrefix) === 0
    }).map(function(key) {
      var def = parameterDefinitions[key]
      var active = sessionOptions[key]
      var value
      if (isUnDef(active)) value = "(unset)"
      else if (isObject(active) || isArray(active)) value = stringify(active, __, "")
      else value = "" + active
      return { parameter: key, value: value, description: def.description }
    })
    if (rows.length === 0) {
      var shownPrefix = isString(prefix) ? prefix : (isUnDef(prefix) ? "" : String(prefix))
      var filterMessage = shownPrefix.length > 0
        ? "No parameters match prefix '" + shownPrefix + "'."
        : "No parameters available."
      print(colorifyText(filterMessage, hintColor))
      return
    }
    print( printTable(rows, (__conAnsi ? isDef(__con) && __con.getTerminal().getWidth() : __), true, __conAnsi, (__conAnsi || isDef(this.__codepage) ? "utf" : __), __, true, false, true) )
  }

  function ensureModel(args) {
    if (isString(args.model) && args.model.trim().length > 0) return true
    var envModel = getEnv("OAF_MODEL")
    if (isString(envModel) && envModel.trim().length > 0) return true
    printErr(colorifyText("!!", "ITALIC," + errorColor) + " " + colorifyText("OAF_MODEL is not set and no model override provided. Export OAF_MODEL or use /set model ...", errorColor))
    return false
  }

  function processFileAttachments(text) {
    if (!isString(text) || text.trim().length === 0) return text

    // Match @path patterns - matches @ followed by path characters until whitespace
    var pattern = /@([^\s]+)/g
    var match
    var result = text
    var processed = []

    while ((match = pattern.exec(text)) !== null) {
      var fullMatch = match[0]  // e.g., "@some/file.md"
      var filePath = match[1]   // e.g., "some/file.md"

      // Skip if already processed (same file referenced multiple times)
      if (processed.indexOf(fullMatch) !== -1) continue
      processed.push(fullMatch)

      try {
        // Try to read the file
        var fileContent = io.readFileString(filePath)
        if (isDef(fileContent)) {
          // Replace all occurrences of this pattern with the file content
          var replacement = "\n\n--- Content from " + filePath + " ---\n" + fileContent + "\n--- End of " + filePath + " ---\n\n"
          result = result.split(fullMatch).join(replacement)
          print(colorifyText("📎 Attached: " + filePath + " (" + fileContent.length + " bytes)", successColor))
        }
      } catch (fileError) {
        printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Unable to read file " + filePath + ": " + fileError, errorColor))
      }
    }

    return result
  }

  function buildArgs(goalText) {
    var cleanGoal = isString(goalText) ? goalText.trim() : goalText

    // Process file attachments (@file/path references)
    cleanGoal = processFileAttachments(cleanGoal)

    var args = {}

    // First, merge extra CLI arguments that weren't in parameterDefinitions
    if (isObject(extraCLIArgs)) {
      Object.keys(extraCLIArgs).forEach(function(key) {
        args[key] = extraCLIArgs[key]
      })
    }

    // Then, merge sessionOptions (which may override extraCLIArgs)
    Object.keys(sessionOptions).forEach(function(key) {
      if (internalParameters[key]) return
      var value = sessionOptions[key]
      if (isUnDef(value) || value === "") return
      args[key] = value
    })

    if (isDef(args.usemermaid)) {
      if (isUnDef(args.usediagrams)) args.usediagrams = args.usemermaid
      delete args.usemermaid
    }
    if (isDef(args.rtm) && isUnDef(args.rpm)) args.rpm = args.rtm

    if (isString(sessionOptions.goalprefix) && sessionOptions.goalprefix.length > 0) {
      cleanGoal = sessionOptions.goalprefix + cleanGoal
    }
    args.goal = cleanGoal
    if (isDef(args.format) && isUnDef(args.__format)) args.__format = args.format
    return args
  }

  var eventPalette = {
    user   : "FG(147)",
    think  : "FG(223)",
    thought: "FG(223)",
    exec   : "FG(117)",
    shell  : "FG(81)",
    final  : successColor,
    error  : errorColor,
    warn   : "FG(214)",
    info   : hintColor,
    plan   : "FG(135)"
  }

  var _prevEventLength = __
  function printEvent(type, icon, message, id) {
    // Ignore user events
    if (type == "user") return
    var extra = "", inline = false

    var iconText
    if ((sessionOptions.showexecs && (icon == "⚙️" || icon == "🖥️")) && icon != "📚" && type != "error" && icon != "✅" && icon != "📂" && icon != "ℹ️" && icon != "➡️" && icon != "⬅️" && icon != "📏" && icon != "⏳" && icon != "🏁" && icon != "🤖") {
      iconText = colorifyText(icon, "RESET," + (eventPalette[type] || accentColor)) + (icon.length > 1 ? " " : "  ")
    } else {
      if (type == "final") {
        iconText = colorifyText("⦿", "RESET," + (eventPalette[type] || accentColor)) + " "
      } else if (type == "error") {
        iconText = colorifyText("✖", "RESET," + (eventPalette[type] || accentColor)) + " "
      } else {
        iconText = colorifyText("•", "RESET," + (eventPalette[type] || accentColor)) + " "
      }
      inline = true
    }
    //var prefix = colorifyText("[" + id + "]", hintColor)
    var _msg = colorifyText("│ ", promptColor) + extra + iconText + colorifyText(message.replace(/\n/g, "↵").trim(), hintColor + ",ITALIC")
    // Optimized: extract previous line erase logic
    function _erasePrev() {
      if (!isDef(_prevEventLength)) return
      var termWidth = (__conAnsi && isDef(__con)) ? __con.getTerminal().getWidth() : 80
      var prevLines = Math.ceil(_prevEventLength / termWidth)
      for (var i = 0; i < prevLines; i++) {
      printnl("\r" + repeat(termWidth, " ") + "\r")
      if (i < prevLines - 1) printnl("\u001b[1A")
      }
      printnl("\r")
    }

    if (args.verbose === true || !inline) {
      _erasePrev()
      print(_msg)
      _prevEventLength = __
    } else {
      _erasePrev()
      printnl(_msg + "\r")
      _prevEventLength = _msg.length
    }
    //print(prefix + " " + iconText + " " + message)
  }

  function persistConversationSnapshot(agentInstance) {
    var convoPath = getConversationPath()
    if (!isString(convoPath) || convoPath.trim().length === 0) return
    var agentRef = isObject(agentInstance) ? agentInstance : activeAgent
    if (!isObject(agentRef)) return
    try {
      if (!isObject(agentRef.llm) || typeof agentRef.llm.getGPT !== "function") return
      var conversation = agentRef.llm.getGPT().getConversation()
      if (isArray(conversation)) {
        io.writeFileJSON(convoPath, { u: new Date(), c: conversation }, "")
      }
    } catch(ignorePersistError) { }
  }

  function runGoal(goalText) {
    var _args = buildArgs(goalText)
    if (!ensureModel(_args)) return
    var agent = new MiniA()
    activeAgent = agent
    agent.setInteractionFn(function(event, message) {
      agent.defaultInteractionFn(event, message, function(icon, text, id) {
        printEvent(event, icon, text, id)
      })
    })
    var agentResult = __
    var stopRequested = false
    try {
      agent.init(_args)
      $tb(function() {
        agentResult = agent.start(_args)
      }).stopWhen(function(done) {
        if (done === true) return true
        var rawCode = con.readCharNB()
        var code = isDef(rawCode) ? Number(rawCode) : NaN
        if (!isNaN(code) && code > 0) {
          if (code === 27) {
            sleep(40)
            var followRaw = con.readCharNB()
            var followCode = isDef(followRaw) ? Number(followRaw) : NaN
            if (isNaN(followCode) || followCode <= 0) {
              sleep(40)
              followRaw = con.readCharNB()
              followCode = isDef(followRaw) ? Number(followRaw) : NaN
            }
            if ((isNaN(followCode) || followCode <= 0) && !stopRequested) {
              stopRequested = true
              agent.state = "stop"
              if (isObject(global.__mini_a_metrics) && isObject(global.__mini_a_metrics.goals_stopped) && isFunction(global.__mini_a_metrics.goals_stopped.inc)) {
                try { global.__mini_a_metrics.goals_stopped.inc() } catch(ignoreInc) {}
              }
              printEvent("warn", "🛑", "Esc pressed. Requesting Mini-A to stop...")
            }
          }
        }
        sleep(75)
        return false
      }).exec()
      persistConversationSnapshot(agent)
      refreshConversationStats(agent)
      if (stopRequested) {
        print(colorifyText("Mini-A stopped by user (Esc).", hintColor))
        return
      }
      lastResult = agentResult
      if (isUnDef(_args.outfile)) {
        //print(colorifyText("\n🏁 Final answer", successColor))
        print()
        if (isObject(lastResult) || isArray(lastResult)) {
          print(stringify(lastResult, __, "  "))
        } else if (isString(lastResult)) {
          print(lastResult)
        } else if (isDef(lastResult)) {
          print(stringify(lastResult, __, ""))
        }
      } else {
        print(colorifyText("Final answer written to " + _args.outfile, successColor))
      }
    } catch (e) {
      var errMsg = isDef(e) && isDef(e.message) ? e.message : "" + e
      printErr(colorifyText("!!", "ITALIC," + errorColor) + " " + colorifyText("Mini-A execution failed: " + errMsg, errorColor))
    }
  }

  function finalizeSession(reason) {
    if (shutdownHandled) return
    shutdownHandled = true

    try { persistConversationSnapshot(activeAgent) } catch(ignorePersist) {}
    try { refreshConversationStats(activeAgent) } catch(ignoreRefresh) {}

    if (commandHistory && typeof commandHistory.flush === "function") {
      try { commandHistory.flush() } catch(ignoreFlushError) {}
    }

    var exitStats = isObject(lastConversationStats) ? lastConversationStats : __
    if (isObject(exitStats) && isNumber(exitStats.messageCount) && exitStats.messageCount > 0) {
      var exitConversationPath = isString(exitStats.path) && exitStats.path.length > 0 ? exitStats.path : getConversationPath()
      if (isString(exitConversationPath) && exitConversationPath.length > 0) {
        if (io.fileExists(exitConversationPath)) {
          printnl(colorifyText("Conversation saved to " + exitConversationPath + ".", hintColor))
        } else {
          printnl(colorifyText("Conversation context updated for this session.", hintColor))
        }
      }
      print(colorifyText(" Start mini-a with 'resume=true' to continue this conversation.", hintColor))
      print(colorifyText("Goodbye!", accentColor))
    }
  }

  function printHelp() {
    var conversationPath = getConversationPath()
    var conversationDisplay = (isString(conversationPath) && conversationPath.length > 0) ? conversationPath : "disabled"
    var lines = [
      "• Type a goal and press Enter to launch Mini-A. Press " + colorifyText("Esc", accentColor) + colorifyText(" during execution to request a stop.", hintColor),
      "• Enter '" + colorifyText("\"\"\"", accentColor) + "' on a new line to compose multi-line goals.",
      "• Include file contents in your goal using " + colorifyText("@path/to/file", accentColor) + colorifyText(" syntax.", hintColor),
      "  Example: " + colorifyText("\"Follow these instructions @docs/guide.md and apply @config/settings.json\"", hintColor),
      "• Use Tab to complete slash commands and ↑/↓ to browse history saved at " + colorifyText(historyFilePath, accentColor) + ".",
      "• Conversation is stored at " + colorifyText(conversationDisplay, accentColor) + " (clear with /clear).",
      "",
      "Commands (prefix with '/'):",
      "  " + colorifyText("/help", "BOLD") + colorifyText("               Show this help message", hintColor),
      "  " + colorifyText("/set", "BOLD") + colorifyText(" <key> <value>  Update a Mini-A parameter (use '", hintColor) + colorifyText("\"\"\"", accentColor) + colorifyText("' for multi-line values)", hintColor),
      "  " + colorifyText("/toggle", "BOLD") + colorifyText(" <key>       Toggle boolean parameter", hintColor),
      "  " + colorifyText("/unset", "BOLD") + colorifyText(" <key>        Clear a parameter", hintColor),
      "  " + colorifyText("/show", "BOLD") + colorifyText(" [prefix]      Display configured parameters (filtered by prefix)", hintColor),
      "  " + colorifyText("/reset", "BOLD") + colorifyText("              Restore default parameters", hintColor),
      "  " + colorifyText("/last", "BOLD") + colorifyText("               Print the previous final answer", hintColor),
      "  " + colorifyText("/clear", "BOLD") + colorifyText("              Reset the ongoing conversation", hintColor),
      "  " + colorifyText("/context", "BOLD") + colorifyText("            Visualize conversation/context size", hintColor),
      "  " + colorifyText("/compact", "BOLD") + colorifyText(" [n]        Summarize old context, keep last n messages", hintColor),
      "  " + colorifyText("/history", "BOLD") + colorifyText(" [n]        Show the last n conversation turns", hintColor),
      "  " + colorifyText("/exit", "BOLD") + colorifyText("               Leave the console", hintColor)
    ]
    print( ow.format.withSideLine( lines.join("\n"), __, promptColor, hintColor, ow.format.withSideLineThemes().openCurvedRect) )
  }

  const miniaLogo = ` ._ _ ${colorifyText("o", promptColor)}._ ${colorifyText("o", promptColor)}   _ 
 | | ||| ||~~(_|`
  print(colorifyText(miniaLogo, "BOLD") + colorifyText(" console", accentColor))
  print()
  print(colorifyText("Type /help for available commands.", hintColor))

  const _miniaConReset = function() {
  	if (String(java.lang.System.getProperty("os.name")).match(/Windows/)) return true
  	if (!__initializeCon() || isUnDef(__con)) return false
  	__con.getTerminal().settings.set("-icanon min 1 -echo")
  	return true
  }

  addOnOpenAFShutdown(() => {
    if (String(java.lang.System.getProperty("os.name")).match(/Windows/)) return true
    if (!__initializeCon() || isUnDef(__con)) return false
  	__con.getTerminal().settings.set("icanon echo")
  	return true
  })
  
  while(true) {
    _miniaConReset()
    var input = con.readLinePrompt(promptLabel())
    if (isUnDef(input)) break
    var trimmed = String(input)
    if (trimmed.trim().length === 0) continue
    if (trimmed === '"""') {
      var composed = collectMultiline("")
      if (isDef(composed) && composed.trim().length > 0) runGoal(composed)
      continue
    }
    if (trimmed.charAt(0) === '/') {
      var command = trimmed.substring(1).trim()
      if (command.length === 0) {
        printHelp()
        continue
      }
      if (command === "help") {
        printHelp()
        continue
      }
      if (command === "exit" || command === "quit") {
        break
      }
      if (command === "show") {
        describeOptions()
        continue
      }
      if (command.indexOf("show ") === 0) {
        var prefixFilter = command.substring(5).trim()
        describeOptions(prefixFilter.length > 0 ? prefixFilter : __)
        continue
      }
      if (command === "reset") {
        sessionOptions = resetOptions()
        lastConversationStats = __
        print(colorifyText("Parameters reset to defaults.", successColor))
        continue
      }
      if (command === "last") {
        if (isUnDef(lastResult)) {
          print(colorifyText("No goal executed yet.", hintColor))
        } else if (isObject(lastResult) || isArray(lastResult)) {
          print(stringify(lastResult, __, "  "))
        } else {
          print(lastResult)
        }
        continue
      }
      if (command === "clear") {
        clearConversationHistory()
        continue
      }
      if (command === "context") {
        printContextSummary()
        continue
      }
      if (command === "compact") {
        compactConversationContext()
        continue
      }
      if (command.indexOf("compact ") === 0) {
        var keepValue = command.substring(8).trim()
        var parsedKeep = parseInt(keepValue, 10)
        if (isNaN(parsedKeep)) {
          print(colorifyText("Usage: /compact [messagesToKeep]", errorColor))
        } else {
          compactConversationContext(parsedKeep)
        }
        continue
      }
      if (command === "history") {
        printConversationHistory()
        continue
      }
      if (command.indexOf("history ") === 0) {
        var countArg = command.substring(8).trim()
        var parsedCount = parseInt(countArg, 10)
        if (isNaN(parsedCount)) {
          print(colorifyText("Usage: /history [numberOfEntries]", errorColor))
        } else {
          printConversationHistory(parsedCount)
        }
        continue
      }
      if (command.indexOf("toggle ") === 0) {
        toggleOption(command.substring(7).trim())
        continue
      }
      if (command.indexOf("unset ") === 0) {
        unsetOption(command.substring(6).trim())
        continue
      }
      if (command.indexOf("set ") === 0) {
        var content = command.substring(4)
        var match = content.match(/^(\w+)(?:\s*=\s*|\s+)([\s\S]+)$/)
        if (!match) {
          print(colorifyText("Usage: /set <key> <value>", errorColor))
        } else {
          var key = match[1]
          var value = match[2]
          setOption(key, value)
        }
        continue
      }
      printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Unknown command: /" + command, errorColor))
      continue
    }
    var goalText = trimmed
    if (goalText.endsWith("\\")) {
      goalText = goalText.substring(0, goalText.length - 1)
      var more = collectMultiline("")
      if (more !== __) goalText = goalText + "\n" + more
    }
    runGoal(goalText)
  }

  finalizeSession("exit")
  if (isDef(ow.oJob)) ow.oJob.stop()
} catch(_ge) {
  $err(_ge)
}
