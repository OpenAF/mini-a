// Mini-A MCP Tester
// Provides an interactive console workflow to test MCP servers (STDIO or HTTP remote)
// and call their tools with custom parameters
plugin("Console")

// Get command line arguments
var args = isDef(global._args) ? global._args : processExpr(" ")

// Initialize OAF module
__initializeCon()

// Load additional libraries if specified
if (isDef(args.libs) && args.libs.length > 0) {
    args.libs.split(",").map(r => r.trim()).filter(r => r.length > 0).forEach(lib => {
        log(`Loading library: ${lib}...`)
        try {
            if (lib.startsWith("@")) {
                if (/^\@([^\/]+)\/(.+)\.js$/.test(lib)) {
                    var _ar = lib.match(/^\@([^\/]+)\/(.+)\.js$/)
                    var _path = getOPackPath(_ar[1])
                    var _file = _path + "/" + _ar[2] + ".js"
                    if (io.fileExists(_file)) {
                        loadLib(_file)
                    } else {
                        logErr(`Library '${lib}' not found.`)
                    }
                } else {
                    logErr(`Library '${lib}' does not have the correct format (@oPack/library.js).`)
                }
            } else {
                loadLib(lib)
            }
        } catch(e) {
            logErr(`Failed to load library ${lib}: ${e.message}`)
        }
    })
}

// Create MCP connection configuration
function buildMCPConfig(args) {
    var _config = {}

    print()
    var _connectionType = askChoose("Choose MCP connection type: ", ["STDIO (local command)", "HTTP Remote", "🔙 Cancel"])

    if (_connectionType == 2) {
        return null
    }

    if (_connectionType == 0) {
        // STDIO connection
        var _cmd = ask("Enter the MCP command to execute (e.g., 'ojob mcps/mcp-time.yaml'): ")
        if (isUnDef(_cmd) || _cmd.trim() == "") {
            print(ansiColor("ITALIC,FG(196)", "!!") + ansiColor("FG(196)", " Command cannot be empty."))
            return null
        }
        _config.cmd = _cmd.trim()

        // Optional timeout
        var _timeout = ask("Enter timeout in milliseconds (leave blank for default 30000): ")
        if (_timeout != "" && !isNaN(_timeout)) {
            _config.timeout = Number(_timeout)
        }
    } else if (_connectionType == 1) {
        // HTTP Remote connection
        var _url = ask("Enter the MCP HTTP URL (e.g., 'http://localhost:9090/mcp'): ")
        if (isUnDef(_url) || _url.trim() == "") {
            print(ansiColor("ITALIC,FG(196)", "!!") + ansiColor("FG(196)", " URL cannot be empty."))
            return null
        }
        _config.type = "remote"
        _config.url = _url.trim()

        // Optional timeout
        var _timeout = ask("Enter timeout in milliseconds (leave blank for default 30000): ")
        if (_timeout != "" && !isNaN(_timeout)) {
            _config.timeout = Number(_timeout)
        }
    }

    return _config
}

// Helper function to print elapsed time
function printElapsedTime(startTime, operation) {
    var endTime = now()
    var elapsed = endTime - startTime
    print(ansiColor("FAINT", "⏱  " + operation + " took " + elapsed + "ms"))
}

// List MCP tools
function listMCPTools(mcpClient, showElapsed) {
    try {
        var startTime = now()
        var tools = mcpClient.listTools()
        if (showElapsed) {
            printElapsedTime(startTime, "List tools")
        }

        if (isUnDef(tools) || isUnDef(tools.tools) || tools.tools.length == 0) {
            print("\n📭 No tools available from this MCP server.\n")
            return []
        }

        print("\n" + ansiColor("BOLD", "🔧 Available Tools:"))
        print(ansiColor("FAINT", "─────────────────────"))

        tools = tools.tools
        tools.forEach((tool, idx) => {
            print(ansiColor("FG(41)", `[${idx + 1}] ${tool.name}`))
            if (isDef(tool.description)) {
                print("    " + ansiColor("FAINT,ITALIC", tool.description))
            }
            if (isDef(tool.inputSchema) && isDef(tool.inputSchema.properties)) {
                var props = Object.keys(tool.inputSchema.properties)
                if (props.length > 0) {
                    print("    " + ansiColor("FG(248)", "Parameters: ") + props.join(", "))
                }
            }
            print()
        })

        return tools
    } catch(e) {
        print(ansiColor("ITALIC,FG(196)", "!!") + ansiColor("FG(196)", " Failed to list tools: " + e.message))
        return []
    }
}

