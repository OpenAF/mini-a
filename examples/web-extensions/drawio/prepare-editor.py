#!/usr/bin/env python3
"""Prepare an existing pinned draw.io checkout for a local Mini-A asset mount.

Apache-2.0. Never downloads, modifies the source checkout, or grants conformance.
"""
import argparse
import hashlib
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import shutil
import subprocess

COMMIT = "c72c9a98b7a6ce392556ed04c05e0ff19f43f5c3"
MAX_FILE = 64 * 1024 * 1024
MAX_TOTAL = 512 * 1024 * 1024
CONFIG = """
// Mini-A local-only profile. Added by prepare-editor.py; upstream license retained.
window.DRAWIO_PUBLIC_BUILD = true;
window.ALLOW_CUSTOM_PLUGINS = false;
window.EXPORT_URL = null;
window.PROXY_URL = null;
window.OPEN_URL = null;
window.LOG_URL = null;
window.DRAWIO_LOG_URL = null;
window.AI_URL = null;
window.DRAWIO_AI_URL = null;
window.ICONSEARCH_PATH = null;
window.ICON_SERVICE_PATH = null;
window.DRAWIO_CONFIG = Object.assign({}, window.DRAWIO_CONFIG || {}, {
  lockdown: true, enableCustomLibraries: false, customLibraries: [], plugins: [],
  defaultFonts: ['Arial', 'Helvetica', 'Verdana', 'Times New Roman', 'Courier New'],
  defaultVertexStyle: {html: 0, fontFamily: 'Arial'},
  defaultEdgeStyle: {html: 0, fontFamily: 'Arial'}, mathJaxRender: false
});
if (typeof mxObjectCodec !== 'undefined') {
  mxObjectCodec.allowEval = false;
  mxObjectCodec.allowInclude = false;
}
if (typeof mxStylesheetCodec !== 'undefined') mxStylesheetCodec.allowEval = false;
if (typeof mxStencil !== 'undefined') mxStencil.allowEval = false;
if (typeof mxGraphView !== 'undefined') mxGraphView.prototype.allowEval = false;
"""


class Bootstrap(HTMLParser):
    """Externalize inline JS without granting CSP unsafe-inline or eval."""
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.parts = []
        self.scripts = {}
        self.active = None

    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if name.lower().startswith("on"):
                raise ValueError("Inline event handlers are unsupported")
            if tag == "script" and name == "src" and (
                value is None or ":" in value or value.startswith("/")
            ):
                raise ValueError("Only local relative scripts are supported")
        values = dict(attrs)
        if tag == "script" and "src" not in values and values.get("type", "").lower() in (
            "", "text/javascript", "application/javascript", "module"
        ):
            if self.active is not None:
                raise ValueError("Nested script block")
            self.active = (attrs, [])
        else:
            self.parts.append(self.get_starttag_text())

    def handle_endtag(self, tag):
        if tag == "script" and self.active is not None:
            attrs, body = self.active
            self.active = None
            content = "".join(body)
            digest = hashlib.sha256(content.encode()).hexdigest()
            filename = "mini-a-bootstrap-" + digest + ".js"
            self.scripts[filename] = content
            rendered = "".join(" " + key + ("" if value is None else '="' + html.escape(value, quote=True) + '"') for key, value in attrs)
            self.parts.append('<script' + rendered + ' src="' + filename + '"></script>')
        else:
            self.parts.append("</" + tag + ">")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if self.active is not None:
            raise ValueError("Self-closing script is unsupported")

    def handle_data(self, data):
        (self.active[1] if self.active is not None else self.parts).append(data)

    def handle_comment(self, data):
        self.handle_data("<!--" + data + "-->")

    def handle_decl(self, decl):
        self.parts.append("<!" + decl + ">")

    def handle_entityref(self, name):
        self.handle_data("&" + name + ";")

    def handle_charref(self, name):
        self.handle_data("&#" + name + ";")


def prepare_index(source):
    parser = Bootstrap()
    parser.feed(source)
    parser.close()
    if parser.active is not None:
        raise ValueError("Unclosed script")
    return "".join(parser.parts), parser.scripts


def public_files(root):
    files = []
    total = 0
    for item in sorted(root.rglob("*")):
        relative = item.relative_to(root)
        if any(part.startswith(".") or part in ("WEB-INF", "META-INF") for part in relative.parts):
            continue
        if len(relative.parts) > 24 or item.is_symlink():
            raise ValueError("Unsupported link/deep path: " + str(relative))
        if item.is_dir():
            continue
        if not item.is_file():
            raise ValueError("Only regular files are supported: " + str(relative))
        size = item.stat().st_size
        total += size
        if size > MAX_FILE or total > MAX_TOTAL or len(files) >= 20000:
            raise ValueError("Editor asset size/count limit")
        files.append((relative, size))
    return files


def inventory(root):
    rows = []
    for relative, size in public_files(root):
        digest = hashlib.sha256((root / relative).read_bytes()).hexdigest()
        rows.append({"path": relative.as_posix(), "bytes": size, "sha256": digest})
    # Match Mini-A's mount digest: sorted path<TAB>length<TAB>hash, no final newline.
    lines = sorted(row["path"] + "\t" + str(row["bytes"]) + "\t" + row["sha256"] for row in rows)
    return {"commit": COMMIT, "sha256": hashlib.sha256("\n".join(lines).encode()).hexdigest(), "files": rows}


def prepare(checkout, output):
    checkout = checkout.resolve(strict=True)
    output = output.absolute()
    if output.exists() or output.is_symlink():
        raise ValueError("Output must not already exist")
    # Resolve existing parent links before enforcing the source/output boundary.
    output = output.resolve(strict=False)
    report_path = output.with_name(output.name + ".inventory.json")
    if report_path.exists() or report_path.is_symlink():
        raise ValueError("Inventory output already exists: " + str(report_path))
    if output.is_relative_to(checkout):
        raise ValueError("Output must be outside the source checkout")
    def git(*args):
        return subprocess.check_output(["git", "-C", str(checkout), *args], text=True).strip()
    if git("rev-parse", "HEAD") != COMMIT:
        raise ValueError("Expected pinned checkout " + COMMIT)
    if git("status", "--porcelain", "--untracked-files=all", "--", "src/main/webapp", "LICENSE"):
        raise ValueError("The source webapp or license has local changes or untracked files")
    source = checkout / "src/main/webapp"
    files = public_files(source)
    if not (source / "index.html").is_file():
        raise ValueError("Missing editor index.html")
    # Validate before creating output; never rewrite the original editor.
    index, scripts = prepare_index((source / "index.html").read_text())
    output.mkdir(parents=True)
    for relative, _ in files:
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / relative, target)
    (output / "index.html").write_text(index)
    for name, content in scripts.items():
        (output / name).write_text(content)
    for filename in ("js/PreConfig.js", "js/PostConfig.js"):
        with (output / filename).open("a") as stream:
            stream.write(CONFIG)
    # Main source notice is outside webapp; preserve it in this local copy too.
    shutil.copyfile(checkout / "LICENSE", output / "LICENSE.drawio")
    report = inventory(output)
    report["inlineScriptsExternalized"] = len(scripts)
    report["conformance"] = "Not granted. Complete the documented browser tests."
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    return {"path": str(output), "sha256": report["sha256"], "inventory": str(report_path)}


if __name__ == "__main__":
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("--checkout", type=Path, required=True)
    arguments.add_argument("--output", type=Path, required=True)
    values = arguments.parse_args()
    try:
        print(json.dumps(prepare(values.checkout, values.output), indent=2))
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        arguments.exit(1, str(error) + "\n")
