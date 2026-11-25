// Retain the initiating agent through the synchronous embedded proxy dispatch.
var __miniAMcpCallingAgent = new java.lang.ThreadLocal()

// Keep protocol control responses out of tool output, caches and traces.
function __miniAMcpPending(result) {
  return isMap(result) && ["task", "input_required"].indexOf(result.resultType) >= 0
}

// Return an actionable error without echoing protocol state or elicitation data.
function __miniAMcpFailure(message) {
  return { error: message, content: [{ type: "text", text: message }], isError: true, retryable: false }
}

// Display server-supplied text as plain text without terminal control sequences.
function __miniAMcpLabel(value) {
  return String(value || "").replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, " ").substring(0, 1200)
}

// Match OpenAF's transport default for descriptors containing only a URL.
function __miniAMcpType(config) {
  var type = String(config.type || "stdio").toLowerCase()
  return type === "stdio" && isDef(config.url) && isUnDef(config.cmd) ? "remote" : type
}

// Bind interaction callbacks to this Mini-A instance before negotiation.
MiniA.prototype._configureMcpClient = function(client, config, interactionArgs) {
  var parent = this
  client.__miniAMcpIdentity = this._mcpServerIdentity(config)
  client.__miniAMcpLocal = __miniAMcpType(config) === "stdio"
  client.__miniAMcpLabel = __miniAMcpLabel(config.id || config.name || "MCP server")
  if ((this._canPromptMcp(interactionArgs) || interactionArgs && interactionArgs.__mcpPromptPrewarm === true) &&
      isFunction(client.onElicitationRequest)) {
    client.__miniAMcpPromptLock = new java.util.concurrent.locks.ReentrantLock()
    client.__miniAMcpPromptOwner = new java.util.concurrent.atomic.AtomicReference()
    client.onElicitationRequest(function(params) {
      if (String(client.__miniAMcpPromptOwner.get()) !== String(parent._id)) return { action: "cancel" }
      return parent._answerMcpElicitation(client, params)
    }, { form: {}, url: {} })
  }
  return client
}

// A Skills server can publish resources without implementing tools/list.
MiniA.prototype._listMcpToolCatalog = function(client) {
  var caps = isFunction(client.getCapabilities) ? client.getCapabilities() : {}
  if (caps && !isMap(caps.tools) && isMap(caps.extensions) &&
      isMap(caps.extensions["io.modelcontextprotocol/skills"])) return { tools: [] }
  return client.listTools()
}

// Summarize negotiated features without exposing transport or authentication details.
MiniA.prototype._describeMcpFeatures = function(client, args) {
  if (!client.__miniAMcpIdentity || !isFunction(client.getCapabilities)) return
  var info = isFunction(client.getInfo) ? client.getInfo() : {}
  var server = info && info.serverInfo
  if (server && isString(server.name) && client.__miniAMcpLabel === "MCP server") client.__miniAMcpLabel = __miniAMcpLabel(server.name)
  var caps = client.getCapabilities(), extensions = caps && caps.extensions || {}
  var tasks = isFunction(client.getTask) && isMap(extensions["io.modelcontextprotocol/tasks"])
  var skills = isFunction(client.listSkills) && isMap(extensions["io.modelcontextprotocol/skills"])
  var version = info && info.protocolVersion || ""
  var prompt = client.__miniAMcpPromptLock && version >= "2025-06-18"
  if (!tasks && !skills && !prompt && version < "2026-07-28") return
  this.fnI("mcp", client.__miniAMcpLabel + " · " + version + " · tasks " + (tasks ? "available" : "unavailable") +
    " · elicitation " + (prompt ? version >= "2025-11-25" ? "form and URL" : "form" : "unavailable") +
    " · skills " + (skills ? (toBoolean(args.useskills) === true ? "available" : "disabled") +
      " (server " + client.__miniAMcpIdentity.substring(0, 12) + ")" : "unavailable"))
}

