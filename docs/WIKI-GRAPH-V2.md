# Incremental wiki graph reconciliation

Graph reconciliation is optional derived-data maintenance. Existing settings keep
their behavior except that `wikigraphreconcile=lexical` (deterministic, no provider calls) is now the default; set `off` to disable it. Also
`wikigraphsemantic` still controls semantic extraction, not embeddings.
Reconciliation never edits source Markdown, frontmatter or ingestion ownership.

## Choose the operation

| Operation | Effect | Provider calls |
| --- | --- | --- |
| `wiki reindex` | Existing lexical/serving index rebuild behavior | None introduced by reconciliation |
| `graph build extraction=structural` | Structural nodes and explicit relationships | None unless reconciliation was explicitly enabled |
| `graph build extraction=semantic modelHelp=off` | Existing grounded deterministic concept extraction | None unless separate reconciliation assistance was enabled |
| `graph reconcile` | Incremental corpus-wide candidate discovery and grounded memberships | Lexical by default; optional independent settings below |
| `graph upgrade` | Staged complete reconstruction from current wiki Markdown | Only explicitly selected extraction/reconciliation assistance |
| `graph embeddings` | Refresh the graph's persistent embedding cache | Bounded embedding cache misses only; no graph relationships |
| `graph resume` | Continue an unfinished staged upgrade | Reuses completed evidence and cached vectors |
| `dream rebuild` / `fullRebuild` | Existing search plus full graph rebuild, now using staged graph publication | Effective build settings; clearly expensive opt-in |

Original PDFs, websites, repositories and ingest folders are unnecessary for a
graph upgrade. Structural-only and semantically enriched legacy graphs are both
supported. Existing concept/document/section/tag/alias identities are retained.
Mounts remain read-only and cross-wiki relationships remain query-time joins.

## Start with deterministic reconciliation

```sh
ojob utils/wikiOps.yaml operation=graph.reconcile \
  wikiroot=/path/wiki usewikigraph=true wikiaccess=rw confirm=true \
  params='{"reconcile":"lexical"}'

# Enable the same work during ordinary ingestion and Dream finalization.
ojob utils/wikiHydrate.yaml wikiroot=/path/wiki source=/path/source \
  wikigraphreconcile=lexical

# Or save shared preferences for subsequent builds and ingestions.
ojob utils/wikiOps.yaml operation=graph.defaults \
  wikiroot=/path/wiki usewikigraph=true wikiaccess=rw confirm=true \
  params='{"reconcile":"lexical","reconcileLlm":"off"}'
```

Candidates come from the entire eligible primary wiki: resolved links, metadata
postings, grounded normalized concepts and, when available, the existing V2 lexical
passage index. Generic/high-frequency features are suppressed. Similarity is a
discovery signal; it never creates a factual document relationship by itself.
Grounding reuses independent `MENTIONS` assertions and shared concept nodes rather
than constructing document-pair cliques. Ambiguous identities are not merged.

Repeated unchanged ingestion skips transformations and checks pending/versioned
graph work. A completed identical reconciliation makes zero provider calls and
does not rewrite `graph.json`. Edited/deleted pages lose stale support while other
pages keep independently supported evidence. Source synchronization and optional
enrichment completion are reported separately. Manual page writes, deletes and
moves mark derived relationship work pending without starting providers. The next
explicit reconciliation/build or enabled ingestion finalization processes it.

## Settings and costs

Explicit operation options override explicit session settings, saved wiki build
preferences and built-ins, in that order. CLI names are lower case; build options
use camel case. Saved preferences live in `.mini-a-wiki-state/config.json`.

