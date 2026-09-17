# Development records

Implementation plans, validation reports, model experiments, and dated run outputs
live in `docs/` here. They preserve historical evidence and are excluded from the
release oPack; user documentation remains in the repository's top-level `docs/`.

Historical retrieval source snapshots are preserved in Git, with immutable links
and checksums in [the archive index](../tests/fixtures/wiki-retrieval-v2/ARCHIVE.md).

The release workflow uses the same exclusion list for `genpack` and `pack`.
To reproduce it locally, run from the repository root:

```sh
opack genpack . --exclude .github,tests,development,private,.mini-a,WIKI-RETRIEVE-PLAN.md,WIKI-RETRIEVE-PLAN-2.md
opack pack . --exclude .github,tests,development,private,.mini-a,WIKI-RETRIEVE-PLAN.md,WIKI-RETRIEVE-PLAN-2.md
```

`pack` regenerates the manifest too. Keep both commands aligned with
[the workflow](../.github/workflows/github-action.yml). Root wiki plans and local
runtime state remain outside the package.

For cleanup verification and remaining compatibility review candidates, see the
[dated assessment](../tests/PACKAGE-CLEANUP-ASSESSMENT.md#cleanup-applied--2026-09-17).
Run `node tests/testRunners.cjs` to check runner discovery and failure propagation.
