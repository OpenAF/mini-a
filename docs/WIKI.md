# Mini-A wiki guide

Mini-A's wiki is a Markdown knowledge base shared by agent sessions, the console, and the `mcp-wiki` servers. Enable it with `usewiki=true`; `/wiki context` is the quickest way to inspect its access mode and available retrieval features.

## Backends and access

| Backend | Configuration | Read/write | Notes |
| --- | --- | --- | --- |
| `fs` | `wikiroot=/path/to/wiki` | `ro` or `rw` | Default local Markdown directory. A `.zip` or `.okt` root is always read-only. |
| `s3` | `wikibucket`, `wikiprefix`, `wikiurl` | `ro` or `rw` | Native object listing supplies the page catalog. |
| `s3fs` | S3 settings plus `wikiroot` | `ro` or `rw` | Local filesystem cache backed by S3. |
| `es` | `wikiurl`, `wikiprefix` | `ro` or `rw` | Elasticsearch/OpenSearch; `wikiprefix` is the index name. |
| `http` | `wikiurl=https://docs.example/wiki` | always `ro` | Static HTTP(S) page server. `https` is an accepted backend alias. |

`wikiaccess=ro` never builds or updates indexes. `wikiaccess=rw` permits page edits, reindexing, and graph generation where the backend supports writes. HTTP and archive roots force read-only access even when `rw` is requested.

## Core operations

The console supports `/wiki list`, `read`, `search`, `write`, `delete`, `move`, `tree`, `browse`, `backlinks`, `lint`, `reindex`, and `graph`. The same operations are exposed to agents through the wiki tool. Paths are wiki-relative Markdown paths such as `guides/setup.md`; traversal outside the wiki is rejected.

Use `tree` and `browse` for hierarchy, `backlinks` before moving a page, and `lint` before publishing structural changes. `mcp-wiki.yaml` exposes the read-oriented MCP surface; `mcp-wiki-safe.yaml` adds bounded, opaque-reference retrieval for untrusted clients. Mounts (`wikimounts`) attach other read-only wiki configurations under `@name/`.

All three MCP servers (`mcp-wiki.yaml`, `mcp-wiki-safe.yaml`, `mcp-wiki-ops.yaml`) accept `audit=true` (or `OJOB_MCP_AUDIT`) to log every tool call. For `s3`, `http`, and `es` backends this also logs each page actually fetched — backend, resolved location (`s3://bucket/key`, the joined URL, or `es:index/path`), and byte count — including internal fetches made while serving `search`, `lint`, `list`, or `reindex`, not just the top-level tool call. Local `fs` reads are not covered. `mcp-wiki-safe.yaml` only ever logs the resolved location, never the opaque reference exposed to restricted-mode callers.

## Operational and maintenance modes

Beyond interactive `/wiki` commands, maintenance work can also run unattended via
`mini-a dream=true usewiki=true dreamwikimode=<mode>` — this is the only supported batch/non-interactive
entry point for wiki maintenance. Built-in console commands like `/wiki reindex` are interactive-only:
`exec="/wiki reindex"` is rejected (`exec=` only supports custom commands/skills, not built-ins).

| Operation | Console command | Agent tool op | Batch (`dream=true`) |
| --- | --- | --- | --- |
| Rebuild search index | `/wiki reindex` | `reindex` | `dreamwikimode=reindex` |
| Rebuild knowledge graph | `/graph build` (if `usewikigraph`) | `graph` op `build` | `dreamwikimode=graph` |
| Regenerate index.md pages | — | — | `dreamwikimode=indexes` |
| Fix lint issues (links, indexes, headings) | `/wiki lint` (report only) | `lint` | `dreamwikimode=repair` |
| Full deterministic pass | — | — | `dreamwikimode=apply` (default) |
| Structural reorg (LLM agent) | — | — | `dreamwikimode=reorg` (requires `dreamwikireorg=true`) |
| Dry-run proposal | — | — | `dreamwikimode=plan` |

`repair`, `reindex`, `graph`, and `indexes` are the isolated building blocks that `apply` composes: `repair`
fixes lint-flagged issues only; `reindex` rebuilds only the Lucene search index; `graph` rebuilds only the
`usewikigraph` knowledge graph; `indexes` unconditionally regenerates every section/root `index.md` from
current structure. Run them individually — e.g. a cheap nightly `reindex`, a separate weekly `graph` pass —
or let `apply` run all of them together. None of these four modes call an LLM. `reindex`/`graph`/`indexes`
all require a `wikiaccess=rw`-capable backend (archive/http roots stay read-only regardless).

```sh
# Nightly search reindex only
mini-a dream=true usewiki=true wikiroot=/shared/wiki dreamwikimode=reindex

# Weekly knowledge-graph rebuild only
mini-a dream=true usewiki=true usewikigraph=true wikiroot=/shared/wiki dreamwikimode=graph
```

See [`USAGE.md`](../USAGE.md#dreams-sleep-pass) for the full dream-mode reference (gating rules, all
`dreamwikimode` values, the `/dream` console table, and complete standalone examples).

## Search and graph state

