# Wiki Graph v2: implementation plan for review

Status: implementation authorized on 2026-11-15. Audit date: 2026-11-15. Checkout: `main`.
This document records the reviewed architecture and implementation plan.
See `WIKI-GRAPH-V2.md` and `GRAPH-BUILDS-VALIDATION.md` for implemented behavior
and validation boundaries; defaults remain opt-in.

## 1. Current implementation and compatibility contract

The existing architecture already implements much of the requested foundation.
Extend it rather than replace the graph, manifest, retrieval engine or job system.

| Area | Current source and behavior | Consequence for v2 |
| --- | --- | --- |
| Page ingestion | `js/wiki/mini-a-ingest.js`, `run`, `_applyJournalPages`, `_finishJournal`, `_finalize`: scoped source/chunk manifests, signatures, journal v3, ownership/conflict checks, pruning, transform receipts and finalization checkpoints | Enqueue graph work only after page operations and ownership manifest commit; resume finalization without replaying transformations |
| Knowledge state | `js/wiki/mini-a-wiki-knowledge.js:6`, `knowledgeLoadState`, `knowledgePageSignature`, `knowledgeMove`, derivative registry | Manifest v2 remains the ownership authority. Source signatures exclude volatile metadata; do not substitute graph hashes for ownership signatures |
| Structural updates | `js/wiki/mini-a-wiki.js:1806`, `_graphUpdatePage`, `_graphRemovePage`, `_graphBatch`; `js/wiki/mini-a-graph.js:581`, `_updatePage` | Ordinary writes update structural state and invalidate page-owned semantic state; batches defer persistence and derived statistics, but are not transactions or rollback boundaries |
| Structural rebuild | `js/wiki/mini-a-graph.js:511`, `_buildStructural` | Reconstructs nodes and structural edges; preserves semantic work for unchanged page hashes and carries changed-page model work for later section rebasing |
| Graph identity | `js/wiki/mini-a-graph.js:94`, `_id`, `_edgeKey`, `_conceptId`, `_conceptVocabulary` | IDs include `doc:<path>`, heading-derived sections, normalized tags/aliases, page-scoped and normalized concepts. Edge identity includes endpoints/type/provenance plus owner page and section. Preserve these rules |
| Existing discovery | `js/wiki/mini-a-graph.js:293`, `_indexPageStructural`; `:717`, `_conceptVocabulary`; `:766`, `_deterministicMentions`; `:936`, `_sectionPlan` | Titles/source yield structural discovery keys. Semantic builds already ground technical identifiers, page titles/aliases and repeated emphasized terms, reject ambiguous identities, and select bounded peers via adjacency |
| Semantic extraction | `js/wiki/mini-a-graph.js:1032`, `buildSemantic`; `js/wiki/mini-a-graph-options.js` | Deterministic pass precedes optional LC/main extraction and decision classification. Contract v3 requires a literal section quote containing both endpoints; up to 32 relationships. Classification/fallback consume the same extraction budget |
| Budgets and evidence carry | `js/wiki/mini-a-graph.js:842`, `_stashCarry`, `_rebaseCarry`, `_migrateLegacyEnrichment`, `buildSemantic` | Stable section/model/input hashes, failure cycles, rotating work cursor, checkpoints every 15 seconds/250 sections, and legacy enrichment migration already exist. Reuse; separate reconciliation validation budget from extraction |
| Persistence | `js/wiki/mini-a-graph.js:487`, `_persist`; `:2337`, `save`; `:2396`, `load` | Graph envelope v2; atomic temporary-file replacement. FalkorDB sync/diffs run before local save; remote loading is preferred when configured. This is not an atomic local/remote transaction |
| Statistics | `js/wiki/mini-a-graph.js:2168`, `stats`; `utils/graphStats.yaml` | Library returns nodes, edges, provenance, danglingLinks and communities. Utility adds richer physical counts. Neither provides the requested meaningful-connectivity report |
| Communities/expansion | `js/wiki/mini-a-graph.js:1368`, `detectCommunities`, `expansionCandidates`, `proximity` | Community construction already uses explicit links and frequency-weighted shared features without a stored pair projection. Reuse its feature rules, but do not alter legacy community behavior when reconciliation is off |
| Retrieval V2 | `js/wiki/mini-a-wiki-retrieval.js`, `_collect`, `_expandGraph`, `_graphActive`; `docs/WIKI-RETRIEVAL-V2.md:129` | Pins immutable serving generations; bounded graph candidates must pass current revision, permission and passage checks. No embedding/model calls in serving retrieval. Preserve ranking and query-time mount joins |
| Reindex | `js/wiki/mini-a-wiki.js:1956`, `reindex` | V2 builds serving artifacts; legacy path may also rebuild the structural graph unless `skipGraph`. Preserve this distinction and all existing defaults |
| Full rebuild | `js/wiki/mini-a-wiki-maintenance.js:70`, `__miniAWikiFullRebuild`; manager `fullRebuild` | Already reconstructs from current Markdown, journals index/graph-reset/graph, snapshots old graph and resumes model sections. However, it saves an empty live graph at reset and discards pre-run evidence from active state. Replace this publication path with staging |
| Dream/ingest finalize | `js/memory/mini-a-dreams.js:2028`, `_finalizeWiki`, `_wikiSemanticEnabled`; ingest `_finalize` | Regenerates index pages, reindexes with graph skip, then builds graph. Apply/plan have existing semantic defaults different from graph/reorg; utility wrappers explicitly opt out. Preserve those historical behaviors |
| Embeddings | `js/memory/mini-a-embeddings.js`, `MiniAEmbeddings`, `MiniASemanticRetrieve`; wiki facade `js/wiki/mini-a-wiki-embeddings.js` | MVStore content/config keyed vectors, normalized responses, shape guards, shared handles, `get`/`peek`, provider metrics and bounded fallback exist. Cache is a vector store, not an ANN index |
| Skills | `js/skills/mini-a-skill-runtime.js`, consultation/discovery blocks | Optional skill embeddings and lexical selection have their own policies. Graph reconciliation must not enable skills/history or alter skill ranking |
| Entry points | `js/wiki/mini-a-wikiops.js`, `js/wiki/mini-a-mcp-wiki.js`, `js/session/mini-a-wikiman.js`, `mcps/mcp-wiki.yaml` | Operator graph build/settings already share manager APIs. Restricted wiki MCP has different mutation permissions; do not grant it new operator rights |
| Studio/utilities | `js/studio/wiki-studio-graph.js`, `wiki-studio-ingestion.js`, `wiki-studio-operations.js`, `wiki-studio-jobs.js`; `utils/wikiJobsLib.js`, `wikiHydrate.yaml`, `wikiDream.yaml`, `wikiGraph.yaml` | Reuse jobs, cancellation, backup and route/worker allowlists. `wikiGraph` is an offline renderer, not a rebuild service. Studio renderer caps are presentation limits, not graph processing limits |

