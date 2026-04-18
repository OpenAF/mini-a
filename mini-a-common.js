// Author: Nuno Aguiar
// License: Apache 2.0
// Description: Shared utility functions used across mini-a components.

/**
 * Returns a formatted error message string from an error value.
 * Replaces the repeated `(e.message || String(e))` / `(isDef(e) && isString(e.message)) ? e.message : e` pattern.
 */
function __miniAErrMsg(e) {
  return (isDef(e) && isString(e.message)) ? e.message : String(e)
}

/**
 * Resolves the canonical path to a SKILL.md template within a folder.
 * Returns the path string if found, or undefined if not found.
 *
 * @param {string} folderPath - The folder to look inside.
 * @param {string[]} [candidates] - Filenames to try (default: ["SKILL.md", "skill.md"]).
 */
function __miniAResolveSkillTemplateFromFolder(folderPath, candidates) {
  candidates = candidates || ["SKILL.yaml", "SKILL.yml", "SKILL.json", "SKILL.md", "skill.md"]
  if (!isString(folderPath) || folderPath.trim().length === 0) return __
  for (var i = 0; i < candidates.length; i++) {
    try {
      var candidatePath = String(new java.io.File(folderPath, candidates[i]).getCanonicalPath())
      if (!io.fileExists(candidatePath)) continue
      var info = io.fileInfo(candidatePath)
      if (isDef(info) && info.isFile === true) return candidatePath
    } catch (e) {}
  }
  return __
}

function __miniASkillTemplateFormatFromPath(templatePath) {
  if (!isString(templatePath)) return "markdown"
  var lower = templatePath.toLowerCase()
  if (/\.ya?ml$/i.test(lower)) return "yaml"
  if (/\.json$/i.test(lower)) return "json"
  return "markdown"
}

function __miniAShouldIgnoreSkillEntryName(entryName, includeHidden) {
  if (!isString(entryName) || entryName.length === 0) return true
  if (String(entryName).toLowerCase().endsWith(".disabled")) return true
  if (includeHidden !== true && entryName.indexOf(".") === 0) return true
  return false
}

function __miniAExtractFrontMatterMeta(markdownText) {
  var meta = __
  var body = isString(markdownText) ? String(markdownText) : String(markdownText || "")
  var normalized = body.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n")
  var frontMatterMatch = normalized.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/)
  if (frontMatterMatch && isString(frontMatterMatch[1])) {
    try {
      var parsed = af.fromYAML(frontMatterMatch[1])
      if (isObject(parsed)) meta = parsed
    } catch (ignoreMetaParseError) {}
    body = normalized.substring(frontMatterMatch[0].length)
  } else {
    body = normalized
  }
  return {
    meta: isObject(meta) ? meta : __,
    body: body
  }
}

