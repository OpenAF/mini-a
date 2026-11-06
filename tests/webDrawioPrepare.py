"""Local-only checks for the optional editor preparation helper."""
import hashlib
import importlib.util
import sys
from pathlib import Path
import tempfile

path = Path(__file__).resolve().parents[1] / "examples/web-extensions/drawio/prepare-editor.py"
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("drawio_prepare", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

source = '<!doctype html><html><script>window.example = "<&";</script><script src="js/app.js"></script><body>Safe &amp; local</body></html>'
rewritten, scripts = module.prepare_index(source)
assert len(scripts) == 1
assert '<script src="mini-a-bootstrap-' in rewritten
assert '<script src="js/app.js"></script>' in rewritten
assert 'Safe &amp; local' in rewritten
assert list(scripts.values()) == ['window.example = "<&";']
for bad in ('<body onload="run()">', '<script src="https://remote.test/a.js"></script>', '<script src="//remote.test/a.js"></script>', '<script>unterminated'):
    try:
        module.prepare_index(bad)
    except ValueError:
        pass
    else:
        raise AssertionError("Unsafe bootstrap accepted")
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    (root / "index.html").write_text("hello")
    (root / ".secret").write_text("private")
    (root / "WEB-INF").mkdir()
    (root / "WEB-INF/config").write_text("server secret")
    report = module.inventory(root)
    assert len(report["files"]) == 1
    payload = "index.html\t5\t" + hashlib.sha256(b"hello").hexdigest()
    assert report["sha256"] == hashlib.sha256(payload.encode()).hexdigest()
    (root / "linked.js").symlink_to(root / "index.html")
    try:
        module.inventory(root)
    except ValueError:
        pass
    else:
        raise AssertionError("Symlink accepted")
print("PASS editor preparation: script extraction, no network/scripts, safe asset inventory and symlink rejection")
