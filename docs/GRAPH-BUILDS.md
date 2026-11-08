# Wiki graph builds

Wiki Manager (`wikiman=true`) and Wiki Studio → Graph use the same build contract as
`MiniAWikiManager.graph("build", options)`, the native graph action, MCP `graph_build`,
`/graph build key=value ...`, and `utils/wikiOps.yaml operation=graph.build`.

| Option | Values / built-in default |
| --- | --- |
| `extraction` | `structural` (default), `semantic` |
| `modelHelp` | `off` (default), `auto`; always off for structural extraction |
| `strategy` | `incremental` (default), `full`, `resume` |
| `force` | `false`; ignore semantic caches for this semantic run |
| `maxCalls` | 100; positive integer |
| `maxTokens` | 200000 estimated input plus output tokens; positive integer |
| `maxMinutes` | 10; positive finite number |
| `preset` | `small`, `moderate`, `large`, `custom`, `reset` |

Small budgets are 20 calls / 40000 tokens / 2 minutes. Moderate uses built-in budgets.
Large allows 500 calls / 1000000 tokens / 30 minutes. Custom keeps the entered values.
Reset restores built-in extraction, assistance and budgets. There is no unlimited mode.

Explicit run options override saved wiki defaults, which override built-in defaults.
The legacy `semantic=true` maps to semantic extraction with automatic assistance;
`semantic=false` explicitly requests structural extraction. Explicit `extraction` and
`modelHelp` take precedence over that alias.

Incremental builds update changed or missing work and remove deleted evidence. Page batches
calculate communities and scores after the batch completes; direct single-page updates
still return current statistics. Wiki page writes (ingest journals, editor saves) update the
graph lazily: an ingest journal runs inside one graph batch (`beginBatch()`/`endBatch()`), so
it costs one `graph.json` save and one community recomputation instead of one per page.
Page removal touches only the page's own edges. Loading a graph defers communities and
surprise scores until first use. Semantic checkpoints preserve evidence and progress, saved
at most every 15 seconds or 250 committed sections and at stage boundaries, with derived
statistics recomputed on reload. Full builds reconstruct structural state while retaining
valid enrichment. Force ignores semantic caches.

Model work is content-addressed per section. A section is identified by its heading name
and text. It is complete while the hash of its model input (section text, mentioned
concepts, path-ordered cross-page candidates, model fingerprint and prompt version) is
unchanged. Editing one section re-extracts only that section. Model assertions of
unchanged sections in an edited page are carried across the edit (also through ingest or
structural updates before the semantic build) and rebased onto the new revision with
corrected evidence offsets. Deterministic mentions depend only on the vocabulary entries
a page actually looks up, so adding or renaming a page re-scans pages (CPU only) but
re-extracts only those that mention the changed name. A peer page edit invalidates a
section only when that section's candidate set changes. Pre-v3 enrichment of unchanged
pages is migrated without model calls (offset completions become section ids; model
assertions move to normalized concept ids).

Every incremental semantic build continues unfinished sections, so `strategy=resume` is
an explicit equivalent that also rejects stale options. Dream/ingest finalization reports
`graph_build` (status, pending, resumable, calls, cached) and logs when enrichment stays
partial. Resume plus force, and structural resume/force, are rejected. Model failures
remain pending; an empty validated relationship array is successful work. Failed
refreshes preserve valid assertions for unchanged sources.

Both interactive interfaces show effective settings and configured model availability
before a build. They expose presets, custom budgets, per-run overrides, and **Save
defaults**. Defaults are shared in `.mini-a-wiki-state/config.json` under the wiki's
index root. They contain extraction, assistance and budgets only. Strategy, force and
resume are per-run actions. Read-only wikis and mounts cannot save or build. Other
configuration fields in this file are preserved. Connection settings remain session-only.

```sh
# Deterministic semantics, with zero model calls:
ojob utils/wikiOps.yaml operation=graph.build wikiroot=/path/wiki \
  usewikigraph=true wikiaccess=rw confirm=true \
  params='{"extraction":"semantic","modelHelp":"off"}'

# Save shared preferences:
ojob utils/wikiOps.yaml operation=graph.defaults wikiroot=/path/wiki \
  usewikigraph=true wikiaccess=rw confirm=true \
  params='{"extraction":"semantic","modelHelp":"auto","preset":"small"}'

# Resume previously unfinished enrichment with a one-run budget override:
ojob utils/wikiOps.yaml operation=graph.build wikiroot=/path/wiki \
  usewikigraph=true wikiaccess=rw confirm=true \
  params='{"extraction":"semantic","modelHelp":"auto","strategy":"resume","maxCalls":25}'
```

