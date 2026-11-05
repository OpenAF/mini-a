"""Exercise relocated libraries and public facades using real OpenAF in disposable packages."""
from pathlib import Path
import json
import shutil
import subprocess
import tempfile

base = Path(__file__).resolve().parents[1]
entries = sorted(p.name for p in base.glob('*.js'))
assert entries == ['mini-a-con.js', 'mini-a-dreams.js', 'mini-a-mcptest.js',
                   'mini-a-memoryman.js', 'mini-a-modelman.js', 'mini-a-wikiman.js', 'mini-a.js'], entries

def run(code, cwd):
    result = subprocess.run(['oaf', '-c', 'try {\n' + code + '\n} catch(e) { printErr(String(e)); exit(1) }'],
                            cwd=cwd, capture_output=True, text=True, timeout=120)
    assert result.returncode == 0 and 'MODULE_PATHS_OK' in result.stdout, result.stdout + result.stderr

with tempfile.TemporaryDirectory(prefix='mini-a-module-paths-', dir='/private/tmp') as tmp:
    root = Path(tmp)
    caller = root / 'caller'
    caller.mkdir()
    package = root / 'package'
    package.mkdir()
    shutil.copytree(base / 'js', package / 'js', ignore=shutil.ignore_patterns('.openaf_precompiled'))
    for name in entries + ['mini-a.yaml']:
        shutil.copy2(base / name, package / name)
    for runtime in [base, package]:
        # Installed Mini-A may point elsewhere: source-relative dependencies must stay in this copy.
        expected = json.dumps(str(runtime))
        run(f'''
load({json.dumps(str(runtime / 'mini-a.js'))})
var expected = {expected}
if (__miniABundleRoot !== expected) throw new Error("Wrong core package: " + __miniABundleRoot)
loadLib(__miniAPath("js/session/mini-a-session.js"))
if (__miniASessionBundleRoot !== expected) throw new Error("Wrong session package")
if (__miniAResolvePackageRoot(expected + "/js/wiki/mini-a-wiki.js") !== expected) throw new Error("Nested source resolution")
__miniAEnsureOptionalLibrary("memory")
__miniAEnsureOptionalLibrary("history")
var memory = MiniAMemoryManager, history = MiniAHistoryVM
__miniAEnsureOptionalLibrary("memory"); __miniAEnsureOptionalLibrary("history")
if (memory !== MiniAMemoryManager || history !== MiniAHistoryVM) throw new Error("Optional library loaded twice")
load(expected + "/mini-a.js")
if (typeof MiniA.prototype._extractResponseTextCandidates !== "function") throw new Error("Reload lost prototype mixins")
var loaded = Object.keys(__loadedLibs).filter(function(k) {{ return k.indexOf("/js/") >= 0 && k.endsWith(".js") }})
if (loaded.some(function(k) {{ return k.indexOf(expected.toLowerCase() + "/js/") !== 0 }})) throw new Error("Mixed packages: " + loaded)
print("MODULE_PATHS_OK")
''', caller)
    # Exercise the real manager facades twice without starting an interactive UI.
    # Disposable implementations record invocations; production files are untouched.
    managers = {'mini-a-modelman.js': 'session', 'mini-a-memoryman.js': 'session',
                'mini-a-mcptest.js': 'session', 'mini-a-wikiman.js': 'session',
                'mini-a-dreams.js': 'memory', 'mini-a-con.js': 'session'}
    for name, folder in managers.items():
        (package / 'js' / folder / name).write_text('global.__entryCalls = (global.__entryCalls || 0) + 1\n')
        run(f'''
load({json.dumps(str(package / name))})
load({json.dumps(str(package / name))})
if (global.__entryCalls !== 2) throw new Error("Entry did not execute twice: {name}")
print("MODULE_PATHS_OK")
''', caller)
print('PASS: seven root entries, unrelated cwd, extracted package isolation, lazy loading, reloads and repeated manager commands')
