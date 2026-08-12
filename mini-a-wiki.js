// Author: Nuno Aguiar
// License: Apache 2.0
// Description: Wiki manager for Mini-A. Supports filesystem, S3, Elasticsearch and static HTTP(S) backends.

// ── Template version & helpers ────────────────────────────────────────────────

var __MINI_A_WIKI_AGENTS_VERSION = 4
var __MINI_A_WIKI_LEXICAL_SCHEMA_VERSION = 1
var __MINI_A_WIKI_LEXICAL_LANGUAGES = [
  "arabic", "armenian", "basque", "bengali", "brazilian", "bulgarian", "catalan", "chinese", "cjk", "czech", "danish", "dutch", "english", "estonian", "finnish", "french", "galician", "german", "greek", "hindi", "hungarian", "indonesian", "irish", "italian", "latvian", "lithuanian", "norwegian", "persian", "polish", "portuguese", "romanian", "russian", "sorani", "spanish", "swedish", "tamil", "telugu", "thai", "turkish"
]

// Keep the on-disk index contract deliberately small and model-free. More
// expensive lexical features remain explicit opt-ins in wikilexical.
var __miniAWikiLexicalConfig = function(raw, wikiRoot) {
  var value = raw
  if (isUnDef(value) || value === null || (isString(value) && value.trim().length === 0)) value = { language: "english" }
  if (isString(value)) {
    try { value = af.fromJSSLON(value) } catch(e) { throw new Error("Invalid wikilexical configuration: expected SLON/JSON object: " + __miniAErrMsg(e)) }
  }
  if (!isMap(value)) throw new Error("Invalid wikilexical configuration: expected a SLON/JSON object")
  var allowed = { language: true, synonyms: true, synonymsfile: true, shingles: true, ngrams: true, queryexpansion: true, pseudorelevancefeedback: true }
  Object.keys(value).forEach(function(key) {
    if (allowed[String(key).toLowerCase()] !== true) throw new Error("Invalid wikilexical configuration: unsupported option '" + key + "'")
  })
  var language = isString(value.language) ? value.language.toLowerCase().trim() : "english"
  if (__MINI_A_WIKI_LEXICAL_LANGUAGES.indexOf(language) < 0) throw new Error("Invalid wikilexical language '" + String(value.language) + "'. Supported Lucene languages include english, french, german, portuguese and spanish.")
  var cfg = { language: language, synonyms: [], shingles: false, ngrams: false, queryExpansion: false, pseudoRelevanceFeedback: false }
  var normalizeRules = function(rules, source) {
    if (!isArray(rules)) throw new Error("Invalid wikilexical " + source + ": expected an array of synonym rules")
    return rules.map(function(rule, i) {
      var terms = isString(rule) ? rule.split(",") : rule
      if (!isArray(terms) || terms.length < 2 || !terms.every(function(t) { return isString(t) && t.trim().length > 0 })) throw new Error("Invalid wikilexical synonym rule at index " + i + " in " + source + ": use a comma-separated string or an array with at least two terms")
      return terms.map(function(t) { return t.trim().toLowerCase() })
    })
  }
  if (isDef(value.synonyms)) {
    cfg.synonyms = normalizeRules(value.synonyms, "synonyms")
  }
  var synonymsFile = isDef(value.synonymsFile) ? value.synonymsFile : value.synonymsfile
  if (isDef(synonymsFile)) {
    if (!isString(synonymsFile) || synonymsFile.trim().length === 0) throw new Error("Invalid wikilexical synonymsFile: expected a non-empty file path")
    var synonymsPath = synonymsFile.trim()
    if (!(new java.io.File(synonymsPath)).isAbsolute()) {
      var rootFile = isDef(wikiRoot) ? new java.io.File(String(wikiRoot)) : __
      if (isUnDef(rootFile) || !rootFile.isDirectory()) throw new Error("Invalid wikilexical synonymsFile: a relative path requires a filesystem wiki root")
      synonymsPath = rootFile.getCanonicalPath() + java.io.File.separator + synonymsPath
    }
    var synonymsJavaFile = new java.io.File(synonymsPath)
    if (!synonymsJavaFile.isFile()) throw new Error("Invalid wikilexical synonymsFile: file not found: " + synonymsPath)
    var synonymsRaw = io.readFileString(synonymsPath).trim()
    var fileRules
    try {
      fileRules = af.fromJSSLON(synonymsRaw)
    } catch(e) {
    }
    if (!isArray(fileRules)) fileRules = synonymsRaw.split(/\r?\n/).map(function(line) { return line.trim() }).filter(function(line) { return line.length > 0 && line.indexOf("#") !== 0 })
    cfg.synonyms = cfg.synonyms.concat(normalizeRules(fileRules, "synonymsFile"))
  }
  ;["shingles", "ngrams", "queryExpansion", "pseudoRelevanceFeedback"].forEach(function(key) {
    var sourceKey = key.toLowerCase()
    var provided = isDef(value[key]) ? value[key] : value[sourceKey]
    if (isDef(provided) && typeof provided !== "boolean") throw new Error("Invalid wikilexical " + key + ": expected boolean")
    if (isDef(provided)) cfg[key] = provided
  })
  return cfg
}

var __miniAWikiLexicalFingerprint = function(cfg) {
  var normalized = {
    language: cfg.language,
    synonyms: cfg.synonyms,
    shingles: cfg.shingles === true,
    ngrams: cfg.ngrams === true,
    queryExpansion: cfg.queryExpansion === true,
    pseudoRelevanceFeedback: cfg.pseudoRelevanceFeedback === true
  }
  return sha1(stringify(normalized, __, ""))
}

// These small helpers are deliberately standalone so callers can validate URL and
// bundle metadata behaviour without requiring a live HTTP or S3 service.
var __miniAWikiUrlJoin = function(base, path) {
  var b = isString(base) ? base.trim() : ""
  var p = isString(path) ? path.trim() : ""
  while (b.endsWith("/")) b = b.substring(0, b.length - 1)
  while (p.startsWith("/")) p = p.substring(1)
  return p.length > 0 ? b + "/" + p : b
}

var __miniAWikiBundleChanged = function(remote, local) {
  if (!isMap(remote) || !isMap(local)) return true
  if (isString(remote.etag) && remote.etag.length > 0) return remote.etag !== local.etag
  if (isString(remote.lastModified) && remote.lastModified.length > 0) return remote.lastModified !== local.lastModified
  return true
}

var __miniAWikiBundleEntryRelative = function(entry) {
  if (!isString(entry)) return __
  var value = String(entry).replace(/\\/g, "/")
  if (value.indexOf("..") >= 0 || value.startsWith("/")) return __
  if (value.indexOf(".mini-a-wiki-lucene/") === 0 || value.indexOf(".mini-a-wiki-graph/") === 0) return value
  return __
}

var __miniAWikiBasicAuth = function(accessKey, secret) {
  var raw = new java.lang.String(String(accessKey) + ":" + String(secret))
  return "Basic " + java.util.Base64.getEncoder().encodeToString(raw.getBytes("UTF-8"))
}

// v1 stock fingerprint phrase — if AGENTS.md contains this verbatim it was never user-edited
var __MINI_A_WIKI_V1_STOCK_PHRASE = "This file defines how agents should read, distil, and contribute knowledge to this wiki."

var __miniAWikiAgentsTemplate = function(now) {
  return [
    "---",
    "title: Wiki Contribution Guidelines",
    "description: Rules and workflow for agents reading from and writing to this wiki.",
    "agentsVersion: " + __MINI_A_WIKI_AGENTS_VERSION,
    "created: " + now,
    "updated: " + now,
    "---",
    "",
    "<!-- mini-a:agents managed:start — content inside is overwritten on template upgrade -->",
    "",
    "# Wiki Contribution Guidelines",
    "",
    "## Quick start",
    "",
    "1. **`context`** — call once to get a compact wiki overview before anything else.",
    "2. **`search`** — find candidates first, always. Call before read or write.",
    "3. **`read`** — read the best match. For long pages: `countLines=true` first, then `section=` for the heading you need.",
    "4. **`write`** — distil and save knowledge. Fill all required frontmatter fields.",
    "5. **`lint`** — fix all error-severity issues before finishing.",
    "6. Never edit AGENTS.md, index.md, or log.md directly.",
    "",
    "## Operations in this surface",
    "",
    "Available agent action ops (`wiki op=\"...\"`):  ",
    "`context` · `search` · `read` · `list` · `browse` · `tree` · `backlinks` · `write` · `delete` · `move` · `init` · `lint` · `reindex` · `attach` · `detach` · `mounts`",
    "",
    "- `wiki op=\"context\"` — compact wiki overview (page count, sections, mounts, recent changes).",
    "- `wiki op=\"search\" query=\"...\"` — search pages; returns path+title+description by default.",
    "- `wiki op=\"read\" path=\"...\"` — read a page; add `section=` for one heading only.",
    "- `wiki op=\"list\"` — list pages; add `withMeta=true` for path+title+description+type+updated.",
    "- `wiki op=\"browse\"` — navigate section structure.",
    "- `wiki op=\"tree\"` — full hierarchy tree.",
    "- `wiki op=\"write\" path=\"...\" meta={...} body=\"...\"` — write or update a page.",
    "- `wiki op=\"delete\" path=\"...\"` — delete a page.",
    "- `wiki op=\"move\" from=\"...\" to=\"...\"` — move and rewrite all links.",
    "- `wiki op=\"init\" path=\"...\"` — create a section index.md.",
    "- `wiki op=\"lint\"` — health check; fix error-severity results.",
    "- `wiki op=\"attach\" name=\"...\" backend=\"fs\" root=\"...\"` — mount a read-only wiki at @name/.",
    "- `wiki op=\"detach\" name=\"...\"` — unmount.",
    "- `wiki op=\"mounts\"` — list active mounts.",
    "",
    "## Page schema",
    "",
    "Every page is a Markdown file with a YAML front-matter block.",
    "",
    "### Required front-matter fields",
    "",
    "```yaml",
    "---",
    "title: Human-readable title (string)",
    "description: One-sentence summary of the page (string)",
    "created: <ISO 8601 timestamp>",
    "updated: <ISO 8601 timestamp>   # refresh on every write",
    "type: concept | entity | comparison | summary | overview   # required by OKF; auto-filled to 'concept' if omitted",
    "---",
    "```",
    "",
    "`timestamp` is accepted as an alias of `updated` (OKF compatibility) — read as `updated` if `updated` is absent; written alongside `updated` on every save.",
    "",
    "### Optional front-matter fields",
    "",
    "```yaml",
    "tags: [tag1, tag2]              # lowercase slugs",
    "aliases: [alt-name]             # alternative names for search",
    "supersedes: path/to/old.md      # when this page replaces another",
    "status: draft | review | stable # omit for stable",
    "```",
    "",
    "### Provenance fields (set by the ingest pipeline)",
    "",
    "```yaml",
    "source: path/or/url             # the document this page was distilled from",
    "source_ref: <commit sha|origin> # repo commit or origin the source came from",
    "source_hash: <sha1>             # sha1 of the ingested source content",
    "ingested: <ISO 8601 timestamp>  # when the distillation ran",
    "```",
    "",
    "Pages carrying these fields are machine-ingested. Edit them freely, but expect a later",
    "ingest of a changed source to overwrite the page — record durable additions elsewhere.",
    "",
    "### Body conventions",
    "",
    "- Start with a single `# Title` heading matching `front-matter.title`.",
    "- Use `## Section` headings; never skip levels (h1 → h3 is wrong).",
    "- One concept per page. Split when a section exceeds ~300 words.",
    "- End with `## See also` listing related pages when relevant.",
    "",
    "## Ingestion workflow",
    "",
    "1. **Search first** — call search before creating anything. If a relevant page exists, update it.",
    "2. **Distil, do not dump** — extract the essential fact. Strip conversation context and ephemeral details.",
    "3. **One concept per page** — if knowledge spans multiple concepts, create one page per concept and link them.",
    "4. **Write or update:**",
    "   - New page: set `created` and `updated` to now.",
    "   - Existing page: update `updated`, preserve `created`.",
    "   - To supersede stale content: set `supersedes` in the new page and mark the old page body with `> **Superseded** — see [New Page](path.md)`.",
    "5. **Link** — add links from related pages. Use relative Markdown links or `[[Page Name]]` wiki-style links.",
    "6. **Lint** — run lint and fix all error-severity issues.",
    "",
    "## Retrieval conventions",
    "",
    "- Start with `context` to get a compact wiki overview before doing anything else.",
    "- Use `search` to find candidates; then `read` the most relevant result.",
    "- For long pages: call `read(path, countLines=true)` first, then `read(path, section=\"heading name\")` to fetch only what you need. Never read a full page when a section read suffices.",
    "- Use `browse` or `tree` to navigate folder structure when search does not surface results.",
    "- Use `read index.md` for the wiki entrypoint and catalog.",
    "- Prefer the most-recently-updated page when multiple pages cover similar ground.",
    "- Trust `status: stable` content; treat `status: draft` as provisional.",
    "",
    "## Folder structure (recommended, never enforced)",
    "",
    "Common folder names: `topics/`, `concepts/`, `entities/`, `comparisons/`.  ",
    "Use them when they fit; create others freely; never move pages just to match this taxonomy.  ",
    "Unfiled pages at the root are valid. Structure is emergent.",
    "",
    "## Attached wikis (read-only mounts)",
    "",
    "Other wikis may be mounted read-only. Mounted pages appear as `@name/path.md`.",
    "- Search, read, browse, and tree span all mounts automatically.",
    "- Writes always go to the primary wiki. `write @name/...` is rejected.",
    "- See `## Attached wikis` in `index.md` for a list of active mounts.",
    "- Each mount's home is readable via `read \"@name/index.md\"`.",
    "",
    "## Linking",
    "",
    "- Use relative Markdown links: `[Page Title](path/to/page.md)`.",
    "- Wiki-style links: `[[Page Title]]` (auto-slugified, root-relative).",
    "- Cross-wiki links to mounts: `@name/path.md` — resolved against the named mount.",
    "",
    "## log.md",
    "",
    "`log.md` is an append-only journal of all write, delete, and move operations.  ",
    "Never write to it directly. Read it to see recent changes.",
    "",
    "## index.md",
    "",
    "`index.md` (root and per-section) is a catalog of pages with summaries and section links.  ",
    "It is regenerated by the wiki dream apply pass. Run the dream to refresh it.",
    "",
    "## Content rules",
    "",
    "- Write concise, factual, durable content. State the fact once; link rather than restate.",
    "- Do not contradict existing pages without first marking the old content as superseded.",
    "- Do not duplicate information that already exists on another page — link instead.",
    "- Use neutral, encyclopaedic tone. No first-person ('I found…', 'we decided…').",
    "",
    "## Writing style — write like a plain reference, not an AI",
    "",
    "- Use plain verbs: `is` / `has`, not \"serves as\", \"stands as\", \"boasts\", \"features\".",
    "- Cut puffery: no \"pivotal\", \"crucial\", \"rich tapestry\", \"groundbreaking\", \"marks a turning point\", \"underscores\".",
    "- Drop trailing \"-ing\" significance clauses (\"…, highlighting its importance\").",
    "- No negative parallelism: avoid \"not only X but also Y\" / \"not X, but Y\".",
    "- Attribute specifically or not at all — no \"experts say\", \"some critics\", \"studies show\".",
    "- Avoid rule-of-three padding and forced synonym-swapping; repeat the plain term.",
    "- No editorialising wrap-ups or future speculation without sources.",
    "- Formatting: sentence-case headings; bold only for first-use definitions; straight quotes; minimal em dashes; no emoji; never skip heading levels.",
    "",
    "## Lint",
    "",
    "- Run lint before finishing to check for broken links, orphan pages, and stale content.",
    "- Fix all error-severity issues.",
    "- Address warning-severity issues where possible.",
    "- info-severity issues (near-duplicates, stale pages) are advisory; use judgement.",
    "",
    "<!-- mini-a:agents managed:end -->",
  ].join("\n")
}

var __miniAWikiIndexRootTemplate = function(now) {
  return [
    "---",
    "title: Wiki Home",
    "description: Main entrypoint and table of contents for this wiki.",
    "created: " + now,
    "updated: " + now,
    "tags:",
    "  - home",
    "  - index",
    "---",
    "",
    "# Wiki Home",
    "",
    "Main entrypoint for this wiki. Start with `context` or search, then read the most relevant page.",
    "",
    "## Start here",
    "",
    "- [AGENTS.md](AGENTS.md) — contribution rules, page schema, and workflow for agents.",
    "- [log.md](log.md) — append-only journal of recent writes and moves.",
    "",
    "## Sections",
    "",
    "- Add section index links here as the wiki grows.",
    "",
    "## Pages",
    "",
    "- Add top-level page links here.",
    "",
    "## Recent",
    "",
    "- See [log.md](log.md) for recent changes.",
  ].join("\n")
}

var __miniAWikiLogTemplate = function(now) {
  return [
    "---",
    "title: Wiki Log",
    "description: Append-only journal of wiki write, delete, and move operations.",
    "created: " + now,
    "updated: " + now,
    "tags:",
    "  - log",
    "---",
    "",
    "# Wiki Log",
    "",
    "Append-only. Do not edit this file directly.",
  ].join("\n")
}

var MiniAWikiManager = function(config, loggerFn, auditFn) {
  this._logFn  = isFunction(loggerFn) ? loggerFn : function() {}
  this._auditFn = isFunction(auditFn) ? auditFn : function() {}
  this._config = {}
  this._backend = __
  this.configure(config)
}

// Best-effort hook for backends that fetch page content from an external
// store (s3, http, es). Never lets a caller-supplied audit callback break
// retrieval. `identifier` is the backend-resolved location (s3://bucket/key,
// full URL, es:index/path) -- distinct from `path`, the wiki-relative path.
MiniAWikiManager.prototype._auditRetrieval = function(backend, identifier, path, ok, bytes) {
  try { this._auditFn({ backend: backend, identifier: identifier, path: path, ok: ok === true, bytes: isNumber(bytes) ? bytes : 0 }) } catch(e) {}
}


MiniAWikiManager.prototype._indexMeta = function() {
  return {
    hiddenNames: [
      ".mini-a-wiki-lucene.lock",
      ".mini-a-wiki-meta",
      ".mini-a-wiki-graph"
    ]
  }
}

MiniAWikiManager.prototype._isHiddenPath = function(path) {
  var p = isString(path) ? String(path).trim() : ""
  if (p.length === 0) return false
  var bn = p.split("/").pop()
  var meta = this._indexMeta()
  return meta.hiddenNames.indexOf(p) >= 0 || meta.hiddenNames.indexOf(bn) >= 0
}

MiniAWikiManager.prototype._isSearchExcludedPath = function(path) {
  var p = isString(path) ? String(path).trim() : ""
  if (p.length === 0) return false
  if (this._isHiddenPath(p)) return true
  var bn = p.split("/").pop()
  if (bn === "AGENTS.md" || bn === "index.md" || bn === "log.md") return true
  if (p.indexOf("/.mini-a-wiki-graph/") >= 0 || p.indexOf("/.mini-a-wiki-graph") === 0) return true
  return p.split("/").some(function(part) { return part.length > 0 && part.charAt(0) === "." })
}

MiniAWikiManager.prototype._safeListPages = function(prefix) {
  this._maybeRefreshArtifactBundle()
  var self = this
  return this._backend.list(prefix).filter(function(p) {
    return isString(p) && p.endsWith('.md') && !self._isHiddenPath(p)
  })
}

MiniAWikiManager.prototype._ensureIndexRuntime = function() {
  this._metaShards = isMap(this._metaShards) ? this._metaShards : {}
  this._metaDirty = isMap(this._metaDirty) ? this._metaDirty : {}
  this._luceneChannel = isString(this._luceneChannel) ? this._luceneChannel : ""
  this._luceneFallbackWarned = this._luceneFallbackWarned === true
  this._luceneNeedsRebuild = this._luceneNeedsRebuild === true
  this._lexicalReadOnlyWarned = this._lexicalReadOnlyWarned === true
  this._stats = isMap(this._stats) ? this._stats : { luceneFullRebuilds: 0, luceneSets: 0, luceneUnsets: 0, metaHits: 0, metaMisses: 0 }
}

MiniAWikiManager.prototype._getBackendIdentity = function() {
  if (this._backendType === "s3" || this._backendType === "s3fs") {
    return "s3|" + (this._config.bucket || "") + "|" + (this._config.prefix || "")
  }
  if (this._backendType === "es") {
    return "es|" + (this._config.esurl || "") + "|" + (this._config.esindex || "")
  }
  if (this._backendType === "http") return "http|" + (this._config.url || "")
  return "fs|" + (isObject(this._backend) && isString(this._backend.root) ? this._backend.root : ".")
}

MiniAWikiManager.prototype._getIndexRoot = function() {
  if (this._backendType === "fs" || this._backendType === "s3fs") return this._backend.root
  if (isString(this._config.indexdir) && this._config.indexdir.trim().length > 0) return this._config.indexdir.trim()
  var home = String(java.lang.System.getProperty("user.home") || ".")
  return home + "/.mini-a/wiki-index/" + sha1(this._getBackendIdentity())
}

MiniAWikiManager.prototype._ensureIndexRoot = function() {
  var root = this._getIndexRoot()
  // read-only wikis never create index storage: they consume whatever already exists
  if (this._access !== "rw") return root
  try { if (!io.fileExists(root)) io.mkdir(root) } catch(e) {}
  return root
}

MiniAWikiManager.prototype._metaRoot = function() {
  return this._ensureIndexRoot() + "/.mini-a-wiki-meta"
}

MiniAWikiManager.prototype._metaShardKey = function(path) {
  return sha1(String(path || "")).substring(0, 1)
}

MiniAWikiManager.prototype._metaShardPath = function(shardKey) {
  return this._metaRoot() + "/shard-" + shardKey + ".json"
}

MiniAWikiManager.prototype._loadMetaShard = function(shardKey) {
  this._ensureIndexRuntime()
  if (isMap(this._metaShards[shardKey])) return this._metaShards[shardKey]
  if (this._access === "rw") {
    try {
      var root = this._metaRoot()
      if (!io.fileExists(root)) io.mkdir(root)
    } catch(e) {}
  }
  var shard = {}
  try {
    var path = this._metaShardPath(shardKey)
    if (io.fileExists(path)) {
      var parsed = af.fromJson(io.readFileString(path))
      if (isMap(parsed)) shard = parsed
    }
  } catch(ignoreLoad) {}
  this._metaShards[shardKey] = shard
  return shard
}

