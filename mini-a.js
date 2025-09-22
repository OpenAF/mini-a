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
• {{name}}: {{description}}{{#if inputSchema.properties}}(parameters: {{{$stringifyInLine inputSchema.properties}}}){{/if}}
{{/each}}

{{/if~}}
ACTION USAGE:
• "think" - Plan your next step (no external tools needed){{#if useshell}}
• "shell" - Execute POSIX commands (ls, cat, grep, curl, etc.){{/if}}{{#if actionsList}}
• Use available actions only when essential for achieving your goal{{/if}}
• "final" - Provide your complete answer when goal is achieved

RULES:
1. Always include "thought" and "action" fields
2. Be concise
3. Use tools only when necessary
4. Work incrementally toward your goal
5. Respond with valid JSON only - no extra text

{{#if knowledge}}
CONTEXT:
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

  // Using OAF_MODEL env var for model selection
  if (isUnDef(getEnv("OAF_MODEL"))) {
    logErr("OAF_MODEL environment variable not set. Please set it to your desired LLM model.")
    return
  }
  if (isUnDef(this._oaf_model)) this._oaf_model = af.fromJSSLON(getEnv("OAF_MODEL"))
  this.llm = $llm(this._oaf_model)
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
  case "user"   : _e = "👤"; break
  case "exec"   : _e = "⚙️"; break
  case "shell"  : _e = "🖥️"; break
  case "think"  : _e = "💡"; break
  case "final"  : _e = "🏁"; break
  case "input"  : _e = "➡️"; break
  case "output" : _e = "⬅️"; break
  case "thought": _e = "💭"; break
  case "think"  : _e = "💡"; break
  case "size"   : _e = "📏"; break
  case "rate"   : _e = "⏳"; break
  case "mcp"    : _e = "🤖"; break
  case "done"   : _e = "✅"; break
  case "error"  : _e = "❌"; break
  case "libs"   : _e = "📚"; break
  case "info"   : _e = "ℹ️"; break
  case "load"   : _e = "📂"; break
  case "mcp"    : _e = "🤖"; break
  case "warn"   : _e = "⚠️"; break
  default       : _e = e
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

MiniA.prototype.init = function(args) {
  if (this._isInitialized) return

  args = _$(args, "args").isMap().default({})

  args.mcp = _$(args.mcp, "args.mcp").isString().default(__)
  args.verbose = _$(args.verbose, "args.verbose").isBoolean().default(false)
  args.rtm = _$(args.rtm, "args.rtm").isNumber().default(__) // rate limit (calls per minute)
  args.maxsteps = _$(args.maxsteps, "args.maxsteps").isNumber().default(25)
  args.readwrite = _$(args.readwrite, "args.readwrite").isBoolean().default(false)
  args.debug = _$(args.debug, "args.debug").isBoolean().default(false)
  args.useshell = _$(args.useshell, "args.useshell").isBoolean().default(false)
  args.knowledge = _$(args.knowledge, "args.knowledge").isString().default("")
  args.outfile = _$(args.outfile, "args.outfile").isString().default(__)
  args.libs = _$(args.libs, "args.libs").isString().default("")
  args.conversation = _$(args.conversation, "args.conversation").isString().default(__)
  args.raw = _$(args.raw, "args.raw").isBoolean().default(false)
  args.checkall = _$(args.checkall, "args.checkall").isBoolean().default(false)

  // Load additional libraries if specified
  if (isDef(args.libs) && args.libs.length > 0) {
    args.libs.split(",").map(r => r.trim()).filter(r => r.length > 0).forEach(lib => {
      this._fnI("libs", `Loading library: ${lib}...`)
      loadLib(lib)
    })
  }

  // Load conversation history if provided
  if (isDef(args.conversation) && io.fileExists(args.conversation)) {
    this._fnI("load", `Loading conversation history from ${args.conversation}...`)
    this.llm.getGPT().setConversation( io.readFileJSON(args.conversation) )
  }

  // Using MCP (single or multiple connections)
  var needMCPInit = false
  if (isUnDef(this.mcpConnections) || isUnDef(this.mcpTools) || isUnDef(this.mcpToolNames) || isUnDef(this.mcpToolToConnection)) {
    needMCPInit = true    
    this.mcpConnections = []
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
        var mcp = $mcp(mcpConfig)
        mcp.initialize()
        sleep(100, true)
        
        var tools = mcp.listTools()
        if (isDef(tools) && isDef(tools.tools)) {
          tools = tools.tools
        } else {
          throw new Error(`MCP connection ${index + 1} failed or returned no tools.`)
        }
        
        // Store connection and map tools to this connection
        this.mcpConnections.push(mcp)
        tools.forEach(tool => {
          this.mcpTools.push(tool)
          this.mcpToolNames.push(tool.name)
          this.mcpToolToConnection[tool.name] = index
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
  if (args.knowledge.indexOf("\n") < 0 && io.fileExists(args.knowledge)) args.knowledge = io.readFileString(args.knowledge)

  if (isUnDef(this._systemInst)) this._systemInst = $t(this._SYSTEM_PROMPT.trim(), {
    actionsWordNumber: this._numberInWords(1 + this.mcpTools.length),
    actionsList      : this.mcpTools.map(r => r.name).join(" | "),
    useshell         : args.useshell,
    knowledge        : args.knowledge.trim(),
    actionsdesc      : this.mcpTools,
    isMachine        : (isDef(args.__format) && args.__format != "md")
  })
  llm = this.llm.withInstructions(this._systemInst)
  this._fnI("size", `System prompt size ${ow.format.toBytesAbbreviation(this._systemInst.length)}`)
  if (args.debug) {
    print( ow.format.withSideLine(">>>\n" + this._systemInst + "\n>>>", __, "FG(196)", "BG(52),WHITE", ow.format.withSideLineThemes().doubleLineBothSides) )
  }

  this._isInitialized = true
}

MiniA.prototype.clear = function() {
  this.llm.getGPT().setConversation([])
}

MiniA.prototype.set = function(aConversation) {
  _$(aConversation, "aConversation").isArray().$_()
  this.llm.getGPT().setConversation(aConversation)
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
 * - __format (string, optional): Output format, either "json" or "md". If not set, defaults to "md" unless outfile is specified, then defaults to "json".
 * 
 * Returns:
 * - The final answer as a string or parsed JSON object if __format is "json" and the answer is valid JSON.
 * </odoc>
 */
MiniA.prototype.start = function(args) {
    _$(args.goal, "args.goal").isString().$_()
    args.mcp = _$(args.mcp, "args.mcp").isString().default(__)
    args.verbose = _$(args.verbose, "args.verbose").isBoolean().default(false)
    args.rtm = _$(args.rtm, "args.rtm").isNumber().default(__) // rate limit (calls per minute)
    args.maxsteps = _$(args.maxsteps, "args.maxsteps").isNumber().default(25)
    args.readwrite = _$(args.readwrite, "args.readwrite").isBoolean().default(false)
    args.debug = _$(args.debug, "args.debug").isBoolean().default(false)
    args.useshell = _$(args.useshell, "args.useshell").isBoolean().default(false)
    args.knowledge = _$(args.knowledge, "args.knowledge").isString().default("")
    args.outfile = _$(args.outfile, "args.outfile").isString().default(__)
    args.libs = _$(args.libs, "args.libs").isString().default("")
    args.conversation = _$(args.conversation, "args.conversation").isString().default(__)
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

    this._fnI("user", `${args.goal}`)

    this.init(args)

    this._fnI("info", `Using model: ${this._oaf_model.model} (${this._oaf_model.type})`)

    var context = [], maxSteps = args.maxsteps
    // Context will hold the history of thoughts, actions, and observations
    // We will iterate up to maxSteps to try to achieve the goal
    for(var step = 0; step < maxSteps; step++) {
      // TODO: Improve by summarizing context to fit in prompt if needed
      var prompt = $t(this._STEP_PROMPT_TEMPLATE.trim(), {
        goal   : args.goal,
        context: step == 0 ? "" : context.join("\n")
      })

      this._fnI("input", `Interacting with model (context size ${ow.format.toBytesAbbreviation(context.join("").length)})...`)
      // Get model response and parse as JSON
      addCall()
      if (args.debug) {
        print( ow.format.withSideLine(">>>\n" + prompt + ">>>", __, "FG(220)", "BG(230),BLACK", ow.format.withSideLineThemes().doubleLineBothSides) )
      }
      var rmsg = this.llm.prompt(prompt)
      this._fnI("output", "Model responded.")

      // Store history
      if (isDef(args.conversation)) io.writeFileJSON(args.conversation, this.llm.getGPT().getConversation())
      
      var msg
      if (isString(rmsg)) {
        rmsg = rmsg.replace(/.+\n(\{.+)/m, "$1")
        msg = jsonParse(rmsg, __, __, true)
        if (isUnDef(msg) || !(isMap(msg) || isArray(msg))) {
          context.push(`[OBS ${step + 1}] (error) invalid JSON from model.`)
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
        continue
      }
      if (isUnDef(thought) || thought.length == 0) {
        context.push(`[OBS ${step + 1}] (error) missing 'thought' from model.`)
        continue
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
        this._fnI("think", `${thought || "(no thought)"}`)
        context.push(`[THOUGHT ${step + 1}] ${thought || "no thought"}`)
        continue
      }

      // Action 'shell': run command and add observation to context
      if (action == "shell") {
        if (!command) {
          context.push(`[OBS ${step + 1}] (shell) missing 'command' from model.`)
          continue
        }
        var shellOutput = this._runCommand({ command: command, readwrite: args.readwrite, checkall: args.checkall }).output
        context.push(`[ACT ${step + 1}] shell: ${command}`)
        context.push(`[OBS ${step + 1}] ${shellOutput.trim() || "(no output)"}`)
        continue
      }

      if (this.mcpToolNames.indexOf(origAction) >= 0) {
        if (isDef(msg.params) && !isMap(msg.params)) {
          context.push(`[OBS ${step + 1}] (${origAction}) missing or invalid 'params' from model.`)
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
          toolOutput = jsonParse(toolOutput.content[0].text, __, __, true)
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
        continue
      }

      // Action 'final': print answer and exit
      if (action == "final") {
        /*if (args.verbose && thought) {
          this._fnI("", `[THOUGHT ${step + 1}] ${thought}`)
        }*/
        
        if (answer.trim().startsWith("```") && answer.trim().endsWith("```")) {
          // Remove code block markers if present
          answer = answer.replace(/^```+[\w]*\n/, "").replace(/```+$/, "").trim()
        }

        if (isDef(args.outfile)) {
          io.writeFileString(args.outfile, answer || "(no answer)")
          this._fnI("done", `Final answer written to ${args.outfile}`)
        } else {
          if (isString(answer)) answer = answer.trim()
          if (isString(answer) && answer.match(/^(\{|\[).+(\}|\])$/m) && args.__format == "json") {
            return jsonParse(answer, __, __, true)
          }
          this._fnI("final", `Final answer determined. Goal achieved.`)
          if (args.raw) {
            return answer || "(no answer)" 
          } else {
            return $o(answer || "(no answer)", args, __, true)
          }
        }
        return
      }

      // Unknown action: just add thought to context
      context.push(`[THOUGHT ${step + 1}] ((unknown action -> think) ${thought || "no thought"})`)
    }

    // If max steps hit without final action
    var finalPrompt = $t(this._FINAL_PROMPT.trim(), {
      goal   : args.goal,
      context: context.join("\n")
    })

    this._fnI("warn", `Reached max steps. Asking for final answer...`)
    // Get final answer from model
    addCall()
    var res = jsonParse(this.llm.prompt(finalPrompt), __, __, true)

    // Store history
    if (isDef(args.conversation)) io.writeFileJSON(args.conversation, this.llm.getGPT().getConversation())
    
    // Extract final answer
    if (isDef(res.answer) && res.answer.trim().startsWith("```") && res.answer.trim().endsWith("```")) {
      // Remove code block markers if present
      res.answer = res.answer.replace(/^```+[\w]*\n/, "").replace(/```+$/, "").trim()
    }

    if (isDef(args.outfile)) {
      io.writeFileString(args.outfile, res.answer || "(no final answer)")
      this._fnI("final", `Final answer written to ${args.outfile}`)
      return
    } else {
      if (isString(res.answer)) res.answer = res.answer.trim()
      if (isString(res.answer) && res.answer.match(/^(\{|\[).+(\}|\])$/m) && args.__format == "json") {
        return jsonParse(res.answer, __, __, true)
      }
      if (args.raw) {
        return res.answer || "(no answer)" 
      } else {
        return $o(res.answer || "(no final answer)", args, __, true)
      }
    }
}