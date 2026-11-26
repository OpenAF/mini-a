// Resolve dependencies from this package before loading other modules.
if (typeof __miniAPath !== "function") loadLib(String(new java.io.File(String(__loadedfrom)).getCanonicalFile().getParentFile().getParent()) + "/mini-a-paths.js")

// Mini-A MCP Tester
// Provides an interactive console workflow to test MCP servers across
// the transports and config shapes supported by OpenAF's $mcp().
plugin("Console")

// Get command line arguments
var args = isDef(global._args) ? global._args : processExpr(" ")

// Initialize OAF module
__initializeCon()
loadLib(__miniAPath("js/core/mini-a-common.js"))
loadLib(__miniAPath("js/core/mini-a-mcp-helpers.js"))

// Load additional libraries if specified
if (isDef(args.libs) && args.libs.length > 0) {
    __miniALoadLibraries(args.libs, log, logErr)
}

function normalizeChoiceIndex(value, maxExclusive) {
    var idx = isNumber(value) ? value : Number(value)
    if (isNaN(idx)) return -1
    idx = Math.floor(idx)
    if (idx < 0) return -1
    if (isNumber(maxExclusive) && idx >= maxExclusive) return -1
    return idx
}

function parseOptionalJSSLON(label, rawValue, expectedType) {
    if (isUnDef(rawValue) || String(rawValue).trim() == "") return __

    var parsed = af.fromJSSLON(String(rawValue).trim())
    if (expectedType == "map" && !isMap(parsed)) {
        throw new Error(label + " must be a map/object.")
    }
    if (expectedType == "array" && !isArray(parsed)) {
        throw new Error(label + " must be an array.")
    }
    return parsed
}

function summarizeMCPConfig(config) {
    if (!isMap(config)) return "(invalid config)"

    var type = String(config.type || (isDef(config.cmd) ? "stdio" : "remote")).toLowerCase()
    if (type == "http") type = "remote"
    if (type == "remote" && config.sse === true) type = "sse"

    if (type == "stdio") return "stdio: " + String(config.cmd || "(missing cmd)")
    if (type == "ojob") {
        var jobName = isMap(config.options) && isDef(config.options.job) ? String(config.options.job) : "(missing job)"
        return "ojob: " + jobName
    }
    if (type == "dummy") return "dummy"

    var target = isDef(config.url) ? String(config.url) : "(missing url)"
    return type + ": " + target
}

function stripNullAndUndef(value) {
    if (isArray(value)) {
        return value.filter(v => !isUnDef(v) && !isNull(v)).map(stripNullAndUndef)
    }
    if (isMap(value)) {
        var _res = {}
        Object.keys(value).forEach(function(key) {
            var v = value[key]
            if (isUnDef(v) || isNull(v)) return
            _res[key] = stripNullAndUndef(v)
        })
        return _res
    }
    return value
}

function buildMcpParamString(config) {
    return af.toSLON(stripNullAndUndef(config))
}

function normalizeMCPConfigInput(rawConfig) {
    var config = rawConfig

    if (isString(config)) config = af.fromJSSLON(config)

    if (isArray(config)) {
        if (config.length == 0) throw new Error("No MCP configuration entries were provided.")
        if (config.length == 1) return config[0]

        var choices = config.map((cfg, idx) => "[" + (idx + 1) + "] " + summarizeMCPConfig(cfg)).concat(["🔙 Cancel"])
        var chosen = normalizeChoiceIndex(askChoose("Select which MCP configuration to test: ", choices, Math.min(choices.length, 10)), config.length)
        if (chosen < 0 || chosen >= config.length) return __
        return config[chosen]
    }

    if (!isMap(config)) {
        throw new Error("MCP configuration should be an object/map or an array of objects/maps.")
    }

    return config
}

// Include the provider's safe OAuth error identifier without exposing token responses.
function mcpConnectionError(error) {
  var message = String(error.message)
  if (isString(error.oauthError) && /^[a-zA-Z0-9_]+$/.test(error.oauthError)) {
    message += " (OAuth: " + error.oauthError + ")"
  }
  return message
}

// Read advertised scopes without starting login or requesting protected tools.
function discoverMCPScopes(url) {
  var uri = new java.net.URI(url)
  if (String(uri.getScheme()) != "https") throw new Error("Scope discovery requires an HTTPS server URL.")
  var origin = String(new java.net.URI(uri.getScheme(), null, uri.getHost(), uri.getPort(), null, null, null))
  var path = String(uri.getPath() || "").replace(/\/$/, "")
  var urls = [origin + "/.well-known/oauth-protected-resource" + path]
  if (path != "") urls.push(origin + "/.well-known/oauth-protected-resource")
  for (var i = 0; i < urls.length; i++) {
    var metadata = $rest({ timeout: 10000 }).get(urls[i])
    if (!isMap(metadata) || !isArray(metadata.scopes_supported)) continue
    var scopes = metadata.scopes_supported.filter(function(scope) {
      return isString(scope) && scope.length > 0 && !/\s/.test(scope)
    })
    return scopes.filter(function(scope, index) { return scopes.indexOf(scope) == index }).sort()
  }
  return []
}

// Let users select multiple advertised scopes, enter scopes manually, or retain defaults.
function chooseMCPScopes(config, auth) {
  var mode = normalizeChoiceIndex(askChoose("OAuth scopes: ", [
    "🔍 Discover and select scopes", "📝 Enter scopes manually", "Use OpenAF defaults", "🔙 Cancel"
  ]), 4)
  if (mode < 0 || mode == 3) return false
  if (mode == 2) return true
  if (mode == 0) {
    var scopes = []
    try {
      print("Discovering advertised OAuth scopes...")
      scopes = discoverMCPScopes(config.url)
    } catch(e) {
      print("Scope discovery failed. Enter scopes manually or cancel with a blank value.")
    }
    if (scopes.length > 0) {
      var selected = askChooseMultiple("Select OAuth scopes (blank selection cancels): ", scopes, 12)
      if (!isArray(selected) || selected.length == 0) return false
      auth.scope = selected.join(" ")
      return true
    }
    print("No selectable scopes discovered. Enter the provider's scope names separated by spaces.")
  }
  var value = ask("Scopes separated by spaces (blank to cancel): ")
  if (isUnDef(value) || value.trim() == "") return false
  auth.scope = value.trim()
  return true
}