MiniAWikiManager.prototype._saveMetaShard = function(shardKey) {
  this._ensureIndexRuntime()
  // read-only wikis keep the shard in memory only; never write into the source tree
  if (this._access !== "rw") { this._metaDirty[shardKey] = false; return }
  if (this._metaDirty[shardKey] !== true) return
  try {
    var root = this._metaRoot()
    if (!io.fileExists(root)) io.mkdir(root)
    io.writeFileString(this._metaShardPath(shardKey), stringify(this._metaShards[shardKey] || {}, __, ""))
    this._metaDirty[shardKey] = false
  } catch(e) {
    this._logFn("warn", "Failed to persist wiki metadata shard: " + __miniAErrMsg(e))
  }
}

MiniAWikiManager.prototype._buildPageRecord = function(path, raw, parsed) {
  var meta = isMap(parsed && parsed.meta) ? parsed.meta : {}
  var body = isString(parsed && parsed.body) ? parsed.body : ""
  var lines = body.split(/\r?\n/)
  var headings = []
  for (var i = 0; i < lines.length; i++) {
    var m = String(lines[i] || "").match(/^(#{1,6})\s+(.+)$/)
    if (m) headings.push({ level: m[1].length, text: String(m[2] || "").trim() })
  }
  return {
    path: path,
    meta: meta,
    body: body,
    raw: raw,
    links: this.extractLinks(body),
    record: {
      hash: sha1(String(raw || "")),
      mtime: __,
      size: String(raw || "").length,
      title: isString(meta.title) ? meta.title : path,
      description: isString(meta.description) ? meta.description : "",
      type: isString(meta.type) ? meta.type : "",
      updated: isDef(meta.updated) ? String(meta.updated) : "",
      tags: isArray(meta.tags) ? clone(meta.tags) : [],
      aliases: isArray(meta.aliases) ? clone(meta.aliases) : [],
      supersedes: isString(meta.supersedes) ? meta.supersedes : "",
      links: this.extractLinks(body),
      headings: headings
    }
  }
}

MiniAWikiManager.prototype._metaReadFastInfo = function(path) {
  if (this._backendType !== "fs" && this._backendType !== "s3fs") return __
  try {
    var base = this._backend.root
    var full = new java.io.File(base, path)
    if (!full.exists() || !full.isFile()) return __
    return { mtime: Number(full.lastModified()), size: Number(full.length()) }
  } catch(e) {
    return __
  }
}

MiniAWikiManager.prototype._metaFor = function(path, rawOpt, parsedOpt) {
  this._ensureIndexRuntime()
  if (this._config.wikimetacache === false) {
    var rawDirect = isString(rawOpt) ? rawOpt : this._backend.read(path)
    if (!isString(rawDirect)) return __
    var parsedDirect = isMap(parsedOpt) ? parsedOpt : this.parseFrontmatter(rawDirect)
    return this._buildPageRecord(path, rawDirect, parsedDirect).record
  }
  var shardKey = this._metaShardKey(path)
  var shard = this._loadMetaShard(shardKey)
  var fast = this._metaReadFastInfo(path)
  var cached = isMap(shard[path]) ? shard[path] : __
  if (isMap(cached) && isMap(fast) && cached.mtime === fast.mtime && cached.size === fast.size) {
    this._stats.metaHits++
    return cached
  }
  var raw = isString(rawOpt) ? rawOpt : this._backend.read(path)
  if (!isString(raw)) return cached
  var parsed = isMap(parsedOpt) ? parsedOpt : this.parseFrontmatter(raw)
  var built = this._buildPageRecord(path, raw, parsed).record
  if (isMap(fast)) {
    built.mtime = fast.mtime
    built.size = fast.size
  }
  shard[path] = built
  this._metaDirty[shardKey] = true
  this._saveMetaShard(shardKey)
  this._stats.metaMisses++
  return built
}

// deferSave skips the per-call _saveMetaShard flush — batch callers (e.g.
// _readAllPageDocs) set it and flush each touched shard once afterwards, instead
// of rewriting the whole shard JSON on every single page.
MiniAWikiManager.prototype._metaUpdate = function(path, raw, parsed, deferSave) {
  this._ensureIndexRuntime()
  if (this._config.wikimetacache === false) return __
  var built = this._buildPageRecord(path, raw, parsed).record
  var fast = this._metaReadFastInfo(path)
  if (isMap(fast)) {
    built.mtime = fast.mtime
    built.size = fast.size
  }
  var shardKey = this._metaShardKey(path)
  this._loadMetaShard(shardKey)[path] = built
  this._metaDirty[shardKey] = true
  if (deferSave !== true) this._saveMetaShard(shardKey)
  return built
}

MiniAWikiManager.prototype._metaRemove = function(path) {
  this._ensureIndexRuntime()
  if (this._config.wikimetacache === false) return
  var shardKey = this._metaShardKey(path)
  var shard = this._loadMetaShard(shardKey)
  if (isMap(shard) && isDef(shard[path])) {
    delete shard[path]
    this._metaDirty[shardKey] = true
    this._saveMetaShard(shardKey)
  }
}

MiniAWikiManager.prototype._luceneChName = function() {
  return "__mini_a_wiki_searchdb_" + sha1(this._getLuceneIndexPath()).substring(0, 8)
}

// _luceneIndexExists: true when a usable Lucene index is already on disk. Used to keep
// read-only wikis from creating (and locking) an index they are not allowed to maintain.
MiniAWikiManager.prototype._luceneIndexExists = function() {
  try {
    var idxPath = this._getLuceneIndexPath()
    if (!io.fileExists(idxPath)) return false
    var listing = io.listFiles(idxPath)
    var files = isMap(listing) && isArray(listing.files) ? listing.files : []
    return files.some(function(f) { return isString(f.filename) && f.filename.indexOf("segments") === 0 })
  } catch(e) {
    return false
  }
}

// _luceneQueryReadOnly: queries an existing Lucene index through a bare DirectoryReader.
// No IndexWriter is opened, so no write.lock is taken and nothing is created on disk.
// Reads the searchdb channel schema (id / content / payload) rather than the addFile schema.
MiniAWikiManager.prototype._luceneQueryReadOnly = function(query, limit) {
  if (!this._ensureLucene()) return []
  if (!this._luceneIndexExists()) return []
  var max = isNumber(limit) && limit > 0 ? limit : 20
  var dir = __, reader = __
  var out = []
  try {
    var L = Packages.org.apache.lucene
    dir = L.store.FSDirectory.open(java.nio.file.Paths.get(this._getLuceneIndexPath()))
    reader = L.index.DirectoryReader.open(dir)
    var searcher = new L.search.IndexSearcher(reader)
    var parsed = new L.queryparser.classic.QueryParser("content", new L.analysis.standard.StandardAnalyzer()).parse(query)
    var hits = searcher.search(parsed, max)
    var scoreDocs = hits.scoreDocs
    for (var i = 0; i < scoreDocs.length; i++) {
      var doc = this._luceneStoredDoc(searcher, scoreDocs[i].doc)
      if (isUnDef(doc) || doc == null) continue
      var payload = {}
      try { payload = af.fromJson(String(doc.get("payload") || "{}")) } catch(ep) { payload = {} }
      out.push({
        id     : String(doc.get("id") || ""),
        content: isDef(doc.get("content")) ? String(doc.get("content")) : "",
        payload: isMap(payload) ? payload : {},
        score  : Number(scoreDocs[i].score)
      })
    }
  } catch(e) {
    this._logFn("warn", "Read-only Lucene query failed: " + __miniAErrMsg(e))
    return []
  } finally {
    try { if (isDef(reader) && reader != null) reader.close() } catch(ignoreR) {}
    try { if (isDef(dir) && dir != null) dir.close() } catch(ignoreD) {}
  }
  return out
}

MiniAWikiManager.prototype._luceneListAllReadOnly = function(prefix) {
  if (!this._ensureLucene() || !this._luceneIndexExists()) return []
  var pfx = isString(prefix) ? prefix.trim() : ""
  var dir = __, reader = __, out = [], seen = {}
  try {
    var L = Packages.org.apache.lucene
    dir = L.store.FSDirectory.open(java.nio.file.Paths.get(this._getLuceneIndexPath()))
    reader = L.index.DirectoryReader.open(dir)
    var searcher = new L.search.IndexSearcher(reader)
    var live = L.index.MultiBits.getLiveDocs(reader)
    for (var i = 0; i < reader.maxDoc(); i++) {
      if (isDef(live) && live != null && !live.get(i)) continue
      var doc = this._luceneStoredDoc(searcher, i)
      var id = isDef(doc) && doc != null ? String(doc.get("id") || "") : ""
      if (id.length > 0 && id.endsWith(".md") && id.indexOf(pfx) === 0 && seen[id] !== true) { seen[id] = true; out.push(id) }
    }
  } catch(e) {
    this._logFn("warn", "Read-only Lucene listing failed: " + __miniAErrMsg(e))
    return []
  } finally {
    try { if (isDef(reader) && reader != null) reader.close() } catch(ignoreR) {}
    try { if (isDef(dir) && dir != null) dir.close() } catch(ignoreD) {}
  }
  return out.sort()
}

// _luceneStoredDoc: stored-fields accessor across Lucene versions (storedFields() vs doc()).
MiniAWikiManager.prototype._luceneStoredDoc = function(searcher, docId) {
  try {
    if (isDef(searcher.storedFields) && typeof searcher.storedFields === "function") {
      var sf = searcher.storedFields()
      if (isDef(sf) && sf != null && typeof sf.document === "function") return sf.document(docId)
    }
  } catch(e) {}
  try { if (typeof searcher.doc === "function") return searcher.doc(docId) } catch(e2) {}
  return __
}

MiniAWikiManager.prototype._openLucene = function(forceEphemeral) {
  if (!this._ensureLucene()) return __
  // $ch(...).create("searchdb") always opens an IndexWriter (CREATE_OR_APPEND), which would
  // take the write lock and create the index directory. Read-only wikis must never get here;
  // they query through _luceneQueryReadOnly instead.
  if (this._access !== "rw") return __
  this._ensureIndexRuntime()
  var chName = this._luceneChName()
  if (forceEphemeral !== true && this._luceneChannel === chName) return chName
  try {
    $ch(chName).create("searchdb", this._luceneOptions())
    if (forceEphemeral !== true) this._luceneChannel = chName
    return chName
  } catch(e) {
    var msg = __miniAErrMsg(e)
    if (msg.toLowerCase().indexOf("lock") >= 0 || msg.indexOf("LockObtainFailedException") >= 0) {
      if (this._luceneFallbackWarned !== true) {
        this._logFn("warn", "Lucene writer lock held by another process; falling back to per-operation open/close.")
        this._luceneFallbackWarned = true
      }
      return "__ephemeral__"
    }
    throw e
  }
}

MiniAWikiManager.prototype._closeLucene = function(chName) {
  var name = isString(chName) && chName.length > 0 ? chName : this._luceneChannel
  if (!isString(name) || name.length === 0 || name === "__ephemeral__") return
  try { $ch(name).destroy() } catch(ignoreDestroy) {}
  if (name === this._luceneChannel) this._luceneChannel = ""
}

MiniAWikiManager.prototype._isLuceneIndexCompatibilityError = function(e) {
  var msg = __miniAErrMsg(e).toLowerCase()
  return msg.indexOf("indexformattoooldexception") >= 0 ||
    msg.indexOf("format version is not supported") >= 0 ||
    msg.indexOf("could not load codec") >= 0 ||
    msg.indexOf("lucene-backward-codecs.jar") >= 0
}

MiniAWikiManager.prototype._handleLuceneIncrementalFailure = function(op, e) {
  this._luceneNeedsRebuild = true
  var msg = __miniAErrMsg(e)
  if (this._isLuceneIndexCompatibilityError(e)) {
    this._logFn("warn", "Failed incremental Lucene " + op + " due to incompatible index; rebuilding Lucene index: " + msg)
    this._rebuildSearchIndex({ resetLucene: true })
  } else {
    this._logFn("warn", "Failed incremental Lucene " + op + ": " + msg)
  }
}

MiniAWikiManager.prototype._luceneSet = function(path, raw, title) {
  if (this._access !== "rw") return
  if (!this._ensureLucene()) return
  this._ensureIndexRuntime()
  try {
    var chName = this._openLucene(false)
    if (chName === "__ephemeral__") chName = this._openLucene(true)
    $ch(chName).set({ id: path }, { content: raw, payload: { path: path, title: title } })
    if (chName !== this._luceneChannel) this._closeLucene(chName)
    this._stats.luceneSets++
  } catch(e) {
    this._handleLuceneIncrementalFailure("update", e)
  }
}

MiniAWikiManager.prototype._luceneUnset = function(path) {
  if (this._access !== "rw") return
  if (!this._ensureLucene()) return
  this._ensureIndexRuntime()
  try {
    var chName = this._openLucene(false)
    if (chName === "__ephemeral__") chName = this._openLucene(true)
    $ch(chName).unset({ id: path })
    if (chName !== this._luceneChannel) this._closeLucene(chName)
    this._stats.luceneUnsets++
  } catch(e) {
    this._handleLuceneIncrementalFailure("delete", e)
  }
}

MiniAWikiManager.prototype._graphPayloadFromRecord = function(path, raw, parsed) {
  var built = this._buildPageRecord(path, raw, parsed)
  return {
    path: path,
    meta: built.meta,
    body: built.body,
    links: built.links
  }
}

MiniAWikiManager.prototype._readArchiveGraph = function() {
  if (this._archiveRoot !== true || !isObject(this._backend) || !isString(this._backend.root)) return __
  try {
    var raw = io.readFileString(this._backend.root + "::.mini-a-wiki-graph/graph.json")
    return isDef(raw) ? String(raw) : __
  } catch(e) { return __ }
}

MiniAWikiManager.prototype._mountGraph = function(mount) {
  if (!isMap(mount) || !isObject(mount.manager)) return __
  var ttl = isNumber(this._config.wikimountgraphttlms) ? this._config.wikimountgraphttlms : 60000
  var nowMs = now()
  if (isObject(mount.graph) && isNumber(mount.graphCheckedAt) && ttl > 0 && (nowMs - mount.graphCheckedAt) < ttl) return mount.graph
  mount.graphCheckedAt = nowMs
  try {
    loadLib("mini-a-graph.js")
    var graphDir = mount.manager._getGraphPath()
    var graphRaw = mount.manager._readArchiveGraph()
    if (!isString(graphRaw) && !io.fileExists(graphDir + "/graph.json")) {
      mount.graph = __
      return __
    }
    mount.graph = new MiniAWikiGraph({ graphDir: graphDir, graphRaw: graphRaw, readOnly: true }, this._logFn)
    return mount.graph
  } catch(e) {
    this._logFn("warn", "Failed to load mount graph for @" + mount.name + ": " + __miniAErrMsg(e))
    mount.graph = __
    return __
  }
}

// _readAllPageDocs: single read pass shared by reindex()'s search + graph rebuild
// so every page is fetched from the backend once instead of once per index — this
// alone halves the backend I/O regardless of concurrency. Reads are serial: an
// earlier pForEach-based version deadlocked the shared OpenAF thread pool under
// this file's own test suite (MiniAWikiManager's constructor calls
// listFilesRecursive, which blocks forever waiting on a pool worker occupied by a
// stuck nested read) — see reindex() call sites before reintroducing parallel reads.
MiniAWikiManager.prototype._readAllPageDocs = function() {
  var self = this
  var pages = this._safeListPages("").filter(function(p) { return !self._isSearchExcludedPath(p) })
  var readOne = function(p) {
    var raw = self._backend.read(p)
    if (!isString(raw)) return __
    var parsed = self.parseFrontmatter(raw)
    var body = isString(parsed.body) ? parsed.body : ""
    return {
      path  : p,
      raw   : raw,
      parsed: parsed,
      title : isString(parsed.meta.title) ? parsed.meta.title : p,
      body  : body,
      meta  : isMap(parsed.meta) ? parsed.meta : {},
      links : self.extractLinks(body)
    }
  }
  var results = pages.map(readOne)
  var docs = []
  var touchedShards = {}
  ;(isArray(results) ? results : []).forEach(function(r) {
    if (!isMap(r)) return
    docs.push(r)
    self._metaUpdate(r.path, r.raw, r.parsed, true)
    touchedShards[self._metaShardKey(r.path)] = true
  })
  // Each shard file holds many pages' metadata; flush once per shard instead of
  // once per page (_metaUpdate above deferred the save for exactly this reason).
  Object.keys(touchedShards).forEach(function(shardKey) { self._saveMetaShard(shardKey) })
  return docs
}

// _rebuildSearchIndex: pass a pre-read `pageDocs` (from _readAllPageDocs) to skip
// this function's own read pass entirely — used by reindex() to share one backend
// fetch with _rebuildGraphIndex. Falls back to reading pages itself when omitted,
// preserving the original single-caller behaviour (e.g. bootstrap/init).
MiniAWikiManager.prototype._rebuildSearchIndex = function(options, pageDocs) {
  if (this._access !== 'rw') return { ok: false, error: "wiki is read-only" }
  try {
    var opts = isObject(options) ? options : {}
    var self = this
    var docs
    if (isArray(pageDocs)) {
      docs = pageDocs.map(function(r) { return { path: r.path, title: r.title, raw: r.raw, body: r.body } })
    } else {
      var pages = this._safeListPages("").filter(function(p) { return !self._isSearchExcludedPath(p) })
      docs = []
      for (var i=0;i<pages.length;i++) {
        var raw = this._backend.read(pages[i])
        if (!isString(raw)) continue
        var parsed = this.parseFrontmatter(raw)
        docs.push({ path: pages[i], title: isString(parsed.meta.title) ? parsed.meta.title : pages[i], raw: raw, body: isString(parsed.body) ? parsed.body : "" })
        this._metaUpdate(pages[i], raw, parsed)
      }
    }
    return this._ensureSearchIndex().rebuild(docs, opts)
  } catch(e) {
    this._logFn('warn', 'Failed to rebuild wiki index: ' + __miniAErrMsg(e))
    return { ok: false, error: __miniAErrMsg(e) }
  }
}

MiniAWikiManager.prototype._getGraphPath = function() {
  return this._ensureIndexRoot() + "/.mini-a-wiki-graph"
}

// _hydrateS3Artifacts downloads a separately stored, immutable search cache.
// Wiki pages remain under wikiprefix; Lucene and graph files use this explicit
// prefix so ordinary page listing/search never exposes implementation artifacts.
MiniAWikiManager.prototype._hydrateS3Artifacts = function() {
  if (this._backendType !== "s3" || !isString(this._config.s3artifactprefix) || this._config.s3artifactprefix.trim().length === 0) return
  var artifactPrefix = this._config.s3artifactprefix.trim()
  if (!artifactPrefix.endsWith("/")) artifactPrefix += "/"
  var bucket = isString(this._config.bucket) ? this._config.bucket.trim() : ""
  if (bucket.length === 0) return
  if (toBoolean(this._config.s3artifactbundle) === true) {
    var bundleKey = artifactPrefix + "mini-a-wiki-index.zip"
    var s3 = this._backend.client
    return this._hydrateArtifactBundle(function() {
      var stat = s3.statObject(bucket, bundleKey)
      return { etag: isDef(stat.etag) ? String(stat.etag) : "", lastModified: isDef(stat.modifiedTime) ? String(stat.modifiedTime) : "" }
    }, function() { return s3.getObjectStream(bucket, bundleKey) }, "s3", bundleKey)
  }
  var root = this._getIndexRoot()
  try {
    var rootFile = new java.io.File(root)
    if (!rootFile.exists() && !rootFile.mkdirs()) throw "could not create local artifact cache"
    var s3 = this._backend.client
    var objects = s3.listObjects(bucket, artifactPrefix, false, true)
    if (!isArray(objects)) return
    var restored = 0
    objects.forEach(function(obj) {
      var key = isString(obj.filename) ? obj.filename : (isString(obj.canonicalPath) ? obj.canonicalPath : "")
      if (!key.startsWith(artifactPrefix) || key.endsWith("/")) return
      var relative = key.substring(artifactPrefix.length)
      if (relative.length === 0 || relative.indexOf("..") >= 0 || relative.startsWith("/")) return
      var target = new java.io.File(rootFile, relative)
      var canonicalRoot = rootFile.getCanonicalPath() + java.io.File.separator
      if (!target.getCanonicalPath().startsWith(canonicalRoot)) return
      var parent = target.getParentFile()
      if (!parent.exists() && !parent.mkdirs()) throw "could not create artifact cache directory"
      var stream = s3.getObjectStream(bucket, key)
      try {
        java.nio.file.Files.copy(stream, target.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING)
        restored++
      } finally {
        try { stream.close() } catch(ignoreClose) {}
      }
    })
    if (restored > 0) this._logFn("info", "Hydrated " + restored + " wiki search/graph artifacts from S3")
    return false
  } catch(e) {
    this._logFn("warn", "Failed to hydrate wiki search/graph artifacts from S3: " + __miniAErrMsg(e))
    return false
  }
}

// Hydrate a complete Lucene+graph cache without ever merging old segment files
// into a new index. remoteMetaFn must only perform a cheap metadata request.
MiniAWikiManager.prototype._hydrateArtifactBundle = function(remoteMetaFn, downloadFn, source, key) {
  var self = this
  var root = this._getIndexRoot()
  var rootFile = new java.io.File(root)
  var metaFile = new java.io.File(root + "/.mini-a-wiki-bundle-meta.json")
  var zipFile = new java.io.File(root + "/.mini-a-wiki-bundle-" + genUUID() + ".zip")
  var suffix = ".new-" + genUUID()
  var luceneNew = new java.io.File(root + "/.mini-a-wiki-lucene" + suffix)
  var graphNew = new java.io.File(root + "/.mini-a-wiki-graph" + suffix)
  var installed = false
  var remove = function(file) {
    if (!file.exists()) return
    if (file.isDirectory()) { var children = file.listFiles(); for (var i = 0; isDef(children) && i < children.length; i++) remove(children[i]) }
    file.delete()
  }
  try {
    if (!rootFile.exists() && !rootFile.mkdirs()) throw "could not create local artifact cache"
    var remote = remoteMetaFn()
    var local = __
    try { if (metaFile.isFile()) local = af.fromJson(io.readFileString(metaFile.getPath())) } catch(ignoreMeta) {}
    if (!__miniAWikiBundleChanged(remote, local) && local.source === source && local.key === key) return false
    var stream = downloadFn()
    try { java.nio.file.Files.copy(stream, zipFile.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING) } finally { try { stream.close() } catch(ignoreClose) {} }
    plugin("ZIP")
    var zip = new ZIP()
    try {
      var zipPath = String(zipFile.getPath())
      var entries = Object.keys(zip.list(zipPath))
      entries.forEach(function(entry) {
        var relative = __miniAWikiBundleEntryRelative(entry)
        if (isUnDef(relative) || relative.endsWith("/")) return
        var targetRoot = relative.indexOf(".mini-a-wiki-lucene/") === 0 ? luceneNew : graphNew
        var child = relative.substring(relative.indexOf("/") + 1)
        var target = new java.io.File(targetRoot.getPath() + java.io.File.separator + child)
        var canonicalRoot = targetRoot.getCanonicalPath() + java.io.File.separator
        if (child.indexOf("..") >= 0 || !target.getCanonicalPath().startsWith(canonicalRoot)) throw "unsafe artifact bundle entry"
        var parent = target.getParentFile()
        if (!parent.exists() && !parent.mkdirs()) throw "could not create artifact cache directory"
        var entryStream = zip.streamGetFileStream(zipPath, entry)
        try { java.nio.file.Files.copy(entryStream, target.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING) } finally { try { entryStream.close() } catch(ignoreEntryClose) {} }
      })
    } finally { try { zip.close() } catch(ignoreZipClose) {} }
    var lucene = new java.io.File(root + "/.mini-a-wiki-lucene")
    var graph = new java.io.File(root + "/.mini-a-wiki-graph")
    remove(lucene); remove(graph)
    if (!luceneNew.exists()) throw "bundle has no Lucene artifacts"
    if (luceneNew.exists()) java.nio.file.Files.move(luceneNew.toPath(), lucene.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING)
    if (graphNew.exists()) java.nio.file.Files.move(graphNew.toPath(), graph.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING)
    installed = true
    if (!lucene.exists()) throw "could not install Lucene artifact bundle"
    remote.source = source; remote.key = key; remote.fetchedAt = new Date().toISOString()
    io.writeFileString(metaFile.getPath(), stringify(remote, __, ""))
    this._logFn("info", "Hydrated wiki search/graph artifact bundle from " + source)
    return true
  } catch(e) {
    this._logFn("warn", "Failed to hydrate wiki search/graph artifact bundle: " + __miniAErrMsg(e))
    return false
  } finally { try { zipFile.delete(); if (!installed) { remove(luceneNew); remove(graphNew) } } catch(ignoreClean) {} }
}

// _graphPages: pass a pre-read `pageDocs` (from _readAllPageDocs) to build the
// graph shape from it directly instead of re-reading every page from the backend.
// Falls back to its own read pass when omitted, preserving behaviour for the
// standalone `graph build`/`graph answer` callers.
MiniAWikiManager.prototype._graphPages = function(pageDocs) {
  if (isArray(pageDocs)) {
    return pageDocs.map(function(r) {
      return { path: r.path, meta: r.meta, body: r.body, links: r.links }
    })
  }
  var self = this
  var pages = this._safeListPages("").filter(function(p) { return !self._isSearchExcludedPath(p) })
  var out = []
  for (var i = 0; i < pages.length; i++) {
    var raw = this._backend.read(pages[i])
    if (!isString(raw)) continue
    var parsed = this.parseFrontmatter(raw)
    out.push({
      path: pages[i],
      meta: isMap(parsed.meta) ? parsed.meta : {},
      body: isString(parsed.body) ? parsed.body : "",
      links: this.extractLinks(isString(parsed.body) ? parsed.body : "")
    })
  }
  return out
}

MiniAWikiManager.prototype._rebuildGraphIndex = function(pageDocs) {
  if (!isObject(this._graph)) return
  try {
    this._graph.buildStructural(this._graphPages(pageDocs))
  } catch(e) {
    this._logFn("warn", "Failed to rebuild graph index: " + __miniAErrMsg(e))
  }
}

MiniAWikiManager.prototype._getLuceneIndexPath = function() {
  return this._ensureIndexRoot() + "/.mini-a-wiki-lucene"
}

MiniAWikiManager.prototype._getLexicalManifestPath = function() {
  return this._getLuceneIndexPath() + "/mini-a-lexical.json"
}

MiniAWikiManager.prototype._lexicalManifest = function() {
  try {
    var path = this._getLexicalManifestPath()
    if (!io.fileExists(path)) return __
    var manifest = af.fromJson(io.readFileString(path))
    return isMap(manifest) ? manifest : __
  } catch(e) { return __ }
}

MiniAWikiManager.prototype._lexicalManifestStatus = function() {
  var manifest = this._lexicalManifest()
  if (!isMap(manifest)) return { compatible: false, reason: "missing" }
  if (manifest.schemaVersion !== __MINI_A_WIKI_LEXICAL_SCHEMA_VERSION) return { compatible: false, reason: "schema" }
  if (manifest.fingerprint !== this._lexicalFingerprint) return { compatible: false, reason: "configuration" }
  return { compatible: true, manifest: manifest }
}

MiniAWikiManager.prototype._writeLexicalManifest = function() {
  if (this._access !== "rw") return false
  var indexPath = this._getLuceneIndexPath()
  if (!io.fileExists(indexPath)) io.mkdir(indexPath)
  var manifest = {
    schemaVersion: __MINI_A_WIKI_LEXICAL_SCHEMA_VERSION,
    lexical: this._lexicalConfig,
    fingerprint: this._lexicalFingerprint
  }
  io.writeFileString(this._getLexicalManifestPath(), stringify(manifest, __, ""))
  return true
}

MiniAWikiManager.prototype._hasEnhancedLexicalSupport = function() {
  try {
    if (isUnDef(ow.ch.__types.searchdb) || !isFunction(ow.ch.__types.searchdb.search)) return false
    // searchdb.search existed before enhanced lexical retrieval. Check the
    // adapter implementation rather than mistaking that plain API for support.
    return String(ow.ch.__types.searchdb.search).toLowerCase().indexOf("lexicalenhanced") >= 0
  } catch(e) { return false }
}

MiniAWikiManager.prototype._luceneOptions = function() {
  return {
    path: this._getLuceneIndexPath(),
    idField: "id",
    contentField: "content",
    analyzer: this._lexicalConfig.language,
    lexical: this._luceneLexicalOptions()
  }
}

MiniAWikiManager.prototype._luceneLexicalOptions = function() {
  return {
    language: this._lexicalConfig.language,
    synonyms: {
      enabled: this._lexicalConfig.synonyms.length > 0,
      rules: this._lexicalConfig.synonyms.map(function(rule) { return rule.join(",") })
    },
    shingles: { enabled: this._lexicalConfig.shingles === true },
    characterNGrams: { enabled: this._lexicalConfig.ngrams === true },
    queryExpansion: { enabled: this._lexicalConfig.queryExpansion === true },
    pseudoRelevanceFeedback: { enabled: this._lexicalConfig.pseudoRelevanceFeedback === true }
  }
}

MiniAWikiManager.prototype._ensureLucene = function() {
  if (this._luceneReady === true) return true
  try {
    includeOPack("lucene")
    loadLib("lucene.js")
    this._luceneReady = true
    return true
  } catch(e) {
    this._luceneReady = false
    this._logFn("warn", "Lucene oPack not available: " + __miniAErrMsg(e))
    return false
  }
}

MiniAWikiManager.prototype._rebuildLuceneIndex = function(docs, options) {
  if (this._access !== "rw") return { ok: false, error: "wiki is read-only" }
  if (!this._ensureLucene()) return { ok: false, error: "Lucene oPack is not available" }
  try {
    var opts = isObject(options) ? options : {}
    this._ensureIndexRuntime()
    var idxPath = this._getLuceneIndexPath()
    var chName = this._luceneChName()
    this._closeLucene(chName)
    if (opts.resetLucene === true) {
      try { if (io.fileExists(idxPath)) io.rm(idxPath) } catch(ignoreRm) {}
    }
    try {
      $ch(chName).create("searchdb", this._luceneOptions())
      ;(isArray(docs) ? docs : []).forEach(function(d) {
        $ch(chName).set({ id: d.path }, { content: d.raw, payload: { path: d.path, title: d.title } })
      })
      try {
        var known = {}
        ;(isArray(docs) ? docs : []).forEach(function(d) { known[d.path] = true })
        var keys = $ch(chName).getKeys()
        if (isArray(keys)) {
          keys.forEach(function(k) {
            var id = isMap(k) && isString(k.id) ? k.id : (isString(k) ? k : __)
            if (isString(id) && !known[id]) $ch(chName).unset({ id: id })
          })
        }
      } catch(ignoreKeys) {}
    } finally {
      this._closeLucene(chName)
    }
    this._stats.luceneFullRebuilds++
    this._luceneNeedsRebuild = false
    return { ok: true }
  } catch(e) {
    this._logFn("warn", "Failed to rebuild Lucene index: " + __miniAErrMsg(e))
    return { ok: false, error: __miniAErrMsg(e) }
  }
}

// ---------------------------------------------------------------------------
// Search index seam
//
// Full-text search is pluggable behind a duck-typed object mirroring the storage
// backend idiom: { type, writable, available, exists, query, set, unset, rebuild, close }.
// query() returns hits in the searchdb channel shape: { id, content, payload, score }.
// ---------------------------------------------------------------------------

MiniAWikiManager.prototype._makeLuceneSearchIndex = function() {
  var self = this
  return {
    type     : "lucene",
    writable : self._access === "rw",
    available: function() { return self._ensureLucene() },
    exists   : function() { return self._luceneIndexExists() },
    query    : function(q, limit) {
      var manifestStatus = self._lexicalManifestStatus()
      if (self._access !== "rw") {
        if (!manifestStatus.compatible) {
          if (self._luceneIndexExists() && self._lexicalReadOnlyWarned !== true) {
            self._logFn("warn", "Wiki Lucene index uses a legacy or mismatched lexical schema; using ordinary Lucene search. The publisher must run writable reindex and republish the artifacts.")
            self._lexicalReadOnlyWarned = true
          }
          return self._luceneQueryReadOnly(q, limit)
        }
        // The enhanced searchdb API is channel-backed and opening it takes an
        // IndexWriter lock. Keep read-only/hydrated managers mutation-free.
        return self._luceneQueryReadOnly(q, limit)
      }
      var chName = self._openLucene(false)
      if (chName === "__ephemeral__") chName = self._openLucene(true)
      if (!isString(chName) || chName.length === 0) return []
      var hits = manifestStatus.compatible && self._hasEnhancedLexicalSupport()
        ? ow.ch.__types.searchdb.search(chName, { mode: "lexicalEnhanced", query: q, lexical: self._luceneLexicalOptions(), limit: limit })
        : $ch(chName).getAll({ query: q, limit: limit })
      if (chName !== self._luceneChannel) self._closeLucene(chName)
      return isArray(hits) ? hits : []
    },
    set      : function(path, raw, title) { self._luceneSet(path, raw, title) },
    unset    : function(path) { self._luceneUnset(path) },
    rebuild  : function(docs, opts) { return self._rebuildLuceneIndex(docs, opts) },
    close    : function() { self._closeLucene() }
  }
}

MiniAWikiManager.prototype._makeNullSearchIndex = function() {
  return {
    type     : "none",
    writable : false,
    available: function() { return false },
    exists   : function() { return false },
    query    : function() { return [] },
    set      : function() {},
    unset    : function() {},
    rebuild  : function() {},
    close    : function() {}
  }
}

MiniAWikiManager.prototype._ensureSearchIndex = function() {
  if (isObject(this._searchIndex)) return this._searchIndex
  var kind = isString(this._config.wikisearch) ? String(this._config.wikisearch).toLowerCase().trim() : "auto"
  if (kind === "none") {
    this._searchIndex = this._makeNullSearchIndex()
    return this._searchIndex
  }
  if (kind === "opensearch") {
    // the seam exists but no OpenSearch implementation ships yet - say so rather than
    // silently behaving like local Lucene
    this._logFn("warn", "wikisearch=opensearch is not implemented yet; using the local Lucene index instead.")
  }
  this._searchIndex = this._makeLuceneSearchIndex()
  return this._searchIndex
}

// _searchIndexStatus: human-readable state of the full-text index, for context()/reporting.
MiniAWikiManager.prototype._searchIndexStatus = function() {
  var idx = this._ensureSearchIndex()
  if (idx.type === "none") return "none"
  if (!idx.available()) return "scan"
  if (!idx.exists()) return this._access === "rw" ? "empty" : "scan"
  return idx.type + (idx.writable ? "" : "-readonly")
}

MiniAWikiManager.prototype._graphUpdatePage = function(path, raw, parsed) {
  if (!isObject(this._graph) || !isFunction(this._graph.updatePage)) return
  try {
    this._graph.updatePage(this._graphPayloadFromRecord(path, raw, parsed))
  } catch(e) {
    this._logFn("warn", "Failed to update graph page index: " + __miniAErrMsg(e))
  }
}

MiniAWikiManager.prototype._graphRemovePage = function(path) {
  if (!isObject(this._graph) || !isFunction(this._graph.removePage)) return
  try {
    this._graph.removePage(path)
  } catch(e) {
    this._logFn("warn", "Failed to remove graph page index: " + __miniAErrMsg(e))
  }
}

MiniAWikiManager.prototype._updatePageIndexes = function(path, raw, parsed) {
  var meta = this._metaUpdate(path, raw, parsed)
  this._ensureSearchIndex().set(path, raw, isMap(meta) && isString(meta.title) ? meta.title : path)
  this._graphUpdatePage(path, raw, parsed)
}

MiniAWikiManager.prototype._removePageIndexes = function(path) {
  this._metaRemove(path)
  this._ensureSearchIndex().unset(path)
  this._graphRemovePage(path)
}

MiniAWikiManager.prototype.reindex = function() {
  if (this._access !== "rw") return { ok: false, error: "wiki is read-only" }
  try {
    if (!this._ensureLucene() || !this._hasEnhancedLexicalSupport()) return { ok: false, error: "Lucene oPack does not support lexicalEnhanced search; upgrade the lucene oPack before publishing an enhanced wiki index." }
    var manifestStatus = this._lexicalManifestStatus()
    var pageDocs = this._readAllPageDocs()
    var rebuilt = this._rebuildSearchIndex({ resetLucene: !manifestStatus.compatible }, pageDocs)
    if (!isMap(rebuilt) || rebuilt.ok !== true) return isMap(rebuilt) ? rebuilt : { ok: false, error: "failed to rebuild lexical index" }
    this._writeLexicalManifest()
    this._rebuildGraphIndex(pageDocs)
    return { ok: true }
  } catch(e) {
    return { ok: false, error: __miniAErrMsg(e) }
  }
}

MiniAWikiManager.prototype._withGraphHints = function(hits, options) {
  if (!isArray(hits)) return hits
  var opts = isObject(options) ? options : {}
  // F12: undefined means enabled; only explicit false disables hints
  if (this._config.wikigraphsearchhints === false && opts.wikigraphsearchhints !== true) return hits
  var cap = isNumber(opts.wikigraphhintcap) ? opts.wikigraphhintcap : (isNumber(this._config.wikigraphhintcap) ? this._config.wikigraphhintcap : 5)
  var lim = isNumber(opts.limit) && opts.limit > 0 ? opts.limit : __
  if (isNumber(lim) && hits.length >= lim) return hits
  var combined = hits.slice()
  var primaryPaths = hits.map(function(h) { return h.path }).filter(function(p) { return isString(p) && !p.startsWith("@") })
  if (isObject(this._graph) && primaryPaths.length > 0) {
    var related = this._graph.relatedFor(primaryPaths, { cap: cap })
    if (isArray(related) && related.length > 0) {
      combined = combined.concat(related.map(function(r) {
        return {
          path: r.path,
          title: r.path.replace(/\.md$/i, "").replace(/[-_/]/g, " "),
          description: "[Related pages (graph)] " + r.connection + " score=" + r.score + " provenance=" + r.provenance + " - " + r.digest
        }
      }))
    }
  }
  if (this._config.wikigraphmounts !== false) {
    var byMount = {}
    hits.forEach(function(h) {
      if (!isString(h.path) || !h.path.startsWith("@")) return
      var m = h.path.match(/^@([^/]+)\/(.+)$/)
      if (!m) return
      byMount[m[1]] = byMount[m[1]] || []
      byMount[m[1]].push(m[2])
    })
    var mounts = isArray(this._mounts) ? this._mounts : []
    mounts.forEach(function(mount) {
      var localPaths = byMount[mount.name]
      if (!isArray(localPaths) || localPaths.length === 0) return
      var graph = this._mountGraph(mount)
      if (!isObject(graph) || !isFunction(graph.relatedFor)) return
      var related = graph.relatedFor(localPaths, { cap: cap })
      if (!isArray(related)) return
      related.forEach(function(r) {
        combined.push({
          path: "@" + mount.name + "/" + r.path,
          title: r.path.replace(/\.md$/i, "").replace(/[-_/]/g, " "),
          description: "[Related pages (graph @" + mount.name + ")] " + r.connection + " score=" + r.score + " provenance=" + r.provenance + " - " + r.digest
        })
      })
    }.bind(this))
  }
  return isNumber(lim) ? combined.slice(0, lim) : combined
}

MiniAWikiManager.prototype.graph = function(op, params) {
  this._maybeRefreshArtifactBundle()
  var action = isString(op) ? op.toLowerCase().trim() : (isObject(params) && isString(params.op) ? params.op.toLowerCase().trim() : "stats")
  var p = isObject(params) ? params : {}
  var mountGraphRequest = (action === "neighbors" || action === "retrieve") && isString(p.path) && p.path.startsWith("@")
  if (!isObject(this._graph) && !mountGraphRequest) return { ok: false, error: "graph is not enabled (usegraph=true)" }
  // read-only wikis can query an existing graph (local graph.json or external FalkorDB)
  // but never build or persist one
  if (this._access !== "rw") {
    var mutating = ["build", "report"].indexOf(action) >= 0 || (action === "falkor" && !isString(p.query))
    if (mutating) return { ok: false, error: "wiki is read-only: graph '" + action + "' requires wikiaccess=rw" }
  }
  if (action === "build") {
    var st = this._graph.buildStructural(this._graphPages(), p)
    if (p.report === true && p.preview !== true && isFunction(this._graph.saveReport)) this._graph.saveReport()
    // F5: wikigraphsemantic=true makes graph build default semantic:true (still emits corpus warning)
    if (p.semantic === true || toBoolean(this._config.wikigraphsemantic) === true) return this._graph.buildSemantic(this._graphPages(), p)
    return { ok: true, structural: st }
  }
  if (action === "report") return isFunction(this._graph.saveReport) ? this._graph.saveReport() : { ok: false, error: "report not supported" }
  if ((action === "neighbors" || action === "retrieve") && isString(p.path) && p.path.startsWith("@")) {
    var mres = this._resolveMountPath(p.path)
    if (!mres || !mres.mount) return { ok: false, error: "mount not found" }
    var mountGraph = this._mountGraph(mres.mount)
    if (!isObject(mountGraph)) return { ok: false, error: "mount graph not available" }
    if (action === "neighbors") {
      var nres = mountGraph.neighbors("doc:" + mres.localPath)
      return nres.map(function(e) {
        var out = merge({}, e)
        if (String(out.from).startsWith("doc:")) out.from = "doc:@" + mres.name + "/" + String(out.from).substring(4)
        if (String(out.to).startsWith("doc:")) out.to = "doc:@" + mres.name + "/" + String(out.to).substring(4)
        return out
      })
    }
    var rres = mountGraph.retrieve(p.concepts || p.query || mres.localPath, p)
    if (isArray(rres.pages)) {
      rres.pages = rres.pages.map(function(pg) { return merge({}, pg, { path: "@" + mres.name + "/" + pg.path }) })
    }
    return rres
  }
  if (action === "query") return this._graph.query(isString(p.text) ? p.text : (isString(p.query) ? p.query : ""))
  if (action === "neighbors") return this._graph.neighbors(isString(p.node) ? p.node : (isString(p.path) ? ("doc:" + p.path) : ""))
  if (action === "path") return this._graph.path(p.from || p.a || "", p.to || p.b || "")
  if (action === "communities") return this._graph.detectCommunities()
  if (action === "surprise") return this._graph.crossDocumentSurprise()
  if (action === "stats") return this._graph.stats()
  if (action === "export") return this._graph.export(isString(p.format) ? p.format : "mermaid")
  if (action === "falkor") return isString(p.query) ? this._graph.falkorQuery(p.query) : this._graph.falkorSync()
  if (action === "retrieve") return this._graph.retrieve(p.concepts || p.query || "", p)
  if (action === "answer") return this._graph.answer(p.question || p.query || "", p)
  return { ok: false, error: "unknown graph op: " + action }
}

MiniAWikiManager.prototype.list = function(prefix, options) {
  var pfx  = isString(prefix) ? prefix : ""
  var opts = isObject(options) ? options : {}
  // Mount routing: @name/... → list that mount
  if (pfx.startsWith("@")) {
    var mres = this._resolveMountPath(pfx.endsWith("/") ? pfx + "_dummy.md" : pfx)
    if (mres && mres.mount) return mres.mount.manager.list(mres.localPath.replace(/_dummy\.md$/, ""), options)
    return []
  }
  var pages
  try { pages = this._safeListPages(pfx) } catch(e) { pages = [] }
  var offset = isNumber(opts.offset) && opts.offset > 0 ? Math.floor(opts.offset) : 0
  var limit = isNumber(opts.limit) && opts.limit > 0 ? Math.floor(opts.limit) : __
  var slicedPages = isNumber(limit) ? pages.slice(offset, offset + limit) : (offset > 0 ? pages.slice(offset) : pages)
  if (opts.withMeta !== true) return slicedPages
  var self = this
  return slicedPages.map(function(p) {
    var m = self._metaFor(p)
    return {
      path       : p,
      title      : isMap(m) && isString(m.title)       ? m.title       : p.replace(/\.md$/i, "").replace(/[-_/]/g, " "),
      description: isMap(m) && isString(m.description) ? m.description : "",
      type       : isMap(m) && isString(m.type)        ? m.type        : "",
      updated    : isMap(m) && isDef(m.updated)        ? __miniAWikiIsoDay(m.updated) : ""
    }
  })
}

// _resolveMountPath: parse @name/localpath → { mount, localPath } or null
MiniAWikiManager.prototype._resolveMountPath = function(path) {
  if (!isString(path) || !path.startsWith("@")) return null
  var withoutAt = path.substring(1)
  var slashIdx  = withoutAt.indexOf("/")
  var name      = slashIdx >= 0 ? withoutAt.substring(0, slashIdx) : withoutAt
  var localPath = slashIdx >= 0 ? withoutAt.substring(slashIdx + 1) : ""
  var mounts    = isArray(this._mounts) ? this._mounts : []
  for (var i = 0; i < mounts.length; i++) {
    if (mounts[i].name === name) return { mount: mounts[i], localPath: localPath, name: name }
  }
  return { mount: null, localPath: localPath, name: name }
}

MiniAWikiManager.prototype.configure = function(config) {
  var cfg = isMap(config) ? config : {}
  // The explicit runtime value wins. The environment form is intentionally
  // read here too so direct manager/MCP construction has the same behaviour as
  // the Mini-A launcher.
  if (isUnDef(cfg.wikilexical) && isString(getEnv("OAF_MINI_A_WIKI_LEXICAL"))) cfg.wikilexical = getEnv("OAF_MINI_A_WIKI_LEXICAL")
  this._lexicalConfig = __miniAWikiLexicalConfig(cfg.wikilexical, cfg.root)
  this._lexicalFingerprint = __miniAWikiLexicalFingerprint(this._lexicalConfig)
  var accessRaw  = isDef(cfg.access) ? String(cfg.access).toLowerCase().trim() : "ro"
  var backendRaw = isDef(cfg.backend) ? String(cfg.backend).toLowerCase().trim() : "fs"
  this._access      = accessRaw === "rw" ? "rw" : "ro"
  if (backendRaw === "https") backendRaw = "http"
  this._backendType = ["s3", "es", "s3fs", "http"].indexOf(backendRaw) >= 0 ? backendRaw : "fs"
  // A local ZIP-compatible filesystem root is a wiki bundle, not a writable
  // directory. Detect it before any bootstrap/index/graph work can write.
  this._archiveRoot = this._backendType === "fs" && this._isArchiveRoot(cfg.root)
  if (this._archiveRoot) this._access = "ro"
  if (this._backendType === "http") this._access = "ro"
  this._config  = cfg
  this._graph = __
  this._searchIndex = __
  this._mounts  = isArray(this._mounts) ? this._mounts : []
  this._ensureIndexRuntime()
  this._backend = this._backendType === "s3" ? this._makeS3Backend(cfg) : (this._backendType === "es" ? this._makeEsBackend(cfg) : (this._backendType === "s3fs" ? this._makeS3FsBackend(cfg) : (this._backendType === "http" ? this._makeHttpBackend(cfg) : this._makeFsBackend(cfg))))
  // true per-instance nonce, not just the backend-identity hash: $cache(name) is a
  // process-global registry, and two managers can share the same backend identity
  // (e.g. tests constructing several managers against the same fixture root) — without
  // this, the second instance's cache setup would silently reuse the first instance's
  // loader closure/backend reference.
  this._instanceNonce = sha1(this._getBackendIdentity() + "|" + String(new Date().getTime()) + "|" + String(Math.random())).substring(0, 12)
  this._hydrateS3Artifacts()
  if (this._backendType === "http") this._hydrateHttpArtifacts()
  this._artifactLastCheckAt = new Date().getTime()
  this._initializeGraph()
  this._bootstrapWiki()
}

MiniAWikiManager.prototype._initializeGraph = function() {
  var cfg = this._config
  if (toBoolean(cfg.usegraph) === true) {
    try {
      loadLib("mini-a-graph.js")
      var graphCfg = {
        graphDir: this._getGraphPath(),
        communityAlgo: isString(cfg.wikigraphcommunity) ? cfg.wikigraphcommunity : "louvain",
        falkor: isMap(cfg.wikigraphfalkor) ? cfg.wikigraphfalkor : __,
        llmExtractFn: isFunction(cfg.llmExtractFn) ? cfg.llmExtractFn : __,
        readOnly: this._access !== "rw",
        autosave: isString(cfg.wikigraphautosave) ? cfg.wikigraphautosave : "always",
        saveDebounceMs: isNumber(cfg.wikigraphsavedebouncems) ? cfg.wikigraphsavedebouncems : 5000
      }
      graphCfg.graphRaw = this._readArchiveGraph()
      // read-only wikis consume an existing graph (local graph.json or an external FalkorDB);
      // they never create one, so skip silently when there is nothing to consume.
      if (this._access !== "rw" &&
          !isString(graphCfg.graphRaw) &&
          !io.fileExists(graphCfg.graphDir + "/graph.json") &&
          !(isMap(graphCfg.falkor) && isString(graphCfg.falkor.host))) {
        this._graph = __
      } else {
        this._graph = new MiniAWikiGraph(graphCfg, function(level, msg) { this._logFn(level, msg) }.bind(this))
      }
    } catch(graphErr) {
      this._logFn("warn", "Graph support unavailable: " + __miniAErrMsg(graphErr))
      this._graph = __
    }
  }
}

MiniAWikiManager.prototype._isArchiveRoot = function(root) {
  if (!isDef(root) || String(root).trim().length === 0) return false
  try {
    var file = new java.io.File(String(root).trim())
    return file.isFile() && /\.(zip|okt)$/i.test(String(file.getName()))
  } catch(e) { return false }
}

MiniAWikiManager.prototype._bootstrapWiki = function() {
  this._bootstrappedFiles = []
  try {
    var pages = this.list("")
    var hasAgents = this._backend.exists("AGENTS.md")
    var hasIndex  = this._backend.exists("index.md")
    if (this._access !== "rw") return

    // Bootstrap a brand-new wiki, or upgrade the legacy AGENTS-only bootstrap.
    if (pages.length > 0 && !(pages.length === 1 && hasAgents && !hasIndex)) return

    var now = new Date().toISOString()
    if (!hasAgents) { this._backend.write("AGENTS.md", __miniAWikiAgentsTemplate(now)); this._bootstrappedFiles.push("AGENTS.md") }
    if (!hasIndex)  { this._backend.write("index.md",  __miniAWikiIndexRootTemplate(now)); this._bootstrappedFiles.push("index.md") }
    if (!this._backend.exists("log.md")) { this._backend.write("log.md", __miniAWikiLogTemplate(now)); this._bootstrappedFiles.push("log.md") }
  } catch(e) {}
}

MiniAWikiManager.prototype._normalizeSectionPath = function(path) {
  if (!isString(path) || path.trim().length === 0) return ""
  var value = String(path).trim().replace(/\\/g, "/")
  if (value.toLowerCase().endsWith("/index.md")) value = value.substring(0, value.length - "index.md".length)
  if (value.toLowerCase().endsWith(".md")) value = value.substring(0, value.lastIndexOf("/") + 1)
  if (value.length === 0) return ""
  value = __miniAWikiNormalizePath(value, { allowDirectory: true })
  if (value.length > 0 && !value.endsWith("/")) value = value + "/"
  return value
}

MiniAWikiManager.prototype._pageDir = function(path) {
  if (!isString(path) || path.indexOf("/") < 0) return ""
  return path.substring(0, path.lastIndexOf("/") + 1)
}

MiniAWikiManager.prototype._pageTitle = function(path) {
  var meta = this._metaFor(path)
  if (isMap(meta) && isString(meta.title) && meta.title.trim().length > 0) return meta.title.trim()
  return path.replace(/\.md$/i, "").replace(/.*\//, "").replace(/[-_]/g, " ")
}

MiniAWikiManager.prototype._relativePath = function(fromPage, targetPage) {
  var fromDir = this._pageDir(fromPage)
  var fromParts = fromDir.length > 0 ? fromDir.replace(/\/$/, "").split("/") : []
  var targetParts = targetPage.split("/")
  while (fromParts.length > 0 && targetParts.length > 0 && fromParts[0] === targetParts[0]) {
    fromParts.shift()
    targetParts.shift()
  }
  var rel = []
  for (var i = 0; i < fromParts.length; i++) rel.push("..")
  rel = rel.concat(targetParts)
  return rel.length > 0 ? rel.join("/") : targetPage.replace(/.*\//, "")
}

// _makeIndexContent: generates a section or root index page.
// pagesInfo (optional): { pages:[{path,title,description,type,updated,relPath}], sections:[{indexPath,title,pageCount,updated}], recent:[string], attachedWikis:[{name,description,backend,pages}] }
MiniAWikiManager.prototype._makeIndexContent = function(indexPath, title, description, pagesInfo) {
  var now = new Date().toISOString()
  var isoValue = function(value, fallback) {
    if (isUnDef(value) || value === null || String(value).trim().length === 0) return fallback
    try { if (isDate(value)) return value.toISOString() } catch(eDate) {}
    return String(value)
  }
  var created = isMap(pagesInfo) ? isoValue(pagesInfo.created, now) : now
  var updated = isMap(pagesInfo) ? isoValue(pagesInfo.updated, now) : now
  var isRoot = indexPath === "index.md"
  var sectionName = isString(title) && title.trim().length > 0 ? title.trim()
    : (isRoot ? "Wiki Home" : indexPath.replace(/\/index\.md$/i, "").replace(/[-_/]/g, " "))
  var desc = isString(description) && description.trim().length > 0 ? description.trim()
    : (isRoot ? "Main entrypoint and catalog for this wiki." : "Navigation index for this wiki section.")

  var lines = [
    "---",
    "title: " + sectionName,
    "description: " + desc,
    "created: " + created,
    "updated: " + updated,
    "tags:",
    "  - index",
    "---",
    "",
    "# " + sectionName,
    "",
    desc,
    ""
  ]

  var pi = isMap(pagesInfo) ? pagesInfo : null

  if (pi) {
    var sections = isArray(pi.sections) ? pi.sections : []
    var pages    = isArray(pi.pages)    ? pi.pages    : []
    var recent   = isArray(pi.recent)   ? pi.recent   : []
    var attached = isArray(pi.attachedWikis) ? pi.attachedWikis : []

    if (isRoot && attached.length > 0) {
      lines.push("## Attached wikis", "")
      attached.forEach(function(w) {
        lines.push("- @" + w.name + " — " + (w.description || "") + " (" + (w.backend || "fs") + ") · " + (w.pages || 0) + " pages")
      })
      lines.push("")
    }

    if (isRoot) {
      lines.push("## Start here", "")
      lines.push("- [AGENTS.md](AGENTS.md) — contribution rules, schema, and workflow for agents.")
      lines.push("- [log.md](log.md) — append-only journal of recent writes and moves.")
      lines.push("")
    }

    if (sections.length > 0) {
      lines.push("## Sections", "")
      lines.push("| Section | Pages | Updated |")
      lines.push("|---|---|---|")
      sections.forEach(function(s) {
        lines.push("| [" + s.title + "](" + s.indexPath + ") | " + (s.pageCount || 0) + " | " + (s.updated || "") + " |")
      })
      lines.push("")
    } else {
      lines.push("## Sections", "", "- Add section index links here as the wiki grows.", "")
    }

    if (pages.length > 0) {
      lines.push("## Pages", "")
      lines.push("| Page | Updated | Summary |")
      lines.push("|---|---|---|")
      pages.forEach(function(p) {
        lines.push("| [" + p.title + "](" + (p.relPath || p.path) + ") | " + (p.updated || "") + " | " + (p.description || "") + " |")
      })
      lines.push("")
    } else {
      lines.push("## Pages", "", "- Add top-level page links here.", "")
    }

    if (isRoot && recent.length > 0) {
      lines.push("## Recent", "")
      recent.forEach(function(e) { lines.push("- " + e) })
      lines.push("")
    } else if (isRoot) {
      lines.push("## Recent", "", "- See [log.md](log.md) for recent changes.", "")
    }
  } else {
    // Placeholder template (no live page data available yet)
    if (isRoot) {
      lines.push("## Start here", "")
      lines.push("- [AGENTS.md](AGENTS.md) — contribution rules, schema, and workflow for agents.")
      lines.push("- [log.md](log.md) — append-only journal of recent writes and moves.")
      lines.push("")
    }
    lines.push("## Sections", "", "- Add section index links here.", "", "## Pages", "", "- Add page links here.", "")
  }

  return lines.join("\n")
}

// _isoDay: YYYY-MM-DD from a front-matter `updated` value. af.fromYAML turns ISO date
// strings into Date objects, so a plain String(...).substring(0,10) yields "Sun Aug 02".
var __miniAWikiIsoDay = function(value) {
  if (isUnDef(value) || value === null) return ""
  try {
    if (isDate(value)) return value.toISOString().substring(0, 10)
  } catch(eDate) {}
  var s = String(value)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10)
  try {
    var d = new Date(s)
    if (!isNaN(d.getTime())) return d.toISOString().substring(0, 10)
  } catch(eParse) {}
  return s.substring(0, 10)
}

// _indexBodyExtras: pulls out the parts of an existing index page that regenerateIndexes does
// not own, so author-written content survives a regeneration:
//   intro    - prose between the `# Title` heading and the first `##` section
//   sections - whole `## ...` blocks whose heading is not one of the generated ones
MiniAWikiManager.prototype._indexBodyExtras = function(body) {
  var out = { intro: "", sections: "" }
  if (!isString(body) || body.length === 0) return out
  var generated = { "attached wikis": true, "start here": true, "sections": true, "pages": true, "recent": true }
  var lines = body.split(/\r?\n/)
  var intro = []
  var kept  = []
  var keeping = false
  var seenHeading = false
  for (var i = 0; i < lines.length; i++) {
    var line = String(lines[i])
    var m = line.match(/^##\s+(.+?)\s*$/)
    if (m) {
      seenHeading = true
      keeping = generated[String(m[1]).toLowerCase()] !== true
    }
    if (keeping) { kept.push(line); continue }
    if (!seenHeading && !/^#\s+/.test(line)) intro.push(line)
  }
  out.intro    = intro.join("\n").replace(/^\s+|\s+$/g, "")
  out.sections = kept.join("\n").replace(/^\s+|\s+$/g, "")
  return out
}

// regenerateIndexes: rebuilds root and section index.md bodies from live page metadata,
// driving the pagesInfo branch of _makeIndexContent. Existing title/description are preserved.
// options.paths may restrict regeneration to exact index paths. Unchanged pages are skipped,
// which makes repeated deterministic repair runs content-idempotent.
// Returns { ok, regenerated:[path], skipped:[path] }.
MiniAWikiManager.prototype.regenerateIndexes = function(options) {
  if (this._access !== "rw") return { ok: false, error: "wiki is read-only" }
  var opts = isObject(options) ? options : {}
  var self = this
  var out = { ok: true, regenerated: [], skipped: [] }

  var pages = this._safeListPages("").filter(function(p) {
    var bn = p.split("/").pop()
    return bn !== "index.md" && bn !== "AGENTS.md" && bn !== "log.md"
  })

  // group pages by their immediate directory
  var byDir = {}
  pages.forEach(function(p) {
    var dir = self._pageDir(p)
    if (!isArray(byDir[dir])) byDir[dir] = []
    byDir[dir].push(p)
  })
  // every directory that holds pages gets an index, plus the root
  var dirs = Object.keys(byDir)
  if (dirs.indexOf("") < 0) dirs.push("")

  var infoFor = function(p) {
    var m = self._metaFor(p)
    return {
      path       : p,
      title      : isMap(m) && isString(m.title) && m.title.trim().length > 0 ? m.title.trim() : self._pageTitle(p),
      description: isMap(m) && isString(m.description) ? m.description : "",
      type       : isMap(m) && isString(m.type) ? m.type : "",
      updated    : isMap(m) && isDef(m.updated) ? __miniAWikiIsoDay(m.updated) : ""
    }
  }

  var requestedPaths = isArray(opts.paths) ? opts.paths : []
  // Regenerate children before parents so a parent catalog records the final child metadata
  // in the same pass (and a second identical pass has nothing left to change).
  dirs.sort(function(a, b) {
    var depthA = a.split("/").length, depthB = b.split("/").length
    if (depthA !== depthB) return depthB - depthA
    return a < b ? -1 : (a > b ? 1 : 0)
  }).forEach(function(dir) {
    var indexPath = dir + "index.md"
    if (requestedPaths.length > 0 && requestedPaths.indexOf(indexPath) < 0) return
    var isRoot    = indexPath === "index.md"

    // direct child pages of this directory
    var direct = (isArray(byDir[dir]) ? byDir[dir] : []).sort().map(function(p) {
      var info = infoFor(p)
      info.relPath = self._relativePath(indexPath, p)
      return info
    })

    // immediate child sections of this directory
    var childSections = dirs.filter(function(d) {
      if (d === dir || d.indexOf(dir) !== 0) return false
      var rest = d.substring(dir.length).replace(/\/$/, "")
      return rest.length > 0 && rest.indexOf("/") < 0
    }).sort().map(function(d) {
      var childIndex = d + "index.md"
      var cm = self._metaFor(childIndex)
      var childPages = self._safeListPages(d).filter(function(p) { return p.split("/").pop() !== "index.md" })
      return {
        indexPath: self._relativePath(indexPath, childIndex),
        title    : isMap(cm) && isString(cm.title) && cm.title.trim().length > 0 ? cm.title.trim()
                 : d.replace(/\/$/, "").replace(/.*\//, "").replace(/[-_]/g, " "),
        pageCount: childPages.length,
        updated  : isMap(cm) && isDef(cm.updated) ? __miniAWikiIsoDay(cm.updated) : ""
      }
    })

    var recent = []
    var attached = []
    if (isRoot) {
      try {
        var logRaw = this._backend.read("log.md")
        if (isString(logRaw)) {
          logRaw.split("\n").forEach(function(line) { if (/^## \[/.test(line)) recent.push(line.replace(/^## /, "").trim()) })
          recent = recent.reverse().slice(0, isNumber(opts.maxRecent) ? opts.maxRecent : 10)
        }
      } catch(eLog) {}
      attached = (isArray(this._mounts) ? this._mounts : []).map(function(m) {
        var count = 0; try { count = m.manager._safeListPages("").length } catch(eC) {}
        var desc = ""
        try {
          var idx = m.manager.read("index.md")
          if (isObject(idx) && isObject(idx.meta) && isString(idx.meta.description)) desc = idx.meta.description
        } catch(eD) {}
        return { name: m.name, description: desc, backend: m.manager._backendType, pages: count }
      })
    }

    // preserve the human-authored title/description, intro prose and custom sections
    var title = __, description = __, created = __, updated = __, extras = { intro: "", sections: "" }, existingRaw = __
    try {
      var existing = self.read(indexPath)
      if (isObject(existing) && isObject(existing.meta)) {
        if (isString(existing.meta.title)) title = existing.meta.title
        if (isString(existing.meta.description)) description = existing.meta.description
        if (isDef(existing.meta.created)) created = existing.meta.created
        if (isDef(existing.meta.updated)) updated = existing.meta.updated
      }
      if (isObject(existing) && isString(existing.body)) extras = self._indexBodyExtras(existing.body)
      existingRaw = self._backend.read(indexPath)
    } catch(eRead) {}

    try {
      var makeContent = function(indexUpdated) {
        var content = self._makeIndexContent(indexPath, title, description, {
          pages: direct, sections: childSections, recent: recent, attachedWikis: attached,
          created: created, updated: indexUpdated
        })
      // put the author's intro back in place of the generated one-liner
        if (extras.intro.length > 0) {
          var hIdx = content.indexOf("\n# ")
          if (hIdx >= 0) {
            var afterHeading = content.indexOf("\n", hIdx + 1)
            var firstSection = content.indexOf("\n## ", hIdx)
            if (afterHeading >= 0 && firstSection > afterHeading) {
              content = content.substring(0, afterHeading + 1) + "\n" + extras.intro + "\n" + content.substring(firstSection)
            }
          }
        }
        if (extras.sections.length > 0) content = content.replace(/\s+$/, "") + "\n\n" + extras.sections + "\n"
        return content
      }
      // Generate once using the existing timestamp. If it is identical, do not write.
      var content = makeContent(updated)
      if (isString(existingRaw) && existingRaw === content) {
        out.skipped.push(indexPath)
        return
      }
      // A changed catalog needs a fresh `updated`, while preserving its original `created`.
      content = makeContent(new Date().toISOString())
      self._backend.write(indexPath, content)
      self._updatePageIndexes(indexPath, content, self.parseFrontmatter(content))
      out.regenerated.push(indexPath)
    } catch(eWrite) {
      self._logFn("warn", "Failed to regenerate " + indexPath + ": " + __miniAErrMsg(eWrite))
      out.skipped.push(indexPath)
    }
  }.bind(this))

  return out
}

MiniAWikiManager.prototype.init = function(path) {
  if (this._access !== "rw") return { ok: false, error: "wiki is read-only" }
  var now = new Date().toISOString()
  if (isString(path) && path.trim().length > 0) {
    try {
      var section = this._normalizeSectionPath(path)
      var indexPath = section + "index.md"
      if (this._backend.exists(indexPath)) return { ok: true, created: [], skipped: [ indexPath ] }
      var content = this._makeIndexContent(indexPath)
      this._backend.write(indexPath, content)
      this._updatePageIndexes(indexPath, content, this.parseFrontmatter(content))
      return { ok: true, created: [ indexPath ], skipped: [] }
    } catch(sectionErr) {
      return { ok: false, error: __miniAErrMsg(sectionErr) }
    }
  }
  var hasAgents = this._backend.exists("AGENTS.md")
  var hasIndex  = this._backend.exists("index.md")
  var hasLog    = this._backend.exists("log.md")
  var bootstrapped = isArray(this._bootstrappedFiles) ? this._bootstrappedFiles : []
  this._bootstrappedFiles = []
  var created = []
  var skipped = []
  try {
    var bootstrapPageDocs = this._readAllPageDocs()
    this._rebuildSearchIndex(__, bootstrapPageDocs)
    this._rebuildGraphIndex(bootstrapPageDocs)
    if (!hasAgents) {
      this._backend.write("AGENTS.md", __miniAWikiAgentsTemplate(now))
      created.push("AGENTS.md")
    } else if (bootstrapped.indexOf("AGENTS.md") >= 0) {
      created.push("AGENTS.md")
    } else {
      skipped.push("AGENTS.md")
    }
    if (!hasIndex) {
      this._backend.write("index.md", __miniAWikiIndexRootTemplate(now))
      created.push("index.md")
    } else if (bootstrapped.indexOf("index.md") >= 0) {
      created.push("index.md")
    } else {
      skipped.push("index.md")
    }
    if (!hasLog) {
      this._backend.write("log.md", __miniAWikiLogTemplate(now))
      created.push("log.md")
    } else if (bootstrapped.indexOf("log.md") >= 0) {
      created.push("log.md")
    } else {
      skipped.push("log.md")
    }
    return { ok: true, created: created, skipped: skipped }
  } catch(e) {
    return { ok: false, error: __miniAErrMsg(e) }
  }
}

var __miniAWikiFsList = function(dir, normalizedPrefix, sep) {
  if (isUnDef(dir)) return []
  dir = String(dir)
  if (dir.length === 0) return []
  if (!io.fileExists(dir) || io.fileInfo(dir).isDirectory != true) return []

  var dirPrefix = dir.endsWith(sep) ? dir : dir + sep
  var raw = listFilesRecursive(dir)
  var entries = []
  if (isArray(raw)) {
    entries = raw
  } else if (isMap(raw) && isArray(raw.files)) {
    entries = raw.files
  } else if (isDef(raw) && isFunction(raw.forEach)) {
    raw.forEach(function(entry) { entries.push(entry) })
  }

  var dedup = []
  var seen = {}
  entries.forEach(function(entry) {
    if (!isMap(entry) || entry.isFile != true) return
    var entryPath = isString(entry.canonicalPath) ? entry.canonicalPath : ""
    if (entryPath.length === 0 && isString(entry.filepath)) entryPath = entry.filepath
    if (entryPath.length === 0 && isString(entry.path) && isString(entry.filename)) entryPath = entry.path + sep + entry.filename
    if (entryPath.length === 0) return

    try { entryPath = new java.io.File(entryPath).getCanonicalPath() } catch(e) {}
    if (!entryPath.endsWith(".md")) return
    if (!entryPath.startsWith(dirPrefix)) return

    var relPath = normalizedPrefix + String(entryPath).substring(dirPrefix.length).replace(/\\/g, "/")
    if (!isString(relPath) || relPath.length === 0 || seen[relPath] === true) return
    seen[relPath] = true
    dedup.push(relPath)
  })

  return dedup.sort()
}

var __miniAWikiEsRowsToPaths = function(rows) {
  if (!isArray(rows)) return []
  return rows.map(function(r) {
    return isMap(r) && isString(r.path) ? r.path : __
  }).filter(isString)
}

var __miniAWikiNormalizePath = function(path, options) {
  var opts = isMap(options) ? options : {}
  if (!isString(path)) throw "path is required"

  var value = String(path).trim().replace(/\\/g, "/")
  if (value.length === 0) throw "path is required"
  if (/[\x00-\x1f]/.test(value)) throw "path contains control characters"
  if (value.startsWith("/") || value.startsWith("//") || /^[A-Za-z]:\//.test(value)) throw "absolute paths are not allowed"
  if (opts.allowDirectory === true) {
    while (value.length > 0 && value.endsWith("/")) value = value.substring(0, value.length - 1)
  }
  if (!opts.allowDirectory && value.endsWith("/")) throw "path must target a file"

  var parts = value.split("/")
  var normalized = []

  for (var i = 0; i < parts.length; i++) {
    var part = String(parts[i] || "").trim()
    if (part.length === 0) throw "path contains empty segments"
    if (part === ".") continue
    if (part === "..") throw "path traversal is not allowed"
    if (part.startsWith("@")) throw "paths starting with @ are reserved for mounted wikis"
    normalized.push(part)
  }

  if (normalized.length === 0) throw "path is required"

  var finalPath = normalized.join("/")
  if (opts.requireMarkdown === true && !finalPath.toLowerCase().endsWith(".md")) {
    throw "path must end with .md"
  }

  return finalPath
}

// ── Filesystem backend ───────────────────────────────────────────────────────

MiniAWikiManager.prototype._makeFsBackend = function(cfg) {
  var sep  = String(java.io.File.separator)
  var rawRoot = isDef(cfg.root) ? String(cfg.root).trim() : ""
  var root = rawRoot.length > 0 ? rawRoot : "."
  var canonicalRoot = String(new java.io.File(root).getCanonicalPath())
  if (this._archiveRoot) return this._makeArchiveFsBackend(canonicalRoot)
  var canonicalRootPrefix = canonicalRoot.endsWith(sep) ? canonicalRoot : canonicalRoot + sep
  var normalizePrefix = function(value) {
    var prefix = isDef(value) ? String(value).trim().replace(/\\/g, "/") : ""
    if (prefix.length === 0) return ""
    prefix = __miniAWikiNormalizePath(prefix, { allowDirectory: true })
    if (prefix.startsWith("./")) prefix = prefix.substring(2)
    while (prefix.startsWith("/")) prefix = prefix.substring(1)
    if (prefix.length > 0 && !prefix.endsWith("/")) prefix = prefix + "/"
    return prefix
  }
  // asDirectory=true resolves a folder prefix (no .md leaf required);
  // allowMissingLeaf=true resolves a file that does not exist yet.
  var resolvePath = function(relPath, allowMissingLeaf, asDirectory) {
    var rel = (isDef(relPath) && String(relPath).length > 0) ? __miniAWikiNormalizePath(relPath, {
      allowDirectory  : asDirectory === true || allowMissingLeaf !== true,
      requireMarkdown : asDirectory !== true && allowMissingLeaf !== true
    }) : ""
    var candidate = rel.length > 0 ? new java.io.File(canonicalRoot, rel) : new java.io.File(canonicalRoot)
    var canonical
    if (allowMissingLeaf === true && !candidate.exists()) {
      var parent = candidate.getParentFile()
      var parentCanonical = isDef(parent) ? String(parent.getCanonicalPath()) : canonicalRoot
      canonical = parentCanonical + sep + candidate.getName()
    } else {
      canonical = String(candidate.getCanonicalPath())
    }
    if (canonical !== canonicalRoot && !canonical.startsWith(canonicalRootPrefix)) {
      throw "path escapes wikiroot"
    }
    return canonical
  }
  return {
    type: "fs",
    root: canonicalRoot,
    list: function(prefix) {
      try {
        var normalizedPrefix = normalizePrefix(prefix)
        var dir = resolvePath(normalizedPrefix, false, true)
        return __miniAWikiFsList(dir, normalizedPrefix, sep)
      } catch(e) { return [] }
    },
    read: function(path) {
      try {
        var content = io.readFileString(resolvePath(path, false))
        return isDef(content) ? String(content) : __
      } catch(e) { return __ }
    },
    write: function(path, content) {
      var full = resolvePath(path, true)
      var parent = new java.io.File(full).getParentFile()
      if (isDef(parent) && !io.fileExists(String(parent.getCanonicalPath()))) io.mkdir(String(parent.getCanonicalPath()))
      io.writeFileString(full, content)
    },
    exists: function(path) {
      try { return io.fileExists(resolvePath(path, false)) } catch(e) { return false }
    },
    delete: function(path) {
      var full = resolvePath(path, false)
      var file = new java.io.File(full)
      if (!file.exists()) throw "file not found"
      if (!file.isFile()) throw "not a file"
      if (!file.delete()) throw "failed to delete file"
    }
  }
}

// ZIP and OKT files are transparent, read-only filesystem wiki roots. Paths are
// deliberately the archive entry names: bundles must place index.md at root.
MiniAWikiManager.prototype._makeArchiveFsBackend = function(archivePath) {
  plugin("ZIP")
  var safeEntry = function(value) {
    if (!isString(value)) return __
    try {
      var normalized = __miniAWikiNormalizePath(value, { requireMarkdown: true })
      // Do not reinterpret entries (for example, backslashes or ./ prefixes).
      return normalized === value ? normalized : __
    } catch(e) { return __ }
  }
  var entries = function() {
    var zip = new ZIP()
    try {
      return Object.keys(zip.list(archivePath)).map(safeEntry).filter(function(p) { return isString(p) })
    } finally {
      try { zip.close() } catch(e) {}
    }
  }
  return {
    type: "archive",
    root: archivePath,
    readOnly: true,
    list: function(prefix) {
      var pfx = isDef(prefix) ? String(prefix).trim() : ""
      if (pfx.length > 0) {
        try { pfx = __miniAWikiNormalizePath(pfx, { allowDirectory: true }) } catch(e) { return [] }
        if (pfx.length > 0) pfx = pfx + "/"
      }
      return entries().filter(function(path) { return pfx.length === 0 || path.indexOf(pfx) === 0 }).sort()
    },
    read: function(path) {
      var entry = safeEntry(path)
      if (isUnDef(entry)) return __
      try {
        var content = io.readFileString(archivePath + "::" + entry)
        return isDef(content) ? String(content) : __
      } catch(e) { return __ }
    },
    exists: function(path) {
      var entry = safeEntry(path)
      return isDef(entry) && entries().indexOf(entry) >= 0
    },
    write: function() { throw "archive wiki is read-only" },
    delete: function() { throw "archive wiki is read-only" }
  }
}

// ── S3 backend ───────────────────────────────────────────────────────────────

MiniAWikiManager.prototype._makeS3Backend = function(cfg) {
  loadLib("s3.js")
  var parent = this
  var bucket  = isString(cfg.bucket) ? cfg.bucket.trim() : ""
  var prefix  = isString(cfg.prefix) ? cfg.prefix.trim() : "wiki/"
  if (prefix.length > 0 && !prefix.endsWith("/")) prefix = prefix + "/"
  var url     = isString(cfg.url) ? cfg.url : "https://s3.amazonaws.com"
  var s3client = new S3(url, cfg.accessKey, cfg.secret, cfg.region,
                        toBoolean(cfg.useVersion1) === true,
                        toBoolean(cfg.ignoreCertCheck) === true)
  return {
    type  : "s3",
    bucket: bucket,
    prefix: prefix,
    client: s3client,
    list: function(pfx) {
      var p = prefix + (isString(pfx) && pfx.length > 0 ? pfx : "")
      try {
        var objs = s3client.listObjects(bucket, p, false, true)
        if (!isArray(objs)) return []
        return objs
          .map(function(o) { return isString(o.filename) ? o.filename : (isString(o.canonicalPath) ? o.canonicalPath : "") })
          .filter(function(n) { return n.length > 0 && n.endsWith(".md") && !n.endsWith("/") })
          .map(function(n) { return n.startsWith(prefix) ? n.substring(prefix.length) : n })
      } catch(e) {
        if (isFunction(parent._logFn)) parent._logFn("warn", "Failed to list wiki S3 objects: " + __miniAErrMsg(e))
        return []
      }
    },
    read: function(path) {
      var identifier = "s3://" + bucket + "/" + prefix + path
      try {
        var stream = s3client.getObjectStream(bucket, prefix + path)
        var content = af.fromInputStream2String(stream)
        parent._auditRetrieval("s3", identifier, path, true, isString(content) ? content.length : 0)
        return content
      } catch(e) {
        parent._auditRetrieval("s3", identifier, path, false, 0)
        return __
      }
    },
    write: function(path, content) {
      s3client.putObjectStream(bucket, prefix + path,
        af.fromString2InputStream(content), {}, "text/markdown")
    },
    exists: function(path) {
      try {
        var stream = s3client.getObjectStream(bucket, prefix + path)
        if (isDef(stream)) { try { stream.close() } catch(ig) {} return true }
        return false
      } catch(e) { return false }
    },
    delete: function(path) {
      s3client.removeObject(bucket, prefix + path)
    },
    close: function() {
      try { s3client.close() } catch(e) {}
    }
  }
}

// ── Static HTTP(S) backend ──────────────────────────────────────────────────

MiniAWikiManager.prototype._makeHttpBackend = function(cfg) {
  var parent = this
  var base = isString(cfg.url) ? cfg.url.trim() : ""
  var timeout = isNumber(Number(cfg.wikihttptimeout)) && Number(cfg.wikihttptimeout) > 0 ? Number(cfg.wikihttptimeout) : 30000
  var secret = isString(cfg.secret) && cfg.secret.length > 0 ? cfg.secret : (isString(getEnv("OAF_MINI_A_WIKI_SECRET")) ? getEnv("OAF_MINI_A_WIKI_SECRET") : __)
  var auth = function(connection) {
    if (isString(cfg.accessKey) && cfg.accessKey.length > 0 && isString(secret) && secret.length > 0) connection.setRequestProperty("Authorization", __miniAWikiBasicAuth(cfg.accessKey, secret))
    else if (isString(secret) && secret.length > 0) connection.setRequestProperty("Authorization", "Bearer " + secret)
  }
  var open = function(path, method) {
    var connection = new java.net.URL(__miniAWikiUrlJoin(base, path)).openConnection()
    connection.setConnectTimeout(timeout); connection.setReadTimeout(timeout)
    if (isDef(connection.setRequestMethod)) connection.setRequestMethod(method)
    auth(connection)
    return connection
  }
  return {
    type: "http",
    url: base,
    list: function(prefix) { return parent._luceneListAllReadOnly(prefix) },
    read: function(path) {
      var identifier = __miniAWikiUrlJoin(base, path)
      var conn = __
      try {
        conn = open(path, "GET")
        var code = Number(conn.getResponseCode())
        if (code < 200 || code >= 300) {
          try {
            var errStream = conn.getErrorStream()
            if (isDef(errStream) && errStream != null) { af.fromInputStream2String(errStream); errStream.close() }
          } catch(ignoreErrStream) {}
          parent._auditRetrieval("http", identifier, path, false, 0)
          return __
        }
        var stream = conn.getInputStream()
        try {
          var content = af.fromInputStream2String(stream)
          parent._auditRetrieval("http", identifier, path, true, isString(content) ? content.length : 0)
          return content
        } finally { try { stream.close() } catch(ignoreClose) {} }
      } catch(e) {
        parent._auditRetrieval("http", identifier, path, false, 0)
        return __
      } finally {
        try { if (isDef(conn) && conn instanceof java.net.HttpURLConnection) conn.disconnect() } catch(ignoreDisconnect) {}
      }
    },
    exists: function(path) {
      var conn = __
      try {
        conn = open(path, "HEAD")
        var code = Number(conn.getResponseCode())
        return code >= 200 && code < 300
      } catch(e) {
        return false
      } finally {
        try { if (isDef(conn) && conn instanceof java.net.HttpURLConnection) conn.disconnect() } catch(ignoreDisconnect) {}
      }
    },
    write: function() { throw "http wiki is read-only" },
    delete: function() { throw "http wiki is read-only" },
    close: function() {}
  }
}

MiniAWikiManager.prototype._hydrateHttpArtifacts = function() {
  var base = isString(this._config.url) ? this._config.url.trim() : ""
  if (base.length === 0) return
  var bundleUrl = isString(this._config.wikihttpindexurl) && this._config.wikihttpindexurl.trim().length > 0 ? this._config.wikihttpindexurl.trim() : __miniAWikiUrlJoin(base, "mini-a-wiki-index.zip")
  var timeout = isNumber(Number(this._config.wikihttptimeout)) && Number(this._config.wikihttptimeout) > 0 ? Number(this._config.wikihttptimeout) : 30000
  var secret = isString(this._config.secret) && this._config.secret.length > 0 ? this._config.secret : (isString(getEnv("OAF_MINI_A_WIKI_SECRET")) ? getEnv("OAF_MINI_A_WIKI_SECRET") : __)
  var auth = function(conn) {
    if (isString(this._config.accessKey) && this._config.accessKey.length > 0 && isString(secret) && secret.length > 0) conn.setRequestProperty("Authorization", __miniAWikiBasicAuth(this._config.accessKey, secret));
    else if (isString(secret) && secret.length > 0) conn.setRequestProperty("Authorization", "Bearer " + secret)
  }.bind(this)
  var connect = function(method) {
    var conn = new java.net.URL(bundleUrl).openConnection()
    conn.setConnectTimeout(timeout); conn.setReadTimeout(timeout); conn.setRequestMethod(method); auth(conn)
    return conn
  }
  return this._hydrateArtifactBundle(function() {
    var conn = connect("HEAD")
    try {
      var code = Number(conn.getResponseCode())
      if (code < 200 || code >= 300) throw "HTTP HEAD " + bundleUrl + " for bundle metadata returned " + code
      return { etag: String(conn.getHeaderField("ETag") || ""), lastModified: String(conn.getHeaderField("Last-Modified") || "") }
    } finally { try { conn.disconnect() } catch(ignoreDisconnect) {} }
  }, function() {
    var conn = connect("GET"), code = Number(conn.getResponseCode())
    if (code < 200 || code >= 300) {
      try { conn.disconnect() } catch(ignoreDisconnect) {}
      throw "HTTP GET " + bundleUrl + " for bundle download returned " + code
    }
    return conn.getInputStream()
  }, "http", bundleUrl)
}

// Remote artifact bundles are immutable snapshots. A long-lived server may
// cheaply probe their metadata between requests and replace the whole local
// snapshot only when it changed. Individual S3 artifacts deliberately do not
// participate: mixing files from two Lucene generations is unsafe.
MiniAWikiManager.prototype._maybeRefreshArtifactBundle = function() {
  var seconds = Number(this._config.wikiartifactrefreshsecs)
  if (!isNumber(seconds) || seconds <= 0 || this._artifactRefreshInProgress === true) return false
  var refreshable = this._backendType === "http" || (this._backendType === "s3" && toBoolean(this._config.s3artifactbundle) === true)
  if (!refreshable) return false
  var now = new Date().getTime()
  var last = isNumber(this._artifactLastCheckAt) ? this._artifactLastCheckAt : 0
  if (last > 0 && now - last < seconds * 1000) return false
  this._artifactLastCheckAt = now
  this._artifactRefreshInProgress = true
  try {
    var changed = this._backendType === "http" ? this._hydrateHttpArtifacts() : this._hydrateS3Artifacts()
    if (changed !== true) return false
    if (isObject(this._searchIndex) && isFunction(this._searchIndex.close)) this._searchIndex.close()
    this._searchIndex = __
    if (isObject(this._graph) && isFunction(this._graph.close)) this._graph.close()
    this._graph = __
    // a refreshed artifact bundle means backend.read() would now return different
    // content for the same paths — drop the read cache so it doesn't keep serving
    // pre-refresh bodies for up to wikisearchcachettlms. Guarded by isFunction, not just
    // called directly: this method is unit-tested via .call() against a plain-object
    // fake that doesn't implement every MiniAWikiManager prototype method.
    if (isFunction(this._invalidateReadCache)) this._invalidateReadCache()
    this._initializeGraph()
    this._logFn("info", "Refreshed wiki search/graph artifact bundle")
    return true
  } catch(e) {
    this._logFn("warn", "Failed to refresh wiki search/graph artifact bundle: " + __miniAErrMsg(e))
    return false
  } finally {
    this._artifactRefreshInProgress = false
  }
}

MiniAWikiManager.prototype._makeEsBackend = function(cfg) {
  var parent = this
  includeOPack("ElasticSearch")
  loadLib("elasticsearch.js")
  var esurl = isString(cfg.esurl) ? cfg.esurl : "http://127.0.0.1:9200"
  var index = isString(cfg.esindex) && cfg.esindex.length > 0 ? cfg.esindex : "mini_a_wiki"
  var es = new ElasticSearch(esurl, cfg.esuser, cfg.espass)
  var chName = "__mini_a_wiki_es_" + sha1(index).substring(0, 8)
  es.createCh(index, ["path"], chName)
  return {
    type: "es",
    index: index,
    list: function(pfx) {
      var prefix = isString(pfx) ? pfx : ""
      var rows = $ch(chName).getAll({ query: { prefix: { path: prefix } }, size: 10000 })
      if (isArray(rows) && rows.length >= 10000 && isFunction(parent._logFn)) {
        parent._logFn("warn", "Elastic wiki list reached the 10000 row cap; results may be truncated.")
      }
      return __miniAWikiEsRowsToPaths(rows)
    },
    read: function(path) {
      var r = $ch(chName).get({ path: path })
      var raw = isMap(r) ? r.raw : __
      parent._auditRetrieval("es", "es:" + index + "/" + path, path, isDef(raw), isString(raw) ? raw.length : 0)
      return raw
    },
    write: function(path, content) { $ch(chName).set({ path: path }, { path: path, raw: content }) },
    exists: function(path) { return isMap($ch(chName).get({ path: path })) },
    delete: function(path) { $ch(chName).unset({ path: path }) },
    close: function() { try { $ch(chName).destroy() } catch(e) {} }
  }
}

MiniAWikiManager.prototype._makeS3FsBackend = function(cfg) {
  var fsb = this._makeFsBackend(cfg)
  var access = isString(cfg.access) ? cfg.access.toLowerCase() : "rw"

  if (access !== "ro") {
    var s3b = this._makeS3Backend(cfg)
    try {
      var pages = s3b.list("")
      for (var i = 0; i < pages.length; i++) {
        var raw = s3b.read(pages[i])
        if (!isString(raw)) continue

        var shouldWrite = true
        try {
          if (isFunction(fsb.exists) && fsb.exists(pages[i])) {
            var current = isFunction(fsb.read) ? fsb.read(pages[i]) : __
            shouldWrite = raw !== current
          }
        } catch(ig) {}

        if (shouldWrite) fsb.write(pages[i], raw)
      }
    } catch(e) {
      this._logFn("warn", "Failed to bootstrap s3fs wiki: " + __miniAErrMsg(e))
    } finally {
      try { s3b.close() } catch(ig) {}
    }
  }

  return fsb
}

MiniAWikiManager.prototype.close = function() {
  var self = this
  Object.keys(this._metaDirty || {}).forEach(function(k) { self._saveMetaShard(k) })
  if (isObject(this._searchIndex)) { try { this._searchIndex.close() } catch(ignoreIdxClose) {} }
  this._closeLucene()
  if (isObject(this._graph) && isFunction(this._graph.close)) {
    try { this._graph.close() } catch(ignoreGraphClose) {}
  }
  this._invalidateReadCache()
  if (isObject(this._backend) && isFunction(this._backend.close)) {
    this._backend.close()
  }
  // pre-existing gap: mounts were never cascaded (only detach() closed a mount's
  // manager) — now more consequential since every mount also owns its own read-cache
  // channel in the process-global $cache registry
  if (isArray(this._mounts)) {
    this._mounts.forEach(function(m) {
      try { if (isObject(m.manager) && isFunction(m.manager.close)) m.manager.close() } catch(ignoreMountClose) {}
    })
  }
}

// ── Front-matter ─────────────────────────────────────────────────────────────

MiniAWikiManager.prototype.parseFrontmatter = function(raw) {
  if (!isString(raw)) return { meta: {}, body: "" }
  var stripped = raw.replace(/\r\n/g, "\n")
  if (!stripped.startsWith("---\n")) return { meta: {}, body: stripped }
  var end = stripped.indexOf("\n---\n", 4)
  if (end < 0) {
    end = stripped.indexOf("\n---", 4)
    if (end < 0) return { meta: {}, body: stripped }
  }
  var yamlBlock = stripped.substring(4, end)
  var body = stripped.substring(end + 5)
  var meta = {}
  try { meta = af.fromYAML(yamlBlock) || {} } catch(e) {}
  if (!isObject(meta)) meta = {}
  if (isDef(meta.timestamp) && isUnDef(meta.updated)) meta.updated = meta.timestamp
  return { meta: meta, body: body }
}

MiniAWikiManager.prototype._serializeFrontmatter = function(meta, body) {
  var yaml = ""
  try { yaml = af.toYAML(meta) } catch(e) { yaml = "" }
  return "---\n" + yaml + "---\n" + (isString(body) ? body : "")
}

// Markdown headings outside fenced code blocks.  Keeping this parser here makes
// lint, anchor validation and deterministic dream repairs agree exactly.
MiniAWikiManager.prototype._markdownHeadings = function(body) {
  var out = [], fenced = false, fenceChar = ""
  String(body || "").split(/\r?\n/).forEach(function(line, lineNo) {
    var fence = String(line).match(/^\s*(```+|~~~+)/)
    if (fence) {
      var ch = fence[1].substring(0, 1)
      if (!fenced) { fenced = true; fenceChar = ch }
      else if (ch === fenceChar) { fenced = false; fenceChar = "" }
      return
    }
    if (fenced) return
    var m = String(line).match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (m) out.push({ line: lineNo, level: m[1].length, text: String(m[2]).trim() })
  })
  return out
}

MiniAWikiManager.prototype._headingAnchor = function(text) {
  return String(text || "").toLowerCase().trim().replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9\s_-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-")
}

// ── Link extraction ───────────────────────────────────────────────────────────

// Returns [{raw, type}] where type is "md" (page-relative) or "wiki" (root-relative).
// External https?:// targets are excluded here since they are never wiki-internal.
MiniAWikiManager.prototype._wikiLinkTarget = function(value) {
  var target = String(value || "").split("|")[0].split("#")[0].trim()
  if (target.length === 0) return ""
  if (target.toLowerCase().endsWith(".md")) return target.replace(/^\/+/, "")
  return target.toLowerCase().replace(/\s+/g, "-") + ".md"
}

MiniAWikiManager.prototype._extractLinkEntries = function(body) {
  if (!isString(body)) return []
  var entries = []
  var seen    = {}
  var m
  var mdRe = /\[([^\]]*)\]\(([^)]+)\)/g
  while ((m = mdRe.exec(body)) !== null) {
    var target = m[2].trim()
    var pathPart = target.split("#")[0]
    var internal = target.charAt(0) === "#" || /\.md$/i.test(pathPart) || /\/$/.test(pathPart) || !/\.[a-z0-9]+$/i.test(pathPart)
    if (target.length > 0 && internal && !/^[a-z][a-z0-9+.-]*:/i.test(target) && !seen[target]) {
      seen[target] = true
      entries.push({ raw: target, type: "md" })
    }
  }
  // Wiki-style links: [[Page Name]] and [[path.md|label]] — always root-relative.
  var wikiRe = /\[\[([^\]]+)\]\]/g
  while ((m = wikiRe.exec(body)) !== null) {
    var target = this._wikiLinkTarget(m[1])
    if (target.length > 0) {
      if (!seen[target]) { seen[target] = true; entries.push({ raw: target, type: "wiki" }) }
    }
  }
  return entries
}

// Public: returns raw link targets for backward-compatibility.
MiniAWikiManager.prototype.extractLinks = function(body) {
  return this._extractLinkEntries(body).map(function(e) { return e.raw })
}

// Resolve a Markdown link target relative to the source page's directory.
// Wiki-style ([[…]]) slugs are already root-relative — pass them directly without calling this.
// Returns the resolved wiki-root-relative path, or null if the link is not a valid
// internal wiki reference (external URL, absolute path, or escapes the wiki root).
MiniAWikiManager.prototype.resolveLink = function(sourcePage, target) {
  if (!isString(target) || target.length === 0) return null
  if (/^https?:\/\//i.test(target)) return null   // external URL
  // Cross-wiki mount link: @name/path.md — return as-is; lint validates separately
  if (target.startsWith("@")) return target

  // Bundle-root-relative link (OKF-style absolute path): resolve from the wiki root
  var pageDir
  if (target.startsWith("/")) {
    pageDir = ""
    target  = target.replace(/^\/+/, "")
  } else {
    pageDir = isString(sourcePage) && sourcePage.indexOf("/") > -1
      ? sourcePage.substring(0, sourcePage.lastIndexOf("/") + 1)
      : ""
  }
  var combined = pageDir + target
  var parts = combined.split("/")
  var normalized = []
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i]
    if (part === "" || part === ".") continue
    if (part === "..") {
      if (normalized.length > 0) normalized.pop()
      else return null  // would escape wiki root
    } else {
      normalized.push(part)
    }
  }
  if (normalized.length === 0) return null
  var resolved = normalized.join("/")
  if (!resolved.toLowerCase().endsWith(".md")) return null
  return resolved
}

// ── Fingerprint / near-duplicate (mirrors MiniAMemoryManager) ────────────────

MiniAWikiManager.prototype._fingerprint = function(text) {
  if (!isString(text)) text = String(text || "")
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
}

MiniAWikiManager.prototype._isNearDuplicate = function(a, b) {
  var fa = this._fingerprint(a), fb = this._fingerprint(b)
  if (fa.length === 0 || fb.length === 0) return false
  if (fa === fb) return true
  if (fa.length > 20 && fb.length > 20 && (fa.indexOf(fb) >= 0 || fb.indexOf(fa) >= 0)) return true
  var aw = fa.split(" "), bw = fb.split(" ")
  var seen = {}
  aw.forEach(function(w) { if (w.length > 2) seen[w] = true })
  var overlap = 0, denom = 0
  bw.forEach(function(w) {
    if (w.length <= 2) return
    denom++
    if (seen[w]) overlap++
  })
  if (denom === 0) return false
  return (overlap / denom) >= 0.85
}

// _sliceLines: slice an array of raw lines by range or section name.
// Returns { linesTotal, lineStart, lineEnd, linesRead, content } or { linesTotal } for countLines.
MiniAWikiManager.prototype._sliceLines = function(lines, options) {
  var total = lines.length
  var opts  = isObject(options) ? options : {}

  if (opts.countLines === true) return { linesTotal: total }

  var start, end

  if (isString(opts.section) && opts.section.trim().length > 0) {
    var sectionName  = opts.section.trim().toLowerCase()
    var sectionStart = -1
    var sectionLevel = 0
    for (var i = 0; i < lines.length; i++) {
      var sm = /^(#{1,6})\s+(.+)/.exec(lines[i])
      if (sm && sm[2].trim().toLowerCase().indexOf(sectionName) >= 0) {
        sectionStart = i; sectionLevel = sm[1].length; break
      }
    }
    if (sectionStart < 0) return { linesTotal: total, lineStart: 0, lineEnd: 0, linesRead: 0, content: "" }
    var sectionEnd = lines.length
    for (var j = sectionStart + 1; j < lines.length; j++) {
      var em = /^(#{1,6})\s+/.exec(lines[j])
      if (em && em[1].length <= sectionLevel) { sectionEnd = j; break }
    }
    start = sectionStart
    end   = sectionEnd - 1
  } else {
    start = isNumber(opts.lineStart) && opts.lineStart > 0 ? opts.lineStart - 1 : 0
    if (isNumber(opts.maxLines) && opts.maxLines > 0) {
      end = start + opts.maxLines - 1
    } else if (isNumber(opts.lineEnd) && opts.lineEnd > 0) {
      end = opts.lineEnd - 1
    } else {
      end = lines.length - 1
    }
  }

  if (start < 0) start = 0
  end = Math.min(end, lines.length - 1)
  if (start > end) end = start

  var sliced = lines.slice(start, end + 1)
  return {
    linesTotal: total,
    lineStart : start + 1,
    lineEnd   : end + 1,
    linesRead : sliced.length,
    content   : sliced.join("\n")
  }
}

MiniAWikiManager.prototype.read = function(path, options) {
  if (!isString(path) || path.trim().length === 0) return __
  this._maybeRefreshArtifactBundle()
  var trimmed = path.trim()
  // Mount routing: @name/localpath
  if (trimmed.startsWith("@")) {
    var mres = this._resolveMountPath(trimmed)
    if (!mres || !mres.mount) return __
    return mres.mount.manager.read(mres.localPath, options)
  }
  try { path = __miniAWikiNormalizePath(path, { requireMarkdown: true }) } catch(e) { return __ }
  var raw = this._backend.read(path)
  if (isUnDef(raw)) return __
  var parsed = this.parseFrontmatter(raw)

  var opts = isObject(options) ? options : {}
  var hasRangeOpts = opts.countLines === true
    || (isNumber(opts.lineStart) && opts.lineStart > 0)
    || (isNumber(opts.lineEnd)   && opts.lineEnd   > 0)
    || (isNumber(opts.maxLines)  && opts.maxLines  > 0)
    || (isString(opts.section)   && opts.section.trim().length > 0)

  if (!hasRangeOpts) {
    var self = this
    var npath = path.trim()
    var entries = self._extractLinkEntries(parsed.body)
    var seenLinks = {}
    var resolvedLinks = []
    entries.forEach(function(e) {
      var resolved = e.type === "wiki" ? e.raw : self.resolveLink(npath, e.raw)
      if (isString(resolved) && resolved.length > 0 && !seenLinks[resolved]) {
        seenLinks[resolved] = true
        resolvedLinks.push(resolved)
      }
    })
    return { path: npath, meta: parsed.meta, body: parsed.body, raw: raw, links: resolvedLinks }
  }

  var lines  = raw.split("\n")
  var sliced = this._sliceLines(lines, opts)

  if (opts.countLines === true) {
    return { path: path.trim(), meta: parsed.meta, linesTotal: sliced.linesTotal }
  }

  return {
    path      : path.trim(),
    meta      : parsed.meta,
    body      : sliced.content,
    raw       : sliced.content,
    lineStart : sliced.lineStart,
    lineEnd   : sliced.lineEnd,
    linesTotal: sliced.linesTotal,
    linesRead : sliced.linesRead
  }
}

MiniAWikiManager.prototype.write = function(path, metaOrRaw, body, options) {
  if (this._access !== "rw") return { ok: false, error: "wiki is read-only (wikiaccess=ro)" }
  if (!isString(path) || path.trim().length === 0) return { ok: false, error: "path is required" }
  if (path.trim().startsWith("@")) return { ok: false, error: "mounted wikis are read-only; cannot write to " + path.trim() }
  try {
    path = __miniAWikiNormalizePath(path, { requireMarkdown: true })
  } catch(e) {
    return { ok: false, error: __miniAErrMsg(e) }
  }

  var opts         = isObject(options) ? options : {}
  var doAppend     = opts.append === true
  var doInsert     = isNumber(opts.lineInsert) && opts.lineInsert > 0
  var doRangeEdit  = (isNumber(opts.lineStart) && opts.lineStart > 0) || (isNumber(opts.lineEnd) && opts.lineEnd > 0)
  var doSection    = isString(opts.section) && opts.section.trim().length > 0
  var now          = new Date().toISOString()

  if (doAppend || doInsert || doRangeEdit || doSection) {
    var existing = this.read(path)
    if (!isObject(existing)) return { ok: false, error: "page not found: " + path }

    var rawLines   = existing.raw.split("\n")
    var newContent = isString(metaOrRaw) ? metaOrRaw : (isString(body) ? body : "")
    var newLines   = newContent.split("\n")
    var resultLines

    if (doAppend) {
      resultLines = rawLines.concat(newLines)
    } else if (doSection) {
      var sectionName  = opts.section.trim().toLowerCase()
      var sectionStart = -1
      var sectionLevel = 0
      for (var i = 0; i < rawLines.length; i++) {
        var sm = /^(#{1,6})\s+(.+)/.exec(rawLines[i])
        if (sm && sm[2].trim().toLowerCase().indexOf(sectionName) >= 0) {
          sectionStart = i; sectionLevel = sm[1].length; break
        }
      }
      if (sectionStart < 0) return { ok: false, error: "section not found: " + opts.section }
      var sectionEnd = rawLines.length
      for (var j = sectionStart + 1; j < rawLines.length; j++) {
        var em = /^(#{1,6})\s+/.exec(rawLines[j])
        if (em && em[1].length <= sectionLevel) { sectionEnd = j; break }
      }
      resultLines = rawLines.slice(0, sectionStart + 1).concat(newLines).concat(rawLines.slice(sectionEnd))
    } else if (doInsert) {
      var insertAt = Math.max(0, Math.min(opts.lineInsert - 1, rawLines.length))
      resultLines  = rawLines.slice(0, insertAt).concat(newLines).concat(rawLines.slice(insertAt))
    } else {
      var replStart = isNumber(opts.lineStart) && opts.lineStart > 0 ? opts.lineStart - 1 : 0
      var replEnd   = isNumber(opts.lineEnd)   && opts.lineEnd   > 0 ? opts.lineEnd        : replStart + 1
      replEnd       = Math.min(replEnd, rawLines.length)
      resultLines   = rawLines.slice(0, replStart).concat(newLines).concat(rawLines.slice(replEnd))
    }

    var fullRaw   = resultLines.join("\n")
    var reparsed  = this.parseFrontmatter(fullRaw)
    var updatedMeta = (isObject(reparsed.meta) && Object.keys(reparsed.meta).length > 0)
      ? reparsed.meta : (isObject(existing.meta) ? existing.meta : {})
    if (!updatedMeta.created && isObject(existing.meta) && existing.meta.created) updatedMeta.created = existing.meta.created
    updatedMeta.updated = now
    updatedMeta.timestamp = now
    if (!isString(updatedMeta.type) || updatedMeta.type.trim().length === 0) updatedMeta.type = "concept"

    try {
      var updatedRaw = this._serializeFrontmatter(updatedMeta, reparsed.body)
      this._backend.write(path, updatedRaw)
      this._invalidateReadCache()
      this._updatePageIndexes(path, updatedRaw, this.parseFrontmatter(updatedRaw))
      this._logWrite(path, updatedMeta)
      return { ok: true, path: path }
    } catch(e) {
      return { ok: false, error: __miniAErrMsg(e) }
    }
  }

  // Full-page write (existing behavior)
  var meta, bodyText, parsedRaw
  if (isUnDef(body) && isString(metaOrRaw)) {
    parsedRaw = this.parseFrontmatter(metaOrRaw)
    meta      = isObject(parsedRaw.meta) ? parsedRaw.meta : {}
    bodyText  = parsedRaw.body
  } else {
    meta     = isObject(metaOrRaw) ? metaOrRaw : {}
    bodyText = isString(body) ? body : ""
  }

  var existingPage = this.read(path)
  if (!meta.created) {
    meta.created = (isObject(existingPage) && isObject(existingPage.meta) && existingPage.meta.created) ? existingPage.meta.created : now
  }
  meta.updated = now
  meta.timestamp = now
  if (!isString(meta.type) || meta.type.trim().length === 0) meta.type = "concept"

  if (!isString(meta.title) || meta.title.trim().length === 0) {
    if (isObject(existingPage) && isObject(existingPage.meta) && isString(existingPage.meta.title) && existingPage.meta.title.trim().length > 0) {
      meta.title = existingPage.meta.title.trim()
    } else {
      meta.title = path.replace(/\.md$/, "").replace(/[-_/]/g, " ")
    }
  }

  try {
    var content = this._serializeFrontmatter(meta, bodyText)
    this._backend.write(path, content)
    this._invalidateReadCache()
    this._updatePageIndexes(path, content, this.parseFrontmatter(content))
    this._logWrite(path, meta)
    return { ok: true, path: path }
  } catch(e) {
    return { ok: false, error: __miniAErrMsg(e) }
  }
}

// _logWrite: internal helper — appends to log.md without triggering search reindex
MiniAWikiManager.prototype._logWrite = function(path, meta) {
  var SKIP = ["AGENTS.md", "log.md"]
  if (SKIP.indexOf(path) >= 0 || path === "index.md" || path.endsWith("/index.md")) return
  try { this.appendLog("write", isObject(meta) && isString(meta.title) ? meta.title : path, path) } catch(e) {}
}

MiniAWikiManager.prototype.delete = function(path) {
  if (this._access !== "rw") return { ok: false, error: "wiki is read-only (wikiaccess=ro)" }
  if (!isString(path) || path.trim().length === 0) return { ok: false, error: "path is required" }
  if (path.trim().startsWith("@")) return { ok: false, error: "mounted wikis are read-only; cannot delete " + path.trim() }
  try {
    path = __miniAWikiNormalizePath(path, { requireMarkdown: true })
  } catch(e) {
    return { ok: false, error: __miniAErrMsg(e) }
  }

  if (path === "AGENTS.md") return { ok: false, error: "cannot delete AGENTS.md (protected)" }
  if (path === "log.md") return { ok: false, error: "cannot delete log.md (protected)" }
  if (this._isHiddenPath(path)) return { ok: false, error: "cannot delete hidden wiki index files" }

  try {
    this._backend.delete(path)
    this._invalidateReadCache()
    this._removePageIndexes(path)
    try { this.appendLog("delete", path, path) } catch(le) {}
    return { ok: true, path: path }
  } catch(e) {
    return { ok: false, error: __miniAErrMsg(e) }
  }
}

// _snippetFromContent: finds the first line of an indexed document matching pattern and
// returns it as a scan-style snippet, so index-backed results are as usable as scan results.
MiniAWikiManager.prototype._snippetFromContent = function(content, pattern, contextN) {
  var empty = { line: 1, snippet: "", contextBefore: [], contextAfter: [] }
  if (!isString(content) || content.length === 0) return empty
  var lines = content.split(/\r?\n/)
  for (var i = 0; i < lines.length; i++) {
    pattern.lastIndex = 0
    var m = pattern.exec(lines[i])
    if (!m) continue
    var snippet = lines[i].substring(Math.max(0, m.index - 60), m.index + 120).trim()
    if (snippet.length === 0) snippet = lines[i].substring(0, 180).trim()
    var ctx = isNumber(contextN) && contextN > 0 ? contextN : 0
    pattern.lastIndex = 0   // never leave the shared regex advanced for the caller
    return {
      line         : i + 1,
      snippet      : snippet,
      contextBefore: ctx > 0 ? lines.slice(Math.max(0, i - ctx), i) : [],
      contextAfter : ctx > 0 ? lines.slice(i + 1, Math.min(lines.length, i + 1 + ctx)) : []
    }
  }
  // matched by the analyzer but not by the literal pattern (stemming, frontmatter, etc.)
  var firstBody = lines.filter(function(l) { return String(l).trim().length > 0 })[0] || ""
  empty.snippet = String(firstBody).substring(0, 180).trim()
  return empty
}

// Keep Lucene result fields together at the adapter boundary. `score` is the
// native Lucene relevance score; graph/recentness ranking can consume it later
// without changing the Lucene index adapter or the public result shape again.
MiniAWikiManager.prototype._resultFromLuceneHit = function(hit, compact, pattern, contextN) {
  var hitPath = hit.id || (isMap(hit.payload) ? hit.payload.path : __)
  var hitTitle = isMap(hit.payload) && isString(hit.payload.title) ? hit.payload.title : (hit.id || "")
  var result
  if (compact) {
    result = { path: hitPath, title: hitTitle, description: "" }
  } else {
    // extract a real matching line out of the stored content instead of echoing the query
    var loc = this._snippetFromContent(hit.content, pattern, contextN)
    result = { path: hitPath, title: hitTitle, line: isNumber(hit.line) ? hit.line : loc.line, snippet: loc.snippet }
    if (contextN > 0) {
      result.contextBefore = loc.contextBefore
      result.contextAfter  = loc.contextAfter
    }
  }
  // Do not manufacture a score: only expose a finite score supplied by Lucene.
  if (isDef(hit.score) && hit.score != null && isFinite(Number(hit.score))) result.score = Number(hit.score)
  return result
}

// ── Scan-fallback read cache & budget ──────────────────────────────────────────
// Both exist for the same reason: search()'s scan-fallback path (forceScan/regex/scoped
// path, or an unavailable index) reads pages one at a time via backend.read() — cheap for
// local fs, but each call is a real network round-trip for s3/http backends, with only a
// per-request timeout (wikihttptimeout) and no cap on the total number/duration of reads.

MiniAWikiManager.prototype._ensureReadCache = function() {
  if (isObject(this._readCache)) return this._readCache
  var self = this
  var ttl = isNumber(Number(this._config.wikisearchcachettlms)) && Number(this._config.wikisearchcachettlms) > 0
    ? Number(this._config.wikisearchcachettlms) : 15000
  var maxSize = isNumber(Number(this._config.wikisearchcachemaxsize)) && Number(this._config.wikisearchcachemaxsize) > 0
    ? Number(this._config.wikisearchcachemaxsize) : 500
  // process-global $cache registry keyed by name: the identity hash is only for
  // debuggability, this._instanceNonce (set once in configure()) is what actually keeps
  // two managers from colliding on the same cache/loader closure.
  var name = "miniawikiread_" + sha1(this._getBackendIdentity()).substring(0, 8) + "_" + this._instanceNonce
  // $cache's "cache" channel type wraps the key it hands to .fn() as {key: <rawKey>} —
  // confirmed empirically (jstack-style probing, not documented), so the loader must
  // unwrap it back to a plain path.
  var c = $cache(name).ttl(ttl).maxSize(maxSize).fn(function(k) {
    return self._backend.read(isMap(k) && isString(k.key) ? k.key : k)
  }).create()
  this._readCache = c
  return c
}

// cacheEnabledFor: default the read cache on only for backends where each read is a
// real network round-trip (s3/http/es) — for fs/archive it would just add up to
// wikisearchcachettlms of staleness for pages edited outside this manager with no
// latency benefit to justify it. wikisearchcache, if explicitly set, always wins.
MiniAWikiManager.prototype._cacheEnabledFor = function() {
  // isDef/toBoolean, not === true/false: config can arrive as a CLI-supplied string
  // ("false"), same as wikisearchparallel's toBoolean() check elsewhere in this file.
  if (isDef(this._config.wikisearchcache)) return toBoolean(this._config.wikisearchcache) === true
  return this._backendType === "s3" || this._backendType === "http" || this._backendType === "es"
}

MiniAWikiManager.prototype._cachedBackendRead = function(path) {
  if (!this._cacheEnabledFor()) return this._backend.read(path)
  // .set()/.unset() on a "cache"-type channel do not reliably invalidate .get() (verified
  // empirically — neither raw nor {key:...}-wrapped forms round-trip); only destroying and
  // recreating the whole channel does, which is what write()/delete() do below instead.
  var entry = this._ensureReadCache().get(path)
  return isMap(entry) ? entry.result : entry
}

// _invalidateReadCache: the only proven-reliable way to invalidate this cache type is to
// destroy the whole channel and let the next _cachedBackendRead() call lazily recreate
// it — coarser than per-key invalidation, but write()/delete() are rare relative to
// reads, and per-key .set()/.unset() do not actually work against .get()'s cache state.
MiniAWikiManager.prototype._invalidateReadCache = function() {
  if (!isObject(this._readCache)) return
  try { this._readCache.destroy() } catch(e) {}
  this._readCache = __
}

MiniAWikiManager.prototype._scanBudgetExceeded = function(scanState) {
  return scanState.scanned >= scanState.budget || new Date().getTime() >= scanState.deadline
}

MiniAWikiManager.prototype.search = function(query, options) {
  if (!isString(query) || query.trim().length === 0) return []
  this._maybeRefreshArtifactBundle()
  var opts       = isObject(options) ? options : {}
  var limit      = isNumber(opts.limit)        && opts.limit        > 0 ? opts.limit        : 20
  var contextN   = isNumber(opts.contextLines) && opts.contextLines > 0 ? Math.min(opts.contextLines, 10) : 0
  // compact=true by default: returns [{path,title,description}] per page (no per-line snippets)
  // compact=false (or contextLines>0): returns full per-line results with snippets
  var compact    = opts.compact !== false && contextN === 0
  var caseSens   = opts.caseSensitive === true
  var forceScan  = opts.forceScan === true
  var searchIn   = isString(opts.searchIn) && opts.searchIn.toLowerCase() === "body" ? "body" : "all"
  var scopedPath = ""
  if (isString(opts.path) && opts.path.trim().length > 0) {
    try { scopedPath = __miniAWikiNormalizePath(opts.path, { requireMarkdown: true }) } catch(e) { return [] }
  }

  var q = query.trim()
  var pattern
  try {
    var re = opts.regex === true ? q : q.replace(/([.*+?^${}()|[\]\\])/g, "\\$1")
    pattern = new RegExp(re, caseSens ? "g" : "gi")
  } catch(e) {
    this._logFn("warn", "Invalid regex '" + q + "', falling back to literal: " + e)
    pattern = new RegExp(q.replace(/([.*+?^${}()|[\]\\])/g, "\\$1"), caseSens ? "g" : "gi")
  }

  var self = this
  var pages = []
  if (scopedPath.length > 0) {
    pages = [scopedPath]
  }
  var results = []

  // Shared count+time budget for the scan-fallback path, propagated through mount
  // fan-out (not reset per mount) via opts.__scanState. Constructed unconditionally,
  // before the Lucene branch, because a mount can fall back to scanning even when the
  // root call hit its own index — the shared budget must be live in both branches.
  var scanState = isObject(opts.__scanState) && isNumber(opts.__scanState.budget) && isNumber(opts.__scanState.deadline)
    ? opts.__scanState
    : {
        scanned: 0,
        budget: isNumber(Number(this._config.wikisearchscanbudget)) && Number(this._config.wikisearchscanbudget) > 0
          ? Number(this._config.wikisearchscanbudget) : 1000,
        deadline: new Date().getTime() + (isNumber(Number(this._config.wikisearchscanmaxms)) && Number(this._config.wikisearchscanmaxms) > 0
          ? Number(this._config.wikisearchscanmaxms) : 15000),
        truncated: false
      }

  var searchIdx = this._ensureSearchIndex()
  var useIndex  = searchIdx.available() && (searchIdx.writable || searchIdx.exists())
  if (!forceScan && !opts.regex && scopedPath.length === 0 && useIndex) {
    try {
      var luceneQuery = q.replace(/(&&|\|\||[+\-!(){}\[\]^"~*?:\\/])/g, "\\$1")
      var luceneHits = searchIdx.query(luceneQuery, limit)
      if (isArray(luceneHits) && luceneHits.length > 0) {
        var self = this
        var validHits = luceneHits.map(function(h) {
          return self._resultFromLuceneHit(h, compact, pattern, contextN)
        }).map(function(r) {
          if (!compact) return r
          var hitMeta = self._metaFor(r.path)
          r.description = isMap(hitMeta) && isString(hitMeta.description) ? hitMeta.description : ""
          return r
        }).filter(function(r) { return isString(r.path) && r.path.length > 0 && !self._isSearchExcludedPath(r.path) })
        if (validHits.length > 0) {
          // Fan out to mounts after primary results
          var mountResults = this._searchMounts(query, opts, compact, limit - validHits.length, scanState)
          var luceneOut = this._withGraphHints(validHits.concat(mountResults), opts)
          if (scanState.truncated === true) { luceneOut.truncated = true; luceneOut.scanned = scanState.scanned; luceneOut.scanBudget = scanState.budget }
          return luceneOut
        }
      }
    } catch(le) {
      this._logFn("warn", "Lucene search fallback to scan: " + __miniAErrMsg(le))
    }
  }

  pages = pages.length > 0 ? pages : this.list("")
  pages = pages.filter(function(p) { return !self._isSearchExcludedPath(p) })

  var seenPaths = {}  // for compact dedup

  if (toBoolean(this._config.wikisearchparallel) === true) {
    // PARALLEL SCAN CAVEAT (wikisearchparallel, default false): this pForEach call submits
    // work to the shared ForkJoinPool (__getThreadPool(), non-virtual) — the same pool an
    // earlier pForEach-based read path used before it was reverted to serial reads after a
    // deadlock reproduced only on the SECOND consecutive full `ojob tests/wiki.yaml` run in
    // the same JVM (see the comment above _readAllPageDocs, ~line 797). That incident's root
    // cause was never conclusively isolated: a jstack capture showed a stuck worker from an
    // earlier pForEach batch starving a later listFilesRecursive call — but listFilesRecursive
    // actually runs on a SEPARATE virtual-thread executor ($doV / __getThreadPool(true)), not
    // the pool pForEach uses, so the literal "same pool" explanation does not cleanly match the
    // runtime. A companion fix is proposed upstream (see openaf/PFOREACH_PLAN.md: pForEach's
    // completion wait is currently unbounded in two places, and cancellation on timeout is
    // best-effort). Until that lands, treat this as an unconfirmed-root-cause, empirically
    // reproducible failure class — NOT something this design "fixes" or "avoids." This is why
    // wikisearchparallel defaults to false, and why any locking here uses only bounded
    // tryLock()/atomic primitives, never a blocking lock. Before flipping the default, or
    // trusting this path in a long-lived process, run the full test suite twice in one JVM
    // (see tests/wiki.yaml verification notes) and inspect a jstack after the second run.
    var scanCounter   = $atomic(0)   // pages read, for the budget
    var hitsCounter   = $atomic(0)   // results contributed, for early stop near `limit`
    var localBudget   = scanState.budget - scanState.scanned
    var localDeadline = scanState.deadline
    // workers only ever read scanState.budget/deadline (captured above as immutable
    // locals) and never write to scanState itself — only this single-threaded merge
    // phase, after pForEach returns, updates scanState.scanned/.truncated
    var perPageResults = pForEach(pages, function(p) {
      if (scanCounter.get() >= localBudget || new Date().getTime() >= localDeadline) return __
      if (hitsCounter.get() >= limit) return __
      scanCounter.inc()
      var raw = self._cachedBackendRead(p)
      if (!isString(raw)) return __
      var parsed = self.parseFrontmatter(raw)
      // per-worker RegExp clone: pattern.lastIndex is stateful and racy if shared, and
      // pattern.flags is unreliable under Rhino, so rebuild explicitly from caseSens
      var localPattern = new RegExp(pattern.source, caseSens ? "g" : "gi")
      var hit = self._scanPageForMatches(p, raw, parsed, localPattern, searchIn, compact, contextN)
      if (!hit) return __
      if (compact) { hitsCounter.inc(); return { path: p, raw: raw, parsed: parsed, hit: hit } }
      hitsCounter.getAdd(hit.length)
      return { path: p, hit: hit }
    }, function(perr) { self._logFn("warn", "Parallel wiki scan read failed: " + __miniAErrMsg(perr)) }, false)

    // single-threaded merge, preserves original page order — no lock needed here since
    // nothing else runs concurrently with this loop
    for (var pi = 0; pi < perPageResults.length && results.length < limit; pi++) {
      var pr = perPageResults[pi]
      if (!pr) continue
      if (compact) {
        if (!seenPaths[pr.path]) {
          seenPaths[pr.path] = true
          var cm = this._metaFor(pr.path, pr.raw, pr.parsed)
          results.push({ path: pr.path, title: pr.hit.title, description: isMap(cm) && isString(cm.description) ? cm.description : "" })
        }
      } else {
        for (var sj = 0; sj < pr.hit.length && results.length < limit; sj++) results.push(pr.hit[sj])
      }
    }
    scanState.scanned += scanCounter.get()
    if (scanCounter.get() >= localBudget || new Date().getTime() >= localDeadline) scanState.truncated = true
  } else {
    for (var i = 0; i < pages.length && results.length < limit; i++) {
      if (this._scanBudgetExceeded(scanState)) { scanState.truncated = true; break }
      scanState.scanned++
      var raw = this._cachedBackendRead(pages[i])
      if (!isString(raw)) continue
      var parsed = this.parseFrontmatter(raw)
      var hit = this._scanPageForMatches(pages[i], raw, parsed, pattern, searchIn, compact, contextN)
      if (!hit) continue

      if (compact) {
        if (!seenPaths[pages[i]]) {
          seenPaths[pages[i]] = true
          var cachedMeta = this._metaFor(pages[i], raw, parsed)
          results.push({
            path: pages[i],
            title: hit.title,
            description: isMap(cachedMeta) && isString(cachedMeta.description) ? cachedMeta.description : ""
          })
        }
      } else {
        for (var si = 0; si < hit.length && results.length < limit; si++) results.push(hit[si])
      }
    }
  }

  var mountResults = this._searchMounts(query, opts, compact, limit - results.length, scanState)
  var out = this._withGraphHints(results.concat(mountResults), opts)
  if (scanState.truncated === true) { out.truncated = true; out.scanned = scanState.scanned; out.scanBudget = scanState.budget }
  return out
}

// _scanPageForMatches: shared per-page match logic used by both the sequential and
// (wikisearchparallel) parallel scan paths — kept in exactly one place so they can't
// silently diverge (see testSearchParallelMatchesSequentialResults). Returns, for
// compact mode, {path,title} on the first matching line (or __ if none); for non-compact
// mode, the full array of per-line snippet results (or __ if none). Non-compact mode
// intentionally scans every matching line in the page rather than stopping at the
// caller's overall `limit` mid-page — the caller truncates on push — trading a little
// wasted scanning on the last matched page for one shared implementation.
MiniAWikiManager.prototype._scanPageForMatches = function(path, raw, parsed, localPattern, searchIn, compact, contextN) {
  var title = isString(parsed.meta.title) ? parsed.meta.title : path
  var lines = raw.split("\n")
  var bodyStartLine = 0
  if (searchIn === "body" && raw.startsWith("---\n")) {
    var fmEnd = raw.indexOf("\n---\n", 4)
    if (fmEnd >= 0) bodyStartLine = raw.substring(0, fmEnd + 5).split("\n").length - 1
  }
  if (compact) {
    for (var li = bodyStartLine; li < lines.length; li++) {
      localPattern.lastIndex = 0
      if (localPattern.exec(lines[li])) return { path: path, title: title }
    }
    return __
  }
  var snippetResults = []
  for (var lj = bodyStartLine; lj < lines.length; lj++) {
    localPattern.lastIndex = 0
    var m = localPattern.exec(lines[lj])
    if (!m) continue
    var matchIdx = m.index
    var snippet  = lines[lj].substring(Math.max(0, matchIdx - 60), matchIdx + 120).replace(/\n/g, " ").trim()
    if (snippet.length === 0) snippet = lines[lj].substring(0, 180).trim()
    var result = { path: path, title: title, line: lj + 1, snippet: snippet }
    if (contextN > 0) {
      result.contextBefore = lines.slice(Math.max(0, lj - contextN), lj)
      result.contextAfter  = lines.slice(lj + 1, Math.min(lines.length, lj + 1 + contextN))
    }
    snippetResults.push(result)
  }
  return snippetResults.length > 0 ? snippetResults : __
}

// _searchMounts: fan search out to all mounts, prefix paths with @name/. The scanState
// budget is shared across the whole fan-out, not reset per mount.
MiniAWikiManager.prototype._searchMounts = function(query, opts, compact, remaining, scanState) {
  if (remaining <= 0) return []
  var mounts = isArray(this._mounts) ? this._mounts : []
  if (mounts.length === 0) return []
  if (isObject(scanState) && this._scanBudgetExceeded(scanState)) { scanState.truncated = true; return [] }
  var combined = []
  var mountOpts = merge({}, opts)
  mountOpts.limit = remaining
  // assigned AFTER merge(), not folded into it — relying on merge()'s recursive clone to
  // pass this object through by reference for this shape is unverified and fragile
  mountOpts.__scanState = scanState
  for (var mi = 0; mi < mounts.length && combined.length < remaining; mi++) {
    if (isObject(scanState) && this._scanBudgetExceeded(scanState)) { scanState.truncated = true; break }
    var m = mounts[mi]
    try {
      var hits = m.manager.search(query, mountOpts)
      hits.forEach(function(h) {
        var prefixed = merge({}, h)
        prefixed.path = "@" + m.name + "/" + h.path
        prefixed.mount = m.name
        combined.push(prefixed)
      })
    } catch(e) {
      this._logFn("warn", "Mount search failed for @" + m.name + ": " + __miniAErrMsg(e))
    }
  }
  return combined
}

MiniAWikiManager.prototype.tree = function(prefix, depth) {
  var mountPrefix = isString(prefix) ? prefix.trim() : ""
  if (mountPrefix.startsWith("@")) {
    var mountResult = this._resolveMountPath(mountPrefix)
    if (mountResult && mountResult.mount) return mountResult.mount.manager.tree(mountResult.localPath, depth)
    return { path: mountPrefix, error: "mount not found: " + (mountResult ? mountResult.name : mountPrefix), pages: [], sections: [] }
  }
  var sectionPrefix = ""
  try { sectionPrefix = this._normalizeSectionPath(prefix) } catch(e) { sectionPrefix = "" }
  var maxDepth = isNumber(depth) && depth >= 0 ? depth : 3
  var pages = this.list(sectionPrefix).filter(function(p) { return isString(p) && p.endsWith(".md") })
  var self = this
  var nodeBudget = isNumber(this._config.wikitreebudget) && this._config.wikitreebudget > 0 ? this._config.wikitreebudget : 5000
  var nodeCount = 0
  var truncated = false

  var buildNode = function(dir, level) {
    if (nodeCount >= nodeBudget) {
      truncated = true
      return { path: dir, name: dir.length === 0 ? "" : dir.replace(/\/$/, "").replace(/.*\//, ""), index: { path: dir + "index.md", exists: self._backend.exists(dir + "index.md") }, page_count: 0, direct_page_count: 0, child_section_count: 0, pages: [], sections: [], truncated: true }
    }
    nodeCount++
    var indexPath = dir + "index.md"
    var directPages = []
    var childMap = {}
    var totalPages = 0

    pages.forEach(function(p) {
      if (p.indexOf(dir) !== 0) return
      var rest = p.substring(dir.length)
      if (rest.length === 0) return
      totalPages++
      if (rest.indexOf("/") < 0) {
        if (rest !== "index.md") directPages.push({
          path: p,
          title: self._pageTitle(p)
        })
      } else {
        var childName = rest.substring(0, rest.indexOf("/"))
        childMap[childName] = dir + childName + "/"
      }
    })

    directPages.sort(function(a, b) { return a.path.localeCompare(b.path) })
    var childNames = Object.keys(childMap).sort()
    var sections = []
    if (level < maxDepth) {
      childNames.forEach(function(name) { sections.push(buildNode(childMap[name], level + 1)) })
    } else {
      childNames.forEach(function(name) {
        var childDir = childMap[name]
        var childIndex = childDir + "index.md"
        var count = 0
        pages.forEach(function(p) { if (p.indexOf(childDir) === 0) count++ })
        sections.push({
          path: childDir,
          name: name,
          index: { path: childIndex, exists: self._backend.exists(childIndex) },
          page_count: count,
          direct_page_count: 0,
          child_section_count: 0,
          pages: [],
          sections: []
        })
      })
    }

    var idx = { path: indexPath, exists: self._backend.exists(indexPath) }
    if (idx.exists) {
      var idxPage = self.read(indexPath)
      if (isObject(idxPage) && isObject(idxPage.meta)) {
        idx.title = isString(idxPage.meta.title) ? idxPage.meta.title : indexPath
        idx.updated = idxPage.meta.updated
      }
    }

    return {
      path: dir,
      name: dir.length === 0 ? "" : dir.replace(/\/$/, "").replace(/.*\//, ""),
      index: idx,
      page_count: totalPages,
      direct_page_count: directPages.length,
      child_section_count: childNames.length,
      pages: directPages,
      sections: sections
    }
  }

  var root = buildNode(sectionPrefix, 0)
  root.prefix = sectionPrefix
  root.depth = maxDepth
  root.truncated = truncated
  return root
}

MiniAWikiManager.prototype.browse = function(path) {
  // Mount routing: @name/... browse
  var trimmedPath = isString(path) ? path.trim() : ""
  if (trimmedPath.startsWith("@")) {
    var mres = this._resolveMountPath(trimmedPath.endsWith("/") ? trimmedPath + "_dummy.md" : trimmedPath)
    if (mres && mres.mount) return mres.mount.manager.browse(mres.localPath)
    return { path: trimmedPath, error: "mount not found: " + (mres ? mres.name : trimmedPath) }
  }

  var section = ""
  try { section = this._normalizeSectionPath(path) } catch(e) { section = "" }
  var nearest = section
  while (nearest.length > 0 && !this._backend.exists(nearest + "index.md")) {
    nearest = nearest.replace(/\/$/, "")
    nearest = nearest.indexOf("/") >= 0 ? nearest.substring(0, nearest.lastIndexOf("/") + 1) : ""
  }
  if (nearest.length === 0 && this._backend.exists("index.md")) nearest = ""
  var node = this.tree(section, 1)
  var indexPath = nearest + "index.md"
  var suggested = []
  if (this._backend.exists(indexPath)) suggested.push(indexPath)
  node.pages.slice(0, 5).forEach(function(p) { suggested.push(p.path) })
  node.sections.slice(0, 5).forEach(function(s) {
    if (isObject(s.index) && s.index.exists) suggested.push(s.index.path)
  })

  // Append mounts as virtual sections at the root
  var mountSections = []
  if (section === "") {
    var mounts = isArray(this._mounts) ? this._mounts : []
    mounts.forEach(function(m) {
      var count = 0; try { count = m.manager._safeListPages("").length } catch(e) {}
      mountSections.push({ path: "@" + m.name + "/", name: "@" + m.name, mount: true, page_count: count,
        index: { path: "@" + m.name + "/index.md", exists: true } })
    })
  }

  return {
    path: section,
    nearest_index: {
      path: indexPath,
      exists: this._backend.exists(indexPath),
      title: this._backend.exists(indexPath) ? this._pageTitle(indexPath) : __
    },
    child_sections: node.sections.map(function(s) {
      return { path: s.path, name: s.name, index: s.index, page_count: s.page_count }
    }).concat(mountSections),
    direct_pages: node.pages,
    suggested_next_reads: suggested
  }
}

MiniAWikiManager.prototype.backlinks = function(path) {
  var target
  try { target = __miniAWikiNormalizePath(path, { requireMarkdown: true }) } catch(e) { return { target: path, count: 0, backlinks: [] } }
  var self = this
  var results = []
  this.list("").forEach(function(p) {
    var raw = self._backend.read(p)
    if (!isString(raw)) return
    var parsed = self.parseFrontmatter(raw)
    var entries = self._extractLinkEntries(parsed.body)
    var matches = []
    entries.forEach(function(entry) {
      var resolved = entry.type === "wiki" ? entry.raw : self.resolveLink(p, entry.raw)
      if (resolved === target) matches.push({ target: entry.raw, resolved: resolved })
    })
    if (matches.length > 0) {
      results.push({
        path: p,
        title: isString(parsed.meta.title) ? parsed.meta.title : p,
        links: matches
      })
    }
  })
  return { target: target, count: results.length, backlinks: results }
}

MiniAWikiManager.prototype._rewriteLinksForMove = function(raw, sourcePage, fromPath, toPath, rebaseOnly) {
  if (!isString(raw)) return raw
  var self = this
  var body = raw
  body = body.replace(/\[([^\]]*)\]\(([^)]+\.md([^)]*)?)\)/g, function(full, label, target) {
    var parts = target.split("#")
    var cleanTarget = parts[0].trim()
    var anchor = parts.length > 1 ? "#" + parts.slice(1).join("#") : ""
    if (/^https?:\/\//i.test(cleanTarget) || cleanTarget.startsWith("/")) return full
    var resolved = self.resolveLink(sourcePage, cleanTarget)
    if (!isString(resolved)) return full
    if (resolved === fromPath) resolved = toPath
    else if (rebaseOnly !== true) return full
    return "[" + label + "](" + self._relativePath(rebaseOnly === true ? toPath : sourcePage, resolved) + anchor + ")"
  })
  body = body.replace(/\[\[([^\]]+)\]\]/g, function(full, label) {
    var target = self._wikiLinkTarget(label)
    if (target !== fromPath) return full
    var pipe = String(label).indexOf("|")
    var text = pipe >= 0 ? String(label).substring(pipe + 1).trim() : label
    return "[" + text + "](" + self._relativePath(rebaseOnly === true ? toPath : sourcePage, toPath) + ")"
  })
  return body
}

MiniAWikiManager.prototype.move = function(from, to, options) {
  if (this._access !== "rw") return { ok: false, error: "wiki is read-only (wikiaccess=ro)" }
  if (isString(from) && from.trim().startsWith("@")) return { ok: false, error: "mounted wikis are read-only; cannot move " + from.trim() }
  if (isString(to)   && to.trim().startsWith("@"))   return { ok: false, error: "mounted wikis are read-only; cannot move to " + to.trim() }
  var opts = isObject(options) ? options : {}
  var fromPath, toPath
  try {
    fromPath = __miniAWikiNormalizePath(from, { requireMarkdown: true })
    toPath = __miniAWikiNormalizePath(to, { requireMarkdown: true })
  } catch(e) {
    return { ok: false, error: __miniAErrMsg(e) }
  }
  if (fromPath === "AGENTS.md" || toPath === "AGENTS.md") return { ok: false, error: "cannot move AGENTS.md (protected)" }
  if (fromPath === "log.md"    || toPath === "log.md")    return { ok: false, error: "cannot move log.md (protected)" }
  if (this._isHiddenPath(fromPath) || this._isHiddenPath(toPath)) return { ok: false, error: "cannot move hidden wiki index files" }
  if (!this._backend.exists(fromPath)) return { ok: false, error: "page not found: " + fromPath }
  if (fromPath === toPath) return { ok: true, from: fromPath, to: toPath, pages_moved: 0, pages_changed: 0, redirect_created: false }
  if (this._backend.exists(toPath) && opts.overwrite !== true) return { ok: false, error: "target exists: " + toPath }

  var raw = this._backend.read(fromPath)
  if (!isString(raw)) return { ok: false, error: "page not readable: " + fromPath }
  var movedRaw = this._rewriteLinksForMove(raw, fromPath, fromPath, toPath, true)
  var writeMoved = this.write(toPath, movedRaw)
  if (!isObject(writeMoved) || writeMoved.ok !== true) return writeMoved

  var pagesChanged = []
  var self = this
  this.list("").forEach(function(p) {
    if (p === fromPath || p === toPath) return
    var pageRaw = self._backend.read(p)
    if (!isString(pageRaw)) return
    var rewritten = self._rewriteLinksForMove(pageRaw, p, fromPath, toPath, false)
    if (rewritten !== pageRaw) {
      var res = self.write(p, rewritten)
      if (isObject(res) && res.ok === true) pagesChanged.push(p)
    }
  })

  var redirectCreated = false
  if (opts.leaveRedirect === true || opts.redirect === true || opts.stub === true) {
    var oldPage = this.parseFrontmatter(raw)
    var meta = isObject(oldPage.meta) ? oldPage.meta : {}
    meta.title = isString(meta.title) ? meta.title : fromPath
    meta.superseded_by = toPath
    var rel = this._relativePath(fromPath, toPath)
    var stubBody = "> Superseded - this page moved to [" + toPath + "](" + rel + ").\n"
    var stub = this.write(fromPath, meta, stubBody)
    redirectCreated = isObject(stub) && stub.ok === true
  } else {
    var del = this.delete(fromPath)
    if (!isObject(del) || del.ok !== true) return del
  }

  try { this.appendLog("move", fromPath + " → " + toPath, toPath) } catch(le) {}
  return {
    ok: true,
    from: fromPath,
    to: toPath,
    pages_moved: 1,
    pages_changed: pagesChanged.length,
    changed_pages: pagesChanged,
    redirect_created: redirectCreated
  }
}

// ── Lint ──────────────────────────────────────────────────────────────────────

MiniAWikiManager.prototype.lint = function(memoryManager, options) {
  var opts      = isObject(options) ? options : {}
  var staleDays = isNumber(opts.staleDays) ? opts.staleDays : 90
  var LINT_SKIP = ["AGENTS.md", "log.md"]
  var pages     = this.list("").filter(p => LINT_SKIP.indexOf(p) < 0) // skip policy/journal docs
  var issues    = []
  var pageData  = {}   // path -> { meta, body, linkEntries }
  var incomingCount = {}

  pages.forEach(function(p) { incomingCount[p] = 0 })

  // Pass 1: parse all pages and collect link entries
  var self = this
  pages.forEach(function(p) {
    var raw = self._backend.read(p)
    if (!isString(raw)) return
    var parsed = self.parseFrontmatter(raw)
    var linkEntries = self._extractLinkEntries(parsed.body)
    pageData[p] = { meta: parsed.meta, body: parsed.body, linkEntries: linkEntries }
  })

  // Pass 2: run checks
  var nowMs = Date.now()
  pages.forEach(function(p) {
    var pd = pageData[p]
    if (!pd) return

    // Check 1: Broken internal links
    // md links are page-relative; wiki-style links are always root-relative; @name/... are cross-wiki
    pd.linkEntries.forEach(function(entry) {
      var bits = String(entry.raw).split("#"), linkPath = bits.shift(), anchor = bits.join("#")
      var resolved = linkPath.length === 0 ? p : (entry.type === "wiki" ? linkPath : self.resolveLink(p, linkPath))
      var nonCanonical = false
      if (resolved === null && linkPath.length > 0 && entry.type === "md") {
        var withMd = self.resolveLink(p, linkPath + ".md")
        var withIndex = self.resolveLink(p, linkPath.replace(/\/$/, "") + "/index.md")
        if (isString(withMd) && self._backend.exists(withMd)) { resolved = withMd; nonCanonical = true }
        else if (isString(withIndex) && self._backend.exists(withIndex)) { resolved = withIndex; nonCanonical = true }
        else resolved = withMd
      }
      if (resolved === null) return  // external URL, absolute path, or escapes root — not wiki-internal
      if (nonCanonical) {
        issues.push({ severity: "error", type: "broken_link", page: p, target: entry.raw, resolved: resolved, detail: "non-canonical internal path", linkType: entry.type })
        return
      }
      // Cross-wiki mount link
      if (isString(resolved) && resolved.startsWith("@")) {
        var mres = self._resolveMountPath(resolved.endsWith(".md") ? resolved : resolved + "/index.md")
        if (!mres || !mres.mount) {
          issues.push({ severity: "info", type: "unresolved_mount_link", page: p, target: entry.raw, mount: mres ? mres.name : resolved, linkType: entry.type })
        }
        return
      }
      var exists = self._backend.exists(resolved)
      if (!exists) {
        issues.push({ severity: "error", type: "broken_link", page: p, target: entry.raw, resolved: resolved, linkType: entry.type })
      } else {
        if (!isNumber(incomingCount[resolved])) incomingCount[resolved] = 0
        incomingCount[resolved]++
        if (anchor.length > 0 && pageData[resolved]) {
          var wanted = anchor.toLowerCase(), anchors = self._markdownHeadings(pageData[resolved].body).map(function(h) { return self._headingAnchor(h.text) })
          if (anchors.indexOf(wanted) < 0) issues.push({ severity: "error", type: "invalid_anchor", page: p, target: entry.raw, resolved: resolved, anchor: anchor, linkType: entry.type })
        }
      }
    })

    // Check 2: Missing front-matter fields
    if (!isString(pd.meta.title) || pd.meta.title.trim().length === 0) {
      issues.push({ severity: "warning", type: "missing_frontmatter", page: p, field: "title" })
    }
    if (!isString(pd.meta.description) || pd.meta.description.trim().length === 0) {
      issues.push({ severity: "info", type: "missing_frontmatter", page: p, field: "description" })
    }
    if (isUnDef(pd.meta.created) || String(pd.meta.created).trim().length === 0) {
      issues.push({ severity: "warning", type: "missing_frontmatter", page: p, field: "created" })
    }
    if (isUnDef(pd.meta.updated) || String(pd.meta.updated).trim().length === 0) {
      issues.push({ severity: "warning", type: "missing_frontmatter", page: p, field: "updated" })
    }
    if ((!isString(pd.meta.type) || pd.meta.type.trim().length === 0) && p !== "index.md" && !p.endsWith("/index.md")) {
      issues.push({ severity: "info", type: "missing_frontmatter", page: p, field: "type" })
    }

    // Check 3: one title-synchronised H1 and a non-skipping hierarchy.
    var headings = self._markdownHeadings(pd.body)
    var h1s = headings.filter(function(h) { return h.level === 1 })
    if (h1s.length === 0) issues.push({ severity: "warning", type: "missing_h1", page: p })
    if (h1s.length > 1) issues.push({ severity: "warning", type: "multiple_h1", page: p, count: h1s.length })
    if (h1s.length > 0 && isString(pd.meta.title) && pd.meta.title.trim().length > 0 && h1s[0].text !== pd.meta.title.trim()) {
      issues.push({ severity: "warning", type: "title_h1_mismatch", page: p, title: pd.meta.title, heading: h1s[0].text })
    }
    for (var hi = 1; hi < headings.length; hi++) {
      if (headings[hi].level > headings[hi - 1].level + 1) {
        issues.push({ severity: "warning", type: "heading_hierarchy", page: p, line: headings[hi].line + 1, from: headings[hi - 1].level, to: headings[hi].level })
      }
    }

    // Check 4: Stale pages
    if (staleDays > 0) {
      var rawAnchor = isDef(pd.meta.updated) ? pd.meta.updated : (isDef(pd.meta.created) ? pd.meta.created : __)
      if (isDef(rawAnchor)) {
        var anchorMs
        try {
          anchorMs = isString(rawAnchor) ? new Date(rawAnchor).getTime() : new Date(String(rawAnchor)).getTime()
        } catch(dateErr) { anchorMs = NaN }
        if (!isNaN(anchorMs)) {
          var ageDays = Math.floor((nowMs - anchorMs) / 86400000)
          if (ageDays > staleDays) {
            issues.push({ severity: "info", type: "stale", page: p, age_days: ageDays })
          }
        }
      }
    }
  })

  // Check 5: Hierarchy/index health
  var folders = { "": true }
  pages.forEach(function(p) {
    var parts = p.split("/")
    if (parts.length <= 1) return
    var accum = ""
    for (var i = 0; i < parts.length - 1; i++) {
      accum += parts[i] + "/"
      folders[accum] = true
    }
  })
  Object.keys(folders).sort().forEach(function(dir) {
    var directPages = []
    var childIndexes = []
    pages.forEach(function(p) {
      if (p.indexOf(dir) !== 0) return
      var rest = p.substring(dir.length)
      if (rest.length === 0) return
      if (rest.indexOf("/") < 0) {
        if (rest !== "index.md") directPages.push(p)
      } else {
        var childIndex = dir + rest.substring(0, rest.indexOf("/")) + "/index.md"
        if (pages.indexOf(childIndex) >= 0 && childIndexes.indexOf(childIndex) < 0) childIndexes.push(childIndex)
      }
    })
    if (directPages.length === 0 && childIndexes.length === 0) return

    var indexPath = dir + "index.md"
    var indexData = pageData[indexPath]
    if (!indexData) {
      issues.push({ severity: "warning", type: "missing_index", section: dir, page: indexPath, direct_pages: directPages.length, child_indexes: childIndexes.length })
      directPages.forEach(function(required) {
        issues.push({ severity: "warning", type: "structural_orphan", section: dir, page: required, parent: indexPath })
      })
      return
    }

    var linked = {}
    indexData.linkEntries.forEach(function(entry) {
      var indexTarget = String(entry.raw).split("#")[0]
      var resolved = entry.type === "wiki" ? indexTarget : self.resolveLink(indexPath, indexTarget)
      if (isString(resolved)) linked[resolved] = true
    })
    directPages.concat(childIndexes).forEach(function(required) {
      if (!linked[required]) {
        issues.push({ severity: "warning", type: "index_missing_links", section: dir, page: indexPath, target: required })
        if (!/\/index\.md$/i.test(required) && required !== "index.md") issues.push({ severity: "warning", type: "structural_orphan", section: dir, page: required, parent: indexPath })
      }
    })

    if (isDef(indexData.meta.updated)) {
      var indexMs = new Date(String(indexData.meta.updated)).getTime()
      if (!isNaN(indexMs)) {
        directPages.concat(childIndexes).forEach(function(child) {
          var childData = pageData[child]
          if (!childData || isUnDef(childData.meta.updated)) return
          var childMs = new Date(String(childData.meta.updated)).getTime()
          if (!isNaN(childMs) && childMs > indexMs) {
            issues.push({ severity: "info", type: "stale_index", section: dir, page: indexPath, newer_child: child })
          }
        })
      }
    }
  })

  // Check 6: Pages represented only by their parent catalogue remain semantic advice.
  pages.forEach(function(p) {
    var name = p.replace(/.*\//, "").toLowerCase()
    if (name === "index.md" || name === "readme.md" || name === "log.md") return
    var parent = self._pageDir(p) + "index.md"
    var parentLinks = pageData[parent] ? pageData[parent].linkEntries.some(function(e) {
      var ep = String(e.raw).split("#")[0]
      return (e.type === "wiki" ? ep : self.resolveLink(parent, ep)) === p
    }) : false
    if (parentLinks && (incomingCount[p] || 0) <= 1) issues.push({ severity: "info", type: "semantic_orphan", page: p, parent: parent })
  })

  // Check 7: Near-duplicate page bodies
  var pageList = Object.keys(pageData)
  for (var i = 0; i < pageList.length; i++) {
    for (var j = i + 1; j < pageList.length; j++) {
      var pa = pageList[i], pb = pageList[j]
      if (pageData[pa] && pageData[pb] &&
          self._isNearDuplicate(pageData[pa].body, pageData[pb].body)) {
        issues.push({ severity: "info", type: "near_duplicate", page: pa, similar: pb })
      }
    }
  }

  // Check 8: Memory cross-check (optional)
  if (isObject(memoryManager) && isFunction(memoryManager.getSectionEntries)) {
    var factSections = ["facts", "decisions"]
    factSections.forEach(function(section) {
      var entries = memoryManager.getSectionEntries(section)
      if (!isArray(entries)) return
      entries.forEach(function(entry) {
        if (!isString(entry.value) || entry.value.length < 20) return
        pages.forEach(function(p) {
          if (!pageData[p]) return
          // Only check body lines that look like factual claims
          pageData[p].body.split("\n").forEach(function(line) {
            if (line.trim().length < 20) return
            if (self._isNearDuplicate(line, entry.value)) {
              var existing = issues.find(function(iss) {
                return iss.type === "memory_conflict" && iss.page === p && iss.memoryId === entry.id
              })
              if (!existing) {
                issues.push({
                  severity     : "warning",
                  type         : "memory_conflict",
                  page         : p,
                  memorySection: section,
                  memoryId     : entry.id,
                  wikiExcerpt  : line.trim().substring(0, 120),
                  memoryValue  : entry.value.substring(0, 120)
                })
              }
            }
          })
        })
      })
    })
  }

  var summary = { pages: pages.length, errors: 0, warnings: 0, info: 0 }
  issues.forEach(function(iss) {
    if (iss.severity === "error")   summary.errors++
    else if (iss.severity === "warning") summary.warnings++
    else summary.info++
  })

  return { summary: summary, issues: issues }
}

// ── appendLog ─────────────────────────────────────────────────────────────────

// appendLog: append-only write to log.md via backend (no search reindex, no self-logging)
MiniAWikiManager.prototype.appendLog = function(op, title, path) {
  if (this._access !== "rw") return
  try {
    var dateStr = new Date().toISOString().substring(0, 10)
    var entry   = "## [" + dateStr + "] " + String(op) + " | " + (isString(title) ? title : path) + " — " + path
    var existing = this._backend.read("log.md")
    var content
    if (isString(existing)) {
      content = existing.replace(/\s+$/, "") + "\n\n" + entry
    } else {
      content = __miniAWikiLogTemplate(new Date().toISOString()) + "\n\n" + entry
    }
    this._backend.write("log.md", content)
  } catch(e) {
    this._logFn("warn", "Failed to append to log.md: " + __miniAErrMsg(e))
  }
}

// ── upgradeAgents ─────────────────────────────────────────────────────────────

// upgradeAgents: safely re-render AGENTS.md to the current template version
// - stock v1 (fingerprint match) → wholesale-replace with v2
// - user-edited (no markers, no fingerprint) → prepend managed block, preserve user content
// - has managed markers → replace only managed region, keep user content outside
// - already at current version → no-op
MiniAWikiManager.prototype.upgradeAgents = function() {
  if (this._access !== "rw") return { ok: false, error: "wiki is read-only" }
  var CURRENT  = __MINI_A_WIKI_AGENTS_VERSION
  var MANAGED_START_STR = "<!-- mini-a:agents managed:start"
  var MANAGED_END_STR   = "<!-- mini-a:agents managed:end -->"
  var now = new Date().toISOString()

  if (!this._backend.exists("AGENTS.md")) {
    this._backend.write("AGENTS.md", __miniAWikiAgentsTemplate(now))
    return { ok: true, action: "created", agentsVersion: CURRENT }
  }

  var raw    = this._backend.read("AGENTS.md")
  if (!isString(raw)) return { ok: false, error: "could not read AGENTS.md" }
  var parsed = this.parseFrontmatter(raw)
  var curVer = isNumber(parsed.meta.agentsVersion) ? parsed.meta.agentsVersion : 0
  if (curVer >= CURRENT) return { ok: true, action: "noop", agentsVersion: curVer }

  var body = isString(parsed.body) ? parsed.body : ""

  // Case 1: has managed markers → replace only managed region
  var startIdx = body.indexOf(MANAGED_START_STR)
  var endIdx   = body.indexOf(MANAGED_END_STR)
  if (startIdx >= 0 && endIdx > startIdx) {
    var newTpl       = __miniAWikiAgentsTemplate(now)
    var newParsed    = this.parseFrontmatter(newTpl)
    var newBody      = isString(newParsed.body) ? newParsed.body : ""
    var newStartIdx  = newBody.indexOf(MANAGED_START_STR)
    var newEndIdx    = newBody.indexOf(MANAGED_END_STR)
    var newManaged   = newBody.substring(newStartIdx, newEndIdx + MANAGED_END_STR.length)
    var beforeManaged = body.substring(0, startIdx)
    var afterManaged  = body.substring(endIdx + MANAGED_END_STR.length)
    var meta = merge({}, isObject(parsed.meta) ? parsed.meta : {})
    meta.agentsVersion = CURRENT
    meta.updated = now
    this._backend.write("AGENTS.md", this._serializeFrontmatter(meta, beforeManaged + newManaged + afterManaged))
    return { ok: true, action: "upgraded", agentsVersion: CURRENT }
  }

  // Case 2: no markers, stock v1 fingerprint → wholesale replace
  if (body.indexOf(__MINI_A_WIKI_V1_STOCK_PHRASE) >= 0) {
    this._backend.write("AGENTS.md", __miniAWikiAgentsTemplate(now))
    return { ok: true, action: "upgraded", agentsVersion: CURRENT }
  }

  // Case 3: no markers, user-customized → prepend managed block, preserve user content
  var newTpl2      = __miniAWikiAgentsTemplate(now)
  var newParsed2   = this.parseFrontmatter(newTpl2)
  var newBody2     = isString(newParsed2.body) ? newParsed2.body : ""
  var ns2          = newBody2.indexOf(MANAGED_START_STR)
  var ne2          = newBody2.indexOf(MANAGED_END_STR)
  var managedBlock = newBody2.substring(ns2, ne2 + MANAGED_END_STR.length)
  var meta2 = merge({}, isObject(parsed.meta) ? parsed.meta : {})
  meta2.agentsVersion = CURRENT
  meta2.updated = now
  var userContent = body.trim()
  var newFullBody = "\n" + managedBlock + "\n\n<!-- Your customizations below are never overwritten -->\n\n" + userContent + "\n"
  this._backend.write("AGENTS.md", this._serializeFrontmatter(meta2, newFullBody))
  return { ok: true, action: "preserved", agentsVersion: CURRENT }
}

// ── Federation (attach / detach / mounts) ─────────────────────────────────────

MiniAWikiManager.prototype.attach = function(name, config) {
  if (!isString(name) || name.trim().length === 0) return { ok: false, error: "name is required" }
  name = name.trim().replace(/^@/, "")
  this._mounts = isArray(this._mounts) ? this._mounts : []
  // Remove any existing mount with this name
  this._mounts = this._mounts.filter(function(m) { return m.name !== name })
  var cfg = isMap(config) ? config : {}
  cfg.access = "ro"
  // Mounts inherit the caller's lexical contract unless they explicitly select
  // another language/rule set. This makes a single wikilexical setting apply
  // consistently to federated retrieval.
  if (isUnDef(cfg.wikilexical)) cfg.wikilexical = this._lexicalConfig
  try {
    var manager = new MiniAWikiManager(cfg, this._logFn, this._auditFn)
    var count   = manager._safeListPages("").length
    this._mounts.push({ name: name, manager: manager, prefix: "@" + name + "/" })
    return { ok: true, name: name, pages: count }
  } catch(e) {
    return { ok: false, error: __miniAErrMsg(e) }
  }
}

MiniAWikiManager.prototype.detach = function(name) {
  if (!isString(name) || name.trim().length === 0) return { ok: false, error: "name is required" }
  name = name.trim().replace(/^@/, "")
  this._mounts = isArray(this._mounts) ? this._mounts : []
  var found = false
  this._mounts = this._mounts.filter(function(m) {
    if (m.name !== name) return true
    found = true
    try { if (isFunction(m.manager.close)) m.manager.close() } catch(e2) {}
    return false
  })
  if (!found) return { ok: false, error: "no mount named '" + name + "'" }
  return { ok: true, name: name }
}

MiniAWikiManager.prototype.mounts = function() {
  this._mounts = isArray(this._mounts) ? this._mounts : []
  return this._mounts.map(function(m) {
    var count = 0; try { count = m.manager._safeListPages("").length } catch(e) {}
    return { name: m.name, prefix: m.prefix, pages: count }
  })
}

// ── context ───────────────────────────────────────────────────────────────────

MiniAWikiManager.prototype.context = function(options) {
  var opts        = isObject(options) ? options : {}
  var maxSections = isNumber(opts.maxSections) && opts.maxSections > 0 ? opts.maxSections : 10
  var maxRecent   = isNumber(opts.maxRecent)   && opts.maxRecent   > 0 ? opts.maxRecent   : 5

  var pages = this._safeListPages("")
  var sectionSet = {}
  pages.forEach(function(p) {
    var parts = p.split("/")
    if (parts.length > 1) sectionSet[parts[0] + "/"] = true
  })
  var sections = Object.keys(sectionSet).sort().slice(0, maxSections)

  // Last N log entries (most recent first)
  var recent = []
  try {
    var logRaw = this._backend.read("log.md")
    if (isString(logRaw)) {
      logRaw.split("\n").forEach(function(line) {
        if (/^## \[/.test(line)) recent.push(line.replace(/^## /, "").trim())
      })
      recent = recent.reverse().slice(0, maxRecent)
    }
  } catch(e) {}

  var mounts = isArray(this._mounts) ? this._mounts : []
  var mountList = mounts.slice(0, 10).map(function(m) {
    var count = 0; try { count = m.manager._safeListPages("").length } catch(e) {}
    var desc = ""
    try {
      var idx = m.manager.read("index.md")
      if (isObject(idx) && isObject(idx.meta) && isString(idx.meta.description)) desc = idx.meta.description
    } catch(e) {}
    return { name: m.name, pages: count, description: desc }
  })

  // Retrieval capability: tells the agent up-front whether search is index-backed or a full scan,
  // and whether a knowledge graph is available as an entry point.
  var searchStatus = "scan"
  try { searchStatus = this._searchIndexStatus() } catch(e) {}
  var graphStatus = "none"
  var entryPoints = []
  if (isObject(this._graph)) {
    graphStatus = isFunction(this._graph._hasFalkorRead) && this._graph._hasFalkorRead() ? "falkor" : "local"
    try {
      var comms = this._graph.detectCommunities()
      var list  = isArray(comms) ? comms : (isMap(comms) && isArray(comms.communities) ? comms.communities : [])
      entryPoints = list.slice(0, 5).map(function(c) {
        return {
          label: isString(c.label) ? c.label : (isString(c.name) ? c.name : String(c.id || "")),
          size : isNumber(c.size) ? c.size : (isArray(c.members) ? c.members.length : 0)
        }
      }).filter(function(c) { return c.label.length > 0 })
    } catch(ec) {}
  }

  return {
    pages    : pages.length,
    sections : sections,
    mounts   : mountList,
    recent   : recent,
    access   : this._access,
    retrieval: {
      search : searchStatus,
      graph  : graphStatus,
      entries: entryPoints
    },
    hint     : "Call search() first, then read() the best match by path. For long pages use section= to read only the heading you need." +
               (searchStatus === "scan" ? " (search is a full scan here - prefer narrow queries)" : "")
  }
}
