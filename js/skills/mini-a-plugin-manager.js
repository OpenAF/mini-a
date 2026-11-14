// Manage local plugin packages independently of agent execution.
function MiniAPluginManager(options) {
  this.options = isMap(options) ? options : {}
  this.root = __miniAPluginBaseHomeDir(this.options) + "/.openaf-mini-a/managed-plugins"
  this.access = new MiniAFileAccess(this.options.fileallow)
}

// List immutable package directories and their activation state.
MiniAPluginManager.prototype.list = function() {
  if (!io.fileExists(this.root)) return []
  return io.listFiles(this.access.assert(this.root)).files.filter(function(entry) {
    return entry.isDirectory === true && /^[a-z0-9][a-z0-9.-]*$/.test(entry.filename)
  }).map(function(entry) {
    var state = io.readFileJSON(this.root + "/" + entry.filename + "/state.json")
    return { id: entry.filename, removed: state.removed === true, enabled: state.enabled === true, path: this.root + "/" + entry.filename + "/package" }
  }, this).filter(function(item) { return item.removed !== true })
}

// Inspect metadata without spawning MCP servers or executing package code.
MiniAPluginManager.prototype.inspect = function(source) {
  var path = String(new java.io.File(this.access.assert(source)).getCanonicalPath())
  var result = __miniAPluginLoadOne(path, merge(this.options, { inspect: true }))
  if (!result.ok) throw new Error(result.warning)
  var report = { id: result.name, format: result.format, source: path, warnings: result.warnings, components: [] }
  if (isString(result.skillsDir)) report.components.push({ kind: "skills", status: "supported" })
  if (result.commands.length) report.components.push({ kind: "commands", status: "adapted" })
  if (result.hooks.length) report.components.push({ kind: "hooks", status: "adapted" })
  result.mcpConfigs.forEach(function(config) { report.components.push({ kind: "mcp", id: config.id, status: "adapted" }) })
  ;["agents", "apps", "lspServers"].forEach(function(kind) {
    if (isDef(result.manifest[kind]) || io.fileExists(path + "/" + kind) || (kind === "apps" && io.fileExists(path + "/.app.json"))) {
      report.components.push({ kind: kind, status: "unsupported", reason: "No compatible runtime adapter is available" })
    }
  })
  return report
}

// Copy contained regular files, preserving executable permissions and rejecting links.
MiniAPluginManager.prototype.copy = function(source, target) {
  var src = java.nio.file.Paths.get(source)
  var dst = java.nio.file.Paths.get(target)
  if (java.nio.file.Files.isSymbolicLink(src)) throw new Error("Package links are unsupported: " + source)
  if (new java.io.File(source).isDirectory()) {
    io.mkdir(target)
    var self = this
    io.listFiles(source).files.forEach(function(entry) { self.copy(source + "/" + entry.filename, target + "/" + entry.filename) })
  } else {
    java.nio.file.Files.copy(src, dst, java.nio.file.StandardCopyOption.COPY_ATTRIBUTES)
  }
}

// Convert a package into a separate portable directory without resolving credentials.
MiniAPluginManager.prototype.convert = function(source, target) {
  var report = this.inspect(source)
  this.access.assert(target)
  if (io.fileExists(target)) throw new Error("Destination already exists")
  var result = __miniAPluginLoadOne(report.source, merge(this.options, { inspect: true }))
  this.copy(report.source, target)
  var manifest = { "$schema": __MINI_A_PLUGIN_SCHEMA_ID, name: result.name, extensions: { "org.openaf.mini-a": { sourceFormat: result.format } } }
  ;["version", "description", "author", "homepage", "repository", "license", "keywords"].forEach(function(key) {
    if (isDef(result.manifest[key])) manifest[key] = result.manifest[key]
  })
  if (isString(result.manifest.commands)) manifest.commands = result.manifest.commands
  if (isString(result.manifest.hooks)) manifest.hooks = result.manifest.hooks
  if (isString(result.skillsDir) && result.skillsDir !== report.source + "/skills") this.copy(result.skillsDir, target + "/skills")
  io.writeFileJSON(target + "/plugin.json", manifest)
  var mcpPath = report.source + "/" + (isString(result.manifest.mcpServers) ? result.manifest.mcpServers : ".mcp.json")
  if (result.format !== "agent" && io.fileExists(mcpPath)) {
    var mcp = io.readFileJSON(mcpPath)
    mcp.$schema = __MINI_A_PLUGIN_MCP_SCHEMA_ID
    Object.keys(mcp.mcpServers || {}).forEach(function(key) {
      var entry = mcp.mcpServers[key]
      if (isUnDef(entry.type) && isString(entry.command)) entry.type = "stdio"
      if (entry.type === "http") entry.type = "streamable-http"
    })
    io.writeFileString(target + "/mcp.json", stringify(mcp, __, "  ").replace(/CLAUDE_PLUGIN_ROOT|CODEX_PLUGIN_ROOT/g, "PLUGIN_ROOT"))
  }
  io.writeFileJSON(target + "/conversion-report.json", report)
  return report
}

