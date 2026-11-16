"""Abrupt JVM recovery at graph staging/publication/provider-receipt boundaries."""
import json
import os
from pathlib import Path
import subprocess
import tempfile

REPO = Path(__file__).resolve().parents[1]
ENV = os.environ.copy()
for key in ("OAF_MODEL", "OAF_LC_MODEL", "OAF_EMBED_MODEL"):
    ENV.pop(key, None)


def execute(work, name, source, expected=0):
    script = work / (name + ".js")
    script.write_text(source)
    result = subprocess.run(["oaf", "-f", str(script)], cwd=REPO, env=ENV,
                            capture_output=True, text=True, timeout=90)
    assert result.returncode == expected, (name, result.returncode, result.stdout, result.stderr)
    return result.stdout


with tempfile.TemporaryDirectory(prefix="graph-upgrade-recovery-", dir="/private/tmp") as temp:
    base = Path(temp)
    for boundary in ("structure", "graph", "ready", "post-rename", "published", "validation-receipt"):
        work = base / boundary
        work.mkdir()
        wiki = work / "wiki"
        wiki.mkdir()
        prose = boundary == "validation-receipt"
        for name in ("a", "b"):
            (wiki / (name + ".md")).write_text("---\ntitle: Storage Engine\n---\n" +
                                              ("Use a persistent cache." if prose else "Use `cacheKey`."))
        prelude = """
          load('js/core/mini-a-common.js')
          load('js/wiki/mini-a-wiki.js')
          var wm = new MiniAWikiManager({backend:'fs',root:%s,access:'rw',usegraph:true,skipBootstrap:true},function(){})
          var calls = %s
          wm._graph._cfg.reconcileValidators = [{fingerprint:'recovery-fixture',extract:function(){
            io.writeFileString(calls, 'called\\n', __, true)
            return {concepts:[]}
          }}]
        """ % (json.dumps(str(wiki)), json.dumps(str(work / "calls.txt")))
        setup = prelude + "wm.graph('build',{})\nwm.close()"
        execute(work, "setup", setup)
        graph = wiki / ".mini-a-wiki-graph" / "graph.json"
        previous = graph.read_bytes()
        options = dict(confirmExpensive=True, extraction="structural", modelHelp="off", reconcile="lexical",
                       reconcileLlm="auto" if prose else "off")
        crash = prelude + """
          var originalAtomic = __miniAWikiMaintenanceJson
          __miniAWikiMaintenanceJson = function(path,value) {
            originalAtomic(path,value)
            if (%s === 'post-rename' && path === %s || %s === 'validation-receipt' && path.indexOf('/validation/') >= 0) java.lang.Runtime.getRuntime().halt(73)
          }
          var options = %s
          options.onProgress = function(progress) {if(progress.phase === %s) java.lang.Runtime.getRuntime().halt(73)}
          wm.graph('upgrade',options)
        """ % (json.dumps(boundary), json.dumps(str(graph)), json.dumps(boundary),
               json.dumps(options), json.dumps(boundary))
        execute(work, "crash", crash, 73)
        if boundary in ("structure", "graph", "ready", "validation-receipt"):
            assert graph.read_bytes() == previous, (boundary, "old graph replaced prematurely")
        output = execute(work, "resume", prelude + """
          var result = wm.graph('resume', %s)
          if (!result.complete) throw new Error('Recovery incomplete: ' + stringify(result))
          print('RESULT ' + stringify({edges:wm.graph('stats').edges,previous:result.previous},__,''))
          wm.close()
        """ % json.dumps(options))
        result = json.loads(next(line[7:] for line in output.splitlines() if line.startswith("RESULT ")))
        assert Path(result["previous"]).is_file(), (boundary, "missing verified predecessor")
        if prose:
            assert (work / "calls.txt").read_text().count("called") == 1, "completed validation was billed again"
        else:
            snapshot = json.loads(graph.read_text())
            assert sum(edge["type"] == "MENTIONS" for edge in snapshot["edges"]) == 2, boundary
    nodes = {"doc:a.md": {"type": "document", "props": {"path": "a.md", "hash": "a", "revision": "v1"}},
             "doc:b.md": {"type": "document", "props": {"path": "b.md", "hash": "b", "revision": "v1"}}}
    edges = []
    for number in range(1000):
        section = f"section:a.md#heading-{number}"
        nodes[section] = {"type": "section", "props": {"page": "a.md", "heading": str(number)}}
        edges.append({"from": "doc:a.md", "to": section, "type": "IN_SECTION", "provenance": "EXTRACTED", "props": {}})
    fixture = base / "statistics.json"
    fixture.write_text(json.dumps({"version": 2, "nodes": nodes, "edges": edges}))
    statistics = subprocess.run(["ojob", str(REPO / "utils/graphStats.yaml"),
                                 "file=" + str(fixture), "detailed=true", "__format=json"],
                                cwd=base, env=ENV, capture_output=True, text=True, timeout=60)
    assert statistics.returncode == 0, statistics.stdout + statistics.stderr
    report = json.loads(statistics.stdout)
    assert report["nodes"]["total"] == 1002 and report["edges"]["total"] == 1000
    assert report["connectivity"]["components"] == 2 and report["connectivity"]["averageMeaningfulNeighbors"] == 0
    print("PASS: 6 abrupt graph recovery boundaries and detailed statistics from an unrelated working directory")
