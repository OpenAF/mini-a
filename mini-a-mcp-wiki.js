// Author: OpenAI Assistant
// License: Apache 2.0
// Description: Shared MCP wiki bootstrap helpers for standalone wiki MCP jobs.

loadLib("mini-a-common.js")
loadLib("mini-a-wiki.js")
loadLib("mini-a-utils.js")

var __miniAMcpWikiRestrictedCeilings = {
  searchLimit: 10, minQueryChars: 64, metaChars: 2000, readLines: 100,
  readChars: 16000, refTtl: 3600, maxSearches: 200, maxReads: 100,
  maxChars: 500000, window: 86400, pageCooldown: 86400
}

function __miniAMcpWikiSafeChars(value, max) {
  var s = isDef(value) ? String(value) : ""
  if (!isNumber(max) || max < 1 || s.length <= max) return s
  try {
    var js = new java.lang.String(s)
    return String(js.substring(0, js.offsetByCodePoints(0, Math.min(max, js.codePointCount(0, js.length())))))
  } catch(e) { return s.substring(0, max) }
}

function __miniAMcpWikiRestrictedError(code) { return { ok: false, error: code } }

function __miniAMcpWikiPositiveOption(args, name, fallback, ceiling) {
  var value = isDef(args[name]) ? Number(args[name]) : fallback
  if (!isFinite(value) || value <= 0 || Math.floor(value) !== value || value > ceiling) {
    throw "invalid restricted retrieval option: " + name
  }
  return value
}

function __miniAMcpWikiCreateChannelFromDef(rawDef, fallbackName, fallbackType) {
  var parsed = __
  try { parsed = af.fromJSSLON(__miniANormalizeChannelDef(rawDef)) } catch(ignoreParse) {}
  if (!isMap(parsed)) throw "invalid restricted reference channel definition"
  var cName = isString(parsed.name) && parsed.name.trim().length > 0 ? parsed.name.trim() : fallbackName
  var cType = isString(parsed.type) && parsed.type.trim().length > 0 ? parsed.type.trim() : (fallbackType || "simple")
  var cOpts = isMap(parsed.options) ? parsed.options : {}
  var exists = false
  try { exists = $ch().list().indexOf(cName) >= 0 } catch(ignoreList) {}
  if (!exists) {
    try { $ch(cName).create(cType, cOpts) } catch(e) { throw "restricted reference channel unavailable (" + cType + "): " + __miniAErrMsg(e) }
  }
  return cName
}

function __miniAMcpWikiParseChannelKey(rawKey) {
  if (isMap(rawKey)) return rawKey
  if (!isString(rawKey)) return __
  var text = rawKey.trim()
  if (text.length === 0) return __
  var parsed = __
  try { parsed = jsonParse(text, __, __, true) } catch(ignoreJsonParse) {}
  if (!isMap(parsed)) { try { parsed = af.fromJSSLON(text) } catch(ignoreJSSLONParse) {} }
  return isMap(parsed) ? parsed : __
}

function __miniAMcpWikiChannelUnset(ch, key) {
  if (isFunction(ch.unset)) { try { ch.unset(key); return } catch(ignoreUnset) {} }
  try { ch.set(key, __) } catch(ignoreClear) {}
}

