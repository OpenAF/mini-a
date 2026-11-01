# Wiki quickstart: create, hydrate, dream, query

Build a searchable Mini-A wiki from a folder of documents in three commands, then ask it questions in the terminal or the browser. This page is the short path; [WIKI.md](WIKI.md) is the reference.

## Before you start

- Set a model: `export OAF_MODEL="(type: openai, model: gpt-5, key: ...)"` (or pass `model=` / `mode=<your mode>` to any command below). Hydrating with `ingestmode=raw` avoids model calls during ingestion; dreaming and answering questions need one.
- Every command has two spellings. Use the installed `mini-a` command (or `opack exec mini-a`) from anywhere, or call the job directly with `ojob utils/<job>.yaml`. The `mini-a --wiki-hydrate` style flags are accepted as aliases for the `key=true` forms.
- Stop other readers and writers of a wiki before hydrating or dreaming it; both finish by compacting the serving index.

## 1. Create and hydrate

```sh
mini-a wikihydrate=true wikiroot=./mywiki source=./docs
# same thing
ojob utils/wikiHydrate.yaml wikiroot=./mywiki source=./docs
```

`wikiroot` is created when it does not exist. `source` can be a folder (Markdown, text, HTML), a git repository or a page URL. Useful options:

| Option | Effect |
| --- | --- |
| `dryrun=true` | Report what would be ingested without writing anything. Try this first. |
| `prune=true` | Remove ingested pages whose source file no longer exists. |
| `ingestinclude=` / `ingestexclude=` | Limit which source files are read. |
| `semantic=true` | Add LLM semantic relationships to the wiki graph (slower, optional). |
| `dream=true` | Run a dream straight after ingestion. |

Running it again is incremental: unchanged sources are skipped.

## 2. Dream (optional)

A dream reorganizes the wiki: merges duplicates, fixes links, adds indexes and refreshes the graph.

```sh
mini-a wikidream=true wikiroot=./mywiki dreamwikimode=plan   # preview only, changes nothing
mini-a wikidream=true wikiroot=./mywiki                      # reorganize (default mode: reorg)
ojob utils/wikiDream.yaml wikiroot=./mywiki organize=topics
```

- Mutating modes (`reorg`, `apply`, `repair`, `auto`) first zip the wiki to `./mywiki.predream-<timestamp>.zip`. To undo a dream, delete the wiki folder and unzip the backup in its place.
- `wikidream=true` reorganizes a wiki. It is not the agent-memory `dream=true`.

## 3. Query

```sh
mini-a wikiquery=true wikiroot=./mywiki                       # terminal console
mini-a wikiquery=true wikiroot=./mywiki onport=8888           # browser at http://localhost:8888
mini-a wikiquery=true wikiroot=./mywiki goal="How do we deploy?"   # one answer, then exit
ojob utils/wikiQuery.yaml wikiroot=./mywiki web=true onport=8888
```

The wiki is opened read-only with the `wiki` mode preset: wiki search and graph tools on, shell, file writes and delegation off. Pass `mode=poweruser` for the full toolset, or `mode=none` to skip presets. Retrieval settings default to the same values the hydrate and dream jobs use, so searches match the published index.

In the console, try:

```text
/wiki context            what the wiki holds and how it is being searched
/wiki search caching     find pages
/wiki read guides/x.md   read one
/graph ...               explore relationships (needs the graph; see WIKI.md)
```

## 4. Keep it fresh

- Source changed: re-run hydrate (add `prune=true` to drop removed files).
- Wiki drifting or messy: dream with `dreamwikimode=plan`, review, then run it for real.
- Several wikis: use `wikimounts` (see [WIKI.md](WIKI.md#mcp-multi-wiki-selection)); `wikiquery` passes it through.
- Publish for others: see [static HTTP wiki](WIKI.md#publishing-a-static-http-wiki).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Wiki directory not found ... Hydrate it first` | Dream and query need an existing wiki. Run hydrate first. |
| Query warns "No published search index" | The wiki has pages but no serving index. Hydrate or dream it (or `/wiki reindex` in a writable session). |
| Query fails with "wiki has no pages" | `wikiroot` points at an empty folder; check the path. |
| Answers miss pages you know exist | Search results can be partial; check `/wiki context`, and keep `wikilexical` the same as the publisher (`OAF_MINI_A_WIKI_LEXICAL`). |
| Model errors | Set `OAF_MODEL` or pass `model=` / `mode=`. |
