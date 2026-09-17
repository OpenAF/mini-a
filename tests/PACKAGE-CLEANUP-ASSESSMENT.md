# Package cleanup assessment — 2026-09-17

Assessment of the current `autonomy` checkout. No runtime code, package metadata,
existing documentation, or tests were changed. Existing `.package.yaml` edits and
untracked `WIKI-RETRIEVE-PLAN*.md` files were preserved.

## Main findings

The best release-size improvement is to exclude development evidence from the
package while retaining it in the repository or a durable archive. Tests already
are excluded. Do not delete whole runtime modules based on reference counts:
OpenAF loads modules dynamically and exposes prototype methods to consumers.

| Scope | Files | Bytes |
| --- | ---: | ---: |
| Current package manifest, including its own metadata | 130 | 5,358,972 |
| Packaged `docs/` | 20 | 571,014 |
| Tracked `tests/` | 302 | 3,766,542 |
| Test fixture ZIP snapshots | 17 | 1,651,187 |
| Test fixture JSON files | 226 | 789,786 |

All 130 manifest paths exist. Counts precede this assessment file. Byte totals
are file contents, not filesystem allocation or installation overhead.

## 1. Exclude development evidence from release packaging

These nine files total **369,636 bytes (6.9% of the current package contents)**:

| File | Bytes | Recommendation |
| --- | ---: | --- |
| `WIKI-RETRIEVE-PLAN.md` | 97,863 | Keep local planning history; exclude from releases |
| `WIKI-RETRIEVE-PLAN-2.md` | 26,286 | Keep local planning history; exclude from releases |
| `development/docs/VM-IMPLEMENTATION-REVIEW.md` | 10,034 | Repository development evidence |
| `development/docs/WIKI-INGEST-IMPLEMENTATION-PLAN.md` | 20,558 | Repository implementation history |
| `development/docs/WIKI-INGEST-VALIDATION.md` | 9,921 | Repository validation evidence |
| `development/docs/WIKI-RETRIEVAL-V2-BASELINE.md` | 10,984 | Repository benchmark evidence |
| `development/docs/WIKI-RETRIEVAL-V2-VALIDATION.md` | 176,674 | Repository validation history |
| `development/docs/historyvm-live-2026-09-17.json` | 12,656 | Dated run output; retain provenance |
| `development/docs/TESTS_MODELS.md` | 4,660 | Model testing notes; no incoming tracked reference found |

A Python ZIP/DEFLATE comparison over the manifest gives 1,438,368 bytes currently
versus 1,310,866 bytes without these files: **127,502 bytes (8.9%) smaller**.
This is an estimate, not a built or installed oPack measurement.

Packaging changes must cover both `genpack` and `pack` in
`.github/workflows/github-action.yml`, which currently use
`--exclude .github,tests`. Editing only `.package.yaml` will not persist through
regeneration. Validate the OpenAF exclusion semantics before changing the build,
then regenerate matching `files` and `filesHash` entries.

Before exclusions, convert affected links in retained user documentation to
repository URLs. `USAGE.md` links to the VM review; `docs/WIKI.md` and
`docs/WIKI-RETRIEVAL-V2.md` link to validation/baseline evidence. Do not leave
broken installed-document links. Keep user guides, changelog, license, examples,
and MCP documentation. `.gitignore`, contribution guidance, and conduct guidance
could also be repository-only, but their savings are small. Treat `AGENTS.md`
separately because the agent discovers instruction files at runtime.

## 2. Repository-only cleanup candidates

- **Remove `tests/wiki_js_fns.txt`.** No incoming reference was found. All 108
  recorded function line locations are stale against `tests/wiki.js`. It is a
  generated index, not an executable test; regenerate on demand with a search.
- **Archive the 17 `tests/fixtures/wiki-retrieval-v2/*.zip` files**, after preserving
  their evidence references. Inspected archives contain historical JavaScript
  sources, often `before/` and `after/` copies. No current executable test reader
  for these archive files was found. Their total is 1.65 MB; moving them out of
  the checkout does not shrink an existing Git history or the current oPack.
- The fixture directory also contains `catalogue-sharing-runtime.patch` (3,792
  bytes). Classify it with historical source evidence, not test inputs.
- Separate generated assertion/performance reports from actual input corpora.
  Preserve `development.json`, `held-out.json`, and `acceptance.json`:
  `wikiRetrievalQuality.js` constructs input paths from the selected split.
  `wikiRetrievalAcceptance.py` also consumes `quality-acceptance-{v2,legacy}.json`
  by default and allows a different result prefix. No blanket JSON deletion.