function __miniASanitizeVirtualSkillPath(pathValue) {
  if (!isString(pathValue)) return __
  var normalized = pathValue.trim().replace(/\\/g, "/")
  if (normalized.length === 0) return __
  if (normalized.charAt(0) === "/") return __
  if (/^[A-Za-z]:\//.test(normalized)) return __
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) return __
  if (normalized.indexOf("..") >= 0) return __
  while (normalized.indexOf("//") >= 0) normalized = normalized.replace(/\/\//g, "/")
  if (normalized.length === 0 || normalized === ".") return __
  if (normalized.indexOf("./") === 0) normalized = normalized.substring(2)
  return normalized.length > 0 ? normalized : __
}

function __miniANormalizeSkillVirtualFiles(skillDoc) {
  var files = {}

  function joinPath(basePath, childPath) {
    if (!isString(childPath)) return __
    var sanitizedChild = __miniASanitizeVirtualSkillPath(childPath)
    if (!isString(sanitizedChild)) return __
    if (!isString(basePath) || basePath.length === 0) return sanitizedChild
    var merged = basePath + "/" + sanitizedChild
    return __miniASanitizeVirtualSkillPath(merged)
  }

  function appendFile(pathKey, value) {
    var normalizedPath = __miniASanitizeVirtualSkillPath(pathKey)
    if (!isString(normalizedPath)) return
    if (isUnDef(value) || value === null) {
      files[normalizedPath] = ""
      return
    }
    if (isString(value) || value instanceof java.lang.String) {
      files[normalizedPath] = String(value)
      return
    }
    if (isObject(value)) {
      if (isString(value.body)) {
        files[normalizedPath] = value.body
        return
      }
      if (isString(value.content)) {
        files[normalizedPath] = value.content
        return
      }
      if (isString(value.text)) {
        files[normalizedPath] = value.text
        return
      }
      files[normalizedPath] = ""
      return
    }
    files[normalizedPath] = String(value)
  }

  function visitRefs(refsMap, basePath) {
    if (!isObject(refsMap)) return
    Object.keys(refsMap).forEach(function(rawKey) {
      var refValue = refsMap[rawKey]
      var key = isString(rawKey) ? rawKey : String(rawKey)
      var joined = joinPath(basePath, key)
      if (!isString(joined)) return
      if (isObject(refValue) && isObject(refValue.refs)) {
        visitRefs(refValue.refs, joined)
        if (isString(refValue.body) || isString(refValue.content) || isString(refValue.text)) appendFile(joined, refValue)
        return
      }
      appendFile(joined, refValue)
    })
  }

  function visitChildren(children, basePath) {
    if (!isArray(children)) return
    children.forEach(function(child) {
      if (!isObject(child)) return
      var childPath = isString(child.path) ? child.path : ""
      var childBase = basePath
      if (childPath.length > 0) {
        childBase = joinPath(basePath, childPath)
        if (!isString(childBase)) childBase = basePath
      }
      if (isObject(child.refs)) visitRefs(child.refs, childBase)
      if (isArray(child.children)) visitChildren(child.children, childBase)
    })
  }

  if (isObject(skillDoc)) {
    if (isObject(skillDoc.refs)) visitRefs(skillDoc.refs, "")
    if (isArray(skillDoc.children)) visitChildren(skillDoc.children, "")
  }
  return files
}

function __miniALoadSkillTemplateDocument(templatePath) {
  if (!isString(templatePath) || templatePath.trim().length === 0) return __
  if (!io.fileExists(templatePath) || io.fileInfo(templatePath).isFile !== true) return __
  var raw = io.readFileString(templatePath)
  if (!isString(raw)) raw = String(raw || "")
  var format = __miniASkillTemplateFormatFromPath(templatePath)

  if (format === "markdown") {
    var md = __miniAExtractFrontMatterMeta(raw)
    var mdMeta = isObject(md.meta) ? md.meta : {}
    var mdDescription = isString(mdMeta.description) ? mdMeta.description.replace(/\s+/g, " ").trim() : ""
    return {
      format      : "markdown",
      rawContent  : raw,
      bodyTemplate: isString(md.body) ? md.body : "",
      description : mdDescription.length > 0 ? mdDescription : __,
      meta        : mdMeta,
      virtualFiles: {}
    }
  }

  var parsed
  try {
    parsed = format === "json" ? jsonParse(raw) : af.fromYAML(raw)
  } catch (parseError) {
    parsed = __
  }
  if (!isObject(parsed)) return __
  var bodyTemplate = ""
  if (isString(parsed.body)) bodyTemplate = parsed.body
  if (bodyTemplate.length === 0 && isString(parsed.goal)) bodyTemplate = parsed.goal
  var description = ""
  if (isString(parsed.summary)) description = parsed.summary
  if (description.length === 0 && isString(parsed.description)) description = parsed.description
  if (description.length === 0 && isObject(parsed.meta) && isString(parsed.meta.description)) description = parsed.meta.description
  description = isString(description) ? description.replace(/\s+/g, " ").trim() : ""

  return {
    format      : format,
    rawContent  : raw,
    bodyTemplate: bodyTemplate,
    description : description.length > 0 ? description : __,
    meta        : isObject(parsed.meta) ? parsed.meta : {},
    skillData   : parsed,
    virtualFiles: __miniANormalizeSkillVirtualFiles(parsed)
  }
}

/**
 * Reads a skill description from the YAML front-matter of a SKILL.md template.
 * Returns the description string, or undefined if not present / on error.
 *
 * @param {string} templatePath - Absolute path to the template file.
 */
function __miniAReadSkillDescriptionFromTemplate(templatePath) {
  if (!isString(templatePath) || templatePath.trim().length === 0) return __
  try {
    var loaded = __miniALoadSkillTemplateDocument(String(templatePath))
    if (!isObject(loaded) || !isString(loaded.description)) return __
    var description = loaded.description.replace(/\s+/g, " ").trim()
    return description.length > 0 ? description : __
  } catch (e) {
    return __
  }
}

/**
 * Removes leading YAML front-matter from markdown content when present.
 * Intended for slash command / skill template processing, so metadata blocks
 * used for listing do not leak into rendered prompts.
 *
 * @param {string} markdownText - Raw markdown text.
 * @returns {string} markdown without the leading front-matter block.
 */
function __miniAStripMarkdownFrontMatter(markdownText) {
  if (!isString(markdownText) || markdownText.length === 0) return ""
  var normalized = String(markdownText).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n")
  var frontMatterMatch = normalized.match(/^---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/)
  if (!frontMatterMatch) return normalized
  return normalized.substring(frontMatterMatch[0].length)
}

/**
 * Renders a skill template by substituting {{args}}, {{argv}}, {{argc}},
 * and positional {{arg1}}…{{argN}} placeholders.
 * If the template contains no placeholders but arguments were provided,
 * arguments are auto-appended.
 *
 * @param {string}  template   - The raw template text.
 * @param {object}  parsedArgs - Object with `raw` (string), `argv` (array), `argc` (number).
 */
function __miniARenderSkillTemplate(template, parsedArgs) {
  var rendered = isString(template) ? template : String(template || "")
  var replacedAny = false
  var args = isObject(parsedArgs) ? parsedArgs : { raw: "", argv: [], argc: 0 }

  function replaceAll(placeholder, value) {
    if (rendered.indexOf(placeholder) >= 0) {
      replacedAny = true
      rendered = rendered.split(placeholder).join(value)
    }
  }

  var argvString = "[]"
  try {
    argvString = stringify(args.argv || [], __, "")
  } catch (e) {
    argvString = "[]"
  }

  replaceAll("{{args}}", args.raw || "")
  replaceAll("{{argv}}", argvString)
  replaceAll("{{argc}}", String(isNumber(args.argc) ? args.argc : 0))

  rendered = rendered.replace(/\{\{arg([1-9][0-9]*)\}\}/g, function(_, indexStr) {
    replacedAny = true
    var idx = Number(indexStr) - 1
    if (!isNaN(idx) && idx >= 0 && isArray(args.argv) && idx < args.argv.length) return args.argv[idx]
    return ""
  })

  if ((args.argc || 0) > 0 && replacedAny !== true) {
    rendered += "\n\nArguments (auto-appended):\n"
    rendered += "- raw: " + (args.raw || "") + "\n"
    rendered += "- argv: " + argvString + "\n"
    rendered += "- argc: " + (args.argc || 0) + "\n"
  }

  return rendered
}

/**
 * Builds a compact tool manifest array for /list-tools responses.
 * When proxyState is provided (mcpproxy=true), reads from the proxy connection catalog
 * so the listing is proxy-aware (includes connection alias).
 * Without proxyState, falls back to the plain tools array.
 *
 * @param {Array}   tools      - agent.mcpTools array (fallback when no proxy state)
 * @param {Object}  [proxyState] - global.__mcpProxyState__ when mcpproxy=true
 * @param {boolean} [withSchema] - if true, include inputSchema per tool
 * @returns {Array} compact tool entries: { name, description[, connection][, inputSchema] }
 */
function __miniABuildCompactToolManifest(tools, proxyState, withSchema) {
  withSchema = withSchema === true
  var result = []

  if (isObject(proxyState) && isObject(proxyState.connections)) {
    Object.keys(proxyState.connections).forEach(function(connId) {
      var conn = proxyState.connections[connId]
      if (!isObject(conn) || !isArray(conn.tools)) return
      var alias = isString(conn.alias) ? conn.alias : connId
      conn.tools.forEach(function(tool) {
        if (!isObject(tool) || !isString(tool.name)) return
        if (tool.name === "proxy-dispatch") return
        var desc = isString(tool.description) ? tool.description : ""
        var entry = {
          name       : tool.name,
          description: desc.split("\n")[0].trim(),
          connection : alias
        }
        if (withSchema && isObject(tool.inputSchema)) entry.inputSchema = tool.inputSchema
        result.push(entry)
      })
    })
  } else if (isArray(tools)) {
    tools.forEach(function(tool) {
      if (!isObject(tool) || !isString(tool.name)) return
      var desc = isString(tool.description) ? tool.description : ""
      var entry = {
        name       : tool.name,
        description: desc.split("\n")[0].trim()
      }
      if (withSchema && isObject(tool.inputSchema)) entry.inputSchema = tool.inputSchema
      result.push(entry)
    })
  }

  return result
}

/**
 * Loads additional libraries from a comma-separated string.
 * Supports both plain file paths and @oPack/library.js notation.
 *
 * @param {string}   libsString - Comma-separated list of library paths.
 * @param {function} [logFn]    - Called with informational messages (default: log).
 * @param {function} [errFn]    - Called with error messages (default: logErr).
 */
function __miniALoadLibraries(libsString, logFn, errFn) {
  if (!isString(libsString) || libsString.trim().length === 0) return
  logFn = isFunction(logFn) ? logFn : function(msg) { log(msg) }
  errFn = isFunction(errFn) ? errFn : function(msg) { logErr(msg) }
  libsString.split(",").map(function(r) { return r.trim() }).filter(function(r) { return r.length > 0 }).forEach(function(lib) {
    logFn("Loading library: " + lib + "...")
    try {
      if (lib.startsWith("@")) {
        if (/^\@([^\/]+)\/(.+)\.js$/.test(lib)) {
          var _ar = lib.match(/^\@([^\/]+)\/(.+)\.js$/)
          var _path = getOPackPath(_ar[1])
          var _file = _path + "/" + _ar[2] + ".js"
          if (io.fileExists(_file)) {
            loadLib(_file)
          } else {
            errFn("Library '" + lib + "' not found.")
          }
        } else {
          errFn("Library '" + lib + "' does not have the correct format (@oPack/library.js).")
        }
      } else {
        loadLib(lib)
      }
    } catch(e) {
      errFn("Failed to load library " + lib + ": " + __miniAErrMsg(e))
    }
  })
}
