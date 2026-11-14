// Resolve dependencies from this package before loading other modules.
if (typeof __miniAPath !== "function") loadLib(String(new java.io.File(String(__loadedfrom)).getCanonicalFile().getParentFile().getParent()) + "/mini-a-paths.js")

// Author: Nuno Aguiar
// License: Apache 2.0
// Description: Agent Plugins (agent-plugins.org 1.0.0) discovery and adapter layer for Mini-A.
//
// Consumes third-party/user-downloaded Agent Plugins directories (plugin.json + skills/ + mcp.json)
// and turns them into inputs the existing skills and $mcp machinery already understand:
// plugin skills/ directories are just appended to the skills-root list (no new skill parsing),
// and mcp.json server entries are converted into plain $mcp config maps.
//
// Validation is hand-rolled (not ajv/ow.obj.schemaCompile) on purpose: the surface is small
// (a handful of fields, three MCP transport shapes) and hand-rolled checks give precise,
// per-field warnings without the draft-07 schema-translation and oneOf-error-message pitfalls
// that come with reusing the published JSON Schemas verbatim.
//
// Resilience follows the spec: a bad plugin.json drops only that plugin, a bad mcp.json drops
// only that plugin's MCP surface (skills still load), and a bad individual mcpServers entry
// drops only that entry. Unknown top-level plugin.json fields are intentionally NOT rejected
// (forward-compat with future minor spec versions), even though the published schema is closed.

var __MINI_A_PLUGIN_SCHEMA_ID = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"
var __MINI_A_PLUGIN_MCP_SCHEMA_ID = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json"
var __MINI_A_PLUGIN_NAME_PATTERN = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/

loadLib(__miniAPath("js/core/mini-a-common.js"))

function __miniAPluginExpandHomePath(pathValue) {
  if (!(isString(pathValue) || pathValue instanceof java.lang.String)) return pathValue
  pathValue = String(pathValue)
  if (pathValue === "~") return String(java.lang.System.getProperty("user.home"))
  if (pathValue.indexOf("~/") === 0 || pathValue.indexOf("~\\") === 0) {
    var home = java.lang.System.getProperty("user.home")
    if (isString(home) && home.length > 0) return home + pathValue.substring(1)
  }
  return pathValue
}

function __miniAPluginSplitDirList(value) {
  if (isArray(value)) {
    return value.filter(function(v) { return isString(v) || v instanceof java.lang.String })
      .map(function(v) { return String(v).trim() })
      .filter(function(v) { return v.length > 0 })
  }
  if (isString(value) || value instanceof java.lang.String) {
    return String(value).split(",").map(function(v) { return v.trim() }).filter(function(v) { return v.length > 0 })
  }
  return []
}

// Priority: an explicit options.homedir (lets tests/callers redirect without the global
// __gHDir side effect) > the __gHDir() override mini-a-con.js sets from a homedir= CLI arg
// > the JVM's user.home.
function __miniAPluginBaseHomeDir(options) {
  options = isMap(options) ? options : {}
  if ((isString(options.homedir) || options.homedir instanceof java.lang.String) && String(options.homedir).trim().length > 0) {
    return String(options.homedir).trim()
  }
  var gBase = __
  if (typeof __gHDir === "function") {
    try {
      var g = __gHDir()
      if (isString(g) || g instanceof java.lang.String) gBase = String(g)
    } catch (ignoreGHDirError) {}
  }
  if (isString(gBase) && gBase.length > 0) return gBase
  var userHome = java.lang.System.getProperty("user.home")
  return (isString(userHome) || userHome instanceof java.lang.String) ? String(userHome) : "."
}

// __miniAPluginResolveExplicit: each entry in options.plugins IS a plugin directory.
function __miniAPluginResolveExplicit(options) {
  options = isMap(options) ? options : {}
  var roots = []
  var seen = {}
  __miniAPluginSplitDirList(options.plugins).forEach(function(d) {
    var expanded = __miniAPluginExpandHomePath(d)
    var canonical
    try { canonical = String(new java.io.File(expanded).getCanonicalPath()) } catch (e) { return }
    if (seen[canonical]) return
    seen[canonical] = true
    roots.push(canonical)
  })
  return roots
}

