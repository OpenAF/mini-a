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

## Search and graph state

Writable wikis maintain a Lucene index in `.mini-a-wiki-lucene/` and can maintain graph data in `.mini-a-wiki-graph/`. The index powers lexical search; graph state powers backlinks, community information, and optional related-page search hints. `wikilexical` selects language and optional explicit enhancements.

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