Compatibility invariants:

1. Existing Markdown/frontmatter, manifests, serving indexes and graph v2 snapshots remain readable without migration on ordinary reads.
2. Reconciliation defaults to off everywhere. `wikigraphsemantic` retains deterministic plus optional model extraction semantics; it never means vectors.
3. Preserve existing edge types, provenance enum, public facades, ownership rules and graph APIs. New fields are additive and optional.
4. Mounts remain read-only; cross-wiki joins remain query-time only. Generated catalogs own no materialized primary graph.
5. No hidden provider calls during reads, diagnostics, preview, structural builds or ordinary reindexing.
6. Reconciliation edits derived artifacts only. Dream reorg and ingest retain their existing, separately authorized Markdown changes.
7. Never clear an existing cache merely because reconciliation is enabled. Preserve valid independent assertions when one supporting page disappears.

## 2. Minimal additions and shared APIs

Add three internal package-relative modules using `js/mini-a-paths.js`:

- `js/wiki/mini-a-graph-connectivity.js`: pure graph connectivity analysis, shared by library reports and statistics utility.
- `js/wiki/mini-a-graph-reconcile.js`: `MiniAGraphReconciler` with discovery, grounding, dependency/posting indexes and bounded work processing.
- `js/wiki/mini-a-graph-upgrade.js`: staging, verification, publication and recovery, called by existing maintenance/full-rebuild service. Avoid another public manager or ownership database.

Proposed library surface (additive):

```javascript
wm.graph("stats", { detailed: true })
wm.graph("build", { reconcile: "lexical", modelHelp: "off" })
wm.graph("reconcile", { reconcile: "lexical", preview: true })
wm.graph("upgrade", { reconcile: "lexical", preview: true })
wm.graph("upgrade", { reconcile: "lexical", confirmExpensive: true })
wm.graph("embeddings", { action: "refresh", embeddingMaxCalls: 8 })
wm.graph("resume", { runId: "..." })
wm.fullRebuild({ confirmExpensive: true, reconcile: "lexical" })
```

