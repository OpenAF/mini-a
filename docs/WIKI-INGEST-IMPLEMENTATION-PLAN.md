# Codex Implementation Plan — Safe reconciliation of wiki ingestion

## 1. Context and objective

Repository: openaf/mini-a. Reference branch: autonomy. Analysed commit:
46e0cec3a386c4ccf3991f0c44c8344d2a131d70.

Implement the corrections needed so that repeated ingestion of a folder or repository into an existing wiki:

- Updates changed sources correctly, retaining valid content and removing content no longer present in the source.
- Detects disappeared sources and permits explicit, safe removal of their artifacts, restricted to the correct origin.
- Leaves no obsolete chunks active in the manifest or retrieval.
- Never replaces a complete page with a distillation of only part of the document.
- Recovers after failures and accurately reports partial results, blocked operations and conflicts.

The guarantee applies to ingestion-managed artifacts within their identified scope. Do not turn the whole wiki into a destructive mirror: preserve manual pages, other origins and content whose provenance does not support a safe decision.

Confirm the current branch before editing. Adapt to existing corrections without duplicating them. Read AGENTS.md; respect OpenAF, JavaScript and repository conventions. Avoid unnecessary external dependencies. Never migrate or destructively operate on real wikis; use temporary fixtures and simulated backends.

### Compatibility baseline

Use `main` as the compatibility baseline; `autonomy` is an unreleased development
branch. Preserve ingestion contracts and authoritative state supported by `main`.
Formats and internal APIs introduced only on `autonomy` need no compatibility
adapters or migration tooling. This does not permit discarding authoritative
content or guessing ownership: unresolved provenance still blocks removal.

