"""Check package inventory and bundle resolution without installing an oPack.

Run: python3 tests/bundledSkillsPackage.py
Requires the existing OpenAF `oaf` launcher; uses only Python's standard library.
"""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

checkout = Path(__file__).resolve().parents[1]
manifest = (checkout / '.package.yaml').read_text()
files = [line[2:] for line in manifest.split('files:\n', 1)[1].split('filesHash:', 1)[0].splitlines() if line.startswith('- ')]
bundled = sorted(str(path.relative_to(checkout)) for path in (checkout / 'skills').rglob('*') if path.is_file())
assert len(bundled) == 13, bundled
for name in bundled:
    assert name in files, f'Missing package file: {name}'
    digest = hashlib.sha1((checkout / name).read_bytes()).hexdigest()
    assert f'  {name}: {digest}' in manifest, f'Stale package hash: {name}'

with tempfile.TemporaryDirectory(prefix='mini-a-bundle-package-') as tmp:
    temporary = Path(tmp).resolve()
    package = temporary / 'package'
    unrelated = temporary / 'caller'
    unrelated.mkdir()
    for name in files:
        source = checkout / name
        target = package / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    for runtime in [checkout, package]:
        code = '''
java.lang.System.setProperty("user.home", %s)
load(%s)
var agent = new MiniA()
agent.fnI = function() {}; agent._trace = function() {}
agent._getPluginsDiscovery = function() { return { skillsRoots: [] } }
agent._resetSkillRuntime({})
agent._createUtilsMcpConfig({ useskills: true, utilsroot: %s })
var expected = %s
if (__miniABundleRoot !== expected) throw new Error("Wrong agent root: " + __miniABundleRoot)
var tool = agent._skillUtils
var names = tool._listSkills({}).map(function(item) { return item.name }).sort()
if (names.join(",") !== "mini-a-runtime-diagnostics,mini-a-skill-authoring,mini-a-wiki-retrieval") throw new Error("Wrong inventory: " + names)
names.forEach(function(name) {
  var rendered = tool.skills({ operation: "render", name: name })
  if (!isString(rendered.rendered)) throw new Error("Failed render " + name)
  if (rendered.referencedFiles.length !== 1) throw new Error("Missing offline reference " + name)
  var support = tool.skills({operation: "read", name: name, reference: rendered.referencedFiles[0].relativePath})
  if (!isString(support.body) || support.body.length < 100) throw new Error("Failed offline reference " + name)
})
load(expected + "/mini-a-session.js")
var session = MiniAInteractiveSession({useskills: true, homedir: %s, usehistory: false}, {
  print: function() {}, error: function() {}, event: function() {}, view: function() {},
  validateOption: function() {}, ask: function() {}, goal: function() {}, commandResult: function() {}
})
try {
  if (session.commands().indexOf("mini-a-wiki-retrieval") < 0) throw new Error("Console bundle missing")
  if (__miniASessionBundleRoot !== expected) throw new Error("Wrong console package root")
} finally { session.dispose() }
print("Bundle verified: " + expected)
''' % (json.dumps(str(unrelated)), json.dumps(str(runtime / 'mini-a.js')), json.dumps(str(unrelated)), json.dumps(str(runtime)), json.dumps(str(unrelated)))
        result = subprocess.run(['oaf', '-c', code], cwd=unrelated, text=True, capture_output=True, timeout=120)
        assert result.returncode == 0 and 'Bundle verified:' in result.stdout, result.stdout + result.stderr
        print(result.stdout.strip())
print('Package inventory and unrelated-directory checks passed.')
