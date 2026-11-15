# Graph build implementation validation

Validated on 2026-11-06 from the Mini-A checkout and sibling OpenAF source.
These checks cover both delivery stages: deterministic connections and controls,
then bounded enrichment, resume, inference and dream tag safeguards.

## Repeatable checks

| Command | Result |
| --- | --- |
| `oaf -f tests/graphBuild.js` | 61 assertions passed |
| `oaf -f tests/graphParity.js` | 14 parity assertions plus existing OpenAF graph channel suites passed |
| `ojob tests/graph.yaml` | 22 passed |
| `ojob tests/wiki.yaml` | 260 passed, including retrieval V2 |
| `ojob tests/wikiCross.yaml` | 13 passed |
| `ojob tests/wikiManager.yaml` | 22 passed |
| `ojob tests/wikiStudio.yaml` | 15 passed |
| `ojob tests/dreams.yaml` | 75 passed |
| `ojob tests/miniAUtils.yaml` | 56 passed |
| `ojob tests/wikiUtilsJobs.yaml` | 9 passed |
| `node tests/wikiStudioUI.cjs` | Passed, including settings and visible progress counters |
| `node tests/wikiStudioRequests.cjs` | Passed |
| `python3 tests/wikiGraph.py` | 4 passed |
| `node tests/modulePaths.cjs` and `python3 tests/modulePaths.py` | Passed |

Build acceptance uses deterministic model stubs. It covers zero-call structural and
model-off execution, restart/resume, forced and full builds, budgets, cancellation,
source/dependency/model fingerprint invalidation, empty results, malformed evidence,
failure preservation, LC fallback, decision calls, ambiguity, late evidence, tags,
and traversal filters. Manager and Studio checks cover shared persisted preferences,
run overrides, replay, read-only restrictions and absence of Markdown writes by builds.

The OpenAF fixture explicitly loads the modified `js/owrap.ch.js`; it verifies file
and channel-backed storage, metadata preservation, traversal and incremental deletion.
The installed OpenAF JAR was not rebuilt or replaced, and the complete OpenAF suite
was not run. Packaged Mini-A compiled artifacts affected by these changes were refreshed.

## Fixed retrieval benchmark

`oaf -f tests/graphConnectionBenchmark.js` uses the checked-in
`tests/fixtures/graph-connections/benchmark.json`: 1,030 synthetic technical pages,
five graph-dependent queries and five exact-title control queries. Its baseline
freezes the former document-metadata graph retrieval behavior.

| Metric | Baseline | Enhanced |
| --- | ---: | ---: |
| Graph-dependent Recall@10 | 0.1667 | 1.0000 |
| Overall Precision@10 | 0.1000 | 0.3500 |

Relative Recall@10 improvement is 500%, exceeding the 10% requirement. Precision
improves by 25 percentage points, within the allowed 2-point regression bound.
Maximum retrieval work is eight inspected edges against a 256-edge limit. Enrichment
uses three stub calls and 7,062 estimated tokens; 1,027 pages remain pending when the
three-call budget stops scheduling. The pending result is expected and resumable.

This is synthetic acceptance evidence, not a quality measurement on a production wiki.
It does not establish performance or relevance for an arbitrary real corpus.

## Bounded live checks

A separate provider check used one synthetic page containing
`TLS protects HTTP traffic. HTTP uses TCP.` and a budget of one call, 5,000 estimated
tokens and one minute. The LC call completed in 1,059 ms, used 2,167 estimated tokens,
returned two grounded relationships, and left zero failed or pending pages. These are
local estimates, not billed token counts. Live main-model fallback, live decision
classification and a full live dream reorganization were not exercised; stubs cover
their relevant orchestration and safeguards.

`MINIA_GRAPH_TEST_PORT=<port> oaf -f tests/graphFalkorLive.js` passed nine assertions
against a disposable loopback-only FalkorDB container. It forces remote reload by
removing the fixture's local snapshot, then checks evidence, canonical concept
properties, checkpoints and deletion that preserves another page's support.
Tested image ID: `sha256:3569494cde481051a4bc1d6b773511a08a458e9300f5d14c914929530cf279d2`.
The test container was removed afterward; existing services were not restarted.

Studio UI verification uses the DOM harness and server operation fixtures, rather
than a visual session against a deployed Studio. No production wiki was reorganized
and no installed Mini-A service was deployed or restarted.

## Wiki Graph v2 validation — 2026-11-15

The opt-in reconciliation and staged upgrade implementation is described in
[Wiki Graph v2](WIKI-GRAPH-V2.md). These are local checkout results on installed
OpenAF `20261114`; they do not establish production-corpus quality or hosted CI.