function MiniAMcpWikiRestriction(args, cfg) {
  args = isMap(args) ? args : {}
  this.enabled = toBoolean(args.wikirestrict) === true
  this.refs = {}
  this.cooldowns = {}
  this.audit = []
  this.stateId = sha1(nowNano() + "|" + genUUID())
  this.maxEntries = 2048
  this.policy = {
    searchLimit : __miniAMcpWikiPositiveOption(args, "wikirestrictsearchlimit", 3, __miniAMcpWikiRestrictedCeilings.searchLimit),
    minQueryChars: __miniAMcpWikiPositiveOption(args, "wikirestrictminquerychars", 4, __miniAMcpWikiRestrictedCeilings.minQueryChars),
    metaChars   : __miniAMcpWikiPositiveOption(args, "wikirestrictmetachars", 300, __miniAMcpWikiRestrictedCeilings.metaChars),
    readLines   : __miniAMcpWikiPositiveOption(args, "wikirestrictreadlines", 40, __miniAMcpWikiRestrictedCeilings.readLines),
    readChars   : __miniAMcpWikiPositiveOption(args, "wikirestrictreadchars", 6000, __miniAMcpWikiRestrictedCeilings.readChars),
    refTtl      : __miniAMcpWikiPositiveOption(args, "wikirestrictrefttl", 120, __miniAMcpWikiRestrictedCeilings.refTtl),
    maxSearches : __miniAMcpWikiPositiveOption(args, "wikirestrictmaxsearches", 30, __miniAMcpWikiRestrictedCeilings.maxSearches),
    maxReads    : __miniAMcpWikiPositiveOption(args, "wikirestrictmaxreads", 15, __miniAMcpWikiRestrictedCeilings.maxReads),
    maxChars    : __miniAMcpWikiPositiveOption(args, "wikirestrictmaxchars", 60000, __miniAMcpWikiRestrictedCeilings.maxChars),
    window      : __miniAMcpWikiPositiveOption(args, "wikirestrictwindow", 3600, __miniAMcpWikiRestrictedCeilings.window),
    pageCooldown: __miniAMcpWikiPositiveOption(args, "wikirestrictpagecooldown", 3600, __miniAMcpWikiRestrictedCeilings.pageCooldown)
  }
  this.statePath = isString(args.wikirestrictstate) && args.wikirestrictstate.trim().length > 0 ? args.wikirestrictstate.trim() : __
  if (this.statePath && cfg.backend === "fs") {
    var root = String(new java.io.File(cfg.root).getCanonicalPath())
    var state = String(new java.io.File(this.statePath).getCanonicalPath())
    if (state === root || state.startsWith(root + java.io.File.separator)) throw "restricted state must be outside wikiroot"
    this.statePath = state
  }
  // Opt-in: unset (default) keeps references/cooldowns in this process's memory only,
  // today's behavior, correct for a single standalone instance. Set to a SLON/JSON
  // OpenAF channel definition (e.g. redis) so multiple replicas behind a load balancer
  // share one issue/consume ledger: a reference issued by one replica's search call can
  // be consumed by whichever replica later serves the matching read call. Channel-type
  // choice matters: `simple`/`file` are single-writer stores (fine standalone, unsafe
  // shared by concurrent replicas); `redis`/`mongo` do real per-key ops and are safe.
  this.refChName = isString(args.wikirestrictrefch) && args.wikirestrictrefch.trim().length > 0
    ? __miniAMcpWikiCreateChannelFromDef(args.wikirestrictrefch, "_mini_a_wiki_restrict_refs", "simple")
    : __
  this._lastSweep = 0
  this.usage = { started: Date.now(), searches: 0, reads: 0, chars: 0 }
  this._loadState()
}

MiniAMcpWikiRestriction.prototype._loadState = function() {
  if (!this.statePath) return
  try {
    if (!io.fileExists(this.statePath)) return
    var saved = af.fromJson(io.readFileString(this.statePath))
    if (!isMap(saved) || !isMap(saved.usage)) throw "invalid ledger"
    this.usage = saved.usage
    if (!this.refChName) this.cooldowns = isMap(saved.cooldowns) ? saved.cooldowns : {}
  } catch(e) { throw "restricted state unavailable" }
}

MiniAMcpWikiRestriction.prototype._saveState = function() {
  if (!this.statePath) return
  try {
    var parent = new java.io.File(this.statePath).getParentFile()
    if (!parent || (!parent.exists() && !parent.mkdirs())) throw "state directory unavailable"
    var temp = this.statePath + ".tmp-" + genUUID()
    // cooldowns move to the shared channel once configured; the local ledger keeps usage only
    io.writeFileString(temp, stringify({ usage: this.usage, cooldowns: this.refChName ? {} : this.cooldowns }, __, ""))
    java.nio.file.Files.move(java.nio.file.Paths.get(temp), java.nio.file.Paths.get(this.statePath), java.nio.file.StandardCopyOption.REPLACE_EXISTING, java.nio.file.StandardCopyOption.ATOMIC_MOVE)
  } catch(e) { throw "restricted state unavailable" }
}

