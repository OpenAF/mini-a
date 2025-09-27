var __MiniA_mcpConnections = {}

/**
 * <odoc>
 * <key>MinA</key>
 * Mini Agent (Mini-A) to achieve goals using an LLM and shell commands.
 * Requires OAF_MODEL environment variable to be set to your desired LLM model.
 * </odoc>
 */
var MiniA = function() {
  this._isInitialized = false

  this._SYSTEM_PROMPT = `
You are a goal-oriented agent running in background. Work step-by-step toward your goal. No user interaction or feedback is possible.

RESPONSE FORMAT: Always respond with exactly one valid JSON object:
{
    "thought": "your reasoning for this step",
    "action": "think{{#if useshell}} | shell{{/if}}{{#if actionsList}} | {{actionsList}}{{/if}} | final",{{#if useshell}}
    "command": "required when action=shell: POSIX command to execute",{{/if}}
    "answer": "required when action=final: your complete answer {{#if isMachine}}as JSON{{else}}in markdown{{/if}}",
    "params": "required when action={{#if actionsList}}{{actionsList}}{{/if}}: JSON object with action parameters"
}

{{#if actionsList}}
AVAILABLE ACTIONS:
{{#each actionsdesc}}
• {{name}}: {{{description}}}{{#if inputSchema.properties}}(parameters: {{{$stringifyInLine inputSchema.properties}}}){{/if}}
{{/each}}

{{/if~}}
ACTION USAGE:
• "think" - Plan your next step (no external tools needed){{#if useshell}}
• "shell" - Execute POSIX commands (ls, cat, grep, curl, etc.){{/if}}{{#if actionsList}}
• Use available actions only when essential for achieving your goal{{/if}}
• "final" - Provide your complete answer when goal is achieved

RULES:
1. Always include "thought" and "action" fields
2. Always be concise and to the point
3. Use tools only when necessary
4. Work incrementally toward your goal
5. Respond with valid JSON only - no extra text{{#if markdown}}
6. The JSON response "answer" property should always be in markdown format{{/if}}{{#each rules}}
{{{this}}}
{{/each}}

{{#if knowledge}}
KNOWLEDGE:
{{{knowledge}}}
{{/if}}
    `

  this._STEP_PROMPT_TEMPLATE = `
GOAL: {{{goal}}}

{{#if context}}PROGRESS SO FAR:
{{{context}}}

{{/if}}What's your next step? Respond with a single JSON object following the schema.
    `

  this._FINAL_PROMPT = `
GOAL: {{{goal}}}

PROGRESS: {{{context}}}

Maximum steps reached. Provide your best final answer now.
Respond as JSON: {"thought":"reasoning","action":"final","answer":"your complete answer"}
    `

  this._fnI = this.defaultInteractionFn
  this.state = "idle"
}

/**
 * <odoc>
 * <key>MinA.defaultInteractionFn(event, message)</key>
 * Default interaction function that logs events to the console with emojis.
 * Event types: exec, shell, think, final, input, output, thought, size, rate, mcp, done, error, libs, info, load, warn
 * </odoc>
 */
MiniA.prototype.defaultInteractionFn = function(e, m) {
  var _e = ""
  switch(e) {
  case "user"     : _e = "👤"; break
  case "exec"     : _e = "⚙️"; break
  case "shell"    : _e = "🖥️"; break
  case "think"    : _e = "💡"; break
  case "final"    : _e = "🏁"; break
  case "input"    : _e = "➡️"; break
  case "output"   : _e = "⬅️"; break
  case "thought"  : _e = "💭"; break
  case "size"     : _e = "📏"; break
  case "rate"     : _e = "⏳"; break
  case "mcp"      : _e = "🤖"; break
  case "done"     : _e = "✅"; break
  case "error"    : _e = "❌"; break
  case "libs"     : _e = "📚"; break
  case "info"     : _e = "ℹ️"; break
  case "load"     : _e = "📂"; break
  case "warn"     : _e = "⚠️"; break
  case "stop"     : _e = "🛑"; break
  case "error"    : _e = "❗"; break
  case "summarize": _e = "📝"; break
  default         : _e = e
  }
  log(_e + "  " + m)
}

/**
 * <odoc>
 * <key>MinA.setInteractionFn(fn) : Function</key>
 * Set a custom interaction function to handle events.
 * The function should accept two parameters: event type and message.
 * Event types: exec, shell, think, final, input, output, thought, size, rate, mcp, done, error, libs, info, load, warn
 * </odoc>
 */
MiniA.prototype.setInteractionFn = function(fn) {
    _$(fn, "fn").isFunction().$_()
    this._fnI = fn
}



// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Estimate token count for text (rough estimate: ~4 characters per token)
 */
MiniA.prototype._estimateTokens = function(text) {
    if (isUnDef(text)) return 0
    return Math.ceil((isString(text) ? text : stringify(text, __, "")).length / 4)
}

