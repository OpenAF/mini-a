// Author: Nuno Aguiar
// License: Apache 2.0
// Description: Virtual skill library facade on top of MiniAWikiManager (mini-a-wiki.js).
//
// This module never re-implements search/storage/graph. It is a thin, specialized
// layer that (a) recognizes wiki pages carrying skill-shaped frontmatter (type: skill,
// or an existing mini-a.skill/v1-style schema) and (b) reshapes the existing wiki
// retrieval primitives (search/searchSelected, open, agenticRead, related, context)
// into a small, paging-friendly "virtual skill" surface: context/search/recommend/
// open/read/related. See docs/VIRTUAL-SKILLS.md.
//
// Callers hold a MiniAWikiManager (wm) -- the same instance used for usewiki/mcp-wiki.
// A wiki containing ordinary knowledge pages and skill pages side by side works
// unchanged: non-skill pages simply have empty skill fields and are excluded by the
// default type="skill" filter in search/recommend.

var __MINI_A_SKILL_SCHEMA = "mini-a.virtual-skill/v1"

// ── ranking ──────────────────────────────────────────────────────────────────
// Centralized weights so future signals (trust/quality/popularity/recency) can be
// added in one place instead of scattered magic numbers. See docs/VIRTUAL-SKILLS.md.
var __MINI_A_SKILL_RANK_WEIGHTS = {
  lexical      : 1.0,
  name         : 3.0,
  title        : 2.0,
  intent       : 2.5,
  tag          : 1.0,
  appliesTo    : 1.5,
  compatibility: 1.0,
  graph        : 1.0
}

var __MINI_A_SKILL_RISK_RANK = { "": 0, "low": 1, "medium": 2, "high": 3 }

function __miniASkillRiskRank(level) {
  var key = isString(level) ? level.toLowerCase().trim() : ""
  return isDef(__MINI_A_SKILL_RISK_RANK[key]) ? __MINI_A_SKILL_RISK_RANK[key] : 0
}

function __miniASkillTokenize(text) {
  var seen = {}, terms = []
  String(text || "").toLowerCase().split(/[^a-z0-9_-]+/).forEach(function(t) {
    if (t.length < 2 || seen[t] === true) return
    seen[t] = true
    terms.push(t)
  })
  return terms
}

function __miniASkillOverlapRatio(queryTerms, candidateTerms) {
  if (!isArray(queryTerms) || queryTerms.length === 0 || !isArray(candidateTerms) || candidateTerms.length === 0) return 0
  var set = {}
  candidateTerms.forEach(function(t) { set[t] = true })
  var hits = 0
  queryTerms.forEach(function(t) { if (set[t] === true) hits++ })
  return hits / queryTerms.length
}

// record: the _metaFor()-shaped cached page record (already carries name/title/tags/
// intent/appliesTo/compatibility from the mini-a-wiki.js _buildPageRecord extension).
function __miniAComputeSkillScore(queryTerms, record, context) {
  context = isMap(context) ? context : {}
  var weights = merge(merge({}, __MINI_A_SKILL_RANK_WEIGHTS), isMap(context.weights) ? context.weights : {})

  var lexicalScore = isNumber(context.nativeScore) ? context.nativeScore : (1 / (1 + (isNumber(context.rank) ? context.rank : 0)))
  var nameTerms     = __miniASkillTokenize(record.name)
  var titleTerms    = __miniASkillTokenize(record.title)
  var tagTerms      = (isArray(record.tags) ? record.tags : []).map(function(t) { return String(t).toLowerCase() })
  var appliesTerms  = (isArray(record.appliesTo) ? record.appliesTo : []).map(function(t) { return String(t).toLowerCase() })
  var intentPhrases = isArray(record.intent) ? record.intent : []

  var nameBoost  = __miniASkillOverlapRatio(queryTerms, nameTerms)
  var titleBoost = __miniASkillOverlapRatio(queryTerms, titleTerms)

  var tagBoost = 0
  ;(queryTerms || []).forEach(function(t) { if (tagTerms.indexOf(t) >= 0) tagBoost = 1 })

  var appliesToBoost = 0
  ;(queryTerms || []).forEach(function(t) { if (appliesTerms.indexOf(t) >= 0) appliesToBoost = 1 })

  var intentBoost = 0
  intentPhrases.forEach(function(phrase) {
    var ratio = __miniASkillOverlapRatio(queryTerms, __miniASkillTokenize(phrase))
    if (ratio > intentBoost) intentBoost = ratio
  })

  var compatibilityBoost = 0
  if (isString(context.compatibilityKey) && context.compatibilityKey.length > 0 &&
      isMap(record.compatibility) && record.compatibility[context.compatibilityKey] === true) compatibilityBoost = 1

  var graphBoost = isNumber(context.graphBoost) ? context.graphBoost : 0

  return weights.lexical * lexicalScore
    + weights.name * nameBoost
    + weights.title * titleBoost
    + weights.intent * intentBoost
    + weights.tag * tagBoost
    + weights.appliesTo * appliesToBoost
    + weights.compatibility * compatibilityBoost
    + weights.graph * graphBoost
}

