// Author: Nuno Aguiar
// License: Apache 2.0
// Description: Sandbox and shell-execution helpers for MiniA.

MiniA.prototype._splitShellPrefix = function(value) {
    if (!isString(value)) return []
    var prefix = value.trim()
    if (prefix.length === 0) return []

    var result = []
    var current = ""
    var inSingle = false
    var inDouble = false

    for (var i = 0; i < prefix.length; i++) {
        var ch = prefix.charAt(i)

        if (ch === "\\" && i + 1 < prefix.length) {
            i++
            current += prefix.charAt(i)
            continue
        }

        if (ch === "'" && !inDouble) {
            inSingle = !inSingle
            continue
        }

        if (ch === '"' && !inSingle) {
            inDouble = !inDouble
            continue
        }

        if (!inSingle && !inDouble && /\s/.test(ch)) {
            if (current.length > 0) {
                result.push(current)
                current = ""
            }
            continue
        }

        current += ch
    }

    if (inSingle || inDouble) return [prefix]
    if (current.length > 0) result.push(current)

    return result.length > 0 ? result : [prefix]
}

MiniA.prototype._detectHostOs = function() {
    try {
      var name = String(java.lang.System.getProperty("os.name", "")).toLowerCase()
      if (name.indexOf("mac") >= 0 || name.indexOf("darwin") >= 0) return "macos"
      if (name.indexOf("win") >= 0) return "windows"
      if (name.indexOf("linux") >= 0) return "linux"
    } catch(e) {}
    return "unknown"
}

