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
