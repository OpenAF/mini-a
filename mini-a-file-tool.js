// Author: Nuno Aguiar
// License: Apache 2.0
// Description: Mini-A file tool for basic file operations within a specified root directory

/**
 * <odoc>
 * <key>MiniFileTool(options) : MiniFileTool</key>
 * Creates a MiniFileTool instance to perform file operations within a specified root directory.
 * </odoc>
 */
var MiniFileTool = function(options) {
  this._FileClass = Packages.java.io.File
  this._initialized = false
  this._root = null
  this._rootWithSep = null
  this._readWrite = false
  this._separator = String(this._FileClass.separator)
  this._listNestedKeys = ["files", "dirs", "children", "items", "list", "entries", "content"]
  if (isDef(options)) {
    this.init(options)
  }
}

/**
 * <odoc>
 * <key>MiniFileTool.init(options) : Object</key>
 * Initializes the MiniFileTool instance with the specified options.
 *
 * The `options` parameter can be:
 * - A string representing the root directory path.
 * - An object with the following properties:
 *   - `root` (string): The root directory path. Defaults to the current directory (`"."`).
 *   - `readwrite` (boolean): If set to `true`, enables write operations. Defaults to `false` (read-only mode).
 *
 * Returns the MiniFileTool instance on success, or an error message string on failure.
 * </odoc>
 */
MiniFileTool.prototype.init = function(options) {
  try {
    if (isUnDef(options)) options = {}
    if (isString(options)) options = { root: options }
    var File = this._FileClass
    var rootPath = options.root || "."
    var rootFile = new File(rootPath)
    var canonicalRoot = String(rootFile.getCanonicalPath())
    if (!rootFile.exists()) {
      return "[ERROR] Root path not found: " + rootPath
    }
    if (!rootFile.isDirectory()) {
      return "[ERROR] Root path is not a directory: " + canonicalRoot
    }

    var info = io.fileInfo(canonicalRoot)
    if (isUnDef(info) || info.isDirectory !== true) {
      return "[ERROR] Unable to load directory information for: " + canonicalRoot
    }

    this._root = canonicalRoot
    this._readWrite = options.readwrite === true
    var sep = String(File.separator)
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

MiniFileTool.prototype._ensureInitialized = function() {
  if (this._initialized !== true) {
    throw new Error("File context not initialized")
  }
}

MiniFileTool.prototype._withinRoot = function(candidate) {
  if (!isString(candidate)) return false
  if (candidate === this._root) return true
  return isString(this._rootWithSep) && candidate.indexOf(this._rootWithSep) === 0
}

MiniFileTool.prototype._toRelative = function(targetPath) {
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

MiniFileTool.prototype._resolve = function(target) {
  var File = this._FileClass
  var candidate = new File(target)
  if (!candidate.isAbsolute()) {
    candidate = new File(this._root, target)
  }
  var resolved = String(candidate.getCanonicalPath())
  if (!this._withinRoot(resolved)) {
    throw new Error("Path outside of allowed root: " + target)
  }
  return resolved
}

MiniFileTool.prototype._ensureWritable = function(operation) {
  if (this._readWrite !== true) {
    throw new Error("Read-only mode. Set readwrite=true to allow " + operation)
  }
}

MiniFileTool.prototype._listEntries = function(baseDir, options) {
  var self = this
  options = options || {}
  var includeHidden = options.includeHidden === true
  var recursive = options.recursive === true
  var results = []
  var seen = {}
  var FileRef = this._FileClass

  var pushEntry = function(fullPath) {
    if (!isString(fullPath)) return
    if (!self._withinRoot(fullPath)) return
    if (fullPath === baseDir) return
    if (seen[fullPath]) return
    var fileObj = new FileRef(fullPath)
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
        var fromString = new FileRef(isString(ctxDir) ? ctxDir : baseDir, value)
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
          var fileCandidate = new FileRef(candidate)
          if (!fileCandidate.isAbsolute()) {
            fileCandidate = new FileRef(isString(ctxDir) ? ctxDir : baseDir, candidate)
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
            baseForName = new FileRef(parentDir)
            if (!baseForName.isAbsolute()) {
              baseForName = new FileRef(isString(ctxDir) ? ctxDir : baseDir, parentDir)
            }
          } else {
            baseForName = new FileRef(isString(ctxDir) ? ctxDir : baseDir)
          }
          resolved = String(new FileRef(baseForName, value.filename).getCanonicalPath())
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
      var listed = io.listFiles(currentDir) || []
      if (isArray(listed)) {
        listed.forEach(function(entry) {
          try {
            var childFile = new FileRef(currentDir, entry)
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
    raw = recursive ? io.listFilesRecursive(baseDir) : io.listFiles(baseDir)
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
 * <key>MiniFileTool.readFile(params) : Object</key>
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
MiniFileTool.prototype.readFile = function(params) {
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
 * <key>MiniFileTool.listDirectory(params) : Array</key>
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
MiniFileTool.prototype.listDirectory = function(params) {
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

MiniFileTool.prototype._collectFiles = function(startPath, recursive) {
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
 * <key>MiniFileTool.searchContent(params) : Array</key>
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
MiniFileTool.prototype.searchContent = function(params) {
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
 * <key>MiniFileTool.getFileInfo(params) : Object</key>
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
MiniFileTool.prototype.getFileInfo = function(params) {
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
 * <key>MiniFileTool.writeFile(params) : Object</key>
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
MiniFileTool.prototype.writeFile = function(params) {
  params = params || {}
  if (isUnDef(params.path)) return "[ERROR] path is required"
  if (isUnDef(params.content)) return "[ERROR] content is required"
  try {
    this._ensureInitialized()
    this._ensureWritable("write operations")
    var filePath = this._resolve(params.path)
    var File = this._FileClass
    var targetFile = new File(filePath)
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

MiniFileTool.prototype._deleteRecursive = function(targetPath) {
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
 * <key>MiniFileTool.deleteFile(params) : Object</key>
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
MiniFileTool.prototype.deleteFile = function(params) {
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
