#!/usr/bin/env python3
"""Model-free HTTP/worker E2E using isolated disposable wiki/state directories."""
import argparse
import json
import io
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument("--base", default=str(Path(__file__).resolve().parents[1]))
args = parser.parse_args()
base = Path(args.base).resolve()
temp = Path(tempfile.mkdtemp(prefix="wiki-studio-http-", dir="/private/tmp"))
token = "disposable-integration-token-" + uuid.uuid4().hex
with socket.socket() as s:
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
url = f"http://127.0.0.1:{port}/api/v1/"
checks = 0


def request(path, method="GET", body=None, status=200, auth=True, headers=None, raw=None):
    global checks
    h = {"Authorization": "Bearer " + token} if auth else {}
    h.update(headers or {})
    if body is not None:
        h["Content-Type"] = "application/json"
    data = raw if raw is not None else json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url + path, method=method, headers=h, data=data)
    try:
        response = urllib.request.urlopen(req, timeout=30)
    except urllib.error.HTTPError as error:
        response = error
    content = response.read()
    assert response.status == status, (path, response.status, content[:800])
    checks += 1
    if "application/json" in response.headers.get("Content-Type", ""):
        return json.loads(content)
    return content.decode()


def job(path, body):
    key = uuid.uuid4().hex
    submitted = request(path, "POST", body, headers={"Idempotency-Key": key})
    duplicate = request(path, "POST", body, headers={"Idempotency-Key": key})
    assert submitted["id"] == duplicate["id"]
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        result = request("jobs/" + submitted["id"])
        if result["status"] in {"completed", "failed", "partial", "recovery-required", "interrupted", "cancelled"}:
            assert result["status"] == "completed", result
            events = request("jobs/" + result["id"] + "/events")
            assert "event: progress" in events
            last_seq = max(int(line[4:]) for line in events.splitlines() if line.startswith("id: "))
            replay = request("jobs/" + result["id"] + "/events", headers={"Last-Event-ID": str(last_seq)})
            assert "data: " not in replay
            request("jobs/" + result["id"] + "/events", auth=False, status=401)
            return result
        time.sleep(0.3)
    raise AssertionError("Worker timeout: " + submitted["id"])


root = temp / "wikis"
root.mkdir()
for name in ["a", "b"]:
    (root / name).mkdir()
