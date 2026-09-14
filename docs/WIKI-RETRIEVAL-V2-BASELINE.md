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