For retrieval serving artifacts, follow the
[retrieval plan compatibility baseline](../WIKI-RETRIEVE-PLAN.md#compatibility-baseline--development-branch)
and its [remaining-work companion](../WIKI-RETRIEVE-PLAN-2.md).

## 2. Files and paths to inspect

Main implementation: mini-a-ingest.js, mini-a-wiki-knowledge.js, mini-a-wiki.js, mini-a-dreams.js.

Entry points and integration: mini-a-ingest.yaml, mini-a.yaml, mini-a-con.js and every actual MiniAIngest constructor or ingestion parameter forwarding path.

Tests and documentation: tests/wikiIngest.js and .yaml, tests/wiki.js and .yaml, tests/dreams.js and .yaml when affected, docs/WIKI.md, USAGE.md, CHEATSHEET.md, and README.md where necessary.

Inspect _discover(), _loadLedger(), _saveLedger(), _wikiPathFor(), run(), _distillAll(), _finalize(), knowledgeChunks(), knowledgeLoadState(), knowledgeSaveState(), knowledgeDirtySet(), assembleContext(), and the contracts of write(), delete(), move(), reindex(), _finalizeWiki(). Audit consumers of manifest.sources, manifest.chunks, facts, summaries and dependencies. Do not assume deleting a page automatically removes every derived artifact.

## 3. Configuration contract

Add and document:

- ingestprune=false: preserves the default non-destructive behavior. When true, reconciles sources proven missing after all safety checks.
- ingestallowemptyprune=false: additional authorization to remove all previously managed sources in a scope after complete discovery confirms it is truly empty.
- ingestsourceid=<optional identifier>: stable logical origin identity when a folder's physical path changes. Otherwise derive identity from the canonical origin.

Preserve and clarify:

- ingestdryrun=true: calculate the complete plan, including writes, removals, repairs, conflicts and blocked operations; apply nothing.
- ingestforce=true: reprocess present sources even when unchanged. Does not enable prune, bypass permissions/conflicts, or waive budgets.
- ingestmode=auto|normalize|distill|raw: preserve existing modes while fixing complete-page reconstruction.

Individual URLs are not complete site inventories. URL ingestion must not remove other ingested URLs. Explicitly reject unsupported prune combinations. Validate and forward parameters at actual entry points. Respect explicit wikiaccess=ro, including the standalone wrapper; a default rw must not override it.

## 4. Identity, ownership and versioned state

Introduce explicit ingestion scope identity distinguishing destination backend/wiki, source type and canonical/logical identity, and destination section. A repository commit is not permanent origin identity: new commits update the same origin.

Store discovery configuration separately, including filters, limits and relevant versions. Changing filters does not mean excluded files were deleted.

Each source needs scopeId/sourceKey, relative path/sourceId, full-content hash, full normalized hash, transformation fingerprint, actual destination mapping, complete current chunk set, applied version/generation, last written page signature, and ownership provenance.

The fingerprint covers mode, chunker, normalizer, prompt, relevant parameters and explicit model configuration without secrets. Hash equality alone cannot establish unchanged state: also verify transformation compatibility, state integrity, page existence and destination association.

Use one authoritative applied-generation state. The ledger may remain a compatible representation or rebuildable index, but never an independent authority contradicting the manifest. Preserve other components' fields/namespaces.

## 5. Migration of existing wikis

Version and migrate state supported by `main` conservatively. In this section, legacy state means a format supported by `main`, not an intermediate development-only format. Distinguish missing state, valid legacy state and corrupt/partially persisted state. Read errors never authorize approximate ownership reconstruction followed by deletion.

Associate legacy records using concrete checks, such as recomputing the old key from the supplied origin/sourceId, checking wikiPath, and validating available provenance. Never assign every record to the current origin.

When ownership cannot be established, preserve content, mark records unresolved, block automatic removal and report required review/reingestion. Repair incomplete manifests created by partial distillation by reconstructing from present complete sources with validated ownership even when the ledger hash matches.

Retain a recoverable pre-migration copy. Migration is idempotent and writes nothing during dry-run.

## 6. Complete discovery and reconciliation

Separate observed inventory from processing candidates. Discovery conceptually returns eligible sources, present ignored paths/reasons, oversized files, read/listing errors, inventory completeness and observed origin identity/configuration. A listing failure must not resemble an empty folder.

Classify previously known scoped sources as present unchanged, present changed, filtered, unreadable/empty/oversized, proven absent, or unknown due to incomplete discovery. Only proven absence permits prune. Empty/unreadable files preserve the last applied result and remain unresolved.

Filter changes preserve sources outside current selection. Incompatible selections cannot justify prune: block affected removals and explain. Incomplete discovery blocks destructive work.

Detect relevant origin changes during execution. Revalidate inventory/identity before removals where necessary; inconsistencies block prune. Do not promise filesystem snapshot atomicity without an actual mechanism.

Do not return early merely because sources.length or pending.length is zero. Evaluate removals, migration, repairs, invalidation and interrupted-run recovery first. Distinguish missing/inaccessible folders, no matching selection, and confirmed empty folders. Empty folders require both prune and allowemptyprune.

## 7. Correct partial distillation

Implement the simple correct solution first: rebuild the page from the entire current source. Keep sourceChunks, changedChunks, removedChunks and llmInputChunks separate; never replace sourceChunks with changedChunks.

normalize/raw rebuild from all applicable current content, removing internal deletions and making no LLM calls. distill supplies the complete source when one chunk changes, chunks disappear without additions, sections reorder, or force reprocesses unchanged content. Never send an empty prompt just because changedChunks is empty. Do not automatically merge the old page with a delta: it may restore removed facts.

auto keeps deterministic processing for structured sources and assesses the current whole source. A distillation replacing a whole page receives the whole source.

Budget the effective prompt, including overhead. If the whole source exceeds limits, explicitly defer it. Never silently truncate or publish a partial replacement. Failed/deferred sources do not advance applied hashes. Future reuse of per-chunk distillations must compose ALL current results; it is optional and must not delay this fix.

## 8. Chunk identity and lifecycle

Ingestion chunk IDs include source namespace/sourceKey, structural section identity and a deterministic repeated-occurrence discriminator. Relative path plus last heading is insufficient across origins or repeated headings. Preserve knowledgeChunks() compatibility with optional namespace options and avoid unnecessary public citation-anchor changes. Structural identity and content hashes remain separate.

After an applied update: record the complete current source chunk list; update corresponding global records; retire previous chunks no longer belonging to the source; preserve legitimately referenced records; update affected references/artifacts. Cleanup is reference-aware, never an indiscriminate match on name/hash/page. No global GC of ambiguous legacy records or other producers' chunks. Metrics distinguish identity/hash changes and removals, including repeated-section multiplicity.

## 9. Prevent obsolete knowledge retrieval

assembleContext() must not accept every global record sharing a search-hit page. For ingestion chunks validate active source, membership in the current complete chunk set, version/hash/generation, page binding, and incompatible pending invalidation. Share helpers across consumers.

Audit retrieval and facts/summaries/dependencies consumers. Compute dependents BEFORE deleting their edges. Invalidate summaries, facts and caches derived from removed content; reindexing a principal page does not make a proven stale cache current evidence.

For multi-source derivatives preserve valid sources and invalidate/recalculate affected results; do not delete an entire page because one contributor disappears. Preserve manual/legacy artifacts with insufficient provenance and report limits. Do not promise global removal of every copied fact in a legacy wiki.

## 10. Writes, removals, renames and conflicts

Before replace/delete validate expected source/scope ownership against the last ingestion-written page signature. Cover body and meaningful metadata, excluding proven automatic maintenance fields. Manual edits or dream reorganization produce explicit conflicts: preserve the page and do not claim completed synchronization. Document resolution/retry. force never bypasses this protection.

Plan naming collisions before writes: docs/api.md versus docs-api.md, different origins in one section, collapsed slugs, Unicode/empty slugs, index.md and reserved names. Ingested pages must not occupy structural indexes later overwritten by finalization. Keep valid existing mappings. Use deterministic identity-derived suffixes for new collisions and persist mappings. Never overwrite unowned pages to resolve naming.

Renames initially use safe new-source plus old-source removal semantics with prune. Optional rename optimization requires an unambiguous match, such as a unique exact hash in one scope, never LLM/similarity inference. move() must honor its contract and update ownership, ledger, chunks and dependencies. Existing wiki moves must update/validate bindings to prevent old-path recreation/duplication.

Prune requires complete discovery, verified ownership, compatible scope selection, conflict checks and successful required writes. Failures/deferrals block destructive work and report planned unapplied removals. Use wm.delete() or backend-equivalent contracts, never direct io.rm() for wiki pages. Protect read-only mounts, paths outside destination and internal control artifacts.

## 11. Persistence, concurrency and recovery

Two independent JSON writes are not a transaction. Implement a small recoverable generation/journal strategy or an existing equivalent, distinguishing prepared plan, applied page operations, committed state, pending finalization and completed run.

Check ledger/manifest persistence, write, delete and finalize results. Use atomic state-file replacement where supported; no silent non-atomic fallback advertised as equivalent. Recovery after delete-before-state-persistence is idempotent; already absent pages are recoverable.

Serialize shared wiki mutations and detect concurrent changes between planning/application. Reuse the console manager; do not open a second Lucene writer or close a caller-owned manager.

Remote guarantees use actual backend capabilities. Independent local caches cannot provide distributed multi-writer coordination: document single-writer limits. Close owned managers and clean temporary resources in finally, including errors.

## 12. Finalization and results

Finalize removal-only or index-affecting repair runs. Keep structural indexes/listings, metadata/text search, graph/backlinks, active chunks, caches and derivatives coherent. Remove obsolete automatic index references. Do not rewrite unknown manual links to hide lint failures; report unresolved broken links.

No global semantic consolidation for deterministic repair. Honor explicitly enabled semantic work and its costs. Finalization failure leaves recoverable pending work; retry without redistilling already applied sources.

Keep useful existing result fields and add status=complete|noop|planned|partial|blocked|failed, sync_complete, scope/discovery completeness, missing sources, planned/applied writes/removals, conflicts/blocked prune with reasons, removed chunks/invalidated derivatives, migration/repair done or pending, persistence/finalization failures.

ok=true means the requested work succeeded, not merely that the main block threw no exception. Blocking failures/conflicts/budget deferrals cannot report completed synchronization. Without prune, missing sources are reported and preserved: upsert may succeed but must not claim a full mirror. Dry-run separates planned and applied work. Propagate status/exit codes through wrappers.

## 13. Truly non-mutating dry-run

Planning changes no pages, ledger/manifest, indexes, graph/wiki logs, persisted timestamps or migration state. Inspect manager-constructor/loader side effects. Use read/planning paths that do not initialize/regenerate destination files. No LLM calls; report candidates/estimates without claiming completed distillation. Isolated temporary downloads/clones are allowed and cleaned, without authorizing wiki/source mutation.

## 14. Required regression tests

Use temporary fixtures, stub LLMs and fault injection; register tests in YAML jobs.

1. Initial ingestion creates one page per source.
2. Unchanged second run is no-op.
3. Only a changed source updates.
4. Changing section two of three preserves one and three.
5. Removing a section removes its content and preserves others.
6. Deletion without added chunks still updates correctly.
7. Forced distill uses complete, nonempty content.
8. normalize/raw/deterministic auto never construct an LLM.
9. Over-budget full sources defer without partial replacement.
10. Mode/fingerprint changes invalidate hash-only skipping.
11. Missing mapped pages repair with valid ownership.
12. Removing C while A/B stay unchanged detects absence.
13. prune=false preserves/reports C.
14. prune=true removes C and exclusive artifacts.
15. Removal-only runs finalize.
16. Confirmed empty origins require extra authorization.
17. Missing/inaccessible origins never prune.
18. Partial listing failures block destructive work.
19. Filtered/oversized/empty/unreadable files are not missing.
20. Filter changes preserve knowledge outside selection.
21. URL ingestion never deletes other URLs.
22. Successful rename/move reconciliation leaves no old page unless a reported conflict prevents it.
23. Removed chunks never appear in assembleContext().
24. Repeated updates/removals do not accumulate orphan chunks.
25. Equal relative paths across origins do not collide.
26. Repeated headings have distinct IDs.
27. Colliding/reserved slugs never overwrite other pages.
28. Manual/edited/other-origin pages survive.
29. Shared artifacts survive while legitimately referenced.
30. Affected derivatives invalidate without indiscriminately deleting valid contributors.
31. Destination-section changes cannot be skipped by an old hash.
32. Valid legacy migration is idempotent.
33. Ambiguous legacy ownership preserves data and blocks removal.
34. Corrupt manifests never enable prune.
35. LLM/write failure retains last applied state and retry eligibility.
36. Persistence/delete/finalize failures cannot report complete success.
37. Interrupted operations/state persistence recover.
38. Recovery retries neither duplicate nor remove additional artifacts.
39. Dry-run preserves destination hashes/inventory/timestamps.
40. Every entry point honors wikiaccess=ro.
41. Console manager reuse opens no second writer and does not close it.
42. Concurrent updates cannot silently lose changes.

Run at least `ojob tests/wikiIngest.yaml` and `ojob tests/wiki.yaml`, plus affected suites. Test remote contracts with mocks and no real credentials; distinguish simulated tests from real integrations. Record unavailable commands; written tests are not executed tests.

## 15. Documentation and examples

Explain upsert versus destructive reconciliation. Provide equivalent examples:

```sh
ojob mini-a-ingest.yaml ingestsource=./docs wikiroot=./wiki ingestmode=normalize ingestprune=true ingestdryrun=true
ojob mini-a-ingest.yaml ingestsource=./docs wikiroot=./wiki ingestmode=normalize ingestprune=true
ojob mini-a-ingest.yaml ingestsource=./docs wikiroot=./wiki ingestmode=normalize ingestprune=true ingestallowemptyprune=true
```

Explain non-destructive defaults, prune/empty-origin limits, filters/discovery errors, edited-page protection, migration/unresolved ownership, force versus deletion authorization, full-distillation costs/budget deferrals, recovery, backend/concurrency guarantees and limits, and derivative-cleanup limits without provenance.

## 16. Implementation order and completion criteria

Use small testable changes: A reproduce partial distillation/stale chunks; B complete reconstruction/active chunk validation; C versioned state/ownership/identity/migration; D complete discovery/planning/protected prune; E recoverable persistence/invalidation/finalization; F CLI/console integration/documentation/full regressions.

Do not postpone integrity fixes for future chunk optimization. Complete only when updated pages match current complete sources; removed content cannot return from stale chunks/caches; prune removes only verified eligible managed artifacts; partial failures never cause unsafe deletions; dry-run preserves destination; migration/recovery are tested; results/exit codes describe actual outcomes.

Delivery: summarize corrected defects/compatibility decisions, changed files, parameters/behavior, executed tests/results, and remaining limitations without presenting them as implemented guarantees.

## Opt-in passage retrieval

`wikiretrievalv2=true` and `wikiretrievalconfig` reach the shared wiki manager.
An explicit writable reindex builds local serving generations; existing ingestion
journals, full-source reconstruction and protected pruning remain authoritative.
Original ingestion chunks and summaries do not become wiki-range quotations.
See [retrieval v2](WIKI-RETRIEVAL-V2.md) for effective capabilities, restricted
presentation policy, rollout and outstanding requirements.

Retrieval publication, cold opening, first-use evidence verification and full
lint/export follow the [validation boundaries](../WIKI-RETRIEVE-PLAN.md#validation-boundaries).
Obsolete development serving schemas require explicit rejection and a writable
rebuild; ingestion must not introduce old-schema readers or exporters.