`upgrade` rebuilds graph artifacts only; `fullRebuild` retains its existing graph
and search-index purpose. Both use the same staged graph builder. Existing
`strategy=full|resume`, `force`, `semantic`, `modelHelp` and `dream.rebuild` remain
valid. Do not relax the existing extraction resolver's resume/force checks;
operation-level resume dispatches to the applicable saved phase separately.

Internal reconciler contract:

```javascript
reconciler.discover(pageRef, snapshot, options)
reconciler.validate(candidate, snapshot, options)
reconciler.plan(changes, snapshot, options)
reconciler.run(plan, options)
```

Candidate records contain source/target wiki-local IDs, current revisions and
graph hashes, strategy/method, matched normalized terms/concepts, bounded passage
references/quotes, lexical score components, optional cosine score, deterministic
rank, provenance and validation status/reason. Sort ties by canonical page path,
then passage offset; never use filesystem enumeration order.

All mutation actions must be added to manager writer-lock wrappers, pending move/
ingest guards, operation permissions, Studio worker allowlists and MCP schemas.
Preview and detailed stats must also work without a writable graph instance.

## 3. Exact proposed settings

Extend `MiniAGraphBuild.resolve/preferences` and shared argument mapping. Store
new preferences under existing `.mini-a-wiki-state/config.json.graphBuild`.

| CLI/session setting | Build option | Default / validation |
| --- | --- | --- |
| `wikigraphreconcile` | `reconcile` | `off`; `off`, `lexical`, `hybrid` |
| `wikigraphreconcilellm` | `reconcileLlm` | `off`; `off`, `auto`; auto requires reconciliation enabled |
| `wikigraphreconcilemaxcandidates` | `reconcileMaxCandidates` | 16 per page; integer 1–128 |
| `wikigraphreconcilemaxedges` | `reconcileMaxEdges` | 16 added concept memberships/assertions per page; integer 1–128; existing structural/semantic edges excluded |
| `wikigraphreconcilemaxcalls` | `reconcileMaxCalls` | 8 validation calls per invocation; integer 0–1000 |
| `wikigraphreconcilemaxtokens` | `reconcileMaxTokens` | 16000 estimated validation tokens per invocation; integer >= 0 |
| `wikigraphreconcilemaxminutes` | `reconcileMaxMinutes` | 1 minute per invocation; positive finite number |
| `wikigraphembeddingmaxcalls` | `embeddingMaxCalls` | 8 cache misses per invocation; integer 0–1000 |
| `wikigraphreconcilemaxpages` | `reconcileMaxPages` | 100 processed pages per invocation; integer 1–10000 |
| `wikigraphreconcilemaxdf` | `reconcileMaxDf` | 0.2 corpus fraction; finite number > 0 and <= 1 |
| `wikigraphembeddingmaxcomparisons` | `embeddingMaxComparisons` | 10000 dot products per invocation; positive integer |

Add internal hard limits: 256 feature postings inspected per page, 16 discovery
queries per page, 4096 input characters per embedding, 4 selected passages per
page, and bounded quote lengths. Expose effective limits and truncation reasons.
Usable feature DF ceiling is `min(200, max(2, floor(pageCount * maxDf)))` plus the
generic stoplist. These are proposed new-reconciliation defaults, not changes to
legacy community/expansion thresholds. Quality tests may tighten them before release.

Resolution: built-ins < saved wiki preferences < explicit session configuration
< explicit operation overrides. Existing wrapper-enforced access/backup settings
still apply. Do not treat YAML-injected absent/default values as explicit overrides.
No new environment toggle automatically enables reconciliation; `OAF_EMBED_MODEL`
supplies only an embedding provider. Existing presets retain their current values
and do not switch on either reconciliation or LLM validation.

`reconcile=hybrid` without a usable provider returns lexical results with a clear
fallback status. LLM availability never changes `reconcileLlm=off`. Zero validation
or embedding budgets mean no new provider calls, including retries/classification.
One invocation shares its limits across all affected pages and fallback attempts.
Resume uses a new explicit invocation budget; report cumulative spend separately.

## 4. Connectivity diagnostics

Keep every existing statistic. Add optional `connectivity` and `enrichment`
objects; the offline utility retains all its existing fields too.

Report physical document count, authoritative actual pages, placeholders, explicit
document edge count, documents with qualifying shared tags, grounded shared
concepts, navigation-only documents, semantically isolated documents, component
sizes/count, largest-component percentage, mean/median distinct meaningful
neighbors, edges by type/provenance/method, validation rejections, dangling/stale
evidence and completed/pending/deferred/failed enrichment work.