// Include the effective stdio directory in the identity used for recovery.
MiniA.prototype._mcpServerIdentity = function(config) {
  var descriptor = merge({}, config)
  var type = __miniAMcpType(descriptor)
  if (type === "stdio" && !isString(descriptor.pwd)) {
    var defaultDir = __flags.JSONRPC && __flags.JSONRPC.cmd && __flags.JSONRPC.cmd.defaultDir
    descriptor.pwd = defaultDir || "."
  }
  if (type === "stdio") descriptor.pwd = String(new java.io.File(descriptor.pwd).getCanonicalPath())
  return sha256(this._stableStringify(descriptor))
}

// Bind inbound legacy callbacks to the current dispatch for this client.
MiniA.prototype._withMcpPromptOwner = function(client, fn) {
  var lock = client.__miniAMcpPromptLock
  var previous = __miniAMcpCallingAgent.get()
  var owner = previous === null ? this : previous
  if (lock) lock.lock()
  try {
    if (lock) client.__miniAMcpPromptOwner.set(String(owner._id))
    __miniAMcpCallingAgent.set(owner)
    return fn()
  } finally {
    if (lock) {
      client.__miniAMcpPromptOwner.set(null)
      lock.unlock()
    }
    if (previous === null) __miniAMcpCallingAgent.remove()
    else __miniAMcpCallingAgent.set(previous)
  }
}

// Only foreground sessions advertise human interaction.
MiniA.prototype._canPromptMcp = function(args) {
  args = args || this._mcpInteractionArgs || this._lastStartArgs || {}
  if (toBoolean(args.workermode) === true) return false
  if (args.__interaction_source === "mini-a-web") return isFunction(this._userInputFn)
  return args.__interaction_source === "mini-a-con" &&
    (isFunction(this._userInputFn) || isFunction(this._confirmFn) || java.lang.System.console() !== null)
}

// Reuse the session adapter or the shared terminal input lock.
MiniA.prototype._mcpPrompt = function(label, choices, url) {
  if (!this._canPromptMcp() || this._stopRequested === true) throw new Error("MCP interaction unavailable")
  if (isFunction(this._userInputFn)) return this._userInputFn({
    private: true, label: label, choices: choices, url: url
  })
  var parent = this
  var read = function() {
    if (isArray(choices)) return askChoose(label, choices)
    return ask(label + " ")
  }
  return isString(parent._terminalInputLock) ? syncFn(read, parent._terminalInputLock) : read()
}

// Decode one supported flat-schema field, preserving typed and optional values.
function __miniAMcpField(schema) {
  var choices, labels
  var list = schema.type === "array" ? schema.items : schema
  if (isMap(list) && isArray(list.enum)) {
    choices = list.enum
    labels = choices.map(String)
  } else if (isMap(list) && isArray(schema.type === "array" ? list.anyOf : list.oneOf)) {
    var items = schema.type === "array" ? list.anyOf : list.oneOf
    choices = items.map(function(item) { return item.const })
    labels = items.map(function(item) { return __miniAMcpLabel(item.title || item.const) })
  } else if (schema.type === "boolean") {
    choices = [true, false]
    labels = ["Yes", "No"]
  }
  if (["string", "boolean", "number", "integer", "array"].indexOf(schema.type) < 0 ||
      schema.type === "array" && (!choices || choices.some(function(value) { return !isString(value) }))) {
    throw new Error("Unsupported MCP form field")
  }
  return { choices: choices, labels: labels }
}

