# Wiki ingestion reconciliation: implementation and validation

Validated on `autonomy`, starting at `46e0cec3a386c4ccf3991f0c44c8344d2a131d70`.
The pre-existing `.package.yaml` worktree changes were preserved. No real wiki was
migrated or pruned. All mutation tests used temporary fixtures or a simulated backend.

The translated requirements are in [the English implementation plan](WIKI-INGEST-IMPLEMENTATION-PLAN.md).
Operating examples and safety limits are in [Safe repeated ingestion](WIKI.md#safe-repeated-ingestion).

## Corrected behavior

- Complete-source reconstruction replaces changed-chunk-only distillation. Deletion-only
  changes, reorderings and force reprocessing supply all current chunks. Deterministic
  modes make no model calls. Budget estimates include the complete effective prompt.
- Versioned source records bind destination, origin, section, transformation, page
  signature, complete chunk membership and applied generation. The manifest is the
  applied authority; the legacy ledger cannot make hash-only skip decisions.
- Canonical destination identity makes dry/live planning agree across path aliases.
  Namespaces and structural repeated-heading IDs avoid cross-origin chunk collisions.
  New page mappings avoid existing pages, colliding slugs and reserved indexes.
- Complete discovery separates present paths from selected candidates. Missing sources
  are reported even when every remaining source is unchanged. Protected prune requires
  compatible filters/limits, complete discovery, successful transforms, no conflicts,
  additional empty-folder authorization where appropriate, and inventory revalidation.
- Signatures protect edited pages, including against force. Unique unchanged moved
  bindings are repaired. Conservative legacy migration preserves backups; historical
  distillations without last-write proof become review conflicts rather than overwrites.
- Reference-aware scoped chunk retirement and current membership/hash/generation checks
  suppress obsolete context. Pending journals suppress affected evidence. Provenance-
  linked facts/summaries are invalidated before dependent edges are removed. Existing
  wiki graph update/delete hooks clear page-owned semantic caches.
- Atomic prepared journals make page operations, manifest commitment and finalization
  recoverable. Missing already-deleted pages are idempotent recovery cases. Recovery
  verifies scope and rechecks unapplied deletions against accessible complete origins.
  Optimistic state checks reject concurrent changes before and during page application.
- The local ingestion lock precedes manager bootstrap. Caller-owned manager references
  survive argument merging, are reused, and are never closed by ingestion.
- Dry-run uses a non-bootstrapping read facade, performs no model calls and applies no
  writes/deletes/migration. Planned/applied writes, removals, repairs, chunk removals and
  derivative invalidations are reported separately. Failure status reaches wrappers.

## Changed files

| File | Change |
| --- | --- |
| [mini-a-ingest.js](../mini-a-ingest.js) | Scoped reconciliation, full transforms, ownership, journal, migration, results, locks |
| [mini-a-wiki-knowledge.js](../mini-a-wiki-knowledge.js) | Schema/chunker versions, atomic state, strict corrupt-state handling, active retrieval |
| [mini-a-ingest.yaml](../mini-a-ingest.yaml) | Parameter validation/help and explicit read-only preservation |
| [mini-a-con.js](../mini-a-con.js) | Session parameters, command flags and partial/failure reporting |
| [mini-a.yaml](../mini-a.yaml) | Parameter documentation |
| [tests/wikiIngest.js](../tests/wikiIngest.js) | More informative existing assertion |
| [tests/wikiIngestReconcile.js](../tests/wikiIngestReconcile.js) | Temporary-fixture and fault-injection regressions |
| [tests/wikiIngest.yaml](../tests/wikiIngest.yaml) | Register all additional regressions |
| [WIKI.md](WIKI.md) | Upsert/prune, costs, conflicts, migration, recovery and backend limits |
| [USAGE.md](../USAGE.md) | Reconciliation examples and operating guidance |
| [CHEATSHEET.md](../CHEATSHEET.md) | Preview/apply/empty-source examples |
| [WIKI-INGEST-IMPLEMENTATION-PLAN.md](WIKI-INGEST-IMPLEMENTATION-PLAN.md) | English translation of the supplied plan |
| [WIKI-INGEST-VALIDATION.md](WIKI-INGEST-VALIDATION.md) | This delivery record |

No edits were needed in mini-a-wiki.js or mini-a-dreams.js: existing backend page,
graph invalidation, move and deterministic finalization contracts were reused.

## Parameters and compatibility

`ingestprune=false`, `ingestallowemptyprune=false`, and optional `ingestsourceid` are
available in standalone/session configuration. Console flags are `prune`,
`allowemptyprune`, and `sourceid=<id>`. Existing `dryrun` and `force` flags remain.
Production defaults to `auto`; injected custom/test models retain implicit `distill`
when no mode is supplied. Full distillation retains bounded batch concurrency.
Explicit `wikiaccess=ro` cannot be overridden by the standalone default.

`ok` reports requested-work success. `sync_complete` does not claim a mirror after
non-pruning upsert with disappeared or unresolved sources. `status` distinguishes
complete, noop, planned, partial, blocked and failed outcomes. `written` no longer
contains dry-run paths; use `planned_writes`. The legacy ledger is not independently
updated; the manifest and journal carry applied and recovery state.

## Executed validation

| Command/check | Result |
| --- | --- |
| `ojob tests/wikiIngest.yaml` | **58 passed, 0 failed** |
| `ojob tests/wiki.yaml` | **150 passed, 7 failed** |
| Same wiki command in untouched reference archive | **150 passed, same 7 failed** |
| `ojob tests/dreams.yaml` | **44 passed, 3 failed** |
| Same dreams command in untouched reference archive | **44 passed, same 3 failed** |
| Standalone wrapper with `wikiaccess=ro` | Exit 1, no destination created |
| Standalone wrapper with `ingestdryrun=true ingestprune=true` | Exit 0, planned status, no destination created |
| `node --check` on changed JavaScript files | Passed |
| `git diff --check` | Passed |

Assertion counts come from test output; oJob's outer job SUCCESS labels can coexist
with failed assertions. Full-suite failures were verified against an isolated
`git archive HEAD` reference under `/tmp`, without modifying this checkout.

Existing wiki failures: BootstrapCreatesAgentsAndIndexForEmptyWritableWiki,
LintOrphan, LintHeadingHierarchy, McpWikiMetadataIncludesHierarchyTools,
McpWikiSearchSchemasDescribeLexicalRetrieval, SearchReturnsLineNumbers, DriftGuard.
Existing dreams failures: BuildLlmUsesOAFModelFallback, BuildLlmPrefersModelArg,
DreamWikiPlanPreviewsGraphWithoutPersisting.

The new regressions exercise full distillation, deterministic modes, budgets,
fingerprint/missing-page repair, removal-only finalization, empty/missing origins,
incomplete inventories, excluded/oversized/empty/unreadable sources, filter changes,
URLs, renames/moves, repeated headings/cycles, collisions and Unicode names, manual
edits, shared artifacts, migration/corruption, model/write/delete/state/finalize faults,
interrupted recovery, unchanged dry-run bytes/timestamps, borrowed managers, locks,
and optimistic concurrency conflicts. Remote write/delete/persistence behavior is
**simulated**, with no credentials or provider calls.

## Supported limits

There is no distributed transaction or cross-cache remote multi-writer CAS. Use a
single writer for remote destinations. The lock serializes ingestion jobs sharing one
local index directory; ordinary wiki tools and external writers do not take that lock.
Optimistic conflict detection cannot eliminate every race with uncoordinated writers.
Do not edit sources/pages/state during ingestion or pending recovery.

Revalidation detects changes; it is not an atomic source-filesystem snapshot. Token
budgets use the repository's token estimator. No live provider, hosted CI, S3, Elastic,
FalkorDB or console UI integration was performed. Standalone remote dry-run requires
an existing supplied manager and refuses to initialize a destination cache.

Ambiguous ownership and unverifiable legacy distillations remain preserved review
conflicts. Derivatives without sufficient provenance and semantic copies in manual or
legacy pages are not globally removed. Broken manual links are reported after
finalization, never rewritten to conceal them. Concurrent state conflicts that leave a
prepared journal require operator review before recovery can proceed; recovery never
silently overwrites the competing state. Atomic rename support is required for state
persistence; unsupported filesystems fail explicitly.
