// Advanced web transport for the shared interactive session. No command implementations here.
function MiniAAdvanced(args) {
  this.args = args
  this.schedule = function(fn) { return $doV(fn) }
  this.submitPrompt = function(request) { return MiniAWebPrompt(request) }
  this.sessions = {}
  this.lock = new java.util.concurrent.locks.ReentrantLock()
  this.root = String(args.webadvancedpath || ((isDef(__gHDir) ? __gHDir() : java.lang.System.getProperty("user.home")) + "/.openaf-mini-a/web"))
  this.root = String(new java.io.File(this.root).getCanonicalPath())
  io.mkdir(this.root)
  this.presetPath = this.root + "/presets.json"
  this.presets = io.fileExists(this.presetPath) ? io.readFileJSON(this.presetPath) : { presets: {} }
}

MiniAAdvanced.prototype.removeSession = function(uuid) {
  var state = this.sessions[uuid]
  if (state) state.runtime.dispose()
  delete this.sessions[uuid]
  global._mini_a_web_dispose(uuid)
  delete global.__res[uuid]
  delete global.__lastActivity[uuid]
  ;[".json", ".ndjson"].forEach(function(ext) {
    var path = this.root + "/" + uuid + ext
    if (io.fileExists(path)) io.rm(path)
  }, this)
}

MiniAAdvanced.prototype.pruneHistory = function() {
  this.lock.lock()
  try {
    var self = this
    Object.keys(this.sessions).forEach(function(uuid) {
      if (self.sessions[uuid] && global.__busy[uuid] !== true) self.sessions[uuid].runtime.pruneHistory(false)
    })
  } finally { this.lock.unlock() }
}

MiniAAdvanced.prototype.isServerOption = function(key) {
  return /^(web|onport|historypath|historys3|historyretention|ssequeuetimeout|memorysessionheader|logpromptheaders|homedir|conversation|useeditor|editor|maxpromptchars|path$|useattach$)/.test(key)
}

MiniAAdvanced.prototype.safe = function(value, key) {
  var self = this
  if (isUnDef(value)) return value
  if (/^key$|^token$|api.?key|access.?key|secret|pass(?:word)?$|authorization|credential|webtoken|workerregtoken/i.test(key || "")) return "[redacted]"
  if (isArray(value)) return value.map(function(v) { return self.safe(v) })
  if (isMap(value)) {
    var out = {}
    Object.keys(value).forEach(function(k) { out[k] = self.safe(value[k], k === "value" && isString(value.parameter) ? value.parameter : k) })
    return out
  }
  if (isString(value)) {
    // Model settings are commonly SLON strings, rather than objects.
    if (/^\s*[({]/.test(value)) {
      try { var parsed = af.fromJSSLON(value); if (isMap(parsed) || isArray(parsed)) return self.safe(parsed) } catch(ignore) {}
    }
    value = value.replace(/(\/set\s+(?:\w*(?:secret|password|accesskey|apikey|webtoken|workerregtoken|secpass|falkorpass))\s*(?:=|\s)\s*)[^\n]+/ig, "$1[redacted]")
    return value.replace(/((?:key|api[_-]?key|token|password|secret|authorization|secpass|falkorpass)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,)}]+)/ig, "$1[redacted]")
  }
  return value
}

// Keep saved model selections while resolving credentials from the current server/session.
MiniAAdvanced.prototype.mergeOptions = function(base, override) {
  var out = merge(base, override)
  ;["model", "modellc", "modelval"].forEach(function(key) {
    if (!isDef(override[key])) return
    try {
      var previous = isString(base[key]) ? af.fromJSSLON(base[key]) : base[key]
      var next = isString(override[key]) ? af.fromJSSLON(override[key]) : override[key]
      if (isMap(previous) && isMap(next) && previous.type === next.type && previous.url === next.url) out[key] = stringify(merge(previous, next), __, "")
    } catch(ignore) {}
  })
  return out
}

