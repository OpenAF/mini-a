#!/usr/bin/env python3
"""Crash the real folder worker between filesystem changes and publication.
Run from any directory; fixtures and retained recovery snapshots are disposable.
"""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

base = Path(__file__).resolve().parents[1]
oaf = shutil.which("oaf") or "oaf"
with tempfile.TemporaryDirectory(prefix="wiki-folder-crash-", dir="/private/tmp") as temp:
    parent = Path(temp)
    for operation in ("move", "delete"):
        root = parent / operation
        (root / "old" / "empty").mkdir(parents=True)
        (root / "old" / "index.md").write_text("# Original\n")
        (root / "old" / "asset.bin").write_bytes(b"\x00\xffretained")
        (root / "incoming.md").write_text("# Incoming\n[Old](old/index.md)\n")
        common = "loadLib(" + json.dumps(str(base / "js/wiki/mini-a-wiki.js")) + ")\n"
        cfg = {"backend": "fs", "root": str(root), "access": "rw", "skipBootstrap": True, "wikiretrievalv2": True}
        crash = parent / "crash.js"
        crash.write_text(common + "var wm = new MiniAWikiManager(" + json.dumps(cfg) + ")\n"
                         + 'var preview = wm.previewFolder("old", ' + ('"new"' if operation == "move" else 'null') + ')\n'
                         + 'if (!preview.ok) throw new Error(JSON.stringify(preview))\n'
                         + 'var options = {expectedRevision:preview.revision,confirmation:"old",onProgress:function(message) { if (message.indexOf("Publishing") === 0) java.lang.Runtime.getRuntime().halt(23) }}\n'
                         + ('wm.moveFolder("old","new",options)' if operation == "move" else 'wm.deleteFolder("old",options)') + '\nthrow new Error("Expected crash checkpoint")\n')
        killed = subprocess.run([oaf, "-f", str(crash)], cwd=parent, capture_output=True, text=True, timeout=60)
        assert killed.returncode == 23, killed.stdout + killed.stderr
        journal_path = root / ".mini-a-wiki-folders/pending.json"
        journal = json.loads(journal_path.read_text())
        assert journal["phase"] == "publishing"
        assert not (root / "old").exists()
        cfg.update({"folderRecovery": True, "maintenanceSourceOnly": True})
        recover = parent / "recover.js"
        recover.write_text(common + "var wm = new MiniAWikiManager(" + json.dumps(cfg) + ")\n"
                           + "var result = wm.restoreFolder(" + json.dumps(journal["id"]) + ")\nwm.close()\n"
                           + 'if (!result.ok) throw new Error(JSON.stringify(result))\nprint("RESTORED")\n')
        restored = subprocess.run([oaf, "-f", str(recover)], cwd=parent, capture_output=True, text=True, timeout=60)
        assert restored.returncode == 0 and "RESTORED" in restored.stdout, restored.stdout + restored.stderr
        assert not journal_path.exists()
        assert (root / "old" / "empty").is_dir()
        assert (root / "old" / "asset.bin").read_bytes() == b"\x00\xffretained"
        assert (root / "old" / "index.md").read_text() == "# Original\n"
        assert not (root / "new").exists()
        print("PASS:", operation, "process interruption, persistent journal, fresh-process verified rollback")
