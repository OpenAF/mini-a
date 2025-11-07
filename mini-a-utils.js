// Author: Nuno Aguiar
// License: Apache 2.0
// Description: Mini-A utils tool for basic file operations within a specified root directory

/**
 * <odoc>
 * <key>MiniUtilsTool(options) : MiniUtilsTool</key>
 * Creates a MiniUtilsTool instance to perform file operations within a specified root directory.
 * </odoc>
 */
var MiniUtilsTool = function(options) {
  this._initialized = false
  this._root = null
  this._rootWithSep = null
  this._readWrite = false
  this._separator = String(java.io.File.separator)
  this._listNestedKeys = ["files", "dirs", "children", "items", "list", "entries", "content"]
  if (isDef(options)) {
    this.init(options)
  }
}

/**
 * <odoc>
 * <key>MiniUtilsTool.init(options) : Object</key>
 * Initializes the MiniUtilsTool instance with the specified options.
 *
 * The `options` parameter can be:
 * - A string representing the root directory path.
 * - An object with the following properties:
 *   - `root` (string): The root directory path. Defaults to the current directory (`"."`).
 *   - `readwrite` (boolean): If set to `true`, enables write operations. Defaults to `false` (read-only mode).
 *
 * Returns the MiniUtilsTool instance on success, or an error message string on failure.
 * </odoc>
 */
MiniUtilsTool.prototype.init = function(options) {
  try {
    if (isUnDef(options)) options = {}
    if (isString(options) || options instanceof java.lang.String) options = { root: options }
    var rootPath = options.root || "."
    var rootFile = io.fileInfo(rootPath)
    var canonicalRoot = rootFile.canonicalPath
    if (!io.fileExists(canonicalRoot)) {
      return "[ERROR] Root path not found: " + rootPath
    }
    if (!rootFile.isDirectory) {
      return "[ERROR] Root path is not a directory: " + canonicalRoot
    }

    var info = io.fileInfo(canonicalRoot)
    if (isUnDef(info) || info.isDirectory !== true) {
      return "[ERROR] Unable to load directory information for: " + canonicalRoot
    }

    this._root = canonicalRoot
    this._readWrite = options.readwrite === true
    var sep = String(java.io.File.separator)
    this._separator = sep
    if (canonicalRoot.indexOf(sep, canonicalRoot.length - sep.length) === -1) {
      this._rootWithSep = canonicalRoot + sep
    } else {
      this._rootWithSep = canonicalRoot
    }
    this._initialized = true
    return this
  } catch (e) {
    this._initialized = false
    return "[ERROR] " + (e.message || String(e))
  }
}

MiniUtilsTool.prototype._ensureInitialized = function() {
  if (this._initialized !== true) {
    throw new Error("File context not initialized")
  }
}

MiniUtilsTool.prototype._withinRoot = function(candidate) {
  if (!isString(candidate)) return false
  if (candidate === this._root) return true
  return isString(this._rootWithSep) && candidate.indexOf(this._rootWithSep) === 0
}

MiniUtilsTool.prototype._toRelative = function(targetPath) {
  if (!isString(targetPath)) return targetPath
  if (!this._withinRoot(targetPath)) return targetPath
  var relative = targetPath.substring(this._root.length)
  if (relative.indexOf(this._separator) === 0) {
    relative = relative.substring(this._separator.length)
  }
  if (relative.length === 0) {
    relative = "."
  }
  return relative
}

MiniUtilsTool.prototype._resolve = function(target) {
  var candidate = new java.io.File(target)
  if (!candidate.isAbsolute()) {
    candidate = new java.io.File(this._root, target)
  }
  var resolved = String(candidate.getCanonicalPath())
  if (!this._withinRoot(resolved)) {
    throw new Error("Path outside of allowed root: " + target)
  }
  return resolved
}

MiniUtilsTool.prototype._ensureWritable = function(operation) {
  if (this._readWrite !== true) {
    throw new Error("Read-only mode. Set readwrite=true to allow " + operation)
  }
}

