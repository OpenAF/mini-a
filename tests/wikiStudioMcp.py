"""Exercise MCP source capture with a real Studio, worker and counting loopback MCP."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
from threading import Thread
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import uuid

test_dir = Path(__file__).resolve().parent
calls = []
tickets = [{"title": "First", "status": None, "notes": "private | <em>notes</em>"}, {"title": "Second"}]
schema = {"type": "object", "additionalProperties": False, "required": ["label"], "properties": {
    "label": {"type": "string", "description": "Report label"},
    "enabled": {"type": "boolean", "default": True}, "count": {"type": "integer", "minimum": 0},
    "query": {"type": "object", "required": ["nested"]},
    "mode": {"enum": ["tickets", "text", "json", "error", "large", "wait", "unsupported"]}}}


class CountingMcp(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        msg = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        method = msg["method"]
        if "id" not in msg:
            self.send_response(202)
            self.end_headers()
            return
        if method == "initialize":
            result = {"protocolVersion": msg["params"]["protocolVersion"], "serverInfo": {"name": "counter", "version": "1"},
                      "capabilities": {"tools": {}}}
        elif method == "tools/list":
            result = {"tools": [] if self.path == "/empty" else [{"name": "report", "description": "Fetch tickets", "inputSchema": schema}]}
        elif method == "tools/call":
            args = msg["params"]["arguments"]
            calls.append((self.path, args))
            mode = args.get("mode")
            if mode == "wait":
                time.sleep(2)
            result = {"structuredContent": {"tickets": tickets}, "content": [{"type": "text", "text": "fallback"},
                                                                            {"type": "image", "data": "AA==", "mimeType": "image/png"}]}
            if mode in ("text", "json", "error", "large", "unsupported"):
                texts = {"text": "# Raw Markdown\n\nText", "json": json.dumps(tickets), "error": "Error text", "large": "x" * 100000}
                result = {"content": [{"type": "text", "text": texts[mode]}]} if mode in texts else {"content": [{"type": "audio"}]}
                if mode == "error":
                    result["isError"] = True
        else:
            result = {}
        body = json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": result}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass


def run(tmp, browser, base):
    token, session = uuid.uuid4().hex, str(uuid.uuid4())
    mcp = ThreadingHTTPServer(("127.0.0.1", 0), CountingMcp)
    Thread(target=mcp.serve_forever, daemon=True).start()
    remote = f"http://127.0.0.1:{mcp.server_port}"
    root = tmp / "wikis"
    for wiki in ("a", "b"):
        (root / wiki).mkdir(parents=True)
    plugin = tmp / "plugin"
    plugin.mkdir()
    (plugin / "plugin.json").write_text(json.dumps({"$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", "name": "fixture"}))
    (plugin / "mcp.json").write_text(json.dumps({"$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
        "mcpServers": {"tickets": {"type": "streamable-http", "url": remote + "/plugin"}}}))
    managed = tmp / ".openaf-mini-a/managed-plugins/disabled"
    (managed / "package").mkdir(parents=True)
    (managed / "state.json").write_text(json.dumps({"enabled": False}))
    (managed / "package/plugin.json").write_text((plugin / "plugin.json").read_text().replace('"fixture"', '"disabled"'))
    (managed / "package/mcp.json").write_text((plugin / "mcp.json").read_text())
    # The active mode supplies the plugin path. The explicit launch catalog overrides its MCP default.
    (tmp / ".openaf-mini-a/modes.yaml").write_text(json.dumps({"fixture": {"params": {"plugins": str(plugin), "mcp": {"id": "overridden"}}}}))
    configs = [{"id": key, "type": "remote", "url": remote + path, "timeout": timeout}
               for key, path, timeout in [("Launch", "/launch", 6000), ("Empty", "/empty", 2000), ("Slow", "/slow", 300)]]
    configs += [{"id": "Offline", "type": "remote", "url": "http://127.0.0.1:1", "timeout": 300},
                {"type": "ojob", "options": {"job": "mcps/mcp-math.yaml"}}]
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        origin = f"http://127.0.0.1:{sock.getsockname()[1]}"
    env = {k: v for k, v in os.environ.items() if not k.endswith("_MODEL")}
    env["STUDIO_TOKEN"] = token
    state = tmp / "state"
    log = (tmp / "server.log").open("w")
    proc = subprocess.Popen(["ojob", str(base / "mini-a-wiki-studio.yaml"), "onport=" + origin.split(":")[-1], f"studiohome={state}",
        f"homedir={tmp}", "mode=fixture", "studioallowroots=" + json.dumps([str(root)]), "mcp=" + json.dumps(configs),
        "studiomaxsourcebytes=32768", "studiomaxbatchbytes=65536", "openbrowser=false"], cwd=tmp, env=env, stdout=log, stderr=log, start_new_session=True)

    def api(route, body=None, status=200, owner=session):
        req = Request(origin + "/api/v1/" + route, data=json.dumps(body).encode() if body is not None else None,
                      headers={"Authorization": "Bearer " + token, "Content-Type": "application/json", "X-Studio-Session": owner, "Idempotency-Key": uuid.uuid4().hex})
        try:
            response = urlopen(req, timeout=30)
        except HTTPError as e:
            response = e
        with response:
            result = json.load(response)
            assert response.status == status, (route, response.status, result)
            return result

    try:
        for _ in range(150):
            try:
                api("health")
                break
            except URLError:
                if proc.poll() is not None:
                    raise AssertionError((tmp / "server.log").read_text())
                time.sleep(.2)
        for wiki in ("a", "b"):
            api("wikis", {"id": wiki, "name": wiki.upper(), "root": str(root / wiki), "access": "rw"})
        route = "wikis/a/mcp/"
        catalog = api(route + "connections")["items"]
        keys = {e["label"]: e["id"] for e in catalog}
        assert "plugin:disabled:tickets" not in keys and "overridden" not in keys
        assert all(set(e) == {"label", "id"} for e in catalog)
        if browser:
            for theme, width in [("light", 1200), ("dark", 1200), ("dark", 390)]:
                before = len(calls)
                subprocess.run(["node", str(test_dir / "wikiStudioMcpBrowser.cjs"), origin, token, theme, str(width), str(tmp)], check=True, timeout=110)
                assert len(calls) == before + 3, "Only the explicit clicks may invoke a tool"
            calls.clear()
        for label in ("Launch", "plugin:fixture:tickets"):
            discovered = api(route + "tools?connection=" + keys[label])
            assert discovered["items"][0]["inputSchema"] == schema
            assert discovered["label"] == label + " · counter", discovered["label"]
        assert api(route + "tools?connection=" + keys["mcp-math.yaml"])["items"]
        bundled = api(route + "call", {"connection": keys["mcp-math.yaml"], "tool": "calculate", "arguments": {"operation": "add", "values": [2, 3]}})
        assert [0, "result"] in bundled["fields"] and "# result\n\n5" in bundled["markdown"], bundled["markdown"]
        assert api(route + "tools?connection=" + keys["Empty"])["items"] == []
        api(route + "tools?connection=" + keys["Offline"], status=502)

        def call(args, status=200, label="Launch", tool="report"):
            return api(route + "call", {"connection": keys[label], "tool": tool, "arguments": args}, status)

        for invalid in ({}, {"label": "ok", "count": "0"}, {"label": "ok", "query": {}}):
            call(invalid, 400)
        call({}, 409, tool="removed")
        assert not calls
        args = {"label": "", "count": 0, "enabled": False, "query": {"nested": "argument-secret"}}
        result = call(args, label="plugin:fixture:tickets")
        assert calls == [("/plugin", args)]
        assert result["unsupported"] == ["image"] and "fallback" not in result["markdown"]
        selection = [[0, "tickets", "title"], [0, "tickets", "status"]]
        pick = {"resultId": result["resultId"], "selection": selection}
        api(route + "preview", pick, 410, owner=str(uuid.uuid4()))
        api("wikis/b/mcp/preview", pick, 410)
        markdown = api(route + "preview", pick)["markdown"]
        assert markdown.splitlines() == ["# tickets", "", "| title | status |", "| --- | --- |", "| First | null |", "| Second |  |"]
        stage = dict(pick, id="sample", name="Sample", expectedRevision=None, adhoc=False)
        source = api(route + "stage", stage)
        assert source["type"] == "mcp" and list(source["files"]) == ["sample.md"]
        assert (state / "sources/uploads" / source["revision"] / "files/sample.md").read_bytes() == markdown.encode("utf-8")
        assert source["origin"] == {"connection": keys["plugin:fixture:tickets"], "tool": "report", "selection": selection}
        api(route + "stage", stage, 410)

        def ingest(record, preview):
            job = api("wikis/a/ingestions", {"sourceId": record["id"], "revision": record["revision"], "preview": preview, "options": {"mode": "normalize"}})
            for _ in range(180):
                job = api("jobs/" + job["id"])
                if job["status"] == "completed":
                    return
                assert job["status"] not in ("failed", "partial", "cancelled", "interrupted", "recovery-required"), job
                time.sleep(.25)
            raise AssertionError("Import timed out")

        ingest(source, True)
        ingest(source, False)
        assert len(calls) == 1
        for mode, status in [("error", 502), ("large", 413), ("unsupported", 422)]:
            call({"label": "", "mode": mode}, status)
        call({"label": "", "mode": "wait"}, 504, "Slow")
        fresh = call({"label": "again", "mode": "json"})
        assert calls[-1][1] == {"label": "again", "mode": "json"}
        revision = dict(stage, resultId=fresh["resultId"], expectedRevision=source["revision"])
        api(route + "stage", revision, 400)
        assert api("wikis/a/sources")["items"][0]["revision"] == source["revision"]
        updated = api(route + "stage", dict(revision, selection=[[0, "title"]]))
        assert list(updated["files"]) == ["sample.md"] and updated["lineage"] == [source["revision"]]
        plain = call({"label": "", "mode": "text"})
        assert plain["markdown"] == "# Raw Markdown\n\nText"
        oneoff = api(route + "stage", dict(stage, id="once", adhoc=True, selection=None, resultId=plain["resultId"]))
        ingest(oneoff, True)
        ingest(oneoff, False)
        assert not (state / "sources/uploads" / oneoff["revision"]).exists()
        assert [r["id"] for r in api("wikis/a/sources")["items"]] == ["sample"]
        assert "argument-secret" not in "".join(p.read_text() for folder in ["sources/records", "audit"] for p in (state / folder).rglob("*") if p.is_file())
        print("PASS: MCP discovery, schema, capture ownership, projection, errors, updates, import and cleanup", flush=True)
    finally:
        if proc.poll() is None:
            os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(timeout=20)
        mcp.shutdown()
        log.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--browser", action="store_true")
    parser.add_argument("--base", type=Path, default=test_dir.parent)
    options = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="wiki-studio-mcp-", dir="/private/tmp") as temp:
        run(Path(temp), options.browser, options.base.resolve())