| CLI setting | Build option | Default |
| --- | --- | --- |
| `wikigraphreconcile` | `reconcile` | `lexical`: `off`, `lexical`, `hybrid` |
| `wikigraphreconcilellm` | `reconcileLlm` | `off`: `off`, `auto` |
| `wikigraphreconcilemaxcandidates` | `reconcileMaxCandidates` | 16 per page, maximum 128 |
| `wikigraphreconcilemaxedges` | `reconcileMaxEdges` | 16 added memberships per page, maximum 128 |
| `wikigraphreconcilemaxpages` | `reconcileMaxPages` | 100 indexing/reconciliation pages for the first run (follow-up runs in the same build take 10×), maximum 10000; a build repeats runs until settled within the time and provider budgets |
| `wikigraphreconcilemaxcalls` | `reconcileMaxCalls` | 8 validation calls per invocation, maximum 1000 |
| `wikigraphreconcilemaxtokens` | `reconcileMaxTokens` | 16000 estimated validation tokens |
| `wikigraphreconcilemaxminutes` | `reconcileMaxMinutes` | 1 minute per invocation |
| `wikigraphreconcilemaxdf` | `reconcileMaxDf` | 0.2 corpus fraction; absolute feature DF capped at 200 |
| `wikigraphembeddingmaxcalls` | `embeddingMaxCalls` | 8 cache misses per invocation, maximum 1000 |
| `wikigraphembeddingmaxcomparisons` | `embeddingMaxComparisons` | 10000 vector comparisons per invocation |

Zero validation-call/token or embedding-call budgets defer the corresponding new
provider work. Page/candidate/edge/comparison limits must be positive integers;
minutes must be positive and finite, and DF must be in `(0,1]`. Invalid settings
fail before provider creation. Existing semantic extraction budgets remain separate.
Time limits stop new calls; an in-flight request uses its provider timeout.

Budgets apply to an invocation, shared across its pages. Repeating a partial run
grants another invocation budget while reusing completed work. Lower page limits
can require multiple runs to finish corpus indexing before reconciliation begins.

## Embeddings without LLM validation

Configure `OAF_EMBED_MODEL` using an embedding-capable OpenAF provider, then use:

```sh
ojob utils/wikiOps.yaml operation=graph.reconcile \
  wikiroot=/path/wiki usewikigraph=true wikiaccess=rw confirm=true \
  params='{"reconcile":"hybrid","reconcileLlm":"off","embeddingMaxCalls":8}'
```

Inputs combine bounded title/description and up to four passages around technical
identifiers or code mentions (falling back to the introduction), up to 4096 characters.
Existing H2 MVStore infrastructure caches normalized vectors by content and provider
configuration, with model/dimension checks. Unchanged inputs are reused across
refresh, reconciliation and staged upgrades. Credentials are never written into
graph reports or index metadata. Provider errors stop vector work for the invocation
and preserve deterministic grounding; requested vector work remains explicitly partial.

Hybrid currently reranks a bounded lexical/feature candidate set. It does not scan
all document pairs and does not provide corpus-wide synonym discovery independent
of lexical/features. There is no mandatory vector database or ANN dependency.
The measured synthetic comparisons did not demonstrate additional quality from
hybrid ranking; it remains opt-in. Add ANN only after a representative quality and
cost benchmark justifies it.

`reconcileLlm=auto` independently enables bounded validation of ambiguous shared
concepts. It requires literal source and target quotes, current revisions, specific
names and unambiguous identity. It can abstain. Successful pair results are durably
cached, including empty results; both document memberships reuse one pair call.
Failures are deferred after two cycles; explicit per-run `reconcileRetryFailed=true` permits another
attempt without enabling ordinary semantic extraction. Embedding availability never authorizes LLM calls.

## Preview, upgrade and recovery

```sh
# Read-only, model-free preview. No confirm flag or write access is needed.
ojob utils/wikiOps.yaml operation=graph.upgrade \
  wikiroot=/path/wiki usewikigraph=true wikiaccess=ro \
  params='{"preview":true,"reconcile":"lexical"}'

# Reconstruct only the graph from current wiki pages, retaining compatible evidence.
ojob utils/wikiOps.yaml operation=graph.upgrade \
  wikiroot=/path/wiki usewikigraph=true wikiaccess=rw confirm=true \
  params='{"confirmExpensive":true,"reconcile":"lexical","reconcileMaxPages":1000}'

# Continue a partial or interrupted upgrade.
ojob utils/wikiOps.yaml operation=graph.resume \
  wikiroot=/path/wiki usewikigraph=true wikiaccess=rw confirm=true \
  params='{"confirmExpensive":true,"reconcileMaxPages":1000}'
```

Preview reports current graph/connectivity, deterministic expected results and
bounded provider/disk estimates. Model-dependent changes are uncertain. Preview
never calls models, writes caches or changes the manager's live graph.

