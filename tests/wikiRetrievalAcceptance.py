#!/usr/bin/env python3
"""Check frozen, source-bound local quality results from wikiRetrievalQuality.js."""
import hashlib
import json
import argparse
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests/fixtures/wiki-retrieval-v2"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--prefix", default="quality-acceptance", help="Result filename prefix; source hashes must match the current checkout")
args = parser.parse_args()
fixture_bytes = (FIXTURES / "acceptance.json").read_bytes()
fixture = json.loads(fixture_bytes)
reports = {mode: json.loads((FIXTURES / f"{args.prefix}-{mode}.json").read_text()) for mode in ("v2", "legacy")}
assert len(fixture["pages"]) >= 30 and len(fixture["queries"]) >= 30
assert sum(bool(q["support"]) for q in fixture["queries"]) >= 25
assert sum(not q["support"] for q in fixture["queries"]) >= 5
for mode, report in reports.items():
    assert report["evaluationVersion"] == 3 and report["mode"] == mode
    assert report["split"] == "acceptance" and report["samples"] == len(fixture["queries"])
    assert report["fixtureSha1"] == hashlib.sha1(fixture_bytes).hexdigest()
    for key, name in (("wiki", "mini-a-wiki.js"), ("knowledge", "mini-a-wiki-knowledge.js"), ("retrieval", "mini-a-wiki-retrieval.js"), ("harness", "tests/wikiRetrievalQuality.js")):
        assert report["sourceSha1"][key] == hashlib.sha1((ROOT / name).read_bytes()).hexdigest(), (mode, name)
    assert len(report["results"]) == len(fixture["queries"])
    assert report["unanswerableCorrect"] == report["unanswerableSamples"]
v2 = reports["v2"]
assert v2["passageRecallAtK"] == 1 and v2["mrr"] == 1
assert all(r["citationRangeCorrectness"] == 1 for r in v2["results"] if not r["expectedUnanswerable"])
assert all(r["duplicateFraction"] == 0 for r in v2["results"])
assert v2["passageRecallAtK"] > reports["legacy"]["passageRecallAtK"]
print("ACCEPTANCE_QUALITY_PASS", len(fixture["pages"]), "pages", len(fixture["queries"]), "queries")