// Apply activation changes only to future discovery snapshots.
MiniAPluginManager.prototype.request = function(request) {
  var op = request.op
  if (op === "list") return this.list()
  if (op === "inspect") return this.inspect(request.source)
  if (op === "convert") return this.convert(request.source, request.out)
  if (op === "install") {
    var report = this.inspect(request.source)
    var destination = this.root + "/" + report.id
    this.access.assert(destination)
    if (io.fileExists(destination)) throw new Error("Plugin already installed")
    io.mkdir(this.root)
    var staging = this.root + "/.install-" + report.id + "-" + now()
    io.mkdir(staging)
    try {
      this.convert(request.source, staging + "/package")
      io.writeFileJSON(staging + "/state.json", { enabled: false })
      java.nio.file.Files.move(java.nio.file.Paths.get(staging), java.nio.file.Paths.get(destination), java.nio.file.StandardCopyOption.ATOMIC_MOVE)
    } catch (error) {
      io.rm(staging)
      throw error
    }
    return { id: report.id, enabled: false, report: report }
  }
  if (!isString(request.id) || !__MINI_A_PLUGIN_NAME_PATTERN.test(request.id)) throw new Error("Invalid plugin id")
  var path = this.access.assert(this.root + "/" + request.id)
  if (!io.fileExists(path)) throw new Error("Plugin not installed")
  if (op === "enable" || op === "disable") {
    var previous = io.readFileJSON(path + "/state.json")
    if (previous.removed === true) throw new Error("Plugin has been removed")
    this.writeState(path + "/state.json", { enabled: op === "enable" })
    return { id: request.id, enabled: op === "enable", applies: "new sessions" }
  }
  if (op === "remove") {
    // Retire files so existing session snapshots remain readable.
    this.writeState(path + "/state.json", { enabled: false, removed: true })
    return { id: request.id, removed: true, applies: "new sessions" }
  }
  throw new Error("Unknown plugin operation")
}

// Extract bounded local ZIP packages into a disposable staging directory.
MiniAPluginManager.prototype.extract = function(source, preserveRoot) {
  var archive = new org.apache.commons.compress.archivers.zip.ZipFile(new java.io.File(this.access.assert(source)))
  var root = String(new java.io.File(io.createTempDir()).getCanonicalPath())
  var total = 0
  var count = 0
  var seen = {}
  try {
    var entries = archive.getEntries()
    while (entries.hasMoreElements()) {
      var entry = entries.nextElement()
      var name = String(entry.getName())
      count++
      if (count > 10000 || entry.isUnixSymlink() || /(^\/|\\|^[A-Za-z]:|(^|\/)\.\.($|\/))/.test(name)) throw new Error("Unsafe ZIP entry")
      var resolved = __miniAPluginResolveContained(root, name)
      if (!resolved.ok || seen[resolved.path]) throw new Error("Invalid or duplicate ZIP entry")
      seen[resolved.path] = true
      if (entry.isDirectory()) { io.mkdir(resolved.path); continue }
      io.mkdir(String(new java.io.File(resolved.path).getParent()))
      var input = archive.getInputStream(entry)
      var output = new java.io.FileOutputStream(resolved.path)
      try {
        var buffer = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192)
        var length
        while ((length = input.read(buffer)) !== -1) {
          total += length
          if (total > 100 * 1024 * 1024) throw new Error("ZIP expanded size exceeds 100 MiB")
          output.write(buffer, 0, length)
        }
      } finally { input.close(); output.close() }
      if ((entry.getUnixMode() & 73) !== 0) new java.io.File(resolved.path).setExecutable(true, false)
    }
    var packageRoot = root
    if (preserveRoot !== true && !io.fileExists(root + "/plugin.json") && !io.fileExists(root + "/.claude-plugin/plugin.json") && !io.fileExists(root + "/.codex-plugin/plugin.json") && !io.fileExists(root + "/opencode.json") && !io.fileExists(root + "/opencode.jsonc")) {
      var children = io.listFiles(root).files
      if (children.length !== 1 || children[0].isDirectory !== true) throw new Error("ZIP must contain one plugin root")
      packageRoot = root + "/" + children[0].filename
    }
    return { root: root, path: packageRoot }
  } catch (error) {
    io.rm(root)
    throw error
  } finally { archive.close() }
}

// Keep archive staging lifetime limited to one management operation.
MiniAPluginManager.prototype.request = (function(__miniAPluginFolderRequest) {
  return function(request) {
  if (isString(request.source) && /\.zip$/i.test(request.source)) {
    if (new java.io.File(request.source).length() > 25 * 1024 * 1024) throw new Error("ZIP compressed size exceeds 25 MiB")
    var extracted = this.extract(request.source)
    try { return __miniAPluginFolderRequest.call(this, merge(request, { source: extracted.path })) }
    finally { io.rm(extracted.root) }
  }
  return __miniAPluginFolderRequest.call(this, request)
  }
})(MiniAPluginManager.prototype.request)

// Publish state with a complete-file rename so readers never observe partial JSON.
MiniAPluginManager.prototype.writeState = function(path, state) {
  var temporary = path + "." + String(java.util.UUID.randomUUID()) + ".tmp"
  try {
    io.writeFileJSON(temporary, state)
    java.nio.file.Files.move(java.nio.file.Paths.get(temporary), java.nio.file.Paths.get(path), java.nio.file.StandardCopyOption.ATOMIC_MOVE, java.nio.file.StandardCopyOption.REPLACE_EXISTING)
  } finally {
    if (io.fileExists(temporary)) io.rm(temporary)
  }
}