Definitions are part of the API:

- Actual pages come from the authoritative page inventory when provided; snapshot-only reports use indexed hash/revision and mark authority as `snapshot`.
- Meaningful connectivity includes non-navigation explicit document links, non-generic shared tags and current grounded concept memberships. `IN_SECTION`, discovery keys, aliases identifying the same page, placeholders and stale/ambiguous assertions do not count.
- Navigation is a derived classification of generated/root/folder index pages and link evidence, not a new edge type. Report uncertain classification separately.
- Semantic isolation means no qualifying grounded concept or validated semantic connection; also report meaningful isolation, since explicit links/tags can connect a semantically isolated page.
- A popular generic concept cannot connect components or increase meaningful degree. Inferred evidence is reported separately from grounded evidence.

Compute components through union-find over explicit links and feature incidence:
union one representative with each member, without expanding feature cliques.
For distinct neighbor degrees, traverse only eligible, DF-capped postings and
deduplicate one document at a time. Enforce a report-wide visit/deadline budget.
If exhausted, return incomplete/partial degree metrics with inspected counts and
lower bounds; never label estimates as exact median/average. Components can still
be exact over the full eligible incidence pass. Cache reports by graph checksum
and diagnostic policy version. Do not make detailed diagnostics a mandatory save cost.

## 5. Discovery, validation and relationship representation

Discovery reads the whole eligible primary wiki through existing indexes, even
when the changed set is one ingest batch. Strategies share a single result format:
resolved links; tag/alias/page-name postings; normalized technical concepts;
title/description lexical search using V2 passage candidates; bounded existing
graph adjacency; optional vector candidates. V2 discovery disables graph expansion
to avoid recursive reinforcement and pins the serving generation. A temporary
derived lexical index supports a staged rebuild or legacy wiki without V2; do not
force conversion of its serving index.

Apply DF filtering, stable ranks, per-strategy reserves and candidate/visit limits
before passage loading. Index vocabulary lookups including unsuccessful mentions
so a newly introduced title/concept can revisit relevant old pages. Index tokens
from relevant body windows as well as metadata; otherwise cross-batch discovery
would miss old pages without matching titles. New vocabulary lookup uses postings,
never unrestricted source-target pairs. Report posting truncation and remaining work.

Validation first rechecks current page identities, revisions, permissions and
pending journals. Explicit links retain `LINKS_TO`. Shared tags retain `HAS_TAG`.
Grounded concepts materialize/reuse `MENTIONS`, with source quotes/offsets and
existing concept normalization/ambiguity rules. Lexical similarity does not prove
a concept identity, causal relationship or factual association. A vector score
alone is always discovery-only. Do not persist generic `RELATED_TO` document
edges simply because two pages are similar.

Use existing shared concept paths instead of document-pair cliques. Each assertion
has a stable logical evidence key, owner, page revisions/hashes, quote references,
method, validation status, confidence and reconciliation contract version.
Do not deduplicate independently supported assertions into an ownerless edge.
If an existing deterministic/semantic membership already provides the same valid
support, reuse it rather than add a competing assertion. Enforce caps only on
new reconciliation-owned work; never delete legacy evidence to meet a new cap.

Optional LLM validation gets only bounded source/target passages and an explicit
untrusted-data instruction. A separate versioned pair-validation contract must
check both documents' literal evidence and revisions; it must not weaken the
existing single-section extraction contract. The initial implementation validates
ambiguous concept grounding/identity and can abstain. Factual concept relationships
continue through the existing extractor and its two-endpoint quote checks.
Reject contradictory outputs, unresolved homonyms, unsupported endpoints and
invented citations. An inferred statement remains `INFERRED`; model approval is
not evidence that it is an explicit source assertion.

## 6. Persistent state, invalidation and incremental processing

Keep graph envelope `version: 2`. Add optional `reconciliation` metadata version 1
and additive reconciliation-owned edge properties. Do not change manifest schema
or existing graph edge keys. Reconciliation metadata records policy/version,
effective non-secret fingerprints, per-page input signatures, generation,
coverage, and references/checksums for rebuildable posting/dependency shards.

Store derived artifacts under `.mini-a-wiki-graph/reconcile/`: hash-prefix shards
for page features, vocabulary/term postings, assertion dependencies and completed
work records. Each record is generation/checksum bound to `graph.json`. Missing,
corrupt or mismatched shards are rebuilt or ignored, never treated as ownership
authority. Bundles may omit them; graph evidence remains self-contained and usable.

