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

Incremental builds update changed or missing work and remove deleted evidence. Full
builds reconstruct structural state while retaining valid enrichment. Force ignores
semantic caches. Resume revalidates the current pages and continues unfinished
sections; it never runs automatically. Resume plus force, and structural resume/force,
are rejected. Model failures remain pending; an empty validated relationship array is
successful work. Failed refreshes preserve valid assertions for unchanged sources.

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

Concept identity is conservative: page concepts are scoped; technical identifier spelling
is preserved; ambiguous aliases are not merged. Extraction method (`deterministic` or
`model`) is separate from the grounded/inferred evidence layer. Current grounded support
ranks ahead of inferred expansion. Cross-wiki joins use bounded postings of explicitly
joinable concepts and retain source namespaces. No mount is mutated. Communities use
sparse shared concepts and tags instead of pairwise page edges.

Ordinary builds never edit Markdown. During Dream reorg, `graph op=tags path=...` supplies
up to five body-evidenced suggestions, preferring existing vocabulary. The main model
reviews them through constrained wiki edits, preserves existing tags and records reasons.
Normalization/removal suggestions are reported separately. Tag edges cannot justify tags.
Reorg finalization refreshes graph and search artifacts.

The graph envelope remains version 2 and edge keys remain
`[from,to,type,provenance,page,section]`. Extraction/cache state is versioned separately.
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