MiniUtilsTool.prototype._listEntries = function(baseDir, options) {
  var self = this
  options = options || {}
  var includeHidden = options.includeHidden === true
  var recursive = options.recursive === true
  var results = []
  var seen = {}

  var pushEntry = function(fullPath) {
    if (!isString(fullPath)) return
    if (!self._withinRoot(fullPath)) return
    if (fullPath === baseDir) return
    if (seen[fullPath]) return
    var fileObj = new java.io.File(fullPath)
    var fileName = String(fileObj.getName())
    if (!includeHidden && (fileObj.isHidden() || fileName.charAt(0) === ".")) return
    var info = io.fileInfo(fullPath)
    if (isUnDef(info)) return
    info.filename = isString(info.filename) ? info.filename : fileName
    info.lastModified = isDef(info.lastModified) ? new Date(info.lastModified) : __
    info.createTime = isDef(info.createTime) ? new Date(info.createTime) : __
    info.lastAccess = isDef(info.lastAccess) ? new Date(info.lastAccess) : __
    info.relativePath = self._toRelative(info.canonicalPath || fullPath)
    info.isDirectory = info.isDirectory === true
    info.isFile = info.isFile === true
    info.hidden = fileObj.isHidden()
    delete info.canonicalPath
    delete info.filepath
    delete info.path
    results.push(info)
    seen[fullPath] = true
  }

  var _traverse = function(value, ctxDir) {
    if (isUnDef(value)) return
    if (isArray(value)) {
      value.forEach(function(entry) {
        _traverse(entry, ctxDir)
      })
      return
    }
    if (isString(value)) {
      try {
        var fromString = new java.io.File(isString(ctxDir) ? ctxDir : baseDir, value)
        var resolved = String(fromString.getCanonicalPath())
        pushEntry(resolved)
      } catch (innerErr) {
      }
      return
    }
    if (isMap(value)) {
      var resolved
      var candidate = value.canonicalPath || value.filepath || value.path
      if (isString(candidate)) {
        try {
          var fileCandidate = new java.io.File(candidate)
          if (!fileCandidate.isAbsolute()) {
            fileCandidate = new java.io.File(isString(ctxDir) ? ctxDir : baseDir, candidate)
          }
          resolved = String(fileCandidate.getCanonicalPath())
          pushEntry(resolved)
        } catch (innerErr2) {
          resolved = null
        }
      } else if (isString(value.filename)) {
        try {
          var parentDir = value.directory
          var baseForName
          if (isString(parentDir)) {
            baseForName = new java.io.File(parentDir)
            if (!baseForName.isAbsolute()) {
              baseForName = new java.io.File(isString(ctxDir) ? ctxDir : baseDir, parentDir)
            }
          } else {
            baseForName = new java.io.File(isString(ctxDir) ? ctxDir : baseDir)
          }
          resolved = String(new java.io.File(baseForName, value.filename).getCanonicalPath())
          pushEntry(resolved)
        } catch (innerErr3) {
          resolved = null
        }
      }

      var childContext = resolved
      if (!isString(childContext) || value.isDirectory !== true) {
        childContext = ctxDir
      }
      self._listNestedKeys.forEach(function(key) {
        if (isDef(value[key])) {
          _traverse(value[key], childContext)
        }
      })
    }
  }

  var fallbackEnumerate = function(currentDir) {
    try {
      var listed = io.listFiles(currentDir).files || []
      if (isArray(listed)) {
        listed.forEach(function(entry) {
          try {
            var childFile = new java.io.File(currentDir, entry)
            var childPath = String(childFile.getCanonicalPath())
            pushEntry(childPath)
            if (recursive) {
              var childInfo = io.fileInfo(childPath)
              if (isDef(childInfo) && childInfo.isDirectory === true) {
                fallbackEnumerate(childPath)
              }
            }
          } catch (innerErr) {
          }
        })
      } else {
        _traverse(listed, currentDir)
      }
    } catch (innerErr2) {
    }
  }

  var raw
  try {
    raw = recursive ? listFilesRecursive(baseDir) : io.listFiles(baseDir).files
  } catch (e) {
    raw = null
  }

  if (isUnDef(raw)) {
    fallbackEnumerate(baseDir)
  } else {
    _traverse(raw, baseDir)
    if (results.length === 0) {
      fallbackEnumerate(baseDir)
    }
  }

  results.sort(function(a, b) {
    var left = isDef(a.relativePath) ? String(a.relativePath) : String(a.path || a.filename || "")
    var right = isDef(b.relativePath) ? String(b.relativePath) : String(b.path || b.filename || "")
    return left.localeCompare(right)
  })

  return results
}

/**
 * <odoc>
 * <key>MiniUtilsTool.readFile(params) : Object</key>
 * Reads the content of a file specified by the `path` parameter.
 * The `params` object can have the following properties:
 * - `path` (string, required): The relative or absolute path to the file to be read.
 * - `encoding` (string, optional): The character encoding to use when reading the file. Defaults to `"utf-8"`.
 *  
 * Returns an object containing file details and content on success, or an error message string on failure.
 * The returned object includes:
 * - `path`: The canonical path of the file.
 * - `relativePath`: The path of the file relative to the root directory.
 * - `encoding`: The encoding used to read the file.
 * - `content`: The content of the file as a string.
 * - Other file metadata such as size, last modified date, etc.
 * </odoc>
 */
MiniUtilsTool.prototype.readFile = function(params) {
  params = params || {}
  if (isUnDef(params.path)) return "[ERROR] path is required"
  try {
    this._ensureInitialized()
    var filePath = this._resolve(params.path)
    if (!io.fileExists(filePath)) {
      return "[ERROR] File not found: " + params.path
    }
    var details = io.fileInfo(filePath)
    if (isUnDef(details) || details.isFile !== true) {
      return "[ERROR] Path is not a file: " + params.path
    }
    var encoding = params.encoding || "utf-8"
    var content = io.readFileString(filePath, encoding)
    details.path = isString(details.canonicalPath) ? details.canonicalPath : filePath
    details.relativePath = this._toRelative(details.path)
    details.encoding = encoding
    details.content = content
    return details
  } catch (e) {
    return "[ERROR] " + (e.message || String(e))
  }
}