/**
 * Format token statistics for display
 */
MiniA.prototype._formatTokenStats = function(stats) {
    if (isUnDef(stats)) return ""
    var tokenInfo = []
    if (isDef(stats.prompt_tokens)) tokenInfo.push(`prompt: ${stats.prompt_tokens}`)
    if (isDef(stats.completion_tokens)) tokenInfo.push(`completion: ${stats.completion_tokens}`)
    if (isDef(stats.total_tokens)) tokenInfo.push(`total: ${stats.total_tokens}`)
    return tokenInfo.length > 0 ? "Tokens - " + tokenInfo.join(", ") : ""
}

/**
 * Remove code block markers from text if present
 */
MiniA.prototype._cleanCodeBlocks = function(text) {
    if (!isString(text)) return text
    var trimmed = text.trim()
    if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
        return trimmed.replace(/^```+[\w]*\n/, "").replace(/```+$/, "").trim()
    }
    return text
}

/**
 * Validate and set default values for common argument patterns
 */
MiniA.prototype._validateArgs = function(args, validations) {
    validations.forEach(v => {
        var value = args[v.name]
        var validated = _$(value, v.path || `args.${v.name}`)
        
        if (v.type === "string") validated = validated.isString()
        else if (v.type === "boolean") validated = validated.isBoolean()
        else if (v.type === "number") validated = validated.isNumber()
        
        args[v.name] = validated.default(v.default)
    })
    return args
}

/**
 * Process and return final answer based on format requirements
 */
MiniA.prototype._processFinalAnswer = function(answer, args) {
    if (isDef(args.outfile)) {
        io.writeFileString(args.outfile, answer || "(no answer)")
        this._fnI("done", `Final answer written to ${args.outfile}`)
        return
    }
    
    if (isString(answer) && args.__format != "raw") answer = answer.trim()
    
    // Handle JSON parsing for markdown format
    if ((args.__format == "md" && args.__format != "raw") && isString(answer) && answer.match(/^(\{|\[).+(\}|\])$/m)) {
        this.state = "stop"
        return jsonParse(answer, __, __, true)
    }
    
    if ((args.__format == "md" && args.__format != "raw") && isObject(answer)) {
        return answer
    }
    
    this._fnI("final", `Final answer determined. Goal achieved.`)
    this.state = "stop"
    
    if (args.raw) {
        return answer || "(no answer)" 
    } else {
        if (args.__format != "md" && args.__format != "raw" && isString(answer)) {
            answer = jsonParse(answer)
        }
        return $o(answer || "(no answer)", args, __, true)
    }
}

MiniA.prototype._numberInWords = num => {
    const words = ["zero","one","two","three","four","five","six","seven","eight","nine","ten",
                  "eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen",
                  "eighteen","nineteen","twenty"]
    const tens = { 20: "twenty", 30: "thirty", 40: "forty", 50: "fifty" }

    if (num >= 0 && num <= 20) return words[num]
    if (num > 20 && num <= 50) {
        const ten = Math.floor(num / 10) * 10
        const one = num % 10
        return one === 0 ? tens[ten] : `${tens[ten]}-${words[one]}`
    }
    return num.toString()
}

MiniA.prototype._runCommand = function(args) {
    _$(args.command, "args.command").isString().$_()
    args.readwrite = _$(args.readwrite, "args.readwrite").isBoolean().default(false)
    args.checkall  = _$(args.checkall,  "args.checkall").isBoolean().default(false)

    const banned = [
        "rm","sudo","chmod","chown","mv","scp","ssh","docker","podman","kubectl",
        "dd","mkfs","mkfs.ext4","mkfs.xfs","mount","umount","apt","yum","brew",
        "apt-get","apk","rpm","cp","rsync","truncate","ln","passwd","useradd",
        "userdel","groupadd","groupdel","shutdown","reboot","poweroff","halt",
        "systemctl","service","fdisk","sfdisk","parted","losetup","mkswap",
        "swapoff","swapon","iptables","nft","grub-install","update-grub",
        "curl","wget","perl","python","ruby","node","npm","yarn","pip","pip3","gem"
    ]

    var exec = false
    var lcCmd = (args.command || "").toString().toLowerCase()
    var tokens = lcCmd.split(/\s+/).filter(Boolean)

    // detect banned tokens or tokens that start with banned entries (e.g., "docker-compose")
    var hasBannedToken = tokens.some(t => banned.includes(t) || banned.some(b => t === b || t.startsWith(b + "-") || t.startsWith(b + ".")))

    // detect redirections, pipes or shell control operators which can perform write/replace operations
    var hasRedirectionOrPipe = /[<>|&;]/.test(lcCmd)

    // collect what was detected to show to user
    var detected = []
    if (hasBannedToken) {
      detected = detected.concat(tokens.filter(t => banned.includes(t) || banned.some(b => t === b || t.startsWith(b + "-") || t.startsWith(b + "."))))
    }
    if (hasRedirectionOrPipe) detected.push("redirection/pipe")

    if (!this._alwaysExec && (hasBannedToken || hasRedirectionOrPipe || args.checkall)) {
      var note = detected.length ? " Detected: " + detected.join(", ") : ""
      var _r = askChoose("Can I execute '" + ansiColor("italic,red,bold", args.command) + "'? " + ansiColor("faint","(" + note + " )"), ["No", "Yes", "Always"])
      if (_r == 2) {
        exec = true
        this._alwaysExec = true
      } else {
        if (_r == 1) {
          exec = true
        } else {
          args.output = `[blocked] Command contains banned operation${note}: ${args.command}`
        }
      }
    } else {
      exec = true
    }

    if (exec) {
      this._fnI("shell", "Executing '" + args.command + "'...")
      var _r = $sh(args.command).get(0)
      args.output = _r.stdout + (isDef(_r.stderr) && _r.stderr.length > 0 ? "\n[stderr] " + _r.stderr : "")
    }

    return args
}

