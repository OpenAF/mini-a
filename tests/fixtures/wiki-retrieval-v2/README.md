# Retrieval fixtures and evidence

- `development.json`, `held-out.json`, and `acceptance.json` are input corpora used
  by `tests/wikiRetrievalQuality.js`.
- `quality-acceptance-v2.json` and `quality-acceptance-legacy.json` are the current
  acceptance results. `python3 tests/wikiRetrievalAcceptance.py` verifies their
  fixture and source hashes before checking quality. They were refreshed on
  2026-09-17; historical versions remain in Git.
- Other JSON files preserve dated assertion reports, benchmarks, and experimental
  comparisons. They are historical evidence, not a claim that the current checkout
  passed those checks. Identical files may label different historical experiments.
- Source ZIPs and the comparison patch were removed from the working tree after
  verifying their bytes against Git. [ARCHIVE.md](ARCHIVE.md) gives exact revision
  links, checksums, and recovery instructions. Historical `sourceArchive` names
  refer to that index.

Regenerate acceptance results from the repository root by running the quality
harness with `WIKI_EVAL_SPLIT=acceptance` and `WIKI_EVAL_MODE=v2` or `legacy`, and
saving each `QUALITY=` JSON payload to its corresponding result file. Then run
`python3 tests/wikiRetrievalAcceptance.py`. Do not edit source hashes by hand.