/**
 * <odoc>
 * <key>MiniUtilsTool.listDirectory(params) : Array</key>
 * Lists the contents of a directory specified by the `path` parameter.
 * The `params` object can have the following properties:
 * - `path` (string, optional): The relative or absolute path to the directory to be listed. Defaults to the root directory (`"."`).
 * - `includeHidden` (boolean, optional): If set to `true`, includes hidden files and directories in the listing. Defaults to `false`.
 * - `recursive` (boolean, optional): If set to `true`, lists contents recursively. Defaults to `false`.
 * 
 * Returns an array of objects representing the files and directories within the specified directory on success, or an error message string on failure.
 * Each object in the returned array includes:
 * - `relativePath`: The path of the file or directory relative to the root directory.
 * - Other file metadata such as size, last modified date, type (file or directory), etc.
 * </odoc>
 */
MiniUtilsTool.prototype.listDirectory = function(params) {
  params = params || {}
  try {
    this._ensureInitialized()
    var dirPath = this._resolve(isDef(params.path) ? params.path : ".")
    var info = io.fileInfo(dirPath)
    if (isUnDef(info) || info.isDirectory !== true) {
      return "[ERROR] Path is not a directory: " + (isDef(params.path) ? params.path : ".")
    }
    var includeHidden = params.includeHidden === true
    var recursive = params.recursive === true
    return this._listEntries(dirPath, {
      recursive: recursive,
      includeHidden: includeHidden
    })
  } catch (e) {
    return "[ERROR] " + (e.message || String(e))
  }
}

MiniUtilsTool.prototype._collectFiles = function(startPath, recursive) {
  var entries = this._listEntries(startPath, { recursive: recursive, includeHidden: true })
  var files = []
  var self = this
  entries.forEach(function(entry) {
    if (entry.isDirectory === true) return
    try {
      var absolute = self._resolve(entry.relativePath)
      files.push({
        filepath: absolute,
        relativePath: entry.relativePath
      })
    } catch (err) {
    }
  })
  return files
}

/**
 * <odoc>
 * <key>MiniUtilsTool.searchContent(params) : Array</key>
 * Searches for a specified pattern within the content of files starting from a given directory.
 * The `params` object can have the following properties:
 * - `pattern` (string, required): The pattern to search for within the file contents.
 * - `path` (string, optional): The relative or absolute path to the directory or file to start the search from. Defaults to the root directory (`"."`).
 * - `regex` (boolean, optional): If set to `true`, treats the pattern as a regular expression. Defaults to `false`.
 * - `caseSensitive` (boolean, optional): If set to `true`, makes the search case-sensitive. Defaults to `false`.
 * - `recursive` (boolean, optional): If set to `true`, searches files recursively in subdirectories. Defaults to `true`.
 * - `maxResults` (number, optional): The maximum number of results to return. Defaults to `0` (no limit).
 * 
 * Returns an array of objects representing the search results on success, or an error message string on failure.
 * Each object in the returned array includes:
 * - `path`: The canonical path of the file where the pattern was found.
 * - `relativePath`: The path of the file relative to the root directory.
 * - `line`: The line number where the pattern was found.
 * - `preview`: A preview of the line containing the pattern.
 * </odoc>
 */
MiniUtilsTool.prototype.searchContent = function(params) {
  params = params || {}
  if (isUnDef(params.pattern)) return "[ERROR] pattern is required"
  try {
    this._ensureInitialized()
    if (!isString(params.pattern)) {
      return "[ERROR] pattern is required"
    }
    var startPath = this._resolve(isDef(params.path) ? params.path : ".")
    var searchInfo = io.fileInfo(startPath)
    if (isUnDef(searchInfo)) {
      return "[ERROR] Path not found: " + (isDef(params.path) ? params.path : ".")
    }

    var regexMode = params.regex === true
    var caseSensitive = params.caseSensitive === true
    var recursive = params.recursive !== false
    var maxResults = Number(params.maxResults || 0)
    var collected = 0
    var matcher = null
    if (regexMode) {
      var flags = caseSensitive ? "g" : "gi"
      matcher = new RegExp(params.pattern, flags)
    }
    var patternValue = caseSensitive ? params.pattern : String(params.pattern).toLowerCase()
    var files = []
    if (searchInfo.isFile === true) {
      files.push({
        filepath: startPath,
        relativePath: this._toRelative(startPath)
      })
    }
    if (searchInfo.isDirectory === true) {
      files = files.concat(this._collectFiles(startPath, recursive))
    }

    var results = []
    var self = this
    files.some(function(entry) {
      if (maxResults > 0 && collected >= maxResults) return true
      try {
        var content = io.readFileString(entry.filepath)
        var lines = content.split(/\r?\n/)
        for (var i = 0; i < lines.length; i++) {
          if (maxResults > 0 && collected >= maxResults) break
          var line = lines[i]
          var matched = false
          if (regexMode) {
            matcher.lastIndex = 0
            matched = matcher.test(line)
          } else {
            var haystack = caseSensitive ? line : line.toLowerCase()
            matched = haystack.indexOf(patternValue) >= 0
          }
          if (matched) {
            collected++
            results.push({
              path: entry.filepath,
              relativePath: entry.relativePath,
              line: i + 1,
              preview: line
            })
            break
          }
        }
      } catch (err) {
        results.push({ error: err })
      }
      return maxResults > 0 && collected >= maxResults
    })

    return results.filter(function(r) {
      return r != null && isMap(r)
    })
  } catch (e) {
    return "[ERROR] " + (e.message || String(e))
  }
}

