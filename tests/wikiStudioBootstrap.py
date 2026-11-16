"""Check environment libraries through both real Studio startup paths in OpenAF."""
from pathlib import Path
import json
import os
import subprocess
import tempfile

base = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="studio-bootstrap-", dir="/private/tmp") as tmp:
    root = Path(tmp)
    first = root / "first.js"
    second = root / "second.js"
    first.write_text('global.__studioLibraryOrder = ["first"]\n')
    second.write_text('global.__studioLibraryOrder.push("second")\n')
    for entry, job_index in [("mini-a-wiki-studio.yaml", 1), ("mini-a-wiki-studio-worker.yaml", 0)]:
        for enabled in [False, True]:
            env = os.environ.copy()
            env.pop("OAF_MINI_A_LIBS", None)
            if enabled:
                env["OAF_MINI_A_LIBS"] = f"  {first}, , {second}  "
            code = f'''
try {{
  ow.loadOJob()
  ow.oJob.__file = {json.dumps(str(base / entry))}
  var startup = io.readFileYAML(ow.oJob.__file).jobs[{job_index}].exec
  var reached = false
  // Run actual library loading, replacing only the listener and job execution.
  var verify = function() {{
    var expected = {json.dumps(["first", "second"] if enabled else None)}
    if (expected === null) {{
      if (isDef(global.__studioLibraryOrder)) throw new Error("Unexpected library load")
    }} else if (stringify(global.__studioLibraryOrder) !== stringify(expected)) {{
      throw new Error("Environment libraries missing or out of order")
    }}
    if (typeof MiniA !== "undefined") throw new Error("Bootstrap loaded agent core eagerly")
    reached = true
  }}
  new Function("args", "wikiStudioConfig", "WikiStudioServer", "wikiStudioRunWorker", startup)(
    {{ studiohome: {json.dumps(tmp)}, jobid: "test" }},
    function() {{ return {{}} }},
    function() {{ this.start = verify }},
    verify)
  if (!reached) throw new Error("Startup did not reach server or worker")
  print("STUDIO_BOOTSTRAP_OK")
}} catch(e) {{ printErr(String(e)); exit(1) }}
'''
            result = subprocess.run(["oaf", "-c", code], cwd=root, env=env,
                                    capture_output=True, text=True, timeout=90)
            assert result.returncode == 0 and "STUDIO_BOOTSTRAP_OK" in result.stdout, result.stdout + result.stderr
            print(f"PASS: {entry}, environment libraries {'set' if enabled else 'unset'}, unrelated cwd")