// __miniAPluginResolveRoots: each entry in options.pluginsroot/pluginsroots CONTAINS plugin subfolders.
function __miniAPluginResolveRoots(options) {
  options = isMap(options) ? options : {}
  var roots = []
  var seen = {}
  var addRoot = function(pathValue) {
    var expanded = __miniAPluginExpandHomePath(pathValue)
    var canonical
    try { canonical = String(new java.io.File(expanded).getCanonicalPath()) } catch (e) { return }
    if (seen[canonical]) return
    if (!io.fileExists(canonical)) return
    var info = io.fileInfo(canonical)
    if (isUnDef(info) || info.isDirectory !== true) return
    seen[canonical] = true
    roots.push(canonical)
  }

  __miniAPluginSplitDirList(options.pluginsroot).forEach(addRoot)
  __miniAPluginSplitDirList(options.pluginsroots).forEach(addRoot)

  if (roots.length === 0) {
    addRoot(__miniAPluginBaseHomeDir(options) + java.io.File.separator + ".openaf-mini-a" + java.io.File.separator + "plugins")
  }
  return roots
}

function __miniAPluginDataDir(pluginName, options) {
  var dataRoot = __miniAPluginBaseHomeDir(options) + java.io.File.separator + ".openaf-mini-a" + java.io.File.separator + "plugin-data"
  if (options.inspect !== true && !io.fileExists(dataRoot)) io.mkdir(dataRoot)
  var pluginDataDir = dataRoot + java.io.File.separator + pluginName
  if (options.inspect !== true && !io.fileExists(pluginDataDir)) io.mkdir(pluginDataDir)
  return String(new java.io.File(pluginDataDir).getCanonicalPath())
}

function __miniAPluginValidateManifest(parsed) {
  if (!isMap(parsed)) return { ok: false, error: "plugin.json must be a JSON object" }
  if (parsed.$schema !== __MINI_A_PLUGIN_SCHEMA_ID) {
    return { ok: false, error: "plugin.json '$schema' must be '" + __MINI_A_PLUGIN_SCHEMA_ID + "'" }
  }
  if (!isString(parsed.name) || parsed.name.length < 1 || parsed.name.length > 64 || !__MINI_A_PLUGIN_NAME_PATTERN.test(parsed.name)) {
    return { ok: false, error: "plugin.json 'name' is missing or invalid" }
  }
  if (isDef(parsed.version) && !isString(parsed.version)) return { ok: false, error: "plugin.json 'version' must be a string" }
  if (isDef(parsed.description) && !isString(parsed.description)) return { ok: false, error: "plugin.json 'description' must be a string" }
  if (isDef(parsed.author)) {
    if (!isMap(parsed.author)) return { ok: false, error: "plugin.json 'author' must be an object" }
    var authorAllowed = { name: 1, email: 1, url: 1 }
    var authorExtra = Object.keys(parsed.author).filter(function(k) { return !authorAllowed[k] })
    if (authorExtra.length > 0) return { ok: false, error: "plugin.json 'author' has unexpected field(s): " + authorExtra.join(",") }
    if (Object.keys(parsed.author).some(function(k) { return !isString(parsed.author[k]) })) {
      return { ok: false, error: "plugin.json 'author' fields must be strings" }
    }
  }
  if (isDef(parsed.homepage) && !isString(parsed.homepage)) return { ok: false, error: "plugin.json 'homepage' must be a string" }
  if (isDef(parsed.repository) && !isString(parsed.repository)) return { ok: false, error: "plugin.json 'repository' must be a string" }
  if (isDef(parsed.license) && !isString(parsed.license)) return { ok: false, error: "plugin.json 'license' must be a string" }
  if (isDef(parsed.keywords)) {
    if (!isArray(parsed.keywords) || parsed.keywords.some(function(k) { return !isString(k) })) {
      return { ok: false, error: "plugin.json 'keywords' must be an array of strings" }
    }
  }
  if (isDef(parsed.extensions)) {
    if (!isMap(parsed.extensions) || Object.keys(parsed.extensions).some(function(k) { return !isMap(parsed.extensions[k]) })) {
      return { ok: false, error: "plugin.json 'extensions' must be an object of objects" }
    }
  }
  // Unknown top-level keys beyond the ones checked above are deliberately NOT rejected
  // (forward-compat with future Agent Plugins minor versions - see module doc comment).
  return { ok: true }
}

