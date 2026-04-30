// Author: Nuno Aguiar
// License: Apache 2.0
// Description: Wiki manager for Mini-A. Supports filesystem and S3 backends.

var MiniAWikiManager = function(config, loggerFn) {
  this._logFn  = isFunction(loggerFn) ? loggerFn : function() {}
  this._config = {}
  this._backend = __
  this.configure(config)
}


MiniAWikiManager.prototype._indexMeta = function() {
  return {
    file: ".mini-a-wiki-lucene.json",
    hiddenNames: [".mini-a-wiki-lucene.json", ".mini-a-wiki-lucene.lock"]
  }
}

MiniAWikiManager.prototype._isHiddenPath = function(path) {
  var p = isString(path) ? String(path).trim() : ""
  if (p.length === 0) return false
  var bn = p.split("/").pop()
  var meta = this._indexMeta()
  return meta.hiddenNames.indexOf(p) >= 0 || meta.hiddenNames.indexOf(bn) >= 0
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
    var pages = this._safeListPages("")
    var docs = []
    for (var i=0;i<pages.length;i++) {
      var raw = this._backend.read(pages[i])
      if (!isString(raw)) continue
      var parsed = this.parseFrontmatter(raw)
      docs.push({ path: pages[i], title: isString(parsed.meta.title) ? parsed.meta.title : pages[i], raw: raw, body: isString(parsed.body) ? parsed.body : "" })
    }
    this._backend.write(this._indexMeta().file, stringify(docs, __, ""))
    this._rebuildLuceneIndex(docs)
  } catch(e) { this._logFn('warn', 'Failed to rebuild wiki index: ' + __miniAErrMsg(e)) }
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
    var p = getOPackPath("lucene")
    if (!isString(p) || p.length === 0) return false
    loadLib(p + "/lucene.js")
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
    $ch(chName).destroy()
    $ch(chName).create("searchdb", { path: idxPath, idField: "id", contentField: "content" })
    ;(isArray(docs) ? docs : []).forEach(function(d) {
      $ch(chName).set({ id: d.path }, { content: d.raw, payload: { path: d.path, title: d.title } })
    })
    $ch(chName).destroy()
  } catch(e) {
    this._logFn("warn", "Failed to rebuild Lucene index: " + __miniAErrMsg(e))
  }
}

MiniAWikiManager.prototype.list = function(prefix) {
  var pfx = isString(prefix) ? prefix : ""
  if (this._backendType === "fs" && isMap(this._backend) && isDef(this._backend.root)) {
    try {
      return this._safeListPages(pfx)
    } catch(e) {
      return []
    }
  }
  return this._safeListPages(pfx)
}