// ── observability (§29) ──────────────────────────────────────────────────────
// Counters only -- never skill body contents, per the "avoid context explosion"
// / "no body logging by default" requirements.
var __miniASkillMetrics = {
  searches: 0, recommends: 0, opens: 0, reads: 0, sectionsRead: 0, related: 0, charsReturned: 0
}

function __miniASkillMetricsIncr(name, n) {
  if (!isNumber(__miniASkillMetrics[name])) __miniASkillMetrics[name] = 0
  __miniASkillMetrics[name] += isNumber(n) ? n : 1
}

function __miniASkillMetricsSnapshot() {
  return clone(__miniASkillMetrics)
}

function __miniASkillLog(logFn, msg) {
  if (isFunction(logFn)) { try { logFn("info", "[skills] " + msg) } catch(e) {} }
}

// ── lightweight in-process caches (§30) ──────────────────────────────────────
// Short-TTL only: _metaFor() in mini-a-wiki.js already owns real invalidation
// (mtime/size-based); this just avoids recomputation within one burst of calls.
var __miniASkillOpenCache = {}
var __miniASkillReadCache = {}
var __miniASkillContextCache = {}

function __miniASkillCacheGet(store, key, ttlMs) {
  var entry = store[key]
  if (!isMap(entry)) return __
  if ((new Date().getTime() - entry.at) > ttlMs) { delete store[key]; return __ }
  return entry.value
}

function __miniASkillCacheSet(store, key, value) {
  store[key] = { at: new Date().getTime(), value: value }
}

function __miniASkillWikiIdentity(wm) {
  try { return isFunction(wm._getBackendIdentity) ? wm._getBackendIdentity() : "wiki" } catch(e) { return "wiki" }
}

// ── normalized virtual skill model (§2) ──────────────────────────────────────
function __miniASkillIsSkillMeta(meta) {
  if (!isMap(meta)) return false
  if (isString(meta.type) && meta.type.trim().toLowerCase() === "skill") return true
  // also recognize existing mini-a.skill/v1 (local SKILL.md/SKILL.yaml) authored
  // content that ended up mirrored into a wiki page, per docs/SKILLS-YAML-FORMAT.md
  if (isString(meta.schema) && meta.schema.trim().toLowerCase().indexOf("mini-a.skill/") === 0) return true
  return false
}

function __miniASkillRef(wikiName, localPath) {
  return (wikiName && wikiName !== "primary") ? ("wiki:@" + wikiName + "/" + localPath) : ("wiki:" + localPath)
}