MiniAMcpWikiRestriction.prototype._sweepChannel = function(now) {
  var ch = $ch(this.refChName)
  var keys = []
  try { keys = ch.getKeys() } catch(ignoreGetKeys) { return }
  keys.forEach(function(rawKey) {
    var key = __miniAMcpWikiParseChannelKey(rawKey)
    if (!isMap(key)) return
    try {
      var value = ch.get(key)
      if (isMap(value) && Number(value.expires || 0) <= now) __miniAMcpWikiChannelUnset(ch, key)
    } catch(ignoreSweepEntry) {}
  })
}

MiniAMcpWikiRestriction.prototype._purge = function() {
  var now = Date.now(), self = this
  if (now - Number(this.usage.started || 0) >= this.policy.window * 1000) this.usage = { started: now, searches: 0, reads: 0, chars: 0 }
  if (this.audit.length > this.maxEntries) this.audit = this.audit.slice(-this.maxEntries)
  if (this.refChName) {
    // rate-limited: avoid a full channel scan (redis/s3/etc. round-trips) on every call
    var sweepEveryMs = Math.max(this.policy.refTtl, 30) * 1000
    if (now - Number(this._lastSweep || 0) >= sweepEveryMs) {
      this._lastSweep = now
      this._sweepChannel(now)
    }
    return
  }
  Object.keys(this.refs).forEach(function(k) { if (Number(self.refs[k].expires || 0) <= now) delete self.refs[k] })
  Object.keys(this.cooldowns).forEach(function(k) { if (Number(self.cooldowns[k]) <= now) delete self.cooldowns[k] })
}

MiniAMcpWikiRestriction.prototype._event = function(kind, value) {
  this.audit.push({ at: Date.now(), kind: kind, hash: sha1(String(value || "")) })
}

MiniAMcpWikiRestriction.prototype._can = function(kind, chars) {
  this._purge()
  if ((kind === "search" && this.usage.searches >= this.policy.maxSearches) ||
      (kind === "read" && this.usage.reads >= this.policy.maxReads) ||
      this.usage.chars + Math.max(0, Number(chars || 0)) > this.policy.maxChars) return false
  return true
}

MiniAMcpWikiRestriction.prototype.charge = function(kind, chars) {
  if (!this._can(kind, chars)) return false
  if (kind === "search") this.usage.searches++
  if (kind === "read") this.usage.reads++
  this.usage.chars += Math.max(0, Number(chars || 0))
  try { this._saveState() } catch(e) { return false }
  return true
}

MiniAMcpWikiRestriction.prototype._cooldownActive = function(hash) {
  if (this.refChName) {
    var v
    try { v = $ch(this.refChName).get({ kind: "cooldown", hash: hash }) } catch(ignoreGet) { return false }
    return isMap(v) && Number(v.expires || 0) > Date.now()
  }
  return isDef(this.cooldowns[hash]) && Number(this.cooldowns[hash]) > Date.now()
}

MiniAMcpWikiRestriction.prototype.issue = function(path) {
  this._purge()
  var hash = sha1(String(path))
  if (this._cooldownActive(hash)) return __
  var ref = sha256(this.stateId + "|" + nowNano() + "|" + genUUID()).substring(0, 32)
  var refExpires = Date.now() + this.policy.refTtl * 1000
  var cooldownExpires = Date.now() + this.policy.pageCooldown * 1000
  if (this.refChName) {
    $ch(this.refChName).set({ kind: "ref", ref: ref }, { path: path, expires: refExpires })
    $ch(this.refChName).set({ kind: "cooldown", hash: hash }, { expires: cooldownExpires })
  } else {
    this.refs[ref] = { path: path, expires: refExpires }
    this.cooldowns[hash] = cooldownExpires
  }
  return ref
}

MiniAMcpWikiRestriction.prototype.consume = function(ref) {
  this._purge()
  if (!isString(ref)) return __
  var grant
  if (this.refChName) {
    var ch = $ch(this.refChName), key = { kind: "ref", ref: ref }
    grant = ch.get(key)
    if (isMap(grant)) __miniAMcpWikiChannelUnset(ch, key)
  } else {
    grant = this.refs[ref]
    delete this.refs[ref]
  }
  if (!isMap(grant)) return __
  return Number(grant.expires) > Date.now() ? grant : __
}