// Serialize lifecycle writes across threads and processes sharing the same home.
MiniAPluginManager.prototype.request = (function(__miniAPluginUnlockedRequest) {
  return function(request) {
  if (["install", "enable", "disable", "remove"].indexOf(request.op) < 0) return __miniAPluginUnlockedRequest.call(this, request)
  this.access.assert(this.root)
  io.mkdir(this.root)
  var file = new java.io.RandomAccessFile(this.root + "/.lock", "rw")
  var channel = file.getChannel()
  var lock = null
  var deadline = now() + 10000
  try {
    while (lock === null) {
      try { lock = channel.tryLock() } catch (error) {
        if (!(error.javaException instanceof java.nio.channels.OverlappingFileLockException)) throw error
      }
      if (lock === null) {
        if (now() >= deadline) throw new Error("Plugin registry is busy; retry the operation")
        java.lang.Thread.sleep(10)
      }
    }
    return __miniAPluginUnlockedRequest.call(this, request)
  } finally {
    if (lock !== null) lock.release()
    channel.close()
    file.close()
  }
  }
})(MiniAPluginManager.prototype.request)

// Export a converted package as a ZIP while retaining executable file modes.
MiniAPluginManager.prototype.exportZip = function(source, options) {
  var temporary = String(new java.io.File(io.createTempDir()).getCanonicalPath())
  try {
    var packagePath = temporary + "/package"
    options = isMap(options) ? options : {}
    if (options.target === "all") {
      io.mkdir(packagePath)
      var self = this
      ;["minia", "claude", "chatgpt", "opencode", "copilot"].forEach(function(target) {
        var encoded = self.exportZip(source, merge(options, { target: target }))
        java.nio.file.Files.write(java.nio.file.Paths.get(packagePath + "/" + target + ".zip"), java.util.Base64.getDecoder().decode(encoded))
      })
    } else this.request(merge(options, { op: "convert", source: source, out: packagePath, dryRun: false }))
    var bytes = new java.io.ByteArrayOutputStream()
    var zip = new org.apache.commons.compress.archivers.zip.ZipArchiveOutputStream(bytes)
    var visit = function(folder, prefix) {
      io.listFiles(folder).files.forEach(function(file) {
        var path = folder + "/" + file.filename
        var name = prefix + file.filename
        if (file.isDirectory) {
          visit(path, name + "/")
        } else {
          var entry = new org.apache.commons.compress.archivers.zip.ZipArchiveEntry(name)
          entry.setUnixMode(new java.io.File(path).canExecute() ? 33261 : 33188)
          zip.putArchiveEntry(entry)
          zip.write(io.readFileBytes(path))
          zip.closeArchiveEntry()
        }
      })
    }
    try { visit(packagePath, "") } finally { zip.close() }
    return String(java.util.Base64.getEncoder().encodeToString(bytes.toByteArray()))
  } finally { io.rm(temporary) }
}

// Handle bounded browser transfers without accepting client-controlled staging paths.
MiniAPluginManager.prototype.webRequest = function(request) {
  var temporary = null
  try {
    var source = request.acquisition ? this.acquisition(request.acquisition).packagePath : request.source
    if (isDef(request.upload)) {
      if (!isString(request.upload) || request.upload.length > 34952536 || !/^[A-Za-z0-9+/]*={0,2}$/.test(request.upload)) throw new Error("Invalid ZIP upload")
      temporary = String(new java.io.File(io.createTempDir()).getCanonicalPath())
      source = temporary + "/upload.zip"
      java.nio.file.Files.write(java.nio.file.Paths.get(source), java.util.Base64.getDecoder().decode(request.upload))
    }
    if (request.op === "download") return { filename: (request.target || "mini-a") + "-plugin.zip", base64: this.exportZip(source, request) }
    return this.request(merge(request, { source: source }))
  } finally {
    if (temporary !== null) io.rm(temporary)
  }
}

// Read JSONC without evaluating configuration as JavaScript.
MiniAPluginManager.prototype.readConfig = function(path) {
  var text = io.readFileString(this.access.assert(path))
  var output = ""
  var quoted = false
  var escaped = false
  for (var i = 0; i < text.length; i++) {
    var character = text.charAt(i)
    if (quoted) {
      output += character
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === '"') quoted = false
    } else if (character === '"') {
      quoted = true
      output += character
    } else if (character === "/" && text.charAt(i + 1) === "/") {
      while (i < text.length && text.charAt(i) !== "\n") i++
      output += "\n"
    } else if (character === "/" && text.charAt(i + 1) === "*") {
      i += 2
      while (i < text.length && !(text.charAt(i) === "*" && text.charAt(i + 1) === "/")) i++
      if (i >= text.length) throw new Error("Unterminated JSONC comment")
      i++
      output += " "
    } else output += character
  }
  // Remove trailing commas only outside strings.
  return jsonParse(output.replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, function(match, suffix) {
    return isDef(suffix) ? suffix : match
  }))
}