// record is a _metaFor()-shaped map (see mini-a-wiki.js _buildPageRecord).
function __miniASkillNormalize(wikiName, localPath, record, extra) {
  extra = isMap(extra) ? extra : {}
  var baseName = String(localPath || "").replace(/\.md$/i, "").split("/").pop()
  var out = {
    schema       : __MINI_A_SKILL_SCHEMA,
    name         : isString(record.name) && record.name.length > 0 ? record.name : baseName,
    title        : isString(record.title) && record.title.length > 0 ? record.title : baseName,
    summary      : isString(extra.summary) && extra.summary.length > 0 ? extra.summary : (isString(record.description) ? record.description : ""),
    type         : isString(record.type) ? record.type : "",
    tags         : isArray(record.tags) ? record.tags : [],
    intents      : isArray(record.intent) ? record.intent : [],
    appliesTo    : isArray(record.appliesTo) ? record.appliesTo : [],
    requires     : isMap(record.requires) ? record.requires : {},
    compatibility: isMap(record.compatibility) ? record.compatibility : {},
    risk         : isString(record.risk) ? record.risk : "",
    trust        : isMap(record.trust) ? record.trust : {},
    version      : isString(record.version) ? record.version : "",
    provider     : "wiki",
    wiki         : wikiName || "primary",
    path         : localPath,
    ref          : __miniASkillRef(wikiName, localPath)
  }
  if (isDef(extra.sourceUrl)) out.sourceUrl = extra.sourceUrl
  if (isNumber(extra.score)) out.score = extra.score
  return out
}

// ── multi-wiki metadata resolution ───────────────────────────────────────────
function __miniASkillTargetsByName(wm, wikiSelector) {
  var targets = {}
  try {
    var selection = wm.resolveWikiSelection(wikiSelector)
    if (selection.ok) selection.targets.forEach(function(t) { targets[t.name] = t.manager })
  } catch(e) {}
  if (!isDef(targets.primary)) targets.primary = wm
  return targets
}

function __miniASkillResolveHitMeta(wm, targetsByName, hit) {
  var wikiName = isString(hit.wiki) ? hit.wiki : "primary"
  var manager = targetsByName[wikiName] || wm
  var localPath = hit.path
  var mountPrefix = "@" + wikiName + "/"
  if (wikiName !== "primary" && isString(localPath) && localPath.indexOf(mountPrefix) === 0) {
    localPath = localPath.substring(mountPrefix.length)
  }
  if (!isString(localPath) || localPath.length === 0) return __
  var meta
  try { meta = manager._metaFor(localPath) } catch(e) { meta = __ }
  if (!isMap(meta)) return __
  return { manager: manager, wikiName: wikiName, localPath: localPath, meta: meta }
}

function __miniASkillPassesFilters(meta, opts) {
  if (isArray(opts.tags) && opts.tags.length > 0) {
    var tags = (isArray(meta.tags) ? meta.tags : []).map(function(t) { return String(t).toLowerCase() })
    var wantTags = opts.tags.map(function(t) { return String(t).toLowerCase() })
    if (!wantTags.some(function(t) { return tags.indexOf(t) >= 0 })) return false
  }
  if (isArray(opts.appliesTo) && opts.appliesTo.length > 0) {
    var appliesTo = (isArray(meta.appliesTo) ? meta.appliesTo : []).map(function(t) { return String(t).toLowerCase() })
    var wantApplies = opts.appliesTo.map(function(t) { return String(t).toLowerCase() })
    if (!wantApplies.some(function(t) { return appliesTo.indexOf(t) >= 0 })) return false
  }
  if (isString(opts.compatibility) && opts.compatibility.trim().length > 0) {
    var compat = isMap(meta.compatibility) ? meta.compatibility : {}
    if (compat[opts.compatibility.trim()] !== true) return false
  }
  if (isString(opts.maxRisk) && opts.maxRisk.trim().length > 0) {
    if (__miniASkillRiskRank(meta.risk) > __miniASkillRiskRank(opts.maxRisk)) return false
  }
  return true
}

