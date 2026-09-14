# Retrieval v2 baseline (2026-09-14)

Starting checkout: `autonomy`, `b217b2aa2a9629aa279cda1c8d3443da12878038`.
Existing dirty file: `.package.yaml`; its unrelated edits are preserved.
Reference comparison used `git archive HEAD` extracted into
`/tmp/mini-a-v2-reference`; the working checkout was never reset.

Runtime: OpenAF 20260913, JVM 26.0.2, Lucene 10.5.0, lucene oPack
20260805, macOS. Fixtures use local temporary directories. No provider credentials,
model, deployment, publishing, or pruning of real content were used.

## Entry points and scope

- `mini-a.js` loads common, wiki, then knowledge through `loadLib`.
- `mini-a-dreams.js` loads wiki and knowledge before Mini-A. Its reindex mode
  calls the manager's existing writable `reindex` entry point.
- Ingestion loads both libraries, copies `global.__miniAWikiKnowledge.methods`
  onto a manager when absent, and closes only owned managers. This bridges
  constructors loaded into different OpenAF scopes.
- `mini-a-mcp-wiki.js` loads wiki and utils; standalone MCP jobs load this
  module. Loading knowledge in an interactive scope does not prove installation
  on that standalone constructor. Restricted search/read use a separate policy
  and opaque-reference presentation adapter.
- Skills MCP loads wiki MCP and skills; virtual skills reuse manager search,
  selected search, open and agentic read.
- Utils routes wiki operations to the active manager; console commands also
  construct managers. `search` uses the search-index seam and legacy mounts;
  `agenticSearch` uses `searchSelected` when a selector exists. `retrieve`
  previously failed to forward that selector. `assembleContext` is a separately
  installed knowledge method, using ingestion chunks rather than page passages.

### Required-surface trace

The trace covered the required implementation, transport, test, and guidance
surfaces. `mini-a-wiki.js` owns backend access, Lucene/scan search, mounts,
agentic read/grep/retrieve, and the legacy `assembleContext` placeholder.
`mini-a-wiki-knowledge.js` installs the legacy knowledge methods onto the
constructor prototype. `mini-a-wiki-retrieval.js` is the opt-in serving layer;
its constructor loads the knowledge extension and explicitly installs it on the
manager it receives. `mini-a-ingest.js` loads both base and knowledge modules,
and `mini-a-graph.js` supplies optional graph enrichment. `mini-a-dreams.js`
loads the same pair before `mini-a.js` and invokes writable manager operations.

Interactive Mini-A (`mini-a.js`, `mini-a.yaml`, and `mini-a-con.js`) constructs
the manager and routes the agent/console wiki tool through `MiniUtilsTool.wiki`.
The wiki MCP YAMLs load `mini-a-mcp-wiki.js`, which loads only common, wiki, and
utils modules before constructing its own manager. `mcp-wiki-safe.yaml` wraps
that route in its opaque-reference and disclosure policy; `mcp-wiki-ops.yaml`
uses the writable operations route. `mini-a-mcp-skills.js` loads the wiki MCP
bootstrap and `mini-a-skills.js`; `mcp-skills.yaml` and `mcp-skills-safe.yaml`
therefore reuse the same manager and safe-policy adapter rather than duplicate
retrieval. This distinction is why loading the knowledge module in an
interactive test is not proof that a standalone MCP constructor acquired it.

`tests/wiki*.js`, `tests/graph*.js`, and `tests/dreams*.js` exercise their own
explicit loading arrangements. `tests/wikiRetrievalContracts.js` covers the
legacy contracts, while `tests/wikiRetrievalV2.js` covers opt-in serving and
publication behavior. `docs/WIKI.md`, `docs/WIKI-INGEST-IMPLEMENTATION-PLAN.md`,
`docs/WIKI-INGEST-VALIDATION.md`, and `docs/VIRTUAL-SKILLS.md` were checked
against those dispatch paths and contracts.

## Findings

Confirmed by source inspection and/or fixtures:

- Read-only QueryParser hard-coded StandardAnalyzer despite language-specific
  index writes. Real English/Portuguese fixtures exercise the repair.
- Enhanced lexical search is channel-backed; ordinary queries already avoid a
  writer. Synonyms, expansion and extra fields remain unsupported by the bare
  reader path. Capability detection still inspects function source text.
- Healthy Lucene zero results fall through to listing/reading pages. Benchmark
  reproduces this using real Lucene and instrumented backend reads.
- knowledgeRank reads candidate bodies, replaces score and applies editorial
  recency. retrieve reads prefixes and advertises synthesis that does not run.
- assembleContext enumerates all source chunks for each hit and skips oversized
  candidates. Source chunks are not truthful wiki-page position evidence.
- Legacy mounts receive remaining capacity; selected search concatenates/slices.
- No-range continuations have incomplete line positions; section continuations
  escape their initial selection; oversized lines can lose text. Mounted reads
  return local identity. Final outline ranges add frontmatter offset twice.
- grep emits an offset it does not consume. backlinks reads the corpus.
- Query telemetry rewrites the knowledge manifest.
- Reindex can delete its usable index before a replacement succeeds.

Already functioning: ordinary Lucene queries do not acquire a writer;
scan fallback propagates a shared count/time state through legacy mounts;
ingestion retains complete-source reconstruction, protected pruning, ownership
checks, journals and pending suppression. These were retained.

### Assessment traceability

The following is the Phase 0 audit of every assessment observation. “Confirmed”
means the isolated `git archive HEAD` reference or its instrumented fixture
exhibited the stated behavior. The named current tests are regression evidence;
they do not change the historical baseline result.