MiniAAdvanced.prototype.get = function(uuid) {
  this.lock.lock()
  try { return this._get(uuid) } finally { this.lock.unlock() }
}
MiniAAdvanced.prototype._get = function(uuid) {
  if (!global._mini_a_web_isValidUuid(uuid)) throw new Error("Invalid session id")
  if (this.sessions[uuid]) return this.sessions[uuid]
  var self = this, file = this.root + "/" + uuid + ".json"
  var saved = io.fileExists(file) ? io.readFileJSON(file) : {}
  var state = { uuid: uuid, file: file, journal: this.root + "/" + uuid + ".ndjson", sequence: 0, offsets: [], pending: null, operation: null, receipts: isMap(saved.receipts) ? saved.receipts : {}, closed: saved.closed === true }
  state.lock = new java.util.concurrent.locks.ReentrantLock()
  state.askLock = new java.util.concurrent.locks.ReentrantLock()
  // Recover the journal index, never materialize all diagnostic payloads in memory.
  if (io.fileExists(state.journal)) {
    var raf = new java.io.RandomAccessFile(state.journal, "r")
    try { while (raf.getFilePointer() < raf.length()) { state.offsets.push(raf.getFilePointer()); raf.readLine() } } finally { raf.close() }
    state.sequence = state.offsets.length
  }
  var options = merge({}, this.args)
  var preset = this.presets.presets[this.presets.defaultPreset]
  if (isMap(preset)) options = this.mergeOptions(options, preset)
  if (isMap(saved.options)) options = this.mergeOptions(options, saved.options)
  delete options.conversation
  options.resume = true
  options.historykeep = true
  delete options.goal
  delete options.exec
  state.overrides = isMap(saved.options) ? merge({}, saved.options) : {}
  var historyReservations = {}
  function emit(type, value) { self.emit(state, type, value) }
  state.runtime = MiniAInteractiveSession(options, {
    conversationPath: function(directory) {
      var legacy = self.root + "/c-" + uuid + ".json"
      return io.fileExists(legacy) ? legacy : directory + "/c-" + uuid + ".json"
    },
    historyDirectories: [self.root],
    protectHistory: function(path) {
      var protectedPath = Object.keys(self.sessions).some(function(id) {
        var runtime = self.sessions[id].runtime, agent = runtime.agent()
        var childrenRunning = isObject(agent) && isObject(agent._subtaskManager) && agent._subtaskManager.list().some(function(task) { return task.status === "running" || task.status === "pending" })
        return (global.__busy[id] === true || childrenRunning) && runtime.options().conversation === path
      })
      if (protectedPath) return true
      var match = String(new java.io.File(path).getName()).match(/^c-([a-z0-9-]+)\.json$/i)
      if (!match) return false
      var token = global._mini_a_web_reserve(match[1])
      if (isUnDef(token)) return true
      historyReservations[path] = { uuid: match[1], token: token }
      return false
    },
    releaseHistory: function(path) {
      var held = historyReservations[path]
      if (held) global._mini_a_web_release(held.uuid, held.token)
      delete historyReservations[path]
    },
    historyDeleted: function(path) {
      var id = String(new java.io.File(path).getName()).replace(/^c-/, "").replace(/\.json$/, "")
      if (self.sessions[id] || io.fileExists(self.root + "/" + id + ".json")) self.removeSession(id)
    },
    print: function(value) { emit("output", value) },
    error: function(value) { emit("error", value) },
    event: function(type, value) { if (type === "history-clear") global.__res[uuid] = []; emit(type, value) },
    view: function(name) { emit("view", name) },
    goal: function(goal, skillUsage, displayPrompt) { state.goal = { prompt: goal, skillUsage: skillUsage, displayPrompt: displayPrompt }; return true },
    validateOption: function(key) {
      if (self.isServerOption(key)) throw new Error(key + " is controlled by the server/session and requires server configuration")
    },
    ask: function(type, label, choices, value) {
      state.askLock.lock()
      try {
      if (state.cancelled) throw new Error("Command cancelled")
      var pending = { id: genUUID(), type: type, label: label, choices: choices || [], value: value || "" }
      state.pending = pending
      emit("interaction", pending)
      while (state.pending === pending && !state.cancelled) sleep(100)
      if (state.cancelled) throw new Error("Command cancelled")
      return pending.answer
      } finally { state.askLock.unlock() }
    }
  })
  if (isUnDef(global.__res)) global.__res = {}
  if (isUnDef(global.__res[uuid]) && state.sequence) {
    global.__res[uuid] = []
    for (var offset = 0; offset < state.sequence; offset += 100) {
      this.events(state, offset, 100, true).forEach(function(event) {
        if (event.type === "history-clear") global.__res[uuid] = []
        if (event.type === "user") global.__res[uuid].push({ event: "👤", message: String(event.value) })
        if (event.type === "answer") global.__res[uuid].push({ event: "final", message: String(event.value) })
      })
    }
  }
  if (saved.running) this.emit(state, "warn", "The server restarted. Previous work was interrupted and was not resumed.")
  this.sessions[uuid] = state
  global.__lastActivity[uuid] = Date.now()
  state.runtime.pruneHistory()
  return state
}