function __miniAMcpWikiDenyRestricted(operation) {
  var r = global.__miniAMcpWiki && global.__miniAMcpWiki.restriction
  if (r && r.enabled) return __miniAMcpWikiRestrictedError("restricted-operation")
  return __
}

function __miniAMcpWikiRestrictedSearch(args) {
  var state = global.__miniAMcpWiki && global.__miniAMcpWiki.restriction
  if (!state || !state.enabled) return global.__wikiTool.wiki({ operation: "search", query: args.query, limit: args.limit, caseSensitive: args.caseSensitive, regex: args.regex, contextLines: args.contextLines, path: args.path, compact: args.contextLines === 0 })
  var q = isString(args.query) ? args.query.trim() : ""
  if (q.length < state.policy.minQueryChars || !/[A-Za-z0-9\u00c0-\uffff]/.test(q) || /[*?]{2,}|^\*|^\.$/.test(q)) return __miniAMcpWikiRestrictedError("restricted-query-rejected")
  if (!state._can("search", 0)) return __miniAMcpWikiRestrictedError("restricted-budget-exhausted")
  state._event("search", q)
  var hits
  try { hits = global.__wikiManager.search(q, { limit: state.policy.searchLimit, regex: false, caseSensitive: false, contextLines: 0, compact: true, path: "" }) } catch(e) { return __miniAMcpWikiRestrictedError("restricted-unavailable") }
  var results = [], chars = 0
  hits.forEach(function(hit) {
    if (results.length >= state.policy.searchLimit || !isMap(hit) || !isString(hit.path)) return
    var ref = state.issue(hit.path)
    if (!ref) return
    var title = __miniAMcpWikiSafeChars(hit.title, state.policy.metaChars)
    var description = __miniAMcpWikiSafeChars(hit.description, Math.max(0, state.policy.metaChars - title.length))
    chars += title.length + description.length + ref.length
    results.push({ title: title, description: description, reference: ref })
  })
  if (!state.charge("search", chars)) return __miniAMcpWikiRestrictedError("restricted-budget-exhausted")
  return { results: results }
}

function __miniAMcpWikiRestrictedRead(args) {
  var state = global.__miniAMcpWiki && global.__miniAMcpWiki.restriction
  if (!state || !state.enabled) return global.__wikiTool.wiki({ operation: "read", path: args.path, lineStart: args.startLine, lineEnd: args.endLine, section: args.section, countLines: args.countLines, compact: args.compact })
  if (args.countLines === true) return __miniAMcpWikiRestrictedError("invalid-or-expired-reference")
  var grant = state.consume(args.path)
  if (!grant) return __miniAMcpWikiRestrictedError("invalid-or-expired-reference")
  if (!state._can("read", 0)) return __miniAMcpWikiRestrictedError("restricted-budget-exhausted")
  state._event("read", grant.path)
  var page
  try { page = global.__wikiManager.read(grant.path) } catch(e) { page = __ }
  if (!isMap(page) || !isString(page.body)) return __miniAMcpWikiRestrictedError("invalid-or-expired-reference")
  var lines = page.body.split("\n"), start = 0, end = Math.min(lines.length, state.policy.readLines)
  if (isString(args.section) && args.section.trim().length > 0) {
    var wanted = args.section.trim().toLowerCase(), found = -1, level = 7
    for (var i = 0; i < lines.length; i++) { var m = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i]); if (m && m[2].toLowerCase() === wanted) { found = i; level = m[1].length; break } }
    if (found < 0) return __miniAMcpWikiRestrictedError("invalid-or-expired-reference")
    start = found; end = Math.min(lines.length, start + state.policy.readLines)
    for (var j = found + 1; j < end; j++) { var next = /^(#{1,6})\s+/.exec(lines[j]); if (next && next[1].length <= level) { end = j; break } }
  } else if (isNumber(args.startLine) || isNumber(args.endLine)) {
    start = Math.max(0, (isNumber(args.startLine) ? args.startLine : 1) - 1)
    end = Math.min(lines.length, isNumber(args.endLine) ? args.endLine : start + state.policy.readLines)
    if (end - start > state.policy.readLines || start >= lines.length || end <= start) return __miniAMcpWikiRestrictedError("invalid-or-expired-reference")
  }
  var content = __miniAMcpWikiSafeChars(lines.slice(start, end).join("\n"), state.policy.readChars)
  if (!state.charge("read", content.length)) return __miniAMcpWikiRestrictedError("restricted-budget-exhausted")
  return { content: content }
}

