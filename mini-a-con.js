plugin("Console")
var args = processExpr(" ")

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
var historyFileName = ".openaf-mini-a_history"
var historyHome     = isDef(__gHDir) ? __gHDir() : java.lang.System.getProperty("user.home")
var historyFilePath = io.fileInfo((historyHome || ".") + "/" + historyFileName).canonicalPath
var consoleReader   = null
var commandHistory  = null
var slashCommands   = ["help", "set", "toggle", "unset", "show", "reset", "last", "exit", "quit"]

try {
  if (isDef(con) && typeof con.getConsoleReader === "function") {
    consoleReader = con.getConsoleReader()
    commandHistory = new Packages.jline.console.history.FileHistory(new java.io.File(historyFilePath))
    consoleReader.setHistory(commandHistory)
  }
} catch (historyError) {
  commandHistory = null
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
  useshell       : { type: "boolean", default: false, description: "Allow shell command execution" },
  readwrite      : { type: "boolean", default: false, description: "Allow write operations during shell commands" },
  checkall       : { type: "boolean", default: false, description: "Ask for confirmation before shell commands" },
  shellbatch     : { type: "boolean", default: false, description: "Automatically approve shell commands" },
  shellallowpipes: { type: "boolean", default: false, description: "Allow pipes and redirections" },
  usetools       : { type: "boolean", default: false, description: "Register MCP tools directly on the model" },
  useutils       : { type: "boolean", default: false, description: "Enable bundled Mini File Tool utilities" },
  useplanning    : { type: "boolean", default: false, description: "Track and expose task planning" },
  chatbotmode    : { type: "boolean", default: false, description: "Run Mini-A in chatbot mode" },
  mcplazy        : { type: "boolean", default: false, description: "Defer MCP connection initialization" },
  mcpdynamic     : { type: "boolean", default: false, description: "Select MCP tools dynamically per goal" },
  rpm            : { type: "number", description: "Requests per minute limit" },
  tpm            : { type: "number", description: "Tokens per minute limit" },
  maxsteps       : { type: "number", description: "Maximum consecutive non-success steps" },
  maxcontext     : { type: "number", description: "Maximum allowed context tokens" },
  toolcachettl   : { type: "number", description: "Default MCP result cache TTL (ms)" },
  goalprefix     : { type: "string", description: "Optional prefix automatically added to every goal" },
  shell          : { type: "string", description: "Prefix applied to each shell command" },
  shellallow     : { type: "string", description: "Comma-separated shell allow list" },
  shellbanextra  : { type: "string", description: "Comma-separated extra banned commands" },
  mcp            : { type: "string", description: "MCP connection definition (SLON/JSON)" },
  knowledge      : { type: "string", description: "Extra knowledge or context" },
  libs           : { type: "string", description: "Comma-separated libraries to load" },
  conversation   : { type: "string", description: "Conversation history file" },
  outfile        : { type: "string", description: "Save final answer to file" },
  outputfile     : { type: "string", description: "Alias for outfile for plan conversions" },
  planfile       : { type: "string", description: "Plan file to load before execution" },
  planformat     : { type: "string", description: "Plan format override (md|json)" },
  rules          : { type: "string", description: "Custom agent rules (JSON or SLON)" },
  state          : { type: "string", description: "Initial agent state (JSON or SLON)" },
  format         : { type: "string", description: "Final answer format (md|json)" },
  model          : { type: "string", description: "Override OAF_MODEL configuration" },
  modellc        : { type: "string", description: "Override OAF_LC_MODEL configuration" },
  auditch        : { type: "string", description: "Audit channel definition" }
}
var sessionParameterNames = Object.keys(parameterDefinitions).sort()

function parseBoolean(value) {
  var lowered = ("" + value).trim().toLowerCase()
  if (lowered === "true" || lowered === "1" || lowered === "yes" || lowered === "y" || lowered === "on") return true
  if (lowered === "false" || lowered === "0" || lowered === "no" || lowered === "n" || lowered === "off") return false
  return undefined
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
    var parsedNum = parseNumber(rawValue)
    if (isUnDef(parsedNum)) {
      print(colorifyText("Ignored CLI override for " + key + ": expected number.", errorColor))
      return undefined
    }
    return parsedNum
  }
  if (def.type === "string") {
    return String(rawValue)
  }
  return rawValue
}