MiniAAdvanced.prototype.emit = function(state, type, value) {
  state.lock.lock()
  try {
    var record = { sequence: state.sequence + 1, timestamp: new Date().toISOString(), runId: state.operation, type: type, value: this.safe(value) }
    var offset = io.fileExists(state.journal) ? Number(new java.io.File(state.journal).length()) : 0
    io.writeFileString(state.journal, stringify(record, __, "") + "\n", __, true)
    state.offsets.push(offset)
    state.sequence++
    global.__lastActivity[state.uuid] = Date.now()
  } finally { state.lock.unlock() }
}

MiniAAdvanced.prototype.events = function(state, after, limit, full) {
  var out = [], raf
  state.lock.lock()
  try {
    if (io.fileExists(state.journal)) {
      raf = new java.io.RandomAccessFile(state.journal, "r")
      for (var i = after; i < Math.min(state.offsets.length, after + limit); i++) {
        raf.seek(state.offsets[i])
        var line = String(new java.lang.String(new java.lang.String(raf.readLine()).getBytes("ISO-8859-1"), "UTF-8"))
        var record = jsonParse(line)
        // Console print() emits blank separator lines with no value. Older journals
        // contain these records too, so tolerate them when reading any event page.
        var serializedValue = full ? __ : stringify(record.value, __, "")
        if (isString(serializedValue) && serializedValue.length > 8000) {
          record.value = serializedValue.substring(0, 8000)
          record.truncated = true
        }
        out.push(record)
      }
    }
  } finally { if (raf) raf.close(); state.lock.unlock() }
  return out
}

MiniAAdvanced.prototype.persist = function(state, full) {
  var options = full ? state.runtime.options() : state.overrides, self = this, clean = {}
  Object.keys(options).forEach(function(key) {
    // Secrets stay in server memory/environment; never export them into presets or snapshots.
    if (/^key$|^token$|api.?key|access.?key|secret|pass(?:word)?$|authorization|credential|webtoken|workerregtoken/i.test(key)) return
    var safe = self.safe(options[key], key)
    if (String(stringify(safe, __, "")).indexOf("[redacted]") >= 0) {
      if (["model", "modellc", "modelval"].indexOf(key) < 0 || !isMap(safe)) return
      function strip(value) {
        if (!isMap(value)) return value
        var out = {}
        Object.keys(value).forEach(function(k) { if (value[k] !== "[redacted]") out[k] = strip(value[k]) })
        return out
      }
      clean[key] = stringify(strip(safe), __, "")
      return
    }
    clean[key] = options[key]
  })
  if (full) return clean
  io.writeFileJSON(state.file, { options: clean, running: !!state.operation, closed: state.closed, receipts: state.receipts }, "")
  return clean
}

MiniAAdvanced.prototype.snapshot = function(state, after) {
  var definitions = state.runtime.definitions, options = state.runtime.options(), self = this
  return {
    uuid: state.uuid, sequence: state.sequence, busy: !!global.__busy[state.uuid], closed: state.closed,
    operation: state.operation, kind: state.kind, pending: state.pending ? this.safe(state.pending) : null,
    commands: state.runtime.commands(), completions: state.runtime.completions(), events: this.events(state, after, 100),
    settings: Object.keys(definitions).sort().map(function(key) {
      var def = definitions[key]
      var value = options[key]
      var modelEnv = { model: "OAF_MODEL", modellc: "OAF_LC_MODEL", modelval: "OAF_VAL_MODEL" }
      if (isUnDef(value) && modelEnv[key]) value = getEnv(modelEnv[key])
      return { name: key, type: def.type, dataEditor: def.dataEditor, description: def.description, value: self.safe(value, key), defaultValue: self.safe(def.default, key), source: Object.prototype.hasOwnProperty.call(state.overrides, key) ? "session" : "server",
        readOnly: self.isServerOption(key) }
    }), presets: Object.keys(this.presets.presets), defaultPreset: this.presets.defaultPreset
  }
}