/**
 * <odoc>
 * <key>MiniUtilsTool.getFileInfo(params) : Object</key>
 * Retrieves information about a file or directory specified by the `path` parameter.
 * The `params` object can have the following properties:
 * - `path` (string, required): The relative or absolute path to the file or directory.
 * 
 * Returns an object containing file or directory details on success, or an error message string on failure.
 * The returned object includes:
 * - `path`: The canonical path of the file or directory.
 * - `relativePath`: The path of the file or directory relative to the root directory.
 * - Other file metadata such as size, type (file or directory), last modified date, etc.
 * </odoc>
 */
MiniUtilsTool.prototype.getFileInfo = function(params) {
  params = params || {}
  if (isUnDef(params.path)) return "[ERROR] path is required"
  try {
    this._ensureInitialized()
    var filePath = this._resolve(params.path)
    if (!io.fileExists(filePath)) {
      return "[ERROR] Path not found: " + params.path
    }
    var info = io.fileInfo(filePath)
    if (isUnDef(info)) {
      return "[ERROR] Unable to retrieve file info: " + params.path
    }
    info.path = isString(info.canonicalPath) ? info.canonicalPath : filePath
    info.relativePath = this._toRelative(info.path)
    return info
  } catch (e) {
    return "[ERROR] " + (e.message || String(e))
  }
}

/**
 * <odoc>
 * <key>MiniUtilsTool.writeFile(params) : Object</key>
 * Writes content to a file specified by the `path` parameter.
 * The `params` object can have the following properties:
 * - `path` (string, required): The relative or absolute path to the file to be written.
 * - `content` (string, required): The content to write to the file.
 * - `encoding` (string, optional): The character encoding to use when writing the file. Defaults to `"utf-8"`.
 * - `append` (boolean, optional): If set to `true`, appends the content to the file instead of overwriting it. Defaults to `false`.
 * - `createMissingDirs` (boolean, optional): If set to `true`, creates any missing parent directories. Defaults to `true`.
 * 
 * Returns an object containing file details on success, or an error message string on failure.
 * The returned object includes:
 * - `path`: The canonical path of the file.
 * - `relativePath`: The path of the file relative to the root directory.
 * - `encoding`: The encoding used to write the file.
 * - `contentLength`: The length of the content written to the file.
 * - `append`: Indicates whether the content was appended to the file.
 * - Other file metadata such as size, last modified date, etc.
 * </odoc>
 */
MiniUtilsTool.prototype.writeFile = function(params) {
  params = params || {}
  if (isUnDef(params.path)) return "[ERROR] path is required"
  if (isUnDef(params.content)) return "[ERROR] content is required"
  try {
    this._ensureInitialized()
    this._ensureWritable("write operations")
    var filePath = this._resolve(params.path)
    var targetFile = new java.io.File(filePath)
    var parent = targetFile.getParentFile()
    if (params.createMissingDirs !== false && parent !== null && !parent.exists()) {
      parent.mkdirs()
    }
    var encoding = params.encoding || "utf-8"
    io.writeFileString(filePath, params.content, encoding, params.append === true)
    var info = io.fileInfo(filePath)
    if (isDef(info)) {
      info.path = isString(info.canonicalPath) ? info.canonicalPath : filePath
      info.relativePath = this._toRelative(info.path)
      info.encoding = encoding
      info.contentLength = isString(params.content) ? params.content.length : 0
      info.append = params.append === true
      return info
    }
    return {
      path: filePath,
      relativePath: this._toRelative(filePath),
      size: isString(params.content) ? params.content.length : 0,
      encoding: encoding
    }
  } catch (e) {
    return "[ERROR] " + (e.message || String(e))
  }
}

MiniUtilsTool.prototype._deleteRecursive = function(targetPath) {
  var self = this
  var entries = this._listEntries(targetPath, { recursive: true, includeHidden: true })
  entries.sort(function(a, b) {
    var left = String(a.relativePath || "")
    var right = String(b.relativePath || "")
    return right.length - left.length
  })
  entries.forEach(function(entry) {
    try {
      var entryPath = self._resolve(entry.relativePath)
      io.rm(entryPath)
    } catch (err) {
    }
  })
  io.rm(targetPath)
}

/**
 * <odoc>
 * <key>MiniUtilsTool.deleteFile(params) : Object</key>
 * Deletes a file or directory specified by the `path` parameter.
 * The `params` object can have the following properties:
 * - `path` (string, required): The relative or absolute path to the file or directory to be deleted.
 * - `confirm` (boolean, required): Must be set to `true` to confirm the deletion operation.
 * - `recursive` (boolean, optional): If set to `true`, allows deletion of directories and their contents. Defaults to `false`.
 * 
 * Returns an object containing deletion details on success, or an error message string on failure.
 * The returned object includes:
 * - `path`: The canonical path of the deleted file or directory.
 * - `relativePath`: The path of the deleted file or directory relative to the root directory.
 * - `deleted`: A boolean indicating whether the deletion was successful.
 * - `type`: Indicates whether the deleted item was a `"file"` or `"directory"`.
 * </odoc>
 */