function applyArgumentDefaults(argMap) {
  if (!isObject(argMap)) return
  Object.keys(argMap).forEach(function(originalKey) {
    var normalizedKey = String(originalKey).toLowerCase()
    if (!Object.prototype.hasOwnProperty.call(parameterDefinitions, normalizedKey)) return
    var definition = parameterDefinitions[normalizedKey]
    var rawValue = argMap[originalKey]
    var coerced = coerceDefaultValue(definition, rawValue, normalizedKey)
    if (isDef(coerced)) definition.default = coerced
  })
}

if (consoleReader) {
  try {
    var slashParameterHints = { set: "=", toggle: "", unset: "" }
    consoleReader.addCompleter(
      new Packages.openaf.jline.OpenAFConsoleCompleter(function(buf, cursor, candidates) {
        if (buf === null) return -1
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

applyArgumentDefaults(args)

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
var lastResult = null
var internalParameters = { goalprefix: true }

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
    if (value === null) return
  }
  if (def.type === "boolean") {
    var parsedBool = parseBoolean(value)
    if (isUnDef(parsedBool)) {
      print(colorifyText("Unable to parse boolean value for " + key + ". Use true/false.", errorColor))
      return
    }
    value = parsedBool
  } else if (def.type === "number") {
    var parsedNum = parseNumber(value)
    if (isUnDef(parsedNum)) {
      print(colorifyText("Unable to parse numeric value for " + key + ".", errorColor))
      return
    }
    value = parsedNum
  } else if (def.type === "string") {
    if (!isString(value)) value = String(value)
  }
  sessionOptions[key] = value
  print(colorifyText("Set " + key + "=" + value, successColor))
}

function unsetOption(name) {
  var key = name.toLowerCase()
  if (!Object.prototype.hasOwnProperty.call(parameterDefinitions, key)) {
    print(colorifyText("Unknown parameter: " + name, errorColor))
    return
  }
  if (Object.prototype.hasOwnProperty.call(parameterDefinitions[key], "default")) {
    sessionOptions[key] = parameterDefinitions[key].default
  } else {
    delete sessionOptions[key]
  }
  print(colorifyText("Cleared parameter " + key, successColor))
}

function toggleOption(name) {
  var key = name.toLowerCase()
  if (!Object.prototype.hasOwnProperty.call(parameterDefinitions, key)) {
    print(colorifyText("Unknown parameter: " + name, errorColor))
    return
  }
  var def = parameterDefinitions[key]
  if (def.type !== "boolean") {
    print(colorifyText("Parameter " + key + " is not boolean.", errorColor))
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
 */
function describeOptions() {
  var rows = Object.keys(parameterDefinitions).sort().map(function(key) {
    var def = parameterDefinitions[key]
    var active = sessionOptions[key]
    var value
    if (isUnDef(active)) value = "(unset)"
    else if (isObject(active) || isArray(active)) value = stringify(active, __, "")
    else value = "" + active
    return { parameter: key, value: value, description: def.description }
  })
  print( printTable(rows, (__conAnsi ? isDef(__con) && __con.getTerminal().getWidth() : __), true, __conAnsi, (__conAnsi || isDef(this.__codepage) ? "utf" : __), __, true, false, true) )
}

function ensureModel(args) {
  if (isString(args.model) && args.model.trim().length > 0) return true
  var envModel = getEnv("OAF_MODEL")
  if (isString(envModel) && envModel.trim().length > 0) return true
  print(colorifyText("OAF_MODEL is not set and no model override provided. Export OAF_MODEL or use /set model ...", errorColor))
  return false
}

function buildArgs(goalText) {
  var cleanGoal = isString(goalText) ? goalText.trim() : goalText
  var args = {}
  Object.keys(sessionOptions).forEach(function(key) {
    if (internalParameters[key]) return
    var value = sessionOptions[key]
    if (isUnDef(value) || value === "") return
    args[key] = value
  })
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

function printEvent(type, icon, message, id) {
  var prefix = colorifyText("[" + id + "]", hintColor)
  var iconText = colorifyText(icon, eventPalette[type] || accentColor)
  print(prefix + " " + iconText + " " + message)
}

function runGoal(goalText) {
  var args = buildArgs(goalText)
  if (!ensureModel(args)) return
  var agent = new MiniA()
  agent.setInteractionFn(function(event, message) {
    agent.defaultInteractionFn(event, message, function(icon, text, id) {
      printEvent(event, icon, text, id)
    })
  })
  try {
    agent.init(args)
    lastResult = agent.start(args)
    if (isUnDef(args.outfile)) {
      print(colorifyText("\n🏁 Final answer", successColor))
      if (isObject(lastResult) || isArray(lastResult)) {
        print(stringify(lastResult, __, "  "))
      } else if (isString(lastResult)) {
        print(lastResult)
      } else if (isDef(lastResult)) {
        print(stringify(lastResult, __, ""))
      }
    } else {
      print(colorifyText("Final answer written to " + args.outfile, successColor))
    }
  } catch (e) {
    var errMsg = isDef(e) && isDef(e.message) ? e.message : "" + e
    print(colorifyText("Mini-A execution failed: " + errMsg, errorColor))
  }
}

function printHelp() {
  var lines = [
    "- Type a goal and press Enter to launch Mini-A.",
    "- Enter '" + colorifyText("\"\"\"", accentColor) + colorifyText("' on a new line to compose multi-line goals.", hintColor),
    "- Use Tab to complete slash commands and ↑/↓ to browse history saved at " + colorifyText(historyFilePath, accentColor) + ".",
    "",
    "Commands (prefix with '/'):",
    "  " + colorifyText("/help", "BOLD") + colorifyText("               Show this help message", hintColor),
    "  " + colorifyText("/set", "BOLD") + colorifyText(" <key> <value>  Update a Mini-A parameter (use '", hintColor) + colorifyText("\"\"\"", accentColor) + colorifyText("' for multi-line values)", hintColor),
    "  " + colorifyText("/toggle", "BOLD") + colorifyText(" <key>       Toggle boolean parameter", hintColor),
    "  " + colorifyText("/unset", "BOLD") + colorifyText(" <key>        Clear a parameter", hintColor),
    "  " + colorifyText("/show", "BOLD") + colorifyText("               Display configured parameters", hintColor),
    "  " + colorifyText("/reset", "BOLD") + colorifyText("              Restore default parameters", hintColor),
    "  " + colorifyText("/last", "BOLD") + colorifyText("               Print the previous final answer", hintColor),
    "  " + colorifyText("/exit", "BOLD") + colorifyText("               Leave the console", hintColor)
  ]
  print( ow.format.withSideLine( lines.join("\n"), __, promptColor, hintColor, ow.format.withSideLineThemes().openCurvedRect) )
}

const miniaLogo = `._ _ o._ o   _ 
| | ||| ||~~(_|`
print(colorifyText(miniaLogo, "BOLD") + colorifyText(" console", accentColor))
print()
print(colorifyText("Type /help for available commands.", hintColor))

while(true) {
  var input = con.readLinePrompt(promptLabel())
  if (isUnDef(input)) break
  var trimmed = String(input)
  if (trimmed.trim().length === 0) continue
  if (trimmed === '"""') {
    var composed = collectMultiline("")
    if (composed !== null && composed.trim().length > 0) runGoal(composed)
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
    if (command === "reset") {
      sessionOptions = resetOptions()
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
    print(colorifyText("Unknown command: /" + command, errorColor))
    continue
  }
  var goalText = trimmed
  if (goalText.endsWith("\\")) {
    goalText = goalText.substring(0, goalText.length - 1)
    var more = collectMultiline("")
    if (more !== null) goalText = goalText + "\n" + more
  }
  runGoal(goalText)
}

print(colorifyText("Goodbye!", accentColor))
if (commandHistory && typeof commandHistory.flush === "function") {
  try {
    commandHistory.flush()
  } catch (flushError) { }
}