// ============================================================================
// MAIN METHODS
// ============================================================================

MiniA.prototype.init = function(args) {
  if (this._isInitialized) return

  args = _$(args, "args").isMap().default({})

  // Validate common arguments
  this._validateArgs(args, [
    { name: "mcp", type: "string", default: __ },
    { name: "rtm", type: "number", default: __ },
    { name: "maxsteps", type: "number", default: 50 },
    { name: "knowledge", type: "string", default: "" },
    { name: "outfile", type: "string", default: __ },
    { name: "libs", type: "string", default: "" },
    { name: "conversation", type: "string", default: __ }
  ])

  // Convert and validate boolean arguments
  args.verbose = _$(toBoolean(args.verbose), "args.verbose").isBoolean().default(false)
  args.readwrite = _$(toBoolean(args.readwrite), "args.readwrite").isBoolean().default(false)
  args.debug = _$(toBoolean(args.debug), "args.debug").isBoolean().default(false)
  args.useshell = _$(toBoolean(args.useshell), "args.useshell").isBoolean().default(false)
  args.raw = _$(toBoolean(args.raw), "args.raw").isBoolean().default(false)
  args.checkall = _$(toBoolean(args.checkall), "args.checkall").isBoolean().default(false)

  // Load additional libraries if specified
  if (isDef(args.libs) && args.libs.length > 0) {
    args.libs.split(",").map(r => r.trim()).filter(r => r.length > 0).forEach(lib => {
      this._fnI("libs", `Loading library: ${lib}...`)
      try {
        if (lib.startsWith("@")) {
          if (/^\@([^\/]+)\/(.+)\.js$/.test(lib)) {
            var _ar = lib.match(/^\@([^\/]+)\/(.+)\.js$/)
            var _path = getOPackPath(_ar[1])
            var _file = _path + "/" + _ar[2] + ".js"
            if (io.fileExists(_file)) {
              loadLib(_file)
            } else {
              this._fnI("error", `Library '${lib}' not found.`)
            }
          } else {
            this._fnI("error", `Library '${lib}' does not have the correct format (@oPack/library.js).`)
          }
        } else {
          loadLib(lib)
        }
      } catch(e) {
        this._fnI("error", `Failed to load library ${lib}: ${e.message}`)
      }
    })
  }

  // Using OAF_MODEL env var for model selection
  if (isUnDef(getEnv("OAF_MODEL"))) {
    logErr("OAF_MODEL environment variable not set. Please set it to your desired LLM model.")
    return
  }
  // Check for the low-cost model in OAF_LC_MODEL
  if (isDef(getEnv("OAF_LC_MODEL")) && isUnDef(this._oaf_lc_model)) {
    this._oaf_lc_model = af.fromJSSLON(getEnv("OAF_LC_MODEL"))
    this._use_lc = true
  } else {
    this._use_lc = false
  }

  if (isUnDef(this._oaf_model)) this._oaf_model = af.fromJSSLON(getEnv("OAF_MODEL"))
  this.llm = $llm(this._oaf_model)
  if (this._use_lc) this.lc_llm = $llm(this._oaf_lc_model)

  // Load conversation history if provided
  if (isDef(args.conversation) && io.fileExists(args.conversation)) {
    this._fnI("load", `Loading conversation history from ${args.conversation}...`)
    this.llm.getGPT().setConversation( io.readFileJSON(args.conversation) )
    if (this._use_lc) this.lc_llm.getGPT().setConversation( io.readFileJSON(args.conversation) )
  }

  // Using MCP (single or multiple connections)
  var needMCPInit = false
  if (isUnDef(this.mcpConnections) || isUnDef(this.mcpTools) || isUnDef(this.mcpToolNames) || isUnDef(this.mcpToolToConnection)) {
    needMCPInit = true    
    this.mcpConnections = __MiniA_mcpConnections
    this.mcpTools = []
    this.mcpToolNames = []
    this.mcpToolToConnection = {}
  }
  if (isDef(args.mcp) && needMCPInit) {
    var mcpConfigs = af.fromJSSLON(args.mcp)
    
    // Handle both single object and array of MCP configurations
    if (!isArray(mcpConfigs)) {
      mcpConfigs = [mcpConfigs]
    }

    this._fnI("mcp", `Initializing ${mcpConfigs.length} MCP connection(s)...`)

    // Initialize each MCP connection
    mcpConfigs.forEach((mcpConfig, index) => {
      try {
        var mcp
        if (Object.keys(this.mcpConnections).indexOf(md5(mcpConfig)) >= 0) {
          mcp = this.mcpConnections[md5(mcpConfig)]
        } else {
          mcp = $mcp(mcpConfig)
          this.mcpConnections[md5(mcpConfig)] = mcp
          mcp.initialize()
          sleep(100, true)
        }
        
        var tools = mcp.listTools()
        if (isDef(tools) && isDef(tools.tools)) {
          tools = tools.tools
        } else {
          throw new Error(`MCP connection ${index + 1} failed or returned no tools.`)
        }
        
        // Store connection and map tools to this connection
        //this.mcpConnections.push(mcp)
        tools.forEach(tool => {
          this.mcpTools.push(tool)
          this.mcpToolNames.push(tool.name)
          this.mcpToolToConnection[tool.name] = md5(mcpConfig)
        })

        this._fnI("done", `MCP connection ${index + 1} established. Found #${tools.length} tools.`)
      } catch (e) {
        logErr(`❌ Failed to initialize MCP connection ${index + 1}: ${e.message}`)
        throw e
      }
    })

    this._fnI("done", `Total MCP tools available: ${this.mcpTools.length}`)
  }

  // Provide system prompt instructions
  if (args.knowledge.length > 0 && args.knowledge.indexOf("\n") < 0 && io.fileExists(args.knowledge)) args.knowledge = io.readFileString(args.knowledge)
  var rules = af.fromJSSLON(args.rules)
  if (!isArray(rules)) rules = [rules]

  if (isUnDef(this._systemInst)) this._systemInst = $t(this._SYSTEM_PROMPT.trim(), {
    actionsWordNumber: this._numberInWords(1 + this.mcpTools.length),
    actionsList      : this.mcpTools.map(r => r.name).join(" | "),
    useshell         : args.useshell,
    markdown         : args.__format == "md",
    rules            : rules.filter(r => isDef(r) && r.length > 0).map((rule, idx) => idx + (args.__format == "md" ? 7 : 6) + ". " + rule),
    knowledge        : args.knowledge.trim(),
    actionsdesc      : this.mcpTools,
    isMachine        : (isDef(args.__format) && args.__format != "md")
  })

  llm = this.llm.withInstructions(this._systemInst)
  if (this._use_lc) this.lc_llm = this.lc_llm.withInstructions(this._systemInst)

  var systemTokens = this._estimateTokens(this._systemInst)
  this._fnI("size", `System prompt ~${systemTokens} tokens`)
  if (args.debug) {
    print( ow.format.withSideLine(">>>\n" + this._systemInst + "\n>>>", __, "FG(196)", "BG(52),WHITE", ow.format.withSideLineThemes().doubleLineBothSides) )
  }

  this._isInitialized = true
}

