// Studio opens only server-configured MCP connections, on explicit requests.
loadLib(__miniAPath("js/skills/mini-a-plugins.js"))

// Keep display metadata on one line and short enough for the connection picker.
WikiStudio.mcpLabelText = function(value) {
  if (!isString(value)) return ""
  return value.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim().slice(0, 96)
}

// Identify a connection before discovery, without displaying arguments, URL paths or credentials.
WikiStudio.mcpConnectionLabel = function(entry, index) {
  var id = WikiStudio.mcpLabelText(entry.id)
  var detail = WikiStudio.mcpLabelText(entry.name) || WikiStudio.mcpLabelText(entry.title)
  if (!detail && entry.type === "ojob") {
    var job = (entry.options || {}).job || entry.job
    if (isString(job)) detail = WikiStudio.mcpLabelText(job.split(/[?#]/)[0].split(/[\\/]/).pop())
  }
  if (!detail) detail = WikiStudio.mcpLabelText(entry.description)
  if (!detail && !id && isString(entry.url)) {
    try {
      var uri = new java.net.URI(entry.url)
      if (uri.getHost() !== null) detail = WikiStudio.mcpLabelText(String(uri.getHost()) + (uri.getPort() < 0 ? "" : ":" + uri.getPort()))
    } catch (invalidUrl) {}
  }
  if (!detail && !id && entry.cmd) {
    var command = isArray(entry.cmd) ? entry.cmd[0] : String(entry.cmd).split(/\s+/)[0]
    var executable = isString(command) ? command.split(/[\\/]/).pop() : ""
    if (/^[a-zA-Z0-9_.+-]+$/.test(executable)) detail = executable
  }
  if (id && detail && id !== detail) return id + " · " + detail
  return id || detail || "Connection " + (index + 1)
}

// Build the launch catalog without initializing a connection.
WikiStudioServer.prototype.startMcpSources = function() {
  var options = this.config.mcpOptions || {}
  var mode = MiniALauncher.applyLauncherEnvDefaults({ mode: options.mode }).mode
  if (isString(mode) && mode.trim()) {
    var preset = __miniAResolveModePreset(mode, { basePath: this.config.base, homeDir: options.homedir })
    Object.keys(options).forEach(function(key) {
      if (isUnDef(options[key]) && isDef(preset.params[key])) options[key] = preset.params[key]
    })
  }
  var raw = options.mcp
  if (isString(raw) && raw.trim()) {
    try { raw = JSON.parse(raw) } catch (e) { raw = af.fromJSSLON(raw) }
  }
  WikiStudio.assert(isUnDef(raw) || raw === "" || isMap(raw) || isArray(raw), 400, "invalid_mcp", "Expected an MCP connection or array in JSON or SLON")
  var entries = isArray(raw) ? raw : isMap(raw) ? [raw] : []
  var connections = Object.create(null)
  var base = this.config.base
  var cwd = WikiStudio.canonical(".")
  entries.concat(__miniAPluginDiscover(options).mcpConfigs).forEach(function(entry, index) {
    WikiStudio.assert(isMap(entry), 400, "invalid_mcp", "Expected an MCP connection definition")
    var key = WikiStudio.hash(isString(entry.id) ? entry.id : JSON.stringify(entry))
    if (connections[key]) return
    var config = clone(entry)
    if (config.type === "ojob") {
      var opts = config.options || {}
      var job = opts.job || config.job
      var inspected = MiniALauncher.inspectMcpJobPath(job, [cwd, options.agentDir, base])
      var file = inspected.defaultDir ? new java.io.File(inspected.defaultDir, inspected.jobPath) : new java.io.File(String(job))
      // OpenAF resolves oJob descriptors against a process-wide base when constructing the client.
      if (!__flags.JSONRPC) __flags.JSONRPC = {}
      if (!__flags.JSONRPC.cmd) __flags.JSONRPC.cmd = {}
      if (!__flags.JSONRPC.cmd.defaultDir) __flags.JSONRPC.cmd.defaultDir = base
      opts.job = String(WikiStudio.path(WikiStudio.canonical(__flags.JSONRPC.cmd.defaultDir)).relativize(file.getCanonicalFile().toPath()))
      config.options = opts
    }
    connections[key] = { label: WikiStudio.mcpConnectionLabel(entry, index), config: config }
  })
  // Qualify duplicate display names while keeping saved connection IDs stable.
  var counts = Object.create(null)
  Object.keys(connections).forEach(function(key) {
    var item = connections[key]
    var count = (counts[item.label] || 0) + 1
    counts[item.label] = count
    if (count > 1) item.label += " (" + count + ")"
  })
  if (Object.keys(connections).length) {
    ow.loadObj()
    // Older OpenAF installations expose the bundled Ajv constructor directly.
    if (isFunction(ow.obj.schemaCreate)) this.mcpSchema = ow.obj.schemaCreate()
    else {
      loadAjv()
      this.mcpSchema = { schemaValidate: function(schema, value) {
        return new Ajv({ useDefaults: false, coerceTypes: false }).validate(schema, value)
      } }
    }
  }
  this.mcpConnections = connections
  this.mcpCaptures = new Map()
  this.mcpCaptureLock = new java.util.concurrent.locks.ReentrantLock()
  this.mcpJobLock = new java.util.concurrent.locks.ReentrantLock()
}

// Release abandoned captures even while Studio is idle.
WikiStudioServer.prototype.expireMcpCaptures = function() {
  if (!this.mcpCaptureLock || !this.mcpCaptureLock.tryLock()) return
  try {
    var captures = this.mcpCaptures
    captures.forEach(function(value, key) {
      if (value.expires <= Date.now()) captures.delete(key)
    })
  } finally { this.mcpCaptureLock.unlock() }
}

// Keep Markdown blocks in order and expose complete JSON objects and arrays for selection.
WikiStudio.mcpBlocks = function(result) {
  var blocks = [], unsupported = []
  function textBlock(text) {
    try {
      var json = JSON.parse(text)
      if (isArray(json) || isMap(json)) return { json: json }
    } catch (ignorePlainText) {}
    return { text: text }
  }
  if (isString(result)) blocks.push(textBlock(result))
  else {
    WikiStudio.assert(isMap(result), 422, "invalid_result", "The tool returned no importable result")
    if (result.error && /time.?out|timed out/i.test(String(result.error.message || result.error))) {
      WikiStudio.fail(504, "mcp_timeout", "MCP request timed out. A started call may have taken effect. Call again explicitly if needed.")
    }
    if (result.isError === true || isDef(result.error)) {
      var errorText = result.isError === true && isArray(result.content) ? result.content.filter(function(block) {
        return block && block.type === "text" && isString(block.text)
      })[0] : __
      WikiStudio.fail(502, "mcp_tool_error", errorText ? "Tool error: " + errorText.text.slice(0, 500) : "The MCP tool reported an error. Review its arguments before calling again.")
    }
    var structured = Object.prototype.hasOwnProperty.call(result, "structuredContent")
    if (structured) blocks.push({ json: result.structuredContent })
    if (isArray(result.content)) result.content.forEach(function(block) {
      if (block && block.type === "text" && isString(block.text)) {
        if (!structured) blocks.push(textBlock(block.text))
      } else {
        var type = block && block.type || "unknown"
        if (unsupported.indexOf(type) < 0) unsupported.push(type)
      }
    })
  }
  WikiStudio.assert(blocks.length > 0, 422, "unsupported_result", "No importable content. Unsupported blocks: " + unsupported.join(", "))
  return { blocks: blocks, unsupported: unsupported }
}

// Paths start with a content block number. Array items share their object field paths.
WikiStudio.mcpFields = function(blocks) {
  var fields = [], seen = Object.create(null), limited = false, chars = 0

  // Bound picker metadata independently of the captured result. Whole-result import stays available.
  function add(path) {
    if (fields.length >= 2048 || chars >= 131072) {
      limited = true
      return false
    }
    var key = JSON.stringify(path)
    if (!seen[key]) {
      if (key.length > 2048 || chars + key.length > 131072) {
        limited = true
        return false
      }
      seen[key] = true
      chars += key.length
      fields.push(path)
    }
    return true
  }

  // Merge fields seen at the same location across all array items.
  function visit(value, path, depth) {
    if (depth > 48) {
      limited = true
      return
    }
    if (isArray(value)) {
      value.forEach(function(item) { visit(item, path, depth + 1) })
    } else if (isMap(value)) {
      Object.keys(value).forEach(function(name) {
        var child = path.concat([name])
        if (add(child)) visit(value[name], child, depth + 1)
      })
    }
  }
  blocks.forEach(function(block, i) {
    if (blocks.length === 1 || add([i])) visit(block.json, [i], 0)
  })
  return { paths: fields, limited: limited }
}

// Use one projection for the live document and the sealed revision.
WikiStudio.mcpDocument = function(capture, selection) {
  var root = { children: Object.create(null) }
  if (selection !== null) {
    WikiStudio.assert(isArray(selection) && selection.length > 0 && selection.length <= 2048, 400, "invalid_selection", "Choose at least one available field")
    var allowed = new Set(capture.fields.paths.map(function(path) { return JSON.stringify(path) }))
    selection.forEach(function(path) {
      WikiStudio.assert(allowed.has(JSON.stringify(path)), 400, "field_missing", "A selected field is missing. Revise your selection.")
      var node = root
      path.forEach(function(key) {
        if (!node.children[key]) node.children[key] = { children: Object.create(null) }
        node = node.children[key]
      })
      node.whole = true
    })
  }

  // Preserve array positions, explicit nulls and the original order of object keys.
  function project(value, node) {
    if (node.whole || value === null) return value
    if (isArray(value)) return value.map(function(v) { return project(v, node) })
    var out = Object.create(null)
    if (isMap(value)) Object.keys(value).forEach(function(key) {
      if (node.children[key]) out[key] = project(value[key], node.children[key])
    })
    return out
  }

  // Bound sparse tables before the oafp formatter expands every row to the union of its columns.
  var remaining = capture.limit
  function prepare(value, depth, budget) {
    WikiStudio.assert(depth < 128, 413, "document_limit", "Document is too deeply nested. Select fewer fields.")
    if (isArray(value)) {
      var columns = new Set()
      var table = value.length > 0 && value.every(function(row) {
        return isMap(row) && Object.keys(row).every(function(key) {
          columns.add(key)
          return !isMap(row[key]) && !isArray(row[key])
        })
      })
      if (!table) return value.map(function(item) { return prepare(item, depth + 1, budget) })
      budget.bytes -= (value.length + 2) * (columns.size * 3 + 2)
      WikiStudio.assert(budget.bytes >= 0, 413, "document_limit", "Markdown table exceeds the source or batch limit. Select fewer fields.")

      // Blank defaults distinguish missing cells from null without duplicating all columns in every row.
      var blanks = Object.create(null)
      columns.forEach(function(key) { blanks[key] = "" })
      return value.map(function(row) {
        var out = Object.create(blanks)
        Object.keys(row).forEach(function(key) { out[key] = row[key] })
        return out
      })
    }
    if (!isMap(value)) return value
    var out = Object.create(null)
    Object.keys(value).forEach(function(key) { out[key] = prepare(value[key], depth + 1, budget) })
    return out
  }

  var sections = []
  capture.blocks.forEach(function(block, index) {
    var node = root.children[index]
    if (selection !== null && !node) return
    var section = block.text
    if (!isString(section)) {
      var value = selection === null ? block.json : project(block.json, node)
      if (isMap(value) || isArray(value)) {
        var prepared = prepare(value, 0, { bytes: remaining })
        section = $o(prepared, { __format: "md", mdformat: "structured" }, __, true)
        if (isArray(value) && value.length === 0 && !section.trim()) section = "[]"
      } else {
        section = String(value)
      }
    }
    remaining -= WikiStudio.bytes(section).length + (sections.length ? 2 : 0)
    WikiStudio.assert(remaining >= 0, 413, "document_limit", "Formatted document exceeds the source or batch limit. Select fewer fields.")
    sections.push(section)
  })
  return sections.join("\n\n")
}

// Validate against the current catalog on the same client that will perform the call.
WikiStudioServer.prototype.withMcpSourceTool = function(key, body, fn) {
  var entry = this.mcpConnections[key], client
  WikiStudio.assert(entry, 404, "missing_connection", "This connection is no longer configured")
  var localJob = entry.config.type === "ojob"
  var embedded = localJob || entry.config.type === "dummy"
  // oJob clients register named jobs in the same OpenAF runtime.
  if (localJob) WikiStudio.assert(this.mcpJobLock.tryLock(), 423, "mcp_busy", "Another embedded MCP job is active. Try again after it finishes.")
  try {
    var options = clone(entry.config)
    if (!embedded && isUnDef(options.protocolVersion)) options.protocolVersion = "auto"
    client = $mcp(merge(options, { shared: false, debug: false }))
    client.initialize()
    var capabilities = isFunction(client.getCapabilities) ? client.getCapabilities() : __
    var catalog = isMap(capabilities) && isUnDef(capabilities.tools) ? { tools: [] } : client.listTools()
    WikiStudio.assert(catalog && isArray(catalog.tools), 502, "mcp_catalog", "The connection could not list its tools")
    var tools = catalog.tools.map(function(tool) {
      return { name: tool.name, description: tool.description || "", inputSchema: tool.inputSchema || { type: "object" } }
    })
    if (!body) {
      // Use the handshake already performed for discovery to identify generic transports.
      var info = isFunction(client.getInfo) ? client.getInfo() : __
      var server = (info && info.serverInfo) || {}
      var name = WikiStudio.mcpLabelText(server.title) || WikiStudio.mcpLabelText(server.name)
      entry.displayLabel = name && entry.label !== name ? entry.label + " · " + name : entry.label
      return { items: tools, label: entry.displayLabel }
    }
    var tool = tools.filter(function(item) { return item.name === body.tool })[0]
    WikiStudio.assert(tool, 409, "missing_tool", "This tool is no longer advertised. Choose a tool again.")
    var valid
    try {
      valid = this.mcpSchema.schemaValidate(tool.inputSchema, body.arguments) === true
    } catch (invalid) { valid = false }
    WikiStudio.assert(isMap(body.arguments) && valid, 400, "invalid_arguments", "Arguments do not match this tool's input schema")
    var result
    if (embedded) {
      // Embedded jobs run in-process, so their transport has no socket deadline.
      var completed = $tb(function() {
        result = client.callTool(tool.name, body.arguments)
      }).timeout(entry.config.timeout || 60000).exec()
      WikiStudio.assert(completed === true, 504, "mcp_timeout", "Tool timed out. Check the connected system before explicitly calling again.")
      // Embedded OpenAF jobs can return a native JSON value without an MCP content envelope.
      var envelope = isMap(result) && (isArray(result.content) || isDef(result.structuredContent) || result.isError || isDef(result.error))
      if (!envelope && isDef(result) && !isString(result)) {
        result = { structuredContent: result }
      }
    } else {
      result = client.callTool(tool.name, body.arguments)
    }
    return fn(result)
  } catch (e) {
    if (e.status) throw e
    if (/time.?out|timed out/i.test(String(e))) WikiStudio.fail(504, "mcp_timeout", "MCP request timed out. A started call may have taken effect. Call again explicitly if needed.")
    WikiStudio.fail(502, "mcp_unavailable", body ? "MCP request failed. Check the connection before calling again." : "Could not read tools from this connection. Check the server and try again.")
  } finally {
    if (client && isFunction(client.destroy)) {
      try { client.destroy() } catch (ignoreClosed) {}
    }
    if (localJob) this.mcpJobLock.unlock()
  }
}

// Store a bounded capture. Neither the transport nor the arguments enter the record.
WikiStudioServer.prototype.captureMcpSource = function(w, session, body, result) {
  var config = this.config, limit = Math.min(config.maxSourceBytes, config.maxBatchBytes)
  var encoded = JSON.stringify(result)
  var size = isString(encoded) ? WikiStudio.bytes(encoded).length : 0
  WikiStudio.assert(size > 0 && size <= limit, 413, "mcp_limit", "MCP result exceeds the source or batch limit")
  var data = WikiStudio.mcpBlocks(result)
  var fields = WikiStudio.mcpFields(data.blocks)
  var capture = { wiki: w.id, identity: w.identity, session: session, connection: body.connection, tool: body.tool,
    blocks: data.blocks, fields: fields, limit: limit, expires: Date.now() + 15 * 60 * 1000, size: size }
  var id = WikiStudio.id(), markdown, warning
  try {
    markdown = WikiStudio.mcpDocument(capture, null)
  } catch (e) {
    if (e.code !== "document_limit" || !fields.paths.length) throw e
    warning = e.message
  }
  this.mcpCaptureLock.lock()
  try {
    this.expireMcpCaptures()
    var total = capture.size
    this.mcpCaptures.forEach(function(item) { total += item.size })
    WikiStudio.assert(this.mcpCaptures.size < 64 && total <= config.maxBatchBytes, 429, "capture_limit", "Studio's capture storage is full. Stage a result or wait for captures to expire.")
    this.mcpCaptures.set(id, capture)
  } finally { this.mcpCaptureLock.unlock() }
  return { resultId: id, fields: fields.paths, limited: fields.limited, unsupported: data.unsupported, markdown: markdown, warning: warning }
}

// Seal a single Markdown file through the same source publisher as browser uploads.
WikiStudioServer.prototype.stageMcpSource = function(w, capture, body, markdown) {
  var id = WikiStudio.name(body.id), uploadId = WikiStudio.id()
  var dir = this.config.home + "/sources/uploads/" + uploadId
  var bytes = WikiStudio.bytes(markdown)
  WikiStudio.assert(bytes.length <= Math.min(this.config.maxSourceBytes, this.config.maxBatchBytes), 413, "mcp_limit", "Selected document exceeds the source or batch limit")
  WikiStudio.privateDir(dir + "/files")
  try {
    // These names are reserved for wiki instructions and generated pages.
    var stem = ["agents", "index", "log"].indexOf(id) >= 0 ? "source-" + id : id
    var path = WikiStudio.safeFile(dir + "/files", stem + ".md", true)
    java.nio.file.Files.write(WikiStudio.path(path), bytes)
    return this.sourceAdd(w, { id: id, name: body.name, adhoc: body.adhoc, type: "upload", uploadId: uploadId }, {
      origin: { connection: capture.connection, tool: capture.tool, selection: body.selection },
      expectedRevision: body.expectedRevision
    })
  } catch (e) {
    io.rm(dir)
    throw e
  }
}

// Capture capabilities are specific to one authenticated browser session and wiki root.
WikiStudioServer.prototype.mcpSourceRoute = function(req, w, action, role) {
  WikiStudio.authorize(role, "admin", w)
  var body = req.body || {}, self = this
  if (action === "connections" && req.method === "GET") return { items: Object.keys(this.mcpConnections).map(function(key) {
    return { id: key, label: self.mcpConnections[key].displayLabel || self.mcpConnections[key].label }
  }) }
  if (action === "tools" && req.method === "GET") return this.withMcpSourceTool(req.query.connection)
  WikiStudio.assert(req.method === "POST" && ["call", "preview", "stage"].indexOf(action) >= 0, 405, "method_not_allowed", "Unknown MCP source operation")
  var session = req.headers["x-studio-session"]
  WikiStudio.assert(isString(session) && /^[a-f0-9-]{36}$/.test(session), 400, "invalid_session", "Supply a Studio session UUID")
  if (action === "call") {
    WikiStudio.fields(body, ["connection", "tool", "arguments"])
    return this.withMcpSourceTool(body.connection, body, function(result) { return self.captureMcpSource(w, session, body, result) })
  }
  WikiStudio.fields(body, action === "stage" ? ["resultId", "selection", "id", "name", "adhoc", "expectedRevision"] : ["resultId", "selection"])
  this.mcpCaptureLock.lock()
  try {
    var capture = this.mcpCaptures.get(body.resultId)
    WikiStudio.assert(capture && capture.expires > Date.now() && capture.wiki === w.id && capture.identity === w.identity && capture.session === session,
      410, "capture_expired", "This result is unavailable. Call the tool explicitly to capture a fresh result.")
    var markdown = WikiStudio.mcpDocument(capture, body.selection)
    if (action === "preview") return { markdown: markdown }
    var source = WikiStudio.wikiLock(this.config.home, w.id, function() {
      var current = self.registry.verify(self.registry.get(w.id))
      WikiStudio.authorize(role, "admin", current)
      WikiStudio.assert(current.identity === capture.identity, 410, "capture_expired", "Wiki root changed. Capture a fresh result.")
      return self.stageMcpSource(current, capture, body, markdown)
    })
    this.mcpCaptures.delete(body.resultId)
    return source
  } finally { this.mcpCaptureLock.unlock() }
}
