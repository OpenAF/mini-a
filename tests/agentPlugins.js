(function() {
  load("mini-a-common.js")
  load("mini-a-plugins.js")

  // ─── helpers ────────────────────────────────────────────────

  var writeJSON = function(path, obj) {
    io.writeFileString(path, stringify(obj, __, ""))
  }

  // io.createTempDir() can return a non-canonical path (e.g. macOS /var/folders/... is a
  // symlink to /private/var/folders/...); canonicalize once so expected-path assertions
  // match what __miniAPlugin* (which always canonicalizes) actually returns.
  var canon = function(path) {
    return String(new java.io.File(path).getCanonicalPath())
  }

  var makePluginDir = function(root, name, manifestOverrides) {
    var dir = root + "/" + name
    io.mkdir(dir)
    var manifest = merge({
      "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      "name"   : name
    }, isMap(manifestOverrides) ? manifestOverrides : {})
    writeJSON(dir + "/plugin.json", manifest)
    return dir
  }

  var addSkill = function(pluginDir, skillName) {
    io.mkdir(pluginDir + "/skills")
    io.mkdir(pluginDir + "/skills/" + skillName)
    io.writeFileString(pluginDir + "/skills/" + skillName + "/SKILL.md",
      "---\nname: " + skillName + "\ndescription: a test skill\n---\nDo the thing.")
  }

  var addMcpJson = function(pluginDir, mcpServers, schemaOverride) {
    writeJSON(pluginDir + "/mcp.json", {
      "$schema"   : isDef(schemaOverride) ? schemaOverride : "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      "mcpServers": mcpServers
    })
  }

  var cleanup = function() {
    for (var i = 0; i < arguments.length; i++) {
      try { io.rm(arguments[i]) } catch (e) {}
    }
  }

  var findConfigById = function(configs, id) {
    return $from(configs).equals("id", id).at(0)
  }

  // ─── tests ──────────────────────────────────────────────────

  exports.testValidPluginSkillsOnly = function() {
    var home = canon(io.createTempDir("miniplugins_home_"))
    var pluginDir = makePluginDir(home, "skills-only")
    addSkill(pluginDir, "hello")
    try {
      var result = __miniAPluginDiscover({ plugins: pluginDir, homedir: home })
      ow.test.assert(result.skillsRoots.length, 1, "should contribute exactly one skills root")
      ow.test.assert(result.skillsRoots[0], pluginDir + "/skills", "skills root should be the plugin's skills/ dir")
      ow.test.assert(result.mcpConfigs.length, 0, "no mcp.json means no mcp configs")
      ow.test.assert(result.warnings.length, 0, "a fully valid plugin should produce no warnings")
    } finally { cleanup(home) }
  }

  exports.testValidPluginMcpStdioOnly = function() {
    var home = canon(io.createTempDir("miniplugins_home_"))
    var pluginDir = makePluginDir(home, "mcp-only")
    addMcpJson(pluginDir, {
      "runner": {
        "type"   : "stdio",
        "command": "./run.sh",
        "args"   : ["${PLUGIN_ROOT}/data", "--tag=x"],
        "env"    : { "MY_VAR": "from-plugin" },
        "cwd"    : "${PLUGIN_DATA}"
      }
    })
    try {
      var result = __miniAPluginDiscover({ plugins: pluginDir, homedir: home })
      ow.test.assert(result.skillsRoots.length, 0, "no skills/ dir means no skills root contributed")
      ow.test.assert(result.mcpConfigs.length, 1, "should emit exactly one mcp config")
      var cfg = result.mcpConfigs[0]
      ow.test.assert(isArray(cfg.cmd), true, "cmd must be an array (native argv-exec, no shell)")
      ow.test.assert(cfg.cmd[0], pluginDir + "/run.sh", "'./run.sh' must resolve to an absolute path under the plugin root")
      ow.test.assert(cfg.cmd[1], pluginDir + "/data", "'${PLUGIN_ROOT}' in args must expand to the plugin root")
      ow.test.assert(cfg.cmd[2], "--tag=x", "plain args must pass through untouched")
      ow.test.assert(cfg.pwd, home + "/.openaf-mini-a/plugin-data/mcp-only", "cwd '${PLUGIN_DATA}' must resolve to the plugin's data dir")
      ow.test.assert(cfg.envs.MY_VAR, "from-plugin", "declared env vars must be present")
      ow.test.assert(cfg.envs.PLUGIN_ROOT, pluginDir, "PLUGIN_ROOT must always be injected")
      ow.test.assert(cfg.envs.PLUGIN_DATA, home + "/.openaf-mini-a/plugin-data/mcp-only", "PLUGIN_DATA must always be injected")
      // Regression test: envs must be seeded from the ambient environment, since $sh's
      // envsMap fully REPLACES the child process environment (not merges) - omitting this
      // seed would silently break PATH-dependent bare-name command resolution.
      ow.test.assert(isDef(cfg.envs.PATH) || isDef(cfg.envs.Path), true, "envs must include the ambient PATH, not just plugin-declared vars")
    } finally { cleanup(home) }
  }

  exports.testMalformedPluginJsonSkipsPluginNotSiblings = function() {
    var root = canon(io.createTempDir("miniplugins_root_"))
    var goodDir = makePluginDir(root, "good-plugin")
    addSkill(goodDir, "ok")
    var badDir = root + "/bad-plugin"
    io.mkdir(badDir)
    writeJSON(badDir + "/plugin.json", { "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json" }) // missing 'name'
    try {
      var result = __miniAPluginDiscover({ pluginsroot: root, homedir: root })
      ow.test.assert(result.skillsRoots.length, 1, "only the good plugin should contribute a skills root")
      ow.test.assert(result.skillsRoots[0], goodDir + "/skills", "the surviving skills root must belong to the good plugin")
      ow.test.assert(result.warnings.length, 1, "the bad plugin should produce exactly one warning")
    } finally { cleanup(root) }
  }

  exports.testForwardCompatUnknownTopLevelKey = function() {
    var home = canon(io.createTempDir("miniplugins_home_"))
    var pluginDir = makePluginDir(home, "future-plugin", { futureField: "unknown-to-us" })
    addSkill(pluginDir, "ok")
    try {
      var result = __miniAPluginDiscover({ plugins: pluginDir, homedir: home })
      ow.test.assert(result.skillsRoots.length, 1, "an unknown top-level plugin.json field must not reject the plugin (forward-compat)")
      ow.test.assert(result.warnings.length, 0, "an unknown top-level field should not even produce a warning")
    } finally { cleanup(home) }
  }

  exports.testPlaceholderExpansionLeavesUnknownLiteral = function() {
    var ctx = { pluginRoot: "/plugins/foo", pluginData: "/data/foo" }
    var expanded = __miniAPluginExpandPlaceholders("${PLUGIN_ROOT}/bin ${SOME_OTHER} ${PLUGIN_DATA}/x", ctx)
    ow.test.assert(expanded, "/plugins/foo/bin ${SOME_OTHER} /data/foo/x", "only PLUGIN_ROOT/PLUGIN_DATA should expand; unrecognized placeholders stay literal")
  }

  exports.testPathTraversalRejected = function() {
    var home = canon(io.createTempDir("miniplugins_home_"))
    var pluginDir = makePluginDir(home, "escape-plugin")
    addMcpJson(pluginDir, {
      "runner": {
        "type"   : "stdio",
        "command": "./run.sh",
        "cwd"    : "${PLUGIN_ROOT}/../../.."
      }
    })
    try {
      var result = __miniAPluginDiscover({ plugins: pluginDir, homedir: home })
      ow.test.assert(result.mcpConfigs.length, 0, "a cwd that escapes the plugin root must be rejected")
      ow.test.assert(result.warnings.length, 1, "the rejection should surface as a warning, not a thrown error")
    } finally { cleanup(home) }
  }

  exports.testMcpJsonVersionMismatchDropsOnlyMcpSurface = function() {
    var home = canon(io.createTempDir("miniplugins_home_"))
    var pluginDir = makePluginDir(home, "mismatch-plugin")
    addSkill(pluginDir, "ok")
    addMcpJson(pluginDir, {
      "runner": { "type": "stdio", "command": "./run.sh" }
    }, "https://agent-plugins.org/schemas/2.0.0/mcp.schema.json")
    try {
      var result = __miniAPluginDiscover({ plugins: pluginDir, homedir: home })
      ow.test.assert(result.skillsRoots.length, 1, "skills must still load even if mcp.json targets an unsupported version")
      ow.test.assert(result.mcpConfigs.length, 0, "mcp servers must be dropped when mcp.json's $schema does not match")
      ow.test.assert(result.warnings.length, 1, "the version mismatch should produce exactly one warning")
    } finally { cleanup(home) }
  }

  exports.testBadMcpServerEntrySkippedNotWholePlugin = function() {
    var home = canon(io.createTempDir("miniplugins_home_"))
    var pluginDir = makePluginDir(home, "mixed-plugin")
    addMcpJson(pluginDir, {
      "good": { "type": "stdio", "command": "./run.sh" },
      "bad" : { "type": "carrier-pigeon", "command": "nope" }
    })
    try {
      var result = __miniAPluginDiscover({ plugins: pluginDir, homedir: home })
      ow.test.assert(result.mcpConfigs.length, 1, "only the bad entry should be dropped")
      ow.test.assert(isDef(findConfigById(result.mcpConfigs, "plugin:mixed-plugin:good")), true, "the good entry must still be present")
      ow.test.assert(result.warnings.length, 1, "the bad entry should produce exactly one warning")
    } finally { cleanup(home) }
  }
})()