/**
 * <odoc>
 * <key>MinA.start(args) : Object</key>
 * Start the Mini Agent with the specified arguments.
 * Arguments:
 * - goal (string, required): The goal the agent should achieve.
 * - mcp (string, optional): MCP configuration in JSON format. Can be a single object or an array of objects for multiple connections.
 * - verbose (boolean, default=false): Whether to enable verbose logging.
 * - rtm (number, optional): Rate limit in calls per minute. If not set, no rate limiting is applied.
 * - maxsteps (number, default=25): Maximum number of steps the agent will take to achieve the goal.
 * - readwrite (boolean, default=false): Whether to allow read/write operations on the filesystem.
 * - debug (boolean, default=false): Whether to enable debug mode with detailed logs.
 * - useshell (boolean, default=false): Whether to allow shell command execution.
 * - knowledge (string, optional): Additional knowledge or context for the agent. Can be a string or a path to a file.
 * - outfile (string, optional): Path to a file where the final answer will be written.
 * - libs (string, optional): Comma-separated list of additional libraries to load.
 * - conversation (string, optional): Path to a file to load/save conversation history.
 * - raw (boolean, default=false): If true, returns the final answer as a raw string instead of formatted output.
 * - checkall (boolean, default=false): If true, asks for confirmation before executing any shell command.
 * - maxcontext (number, optional): Maximum context size in tokens. If the conversation exceeds this size, it will be summarized.
 * - rules (string): Custom rules or instructions for the agent (JSON or SLON array of strings).
 * - __format (string, optional): Output format, either "json" or "md". If not set, defaults to "md" unless outfile is specified, then defaults to "json".
 * 
 * Returns:
 * - The final answer as a string or parsed JSON object if __format is "json" and the answer is valid JSON.
 * </odoc>
 */