// Handle form and URL requests without passing the question or answer to a model.
MiniA.prototype._answerMcpElicitation = function(client, request) {
  var parent = this
  if (!this._canPromptMcp() || !isMap(request)) return { action: "cancel" }
  var server = client.__miniAMcpLabel
  var message = server + " · " + __miniAMcpLabel(request.message)
  try {
    if (request.mode === "url") {
      var uri = new java.net.URI(request.url)
      if (String(uri.getScheme()).toLowerCase() !== "https" || uri.getHost() === null || uri.getUserInfo() !== null) return { action: "decline" }
      var host = String(uri.getHost()) + (uri.getPort() < 0 ? "" : ":" + uri.getPort())
      var consent = this._mcpPrompt(message + "\nDestination: " + host, ["Allow navigation", "Decline", "Cancel"])
      if (consent !== 0) return { action: consent === 1 ? "decline" : "cancel" }
      var next = this._mcpPrompt("Complete the interaction at " + host + ", then continue." +
        (isFunction(this._userInputFn) ? "" : "\n" + String(uri.toASCIIString())),
        ["Continue", "Cancel"], String(uri.toASCIIString()))
      return { action: next === 0 ? "accept" : "cancel" }
    }
    if (isDef(request.mode) && request.mode !== "form") return { action: "decline" }

    var schema = request.requestedSchema
    if (!isMap(schema) || schema.type !== "object" || !isMap(schema.properties)) return { action: "decline" }
    var keys = Object.keys(schema.properties)
    var fields = keys.map(function(key) { return __miniAMcpField(schema.properties[key]) })
    var begin = this._mcpPrompt(message + "\nRequested fields: " + keys.map(__miniAMcpLabel).join(", "), ["Fill in form", "Decline", "Cancel"])
    if (begin !== 0) return { action: begin === 1 ? "decline" : "cancel" }
    var values = Object.create(null)
    ow.loadObj()
    // Validate the supported subset without applying defaults to skipped fields.
    var validation = { type: "object", properties: Object.create(null), required: schema.required || [] }
    keys.forEach(function(key, index) {
      var source = schema.properties[key], property = {}
      ;["type", "minLength", "maxLength", "format", "minimum", "maximum", "minItems", "maxItems"].forEach(function(attribute) {
        if (isDef(source[attribute])) property[attribute] = source[attribute]
      })
      var choices = fields[index].choices
      if (source.type === "array") property.items = { type: "string", enum: choices }
      else if (choices) property.enum = choices
      validation.properties[key] = property
    })
    var validate = isFunction(ow.obj.schemaCompile) ? ow.obj.schemaCompile(validation) : __
    while (!this._stopRequested) {
      keys.forEach(function(key, index) {
        var prop = schema.properties[key], field = fields[index]
        var required = validation.required.indexOf(key) >= 0
        var initial = isDef(values[key]) ? values[key] : prop.default
        var label = server + " · " + __miniAMcpLabel(prop.title || key) +
          (prop.description ? " (" + __miniAMcpLabel(prop.description) + ")" : "")
        var value
        if (field.choices && prop.type !== "array") {
          var labels = field.labels.slice()
          if (isDef(initial)) labels.push("Keep " + __miniAMcpLabel(stringify(initial, __, "")))
          if (!required) labels.push("Skip field")
          labels.push("Cancel form")
          var selected = parent._mcpPrompt(label, labels)
          if (!isNumber(selected) || selected < 0 || selected >= labels.length - 1) throw new Error("MCP form cancelled")
          value = selected < field.choices.length ? field.choices[selected] : labels[selected] === "Skip field" ? __ : initial
        } else if (prop.type === "array") {
          var mode = parent._mcpPrompt(label, ["Choose values"].concat(isDef(initial) ? ["Keep " + __miniAMcpLabel(stringify(initial, __, ""))] : [], required ? [] : ["Skip field"], ["Cancel form"]))
          if (mode === 0) {
            value = []
            field.choices.forEach(function(item, i) {
              var pick = parent._mcpPrompt(label + " · " + field.labels[i], ["Include", "Omit", "Cancel form"])
              if (pick !== 0 && pick !== 1) throw new Error("MCP form cancelled")
              if (pick === 0) value.push(item)
            })
          } else if (mode === 1 && isDef(initial)) value = initial
          else if (required || mode !== (isDef(initial) ? 2 : 1)) throw new Error("MCP form cancelled")
        } else {
          if (!required || isDef(initial)) {
            var actions = ["Enter value"].concat(isDef(initial) ? ["Keep " + __miniAMcpLabel(stringify(initial, __, ""))] : [], required ? [] : ["Skip field"], ["Cancel form"])
            var edit = parent._mcpPrompt(label, actions)
            if (!isNumber(edit) || edit < 0 || edit >= actions.length - 1) throw new Error("MCP form cancelled")
            if (edit !== 0) {
              if (actions[edit] === "Skip field") delete values[key]
              else values[key] = initial
              return
            }
          }
          var raw = parent._mcpPrompt(label)
          if (!isString(raw)) throw new Error("MCP form cancelled")
          value = prop.type === "string" ? raw : raw.trim() === "" ? null : Number(raw)
        }
        if (isDef(value)) values[key] = value
        else delete values[key]
      })
      var valid = false
      try { valid = isFunction(validate) ? validate(values) : ow.obj.schemaValidate(validation, values) === true }
      catch(ignoreValidationError) {}
      var review = this._mcpPrompt(valid ? message + "\nReview: " + stringify(values, __, "") :
        server + " · The values do not match the requested form. Edit the entries or cancel.",
        valid ? ["Submit", "Edit", "Decline", "Cancel"] : ["Edit", "Decline", "Cancel"])
      if (valid && review === 0) return { action: "accept", content: values }
      if (review === (valid ? 1 : 0)) continue
      return { action: review === (valid ? 2 : 1) ? "decline" : "cancel" }
    }
  } catch(ignoreDismissedInteraction) {}
  return { action: "cancel" }
}