// Configure remote authentication using OpenAF's native OAuth discovery and refresh.
function configureMCPAuth(config) {
  var choice = normalizeChoiceIndex(askChoose("Authentication: ", [
    "Keep current / none", "OAuth2 automatic browser login", "OAuth2 authorization code", "OAuth2 client credentials", "Bearer token", "🔙 Cancel"
  ]), 6)
  if (choice < 0 || choice == 5) return false
  if (choice == 0) return true

  var auth = { type: choice == 4 ? "bearer" : "oauth2" }
  if (choice == 4) {
    auth.token = ask("Bearer token: ", "*")
    if (isUnDef(auth.token) || auth.token.trim() == "") return false
  } else {
    if (choice != 1) {
      auth.grantType = choice == 2 ? "authorization_code" : "client_credentials"
      auth.clientId = ask("Client ID: ")
      if (isUnDef(auth.clientId) || auth.clientId.trim() == "") return false
      var secret = ask("Client secret (blank for public client): ", "*")
      if (isDef(secret) && secret != "") auth.clientSecret = secret
      if (choice == 2) auth.callback = true
    }

    if (!chooseMCPScopes(config, auth)) return false

    var fields = choice == 1 ? [] : ["tokenURL"]
    if (choice == 2) fields = fields.concat(["authURL", "redirectURI"])
    fields.forEach(function(key) {
      var value = ask(key + " (blank for OpenAF default/discovery): ")
      if (isDef(value) && value.trim() != "") auth[key] = value.trim()
    })
    var profile = ask("Encrypted token store profile (blank for no persistence): ")
    if (isDef(profile) && profile.trim() != "") auth.tokenStore = { type: "sec", profile: profile.trim() }
    var extra = ask("Advanced auth options as JSSLON/JSON (blank to skip): ")
    if (isDef(extra) && extra.trim() != "") auth = merge(auth, parseOptionalJSSLON("Authentication options", extra, "map"))
  }
  config.auth = auth
  return true
}

