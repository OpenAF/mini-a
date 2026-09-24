"""Standalone exporter regressions: python3 tests/wikiGraph.py (requires ojob)."""
import json
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

JOB = Path(__file__).resolve().parents[1] / "utils/wikiGraph.yaml"


class WikiGraphTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="mini-a-graph-")
        self.root = Path(self.temp.name)
        self.wiki = self.root / "wiki"
        self.wiki.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def export(self, *args):
        result = subprocess.run(["ojob", str(JOB), "dir=" + str(self.wiki), *args],
                                cwd=self.root, capture_output=True, text=True, timeout=45)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def data(self, name="wiki-graph.html"):
        html = (self.root / name).read_text()
        match = re.search(r'<script id="graph-data" type="application/json">(.*?)</script>', html, re.S)
        self.assertIsNotNone(match)
        return html, json.loads(match[1])

    def test_graph_snapshot_and_safe_embedding(self):
        folder = self.wiki / ".mini-a-wiki-graph"
        folder.mkdir()
        title = '</script><script>alert("test")</script> $& ${x}'
        graph = {"nodes": {
            "__proto__": {"type": "concept", "props": {"title": title}},
            "b": {"type": "document", "props": {}},
            "deleted": {"type": "tag", "_deleted": True}},
            "edges": [{"from": "__proto__", "to": "b", "type": "mentions"},
                      {"from": "b", "to": "absent"},
                      {"from": "b", "to": "__proto__", "_deleted": True}]}
        (folder / "graph.json").write_text(json.dumps(graph))
        before = (folder / "graph.json").read_bytes()
        self.export("output=" + str(self.root), "title=My atlas")
        html, data = self.data()
        self.assertEqual(data["title"], "My atlas")
        self.assertEqual(len(data["nodes"]), 2)
        self.assertEqual(len(data["edges"]), 1)
        self.assertEqual(data["skipped"], 1)
        self.assertEqual(data["nodes"][0]["label"], title)
        self.assertNotIn(title, html)
        self.assertEqual(before, (folder / "graph.json").read_bytes())
        scripts = re.findall(r'<script>\s*([\s\S]*?)</script>', html)
        check = subprocess.run(["node", "--check"], input=scripts[0], text=True, capture_output=True)
        self.assertEqual(check.returncode, 0, check.stderr)

    def test_markdown_fallback_and_default_output(self):
        (self.wiki / "index.md").write_text('# Home\n[[guide|Guide]]\n[Topic](sub/topic.md)\n[[missing]]\n')
        (self.wiki / "guide.md").write_text('---\ntitle: Guide\ntype: skill\n---\n# Guide\n[[sub]]\n')
        (self.wiki / "sub").mkdir()
        (self.wiki / "sub/index.md").write_text('# Subwiki\n')
        (self.wiki / "sub/topic.md").write_text('# Topic\n[Home](../index.md)\n```\n[[guide]]\n```\n')
        (self.wiki / ".hidden.md").write_text('# Hidden')
        (self.wiki / "outside.md").symlink_to(JOB)
        self.export()
        _, data = self.data()
        self.assertEqual(data["source"], "Markdown page links")
        self.assertEqual(len(data["nodes"]), 4)
        self.assertEqual(len(data["edges"]), 4)
        self.assertEqual(next(n for n in data["nodes"] if n["id"] == "doc:guide.md")["type"], "skill")
        self.assertFalse((self.wiki / ".mini-a-wiki-meta").exists())

    def test_empty_wiki_and_custom_file(self):
        self.export("output=" + str(self.root / "empty.html"))
        _, data = self.data("empty.html")
        self.assertEqual(data["nodes"], [])
        self.assertEqual(data["edges"], [])

    def test_invalid_graph_fails_without_output(self):
        folder = self.wiki / ".mini-a-wiki-graph"
        folder.mkdir()
        (folder / "graph.json").write_text('{"nodes": []}')
        result = subprocess.run(["ojob", str(JOB), "dir=" + str(self.wiki)], cwd=self.root,
                                capture_output=True, text=True, timeout=45)
        self.assertIn("Invalid wiki graph", result.stdout + result.stderr)
        self.assertFalse((self.root / "wiki-graph.html").exists())


if __name__ == "__main__":
    unittest.main()