// Poll a known handle and never replay the original tool call.
MiniA.prototype._waitMcpTask = function(client, record, task) {
  var parent = this, taskId = record.taskId
  var next = task, status, expires = Infinity, failures = 0, sent = Object.create(null), cancelling = false
  var stopDeadline = Infinity
  this._activeMcpTasks = this._activeMcpTasks || new java.util.concurrent.ConcurrentHashMap()
  var active = { client: client, record: record, cancelled: new java.util.concurrent.atomic.AtomicBoolean(false) }
  this._activeMcpTasks.put(record.id, active)
  try {
    while (true) {
      if (this._stopRequested && !cancelling) {
        cancelling = true
        stopDeadline = now() + 5000
        this._cancelMcpTask(active)
      }
      if (now() >= expires) return __miniAMcpFailure("MCP task expired before a terminal result was available.")
      if (now() >= stopDeadline) return __miniAMcpFailure("MCP task cancellation was requested. Its final status is unknown.")
      if (isUnDef(next) || next.resultType === "task" && next.status !== "working") {
        try { next = client.getTask(taskId) }
        catch(ignorePollError) {
          if (++failures >= 3) return __miniAMcpFailure("MCP task could not be reached. Resume the run to check its status.")
          sleep(250 * failures)
          continue
        }
        failures = 0
      }
      if (!isMap(next) || next.taskId !== taskId) {
        return __miniAMcpFailure("MCP task expired, is inaccessible, or returned an invalid status.")
      }
      if (isNumber(next.ttlMs) && next.ttlMs >= 0) expires = now() + next.ttlMs
      if (next.status !== status) {
        status = next.status
        this.fnI("mcp", client.__miniAMcpLabel + " · " + record.tool + " · " + status +
          (next.statusMessage ? " · " + __miniAMcpLabel(next.statusMessage) : ""))
      }
      if (status === "completed" && isMap(next.result)) return this._saveMcpTerminalResult(client, record, next.result)
      if (status === "failed") return this._saveMcpTerminalResult(client, record, __miniAMcpFailure("MCP task failed" +
        (isMap(next.error) && isNumber(next.error.code) ? " (code " + next.error.code + ")" : "") + "."))
      if (status === "cancelled") return this._saveMcpTerminalResult(client, record, __miniAMcpFailure("MCP task was cancelled."))
      if (status !== "working" && status !== "input_required") return __miniAMcpFailure("MCP task returned an unsupported status.")
      if (status === "input_required" && !cancelling && isMap(next.inputRequests)) {
        var responses = Object.create(null)
        Object.keys(next.inputRequests).forEach(function(key) {
          if (sent[key]) return
          var request = next.inputRequests[key]
          responses[key] = isMap(request) && request.method === "elicitation/create" ? parent._answerMcpElicitation(client, request.params) : { action: "cancel" }
          sent[key] = true
        })
        if (Object.keys(responses).length) {
          try {
            var updated = client.updateTask(taskId, responses)
            if (isMap(updated) && isDef(updated.error)) return __miniAMcpFailure("MCP task rejected the submitted input.")
          } catch(ignoreUnconfirmedUpdate) {
            // A lost acknowledgement may follow a successful update. Read status only.
          }
        }
      }
      var interval = isNumber(next.pollIntervalMs) && next.pollIntervalMs > 0 ? next.pollIntervalMs : 1000
      var until = Math.min(now() + interval, expires)
      while (now() < until && (!this._stopRequested || cancelling) && now() < stopDeadline) sleep(Math.min(100, Math.max(1, until - now())))
      next = __
    }
  } finally {
    this._activeMcpTasks.remove(record.id)
  }
}