// Show a shell-quoted parameter only when explicitly requested by the user.
function showMCPParameter(config) {
  var value = buildMcpParamString(config).replace(/'/g, "'\\''")
  print("mcp='" + value + "'")
}

// Offer the completed configuration before starting a potentially failing connection.
function reviewMCPConfig(config) {
  while (true) {
    var choice = normalizeChoiceIndex(askChoose("Connection configuration ready: ", [
      "🔌 Connect", "🔤 Show mcp= parameter (includes configured secrets)", "🔙 Cancel"
    ]), 3)
    if (choice == 0) return config
    if (choice != 1) return null
    showMCPParameter(config)
  }
}

// Collect optional connection settings.
function enrichMCPConfig(config) {
    var _config = clone(config)

    var _timeout = ask("Enter timeout in milliseconds (leave blank for default 30000): ")
    if (_timeout != "" && !isNaN(_timeout)) {
        _config.timeout = Number(_timeout)
    }

    var _extra = ask("Extra $mcp options as JSSLON/JSON (blank to skip, e.g. \"(shared: true, clientInfo: (name: 'Mini-A MCP Tester', version: '1.0.0'))\"): ")
    if (isDef(_extra) && _extra.trim() != "") {
        var _extraParsed = parseOptionalJSSLON("Extra $mcp options", _extra, "map")
        _config = merge(_config, _extraParsed)
    }

    if (isDef(_config.url) && !configureMCPAuth(_config)) return null

    return _config
}

// Create MCP connection configuration
function buildMCPConfig(args) {
    var _config = {}

    print()
    var _connectionType = normalizeChoiceIndex(askChoose("Choose MCP connection type: ", [
        "STDIO (local command)",
        "HTTP Remote",
        "HTTP SSE",
        "oJob MCP",
        "Dummy MCP",
        "Raw $mcp config",
        "🔙 Cancel"
    ]), 6)

    if (_connectionType < 0 || _connectionType == 6) {
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
    } else if (_connectionType == 1) {
        // HTTP Remote connection
        var _url = ask("Enter the MCP HTTP URL (e.g., 'http://localhost:9090/mcp'): ")
        if (isUnDef(_url) || _url.trim() == "") {
            print(ansiColor("ITALIC,FG(196)", "!!") + ansiColor("FG(196)", " URL cannot be empty."))
            return null
        }
        _config.type = "remote"
        _config.url = _url.trim()
    } else if (_connectionType == 2) {
        var _sseUrl = ask("Enter the MCP SSE URL (e.g., 'http://localhost:9090/mcp'): ")
        if (isUnDef(_sseUrl) || _sseUrl.trim() == "") {
            print(ansiColor("ITALIC,FG(196)", "!!") + ansiColor("FG(196)", " URL cannot be empty."))
            return null
        }
        _config.type = "sse"
        _config.sse = true
        _config.url = _sseUrl.trim()
    } else if (_connectionType == 3) {
        _config.type = "ojob"
        _config.options = {}

        var _job = ask("Enter the oJob file path (e.g., 'mcps/mcp-time.yaml'): ")
        if (isUnDef(_job) || _job.trim() == "") {
            print(ansiColor("ITALIC,FG(196)", "!!") + ansiColor("FG(196)", " Job path cannot be empty."))
            return null
        }
        _config.options.job = _job.trim()

        var _jobArgs = ask("Optional oJob args as JSSLON/JSON map (blank to skip): ")
        if (isDef(_jobArgs) && _jobArgs.trim() != "") {
            _config.options.args = parseOptionalJSSLON("oJob args", _jobArgs, "map")
        }

        var _jobInit = ask("Optional oJob init entry or array as JSSLON/JSON (blank to skip): ")
        if (isDef(_jobInit) && _jobInit.trim() != "") {
            var _parsedInit = parseOptionalJSSLON("oJob init", _jobInit)
            _config.options.init = _parsedInit
        }
    } else if (_connectionType == 4) {
        _config.type = "dummy"
        _config.options = {}

        var _dummyFns = ask("Dummy MCP functions as JSSLON/JSON map (blank for empty): ")
        if (isDef(_dummyFns) && _dummyFns.trim() != "") {
            _config.options.fns = parseOptionalJSSLON("Dummy functions", _dummyFns, "map")
        }

        var _dummyMeta = ask("Dummy MCP metadata as JSSLON/JSON map (blank for empty): ")
        if (isDef(_dummyMeta) && _dummyMeta.trim() != "") {
            _config.options.fnsMeta = parseOptionalJSSLON("Dummy metadata", _dummyMeta, "map")
        }
    } else if (_connectionType == 5) {
        var _raw = ask("Enter the full $mcp config as JSSLON/JSON: ")
        if (isUnDef(_raw) || _raw.trim() == "") {
            print(ansiColor("ITALIC,FG(196)", "!!") + ansiColor("FG(196)", " Config cannot be empty."))
            return null
        }
        _config = normalizeMCPConfigInput(_raw)
    }

    var enriched = enrichMCPConfig(_config)
    return isDef(enriched) ? reviewMCPConfig(enriched) : null
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

// Show MCP server info
function showMCPServerInfo(mcpClient, showElapsed) {
    try {
        var startTime = now()
        var toolsResult = mcpClient.listTools()
        if (showElapsed) {
            printElapsedTime(startTime, "Get MCP server info")
        }

        var serverInfo = __
        if (isDef(mcpClient.getInfo)) {
            serverInfo = mcpClient.getInfo()
        }

        print("\n" + ansiColor("BOLD", "🖥️  MCP Server Information:"))
        print(ansiColor("FAINT", "──────────────────────────"))

        if (isUnDef(serverInfo)) {
            print(ansiColor("FAINT", "No server information available from this MCP server."))
        } else if (isString(serverInfo)) {
            print(serverInfo)
        } else {
            print(printTree(serverInfo))
        }
        print()
    } catch(e) {
        print(ansiColor("ITALIC,FG(196)", "!!") + ansiColor("FG(196)", " Failed to get server info: " + e.message))
        print()
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
        var _skipParams = normalizeChoiceIndex(askChoose("No parameters defined. Continue with empty parameters?", ["Yes", "No"]), 2)
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
        result = resolveMCPResult(mcpClient, tool, params, result, sessionOptions)
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

// Connect with protocol negotiation. The handler is registered before initialize so elicitation is advertised.
function connectMCP(config, sessionOptions, factory) {
  var raw = clone(config)
  var external = ["dummy", "ojob"].indexOf(__miniAMcpType(config)) < 0
  var opts = external ? merge({ protocolVersion: "auto", tasks: true }, config) : config
  var startTime = now()
  var client = isFunction(factory) ? factory(opts) : $mcp(opts)
  var registered = false
  if (isFunction(client.onElicitationRequest)) {
    client.onElicitationRequest(function(request) { return testerElicitationHandler(request, sessionOptions) }, { form: {}, url: {} })
    registered = true
  }
  client.initialize()
  client.__miniATesterPrompt = registered
  if (sessionOptions.showtimeelapsed) printElapsedTime(startTime, "Initialize MCP connection")
  return { client: client, config: opts, raw: raw }
}

// Describe one feature given whether the runtime and the server support it.
function describeMCPFeature(runtimeOk, serverOk, fnName) {
  if (runtimeOk && serverOk) return "available"
  if (!runtimeOk && serverOk) return "advertised by the server, but this OpenAF runtime lacks " + fnName
  if (runtimeOk && !serverOk) return "not advertised by the server"
  return "unavailable (runtime lacks " + fnName + " and the server does not advertise it)"
}

// Build one row per feature with its negotiated state.
function mcpFeatureRows(client) {
  var summary = __miniAMcpFeatureSummary(client, { prompt: client.__miniATesterPrompt === true })
  var version = summary.version
  var elicitation
  if (!summary.elicitation.runtime) elicitation = "unavailable (runtime lacks onElicitationRequest)"
  else if (version < "2025-06-18") elicitation = "not supported by protocol version " + (version || "(unknown)")
  else elicitation = version >= "2025-11-25" ? "form and URL" : "form"
  return {
    version: version,
    server: summary.server,
    rows: [
      { feature: "tasks", state: describeMCPFeature(summary.tasks.runtime, summary.tasks.server, "getTask") },
      { feature: "elicitation", state: elicitation },
      { feature: "skills", state: describeMCPFeature(summary.skills.runtime, summary.skills.server, "listSkills") },
      { feature: "resources", state: describeMCPFeature(summary.resources.runtime, summary.resources.server, "listResources") },
      { feature: "prompts", state: describeMCPFeature(summary.prompts.runtime, summary.prompts.server, "listPrompts") },
      { feature: "tools", state: describeMCPFeature(summary.tools.runtime, summary.tools.server, "listTools") }
    ]
  }
}

// Print the negotiated capabilities.
function printMCPCapabilities(client) {
  var info = mcpFeatureRows(client)
  print("\n" + ansiColor("BOLD", "🧭 MCP capabilities"))
  print(ansiColor("FAINT", "─────────────────────"))
  var name = isString(info.server.name) ? __miniAMcpLabel(info.server.name) : "(unnamed server)"
  print(ansiColor("FG(248)", "Server: ") + name + ansiColor("FG(248)", "  Protocol: ") + (info.version || "(unknown)"))
  info.rows.forEach(function(row) {
    var ok = row.state === "available" || row.state.indexOf("form") === 0
    print("  " + ansiColor(ok ? "FG(41)" : "FG(248)", row.feature + repeat(12 - row.feature.length, " ")) + row.state)
  })
  print()
}

// Ask for one menu choice and return the zero-based index, or -1 on cancel.
function chooseMCPItem(label, items, size) {
  return normalizeChoiceIndex(askChoose(label, items.concat(["🔙 Back"]), size || 8), items.length)
}

// Answer a server elicitation request (form or URL) interactively, mirroring the agent's URL safety rules.
function testerElicitationHandler(request, sessionOptions) {
  try {
    if (sessionOptions.__noninteractive === true || !isMap(request)) return { action: "cancel" }
    print("\n" + ansiColor("BOLD", "🙋 Server input request") + (isDef(request.mode) ? " (" + request.mode + ")" : ""))
    print(__miniAMcpLabel(request.message))

    if (request.mode === "url") {
      var uri = new java.net.URI(request.url)
      if (String(uri.getScheme()).toLowerCase() !== "https" || uri.getHost() === null || uri.getUserInfo() !== null) {
        print(ansiColor("FG(196)", "!! Declined: only plain https URLs are accepted."))
        return { action: "decline" }
      }
      var host = String(uri.getHost()) + (uri.getPort() < 0 ? "" : ":" + uri.getPort())
      var consent = normalizeChoiceIndex(askChoose("Destination: " + host, ["Allow navigation", "Decline", "Cancel"]), 3)
      if (consent !== 0) return { action: consent === 1 ? "decline" : "cancel" }
      print("Open: " + String(uri.toASCIIString()))
      var next = normalizeChoiceIndex(askChoose("Complete the interaction, then continue.", ["Continue", "Cancel"]), 2)
      return { action: next === 0 ? "accept" : "cancel" }
    }
    if (isDef(request.mode) && request.mode !== "form") return { action: "decline" }

    var schema = request.requestedSchema
    if (!isMap(schema) || schema.type !== "object" || !isMap(schema.properties)) {
      print(ansiColor("FG(196)", "!! Declined: unsupported form schema."))
      return { action: "decline" }
    }
    print(ansiColor("FAINT", "Requested schema: ") + af.toCSLON(schema))
    var keys = Object.keys(schema.properties)
    var fields = keys.map(function(key) { return __miniAMcpField(schema.properties[key]) })
    var required = isArray(schema.required) ? schema.required : []
    var values = {}

    // Test mode: take the schema defaults without prompting.
    if (sessionOptions.autoacceptelicitation === true) {
      keys.forEach(function(key) {
        if (isDef(schema.properties[key].default)) values[key] = schema.properties[key].default
      })
      return required.every(function(key) { return isDef(values[key]) }) ? { action: "accept", content: values } : { action: "decline" }
    }

    while (true) {
      keys.forEach(function(key, index) {
        var prop = schema.properties[key]
        var field = fields[index]
        var isReq = required.indexOf(key) >= 0
        var label = __miniAMcpLabel(prop.title || key) + (prop.description ? " (" + __miniAMcpLabel(prop.description) + ")" : "") + (isReq ? " *" : "")
        var initial = isDef(values[key]) ? values[key] : prop.default
        if (prop.type === "array") {
          var picked = askChooseMultiple(label + ": ", field.labels, 12)
          if (!isArray(picked)) throw new Error("cancelled")
          values[key] = picked.map(function(item) { return isNumber(item) ? field.choices[item] : field.choices[field.labels.indexOf(item)] })
        } else if (isDef(field.choices)) {
          var labels = field.labels.slice()
          if (!isReq) labels.push("(skip)")
          var selected = normalizeChoiceIndex(askChoose(label + ": ", labels, 12), labels.length)
          if (selected < 0) throw new Error("cancelled")
          if (selected < field.choices.length) values[key] = field.choices[selected]
          else delete values[key]
        } else {
          var raw = ask(label + (isDef(initial) ? " [" + initial + "]" : "") + ": ")
          if (raw === "" && isDef(initial)) raw = String(initial)
          if (raw === "") delete values[key]
          else if (prop.type === "string") values[key] = raw
          else if (isNaN(Number(raw))) {
            print(ansiColor("FG(196)", "!! Not a number: " + raw))
            delete values[key]
          } else values[key] = Number(raw)
        }
      })
      var missing = required.filter(function(key) { return isUnDef(values[key]) })
      print(ansiColor("FAINT", "Response: ") + af.toCSLON(values) + (missing.length > 0 ? ansiColor("FG(196)", "  Missing: " + missing.join(", ")) : ""))
      var choices = missing.length > 0 ? ["Edit", "Decline", "Cancel"] : ["Submit", "Edit", "Decline", "Cancel"]
      var review = choices[normalizeChoiceIndex(askChoose("Review response: ", choices), choices.length)]
      if (review === "Submit") return { action: "accept", content: values }
      if (review === "Edit") continue
      return { action: review === "Decline" ? "decline" : "cancel" }
    }
  } catch(e) {
    print(ansiColor("FG(196)", "!! Input request ended: " + __miniAMcpLabel(e.message)))
    return { action: "cancel" }
  }
}

// Follow a task handle until it reaches a terminal state, answering any input it requests.
function pollMCPTask(client, handle, sessionOptions) {
  if (!isFunction(client.getTask)) {
    print(ansiColor("FG(196)", "!! This OpenAF runtime cannot follow tasks (no getTask). Handle: ") + af.toCSLON(handle))
    return handle
  }
  var taskId = handle.taskId
  var next = handle
  var status
  var expires = Infinity
  var failures = 0
  var sent = {}
  print(ansiColor("FG(248)", "⏳ Task " + taskId + " started"))
  while (true) {
    if (now() >= expires) return __miniAMcpFailure("MCP task expired before a terminal result was available.")
    if (isUnDef(next) || next.resultType === "task" && next.status !== "working") {
      try {
        next = client.getTask(taskId)
      } catch(e) {
        if (++failures >= 3) return __miniAMcpFailure("MCP task could not be reached: " + __miniAMcpLabel(e.message))
        sleep(250 * failures)
        continue
      }
      failures = 0
    }
    if (!isMap(next) || next.taskId !== taskId) return __miniAMcpFailure("MCP task returned an invalid status or is inaccessible.")
    if (isNumber(next.ttlMs) && next.ttlMs >= 0) expires = now() + next.ttlMs
    if (next.status !== status) {
      status = next.status
      print(ansiColor("FG(248)", "   status: ") + status + (next.statusMessage ? " · " + __miniAMcpLabel(next.statusMessage) : ""))
    }
    if (status === "completed" && isMap(next.result)) return next.result
    if (status === "failed") return __miniAMcpFailure("MCP task failed" + (isMap(next.error) && isNumber(next.error.code) ? " (code " + next.error.code + ")" : "") + ".")
    if (status === "cancelled") return __miniAMcpFailure("MCP task was cancelled.")
    if (status !== "working" && status !== "input_required") return __miniAMcpFailure("MCP task returned an unsupported status: " + status)
    if (status === "input_required" && isMap(next.inputRequests)) {
      var responses = {}
      Object.keys(next.inputRequests).forEach(function(key) {
        if (sent[key]) return
        var request = next.inputRequests[key]
        responses[key] = isMap(request) && request.method === "elicitation/create" ? testerElicitationHandler(request.params, sessionOptions) : { action: "cancel" }
        sent[key] = true
      })
      if (Object.keys(responses).length > 0) {
        if (isFunction(client.updateTask)) {
          try { client.updateTask(taskId, responses) } catch(e) { print(ansiColor("FG(196)", "!! Task input update failed: " + __miniAMcpLabel(e.message))) }
        } else print(ansiColor("FG(196)", "!! This runtime lacks updateTask; the task input could not be sent."))
      }
    }
    if (sessionOptions.taskprompt === true) {
      var step = normalizeChoiceIndex(askChoose("Task " + taskId + " is " + status + ".", ["Keep waiting", "Cancel task"]), 2)
      if (step !== 0) {
        if (isFunction(client.cancelTask)) {
          try { client.cancelTask(taskId); print("🛑 Cancellation requested.") } catch(e) { print(ansiColor("FG(196)", "!! Cancel failed: " + __miniAMcpLabel(e.message))) }
        } else print(ansiColor("FG(196)", "!! This runtime lacks cancelTask."))
        if (step < 0 || step === 1) { next = __; sleep(250); continue }
      }
    }
    var interval = isNumber(next.pollIntervalMs) && next.pollIntervalMs > 0 ? next.pollIntervalMs : 1000
    if (sessionOptions.taskpollms > 0) interval = sessionOptions.taskpollms
    sleep(Math.min(interval, Math.max(1, expires - now())))
    next = __
  }
}

// Continue input_required results and follow task handles after a tool call.
function resolveMCPResult(client, tool, params, result, sessionOptions) {
  var rounds = 0
  while (isMap(result) && result.resultType === "input_required") {
    if (++rounds > 16) return __miniAMcpFailure("Server kept requesting input after 16 rounds.")
    if (!isFunction(client.continueRequest)) {
      print(ansiColor("FG(196)", "!! The server needs input but this runtime lacks continueRequest."))
      return result
    }
    print(ansiColor("FG(248)", "↪ Server requested input (round " + rounds + ")"))
    try {
      result = client.continueRequest("tools/call", { name: tool.name, arguments: params }, result)
    } catch(e) {
      return __miniAMcpFailure("Continuation failed: " + __miniAMcpLabel(e.message))
    }
  }
  if (isMap(result) && result.resultType === "task") result = pollMCPTask(client, result, sessionOptions)
  return result
}

// Extract a list from a client reply that is either an array or a map holding it.
function mcpListOf(reply, key) {
  if (isArray(reply)) return reply
  return isMap(reply) && isArray(reply[key]) ? reply[key] : []
}

// Print text content, summarizing binary blobs.
function printMCPContents(response) {
  var contents = isMap(response) && isArray(response.contents) ? response.contents : []
  if (contents.length === 0) print(ansiColor("FAINT", "(no contents)"))
  contents.forEach(function(item) {
    print(ansiColor("FAINT", (item.uri || "") + (item.mimeType ? " · " + item.mimeType : "")))
    if (isString(item.text)) print(item.text)
    else if (isString(item.blob)) print(ansiColor("FAINT", "(binary content, " + item.blob.length + " base64 characters)"))
  })
}

// Verify every file of one skill against its manifest digests and sizes.
function verifyMCPSkill(client, entry) {
  var report = { name: isMap(entry.frontmatter) ? entry.frontmatter.name : "", uri: entry.uri, ok: true, files: 0, failures: [] }
  var verified
  try {
    verified = __miniAMcpVerifySkillManifest(entry)
  } catch(e) {
    report.ok = false
    report.failures.push("manifest: " + e.message)
    return report
  }
  Object.keys(verified.files).forEach(function(uri) {
    report.files++
    try {
      var response = client.readResource(uri)
      var resource = isMap(response) && isArray(response.contents) && response.contents.length === 1 ? response.contents[0] : __
      var text = __miniAMcpVerifySkillResource(verified.files[uri], resource, uri)
      if (uri === entry.uri) __miniAMcpCheckSkillFrontmatter(entry, report.name, text)
    } catch(e) {
      report.ok = false
      report.failures.push(uri + ": " + e.message)
    }
  })
  return report
}

// Interactive skills browser.
function skillsMenu(client, sessionOptions) {
  if (!isFunction(client.listSkills)) {
    print(ansiColor("FG(196)", "!! This OpenAF runtime lacks listSkills.") + "\n")
    return
  }
  var entries
  try {
    entries = mcpListOf(client.listSkills(), "skills")
  } catch(e) {
    print(ansiColor("FG(196)", "!! Failed to list skills: " + __miniAMcpLabel(e.message)) + "\n")
    return
  }
  if (entries.length === 0) {
    print("\n📭 No skills published by this server.\n")
    return
  }
  while (true) {
    var names = entries.map(function(entry) {
      var meta = isMap(entry.frontmatter) ? entry.frontmatter : {}
      return __miniAMcpLabel(meta.name || entry.uri) + (meta.description ? " — " + __miniAMcpLabel(meta.description).substring(0, 70) : "")
    })
    var index = chooseMCPItem("Choose a skill: ", names, sessionOptions.toolchoosesize)
    if (index < 0) return
    var entry = entries[index]
    var meta = isMap(entry.frontmatter) ? entry.frontmatter : {}
    print("\n" + ansiColor("BOLD,FG(41)", "Skill: " + __miniAMcpLabel(meta.name)))
    print(ansiColor("FG(248)", "URI: ") + entry.uri + ansiColor("FG(248)", "  Files: ") + (isArray(entry.resources) ? entry.resources.length : 0) +
      (toBoolean(meta["disable-model-invocation"]) === true ? ansiColor("FG(248)", "  (model invocation disabled)") : ""))
    var action = normalizeChoiceIndex(askChoose("Skill action: ", ["✅ Verify all files", "📖 Read SKILL.md", "📎 Read a reference", "🔙 Back"]), 4)
    if (action === 0) {
      var report = verifyMCPSkill(client, entry)
      print(report.ok ? ansiColor("FG(82)", "✅ " + report.files + " file(s) verified") : ansiColor("FG(196)", "!! Verification failed"))
      report.failures.forEach(function(failure) { print("   " + ansiColor("FG(196)", failure)) })
      print()
    } else if (action === 1) {
      try { printMCPContents(client.readResource(entry.uri)) } catch(e) { print(ansiColor("FG(196)", "!! " + __miniAMcpLabel(e.message))) }
      print()
    } else if (action === 2) {
      var refs = (isArray(entry.resources) ? entry.resources : []).map(function(file) { return file.uri }).filter(function(uri) { return uri !== entry.uri })
      var refIndex = chooseMCPItem("Choose a reference: ", refs, 12)
      if (refIndex >= 0) {
        try { printMCPContents(client.readResource(refs[refIndex])) } catch(e) { print(ansiColor("FG(196)", "!! " + __miniAMcpLabel(e.message))) }
        print()
      }
    }
  }
}

// Interactive resources browser.
function resourcesMenu(client, sessionOptions) {
  if (!isFunction(client.listResources)) {
    print(ansiColor("FG(196)", "!! This OpenAF runtime lacks listResources.") + "\n")
    return
  }
  try {
    var resources = mcpListOf(client.listResources(), "resources")
    var templates = isFunction(client.listResourceTemplates) ? mcpListOf(client.listResourceTemplates(), "resourceTemplates") : []
    if (resources.length === 0 && templates.length === 0) {
      print("\n📭 No resources published by this server.\n")
      return
    }
    templates.forEach(function(template) {
      print(ansiColor("FAINT", "template: " + (template.uriTemplate || "") + (template.name ? " (" + template.name + ")" : "")))
    })
    var index = chooseMCPItem("Choose a resource to read: ", resources.map(function(item) { return item.name ? item.name + " — " + item.uri : item.uri }), sessionOptions.toolchoosesize)
    if (index >= 0) {
      printMCPContents(client.readResource(resources[index].uri))
      print()
    }
  } catch(e) {
    print(ansiColor("FG(196)", "!! Resources failed: " + __miniAMcpLabel(e.message)) + "\n")
  }
}

// Interactive prompts browser.
function promptsMenu(client, sessionOptions) {
  if (!isFunction(client.listPrompts)) {
    print(ansiColor("FG(196)", "!! This OpenAF runtime lacks listPrompts.") + "\n")
    return
  }
  try {
    var prompts = mcpListOf(client.listPrompts(), "prompts")
    if (prompts.length === 0) {
      print("\n📭 No prompts published by this server.\n")
      return
    }
    var index = chooseMCPItem("Choose a prompt: ", prompts.map(function(item) { return item.name + (item.description ? " — " + __miniAMcpLabel(item.description).substring(0, 70) : "") }), sessionOptions.toolchoosesize)
    if (index < 0) return
    var promptArgs = {}
    ;(isArray(prompts[index].arguments) ? prompts[index].arguments : []).forEach(function(argument) {
      var value = ask(argument.name + (argument.required ? " *" : "") + (argument.description ? " (" + __miniAMcpLabel(argument.description) + ")" : "") + ": ")
      if (value !== "") promptArgs[argument.name] = value
    })
    print(printTree(client.getPrompt(prompts[index].name, promptArgs)))
    print()
  } catch(e) {
    print(ansiColor("FG(196)", "!! Prompts failed: " + __miniAMcpLabel(e.message)) + "\n")
  }
}

// Look up, list or cancel tasks by ID.
function tasksMenu(client) {
  if (!isFunction(client.getTask)) {
    print(ansiColor("FG(196)", "!! This OpenAF runtime lacks getTask.") + "\n")
    return
  }
  var action = normalizeChoiceIndex(askChoose("Tasks: ", ["🔎 Get task status", "📜 List tasks", "🛑 Cancel task", "🔙 Back"]), 4)
  try {
    if (action === 0 || action === 2) {
      var id = ask("Task ID: ")
      if (isUnDef(id) || id.trim() === "") return
      if (action === 0) print(printTree(client.getTask(id.trim())))
      else if (isFunction(client.cancelTask)) print(printTree(client.cancelTask(id.trim())))
      else print(ansiColor("FG(196)", "!! This runtime lacks cancelTask."))
    } else if (action === 1) {
      if (isFunction(client.listTasks)) print(printTree(client.listTasks()))
      else print(ansiColor("FG(196)", "!! This runtime lacks listTasks."))
    }
  } catch(e) {
    print(ansiColor("FG(196)", "!! Task request failed: " + __miniAMcpLabel(e.message)))
  }
  print()
}

// Build the non-interactive report for a connected client.
function buildMCPReport(client, config) {
  var info = mcpFeatureRows(client)
  var report = { server: isString(info.server.name) ? __miniAMcpLabel(info.server.name) : "", protocol: info.version, ok: true, features: {}, counts: {}, skills: [] }
  info.rows.forEach(function(row) { report.features[row.feature] = row.state })
  function count(key, fn, listKey) {
    try { report.counts[key] = mcpListOf(fn(), listKey).length } catch(e) { report.counts[key] = "unavailable: " + __miniAMcpLabel(e.message) }
  }
  count("tools", function() { return client.listTools() }, "tools")
  var caps = isFunction(client.getCapabilities) ? client.getCapabilities() : {}
  if (isFunction(client.listResources) && isMap(caps.resources)) count("resources", function() { return client.listResources() }, "resources")
  if (isFunction(client.listPrompts) && isMap(caps.prompts)) count("prompts", function() { return client.listPrompts() }, "prompts")
  if (isFunction(client.listSkills)) {
    try {
      var entries = mcpListOf(client.listSkills(), "skills")
      report.counts.skills = entries.length
      entries.forEach(function(entry) {
        var result = verifyMCPSkill(client, entry)
        report.skills.push(result)
        if (!result.ok) report.ok = false
      })
    } catch(e) {
      report.counts.skills = "unavailable: " + __miniAMcpLabel(e.message)
    }
  }
  return report
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
        showlimitcallanswer: { type: "number", default: 0, description: "Limit the printed string length of call tool results (0 = no limit)" },
        taskpollms: { type: "number", default: 0, description: "Override the task polling interval in milliseconds (0 = use the server's pollIntervalMs)" },
        taskprompt: { type: "boolean", default: false, description: "Ask whether to keep waiting or cancel at every task poll" },
        autoacceptelicitation: { type: "boolean", default: false, description: "Answer server input requests with the schema defaults without prompting (for tests)" }
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
                    if (isDef(_currentConfigRaw)) _currentConfigRaw.debug = true
                } else {
                    _currentConfig.debug = false
                    if (isDef(_currentConfigRaw)) _currentConfigRaw.debug = false
                }
                print("🔌 Connecting to MCP server: " + summarizeMCPConfig(_currentConfig))
                _mcpClient = connectMCP(_currentConfig, sessionOptions).client
                print("✅ Connected successfully!\n")
            } catch(e) {
                print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Connection failed: " + mcpConnectionError(e), errorColor) + "\n")
                _mcpClient = __
                _currentConfig = __
                _currentConfigRaw = __
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
                    if (isDef(_currentConfigRaw)) _currentConfigRaw.debug = true
                } else {
                    _currentConfig.debug = false
                    if (isDef(_currentConfigRaw)) _currentConfigRaw.debug = false
                }
                print("🔌 Connecting to MCP server: " + summarizeMCPConfig(_currentConfig))
                _mcpClient = connectMCP(_currentConfig, sessionOptions).client
                print("✅ Connected successfully!\n")
            } catch(e) {
                print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Connection failed: " + mcpConnectionError(e), errorColor) + "\n")
                _mcpClient = __
                _currentConfig = __
                _currentConfigRaw = __
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
    if (toBoolean(args.mcptestreport) !== true) {
        print(ansiColor("BOLD", miniaLogo) + ansiColor(accentColor, " MCP Tester"))
        print()
    }

    var _shouldExit = false
    var _mcpClient = __
    var _currentConfig = __
    var _currentConfigRaw = __ // config as provided, before $mcp() fills in its defaults in-place

    addOnOpenAFShutdown(() => {
        if (isDef(_mcpClient)) {
            try {
                _mcpClient.destroy()
            } catch(e) {}
        }
    })

    // Non-interactive report mode: connect, print the report and exit with a status code
    if (toBoolean(args.mcptestreport) === true) {
        sessionOptions.__noninteractive = true
        var _reportOk = false
        try {
            if (isUnDef(args.mcp)) throw new Error("mcptestreport=true requires mcp=<config>")
            var _reportConfig = isString(args.mcp) ? af.fromJSSLON(args.mcp) : args.mcp
            if (isArray(_reportConfig)) {
                if (_reportConfig.length !== 1) throw new Error("mcptestreport=true needs exactly one MCP connection")
                _reportConfig = _reportConfig[0]
            }
            var _reportConn = connectMCP(_reportConfig, sessionOptions)
            _mcpClient = _reportConn.client
            var _report = buildMCPReport(_mcpClient, _reportConn.config)
            _reportOk = _report.ok
            $o(_report, { __format: args.format || args.__format || "cyaml" })
        } catch(e) {
            print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Report failed: " + mcpConnectionError(e), errorColor))
        }
        try { if (isDef(_mcpClient)) _mcpClient.destroy() } catch(ignoreClose) {}
        global.__miniAMcpTestExitCode = _reportOk ? 0 : 1
        return
    }

    // Check if mcp parameter was provided
    if (isDef(args.mcp)) {
        var config = __
        try {
            config = normalizeMCPConfigInput(args.mcp)

            if (isDef(config)) {
                if (sessionOptions.debug) {
                    config.debug = true
                } else {
                    config.debug = false
                }
                print("🔌 Connecting to MCP server from mcp= parameter: " + summarizeMCPConfig(config))
                var _conn = connectMCP(config, sessionOptions)
                _mcpClient = _conn.client
                _currentConfig = _conn.config
                _currentConfigRaw = _conn.raw
                print("✅ Connected successfully!\n")
                printMCPCapabilities(_mcpClient)
            }
        } catch(e) {
            print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Connection failed: " + mcpConnectionError(e), errorColor) + "\n")
            _mcpClient = __
            _currentConfig = __
            _currentConfigRaw = __
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
                "🖥️  Show MCP server info",
                "🧭 Show capabilities",
                "⏳ Tasks",
                "🧩 Skills",
                "📚 Resources",
                "💬 Prompts",
                "🔧 Call a tool",
                "🔍 Show tool details",
                "🔤 Show mcp= parameter string",
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

        var _action = normalizeChoiceIndex(askChoose(statusMsg, _options, _options.length), _options.length - 1)
        if (_action < 0) _action = _options.length - 1

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
                    _currentConfigRaw = __
                }

                var config = buildMCPConfig(args)
                if (isDef(config)) {
                    config = merge(config, { debug: sessionOptions.debug })
                    print("\n🔌 Connecting to MCP server: " + summarizeMCPConfig(config))
                    try {
                        var _conn2 = connectMCP(config, sessionOptions)
                        _mcpClient = _conn2.client
                        _currentConfig = _conn2.config
                        _currentConfigRaw = _conn2.raw
                        print("✅ Connected successfully!\n")
                        printMCPCapabilities(_mcpClient)
                    } catch(e) {
                        print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" Connection failed: " + mcpConnectionError(e), errorColor) + "\n")
                        _mcpClient = __
                        _currentConfig = __
                        _currentConfigRaw = __
                    }
                }
            } else if (optionText.indexOf("List tools") >= 0) {
                if (isUnDef(_mcpClient)) {
                    print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" No MCP connection. Please create a new connection first.", errorColor) + "\n")
                } else {
                    listMCPTools(_mcpClient, sessionOptions.showtimeelapsed)
                }
            } else if (optionText.indexOf("Show MCP server info") >= 0) {
                if (isUnDef(_mcpClient)) {
                    print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" No MCP connection. Please create a new connection first.", errorColor) + "\n")
                } else {
                    showMCPServerInfo(_mcpClient, sessionOptions.showtimeelapsed)
                }
            } else if (optionText.indexOf("Show capabilities") >= 0) {
                printMCPCapabilities(_mcpClient)
            } else if (optionText.indexOf("Tasks") >= 0) {
                tasksMenu(_mcpClient)
            } else if (optionText.indexOf("Skills") >= 0) {
                skillsMenu(_mcpClient, sessionOptions)
            } else if (optionText.indexOf("Resources") >= 0) {
                resourcesMenu(_mcpClient, sessionOptions)
            } else if (optionText.indexOf("Prompts") >= 0) {
                promptsMenu(_mcpClient, sessionOptions)
            } else if (optionText.indexOf("Call a tool") >= 0) {
                if (isUnDef(_mcpClient)) {
                    print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" No MCP connection. Please create a new connection first.", errorColor) + "\n")
                } else {
                    var startTime = now()
                    var tools = _mcpClient.listTools()
                    if (sessionOptions.showtimeelapsed) {
                        printElapsedTime(startTime, "List tools")
                    }
                    if (isUnDef(tools) || isUnDef(tools.tools) || tools.tools.length == 0) {
                        print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" No tools available.", errorColor) + "\n")
                    } else {
                        tools = tools.tools
                        var toolNames = tools.map(t => t.name).sort().concat(["🔙 Cancel"])
                        var toolIdx = normalizeChoiceIndex(askChoose("Choose a tool to call: ", toolNames, sessionOptions.toolchoosesize), tools.length)

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
                    if (isUnDef(tools) || isUnDef(tools.tools) || tools.tools.length == 0) {
                        print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" No tools available.", errorColor) + "\n")
                    } else {
                        tools = tools.tools
                        var toolNames = tools.map(t => t.name).sort().concat(["🔙 Cancel"])
                        var toolIdx = normalizeChoiceIndex(askChoose("Choose a tool to inspect: ", toolNames, sessionOptions.toolchoosesize), tools.length)

                        if (toolIdx < tools.length) {
                            showToolDetails(tools.filter(t => t.name == toolNames[toolIdx])[0])
                        }
                    }
                }
            } else if (optionText.indexOf("Show mcp= parameter string") >= 0) {
                if (isUnDef(_currentConfigRaw)) {
                    print(ansiColor("ITALIC," + errorColor, "!!") + colorifyText(" No MCP configuration available yet. Please create a new connection first.", errorColor) + "\n")
                } else {
                    print("\n" + ansiColor("FAINT", "-----\nUse the following command-line parameter to reconnect to this MCP server:") + "\n")
                    showMCPParameter(_currentConfigRaw)
                    print(ansiColor("FAINT", "-----") + "\n")
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
                    _currentConfigRaw = __
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

                    var optionIdx = normalizeChoiceIndex(askChoose("Choose an option to toggle: ", optionChoices), optionKeys.length)

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

                    var setOptionIdx = normalizeChoiceIndex(askChoose("Choose an option to set: ", allOptionChoices), allOptionKeys.length)

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

// Run the main tester (tests set __miniAMcpTestNoMain to call the functions directly)
if (!global.__miniAMcpTestNoMain) mainMCPTest(args)