// Show tool details
function showToolDetails(tool) {
    print("\n" + ansiColor("BOLD,FG(41)", "Tool: " + tool.name))
    print(ansiColor("FAINT", repeat(tool.name.length, "─")))

    if (isDef(tool.description)) {
        print(ansiColor("FG(248)", "Description: ") + tool.description)
    }

    if (isDef(tool.inputSchema)) {
        print("\n" + ansiColor("BOLD", "Input Schema:"))

        if (isDef(tool.inputSchema.properties)) {
            var props = tool.inputSchema.properties
            Object.keys(props).forEach(propName => {
                var prop = props[propName]
                var required = isDef(tool.inputSchema.required) && tool.inputSchema.required.indexOf(propName) >= 0
                var reqMark = required ? ansiColor("FG(196)", " *") : ""

                print("  " + ansiColor("FG(41)", propName) + reqMark)
                if (isDef(prop.type)) {
                    print("    " + ansiColor("FAINT", "Type: ") + prop.type)
                }
                if (isDef(prop.description)) {
                    print("    " + ansiColor("FAINT,ITALIC", prop.description))
                }
                if (isDef(prop.enum)) {
                    print("    " + ansiColor("FAINT", "Allowed: ") + prop.enum.join(", "))
                }
                if (isDef(prop.example)) {
                    print("    " + ansiColor("FAINT", "Example: ") + (isObject(prop.example) ? af.toCSLON(prop.example) : prop.example))
                }
            })
        }

        if (isDef(tool.inputSchema.required) && tool.inputSchema.required.length > 0) {
            print("\n" + ansiColor("FAINT", "* = required parameter"))
        }
    }

    print()
}

// Build parameters for tool call
function buildToolParams(tool) {
    var params = {}

    if (isUnDef(tool.inputSchema) || isUnDef(tool.inputSchema.properties)) {
        var _skipParams = askChoose("No parameters defined. Continue with empty parameters?", ["Yes", "No"])
        if (_skipParams == 1) return null
        return params
    }

    var props = tool.inputSchema.properties
    var required = isDef(tool.inputSchema.required) ? tool.inputSchema.required : []

    print(ansiColor("BOLD", "\n📝 Enter parameters:"))
    print(ansiColor("FAINT", "─────────────────────"))

    Object.keys(props).forEach(propName => {
        var prop = props[propName]
        var isRequired = required.indexOf(propName) >= 0
        var reqMark = isRequired ? ansiColor("FG(196)", " *") : ""

        var promptMsg = propName + reqMark
        if (isDef(prop.type)) {
            promptMsg += ansiColor("FAINT", " (" + prop.type + ")")
        }
        if (isDef(prop.description)) {
            print("  " + ansiColor("FAINT,ITALIC", prop.description))
        }

        var value = ask(promptMsg + ": ")

        // Skip if empty and not required
        if (value == "" && !isRequired) {
            return
        }

        // Parse value based on type
        if (isDef(prop.type)) {
            try {
                if (prop.type == "integer" || prop.type == "number") {
                    if (value != "") {
                        params[propName] = Number(value)
                    } else if (isRequired) {
                        print(ansiColor("ITALIC,FG(196)", "!!") + ansiColor("FG(196)", " Required parameter cannot be empty"))
                        params[propName] = 0
                    }
                } else if (prop.type == "boolean") {
                    if (value != "") {
                        params[propName] = (value.toLowerCase() == "true" || value == "1")
                    } else if (isRequired) {
                        params[propName] = false
                    }
                } else if (prop.type == "object" || prop.type == "array") {
                    if (value != "") {
                        try {
                            params[propName] = af.fromJSSLON(value)
                        } catch(e) {
                            print(ansiColor("ITALIC,FG(196)", "!!") + ansiColor("FG(196)", " Failed to parse JSON/SLON, using as string: " + e.message))
                            params[propName] = value
                        }
                    } else if (isRequired) {
                        params[propName] = prop.type == "array" ? [] : {}
                    }
                } else {
                    // string or other types
                    if (value != "" || isRequired) {
                        params[propName] = value
                    }
                }
            } catch(e) {
                print(ansiColor("ITALIC,FG(196)", "!!") + ansiColor("FG(196)", " Error parsing parameter: " + e.message))
                params[propName] = value
            }
        } else {
            // No type specified, use as string
            if (value != "" || isRequired) {
                params[propName] = value
            }
        }
    })

    return params
}