// Retain local results across the server TTL. Remote tasks recheck the authenticated principal on resume.
MiniA.prototype._saveMcpTerminalResult = function(client, record, result) {
  if (client.__miniAMcpLocal && this._runState && this._runState.persist && stringify(result, __, "").length <= 1024 * 1024) {
    record.terminal = result
    try { this._writeRunState() }
    catch(ignoreCheckpointFailure) { this.fnI("warn", "MCP task result could not be checkpointed.") }
  }
  return result
}

// Forward run cancellation to each known task before closing MCP transports.
MiniA.prototype._cancelMcpTask = function(active) {
  if (!active.cancelled.compareAndSet(false, true)) return
  this.fnI("mcp", active.client.__miniAMcpLabel + " · " + active.record.tool + " · cancellation requested")
  try { active.client.cancelTask(active.record.taskId) } catch(ignoreCancellationError) {}
}

// Continue an explicitly elicited request and checkpoint a returned task handle.
MiniA.prototype._resolveMcpPending = function(client, toolName, params, result, fingerprint, callContext) {
  var rounds = 0
  while (isMap(result) && result.resultType === "input_required") {
    if (++rounds > 16 || !this._canPromptMcp() || !isFunction(client.continueRequest)) return __miniAMcpFailure("MCP tool needs input that this run cannot provide.")
    this._mcpContinuation.set("active")
    try {
      result = this._withMcpPromptOwner(client, function() {
        return client.continueRequest("tools/call", { name: toolName, arguments: params }, result)
      })
    }
    catch(ignoreContinuationError) { return __miniAMcpFailure("MCP tool continuation failed. Its outcome may be unknown.") }
    finally { this._mcpContinuation.remove() }
  }
  if (!isMap(result) || result.resultType !== "task") return result
  if (!isString(result.taskId) || !result.taskId.length || !isFunction(client.getTask)) {
    return __miniAMcpFailure("MCP tool returned a task handle that this runtime cannot follow.")
  }
  var record = { id: callContext && callContext.contextId || genUUID(), server: client.__miniAMcpIdentity,
    taskId: result.taskId, tool: toolName, fingerprint: fingerprint }
  var run = this._runState
  if (run) {
    try {
      sync(function() {
        var wasDurable = run.persist
        if (!wasDurable) io.mkdir(run.runDir)
        if (!isArray(run.state.mcp_tasks)) run.state.mcp_tasks = []
        run.state.mcp_tasks.push(record)
        run.persist = true
        try { this._writeRunState() }
        catch(e) {
          run.persist = wasDurable
          throw e
        }
        if (!wasDurable) this.fnI("mcp", "MCP task recovery is available with resumerun=" + run.runId)
      }.bind(this), run.statePath + ":mcp")
    } catch(ignorePersistenceError) {
      this.fnI("warn", "MCP task recovery could not be saved. The current session can still wait for it.")
    }
  }
  return this._waitMcpTask(client, record, result)
}