| ID | Baseline result and affected path | Reproduction / current regression evidence |
| --- | --- | --- |
| a | Confirmed: the read-only QueryParser selected `StandardAnalyzer` despite configured language. | `tests/wikiRetrievalContracts.js:testIndexedLanguageAndTelemetry` indexes real English and Portuguese data. |
| b | Confirmed in the bare reader: configured enhanced lexical features did not reach that path; ordinary channel-backed search was distinct. | `tests/wikiRetrievalV2.js:testLegacyReadOnlyLexicalFeatures` and `testEnhancedPassageLexical`. |
| c | Confirmed: a healthy indexed zero result listed and read the corpus. | `tests/wikiRetrievalContracts.js:testContracts`; `tests/wikiRetrievalBenchmark.js`. |
| d | Confirmed: `knowledgeRank` read candidate bodies, replaced `score`, and added editorial recency. | `tests/wikiRetrievalV2.js:testLegacyReadOnlyLexicalFeatures`. |
| e | Confirmed: legacy `retrieve` used page prefixes instead of query-local passages. | `tests/wikiRetrievalV2.js:testRetrievalAndPublication`. |
| f | Confirmed: legacy `assembleContext` enumerated source chunks per matching page. | `tests/wikiRetrievalV2.js:testBoundedContextPostings`. |
| g | Confirmed: legacy packing could omit every oversized candidate. | `tests/wikiIngestReconcile.js:testLegacyContextProvenance`; `tests/wikiRetrievalV2.js:testStructuralContext`. |
| h | Confirmed: primary results consumed capacity before legacy mounts were searched. | `tests/wikiRetrievalV2.js:testFederationAndBudgets`. |
| i | Confirmed: `searchSelected` concatenated per-wiki results then sliced, without global relevance ranking. | `tests/wikiRetrievalV2.js:testFederationAndBudgets`. |
| j | Confirmed: `retrieve` dropped the selected wiki scope before its search. | `tests/wikiRetrievalContracts.js:testContracts`. |
| k | Confirmed: no-range and section reads could emit invalid cursor positions, lose large-line text, or leave a section. | `tests/wikiRetrievalContracts.js:testContracts`. |
| l | Confirmed: grep exposed a continuation offset that the next call ignored. | `tests/wikiRetrievalContracts.js:testContracts`. |
| m | Confirmed: delegated mounted reads returned a local path instead of a mount-qualified identity. | `tests/wikiRetrievalContracts.js:testContracts`; `tests/wikiRetrievalV2.js:testFederationAndBudgets`. |
| n | Confirmed: backlinks read every page. | `tests/wikiRetrievalV2.js:testDirectDerivedPostings`. |
| o | Confirmed: replacement indexing could remove the serving generation before validation and activation. | `tests/wikiRetrievalV2.js:testPublicationFailureRecovery`, `testInsufficientSpacePublicationRecovery`, and `testProcessCrashPublicationRecovery`. |
| p | Confirmed: query telemetry rewrote the knowledge-authority manifest. | `tests/wikiRetrievalContracts.js:testIndexedLanguageAndTelemetry`; `tests/wikiRetrievalV2.js:testTargetedTelemetryRetention`. |

No assessment observation was dismissed as unreproducible. The two distinctions
recorded above are deliberate: ordinary Lucene search already avoided a writer,
and its shared scan budget already crossed legacy mounts. Neither fact removes
the independently confirmed reader-feature, zero-result, and mount-ranking
problems.

## Baseline validation

`ojob tests/wiki.yaml`: 150 passing test functions, 7 failing.
`ojob tests/graph.yaml`: 14 passing, 0 failing.
`ojob tests/dreams.yaml`: 44 passing, 3 failing. Outer SUCCESS does not establish assertions passing.

Instrumented direct invocation of registered wiki job functions in the isolated
reference: 645 attempted assertions, 7 assertion failures, 151 successful
function invocations. This runner also invokes defined jobs absent from todo;
it is distinct from the oJob invocation count. JSON records include failure names.

Baseline failures: bootstrap index link, orphan lint, heading lint, MCP hierarchy
metadata, MCP lexical schema wording, search line numbers, drift guard. Dream
failures: model fallback, model override, semantic preview default.

The baseline run was made before behavior changes from the isolated archive. A
later source-checkout `ojob tests/wiki.yaml` invocation was used only to confirm
that the registered suite still launches; it is not substituted for the isolated
assertion count above. Current assertion records and their source hashes belong
in `WIKI-RETRIEVAL-V2-VALIDATION.md`, not in this historical baseline.

## Initial measured benchmark

`WIKI_BENCH_PAGES=100 WIKI_BENCH_SAMPLES=10 oaf -f tests/wikiRetrievalBenchmark.js`
Run the same script from the isolated baseline directory to compare its modules.

Indexed zero-result query, 100 pages, 10 warm samples:

| Metric | Baseline | Contract repairs |
|---|---:|---:|
| Cold ms | 64.02 | 26.36 |
| Warm p50 ms | 36.14 | 3.97 |
| Warm p95/p99 ms | 49.40 | 5.95 |
| Cold Markdown reads | 100 | 0 |
| Warm total Markdown reads | 1000 | 0 |
| Warm Markdown bytes | 62800 | 0 |
| End-run JVM used heap bytes | 38616576 | 66887944 |

Heap snapshots are GC-sensitive, not retained-memory or leak measurements.
The comparison is a microbenchmark, not a passage-quality evaluation. No
1000/10000-page, provider, concurrent-reader or full-publication claim is made.
Machine-readable records live under `tests/fixtures/wiki-retrieval-v2/`.