function __miniAMcpWikiBuildConfig(args, options) {
  args = isMap(args) ? args : {}
  options = isMap(options) ? options : {}

  var backend = isDef(args.wikibackend) ? String(args.wikibackend).toLowerCase().trim() : "fs"
  if (["fs", "s3", "es", "s3fs"].indexOf(backend) < 0) backend = "fs"

  var access = isString(options.access) ? options.access.toLowerCase().trim() : "ro"
  if (access !== "rw") access = "ro"
  if (toBoolean(options.readonly) === true) access = "ro"

  var wikiGraphHintCap = Number(args.wikigraphhintcap)
  var wikiGraphFalkorHost = isString(args.wikigraphfalkorhost) && args.wikigraphfalkorhost.trim().length > 0
    ? args.wikigraphfalkorhost.trim() : __
  var wikiGraphFalkorPort = Number(args.wikigraphfalkorport)

  var cfg = {
    access              : access,
    backend             : backend,
    indexdir            : isString(args.wikiindexdir) && args.wikiindexdir.trim().length > 0 ? args.wikiindexdir.trim() : __,
    wikimetacache       : isDef(args.wikimetacache) ? toBoolean(args.wikimetacache) : true,
    usegraph            : (isDef(args.usewikigraph) ? toBoolean(args.usewikigraph) : false) || isString(wikiGraphFalkorHost),
    wikigraphcommunity  : isString(args.wikigraphcommunity) && args.wikigraphcommunity.trim().length > 0 ? args.wikigraphcommunity.trim() : __,
    wikigraphsearchhints: isDef(args.wikigraphsearchhints) ? toBoolean(args.wikigraphsearchhints) : true,
    wikigraphmounts     : isDef(args.wikigraphmounts) ? toBoolean(args.wikigraphmounts) : true,
    wikigraphhintcap    : isNumber(wikiGraphHintCap) && wikiGraphHintCap > 0 ? wikiGraphHintCap : 5,
    wikimountgraphttlms : isNumber(Number(args.wikimountgraphttlms)) ? Number(args.wikimountgraphttlms) : 60000,
    wikigraphautosave   : isString(args.wikigraphautosave) && args.wikigraphautosave.trim().length > 0 ? args.wikigraphautosave.trim() : "always",
    wikigraphsavedebouncems: isNumber(Number(args.wikigraphsavedebouncems)) ? Number(args.wikigraphsavedebouncems) : 5000,
    wikilintstreamthreshold: isNumber(Number(args.wikilintstreamthreshold)) ? Number(args.wikilintstreamthreshold) : 2000,
    wikilintmaxpairs    : isNumber(Number(args.wikilintmaxpairs)) ? Number(args.wikilintmaxpairs) : 250000,
    wikigraphfalkor     : {
      host : wikiGraphFalkorHost,
      port : isNumber(wikiGraphFalkorPort) ? wikiGraphFalkorPort : 6379,
      graph: isString(args.wikigraphfalkorgraph) && args.wikigraphfalkorgraph.trim().length > 0 ? args.wikigraphfalkorgraph.trim() : "mini_a_wiki",
      user : isString(args.wikigraphfalkoruser) && args.wikigraphfalkoruser.trim().length > 0 ? args.wikigraphfalkoruser.trim() : __,
      pass : isString(args.wikigraphfalkorpass) && args.wikigraphfalkorpass.trim().length > 0 ? args.wikigraphfalkorpass.trim() : __
    }
  }

  if (backend === "s3" || backend === "s3fs") {
    cfg.bucket          = args.wikibucket
    cfg.prefix          = args.wikiprefix
    cfg.url             = args.wikiurl
    cfg.accessKey       = args.wikiaccesskey
    cfg.secret          = args.wikisecret
    cfg.region          = args.wikiregion
    cfg.useVersion1     = args.wikiuseversion1
    cfg.ignoreCertCheck = args.wikiignorecertcheck
    if (backend === "s3fs") cfg.root = isString(args.wikiroot) && args.wikiroot.trim().length > 0 ? args.wikiroot.trim() : "."
  } else if (backend === "es") {
    cfg.esurl   = args.wikiurl
    cfg.esindex = isString(args.wikiprefix) && args.wikiprefix.trim().length > 0 ? args.wikiprefix.trim() : "mini_a_wiki"
    cfg.esuser  = args.wikiaccesskey
    cfg.espass  = args.wikisecret
  } else {
    cfg.root = isString(args.wikiroot) && args.wikiroot.trim().length > 0 ? args.wikiroot.trim() : "."
  }

  return cfg
}