MiniA.prototype.start = function(args) {
    _$(args.goal, "args.goal").isString().$_()
    
    // Validate common arguments
    this._validateArgs(args, [
      { name: "mcp", type: "string", default: __ },
      { name: "rtm", type: "number", default: __ },
      { name: "maxsteps", type: "number", default: 25 },
      { name: "knowledge", type: "string", default: "" },
      { name: "outfile", type: "string", default: __ },
      { name: "libs", type: "string", default: "" },
      { name: "conversation", type: "string", default: __ },
      { name: "maxcontext", type: "number", default: 0 },
      { name: "rules", type: "string", default: "" }
    ])

    // Convert and validate boolean arguments
    args.verbose = _$(args.verbose, "args.verbose").isBoolean().default(false)
    args.readwrite = _$(args.readwrite, "args.readwrite").isBoolean().default(false)
    args.debug = _$(args.debug, "args.debug").isBoolean().default(false)
    args.useshell = _$(args.useshell, "args.useshell").isBoolean().default(false)
    args.raw = _$(args.raw, "args.raw").isBoolean().default(false)
    args.checkall = _$(args.checkall, "args.checkall").isBoolean().default(false)

    // Mini autonomous agent to achieve a goal using an LLM and shell commands
    var calls = 0, startTime 

    this._alwaysExec = args.readwrite
    if (isDef(args.outfile) && isUnDef(args.__format)) args.__format = "json"
    if (isUnDef(args.__format)) args.__format = "md"
    //if (args.__format == "md") args.knowledge = "give final answer in markdown without mentioning it\n\n" + args.knowledge

    // Rate limiting helper
    var addCall = () => {
      if (isUnDef(args.rtm)) return
      if (calls == 0) {
        startTime = now()
        calls++
      } else {
        if (calls >= args.rtm) {
          var wait = Math.ceil((60 / args.rtm) * 1000)
          this._fnI("rate", `Rate limit: waiting ${wait}ms before next LLM call...`)
          sleep(wait, true)
          calls = 1
          startTime = now()
        } else if (calls < args.rtm && (now() - startTime) < 60000) {
          startTime = now()
          calls = 1
        } else {
          calls++
        }
      }
    }

    // Summarize context if too long
    var summarize = ctx => {
      // Use low-cost LLM for summarization when available, as it's a simple text condensation task
      var summarizeLLM = this._use_lc ? this.lc_llm : this.llm
      var llmType = this._use_lc ? "low-cost" : "main"
      
      var summaryResponseWithStats = summarizeLLM.promptWithStats("Summarize the following text in a concise manner, keeping all important information:\n\n" + ctx)
      var summaryStats = summaryResponseWithStats.stats
      var tokenStatsMsg = this._formatTokenStats(summaryStats)
      this._fnI("output", `Context summarized using ${llmType} model. ${tokenStatsMsg.length > 0 ? "Summary " + tokenStatsMsg.toLowerCase() : ""}`)
      return summaryResponseWithStats.response
    }

    // Helper function to check and summarize context during execution
    var checkAndSummarizeContext = () => {
      if (args.maxcontext > 0) {
        var contextTokens = this._estimateTokens(context.join(""))
        if (contextTokens > args.maxcontext) {
          this._fnI("size", `Context too large (~${contextTokens} tokens), summarizing...`)
          var recentContext = []
          var oldContext = []
          var recentLimit = Math.floor(args.maxcontext * 0.3) // Keep 30% as recent context
          var currentSize = 0
          
          for (var i = context.length - 1; i >= 0; i--) {
            var entrySize = this._estimateTokens(context[i])
            if (currentSize + entrySize <= recentLimit) {
              recentContext.unshift(context[i])
              currentSize += entrySize
            } else {
              oldContext = context.slice(0, i + 1)
              break
            }
          }
          
          if (oldContext.length > 0) {
            this._fnI("summarize", `Summarizing conversation history...`)
            var summarizedOld = summarize(oldContext.join("\n"))
            context = [`[SUMMARY] Previous context: ${summarizedOld}`].concat(recentContext)
            var newTokens = this._estimateTokens(context.join(""))
            this._fnI("size", `Context summarized from ~${contextTokens} to ~${newTokens} tokens.`)
          }
        }
      }
    }

    this._fnI("user", `${args.goal}`)

    this.init(args)

    this._fnI("info", `Using model: ${this._oaf_model.model} (${this._oaf_model.type})`)

    // Get model response and parse as JSON
    // Check context size and summarize if too large
    // Use low-cost LLM for summarization when available
    if (args.maxcontext > 0) {
      var _c = this.llm.getGPT().getConversation()
      var currentTokens = this._estimateTokens(stringify(_c, __, ""))
      
      this._fnI("size", `Current context tokens: ~${currentTokens} (max allowed: ${args.maxcontext})`)
      if (currentTokens > args.maxcontext) {
        var _sysc = [], _ctx = []
        _c.forEach(c => {
          if (isDef(c.role) && (c.role == "system" || c.role == "developer")) {
            _sysc.push(c)
          } else {
            _ctx.push(c)
          }
        })
        this._fnI("summarize", `Summarizing conversation history...`)
        var _nc = summarize(stringify(_ctx, __, ""))
        var newTokens = this._estimateTokens(stringify(_nc, __, ""))
        this._fnI("size", `Context too large (~${currentTokens} tokens), summarized to ~${newTokens} tokens (system #${_sysc.length}).`)
        this.llm.getGPT().setConversation(_sysc.concat([{ role: "assistant", content: "Summarized conversation: " + _nc }]))
      }
    }

    var context = [], maxSteps = args.maxsteps, consecutiveErrors = 0
    var consecutiveThoughts = 0, totalThoughts = 0, stepsWithoutAction = 0
    var lastActions = [], recentSimilarThoughts = []
    this.state = "processing"
    // Context will hold the history of thoughts, actions, and observations
    // We will iterate up to maxSteps to try to achieve the goal
    for(var step = 0; step < maxSteps && this.state != "stop"; step++) {
      // TODO: Improve by summarizing context to fit in prompt if needed
      var prompt = $t(this._STEP_PROMPT_TEMPLATE.trim(), {
        goal   : args.goal,
        context: step == 0 ? "" : context.join("\n")
      })

      var contextTokens = this._estimateTokens(context.join(""))
      
      // Smart escalation logic - use main LLM for complex scenarios
      var shouldEscalate = false
      var escalationReason = ""
      
      if (this._use_lc && step > 0) {
        // Escalate for consecutive errors
        if (consecutiveErrors >= 2) {
          shouldEscalate = true
          escalationReason = `${consecutiveErrors} consecutive errors`
        }
        // Escalate for too many consecutive thoughts without action
        else if (consecutiveThoughts >= 3) {
          shouldEscalate = true
          escalationReason = `${consecutiveThoughts} consecutive thoughts without action`
        }
        // Escalate if too many thoughts overall (thinking loop)
        else if (totalThoughts >= 5 && step > 0) {
          shouldEscalate = true  
          escalationReason = `${totalThoughts} total thoughts indicating thinking loop`
        }
        // Escalate if no meaningful actions in recent steps
        else if (stepsWithoutAction >= 4) {
          shouldEscalate = true
          escalationReason = `${stepsWithoutAction} steps without meaningful progress`
        }
        // Escalate if similar thoughts are repeating (stuck pattern)
        else if (recentSimilarThoughts.length >= 3) {
          var similarCount = 0
          var lastThought = recentSimilarThoughts[recentSimilarThoughts.length - 1]
          for (var i = 0; i < recentSimilarThoughts.length - 1; i++) {
            if (isSimilarThought(lastThought, recentSimilarThoughts[i])) {
              similarCount++
            }
          }
          if (similarCount >= 2) {
            shouldEscalate = true
            escalationReason = `repeating similar thoughts (${similarCount + 1} similar thoughts)`
          }
        }
      }
      
      var useLowCost = this._use_lc && step > 0 && !shouldEscalate
      var currentLLM = useLowCost ? this.lc_llm : this.llm
      var llmType = useLowCost ? "low-cost" : "main"
      
      // Inform about escalation
      if (this._use_lc && shouldEscalate && step > 0) {
        this._fnI("warn", `Escalating to main model: ${escalationReason}`)
      }
      
      this._fnI("input", `Interacting with ${llmType} model (context ~${contextTokens} tokens)...`)
      // Get model response and parse as JSON
      addCall()
      if (args.debug) {
        print( ow.format.withSideLine(">>>\n" + prompt + ">>>", __, "FG(220)", "BG(230),BLACK", ow.format.withSideLineThemes().doubleLineBothSides) )
      }
      
      var responseWithStats = currentLLM.promptWithStats(prompt)
      var rmsg = responseWithStats.response
      var stats = responseWithStats.stats
      var tokenStatsMsg = this._formatTokenStats(stats)
      this._fnI("output", `${llmType.charAt(0).toUpperCase() + llmType.slice(1)} model responded. ${tokenStatsMsg}`)

      // Store history
      if (isDef(args.conversation)) {
        // Always store the main LLM conversation for consistency
        io.writeFileJSON(args.conversation, this.llm.getGPT().getConversation())
      }
      
      var msg
      if (isString(rmsg)) {
        rmsg = rmsg.replace(/.+\n(\{.+)/m, "$1")
        msg = jsonParse(rmsg, __, __, true)
        
        // If low-cost LLM produced invalid JSON, retry with main LLM
        if ((isUnDef(msg) || !(isMap(msg) || isArray(msg))) && useLowCost) {
          this._fnI("warn", `Low-cost model produced invalid JSON, retrying with main model...`)
          addCall()
          var fallbackResponseWithStats = this.llm.promptWithStats(prompt)
          rmsg = fallbackResponseWithStats.response
          stats = fallbackResponseWithStats.stats
          tokenStatsMsg = this._formatTokenStats(stats)
          this._fnI("output", `main fallback model responded. ${tokenStatsMsg}`)
          
          if (isString(rmsg)) {
            rmsg = rmsg.replace(/.+\n(\{.+)/m, "$1")
            msg = jsonParse(rmsg, __, __, true)
          } else {
            msg = rmsg
          }
        }
        
        if (isUnDef(msg) || !(isMap(msg) || isArray(msg))) {
          context.push(`[OBS ${step + 1}] (error) invalid JSON from model.`)
          consecutiveErrors++
          continue
        }
      } else {
        msg = rmsg
      }

      if (args.debug) {
        print( ow.format.withSideLine("<<<\n" + colorify(msg, { bgcolor: "BG(230),BLACK"}) + "\n<<<", __, "FG(220)", "BG(230),BLACK", ow.format.withSideLineThemes().doubleLineBothSides) )
      }

      // Extract fields from model response
      origAction = (msg.action || msg.think || "").trim()
      action  = (msg.action || msg.think || "").trim().toLowerCase()
      thought = jsonParse((msg.thought || "").trim())
      command = (msg.command || "").trim()
      answer  = ((isObject(msg.answer) ? stringify(msg.answer,__,"") : msg.answer) || "")

      if (isUnDef(action) || action.length == 0) {
        context.push(`[OBS ${step + 1}] (error) missing 'action' from model.`)
        consecutiveErrors++
        continue
      }
      if (isUnDef(thought) || thought.length == 0) {
        context.push(`[OBS ${step + 1}] (error) missing 'thought' from model.`)
        consecutiveErrors++
        continue
      }
      
      // Reset consecutive errors on successful parsing
      consecutiveErrors = 0
      
      // Helper function to check if thoughts are similar
      var isSimilarThought = (thought1, thought2) => {
        if (!thought1 || !thought2) return false
        var t1 = thought1.toString().toLowerCase().trim()
        var t2 = thought2.toString().toLowerCase().trim()
        if (t1 === t2) return true
        // Check for similar meaning (basic similarity check)
        var words1 = t1.split(/\s+/).filter(w => w.length > 3)
        var words2 = t2.split(/\s+/).filter(w => w.length > 3)
        var commonWords = words1.filter(w => words2.includes(w))
        return commonWords.length >= Math.min(words1.length, words2.length) * 0.6
      }

      /*if (args.verbose) {
        this._fnI("", `--- step ${step + 1} ---`)
        this._fnI("", `\n${isObject(msg) ? printTree(msg) : msg}`)
      }*/

      if (action != "think") {
        if (isMap(msg) || isArray(msg)) {
          var _msg = thought || msg.think || af.toSLON(msg) || "(no thought)"
          if (isObject(_msg)) _msg = af.toSLON(_msg)
          this._fnI("thought", `${_msg}`)
        } else {
          this._fnI("thought", `${msg}`)
        }
      }

      // Handle actions
      // --------------

      // Action 'think': just add thought to context
      if (action == "think") {
        var thoughtStr = (isObject(thought) ? stringify(thought, __, "") : thought) || "(no thought)"
        this._fnI("think", `${thoughtStr}`)
        context.push(`[THOUGHT ${step + 1}] ${thoughtStr}`)
        
        // Track thinking patterns for escalation logic
        consecutiveThoughts++
        totalThoughts++
        stepsWithoutAction++
        
        // Check for similar thoughts (simplified tracking)
        recentSimilarThoughts.push(thoughtStr)
        // Keep only last 4 thoughts for comparison
        if (recentSimilarThoughts.length > 4) {
          recentSimilarThoughts.shift()
        }
        
        // Count how many recent thoughts are similar to current one
        var similarCount = 0
        if (recentSimilarThoughts.length >= 3) {
          for (var i = 0; i < recentSimilarThoughts.length - 1; i++) {
            if (isSimilarThought(thoughtStr, recentSimilarThoughts[i])) {
              similarCount++
            }
          }
          // Reset array if we don't have enough similar thoughts
          if (similarCount < 2) {
            recentSimilarThoughts = [thoughtStr]
          }
        }
        
        checkAndSummarizeContext()
        continue
      }

      // Action 'shell': run command and add observation to context
      if (action == "shell") {
        if (!command) {
          context.push(`[OBS ${step + 1}] (shell) missing 'command' from model.`)
          consecutiveErrors++
          continue
        }
        var shellOutput = this._runCommand({ command: command, readwrite: args.readwrite, checkall: args.checkall }).output
        context.push(`[ACT ${step + 1}] shell: ${command}`)
        context.push(`[OBS ${step + 1}] ${shellOutput.trim() || "(no output)"}`)
        
        // Reset thinking counters on meaningful action
        consecutiveThoughts = 0
        stepsWithoutAction = 0
        totalThoughts = Math.max(0, totalThoughts - 1) // Reduce total thoughts on action
        recentSimilarThoughts = [] // Clear similar thoughts on action
        lastActions.push(`shell: ${command}`)
        // Keep only last 3 actions for tracking
        if (lastActions.length > 3) lastActions.shift()
        
        checkAndSummarizeContext()
        continue
      }

      if (this.mcpToolNames.indexOf(origAction) >= 0) {
        if (isDef(msg.params) && !isMap(msg.params)) {
          context.push(`[OBS ${step + 1}] (${origAction}) missing or invalid 'params' from model.`)
          consecutiveErrors++
          continue
        }
        this._fnI("exec", `Executing action '${origAction}' with params: ${af.toSLON(msg.params)}`)
        
        // Find the correct MCP connection for this tool
        var connectionIndex = this.mcpToolToConnection[origAction]
        var mcp = this.mcpConnections[connectionIndex]
        //var tool = this.mcpTools.find(t => t.name == origAction)

        var toolOutput = mcp.callTool(origAction, msg.params)
        if (isDef(toolOutput) && isArray(toolOutput.content) && isDef(toolOutput.content[0]) && isDef(toolOutput.content[0].text)) {
          //toolOutput = toolOutput.content.map(r => jsonParse(r.text, __, __, true))
          var _t = toolOutput.content.map(r => r.text).join("\n")
          toolOutput = jsonParse(_t, __, __, true)
          if (args.debug) {
            print( ow.format.withSideLine("<<<\n" + colorify(toolOutput, { bgcolor: "BG(22),BLACK"}) + "\n<<<", __, "FG(46)", "BG(22),BLACK", ow.format.withSideLineThemes().doubleLineBothSides) )
          }
        } else if (isDef(toolOutput) && isMap(toolOutput) && isDef(toolOutput.text)) {
          toolOutput = toolOutput.text
        } else if (isDef(toolOutput) && isString(toolOutput)) {
          // keep as is
        } else {
          toolOutput = af.toSLON(toolOutput)
        }
        this._fnI("done", `Action '${origAction}' completed (${ow.format.toBytesAbbreviation(stringify(toolOutput, __, "").length)}).`)
        context.push(`[ACT ${step + 1}] ${origAction}: ${af.toSLON(msg.params)}`)
        context.push(`[OBS ${step + 1}] ${stringify(toolOutput, __, "") || "(no output)"}`)
        
        // Reset thinking counters on meaningful action
        consecutiveThoughts = 0
        stepsWithoutAction = 0
        totalThoughts = Math.max(0, totalThoughts - 1) // Reduce total thoughts on action
        recentSimilarThoughts = [] // Clear similar thoughts on action
        lastActions.push(`${origAction}: ${af.toSLON(msg.params)}`)
        // Keep only last 3 actions for tracking
        if (lastActions.length > 3) lastActions.shift()
        
        checkAndSummarizeContext()
        continue
      }

      // Action 'final': print answer and exit
      if (action == "final") {
        if (args.__format != 'md' && args.__format != 'raw') {
          answer = this._cleanCodeBlocks(answer)
        }
        
        // Reset counters as we're finishing
        consecutiveThoughts = 0
        stepsWithoutAction = 0

        return this._processFinalAnswer(answer, args)
      }

      // Unknown action: treat as thinking
      context.push(`[THOUGHT ${step + 1}] ((unknown action -> think) ${thought || "no thought"})`)
      
      // Track as thinking activity for escalation logic
      consecutiveThoughts++
      totalThoughts++
      stepsWithoutAction++
      
      checkAndSummarizeContext()
    }

    // If max steps hit without final action
    var finalPrompt = $t(this._FINAL_PROMPT.trim(), {
      goal   : args.goal,
      context: context.join("\n")
    })

    // If already in stop state, just exit
    if (this.state == "stop") {
      this._fnI("stop", `Agent already in 'stop' state. Exiting...`)
      return "(no answer)"
    }

    this._fnI("warn", `Reached max steps. Asking for final answer...`)
    // Get final answer from model
    addCall()
    var finalResponseWithStats = this.llm.promptWithStats(finalPrompt)
    var res = jsonParse(finalResponseWithStats.response, __, __, true)
    var finalStats = finalResponseWithStats.stats
    var finalTokenStatsMsg = this._formatTokenStats(finalStats)
    this._fnI("output", `Final response received. ${finalTokenStatsMsg}`)

    // Store history
    if (isDef(args.conversation)) io.writeFileJSON(args.conversation, this.llm.getGPT().getConversation())
    
    // Extract final answer
    res.answer = this._cleanCodeBlocks(res.answer)

    return this._processFinalAnswer(res.answer || "(no final answer)", args)
}