Only persist evidence metadata needed to verify graph assertions in graph.json.
Avoid duplicating complete page bodies, manifest chunks or vectors there. Store
vectors in the existing MVStore cache with a separate derived ID-to-input mapping.
Never store provider config, raw responses, keys, headers or URLs in reports.
Current embedding identity hashes the canonical configuration (including secret
values) but does not persist the configuration itself. Preserve cache compatibility;
use a separately allowlisted model/type/dimension/version fingerprint for metadata.
Do not silently change global cache keys for history and skills.

Incremental sequence under the existing writer lock:

1. Finish/recover Markdown operations and commit the ownership manifest.
2. Record the changed/deleted/moved page set and revisions durably before finalization can complete. Existing graph batches remain structural work only.
3. Build updated feature postings, invalidate assertions dependent on old revisions, and select affected neighbors from reverse postings/dependencies.
4. Process a bounded, path-ordered work queue. Recheck revisions before committing each work unit; preserve completed signatures and valid independent support.
5. Publish a validated graph generation and matching derived checkpoints. Mark partial jobs explicitly and resume without repeating completed transformations/provider results.

Deletion removes derived entries and support owned by that page; peers retain
independent memberships. Moves use the existing verified move journal and path
mapping; document IDs remain path-based. Do not invent UUID identity migration.
Revalidate/rebase evidence against moved content and replace affected path IDs;
unchanged text can still reuse embedding inputs. Metadata/vocabulary/model/contract
changes invalidate only signatures and dependencies they actually affect.

Unchanged ingest still checks policy/version and pending queue signatures when
reconciliation is enabled. A completed identical run makes zero provider calls
and no graph rewrite. A pending run stays visible even if all source transforms
were skipped. Ingest source synchronization and enrichment completion are distinct
status fields; partial optional enrichment does not pretend that page ingestion
failed or that enrichment completed.

## 7. Full upgrade, migration, preview and recovery

Extend existing `.mini-a-wiki-full-rebuild.json` to journal v2 with operation kind,
wiki identity, inventory digest, effective settings, source graph checksum,
stage directory, per-phase cursors, cumulative provider usage, staged checksum,
previous checksum, publication and remote-sync status. Incremental reconciliation
uses the same runner's work records; it does not compete with the ingest journal.

Proposed phases:

`inventory -> structure -> discovery-index -> reconcile -> validate -> ready -> publish -> remote-sync -> complete`

Search publication is a separate existing V2 phase when `fullRebuild` requests it.
Preserve immutable V2 generations; do not promise a new atomic transaction spanning
search, graph, Markdown and FalkorDB. Revision gating protects mixed generations.

Build under `.mini-a-wiki-graph/staging/<runId>/` with autosave there and no remote
writer configured. Seed compatible semantic cache/carry/evidence from the old graph.
Reconstruct authoritative structure from current Markdown, including a legacy
structural-only graph; no original repository, PDF, website or source folder needed.
Validate endpoints, evidence/revisions, duplicate identities, schema, dependency
checksums and a reload round trip. Derive communities once after committed batches.

Before publication, reread inventory/revisions under lock and reject stale stages.
Write and verify an immutable previous snapshot and a durable `ready` checkpoint,
then atomically replace live `graph.json`; checksum-bound sidecars can be installed
first because old readers ignore mismatched generations. Record publication and
reload the manager. Never replace the live graph with an empty interim graph.
Failure before replacement leaves the original usable; failure after replacement
is detected by checksum and recovery completes journal bookkeeping or restores
the verified previous snapshot. Keep the previous generation until explicit safe
cleanup. Account for staging plus previous snapshot disk requirements in preflight.

Ordinary reconciliation may publish completed validated units with explicit partial
coverage. Full upgrade keeps its replacement staged until required phases finish;
after budget exhaustion it remains partial and resumable while the old graph serves.
Optional provider unavailability may publish a lexical-complete replacement only
with an explicit degraded/embedding-pending result, never `complete` for all requested
enrichment. Define structural-ready, lexical-complete and requested-enrichment-complete
separately in result schema.

Preview performs no provider calls, graph mutation, cache writes, preferences saves
or wiki-local locks that create files. It reports inspected pages, current nodes/
edges, provable additions/removals, unknown model-dependent changes, estimated
vector hits/misses, call/token/disk estimates and migration conflicts. Estimates
are bounded ranges; do not claim exact unknown provider output. Read-only mounts
can diagnose/preview an individual wiki, never materialize cross-wiki relationships.

