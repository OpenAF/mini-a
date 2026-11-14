// Verify target packages and automatic declarative source conversion.
load('js/skills/mini-a-plugins.js')
var root = String(new java.io.File(io.createTempDir()).getCanonicalPath())
try {
  var manager = new MiniAPluginManager({ homedir: root })
  manager.request({ op: 'create', spec: { metadata: { name: 'target-fixture', version: '1.0.0' } }, out: root + '/source' })
  ;['minia', 'claude', 'chatgpt', 'copilot', 'opencode', 'universal', 'all'].forEach(function(target) {
    var path = root + '/' + target + '.zip'
    manager.request({ op: 'export', source: root + '/source', target: target, out: path })
    if (!io.fileExists(path)) throw 'Missing target ZIP: ' + target
    if (target !== 'all') {
      var report = manager.request({ op: 'inspect', source: path })
      if (report.id !== 'target-fixture') throw 'Round trip identity: ' + target
    }
  })
  var source = root + '/open-source'
  io.mkdir(source + '/.opencode/skills/demo')
  io.writeFileString(source + '/.opencode/skills/demo/SKILL.md', '---\nname: demo\ndescription: Demo\n---\nDemo')
  io.writeFileString(source + '/opencode.jsonc', '{ // config\n "mcp": { "servers": { "test": { "type": "local", "command": ["echo", "hello"], }, }, }, }')
  manager.request({ op: 'convert', source: source, out: root + '/converted' })
  var mcp = io.readFileJSON(root + '/converted/mcp.json').mcpServers.test
  if (mcp.type !== 'stdio' || mcp.command !== 'echo' || mcp.args[0] !== 'hello') throw 'OpenCode MCP conversion'
  if (!io.fileExists(root + '/converted/skills/demo/SKILL.md')) throw 'OpenCode skill conversion'
  manager.request({ op: 'install', source: source })
  if (manager.list()[0].enabled) throw 'Install enabled unexpectedly'
  manager.request({ op: 'export', id: manager.list()[0].id, out: root + '/installed.zip' })
  manager.request({ op: 'convert', source: source, out: root + '/dry-run', dryRun: true })
  if (io.fileExists(root + '/dry-run')) throw 'Dry run wrote output'
  io.mkdir(source + '/.opencode/plugins')
  io.writeFileString(source + '/.opencode/plugins/example.ts', 'throw new Error("must not run")')
  var blocked = false
  try { manager.request({ op: 'convert', source: source, out: root + '/blocked' }) } catch (error) { blocked = true }
  if (!blocked || io.fileExists(root + '/blocked')) throw 'Executable plugin accepted'
  manager.request({ op: 'convert', source: source, out: root + '/excluded', exclude: ['unsupported:.opencode/plugins'] })
  var copilot = root + '/copilot-source'
  io.mkdir(copilot + '/com.github.copilot/commands')
  io.writeFileJSON(copilot + '/plugin.json', { '$schema': __MINI_A_PLUGIN_SCHEMA_ID, name: 'copilot-fixture' })
  io.writeFileString(copilot + '/com.github.copilot/commands/hello.md', 'Hello $ARGUMENTS')
  manager.request({ op: 'convert', source: copilot, out: root + '/copilot-converted' })
  if (!io.fileExists(root + '/copilot-converted/commands/hello.md')) throw 'Copilot command conversion'
  // Execute converted Copilot hooks against Mini-A's actual shell hook runner.
  io.mkdir(copilot + '/com.github.copilot/hooks')
  io.writeFileString(copilot + '/guard.py', 'import json,sys\np=json.load(sys.stdin)\nassert p["toolName"] == "bash"\nassert p["toolArgs"]["command"] == "echo test"\nassert p["sessionId"]\nprint(json.dumps({"permissionDecision":"deny","additionalContext":"copilot guard"}))\n')
  io.writeFileJSON(copilot + '/com.github.copilot/hooks/hooks.json', { version: 1, hooks: { preToolUse: [{ type: 'command', command: 'python3 guard.py', matcher: '^bash$', timeoutSec: 5 }] } })
  manager.request({ op: 'convert', source: copilot, out: root + '/copilot-hooks' })
  var parsedHooks = __miniAPluginLoadOne(root + '/copilot-hooks', { inspect: true })
  if (!parsedHooks.ok || parsedHooks.hooks.length !== 1) throw 'Converted hook missing'
  var outcome = __miniARunPluginHooks(parsedHooks.hooks, 'before_shell', { MINI_A_SHELL_COMMAND: 'echo test' }, { useshell: true, homedir: root })
  if (!outcome.blocked || outcome.outputs[0].output !== 'copilot guard') throw 'Copilot denial conversion'
  var skipped = __miniARunPluginHooks(parsedHooks.hooks, 'before_tool', { MINI_A_TOOL: 'readFile', MINI_A_TOOL_PARAMS: '{}' }, { useshell: true, homedir: root })
  if (skipped.blocked || skipped.outputs.length) throw 'Copilot matcher failed'
  io.writeFileString(root + '/copilot-hooks/guard.py', 'import json\nprint(json.dumps({"permissionDecision":"allow"}))\n')
  var allowed = __miniARunPluginHooks(parsedHooks.hooks, 'before_shell', { MINI_A_SHELL_COMMAND: 'echo test' }, { useshell: true, homedir: root })
  if (allowed.blocked) throw 'Copilot allow blocked'
  io.writeFileString(root + '/copilot-hooks/guard.py', 'import sys\nsys.exit(1)\n')
  var failed = __miniARunPluginHooks(parsedHooks.hooks, 'before_shell', { MINI_A_SHELL_COMMAND: 'echo test' }, { useshell: true, homedir: root })
  if (!failed.blocked) throw 'Copilot process failure allowed'
  io.writeFileString(root + '/copilot-hooks/guard.py', 'import json\nprint(json.dumps({"updatedInput": {"command":"other"}}))\n')
  var rewritten = __miniARunPluginHooks(parsedHooks.hooks, 'before_shell', { MINI_A_SHELL_COMMAND: 'echo test' }, { useshell: true, homedir: root })
  if (!rewritten.blocked) throw 'Copilot unsupported rewriting allowed' 
  var disabled = __miniARunPluginHooks(parsedHooks.hooks, 'before_shell', { MINI_A_SHELL_COMMAND: 'echo test' }, { useshell: false, homedir: root })
  if (disabled.outputs.length) throw 'Hook ran with shell disabled'
  // Validate a generated OpenCode adapter with the native command execution path.
  var hookSource = root + '/native-hook'
  io.mkdir(hookSource + '/hooks')
  io.writeFileJSON(hookSource + '/plugin.json', { '$schema': __MINI_A_PLUGIN_SCHEMA_ID, name: 'native-hook' })
  io.writeFileJSON(hookSource + '/hooks/hooks.json', { hooks: { PreToolUse: [{ matcher: '^Bash$', hooks: [{ type: 'command', command: 'python3 deny.py' }] }] } })
  io.writeFileString(hookSource + '/deny.py', 'import json,sys\np=json.load(sys.stdin)\nassert p["tool_input"]["command"] == "echo test"\nprint(json.dumps({"hookSpecificOutput":{"permissionDecision":"deny"}}))\n')
  manager.request({ op: 'convert', source: hookSource, target: 'opencode', out: root + '/native-target' })
  manager.request({ op: 'convert', source: root + '/native-target', out: root + '/native-return' })
  if (!io.fileExists(root + '/native-return/hooks/hooks.json')) throw 'Generated adapter round trip failed'
  var modulePath = root + '/native-target/.opencode/plugins/mini-a-hooks.mjs'
  io.writeFileString(modulePath, manager.openCodeHookAdapter().replace('import { Plugin } from "@opencode/plugin"', 'const Plugin = { define: value => value }'))
  io.writeFileString(root + '/run-hook.mjs', 'import plugin from "./native-target/.opencode/plugins/mini-a-hooks.mjs"\nlet callback\nawait plugin.setup({ tool: { hook: async (name, fn) => { callback = fn } } })\nlet denied = false\ntry { await callback({tool:"bash", input:{command:"echo test"}}) } catch (error) { denied = /denied/.test(error.message) }\nif (!denied) throw new Error("Native denial missing")\n')
  var nativeRun = $sh(['node', root + '/run-hook.mjs']).get(0)
  if (nativeRun.exitcode !== 0) throw 'Generated adapter execution failed: ' + nativeRun.stderr
  // Do not silently accept handlers whose semantics are not implemented.
  var rejectedHook = false
  try { manager.convertCopilotHooks({ version: 1, hooks: { preToolUse: [{ type: 'command', powershell: 'echo test' }] } }) } catch (error) { rejectedHook = true }
  if (!rejectedHook) throw 'Unsupported handler accepted' 
} finally { io.rm(root) }
print('Plugin target tests passed')