function __miniAPluginValidateMcpServerEntry(entry) {
  if (!isMap(entry)) return { ok: false, error: "must be an object" }
  var type = entry.type
  if (type !== "stdio" && type !== "streamable-http" && type !== "sse") {
    return { ok: false, error: "unsupported or missing 'type' (expected stdio, streamable-http, or sse): " + String(type) }
  }
  if (type === "stdio") {
    var allowed = { type: 1, command: 1, args: 1, env: 1, cwd: 1 }
    var extra = Object.keys(entry).filter(function(k) { return !allowed[k] })
    if (extra.length > 0) return { ok: false, error: "unexpected field(s) for stdio: " + extra.join(",") }
    if (!isString(entry.command) || entry.command.trim().length === 0) return { ok: false, error: "'command' is required and must be a non-empty string" }
    if (isDef(entry.args) && (!isArray(entry.args) || entry.args.some(function(a) { return !isString(a) }))) {
      return { ok: false, error: "'args' must be an array of strings" }
    }
    if (isDef(entry.env)) {
      if (!isMap(entry.env)) return { ok: false, error: "'env' must be an object of strings" }
      var badKey = Object.keys(entry.env).filter(function(k) { return k === "PLUGIN_ROOT" || k === "PLUGIN_DATA" })
      if (badKey.length > 0) return { ok: false, error: "'env' must not declare reserved key(s): " + badKey.join(",") }
      if (Object.keys(entry.env).some(function(k) { return !isString(entry.env[k]) })) {
        return { ok: false, error: "'env' values must be strings" }
      }
    }
    if (isDef(entry.cwd) && (!isString(entry.cwd) || !/^(?:\.\/|\$\{PLUGIN_ROOT\}(?:\/|$)|\$\{PLUGIN_DATA\}(?:\/|$))/.test(entry.cwd))) {
      return { ok: false, error: "'cwd' must start with './', '${PLUGIN_ROOT}', or '${PLUGIN_DATA}'" }
    }
    return { ok: true, type: "stdio" }
  }

  var allowedHttp = { type: 1, url: 1, headers: 1 }
  var extraHttp = Object.keys(entry).filter(function(k) { return !allowedHttp[k] })
  if (extraHttp.length > 0) return { ok: false, error: "unexpected field(s) for " + type + ": " + extraHttp.join(",") }
  if (!isString(entry.url) || entry.url.trim().length === 0) return { ok: false, error: "'url' is required and must be a non-empty string" }
  if (isDef(entry.headers) && !isMap(entry.headers)) return { ok: false, error: "'headers' must be an object of strings" }
  return { ok: true, type: type }
}

// Non-recursive: only the two reserved placeholders are ever substituted, anything else
// (including an unrecognized ${...} token) is left untouched by construction.
function __miniAPluginExpandPlaceholders(value, ctx) {
  if (!isString(value)) return value
  return value.replace(/\$\{PLUGIN_ROOT\}/g, ctx.pluginRoot).replace(/\$\{PLUGIN_DATA\}/g, ctx.pluginData)
}

function __miniAPluginResolveContained(baseCanonical, relPath) {
  var sep = String(java.io.File.separator)
  var baseCanon
  try { baseCanon = String(new java.io.File(baseCanonical).getCanonicalPath()) } catch (e) { return { ok: false, error: "invalid base path" } }
  var basePrefix = baseCanon.endsWith(sep) ? baseCanon : baseCanon + sep
  var candidateFile = (isString(relPath) && relPath.length > 0) ? new java.io.File(baseCanonical, relPath) : new java.io.File(baseCanonical)
  var canonical
  try { canonical = String(candidateFile.getCanonicalPath()) } catch (e2) { return { ok: false, error: "invalid path" } }
  if (canonical !== baseCanon && canonical.indexOf(basePrefix) !== 0) {
    return { ok: false, error: "path escapes plugin boundary" }
  }
  return { ok: true, path: canonical }
}

// Contains cwd against the base matching the placeholder it actually used:
// './'/'${PLUGIN_ROOT}'-relative cwd is contained against pluginRoot, '${PLUGIN_DATA}'-relative against pluginData.
function __miniAPluginResolveCwd(entryCwd, pluginRootCanonical, pluginDataCanonical) {
  var raw = String(entryCwd).trim()
  var base, rel
  if (raw.indexOf("${PLUGIN_DATA}") === 0) {
    base = pluginDataCanonical
    rel = raw.substring("${PLUGIN_DATA}".length).replace(/^[\/\\]+/, "")
  } else if (raw.indexOf("${PLUGIN_ROOT}") === 0) {
    base = pluginRootCanonical
    rel = raw.substring("${PLUGIN_ROOT}".length).replace(/^[\/\\]+/, "")
  } else if (raw.indexOf("./") === 0) {
    base = pluginRootCanonical
    rel = raw.substring(2)
  } else {
    return { ok: false, error: "'cwd' must start with './', '${PLUGIN_ROOT}', or '${PLUGIN_DATA}'" }
  }
  return __miniAPluginResolveContained(base, rel)
}