Writable wikis maintain a Lucene index in `.mini-a-wiki-lucene/` and can maintain graph data in `.mini-a-wiki-graph/`. The index powers lexical search; graph state powers backlinks, community information, and optional related-page search hints. `wikilexical` selects language and optional explicit enhancements. Lucene-backed search results also carry a numeric `score` field (Lucene's native relevance score); results served from the scan fallback (no index available) omit it.

Read-only wikis consume an existing Lucene index without taking a writer lock. If no index is available, local backends can fall back to scanning page contents. Static HTTP has no directory listing, so it requires the published artifact bundle described below for catalog and search.

## Publishing a static HTTP wiki

Publish the Markdown pages at the same relative paths used by the wiki, then publish `mini-a-wiki-index.zip` at the static root (or specify `wikihttpindexurl`). The zip must contain the complete generated paths:

```
.mini-a-wiki-lucene/
.mini-a-wiki-graph/graph.json
```

The Lucene directory must be copied as binary files; do not convert segment files through a text encoder. Mini-A downloads and atomically installs the bundle into its local `wikiindexdir` cache. Page reads remain live HTTP GET requests, while `list`, search, tree, and browse use the catalog stored in Lucene. Consequently, pages excluded from indexing are not visible in an HTTP catalog.

Set `wikihttptimeout` (milliseconds, default `30000`) for HTTP request timeouts. Set `wikiaccesskey` plus `wikisecret` for Basic authentication, or only `wikisecret` for Bearer authentication. If unset, `wikisecret` may come from `OAF_MINI_A_WIKI_SECRET`.

At process startup Mini-A compares HTTP `ETag` or `Last-Modified` metadata with the local bundle sidecar and only downloads a changed bundle. Set `wikiartifactrefreshsecs` to a positive number to repeat that metadata check at most once per interval between wiki requests; a changed bundle is atomically installed and the local Lucene/graph readers reopen. The default `0` retains startup-only hydration.

## S3 artifact bundles

S3 continues to support `wikis3artifactprefix` containing individual Lucene and graph objects. Set `s3artifactbundle=true` to instead consume one `<wikis3artifactprefix>/mini-a-wiki-index.zip`. Mini-A checks S3 object metadata before downloading it, making this useful for read-only consumers with many Lucene segment files. `wikiartifactrefreshsecs` also supports this bundle form; individual artifact trees remain startup-only to avoid mixing Lucene generations. S3 itself still uses native object listing for page catalogs.

## Search scan budget, read cache, and parallel scan

`wiki search` normally answers from the Lucene index (no per-page backend reads). It falls back to scanning pages one at a time whenever `forceScan` is set, `regex` is used, a scoped `path` is given, or no usable index exists — and that scan reads every candidate page via `backend.read()` until it finds enough matches or runs out of pages. For a local filesystem that's cheap; for `s3` or `http` backends each read is a network round-trip, individually capped by `wikihttptimeout` but with no cap on the total number of reads a rare-match query might trigger.

Two settings bound that cost, and apply across a search **and** its mount fan-out as one shared budget, not one per mount:
- `wikisearchscanbudget` (default `1000`): max pages scanned.
- `wikisearchscanmaxms` (default `15000`): max wall-clock milliseconds spent scanning.

When either limit is hit, the search returns early with whatever it already found. Direct JS callers (the `MiniAWikiManager` API, not the serialized MCP tool text) can check `.truncated === true`, `.scanned`, and `.scanBudget` on the returned array to detect a short-stopped search; the MCP `wiki search`/`grep` tool appends a `[NOTE]` line to its text output when this happens.

Scan-fallback reads are also cached per `MiniAWikiManager` instance (`wikisearchcache`, default `true` for `s3`/`http`/`es` backends and `false` for `fs`/archive, TTL `wikisearchcachettlms`, default `15000`ms, capped to `wikisearchcachemaxsize` entries, default `500`), so repeated searches against a slow backend don't keep re-fetching unchanged pages; `fs`/archive default to uncached since a local read has no latency to amortize. `write()` and `delete()` invalidate the whole per-instance cache (not a per-page unset — OpenAF's `$cache` per-key `.set()`/`.unset()` do not reliably invalidate its own `.get()` state, confirmed empirically), so neither is served stale within the TTL window.

`wikisearchparallel` (default `false`, opt-in) parallelizes the scan-fallback path's `backend.read()` calls via OpenAF's `pForEach`. **Read this before enabling it in a long-lived process:** an earlier, unrelated `pForEach`-based read path in the wiki manager (the shared read pass behind `reindex()`) deadlocked OpenAF's shared thread pool, reproducing only on the *second* consecutive full test-suite run within the same JVM — a `jstack` capture showed a worker thread from an earlier `pForEach` batch that never returned, permanently occupying a pool slot and starving a later, unrelated call. That incident's root cause was never conclusively isolated, and a companion investigation found the literal explanation in the original code comment ("blocked on the same pool") doesn't cleanly match the runtime, since the specific call implicated actually runs on a separate virtual-thread executor. A fix to `pForEach` itself is proposed upstream (see the `openaf` project's `PFOREACH_PLAN.md`), but until that lands, `wikisearchparallel` should be treated as carrying the same class of unconfirmed risk. If you enable it, validate with two consecutive full `ojob tests/wiki.yaml` runs in one JVM process before trusting it in production.

## Examples

```sh
# Local writable wiki
mini-a usewiki=true wikiaccess=rw wikibackend=fs wikiroot=./wiki

# Static read-only wiki
mini-a usewiki=true wikibackend=http \
  wikiurl=https://docs.example/wiki wikiindexdir=/var/cache/mini-a/wiki

# Static wiki with a bearer token kept out of command history
export OAF_MINI_A_WIKI_SECRET='...'
mini-a usewiki=true wikibackend=http wikiurl=https://docs.example/wiki

# S3 read-only consumer using a single artifact bundle
mini-a usewiki=true wikiaccess=ro wikibackend=s3 wikibucket=team-wiki \
  wikis3artifactprefix=published/ s3artifactbundle=true
```