function __miniAMcpWikiDefaultLabel(args, cfg) {
  args = isMap(args) ? args : {}
  cfg = isMap(cfg) ? cfg : {}

  if (isString(args.label) && args.label.trim().length > 0) return args.label.trim()
  if (cfg.backend === "s3") {
    if (isString(args.wikibucket) && args.wikibucket.length > 0) return "s3://" + args.wikibucket + "/" + args.wikiprefix
    return "S3 wiki"
  }
  return cfg.root || "wiki"
}

function __miniAMcpWikiCreateTool(cfg, wikiManager) {
  var toolRoot = isString(cfg.root) && cfg.root.trim().length > 0 ? cfg.root.trim() : "."
  // MiniUtilsTool requires a directory, while the wiki backend also accepts
  // ZIP/OKT files as read-only roots. The helper is only the MCP facade, so
  // use the bundle's parent directory in that case.
  if (cfg.backend === "fs" && /\.(zip|okt)$/i.test(toolRoot)) {
    var rootFile = new java.io.File(toolRoot)
    if (rootFile.isFile()) {
      var parent = rootFile.getCanonicalFile().getParentFile()
      if (parent) toolRoot = String(parent.getCanonicalPath())
    }
  }
  var tool = new MiniUtilsTool({
    root     : toolRoot,
    readwrite: String(cfg.access || "").toLowerCase() === "rw"
  })
  tool._wikiManager = wikiManager
  return tool
}

function __miniAMcpWikiAttachMounts(wikiManager, mountsRaw, logPrefix) {
  if (!isObject(wikiManager) || !isString(mountsRaw) || mountsRaw.trim().length === 0) return
  try {
    var mountsList = af.fromJSSLON(mountsRaw)
    if (!isArray(mountsList)) mountsList = [mountsList]
    mountsList.forEach(function(mc) {
      if (!isMap(mc) || !isString(mc.name)) return
      wikiManager.attach(mc.name, merge({ access: "ro" }, mc))
    })
  } catch(mErr) {
    printErrnl("[" + logPrefix + "] wikimounts parse error: " + String(mErr))
  }
}

function __miniAMcpWikiInit(args, options) {
  args = isMap(args) ? args : {}
  options = isMap(options) ? options : {}

  var restricted = toBoolean(args.wikirestrict) === true
  if (restricted) {
    options.access = "ro"
    options.readonly = true
  }
  var cfg = __miniAMcpWikiBuildConfig(args, options)
  if (restricted) {
    cfg.access = "ro"
    cfg.wikigraphsearchhints = false
  }
  var restriction = restricted ? new MiniAMcpWikiRestriction(args, cfg) : { enabled: false }
  var logPrefix = isString(options.logPrefix) ? options.logPrefix : "mcp-wiki"
  global.__wikiManager = new MiniAWikiManager(cfg)
  global.__wikiTool = __miniAMcpWikiCreateTool(cfg, global.__wikiManager)
  args.label = __miniAMcpWikiDefaultLabel(args, cfg)
  __miniAMcpWikiAttachMounts(global.__wikiManager, args.wikimounts, logPrefix)

  global.__miniAMcpWiki = {
    access: cfg.access,
    config: cfg,
    label : args.label,
    restriction: restriction,
    logPrefix: logPrefix
  }

  if (restricted) printErrnl("[" + logPrefix + "] restricted retrieval active (" + (restriction.statePath ? "persistent state" : "process-only state") + "; tools: search, read)")

  return global.__miniAMcpWiki
}