Legacy rebuild journal v1 migration is deterministic: preserve the old journal,
inspect phase/source digest, locate its recovery snapshot, and reuse proven index
and model checkpoints. Never assume the current graph is the original if reset
already happened. Unprovable recovery requires a clear diagnostic; Markdown can
still reconstruct structure. Unknown future schemas fail closed without mutation.

FalkorDB needs an explicit compatibility branch: current remote-first reads and
remote-before-local persistence cannot guarantee atomic publication across stores.
Keep existing operations intact when reconciliation is off. For staged upgrades,
publish local verified state with a durable remote-sync marker, synchronize in a
maintenance window, and force compatible managers to use the verified local graph
while remote state is pending; do not load a partially synced remote graph. Retry
remote sync without repeating enrichment. Existing external/older remote readers
must be stopped during that window. Generation-isolated remote graph names are an
alternative only if a tested adapter can publish/select them safely; do not claim
distributed atomicity or silently switch configured remote names.

Rollback restores the verified prior graph and its checksum-bound sidecars under
the same lock, reloads readers and schedules a full remote resync where applicable.
`reconcile=off` stops new enrichment; it does not erase previously valid graph
evidence. Provide an explicit previewable cleanup operation for reconciliation-owned
assertions if users need the exact pre-enrichment graph rather than disabled work.

## 8. Embedding orchestration and scale

Reuse `MiniAWikiEmbeddings`/`MiniAEmbeddings` and acquire the existing process/file
cache lock conventions. Start with title + description and selected relevant
passages, not every heading/node/tag. Cache immutable inputs by existing content/
configuration keys; namespace index mappings by allowlisted model fingerprint,
dimensions and input-policy version. Validate cached dimensions too, including
the current `peek` path. Incompatible vectors must never participate in cosine
ranking. Provider errors stop vector work and preserve deterministic progress.

MVStore suffices for vector reuse but provides no nearest-neighbor search. Initial
hybrid mode uses bounded exact ranking of corpus-wide lexical/feature candidates;
small-wiki whole-corpus probing is permitted only within the invocation comparison
budget. Full rebuild must not repeat whole-corpus comparisons for every page.
This first implementation is embedding-assisted reranking, with that recall limit
documented. It makes no claim to retrieve lexical-disjoint synonyms corpus-wide.

Benchmark an optional persistent ANN adapter after lexical and bounded hybrid
baselines. Prefer existing installed Lucene vector capabilities if the supported
oPack exposes a stable API; verify capabilities rather than importing arbitrary
sibling JARs. Add no mandatory dependency. ANN metadata/index publication must use
the same generation/model/dimension checks and checkpoint runner. If benchmarks
do not justify ANN, retain bounded hybrid and document its limitation.

Expected work: inventory/structural passes O(input bytes + graph size); indexed
candidate work O(changed pages * bounded posting/query visits), with vocabulary
invalidations possibly broad but resumable; vector dot products O(comparisons *
dimensions); component union approximately O(nodes + feature incidences + edges).
Detailed degrees are budgeted and may be partial. Current whole-JSON graph save,
load/cloning and some derived recomputation remain O(graph size), so v2 does not
claim every incremental publication is sublinear. Batch and measure these costs.

Report cold/warm calls, cache hits, failures, estimated versus reported tokens,
elapsed time, comparison/posting visits, changed/unchanged pages, stage bytes,
peak heap and graph rewrites. No quality or cost improvement is established by
this design alone.

## 9. Phased tasks and completion gates