MiniUtilsTool.prototype.deleteFile = function(params) {
  params = params || {}
  if (isUnDef(params.path)) return "[ERROR] path is required"
  if (isUnDef(params.confirm)) return "[ERROR] confirm is required"
  try {
    this._ensureInitialized()
    this._ensureWritable("delete operations")
    if (params.confirm !== true) {
      return "[ERROR] Deletion blocked: confirm=true is required"
    }
    var targetPath = this._resolve(params.path)
    if (!io.fileExists(targetPath)) {
      return "[ERROR] Path not found: " + params.path
    }
    var info = io.fileInfo(targetPath)
    if (isUnDef(info)) {
      return "[ERROR] Unable to retrieve target info: " + params.path
    }
    if (info.isDirectory === true && params.recursive !== true) {
      return "[ERROR] Path is a directory. Set recursive=true to delete directories"
    }

    if (info.isDirectory === true) {
      this._deleteRecursive(targetPath)
    } else {
      io.rm(targetPath)
    }
    return {
      path: targetPath,
      relativePath: this._toRelative(targetPath),
      deleted: true,
      type: info.isDirectory === true ? "directory" : "file"
    }
  } catch (e) {
    return "[ERROR] " + (e.message || String(e))
  }
}

MiniUtilsTool.prototype.filesystemQuery = function(params) {
  var payload = isObject(params) ? params : {}
  var opValue = payload.operation
  var normalized = isString(opValue) && opValue.trim().length > 0 ? opValue.trim().toLowerCase() : "read"
  var map = {
    read       : "readFile",
    readfile   : "readFile",
    get        : "readFile",
    view       : "readFile",
    list       : "listDirectory",
    ls         : "listDirectory",
    listdirectory: "listDirectory",
    dir        : "listDirectory",
    search     : "searchContent",
    searchcontent: "searchContent",
    grep       : "searchContent",
    find       : "searchContent",
    info       : "getFileInfo",
    stat       : "getFileInfo",
    metadata   : "getFileInfo",
    getfileinfo: "getFileInfo"
  }
  var target = map[normalized]
  if (!target && isString(opValue) && isFunction(this[opValue])) target = opValue
  if (!target) {
    return "[ERROR] Unknown filesystem query operation: " + (isString(opValue) ? opValue : normalized)
  }

  var innerParams = {}
  for (var key in payload) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue
    if (key === "operation") continue
    innerParams[key] = payload[key]
  }

  try {
    var handler = this[target]
    if (!isFunction(handler)) {
      return "[ERROR] Unsupported filesystem query handler: " + target
    }
    return handler.call(this, innerParams)
  } catch (e) {
    return "[ERROR] " + (e && e.message ? e.message : String(e))
  }
}

MiniUtilsTool.prototype.filesystemModify = function(params) {
  var payload = isObject(params) ? params : {}
  var opValue = payload.operation
  if (!isString(opValue) || opValue.trim().length === 0) {
    return "[ERROR] operation is required"
  }
  var normalized = opValue.trim().toLowerCase()
  var map = {
    write     : "writeFile",
    writefile : "writeFile",
    save      : "writeFile",
    append    : "writeFile",
    delete    : "deleteFile",
    remove    : "deleteFile",
    rm        : "deleteFile",
    deletefile: "deleteFile"
  }
  var target = map[normalized]
  if (!target && isString(opValue) && isFunction(this[opValue])) target = opValue
  if (!target) {
    return "[ERROR] Unknown filesystem modify operation: " + opValue
  }

  var innerParams = {}
  for (var key in payload) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue
    if (key === "operation") continue
    innerParams[key] = payload[key]
  }
  if (normalized === "append" && innerParams.append !== true) {
    innerParams.append = true
  }

  try {
    var handler = this[target]
    if (!isFunction(handler)) {
      return "[ERROR] Unsupported filesystem modify handler: " + target
    }
    return handler.call(this, innerParams)
  } catch (e) {
    return "[ERROR] " + (e && e.message ? e.message : String(e))
  }
}

/**
 * <odoc>
 * <key>MiniUtilsTool.mathematics(params) : Object</key>
 * Performs mathematical operations including calculations, statistics, unit conversions, and random number generation.
 * The `params` object can have the following properties:
 * - `operation` (string, required): The operation to perform (calculate, statistics, convert-unit, random).
 * - For calculate: `op` (add, subtract, multiply, divide, power, sqrt, abs, round), `values` (array of numbers), `precision` (optional)
 * - For statistics: `values` (array of numbers), `metrics` (optional array of: mean, median, min, max, sum, count)
 * - For convert-unit: `value` (number), `fromUnit` (string), `toUnit` (string), `precision` (optional)
 * - For random: `type` (integer, sequence, choice, boolean, hex), type-specific params (min/max, items, count, seed, etc.)
 * </odoc>
 */
