var __MiniA_mcpConnections = {}
ow.loadMetrics()

/**
 * <odoc>
 * <key>MinA</key>
 * Mini Agent (Mini-A) to achieve goals using an LLM and shell commands.
 * Requires OAF_MODEL environment variable to be set to your desired LLM model.
 * </odoc>
 */
var MiniA = function() {
  this._isInitialized = false
  this._isInitializing = false
  this._id = genUUID()

  if (isUnDef(global.__mini_a_metrics)) global.__mini_a_metrics = {
    llm_normal_calls: $atomic(0, "long"),
    llm_lc_calls: $atomic(0, "long"),
    goals_achieved: $atomic(0, "long"),
    goals_failed: $atomic(0, "long"),
    thoughts_made: $atomic(0, "long"),
    shell_commands_executed: $atomic(0, "long"),
    shell_commands_blocked: $atomic(0, "long"),
    thinks_made: $atomic(0, "long"),
    finals_made: $atomic(0, "long"),
    steps_taken: $atomic(0, "long"),
    escalations: $atomic(0, "long"),
    retries: $atomic(0, "long"),
    summaries_made: $atomic(0, "long"),
    summaries_skipped: $atomic(0, "long"),
    summaries_forced: $atomic(0, "long"),
    summaries_tokens_reduced: $atomic(0, "long"),
    summaries_original_tokens: $atomic(0, "long"),
    summaries_final_tokens: $atomic(0, "long"),
    goals_stopped: $atomic(0, "long"),
    llm_estimated_tokens: $atomic(0, "long"),
    llm_actual_tokens: $atomic(0, "long"),
    mcp_actions_executed: $atomic(0, "long"),
    mcp_actions_failed: $atomic(0, "long"),
    consecutive_errors: $atomic(0, "long"),
    consecutive_thoughts: $atomic(0, "long"),
    json_parse_failures: $atomic(0, "long"),
    action_loops_detected: $atomic(0, "long"),
    thinking_loops_detected: $atomic(0, "long"),
    similar_thoughts_detected: $atomic(0, "long"),
    context_summarizations: $atomic(0, "long"),
    total_session_time: $atomic(0, "long"),
    avg_step_time: $atomic(0, "long"),
    max_context_tokens: $atomic(0, "long"),
    shell_commands_approved: $atomic(0, "long"),
    shell_commands_denied: $atomic(0, "long"),
    fallback_to_main_llm: $atomic(0, "long"),
    unknown_actions: $atomic(0, "long"),
    llm_normal_tokens: $atomic(0, "long"),
    llm_lc_tokens: $atomic(0, "long")
  }

  this._SYSTEM_PROMPT = `
You are a goal-oriented agent running in background. Work step-by-step toward your goal. No user interaction or feedback is possible.

RESPONSE FORMAT: Always respond with exactly one valid JSON object:
{
    "thought": "your reasoning for this step",
    "action": "think{{#if useshell}} | shell{{/if}}{{#if actionsList}} | {{actionsList}}{{/if}} | final (string or array for chaining)",{{#if useshell}}
    "command": "required when action=shell or action entry uses shell: POSIX command to execute",{{/if}}
    "answer": "required when action=final (or action entry uses final): your complete answer {{#if isMachine}}as JSON{{else}}in markdown{{/if}}",
    "params": "required when action={{#if actionsList}}{{actionsList}}{{/if}} (or action entry uses these actions): JSON object with action parameters",
    "state": {"optional": "persist structured data for future steps"}
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

MULTI-ACTION SUPPORT:
• You may set "action" to an array of action objects to chain tools sequentially in one step
• Each action object must include at least an "action" field and any required fields (e.g., command, params, answer)

{{#if usetools}}
TOOL REGISTRATION:
• {{toolCount}} MCP tools are registered directly with the model; invoke them by naming the tool in "action" and supply the required params.
• Tool schemas are provided via the tool interface, so keep prompts concise.

{{/if}}
STATE MANAGEMENT:
• You can persist and update structured state in the 'state' object at each step.
• To do this, include a top-level "state" field in your response, which will be passed to subsequent steps.

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

CURRENT STATE:
{{{state}}}

{{#if progress}}PROGRESS SO FAR:
{{{progress}}}

{{/if}}What's your next step? Respond with a JSON object following the schema ("action" may be a string or an array of action objects).
    `

  this._FINAL_PROMPT = `
GOAL: {{{goal}}}

CURRENT STATE:
{{{state}}}

PROGRESS: {{{context}}}

Maximum steps reached. Provide your best final answer now.
Respond as JSON: {"thought":"reasoning","action":"final","answer":"your complete answer"}
    `

  this._fnI = this.defaultInteractionFn
  this.state = "idle"
  this._agentState = {}
  this._useTools = false
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

/**
 * <odoc>
 * <key>MinA.getMetrics() : Object</key>
 * Get all metrics for this Mini-A instance.
 * Returns an object with all metric values including performance, behavior, error tracking, 
 * and separate token usage for normal vs low-cost LLM models.
 * </odoc>
 */
MiniA.prototype.getMetrics = function() {
    return {
        llm_calls: {
            normal: global.__mini_a_metrics.llm_normal_calls.get(),
            low_cost: global.__mini_a_metrics.llm_lc_calls.get(),
            total: global.__mini_a_metrics.llm_normal_calls.get() + global.__mini_a_metrics.llm_lc_calls.get(),
            fallback_to_main: global.__mini_a_metrics.fallback_to_main_llm.get()
        },
        goals: {
            achieved: global.__mini_a_metrics.goals_achieved.get(),
            failed: global.__mini_a_metrics.goals_failed.get(),
            stopped: global.__mini_a_metrics.goals_stopped.get()
        },
        actions: {
            thoughts_made: global.__mini_a_metrics.thoughts_made.get(),
            thinks_made: global.__mini_a_metrics.thinks_made.get(),
            finals_made: global.__mini_a_metrics.finals_made.get(),
            mcp_actions_executed: global.__mini_a_metrics.mcp_actions_executed.get(),
            mcp_actions_failed: global.__mini_a_metrics.mcp_actions_failed.get(),
            shell_commands_executed: global.__mini_a_metrics.shell_commands_executed.get(),
            shell_commands_blocked: global.__mini_a_metrics.shell_commands_blocked.get(),
            shell_commands_approved: global.__mini_a_metrics.shell_commands_approved.get(),
            shell_commands_denied: global.__mini_a_metrics.shell_commands_denied.get(),
            unknown_actions: global.__mini_a_metrics.unknown_actions.get()
        },
        performance: {
            steps_taken: global.__mini_a_metrics.steps_taken.get(),
            total_session_time_ms: global.__mini_a_metrics.total_session_time.get(),
            avg_step_time_ms: global.__mini_a_metrics.avg_step_time.get(),
            max_context_tokens: global.__mini_a_metrics.max_context_tokens.get(),
            llm_estimated_tokens: global.__mini_a_metrics.llm_estimated_tokens.get(),
            llm_actual_tokens: global.__mini_a_metrics.llm_actual_tokens.get(),
            llm_normal_tokens: global.__mini_a_metrics.llm_normal_tokens.get(),
            llm_lc_tokens: global.__mini_a_metrics.llm_lc_tokens.get()
        },
        behavior_patterns: {
            escalations: global.__mini_a_metrics.escalations.get(),
            retries: global.__mini_a_metrics.retries.get(),
            consecutive_errors: global.__mini_a_metrics.consecutive_errors.get(),
            consecutive_thoughts: global.__mini_a_metrics.consecutive_thoughts.get(),
            json_parse_failures: global.__mini_a_metrics.json_parse_failures.get(),
            action_loops_detected: global.__mini_a_metrics.action_loops_detected.get(),
            thinking_loops_detected: global.__mini_a_metrics.thinking_loops_detected.get(),
            similar_thoughts_detected: global.__mini_a_metrics.similar_thoughts_detected.get()
        },
        summarization: {
            summaries_made: global.__mini_a_metrics.summaries_made.get(),
            summaries_skipped: global.__mini_a_metrics.summaries_skipped.get(),
            summaries_forced: global.__mini_a_metrics.summaries_forced.get(),
            context_summarizations: global.__mini_a_metrics.context_summarizations.get(),
            summaries_tokens_reduced: global.__mini_a_metrics.summaries_tokens_reduced.get(),
            summaries_original_tokens: global.__mini_a_metrics.summaries_original_tokens.get(),
            summaries_final_tokens: global.__mini_a_metrics.summaries_final_tokens.get()
        }
    }
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

MiniA.prototype._parseListOption = function(value) {
    if (isUnDef(value) || value === null) return []
    if (isArray(value)) {
        return value
            .map(v => (isString(v) ? v : stringify(v, __, "")).toLowerCase().trim())
            .filter(v => v.length > 0)
    }
    if (!isString(value)) value = stringify(value, __, "")
    return value
        .split(",")
        .map(v => v.trim().toLowerCase())
        .filter(v => v.length > 0)
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
    
    // Mark goal as achieved if not already counted
    if (global.__mini_a_metrics.goals_achieved.get() === 0 && global.__mini_a_metrics.goals_stopped.get() === 0) {
      global.__mini_a_metrics.goals_achieved.inc()
    }
    
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
    args.readwrite  = _$(args.readwrite, "args.readwrite").isBoolean().default(false)
    args.checkall   = _$(args.checkall,  "args.checkall").isBoolean().default(false)
    args.shellbatch = _$(args.shellbatch, "args.shellbatch").isBoolean().default(false)

    var allowValue = isDef(args.shellallow) ? args.shellallow : this._shellAllowlist
    var extraBanValue = isDef(args.shellbanextra) ? args.shellbanextra : this._shellExtraBanned
    var allowPipesValue = isDef(args.shellallowpipes) ? args.shellallowpipes : this._shellAllowPipes

    args.shellallowpipes = _$(toBoolean(allowPipesValue), "args.shellallowpipes").isBoolean().default(false)

    const baseBanned = [
        "rm","sudo","chmod","chown","mv","scp","ssh","docker","podman","kubectl",
        "dd","mkfs","mkfs.ext4","mkfs.xfs","mount","umount","apt","yum","brew",
        "apt-get","apk","rpm","cp","rsync","truncate","ln","passwd","useradd",
        "userdel","groupadd","groupdel","shutdown","reboot","poweroff","halt",
        "systemctl","service","fdisk","sfdisk","parted","losetup","mkswap",
        "swapoff","swapon","iptables","nft","grub-install","update-grub",
        "curl","wget","perl","python","python3","ruby","node","npm","yarn","pip","pip3","gem"
    ]

    var allowlist = this._parseListOption(allowValue)
    var extraBanned = this._parseListOption(extraBanValue)
    var banned = baseBanned.concat(extraBanned).filter(b => allowlist.indexOf(b) < 0)

    var exec = false
    var lcCmd = (args.command || "").toString().toLowerCase()
    var tokens = lcCmd.split(/\s+/).filter(Boolean)

    var isTokenAllowed = function(token) {
      return allowlist.some(a => token === a || token.startsWith(a + "-") || token.startsWith(a + "."))
    }

    // detect banned tokens or tokens that start with banned entries (e.g., "docker-compose")
    var bannedTokens = tokens.filter(t => !isTokenAllowed(t) && banned.some(b => t === b || t.startsWith(b + "-") || t.startsWith(b + ".")))
    var hasBannedToken = bannedTokens.length > 0

    // detect redirections, pipes or shell control operators which can perform write/replace operations
    var hasRedirectionOrPipe = !args.shellallowpipes && /[<>|&;]/.test(lcCmd)

    // collect what was detected to show to user
    var detected = []
    if (hasBannedToken) {
      detected = detected.concat(bannedTokens)
    }
    if (hasRedirectionOrPipe) detected.push("redirection/pipe")

    if (!this._alwaysExec && (hasBannedToken || hasRedirectionOrPipe || args.checkall)) {
      var note = detected.length ? " Detected: " + detected.join(", ") : ""
      var _r
      if (!this._shellBatch) {
        _r = askChoose("Can I execute '" + ansiColor("italic,red,bold", args.command) + "'? " + ansiColor("faint","(" + note + " )"), ["No", "Yes", "Always"])
      } else {
        _r == 0 // No prompt in batch mode; default to "No"
      }
      if (_r == 2) {
        exec = true
        this._alwaysExec = true
        global.__mini_a_metrics.shell_commands_approved.inc()
      } else {
        if (_r == 1) {
          exec = true
          global.__mini_a_metrics.shell_commands_approved.inc()
        } else {
          args.output = `[blocked] Command contains banned operation${note}: ${args.command}`
          global.__mini_a_metrics.shell_commands_blocked.inc()
          global.__mini_a_metrics.shell_commands_denied.inc()
        }
      }
    } else {
      exec = true
    }

    if (exec) {
      this._fnI("shell", "Executing '" + args.command + "'...")
      var _r = $sh(args.command).get(0)
      args.output = _r.stdout + (isDef(_r.stderr) && _r.stderr.length > 0 ? "\n[stderr] " + _r.stderr : "")
      global.__mini_a_metrics.shell_commands_executed.inc()
    }

    return args
}

// ============================================================================
// MAIN METHODS
// ============================================================================

MiniA.prototype.init = function(args) {
  if (this._isInitialized) return
  if (this._isInitializing) {
    do {
      sleep(100, true)
    } while(this._isInitializing)
    return
  } else {
    this._isInitializing = true
  }

  ow.metrics.add("mini-a", () => {
    return this.getMetrics()
  })

  args = _$(args, "args").isMap().default({})

  // Validate common arguments
  this._validateArgs(args, [
    { name: "mcp", type: "string", default: __ },
    { name: "rtm", type: "number", default: __ },
    { name: "maxsteps", type: "number", default: 50 },
    { name: "knowledge", type: "string", default: "" },
    { name: "outfile", type: "string", default: __ },
    { name: "libs", type: "string", default: "" },
    { name: "conversation", type: "string", default: __ },
    { name: "shellallow", type: "string", default: "" },
    { name: "shellbanextra", type: "string", default: "" }
  ])

  // Convert and validate boolean arguments
  args.verbose = _$(toBoolean(args.verbose), "args.verbose").isBoolean().default(false)
  args.readwrite = _$(toBoolean(args.readwrite), "args.readwrite").isBoolean().default(false)
  args.debug = _$(toBoolean(args.debug), "args.debug").isBoolean().default(false)
  args.useshell = _$(toBoolean(args.useshell), "args.useshell").isBoolean().default(false)
  args.raw = _$(toBoolean(args.raw), "args.raw").isBoolean().default(false)
  args.checkall = _$(toBoolean(args.checkall), "args.checkall").isBoolean().default(false)
  args.shellallowpipes = _$(toBoolean(args.shellallowpipes), "args.shellallowpipes").isBoolean().default(false)
  args.usetools = _$(toBoolean(args.usetools), "args.usetools").isBoolean().default(false)

  this._shellAllowlist = this._parseListOption(args.shellallow)
  this._shellExtraBanned = this._parseListOption(args.shellbanextra)
  this._shellAllowPipes = args.shellallowpipes
  this._useTools = args.usetools

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
    this._fnI("info", `Low-cost model enabled: ${this._oaf_lc_model.model} (${this._oaf_lc_model.type})`)
  } else {
    this._use_lc = false
  }

  if (isUnDef(this._oaf_model)) this._oaf_model = af.fromJSSLON(getEnv("OAF_MODEL"))
  this.llm = $llm(this._oaf_model)
  if (this._use_lc) this.lc_llm = $llm(this._oaf_lc_model)

  // Load conversation history if provided
  if (isDef(args.conversation) && io.fileExists(args.conversation)) {
    this._fnI("load", `Loading conversation history from ${args.conversation}...`)
    this.llm.getGPT().setConversation( io.readFileJSON(args.conversation).c )
    if (this._use_lc) this.lc_llm.getGPT().setConversation( io.readFileJSON(args.conversation).c )
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
        if (Object.keys(this.mcpConnections).indexOf(md5(stringify(mcpConfig, __, ""))) >= 0) {
          mcp = this.mcpConnections[md5(stringify(mcpConfig, __, ""))]
        } else {
          mcp = $mcp(mcpConfig)
          this.mcpConnections[md5(stringify(mcpConfig, __, ""))] = mcp
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
          this.mcpToolToConnection[tool.name] = md5(stringify(mcpConfig, __, ""))
        })

        this._fnI("done", `MCP connection ${index + 1} established. Found #${tools.length} tools.`)
      } catch (e) {
        logErr(`❌ Failed to initialize MCP connection ${index + 1}: ${e.message}`)
        throw e
      }
    })

    this._fnI("done", `Total MCP tools available: ${this.mcpTools.length}`)
  }

  if (this._useTools && this.mcpTools.length > 0) {
    var registerMcpTools = llmInstance => {
      if (isUnDef(llmInstance) || typeof llmInstance.withMcpTools != "function") return llmInstance

      var updated = llmInstance
      Object.keys(this.mcpConnections).forEach(connectionId => {
        var client = this.mcpConnections[connectionId]
        if (isUnDef(client)) return

        try {
          var result = updated.withMcpTools(client)
          if (isDef(result)) updated = result
        } catch (e) {
          var errMsg = (isDef(e) && isDef(e.message)) ? e.message : e
          this._fnI("warn", `Failed to register MCP tools on LLM: ${errMsg}`)
        }
      })
      return updated
    }

    var updatedMainLLM = registerMcpTools(this.llm)
    if (isDef(updatedMainLLM)) this.llm = updatedMainLLM

    if (this._use_lc) {
      var updatedLowCostLLM = registerMcpTools(this.lc_llm)
      if (isDef(updatedLowCostLLM)) this.lc_llm = updatedLowCostLLM
    }

    this._fnI("mcp", `Registered ${this.mcpTools.length} MCP tool(s) via LLM tool interface${this._use_lc ? " (main + low-cost)" : ""}.`)
  }

  // Provide system prompt instructions
  if (args.knowledge.length > 0 && args.knowledge.indexOf("\n") < 0 && io.fileExists(args.knowledge)) args.knowledge = io.readFileString(args.knowledge)
  var rules = af.fromJSSLON(args.rules)
  if (!isArray(rules)) rules = [rules]

  var promptActionsDesc = this._useTools ? [] : this.mcpTools
  var promptActionsList = this._useTools ? "" : this.mcpTools.map(r => r.name).join(" | ")
  var actionsWordNumber = this._numberInWords(1 + (this._useTools ? 0 : this.mcpTools.length))

  if (isUnDef(this._systemInst)) this._systemInst = $t(this._SYSTEM_PROMPT.trim(), {
    actionsWordNumber: actionsWordNumber,
    actionsList      : promptActionsList,
    useshell         : args.useshell,
    markdown         : args.__format == "md",
    rules            : rules.filter(r => isDef(r) && r.length > 0).map((rule, idx) => idx + (args.__format == "md" ? 7 : 6) + ". " + rule),
    knowledge        : args.knowledge.trim(),
    actionsdesc      : promptActionsDesc,
    isMachine        : (isDef(args.__format) && args.__format != "md"),
    usetools         : this._useTools,
    toolCount        : this.mcpTools.length
  })

  llm = this.llm.withInstructions(this._systemInst)
  if (this._use_lc) this.lc_llm = this.lc_llm.withInstructions(this._systemInst)

  var systemTokens = this._estimateTokens(this._systemInst)
  this._fnI("size", `System prompt ~${systemTokens} tokens`)
  if (args.debug) {
    print( ow.format.withSideLine(">>>\n" + this._systemInst + "\n>>>", __, "FG(196)", "BG(52),WHITE", ow.format.withSideLineThemes().doubleLineBothSides) )
  }

  this._isInitialized = true
  this._isInitializing = false
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
 * - shellallow (string, optional): Comma-separated list of commands allowed even if usually banned.
 * - shellallowpipes (boolean, default=false): Allow usage of pipes, redirection, and shell control operators.
 * - shellbanextra (string, optional): Comma-separated list of additional commands to ban.
 * - shellbatch (boolean, default=false): If true, runs in batch mode without prompting for command execution approval.
 * - usetools (boolean, default=false): Register MCP tools directly on the model instead of expanding the prompt with schemas.
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
    var sessionStartTime = now()
    try {
        return this._startInternal(args, sessionStartTime)
    } catch (e) {
        global.__mini_a_metrics.goals_failed.inc()
        global.__mini_a_metrics.total_session_time.set(now() - sessionStartTime)
        this.state = "stop"
        var errMsg = (isDef(e) && isDef(e.message)) ? e.message : e
        this._fnI("error", `Agent failed: ${errMsg}`)
        throw e
    }
}