(root / "b" / "separate.md").write_text("# Separate wiki\n")
env = os.environ.copy()
env["STUDIO_TOKEN"] = token
env.pop("OAF_MODEL", None)
env.pop("OAF_LC_MODEL", None)
log = open(temp / "server.log", "w")
proc = subprocess.Popen([shutil.which("ojob") or "ojob", str(base / "mini-a-wiki-studio.yaml"), f"onport={port}", f"studiohome={temp / 'state'}", "studioallowroots=" + json.dumps([str(root)]), "openbrowser=false"], cwd=temp, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
try:
    deadline = time.monotonic() + 40
    while True:
        try:
            request("health")
            break
        except (OSError, TimeoutError):
            if time.monotonic() > deadline:
                raise AssertionError((temp / "server.log").read_text())
            time.sleep(0.3)
    # Static assets must come from the selected package even from an unrelated cwd.
    for route, relative in [("/", "index.html"), ("/studio.js", "studio.js"), ("/studio.css", "studio.css")]:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}" + route, timeout=30) as response:
            assert response.status == 200
            assert response.read() == (base / "public/studio" / relative).read_bytes()
            checks += 1
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/js/chart.js", timeout=30) as response:
        assert response.status == 200 and b"Chart" in response.read()
        checks += 1
    for path in ["health", "session", "wikis", "jobs", "audit", "wikis/a/graph/html"]:
        request(path, auth=False, status=401)
    request("session", headers={"Origin": "https://evil.invalid"}, status=403)
    for name in ["a", "b"]:
        request("wikis", "POST", {"id": name, "name": name.upper(), "root": str(root / name), "access": "rw"})
    page = request("wikis/a/pages", "POST", {"path": "first.md", "content": "---\r\ntitle: 'First' # keep\r\n---\r\n# First\r\n[[next]]\r\n", "expectedRevision": None})
    assert "# keep\r\n" in page["content"]
    request("wikis/a/page?path=first.md", "PUT", {"content": "# Conflict", "expectedRevision": "old"}, status=409)
    page = request("wikis/a/page?path=first.md", "PUT", {"content": page["content"] + "Extra\r\n", "expectedRevision": page["revision"]})
    request("wikis/a/page?path=..%2Foutside.md", status=400)
    request("wikis/a/page?path=AGENTS.md", status=400)
    request("wikis/a/search?q=First")
    aggregate = request("search?q=wiki")
    assert len(aggregate["coverage"]) == 2
    request("wikis/a/backlinks?path=first.md")
    children = request("wikis/a/children?limit=1")
    assert children["items"] and children["total"] >= 1
    request("wikis/a/children?path=..%2Foutside", status=400)
    graph_status = request("wikis/a/graph/stats")
    assert graph_status["source"] in {"markdown-links-fallback", "knowledge-graph-snapshot"}
    request("wikis/a", "PATCH", {"graph": {"enabled": False}})
    assert request("wikis/a/graph/stats")["source"] == "markdown-links-fallback"
    request("wikis/a", "PATCH", {"graph": {"enabled": True}})

    for attack in ["slip", "symlink", "duplicate", "bomb", "encrypted"]:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as z:
            if attack == "slip":
                z.writestr("../escape.md", "escape")
            elif attack == "symlink":
                info = zipfile.ZipInfo("link.md")
                info.create_system = 3
                info.external_attr = 0xA1FF << 16
                z.writestr(info, "target.md")
            elif attack == "duplicate":
                z.writestr("A.md", "one")
                z.writestr("a.md", "two")
            elif attack == "bomb":
                z.writestr("large.md", "a" * 1048576)
            else:
                z.writestr("private.md", "encrypted flag")
        data = bytearray(buf.getvalue())
        if attack == "encrypted":
            data[data.index(b"PK\x01\x02") + 8] |= 1
            data[6] |= 1
        upload_id = str(uuid.uuid4())
        request("uploads", "POST", headers={"X-Upload-ID": upload_id, "X-Upload-Path": "attack.zip"}, raw=bytes(data))
        request("wikis/a/sources", "POST", {"id": attack, "name": attack, "type": "upload", "uploadId": upload_id}, status=400)
    assert not (temp / "escape.md").exists()
    assert (root / "b" / "separate.md").read_text() == "# Separate wiki\n"
    html = request("wikis/b/graph/html")
    assert "Markdown page links" in html and "mini-a-wiki-graph-node" in html
    job("wikis/a/graph/rebuild", {"semantic": False})
    before = {p.relative_to(root / "a"): p.read_bytes() for p in (root / "a").rglob("*") if p.is_file()}
    job("wikis/a/dreams", {"mode": "plan", "options": {"semantic": False}})
    after = {p.relative_to(root / "a"): p.read_bytes() for p in (root / "a").rglob("*") if p.is_file()}
    assert before == after, "Plan changed the wiki"
    request("wikis/a/dreams", "POST", {"mode": "reorg", "options": {}}, status=400, headers={"Idempotency-Key": uuid.uuid4().hex})
    upload_id = str(uuid.uuid4())
    request("uploads", "POST", headers={"X-Upload-ID": upload_id, "X-Upload-Path": "nested%2Fsource.md"}, raw=b"# Imported\n\nA deterministic source.\n")
    request("wikis/a/sources", "POST", {"id": "docs", "name": "Docs", "type": "upload", "uploadId": upload_id})
    job("wikis/a/ingestions", {"sourceId": "docs", "revision": upload_id, "preview": True, "options": {"mode": "raw"}})
    applied = job("wikis/a/ingestions", {"sourceId": "docs", "revision": upload_id, "preview": False, "options": {"mode": "raw"}})
    assert applied["backupId"]
    job("wikis/a/dreams", {"mode": "indexes", "options": {"semantic": False}})
    # Recursive operations use real workers, verified snapshots and deduplicated requests.
    folder = root / "b" / "old folder"
    (folder / "nested" / "empty").mkdir(parents=True)
    (folder / "index.md").write_text("# Folder\n[Page](nested/café.md)\n")
    (folder / "nested" / "café.md").write_text("# FolderNeedle\n![Asset](../asset.bin)\n")
    (folder / "asset.bin").write_bytes(b"\x00\xffasset")
    (root / "b" / "incoming.md").write_text("# Incoming\n[Folder](old folder/index.md)\n[unfinished](" + "x" * 4096 + "\n")
    preview = request("wikis/b/folders/preview", "POST", {"source": "old folder", "destination": "renamed folder"})
    assert (preview["pages"], preview["files"], preview["folders"]) == (2, 3, 3)
    assert preview["incomingLinks"][0]["path"] == "incoming.md"
    moved = job("wikis/b/folders/move", {"source": "old folder", "destination": "renamed folder", "expectedRevision": preview["revision"]})
    assert moved["backupId"] and moved["result"]["recovery_pending"] is False
    assert (root / "b" / "renamed folder" / "nested" / "empty").is_dir()
    assert (root / "b" / "renamed folder" / "asset.bin").read_bytes() == b"\x00\xffasset"
    preview = request("wikis/b/folders/preview", "POST", {"source": "renamed folder"})
    request("wikis/b/folders/delete", "POST", {"source": "renamed folder", "expectedRevision": preview["revision"], "confirmation": "wrong"}, status=400)
    incoming = (root / "b" / "incoming.md").read_bytes()
    deleted = job("wikis/b/folders/delete", {"source": "renamed folder", "expectedRevision": preview["revision"], "confirmation": "renamed folder"})
    assert not (root / "b" / "renamed folder").exists()
    assert (root / "b" / "incoming.md").read_bytes() == incoming
    fingerprint = request("wikis/b/overview")["studio"]["fingerprint"]
    restore_id = deleted["backupId"]
    job("wikis/b/backups/" + restore_id + "/restore", {"expectedFingerprint": fingerprint, "confirmation": restore_id + ":" + fingerprint, "externalProcessesStopped": True})
    assert (root / "b" / "renamed folder" / "nested" / "empty").is_dir()
    assert (root / "b" / "renamed folder" / "asset.bin").read_bytes() == b"\x00\xffasset"
    backup_job = job("wikis/a/backups", {})
    backup_id = backup_job["result"]["backupId"]
    fingerprint = request("wikis/a/overview")["studio"]["fingerprint"]
    job("wikis/a/backups/" + backup_id + "/restore", {"expectedFingerprint": fingerprint, "confirmation": backup_id + ":" + fingerprint, "externalProcessesStopped": True})
    history = request("jobs?wikiId=a")["items"]
    assert all(j["deletion"]["allowed"] for j in history)
    request("jobs/" + backup_job["id"], "DELETE", {"wikiId": "a", "confirmation": "delete-history"}, auth=False, status=401)
    request("jobs/" + backup_job["id"], "DELETE", {"wikiId": "b", "confirmation": "delete-history"}, status=404)
    request("jobs/" + backup_job["id"], "DELETE", {"wikiId": "a", "confirmation": "delete-history"})
    request("jobs/" + backup_job["id"], status=404)
    backups = request("wikis/a/backups")["items"]
    assert next(b for b in backups if b["id"] == backup_id)["origin"] == "manual"
    request("wikis/a/backups/" + backup_id, "DELETE", {"confirmation": "wrong"}, status=400)
    request("wikis/a/backups/" + backup_id, "DELETE", {"confirmation": backup_id, "acknowledgeLast": True})
    assert backup_id not in {b["id"] for b in request("wikis/a/backups")["items"]}
    retained = request("jobs?wikiId=a")["items"]
    request("jobs", "DELETE", {"wikiId": "a", "ids": [j["id"] for j in retained], "confirmation": "delete-history"})
    assert request("jobs?wikiId=a")["total"] == 0
    request("wikis/b", "PATCH", {"access": "ro"})
    request("wikis/b/pages", "POST", {"path": "denied.md", "content": "# Denied", "expectedRevision": None}, status=403)
    request("wikis/b/dreams", "POST", {"mode": "apply"}, status=403, headers={"Idempotency-Key": uuid.uuid4().hex})
    request("wikis/b", "DELETE")
    assert (root / "b" / "separate.md").is_file()
    # Simulate an abrupt crash; no active engine is being interrupted here.
    os.killpg(proc.pid, signal.SIGKILL)
    proc.wait(timeout=10)
    before_restart = {p.relative_to(root / "a"): p.read_bytes() for p in (root / "a").rglob("*") if p.is_file()}
    seeded = []
    for state in ["queued", "running"]:
        job_id = str(uuid.uuid4())
        directory = temp / "state/jobs" / job_id
        directory.mkdir()
        (directory / "job.json").write_text(json.dumps({"version": 1, "id": job_id, "wikiId": "a", "operation": "dream.reorg", "params": {}, "status": state, "createdAt": "2026-01-01T00:00:00Z", "phase": state}))
        seeded.append(job_id)
    proc = subprocess.Popen([shutil.which("ojob") or "ojob", str(base / "mini-a-wiki-studio.yaml"), f"onport={port}", f"studiohome={temp / 'state'}", "studioallowroots=" + json.dumps([str(root)]), "openbrowser=false"], cwd=temp, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    deadline = time.monotonic() + 40
    while True:
        try:
            request("health")
            break
        except OSError:
            if time.monotonic() > deadline:
                raise AssertionError((temp / "server.log").read_text())
            time.sleep(0.3)
    for job_id in seeded:
        assert request("jobs/" + job_id)["status"] == "interrupted"
    request("jobs", "DELETE", {"wikiId": "a", "ids": seeded, "confirmation": "delete-history"}, status=409)
    assert before_restart == {p.relative_to(root / "a"): p.read_bytes() for p in (root / "a").rglob("*") if p.is_file()}, "Restart replayed a mutating job"
    print(f"PASS: {checks} HTTP assertions; real isolated worker, raw ingest, plan, graph, indexes, backup and restore; no model/network")
finally:
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        proc.wait()
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    log.close()
    if os.environ.get("STUDIO_KEEP_TESTS"):
        print("Retained test state:", temp)
    else:
        shutil.rmtree(temp)