Automatic assistance uses `OAF_LC_MODEL` for routine work and the main model (`model=`
or `OAF_MODEL`) for fallback. `modeldec` / `OAF_DECIDE_MODEL` optionally classify a
bounded candidate set. Calls are serial. Fallback and classification calls consume the
same budget. Token accounting estimates prompt size plus 2048 output tokens per call;
it is not provider billing. Time limits stop new scheduling; an in-flight call uses the
provider's configured request timeout. Completed sections are checkpointed. Studio
cancellation stops further calls and reports the saved partial result. Progress reports
stage, processed/cached/pending/failed counts, calls, estimated tokens and elapsed time.

Semantic extraction without a model still scans every body section for known concepts,
unambiguous aliases and technical identifiers. It preserves identifiers such as `C++`,
`Node.js`, `getOPackPath` and `conn.ReceiveFunc`. Each page → concept `MENTIONS` assertion
carries a source hash/revision, section, exact quote, UTF-16 body offsets and one-based
body line. These locations are relative to the body, excluding frontmatter.

Concept identity is conservative: page concepts are scoped and ambiguous aliases are not
merged. Free concept ids (`concept:id:<key>`) are case-folded and drop a possessive
`'s`, so `OpenAF`, `openaf` and `openaf's` join. The last prose word also loses a regular
plural (`connections` → `connection`, `policies` → `policy`). Acronyms and identifiers
(`TLS`, `getUsers`, `conn.ReceiveFunc`, `C++`) are only case-folded; node names keep the
original spelling. Besides titles and aliases, the vocabulary includes short `**bold**`
and inline-code terms used on two or more pages, as joinable concepts. A page title
always claims its name first. Extraction method (`deterministic` or
`model`) is separate from the grounded/inferred evidence layer. Current grounded support
ranks ahead of inferred expansion. Cross-wiki joins use bounded postings of explicitly
joinable concepts and retain source namespaces. No mount is mutated. Shared-concept
expansion adds an IDF weight for every shared concept, so several rare shared concepts
outrank one common concept. Concepts on more than 25% of the pages (wikis of 20 or more
pages) are skipped.

Communities use deterministic multi-level Louvain (modularity local moving plus
aggregation) over explicit links and IDF-weighted shared tags and grounded concepts, without
materializing pairwise page edges. Each page belongs to at most one community, and isolated
pages to none. `wikigraphcommunity=louvain` (default) and `label` select it.

`graph op=query` uses a lazily rebuilt token index with summed-IDF scoring (a word still
matches any indexed token containing it). `wikigraphproximity=true` adds a bounded
personalized-PageRank proximity component to Retrieval V2 graph hits (see
[WIKI-RETRIEVAL-V2.md](WIKI-RETRIEVAL-V2.md)). `similarConcepts(conceptId, k)` is an
extension seam for a future embedding layer: it returns `[]` unless a `similarConceptsFn`
graph option is configured.

Ordinary builds never edit Markdown. During Dream reorg, `graph op=tags path=...` supplies
up to five body-evidenced suggestions, preferring existing vocabulary. The main model
reviews them through constrained wiki edits, preserves existing tags and records reasons.
Normalization/removal suggestions are reported separately. Tag edges cannot justify tags.
Reorg finalization refreshes graph and search artifacts.

The graph envelope remains version 2 and edge keys remain
`[from,to,type,provenance,page,section]`. Extraction/cache state is versioned separately
(enrichment version 3; `semantic_carry` holds pending carried model work of edited pages).
Legacy graphs remain navigable, but assertions without current evidence are not verified
retrieval support. Rebuild semantic extraction to refresh them. OpenAF keeps generic
storage and traversal; `neighbors`, `path` and `traverse` share direction, type,
provenance, evidence-layer and minimum-confidence filters.

## Verification

Run `oaf -f tests/graphBuild.js`, `oaf -f tests/graphParity.js` (requires sibling OpenAF),
`oaf -f tests/graphConnectionBenchmark.js`, and the graph, wiki, wikiCross, wikiManager,
wikiStudio and dreams oJob suites. Run module-path checks after loading changes.

`tests/fixtures/graph-connections/benchmark.json` fixes the technical topics, relevance
labels and resource budgets. It is a synthetic 1030-page benchmark, not a production
corpus. It requires at least 10% relative graph-query Recall@10 improvement, at most
2 percentage points overall Precision@10 regression, and retrieval/model budget compliance.
It uses deterministic empty-output model stubs. Live-provider behavior and real FalkorDB
server acceptance require separate environment-specific validation. See the recorded
[implementation validation](GRAPH-BUILDS-VALIDATION.md) for this change.

### Model routing

Structural builds and previews make no model calls. Semantic builds with model help try `OAF_LC_MODEL` first, then `model=` / `OAF_MODEL` if extraction fails validation or needs context. Graph candidate classification uses the bounded Decide API with `modeldec=` / `OAF_DECIDE_MODEL`; `usedecide=false` disables it. Failed or unsupported classification retains the original candidates. Classification never establishes evidence. Decision calls share graph budgets; build reports include `callsByRole`.

Dream auto-repair uses Decide for bounded link choices and the main model for generative repair. Dream reorganization and memory consolidation use the main model.