// Call MCP tool
function callMCPTool(mcpClient, tool, params, sessionOptions) {
    try {
        print("\n" + ansiColor("BOLD,FG(41)", "🚀 Calling tool: " + tool.name))
        if (Object.keys(params).length > 0) {
            print(ansiColor("FAINT", "Parameters: ") + af.toCSLON(params))
        }
        print()

        var startTime = now()
        var result = mcpClient.callTool(tool.name, params)
        if (sessionOptions.showtimeelapsed) {
            printElapsedTime(startTime, "Call tool '" + tool.name + "'")
        }

        print(ansiColor("BOLD,FG(34)", "✅ Result:"))
        print(ansiColor("FAINT", "─────────────────────"))

        if (isUnDef(result)) {
            print(ansiColor("FAINT", "(empty result)"))
        } else if (isString(result)) {
            print(result)
        } else {
            var resultStr = stringify(result, __, "")
            if (sessionOptions.showlimitcallanswer > 0 && resultStr.length > sessionOptions.showlimitcallanswer) {
                resultStr = resultStr.substring(0, sessionOptions.showlimitcallanswer) + "..."
            }
            print(ansiColor("FAINT", resultStr))
            if (sessionOptions.tryparsetoolresult) {
                print(ansiColor("FAINT", "─────────────────────"))
                if (isDef(result)) {
                    var _m = clone(result)
                    traverse(_m, (aK, aV, aP, aO) => {
                        if (isString(aV) && aV.trim().startsWith("{") && aV.trim().endsWith("}")) {
                            try {
                                var _parsed = jsonParse(aV)
                                aO[aK] = _parsed
                            } catch(e) {}
                        } else if (isString(aV) && aV.trim().startsWith("[") && aV.trim().endsWith("]")) {
                            try {
                                var _parsedArr = jsonParse(aV)
                                aO[aK] = _parsedArr
                            } catch(e) {}
                        }
                    })
                    if (isString(_m)) {
                        print(ow.format.withMD(_m))
                    } else {
                        print(printTree(_m))
                    }
                }
            }
        }

        print()

    } catch(e) {
        print("\n" + ansiColor("ITALIC,FG(196)", "!!") + ansiColor("FG(196)", " Tool call failed: " + e.message))
        if (isDef(e.javaException)) {
            print(ansiColor("ITALIC,FG(196)", "!!") + ansiColor("FG(196)", " Stack trace: " + af.toSLON(e.javaException)))
        }
        print()
    }
}

