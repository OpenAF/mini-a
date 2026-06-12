// Author: Nuno Aguiar
// License: Apache 2.0
// Description: Wiki manager for Mini-A. Supports filesystem and S3 backends.

// ── Template version & helpers ────────────────────────────────────────────────

var __MINI_A_WIKI_AGENTS_VERSION = 2

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
    "---",
    "```",
    "",
    "### Optional front-matter fields",
    "",
    "```yaml",
    "type: concept | entity | comparison | summary | overview   # groups pages in indexes",
    "tags: [tag1, tag2]              # lowercase slugs",
    "aliases: [alt-name]             # alternative names for search",
    "supersedes: path/to/old.md      # when this page replaces another",
    "status: draft | review | stable # omit for stable",
    "```",
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

var MiniAWikiManager = function(config, loggerFn) {
  this._logFn  = isFunction(loggerFn) ? loggerFn : function() {}
  this._config = {}
  this._backend = __
  this.configure(config)
}


MiniAWikiManager.prototype._indexMeta = function() {
  return {
    hiddenNames: [".mini-a-wiki-lucene.lock"]
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
  var self = this
  return this._backend.list(prefix).filter(function(p) {
    return isString(p) && p.endsWith('.md') && !self._isHiddenPath(p)
  })
}

MiniAWikiManager.prototype._rebuildSearchIndex = function() {
  if (this._access !== 'rw') return
  try {
    var self = this
    var pages = this._safeListPages("").filter(function(p) { return !self._isSearchExcludedPath(p) })
    var docs = []
    for (var i=0;i<pages.length;i++) {
      var raw = this._backend.read(pages[i])
      if (!isString(raw)) continue
      var parsed = this.parseFrontmatter(raw)
      docs.push({ path: pages[i], title: isString(parsed.meta.title) ? parsed.meta.title : pages[i], raw: raw, body: isString(parsed.body) ? parsed.body : "" })
    }
    this._rebuildLuceneIndex(docs)
  } catch(e) { this._logFn('warn', 'Failed to rebuild wiki index: ' + __miniAErrMsg(e)) }
}

MiniAWikiManager.prototype._getGraphPath = function() {
  var root = "."
  if (this._backendType === "fs" || this._backendType === "s3fs") root = this._backend.root
  return root + "/.mini-a-wiki-graph"
}

MiniAWikiManager.prototype._graphPages = function() {
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

MiniAWikiManager.prototype._rebuildGraphIndex = function() {
  if (!isObject(this._graph)) return
  try {
    this._graph.buildStructural(this._graphPages())
  } catch(e) {
    this._logFn("warn", "Failed to rebuild graph index: " + __miniAErrMsg(e))
  }
}

MiniAWikiManager.prototype._getLuceneIndexPath = function() {
  var root = "."
  if (this._backendType === "fs" || this._backendType === "s3fs") root = this._backend.root
  return root + "/.mini-a-wiki-lucene"
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

MiniAWikiManager.prototype._rebuildLuceneIndex = function(docs) {
  if (!this._ensureLucene()) return
  try {
    var idxPath = this._getLuceneIndexPath()
    var chName = "__mini_a_wiki_searchdb"
    try {
      $ch(chName).destroy()
    } catch(ignore) {}
    try {
      $ch(chName).create("searchdb", { path: idxPath, idField: "id", contentField: "content" })
      ;(isArray(docs) ? docs : []).forEach(function(d) {
        $ch(chName).set({ id: d.path }, { content: d.raw, payload: { path: d.path, title: d.title } })
      })
    } finally {
      try {
        $ch(chName).destroy()
      } catch(ignore2) {}
    }
  } catch(e) {
    this._logFn("warn", "Failed to rebuild Lucene index: " + __miniAErrMsg(e))
  }
}

MiniAWikiManager.prototype.reindex = function() {
  if (this._access !== "rw") return { ok: false, error: "wiki is read-only" }
  try {
    this._rebuildSearchIndex()
    this._rebuildGraphIndex()
    return { ok: true }
  } catch(e) {
    return { ok: false, error: __miniAErrMsg(e) }
  }
}

MiniAWikiManager.prototype._withGraphHints = function(hits, options) {
  if (!isArray(hits) || !isObject(this._graph)) return hits
  var opts = isObject(options) ? options : {}
  // F12: undefined means enabled; only explicit false disables hints
  if (this._config.wikigraphsearchhints === false && opts.wikigraphsearchhints !== true) return hits
  var cap = isNumber(opts.wikigraphhintcap) ? opts.wikigraphhintcap : (isNumber(this._config.wikigraphhintcap) ? this._config.wikigraphhintcap : 5)
  var lim = isNumber(opts.limit) && opts.limit > 0 ? opts.limit : __
  if (isNumber(lim) && hits.length >= lim) return hits
  var paths = hits.map(function(h) { return h.path }).filter(function(p) { return isString(p) && !p.startsWith("@") })
  if (paths.length === 0) return hits
  var related = this._graph.relatedFor(paths, { cap: cap })
  if (!isArray(related) || related.length === 0) return hits
  var combined = hits.concat(related.map(function(r) {
    return {
      path: r.path,
      title: r.path.replace(/\.md$/i, "").replace(/[-_/]/g, " "),
      description: "[Related pages (graph)] " + r.connection + " score=" + r.score + " provenance=" + r.provenance + " — " + r.digest
    }
  }))
  return isNumber(lim) ? combined.slice(0, lim) : combined
}

MiniAWikiManager.prototype.graph = function(op, params) {
  if (!isObject(this._graph)) return { ok: false, error: "graph is not enabled (usegraph=true)" }
  var action = isString(op) ? op.toLowerCase().trim() : (isObject(params) && isString(params.op) ? params.op.toLowerCase().trim() : "stats")
  var p = isObject(params) ? params : {}
  if (action === "build") {
    var st = this._graph.buildStructural(this._graphPages())
    // F5: wikigraphsemantic=true makes graph build default semantic:true (still emits corpus warning)
    if (p.semantic === true || toBoolean(this._config.wikigraphsemantic) === true) return this._graph.buildSemantic(this._graphPages(), p)
    return { ok: true, structural: st }
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
  if (opts.withMeta !== true) return pages
  var self = this
  var limit = isNumber(opts.limit) && opts.limit > 0 ? opts.limit : 1000
  return pages.slice(0, limit).map(function(p) {
    var raw = self._backend.read(p)
    if (!isString(raw)) return { path: p, title: p, description: "", type: "", updated: "" }
    var parsed = self.parseFrontmatter(raw)
    var m = isObject(parsed.meta) ? parsed.meta : {}
    return {
      path       : p,
      title      : isString(m.title)       ? m.title       : p.replace(/\.md$/i, "").replace(/[-_/]/g, " "),
      description: isString(m.description) ? m.description : "",
      type       : isString(m.type)        ? m.type        : "",
      updated    : isDef(m.updated)        ? String(m.updated).substring(0, 10) : ""
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
  var accessRaw  = isDef(cfg.access) ? String(cfg.access).toLowerCase().trim() : "ro"
  var backendRaw = isDef(cfg.backend) ? String(cfg.backend).toLowerCase().trim() : "fs"
  this._access      = accessRaw === "rw" ? "rw" : "ro"
  this._backendType = ["s3", "es", "s3fs"].indexOf(backendRaw) >= 0 ? backendRaw : "fs"
  this._config  = cfg
  this._graph = __
  this._mounts  = isArray(this._mounts) ? this._mounts : []
  this._backend = this._backendType === "s3" ? this._makeS3Backend(cfg) : (this._backendType === "es" ? this._makeEsBackend(cfg) : (this._backendType === "s3fs" ? this._makeS3FsBackend(cfg) : this._makeFsBackend(cfg)))
  if (toBoolean(cfg.usegraph) === true) {
    try {
      loadLib("mini-a-graph.js")
      var graphCfg = {
        graphDir: this._getGraphPath(),
        communityAlgo: isString(cfg.wikigraphcommunity) ? cfg.wikigraphcommunity : "louvain",
        falkor: isMap(cfg.wikigraphfalkor) ? cfg.wikigraphfalkor : __,
        llmExtractFn: isFunction(cfg.llmExtractFn) ? cfg.llmExtractFn : __
      }
      this._graph = new MiniAWikiGraph(graphCfg, function(level, msg) { this._logFn(level, msg) }.bind(this))
    } catch(graphErr) {
      this._logFn("warn", "Graph support unavailable: " + __miniAErrMsg(graphErr))
      this._graph = __
    }
  }
  this._bootstrapWiki()
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
  var page = this.read(path)
  if (isObject(page) && isObject(page.meta) && isString(page.meta.title) && page.meta.title.trim().length > 0) return page.meta.title.trim()
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
  var isRoot = indexPath === "index.md"
  var sectionName = isString(title) && title.trim().length > 0 ? title.trim()
    : (isRoot ? "Wiki Home" : indexPath.replace(/\/index\.md$/i, "").replace(/[-_/]/g, " "))
  var desc = isString(description) && description.trim().length > 0 ? description.trim()
    : (isRoot ? "Main entrypoint and catalog for this wiki." : "Navigation index for this wiki section.")

  var lines = [
    "---",
    "title: " + sectionName,
    "description: " + desc,
    "created: " + now,
    "updated: " + now,
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

MiniAWikiManager.prototype.init = function(path) {
  if (this._access !== "rw") return { ok: false, error: "wiki is read-only" }
  var now = new Date().toISOString()
  if (isString(path) && path.trim().length > 0) {
    try {
      var section = this._normalizeSectionPath(path)
      var indexPath = section + "index.md"
      if (this._backend.exists(indexPath)) return { ok: true, created: [], skipped: [ indexPath ] }
      this._backend.write(indexPath, this._makeIndexContent(indexPath))
      this._rebuildSearchIndex()
      this._rebuildGraphIndex()
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
    this._rebuildSearchIndex()
    this._rebuildGraphIndex()
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
  var resolvePath = function(relPath, allowMissingLeaf) {
    var rel = (isDef(relPath) && String(relPath).length > 0) ? __miniAWikiNormalizePath(relPath, {
      allowDirectory  : allowMissingLeaf !== true,
      requireMarkdown : allowMissingLeaf !== true
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
        var dir = resolvePath(normalizedPrefix, false)
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

// ── S3 backend ───────────────────────────────────────────────────────────────

MiniAWikiManager.prototype._makeS3Backend = function(cfg) {
  loadLib("s3.js")
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
      } catch(e) { return [] }
    },
    read: function(path) {
      try {
        var stream = s3client.getObjectStream(bucket, prefix + path)
        return af.fromInputStream2String(stream)
      } catch(e) { return __ }
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

MiniAWikiManager.prototype._makeEsBackend = function(cfg) {
  includeOPack("ElasticSearch")
  loadLib("elasticsearch.js")
  var esurl = isString(cfg.esurl) ? cfg.esurl : "http://127.0.0.1:9200"
  var index = isString(cfg.esindex) && cfg.esindex.length > 0 ? cfg.esindex : "mini_a_wiki"
  var es = new ElasticSearch(esurl, cfg.esuser, cfg.espass)
  var chName = "__mini_a_wiki_es_" + sha1(index).substring(0, 8)
  es.createCh(index, ["path"], chName)
  return {
    type: "es",
    list: function(pfx) {
      var prefix = isString(pfx) ? pfx : ""
      return __miniAWikiEsRowsToPaths($ch(chName).getAll({ query: { prefix: { path: prefix } }, size: 10000 }))
    },
    read: function(path) {
      var r = $ch(chName).get({ path: path })
      return isMap(r) ? r.raw : __
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
  if (isObject(this._backend) && isFunction(this._backend.close)) {
    this._backend.close()
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
  return { meta: meta, body: body }
}

MiniAWikiManager.prototype._serializeFrontmatter = function(meta, body) {
  var yaml = ""
  try { yaml = af.toYAML(meta) } catch(e) { yaml = "" }
  return "---\n" + yaml + "---\n" + (isString(body) ? body : "")
}

// ── Link extraction ───────────────────────────────────────────────────────────

// Returns [{raw, type}] where type is "md" (page-relative) or "wiki" (root-relative).
// External https?:// targets are excluded here since they are never wiki-internal.
MiniAWikiManager.prototype._extractLinkEntries = function(body) {
  if (!isString(body)) return []
  var entries = []
  var seen    = {}
  var m
  var mdRe = /\[([^\]]*)\]\(([^)]+\.md[^)]*)\)/g
  while ((m = mdRe.exec(body)) !== null) {
    var target = m[2].split("#")[0].trim()
    if (target.length > 0 && !/^https?:\/\//i.test(target) && !seen[target]) {
      seen[target] = true
      entries.push({ raw: target, type: "md" })
    }
  }
  // Wiki-style links: [[Page Name]] — always root-relative slugs
  var wikiRe = /\[\[([^\]]+)\]\]/g
  while ((m = wikiRe.exec(body)) !== null) {
    var name = m[1].trim()
    if (name.length > 0) {
      var slug = name.toLowerCase().replace(/\s+/g, "-") + ".md"
      if (!seen[slug]) { seen[slug] = true; entries.push({ raw: slug, type: "wiki" }) }
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
  if (target.startsWith("/")) return null          // absolute path — not wiki-internal
  // Cross-wiki mount link: @name/path.md — return as-is; lint validates separately
  if (target.startsWith("@")) return target

  var pageDir = isString(sourcePage) && sourcePage.indexOf("/") > -1
    ? sourcePage.substring(0, sourcePage.lastIndexOf("/") + 1)
    : ""
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

    try {
      this._backend.write(path, this._serializeFrontmatter(updatedMeta, reparsed.body))
      this._rebuildSearchIndex()
      this._rebuildGraphIndex()
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
    this._rebuildSearchIndex()
    this._rebuildGraphIndex()
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
    this._rebuildSearchIndex()
    this._rebuildGraphIndex()
    try { this.appendLog("delete", path, path) } catch(le) {}
    return { ok: true, path: path }
  } catch(e) {
    return { ok: false, error: __miniAErrMsg(e) }
  }
}

MiniAWikiManager.prototype.search = function(query, options) {
  if (!isString(query) || query.trim().length === 0) return []
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
  var pages   = scopedPath.length > 0 ? [scopedPath] : this.list("")
  pages = pages.filter(function(p) { return !self._isSearchExcludedPath(p) })
  var results = []

  if (!forceScan && !opts.regex && scopedPath.length === 0 && this._ensureLucene()) {
    try {
      var chName = "__mini_a_wiki_searchdb"
      var luceneQuery = q.replace(/(&&|\|\||[+\-!(){}\[\]^"~*?:\\/])/g, "\\$1")
      var luceneHits
      try {
        $ch(chName).create("searchdb", { path: this._getLuceneIndexPath(), idField: "id", contentField: "content" })
        luceneHits = $ch(chName).getAll({ query: luceneQuery, limit: limit })
      } finally {
        $ch(chName).destroy()
      }
      if (isArray(luceneHits) && luceneHits.length > 0) {
        var self = this
        var validHits = luceneHits.map(function(h) {
          var hitPath = h.id || (isMap(h.payload) ? h.payload.path : __)
          var hitTitle = isMap(h.payload) && isString(h.payload.title) ? h.payload.title : (h.id || "")
          if (compact) {
            var hitDesc = ""
            try {
              var hitRaw = self._backend.read(hitPath)
              if (isString(hitRaw)) {
                var hitParsed = self.parseFrontmatter(hitRaw)
                if (isObject(hitParsed.meta) && isString(hitParsed.meta.description)) hitDesc = hitParsed.meta.description
              }
            } catch(e2) {}
            return { path: hitPath, title: hitTitle, description: hitDesc }
          }
          return { path: hitPath, title: hitTitle, line: isNumber(h.line) ? h.line : 1, snippet: isString(h.content) ? h.content.substring(0, 180) : q }
        }).filter(function(r) { return isString(r.path) && r.path.length > 0 && !self._isSearchExcludedPath(r.path) })
        if (validHits.length > 0) {
          // Fan out to mounts after primary results
          var mountResults = this._searchMounts(query, opts, compact, limit - validHits.length)
          return this._withGraphHints(validHits.concat(mountResults), opts)
        }
      }
    } catch(le) {
      this._logFn("warn", "Lucene search fallback to scan: " + __miniAErrMsg(le))
    }
  }

  var seenPaths = {}  // for compact dedup
  for (var i = 0; i < pages.length && results.length < limit; i++) {
    var raw = this._backend.read(pages[i])
    if (!isString(raw)) continue
    var parsed = this.parseFrontmatter(raw)
    var title  = isString(parsed.meta.title) ? parsed.meta.title : pages[i]
    var lines  = raw.split("\n")

    var bodyStartLine = 0
    if (searchIn === "body" && raw.startsWith("---\n")) {
      var fmEnd = raw.indexOf("\n---\n", 4)
      if (fmEnd >= 0) {
        bodyStartLine = raw.substring(0, fmEnd + 5).split("\n").length - 1
      }
    }

    var matched = false
    for (var li = bodyStartLine; li < lines.length && (compact ? !matched : results.length < limit); li++) {
      pattern.lastIndex = 0
      var m = pattern.exec(lines[li])
      if (!m) continue

      if (compact) {
        if (!seenPaths[pages[i]]) {
          seenPaths[pages[i]] = true
          results.push({
            path: pages[i],
            title: title,
            description: isString(parsed.meta.description) ? parsed.meta.description : ""
          })
        }
        matched = true
      } else {
        var matchIdx = m.index
        var snippet  = lines[li].substring(Math.max(0, matchIdx - 60), matchIdx + 120).replace(/\n/g, " ").trim()
        if (snippet.length === 0) snippet = lines[li].substring(0, 180).trim()

        var result = { path: pages[i], title: title, line: li + 1, snippet: snippet }
        if (contextN > 0) {
          result.contextBefore = lines.slice(Math.max(0, li - contextN), li)
          result.contextAfter  = lines.slice(li + 1, Math.min(lines.length, li + 1 + contextN))
        }
        results.push(result)
      }
    }
  }

  var mountResults = this._searchMounts(query, opts, compact, limit - results.length)
  return this._withGraphHints(results.concat(mountResults), opts)
}

// _searchMounts: fan search out to all mounts, prefix paths with @name/
MiniAWikiManager.prototype._searchMounts = function(query, opts, compact, remaining) {
  if (remaining <= 0) return []
  var mounts = isArray(this._mounts) ? this._mounts : []
  if (mounts.length === 0) return []
  var combined = []
  var mountOpts = merge({}, opts)
  mountOpts.limit = remaining
  for (var mi = 0; mi < mounts.length && combined.length < remaining; mi++) {
    var m = mounts[mi]
    try {
      var hits = m.manager.search(query, mountOpts)
      hits.forEach(function(h) {
        var prefixed = merge({}, h)
        prefixed.path = "@" + m.name + "/" + h.path
        prefixed.mount = m.name
        combined.push(prefixed)
      })
    } catch(e) {}
  }
  return combined
}

MiniAWikiManager.prototype.tree = function(prefix, depth) {
  var sectionPrefix = ""
  try { sectionPrefix = this._normalizeSectionPath(prefix) } catch(e) { sectionPrefix = "" }
  var maxDepth = isNumber(depth) && depth >= 0 ? depth : 3
  var pages = this.list(sectionPrefix).filter(function(p) { return isString(p) && p.endsWith(".md") })
  var self = this

  var buildNode = function(dir, level) {
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
    var slug = String(label).trim().toLowerCase().replace(/\s+/g, "-") + ".md"
    if (slug !== fromPath) return full
    return "[" + label + "](" + self._relativePath(rebaseOnly === true ? toPath : sourcePage, toPath) + ")"
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

  this._rebuildSearchIndex()
  this._rebuildGraphIndex()
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
      var resolved = entry.type === "wiki" ? entry.raw : self.resolveLink(p, entry.raw)
      if (resolved === null) return  // external URL, absolute path, or escapes root — not wiki-internal
      // Cross-wiki mount link
      if (isString(resolved) && resolved.startsWith("@")) {
        var mres = self._resolveMountPath(resolved.endsWith(".md") ? resolved : resolved + "/index.md")
        if (!mres || !mres.mount) {
          issues.push({ severity: "info", type: "unresolved_mount_link", page: p, target: entry.raw, mount: mres ? mres.name : resolved })
        }
        return
      }
      var exists = self._backend.exists(resolved)
      if (!exists) {
        issues.push({ severity: "error", type: "broken_link", page: p, target: entry.raw, resolved: resolved })
      } else {
        if (!isNumber(incomingCount[resolved])) incomingCount[resolved] = 0
        incomingCount[resolved]++
      }
    })

    // Check 2: Missing front-matter fields
    if (!isString(pd.meta.title) || pd.meta.title.trim().length === 0) {
      issues.push({ severity: "warning", type: "missing_frontmatter", page: p, field: "title" })
    }
    if (!isString(pd.meta.description) || pd.meta.description.trim().length === 0) {
      issues.push({ severity: "info", type: "missing_frontmatter", page: p, field: "description" })
    }

    // Check 3: Heading hierarchy
    var h2seen = false, h3seen = false
    pd.body.split("\n").forEach(function(line) {
      if (/^## /.test(line)) h2seen = true
      if (/^### /.test(line)) {
        if (!h2seen) issues.push({ severity: "warning", type: "heading_hierarchy", page: p, detail: "h3 before h2" })
        h3seen = true
      }
      if (/^#### /.test(line) && !h3seen) {
        issues.push({ severity: "warning", type: "heading_hierarchy", page: p, detail: "h4 before h3" })
      }
    })

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
      return
    }

    var linked = {}
    indexData.linkEntries.forEach(function(entry) {
      var resolved = entry.type === "wiki" ? entry.raw : self.resolveLink(indexPath, entry.raw)
      if (isString(resolved)) linked[resolved] = true
    })
    directPages.concat(childIndexes).forEach(function(required) {
      if (!linked[required]) issues.push({ severity: "warning", type: "index_missing_links", section: dir, page: indexPath, target: required })
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

  // Check 6: Orphaned pages (no incoming links — skip index-like and protected files)
  pages.forEach(function(p) {
    var name = p.replace(/.*\//, "").toLowerCase()
    if (name === "index.md" || name === "readme.md" || name === "log.md") return
    if ((incomingCount[p] || 0) === 0) {
      issues.push({ severity: "warning", type: "orphan", page: p })
    }
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
  try {
    var manager = new MiniAWikiManager(cfg, this._logFn)
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

  return {
    pages   : pages.length,
    sections: sections,
    mounts  : mountList,
    recent  : recent,
    hint    : "Call search() first, then read() the best match by path. For long pages use section= to read only the heading you need."
  }
}