// Best-effort, bounded-by-cache full listing used only when search() is called
// without free text (tag/appliesTo/compatibility-only browsing). Relies entirely
// on _metaFor()'s own shard cache -- see mini-a-wiki.js -- so repeated calls are
// cheap after the first pass over a wiki.
function __miniASkillListAll(wm, wikiSelector, capPerWiki) {
  var out = []
  var targets = __miniASkillTargetsByName(wm, wikiSelector)
  Object.keys(targets).forEach(function(name) {
    var manager = targets[name]
    var pages
    try { pages = manager._safeListPages("") } catch(e) { pages = [] }
    for (var i = 0; i < pages.length && i < capPerWiki; i++) {
      var meta
      try { meta = manager._metaFor(pages[i]) } catch(e) { meta = __ }
      if (isMap(meta)) out.push({ path: pages[i], wiki: name, description: meta.description })
    }
  })
  return out
}

// ── skills-context (§7) ───────────────────────────────────────────────────────
function __miniASkillCountAll(wm) {
  var count = 0
  function countManager(manager) {
    var pages
    try { pages = manager._safeListPages("") } catch(e) { pages = [] }
    pages.forEach(function(p) {
      try {
        var m = manager._metaFor(p)
        if (__miniASkillIsSkillMeta(m)) count++
      } catch(e) {}
    })
  }
  countManager(wm)
  ;(isArray(wm._mounts) ? wm._mounts : []).forEach(function(m) { try { countManager(m.manager) } catch(e) {} })
  return count
}

function __miniASkillContext(wm, options, logFn) {
  var opts = isObject(options) ? options : {}
  var base = wm.context(opts) || {}
  var cacheKey = __miniASkillWikiIdentity(wm)
  var now = new Date().getTime()
  var ttl = isNumber(opts.skillCountTtlMs) && opts.skillCountTtlMs >= 0 ? opts.skillCountTtlMs : 30000
  var cached = ttl > 0 ? __miniASkillCacheGet(__miniASkillContextCache, cacheKey, ttl) : __
  var skillCount
  if (isNumber(cached)) {
    skillCount = cached
  } else {
    skillCount = __miniASkillCountAll(wm)
    if (ttl > 0) __miniASkillCacheSet(__miniASkillContextCache, cacheKey, skillCount)
  }
  var wikis = [{ name: "primary", label: (base.wikis && base.wikis[0] && base.wikis[0].label) || "primary" }]
  ;(base.mounts || []).forEach(function(m) { wikis.push({ name: m.name, label: m.label || m.name }) })
  __miniASkillLog(logFn, "context -> " + skillCount + " skills across " + wikis.length + " wiki(s)")
  return {
    label   : isString(opts.label) ? opts.label : "Skill library",
    skillCount: skillCount,
    wikis   : wikis,
    features: {
      search   : true,
      recommend: true,
      graph    : isString(base.retrieval && base.retrieval.graph) && base.retrieval.graph !== "none",
      multiWiki: wikis.length > 1
    },
    hint: "Call search or recommend first. Use open() to inspect a candidate before read(); read() only the section you need."
  }
}

// wm.search()/searchSelected() match a query as one literal (or regex) needle --
// exact for a single keyword, but a multi-word natural-language query (the common
// case for recommend()) almost never appears as a verbatim substring, especially
// without a Lucene index built (small/ad hoc skill libraries). Search per
// significant term instead and merge by path, so multi-term queries behave as an
// OR-of-terms lexical match while every match still comes from wm.search() itself
// -- no parallel retrieval implementation.
function __miniASkillRawHits(wm, query, opts, overFetch) {
  var terms = __miniASkillTokenize(query).filter(function(t) { return t.length >= 3 }).slice(0, 6)
  if (terms.length === 0 && query.length > 0) terms = [query]
  var byKey = {}
  terms.forEach(function(term) {
    var searchOpts = { limit: overFetch, compact: true, contextLines: 0, wiki: opts.wiki }
    var raw
    try { raw = isDef(opts.wiki) ? wm.searchSelected(term, searchOpts) : wm.search(term, searchOpts) } catch(e) { raw = [] }
    if (!isArray(raw)) return
    raw.forEach(function(hit) {
      var key = (isString(hit.wiki) ? hit.wiki : "primary") + "|" + hit.path
      if (!byKey[key]) byKey[key] = merge({}, hit, { _termHits: 0, _termCount: terms.length })
      byKey[key]._termHits++
      if (isNumber(hit.score) && (!isNumber(byKey[key].score) || hit.score > byKey[key].score)) byKey[key].score = hit.score
    })
  })
  var merged = Object.keys(byKey).map(function(k) { return byKey[k] })
  merged.sort(function(a, b) { return b._termHits - a._termHits })
  return merged
}