// Main MCP tester
function mainMCPTest(args) {
    var accentColor  = "FG(218)"
    var promptColor  = "FG(41)"
    var errorColor   = "FG(196)"

    // Helper function for colored text
    function colorifyText(text, color) {
        if (isUnDef(color)) return text
        return ansiColor(color, text)
    }

    var successColor = "FG(82)"

    // Option definitions
    var optionDefinitions = {
        tryparsetoolresult: { type: "boolean", default: true, description: "Parse and display tool result content as tree when available" },
        toolchoosesize: { type: "number", default: 8, description: "Number of items to display in tool selection menus" },
        debug: { type: "boolean", default: false, description: "Enable debug mode for MCP connections" },
        showtimeelapsed: { type: "boolean", default: false, description: "Show elapsed time for MCP operations (list tools, call tools, etc.)" },
        showlimitcallanswer: { type: "number", default: 0, description: "Limit the printed string length of call tool results (0 = no limit)" }
    }

    // Initialize session options with defaults
    function resetOptions() {
        var opts = {}
        Object.keys(optionDefinitions).forEach(function(key) {
            var def = optionDefinitions[key]
            if (def && Object.prototype.hasOwnProperty.call(def, "default")) {
                opts[key] = def.default
            }
        })
        return opts
    }

    var sessionOptions = resetOptions()

    // Set an option value
    function setOption(name, rawValue) {
        var key = name.toLowerCase()
        if (!Object.prototype.hasOwnProperty.call(optionDefinitions, key)) {
            print(colorifyText("Unknown option: " + name, errorColor))
            return
        }
        var def = optionDefinitions[key]
        var value = rawValue

        if (def.type === "boolean") {
            var lowerValue = String(value).toLowerCase()
            if (lowerValue === "true" || lowerValue === "1") {
                value = true
            } else if (lowerValue === "false" || lowerValue === "0") {
                value = false
            } else {
                print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Unable to parse boolean value for " + key + ". Use true/false.", errorColor))
                return
            }
        } else if (def.type === "number") {
            var parsedNum = Number(value)
            if (isNaN(parsedNum)) {
                print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Unable to parse numeric value for " + key + ".", errorColor))
                return
            }
            value = parsedNum
        } else if (def.type === "string") {
            if (!isString(value)) value = String(value)
        }

        var oldValue = sessionOptions[key]
        sessionOptions[key] = value
        print(colorifyText("Set " + key + " = " + value, successColor))

        // If debug option changed and we have an active connection, reconnect
        if (key === "debug" && oldValue !== value && isDef(_mcpClient) && isDef(_currentConfig)) {
            print(colorifyText("Debug option changed. Reconnecting...", accentColor))
            try {
                _mcpClient.destroy()
            } catch(e) {}

            try {
                if (sessionOptions.debug) {
                    _currentConfig.debug = true
                } else {
                    _currentConfig.debug = false
                }
                print("🔌 Connecting to MCP server from mcp= parameter...")
                _mcpClient = $mcp(_currentConfig)
                var startTime = now()
                _mcpClient.initialize()
                if (sessionOptions.showtimeelapsed) {
                    printElapsedTime(startTime, "Initialize MCP connection")
                }
                print("✅ Connected successfully!\n")
            } catch(e) {
                print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Connection failed: " + e.message, errorColor) + "\n")
                _mcpClient = __
                _currentConfig = __
            }
        }
    }

    // Toggle a boolean option
    function toggleOption(name) {
        var key = name.toLowerCase()
        if (!Object.prototype.hasOwnProperty.call(optionDefinitions, key)) {
            print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Unknown option: " + name, errorColor))
            return
        }
        var def = optionDefinitions[key]
        if (def.type !== "boolean") {
            print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Option " + key + " is not boolean.", errorColor))
            return
        }
        var current = sessionOptions[key]
        var toggled = current === true ? false : true
        sessionOptions[key] = toggled
        print(colorifyText("Toggled " + key + " -> " + toggled, successColor))

        // If debug option changed and we have an active connection, reconnect
        if (key === "debug" && isDef(_mcpClient) && isDef(_currentConfig)) {
            print(colorifyText("Debug option changed. Reconnecting...", accentColor))
            try {
                _mcpClient.destroy()
            } catch(e) {}

            try {
                if (sessionOptions.debug) {
                    _currentConfig.debug = true
                } else {
                    _currentConfig.debug = false
                }
                print("🔌 Connecting to MCP server from mcp= parameter...")
                _mcpClient = $mcp(_currentConfig)
                var startTime = now()
                _mcpClient.initialize()
                if (sessionOptions.showtimeelapsed) {
                    printElapsedTime(startTime, "Initialize MCP connection")
                }
                print("✅ Connected successfully!\n")
            } catch(e) {
                print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Connection failed: " + e.message, errorColor) + "\n")
                _mcpClient = __
                _currentConfig = __
            }
        }
    }

    // Display current options
    function describeOptions() {
        var rows = Object.keys(optionDefinitions).sort().map(function(key) {
            var def = optionDefinitions[key]
            var active = sessionOptions[key]
            var value
            if (isUnDef(active)) {
                value = "(unset)"
            } else if (isObject(active) || isArray(active)) {
                value = stringify(active, __, "")
            } else {
                value = "" + active
            }
            return { option: key, value: value, description: def.description }
        })

        if (rows.length === 0) {
            print(colorifyText("No options available.", errorColor))
            return
        }

        print("\n" + ansiColor("BOLD", "⚙️  Current Options:"))
        print(ansiColor("FAINT", "─────────────────────"))
        print(printTable(rows, (__conAnsi ? isDef(__con) && __con.getTerminal().getWidth() : __), true, __conAnsi, (__conAnsi || isDef(this.__codepage) ? "utf" : __), __, true, false, true))
        print()
    }

    const miniaLogo = ` ._ _ ${ansiColor(promptColor, "o")}._ ${ansiColor(promptColor, "o")}   _
 | | ||| ||~~(_|`
    print(ansiColor("BOLD", miniaLogo) + ansiColor(accentColor, " MCP Tester"))
    print()

    var _shouldExit = false
    var _mcpClient = __
    var _currentConfig = __

    addOnOpenAFShutdown(() => {
        if (isDef(_mcpClient)) {
            try {
                _mcpClient.destroy()
            } catch(e) {}
        }
    })

    // Check if mcp parameter was provided
    if (isDef(args.mcp)) {
        var config = __
        try {
            // Parse mcp parameter (can be SLON/JSON string or object)
            if (isString(args.mcp)) {
                config = af.fromJSSLON(args.mcp)
            } else if (isMap(args.mcp)) {
                config = args.mcp
            }

            if (isDef(config)) {
                if (sessionOptions.debug) {
                    config.debug = true
                } else {
                    config.debug = false
                }
                print("🔌 Connecting to MCP server from mcp= parameter...")
                _mcpClient = $mcp(config)
                var startTime = now()
                _mcpClient.initialize()
                if (sessionOptions.showtimeelapsed) {
                    printElapsedTime(startTime, "Initialize MCP connection")
                }
                _currentConfig = config
                print("✅ Connected successfully!\n")
            }
        } catch(e) {
            print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Connection failed: " + e.message, errorColor) + "\n")
            _mcpClient = __
            _currentConfig = __
        }
    }

    while(!_shouldExit) {
        var _options = []

        if (isUnDef(_mcpClient)) {
            // Not connected yet
            _options = [
                "🔌 New connection",
                "⚙️  Show options",
                "🔘 Toggle option",
                "📝 Set option",
                "🔙 Exit"
            ]
        } else {
            // Connected
            _options = [
                "📋 List tools",
                "🔧 Call a tool",
                "🔍 Show tool details",
                "🔌 New connection",
                "❌ Disconnect",
                "⚙️  Show options",
                "🔘 Toggle option",
                "📝 Set option",
                "🔙 Exit"
            ]
        }

        var statusMsg = isUnDef(_mcpClient)
            ? "Choose an action:"
            : "Connected. Choose an action:"

        var _action = askChoose(statusMsg, _options, _options.length)

        // Handle actions
        var optionText = _options[_action]

        if (isDef(optionText)) {
            if (optionText.indexOf("New connection") >= 0) {
                // Disconnect if already connected
                if (isDef(_mcpClient)) {
                    try {
                        _mcpClient.destroy()
                    } catch(e) {}
                    _mcpClient = __
                    _currentConfig = __
                }

                var config = buildMCPConfig(args)
                if (isDef(config)) {
                    config = merge(config, { debug: sessionOptions.debug })
                    print("\n🔌 Connecting to MCP server...")
                    try {
                        _mcpClient = $mcp(config)
                        var startTime = now()
                        _mcpClient.initialize()
                        if (sessionOptions.showtimeelapsed) {
                            printElapsedTime(startTime, "Initialize MCP connection")
                        }
                        _currentConfig = config
                        print("✅ Connected successfully!\n")
                    } catch(e) {
                        print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Connection failed: " + e.message, errorColor) + "\n")
                        _mcpClient = __
                        _currentConfig = __
                    }
                }
            } else if (optionText.indexOf("List tools") >= 0) {
                if (isUnDef(_mcpClient)) {
                    print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" No MCP connection. Please create a new connection first.", errorColor) + "\n")
                } else {
                    listMCPTools(_mcpClient, sessionOptions.showtimeelapsed)
                }
            } else if (optionText.indexOf("Call a tool") >= 0) {
                if (isUnDef(_mcpClient)) {
                    print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" No MCP connection. Please create a new connection first.", errorColor) + "\n")
                } else {
                    var startTime = now()
                    var tools = _mcpClient.listTools()
                    if (sessionOptions.showtimeelapsed) {
                        printElapsedTime(startTime, "List tools")
                    }
                    if (isUnDef(tools) || isUnDef(tools.tools) || tools.length == 0) {
                        print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" No tools available.", errorColor) + "\n")
                    } else {
                        tools = tools.tools
                        var toolNames = tools.map(t => t.name).sort().concat(["🔙 Cancel"])
                        var toolIdx = askChoose("Choose a tool to call: ", toolNames, sessionOptions.toolchoosesize)

                        if (toolIdx < tools.length) {
                            var tool = tools.filter(t => t.name == toolNames[toolIdx])[0]
                            showToolDetails(tool)

                            var params = buildToolParams(tool)
                            if (isDef(params)) {
                                callMCPTool(_mcpClient, tool, params, sessionOptions)
                            }
                        }
                    }
                }
            } else if (optionText.indexOf("Show tool details") >= 0) {
                if (isUnDef(_mcpClient)) {
                    print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" No MCP connection. Please create a new connection first.", errorColor) + "\n")
                } else {
                    var startTime = now()
                    var tools = _mcpClient.listTools()
                    if (sessionOptions.showtimeelapsed) {
                        printElapsedTime(startTime, "List tools")
                    }
                    if (isUnDef(tools) || isUnDef(tools.tools) || tools.length == 0) {
                        print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" No tools available.", errorColor) + "\n")
                    } else {
                        tools = tools.tools
                        var toolNames = tools.map(t => t.name).sort().concat(["🔙 Cancel"])
                        var toolIdx = askChoose("Choose a tool to inspect: ", toolNames, sessionOptions.toolchoosesize)

                        if (toolIdx < tools.length) {
                            showToolDetails(tools.filter(t => t.name == toolNames[toolIdx])[0])
                        }
                    }
                }
            } else if (optionText.indexOf("Disconnect") >= 0) {
                if (isDef(_mcpClient)) {
                    try {
                        _mcpClient.destroy()
                        print("\n❌ Disconnected.\n")
                    } catch(e) {
                        print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Error during disconnect: " + e.message, errorColor) + "\n")
                    }
                    _mcpClient = __
                    _currentConfig = __
                }
            } else if (optionText.indexOf("Show options") >= 0) {
                describeOptions()
            } else if (optionText.indexOf("Toggle option") >= 0) {
                var optionKeys = Object.keys(optionDefinitions).filter(function(key) {
                    return optionDefinitions[key].type === "boolean"
                })

                if (optionKeys.length === 0) {
                    print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" No boolean options available to toggle.", errorColor) + "\n")
                } else {
                    var maxOptionLength = optionKeys.reduce(function(max, key) {
                        return Math.max(max, key.length)
                    }, 0)
                    var optionChoices = optionKeys.map(function(key) {
                        var currentValue = sessionOptions[key]
                        return key + repeat(maxOptionLength - key.length, " ") + " (currently: " + currentValue + ")"
                    }).sort().concat(["🔙 Cancel"])

                    var optionIdx = askChoose("Choose an option to toggle: ", optionChoices)

                    if (optionIdx < optionKeys.length) {
                        toggleOption(optionKeys.filter((k) => optionChoices[optionIdx].startsWith(k))[0])
                        print()
                    }
                }
            } else if (optionText.indexOf("Set option") >= 0) {
                var allOptionKeys = Object.keys(optionDefinitions)

                if (allOptionKeys.length === 0) {
                    print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" No options available to set.", errorColor) + "\n")
                } else {
                    var maxOptionLength = allOptionKeys.reduce(function(max, key) {
                        return Math.max(max, key.length)
                    }, 0)
                    var allOptionChoices = allOptionKeys.map(function(key) {
                        var def = optionDefinitions[key]
                        var currentValue = sessionOptions[key]
                        return key + repeat(maxOptionLength - key.length, " ") + " (" + def.type + ", currently: " + currentValue + ")"
                    }).sort().concat(["🔙 Cancel"])

                    var setOptionIdx = askChoose("Choose an option to set: ", allOptionChoices)

                    if (setOptionIdx < allOptionKeys.length) {
                        var selectedKey = allOptionKeys.filter((k) => allOptionChoices[setOptionIdx].startsWith(k))[0]
                        var def = optionDefinitions[selectedKey]
                        var newValue = ask("Enter new value for " + selectedKey + " (" + def.type + "): ")

                        if (isDef(newValue) && newValue.trim() !== "") {
                            setOption(selectedKey, newValue.trim())
                            print()
                        }
                    }
                }
            } else if (optionText.indexOf("Exit") >= 0) {
                if (isDef(_mcpClient)) {
                    try {
                        _mcpClient.destroy()
                    } catch(e) {}
                }
                print("👋 Exiting...\n")
                _shouldExit = true
            }
        }


        if (!_shouldExit && isDef(_mcpClient)) {
            print(ansiColor("FAINT", repeat((new Console()).getConsoleReader().getTerminal().getWidth(), "─")))
        }
    }
}

// Run the main tester
mainMCPTest(args)