MiniUtilsTool.prototype.mathematics = function(params) {
  params = params || {}
  var op = (params.operation || "calculate").toLowerCase()

  try {
    if (op === "calculate") {
      var mathOp = (params.op || "add").toLowerCase()
      var values = params.values || []
      if (!isArray(values) || values.length === 0) return "[ERROR] values array required"

      var ops = {
        add: function(v) { return v.reduce(function(a,b){return a+b}, 0) },
        subtract: function(v) { return v.reduce(function(a,b){return a-b}) },
        multiply: function(v) { return v.reduce(function(a,b){return a*b}, 1) },
        divide: function(v) { return v.reduce(function(a,b){if(b===0)throw"Division by zero";return a/b}) },
        power: function(v) { if(v.length!==2)throw"Power requires 2 values";return Math.pow(v[0],v[1]) },
        sqrt: function(v) { if(v.length!==1)throw"Sqrt requires 1 value";return Math.sqrt(v[0]) },
        abs: function(v) { if(v.length!==1)throw"Abs requires 1 value";return Math.abs(v[0]) },
        round: function(v) { if(v.length!==1)throw"Round requires 1 value";return Math.round(v[0]) }
      }

      if (!ops[mathOp]) return "[ERROR] Unknown operation: " + mathOp
      var result = ops[mathOp](values.map(Number))
      if (isDef(params.precision)) result = Number(result.toFixed(params.precision))
      return { operation: mathOp, values: values, result: result }

    } else if (op === "statistics") {
      var vals = (params.values || []).map(Number).sort(function(a,b){return a-b})
      if (vals.length === 0) return "[ERROR] values array required"

      var sum = vals.reduce(function(a,b){return a+b}, 0)
      var mean = sum / vals.length
      var n = vals.length
      var median = n % 2 === 0 ? (vals[n/2-1] + vals[n/2])/2 : vals[Math.floor(n/2)]

      var all = { count: n, sum: sum, mean: mean, median: median, min: vals[0], max: vals[n-1] }
      if (isDef(params.metrics) && isArray(params.metrics)) {
        var result = {}
        params.metrics.forEach(function(m) { if (all[m]) result[m] = all[m] })
        return result
      }
      return all

    } else if (op === "convert-unit" || op === "convert") {
      var value = Number(params.value)
      var from = String(params.fromUnit || "").toLowerCase()
      var to = String(params.toUnit || "").toLowerCase()

      var conversions = {
        m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, ft: 0.3048, in: 0.0254,
        kg: 1, g: 0.001, lb: 0.453592, oz: 0.0283495,
        l: 1, ml: 0.001, gal: 3.78541
      }

      if (!conversions[from] || !conversions[to]) return "[ERROR] Unknown unit"
      var result = (value * conversions[from]) / conversions[to]
      if (isDef(params.precision)) result = Number(result.toFixed(params.precision))
      return { value: value, fromUnit: from, toUnit: to, result: result }

    } else if (op === "random") {
      var Random = java.util.Random
      var seed = params.seed
      var rng = isDef(seed) ? new Random(Number(seed)) : new Random()
      var type = (params.type || "integer").toLowerCase()

      if (type === "integer") {
        var min = Math.ceil(Number(params.min || 0))
        var max = Math.floor(Number(params.max || 100))
        if (min > max) return "[ERROR] min must be <= max"
        var range = max - min + 1
        var value = min + rng.nextInt(range)
        return { type: type, min: min, max: max, value: Number(value), seed: isDef(seed) ? Number(seed) : null }

      } else if (type === "sequence") {
        var start = Math.ceil(Number(params.start || 0))
        var end = Math.floor(Number(params.end || 10))
        if (start > end) return "[ERROR] start must be <= end"

        var seq = []
        for (var i = start; i <= end; i++) seq.push(i)
        for (var i = seq.length - 1; i > 0; i--) {
          var j = rng.nextInt(i + 1)
          var temp = seq[i]; seq[i] = seq[j]; seq[j] = temp
        }

        var count = isDef(params.count) ? Math.min(seq.length, Math.max(0, params.count)) : seq.length
        return { type: type, start: start, end: end, count: count, sequence: seq.slice(0, count), seed: isDef(seed) ? Number(seed) : null }

      } else if (type === "choice") {
        var items = params.items
        if (!isArray(items) || items.length === 0) return "[ERROR] items array required"

        var count = Math.max(1, Math.floor(Number(params.count || 1)))
        var unique = params.unique === true

        if (unique && count > items.length) return "[ERROR] count exceeds unique items"

        var results = []
        if (unique) {
          var indices = items.map(function(_, i) { return i })
          for (var i = indices.length - 1; i > 0; i--) {
            var j = rng.nextInt(i + 1)
            var temp = indices[i]; indices[i] = indices[j]; indices[j] = temp
          }
          for (var i = 0; i < count; i++) results.push(items[indices[i]])
        } else {
          for (var i = 0; i < count; i++) results.push(items[rng.nextInt(items.length)])
        }

        return { type: type, count: count, unique: unique, choices: results, seed: isDef(seed) ? Number(seed) : null }

      } else if (type === "boolean") {
        var count = Math.max(1, Math.floor(Number(params.count || 1)))
        var prob = Number(params.probabilityTrue || 0.5)
        if (prob < 0 || prob > 1) return "[ERROR] probabilityTrue must be 0-1"

        var values = []
        for (var i = 0; i < count; i++) values.push(rng.nextDouble() < prob)
        return { type: type, count: count, probabilityTrue: prob, values: values, seed: isDef(seed) ? Number(seed) : null }

      } else if (type === "hex") {
        var length = Math.max(1, Math.floor(Number(params.length || 16)))
        var upper = params.uppercase === true
        var chars = upper ? "0123456789ABCDEF" : "0123456789abcdef"

        var result = ""
        for (var i = 0; i < length; i++) result += chars.charAt(rng.nextInt(16))
        return { type: type, length: length, uppercase: upper, value: result, seed: isDef(seed) ? Number(seed) : null }
      }

      return "[ERROR] Unknown random type: " + type
    }

    return "[ERROR] Unknown operation: " + op
  } catch (e) {
    return "[ERROR] " + (e.message || String(e))
  }
}