// ── skills-search (§8) ────────────────────────────────────────────────────────
function __miniASkillSearch(wm, options, logFn) {
  var opts = isObject(options) ? options : {}
  var query = isString(opts.query) ? opts.query.trim() : ""
  var limit = isNumber(opts.limit) && opts.limit > 0 ? Math.min(Math.floor(opts.limit), 50) : 10
  var typeFilter = isDef(opts.type) ? String(opts.type).trim().toLowerCase() : "skill"
  var overFetch = Math.min(Math.max(limit * 5, 40), 200)

  var hits = query.length === 0 ? __miniASkillListAll(wm, opts.wiki, overFetch) : __miniASkillRawHits(wm, query, opts, overFetch)

  var targetsByName = __miniASkillTargetsByName(wm, opts.wiki)
  var queryTerms = __miniASkillTokenize(query)
  var results = []
  hits.forEach(function(hit, idx) {
    var resolved = __miniASkillResolveHitMeta(wm, targetsByName, hit)
    if (!resolved) return
    var meta = resolved.meta
    if (typeFilter !== "*" && typeFilter.length > 0 && String(meta.type || "").toLowerCase() !== typeFilter) return
    if (!__miniASkillPassesFilters(meta, opts)) return
    var nativeScore = isNumber(hit.score) ? hit.score
      : (isNumber(hit._termHits) && isNumber(hit._termCount) && hit._termCount > 0 ? hit._termHits / hit._termCount : __)
    var score = __miniAComputeSkillScore(queryTerms, meta, {
      rank: idx, nativeScore: nativeScore, compatibilityKey: opts.compatibility, weights: opts.weights
    })
    results.push(__miniASkillNormalize(resolved.wikiName, resolved.localPath, meta, {
      summary: hit.description, score: score, sourceUrl: hit[wm._sourceField]
    }))
  })
  results.sort(function(a, b) { return b.score - a.score })
  results = results.slice(0, limit)
  __miniASkillMetricsIncr("searches")
  __miniASkillLog(logFn, "searched \"" + query + "\" -> " + results.length + " candidate(s)")
  return results
}

// ── skills-recommend (§9) ─────────────────────────────────────────────────────
// Deterministic (lexical + boosts) today; the query-construction step below is the
// only thing a future semantic/vector retriever would need to replace, without
// changing this function's signature or callers.
function __miniASkillRecommend(wm, options, logFn) {
  var opts = isObject(options) ? options : {}
  var task = isString(opts.task) ? opts.task.trim() : ""
  if (task.length === 0) return []
  var envTerms = []
  if (isMap(opts.environment)) Object.keys(opts.environment).forEach(function(k) { envTerms.push(String(opts.environment[k])) })
  if (isArray(opts.capabilities)) envTerms = envTerms.concat(opts.capabilities.map(String))
  var query = [task].concat(envTerms).join(" ")
  var searchOpts = merge({}, opts)
  searchOpts.query = query
  delete searchOpts.task
  delete searchOpts.environment
  delete searchOpts.capabilities
  var results = __miniASkillSearch(wm, searchOpts, logFn)
  __miniASkillMetricsIncr("recommends")
  return results
}