// Enumerate actual server connections, including tool-free skill providers.
MiniA.prototype._mcpFeatureClients = function() {
  var direct = this._mcpConnections || {}, proxy = this._mcpProxyState && this._mcpProxyState.connections || {}
  return Object.keys(direct).map(function(key) { return direct[key] }).concat(Object.keys(proxy).map(function(key) { return proxy[key].client }))
    .filter(function(client, index, clients) { return client && isString(client.__miniAMcpIdentity) && clients.indexOf(client) === index })
}

// Recover known results before allowing the resumed goal to issue any tool calls.
MiniA.prototype._recoverMcpTasks = function(args) {
  this._recoveredMcpTasks = Object.create(null)
  var run = this._runState
  if (!args.resumerun || !run || !isArray(run.state.mcp_tasks)) return []
  var clients = this._mcpFeatureClients(), parent = this
  return run.state.mcp_tasks.map(function(record) {
    var client = clients.filter(function(item) { return item.__miniAMcpIdentity === record.server })[0]
    var result = client && client.__miniAMcpLocal && isMap(record.terminal) ? record.terminal :
      client && isFunction(client.getTask) ? parent._waitMcpTask(client, record) :
      __miniAMcpFailure("MCP task requires its original connection to resume.")
    parent._recoveredMcpTasks[record.fingerprint] = result
    return { id: record.id, tool: record.tool, result: result }
  })
}

// Discover only manifest metadata. Bind every handle to the connection that supplied it.
MiniA.prototype._remoteSkillCatalog = function() {
  var parent = this, catalog = []
  this._mcpFeatureClients().forEach(function(client) {
    var caps = isFunction(client.getCapabilities) ? client.getCapabilities() : {}
    if (!caps.extensions || !isMap(caps.extensions["io.modelcontextprotocol/skills"]) || !isFunction(client.listSkills)) return
    try {
      var response = client.listSkills()
      if (!isArray(response.skills)) return
      response.skills.forEach(function(entry) {
        var item = parent._remoteSkillCandidate(client, entry)
        if (item && !catalog.some(function(existing) { return existing.id === item.id })) catalog.push(item)
      })
    } catch(ignoreUnavailableSkillCatalog) {
      parent.fnI("mcp", client.__miniAMcpLabel + " · skill catalog unavailable")
    }
  })
  return catalog
}

// Use a source-qualified handle that remains stable across list and direct lookup.
MiniA.prototype._remoteSkillCandidate = function(client, entry) {
  if (!isMap(entry) || !isString(entry.uri) || !isMap(entry.frontmatter) ||
      !isString(entry.frontmatter.name) || !isString(entry.frontmatter.description)) return __
  var origin = client.__miniAMcpIdentity.substring(0, 12)
  var id = "mcp:" + origin + ":" + sha256(entry.uri).substring(0, 16)
  return { id: id, name: entry.frontmatter.name, description: entry.frontmatter.description,
    source: "mcp", origin: client.__miniAMcpLabel, client: client, entry: entry,
    disableModelInvocation: toBoolean(entry.frontmatter["disable-model-invocation"]) === true }
}

// Resolve an unlisted URI on an explicitly selected origin.
MiniA.prototype._lookupRemoteSkill = function(name) {
  var match = String(name || "").match(/^mcp:([a-f0-9]{12}):(.+:.+)$/)
  if (!match) return __
  var clients = this._mcpFeatureClients().filter(function(client) {
    return client.__miniAMcpIdentity.substring(0, 12) === match[1]
  })
  if (clients.length !== 1 || !isFunction(clients[0].getSkill)) return __
  try { return this._remoteSkillCandidate(clients[0], clients[0].getSkill(match[2]).skill) }
  catch(ignoreUnknownSkill) { return __ }
}

