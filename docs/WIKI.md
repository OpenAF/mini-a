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

## Agentic retrieval

The agent-facing retrieval layer is a small, incremental protocol layered on the existing Lucene index, scan fallback, hierarchy, mounts, backends, backlinks, and optional graph. It does not create another index or document store. Its purpose is to keep irrelevant Markdown out of model context.

1. `search(query)` finds a small set of candidates. It returns metadata, a `wiki:path` reference, and the native Lucene `score` when Lucene supplied one; scan fallback deliberately does not invent a score.
2. `open(path|ref)` returns cheap structure: front matter, title/description, byte size, links, headings, and deterministic line ranges. It never returns the Markdown body.
3. `navigate(path|ref, section=...)` browses a directory through existing hierarchy logic, or describes a heading's parent, children, adjacent headings, and ranges.
4. `read(path|ref, section|startLine/endLine)` returns the selected evidence. Agent reads default to a bounded character chunk and report `truncated` plus a deterministic `next.startLine` continuation instead of silently flooding context.
5. `grep(path|ref, pattern)` searches one known page or directory and returns bounded matching lines with a little context.

`related(path|ref)` is optional follow-up discovery: it preserves backlinks and uses graph neighbors only when graph state is available. It is useful after lexical retrieval leaves a real gap, not as a mandatory first step. `mcp-wiki-safe.yaml` remains intentionally restricted to its opaque, budgeted search/read contract and does not expose structural enumeration.

An agent should normally iterate, rather than follow a rigid pipeline:

```text
Question: Why can OpenAF memory increase during heavy processing?
search("OpenAF memory increase")
  -> open("troubleshooting/memory.md")
  -> navigate("troubleshooting/memory.md", section="Heap pressure")
  -> read("troubleshooting/memory.md", section="Heap pressure")
  -> grep("troubleshooting/memory.md", "GC")
  -> open("runtime/garbage-collection.md")
  -> read("runtime/garbage-collection.md", section="Heap sizing")
  -> answer from the collected evidence
```

Do not read every search hit, retrieve whole long documents merely because they matched, or keep issuing broad searches after a promising page is open. Prefer `grep` for exact configuration names, identifiers, and errors; use `related` only if normal lexical and structural evidence is insufficient. In debug/verbose mode the manager logs retrieval metadata (engine, result count/top score, section and character count, and grep match count) without logging page contents.

## Citation URLs