/**
 * <odoc>
 * <key>MiniUtilsTool.timeUtilities(params) : Object</key>
 * Performs time and timezone operations.
 * The `params` object can have the following properties:
 * - `operation` (string): The operation to perform (current-time, convert, sleep). Defaults to current-time.
 * - For current-time: `timezone` (optional IANA timezone), `format` (optional Java time pattern)
 * - For convert: `targetTimezone` (required), `sourceTimezone` (optional), `datetime` (optional ISO string)
 * - For sleep: `milliseconds` (required)
 * </odoc>
 */
MiniUtilsTool.prototype.timeUtilities = function(params) {
  params = params || {}
  var op = (params.operation || "current-time").toLowerCase()

  try {
    if (op === "current-time" || op === "current") {
      var ZoneId = java.time.ZoneId
      var ZonedDateTime = java.time.ZonedDateTime
      var DateTimeFormatter = java.time.format.DateTimeFormatter

      var zone = isDef(params.timezone) ? ZoneId.of(params.timezone) : ZoneId.systemDefault()
      var now = ZonedDateTime.now(zone)
      var pattern = params.format || "yyyy-MM-dd'T'HH:mm:ssXXX"
      var formatter = DateTimeFormatter.ofPattern(pattern)

      return {
        timezone: String(zone.getId()),
        iso8601: String(now.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)),
        formatted: String(now.format(formatter)),
        unixEpochSeconds: Number(now.toEpochSecond()),
        unixEpochMilliseconds: Number(now.toInstant().toEpochMilli())
      }

    } else if (op === "convert" || op === "timezone-convert") {
      if (isUnDef(params.targetTimezone)) return "[ERROR] targetTimezone required"

      var ZoneId = java.time.ZoneId
      var ZonedDateTime = java.time.ZonedDateTime
      var DateTimeFormatter = java.time.format.DateTimeFormatter

      var sourceZone = isDef(params.sourceTimezone) ? ZoneId.of(params.sourceTimezone) : ZoneId.systemDefault()
      var targetZone = ZoneId.of(params.targetTimezone)
      var dt = isDef(params.datetime) ? ZonedDateTime.parse(params.datetime) : ZonedDateTime.now(sourceZone)
      var converted = dt.withZoneSameInstant(targetZone)

      return {
        sourceTimezone: String(sourceZone.getId()),
        targetTimezone: String(targetZone.getId()),
        sourceIso8601: String(dt.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)),
        targetIso8601: String(converted.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME))
      }

    } else if (op === "sleep") {
      var duration = Number(params.milliseconds || 0)
      if (duration < 0) return "[ERROR] milliseconds must be non-negative"
      sleep(duration, true)
      return { sleptMilliseconds: duration }
    }

    return "[ERROR] Unknown operation: " + op
  } catch (e) {
    return "[ERROR] " + (e.message || String(e))
  }
}

