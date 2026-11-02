#!/usr/bin/env python3
"""Model-free HTTP/worker E2E using isolated disposable wiki/state directories."""
import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

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
proc = subprocess.Popen([shutil.which("ojob") or "ojob", str(base / "mini-a-wiki-studio.yaml"), f"onport={port}", f"studiohome={temp / 'state'}", "studioallowroots=" + json.dumps([str(root)])], cwd=temp, env=env, stdout=log, stderr=subprocess.STDOUT)
try:
    deadline = time.monotonic() + 40
    while True:
        try:
            request("health")
            break
        except (urllib.error.URLError, TimeoutError):
            if time.monotonic() > deadline:
                raise AssertionError((temp / "server.log").read_text())
            time.sleep(0.3)
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
    request("wikis/a/backlinks?path=first.md")
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
    backup_job = job("wikis/a/backups", {})
    backup_id = backup_job["result"]["backupId"]
    fingerprint = request("wikis/a/overview")["studio"]["fingerprint"]
    job("wikis/a/backups/" + backup_id + "/restore", {"expectedFingerprint": fingerprint, "confirmation": backup_id + ":" + fingerprint, "externalProcessesStopped": True})
    request("wikis/b", "PATCH", {"access": "ro"})
    request("wikis/b/pages", "POST", {"path": "denied.md", "content": "# Denied", "expectedRevision": None}, status=403)
    request("wikis/b/dreams", "POST", {"mode": "apply"}, status=403, headers={"Idempotency-Key": uuid.uuid4().hex})
    request("wikis/b", "DELETE")
    assert (root / "b" / "separate.md").is_file()
    print(f"PASS: {checks} HTTP assertions; real isolated worker, raw ingest, plan, graph, indexes, backup and restore; no model/network")
finally:
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
    log.close()
    if os.environ.get("STUDIO_KEEP_TESTS"):
        print("Retained test state:", temp)
    else:
        shutil.rmtree(temp)
