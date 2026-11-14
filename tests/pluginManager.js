// Verify managed activation and source-preserving vendor conversion.
load('js/skills/mini-a-plugins.js')
var root = String(new java.io.File(io.createTempDir()).getCanonicalPath())
try {
  var source = root + '/source'
  io.mkdir(source + '/.claude-plugin')
  io.writeFileJSON(source + '/.claude-plugin/plugin.json', { name: 'fixture' })
  io.mkdir(source + '/skills/hello')
  io.writeFileString(source + '/skills/hello/SKILL.md', '---\nname: hello\ndescription: hello\n---\nHello')
  io.mkdir(source + '/hooks')
  io.writeFileString(source + '/hook.py', 'import json,sys\np=json.load(sys.stdin)\nassert p["session_id"]\nassert p["hook_event_name"] == "PreToolUse"\nassert p["tool_input"]["command"] == "echo test"\nprint(json.dumps({"hookSpecificOutput":{"permissionDecision":"deny","additionalContext":"fixture context"}}))\n')
  io.writeFileJSON(source + '/hooks/hooks.json', { hooks: { PreToolUse: [{ matcher: '^Bash$', hooks: [{ type: 'command', command: 'python3 hook.py' }] }] } })
  io.mkdir(source + '/commands')
  io.writeFileString(source + '/commands/hello.md', 'Say $ARGUMENTS')
  var manager = new MiniAPluginManager({ homedir: root })
  // Exercise archive detection and reject escaping entries before installation.
  var archivePath = root + "/fixture.zip"
  var zip = new java.util.zip.ZipOutputStream(new java.io.FileOutputStream(archivePath))
  zip.putNextEntry(new java.util.zip.ZipEntry("plugin.json"))
  zip.write(new java.lang.String(stringify({ "$schema": __MINI_A_PLUGIN_SCHEMA_ID, name: "archive" }, __, "")).getBytes("UTF-8"))
  zip.closeEntry()
  zip.close()
  if (manager.request({ op: "inspect", source: archivePath }).id !== "archive") throw "Archive inspection failed"
  var badZip = new java.util.zip.ZipOutputStream(new java.io.FileOutputStream(root + "/bad.zip"))
  badZip.putNextEntry(new java.util.zip.ZipEntry("../escape"))
  badZip.closeEntry()
  badZip.close()
  var rejected = false
  try { manager.request({ op: "inspect", source: root + "/bad.zip" }) } catch (error) { rejected = true }
  if (!rejected) throw "Escaping ZIP accepted"
  var exported = manager.webRequest({ op: "download", source: source })
  if (!isString(exported.base64) || !exported.base64.length) throw "Export missing"
  var uploaded = manager.webRequest({ op: "inspect", upload: exported.base64 })
  if (uploaded.id !== "fixture") throw "Upload round trip failed"
  manager.request({ op: 'install', source: source })
  if (manager.list()[0].enabled) throw 'Installation must be disabled'
  var installedPath = manager.list()[0].path
  if (__miniAPluginDiscover({ homedir: root, plugins: installedPath }).skillsRoots.length) throw 'Disabled explicit path loaded'
  manager.request({ op: 'enable', id: 'fixture' })
  var discovery = __miniAPluginDiscover({ homedir: root })
  if (discovery.skillsRoots.length !== 1 || discovery.commands[0].name !== 'fixture:hello') throw 'Enabled components missing'
  var hookResult = __miniARunPluginHooks(discovery.hooks, 'before_shell', { MINI_A_SHELL_COMMAND: 'echo test' }, { useshell: true, homedir: root })
  if (!hookResult.blocked || hookResult.outputs[0].output !== 'fixture context') throw 'Hook protocol failed'
  var disabledHook = __miniARunPluginHooks(discovery.hooks, 'before_shell', { MINI_A_SHELL_COMMAND: 'echo test' }, { useshell: false, homedir: root })
  if (disabledHook.blocked || disabledHook.outputs.length) throw 'Disabled shell hook executed'
  if (io.fileExists(source + '/plugin.json')) throw 'Source changed'
  manager.request({ op: 'disable', id: 'fixture' })
  if (__miniAPluginDiscover({ homedir: root }).skillsRoots.length) throw 'Disabled components loaded'
  manager.request({ op: 'remove', id: 'fixture' })
  if (manager.list().length) throw 'Removed installation listed'
  if (!io.fileExists(installedPath)) throw 'Active snapshot files removed'
} finally { io.rm(root) }
print('Plugin manager tests passed')