// Approve the complete manifest before requesting any file. Web grants stay session-local.
MiniA.prototype._approveRemoteSkill = function(item, manifest, approval) {
  this._remoteSkillApprovals = this._remoteSkillApprovals || Object.create(null)
  var args = this._mcpInteractionArgs || this._lastStartArgs || {}
  var local = args.__interaction_source !== "mini-a-web" && toBoolean(args.workermode) !== true
  var preferences
  if (local) {
    try { preferences = java.util.prefs.Preferences.userRoot().node("org/openaf/mini-a/mcp-skills") }
    catch(ignorePreferences) {}
  }
  var key = sha256(item.client.__miniAMcpIdentity + "\n" + item.entry.uri)
  if (this._remoteSkillApprovals[key] === approval || preferences && String(preferences.get(key, "")) === approval) return
  delete this._remoteSkillApprovals[key]
  if (preferences) {
    try { preferences.remove(key); preferences.flush() } catch(ignoreRevokeFailure) {}
  }
  if (!this._canPromptMcp()) throw new Error("remote-skill-needs-approval")
  if (this._mcpPrompt(item.origin + " · Load skill " + __miniAMcpLabel(item.name) + "?\n" +
      __miniAMcpLabel(item.entry.uri) + " · " + manifest.length + " files · " + approval.substring(0, 12),
      ["Approve instructions", "Decline"]) !== 0) throw new Error("remote-skill-approval-denied")
  this._remoteSkillApprovals[key] = approval
  if (preferences) {
    try { preferences.put(key, approval); preferences.flush() } catch(ignorePersistFailure) {}
  }
}