| Phase / dependencies | Files and API work | Tests and completion criteria |
| --- | --- | --- |
| 0: audit / review | This document; baseline existing suites; confirm settings, representation and remote publication decisions | Review architecture references and compatibility fixtures. No runtime implementation before review |
| 1: diagnostics / phase 0 | New connectivity module; graph `stats(options)` and `saveReport`; manager stats dispatch; `utils/graphStats.yaml`; console/Studio report presentation | Section-heavy isolated fixture, generic concepts/tags, placeholders, navigation, stale revisions, exact components, partial degree reporting. Preserve every legacy statistics field. Independently releasable |
| 2: deterministic reconciliation / phase 1 | New reconciler; graph owner/index/evidence helpers; shared build resolver; manager hooks and knowledge dependency integration; V2 candidate adapter | Cross-batch old-page discovery, ambiguities, source/target grounding, edits/deletes/moves, vocabulary additions, stable order, edge caps, repeated-run identity and zero-call/no-op behavior. Initially manual library/build entry point |
| 3: legacy upgrade / phase 2 | New upgrade module; maintenance journal v2/fullRebuild; graph load/save/carry; export/hydration compatibility | Structural-only and semantic legacy fixtures; no original sources; repeat upgrade equivalence; v1 journal migration; read-only preview; interruption at every ready/rename/sync checkpoint; verified prior graph always available. Required before hybrid release |
| 4: embedding discovery / phase 3 | Reconciler strategy; shared embedding shape guards and metrics; wiki cache facade; optional ANN adapter only after benchmark | No model/provider, timeout, busy cache, invalid vectors, model/dimension changes, warm restart, cap/cancellation, bounded comparisons, deterministic fallback. No retrieval default change |
| 5: optional LLM validation / phases 2–4 | New pair contract in graph options/reconciler; existing model adapters and failure scheduling | Exact evidence, homonyms, contradictions, malformed/partial output, injection text, abstention, retries and shared spend limits. Off means zero calls; vectors never authorize calls |
| 6: lifecycle/UI parity / phases 2–5 | Ingest journals/finalize/no-change path; Dream finalization/rebuild/reorg; common config mapping; `mini-a.yaml`, `mini-a-web.yaml`; wikiops/wikiman; native MCP and restricted MCP schema; Studio ingestion/operations/jobs and existing public client; utils hydrate/dream/jobs lib/graph renderer where needed | Entrypoint settings/permissions parity; pending work after unchanged ingest; cancellation/recovery; serving/export/Falkor round trips; real browser light/dark/narrow and terminal Back/Cancel. Preserve old behavior when options absent |
| 7: release quality / all | Tests/fixtures/benchmarks and docs below; package metadata using existing generator if shipping new files | All relevant suites pass; held-out non-regression; 100/1000/10000-page runs; resource/cost report; live backend/provider boundaries stated. No default enablement without separate approval |

Phase 1 is independent. Phases 2–3 form a useful deterministic release without
embeddings or LLM validation. Phase 4 is optional; phase 5 is optional independently
of vector discovery. Lifecycle wiring can be developed per surface after the
shared contracts stabilize, but automatic ingest enrichment must wait for recovery
tests. ANN is separately gated by evidence, not a prerequisite for lexical release.

## 10. Test matrix and commands

Audit baseline executed on 2026-11-15: `ojob tests/graph.yaml` passed 22 tests;
`ojob tests/wiki.yaml` passed 268 tests; `node tests/modulePaths.cjs` and
`python3 tests/modulePaths.py` both passed. All four processes exited zero.
These establish the current checkout baseline, not proof of proposed v2 behavior.
No live provider, FalkorDB, browser or scale benchmark was run for this audit.

Extend existing tests rather than replace their fixtures:

- `tests/graph.js`, `graphBuild.js`, `graphParity.js`, `graphLift.js`: identity, carry, legacy migration, provenance, retrieval bounds and disabled-mode equivalence.
- New `tests/graphConnectivity.js`, `graphReconcile.js`, `graphUpgrade.js`, with oJob jobs wired into `tests/graph.yaml` or dedicated YAML jobs.
- `tests/wikiFullRebuild.js`: staging, old-graph availability, interruption/restart, semantic cache retention, disk/publication failures and read-only preview.
- `tests/wikiIngest.js`, `wikiIngestRecoveryProcess.py`: committed changed-set handoff, maintenance-only no-change runs, prune ownership, no partial-transaction graph publication, independent support retention.
- `tests/wikiEmbeddings.js`, `wikiEmbeddingsQuality.js`, `embeddingStats.cjs`: cache shape and fingerprints, provider failures, cold/warm/restart budgets; keep live evaluation explicitly separate.
- `tests/wikiRetrievalContracts.js`, `wikiRetrievalAcceptance.py`, federation/parity/export suites: pinned revisions, permissions, query-time joins, graph-disabled equivalence, artifact hydration with missing derived sidecars.
- `tests/wikiManager.js`, `wikiStudio.js`, `wikiStudioBrowser.cjs`, `wikiUtilsJobs.js`, module paths: consistent options and operation dispatch, permissions, cancellation and packaged loading.
- `tests/graphFalkorLive.js`: opt-in real service round trip, reconciliation metadata and failed-sync/recovery behavior. Mocks alone do not establish remote compatibility.

Baseline and release commands (run from this checkout, using supported installed
OpenAF/oPacks; provider tests require explicitly configured local/test models):