MiniA.prototype._escapeShellArgDoubleQuotes = function(value) {
    var text = isString(value) ? value : String(value)
    return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

MiniA.prototype._escapePowerShellSingleQuotes = function(value) {
    var text = isString(value) ? value : String(value)
    return text.replace(/'/g, "''")
}

MiniA.prototype._getSandboxHostPaths = function() {
    var envPwd = ""
    var cwd = ""
    var tempDir = ""
    var homeDir = ""

    try { envPwd = String(java.lang.System.getenv("PWD") || "") } catch(ignorePwd) {}
    try { cwd = String(java.lang.System.getProperty("user.dir", "") || "") } catch(ignoreCwd) {}
    try { tempDir = String(java.lang.System.getProperty("java.io.tmpdir", "") || "") } catch(ignoreTemp) {}
    try { homeDir = String(java.lang.System.getProperty("user.home", "") || "") } catch(ignoreHome) {}

    if (envPwd.length > 0) cwd = envPwd
    if (cwd.length === 0) cwd = "."
    if (tempDir.length === 0) tempDir = "/tmp"

    return {
      cwd : cwd,
      temp: tempDir,
      home: homeDir
    }
}

MiniA.prototype._getSandboxRuntimeDir = function() {
    if (isString(this._shellSandboxRuntimeDir) && this._shellSandboxRuntimeDir.length > 0) {
      if (io.fileExists(this._shellSandboxRuntimeDir) && isMap(io.fileInfo(this._shellSandboxRuntimeDir)) && io.fileInfo(this._shellSandboxRuntimeDir).isDirectory === true) {
        return this._shellSandboxRuntimeDir
      }
      this._shellSandboxRuntimeDir = ""
    }

    this._shellSandboxRuntimeDirError = ""
    var hostPaths = this._getSandboxHostPaths()
    var registerRuntimeDir = function(path) {
      if (!isString(path) || path.length === 0) return ""
      try {
        if (isDef(java.io.File)) new java.io.File(path).deleteOnExit()
      } catch(ignoreDeleteOnExitRuntimeDirError) {}
      if (typeof MiniA !== "undefined" && isFunction(MiniA._registerSandboxTempFile)) MiniA._registerSandboxTempFile(path)
      this._shellSandboxRuntimeDir = path
      return path
    }.bind(this)

    try {
      if (isMap(io) && isFunction(io.createTempDir)) {
        return registerRuntimeDir(io.createTempDir("mini-a-sandbox-", isString(hostPaths.temp) && hostPaths.temp.length > 0 ? hostPaths.temp : __))
      }
      this._shellSandboxRuntimeDirError = "io.createTempDir is not available in this OpenAF runtime."
    } catch(runtimeCreateError) {
      this._shellSandboxRuntimeDirError = runtimeCreateError.message || String(runtimeCreateError)
    }

    try {
      var baseDir = isString(hostPaths.temp) && hostPaths.temp.length > 0
        ? java.nio.file.Paths.get(hostPaths.temp)
        : __
      var tempDir = isDef(baseDir)
        ? java.nio.file.Files.createTempDirectory(baseDir, "mini-a-sandbox-")
        : java.nio.file.Files.createTempDirectory("mini-a-sandbox-")
      return registerRuntimeDir(String(tempDir.toAbsolutePath()))
    } catch(javaTempDirError) {
      this._shellSandboxRuntimeDirError = javaTempDirError.message || String(javaTempDirError)
    }

    try {
      var tempFile = java.nio.file.Files.createTempFile("mini-a-sandbox-", ".dir")
      var tempPath = String(tempFile.toAbsolutePath())
      try { io.rm(tempPath) } catch(ignoreTempPlaceholderDeleteError) {}
      io.mkdir(tempPath)
      return registerRuntimeDir(tempPath)
    } catch(fallbackRuntimeCreateError) {
      this._shellSandboxRuntimeDirError = fallbackRuntimeCreateError.message || String(fallbackRuntimeCreateError)
    }

    try {
      var tempRoot = isString(hostPaths.temp) && hostPaths.temp.length > 0 ? hostPaths.temp : "."
      var tempPathManual = tempRoot.replace(/[\\\/]+$/, "") + "/mini-a-sandbox-" + nowNano()
      io.mkdir(tempPathManual)
      if (io.fileExists(tempPathManual) && isMap(io.fileInfo(tempPathManual)) && io.fileInfo(tempPathManual).isDirectory === true) {
        return registerRuntimeDir(tempPathManual)
      }
    } catch(manualRuntimeCreateError) {
      this._shellSandboxRuntimeDirError = manualRuntimeCreateError.message || String(manualRuntimeCreateError)
    }

    try {
      if (isUnDef(this._shellSandboxRuntimeDirError) || String(this._shellSandboxRuntimeDirError).length === 0) {
        this._shellSandboxRuntimeDirError = "Unknown runtime directory creation failure."
      }
    } catch(ignoreSandboxRuntimeErrorSet) {}

    return ""
}

MiniA.prototype._isCommandAvailable = function(commandName) {
    var name = isString(commandName) ? commandName.trim() : ""
    if (name.length === 0) return false

    try {
      var pathEnv = String(java.lang.System.getenv("PATH") || "")
      if (pathEnv.length === 0) return false
      var separator = java.io.File.pathSeparator
      var pathParts = String(pathEnv).split(separator)
      var isWindows = this._detectHostOs() === "windows"
      var extensions = [""]

      if (isWindows) {
        var pathExt = String(java.lang.System.getenv("PATHEXT") || ".EXE;.CMD;.BAT;.COM")
        extensions = pathExt.split(";").map(function(ext) { return ext.toLowerCase() })
        if (extensions.indexOf("") < 0) extensions.unshift("")
      }

      for (var i = 0; i < pathParts.length; i++) {
        var part = String(pathParts[i] || "").trim()
        if (part.length === 0) continue
        for (var j = 0; j < extensions.length; j++) {
          var suffix = extensions[j]
          var candidate = new java.io.File(part, isWindows ? name + suffix : name)
          if (candidate.exists() && candidate.isFile() && candidate.canExecute()) return true
        }
      }
    } catch(ignoreCommandLookupError) {}

    return false
}

MiniA.prototype._createTempSandboxProfile = function(args) {
    var tempPath
    var hostPaths = this._getSandboxHostPaths()
    var runtimeDir = this._getSandboxRuntimeDir()
    if (runtimeDir.length === 0) {
      var runtimeDirError = isString(this._shellSandboxRuntimeDirError) && this._shellSandboxRuntimeDirError.length > 0
        ? ": " + this._shellSandboxRuntimeDirError
        : "."
      return {
        profile: "",
        warning: "Failed to create temporary macOS sandbox runtime directory" + runtimeDirError
      }
    }

    var runtimeTmp = runtimeDir + "/tmp"
    var runtimeHome = runtimeDir + "/home"
    try {
      io.mkdir(runtimeTmp)
      io.mkdir(runtimeHome)
    } catch(ignoreSandboxDirCreateError) {}

    var writePaths = [runtimeTmp, runtimeHome]
    if (toBoolean(args.readwrite) === true && isString(hostPaths.cwd) && hostPaths.cwd.length > 0) writePaths.push(hostPaths.cwd)

    var profileLines = [
      "version 1",
      "(deny default)",
      "(allow process-exec)",
      "(allow process-fork)",
      "(allow signal (target self))",
      "(allow sysctl-read)",
      "(allow file-read*)"
    ]

    if (toBoolean(args.sandboxnonetwork) !== true) {
      profileLines.splice(6, 0, "(allow network*)")
    }

    writePaths.filter(function(path, index, arr) {
      return isString(path) && path.length > 0 && arr.indexOf(path) === index
    }).forEach(function(path) {
      profileLines.push("(allow file-write* (subpath \"" + String(path).replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"))")
    })

    var profileText = profileLines.join("\n") + "\n"

    try {
      var tempFile = java.nio.file.Files.createTempFile("mini-a-sandbox-", ".sb")
      tempPath = String(tempFile.toAbsolutePath())
    } catch(tempCreateError) {
      return {
        profile: "",
        warning: "Failed to create temporary macOS sandbox profile: " + (tempCreateError.message || String(tempCreateError))
      }
    }

    try {
      io.writeFileString(tempPath, profileText)
    } catch(tempWriteError) {
      try {
        if (isString(tempPath) && tempPath.length > 0 && io.fileExists(tempPath)) io.rm(tempPath)
      } catch(ignoreRmError) {}
      return {
        profile: "",
        warning: "Failed to write temporary macOS sandbox profile: " + (tempWriteError.message || String(tempWriteError))
      }
    }

    try {
      if (isDef(java.io.File)) new java.io.File(tempPath).deleteOnExit()
    } catch(ignoreDeleteOnExitError) {}

    if (typeof MiniA !== "undefined" && isFunction(MiniA._registerSandboxTempFile)) {
      MiniA._registerSandboxTempFile(tempPath)
    }

    this._shellSandboxAutoProfile = tempPath
    return {
      profile: tempPath,
      warning: "usesandbox=macos: sandboxprofile not provided; using generated restrictive profile " + tempPath + "."
    }
}

MiniA.prototype._resolveMacOSSandboxProfile = function(profilePath, args) {
    var providedPath = isString(profilePath) ? profilePath.trim() : ""
    if (providedPath.length > 0) {
      if (io.fileExists(providedPath) && isMap(io.fileInfo(providedPath)) && io.fileInfo(providedPath).isFile === true) {
        return { profile: providedPath, warning: "" }
      }
      return { profile: "", warning: "sandboxprofile file not found or is not a file: " + providedPath }
    }

    if (isString(this._shellSandboxAutoProfile) && this._shellSandboxAutoProfile.length > 0) {
      if (io.fileExists(this._shellSandboxAutoProfile) && isMap(io.fileInfo(this._shellSandboxAutoProfile)) && io.fileInfo(this._shellSandboxAutoProfile).isFile === true) {
        return { profile: this._shellSandboxAutoProfile, warning: "usesandbox=macos: sandboxprofile not provided; reusing temporary generated profile " + this._shellSandboxAutoProfile + "." }
      }
      this._shellSandboxAutoProfile = ""
    }

    return this._createTempSandboxProfile(args)
}

MiniA.prototype._buildLinuxSandboxConfig = function(args) {
    if (!this._isCommandAvailable("bwrap")) {
      return {
        mode         : "linux",
        prefix       : "",
        warning      : "usesandbox=linux requested but bubblewrap ('bwrap') is not available; running without OS sandbox.",
        backend      : "bwrap",
        status       : "unavailable",
        effectiveMode: "off"
      }
    }

    var hostPaths = this._getSandboxHostPaths()
    var parts = [
      "bwrap",
      "--die-with-parent",
      "--proc", "/proc",
      "--dev", "/dev",
      "--ro-bind", "/", "/",
      "--chdir", "\"$PWD\"",
      "--unshare-user",
      "--unshare-pid",
      "--unshare-uts",
      "--unshare-cgroup",
      "--tmpfs", "/tmp",
      "--tmpfs", "/var/tmp",
      "--dir", "/tmp/mini-a-home",
      "--setenv", "HOME", "/tmp/mini-a-home",
      "--setenv", "TMPDIR", "/tmp",
      "--setenv", "TMP", "/tmp",
      "--setenv", "TEMP", "/tmp"
    ]

    if (toBoolean(args.sandboxnonetwork) === true) parts.push("--unshare-net")

    if (toBoolean(args.readwrite) === true) {
      if (isString(hostPaths.cwd) && hostPaths.cwd.length > 0) parts.push("--bind", "\"" + this._escapeShellArgDoubleQuotes(hostPaths.cwd) + "\"", "\"" + this._escapeShellArgDoubleQuotes(hostPaths.cwd) + "\"")
      if (isString(hostPaths.temp) && hostPaths.temp.length > 0) parts.push("--bind", "\"" + this._escapeShellArgDoubleQuotes(hostPaths.temp) + "\"", "\"" + this._escapeShellArgDoubleQuotes(hostPaths.temp) + "\"")
    }

    parts.push("--", "/bin/sh", "-lc")
    return {
      mode         : "linux",
      prefix       : parts.join(" "),
      warning      : "usesandbox=linux: bubblewrap active with "
        + (toBoolean(args.readwrite) === true
          ? "writable current directory and temp paths"
          : "read-only host filesystem and private temp/home paths")
        + (toBoolean(args.sandboxnonetwork) === true ? ", and network access disabled." : "."),
      backend      : "bwrap",
      status       : "applied",
      effectiveMode: "linux"
    }
}

MiniA.prototype._buildMacOSSandboxConfig = function(args) {
    if (!this._isCommandAvailable("sandbox-exec")) {
      return {
        mode         : "macos",
        prefix       : "",
        warning      : "usesandbox=macos requested but 'sandbox-exec' is not available; running without OS sandbox.",
        backend      : "sandbox-exec",
        status       : "unavailable",
        effectiveMode: "off"
      }
    }

    var macProfile = this._resolveMacOSSandboxProfile(isString(args.sandboxprofile) ? args.sandboxprofile : "", args)
    if (macProfile.profile.length === 0) {
      return {
        mode         : "macos",
        prefix       : "",
        warning      : macProfile.warning + " Running without OS sandbox.",
        backend      : "sandbox-exec",
        status       : "unavailable",
        effectiveMode: "off"
      }
    }

    return {
      mode         : "macos",
      prefix       : "sandbox-exec -f \"" + this._escapeShellArgDoubleQuotes(macProfile.profile) + "\" /bin/sh -lc",
      warning      : (isString(macProfile.warning) && macProfile.warning.length > 0 ? macProfile.warning + " " : "")
        + "usesandbox=macos: sandbox-exec active with "
        + (toBoolean(args.readwrite) === true
          ? "writable current directory and temp paths"
          : "read-only host filesystem and private temp/home paths")
        + (toBoolean(args.sandboxnonetwork) === true ? ", and network access disabled." : "."),
      backend      : "sandbox-exec",
      status       : "applied",
      effectiveMode: "macos"
    }
}

MiniA.prototype._buildWindowsSandboxConfig = function(args) {
    var hostPaths = this._getSandboxHostPaths()
    var runtimeDir = this._getSandboxRuntimeDir()
    var runtimeTmp = runtimeDir.length > 0 ? runtimeDir + "/tmp" : hostPaths.temp
    var runtimeHome = runtimeDir.length > 0 ? runtimeDir + "/home" : hostPaths.temp

    try {
      if (runtimeDir.length > 0) {
        io.mkdir(runtimeTmp)
        io.mkdir(runtimeHome)
      }
    } catch(ignoreWindowsSandboxDirCreateError) {}

    return {
      mode         : "windows",
      prefix       : "",
      warning      : "usesandbox=windows: applying best-effort PowerShell restrictions with "
        + (toBoolean(args.readwrite) === true
          ? "writable current directory and isolated temp/home paths"
          : "isolated temp/home paths")
        + (toBoolean(args.sandboxnonetwork) === true
          ? ", plus best-effort network blocking. This is weaker than Linux bubblewrap and does not provide hard filesystem or guaranteed network isolation."
          : ". This is weaker than Linux bubblewrap" + (toBoolean(args.readwrite) === true ? "." : " and does not provide hard filesystem isolation.")),
      backend      : "powershell",
      status       : "best-effort",
      effectiveMode: "windows",
      runtimeTmp   : runtimeTmp,
      runtimeHome  : runtimeHome,
      cwd          : hostPaths.cwd
    }
}

MiniA.prototype._resolveSandboxPrefix = function(mode, args) {
    var sandboxMode = isString(mode) ? mode.trim().toLowerCase() : ""
    if (sandboxMode.length === 0) return { mode: "off", prefix: "", warning: "", backend: "", status: "off", effectiveMode: "off" }
    if (["false", "off", "none", "disabled", "0", "no"].indexOf(sandboxMode) >= 0) {
      return { mode: "off", prefix: "", warning: "", backend: "", status: "off", effectiveMode: "off" }
    }

    var host = this._detectHostOs()
    if (sandboxMode === "true" || sandboxMode === "on" || sandboxMode === "1") sandboxMode = "auto"
    if (sandboxMode === "auto") sandboxMode = host

    switch(sandboxMode) {
      case "linux":
        return this._buildLinuxSandboxConfig(args)
      case "macos":
        return this._buildMacOSSandboxConfig(args)
      case "windows":
        return this._buildWindowsSandboxConfig(args)
      default:
        return {
          mode         : sandboxMode,
          prefix       : "",
          warning      : "Unknown usesandbox mode '" + sandboxMode + "'. Use auto/linux/macos/windows/off.",
          backend      : "",
          status       : "unknown",
          effectiveMode: "off"
        }
    }
}

MiniA.prototype._buildSandboxExecution = function(sandboxCfg, commandBeforeSandbox, args) {
    var original = isString(commandBeforeSandbox) ? commandBeforeSandbox : ""
    if (!isMap(sandboxCfg) || !isString(sandboxCfg.mode) || sandboxCfg.mode.length === 0 || sandboxCfg.mode === "off") {
      return { finalCommand: original, shInput: original }
    }

    if (sandboxCfg.mode === "windows" && sandboxCfg.status !== "off") {
      var runtimeTmp = isString(sandboxCfg.runtimeTmp) && sandboxCfg.runtimeTmp.length > 0 ? sandboxCfg.runtimeTmp : this._getSandboxHostPaths().temp
      var runtimeHome = isString(sandboxCfg.runtimeHome) && sandboxCfg.runtimeHome.length > 0 ? sandboxCfg.runtimeHome : runtimeTmp
      var cwd = isString(sandboxCfg.cwd) && sandboxCfg.cwd.length > 0 ? sandboxCfg.cwd : this._getSandboxHostPaths().cwd
      var script = [
        "$ErrorActionPreference = 'Stop'",
        "$ProgressPreference = 'SilentlyContinue'",
        "$ExecutionContext.SessionState.LanguageMode = 'ConstrainedLanguage'",
        "$env:TEMP = '" + this._escapePowerShellSingleQuotes(runtimeTmp) + "'",
        "$env:TMP = '" + this._escapePowerShellSingleQuotes(runtimeTmp) + "'",
        "$env:TMPDIR = '" + this._escapePowerShellSingleQuotes(runtimeTmp) + "'",
        "$env:HOME = '" + this._escapePowerShellSingleQuotes(runtimeHome) + "'",
        "$env:USERPROFILE = '" + this._escapePowerShellSingleQuotes(runtimeHome) + "'",
        toBoolean(args.sandboxnonetwork) === true ? "$env:HTTP_PROXY = 'http://127.0.0.1:9'" : "",
        toBoolean(args.sandboxnonetwork) === true ? "$env:HTTPS_PROXY = 'http://127.0.0.1:9'" : "",
        toBoolean(args.sandboxnonetwork) === true ? "$env:ALL_PROXY = 'http://127.0.0.1:9'" : "",
        toBoolean(args.sandboxnonetwork) === true ? "$env:NO_PROXY = '*'" : "",
        toBoolean(args.sandboxnonetwork) === true ? "[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy('http://127.0.0.1:9')" : "",
        "Set-Location -LiteralPath '" + this._escapePowerShellSingleQuotes(cwd) + "'",
        "& cmd.exe /d /s /c '" + this._escapePowerShellSingleQuotes(original) + "'"
      ].filter(function(line) { return isString(line) && line.length > 0 }).join("; ")

      return {
        finalCommand: "powershell -NoLogo -NoProfile -NonInteractive -Command " + script,
        shInput: ["powershell", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script]
      }
    }

    if (isString(sandboxCfg.prefix) && sandboxCfg.prefix.length > 0) {
      var sbParts = this._splitShellPrefix(sandboxCfg.prefix)
      if (!isArray(sbParts) || sbParts.length === 0) sbParts = [sandboxCfg.prefix]
      var finalCommand = sandboxCfg.prefix + " " + original
      var sbInput = sbParts.slice()
      sbInput.push(original)
      return { finalCommand: finalCommand, shInput: sbInput }
    }

    return { finalCommand: original, shInput: original }
}

MiniA.prototype._shouldLogSandboxWarning = function(warningText) {
    if (!isString(warningText) || warningText.length === 0) return false

    if (
      warningText.indexOf("usesandbox=macos: sandboxprofile not provided; reusing temporary generated profile ") === 0 ||
      warningText.indexOf("usesandbox=macos: sandboxprofile not provided; using generated restrictive profile ") === 0
    ) {
      return isObject(this._sessionArgs) && (toBoolean(this._sessionArgs.debug) || toBoolean(this._sessionArgs.verbose))
    }

    return true
}