MiniAAdvanced.prototype.request = function(data) {
  var self = this, state = this.get(data.uuid)
  var after = Math.max(0, Math.floor(Number(data.after) || 0))
  if (!isFinite(after)) throw new Error("Invalid cursor")
  if (data.action === "sessions") {
    return { sessions: io.listFiles(this.root).files.filter(function(file) {
      return file.isFile && /^[0-9a-f-]{36}\.json$/i.test(file.filename)
    }).map(function(file) { return { uuid: file.filename.replace(/\.json$/, ""), updated: file.lastModified } }).sort(function(a,b) { return b.updated - a.updated }).slice(0,100) }
  }
  if (data.action === "snapshot") return this.snapshot(state, after)
  if (data.action === "stats") {
    var agent = state.runtime.agent()
    // Export numeric statistics only; traces and prompt metadata are not chart data.
    function numericStats(value) {
      if (isNumber(value)) return isFinite(value) ? value : null
      if (!isMap(value)) return __
      var result = {}
      Object.keys(value).forEach(function(key) {
        var item = numericStats(value[key])
        if (isDef(item)) result[key] = item
      })
      return result
    }
    var metrics = agent && isFunction(agent.getMetrics) ? agent.getMetrics() : null
    var details = metrics ? this.safe(metrics) : null
    // Keep diagnostic maps/arrays, but leave narrative advisor traces in Debug.
    if (details && isMap(details.advisor)) delete details.advisor.trace
    return { metrics: metrics ? numericStats(metrics) : null, details: details }
  }
  if (data.action === "event") {
    if (!isNumber(data.sequence) || data.sequence < 1 || data.sequence % 1) throw new Error("Invalid sequence")
    return this.events(state, data.sequence - 1, 1, true)[0] || {}
  }
  if (data.action === "trace") return this.safe(state.runtime.tracePage(after, 100, data.category, data.sequence))
  if (data.action === "reply") {
    if (!state.pending || data.id !== state.pending.id) throw new Error("Interaction is no longer pending")
    if (stringify(data.answer, __, "").length > 120000) throw new Error("Answer is too long")
    if (state.pending.type === "choice" && (!isNumber(data.answer) || data.answer < 0 || data.answer >= state.pending.choices.length || data.answer % 1)) throw new Error("Invalid choice")
    state.pending.answer = data.answer
    state.pending = null
    return { ok: true }
  }
  if (data.action === "stop") {
    state.cancelled = true
    state.pending = null
    var agent = global.__conversations[state.uuid]
    if (agent && isFunction(agent.requestStop)) agent.requestStop("Stopped from Advanced mode", { quiet: true })
    return { ok: true }
  }
  if (state.closed) throw new Error("Session ended. Start a new conversation.")
  if (!isString(data.requestId) || !/^[a-zA-Z0-9-]{1,80}$/.test(data.requestId)) throw new Error("A requestId is required")
  if (state.receipts[data.requestId]) return state.receipts[data.requestId]
  var token = global._mini_a_web_reserve(state.uuid)
  if (isUnDef(token)) return { busy: true }
  var receipt = { accepted: true, requestId: data.requestId }
  state.receipts[data.requestId] = receipt
  var receiptKeys = Object.keys(state.receipts)
  while (receiptKeys.length > 128) delete state.receipts[receiptKeys.shift()]
  state.operation = data.requestId
  state.kind = "command"
  state.cancelled = false
  try { this.persist(state) } catch(e) { state.operation = null; global._mini_a_web_release(state.uuid, token); throw e }
  try { this.schedule(function() {
    try {
      var agent = global.__conversations[state.uuid]
      state.runtime.sync(agent)
      state.runtime.saveConversation()
      var beforeOptions = state.runtime.options()
      var previousOptions = stringify(beforeOptions, __, "")
      state.goal = null
      if (data.action === "command") {
        if (!isString(data.command) || data.command.length > 120000) throw new Error("Invalid command")
        self.emit(state, "command", data.command)
        if (state.runtime.execute(data.command) === false) { state.closed = true; state.runtime.dispose(); state.runtime.sync(__); global._mini_a_web_dispose(state.uuid) }
        if (state.goal) self.emit(state, "goal", "Starting expanded goal")
      } else if (data.action === "settings") {
        if (!isMap(data.values)) throw new Error("Settings must be an object")
        var values = merge({}, data.values), current = state.runtime.options()
        function retainMasked(value, previous) {
          if (value === "[redacted]") return previous
          if (isMap(value)) { Object.keys(value).forEach(function(key) { value[key] = retainMasked(value[key], isMap(previous) ? previous[key] : __) }) }
          return value
        }
        Object.keys(values).forEach(function(key) {
          if (isString(values[key]) && values[key].indexOf("[redacted]") >= 0) {
            if (values[key] === "[redacted]") { delete values[key]; return }
            var rawPrevious = current[key]
            var modelEnv = { model: "OAF_MODEL", modellc: "OAF_LC_MODEL", modelval: "OAF_VAL_MODEL" }
            if (isUnDef(rawPrevious) && modelEnv[key]) rawPrevious = getEnv(modelEnv[key])
            var previous = isString(rawPrevious) ? af.fromJSSLON(rawPrevious) : rawPrevious
            values[key] = stringify(retainMasked(af.fromJSSLON(values[key]), previous), __, "")
          }
        })
        state.runtime.setOptions(values)
      } else if (data.action === "preset") {
        if (!isString(data.name) || !/^[a-zA-Z0-9 _-]{1,80}$/.test(data.name)) throw new Error("Invalid preset name")
        if (data.op === "save") {
          var clean = self.persist(state, true)
          delete clean.conversation
          delete clean.resume
          Object.keys(clean).forEach(function(key) { if (self.isServerOption(key)) delete clean[key] })
          self.presets.presets[data.name] = clean
        } else if (data.op === "apply") {
          if (!self.presets.presets[data.name]) throw new Error("Preset not found")
          var values = merge({}, self.presets.presets[data.name])
          Object.keys(values).forEach(function(key) { if (self.isServerOption(key)) delete values[key] })
          var resolved = self.mergeOptions(state.runtime.options(), values)
          Object.keys(values).forEach(function(key) { values[key] = resolved[key] })
          state.runtime.setOptions(values)
        } else if (data.op === "default") self.presets.defaultPreset = data.name
        else if (data.op === "delete") { delete self.presets.presets[data.name]; if (self.presets.defaultPreset === data.name) delete self.presets.defaultPreset }
        else throw new Error("Unknown preset operation")
        self.lock.lock()
        try { io.writeFileJSON(self.presetPath, self.presets, "") } finally { self.lock.unlock() }
        self.emit(state, "output", "Preset " + data.op + ": " + data.name)
      } else throw new Error("Unknown advanced action")
      if (previousOptions !== stringify(state.runtime.options(), __, "")) {
        state.runtime.saveConversation()
        global._mini_a_web_dispose(state.uuid)
        state.runtime.sync(__)
      } else if (state.runtime.agent()) global.__conversations[state.uuid] = state.runtime.agent()
    } catch(e) { self.emit(state, "error", __miniAErrMsg(e)) }
    finally {
      var afterOptions = state.runtime.options()
      Object.keys(afterOptions).forEach(function(key) {
        if (isDef(beforeOptions) && stringify(beforeOptions[key]) !== stringify(afterOptions[key])) state.overrides[key] = afterOptions[key]
      })
      if (isDef(beforeOptions)) Object.keys(beforeOptions).forEach(function(key) { if (isUnDef(afterOptions[key])) delete state.overrides[key] })
      state.operation = null
      try { self.persist(state) } finally { global._mini_a_web_release(state.uuid, token) }
      self.emit(state, "complete", { requestId: data.requestId, action: data.action, settingsChanged: isDef(previousOptions) && previousOptions !== stringify(afterOptions, __, "") })
      if (state.goal && !state.cancelled && !state.closed) {
        var goal = state.goal
        state.goal = null
        self.submitPrompt({ header: { "x-mini-a-token": global.__webtoken }, files: { postData: stringify({ uuid: state.uuid, prompt: goal.prompt, skillUsage: goal.skillUsage, displayPrompt: goal.displayPrompt }, __, "") } })
      }
    }
  }).catch(function(e) { state.operation = null; global._mini_a_web_release(state.uuid, token); self.emit(state, "error", String(e)) })
  } catch(e) {
    state.operation = null
    delete state.receipts[data.requestId]
    try { this.persist(state) } finally { global._mini_a_web_release(state.uuid, token) }
    throw e
  }
  return receipt
}