function __miniAPluginConvertMcpServerEntry(pluginRootCanonical, pluginName, serverName, entry, options) {
  var label = "plugin '" + pluginName + "': mcp server '" + serverName + "'"
  var v = __miniAPluginValidateMcpServerEntry(entry)
  if (!v.ok) return { ok: false, warning: label + ": " + v.error }

  var id = "plugin:" + pluginName + ":" + serverName

  if (v.type === "stdio") {
    var command = entry.command.trim()
    if (/\s/.test(command) || /[;&|`$()<>]/.test(command)) {
      return { ok: false, warning: label + ": command must be a single executable token (no shell metacharacters); declare extra arguments via 'args'" }
    }
    if (command.indexOf("/") >= 0 && command.indexOf("./") !== 0) {
      return { ok: false, warning: label + ": command must be a bare executable name or a './'-relative path" }
    }

    // A './'-relative command is always plugin-root-relative, regardless of the
    // configured 'cwd' (cwd is an independent, separately-specifiable field - the
    // spawned process's working directory need not be the plugin root at all).
    if (command.indexOf("./") === 0) {
      var commandRes = __miniAPluginResolveContained(pluginRootCanonical, command.substring(2))
      if (!commandRes.ok) return { ok: false, warning: label + ": " + commandRes.error }
      command = commandRes.path
    }

    var pluginDataCanonical = __miniAPluginDataDir(pluginName, options)
    var ctx = { pluginRoot: pluginRootCanonical, pluginData: pluginDataCanonical }

    var expandedArgs = (isArray(entry.args) ? entry.args : []).map(function(a) {
      return __miniAPluginExpandPlaceholders(String(a), ctx)
    })

    var expandedEnv = {}
    if (isMap(entry.env)) {
      Object.keys(entry.env).forEach(function(k) {
        expandedEnv[k] = __miniAPluginExpandPlaceholders(String(entry.env[k]), ctx)
      })
    }

    var resolvedCwd = pluginRootCanonical
    if (isString(entry.cwd) && entry.cwd.trim().length > 0) {
      var cwdRes = __miniAPluginResolveCwd(entry.cwd, pluginRootCanonical, pluginDataCanonical)
      if (!cwdRes.ok) return { ok: false, warning: label + ": " + cwdRes.error }
      resolvedCwd = cwdRes.path
    }

    // envs fully REPLACES the child process environment (see js/skills/mini-a-plugins.js callers / plan
    // notes) - ambient env must be seeded first or bare-name command resolution (PATH) breaks.
    var envs = merge(merge(getEnvs(), expandedEnv), { PLUGIN_ROOT: pluginRootCanonical, PLUGIN_DATA: pluginDataCanonical })

    return { ok: true, config: { cmd: [command].concat(expandedArgs), pwd: resolvedCwd, envs: envs, id: id } }
  }

  // streamable-http / sse
  var url = entry.url.trim()
  var isHttps = /^https:\/\//i.test(url)
  var isLocalHttp = /^http:\/\/(localhost|127\.0\.0\.1|\[?::1\]?)(:|\/|$)/i.test(url)
  if (!isHttps && !isLocalHttp) {
    return { ok: false, warning: label + ": url must be absolute https, or http on localhost" }
  }

  var cfg = { type: (v.type === "sse") ? "sse" : "remote", url: url, id: id }
  var warnings = []
  if (isMap(entry.headers)) {
    var authHeaderKey = Object.keys(entry.headers).filter(function(hk) { return String(hk).toLowerCase() === "authorization" })[0]
    if (isDef(authHeaderKey)) {
      var bearerMatch = /^Bearer\s+(.+)$/i.exec(String(entry.headers[authHeaderKey]))
      if (bearerMatch) {
        cfg.auth = { type: "bearer", token: bearerMatch[1] }
      } else {
        warnings.push(label + ": 'Authorization' header is not in 'Bearer <token>' form; ignored")
      }
    }
    var otherHeaders = Object.keys(entry.headers).filter(function(hk) { return String(hk).toLowerCase() !== "authorization" })
    if (otherHeaders.length > 0) {
      warnings.push(label + ": header(s) " + otherHeaders.join(",") + " dropped (only 'Authorization: Bearer <token>' can be passed through today)")
    }
  }

  return { ok: true, config: cfg, warnings: warnings }
}

function __miniAPluginLoadOne(pluginDir, options) {
  options = isMap(options) ? options : {}
  var fileAccess = new MiniAFileAccess(options.fileallow)
  fileAccess.assert(pluginDir)
  if (!io.fileExists(pluginDir) || io.fileInfo(pluginDir).isDirectory !== true) {
    return { ok: false, warning: "plugin directory not found: " + pluginDir }
  }

  var manifestPath = String(new java.io.File(pluginDir, "plugin.json").getCanonicalPath())
  var sourceFormat = "agent"
  if (!io.fileExists(manifestPath)) {
    var codexPath = pluginDir + "/.codex-plugin/plugin.json"
    var claudePath = pluginDir + "/.claude-plugin/plugin.json"
    if (io.fileExists(codexPath) && io.fileExists(claudePath)) return { ok: false, warning: "Ambiguous vendor manifests: " + pluginDir }
    if (io.fileExists(codexPath)) { manifestPath = codexPath; sourceFormat = "codex" }
    else if (io.fileExists(claudePath)) { manifestPath = claudePath; sourceFormat = "claude" }
  }
  if (!io.fileExists(manifestPath)) {
    return { ok: false, warning: "plugin at '" + pluginDir + "' has no plugin.json; skipped" }
  }

  var parsed
  try {
    parsed = af.fromJson(io.readFileString(fileAccess.assert(manifestPath)))
  } catch (parseErr) {
    return { ok: false, warning: "plugin at '" + pluginDir + "': plugin.json is not valid JSON (" + __miniAErrMsg(parseErr) + ")" }
  }

  if (sourceFormat !== "agent") parsed.$schema = __MINI_A_PLUGIN_SCHEMA_ID
  var manifestCheck = __miniAPluginValidateManifest(parsed)
  if (!manifestCheck.ok) {
    return { ok: false, warning: "plugin at '" + pluginDir + "': " + manifestCheck.error }
  }

  var pluginName = parsed.name
  var warnings = []
  var commandDefinitions = []
  var commandsRelative = isString(parsed.commands) ? parsed.commands : "commands"
  var commandsResolved = __miniAPluginResolveContained(pluginDir, commandsRelative)
  if (commandsResolved.ok && io.fileExists(commandsResolved.path)) {
    io.listFiles(fileAccess.assert(commandsResolved.path)).files.forEach(function(entry) {
      if (entry.isDirectory || !/^[a-z0-9][a-z0-9_-]*\.md$/i.test(entry.filename)) return
      var path = fileAccess.assert(commandsResolved.path + "/" + entry.filename)
      var text = io.readFileString(path)
      if (/\$[0-9]|!`|^(?:allowed-tools|model|context|agent):/m.test(text)) {
        warnings.push("Unsupported command semantics: " + entry.filename)
        return
      }
      commandDefinitions.push({ name: pluginName + ":" + entry.filename.replace(/\.md$/i, ""), file: path })
    })
  }

  var hooks = []
  var hooksRelative = isString(parsed.hooks) ? parsed.hooks : "hooks/hooks.json"
  var hooksPath = __miniAPluginResolveContained(pluginDir, hooksRelative)
  if (hooksPath.ok && io.fileExists(hooksPath.path)) {
    try {
      var hookConfig = io.readFileJSON(fileAccess.assert(hooksPath.path))
      var events = { UserPromptSubmit: "before_goal", PreToolUse: "before_tool", PostToolUse: "after_tool" }
      Object.keys(hookConfig.hooks || {}).forEach(function(event) {
        if (!events[event]) { warnings.push("Unsupported hook event: " + event); return }
        hookConfig.hooks[event].forEach(function(group) {
          ;(group.hooks || []).forEach(function(hook) {
            if (hook.type !== "command" || hook.async === true || !isString(hook.command)) {
              warnings.push("Unsupported hook handler: " + event)
              return
            }
            try {
              hooks.push({ event: events[event], sourceEvent: event, protocol: hook.miniAProtocol, command: hook.command, matcher: new RegExp(group.matcher === "*" ? ".*" : (group.matcher || ".*")), timeout: isNumber(hook.timeout) ? hook.timeout * 1000 : 5000, root: pluginDir, format: sourceFormat, name: pluginName })
            } catch (error) { warnings.push("Invalid hook matcher: " + event) }
          })
        })
      })
    } catch (error) { warnings.push("Invalid hooks configuration") }
  }

  var skillsDir = __
  var skillsRelative = sourceFormat !== "agent" && isString(parsed.skills) ? parsed.skills : "skills"
  var skillsResolved = __miniAPluginResolveContained(pluginDir, skillsRelative)
  if (!skillsResolved.ok) return { ok: false, warning: skillsResolved.error }
  var skillsCandidate = skillsResolved.path
  if (io.fileExists(skillsCandidate)) {
    var skillsInfo = io.fileInfo(skillsCandidate)
    if (isDef(skillsInfo) && skillsInfo.isDirectory === true) skillsDir = skillsCandidate
  }

  var mcpConfigs = []
  var mcpRelative = sourceFormat === "agent" ? "mcp.json" : (isString(parsed.mcpServers) ? parsed.mcpServers : ".mcp.json")
  var mcpResolved = __miniAPluginResolveContained(pluginDir, mcpRelative)
  if (!mcpResolved.ok) return { ok: false, warning: mcpResolved.error }
  var mcpJsonPath = mcpResolved.path
  if (io.fileExists(mcpJsonPath)) {
    var mcpParsed
    try {
      mcpParsed = af.fromJson(io.readFileString(fileAccess.assert(mcpJsonPath)))
    } catch (mcpParseErr) {
      warnings.push("plugin '" + pluginName + "': mcp.json is not valid JSON (" + __miniAErrMsg(mcpParseErr) + "); MCP servers skipped")
      mcpParsed = __
    }
    if (isMap(mcpParsed)) {
      if (sourceFormat !== "agent") {
        mcpParsed.$schema = __MINI_A_PLUGIN_MCP_SCHEMA_ID
        Object.keys(mcpParsed.mcpServers || {}).forEach(function(key) {
          var entry = mcpParsed.mcpServers[key]
          if (isMap(entry) && isUnDef(entry.type) && isString(entry.command)) entry.type = "stdio"
          if (isMap(entry) && entry.type === "http") entry.type = "streamable-http"
          if (isMap(entry)) {
            var text = stringify(entry, __, "").replace(/CLAUDE_PLUGIN_ROOT|CODEX_PLUGIN_ROOT/g, "PLUGIN_ROOT").replace(/CLAUDE_PLUGIN_DATA|CODEX_PLUGIN_DATA/g, "PLUGIN_DATA")
            mcpParsed.mcpServers[key] = jsonParse(text)
          }
        })
      }
      if (mcpParsed.$schema !== __MINI_A_PLUGIN_MCP_SCHEMA_ID) {
        warnings.push("plugin '" + pluginName + "': mcp.json '$schema' does not match the supported version; MCP servers skipped")
      } else if (!isMap(mcpParsed.mcpServers)) {
        warnings.push("plugin '" + pluginName + "': mcp.json 'mcpServers' must be an object; MCP servers skipped")
      } else {
        Object.keys(mcpParsed.mcpServers).forEach(function(serverName) {
          try {
            var serverEntry = mcpParsed.mcpServers[serverName]
            if (sourceFormat !== "agent" && isMap(serverEntry.headers) && Object.keys(serverEntry.headers).some(function(key) { return key.toLowerCase() !== "authorization" || !/^Bearer\s+/i.test(serverEntry.headers[key]) })) {
              warnings.push("MCP server requires unsupported headers: " + serverName)
              return
            }
            var converted = __miniAPluginConvertMcpServerEntry(pluginDir, pluginName, serverName, serverEntry, options)
            if (!converted.ok) {
              warnings.push(converted.warning)
              return
            }
            mcpConfigs.push(converted.config)
            if (isArray(converted.warnings)) warnings = warnings.concat(converted.warnings)
          } catch (entryErr) {
            warnings.push("plugin '" + pluginName + "': mcp server '" + serverName + "' failed to load: " + __miniAErrMsg(entryErr))
          }
        })
      }
    }
  }

  return { ok: true, name: pluginName, format: sourceFormat, manifest: parsed, root: pluginDir, commands: commandDefinitions, hooks: hooks, skillsDir: skillsDir, mcpConfigs: mcpConfigs, warnings: warnings }
}