// ── skills-open (§11) ─────────────────────────────────────────────────────────
function __miniASkillOpen(wm, ref, options, logFn) {
  var opts = isObject(options) ? options : {}
  var ttl = isNumber(opts.cacheTtlMs) && opts.cacheTtlMs >= 0 ? opts.cacheTtlMs : 15000
  var cacheKey = __miniASkillWikiIdentity(wm) + "|" + String(ref)
  if (ttl > 0) {
    var cached = __miniASkillCacheGet(__miniASkillOpenCache, cacheKey, ttl)
    if (isDef(cached)) return cached
  }
  var descriptor = wm.open(ref, { maxHeadings: opts.maxHeadings })
  if (!isObject(descriptor)) return { error: "not-found", ref: ref }
  var fm = isMap(descriptor.frontmatter) ? descriptor.frontmatter : {}
  var appliesToRaw = isDef(fm.applies_to) ? fm.applies_to : fm.appliesTo
  var intentRaw = isDef(fm.intent) ? fm.intent : fm.intents
  var out = {
    ref     : descriptor.ref,
    name    : isString(fm.name) && fm.name.length > 0 ? fm.name : String(descriptor.path || "").replace(/\.md$/i, "").split("/").pop(),
    title   : descriptor.title,
    summary : descriptor.description,
    type    : isString(fm.type) ? fm.type : "",
    headings: descriptor.headings.map(function(h) { return h.title }),
    headingsDetailed: descriptor.headings,
    size    : descriptor.size,
    tags    : isArray(fm.tags) ? fm.tags : [],
    intents : isArray(intentRaw) ? intentRaw : (isString(intentRaw) ? [intentRaw] : []),
    appliesTo: isArray(appliesToRaw) ? appliesToRaw : (isString(appliesToRaw) ? [appliesToRaw] : []),
    requires: isMap(fm.requires) ? fm.requires : {},
    compatibility: isMap(fm.compatibility) ? fm.compatibility : {},
    risk    : isString(fm.risk) ? fm.risk : "",
    trust   : isMap(fm.trust) ? fm.trust : {},
    version : isDef(fm.version) ? String(fm.version) : "",
    links   : descriptor.links,
    headingsTruncated: descriptor.headingsTruncated === true,
    linksTruncated: descriptor.linksTruncated === true
  }
  if (ttl > 0) __miniASkillCacheSet(__miniASkillOpenCache, cacheKey, out)
  __miniASkillMetricsIncr("opens")
  __miniASkillLog(logFn, "opened " + ref + " (" + out.headings.length + " headings)")
  return out
}

// ── skills-read (§12) ─────────────────────────────────────────────────────────
// Defaults favor a bounded section/range read (maxChars is deliberately tighter
// than the general wiki reader's default) -- never the whole skill body unless the
// caller explicitly raises maxChars.
function __miniASkillRead(wm, ref, options, logFn) {
  var opts = isObject(options) ? options : {}
  var readOpts = {
    section  : opts.section,
    startLine: isDef(opts.startLine) ? opts.startLine : opts.lineStart,
    endLine  : isDef(opts.endLine) ? opts.endLine : opts.lineEnd,
    maxChars : isNumber(opts.maxChars) && opts.maxChars > 0 ? opts.maxChars : 4000
  }
  var ttl = isNumber(opts.cacheTtlMs) && opts.cacheTtlMs >= 0 ? opts.cacheTtlMs : 15000
  var cacheKey = __miniASkillWikiIdentity(wm) + "|" + String(ref) + "|" + String(readOpts.section || "") + "|" +
    String(readOpts.startLine || "") + "-" + String(readOpts.endLine || "") + "|" + String(readOpts.maxChars)
  if (ttl > 0) {
    var cached = __miniASkillCacheGet(__miniASkillReadCache, cacheKey, ttl)
    if (isDef(cached)) return cached
  }
  var out = wm.agenticRead(ref, readOpts)
  if (!isObject(out)) return { error: "not-found", ref: ref }
  if (ttl > 0) __miniASkillCacheSet(__miniASkillReadCache, cacheKey, out)
  __miniASkillMetricsIncr("reads")
  if (isString(opts.section) && opts.section.length > 0) __miniASkillMetricsIncr("sectionsRead")
  __miniASkillMetricsIncr("charsReturned", isNumber(out.chars) ? out.chars : 0)
  __miniASkillLog(logFn, "loaded " + (opts.section ? "section \"" + opts.section + "\"" : "range") + " of " + ref + " (" + (out.chars || 0) + " chars)")
  return out
}