// Normalize source declarations without starting tools or executing plugin code.
MiniAPluginManager.prototype.describe = function(source, format) {
  var root = String(new java.io.File(this.access.assert(source)).getCanonicalPath())
  var self = this
  var detected = "minia"
  var manifest = {}
  var config = {}
  var configPath = null
  if (io.fileExists(root + "/plugin.json")) {
    manifest = this.readConfig(root + "/plugin.json")
    detected = manifest.$schema === __MINI_A_PLUGIN_SCHEMA_ID && !io.fileExists(root + "/com.github.copilot") ? "minia" : "copilot"
  } else if (io.fileExists(root + "/.claude-plugin/plugin.json")) {
    manifest = this.readConfig(root + "/.claude-plugin/plugin.json")
    detected = "claude"
  } else if (io.fileExists(root + "/.codex-plugin/plugin.json")) {
    manifest = this.readConfig(root + "/.codex-plugin/plugin.json")
    detected = "chatgpt"
  } else {
    ;["opencode.json", "opencode.jsonc", ".opencode/opencode.json", ".opencode/opencode.jsonc"].forEach(function(path) {
      if (io.fileExists(root + "/" + path)) {
        if (configPath !== null) throw new Error("Multiple OpenCode configs; provide one integration bundle")
        configPath = path
      }
    })
    if (configPath === null) throw new Error("No supported plugin manifest or OpenCode configuration")
    detected = "opencode"
    config = this.readConfig(root + "/" + configPath)
    manifest = { name: String(new java.io.File(root).getName()).toLowerCase().replace(/[^a-z0-9.-]/g, "-") }
    if (io.fileExists(root + "/package.json")) manifest = this.readConfig(root + "/package.json")
  }
  if (isString(format) && format !== "auto") detected = format
  if (["minia", "claude", "chatgpt", "copilot", "opencode"].indexOf(detected) < 0) throw new Error("Invalid plugin format")
  if (!__MINI_A_PLUGIN_NAME_PATTERN.test(manifest.name)) throw new Error("Invalid plugin name")
  var components = []
  // Resolve every declared resource within the package boundary.
  var resource = function(kind, relative) {
    var resolved = __miniAPluginResolveContained(root, relative)
    if (!resolved.ok) throw new Error(resolved.error)
    if (io.fileExists(resolved.path)) components.push({ id: kind + ":" + relative, kind: kind, path: relative })
  }
  resource("skills", isString(manifest.skills) ? manifest.skills : (detected === "opencode" || !io.fileExists(root + "/skills") && io.fileExists(root + "/.opencode/skills") ? ".opencode/skills" : "skills"))
  resource("commands", isString(manifest.commands) ? manifest.commands : (detected === "opencode" || !io.fileExists(root + "/commands") && io.fileExists(root + "/.opencode/commands") ? ".opencode/commands" : "commands"))
  resource("hooks", isString(manifest.hooks) ? manifest.hooks : "hooks/hooks.json")
  resource("commands", "com.github.copilot/commands")
  resource("hooks", "com.github.copilot/hooks/hooks.json")
  var generatedHooks = root + "/.opencode/plugins/mini-a-hooks.js"
  var recognizedAdapter = false
  if (io.fileExists(generatedHooks) && io.fileExists(root + "/.opencode/mini-a-hooks.json")) {
    recognizedAdapter = io.readFileString(generatedHooks) === this.openCodeHookAdapter()
    if (recognizedAdapter) {
      this.validateOpenCodeHooks(this.readConfig(root + "/.opencode/mini-a-hooks.json"))
      resource("hooks", ".opencode/mini-a-hooks.json")
    }
  }
  ;["agents", "apps", "lspServers", ".app.json", "com.github.copilot/agents", ".opencode/plugins", "src"].forEach(function(path) {
    if (path === ".opencode/plugins" && recognizedAdapter && io.listFiles(root + "/" + path).files.length === 1) return
    resource("unsupported", path)
  })
  var mcp = { "$schema": __MINI_A_PLUGIN_MCP_SCHEMA_ID, mcpServers: {} }
  if (detected === "opencode") {
    Object.keys((config.mcp || {}).servers || {}).forEach(function(name) {
      var entry = clone(config.mcp.servers[name])
      if (entry.type === "local" && isArray(entry.command)) {
        entry.args = entry.command.slice(1)
        entry.command = entry.command[0]
        entry.type = "stdio"
      } else if (entry.type === "remote") entry.type = "streamable-http"
      if (isMap(entry.environment)) {
        entry.env = entry.environment
        delete entry.environment
      }
      mcp.mcpServers[name] = entry
    })
    if (isDef(config.plugins) || isDef(config.command) || isDef(config.commands)) components.push({ id: "unsupported:opencode-config", kind: "unsupported", reason: "Executable plugins or inline commands require a runtime adapter" })
  } else {
    var relative = isString(manifest.mcpServers) ? manifest.mcpServers : (io.fileExists(root + "/mcp.json") ? "mcp.json" : ".mcp.json")
    var resolved = __miniAPluginResolveContained(root, relative)
    if (!resolved.ok) throw new Error(resolved.error)
    if (io.fileExists(resolved.path)) {
      var parsed = self.readConfig(resolved.path)
      mcp.mcpServers = parsed.mcpServers || parsed.servers || {}
    }
  }
  Object.keys(mcp.mcpServers).forEach(function(name) {
    var entry = mcp.mcpServers[name]
    if (isUnDef(entry.type) && isString(entry.command)) entry.type = "stdio"
    if (entry.type === "http") entry.type = "streamable-http"
    components.push({ id: "mcp:" + name, kind: "mcp", name: name })
  })
  return { root: root, format: detected, manifest: manifest, mcp: mcp, components: components }
}