- Four groups are byte-identical: `dreams-after.json` / `dreams-scope-before.json`;
  `quality-completion-held-out-legacy.json` / `quality-held-out-legacy.json`;
  `quality-completion-held-out-v2.json` / `quality-held-out-v2.json` /
  `quality-parser2-held-out.json`; and `wiki-dreams-scope-regression.json` /
  `wiki-insufficient-space-assertions.json`. Consolidate only with an evidence
  index preserving each run label and its references; identical content alone
  does not establish identical experimental provenance.

## 3. Code removal candidates

Static searches covered tracked JavaScript, YAML, Python, shell, CommonJS, and
Markdown. These results establish repository references, not external usage.

| Symbol and location | Assessment |
| --- | --- |
| `truncateText`, `mini-a-con.js:3279` | Local helper with no caller; strong removal candidate |
| `isTableRowLine`, `mini-a.js:3506` | Local helper with no caller; also leaves `isTableSeparatorLine` at line 3501 and `TABLE_SEPARATOR_REGEX` at line 3487 unused as a group |
| `__miniAStripMarkdownFrontMatter`, `mini-a-common.js:462` | No repository caller or documentation reference; candidate after checking shared-helper compatibility |
| `_getModelConfigForTools`, `mini-a.js:11646` | No repository caller; inspect API compatibility before removal |
| `_levenshteinDistance`, `mini-a-tool-selection.js:9` | Unused wrapper; shared `__miniALevenshteinDistance` is a separate implementation and must not be removed with it |
| `_backupMemoryToMarkdown`, `mini-a-dreams.js:271` | No caller; active memory dream path uses channel or namespace backup helpers |
| `_saveLedger`, `mini-a-ingest.js:213` | Explicitly labeled compatibility export; removal requires compatibility decision, not merely a reference count |
| `lookupMoveLinks`, `mini-a-wiki-retrieval.js:619` | No repository caller; public-shaped method, so retain pending API review |
| `_recordRunTask`, `mini-a.js:1721` | Uncalled persistence helper; investigate whether this is missing integration before deleting |
| `_flushMemoryPersist`, `mini-a.js:8780` | Uncalled last-resort persistence flush; investigate shutdown correctness before deleting |

Keep `__miniASkillMetricsSnapshot`: it is documented in `docs/VIRTUAL-SKILLS.md:335`.
Keep `getCostStats`: it is a documented programmatic API in `USAGE.md`. Similarly,
`getEscalationStats` and capability `getCapabilities` are exposed accessors;
absence of an internal caller is insufficient evidence of obsolescence.

No whole runtime module was established as removable. Preserve supported legacy
wiki, ingestion, history, and argument behavior unless a specific compatibility
contract is deliberately retired. Runtime helpers offer much smaller byte savings
than excluding development reports; their main benefit is reduced maintenance.

## 4. Test organization needs repair before pruning

`tests/wiki.yaml` registers 39 of the 48 function targets in
`tests/wikiRetrievalV2.yaml`. The nine remaining targets are also absent from the
aggregate runner's other included suites:

- `testPreviousGenerationPointerFallback`
- `testPublicationScopedValidation`
- `testRoutedCompactionBoundary`
- `testS3BundleHydrationRefresh`
- `testSchema3CatalogueDelta`
- `testSharedBlockStore`
- `testSharedBlockStoreReclamationClosure`
- `testSourceIoAuditAccounting`
- `testSourceRevocationBeforeMaterialization`

Consolidate registration ownership while preserving both focused entrypoints and
ensuring the aggregate runs each target once. Do not delete the v2 suite or simply
include both complete files without checking duplicate jobs. The aggregate also
omits all 21 registrations in `tests/skills.yaml`.

Keep standalone transport tests and `webActivity.cjs`; a separate entrypoint is
not evidence of disuse. Keep `tests/evalOpenAF.yaml` separate: its header explicitly
requires process isolation because it verifies and resets expected failures.

`tests/autoTestAll.yaml` prints failures and writes a result JSON but ends with
`exit(0)`. `wikiRetrievalAssertions.js` catches failures and prints a report without
explicitly setting a failing exit status. Harden these scripts before relying on
shell exit status for future cleanup verification. The current GitHub workflow
packages releases; it does not run the aggregate tests.

## 5. Other folders

- `examples/`: keep. Basic and v2 templates explicitly serve different use cases;
  YAML oJobs and `.agent.md` profiles are different entrypoints, not duplicate files.