function __miniAPluginDiscover(options) {
  options = isMap(options) ? options : {}
  var fileAccess = new MiniAFileAccess(options.fileallow)
  var warnings = []
  var skillsRoots = []
  var commands = []
  var hooks = []
  var mcpConfigs = []
  var candidateDirs = []
  var seenCandidates = {}

  var pushCandidate = function(dir) {
    var canonical
    try { canonical = String(new java.io.File(dir).getCanonicalPath()) } catch (e) { return }
    if (seenCandidates[canonical]) return
    seenCandidates[canonical] = true
    candidateDirs.push(canonical)
  }

  __miniAPluginResolveExplicit(options).forEach(pushCandidate)

  __miniAPluginResolveRoots(options).forEach(function(root) {
    var listing
    try { listing = io.listFiles(fileAccess.assert(root)) } catch (e) { listing = __ }
    if (!isMap(listing) || !isArray(listing.files)) return
    listing.files.forEach(function(entry) {
      var entryName = __, isDirectory = false
      if (isMap(entry) && isString(entry.filename)) {
        entryName = String(entry.filename)
        isDirectory = entry.isDirectory === true
      } else if (isString(entry) || entry instanceof java.lang.String) {
        entryName = String(entry)
        try { isDirectory = new java.io.File(root, entryName).isDirectory() } catch (e2) { isDirectory = false }
      } else {
        return
      }
      if (!isString(entryName) || entryName.length === 0) return
      if (entryName.charAt(0) === ".") return
      if (!isDirectory) return
      try {
        pushCandidate(String(new java.io.File(root, entryName).getCanonicalPath()))
      } catch (e3) {}
    })
  })

  if (typeof MiniAPluginManager === "function") {
    new MiniAPluginManager(options).list().forEach(function(item) {
      if (item.enabled === true) pushCandidate(item.path)
    })
  }

  var managedStates = typeof MiniAPluginManager === "function" ? new MiniAPluginManager(options).list() : []
  candidateDirs.forEach(function(pluginDir) {
    var managedStateFile = String(new java.io.File(pluginDir).getParent()) + "/state.json"
    if (pluginDir.indexOf(new MiniAPluginManager(options).root + "/") === 0 && io.fileExists(managedStateFile)) {
      var managedState = io.readFileJSON(managedStateFile)
      if (managedState.enabled !== true || managedState.removed === true) return
    }
    if (managedStates.some(function(item) { return item.path === pluginDir && item.enabled !== true })) return
    try {
      var result = __miniAPluginLoadOne(pluginDir, options)
      if (!result.ok) {
        warnings.push(result.warning || ("plugin at '" + pluginDir + "' failed to load"))
        return
      }
      if (isString(result.skillsDir)) skillsRoots.push(result.skillsDir)
      commands = commands.concat(result.commands || [])
      hooks = hooks.concat(result.hooks || [])
      if (isArray(result.mcpConfigs)) mcpConfigs = mcpConfigs.concat(result.mcpConfigs)
      if (isArray(result.warnings)) warnings = warnings.concat(result.warnings)
    } catch (loadErr) {
      warnings.push("plugin at '" + pluginDir + "' failed to load: " + __miniAErrMsg(loadErr))
    }
  })

  return { skillsRoots: skillsRoots, commands: commands, hooks: hooks, mcpConfigs: mcpConfigs, warnings: warnings }
}