MiniAWikiManager.prototype.configure = function(config) {
  var cfg = isMap(config) ? config : {}
  var accessRaw  = isDef(cfg.access) ? String(cfg.access).toLowerCase().trim() : "ro"
  var backendRaw = isDef(cfg.backend) ? String(cfg.backend).toLowerCase().trim() : "fs"
  this._access      = accessRaw === "rw" ? "rw" : "ro"
  this._backendType = ["s3", "es", "s3fs"].indexOf(backendRaw) >= 0 ? backendRaw : "fs"
  this._config  = cfg
  this._backend = this._backendType === "s3" ? this._makeS3Backend(cfg) : (this._backendType === "es" ? this._makeEsBackend(cfg) : (this._backendType === "s3fs" ? this._makeS3FsBackend(cfg) : this._makeFsBackend(cfg)))
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
    var agentsContent = [
      "---",
      "title: Wiki Contribution Guidelines",
      "description: Rules and workflow for agents reading from and writing to this wiki.",
      "created: " + now,
      "updated: " + now,
      "---",
      "",
      "# Wiki Contribution Guidelines",
      "",
      "This file defines how agents should read, distil, and contribute knowledge to this wiki.",
      "All agents that use this wiki **must** read this file before performing any write operation.",
      "",
      "## Page Schema",
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
      "updated: <ISO 8601 timestamp>   # must be refreshed on every write",
      "---",
      "```",
      "",
      "### Optional front-matter fields",
      "",
      "```yaml",
      "tags: [tag1, tag2]              # lowercase slugs",
      "aliases: [alt-name]             # alternative page names for search",
      "supersedes: path/to/old.md      # when this page replaces another",
      "status: draft | review | stable # omit for stable",
      "```",
      "",
      "### Body conventions",
      "",
      "- Start with a single `# Title` heading that matches `front-matter.title`.",
      "- Use `## Section` headings to organise content; never skip levels (e.g. h1 → h3).",
      "- Keep pages focused on one concept. Split into sub-pages when a section exceeds ~300 words.",
      "- End with a `## See Also` section listing related pages when relevant.",
      "",
      "## Ingestion Workflow",
      "",
      "Follow these steps **in order** whenever you want to add knowledge to the wiki:",
      "",
      "1. **Search first** — call `wiki search <keywords>` before creating anything.",
      "   If a relevant page exists, update it rather than creating a duplicate.",
      "2. **Distil, do not dump** — extract the essential, reusable fact or concept.",
      "   Strip conversation context, ephemeral details, and task-specific phrasing.",
      "3. **Choose the right page** — one concept per page.",
      "   If the knowledge spans multiple concepts, create one page per concept and link them.",
      "4. **Write or update** — use `wiki write <path> <meta> <body>`.",
      "   - New page: set `created` and `updated` to now.",
      "   - Existing page: update `updated` to now; preserve `created`.",
      "   - If you are superseding stale content, set `supersedes` in the new page's front-matter",
      "     and mark the old page's body with `> **Superseded** — see [[New Page]]` at the top.",
      "5. **Link** — add relative Markdown links from related pages to the new page.",
      "   Use `[[Page Title]]` wiki-style links or `[Page Title](path/to/page.md)` links.",
      "6. **Lint** — call `wiki lint` and fix all `error`-severity issues before finishing.",
      "",
      "## Retrieval Conventions",
      "",
      "- Start with `wiki read index.md` for the wiki entrypoint and top-level navigation.",
      "- Use `wiki search <query>` for keyword search across page bodies.",
      "- Use `wiki list` to browse available pages when you need to discover structure.",
      "- Use `wiki read <path>` to load a specific page.",
      "- Prefer reading the most-recently-updated page when multiple pages cover similar ground.",
      "- Trust content marked `status: stable`; treat `status: draft` as provisional.",
      "",
      "## Linking",
      "",
      "- Use relative Markdown links: `[Page Title](path/to/page.md)`.",
      "- Wiki-style links are also supported: `[[Page Title]]` (auto-slugified).",
      "- Always link back to this `AGENTS.md` from any page that documents wiki-wide conventions.",
      "",
      "## Content Rules",
      "",
      "- Write concise, factual, durable content. Avoid task-specific or ephemeral phrasing.",
      "- Do not contradict existing pages without first marking the old content as superseded.",
      "- Do not duplicate information that already exists on another page — link instead.",
      "- Use neutral, encyclopaedic tone. Avoid first-person ('I found...', 'we decided...').",
      "",
      "## Lint",
      "",
      "- Run `wiki lint` before finishing to check for broken links, orphan pages, and stale content.",
      "- Fix all `error`-severity issues.",
      "- Address `warning`-severity issues where possible.",
      "- `info`-severity issues (near-duplicates, stale pages) are advisory; use judgement.",
      "",
      "## Entry Point",
      "",
      "- The wiki entrypoint is [Wiki Home](index.md). Keep it updated with the top-level structure.",
      "- Add new sections there when introducing a new major topic area.",
    ].join("\n")

    var indexContent = [
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
      "This is the main entrypoint for the wiki. Start here to discover the available knowledge.",
      "",
      "## Start Here",
      "",
      "- [AGENTS.md](AGENTS.md) — contribution rules, page schema, and ingestion workflow for agents.",
      "",
      "## Topics",
      "",
      "- Add top-level topic pages here as the wiki grows.",
      "- Keep this page short; use it as a table of contents, not a dumping ground.",
      "",
      "## Recent Additions",
      "",
      "- Add links to newly created or important pages here until the topic structure is stable.",
    ].join("\n")

    if (!hasAgents) { this._backend.write("AGENTS.md", agentsContent); this._bootstrappedFiles.push("AGENTS.md") }
    if (!hasIndex)  { this._backend.write("index.md", indexContent);   this._bootstrappedFiles.push("index.md")  }
  } catch(e) {}
}