```sh
ojob tests/graph.yaml
oaf -f tests/graphBuild.js
ojob tests/graphLift.yaml
ojob tests/wiki.yaml
ojob tests/wikiIngest.yaml
ojob tests/wikiUtilsJobs.yaml
ojob tests/wikiManager.yaml
ojob tests/wikiStudio.yaml
node tests/modulePaths.cjs
python3 tests/modulePaths.py
python3 tests/wikiIngestRecoveryProcess.py
python3 tests/wikiRetrievalAcceptance.py
node tests/embeddingStats.cjs
git diff --check
```

Inspect each standalone harness's required environment before execution. Run new
upgrade/reconcile fault jobs and graph parity/Falkor tests via their documented
harnesses. UI checks must exercise the actual served build and report untested
surfaces. Do not substitute syntax checks for browser/runtime correctness.

Quality corpus: partition documents/queries before tuning thresholds. Compare
lexical-only, structural graph, existing semantic graph, reconciled lexical,
bounded hybrid, and optional LLM validation using the same retrieval budgets and
candidate universe. Include unrelated pages, ambiguous identifiers, misleading
high cosine scores, navigation-heavy pages, old/new ingest batches, and abstention
queries. Freeze expected relationships independently of candidate discovery.

Report Recall@K, MRR, grounded-edge precision/false-positive rate, abstention,
component distribution/neighbor coverage, p50/p95 retrieval/build/update latency,
heap/storage overhead and cold/warm provider usage. Gate deterministic gold fixtures
on zero unsupported assertions; disabled-mode compatibility on identical observable
results except additive diagnostics. Hybrid/LLM release requires no lower recall/MRR
and no higher false-positive/abstention error on the frozen comparison corpus;
report uncertainty/sample sizes rather than extrapolate small-fixture results.

Scale at approximately 100, 1000 and 10000 pages; add 100000 passages if practical.
Instrument visits/comparisons to establish bounded work; elapsed time alone does
not prove absence of quadratic behavior. Include an adversarial common-feature
corpus, large sections, cold/warm caches and single-page updates. Record fixed
hardware/runtime/heap, graph bytes and publication overhead. Performance thresholds
must be set from phase-0/1 measured baselines, not invented in this document.

## 11. Documentation and remaining review decisions

Update `docs/WIKI.md`, `WIKI-QUICKSTART.md`, `GRAPH-BUILDS.md`,
`GRAPH-BUILDS-VALIDATION.md`, `WIKI-RETRIEVAL-V2.md`, `WIKI-STUDIO.md`, relevant
CLI/help/native/restricted MCP docs and utility descriptions. Correct the
`embedding-based` wording in both `mini-a.yaml` and `mini-a-web.yaml`. Explain
structural vs deterministic semantic extraction vs optional model extraction vs
vector discovery; rebuilding from existing Markdown; separate reindex/reconcile/
embedding refresh; partial/retry/resume; budgets; cache/model invalidation;
diagnostics; read-only restrictions; recoverable publication; rollback and disabling.

Before implementation review, proposed defaults are: shared concept memberships,
no new factual document relation type; graph envelope stays v2; no mandatory ANN;
filesystem staging first; conservative budgets; no implicit provider calls.

Material tradeoffs requiring explicit review:

1. Exact neighbor statistics can exceed a fixed work budget. This proposal reports partial metrics honestly rather than silently approximating exact counts.
2. Initial hybrid reranks bounded lexical/feature candidates. Broader semantic recall requires a separately justified ANN adapter and supported runtime capability.
3. Full graph upgrades retain the live old graph until publication, costing extra disk and potentially substantial heap. Whole-JSON storage remains a scalability constraint.
4. Current FalkorDB has no cross-store atomic commit. Maintenance-window sync with explicit local fallback is the compatible initial design; older external readers need operational coordination.
5. A crash after a provider accepted a request but before its response was durably cached can cause a repeated billable call. Record ambiguous in-flight attempts; do not promise exactly-once external billing without provider idempotency support.
6. Manual filesystem edits can race the manager lock. Recheck inventory and evidence at publication and return stale-stage status; do not publish unverified source revisions.
7. Existing assertions lacking enough evidence remain readable legacy data but cannot count as verified connectivity or expand revision-gated retrieval until re-grounded. Preserve recoverable legacy bytes instead of inventing provenance.
8. No embedding quality improvement, large-scale capacity or live remote behavior is established by this audit. Those are release gates, not assumptions.

The fifteen requested acceptance criteria map to phases 2–3 (incrementality,
source-free/idempotent upgrade and recovery), 4–5 (cached optional providers and
failure isolation), 1 (honest connectivity), 6 (all lifecycle/API compatibility),
and 7 (quality/performance/regression proof). Completion requires those measured
gates, not merely a denser graph.
