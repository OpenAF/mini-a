"""Exercise wiki guide publication from outside the checkout, without a model.

Run with a skills-capable ojob on PATH. Set WIKI_MCP_OJOB to a test launcher
command and WIKI_MCP_INCLUDES to a newer oJob-common checkout if needed.
Use --legacy-only to exercise a tools-only runtime.
"""
from contextlib import contextmanager
from functools import partial
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import select
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
from threading import Thread
import time
import urllib.error
import urllib.request
import zipfile

REPO = Path(__file__).resolve().parents[1]
STARTER = REPO / "examples" / "wiki-mcp-starter" / "wiki"
EXT = "io.modelcontextprotocol/skills"
MODERN = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {"extensions": {EXT: {}}},
}


@contextmanager
def server(work, descriptor="mcp-wiki", transport="stdio", extra=(), modern_env=False, root=None):
    args = [str(REPO / "mcps" / (descriptor + ".yaml")), "wikiroot=" + str(root or work / "wiki"),
            "label=Team Handbook", "wikiretrievalv2=false", "toolPrefix=kb-", *extra]
    if transport == "http":
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        args += [f"onport={port}", "host=127.0.0.1"]
    launcher = shlex.split(os.environ.get("WIKI_MCP_OJOB", "ojob"))
    env = dict(os.environ)
    env.pop("OJOB_MCP_MODERN", None)
    if modern_env:
        env["OJOB_MCP_MODERN"] = "true"
    with tempfile.TemporaryFile() as diagnostics:
        process = subprocess.Popen(launcher + args, cwd=work, env=env, stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=diagnostics, bufsize=0,
                                   start_new_session=True)
        counter = 0

        def rpc(method, params=None, modern=True, failure=False):
            nonlocal counter
            counter += 1
            params = dict(params or {})
            if modern:
                params["_meta"] = MODERN
            payload = json.dumps(dict(jsonrpc="2.0", id=counter, method=method, params=params)).encode()
            deadline = time.monotonic() + 25
            if transport == "http":
                req = urllib.request.Request(
                    f"http://127.0.0.1:{port}/mcp", data=payload,
                    headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"})
                while True:
                    try:
                        with urllib.request.urlopen(req, timeout=8) as response:
                            body = response.read().decode()
                        wire = next((line[5:] for line in body.splitlines() if line.startswith("data:")), body)
                        result = json.loads(wire)
                        break
                    except urllib.error.URLError:
                        if process.poll() is not None or time.monotonic() >= deadline:
                            raise
                        time.sleep(0.1)
            else:
                process.stdin.write(payload + b"\n")
                process.stdin.flush()
                while select.select([process.stdout], [], [], max(0, deadline - time.monotonic()))[0]:
                    line = process.stdout.readline()
                    if not line:
                        raise RuntimeError("MCP closed STDIO during " + method)
                    try:
                        result = json.loads(line)
                    except ValueError:
                        continue
                    if result.get("id") == counter:
                        break
                else:
                    raise TimeoutError(method)
            assert ("error" in result) is failure, result
            return result["error" if failure else "result"]

        try:
            yield rpc
        except Exception:
            diagnostics.seek(0)
            print(diagnostics.read().decode(errors="replace"), file=sys.stderr)
            raise
        finally:
            process.stdin.close()
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            process.stdout.close()


def tool(rpc, name, modern=True, **args):
    reply = rpc("tools/call", {"name": "kb-" + name, "arguments": args}, modern=modern)
    assert not reply.get("isError"), reply
    if "structuredContent" in reply:
        return reply["structuredContent"]
    return json.loads(reply["content"][0]["text"])


def skill_text(rpc, entry, relative):
    detail = rpc("skills/get", {"uri": entry["uri"]})["skill"]
    uri = entry["uri"].removesuffix("SKILL.md") + relative
    file = next(item for item in detail["resources"] if item["uri"] == uri)
    text = rpc("resources/read", {"uri": uri})["contents"][0]["text"]
    assert file["size"] == len(text.encode())
    assert file["digest"] == "sha256:" + hashlib.sha256(text.encode()).hexdigest()
    return text


def legacy(rpc):
    caps = rpc("initialize", {"protocolVersion": "2024-11-05", "capabilities": {},
                              "clientInfo": {"name": "wiki-guide-test", "version": "1"}}, modern=False)["capabilities"]
    assert EXT not in caps.get("extensions", {}), caps


def check_static_source(work):
    launcher = shlex.split(os.environ.get("WIKI_MCP_OJOB", "ojob"))
    command = launcher + [str(REPO / "utils/wikiOps.yaml"), "wikiroot=" + str(work / "wiki")]
    export = work / "export.zip"
    subprocess.run(command + ["operation=wiki.reindex", "wikiaccess=rw", "confirm=true"],
                   cwd=work, check=True, capture_output=True, timeout=45)
    subprocess.run(command + ["operation=wiki.export", "params=" + json.dumps({"output": str(export)})],
                   cwd=work, check=True, capture_output=True, timeout=45)
    published = work / "published"
    with zipfile.ZipFile(export) as bundle:
        bundle.extractall(published)

    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

    with ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=published)) as source:
        worker = Thread(target=source.serve_forever, daemon=True)
        worker.start()
        try:
            extra = ("modern=true", "wikibackend=http", f"wikiurl=http://127.0.0.1:{source.server_port}",
                     "wikiindexdir=" + str(work / "cache"), "wikiretrievalv2=true",
                     "wikiguide=team-handbook-guide/")
            with server(work, extra=extra) as rpc:
                entries = rpc("skills/list")["skills"]
                entry = next(item for item in entries if item["frontmatter"]["name"] == "team-handbook-guide")
                assert "scheduler" in skill_text(rpc, entry, "references/terminology.md")
                assert tool(rpc, "context")["retrieval"]["mode"] == "v2"
        finally:
            source.shutdown()
            worker.join()
    print("static HTTP wiki skill checks passed", flush=True)


