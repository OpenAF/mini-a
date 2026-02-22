// Author: Nuno Aguiar
// License: Apache 2.0
// Description: Mini-A interactive console session

try {
  plugin("Console")
  var args = processExpr(" ")
  function hasRunnableExecValue(value) {
    if (isUnDef(value) || value === null) return false
    if (isString(value)) return value.trim().length > 0
    return String(value).trim().length > 0
  }
  var hasRunnableExecArg = hasRunnableExecValue(args.exec)

  function hasHelpFlag(map) {
    if (!isObject(map)) return false
    var helpKeys = ["--help", "-h", "help", "h", "/?"]
    var found = false
    Object.keys(map).some(function(key) {
      var normalized = String(key || "").toLowerCase()
      if (helpKeys.indexOf(normalized) >= 0) {
        found = true
        return true
      }
      return false
    })
    return found
  }

  function hasCheatsheetFlag(map) {
    if (!isObject(map)) return false
    var cheatsheetKeys = ["--cheatsheet", "cheatsheet"]
    var found = false
    Object.keys(map).some(function(key) {
      var normalized = String(key || "").toLowerCase()
      if (cheatsheetKeys.indexOf(normalized) >= 0) {
        found = true
        return true
      }
      return false
    })
    return found
  }

  var helpRequested = hasHelpFlag(args)
  var cheatsheetRequested = hasCheatsheetFlag(args)

  // Init
  if (!(isString(args.libs) && args.libs.trim().length > 0)) {
    var envLibs = args.OAF_MINI_A_LIBS || getEnv("OAF_MINI_A_LIBS")
    if (isString(envLibs) && envLibs.trim().length > 0) {
      args.libs = envLibs.trim()
      //log("Using libs from OAF_MINI_A_LIBS environment variable.")
    }
    //global._args = args
  }

  if (!(isString(args.mode) && args.mode.trim().length > 0)) {
    var envMode = args.OAF_MINI_A_MODE || getEnv("OAF_MINI_A_MODE")
    if (isString(envMode) && envMode.trim().length > 0) args.mode = envMode.trim()
  }

  if (!helpRequested && !cheatsheetRequested) {
    (function(args) {
      if (args.__modeApplied === true) return
      if (!isString(args.mode)) return
      var modeName = args.mode.trim()
      if (modeName.length === 0) return

      var modesPath = getOPackPath("mini-a") + "/mini-a-modes.yaml"
      var presets = {}
      try {
        var loaded = io.readFileYAML(modesPath)
        if (isMap(loaded) && isMap(loaded.modes)) {
          presets = loaded.modes
        } else if (isMap(loaded)) {
          presets = loaded
        } else {
          presets = {}
        }
      } catch(e) {
        var errMsg = (isDef(e) && isString(e.message)) ? e.message : e
        logWarn(`Failed to load mode presets for '${modeName}': ${errMsg}`)
        args.__modeApplied = true
        return
      }

      // Load custom modes from user's home directory
      function resolveCanonicalPath(basePath, fileName) {
        return io.fileInfo((basePath || ".") + "/" + fileName).canonicalPath
      }
      var modesHome = isDef(__gHDir) ? __gHDir() : java.lang.System.getProperty("user.home")
      var customModesPath = resolveCanonicalPath(modesHome, ".openaf-mini-a_modes.yaml")
      if (io.fileExists(customModesPath)) {
        try {
          var customLoaded = io.readFileYAML(customModesPath)
          var customPresets = {}
          if (isMap(customLoaded) && isMap(customLoaded.modes)) {
            customPresets = customLoaded.modes
          } else if (isMap(customLoaded)) {
            customPresets = customLoaded
          }
          // Merge custom modes with default modes (custom overrides defaults)
          if (isMap(customPresets) && Object.keys(customPresets).length > 0) {
            presets = merge(presets, customPresets)
          }
        } catch(e) {
          var errMsg = (isDef(e) && isString(e.message)) ? e.message : e
          logWarn(`Failed to load custom mode presets from '${customModesPath}': ${errMsg}`)
        }
      }

      if (!isMap(presets) || Object.keys(presets).length === 0) {
        logWarn(`Mode '${modeName}' requested but no presets are defined.`)
        args.__modeApplied = true
        return
      }

      var keys = Object.keys(presets)
      var resolvedKey
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i]
        if (key === modeName || key.toLowerCase() === modeName.toLowerCase()) {
          resolvedKey = key
          break
        }
      }

      if (isUnDef(resolvedKey)) {
        logWarn(`Mode '${modeName}' not found. Available modes: ${keys.join(", ")}`)
        args.__modeApplied = true
        return
      }

      var preset = presets[resolvedKey]
      if (!isMap(preset)) {
        logWarn(`Mode '${resolvedKey}' preset is invalid.`)
        args.__modeApplied = true
        return
      }

      var applied = []
      var paramsSource = preset.params
      var applyParam = function(key, value) {
        if (isObject(value) || isArray(value)) value = af.toSLON(value)
        if (isString(key) && key.length > 0) {
          args[key] = value
          applied.push(key)
        }
      }

      if (isArray(paramsSource)) {
        paramsSource.forEach(function(entry) {
          if (!isMap(entry)) return
          Object.keys(entry).forEach(function(paramKey) {
            applyParam(paramKey, entry[paramKey])
          })
        })
      } else if (isMap(paramsSource)) {
        Object.keys(paramsSource).forEach(function(paramKey) {
          applyParam(paramKey, paramsSource[paramKey])
        })
      } else if (isDef(paramsSource)) {
        logWarn(`Mode '${resolvedKey}' has unsupported params definition.`)
      }

      var infoMsg = `Mode '${resolvedKey}' enabled`
      if (isString(preset.description) && preset.description.length > 0) {
        infoMsg += `: ${preset.description}`
      }
      log(infoMsg)

      if (applied.length > 0) {
        log(`Mode '${resolvedKey}' applied defaults for: ${applied.join(", ")}`)
      } else {
        log(`Mode '${resolvedKey}' did not change any arguments (overrides already provided).`)
      }

      args.mode = resolvedKey
      args.__modeApplied = true
    })(args)

    // Choose
    if (toBoolean(args.modelman) === true) {
      // Start model management mode
      load("mini-a-modelman.js")
      exit(0)
    } else if (toBoolean(args.mcptest) === true) {
      // Start MCP test mode
      load("mini-a-mcptest.js")
      exit(0)
    } else if (toBoolean(args.workermode) === true) {
      // Start worker mode
      oJobRunFile(getOPackPath("mini-a") + "/mini-a-worker.yaml", args, genUUID(), __, false)
      exit(0)
    } else if (toBoolean(args.web) === true || toBoolean(args.onport) === true) {
      // Start web mode
      oJobRunFile(getOPackPath("mini-a") + "/mini-a-web.yaml", args, genUUID(), __, false)
      exit(0)
    } else if (isDef(args.goal) && hasRunnableExecArg !== true) {
      // Start cli mode
      oJobRunFile(getOPackPath("mini-a") + "/mini-a.yaml", args, genUUID(), __, false)
      exit(0)
    }
  }

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
  loadLib("mini-a-common.js")
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
  var customCommandsDirPath = canonicalizePath(historyHome + "/.openaf-mini-a/commands")
  var customSkillsDirPath   = canonicalizePath(historyHome + "/.openaf-mini-a/skills")
  var hooksDirPath          = canonicalizePath(historyHome + "/.openaf-mini-a/hooks")
  var consoleReader         = __
  var commandHistory        = __
  var lastConversationStats = __
  var slashCommands         = ["help", "set", "toggle", "unset", "show", "reset", "last", "save", "clear", "context", "compact", "summarize", "history", "model", "stats", "skills", "delegate", "subtasks", "subtask", "exit", "quit"]
  var builtInSlashCommands  = {}
  slashCommands.forEach(function(cmd) { builtInSlashCommands[cmd] = true })
  var customSlashCommands      = {}
  var customSkillSlashCommands = {}
  var loadedHooks              = {}
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

  function unwrapSingleMarkdownCodeBlock(text) {
    if (!isString(text)) return text
    var normalized = text.replace(/\r\n/g, "\n")
    var fencedMatch = normalized.match(/^\s*```[^\n]*\n([\s\S]*?)\n```[ \t]*\s*$/)
    if (!isArray(fencedMatch) || fencedMatch.length < 2) return text
    return fencedMatch[1]
  }

  var parameterDefinitions = {
    verbose        : { type: "boolean", default: false, description: "Print detailed interaction events" },
    debug          : { type: "boolean", default: false, description: "Enable debug logging" },
    raw            : { type: "boolean", default: false, description: "Return raw LLM output without formatting adjustments" },
    showthinking   : { type: "boolean", default: false, description: "Surface XML-tagged model thinking blocks as thought logs (uses raw prompt calls)" },
    youare         : { type: "string", description: "Override the opening 'You are...' sentence in the agent prompt" },
    chatyouare     : { type: "string", description: "Override the opening chatbot persona sentence when chatbotmode=true" },
    useshell       : { type: "boolean", default: false, description: "Allow shell command execution" },
    shell          : { type: "string", description: "Prefix applied to every shell command" },
    shelltimeout   : { type: "number", description: "Maximum shell command runtime in milliseconds" },
    readwrite      : { type: "boolean", default: false, description: "Allow write operations during shell commands" },
    checkall       : { type: "boolean", default: false, description: "Ask for confirmation before shell commands" },
    shellbatch     : { type: "boolean", default: false, description: "Automatically approve shell commands" },
    shellallowpipes: { type: "boolean", default: false, description: "Allow pipes and redirections" },
    showexecs      : { type: "boolean", default: false, description: "Show shell/exec events in the interaction stream" },
    usetools       : { type: "boolean", default: false, description: "Register MCP tools directly on the model" },
    useutils       : { type: "boolean", default: false, description: "Enable bundled Mini Utils Tool utilities" },
    "mini-a-docs"  : { type: "boolean", default: false, description: "When true (with useutils=true), point utilsroot to the Mini-A opack path so the LLM can inspect Mini-A documentation files." },
    usediagrams    : { type: "boolean", default: false, description: "Encourage Mermaid diagrams in knowledge prompt" },
    usemermaid     : { type: "boolean", default: false, description: "Alias for usediagrams (Mermaid diagrams guidance)" },
    usecharts      : { type: "boolean", default: false, description: "Encourage Chart.js visuals in knowledge prompt" },
    useascii       : { type: "boolean", default: false, description: "Enable ASCII-based visuals in knowledge prompt" },
    usestream      : { type: "boolean", default: false, description: "Stream LLM tokens in real-time as they arrive" },
    useplanning    : { type: "boolean", default: false, description: "Track and expose task planning" },
    planmode       : { type: "boolean", default: false, description: "Run in plan-only mode without executing actions" },
    validateplan   : { type: "boolean", default: false, description: "Validate a plan using LLM-based critique and structure validation" },
    convertplan    : { type: "boolean", default: false, description: "Convert plan to requested format and exit" },
    resumefailed   : { type: "boolean", default: false, description: "Attempt to resume the last failed goal on startup" },
    forceplanning  : { type: "boolean", default: false, description: "Force planning even when heuristics would skip it" },
    chatbotmode    : { type: "boolean", default: false, description: "Run Mini-A in chatbot mode" },
    mcplazy        : { type: "boolean", default: false, description: "Defer MCP connection initialization" },
    mcpdynamic     : { type: "boolean", default: false, description: "Select MCP tools dynamically per goal" },
    mcpproxy       : { type: "boolean", default: false, description: "Aggregate all MCP connections through a single proxy interface" },
    nosetmcpwd     : { type: "boolean", default: false, description: "Prevent automatic MCP working directory configuration" },
    rpm            : { type: "number", description: "Requests per minute limit" },
    rtm            : { type: "number", description: "Legacy alias for rpm (requests per minute)" },
    tpm            : { type: "number", description: "Tokens per minute limit" },
    maxsteps       : { type: "number", description: "Maximum consecutive non-success steps" },
    maxcontext     : { type: "number", description: "Maximum allowed context tokens" },
    earlystopthreshold: { type: "number", description: "Number of identical consecutive errors before early stop (default: 3, increases to 5 with low-cost models)" },
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
    auditch        : { type: "string", description: "Audit channel definition" },
    toollog        : { type: "string", description: "Tool usage log channel definition" },
    deepresearch   : { type: "boolean", default: false, description: "Enable deep research mode with iterative validation" },
    maxcycles      : { type: "number", default: 3, description: "Maximum research cycles in deep research mode" },
    validationgoal : { type: "string", description: "Validation criteria for deep research outcomes (string or file path; implies deepresearch=true, maxcycles=3)" },
    valgoal        : { type: "string", description: "Alias for validationgoal (string or file path)" },
    validationthreshold: { type: "string", default: "PASS", description: "Required validation verdict (e.g., 'PASS' or 'score>=0.7')" },
    persistlearnings: { type: "boolean", default: true, description: "Carry forward learnings between deep research cycles" },
    usedelegation  : { type: "boolean", default: false, description: "Enable sub-goal delegation to child Mini-A agents" },
    workers        : { type: "string", description: "Comma-separated list of worker URLs to enable remote delegation" },
    usea2a        : { type: "boolean", default: false, description: "Use A2A HTTP+JSON/REST endpoints for remote worker delegation" },
    workerreg      : { type: "number", description: "Port for worker dynamic registration server (main instance)" },
    workerregtoken : { type: "string", description: "Bearer token for worker registration endpoints" },
    workerevictionttl: { type: "number", default: 60000, description: "Heartbeat TTL in ms before dynamic worker eviction" },
    workerregurl   : { type: "string", description: "Comma-separated registration URL(s) used by workers in workermode" },
    workerreginterval: { type: "number", default: 30000, description: "Worker heartbeat interval in ms for self-registration" },
    maxconcurrent  : { type: "number", default: 4, description: "Maximum concurrent child agents when delegation is enabled" },
    delegationmaxdepth: { type: "number", default: 3, description: "Maximum delegation nesting depth" },
    delegationtimeout: { type: "number", default: 300000, description: "Default subtask deadline in milliseconds" },
    delegationmaxretries: { type: "number", default: 2, description: "Default retry count for failed subtasks" },
    showdelegate   : { type: "boolean", default: false, description: "Show delegate/subtask events as separate lines (default keeps them inline)" },
    extracommands  : { type: "string", description: "Comma-separated extra directories for custom slash commands" },
    extraskills    : { type: "string", description: "Comma-separated extra directories for custom skills" },
    extrahooks     : { type: "string", description: "Comma-separated extra directories for custom hooks" }
  }

  if (isDef(parameterDefinitions.conversation) && !(io.fileExists(conversationFilePath) && io.fileInfo(conversationFilePath).isDirectory)) parameterDefinitions.conversation.default = conversationFilePath
  var sessionParameterNames = Object.keys(parameterDefinitions).sort()

  var cliPrimaryOptionKeys = {
    mode: true,
    libs: true,
    goal: true,
    exec: true,
    onport: true,
    web: true,
    modelman: true,
    mcptest: true,
    workermode: true,
    resume: true,
    conversation: true,
    "--help": true,
    "-h": true,
    "--cheatsheet": true
  }

  function formatDefaultValue(value) {
    if (isUnDef(value)) return ""
    if (isString(value)) return value
    if (isNumber(value) || isBoolean(value)) return String(value)
    try {
      return af.toSLON(value)
    } catch(ignoreFormat) {
      return String(value)
    }
  }

  function buildSharedArgumentRows() {
    if (!isObject(parameterDefinitions)) return []
    var rows = []
    Object.keys(parameterDefinitions).sort().forEach(function(name) {
      if (Object.prototype.hasOwnProperty.call(cliPrimaryOptionKeys, name)) return
      var def = parameterDefinitions[name] || {}
      rows.push({
        Argument   : name,
        Type       : isString(def.type) ? def.type : "",
        Default    : Object.prototype.hasOwnProperty.call(def, "default") ? formatDefaultValue(def.default) : "",
        Description: isString(def.description) ? def.description : ""
      })
    })
    return rows
  }

  function printCliHelp() {
    function printOption(option, description, maxLength) {
      print("  " + colorifyText(option, accentColor) + repeat(maxLength - option.length, " ") + " " + colorifyText("  " + description, hintColor))
    }

    print(colorifyText("Mini-A (version " + $from($m4a(getOPackLocalDB())).equals("name", "mini-a").at(0).version + ") options:\n", "BOLD"))

    const options = [
      { option: "mode=<name>", description: "Apply one of the presets defined in mini-a-modes." },
      { option: "libs=<list>", description: "Comma-separated libs to load before launching." },
      { option: "goal=<text>", description: "Execute a single goal in CLI mode and exit when done." },
      { option: "exec=\"/<cmd> ...args\"", description: "Execute one custom command/skill template and exit (use /cmd or $skill)." },
      { option: "onport=<port>", description: "Start the Mini-A web UI on the provided port (alias for web mode)." },
      { option: "modelman=true", description: "Start the model manager instead of the console experience." },
      { option: "mcptest=true", description: "Start the MCP test client instead of the console experience." },
      { option: "workermode=true", description: "Start the headless worker API server (mini-a-worker.yaml)." },
      { option: "resume=true", description: "Reuse the last conversation and continue from where you left." },
      { option: "conversation=<fp>", description: "Path to a conversation JSON file to reuse/save." },
      { option: "--help | -h", description: "Show this help text." },
      { option: "--cheatsheet", description: "Render CHEATSHEET.md and exit." }
    ]

    var maxOptionLength = options.reduce(function(max, opt) {
      return Math.max(max, opt.option.length)
    }, 0)
    options.forEach(function(opt) {
      printOption(opt.option, opt.description, maxOptionLength)
    })

    var sharedRows = buildSharedArgumentRows()
    if (sharedRows.length > 0) {
      print("")
      print(colorifyText("Shared Mini-A arguments (common across modules):", "BOLD") + "\n")
      print(printTable(sharedRows, (__conAnsi ? isDef(__con) && __con.getTerminal().getWidth() : __), true, __conAnsi, (__conAnsi ? "utf" : __), __, true, false, true))
    }

    print("")
    print(colorifyText("Examples:", "BOLD") + "\n")
    const examples = [
      { cmd: "mini-a mode=research goal=\"Summarize the project plan.\"", desc: "# Load research mode and run a goal." },
      { cmd: "mini-a onport=9090", desc: "# Start web chat on port 9090." },
      { cmd: "mini-a modelman=true", desc: "# Launch model manager UI." },
      { cmd: "mini-a mcptest=true", desc: "# Launch MCP test client." },
      { cmd: "mini-a workermode=true onport=8080", desc: "# Launch worker API on port 8080." }
    ]

    var maxCmdLength = examples.reduce(function(max, ex) {
      return Math.max(max, ex.cmd.length)
    }, 0)
    examples.forEach(function(ex) {
      printOption(ex.cmd, ex.desc, maxCmdLength)
    })
  }

  if (helpRequested) {
    printCliHelp()
    exit(0)
  }

  function printCheatSheet() {
    var cheatsheetPath = getOPackPath("mini-a") + "/CHEATSHEET.md"
    if (!io.fileExists(cheatsheetPath)) cheatsheetPath = resolveCanonicalPath(".", "CHEATSHEET.md")
    if (!io.fileExists(cheatsheetPath)) {
      printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Unable to locate CHEATSHEET.md.", errorColor))
      return false
    }

    try {
      var cheatsheet = io.readFileString(cheatsheetPath)
      print(format.withMD(cheatsheet))
      return true
    } catch (cheatsheetError) {
      printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Unable to render CHEATSHEET.md: " + cheatsheetError, errorColor))
      return false
    }
  }

  if (cheatsheetRequested) {
    if (printCheatSheet()) exit(0)
    exit(1)
  }

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
      var parsedNum = Number(rawValue)
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

  // Helper function to get file completions
  function getFileCompletions(partialPath) {
    var completions = []
    try {
      var dirPath = "."
      var filePrefix = partialPath

      // Split the path into directory and file prefix
      var lastSlash = partialPath.lastIndexOf("/")
      if (lastSlash !== -1) {
        dirPath = partialPath.substring(0, lastSlash)
        filePrefix = partialPath.substring(lastSlash + 1)
        if (dirPath.length === 0) dirPath = "/"
      }

      // List files in the directory
      if (io.fileExists(dirPath)) {
        var files = io.listFiles(dirPath)
        if (isObject(files) && isArray(files.files)) {
          files.files.forEach(function(file) {
            if (file.filename.indexOf(filePrefix) === 0) {
              var fullPath = (dirPath === "." ? "" : dirPath + "/") + file.filename
              if (file.isDirectory) fullPath += "/"
              completions.push(fullPath)
            }
          })
        }
      }
    } catch(e) {
      // Ignore errors during file listing
    }
    return completions
  }

  function resolveSkillTemplateFromFolder(folderPath) {
    return __miniAResolveSkillTemplateFromFolder(folderPath)
  }

  function readSkillDescriptionFromTemplate(templatePath) {
    return __miniAReadSkillDescriptionFromTemplate(templatePath)
  }

  function parseExtraDirPaths(commaSeparated) {
    if (!isString(commaSeparated) || commaSeparated.trim().length === 0) return []
    return commaSeparated.split(",")
      .map(function(s) { return s.trim() })
      .filter(function(s) { return s.length > 0 })
      .map(function(s) { return canonicalizePath(s) })
  }

  function loadSlashCommandsFromDir(dirPath, existingNames, options) {
    var loaded = {}
    var opts = isObject(options) ? options : {}
    var enableSkillFolders = opts.enableSkillFolders === true
    var sourceLabel = isString(opts.sourceLabel) ? opts.sourceLabel : "slash commands"
    var sourceCategory = isString(opts.sourceCategory) ? opts.sourceCategory : "command"
    try {
      if (!io.fileExists(dirPath)) return loaded
      var info = io.fileInfo(dirPath)
      if (!isObject(info) || info.isDirectory !== true) return loaded
      var listing = io.listFiles(dirPath)
      if (!isObject(listing) || !isArray(listing.files)) return loaded

      listing.files.forEach(function(file) {
        if (!isObject(file)) return
        if (!isString(file.filename) || file.filename.length === 0) return
        if (file.filename.indexOf(".") === 0) return

        var commandName
        var fullPath
        var sourceType = "file"

        if (file.isDirectory === true) {
          if (enableSkillFolders !== true) return
          commandName = file.filename.toLowerCase()
          fullPath = resolveSkillTemplateFromFolder(canonicalizePath(dirPath + "/" + file.filename))
          if (isUnDef(fullPath)) {
            logWarn("Ignoring skill folder without SKILL.md/skill.md: " + file.filename)
            return
          }
          sourceType = "folder"
        } else {
          if (!/\.md$/i.test(file.filename)) return
          commandName = file.filename.replace(/\.md$/i, "").toLowerCase()
          fullPath = canonicalizePath(dirPath + "/" + file.filename)
        }

        if (!/^[a-z0-9][a-z0-9_-]*$/.test(commandName)) {
          logWarn("Ignoring " + sourceLabel + " entry with invalid name: " + file.filename)
          return
        }
        if (Object.prototype.hasOwnProperty.call(builtInSlashCommands, commandName)) {
          logWarn("Ignoring '/" + commandName + "' because it conflicts with a built-in command.")
          return
        }
        if (isObject(existingNames) && Object.prototype.hasOwnProperty.call(existingNames, commandName)) {
          logWarn("Ignoring '/" + commandName + "' in '" + dirPath + "' because it conflicts with an existing command.")
          return
        }
        if (Object.prototype.hasOwnProperty.call(loaded, commandName)) {
          logWarn("Ignoring duplicate '/" + commandName + "' in '" + dirPath + "'.")
          return
        }

        loaded[commandName] = {
          name: commandName,
          file: fullPath,
          sourceType: sourceType,
          sourceCategory: sourceCategory,
          description: (sourceType === "folder") ? readSkillDescriptionFromTemplate(fullPath) : __
        }
      })
    } catch (loadError) {
      logWarn("Failed to load " + sourceLabel + " from '" + dirPath + "': " + loadError)
    }
    return loaded
  }

  function loadHooksFromDir(dirPath, hooks) {
    var validEvents = ["before_goal", "after_goal", "before_tool", "after_tool", "before_shell", "after_shell"]
    try {
      if (!io.fileExists(dirPath)) return
      var info = io.fileInfo(dirPath)
      if (!isObject(info) || info.isDirectory !== true) return
      var listing = io.listFiles(dirPath)
      if (!isObject(listing) || !isArray(listing.files)) return

      listing.files.forEach(function(file) {
        if (!isObject(file) || file.isDirectory === true) return
        if (!isString(file.filename) || file.filename.length === 0) return
        if (!/\.(yaml|yml|json)$/i.test(file.filename)) return

        var fullPath = canonicalizePath(dirPath + "/" + file.filename)
        try {
          var hookDef
          if (/\.json$/i.test(file.filename)) {
            hookDef = io.readFileJSON(fullPath)
          } else {
            hookDef = io.readFileYAML(fullPath)
          }
          if (!isObject(hookDef)) return
          var event = isString(hookDef.event) ? hookDef.event.trim().toLowerCase() : ""
          if (validEvents.indexOf(event) < 0) {
            logWarn("Hook '" + file.filename + "' has invalid or missing event type: '" + event + "'")
            return
          }
          var cmd = isString(hookDef.command) ? hookDef.command.trim() : ""
          if (cmd.length === 0) {
            logWarn("Hook '" + file.filename + "' has no command defined.")
            return
          }
          var toolFilter = []
          if (isString(hookDef.toolFilter) && hookDef.toolFilter.trim().length > 0) {
            toolFilter = hookDef.toolFilter.split(",").map(function(s) { return s.trim().toLowerCase() }).filter(function(s) { return s.length > 0 })
          }
          hooks[event].push({
            name        : file.filename.replace(/\.(yaml|yml|json)$/i, ""),
            file        : fullPath,
            event       : event,
            command     : cmd,
            toolFilter  : toolFilter,
            injectOutput: parseBoolean(hookDef.injectOutput) === true,
            timeout     : (isNumber(hookDef.timeout) && hookDef.timeout > 0) ? hookDef.timeout : 5000,
            failBlocks  : parseBoolean(hookDef.failBlocks) === true,
            env         : isObject(hookDef.env) ? hookDef.env : {}
          })
        } catch (hookParseError) {
          logWarn("Failed to parse hook file '" + file.filename + "': " + hookParseError)
        }
      })
    } catch (hookLoadError) {
      logWarn("Failed to load hooks from '" + dirPath + "': " + hookLoadError)
    }
  }

  function loadHooks() {
    var validEvents = ["before_goal", "after_goal", "before_tool", "after_tool", "before_shell", "after_shell"]
    var hooks = {}
    validEvents.forEach(function(ev) { hooks[ev] = [] })
    loadHooksFromDir(hooksDirPath, hooks)
    return hooks
  }

  function runHooks(event, contextVars) {
    var hooksForEvent = isArray(loadedHooks[event]) ? loadedHooks[event] : []
    if (hooksForEvent.length === 0) return { outputs: [], blocked: false }

    var outputs = []
    var blocked = false
    var vars = isObject(contextVars) ? contextVars : {}

    hooksForEvent.forEach(function(hook) {
      if (hook.toolFilter.length > 0 && isString(vars.MINI_A_TOOL)) {
        var toolLower = vars.MINI_A_TOOL.toLowerCase()
        if (hook.toolFilter.indexOf(toolLower) < 0) return
      }
      try {
        var env = {}
        Object.keys(hook.env).forEach(function(k) { env[k] = String(hook.env[k]) })
        Object.keys(vars).forEach(function(k) { env[k] = String(vars[k]) })
        env.MINI_A_HOOK_NAME  = hook.name
        env.MINI_A_HOOK_EVENT = event

        var result = $sh(hook.command).timeout(hook.timeout).envs(env).get(0)
        var stdout   = isString(result.stdout)   ? result.stdout.trim()   : ""
        var stderr   = isString(result.stderr)   ? result.stderr.trim()   : ""
        var exitCode = isNumber(result.exitcode) ? result.exitcode        : -1

        if (exitCode !== 0) {
          logWarn("Hook '" + hook.name + "' (" + event + ") exited with code " + exitCode + (stderr.length > 0 ? ": " + stderr.substring(0, 200) : ""))
          if (hook.failBlocks) blocked = true
        }
        if (hook.injectOutput && stdout.length > 0) {
          outputs.push({ hookName: hook.name, output: stdout.substring(0, 4096) })
        }
      } catch (hookExecError) {
        logWarn("Hook '" + hook.name + "' (" + event + ") failed: " + hookExecError)
        if (hook.failBlocks) blocked = true
      }
    })

    return { outputs: outputs, blocked: blocked }
  }

  function getCustomSlashCommandNames() {
    var unique = {}
    Object.keys(customSlashCommands).forEach(function(name) { unique[name] = true })
    Object.keys(customSkillSlashCommands).forEach(function(name) { unique[name] = true })
    return Object.keys(unique).sort()
  }

  function getAllSlashCommandNames() {
    return slashCommands.concat(getCustomSlashCommandNames())
  }

  function findCustomTemplateDefinition(commandName, options) {
    var name = isString(commandName) ? commandName.trim().toLowerCase() : ""
    if (name.length === 0) return __
    var opts = isObject(options) ? options : {}
    var includeCommands = opts.includeCommands !== false
    var includeSkills = opts.includeSkills !== false

    if (includeSkills && Object.prototype.hasOwnProperty.call(customSkillSlashCommands, name)) return customSkillSlashCommands[name]
    if (includeCommands && Object.prototype.hasOwnProperty.call(customSlashCommands, name)) return customSlashCommands[name]
    return __
  }

  function normalizeSkillReferencePath(rawPath) {
    if (!isString(rawPath)) return __
    var normalized = rawPath.trim()
    if (normalized.length === 0) return __
    if (normalized.charAt(0) === "<" && normalized.charAt(normalized.length - 1) === ">") {
      normalized = normalized.substring(1, normalized.length - 1).trim()
    }
    if (normalized.length === 0) return __
    return normalized
  }

  function isAbsoluteOrExternalPath(pathValue) {
    if (!isString(pathValue) || pathValue.length === 0) return false
    if (pathValue.charAt(0) === "/" || pathValue.charAt(0) === "~") return true
    if (/^[A-Za-z]:[\\/]/.test(pathValue)) return true
    if (/^[a-z][a-z0-9+.-]*:/i.test(pathValue)) return true
    if (pathValue.indexOf("//") === 0) return true
    return false
  }

  function splitAttachmentToken(rawToken) {
    var token = isString(rawToken) ? rawToken : ""
    var suffix = ""
    while (token.length > 0) {
      var lastChar = token.charAt(token.length - 1)
      if (/[,.;:!?)\]}'"]/.test(lastChar)) {
        suffix = lastChar + suffix
        token = token.substring(0, token.length - 1)
        continue
      }
      break
    }
    return { filePath: token, suffix: suffix }
  }

  function preprocessSkillTemplateReferences(templateText, templateDef) {
    if (!isString(templateText) || templateText.length === 0) return templateText
    if (!isObject(templateDef) || templateDef.sourceCategory !== "skill") return templateText
    if (!isString(templateDef.file) || templateDef.file.trim().length === 0) return templateText

    var templatePath = canonicalizePath(templateDef.file)
    var templateDir = templatePath.replace(/[\\\/][^\\\/]+$/, "")
    if (!isString(templateDir) || templateDir.length === 0) return templateText

    var text = String(templateText)

    // Resolve relative @file tokens against the skill folder so @reference.md works naturally.
    var chunks = []
    var cursor = 0
    var wsPattern = /\s/
    while (cursor < text.length) {
      var atPos = text.indexOf("@", cursor)
      if (atPos < 0) {
        chunks.push(text.substring(cursor))
        break
      }

      var backslashes = 0
      for (var b = atPos - 1; b >= 0 && text.charAt(b) === "\\"; b--) backslashes++
      if (backslashes > 0) {
        chunks.push(text.substring(cursor, atPos + 1))
        cursor = atPos + 1
        continue
      }

      var endPos = atPos + 1
      while (endPos < text.length && !wsPattern.test(text.charAt(endPos))) endPos++
      var rawToken = text.substring(atPos + 1, endPos)
      var tokenParts = splitAttachmentToken(rawToken)
      var filePath = normalizeSkillReferencePath(tokenParts.filePath)
      var replacement = "@" + tokenParts.filePath

      if (isString(filePath) && filePath.length > 0 && !isAbsoluteOrExternalPath(filePath)) {
        var resolved = canonicalizePath(templateDir + "/" + filePath)
        try {
          if (io.fileExists(resolved) && io.fileInfo(resolved).isFile === true) replacement = "@" + resolved
        } catch(ignoreResolvedSkillRefError) { }
      }

      chunks.push(text.substring(cursor, atPos))
      chunks.push(replacement)
      if (tokenParts.suffix.length > 0) chunks.push(tokenParts.suffix)
      cursor = endPos
    }
    text = chunks.join("")

    // Auto-include relative markdown links from the skill folder.
    var includedPaths = {}
    var includeBlocks = []
    text.replace(/\[[^\]]*\]\(([^)\n]+)\)/g, function(_, targetSpec) {
      var spec = isString(targetSpec) ? targetSpec.trim() : ""
      if (spec.length === 0) return _
      var firstToken = spec.split(/\s+/)[0]
      var normalizedTarget = normalizeSkillReferencePath(firstToken)
      if (!isString(normalizedTarget) || normalizedTarget.length === 0) return _
      if (normalizedTarget.charAt(0) === "#") return _
      if (isAbsoluteOrExternalPath(normalizedTarget)) return _

      var cleanTarget = normalizedTarget.split("#")[0].split("?")[0]
      if (!/\.md$/i.test(cleanTarget)) return _

      var resolvedPath = canonicalizePath(templateDir + "/" + cleanTarget)
      if (Object.prototype.hasOwnProperty.call(includedPaths, resolvedPath)) return _
      includedPaths[resolvedPath] = true

      try {
        if (!io.fileExists(resolvedPath) || io.fileInfo(resolvedPath).isFile !== true) return _
        var refContent = io.readFileString(resolvedPath)
        includeBlocks.push("\n\n--- Skill reference from " + cleanTarget + " ---\n" + refContent + "\n--- End of " + cleanTarget + " ---\n")
      } catch(ignoreSkillRefError) { }
      return _
    })

    if (includeBlocks.length > 0) text += includeBlocks.join("")
    return text
  }

  function parseSlashCommandInput(commandText) {
    var raw = isString(commandText) ? commandText.trim() : ""
    if (raw.length === 0) {
      return { name: "", argsRaw: "" }
    }
    var firstSpace = raw.indexOf(" ")
    if (firstSpace === -1) {
      return { name: raw.toLowerCase(), argsRaw: "" }
    }
    return {
      name: raw.substring(0, firstSpace).trim().toLowerCase(),
      argsRaw: raw.substring(firstSpace + 1).trim()
    }
  }

  function parseSlashArgs(rawArgs) {
    var raw = isString(rawArgs) ? rawArgs.trim() : ""
    if (raw.length === 0) return { ok: true, raw: "", argv: [], argc: 0 }

    var argv = []
    var current = ""
    var quote = ""
    var escaping = false

    for (var i = 0; i < raw.length; i++) {
      var ch = raw.charAt(i)

      if (escaping) {
        current += ch
        escaping = false
        continue
      }

      if (ch === "\\") {
        escaping = true
        continue
      }

      if (quote.length > 0) {
        if (ch === quote) {
          quote = ""
        } else {
          current += ch
        }
        continue
      }

      if (ch === "'" || ch === "\"") {
        quote = ch
        continue
      }

      if (/\s/.test(ch)) {
        if (current.length > 0) {
          argv.push(current)
          current = ""
        }
        continue
      }

      current += ch
    }

    if (escaping || quote.length > 0) {
      return { ok: false, error: "Unbalanced quotes or trailing escape in arguments." }
    }
    if (current.length > 0) argv.push(current)

    return {
      ok: true,
      raw: raw,
      argv: argv,
      argc: argv.length
    }
  }

  function renderCustomSlashTemplate(template, parsedArgs) {
    return __miniARenderSkillTemplate(template, parsedArgs)
  }

  function tryExpandInlineSkillInvocation(text) {
    if (!isString(text) || text.length === 0) return { changed: false, text: text }

    var goalText = String(text)
    var skillRegex = /\$([a-z0-9][a-z0-9_-]*)/ig
    var match

    while ((match = skillRegex.exec(goalText)) !== null) {
      var fullToken = match[0]
      var skillName = String(match[1] || "").toLowerCase()
      var tokenStart = match.index
      var tokenEnd = tokenStart + fullToken.length

      // Allow escaping \$skill to keep it literal.
      var backslashes = 0
      for (var i = tokenStart - 1; i >= 0 && goalText.charAt(i) === "\\"; i--) backslashes++
      if (backslashes > 0) continue

      var matchedSkillDef = findCustomTemplateDefinition(skillName, { includeCommands: false, includeSkills: true })
      if (isUnDef(matchedSkillDef)) continue

      try {
        if (!io.fileExists(matchedSkillDef.file) || io.fileInfo(matchedSkillDef.file).isFile !== true) {
          printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Template file is missing: " + matchedSkillDef.file, errorColor))
          return { changed: false, text: goalText }
        }

        var argsRaw = goalText.substring(tokenEnd).trim()
        var parsedSkillArgs = parseSlashArgs(argsRaw)
        if (parsedSkillArgs.ok !== true) {
          print(colorifyText("Usage: $" + skillName + " [args...]", errorColor))
          printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" " + parsedSkillArgs.error, errorColor))
          return { changed: false, text: goalText }
        }

        var skillTemplate = io.readFileString(matchedSkillDef.file)
        var goalFromSkillTemplate = renderCustomSlashTemplate(skillTemplate, parsedSkillArgs)
        goalFromSkillTemplate = preprocessSkillTemplateReferences(goalFromSkillTemplate, matchedSkillDef)
        var prefix = goalText.substring(0, tokenStart)
        var separator = ""
        if (prefix.length > 0 && !/\s$/.test(prefix)) separator = "\n\n"
        var combined = prefix + separator + goalFromSkillTemplate
        return { changed: true, text: combined }
      } catch (inlineSkillError) {
        printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Failed to execute '$" + skillName + "': " + inlineSkillError, errorColor))
        return { changed: false, text: goalText }
      }
    }

    return { changed: false, text: goalText }
  }

  customSlashCommands      = loadSlashCommandsFromDir(customCommandsDirPath, {}, { sourceLabel: "slash commands", sourceCategory: "command" })
  customSkillSlashCommands = loadSlashCommandsFromDir(customSkillsDirPath, {}, { sourceLabel: "skills", enableSkillFolders: true, sourceCategory: "skill" })
  loadedHooks              = loadHooks()

  var extraCommandsDirs = parseExtraDirPaths(findArgumentValue(args, "extracommands"))
  extraCommandsDirs.forEach(function(dir) {
    var extra = loadSlashCommandsFromDir(dir, customSlashCommands, { sourceLabel: "extra slash commands", sourceCategory: "command" })
    Object.keys(extra).forEach(function(k) {
      if (!Object.prototype.hasOwnProperty.call(customSlashCommands, k)) customSlashCommands[k] = extra[k]
    })
  })

  var extraSkillsDirs = parseExtraDirPaths(findArgumentValue(args, "extraskills"))
  extraSkillsDirs.forEach(function(dir) {
    var extra = loadSlashCommandsFromDir(dir, customSkillSlashCommands, { sourceLabel: "extra skills", enableSkillFolders: true, sourceCategory: "skill" })
    Object.keys(extra).forEach(function(k) {
      if (!Object.prototype.hasOwnProperty.call(customSkillSlashCommands, k)) customSkillSlashCommands[k] = extra[k]
    })
  })

  var extraHooksDirs = parseExtraDirPaths(findArgumentValue(args, "extrahooks"))
  extraHooksDirs.forEach(function(dir) {
    loadHooksFromDir(dir, loadedHooks)
  })

  if (consoleReader) {
    try {
      var slashParameterHints = { set: "=", toggle: "", unset: "", show: "" }
      var statsCompletions = ["detailed", "tools", "out=", "file=", "save=", "json="]
      var lastCompletions = ["md"]
      var modelCompletions = ["model", "modellc"]
      var contextCompletions = ["llm", "analyze"]
      consoleReader.addCompleter(
        new Packages.openaf.jline.OpenAFConsoleCompleter(function(buf, cursor, candidates) {
          if (isUnDef(buf)) return -1
          var uptoCursor = buf.substring(0, cursor)

          // Handle @ file completion (anywhere in the line)
          var lastAtPos = uptoCursor.lastIndexOf("@")
          if (lastAtPos !== -1) {
            var afterAt = uptoCursor.substring(lastAtPos + 1)
            // Only complete if there's no space after @
            if (afterAt.indexOf(" ") === -1) {
              var fileCompletions = getFileCompletions(afterAt)
              fileCompletions.forEach(function(path) {
                candidates.add(path)
              })
              return candidates.isEmpty() ? -1 : (lastAtPos + 1)
            }
          }

          // Handle $skill completions (anywhere in the line)
          var lastDollarPos = uptoCursor.lastIndexOf("$")
          if (lastDollarPos !== -1) {
            var afterDollar = uptoCursor.substring(lastDollarPos + 1)
            // Only complete if there's no space after $
            if (afterDollar.indexOf(" ") === -1) {
              // Respect escaped \$skill usage.
              var escapedDollar = false
              for (var j = lastDollarPos - 1; j >= 0 && uptoCursor.charAt(j) === "\\"; j--) {
                escapedDollar = true
              }
              if (!escapedDollar) {
                var partialSkill = afterDollar.toLowerCase()
                if (/^[a-z0-9_-]*$/.test(partialSkill)) {
                  Object.keys(customSkillSlashCommands).sort().forEach(function(name) {
                    if (name.toLowerCase().indexOf(partialSkill) === 0) candidates.add("$" + name)
                  })
                  return candidates.isEmpty() ? -1 : lastDollarPos
                }
              }
            }
          }

          // Only handle slash commands if line starts with /
          if (uptoCursor.indexOf("/") !== 0) return -1

          var firstSpace = uptoCursor.indexOf(" ")
          if (firstSpace === -1) {
            var partialCommand = uptoCursor.toLowerCase()
            getAllSlashCommandNames().forEach(function(cmd) {
              var candidateCommand = "/" + cmd
              if (candidateCommand.toLowerCase().indexOf(partialCommand) === 0) candidates.add(candidateCommand)
            })
            return candidates.isEmpty() ? -1 : 0
          }

          var commandName = uptoCursor.substring(1, firstSpace)
          var lookupName = commandName.toLowerCase()

          // Handle /save command completions (filename)
          if (lookupName === "save") {
            var remainder = uptoCursor.substring(firstSpace + 1)
            var trimmedRemainder = remainder.replace(/^\s*/, "")
            var insertionPoint = cursor - trimmedRemainder.length

            var fileCompletions = getFileCompletions(trimmedRemainder)
            fileCompletions.forEach(function(path) {
              candidates.add(path)
            })
            return candidates.isEmpty() ? -1 : Number(insertionPoint)
          }

          // Handle /stats command completions
          if (lookupName === "stats") {
            var remainder = uptoCursor.substring(firstSpace + 1)
            var trimmedRemainder = remainder.replace(/^\s*/, "")
            var insertionPoint = cursor - trimmedRemainder.length
            var lastSpace = trimmedRemainder.lastIndexOf(" ")
            var token = lastSpace >= 0 ? trimmedRemainder.substring(lastSpace + 1) : trimmedRemainder
            var tokenInsertionPoint = insertionPoint + (lastSpace >= 0 ? (lastSpace + 1) : 0)
            var tokenLower = token.toLowerCase()
            var fileMatch = token.match(/^(out|file|save|json)=(.*)$/i)

            if (fileMatch) {
              var keyPrefix = fileMatch[1] + "="
              var pathPrefix = fileMatch[2]
              var fileCompletions = getFileCompletions(pathPrefix)
              fileCompletions.forEach(function(path) {
                candidates.add(keyPrefix + path)
              })
              return candidates.isEmpty() ? -1 : Number(tokenInsertionPoint)
            }

            statsCompletions.forEach(function(mode) {
              if (mode.indexOf(tokenLower) === 0) candidates.add(mode)
            })
            return candidates.isEmpty() ? -1 : Number(tokenInsertionPoint)
          }

          // Handle /last command completions
          if (lookupName === "last") {
            var remainder = uptoCursor.substring(firstSpace + 1)
            var trimmedRemainder = remainder.replace(/^\s*/, "")
            var insertionPoint = cursor - trimmedRemainder.length

            lastCompletions.forEach(function(mode) {
              if (mode.indexOf(trimmedRemainder) === 0) candidates.add(mode)
            })
            return candidates.isEmpty() ? -1 : Number(insertionPoint)
          }

          // Handle /model command completions
          if (lookupName === "model") {
            var remainder = uptoCursor.substring(firstSpace + 1)
            var trimmedRemainder = remainder.replace(/^\s*/, "")
            var insertionPoint = cursor - trimmedRemainder.length

            modelCompletions.forEach(function(target) {
              if (target.indexOf(trimmedRemainder) === 0) candidates.add(target)
            })
            return candidates.isEmpty() ? -1 : Number(insertionPoint)
          }

          // Handle /context command completions
          if (lookupName === "context") {
            var remainder = uptoCursor.substring(firstSpace + 1)
            var trimmedRemainder = remainder.replace(/^\s*/, "")
            var insertionPoint = cursor - trimmedRemainder.length

            contextCompletions.forEach(function(option) {
              if (option.indexOf(trimmedRemainder) === 0) candidates.add(option)
            })
            return candidates.isEmpty() ? -1 : Number(insertionPoint)
          }

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

  function getTokenAnalysisFromLLM(agentInstance, entries) {
    if (!isObject(agentInstance)) {
      return __
    }

    // Select LLM: prefer low-cost if available, otherwise use main
    var analyzeLLM = (isObject(agentInstance.lc_llm)) ? agentInstance.lc_llm : agentInstance.llm
    if (!isObject(analyzeLLM) || typeof analyzeLLM.prompt !== "function") {
      return __
    }

    // Build a prompt asking the LLM to analyze token counts
    var analysisPrompt = "Analyze the following conversation and provide a breakdown of token counts by message role category.\n\n"
    analysisPrompt += "Categories:\n"
    analysisPrompt += "- System: Messages with role 'system' or 'developer'\n"
    analysisPrompt += "- User: Messages with role 'user'\n"
    analysisPrompt += "- Assistant: Messages with role 'assistant'\n"
    analysisPrompt += "- Tool: Messages with role 'tool', 'function', or 'observation'\n"
    analysisPrompt += "- Other: Any other message types\n\n"
    analysisPrompt += "Conversation:\n"
    analysisPrompt += "---\n"

    entries.forEach(function(entry, idx) {
      var role = isString(entry.role) ? entry.role : "unknown"
      var content = flattenConversationContent(entry.content)
      var preview = content.length > 200 ? content.substring(0, 200) + "..." : content
      analysisPrompt += "Message " + (idx + 1) + " [" + role + "]: " + preview + "\n"
    })

    analysisPrompt += "---\n\n"
    analysisPrompt += "Return ONLY a JSON object with this exact structure (no markdown, no explanation):\n"
    analysisPrompt += "{\n"
    analysisPrompt += "  \"system_tokens\": <number>,\n"
    analysisPrompt += "  \"user_tokens\": <number>,\n"
    analysisPrompt += "  \"assistant_tokens\": <number>,\n"
    analysisPrompt += "  \"tool_tokens\": <number>,\n"
    analysisPrompt += "  \"other_tokens\": <number>,\n"
    analysisPrompt += "  \"total_tokens\": <number>\n"
    analysisPrompt += "}"

    try {
      var response
      if (typeof analyzeLLM.promptWithStats === "function") {
        var result = analyzeLLM.promptWithStats(analysisPrompt)
        response = isObject(result) ? result.response : result
      } else {
        response = analyzeLLM.prompt(analysisPrompt)
      }

      if (!isString(response) || response.trim().length === 0) {
        return __
      }

      // Try to extract JSON from response (handle markdown code blocks)
      var jsonMatch = response.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        return __
      }

      var parsed = JSON.parse(jsonMatch[0])
      if (!isObject(parsed)) {
        return __
      }

      return parsed
    } catch (analysisError) {
      printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" LLM token analysis failed: " + analysisError, errorColor))
      return __
    }
  }

  function printContextSummary(agentInstance, useLLMAnalysis) {
    var stats = refreshConversationStats(agentInstance)
    if (!isObject(stats) || stats.messageCount === 0) {
      print(colorifyText("No active conversation found. Run a goal first to populate context.", hintColor))
      if (isObject(stats) && isString(stats.path) && stats.path.length > 0) {
        print(colorifyText("Conversation path: " + stats.path, hintColor))
      }
      return
    }

    // If LLM analysis is requested, try to get it
    var llmAnalysis = __
    if (useLLMAnalysis === true) {
      if (!isObject(agentInstance)) {
        print(colorifyText("No active agent available. LLM analysis requires an active session.", hintColor))
        print(colorifyText("Run a goal first, then use '/context llm' or '/context analyze'.", hintColor))
        return
      }

      print(colorifyText("Requesting token analysis from LLM...", hintColor))
      llmAnalysis = getTokenAnalysisFromLLM(agentInstance, stats.entries)

      if (!isObject(llmAnalysis)) {
        print(colorifyText("LLM analysis failed. Falling back to internal estimates.", hintColor))
        useLLMAnalysis = false
      } else {
        // Override stats with LLM analysis
        stats.sections = [
          { section: "System", tokens: llmAnalysis.system_tokens || 0, chars: 0, messages: stats.sections[0].messages },
          { section: "User", tokens: llmAnalysis.user_tokens || 0, chars: 0, messages: stats.sections[1].messages },
          { section: "Assistant", tokens: llmAnalysis.assistant_tokens || 0, chars: 0, messages: stats.sections[2].messages },
          { section: "Tool", tokens: llmAnalysis.tool_tokens || 0, chars: 0, messages: stats.sections[3].messages },
          { section: "Other", tokens: llmAnalysis.other_tokens || 0, chars: 0, messages: stats.sections[4].messages }
        ]
        stats.totalTokens = llmAnalysis.total_tokens || 0
        stats.estimateMethod = "llm"
      }
    }

    // Define colors and patterns for each section type
    var sectionStyles = {
      "System"    : { color: "FG(117)", pattern: "█", label: "System" },
      "User"      : { color: "FG(147)", pattern: "▓", label: "User" },
      "Assistant" : { color: "FG(218)", pattern: "▒", label: "Assistant" },
      "Tool"      : { color: "FG(155)", pattern: "░", label: "Tool" },
      "Other"     : { color: "FG(249)", pattern: "·", label: "Other" }
    }

    print(colorifyText("Conversation context usage", accentColor))
    print()

    // Calculate available width for the bar (reserve some space for borders and padding)
    var termWidth = (__conAnsi && isDef(__con)) ? __con.getTerminal().getWidth() : 80
    var barWidth = Math.max(40, termWidth - 4)  // Reserve 4 chars for borders/padding

    // Build the horizontal bar
    var barSegments = []
    var totalTokens = stats.totalTokens > 0 ? stats.totalTokens : 1

    stats.sections.forEach(function(section) {
      if (section.tokens > 0) {
        var proportion = section.tokens / totalTokens
        var segmentWidth = Math.max(1, Math.round(proportion * barWidth))
        var style = sectionStyles[section.section] || sectionStyles["Other"]

        barSegments.push({
          width: segmentWidth,
          color: style.color,
          pattern: style.pattern,
          section: section
        })
      }
    })

    // Adjust widths to exactly match barWidth (handle rounding differences)
    var currentTotal = barSegments.reduce(function(sum, seg) { return sum + seg.width }, 0)
    if (currentTotal !== barWidth && barSegments.length > 0) {
      // Adjust the largest segment
      var largestIdx = 0
      var largestWidth = 0
      barSegments.forEach(function(seg, idx) {
        if (seg.width > largestWidth) {
          largestWidth = seg.width
          largestIdx = idx
        }
      })
      barSegments[largestIdx].width += (barWidth - currentTotal)
    }

    // Render the bar
    var barLine = ""
    barSegments.forEach(function(seg) {
      var segment = ""
      for (var i = 0; i < seg.width; i++) {
        segment += seg.pattern
      }
      barLine += colorifyText(segment, seg.color)
    })

    print("  " + barLine)
    print()

    // Print legend with details
    stats.sections.forEach(function(section) {
      if (section.tokens > 0) {
        var style = sectionStyles[section.section] || sectionStyles["Other"]
        var share = stats.totalTokens > 0 ? (section.tokens / stats.totalTokens * 100).toFixed(1) : "0.0"
        var icon = colorifyText(style.pattern + style.pattern, style.color)
        var label = colorifyText(section.section.padEnd(10), hintColor)
        var tokens = colorifyText(String(section.tokens).padStart(6), numericColor)
        var percentage = colorifyText((share + "%").padStart(6), hintColor)
        var msgs = colorifyText("(" + section.messages + " msg" + (section.messages === 1 ? "" : "s") + ")", "FG(249)")

        print("  " + icon + " " + label + "  " + tokens + " tokens " + percentage + "  " + msgs)
      }
    })

    print()
    var methodLabel = stats.estimateMethod === "llm" ? "analyzed by LLM" : (stats.estimateMethod === "actual" ? "actual from API" : (stats.estimateMethod === "model" ? "model-based" : "approximate"))
    var tokenLabel = (stats.estimateMethod === "actual" || stats.estimateMethod === "llm") ? "Total tokens: " : "Estimated tokens: ~"
    print(colorifyText("  Total messages: ", hintColor) + colorifyText(String(stats.messageCount), numericColor) + colorifyText(" | " + tokenLabel, hintColor) + colorifyText(String(stats.totalTokens), numericColor) + colorifyText(" (" + methodLabel + ")", hintColor))
    if (isString(stats.path) && stats.path.length > 0) {
      print(colorifyText("  Conversation file: " + stats.path, hintColor))
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

  function resetMetrics() {
    if (isObject(global.__mini_a_metrics)) {
      // Reset all atomic counters
      Object.keys(global.__mini_a_metrics).forEach(function(key) {
        if (key === "per_tool_stats") {
          // Reset per-tool stats
          global.__mini_a_metrics.per_tool_stats = {}
        } else if (isObject(global.__mini_a_metrics[key]) && typeof global.__mini_a_metrics[key].set === "function") {
          global.__mini_a_metrics[key].set(0)
        }
      })
      print(colorifyText("Metrics reset successfully.", successColor))
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
      // Also clear the in-memory conversation from the active agent
      if (isObject(activeAgent) && isObject(activeAgent.llm) && typeof activeAgent.llm.getGPT === "function") {
        try {
          var gpt = activeAgent.llm.getGPT()
          if (typeof gpt.clearConversation === "function") {
            gpt.clearConversation()
          } else if (typeof gpt.setConversation === "function") {
            gpt.setConversation([])
          }
        } catch(ignoreClearError) {}
      }
      lastConversationStats = __
      resetMetrics()
      print(colorifyText("Conversation and metrics cleared. Future goals will start fresh.", successColor))
    } catch (clearError) {
      print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Unable to clear conversation: " + clearError, errorColor))
    }
  }

  function summarize(ctx) {
    if (!isObject(activeAgent) || typeof activeAgent.summarizeText !== "function") {
      return ctx.substring(0, 400)
    }

    var originalState = activeAgent.state
    try {
      if (originalState === "stop") activeAgent.state = "idle"
      var summaryResponse = activeAgent.summarizeText(ctx, { verbose: false })
      if (isString(summaryResponse) && summaryResponse.trim().length > 0) {
        return summaryResponse.trim()
      }
    } catch (summarizeError) {
      printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Summarization failed: " + summarizeError, errorColor))
    } finally {
      if (isDef(originalState)) activeAgent.state = originalState
    }
    return ctx.substring(0, 400)
  }

  function compactConversationContext(preserveCount) {
    var stats = refreshConversationStats(activeAgent)
    if (!isObject(stats) || !isArray(stats.entries) || stats.entries.length === 0) {
      print(colorifyText("No conversation context to compact.", hintColor))
      return
    }

    var keepCount = isNumber(preserveCount) ? Math.max(1, Math.floor(preserveCount)) : 6
    var entries = stats.entries.slice()
    // Always leave at least one older entry eligible for summarization when possible.
    var keepSize = Math.min(keepCount, Math.max(0, entries.length - 1))
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

  function summarizeConversation(preserveCount) {
    // Generate a detailed summary and replace the conversation with it
    var stats = refreshConversationStats(activeAgent)
    if (!isObject(stats) || !isArray(stats.entries) || stats.entries.length === 0) {
      print(colorifyText("No conversation to summarize.", hintColor))
      return
    }

    if (!isObject(activeAgent) || typeof activeAgent.summarizeText !== "function") {
      print(colorifyText("No active agent available. Run a goal first to enable summarization.", hintColor))
      return
    }

    var keepCount = isNumber(preserveCount) ? Math.max(1, Math.floor(preserveCount)) : 6
    var entries = stats.entries.slice()
    // Always leave at least one older entry eligible for summarization when possible.
    var keepSize = Math.min(keepCount, Math.max(0, entries.length - 1))
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

    var conversationText = []
    summarizeCandidates.forEach(function(entry) {
      var role = isString(entry.role) ? entry.role.toUpperCase() : "UNKNOWN"
      var content = flattenConversationContent(entry.content)
      conversationText.push(`${role}: ${content}`)
    })

    var conversationPayload = conversationText.join("\n")

    if (conversationPayload.trim().length === 0) {
      print(colorifyText("No conversation content to summarize.", hintColor))
      return
    }

    var originalState = activeAgent.state
    try {
      print(colorifyText("Generating conversation summary...", hintColor))
      var instructionText = "You are summarizing a conversation between a user and an AI assistant. Provide a clear, concise summary that:\n1) Identifies the main topics discussed\n2) Highlights key decisions or outcomes\n3) Notes any unresolved questions or next steps\n\nFormat the summary in a readable way with bullet points where appropriate."

      if (originalState === "stop") activeAgent.state = "idle"
      var fullSummary = activeAgent.summarizeText(conversationPayload, {
        verbose: false,
        instructionText: instructionText
      })
      if (isDef(originalState)) activeAgent.state = originalState

      if (isString(fullSummary) && fullSummary.trim().length > 0) {
        // Replace the conversation with the summary
        var summaryText = fullSummary.trim()
        var summaryEntry = {
          role: "assistant",
          content: `Conversation summary (${summarizeCandidates.length} messages condensed on ${new Date().toISOString()}):\n\n${summaryText}`
        }

        var newConversation = preserved.concat([summaryEntry]).concat(keepTail)
        var convoPath = getConversationPath()
        if (!isString(convoPath) || convoPath.trim().length === 0) {
          print(colorifyText("Conversation path is not configured. Use /set conversation <path> first.", hintColor))
          return
        }

        io.writeFileJSON(convoPath, { u: new Date(), c: newConversation }, "")
        if (isObject(activeAgent) && isObject(activeAgent.llm) && typeof activeAgent.llm.getGPT === "function") {
          try { activeAgent.llm.getGPT().setConversation(newConversation) } catch (ignoreSetConversation) { }
        }

        var previousTokens = stats.totalTokens
        var updatedStats = refreshConversationStats(activeAgent)
        var afterTokens = isObject(updatedStats) ? updatedStats.totalTokens : 0
        var reduction = previousTokens > 0 ? Math.max(0, previousTokens - afterTokens) : 0
        print(
          colorifyText("Conversation summarized and replaced. Preserved ", successColor) +
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
      } else {
        print(colorifyText("Unable to generate summary. Response was: " + stringify(fullSummary), errorColor))
        print(colorifyText("Conversation payload length: " + conversationPayload.length + " characters", hintColor))
      }
    } catch (summaryError) {
      if (isDef(originalState)) activeAgent.state = originalState
      printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Failed to generate conversation summary: " + summaryError, errorColor))
      if (isDef(summaryError.stack)) {
        print(colorifyText("Stack trace: " + summaryError.stack, errorColor))
      }
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
  var lastResult = __, lastOrigResult = __
  var internalParameters = { goalprefix: true }
  var activeAgent = __
  var shutdownHandled = false
  var subtaskLogsByShortId = {}
  var workerRegBootstrapped = false

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
      var parsedNum = Number(value)
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

    var chunks = []
    var cursor = 0
    var cache = {}
    var wsPattern = /\s/
    var winDrivePattern = /^[A-Za-z]:/

    function splitAttachmentToken(rawToken) {
      var token = isString(rawToken) ? rawToken : ""
      var suffix = ""
      while (token.length > 0) {
        var lastChar = token.charAt(token.length - 1)
        if (/[,.;:!?)\]}'"]/.test(lastChar)) {
          suffix = lastChar + suffix
          token = token.substring(0, token.length - 1)
          continue
        }
        break
      }
      return { filePath: token, suffix: suffix }
    }

    function shouldTreatAsAttachment(filePath) {
      if (!isString(filePath) || filePath.length === 0) return false
      var pathLike = (
        filePath.indexOf("/") >= 0 ||
        filePath.indexOf("\\") >= 0 ||
        filePath.indexOf(".") >= 0 ||
        filePath.charAt(0) === "~" ||
        winDrivePattern.test(filePath)
      )
      if (pathLike) return true
      try {
        if (!io.fileExists(filePath)) return false
        var info = io.fileInfo(filePath)
        return isObject(info) && info.isFile === true
      } catch(ignoreFileInfoError) {
        return false
      }
    }

    while (cursor < text.length) {
      var atPos = text.indexOf("@", cursor)
      if (atPos < 0) {
        chunks.push(text.substring(cursor))
        break
      }

      // Count contiguous backslashes immediately before '@' to detect escaping.
      var backslashes = 0
      for (var b = atPos - 1; b >= 0 && text.charAt(b) === "\\"; b--) backslashes++
      if (backslashes > 0) {
        // Any backslash directly before @ disables attachment parsing.
        // Keep it literal and remove one escaping backslash.
        chunks.push(text.substring(cursor, atPos - 1))
        chunks.push("@")
        cursor = atPos + 1
        continue
      }

      var endPos = atPos + 1
      while (endPos < text.length && !wsPattern.test(text.charAt(endPos))) endPos++
      var rawToken = text.substring(atPos + 1, endPos)
      var tokenParts = splitAttachmentToken(rawToken)
      var filePath = tokenParts.filePath
      var trailingSuffix = tokenParts.suffix
      var fullMatch = "@" + filePath

      // Ignore lone '@' characters.
      if (filePath.length === 0) {
        chunks.push(text.substring(cursor, endPos))
        cursor = endPos
        continue
      }

      chunks.push(text.substring(cursor, atPos))

      if (!Object.prototype.hasOwnProperty.call(cache, fullMatch)) {
        if (!shouldTreatAsAttachment(filePath)) {
          cache[fullMatch] = fullMatch
        } else {
          try {
            var fileContent = io.readFileString(filePath)
            if (isDef(fileContent)) {
              cache[fullMatch] = "\n\n--- Content from " + filePath + " ---\n" + fileContent + "\n--- End of " + filePath + " ---\n\n"
              print(colorifyText("📎 Attached: " + filePath + " (" + fileContent.length + " bytes)", successColor))
            } else {
              cache[fullMatch] = fullMatch
            }
          } catch (fileError) {
            cache[fullMatch] = fullMatch
            printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Unable to read file " + filePath + ": " + fileError, errorColor))
          }
        }
      }

      chunks.push(cache[fullMatch])
      if (trailingSuffix.length > 0) chunks.push(trailingSuffix)
      cursor = endPos
    }

    return chunks.join("")
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
    if (isDef(args.valgoal)) {
      if (isUnDef(args.validationgoal)) args.validationgoal = args.valgoal
      delete args.valgoal
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
    plan   : "FG(135)",
    stream : "RESET"
  }

  var _prevEventLength = __
  var _streamOutputStats = {
    totalChars: 0,
    contentChars: 0
  }
  var _streamHasRendered = false
  var _streamMdState = {
    pending: "",
    inTable: false,
    tableBuffer: "",
    tableHeaderCandidate: ""
  }
  var _streamTableSeparatorRegex = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/

  function _isStreamTableSeparator(lineText) {
    if (!isString(lineText)) return false
    return _streamTableSeparatorRegex.test(lineText.trim())
  }

  function _isStreamTableRow(lineText) {
    if (!isString(lineText)) return false
    var trimmed = lineText.trim()
    if (trimmed.length === 0) return false
    if (_isStreamTableSeparator(trimmed)) return false
    return trimmed.indexOf("|") >= 0
  }

  function _streamTableCellCount(lineText) {
    if (!isString(lineText)) return 0
    var normalized = lineText.trim()
    if (normalized.length === 0) return 0
    if (normalized.indexOf("|") === 0) normalized = normalized.substring(1)
    if (normalized.lastIndexOf("|") === normalized.length - 1) normalized = normalized.substring(0, normalized.length - 1)
    if (normalized.length === 0) return 0
    return normalized.split("|").length
  }

  function _containsStreamTableSyntax(text) {
    if (!isString(text) || text.length === 0) return false
    var lines = text.split("\n")
    for (var i = 0; i < lines.length; i++) {
      if (_isStreamTableSeparator(lines[i]) || _isStreamTableRow(lines[i])) return true
    }
    return false
  }

  function _isStreamValidMarkdownTableText(text) {
    if (!isString(text) || text.length === 0) return false
    var lines = text.split("\n").filter(function(line) { return line.trim().length > 0 })
    if (lines.length < 2) return false

    var separatorIdx = -1
    for (var i = 0; i < lines.length; i++) {
      if (_isStreamTableSeparator(lines[i])) {
        separatorIdx = i
        break
      }
    }
    if (separatorIdx <= 0) return false
    if (separatorIdx > 1) return false

    var headerLine = lines[separatorIdx - 1]
    var separatorLine = lines[separatorIdx]
    if (!_isStreamTableRow(headerLine)) return false

    var headerCols = _streamTableCellCount(headerLine)
    var separatorCols = _streamTableCellCount(separatorLine)
    if (headerCols < 2 || separatorCols < 2 || headerCols !== separatorCols) return false

    for (var j = separatorIdx + 1; j < lines.length; j++) {
      if (!_isStreamTableRow(lines[j])) return false
      if (_streamTableCellCount(lines[j]) !== headerCols) return false
    }
    return true
  }

  function _printStreamMarkdown(text) {
    if (!isString(text) || text.length === 0) return
    _streamHasRendered = true
    if (_containsStreamTableSyntax(text) && !_isStreamValidMarkdownTableText(text)) {
      print(text)
      return
    }
    printnl(ow.format.withMD(text))
  }

  function _flushStreamTableBuffer() {
    if (_streamMdState.tableBuffer.length === 0) return
    _printStreamMarkdown(_streamMdState.tableBuffer)
    _streamMdState.tableBuffer = ""
    _streamMdState.inTable = false
  }

  function _flushStreamTableHeaderCandidate() {
    if (_streamMdState.tableHeaderCandidate.length === 0) return
    _printStreamMarkdown(_streamMdState.tableHeaderCandidate)
    _streamMdState.tableHeaderCandidate = ""
  }

  function _resetStreamRenderState() {
    _streamHasRendered = false
    _streamMdState.pending = ""
    _streamMdState.inTable = false
    _streamMdState.tableBuffer = ""
    _streamMdState.tableHeaderCandidate = ""
  }

  function _flushStreamRemainder() {
    if (_streamMdState.pending.length > 0) {
      if (_streamMdState.inTable && (_isStreamTableRow(_streamMdState.pending) || _isStreamTableSeparator(_streamMdState.pending))) {
        _streamMdState.tableBuffer += _streamMdState.pending
        _streamMdState.pending = ""
      } else if (!_streamMdState.inTable && _streamMdState.tableHeaderCandidate.length > 0 && _isStreamTableSeparator(_streamMdState.pending)) {
        _streamMdState.inTable = true
        _streamMdState.tableBuffer = _streamMdState.tableHeaderCandidate + _streamMdState.pending
        _streamMdState.tableHeaderCandidate = ""
        _streamMdState.pending = ""
      }
    }
    _flushStreamTableBuffer()
    _flushStreamTableHeaderCandidate()
    if (_streamMdState.pending.length > 0) {
      _printStreamMarkdown(_streamMdState.pending)
      _streamMdState.pending = ""
    }
  }

  function _renderStreamChunk(streamText) {
    if (!isString(streamText) || streamText.length === 0) return
    _streamMdState.pending += streamText

    while (true) {
      var newlineIdx = _streamMdState.pending.indexOf("\n")
      if (newlineIdx < 0) break

      var line = _streamMdState.pending.substring(0, newlineIdx)
      _streamMdState.pending = _streamMdState.pending.substring(newlineIdx + 1)
      var lineWithNl = line + "\n"
      var isTableLine = _isStreamTableRow(line)
      var isTableSeparatorLine = _isStreamTableSeparator(line)

      if (_streamMdState.inTable) {
        if (isTableLine || isTableSeparatorLine) {
          _streamMdState.tableBuffer += lineWithNl
        } else {
          _flushStreamTableBuffer()
          _printStreamMarkdown(lineWithNl)
        }
        continue
      }

      if (_streamMdState.tableHeaderCandidate.length > 0) {
        if (isTableSeparatorLine) {
          _streamMdState.inTable = true
          _streamMdState.tableBuffer = _streamMdState.tableHeaderCandidate + lineWithNl
          _streamMdState.tableHeaderCandidate = ""
        } else {
          _flushStreamTableHeaderCandidate()
          if (isTableLine) {
            _streamMdState.tableHeaderCandidate = lineWithNl
          } else {
            _printStreamMarkdown(lineWithNl)
          }
        }
        continue
      }

      if (isTableLine) {
        _streamMdState.tableHeaderCandidate = lineWithNl
      } else {
        _printStreamMarkdown(lineWithNl)
      }
    }

    // Keep partial lines pending. If we're in a table and receive a separator
    // line without trailing newline, hold it until the next chunk completes it.
    if (!_streamMdState.inTable && _streamMdState.pending.length > 0) {
      var pendingTrimmed = _streamMdState.pending.trim()
      var looksLikeTablePiece = _isStreamTableRow(pendingTrimmed) || _isStreamTableSeparator(pendingTrimmed)
      if (!looksLikeTablePiece) {
        _printStreamMarkdown(_streamMdState.pending)
        _streamMdState.pending = ""
      }
    }
  }
  function _parseDelegateSubtaskMessage(message) {
    if (!isString(message)) return __
    var match = message.match(/^\[subtask:([^\]]+)\]\s*(.*)$/)
    if (!isArray(match) || match.length < 3) return __
    return {
      shortId: String(match[1] || "").trim(),
      text: String(match[2] || "")
    }
  }

  function recordDelegateSubtaskLog(message) {
    var parsed = _parseDelegateSubtaskMessage(message)
    if (!isMap(parsed) || !isString(parsed.shortId) || parsed.shortId.length === 0) return
    if (!isArray(subtaskLogsByShortId[parsed.shortId])) subtaskLogsByShortId[parsed.shortId] = []
    subtaskLogsByShortId[parsed.shortId].push(parsed.text.length > 0 ? parsed.text : String(message))
  }

  function getDelegateSubtaskLogs(subtaskId) {
    if (!isString(subtaskId) || subtaskId.trim().length === 0) return []
    var shortId = subtaskId.substring(0, 8)
    var logs = subtaskLogsByShortId[shortId]
    if (!isArray(logs)) return []
    return logs.slice()
  }

  function printEvent(type, icon, message, id) {
    // Handle streaming output
    if (type == "stream") {
      // Clear inline-event erase state before rendering stream chunks so
      // future event logs don't wipe already streamed answer text.
      if (isDef(_prevEventLength)) {
        print()
        _prevEventLength = __
      }
      var streamText = isString(message) ? message : String(message || "")
      _streamOutputStats.totalChars += streamText.length
      _streamOutputStats.contentChars += streamText.replace(/\s/g, "").length
      _renderStreamChunk(streamText)
      return
    }
    // Ignore user events
    if (type == "user") return
    var extra = "", inline = false

    if (type == "delegate") {
      recordDelegateSubtaskLog(message)
      if (toBoolean(sessionOptions.showdelegate) !== true) return
    }

    var iconText
    if (( (!sessionOptions.showexecs && icon != "⚙️" && icon != "🖥️") || sessionOptions.showexecs) && icon != "📚" && icon != "✅" && icon != "📂" && icon != "ℹ️" && icon != "➡️" && icon != "⬅️" && icon != "📏" && icon != "⏳" && icon != "🏁" && icon != "🤖") {
      iconText = colorifyText(icon, "RESET," + (eventPalette[type] || accentColor)) + (icon.length > 1 ? " " : "  ")
      inline = false
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
    if (type == "delegate") inline = true
    //var prefix = colorifyText("[" + id + "]", hintColor)
    var _msg = colorifyText("│ ", promptColor) + extra + iconText + colorifyText(message.replace(/\n/g, "↵").trim(), hintColor + ",ITALIC")
    // Optimized: extract previous line erase logic
    function _erasePrev() {
      if (!isDef(_prevEventLength)) return
      var termWidth = (__conAnsi && isDef(__con)) ? __con.getTerminal().getWidth() : 80
      var prevLines = Math.ceil(_prevEventLength / termWidth)
      for (var i = 0; i < prevLines; i++) {
        printnl("\r" + repeat(termWidth, " "))
        if (i < prevLines - 1) printnl("\u001b[1A")
      }
      printnl("\r")
    }

    if (args.verbose != true && !inline) {
      _erasePrev()
      print(_msg)
      _prevEventLength = __
    } else {
      _erasePrev()
      printnl("\r" + _msg)
      // Store visual length (without ANSI codes) for proper line calculation
      _prevEventLength = (typeof ansiLength === "function") ? ansiLength(_msg) : _msg.length
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
    _streamOutputStats.totalChars = 0
    _streamOutputStats.contentChars = 0
    _resetStreamRenderState()
    var beforeGoalResult = runHooks("before_goal", { MINI_A_GOAL: isString(goalText) ? goalText : "" })
    if (beforeGoalResult.blocked) {
      printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Goal blocked by a before_goal hook.", errorColor))
      return false
    }
    var effectiveGoal = goalText
    if (isArray(beforeGoalResult.outputs) && beforeGoalResult.outputs.length > 0) {
      var hookPrefix = beforeGoalResult.outputs.map(function(o) { return "[Hook " + o.hookName + "] " + o.output }).join("\n")
      effectiveGoal = hookPrefix + "\n\n" + (isString(goalText) ? goalText : "")
    }

    var _args = buildArgs(effectiveGoal)
    if (!ensureModel(_args)) return false
    var agent = new MiniA()
    activeAgent = agent
    agent.setInteractionFn(function(event, message) {
      agent.defaultInteractionFn(event, message, function(icon, text, id) {
        printEvent(event, icon, text, id)
      })
    })
    if (isFunction(agent.setHookFn)) {
      agent.setHookFn(function(event, contextVars) {
        return runHooks(event, contextVars)
      })
    }
    var agentResult = __, agentOrigResult = __
    var stopRequested = false
    try {
      agent.init(_args)
      $tb(function() {
        agentResult = agent.start(_args)
        agentOrigResult = agent.getOrigAnswer()
      }).stopWhen(function(done) {
        if (done === true) return true
        if (stopRequested) return true
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
              return true
            }
          }
        }
        if (stopRequested) return true
        sleep(75)
        return false
      }).exec()
      persistConversationSnapshot(agent)
      refreshConversationStats(agent)
      if (stopRequested) {
        print(colorifyText("Mini-A stopped by user (Esc).", hintColor))
        return false
      }
      var resultPreview = isString(agentResult) ? agentResult.substring(0, 2000) : (isDef(agentResult) ? stringify(agentResult, __, "").substring(0, 2000) : "")
      runHooks("after_goal", { MINI_A_GOAL: isString(goalText) ? goalText : "", MINI_A_RESULT: resultPreview })
      lastResult = agentResult
      lastOrigResult = agentOrigResult
      if (isUnDef(_args.outfile)) {
        // Skip duplicate output if streaming was used - content already displayed
        if (!_args.usestream) {
          //print(colorifyText("\n🏁 Final answer", successColor))
          print()
          if (isObject(lastResult) || isArray(lastResult)) {
            print(stringify(lastResult, __, "  "))
          } else if (isString(lastResult)) {
            print(unwrapSingleMarkdownCodeBlock(lastResult))
          } else if (isDef(lastResult)) {
            print(stringify(lastResult, __, ""))
          }
        } else {
          _flushStreamRemainder()
          // If streaming was enabled but no visible content was streamed, fallback to final result output.
          if (!_streamHasRendered && _streamOutputStats.contentChars === 0 && isDef(lastResult)) {
            print()
            if (isObject(lastResult) || isArray(lastResult)) {
              print(stringify(lastResult, __, "  "))
            } else if (isString(lastResult)) {
              print(unwrapSingleMarkdownCodeBlock(lastResult))
            } else {
              print(stringify(lastResult, __, ""))
            }
          }
          // Add newline after streaming output before prompt
          // Also ensure newline if there was an inline event pending
          if (isDef(_prevEventLength)) {
            print()  // Move to new line after inline event
            _prevEventLength = __
          }
          //print()
        }
      } else {
        print(colorifyText("Final answer written to " + _args.outfile, successColor))
      }
      return true
    } catch (e) {
      var errMsg = isDef(e) && isDef(e.message) ? e.message : "" + e
      printErr(colorifyText("!!", "ITALIC," + errorColor) + " " + colorifyText("Mini-A execution failed: " + errMsg, errorColor))
      return false
    }
  }

  function executeCustomSlashTemplate(rawSlashInput) {
    var commandText = isString(rawSlashInput) ? rawSlashInput.trim() : ""
    if (commandText.length === 0) {
      printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" exec= requires a template name (example: exec=\"/my-command arg1\" or exec=\"$my-skill arg1\").", errorColor))
      return false
    }
    var inputPrefix = commandText.charAt(0)
    if (inputPrefix === "/" || inputPrefix === "$") commandText = commandText.substring(1).trim()
    if (commandText.length === 0) {
      printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" exec= requires a template name (example: exec=\"/my-command arg1\" or exec=\"$my-skill arg1\").", errorColor))
      return false
    }

    var parsedSlashCommand = parseSlashCommandInput(commandText)
    if (!isString(parsedSlashCommand.name) || parsedSlashCommand.name.length === 0) {
      printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Invalid exec= slash command syntax.", errorColor))
      return false
    }
    if (inputPrefix !== "$" && Object.prototype.hasOwnProperty.call(builtInSlashCommands, parsedSlashCommand.name)) {
      printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" exec= only supports custom commands/skills. Built-in '/" + parsedSlashCommand.name + "' is interactive-only.", errorColor))
      return false
    }

    var matchedDef = findCustomTemplateDefinition(parsedSlashCommand.name, {
      includeCommands: inputPrefix !== "$",
      includeSkills: true
    })

    if (isUnDef(matchedDef)) {
      var unknownPrefix = inputPrefix === "$" ? "$" : "/"
      printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Unknown custom slash command/skill: " + unknownPrefix + parsedSlashCommand.name, errorColor))
      return false
    }
    if (!io.fileExists(matchedDef.file) || io.fileInfo(matchedDef.file).isFile !== true) {
      printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Template file is missing: " + matchedDef.file, errorColor))
      return false
    }

    var parsedArgs = parseSlashArgs(parsedSlashCommand.argsRaw)
    if (parsedArgs.ok !== true) {
      var usagePrefix = inputPrefix === "$" ? "$" : "/"
      print(colorifyText("Usage: " + usagePrefix + parsedSlashCommand.name + " [args...]", errorColor))
      printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" " + parsedArgs.error, errorColor))
      return false
    }

    try {
      var template = io.readFileString(matchedDef.file)
      var goalFromTemplate = renderCustomSlashTemplate(template, parsedArgs)
      goalFromTemplate = preprocessSkillTemplateReferences(goalFromTemplate, matchedDef)
      return runGoal(goalFromTemplate) === true
    } catch (templateExecError) {
      var failurePrefix = inputPrefix === "$" ? "$" : "/"
      printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Failed to execute '" + failurePrefix + parsedSlashCommand.name + "': " + templateExecError, errorColor))
      return false
    }
  }

  function ensureDelegationAgent() {
    if (toBoolean(sessionOptions.usedelegation) !== true) {
      print(colorifyText("Delegation is not enabled. Set usedelegation=true to enable.", errorColor))
      return false
    }

    if (isObject(activeAgent) && isDef(activeAgent._subtaskManager)) return true

    var initArgs = buildArgs("__delegation_bootstrap__")
    if (!ensureModel(initArgs)) return false

    try {
      var agent = new MiniA()
      activeAgent = agent
      agent.setInteractionFn(function(event, message) {
        agent.defaultInteractionFn(event, message, function(icon, text, id) {
          printEvent(event, icon, text, id)
        })
      })
      agent.init(initArgs)
      if (isDef(agent._subtaskManager)) return true
      print(colorifyText("Delegation could not be initialized with current settings.", errorColor))
      return false
    } catch (e) {
      var errMsg = isDef(e) && isDef(e.message) ? e.message : "" + e
      printErr(colorifyText("!!", "ITALIC," + errorColor) + " " + colorifyText("Delegation initialization failed: " + errMsg, errorColor))
      return false
    }
  }

  function bootstrapWorkerRegistration() {
    if (workerRegBootstrapped) return
    workerRegBootstrapped = true
    if (!isNumber(sessionOptions.workerreg)) return

    var initArgs = buildArgs("__delegation_bootstrap__")
    initArgs.usedelegation = true

    if (!ensureModel(initArgs)) return

    try {
      var agent = new MiniA()
      activeAgent = agent
      agent.setInteractionFn(function(event, message) {
        agent.defaultInteractionFn(event, message, function(icon, text, id) {
          printEvent(event, icon, text, id)
        })
      })
      agent.init(initArgs)
    } catch (e) {
      var errMsg = isDef(e) && isDef(e.message) ? e.message : "" + e
      printErr(colorifyText("!!", "ITALIC," + errorColor) + " " + colorifyText("Worker registration bootstrap failed: " + errMsg, errorColor))
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

  function parseStatsOptions(args) {
    var parsedArgs
    if (isObject(args) && isArray(args.argv)) {
      parsedArgs = {
        ok: true,
        raw: isString(args.raw) ? args.raw : "",
        argv: args.argv,
        argc: isNumber(args.argc) ? args.argc : args.argv.length
      }
    } else {
      parsedArgs = parseSlashArgs(isString(args) ? args : "")
    }
    if (parsedArgs.ok !== true) return parsedArgs

    var options = {
      showDetailed: false,
      showTools: false,
      outputPath: __
    }

    for (var i = 0; i < parsedArgs.argv.length; i++) {
      var token = parsedArgs.argv[i]
      var tokenLower = token.toLowerCase()

      if (tokenLower === "detailed" || tokenLower === "detail" || tokenLower === "full") {
        options.showDetailed = true
        continue
      }
      if (tokenLower === "tools" || tokenLower === "tool") {
        options.showTools = true
        continue
      }

      var valueFromNext = false
      var outputKey = ""
      var outputValue = ""
      var splitPos = token.indexOf("=")

      if (splitPos > 0) {
        outputKey = token.substring(0, splitPos).toLowerCase()
        outputValue = token.substring(splitPos + 1)
      } else if (tokenLower === "out" || tokenLower === "output" || tokenLower === "file" || tokenLower === "save" || tokenLower === "json") {
        valueFromNext = true
        outputKey = tokenLower
      }

      if (outputKey === "out" || outputKey === "output" || outputKey === "file" || outputKey === "save" || outputKey === "json") {
        if (valueFromNext) {
          if (i + 1 >= parsedArgs.argv.length) {
            return { ok: false, error: "Missing output file path after '" + token + "'." }
          }
          outputValue = parsedArgs.argv[++i]
        }
        if (!isString(outputValue) || outputValue.trim().length === 0) {
          return { ok: false, error: "Output file path cannot be empty." }
        }
        options.outputPath = outputValue.trim()
        continue
      }

      return { ok: false, error: "Unknown /stats argument '" + token + "'." }
    }

    options.ok = true
    return options
  }

  function printStats(args) {
    var statsOptions = parseStatsOptions(args)
    if (statsOptions.ok !== true) {
      print(colorifyText("Usage: /stats [detailed] [tools] [out=<file.json>]", errorColor))
      printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" " + statsOptions.error, errorColor))
      return
    }

    if (!isObject(activeAgent) || typeof activeAgent.getMetrics !== "function") {
      print(colorifyText("No active agent available. Run a goal first to collect metrics.", hintColor))
      return
    }

    var metrics = activeAgent.getMetrics()
    if (!isObject(metrics)) {
      print(colorifyText("Unable to retrieve metrics.", errorColor))
      return
    }

    var showDetailed = statsOptions.showDetailed === true
    var showTools = statsOptions.showTools === true
    var summaryExport = __
    var exportPayload = __

    print(colorifyText("Mini-A Session Statistics", accentColor))
    print()

    // Show general stats by default
    if (!showDetailed && !showTools) {
      var summaryRows = []
      summaryExport = {
        goals: {},
        llm_calls: {},
        actions: {},
        performance: {}
      }

      // Goals
      if (isObject(metrics.goals)) {
        summaryExport.goals = {
          achieved: metrics.goals.achieved || 0,
          failed: metrics.goals.failed || 0,
          stopped: metrics.goals.stopped || 0
        }
        summaryRows.push({
          category: "Goals",
          metric: "Achieved",
          value: metrics.goals.achieved || 0
        })
        summaryRows.push({
          category: "",
          metric: "Failed",
          value: metrics.goals.failed || 0
        })
        summaryRows.push({
          category: "",
          metric: "Stopped",
          value: metrics.goals.stopped || 0
        })
      }

      // LLM Calls
      if (isObject(metrics.llm_calls)) {
        summaryExport.llm_calls = {
          total: metrics.llm_calls.total || 0,
          normal: metrics.llm_calls.normal || 0,
          low_cost: metrics.llm_calls.low_cost || 0
        }
        summaryRows.push({
          category: "LLM Calls",
          metric: "Total",
          value: metrics.llm_calls.total || 0
        })
        summaryRows.push({
          category: "",
          metric: "Normal",
          value: metrics.llm_calls.normal || 0
        })
        summaryRows.push({
          category: "",
          metric: "Low Cost",
          value: metrics.llm_calls.low_cost || 0
        })
      }

      // Actions
      if (isObject(metrics.actions)) {
        summaryExport.actions = {
          mcp_actions_executed: metrics.actions.mcp_actions_executed || 0,
          mcp_actions_failed: metrics.actions.mcp_actions_failed || 0,
          shell_commands_executed: metrics.actions.shell_commands_executed || 0,
          thoughts_made: metrics.actions.thoughts_made || 0
        }
        summaryRows.push({
          category: "Actions",
          metric: "MCP Executed",
          value: metrics.actions.mcp_actions_executed || 0
        })
        summaryRows.push({
          category: "",
          metric: "MCP Failed",
          value: metrics.actions.mcp_actions_failed || 0
        })
        summaryRows.push({
          category: "",
          metric: "Shell Commands",
          value: metrics.actions.shell_commands_executed || 0
        })
        summaryRows.push({
          category: "",
          metric: "Thoughts Made",
          value: metrics.actions.thoughts_made || 0
        })
      }

      // Performance
      if (isObject(metrics.performance)) {
        summaryExport.performance = {
          steps_taken: metrics.performance.steps_taken || 0
        }
        if (metrics.performance.total_session_time_ms > 0) {
          summaryExport.performance.total_session_time_ms = metrics.performance.total_session_time_ms
          summaryExport.performance.total_session_time_seconds = Number((metrics.performance.total_session_time_ms / 1000).toFixed(2))
        }
        summaryRows.push({
          category: "Performance",
          metric: "Steps Taken",
          value: metrics.performance.steps_taken || 0
        })
        if (metrics.performance.total_session_time_ms > 0) {
          summaryRows.push({
            category: "",
            metric: "Session Time (s)",
            value: (metrics.performance.total_session_time_ms / 1000).toFixed(2)
          })
        }
      }

      print(printTable(summaryRows, (__conAnsi ? isDef(__con) && __con.getTerminal().getWidth() : __), true, __conAnsi, (__conAnsi || isDef(this.__codepage) ? "utf" : __), __, true, false, true))
      print()
      print(colorifyText("Use '/stats detailed' for all metrics, '/stats tools' for per-tool statistics, or add out=<file.json> to save.", hintColor))
      exportPayload = { mode: "summary", data: summaryExport }
    }

    // Show detailed stats
    if (showDetailed) {
      print(colorifyText("Detailed Statistics:", accentColor))
      print()
      print(printTree(metrics))
      exportPayload = { mode: (showTools ? "detailed+tools" : "detailed"), data: metrics }
    }

    // Show per-tool stats
    if (showTools) {
      print(colorifyText("Per-Tool Usage Statistics:", accentColor))
      print()

      if (isObject(metrics.per_tool_usage) && Object.keys(metrics.per_tool_usage).length > 0) {
        var toolRows = []
        Object.keys(metrics.per_tool_usage).sort().forEach(function(toolName) {
          var toolStat = metrics.per_tool_usage[toolName]
          var successRate = toolStat.calls > 0
            ? ((toolStat.successes / toolStat.calls) * 100).toFixed(1) + "%"
            : "N/A"
          toolRows.push({
            tool: toolName,
            calls: toolStat.calls,
            successes: toolStat.successes,
            failures: toolStat.failures,
            success_rate: successRate
          })
        })

        print(printTable(toolRows, (__conAnsi ? isDef(__con) && __con.getTerminal().getWidth() : __), true, __conAnsi, (__conAnsi || isDef(this.__codepage) ? "utf" : __), __, true, false, true))
      } else {
        print(colorifyText("No per-tool statistics available yet.", hintColor))
      }
      if (!showDetailed) {
        exportPayload = { mode: "tools", data: isObject(metrics.per_tool_usage) ? metrics.per_tool_usage : {} }
      }
    }

    if (isString(statsOptions.outputPath) && statsOptions.outputPath.length > 0) {
      var payload = {
        generated_at: new Date(),
        mode: isObject(exportPayload) && isString(exportPayload.mode) ? exportPayload.mode : "summary",
        data: isObject(exportPayload) && isDef(exportPayload.data) ? exportPayload.data : {}
      }
      try {
        io.writeFileJSON(statsOptions.outputPath, payload, "")
        print()
        print(colorifyText("Statistics written to " + statsOptions.outputPath, successColor))
      } catch (statsSaveErr) {
        printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Unable to write statistics file: " + statsSaveErr, errorColor))
      }
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
      "• Use " + colorifyText("\\$name", accentColor) + colorifyText(" when you need a literal $ token at the beginning of a goal line.", hintColor),
      "• Notes: skills can also be executed with " + colorifyText("$skill [args]", accentColor) + colorifyText(".", hintColor),
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
      "  " + colorifyText("/last", "BOLD") + colorifyText(" [md]          Print the previous final answer (md: raw markdown)", hintColor),
      "  " + colorifyText("/save", "BOLD") + colorifyText(" [file.md]     Save the last response to a file (default: response.md)", hintColor),
      "  " + colorifyText("/clear", "BOLD") + colorifyText("              Reset the ongoing conversation and accumulated metrics", hintColor),
      "  " + colorifyText("/context", "BOLD") + colorifyText("            Visualize conversation/context size", hintColor),
      "  " + colorifyText("/compact", "BOLD") + colorifyText(" [n]        Summarize old context, keep last n messages", hintColor),
      "  " + colorifyText("/summarize", "BOLD") + colorifyText(" [n]      Compact and display an LLM-generated conversation summary", hintColor),
      "  " + colorifyText("/history", "BOLD") + colorifyText(" [n]        Show the last n conversation turns", hintColor),
      "  " + colorifyText("/model", "BOLD") + colorifyText(" [target]     Choose a different model (target: model or modellc)", hintColor),
      "  " + colorifyText("/stats", "BOLD") + colorifyText(" [mode] [out=file.json]  Show session statistics (modes: detailed, tools)", hintColor),
      "  " + colorifyText("/skills", "BOLD") + colorifyText(" [prefix]    List discovered skills (optionally filtered by prefix)", hintColor),
      "  " + colorifyText("/delegate", "BOLD") + colorifyText(" <goal>    Delegate a sub-goal to a child agent (requires usedelegation=true)", hintColor),
      "  " + colorifyText("/subtasks", "BOLD") + colorifyText("           List all subtasks and their status", hintColor),
      "  " + colorifyText("/subtask", "BOLD") + colorifyText(" <id>       Show details for a subtask", hintColor),
      "  " + colorifyText("/exit", "BOLD") + colorifyText("               Leave the console", hintColor)
    ]
    var commandNames = Object.keys(customSlashCommands).sort()
    if (commandNames.length > 0) {
      lines.push("")
      lines.push("Custom commands from " + colorifyText(customCommandsDirPath, accentColor) + ":")
      commandNames.forEach(function(name) {
        lines.push("  " + colorifyText("/" + name, "BOLD") + colorifyText(" [args]       Execute instructions from " + customSlashCommands[name].file, hintColor))
      })
    }
    var skillNames = Object.keys(customSkillSlashCommands).sort()
    if (skillNames.length > 0) {
      lines.push("")
      lines.push("Skills from " + colorifyText(customSkillsDirPath, accentColor) + " (skills also support $<name>):")
      skillNames.forEach(function(name) {
        var skillEntry = customSkillSlashCommands[name]
        var sourceHint = (isObject(skillEntry) && skillEntry.sourceType === "folder") ? "folder skill" : "template skill"
        var fallbackHelp = "Execute " + sourceHint + " from " + customSkillSlashCommands[name].file
        var skillHelpText = fallbackHelp
        if (isObject(skillEntry) && skillEntry.sourceType === "folder" && isString(skillEntry.description) && skillEntry.description.trim().length > 0) {
          var termWidth = (__conAnsi && isDef(__con)) ? __con.getTerminal().getWidth() : 80
          var maxDescriptionLength = Math.max(32, termWidth - (name.length + 20))
          skillHelpText = truncateText(skillEntry.description.replace(/\s+/g, " ").trim(), maxDescriptionLength)
        }
        lines.push("  " + colorifyText("/" + name, "BOLD") + colorifyText(" [args]   " + skillHelpText, hintColor))
      })
    }
    var totalHooks = 0
    Object.keys(loadedHooks).forEach(function(ev) { totalHooks += loadedHooks[ev].length })
    if (totalHooks > 0) {
      lines.push("")
      lines.push("Hooks: " + colorifyText(String(totalHooks) + " hook(s) loaded", hintColor) + " from " + colorifyText(hooksDirPath, accentColor))
    }
    print( ow.format.withSideLine( lines.join("\n"), __, promptColor, hintColor, ow.format.withSideLineThemes().openCurvedRect) )
  }

  function printSkills(prefix) {
    var normalizedPrefix = isString(prefix) ? prefix.trim().toLowerCase() : ""
    var skillNames = Object.keys(customSkillSlashCommands).sort().filter(function(name) {
      if (normalizedPrefix.length === 0) return true
      return name.indexOf(normalizedPrefix) === 0
    })

    if (skillNames.length === 0) {
      if (normalizedPrefix.length > 0) {
        print(colorifyText("No skills match prefix '" + normalizedPrefix + "'.", hintColor))
      } else {
        print(colorifyText("No skills discovered in " + customSkillsDirPath + ".", hintColor))
      }
      return
    }

    var rows = skillNames.map(function(name) {
      var entry = customSkillSlashCommands[name]
      var source = (isObject(entry) && entry.sourceType === "folder") ? "folder" : "file"
      var description = ""
      if (isObject(entry) && isString(entry.description) && entry.description.trim().length > 0) {
        description = entry.description.replace(/\s+/g, " ").trim()
      }
      if (description.length === 0) description = "No description"
      return {
        skill: name,
        type: source,
        description: description,
        file: isObject(entry) && isString(entry.file) ? entry.file : ""
      }
    })

    print(colorifyText("Skills (" + rows.length + ") from " + customSkillsDirPath + ":", accentColor))
    print()
    print(printTable(rows, (__conAnsi ? isDef(__con) && __con.getTerminal().getWidth() : __), true, __conAnsi, (__conAnsi || isDef(this.__codepage) ? "utf" : __), __, true, false, true))
    print(colorifyText("Run a skill with /<name> ...args... or $<name> ...args...", hintColor))
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

  var execArgValue = args.exec
  if (hasRunnableExecValue(execArgValue)) {
    bootstrapWorkerRegistration()
    var execSuccess = executeCustomSlashTemplate(String(execArgValue))
    finalizeSession(execSuccess ? "exec" : "exec-error")
    if (isDef(ow.oJob)) ow.oJob.stop()
    exit(execSuccess ? 0 : 1)
  }

  bootstrapWorkerRegistration()
  
  while(true) {
    _miniaConReset()
    var input = con.readLinePrompt(promptLabel())
    if (isUnDef(input)) break
    var trimmed = String(input)
    if (trimmed.trim().length === 0) continue
    if (trimmed.indexOf("\\$") === 0) {
      var escapedGoalText = "$" + trimmed.substring(2)
      runGoal(escapedGoalText)
      continue
    }
    if (trimmed === '"""') {
      var composed = collectMultiline("")
      if (isDef(composed) && composed.trim().length > 0) runGoal(composed)
      continue
    }
    if (trimmed.charAt(0) === '$') {
      var skillCommand = trimmed.substring(1).trim()
      if (skillCommand.length === 0) {
        print(colorifyText("Usage: $<skill> [args...]", errorColor))
        continue
      }
      var parsedSkillCommand = parseSlashCommandInput(skillCommand)
      var _matchedSkillDef = findCustomTemplateDefinition(parsedSkillCommand.name, { includeCommands: false, includeSkills: true })
      if (isDef(_matchedSkillDef)) {
        try {
          if (!io.fileExists(_matchedSkillDef.file) || io.fileInfo(_matchedSkillDef.file).isFile !== true) {
            printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Template file is missing: " + _matchedSkillDef.file, errorColor))
            continue
          }
          var parsedSkillArgs = parseSlashArgs(parsedSkillCommand.argsRaw)
          if (parsedSkillArgs.ok !== true) {
            print(colorifyText("Usage: $" + parsedSkillCommand.name + " [args...]", errorColor))
            printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" " + parsedSkillArgs.error, errorColor))
            continue
          }
          var skillTemplate = io.readFileString(_matchedSkillDef.file)
          var goalFromSkillTemplate = renderCustomSlashTemplate(skillTemplate, parsedSkillArgs)
          goalFromSkillTemplate = preprocessSkillTemplateReferences(goalFromSkillTemplate, _matchedSkillDef)
          runGoal(goalFromSkillTemplate)
        } catch (skillTemplateExecError) {
          printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Failed to execute '$" + parsedSkillCommand.name + "': " + skillTemplateExecError, errorColor))
        }
        continue
      }
    }
    if (trimmed.charAt(0) === '/') {
      var command = trimmed.substring(1).trim()
      var commandLower = command.toLowerCase()
      var parsedSlashCommand = parseSlashCommandInput(command)
      if (command.length === 0) {
        printHelp()
        continue
      }
      if (commandLower === "help") {
        printHelp()
        continue
      }
      if (commandLower === "exit" || commandLower === "quit") {
        break
      }
      if (commandLower === "show") {
        describeOptions()
        continue
      }
      if (commandLower.indexOf("show ") === 0) {
        var prefixFilter = command.substring(5).trim()
        describeOptions(prefixFilter.length > 0 ? prefixFilter : __)
        continue
      }
      if (commandLower === "reset") {
        sessionOptions = resetOptions()
        lastConversationStats = __
        print(colorifyText("Parameters reset to defaults.", successColor))
        continue
      }
      if (commandLower === "last" || commandLower.indexOf("last ") === 0) {
        if (isUnDef(lastResult)) {
          print(colorifyText("No goal executed yet.", hintColor))
          continue
        }

        // Check for "md" option
        var printMarkdown = false
        if (command.indexOf("last ") === 0) {
          var lastArg = command.substring(5).trim().toLowerCase()
          if (lastArg === "md") {
            printMarkdown = true
          }
        }

        if (printMarkdown) {
          // Print raw result without markdown parsing
          if (isObject(lastOrigResult) || isArray(lastOrigResult)) {
            print(stringify(lastOrigResult, __, "  "))
          } else {
            print(String(lastOrigResult))
          }
        } else {
          // Default behavior - print with formatting
          if (isObject(lastResult) || isArray(lastResult)) {
            print(stringify(lastResult, __, "  "))
          } else {
            print(unwrapSingleMarkdownCodeBlock(String(lastResult)))
          }
        }
        continue
      }
      if (commandLower === "save" || commandLower.indexOf("save ") === 0) {
        if (isUnDef(lastResult)) {
          print(colorifyText("No goal executed yet. Nothing to save.", hintColor))
          continue
        }

        // Parse filename from command
        var fileName = "response.md"
        if (commandLower.indexOf("save ") === 0) {
          var fileArg = command.substring(5).trim()
          if (fileArg.length > 0) {
            fileName = fileArg
          }
        }

        try {
          var content = ""
          if (isObject(lastOrigResult) || isArray(lastOrigResult)) {
            content = stringify(lastOrigResult, __, "  ")
          } else {
            content = String(lastOrigResult)
          }

          io.writeFileString(fileName, content)
          print(colorifyText("Response saved to " + fileName + " (" + content.length + " bytes)", successColor))
        } catch (saveError) {
          printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Unable to save file: " + saveError, errorColor))
        }
        continue
      }
      if (commandLower === "clear") {
        clearConversationHistory()
        continue
      }
      if (commandLower === "context") {
        printContextSummary(activeAgent, false)
        continue
      }
      if (commandLower.indexOf("context ") === 0) {
        var contextArg = command.substring(8).trim().toLowerCase()
        if (contextArg === "llm" || contextArg === "analyze") {
          printContextSummary(activeAgent, true)
        } else {
          print(colorifyText("Usage: /context [llm|analyze]", errorColor))
        }
        continue
      }
      if (commandLower === "compact") {
        compactConversationContext()
        continue
      }
      if (commandLower.indexOf("compact ") === 0) {
        var keepValue = command.substring(8).trim()
        var parsedKeep = parseInt(keepValue, 10)
        if (isNaN(parsedKeep)) {
          print(colorifyText("Usage: /compact [messagesToKeep]", errorColor))
        } else {
          compactConversationContext(parsedKeep)
        }
        continue
      }
      if (commandLower === "summarize") {
        summarizeConversation()
        continue
      }
      if (commandLower.indexOf("summarize ") === 0) {
        var keepValue = command.substring(10).trim()
        var parsedKeep = parseInt(keepValue, 10)
        if (isNaN(parsedKeep)) {
          print(colorifyText("Usage: /summarize [messagesToKeep]", errorColor))
        } else {
          summarizeConversation(parsedKeep)
        }
        continue
      }
      if (commandLower === "history") {
        printConversationHistory()
        continue
      }
      if (commandLower.indexOf("history ") === 0) {
        var countArg = command.substring(8).trim()
        var parsedCount = parseInt(countArg, 10)
        if (isNaN(parsedCount)) {
          print(colorifyText("Usage: /history [numberOfEntries]", errorColor))
        } else {
          printConversationHistory(parsedCount)
        }
        continue
      }
      if (commandLower === "model" || commandLower.indexOf("model ") === 0) {
        var target = "model" // default to model
        if (commandLower.indexOf("model ") === 0) {
          var targetArg = command.substring(6).trim().toLowerCase()
          if (targetArg === "modellc" || targetArg === "lc") {
            target = "modellc"
          } else if (targetArg === "model") {
            target = "model"
          } else {
            print(colorifyText("Invalid target. Use 'model' or 'modellc'.", errorColor))
            continue
          }
        }
        try {
          // Store original args and set temporary args for model manager
          var originalGlobalArgs = clone(args)
          global._args = merge(args, { __noprint: true })

          // Set up result capture mechanism
          global.__mini_a_con_capture_model = true
          global.__mini_a_con_model_result = __

          // Load the model manager (which will execute mainOAFModel and store result)
          var modelManPath = getOPackPath("mini-a") + "/mini-a-modelman.js"
          load(modelManPath)

          // Get the captured result
          var selectedModel = global.__mini_a_con_model_result

          // Clean up
          delete global.__mini_a_con_capture_model
          delete global.__mini_a_con_model_result
          args = originalGlobalArgs

          if (isMap(selectedModel)) {
            sessionOptions[target] = af.toSLON(selectedModel)

            /*if (target == "model") args.model = af.toSLON(selectedModel)
            else if (target == "lowcost") args.modellc = af.toSLON(selectedModel)*/

            print(colorifyText("Model definition set for " + target + ".", successColor))
            //print(colorifyText("Value: " + modelSLON, hintColor))
          } else {
            print(colorifyText("No model selected.", hintColor))
          }
        } catch (modelError) {
          printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Failed to load model: " + modelError, errorColor))
          $err(modelError)
          // Clean up on error
          delete global.__mini_a_con_capture_model
          delete global.__mini_a_con_model_result
          if (isDef(originalGlobalArgs)) args = originalGlobalArgs
        }
        continue
      }
      if (parsedSlashCommand.name === "stats") {
        var parsedStatsArgs = parseSlashArgs(parsedSlashCommand.argsRaw)
        if (parsedStatsArgs.ok !== true) {
          print(colorifyText("Usage: /stats [detailed] [tools] [out=<file.json>]", errorColor))
          printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" " + parsedStatsArgs.error, errorColor))
          continue
        }
        printStats(parsedStatsArgs)
        continue
      }
      if (commandLower === "skills") {
        printSkills()
        continue
      }
      if (commandLower.indexOf("skills ") === 0) {
        printSkills(command.substring(7))
        continue
      }
      if (commandLower.indexOf("delegate ") === 0) {
        if (!ensureDelegationAgent()) continue
        var goal = command.substring(9).trim()
        if (goal.length === 0) {
          print(colorifyText("Usage: /delegate <goal>", errorColor))
          continue
        }
        try {
          var subtaskId = activeAgent._subtaskManager.submitAndRun(goal, {}, {})
          print(colorifyText("Subtask submitted: " + subtaskId, successColor))
          print(colorifyText("Use /subtask " + subtaskId + " to check status", hintColor))
        } catch (delegateErr) {
          printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Delegation failed: " + delegateErr, errorColor))
        }
        continue
      }
      if (commandLower === "subtasks") {
        if (!ensureDelegationAgent()) continue
        try {
          var subtasks = activeAgent._subtaskManager.list()
          if (subtasks.length === 0) {
            print(colorifyText("No subtasks.", hintColor))
          } else {
            print(colorifyText("Subtasks (" + subtasks.length + "):", accentColor))
            subtasks.forEach(function(st) {
              var idShort = st.id.substring(0, 8)
              var statusColor = st.status === "completed" ? successColor : (st.status === "failed" ? errorColor : hintColor)
              print("  " + colorifyText(idShort, statusColor) + " " + colorifyText(st.status.padEnd(10), statusColor) + " " + colorifyText(st.goal.substring(0, 60), hintColor))
            })
          }
        } catch (listErr) {
          printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Failed to list subtasks: " + listErr, errorColor))
        }
        continue
      }
      if (commandLower.indexOf("subtask cancel ") === 0) {
        if (!ensureDelegationAgent()) continue
        var subtaskId = command.substring(15).trim()
        if (subtaskId.length === 0) {
          print(colorifyText("Usage: /subtask cancel <id>", errorColor))
          continue
        }
        try {
          var cancelled = activeAgent._subtaskManager.cancel(subtaskId)
          if (cancelled) {
            print(colorifyText("Subtask " + subtaskId.substring(0, 8) + " cancelled.", successColor))
          } else {
            print(colorifyText("Subtask " + subtaskId.substring(0, 8) + " is already in terminal state.", hintColor))
          }
        } catch (cancelErr) {
          printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Failed to cancel subtask: " + cancelErr, errorColor))
        }
        continue
      }
      if (commandLower.indexOf("subtask result ") === 0) {
        if (!ensureDelegationAgent()) continue
        var subtaskId = command.substring(15).trim()
        if (subtaskId.length === 0) {
          print(colorifyText("Usage: /subtask result <id>", errorColor))
          continue
        }
        try {
          var result = activeAgent._subtaskManager.result(subtaskId)
          print(colorifyText("Result for subtask " + subtaskId.substring(0, 8) + ":", accentColor))
          if (isDef(result.error)) {
            print(colorifyText("Error: " + result.error, errorColor))
          } else if (isDef(result.answer)) {
            print(result.answer)
          } else {
            print(colorifyText("No result available.", hintColor))
          }
        } catch (resultErr) {
          printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Failed to get result: " + resultErr, errorColor))
        }
        continue
      }
      if (commandLower.indexOf("subtask ") === 0) {
        if (!ensureDelegationAgent()) continue
        var subtaskId = command.substring(8).trim()
        if (subtaskId.length === 0) {
          print(colorifyText("Usage: /subtask <id> | /subtask cancel <id> | /subtask result <id>", errorColor))
          continue
        }
        try {
          var status = activeAgent._subtaskManager.status(subtaskId)
          print(colorifyText("Subtask " + status.id.substring(0, 8) + ":", accentColor))
          print("  Status: " + colorifyText(status.status, status.status === "completed" ? successColor : (status.status === "failed" ? errorColor : hintColor)))
          print("  Goal: " + colorifyText(status.goal, hintColor))
          print("  Attempt: " + colorifyText(status.attempt + "/" + status.maxAttempts, numericColor))
          if (isDef(status.startedAt)) {
            var elapsed = status.completedAt ? (status.completedAt - status.startedAt) : (new Date().getTime() - status.startedAt)
            print("  Duration: " + colorifyText(Math.round(elapsed / 1000) + "s", numericColor))
          }
          var subtaskLogs = getDelegateSubtaskLogs(status.id)
          if (subtaskLogs.length > 0) {
            print("  Logs:")
            subtaskLogs.forEach(function(line) {
              print("    " + colorifyText(line, hintColor))
            })
          } else if (status.status === "running") {
            print("  Logs: " + colorifyText("(no delegate events yet)", hintColor))
          }
        } catch (statusErr) {
          printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Failed to get status: " + statusErr, errorColor))
        }
        continue
      }
      if (commandLower.indexOf("toggle ") === 0) {
        toggleOption(command.substring(7).trim())
        continue
      }
      if (commandLower.indexOf("unset ") === 0) {
        unsetOption(command.substring(6).trim())
        continue
      }
      if (commandLower.indexOf("set ") === 0) {
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
      var _matchedDef = findCustomTemplateDefinition(parsedSlashCommand.name)
      if (isDef(_matchedDef)) {
        try {
          if (!io.fileExists(_matchedDef.file) || io.fileInfo(_matchedDef.file).isFile !== true) {
            printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Template file is missing: " + _matchedDef.file, errorColor))
            continue
          }
          var parsedArgs = parseSlashArgs(parsedSlashCommand.argsRaw)
          if (parsedArgs.ok !== true) {
            print(colorifyText("Usage: /" + parsedSlashCommand.name + " [args...]", errorColor))
            printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" " + parsedArgs.error, errorColor))
            continue
          }
          var template = io.readFileString(_matchedDef.file)
          var goalFromTemplate = renderCustomSlashTemplate(template, parsedArgs)
          goalFromTemplate = preprocessSkillTemplateReferences(goalFromTemplate, _matchedDef)
          runGoal(goalFromTemplate)
        } catch (templateExecError) {
          printErr(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Failed to execute '/" + parsedSlashCommand.name + "': " + templateExecError, errorColor))
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
    var inlineSkillExpansion = tryExpandInlineSkillInvocation(goalText)
    if (isObject(inlineSkillExpansion) && inlineSkillExpansion.changed === true && isString(inlineSkillExpansion.text)) {
      goalText = inlineSkillExpansion.text
    }
    runGoal(goalText)
  }

  finalizeSession("exit")
  if (isDef(ow.oJob)) ow.oJob.stop()
} catch(_ge) {
  $err(_ge)
}