// ── WikiSkillProvider (§15) ───────────────────────────────────────────────────
// Minimal provider abstraction so mini-a's skill discovery/resolution can later be
// generalized across LocalSkillProvider/PluginSkillProvider/WikiSkillProvider
// without special-casing wiki-backed skills. Every method below is a direct,
// synchronous call into the facade functions above -- there is no second
// execution path to keep in sync.
function MiniAWikiSkillProvider(wikiManager, options) {
  this._wm = wikiManager
  this._options = isMap(options) ? options : {}
  this._logFn = isFunction(this._options.logFn) ? this._options.logFn : __
  this.provider = "wiki"
}

MiniAWikiSkillProvider.prototype.context = function(opts) { return __miniASkillContext(this._wm, opts, this._logFn) }
MiniAWikiSkillProvider.prototype.search = function(opts) { return __miniASkillSearch(this._wm, opts, this._logFn) }
MiniAWikiSkillProvider.prototype.recommend = function(opts) { return __miniASkillRecommend(this._wm, opts, this._logFn) }
MiniAWikiSkillProvider.prototype.open = function(ref, opts) { return __miniASkillOpen(this._wm, ref, opts, this._logFn) }
MiniAWikiSkillProvider.prototype.read = function(ref, opts) { return __miniASkillRead(this._wm, ref, opts, this._logFn) }
MiniAWikiSkillProvider.prototype.related = function(ref, opts) { return __miniASkillRelated(this._wm, ref, opts, this._logFn) }

// resolve(): normalize a selected skill into a structure compatible with mini-a's
// existing skill rendering machinery (__miniARenderSkillTemplate expects a
// {{args}}/{{argv}}/{{arg1}}-style bodyTemplate), so a remote wiki skill can be
// invoked the same way as a local SKILL.md/SKILL.yaml one (§19-20: discovery and
// execution stay separate -- this only normalizes a skill the caller already
// explicitly selected via search/recommend/open, it never runs anything).
MiniAWikiSkillProvider.prototype.resolve = function(ref, opts) {
  var descriptor = this.open(ref, opts)
  if (!isObject(descriptor) || isDef(descriptor.error)) return __
  var bodyOpts = merge({ maxChars: 32000 }, isMap(opts) ? opts : {})
  var body = this.read(ref, bodyOpts)
  return {
    format      : "wiki",
    name        : descriptor.name,
    description : descriptor.summary,
    meta        : {
      tags: descriptor.tags, risk: descriptor.risk, compatibility: descriptor.compatibility,
      requires: descriptor.requires, version: descriptor.version, appliesTo: descriptor.appliesTo,
      intents: descriptor.intents
    },
    bodyTemplate: isObject(body) && isString(body.body) ? body.body : "",
    virtualFiles: {},
    ref         : ref,
    truncated   : isObject(body) ? body.truncated === true : false
  }
}

// ── skills-related (§14) ──────────────────────────────────────────────────────
function __miniASkillRelated(wm, ref, options, logFn) {
  var opts = isObject(options) ? options : {}
  var raw = wm.related(ref, opts)
  if (!isObject(raw)) return { error: "not-found", ref: ref }
  var mapEntry = function(e) {
    if (!isObject(e)) return e
    var out = merge({}, e)
    if (isString(e.path) && !isString(e.ref)) out.ref = e.path.indexOf("wiki:") === 0 ? e.path : "wiki:" + e.path
    return out
  }
  __miniASkillMetricsIncr("related")
  __miniASkillLog(logFn, "related " + ref)
  return {
    ref     : ref,
    backlinks: (raw.backlinks || []).map(mapEntry),
    graph   : (raw.graph || []).map(mapEntry),
    cross   : isArray(raw.cross) ? raw.cross.map(mapEntry) : []
  }
}