// Read a single verified text resource within the approved manifest.
MiniA.prototype._loadRemoteSkill = function(item, params) {
  var runtime = this._skillRuntime, entry = item.entry, client = item.client
  var manifest = entry.resources
  if (!isArray(manifest) || !manifest.length || manifest.length > 512) throw new Error("remote-skill-manifest-required")
  var total = 0, files = Object.create(null)
  manifest.forEach(function(file) {
    if (!isMap(file) || !isString(file.uri) || files[file.uri] || !/^sha256:[a-f0-9]{64}$/.test(file.digest) ||
        !isNumber(file.size) || file.size < 0 || Math.floor(file.size) !== file.size) throw new Error("invalid-remote-skill-manifest")
    files[file.uri] = file
    total += file.size
  })
  if (total > 16 * 1024 * 1024 || !files[entry.uri]) throw new Error("invalid-remote-skill-manifest")
  var revision = sha256(this._stableStringify(Object.keys(files).sort().map(function(uri) { return files[uri] })))
  var active = runtime.records[item.id]
  if (active && active.revision !== revision) {
    runtime.block(item.id, "skill-source-revision-changed")
    this._syncSkillContext(this._runtime)
    throw new Error("skill-source-revision-changed")
  }
  if (runtime.reserve(item.id)) throw new Error("skills-max-loaded-exceeded")
  var uri = new java.net.URI(entry.uri)
  var root = uri.resolve(".")
  var target = entry.uri
  if (params.reference) {
    if (!active || active.state !== "active") throw new Error("activate-remote-skill-before-reading-references")
    var relative = new java.net.URI(params.reference)
    if (relative.isAbsolute() || relative.getRawAuthority() !== null || relative.getRawQuery() !== null || relative.getRawFragment() !== null ||
        /^(\/)|(^|\/)\.\.(\/|$)/.test(String(relative.getPath()))) throw new Error("remote-skill-reference-must-be-relative")
    target = String(root.resolve(relative).normalize())
  }
  if (!files[target]) throw new Error("remote-skill-reference-outside-manifest")
  this._approveRemoteSkill(item, manifest, revision)
  var response = client.readResource(target)
  var resource = response && isArray(response.contents) && response.contents.length === 1 ? response.contents[0] : __
  if (!isMap(resource) || resource.uri !== target || !isString(resource.text)) throw new Error("remote-skill-text-resource-unavailable")
  var bytes = new java.lang.String(resource.text).getBytes("UTF-8")
  if (bytes.length !== files[target].size || "sha256:" + sha256(bytes) !== files[target].digest) {
    // Refresh metadata for the next activation. The rejected bytes never enter context.
    try { client.getSkill(entry.uri) } catch(ignoreRefreshFailure) {}
    if (active) {
      runtime.block(item.id, "remote-skill-integrity-check-failed")
      this._syncSkillContext(this._runtime)
    }
    throw new Error("remote-skill-integrity-check-failed")
  }
  var body = resource.text
  if (target === entry.uri) {
    var head = body.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
    if (!head || this._stableStringify(af.fromYAML(head[1])) !== this._stableStringify(entry.frontmatter) ||
        String(uri.getPath()).split("/").slice(-2).join("/") !== item.name + "/SKILL.md" &&
        !(String(uri.getPath()) === "/SKILL.md" && String(uri.getHost()) === item.name)) {
      throw new Error("remote-skill-frontmatter-mismatch")
    }
    body = body.substring(head[0].length)
  }
  var limit = Math.max(0, Math.min(runtime.maxChars - runtime.chars, Number(params.maxChars) || 8000))
  var page = __miniASkillPage(body, limit, params.section)
  if (page.error) throw new Error(page.error)
  runtime.consume(item.id, page.chars)
  return merge(page, { rendered: "[MCP skill from " + item.origin + "]\n" + page.body, progressive: true,
    revision: revision, reference: params.reference, referenceRevision: files[target].digest,
    referencedFiles: target === entry.uri ? Object.keys(files).filter(function(fileUri) {
      return fileUri !== target && !root.relativize(new java.net.URI(fileUri)).isAbsolute()
    }).map(function(fileUri) { return { relativePath: String(root.relativize(new java.net.URI(fileUri))) } }) : [] })
}

// Expose remote metadata and reads through the existing skills tool on both surfaces.
MiniA.prototype._remoteSkillToolResult = function(payload, localResult) {
  var op = String(payload.operation || "").toLowerCase()
  var name = String(payload.name || "")
  if (name.indexOf("mcp:") === 0) {
    if (["", "read", "render", "invoke"].indexOf(op) < 0) return { error: "Unsupported remote skill operation" }
    var item = this._remoteSkillCatalog().filter(function(candidate) { return candidate.id === name })[0] || this._lookupRemoteSkill(name)
    if (!item || item.disableModelInvocation) return { error: "Remote skill unavailable for model invocation" }
    try {
      var result = this._loadRemoteSkill(item, payload)
      this._recordSkillContent(item.id, result, item)
      return { skill: item.id, origin: item.origin, revision: result.revision,
        reference: result.reference, referencedFiles: result.referencedFiles, pendingSections: result.pendingSections }
    } catch(e) {
      return { error: __miniAMcpLabel(__miniAErrMsg(e)) }
    }
  }
  if ((op === "list" || op === "search") && isMap(localResult) && isArray(localResult.skills)) {
    var query = String(payload.query || "").toLowerCase()
    var skills = this._remoteSkillCatalog().filter(function(item) {
      return !item.disableModelInvocation && (item.name + " " + item.description).toLowerCase().indexOf(query) >= 0
    }).map(function(item) {
      return payload.compact === true ? item.id : { name: item.id, description: item.description, origin: item.origin, sourceType: "mcp" }
    })
    return merge(localResult, { skills: localResult.skills.concat(skills), count: localResult.skills.length + skills.length })
  }
  return localResult
}