MiniUtilsTool._metadataByFn = (function() {
  var queryReadOps = ["read", "readfile", "get", "view"]
  var queryListOps = ["list", "ls", "listdirectory", "dir"]
  var querySearchOps = ["search", "searchcontent", "grep", "find"]
  var queryInfoOps = ["info", "stat", "metadata", "getfileinfo"]
  var queryReadInfoOps = queryReadOps.concat(queryInfoOps)
  var queryAllOps = queryReadOps
    .concat(queryListOps)
    .concat(querySearchOps)
    .concat(queryInfoOps)

  var modifyWriteOps = ["write", "writefile", "save", "append"]
  var modifyDeleteOps = ["delete", "remove", "rm", "deletefile"]
  var modifyAllOps = modifyWriteOps.concat(modifyDeleteOps)

  var mathOperationTypes = ["calculate", "statistics", "convert-unit", "convert", "random"]
  var timeOperationTypes = ["current-time", "current", "timezone-convert", "sleep"]

  return {
    init: {
      name       : "init",
      description: "Re-initialize the MiniUtilsTool with a new root directory and permissions for file operations.",
      inputSchema: {
        type      : "object",
        properties: {
          root     : { type: "string", description: "Root directory for subsequent file operations. Defaults to current directory." },
          readwrite: { type: "boolean", description: "Enable write and delete operations when set to true." }
        }
      }
    },
    filesystemQuery: {
      name       : "filesystemQuery",
      description: "Execute read-only filesystem actions such as reading file contents, listing directories, searching text, or retrieving metadata within the configured root.",
      inputSchema: {
        type      : "object",
        properties: {
          operation    : {
            type       : "string",
            description: "Operation to execute (read, list, search, info). Defaults to \"read\".",
            enum       : queryAllOps,
            default    : "read"
          },
          path         : { type: "string", description: "Target file or directory path for the operation." },
          encoding     : { type: "string", description: "Character encoding to use when reading files." },
          includeHidden: { type: "boolean", description: "Include hidden files in list operations when true." },
          recursive    : { type: "boolean", description: "Traverse directories recursively when supported." },
          pattern      : { type: "string", description: "Pattern to search for when operation is set to search." },
          regex        : { type: "boolean", description: "Treat pattern as a regular expression when operation is search." },
          caseSensitive: { type: "boolean", description: "Perform case-sensitive searches when operation is search." },
          maxResults   : { type: "number", description: "Maximum number of search matches to return (0 means no limit)." }
        },
        allOf    : [
          {
            if  : { not: { required: ["operation"] } },
            then: { required: ["path"] }
          },
          {
            if  : { required: ["operation"], properties: { operation: { enum: queryReadInfoOps } } },
            then: { required: ["path"] }
          },
          {
            if  : { required: ["operation"], properties: { operation: { enum: querySearchOps } } },
            then: { required: ["pattern"] }
          }
        ]
      }
    },
    filesystemModify: {
      name       : "filesystemModify",
      description: "Perform write, append, or delete operations on files and directories within the configured root (requires readwrite=true).",
      inputSchema: {
        type      : "object",
        properties: {
          operation        : {
            type       : "string",
            description: "Operation to execute (write, append, delete).",
            enum       : modifyAllOps
          },
          path             : { type: "string", description: "Target file or directory path for the operation." },
          content          : { type: "string", description: "Content to write when operation is set to write or append." },
          encoding         : { type: "string", description: "Character encoding to use when writing content." },
          append           : { type: "boolean", description: "Append to the file instead of overwriting when supported." },
          createMissingDirs: { type: "boolean", description: "Create parent directories when writing files if they do not exist." },
          confirm          : { type: "boolean", description: "Must be true to confirm deletion operations." },
          recursive        : { type: "boolean", description: "Delete directories and their contents recursively when true." }
        },
        required : ["operation", "path"],
        allOf    : [
          {
            if  : { required: ["operation"], properties: { operation: { enum: modifyWriteOps } } },
            then: { required: ["content"] }
          },
          {
            if  : { required: ["operation"], properties: { operation: { enum: modifyDeleteOps } } },
            then: { required: ["confirm"] }
          }
        ]
      }
    },
    mathematics: {
      name       : "mathematics",
      description: "Run mathematical utilities including arithmetic calculations, descriptive statistics, unit conversions, and random value generation.",
      inputSchema: {
        type      : "object",
        properties: {
          operation: {
            type       : "string",
            description: "Operation type: calculate, statistics, convert-unit, or random.",
            enum       : mathOperationTypes,
            default    : "calculate"
          },
          op           : { type: "string", description: "Math operation for calculate: add, subtract, multiply, divide, power, sqrt, abs, round." },
          values       : { type: "array", items: { type: "number" }, description: "Array of numbers for calculate or statistics operations." },
          precision    : { type: "number", description: "Decimal precision for rounding results." },
          metrics      : { type: "array", items: { type: "string" }, description: "Specific metrics for statistics: mean, median, min, max, sum, count." },
          value        : { type: "number", description: "Value to convert for convert-unit operation." },
          fromUnit     : { type: "string", description: "Source unit for conversion (m, km, cm, mm, mi, ft, in, kg, g, lb, oz, l, ml, gal)." },
          toUnit       : { type: "string", description: "Target unit for conversion." },
          type         : { type: "string", description: "Random type: integer, sequence, choice, boolean, hex." },
          min          : { type: "number", description: "Minimum value for random integer." },
          max          : { type: "number", description: "Maximum value for random integer or sequence end." },
          start        : { type: "number", description: "Start value for random sequence." },
          end          : { type: "number", description: "End value for random sequence." },
          count        : { type: "number", description: "Count of items to generate or select." },
          items        : { type: "array", description: "Array of items for random choice." },
          unique       : { type: "boolean", description: "Ensure unique choices when true." },
          seed         : { type: "number", description: "Seed for deterministic random generation." },
          probabilityTrue: { type: "number", description: "Probability (0-1) for random boolean generation." },
          length       : { type: "number", description: "Length of random hex string." },
          uppercase    : { type: "boolean", description: "Use uppercase for hex string." }
        },
        required : []
      }
    },
    timeUtilities: {
      name       : "timeUtilities",
      description: "Work with time by returning the current time, converting between time zones, or pausing execution.",
      inputSchema: {
        type      : "object",
        properties: {
          operation     : {
            type       : "string",
            description: "Operation type: current-time, convert, or sleep.",
            enum       : timeOperationTypes,
            default    : "current-time"
          },
          timezone       : { type: "string", description: "IANA timezone identifier (e.g., 'America/New_York', 'Europe/London')." },
          format         : { type: "string", description: "Java time pattern for formatting (e.g., 'yyyy-MM-dd HH:mm:ss')." },
          targetTimezone : { type: "string", description: "Target timezone for conversion (required for convert operation)." },
          sourceTimezone : { type: "string", description: "Source timezone for conversion (defaults to system timezone)." },
          datetime       : { type: "string", description: "ISO 8601 datetime string for conversion (defaults to current time)." },
          milliseconds   : { type: "number", description: "Duration in milliseconds for sleep operation." }
        },
        required : []
      }
    }
  }
})()

MiniUtilsTool.getMetadataByFn = function() {
  return MiniUtilsTool._metadataByFn || {}
}

MiniUtilsTool.getExposedMethodNames = function() {
  var metadata = MiniUtilsTool.getMetadataByFn()
  return Object.keys(metadata)
}