def check(work, legacy_only):
    guide = "wikiguide=team-handbook-guide/"
    with server(work, extra=(guide,)) as rpc:
        legacy(rpc)
        assert tool(rpc, "context", modern=False)["wikis"][0]["guidePath"].endswith("/SKILL.md")
        assert "Next retry" in json.dumps(tool(rpc, "read", modern=False, path="operations/scheduler.md"))
    if legacy_only:
        with server(work, extra=(guide, "modern=true")) as rpc:
            legacy(rpc)
        return

    glossary = work / "wiki/team-handbook-guide/references/terminology.md"
    mounts = "wikimounts=" + json.dumps([
        {"name": "platform", "root": str(work / "platform"), "wikiguide": "team-handbook-guide/"},
        {"name": "second", "root": str(work / "platform"), "wikiguide": "missing.md"},
    ], separators=(",", ":"))
    transports = os.environ.get("WIKI_TRANSPORTS", "stdio,http").split(",")
    for transport in transports:
        with server(work, transport=transport, extra=(guide, mounts), modern_env=True) as rpc:
            caps = rpc("server/discover")["capabilities"]
            assert EXT in caps["extensions"], caps
            entries = {item["frontmatter"]["name"]: item for item in rpc("skills/list")["skills"]}
            assert set(entries) == {"mini-a-wiki-retrieval", "team-handbook-guide", "platform-guide"}, entries
            assert "guidePath" in skill_text(rpc, entries["mini-a-wiki-retrieval"], "references/retrieval.md")
            entry = entries["team-handbook-guide"]
            assert len(entry["resources"]) == 3, entry
            assert "scheduler" in skill_text(rpc, entry, "references/terminology.md")
            assert "operations/" in skill_text(rpc, entry, "references/workflows/finding-current-procedures.md")
            assert "Team terminology" in skill_text(rpc, entries["platform-guide"], "references/terminology.md")
            scoped = tool(rpc, "context", wiki="platform")
            assert scoped["wikis"][0]["guidePath"] == "@platform/team-handbook-guide/SKILL.md", scoped
            assert "Navigate the Team Handbook" in json.dumps(tool(rpc, "read", path=scoped["wikis"][0]["guidePath"]))
            overview = {item["name"]: item for item in tool(rpc, "context")["wikis"]}
            assert overview["second"]["guidePath"] == "@second/missing.md"
            assert "scheduler.md" in json.dumps(tool(rpc, "search", query="scheduler"))
            assert "Next retry" in json.dumps(tool(rpc, "read", path="operations/scheduler.md"))
            assert "operations" in json.dumps(tool(rpc, "tree"))
            marker = "Updated guide reference " + transport
            old = glossary.read_text()
            glossary.write_text(old + "\n" + marker + "\n")
            assert marker in json.dumps(tool(rpc, "read", path="team-handbook-guide/references/terminology.md"))
            assert marker not in skill_text(rpc, entry, "references/terminology.md")
        with server(work, transport=transport, extra=(guide, "modern=true")) as rpc:
            entry = next(item for item in rpc("skills/list")["skills"] if item["frontmatter"]["name"] == "team-handbook-guide")
            assert marker in skill_text(rpc, entry, "references/terminology.md")
        with server(work, transport=transport, extra=(guide, "modern=true", "wikimcpskills=false")) as rpc:
            assert EXT not in rpc("server/discover")["capabilities"].get("extensions", {})
            assert tool(rpc, "context")["wikis"][0]["guidePath"].endswith("/SKILL.md")
        for profile in ("tight", "off"):
            with server(work, "mcp-wiki-safe", transport, (guide, "modern=true", "wikirestrictprofile=" + profile)) as rpc:
                entries = rpc("skills/list")["skills"]
                assert [item["frontmatter"]["name"] for item in entries] == ["mini-a-wiki-safe-retrieval"]
                resources = rpc("resources/list")["resources"]
                assert [item["uri"] for item in resources] == [entries[0]["uri"]], resources
                text = skill_text(rpc, entries[0], "SKILL.md")
                opaque = profile != "off"
                assert ("opaque reference" in text) == opaque
                tools = {item["name"]: item for item in rpc("tools/list")["tools"]}
                assert set(tools) == {"kb-search", "kb-read"}
                assert ("opaque reference" in tools["kb-read"]["description"]) == opaque, tools
                hit = tool(rpc, "search", query="waiting jobs")["results"][0]
                read = tool(rpc, "read", path=hit["reference" if opaque else "path"])
                assert "Next retry" in json.dumps(read), read
        print(transport + " wiki skill checks passed", flush=True)

    archive = work / "handbook.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        for page in STARTER.rglob("*.md"):
            bundle.write(page, page.relative_to(STARTER))
    with server(work, root=archive, extra=(guide, "modern=true")) as rpc:
        entry = next(item for item in rpc("skills/list")["skills"] if item["frontmatter"]["name"] == "team-handbook-guide")
        assert "scheduler" in skill_text(rpc, entry, "references/terminology.md")
    print("archive wiki skill checks passed", flush=True)
    if "http" in transports:
        check_static_source(work)


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="wiki-mcp-skills-") as temporary:
        work = Path(temporary)
        for name in ("wiki", "platform"):
            shutil.copytree(STARTER, work / name)
        mounted = work / "platform/team-handbook-guide/SKILL.md"
        mounted.write_text(mounted.read_text().replace("name: team-handbook-guide", "name: platform-guide"))
        includes = os.environ.get("WIKI_MCP_INCLUDES")
        if includes:
            for name in ("oJobMCP.yaml", "oJobHTTPd.yaml"):
                (work / name).symlink_to(Path(includes).resolve() / name)
        check(work, "--legacy-only" in sys.argv)