The version-2 `.mini-a-wiki-full-rebuild.json` journal tracks indexing, structural
staging, enrichment, validation, readiness, publication and remote synchronization.
Stages live under `.mini-a-wiki-graph/staging/<runId>`. The old live graph remains
available until the replacement has passed endpoint checks, a saved/reloaded round
trip and an authoritative inventory revision check. Publication atomically replaces
`graph.json`; a verified `graph.json.before-full-rebuild-<runId>` remains available.
Never delete these artifacts while a run is pending. Legacy journal v1 is preserved
and migrated without discarding its compatible recovery snapshot.

Resume keeps the settings recorded in the pending journal, including extraction
and model assistance. Explicit request parameters override only their named fields.
Studio uses the saved run settings unless **Override saved upgrade settings with
these controls when resuming** is selected.

Publication also checks that the live graph has not changed since staging began.
A conflicting resume returns `graph-conflict` and preserves the live graph, journal
and staged snapshot. Run `graph upgrade` again to start a new run from the current
graph, including its newer evidence. The earlier stage is retained for inspection.

Search and graph publication are separate operations. Existing V2 revision checks
protect retrieval during mixed generations. An interrupted or budget-limited full
upgrade stays staged and reports `partial`/`resumable`; the old graph continues to
serve. A changed Markdown inventory invalidates the stage. No original ingest source
is needed to restart it. Unchanged compatible semantic evidence and embeddings survive.

For explicit rollback, preview and restore using the completed upgrade ID:

```sh
ojob utils/wikiOps.yaml operation=graph.rollback \
  wikiroot=/path/wiki usewikigraph=true wikiaccess=rw confirm=true \
  params='{"runId":"UPGRADE-ID","preview":true}'
# Remove preview:true to restore the checksum-verified predecessor.
```

FalkorDB is not part of an atomic distributed commit. During reconciled incremental or staged publication,
`remote-sync.json` keeps compatible readers on the verified local snapshot until
remote synchronization succeeds. Stop older/external remote readers during the
maintenance window. Resume retries synchronization without repeating enrichment;
an explicit successful `graph falkor` synchronization also clears the marker.

Rebuildable discovery shards are checksum-addressed under
`.mini-a-wiki-graph/reconcile/`; vectors use `reconcile-embeddings.db` and validated
pair receipts use `validation/`. Exports may omit these caches: graph evidence
remains self-contained and missing discovery indexes rebuild on the next maintenance
run. Graph envelope v2 and manifest v2 remain readable. Unknown reconciliation or
rebuild journal versions are refused without replacing the live graph.

Set `wikigraphreconcile=off` to stop future enrichment. It preserves already valid
evidence; restore the verified predecessor if you need the exact previous graph.
Graph snapshots and caches contain derived wiki information and inherit the wiki's
local access controls. Retained staging/index generations currently require operator
cleanup after confirming that no active run or retained recovery snapshot needs them.

## Connectivity and operational limits

Use `graph stats detailed=true`, Studio's **Inspect meaningful connectivity**, or:

```sh
ojob utils/graphStats.yaml file=/path/wiki/.mini-a-wiki-graph/graph.json detailed=true
```

Existing statistics fields remain unchanged. Additional diagnostics distinguish
actual indexed pages from placeholders, physical edges from meaningful neighbors,
generic features, navigation-only documents, isolated documents, components,
grounded coverage, provenance, stale/unverifiable evidence and pending work.
`IN_SECTION` does not improve meaningful connectivity. Components use incidence
union rather than a pair matrix. Distinct neighbor statistics have a visit budget;
exhaustion returns `partial`, null exact means/medians and explicit lower bounds.
Snapshot-only reports identify their authority as `snapshot`.

Current graph JSON saves, whole-wiki page inventory and some derived computations
still cost O(graph size). Staging also requires space for a replacement and a prior
snapshot. Large corpus processing is resumable and provider/comparison fan-out is
bounded; this does not make every ordinary publication sublinear or guarantee a
particular heap limit. A crash after provider execution but before a durable receipt
may repeat that ambiguous call; exactly-once external billing is not promised.

See [validation results](GRAPH-BUILDS-VALIDATION.md) for measured scope and remaining
live-backend/visual limitations.