`wikisourceurl` is an optional Handlebars template that renders a page's canonical origin
URL (a published docs site, a GitHub blob URL, whatever the wiki's real home is) onto
retrieval results, so an agent can cite where an answer came from. It is off by default.
When set, `search`, `read`, `open`, `grep`, and `related` results carry the rendered URL in
a `sourceUrl` field (rename it with `wikisourcefield`), and the MCP tool descriptions gain
a sentence telling the model to cite it. `list`, `tree`, `browse`, `backlinks`, and
`context` are navigation aids, not retrieval evidence, and never carry it.

Available template variables: `path`, `pathNoExt` (path without its extension),
`encodedPath` (every segment percent-encoded), `backend`, `root`, `bucket`, `prefix`,
`url` (the backend's own endpoint config, not the rendered result), `mount` (the mount
name, for `@name/`-prefixed pages), `section`, `anchor`, and `title`. Handlebars is the
same engine used for MCP tool-description templating (`ow.template`); mini-a registers
`ow.template.addOpenAFHelpers()` and `ow.template.addConditionalHelpers()` for it (see
`ow.template`'s own `odoc` for the full helper list — `$eq`/`$startsWith`/`$compare`/etc.
from the conditional set (Handlebars' own built-in `{{#if}}` still applies as usual),
`$toJSON`/`$date`/etc. from the OpenAF set), plus three helpers just
for URL building: `$encodeURI`, `$encodeURIComponent`, and `$encodePath` (per-segment
percent-encoding that keeps `/` as a separator).

**Use `{{$encodePath pathNoExt}}`, not `{{{pathNoExt}}}`.** Handlebars HTML-escapes
`{{x}}` by default (so a path containing `&` breaks unless you triple-brace it), and
neither form percent-encodes — a path containing a space produces a broken URL either way.
`{{$encodePath ...}}` percent-encodes first, which leaves nothing for Handlebars to escape
and handles spaces correctly, so it is the recommended default over triple-brace escaping:

```
wikisourceurl="https://docs.example.com/{{$encodePath pathNoExt}}"
```

A `wikimounts` entry may set its own `wikisourceurl`; a mounted page then cites its own
wiki's URL space instead of the parent's. A mount without one simply carries no citation
URL for its pages — deliberately, since guessing a local URL for a page that actually
lives elsewhere would be a confidently wrong citation.

`wikisourceinline` (default `false`) additionally appends `[sourceUrl: <url>]` (or your
renamed field) into search results' `description`/`summary` text. Capable models cite from
the `sourceUrl` field and the tool-description instruction alone; smaller local models
often attend to text more reliably than to a sibling JSON key, so `wikisourceinline` is the
lever for those deployments — at the cost of a few dozen extra characters per result.

`wikisourceurl` is never applied under `mcp-wiki-safe.yaml`'s restricted retrieval: that
server's whole contract is opaque, budgeted references that hide the real page path, and a
citation URL necessarily embeds it. `mcp-wiki-safe.yaml` does not accept `wikisourceurl` at
all.

## Console command reference

### `/wiki [op] [args]`

| Op | Functionality | Equivalent to / overlaps |
| --- | --- | --- |
| `context` | Overview: page count, sections, mounts, recent activity | Superset of `mounts` (also lists mounts, with less detail) |
| `list [prefix] [--meta]` | List pages; `--meta` adds title/description per page | |
| `tree` | Hierarchical view with per-section index status | Coarser-grained view of the same structure as `browse` |
| `browse` | One level of a path: child sections, direct pages, suggested next reads | |
| `read <path>` | Print a page's body | |
| `search <query>` | Full-text search (Lucene, falls back to scan) | |
| `backlinks <path>` | Pages linking to a page | Run before `move`/`delete` to see what would break |
| `lint` | Report-only consistency checks (broken links, missing/stale indexes, heading issues) | Read-only counterpart of `dreamwikimode=repair`, which applies the same checks' fixes |
| `write <path> [content]` *(rw)* | Create/update a page | |
| `move <from> <to>` *(rw)*, alias `mv` | Rename/move a page and rewrite inbound links | |
| `delete <path>` *(rw)*, aliases `remove`, `rm` | Delete a page | |
| `init` *(rw)* | Scaffold the initial wiki structure (`AGENTS.md`, root `index.md`) | |
| `reindex` *(rw)* | Rebuild the Lucene search index | Same call as `dreamwikimode=reindex`; also runs as one step of `dreamwikimode=apply` |
| `mounts` | List attached external wikis | Subset of `context` |
| `attach <name> [backend=] [root=] ...` | Attach a read-only external wiki under `@name/` | |
| `detach <name>` | Remove a mount | |

### `/graph [op] [args]` (requires `usewikigraph=true`)

| Op | Functionality | Equivalent to / overlaps |
| --- | --- | --- |
| `build [semantic=true]` *(rw)* | Build/refresh the structural (+ semantic) graph | Same call as `dreamwikimode=graph`; also runs as the last step of `dreamwikimode=apply` |
| `report` *(rw)* | Save a graph report to disk | |
| `query <text>` | Keyword search over all graph nodes (documents and concepts) | Base operation `retrieve` and `answer` are built on |
| `retrieve <query>` | `query()` filtered to document-page nodes, with summaries, capped to a few results | Thin wrapper over `query` |
| `answer <question>` | Same as `retrieve`, phrased as a question | Wraps `retrieve` — despite the name, it does **not** call an LLM; no synthesis happens |
| `neighbors <node>` | Edges touching a node | |
| `path <from> <to>` | Shortest path between two nodes | |
| `communities` | Cluster detection (`wikigraphcommunity`, default Louvain) | |
| `surprise` | Cross-document "surprising" connections | |
| `export [format]` | Export the graph (`mermaid` default, `graphml`, `neo4j`, `html`, `svg`) | |
| `stats` | Node/edge counts summary | |
| `falkor [cypher]` *(rw for sync)* | Sync the graph to, or run a Cypher query against, an external FalkorDB (`wikigraphfalkor`) | |
| `cross <path>` | Join this wiki's graph with mounted wikis' graphs at query time: explicit `@name/` links, plus shared `tag:`/`alias:`/`concept:` keys | See "Cross-wiki graph connections" below |

### `/dream [memory|wiki|mode] [dryrun]`

| Mode | Functionality | Equivalent to / overlaps |
| --- | --- | --- |
| *(no args)* | Runs the memory dream (if `memorych` is set) **and** the wiki dream in `apply` mode (if `usewiki` is set) | |
| `memory` | Consolidate/prune the memory channel only | |
| `wiki` | Run the wiki dream only, effective mode defaults to `apply` | Functionally identical to `dream apply` — same code path, both skip the memory dream |
| `plan` | Dry-run: builds a proposal (index creates/updates, repair candidates, graph preview) without writing anything | |
| `apply` *(default effective mode)* | Deterministic composite pass: `AGENTS.md` upgrade + repair loop + reindex + graph rebuild + index regeneration | Composes `repair` + `reindex` + `graph` + `indexes` |
| `reorg` | Full LLM-agent structural reorg (move/merge/delete pages) | Gated by `dreamwikireorg=true` and `dreamwikiapproval` |
| `repair` | Deterministic lint-fix loop only | Same lint rules as `/wiki lint`, but applies fixes instead of just reporting |
| `reindex` | Search-index rebuild only | Same call as `/wiki reindex` |
| `graph` | Knowledge-graph rebuild only | Same call as `/graph build` |
| `indexes` | Unconditional `index.md` regeneration for every directory | Broader than the `missing_index`/`stale_index` fixes `repair` applies |
| `dryrun` | Modifier flag, not a mode on its own — combine with another mode, e.g. `/dream apply dryrun` | |

## Operational and maintenance modes

Beyond interactive `/wiki` commands, maintenance work can also run unattended via
`mini-a dream=true usewiki=true dreamwikimode=<mode>` — this is the only supported batch/non-interactive
entry point for wiki maintenance. Built-in console commands like `/wiki reindex` are interactive-only:
`exec="/wiki reindex"` is rejected (`exec=` only supports custom commands/skills, not built-ins).

| Operation | Console command | Agent tool op | Batch (`dream=true`) | Uses LLM? |
| --- | --- | --- | --- | --- |
| Rebuild search index | `/wiki reindex` | `reindex` | `dreamwikimode=reindex` | No |
| Rebuild knowledge graph | `/graph build` (if `usewikigraph`) | `graph` op `build` | `dreamwikimode=graph` | No (Yes if `wikigraphsemantic=true`) |
| Regenerate index.md pages | — | — | `dreamwikimode=indexes` | No |
| Fix lint issues (links, indexes, headings) | `/wiki lint` (report only) | `lint` | `dreamwikimode=repair` | No |
| Full deterministic pass | — | — | `dreamwikimode=apply` (default) | Yes if `usewikigraph=true` (defaults `wikigraphsemantic=true`; pass `wikigraphsemantic=false` to opt out) — otherwise No |
| Structural reorg (LLM agent) | — | — | `dreamwikimode=reorg` (requires `dreamwikireorg=true`) | Yes |
| Dry-run proposal | — | — | `dreamwikimode=plan` | Preview only if `usewikigraph=true` — computes (but never persists) the same semantic stats `apply` would write; otherwise No |

`repair`, `reindex`, `graph`, and `indexes` are the isolated building blocks that `apply` composes: `repair`
fixes lint-flagged issues only; `reindex` rebuilds only the Lucene search index; `graph` rebuilds only the
`usewikigraph` knowledge graph; `indexes` unconditionally regenerates every section/root `index.md` from
current structure. Run them individually — e.g. a cheap nightly `reindex`, a separate weekly `graph` pass —
or let `apply` run all of them together. None of these four modes call an LLM by default. `reindex`/`graph`/`indexes`
all require a `wikiaccess=rw`-capable backend (archive/http roots stay read-only regardless).

```sh
# Nightly search reindex only
mini-a dream=true usewiki=true wikiroot=/shared/wiki dreamwikimode=reindex

# Weekly knowledge-graph rebuild only
mini-a dream=true usewiki=true usewikigraph=true wikiroot=/shared/wiki dreamwikimode=graph
```

See [`USAGE.md`](../USAGE.md#dreams-sleep-pass) for the full dream-mode reference (gating rules, all
`dreamwikimode` values, the `/dream` console table, and complete standalone examples).

### What each operation affects

| Operation | Reads | Writes / rebuilds | Leaves untouched |
| --- | --- | --- | --- |
| `reindex` | Every page's raw content | `.mini-a-wiki-lucene/` search index; also refreshes `MiniAWikiManager`'s lightweight internal graph-hint index used for related-page search hints | Page content, `index.md` files, lint issues, `.mini-a-wiki-graph/graph.json` |
| `graph` | Every page's raw content, plus the existing `.mini-a-wiki-graph/graph.json` (to preserve prior LLM-derived edges across structural rebuilds) | `.mini-a-wiki-graph/graph.json` — document/concept nodes, structural edges, communities; also adds/refreshes LLM-derived semantic edges when `wikigraphsemantic=true` | Lucene search index, page content, `index.md` files |
| `indexes` | Current page tree | Every section/root `index.md` — content is regenerated from live directory structure, independent of what lint flags | Lucene search index, `.mini-a-wiki-graph/graph.json`, non-index page content |
| `repair` | `lint()` findings | Only the pages lint flagged: broken-link targets get corrected, missing/stale index links get added, heading-hierarchy violations get fixed | Lucene search index, `.mini-a-wiki-graph/graph.json`, pages lint didn't flag |
| `apply` (default) | Everything above | `repair`'s page-level fixes, then the deterministic finalize pass: full `index.md` regeneration, `reindex()`, and — when `usewikigraph=true` — a `graph build` that now defaults `wikigraphsemantic=true` (an explicit `wikigraphsemantic=false` still opts back out) | Nothing structural — `apply` never moves, merges, or deletes pages |
| `reorg` | A full read/write agent loop over the whole wiki (hierarchy, backlinks, lint, near-duplicates) | Any page it moves, merges, deletes, or corrects, then the same finalize pass as `apply` — but `wikigraphsemantic` stays opt-in here (defaulting the finalize pass's semantic edges is only done for `apply`/`plan`, not the already-LLM-driven `reorg`) | Nothing — this is the only mode that performs structural moves/merges/deletes |
| `plan` | Same reads as `repair` plus a graph preview when `usewikigraph=true` | Nothing on disk — dry-run only. The returned proposal now includes a graph preview (structural stats, and semantic stats when `wikigraphsemantic` would default/resolve to `true`) computed in memory and discarded; `graph.json` is never written | All wiki state, including `graph.json` and the Lucene index |

`wikigraphsemantic` (default `false`) gates the one LLM-touching part of graph rebuilds — extracting cross-page
concept relationships via an LLM call per changed page. It stays strictly opt-in for `graph` and `reorg`. For
`apply` and `plan`, it now defaults to `true` whenever `usewikigraph=true` (pass `wikigraphsemantic=false`
explicitly to keep those two modes structural-only). This applies uniformly whether you invoke `apply`/`plan`
from the CLI (`mini-a dream=true ...`) or from an interactive console's `/dream apply`/`/dream plan`. Note that
`plan`'s preview still makes the real LLM calls to compute what it would extract — only the write to
`graph.json` is skipped — so a `usewikigraph=true` plan run costs the same LLM calls as the `apply` run it's
previewing.

The dream pass resolves its own LLM the same way `model=`/`OAF_MODEL` works for memory dreams (see
[Parameters](../USAGE.md#dreams-sleep-pass)). If neither is set when a semantic pass runs, extraction silently
falls back to a deterministic regex/heuristic extractor (headings, `[[links]]`, markdown links, capitalized
phrases) instead of erroring — the graph still gets semantic-style edges, just not LLM-derived ones. This is
also what `graph`/`reorg` use if you opt them into `wikigraphsemantic=true` without a model configured.

### Maintenance examples

Renaming a page safely — check what points at it first, move it, then confirm nothing broke:

```
/wiki backlinks guides/old-setup.md
/wiki move guides/old-setup.md guides/setup.md
/wiki lint
```

Publishing structural edits — lint before and after, so you can see exactly what a batch of writes introduced:

```
/wiki lint
/wiki write guides/new-topic.md
... (finish content with a line containing only """)
/wiki lint
/wiki reindex
```

Previewing a full maintenance pass before committing to it, then running it for real:

```
/dream plan
/dream apply
```

Rebuilding just the search index after a bulk external edit (e.g. pages changed outside the console), without
touching the graph or `index.md` files:

```
/wiki reindex
```

Rebuilding just the knowledge graph, with semantic (LLM-derived) edges, after `usewikigraph=true`:

```
/graph build semantic=true
```

Attaching a shared read-only reference wiki alongside your writable one, using it, then detaching it:

```
/wiki attach docs backend=fs root=/shared/reference-wiki
/wiki search "rate limiting"
/wiki detach docs
```

Both `/wiki reindex` and `/graph build` are interactive-only; unattended equivalents use `dream=true` from the
CLI (see the table above and the `sh` examples earlier in this section) — e.g. `mini-a dream=true usewiki=true
wikiroot=/shared/wiki dreamwikimode=reindex` for a cron job that only needs the search index refreshed.

## Search and graph state

Writable wikis maintain a Lucene index in `.mini-a-wiki-lucene/` and can maintain graph data in `.mini-a-wiki-graph/`. The index powers lexical search; graph state powers backlinks, community information, and optional related-page search hints. `wikilexical` selects language and optional explicit enhancements. Lucene-backed search results also carry a numeric `score` field (Lucene's native relevance score); results served from the scan fallback (no index available) omit it.

Read-only wikis consume an existing Lucene index without taking a writer lock. If no index is available, local backends can fall back to scanning page contents. Static HTTP has no directory listing, so it requires the published artifact bundle described below for catalog and search.

## Cross-wiki graph connections

Mounts (`wikimounts`, see "Core operations" above) already let `search`, `read`, `grep`, `tree`, `browse`, and `list` span every attached wiki. When both the local wiki and a mount have a graph (`usewikigraph=true`), that graph traversal spans mounts too, at query time only — nothing is ever merged or persisted across wikis.

Two mechanisms feed this, controlled by `wikigraphcross` (default `true`, requires `wikigraphmounts=true`):

- **Explicit `@name/` links.** A Markdown or `[[wiki]]` link to `@team/setup.md` already becomes a graph edge to the mounted page; cross-wiki expansion resolves it against the mount's own graph so it carries a real title and summary instead of a bare path, and (`wikigraphcrossdepth=2`) can pull that page's own related pages one hop further.
- **Shared join keys.** A page's `tags:`/`aliases:` front matter, and any `concept:` nodes from a semantic graph build (`wikigraphsemantic=true`), are wiki-agnostic names. If both wikis use the same tag, alias, or concept, cross-wiki expansion joins on it — even when the query never lexically matched anything in the mount. A key present on more than `wikigraphcrossmaxdf` (default `0.25`, i.e. 25%) of a mount's pages is skipped as too generic to be a useful join (e.g. a boilerplate tag like `docs`).

Relevant settings: `wikigraphcross`, `wikigraphcrossjoin` (CSV of `link,tag,alias,concept`), `wikigraphcrosscap` (default `5`), `wikigraphcrossdepth` (default `1`), `wikigraphcrossmaxdf` (default `0.25`), `wikigraphcrossminkeylen` (default `3`).

Results appear as `[Related pages (graph @name)] ...` hints in search (same prefix as an ordinary mount-graph hint — `mcp-wiki-safe.yaml` opaques both identically), in `related()`'s `cross` field, and via `/graph cross <path>` / the `graph` agent action's `op:"cross"`.

Cross-wiki expansion touches no backend: it only reads each mount's already-loaded, TTL-cached (`wikimountgraphttlms`) read-only graph state, so it does not consume the search scan budget described below. Mounts stay strictly directional and read-only — a wiki traverses into what it mounts, never the reverse, and cross-wiki edges are never written back into either wiki's `graph.json`.

**FalkorDB is not a cross-wiki mechanism.** Pointing two wikis at the same FalkorDB instance does not connect their graphs — `falkor` sync (`/graph falkor`) begins by deleting the target graph before rewriting it, and the default graph name (`wikigraphfalkor.graph`, `"mini_a_wiki"`) is shared across configs unless set explicitly per wiki. Two wikis sharing a FalkorDB graph name will clobber each other's data, not merge it.

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

## Utility oJobs (`utils/`)

Two standalone oJobs report statistics on an existing wiki's on-disk state without going through `mini-a` or the `MiniAWikiManager` API. Both are read-only and safe to run against a live wiki (no writer lock is taken). Add `top=<n>` to change how many entries each ranked list includes (default `10`); `__format=json` prints machine-readable output instead of the default table/text rendering.

### `utils/indexStats.yaml`

Given a wiki root folder (or its `.mini-a-wiki-meta` folder directly), reports page-level statistics assembled from the meta shards — counts by type, tag frequency, link totals and top inbound-referenced pages, orphan pages (no outbound links), heading/alias counts, oldest/newest `updated` timestamps, and the largest pages by size. It also summarizes the sibling `.mini-a-wiki-lucene`, `.mini-a-wiki-graph`, and `.mini-a-wiki-ingest` folders (file counts, total size, and — where readable — graph node/edge counts and ingest ledger entry counts).

```sh
ojob utils/indexStats.yaml dir="/path/to/wiki"
ojob utils/indexStats.yaml dir="/path/to/wiki" top=5 __format=json
```

### `utils/graphStats.yaml`

Given a `.mini-a-wiki-graph/graph.json` file, reports node/edge/community/surprise-link statistics — node counts by type, edge counts by type and provenance (`EXTRACTED`/`INFERRED`/`AMBIGUOUS`), per-node degree (top-N, average, max, isolated-node count, graph density), the largest communities, and the top cross-document surprise links by score.

```sh
ojob utils/graphStats.yaml file="/path/to/.mini-a-wiki-graph/graph.json"
ojob utils/graphStats.yaml file="/path/to/graph.json" top=5 __format=json
```

`graphStats.yaml` also accepts `key=<channel-key>` instead of `file` to read graph data already loaded into an oJob pipeline/channel (falls back to `__pm`/`__pm._map` when neither `file` nor `key` is given), which is how `utils/indexStats.yaml`-style tooling can chain into it in a larger pipeline.

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
# Wiki incremental knowledge

Wiki stores its private, content-addressed manifest under the index cache as
`.mini-a-wiki-state/manifest.json`; it is excluded from page search. Sources are split at
headings (then paragraphs only when a section is too large), so hashes, provenance and token
estimates are tracked per section. A later ingest reuses matching normalized chunks even when
they moved in the document. Missing/corrupt state safely starts fresh; read-only wikis never
attempt to create it.

`ingestmode=auto` is deterministic-first and is the default: well-structured Markdown is
normalized without a model call. Use `normalize` or `raw` to guarantee no LLM use, and
`distill` to preserve legacy LLM distillation. `wikillmbudget`, `wikiingestbudget`,
`wikidreambudget`, and `wikimaxprompttokens` defer work rather than dropping it.

```sh
mini-a ingest=true ingestsource=./docs usewiki=true wikiaccess=rw ingestmode=auto
mini-a dream=true usewiki=true dreamwikimode=plan
```

Dream plans are strictly zero-LLM: they report dirty/affected candidates and estimated calls
and tokens. Runtime semantic extraction starts with title, headings, tags, links, identifiers,
and section digests; it asks for selected context only when the extractor requests it. Search
retains page compatibility while adding deterministic title/path/heading/recency score details
with `debug=true`; `assembleContext()` returns token-bounded chunk context. Set
`wikitelemetry=true` only to retain local aggregate query hashes/frequencies.