MiniA.prototype._startInternal = function(args, sessionStartTime) {
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
      { name: "rules", type: "string", default: "" },
      { name: "shellallow", type: "string", default: "" },
      { name: "shellbanextra", type: "string", default: "" }
    ])

    // Convert and validate boolean arguments
    args.verbose = _$(args.verbose, "args.verbose").isBoolean().default(false)
    args.readwrite = _$(args.readwrite, "args.readwrite").isBoolean().default(false)
    args.debug = _$(args.debug, "args.debug").isBoolean().default(false)
    args.useshell = _$(args.useshell, "args.useshell").isBoolean().default(false)
    args.raw = _$(args.raw, "args.raw").isBoolean().default(false)
    args.checkall = _$(args.checkall, "args.checkall").isBoolean().default(false)
    args.shellallowpipes = _$(toBoolean(args.shellallowpipes), "args.shellallowpipes").isBoolean().default(false)
    args.shellbatch = _$(toBoolean(args.shellbatch), "args.shellbatch").isBoolean().default(false)
    args.usetools = _$(toBoolean(args.usetools), "args.usetools").isBoolean().default(false)

    this._shellAllowlist = this._parseListOption(args.shellallow)
    this._shellExtraBanned = this._parseListOption(args.shellbanextra)
    this._shellAllowPipes = args.shellallowpipes
    this._shellBatch = args.shellbatch
    this._useTools = args.usetools
    sessionStartTime = isNumber(sessionStartTime) ? sessionStartTime : now()

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
      // Use normal cost LLM for summarization
      //var summarizeLLM = this._use_lc ? this.lc_llm : this.llm
      //var llmType = this._use_lc ? "low-cost" : "main"
      var summarizeLLM = this.llm
      var llmType = "main"

      var originalTokens = this._estimateTokens(ctx)
      global.__mini_a_metrics.summaries_original_tokens.getAdd(originalTokens)

      var summaryResponseWithStats = summarizeLLM.withInstructions("You are condensing an agent's working notes.\n1) KEEP (verbatim or lightly normalized): current goal, constraints, explicit decisions, and facts directly advancing the goal.\n2) COMPRESS tangents, detours, and dead-ends into terse bullets.\n3) RECORD open questions and next actions.").promptWithStats(ctx)
      global.__mini_a_metrics.llm_actual_tokens.getAdd(summaryResponseWithStats.stats.total_tokens || 0)
      global.__mini_a_metrics.llm_normal_tokens.getAdd(summaryResponseWithStats.stats.total_tokens || 0)
      global.__mini_a_metrics.llm_normal_calls.inc()
      global.__mini_a_metrics.summaries_made.inc()
      
      var finalTokens = this._estimateTokens(summaryResponseWithStats.response)
      global.__mini_a_metrics.summaries_final_tokens.getAdd(finalTokens)
      global.__mini_a_metrics.summaries_tokens_reduced.getAdd(Math.max(0, originalTokens - finalTokens))
      
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
            global.__mini_a_metrics.context_summarizations.inc()
            var summarizedOld = summarize(oldContext.join("\n"))
            context = [`[SUMMARY] Previous context: ${summarizedOld}`].concat(recentContext)
            var newTokens = this._estimateTokens(context.join(""))
            this._fnI("size", `Context summarized from ~${contextTokens} to ~${newTokens} tokens.`)
          } else {
            global.__mini_a_metrics.summaries_skipped.inc()
          }
        }
      }
    }

    // Check if goal is a string or a file path
    if (args.goal.length > 0 && args.goal.indexOf("\n") < 0 && io.fileExists(args.goal) && io.fileInfo(args.goal).isFile) {
      this._fnI("load", `Loading goal from file: ${args.goal}...`)
      args.goal = io.readFileString(args.goal)
    }
    this._fnI("user", `${args.goal}`)

    this.init(args)

    var initialState = {}
    if (isDef(args.state)) {
      var providedState = args.state
      if (isString(providedState)) {
        var parsedState = jsonParse(providedState, __, __, true)
        if (isObject(parsedState)) providedState = parsedState
      }
      if (isObject(providedState)) {
        var clonedState = jsonParse(stringify(providedState, __, ""), __, __, true)
        initialState = isObject(clonedState) ? clonedState : providedState
      }
    }
    this._agentState = isObject(initialState) ? initialState : {}

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
        global.__mini_a_metrics.summaries_forced.inc()
        var _nc = summarize(stringify(_ctx, __, ""))
        var newTokens = this._estimateTokens(stringify(_nc, __, ""))
        this._fnI("size", `Context too large (~${currentTokens} tokens), summarized to ~${newTokens} tokens (system #${_sysc.length}).`)
        this.llm.getGPT().setConversation(_sysc.concat([{ role: "assistant", content: "Summarized conversation: " + _nc }]))
      } else {
        global.__mini_a_metrics.summaries_skipped.inc()
      }
    }

    var parseStatePayload = value => {
      if (isUnDef(value) || value === null) return __
      if (isObject(value)) return value
      if (isString(value)) {
        var parsed = jsonParse(value, __, __, true)
        if (isObject(parsed)) return parsed
      }
      return __
    }

    var context = [], maxSteps = args.maxsteps, consecutiveErrors = 0
    var consecutiveThoughts = 0, totalThoughts = 0, stepsWithoutAction = 0
    var lastActions = [], recentSimilarThoughts = []
    sessionStartTime = now()
    this.state = "processing"
    // Context will hold the history of thoughts, actions, and observations
    // We will iterate up to maxSteps to try to achieve the goal
    for(var step = 0; step < maxSteps && this.state != "stop"; step++) {
      var stepStartTime = now()
      global.__mini_a_metrics.steps_taken.inc()
      var stateSnapshot = stringify(this._agentState, __, "")
      if (args.debug || args.verbose) {
        this._fnI("info", `[STATE before step ${step + 1}] ${stateSnapshot}`)
      }
      // TODO: Improve by summarizing context to fit in prompt if needed
      var progressEntries = context.slice()
      progressEntries.unshift(`[STATE] ${stateSnapshot}`)
      var prompt = $t(this._STEP_PROMPT_TEMPLATE.trim(), {
        goal   : args.goal,
        progress: progressEntries.join("\n"),
        state  : stateSnapshot
      })

      var contextTokens = this._estimateTokens(context.join(""))
      global.__mini_a_metrics.max_context_tokens.set(Math.max(global.__mini_a_metrics.max_context_tokens.get(), contextTokens))
      
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
        global.__mini_a_metrics.escalations.inc()
      }
      
      this._fnI("input", `Interacting with ${llmType} model (context ~${contextTokens} tokens)...`)
      // Get model response and parse as JSON
      addCall()
      if (args.debug) {
        print( ow.format.withSideLine(">>>\n" + prompt + ">>>", __, "FG(220)", "BG(230),BLACK", ow.format.withSideLineThemes().doubleLineBothSides) )
      }
      
      var responseWithStats = currentLLM.promptWithStats(prompt)
      global.__mini_a_metrics.llm_actual_tokens.getAdd(responseWithStats.stats.total_tokens || 0)
      global.__mini_a_metrics.llm_estimated_tokens.getAdd(this._estimateTokens(prompt))
      
      if (useLowCost) {
        global.__mini_a_metrics.llm_lc_calls.inc()
        global.__mini_a_metrics.llm_lc_tokens.getAdd(responseWithStats.stats.total_tokens || 0)
      } else {
        global.__mini_a_metrics.llm_normal_calls.inc()
        global.__mini_a_metrics.llm_normal_tokens.getAdd(responseWithStats.stats.total_tokens || 0)
      }
      
      var rmsg = responseWithStats.response
      var stats = responseWithStats.stats
      var tokenStatsMsg = this._formatTokenStats(stats)
      this._fnI("output", `${llmType.charAt(0).toUpperCase() + llmType.slice(1)} model responded. ${tokenStatsMsg}`)

      // Store history
      if (isDef(args.conversation)) {
        // Always store the main LLM conversation for consistency
        io.writeFileJSON(args.conversation, { u: new Date(), c: this.llm.getGPT().getConversation() }, "")
      }
      
      var msg
      if (isString(rmsg)) {
        rmsg = rmsg.replace(/.+\n(\{.+)/m, "$1")
        msg = jsonParse(rmsg, __, __, true)
        
        // If low-cost LLM produced invalid JSON, retry with main LLM
        if ((isUnDef(msg) || !(isMap(msg) || isArray(msg))) && useLowCost) {
          this._fnI("warn", `Low-cost model produced invalid JSON, retrying with main model...`)
          global.__mini_a_metrics.fallback_to_main_llm.inc()
          global.__mini_a_metrics.json_parse_failures.inc()
          global.__mini_a_metrics.retries.inc()
          addCall()
          var fallbackResponseWithStats = this.llm.promptWithStats(prompt)
          global.__mini_a_metrics.llm_actual_tokens.getAdd(fallbackResponseWithStats.stats.total_tokens || 0)
          global.__mini_a_metrics.llm_normal_tokens.getAdd(fallbackResponseWithStats.stats.total_tokens || 0)
          global.__mini_a_metrics.llm_normal_calls.inc()
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
          global.__mini_a_metrics.consecutive_errors.set(consecutiveErrors)
          global.__mini_a_metrics.json_parse_failures.inc()
          if (args.debug || args.verbose) {
            this._fnI("info", `[STATE after step ${step + 1}] ${stateSnapshot}`)
          }
          continue
        }
      } else {
        msg = rmsg
      }

      if (args.debug) {
        print( ow.format.withSideLine("<<<\n" + colorify(msg, { bgcolor: "BG(230),BLACK"}) + "\n<<<", __, "FG(220)", "BG(230),BLACK", ow.format.withSideLineThemes().doubleLineBothSides) )
      }

      // Normalize model response into a sequence of action requests
      var baseMsg = msg
      var stateUpdatedThisStep = false
      var stateRecordedInContext = false
      var updatedStateSnapshot = stateSnapshot
      if (isMap(baseMsg) && isDef(baseMsg.state)) {
        var extractedState = parseStatePayload(baseMsg.state)
        if (isObject(extractedState)) {
          this._agentState = extractedState
          updatedStateSnapshot = stringify(this._agentState, __, "")
          stateUpdatedThisStep = true
        }
      }
      var actionMessages = []
      var addActionMessage = entry => {
        if (isUnDef(entry)) return
        var normalized = isMap(entry) ? Object.assign({}, entry) : {}
        if (!isMap(entry)) {
          normalized.action = entry
        }
        if (isMap(baseMsg) && baseMsg !== entry) {
          if (isUnDef(normalized.thought) && isDef(baseMsg.thought)) normalized.thought = baseMsg.thought
          if (isUnDef(normalized.command) && isDef(baseMsg.command)) normalized.command = baseMsg.command
          if (isUnDef(normalized.answer) && isDef(baseMsg.answer)) normalized.answer = baseMsg.answer
          if (isUnDef(normalized.params) && isDef(baseMsg.params)) normalized.params = baseMsg.params
        }
        actionMessages.push(normalized)
      }

      if (isArray(baseMsg)) {
        baseMsg.forEach(addActionMessage)
      } else if (isMap(baseMsg) && isArray(baseMsg.action)) {
        baseMsg.action.forEach(addActionMessage)
      } else {
        addActionMessage(baseMsg)
      }

      if (actionMessages.length === 0) {
        context.push(`[OBS ${step + 1}] (error) missing 'action' from model.`)
        consecutiveErrors++
        global.__mini_a_metrics.consecutive_errors.set(consecutiveErrors)
        if (stateUpdatedThisStep && !stateRecordedInContext) {
          context.push(`[STATE ${step + 1}] ${updatedStateSnapshot}`)
          stateRecordedInContext = true
        }
        if (args.debug || args.verbose) {
          this._fnI("info", `[STATE after step ${step + 1}] ${stringify(this._agentState, __, "")}`)
        }
        continue
      }

      var clearedConsecutiveErrors = false
      var hadErrorThisStep = false

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

      for (var actionIndex = 0; actionIndex < actionMessages.length; actionIndex++) {
        var currentMsg = actionMessages[actionIndex]
        var origActionRaw = ((currentMsg.action || currentMsg.type || currentMsg.name || currentMsg.tool || currentMsg.think || "") + "").trim()
        var action = origActionRaw.toLowerCase()
        var thoughtValue = jsonParse(((currentMsg.thought || "") + "").trim())
        var commandValue = ((currentMsg.command || "") + "").trim()
        var answerValue = ((isObject(currentMsg.answer) ? stringify(currentMsg.answer,__,"") : currentMsg.answer) || "")
        var paramsValue = currentMsg.params

        if (origActionRaw.length == 0) {
          context.push(`[OBS ${step + 1}] (error) missing 'action' from model.`)
          consecutiveErrors++
          global.__mini_a_metrics.consecutive_errors.set(consecutiveErrors)
          hadErrorThisStep = true
          break
        }
        if (isUnDef(thoughtValue) || (isString(thoughtValue) && thoughtValue.length == 0)) {
          context.push(`[OBS ${step + 1}] (error) missing 'thought' from model.`)
          consecutiveErrors++
          global.__mini_a_metrics.consecutive_errors.set(consecutiveErrors)
          hadErrorThisStep = true
          break
        }

        if (!clearedConsecutiveErrors) {
          consecutiveErrors = 0
          global.__mini_a_metrics.consecutive_errors.set(0)
          clearedConsecutiveErrors = true
        }

        var stepSuffix = actionMessages.length > 1 ? `.${actionIndex + 1}` : ""
        var stepLabel = `${step + 1}${stepSuffix}`

        global.__mini_a_metrics.thoughts_made.inc()

        if (action != "think") {
          var logMsg = thoughtValue || currentMsg.think || af.toSLON(currentMsg) || "(no thought)"
          if (isObject(logMsg)) logMsg = af.toSLON(logMsg)
          this._fnI("thought", `${logMsg}`)
        }

        var thoughtStr = (isObject(thoughtValue) ? stringify(thoughtValue, __, "") : thoughtValue) || "(no thought)"

        if (action == "think") {
          this._fnI("think", `${thoughtStr}`)
          context.push(`[THOUGHT ${stepLabel}] ${thoughtStr}`)

          global.__mini_a_metrics.thinks_made.inc()

          consecutiveThoughts++
          totalThoughts++
          stepsWithoutAction++
          global.__mini_a_metrics.consecutive_thoughts.set(consecutiveThoughts)

          if (consecutiveThoughts >= 5) {
            global.__mini_a_metrics.thinking_loops_detected.inc()
          }

          recentSimilarThoughts.push(thoughtStr)
          if (recentSimilarThoughts.length > 4) {
            recentSimilarThoughts.shift()
          }

          var similarCount = 0
          if (recentSimilarThoughts.length >= 3) {
            for (var i = 0; i < recentSimilarThoughts.length - 1; i++) {
              if (isSimilarThought(thoughtStr, recentSimilarThoughts[i])) {
                similarCount++
              }
            }
            if (similarCount < 2) {
              recentSimilarThoughts = [thoughtStr]
            } else {
              global.__mini_a_metrics.similar_thoughts_detected.inc()
            }
          }

          checkAndSummarizeContext()
          continue
        }

        if (action == "shell") {
          if (!commandValue) {
            context.push(`[OBS ${stepLabel}] (shell) missing 'command' from model.`)
            consecutiveErrors++
            global.__mini_a_metrics.consecutive_errors.set(consecutiveErrors)
            hadErrorThisStep = true
            break
          }
          var shellOutput = this._runCommand({
            command        : commandValue,
            readwrite      : args.readwrite,
            checkall       : args.checkall,
            shellallow     : args.shellallow,
            shellbanextra  : args.shellbanextra,
            shellallowpipes: args.shellallowpipes
          }).output
          context.push(`[ACT ${stepLabel}] shell: ${commandValue}`)
          context.push(`[OBS ${stepLabel}] ${shellOutput.trim() || "(no output)"}`)

          consecutiveThoughts = 0
          stepsWithoutAction = 0
          totalThoughts = Math.max(0, totalThoughts - 1)
          recentSimilarThoughts = []
          global.__mini_a_metrics.consecutive_thoughts.set(0)

          lastActions.push(`shell: ${commandValue}`)
          if (lastActions.length > 3) lastActions.shift()

          checkAndSummarizeContext()
          continue
        }

        if (this.mcpToolNames.indexOf(origActionRaw) >= 0) {
          if (isDef(paramsValue) && !isMap(paramsValue)) {
            context.push(`[OBS ${stepLabel}] (${origActionRaw}) missing or invalid 'params' from model.`)
            consecutiveErrors++
            global.__mini_a_metrics.consecutive_errors.set(consecutiveErrors)
            global.__mini_a_metrics.mcp_actions_failed.inc()
            hadErrorThisStep = true
            break
          }
          this._fnI("exec", `Executing action '${origActionRaw}' with params: ${af.toSLON(paramsValue)}`)

          var connectionIndex = this.mcpToolToConnection[origActionRaw]
          var mcp = this.mcpConnections[connectionIndex]

          try {
            var toolOutput = mcp.callTool(origActionRaw, paramsValue)
            global.__mini_a_metrics.mcp_actions_executed.inc()
          } catch (e) {
            global.__mini_a_metrics.mcp_actions_failed.inc()
            toolOutput = { error: e.message }
          }
          if (isDef(toolOutput) && isArray(toolOutput.content) && isDef(toolOutput.content[0]) && isDef(toolOutput.content[0].text)) {
            var _t = toolOutput.content.map(r => r.text).join("\n")
            toolOutput = jsonParse(_t.trim(), __, __, false)
            if (isString(toolOutput)) toolOutput = _t
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
          this._fnI("done", `Action '${origActionRaw}' completed (${ow.format.toBytesAbbreviation(stringify(toolOutput, __, "").length)}).`)
          context.push(`[ACT ${stepLabel}] ${origActionRaw}: ${af.toSLON(paramsValue)}`)
          context.push(`[OBS ${stepLabel}] ${stringify(toolOutput, __, "") || "(no output)"}`)

          consecutiveThoughts = 0
          stepsWithoutAction = 0
          totalThoughts = Math.max(0, totalThoughts - 1)
          recentSimilarThoughts = []
          global.__mini_a_metrics.consecutive_thoughts.set(0)

          lastActions.push(`${origActionRaw}: ${af.toSLON(paramsValue)}`)
          if (lastActions.length > 3) lastActions.shift()

          if (lastActions.length >= 3) {
            var actionCounts = {}
            lastActions.forEach(a => {
              var actionType = a.split(':')[0]
              actionCounts[actionType] = (actionCounts[actionType] || 0) + 1
            })
            if (Object.values(actionCounts).some(count => count >= 3)) {
              global.__mini_a_metrics.action_loops_detected.inc()
            }
          }

          checkAndSummarizeContext()
          continue
        }

        if (action == "final") {
          if (args.__format != 'md' && args.__format != 'raw') {
            answerValue = this._cleanCodeBlocks(answerValue)
          }

          global.__mini_a_metrics.finals_made.inc()

          consecutiveThoughts = 0
          stepsWithoutAction = 0
          global.__mini_a_metrics.consecutive_thoughts.set(0)

          var totalTime = now() - sessionStartTime
          global.__mini_a_metrics.total_session_time.set(totalTime)
          global.__mini_a_metrics.goals_achieved.inc()

          if (stateUpdatedThisStep && !stateRecordedInContext) {
            context.push(`[STATE ${stepLabel}] ${updatedStateSnapshot}`)
            stateRecordedInContext = true
          }
          if (args.debug || args.verbose) {
            this._fnI("info", `[STATE after step ${step + 1}] ${stringify(this._agentState, __, "")}`)
          }

          return this._processFinalAnswer(answerValue, args)
        }

        context.push(`[THOUGHT ${stepLabel}] ((unknown action -> think) ${thoughtStr || "no thought"})`)

        global.__mini_a_metrics.unknown_actions.inc()

        consecutiveThoughts++
        totalThoughts++
        stepsWithoutAction++
        global.__mini_a_metrics.consecutive_thoughts.set(consecutiveThoughts)

        checkAndSummarizeContext()
      }

      if (stateUpdatedThisStep && !stateRecordedInContext) {
        context.push(`[STATE ${step + 1}] ${updatedStateSnapshot}`)
        stateRecordedInContext = true
      }
      if (args.debug || args.verbose) {
        this._fnI("info", `[STATE after step ${step + 1}] ${stringify(this._agentState, __, "")}`)
      }

      if (hadErrorThisStep) {
        continue
      }

      var stepTime = now() - stepStartTime
      var currentAvg = global.__mini_a_metrics.avg_step_time.get()
      var currentSteps = global.__mini_a_metrics.steps_taken.get()
      var newAvg = currentSteps === 1 ? stepTime : ((currentAvg * (currentSteps - 1)) + stepTime) / currentSteps
      global.__mini_a_metrics.avg_step_time.set(Math.round(newAvg))

      continue
    }

    // If max steps hit without final action
    var finalPrompt = $t(this._FINAL_PROMPT.trim(), {
      goal   : args.goal,
      context: context.join("\n"),
      state  : stringify(this._agentState, __, "")
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
    global.__mini_a_metrics.llm_actual_tokens.getAdd(finalResponseWithStats.stats.total_tokens || 0)
    global.__mini_a_metrics.llm_normal_tokens.getAdd(finalResponseWithStats.stats.total_tokens || 0)
    global.__mini_a_metrics.llm_normal_calls.inc()
    
    var res = jsonParse(finalResponseWithStats.response, __, __, true)
    var finalStats = finalResponseWithStats.stats
    var finalTokenStatsMsg = this._formatTokenStats(finalStats)
    this._fnI("output", `Final response received. ${finalTokenStatsMsg}`)

    // Store history
    if (isDef(args.conversation)) io.writeFileJSON(args.conversation, { u: new Date(), c: this.llm.getGPT().getConversation() }, "")
    
    // Extract final answer
    res.answer = this._cleanCodeBlocks(res.answer)

    // Calculate total session time and mark as completed (potentially failed due to max steps)
    var totalTime = now() - sessionStartTime
    global.__mini_a_metrics.total_session_time.set(totalTime)
    global.__mini_a_metrics.goals_stopped.inc()

    return this._processFinalAnswer(res.answer || "(no final answer)", args)
}