// Load management without creating directories during discovery.
loadLib(__miniAPath("js/skills/mini-a-plugin-manager.js"))

// Execute the supported vendor command-hook protocol without widening permissions.
function __miniARunPluginHooks(hooks, event, vars, options) {
  var outcome = { outputs: [], blocked: false }
  hooks.forEach(function(hook) {
    var shellEvent = event === "before_shell" || event === "after_shell"
    var mappedEvent = event === "before_shell" ? "before_tool" : (event === "after_shell" ? "after_tool" : event)
    if (hook.event !== mappedEvent || mappedEvent === "after_tool" && vars.MINI_A_TOOL_ERROR === "true") return
    if (!shellEvent && String(vars.MINI_A_TOOL || "").toLowerCase() === "shell") return
    if (toBoolean(options.useshell) !== true) {
      logWarn("Plugin hook requires useshell=true: " + hook.name)
      return
    }
    var tool = shellEvent ? "Bash" : (vars.MINI_A_TOOL || "")
    if (hook.protocol === "copilot") tool = shellEvent ? "bash" : tool
    if (mappedEvent !== "before_goal" && !hook.matcher.test(tool)) return
    if (!isString(options._pluginHookSession)) options._pluginHookSession = String(java.util.UUID.randomUUID())
    var input = { session_id: options._pluginHookSession, hook_event_name: hook.sourceEvent, cwd: String(java.lang.System.getProperty("user.dir")), prompt: vars.MINI_A_GOAL, tool_name: tool }
    try {
      if (isString(vars.MINI_A_TOOL_PARAMS)) input.tool_input = jsonParse(vars.MINI_A_TOOL_PARAMS)
      if (shellEvent) input.tool_input = { command: vars.MINI_A_SHELL_COMMAND }
      if (isString(vars.MINI_A_TOOL_RESULT)) {
        try { input.tool_response = jsonParse(vars.MINI_A_TOOL_RESULT) } catch (ignore) { input.tool_response = vars.MINI_A_TOOL_RESULT }
      }
      if (event === "after_shell") input.tool_response = { stdout: vars.MINI_A_SHELL_OUTPUT, exit_code: Number(vars.MINI_A_SHELL_EXITCODE) }
      if (hook.protocol === "copilot") {
        input = { sessionId: input.session_id, timestamp: now(), cwd: input.cwd, prompt: input.prompt, toolName: tool, toolArgs: input.tool_input, toolResult: { resultType: "success", textResultForLlm: stringify(input.tool_response || "", __, "") } }
      }
      var env = merge(getEnvs(), { PLUGIN_ROOT: hook.root, CLAUDE_PLUGIN_ROOT: hook.root, CODEX_PLUGIN_ROOT: hook.root })
      var data = __miniAPluginDataDir(hook.name, options)
      env.PLUGIN_DATA = data
      env.CLAUDE_PLUGIN_DATA = data
      env.CODEX_PLUGIN_DATA = data
      env.COPILOT_PLUGIN_ROOT = hook.root
      env.COPILOT_PLUGIN_DATA = data
      var result = $sh(hook.command, stringify(input, __, "")).pwd(hook.root).envs(env).timeout(hook.timeout).get(0)
      if (hook.protocol === "copilot" && result.exitcode !== 0 && mappedEvent !== "after_tool") outcome.blocked = true
      if (result.exitcode === 2 && mappedEvent !== "after_tool") outcome.blocked = true
      var stdout = String(result.stdout || "").trim()
      if (result.exitcode !== 0 && result.exitcode !== 2) logWarn("Plugin hook failed: " + hook.name)
      if (stdout.charAt(0) === "{") {
        var output = jsonParse(stdout)
        if (hook.protocol === "copilot") {
          if (mappedEvent !== "before_tool") return
          if (Object.keys(output).some(function(key) { return ["permissionDecision", "permissionDecisionReason", "additionalContext"].indexOf(key) < 0 })) {
            outcome.blocked = true
            logWarn("Unsupported Copilot hook output: " + hook.name)
            return
          }
          output = { hookSpecificOutput: output }
        }
        var specific = output.hookSpecificOutput || {}
        if (isDef(specific.updatedInput) || specific.permissionDecision === "ask" || Object.keys(output).some(function(key) { return ["decision", "reason", "continue", "stopReason", "systemMessage", "suppressOutput", "hookSpecificOutput"].indexOf(key) < 0 }) || Object.keys(specific).some(function(key) { return ["hookEventName", "permissionDecision", "permissionDecisionReason", "additionalContext"].indexOf(key) < 0 })) {
          logWarn("Unsupported plugin hook control output: " + hook.name)
          if (mappedEvent !== "after_tool") outcome.blocked = true
          return
        }
        if (output.decision === "block" || output.continue === false || specific.permissionDecision === "deny") {
          if (mappedEvent !== "after_tool") outcome.blocked = true
        }
        stdout = specific.additionalContext || output.systemMessage || ""
      }
      if (stdout.length) outcome.outputs.push({ hookName: hook.name, output: stdout.substring(0, 4096) })
    } catch (error) {
      logWarn("Plugin hook failed: " + hook.name)
      if (mappedEvent !== "after_tool") outcome.blocked = true
    }
  })
  return outcome
}