// Report conservative compatibility before writing any output.
MiniAPluginManager.prototype.analyze = function(packageInfo, request) {
  var target = request.target || "minia"
  if (["minia", "claude", "chatgpt", "copilot", "opencode", "universal", "all"].indexOf(target) < 0) throw new Error("Invalid export target")
  var excluded = isArray(request.exclude) ? request.exclude : String(request.exclude || "").split(",")
  var report = { id: packageInfo.manifest.name, format: packageInfo.format, target: target, components: [], blockers: [], warnings: [] }
  var destinations = {}
  packageInfo.components.forEach(function(component) {
    var item = clone(component)
    item.status = "supported"
    if (item.kind === "unsupported" || (item.kind === "hooks" && (["chatgpt", "copilot", "opencode", "universal", "all"].indexOf(target) >= 0))) {
      item.status = "unsupported"
      item.reason = item.reason || "No verified runtime protocol adapter for this target"
    }
    if (item.kind === "hooks" && target === "claude") {
      var declaration = this.readConfig(packageInfo.root + "/" + item.path)
      if (/"miniAProtocol"/.test(stringify(declaration, __, ""))) {
        item.status = "unsupported"
        item.reason = "Mini-A protocol adapters cannot run directly in Claude"
      }
    }
    if (item.kind === "hooks" && target === "opencode") {
      try {
        this.validateOpenCodeHooks(this.readConfig(packageInfo.root + "/" + item.path))
        item.status = "adapted"
        item.reason = "OpenCode V2 pre-tool adapter; fails closed; context injection and input rewriting unsupported"
      } catch (error) {
        item.status = "unsupported"
        item.reason = String(error)
      }
    }
    if (item.kind === "hooks" && packageInfo.format === "copilot" && target === "minia") {
      try {
        this.convertCopilotHooks(this.readConfig(packageInfo.root + "/" + item.path))
        item.status = "adapted"
        item.reason = "Copilot stdin/output adapter; Mini-A fails closed on pre-action execution errors"
      } catch (error) {
        item.status = "unsupported"
        item.reason = String(error)
      }
    }
    if (item.kind === "mcp") {
      var declared = packageInfo.mcp.mcpServers[item.name]
      var sensitive = false
      // Never transfer literal credentials from imported server declarations.
      var checkSecrets = function(value, key) {
        if (isMap(value)) Object.keys(value).forEach(function(child) { checkSecrets(value[child], child) })
        else if (isString(value) && /authorization|password|secret|token|api.?key/i.test(key) && value.length && !/^\$\{[^}]+\}$/.test(value) && !/^\{env:[^}]+\}$/.test(value)) sensitive = true
      }
      checkSecrets(declared, "")
      if (sensitive) {
        item.status = "unsupported"
        item.reason = "Replace literal credentials with unresolved environment references before exporting"
      }
    }
    if (item.kind === "mcp" && ["minia", "all", "universal"].indexOf(target) >= 0) {
      var entry = packageInfo.mcp.mcpServers[item.name]
      var validation = __miniAPluginValidateMcpServerEntry(entry)
      if (!validation.ok || entry.enabled === false || isDef(entry.headers) || isDef(entry.auth) || isDef(entry.oauth)) {
        item.status = "unsupported"
        item.reason = validation.error || "Disabled servers or authentication/header mappings require explicit configuration"
      }
    }
    if (target === "minia" && ["commands", "hooks"].indexOf(item.kind) >= 0 && packageInfo.format !== "opencode") {
      var runtime = __miniAPluginLoadOne(packageInfo.root, merge(this.options, { inspect: true }))
      if (runtime.ok && runtime.warnings.some(function(warning) { return /Unsupported|Invalid/.test(warning) })) {
        item.status = "unsupported"
        item.reason = "Source contains unsupported command or hook semantics"
      }
    }
    if (item.kind === "commands") {
      var commandRoot = packageInfo.root + "/" + item.path
      io.listFiles(commandRoot).files.forEach(function(file) {
        if (!file.isDirectory && /\.md$/.test(file.filename)) {
          var command = io.readFileString(commandRoot + "/" + file.filename)
          if (/\$[0-9]|!`|^(?:allowed-tools|model|context|agent):/m.test(command)) {
            item.status = "unsupported"
            item.reason = "Command uses host-specific argument, execution or permission semantics"
          }
        }
      })
    }
    if (excluded.indexOf(item.id) >= 0) item.status = "excluded"
    else if (item.status === "unsupported") report.blockers.push(item.id)
    if (item.status !== "excluded" && ["skills", "commands", "hooks"].indexOf(item.kind) >= 0) {
      if (destinations[item.kind]) {
        item.status = "unsupported"
        item.reason = "Multiple source directories map to the same destination; exclude one explicitly"
        report.blockers.push(item.id)
      }
      destinations[item.kind] = true
    }
    report.components.push(item)
  }, this)
  return report
}

// Write selected components into a fresh package staging directory.
MiniAPluginManager.prototype.renderPackage = function(info, destination, target, report) {
  var self = this
  io.mkdir(destination)
  var manifest = { "$schema": __MINI_A_PLUGIN_SCHEMA_ID, name: info.manifest.name }
  ;["version", "description", "author", "homepage", "repository", "license", "keywords"].forEach(function(key) {
    if (isDef(info.manifest[key])) manifest[key] = info.manifest[key]
  })
  var mcp = { "$schema": __MINI_A_PLUGIN_MCP_SCHEMA_ID, mcpServers: {} }
  report.components.forEach(function(component) {
    if (component.status === "excluded") return
    if (component.kind === "mcp") {
      mcp.mcpServers[component.name] = info.mcp.mcpServers[component.name]
      return
    }
    var relative = component.kind === "hooks" ? "hooks/hooks.json" : component.kind
    if (target === "copilot" && ["commands", "hooks"].indexOf(component.kind) >= 0) relative = "com.github.copilot/" + relative
    if (target === "opencode") relative = ".opencode/" + relative
    io.mkdir(String(new java.io.File(destination + "/" + relative).getParent()))
    if (component.kind === "hooks" && target === "opencode") {
      io.mkdir(destination + "/.opencode/plugins")
      io.writeFileString(destination + "/.opencode/plugins/mini-a-hooks.js", self.openCodeHookAdapter())
      io.writeFileJSON(destination + "/.opencode/mini-a-hooks.json", self.validateOpenCodeHooks(self.readConfig(info.root + "/" + component.path)))
    } else if (component.kind === "hooks" && info.format === "copilot" && target === "minia") {
      io.writeFileJSON(destination + "/" + relative, self.convertCopilotHooks(self.readConfig(info.root + "/" + component.path)))
    } else self.copy(info.root + "/" + component.path, destination + "/" + relative)
  })
  // Include conventional supporting resources without copying runtime state.
  ;["scripts", "assets", "references", "templates"].forEach(function(path) {
    if (io.fileExists(info.root + "/" + path)) self.copy(info.root + "/" + path, destination + "/" + path)
  })
  // Preserve root-level helper scripts referenced by command hooks.
  io.listFiles(info.root).files.forEach(function(file) {
    if (!file.isDirectory && /\.(py|sh|js|cjs|mjs|ts)$/.test(file.filename)) self.copy(info.root + "/" + file.filename, destination + "/" + file.filename)
  })
  io.writeFileJSON(destination + "/plugin.json", manifest)
  var normalized = stringify(mcp, __, "")
  normalized = normalized.replace(/\$\{(?:CLAUDE|CODEX)_PLUGIN_ROOT\}/g, "${PLUGIN_ROOT}").replace(/\$\{(?:CLAUDE|CODEX)_PLUGIN_DATA\}/g, "${PLUGIN_DATA}")
  mcp = jsonParse(normalized)
  io.writeFileJSON(destination + "/mcp.json", mcp)
  if (target === "claude" || target === "universal") {
    io.mkdir(destination + "/.claude-plugin")
    var vendor = clone(manifest)
    delete vendor.$schema
    io.writeFileJSON(destination + "/.claude-plugin/plugin.json", vendor)
    var claudeMcp = stringify({ mcpServers: mcp.mcpServers }, __, "")
    claudeMcp = claudeMcp.replace(/\$\{PLUGIN_ROOT\}/g, "${CLAUDE_PLUGIN_ROOT}").replace(/\$\{PLUGIN_DATA\}/g, "${CLAUDE_PLUGIN_DATA}")
    io.writeFileJSON(destination + "/.mcp.json", jsonParse(claudeMcp))
  }
  if (target === "universal" && io.fileExists(destination + "/commands")) {
    io.mkdir(destination + "/com.github.copilot")
    self.copy(destination + "/commands", destination + "/com.github.copilot/commands")
  }
  if (target === "opencode" || target === "universal") {
    var servers = {}
    Object.keys(mcp.mcpServers).forEach(function(name) {
      var entry = clone(mcp.mcpServers[name])
      if (entry.type === "stdio") {
        entry.command = [entry.command].concat(entry.args || [])
        delete entry.args
        entry.type = "local"
      } else entry.type = "remote"
      if (isMap(entry.env)) {
        entry.environment = entry.env
        delete entry.env
      }
      servers[name] = entry
    })
    var base = target === "universal" ? destination + "/opencode" : destination
    io.mkdir(base)
    io.writeFileJSON(base + "/opencode.json", { "$schema": "https://opencode.ai/config.json", mcp: { servers: servers } })
    if (target === "universal" && io.fileExists(destination + "/commands")) {
      io.mkdir(base + "/.opencode")
      self.copy(destination + "/commands", base + "/.opencode/commands")
    }
    if (target === "universal" && io.fileExists(destination + "/skills")) {
      io.mkdir(base + "/.opencode")
      self.copy(destination + "/skills", base + "/.opencode/skills")
    }
  }
  io.writeFileJSON(destination + "/conversion-report.json", report)
  io.writeFileString(destination + "/SETUP.md", "# " + manifest.name + "\n\nTarget: " + target + ". Extract before installation. OpenCode configuration is a fragment: merge mcp.servers into your existing configuration. Configure credentials separately. Conversion does not install runtimes or activate plugins.\n")
}

// Atomically convert a supported source with explicit exclusions.
MiniAPluginManager.prototype.buildPackage = function(request) {
  var info = this.describe(request.source, request.format)
  var report = this.analyze(info, request)
  if (request.dryRun === true || request.op === "inspect") return report
  if (report.blockers.length) throw new Error("Explicit exclusions required: " + report.blockers.join(", "))
  this.access.assert(request.out)
  var canonicalOut = String(new java.io.File(request.out).getCanonicalPath())
  if (canonicalOut === info.root || canonicalOut.indexOf(info.root + java.io.File.separator) === 0) throw new Error("Output must be outside source package")
  if (io.fileExists(request.out)) throw new Error("Destination already exists")
  var staging = request.out + ".staging-" + String(java.util.UUID.randomUUID())
  try {
    if (request.target === "all") {
      io.mkdir(staging)
      var self = this
      ;["minia", "claude", "chatgpt", "opencode", "copilot"].forEach(function(target) {
        var encoded = self.exportZip(info.root, merge(request, { target: target }))
        java.nio.file.Files.write(java.nio.file.Paths.get(staging + "/" + target + ".zip"), java.util.Base64.getDecoder().decode(encoded))
      })
    } else this.renderPackage(info, staging, request.target || "minia", report)
    java.nio.file.Files.move(java.nio.file.Paths.get(staging), java.nio.file.Paths.get(request.out), java.nio.file.StandardCopyOption.ATOMIC_MOVE)
  } finally { if (io.fileExists(staging)) io.rm(staging) }
  return report
}

// Assemble a portable source from a declarative creation specification.
MiniAPluginManager.prototype.createPackage = function(request) {
  var spec = isString(request.spec) ? this.readConfig(request.spec) : request.spec
  if (!isMap(spec) || !isMap(spec.metadata)) throw new Error("Creation requires spec.metadata")
  if (!__MINI_A_PLUGIN_NAME_PATTERN.test(spec.metadata.name)) throw new Error("Invalid plugin name")
  var temporary = String(new java.io.File(io.createTempDir()).getCanonicalPath())
  var self = this
  try {
    io.writeFileJSON(temporary + "/plugin.json", merge(spec.metadata, { "$schema": __MINI_A_PLUGIN_SCHEMA_ID }))
    var components = isArray(spec.components) ? spec.components : []
    components.forEach(function(component) {
      if (["skills", "commands", "hooks", "scripts", "assets", "references", "templates"].indexOf(component.kind) < 0) throw new Error("Invalid component kind")
      var name = isString(component.name) ? component.name : String(new java.io.File(component.source).getName())
      if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name === "." || name === "..") throw new Error("Invalid component name")
      var path = temporary + "/" + component.kind + "/" + name
      io.mkdir(String(new java.io.File(path).getParent()))
      self.copy(self.access.assert(component.source), path)
    })
    if (!isMap(spec.mcp) && ["mcp", "combined"].indexOf(spec.template) >= 0) spec.mcp = {}
    if (isMap(spec.mcp)) io.writeFileJSON(temporary + "/mcp.json", { "$schema": __MINI_A_PLUGIN_MCP_SCHEMA_ID, mcpServers: spec.mcp })
    if (isMap(spec.hooks)) {
      io.mkdir(temporary + "/hooks")
      io.writeFileJSON(temporary + "/hooks/hooks.json", { hooks: spec.hooks })
    }
    if (components.length === 0 && spec.template !== "mcp") {
      io.mkdir(temporary + "/skills/hello")
      io.writeFileString(temporary + "/skills/hello/SKILL.md", "---\nname: hello\ndescription: A starter workflow\n---\nDescribe the workflow here.\n")
    }
    return this.buildPackage(merge(request, { source: temporary, op: "convert" }))
  } finally { io.rm(temporary) }
}

// Dispatch normalized creation, inspection, conversion and file exports.
MiniAPluginManager.prototype.request = (function(previous) {
  return function(request) {
    request = merge({}, request)
    if (isString(request.source) && /\.vsix$/i.test(request.source)) throw new Error("Use a Copilot agent plugin folder or ZIP; VSIX extensions cannot be converted")
    if (request.op === "inventory") {
      var home = __miniAPluginBaseHomeDir(this.options) + "/.openaf-mini-a"
      return { plugins: this.list(), skillsRoots: [home + "/skills"].concat(__miniAPluginSplitDirList(this.options.extraskills)), commandsRoots: [home + "/commands"].concat(__miniAPluginSplitDirList(this.options.extracommands)), mcp: this.options.mcp || [] }
    }
    if (["create", "inspect", "convert", "export", "install"].indexOf(request.op) < 0) return previous.call(this, request)
    if (isString(request.id) && request.id.length && isString(request.source) && request.source.length) throw new Error("Choose source or installed id")
    if (isString(request.id) && request.id.length) {
      var installed = this.list().filter(function(item) { return item.id === request.id })
      if (installed.length !== 1) throw new Error("Plugin not installed")
      request.source = installed[0].path
      delete request.id
    }
    if (request.op === "create") return this.createPackage(request)
    if (isString(request.source) && /\.zip$/i.test(request.source)) {
      if (new java.io.File(this.access.assert(request.source)).length() > 25 * 1024 * 1024) throw new Error("ZIP compressed size exceeds 25 MiB")
      var extracted = this.extract(request.source)
      try { return this.request(merge(request, { source: extracted.path })) }
      finally { io.rm(extracted.root) }
    }
    if (request.op === "inspect" || request.op === "convert") return this.buildPackage(request)
    if (request.op === "install") {
      if (request.dryRun === true) return this.buildPackage(merge(request, { op: "inspect", target: "minia" }))
      var temporary = String(new java.io.File(io.createTempDir()).getCanonicalPath())
      try {
        this.buildPackage(merge(request, { op: "convert", target: "minia", out: temporary + "/package" }))
        return previous.call(this, { op: "install", source: temporary + "/package" })
      } finally { io.rm(temporary) }
    }
    if (request.dryRun === true) return this.buildPackage(merge(request, { op: "inspect" }))
    this.access.assert(request.out)
    if (io.fileExists(request.out)) throw new Error("Destination already exists")
    var bytes = this.exportZip(request.source, request)
    if (request.dryRun === true) return this.buildPackage(merge(request, { op: "inspect" }))
    var staging = request.out + "." + String(java.util.UUID.randomUUID()) + ".tmp"
    try {
      java.nio.file.Files.write(java.nio.file.Paths.get(staging), java.util.Base64.getDecoder().decode(bytes))
      java.nio.file.Files.move(java.nio.file.Paths.get(staging), java.nio.file.Paths.get(request.out), java.nio.file.StandardCopyOption.ATOMIC_MOVE)
    } finally { if (io.fileExists(staging)) io.rm(staging) }
    return { out: request.out, target: request.target || "minia" }
  }
})(MiniAPluginManager.prototype.request)

// Adapt the synchronous Copilot command-hook subset without running scripts.
MiniAPluginManager.prototype.convertCopilotHooks = function(config) {
  if (config.version !== 1 || !isMap(config.hooks)) throw new Error("Expected Copilot version 1 command hooks")
  var events = { userPromptSubmitted: "UserPromptSubmit", preToolUse: "PreToolUse", postToolUse: "PostToolUse" }
  var result = { hooks: {} }
  Object.keys(config.hooks).forEach(function(event) {
    if (!events[event] || !isArray(config.hooks[event])) throw new Error("Unsupported Copilot hook event: " + event)
    result.hooks[events[event]] = config.hooks[event].map(function(hook) {
      if (hook.type !== "command" || !isString(hook.command) || isDef(hook.bash) || isDef(hook.powershell) || isDef(hook.cwd) || isDef(hook.env) || hook.async === true) throw new Error("Hook needs a synchronous cross-platform command without environment/cwd overrides")
      if (Object.keys(hook).some(function(key) { return ["type", "command", "timeoutSec", "matcher"].indexOf(key) < 0 })) throw new Error("Unsupported Copilot hook setting")
      var matcher = isString(hook.matcher) ? hook.matcher : ".*"
      new RegExp(matcher)
      var timeout = isNumber(hook.timeoutSec) ? hook.timeoutSec : 5
      if (timeout <= 0 || !isFinite(timeout)) throw new Error("Invalid hook timeout")
      return { matcher: matcher, hooks: [{ type: "command", command: hook.command, timeout: timeout, miniAProtocol: "copilot" }] }
    })
  })
  return result
}

// Generate a fixed OpenCode V2 pre-tool command-hook adapter.
MiniAPluginManager.prototype.openCodeHookAdapter = function() {
  return [
    'import { Plugin } from "@opencode/plugin"',
    'import { readFileSync } from "node:fs"',
    'import { spawnSync } from "node:child_process"',
    'import { randomUUID } from "node:crypto"',
    'import { fileURLToPath } from "node:url"',
    'const root = fileURLToPath(new URL("../../", import.meta.url))',
    'export default Plugin.define({',
    '  id: "mini-a-command-hooks",',
    '  async setup(ctx) {',
    '    const session = randomUUID()',
    '    const config = JSON.parse(readFileSync(new URL("../mini-a-hooks.json", import.meta.url), "utf8"))',
    '    await ctx.tool.hook("execute.before", async (event) => {',
    '      const tool = event.tool === "bash" ? "Bash" : event.tool',
    '      for (const group of config.hooks.PreToolUse || []) {',
    '        if (!new RegExp(group.matcher === "*" ? ".*" : group.matcher || ".*").test(tool)) continue',
    '        for (const hook of group.hooks) {',
    '          const payload = { hook_event_name: "PreToolUse", session_id: event.sessionID || session, tool_name: tool, tool_input: event.input, cwd: root }',
    '          const result = spawnSync(hook.command, { shell: true, cwd: root, env: { ...process.env, PLUGIN_ROOT: root, CLAUDE_PLUGIN_ROOT: root, CODEX_PLUGIN_ROOT: root }, input: JSON.stringify(payload), encoding: "utf8", timeout: (hook.timeout || 5) * 1000, maxBuffer: 1048576 })',
    '          if (result.error || result.status !== 0) throw new Error("Plugin hook failed or denied execution")',
    '          const text = result.stdout.trim()',
    '          if (!text) continue',
    '          const output = JSON.parse(text)',
    '          const decision = output.hookSpecificOutput || {}',
    '          if (Object.keys(output).some(key => !["hookSpecificOutput", "decision", "continue", "reason"].includes(key)) || Object.keys(decision).some(key => !["hookEventName", "permissionDecision", "permissionDecisionReason"].includes(key))) throw new Error("Unsupported hook control output")',
    '          if (output.decision === "block" || output.continue === false || ["deny", "ask"].includes(decision.permissionDecision)) throw new Error(decision.permissionDecisionReason || output.reason || "Plugin hook denied execution")',
    '        }',
    '      }',
    '    })',
    '  }',
    '})',
    ''
  ].join("\n")
}

// Restrict generated adapters to semantics implemented by both runtimes.
MiniAPluginManager.prototype.validateOpenCodeHooks = function(config) {
  if (!isMap(config.hooks) || Object.keys(config.hooks).some(function(event) { return event !== "PreToolUse" })) throw new Error("OpenCode adapter currently supports PreToolUse only")
  if (!isArray(config.hooks.PreToolUse)) throw new Error("Expected PreToolUse hook groups")
  config.hooks.PreToolUse.forEach(function(group) {
    new RegExp(group.matcher === "*" ? ".*" : group.matcher || ".*")
    if (!isArray(group.hooks)) throw new Error("Expected command hooks")
    group.hooks.forEach(function(hook) {
      if (hook.type !== "command" || !isString(hook.command) || Object.keys(hook).some(function(key) { return ["type", "command", "timeout"].indexOf(key) < 0 })) throw new Error("Unsupported OpenCode command-hook handler")
      if (isDef(hook.timeout) && (!isNumber(hook.timeout) || !isFinite(hook.timeout) || hook.timeout <= 0)) throw new Error("Invalid timeout")
      if (/PLUGIN_DATA/.test(hook.command)) throw new Error("Persistent data placeholder requires an OpenCode storage adapter")
    })
  })
  return config
}

// Extend package operations with public artifact acquisition.
loadLib(__miniAPath("js/skills/mini-a-plugin-acquisition.js"))