- `evals/`: keep evaluation suites as user-facing evaluation assets.
- `utils/`: keep both statistics jobs; README documents their standalone use.
- `mcps/`: keep descriptors, including safe/operations variants; runtime dispatch
  and permissions differ. Filename similarity does not imply redundancy.
- `public/`: keep UI template and vendored renderer; no unused asset established.
- `.github/`: screenshots are large but already excluded from the package.
- `private/tmp/`: empty locally and has no tracked file to remove.
- `.openaf_precompiled/` and `.mini-a`: ignored local runtime state, not current
  manifest entries; leave untouched. `.odoc.db` is packaged OpenAF documentation
  metadata; no evidence established that it can be dropped.

## Validation and recommended sequence

Performed manifest existence/size checks, exact-content duplicate checks, test
registration comparisons, static reference searches, archive member inspection,
and a ZIP size estimate. Ran `python3 tests/wikiRetrievalAcceptance.py`; it fails
at the source SHA-1 check for `('v2', 'mini-a-wiki-retrieval.js')`. This proves the
frozen report is stale for this checkout, not that live retrieval quality regressed.
No full OpenAF suite, provider test, package install, or hosted workflow was run.

1. Establish package exclusions and repair documentation links; verify the actual
   generated oPack contents and install behavior.
2. Remove the stale function index and the two strongly isolated local-helper
   groups; run focused console/stream-rendering checks.
3. Repair test registration and exit status, refresh current acceptance outputs,
   and distinguish historical evidence from executable fixtures.
4. Archive source snapshots with checksums and durable provenance links.
5. Review shared/prototype API candidates individually; run the owning suites
   before removing any compatibility or persistence-related helper.

## Cleanup applied — 2026-09-17

- Moved seven development documents/run outputs into `development/docs/` and
  repaired their local links. Retained user guides link to the new repository
  locations. Both release packaging commands exclude `development`, local state,
  private files, and the two root wiki plans. Regenerated the package metadata
  while retaining its existing runtime entries and version.
- Removed the stale function index and the isolated console truncation/table-row
  helper code. Shared/prototype compatibility and persistence candidates remain.
- Removed 17 source ZIPs and one comparison patch from the checkout after verifying
  byte equality with commit `6179d05a775ce9568aea9c3bf9c66a7fdc55461b` (present on
  `origin/autonomy`). The fixture archive index preserves exact Git links, SHA-256
  checksums, and recovery commands. Historical JSON comparisons remain intact.
- Made `wikiRetrievalV2.yaml` the single registration source included by
  `wiki.yaml`; all 48 v2 jobs are scheduled once, including the previously
  unscheduled `CompactBacklinkActivity` and `CrossSurfaceV2Configuration` jobs.
  Added all 21 skills jobs to the aggregate runner.
- Updated the assertion runner to follow local includes and scheduled jobs,
  deduplicate targets, reject empty discovery, restore its assertion hook, and
  return failure status. The aggregate now exits nonzero when assertions fail.
- Refreshed both acceptance reports by running the quality harness and extracting
  its JSON output. The acceptance source-hash and quality checks now pass.

Validation completed:

| Check | Result |
| --- | --- |
| `ojob tests/wiki.yaml` | 209 passes, zero failures |
| `WIKI_COUNT_SUITE=wiki oaf -f tests/wikiRetrievalAssertions.js` | 209 functions, 2,304 assertions, zero failures |
| `ojob tests/skills.yaml` | 21 passes, zero failures |
| Focused existing core streaming/Markdown/console tests | 23 passes |
| `node tests/testRunners.cjs` | Include discovery, scheduling, deduplication, failure propagation, hook restoration and exit-status checks pass |
| `node tests/webActivity.cjs` | Pass |
| `python3 tests/wikiRetrievalAcceptance.py` | 30 pages / 31 queries pass |
| Actual oPack generation and ZIP inspection | 121 files; all manifest files exist, hashes match, exclusions hold |
| Extracted package smoke | Absolute-path load of extracted `mini-a.js` and `new MiniA()` pass |
| Documentation links and `git diff HEAD --check` | Pass |

The built oPack is **1,316,213 bytes**, with **4,987,985 bytes** of file contents:
**370,987 bytes (6.9%) less unpacked content** than the assessed package. This
includes the regenerated manifest. The earlier compressed comparison remains an
estimate because it used Python ZIP settings rather than OpenAF's packer.

The complete aggregate suite, registered package installation, and hosted release
workflow were not run. No provider behavior or public API was removed. Existing
uncommitted work and the user's staging choices were retained; no commit was made.