| Check | Result |
| --- | --- |
| `ojob tests/graph.yaml` | 23 jobs passed, including the new reconciliation harness |
| `oaf -f tests/graphReconcile.js` | 63 assertions: cross-batch grounding, no-op writes/calls, edit/delete invalidation, sparse diagnostics, bounded restart, pair validation, cache reuse, provider failures, retries, ingestion transaction boundaries and remote publication |
| `python3 tests/graphUpgradeRecovery.py` | Six abrupt JVM exits recovered at structure, graph, ready, atomic replacement, post-publication and durable validation-receipt boundaries; completed pair validation was not called again |
| `oaf -f tests/graphBuild.js` | 151 existing build-contract assertions passed |
| `ojob tests/wiki.yaml` | Existing wiki, retrieval, embedding-cache and full-rebuild suite passed |
| `ojob tests/wikiIngest.yaml` | 107 jobs passed |
| `ojob tests/wikiManager.yaml` | 33 jobs passed |
| `ojob tests/wikiStudio.yaml` | 27 jobs passed |
| `ojob tests/wikiUtilsJobs.yaml` | Nine jobs passed |
| `python3 tests/wikiStudioHttp.py` | 271 HTTP assertions, including new preview/upgrade/reconcile/detailed-stat routes and real isolated workers |
| `node tests/wikiStudioUI.cjs`, `node tests/wikiStudioRequests.cjs` | Passed |
| `node tests/embeddingStats.cjs` | Passed |
| `node tests/modulePaths.cjs`, `python3 tests/modulePaths.py` | Passed, including copied packages and unrelated working directories |
| `python3 tests/wikiStudioPackage.py` | Explicit 254-file manifest, generated oPack, extracted layout and real-worker workflow passed |
| `oaf -f tests/graphParity.js` | 14 assertions and existing OpenAF graph channel tests passed |
| `ojob tests/graphLift.yaml`, `python3 tests/wikiGraph.py` | Passed |
| `MINIA_GRAPH_TEST_PORT=... oaf -f tests/graphFalkorLive.js` | 15 assertions passed against a disposable loopback-only FalkorDB container, including staged publication and metadata/evidence round trips |

The real Ollama smoke test used the user's configured `embeddinggemma-2`: two
cold embedding calls, then zero provider calls on the unchanged warm run. One
explicit pair-validation call through the configured Ollama LC model produced two
independently grounded memberships. No model configuration or installed runtime
was changed. Network sandbox failures were retried with permission; failures
continued to leave deterministic operation available.

The production V2 held-out fixture (six queries, including one abstention) scored
Recall@K **1.0**, MRR **1.0**, and one correct abstention both with graph disabled
and with lexical reconciliation. This is a small compatibility check, not broad
quality evidence. Query-time retrieval still performs no provider calls.

`oaf -f tests/graphReconcileBenchmark.js` exercised six configurations at 100, 1000
and 10000 pages: lexical document matching, structural graph, existing semantic
graph, reconciled lexical, simulated hybrid, and simulated pair validation. The
frozen synthetic graph-dependent queries scored Recall@10 **0.167** for lexical/
structural and **1.0** for existing semantic and all reconciled variants, with MRR
**1.0** throughout. Reconciled variants created 42 supported memberships and zero
false-positive memberships on this fixture. Simulated hybrid/validation provided
no additional quality gain; this does not measure real embedding/LLM quality.

| Pages | Reconciled lexical build | Unchanged repeat | Processing rounds | Graph JSON bytes | Total derived bytes | Query p50 / p95 |
| --- | --- | --- | --- | --- | --- | --- |
| 100 | 214 ms | 33 ms | 1 | 174672 | 238613 | 0.50 / 7.60 ms |
| 1000 | 789 ms | 121 ms | 1 | 1397136 | 1757342 | 0.91 / 55.25 ms |
| 10000 | 49184 ms | 1043 ms | 19 | 15608410 | 33447167 | 7.98 / 638.17 ms |

Runs used 1000 pages per invocation and two-minute CPU limits. Times are single
local measurements, not service-level promises. A common-title-prefix case exposed
an excessive vocabulary dependency expansion; lookups are now bounded like the
existing mention scanner. Hybrid performed 162 total dot products and 30 mock
provider calls at 10000 pages, with zero warm provider calls. The recorded JVM
used-heap samples varied substantially across sequential modes (including a
1.36 GB sample for the 10000-page lexical reconciliation run); they are neither
peak heap nor isolated per-mode overhead. Query timings include the first lazy
index load and have only five samples per configuration. The separate 10000-page
identical-title fixture completed in 3055 ms with 10000 components and zero
meaningful neighbors. Simulated validation used six calls and 6837 estimated
tokens at 10000 pages; mock embeddings do not report token usage. Whole-JSON saves and whole-wiki inventory
remain scaling costs. The optional 100000-passage/ANN benchmark was not run; ANN
is deferred rather than introduced as a dependency.

Browser checks used a disposable served wiki: Advanced controls started collapsed,
saved lexical defaults, ran deterministic reconciliation (two memberships, zero
provider calls), and produced a provider-free upgrade preview with connectivity
and publication estimates. The dark layout and 390-pixel viewport were inspected,
including keyboard-visible focus. Light-theme emulation and an interactive terminal
were not exercised; console workflows have manager/adapter tests. The temporary
Studio server and FalkorDB container were stopped after validation.
