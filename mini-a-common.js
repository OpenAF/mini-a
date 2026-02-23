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
  candidates = candidates || ["SKILL.md", "skill.md"]
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

/**
 * Reads a skill description from the YAML front-matter of a SKILL.md template.
 * Returns the description string, or undefined if not present / on error.
 *
 * @param {string} templatePath - Absolute path to the template file.
 */
function __miniAReadSkillDescriptionFromTemplate(templatePath) {
  if (!isString(templatePath) || templatePath.trim().length === 0) return __
  try {
    if (!io.fileExists(templatePath) || io.fileInfo(templatePath).isFile !== true) return __
    var content = io.readFileString(templatePath)
    if (!isString(content) || content.length === 0) return __
    var normalized = String(content).replace(/\r\n/g, "\n")
    var frontMatterMatch = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)
    if (!frontMatterMatch || !isString(frontMatterMatch[1])) return __
    var meta = af.fromYAML(frontMatterMatch[1])
    if (!isObject(meta) || !isString(meta.description)) return __
    var description = meta.description.replace(/\s+/g, " ").trim()
    return description.length > 0 ? description : __
  } catch (e) {
    return __
  }
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