MiniAWikiManager.prototype.init = function() {
  if (this._access !== "rw") return { ok: false, error: "wiki is read-only" }
  var now = new Date().toISOString()
  var hasAgents = this._backend.exists("AGENTS.md")
  var hasIndex  = this._backend.exists("index.md")
  var bootstrapped = isArray(this._bootstrappedFiles) ? this._bootstrappedFiles : []
  this._bootstrappedFiles = []
  var created = []
  var skipped = []
  try {
    this._rebuildSearchIndex()
    if (!hasAgents) {
      var agentsContent = [
        "---",
        "title: Wiki Contribution Guidelines",
        "description: Rules and workflow for agents reading from and writing to this wiki.",
        "created: " + now,
        "updated: " + now,
        "---",
        "",
        "# Wiki Contribution Guidelines",
        "",
        "This file defines how agents should read, distil, and contribute knowledge to this wiki.",
        "All agents that use this wiki **must** read this file before performing any write operation.",
        "",
        "## Page Schema",
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
        "updated: <ISO 8601 timestamp>   # must be refreshed on every write",
        "---",
        "```",
        "",
        "### Optional front-matter fields",
        "",
        "```yaml",
        "tags: [tag1, tag2]              # lowercase slugs",
        "aliases: [alt-name]             # alternative page names for search",
        "supersedes: path/to/old.md      # when this page replaces another",
        "status: draft | review | stable # omit for stable",
        "```",
        "",
        "### Body conventions",
        "",
        "- Start with a single `# Title` heading that matches `front-matter.title`.",
        "- Use `## Section` headings to organise content; never skip levels (e.g. h1 → h3).",
        "- Keep pages focused on one concept. Split into sub-pages when a section exceeds ~300 words.",
        "- End with a `## See Also` section listing related pages when relevant.",
        "",
        "## Ingestion Workflow",
        "",
        "Follow these steps **in order** whenever you want to add knowledge to the wiki:",
        "",
        "1. **Search first** — call `wiki search <keywords>` before creating anything.",
        "   If a relevant page exists, update it rather than creating a duplicate.",
        "2. **Distil, do not dump** — extract the essential, reusable fact or concept.",
        "   Strip conversation context, ephemeral details, and task-specific phrasing.",
        "3. **Choose the right page** — one concept per page.",
        "   If the knowledge spans multiple concepts, create one page per concept and link them.",
        "4. **Write or update** — use `wiki write <path> <meta> <body>`.",
        "   - New page: set `created` and `updated` to now.",
        "   - Existing page: update `updated` to now; preserve `created`.",
        "   - If you are superseding stale content, set `supersedes` in the new page's front-matter",
        "     and mark the old page's body with `> **Superseded** — see [[New Page]]` at the top.",
        "5. **Link** — add relative Markdown links from related pages to the new page.",
        "   Use `[[Page Title]]` wiki-style links or `[Page Title](path/to/page.md)` links.",
        "6. **Lint** — call `wiki lint` and fix all `error`-severity issues before finishing.",
        "",
        "## Retrieval Conventions",
        "",
        "- Start with `wiki read index.md` for the wiki entrypoint and top-level navigation.",
        "- Use `wiki search <query>` for keyword search across page bodies.",
        "- Use `wiki list` to browse available pages when you need to discover structure.",
        "- Use `wiki read <path>` to load a specific page.",
        "- Prefer reading the most-recently-updated page when multiple pages cover similar ground.",
        "- Trust content marked `status: stable`; treat `status: draft` as provisional.",
        "",
        "## Linking",
        "",
        "- Use relative Markdown links: `[Page Title](path/to/page.md)`.",
        "- Wiki-style links are also supported: `[[Page Title]]` (auto-slugified).",
        "- Always link back to this `AGENTS.md` from any page that documents wiki-wide conventions.",
        "",
        "## Content Rules",
        "",
        "- Write concise, factual, durable content. Avoid task-specific or ephemeral phrasing.",
        "- Do not contradict existing pages without first marking the old content as superseded.",
        "- Do not duplicate information that already exists on another page — link instead.",
        "- Use neutral, encyclopaedic tone. Avoid first-person ('I found...', 'we decided...').",
        "",
        "## Lint",
        "",
        "- Run `wiki lint` before finishing to check for broken links, orphan pages, and stale content.",
        "- Fix all `error`-severity issues.",
        "- Address `warning`-severity issues where possible.",
        "- `info`-severity issues (near-duplicates, stale pages) are advisory; use judgement.",
        "",
        "## Entry Point",
        "",
        "- The wiki entrypoint is [Wiki Home](index.md). Keep it updated with the top-level structure.",
        "- Add new sections there when introducing a new major topic area.",
      ].join("\n")
      this._backend.write("AGENTS.md", agentsContent)
      created.push("AGENTS.md")
    } else if (bootstrapped.indexOf("AGENTS.md") >= 0) {
      created.push("AGENTS.md")
    } else {
      skipped.push("AGENTS.md")
    }
    if (!hasIndex) {
      var indexContent = [
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
        "This is the main entrypoint for the wiki. Start here to discover the available knowledge.",
        "",
        "## Start Here",
        "",
        "- [AGENTS.md](AGENTS.md) — contribution rules, page schema, and ingestion workflow for agents.",
        "",
        "## Topics",
        "",
        "- Add top-level topic pages here as the wiki grows.",
        "- Keep this page short; use it as a table of contents, not a dumping ground.",
        "",
        "## Recent Additions",
        "",
        "- Add links to newly created or important pages here until the topic structure is stable.",
      ].join("\n")
      this._backend.write("index.md", indexContent)
      created.push("index.md")
    } else if (bootstrapped.indexOf("index.md") >= 0) {
      created.push("index.md")
    } else {
      skipped.push("index.md")
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
  if (!opts.allowDirectory && value.endsWith("/")) throw "path must target a file"

  var parts = value.split("/")
  var normalized = []

  for (var i = 0; i < parts.length; i++) {
    var part = String(parts[i] || "").trim()
    if (part.length === 0) throw "path contains empty segments"
    if (part === ".") continue
    if (part === "..") throw "path traversal is not allowed"
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
  loadLib("/elasticsearch.js")
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
  var s3b = this._makeS3Backend(cfg)
  try {
    var pages = s3b.list("")
    for (var i = 0; i < pages.length; i++) {
      var raw = s3b.read(pages[i])
      if (isString(raw)) fsb.write(pages[i], raw)
    }
  } catch(e) {
    this._logFn("warn", "Failed to bootstrap s3fs wiki: " + __miniAErrMsg(e))
  } finally {
    try { s3b.close() } catch(ig) {}
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
    return { ok: true, path: path }
  } catch(e) {
    return { ok: false, error: __miniAErrMsg(e) }
  }
}

MiniAWikiManager.prototype.delete = function(path) {
  if (this._access !== "rw") return { ok: false, error: "wiki is read-only (wikiaccess=ro)" }
  if (!isString(path) || path.trim().length === 0) return { ok: false, error: "path is required" }
  try {
    path = __miniAWikiNormalizePath(path, { requireMarkdown: true })
  } catch(e) {
    return { ok: false, error: __miniAErrMsg(e) }
  }

  if (path === "AGENTS.md") return { ok: false, error: "cannot delete AGENTS.md (protected)" }
  if (this._isHiddenPath(path)) return { ok: false, error: "cannot delete hidden wiki index files" }

  try {
    this._backend.delete(path)
    this._rebuildSearchIndex()
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
  var caseSens   = opts.caseSensitive === true
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

  var pages   = scopedPath.length > 0 ? [scopedPath] : this.list("")
  pages = pages.filter(p => !this._isHiddenPath(p))
  var results = []

  if (!opts.regex && scopedPath.length === 0 && this._ensureLucene()) {
    try {
      var chName = "__mini_a_wiki_searchdb"
      $ch(chName).create("searchdb", { path: this._getLuceneIndexPath(), idField: "id", contentField: "content" })
      var luceneHits = $ch(chName).getAll({ query: q, limit: limit })
      $ch(chName).destroy()
      if (isArray(luceneHits) && luceneHits.length > 0) {
        var validHits = luceneHits.map(function(h) {
          return {
            path: h.id || (isMap(h.payload) ? h.payload.path : __),
            title: isMap(h.payload) && isString(h.payload.title) ? h.payload.title : (h.id || ""),
            line: isNumber(h.line) ? h.line : 1,
            snippet: isString(h.content) ? h.content.substring(0, 180) : q
          }
        }).filter(r => isString(r.path) && r.path.length > 0)
        if (validHits.length > 0) return validHits
      }
    } catch(le) {
      this._logFn("warn", "Lucene search fallback to scan: " + __miniAErrMsg(le))
    }
  }

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

    for (var li = bodyStartLine; li < lines.length && results.length < limit; li++) {
      pattern.lastIndex = 0
      var m = pattern.exec(lines[li])
      if (!m) continue

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

  return results
}

// ── Lint ──────────────────────────────────────────────────────────────────────

MiniAWikiManager.prototype.lint = function(memoryManager, options) {
  var opts      = isObject(options) ? options : {}
  var staleDays = isNumber(opts.staleDays) ? opts.staleDays : 90
  var pages     = this.list("").filter(p => p != "AGENTS.md") // skip AGENTS.md since it's more of a policy doc than a content page
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
    // md links are page-relative; wiki-style links are always root-relative
    pd.linkEntries.forEach(function(entry) {
      var resolved = entry.type === "wiki" ? entry.raw : self.resolveLink(p, entry.raw)
      if (resolved === null) return  // external URL, absolute path, or escapes root — not wiki-internal
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

  // Check 5: Orphaned pages (no incoming links — skip index-like files)
  pages.forEach(function(p) {
    var name = p.replace(/.*\//, "").toLowerCase()
    if (name === "index.md" || name === "readme.md") return
    if ((incomingCount[p] || 0) === 0) {
      issues.push({ severity: "warning", type: "orphan", page: p })
    }
  })

  // Check 6: Near-duplicate page bodies
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

  // Check 7: Memory cross-check (optional)
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
