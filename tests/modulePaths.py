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
    for name in entries + ['mini-a.yaml', 'mini-a-web.yaml', 'mini-a-wiki-studio.yaml']:
        shutil.copy2(base / name, package / name)
    (package / 'public').mkdir()
    shutil.copy2(base / 'public/embed-context.js', package / 'public/embed-context.js')
    # Exercise the full web bootstrap, including compiled-library loading, against
    # a checkout and copied installation from a caller outside either package.
    for runtime in [base, package]:
        run(f'''
ow.loadOJob()
ow.oJob.__file = {json.dumps(str(runtime / 'mini-a-web.yaml'))}
var bootstrap = io.readFileYAML(ow.oJob.__file).jobs.filter(function(job) {{ return job.name === "Load web libraries" }})[0].exec
new Function(bootstrap)()
if (__miniABundleRoot !== {json.dumps(str(runtime))}) throw new Error("Web core loaded from another installation")
MiniAWebEmbed.init({{webembed:true,webembedorigins:"http://localhost:8888",webembedcontextrequired:false}})
if (!MiniAWebEmbed.config.enabled || typeof MiniAEmbedContext.envelope !== "function") throw new Error("Web assets not package-relative")
print("MODULE_PATHS_OK")
''', caller)
    # oJob may retain only the requested basename when resolving an installed job.
    # Exercise the actual startup path resolution, before its first library load.
    for job_file, installed, cwd, expected in [
        (str(package / 'mini-a-wiki-studio.yaml'), str(base), caller, package),
        ('mini-a-wiki-studio.yaml', str(base), package, package),
        ('mini-a-wiki-studio.yaml', str(package), caller, package),
        ('mini-a-wiki-studio.yaml', None, caller, None),
    ]:
        run(f'''
var startup = io.readFileYAML({json.dumps(str(package / 'mini-a-wiki-studio.yaml'))}).jobs[1].exec
ow.loadOJob()
ow.oJob.__file = {json.dumps(job_file)}
var resolvedBase, failure
try {{
  var resolve = new Function("getOPackPath", startup.substring(0, startup.indexOf("loadLib(")) + "return base")
  resolvedBase = resolve(function() {{ return {json.dumps(installed)} }})
}} catch(e) {{ failure = String(e) }}
var expected = {json.dumps(str(expected) if expected else None)}
if (expected !== null) {{
  if (resolvedBase !== expected) throw new Error("Wrong Studio path: " + resolvedBase + "; " + failure)
}} else if (resolvedBase !== undefined || failure.indexOf("Cannot locate the Mini-A Wiki Studio package") < 0) {{
  throw new Error("Missing package did not fail clearly: " + failure)
}}
print("MODULE_PATHS_OK")
''', cwd)
    # Check every YAML bootstrap against basename-only oJob resolution, an
    # explicit checkout path, and a missing installation. Do not execute jobs.
    job_cases = []
    for job in sorted(list(base.glob('*.yaml')) + list((base / 'mcps').glob('*.yaml')) + list((base / 'utils').glob('*.yaml'))):
        source = job.read_text()
        start = source.find('var miniALibraryRoot = String(new java.io.File(String(ow.oJob.__file))')
        if start < 0:
            continue
        end_marker = '__miniAPackageRoot = __miniAResolvePackageRoot(miniALibraryRoot)'
        end = source.index(end_marker, start) + len(end_marker)
        job_cases.append({'path': str(job), 'name': job.name, 'code': source[start:end]})
    run(f'''
ow.loadOJob()
var cases = {json.dumps(job_cases)}, installedRoot = {json.dumps(str(package))}
cases.forEach(function(test) {{
  var bootstrap = new Function("getOPackPath", test.code + "; return miniALibraryRoot")
  ow.oJob.__file = test.name
  var resolved = bootstrap(function() {{ return installedRoot }})
  if (resolved !== installedRoot) throw new Error("Installed job path: " + test.path)
  ow.oJob.__file = test.path
  resolved = bootstrap(function() {{ return installedRoot }})
  if (resolved !== {json.dumps(str(base))}) throw new Error("Checkout job path: " + test.path)
  ow.oJob.__file = test.name
  var failed = false
  try {{ bootstrap(function() {{ return undefined }}) }} catch(e) {{ failed = String(e).indexOf("Cannot locate the Mini-A package") >= 0 }}
  if (!failed) throw new Error("Missing package was not rejected: " + test.path)
}})
// Exercise the complete Studio startup wiring with the actual config function;
// substitute the server to avoid opening listeners or starting worker threads.
loadLib(installedRoot + "/js/mini-a-paths.js")
__miniAPackageRoot = installedRoot
loadLib(installedRoot + "/js/studio/wiki-studio-config.js")
var startup = io.readFileYAML(installedRoot + "/mini-a-wiki-studio.yaml").jobs[1].exec
ow.oJob.__file = "mini-a-wiki-studio.yaml"
var captured, localGlobal = {{}}
new Function("args", "getOPackPath", "loadLib", "wikiStudioBootstrap", "wikiStudioConfig", "WikiStudioServer", "global", startup)(
  {{studiohome:{json.dumps(str(root / 'studio-state'))},openbrowser:false}},
  function() {{ return installedRoot }}, function() {{}}, function() {{}}, wikiStudioConfig,
  function(config) {{ captured = config; this.start = function() {{}} }}, localGlobal)
if (captured.base !== installedRoot) throw new Error("Studio runtime lost resolved package: " + captured.base)
var defaultConfig = wikiStudioConfig({{studiohome:{json.dumps(str(root / 'studio-default'))},openbrowser:false}})
if (defaultConfig.base !== installedRoot) throw new Error("Studio config fallback used cwd")
var worker = io.readFileYAML({json.dumps(str(base / 'mini-a-wiki-studio-worker.yaml'))}).jobs[0].exec
var workerBase = new Function("getOPackPath", worker.substring(0, worker.indexOf("loadLib(")) + "return base")(function() {{ return installedRoot }})
if (workerBase !== installedRoot) throw new Error("Studio worker used cwd")
var web = io.readFileYAML({json.dumps(str(base / 'mini-a-web.yaml'))})
var staticJob = web.jobs.filter(function(job) {{ return job.name === "Static content" }})[0], staticArgs = {{}}
new Function("args", staticJob.exec)(staticArgs)
if (staticArgs.path !== installedRoot + "/public") throw new Error("Static assets used cwd or another installation")
print("MODULE_PATHS_OK")
''', caller)
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
