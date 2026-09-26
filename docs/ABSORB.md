# Absorb knowledge from local wikis

Absorption proposes destination-organized knowledge from several filesystem wikis.
Review a saved plan, then explicitly apply it. Planning reads raw source files and
never initializes source wikis. Apply and resume do not call a synthesis model.
No real wiki migration is needed to try this: use disposable directories first.

```json
{
  "sources": [
    {"id": "platform", "root": "../platform-wiki", "paths": ["runtime/", "setup.md#linux"], "exclude": ["runtime/old.md"]},
    {"id": "operations", "root": "../operations-wiki", "tags": ["deployment"], "topic": "runtime configuration"}
  ]
}
```

Roots are relative to the specification file. IDs are stable user-assigned names
(letters, digits, underscores and hyphens); keep the same ID when relocating a
source. Every source needs `all: true`, `paths`, `tags`, or `topic`. Positive
selectors form a union; exclusions win. Tags match exact frontmatter array values.
Paths select pages, directories, or heading anchors. Ambiguous/missing requested
headings block the plan. A section exclusion excludes a selected whole page rather
than risking transfer of excluded text. Topic retrieval uses lexical candidates;
the model then judges relevance. A topic with no lexical matches selects nothing.

Hidden state, symlinks, indexes, logs, node_modules and AGENTS.md wiki instruction
files are excluded. Mount configuration is not traversed.
Structured knowledge pages marked `schema: mini-a.skill/v1` or `type: skill` are
selected as intact units; changes to their template or metadata are blocked.
Source and destination directory trees must not overlap.

## Review and apply

```sh
ojob mini-a-absorb.yaml absorbop=plan absorbspec=./sources.json wikiroot=./destination wikiaccess=rw
ojob mini-a-absorb.yaml absorbop=show absorbplan=<id> wikiroot=./destination
ojob mini-a-absorb.yaml absorbop=apply absorbplan=<id> wikiroot=./destination wikiaccess=rw
ojob mini-a-absorb.yaml absorbop=status wikiroot=./destination
ojob mini-a-absorb.yaml absorbop=resume absorbplan=<id> wikiroot=./destination wikiaccess=rw
```

The console has equivalent commands against its active filesystem wiki:

```text
/absorb plan "/path/My Sources.json"
/absorb show <id>
/absorb apply <id>
/absorb status
/absorb resume <id>
```

Tab completion covers subcommands, quoted specification paths and saved plan IDs.
Use `model=...` or `OAF_MODEL` for planning synthesis. Exact duplicate detection is
model-free; any remaining synthesis requires a model. A single bounded call sees
all selected contributions together and the destination inventory, allowing
several sources to enrich one page or one source to support several pages.

The default limits are `absorbmaxpages=100` selected pages and
`absorbmaxtokens=100000` aggregate estimated input tokens (characters / 4).
These are input budgets, not provider billing estimates. Budget-exhausted,
unaccounted-for or incomplete selection plans cannot be applied. Reduce selection
or explicitly raise the budget. Remote backends, MCP/agent invocation, continuous
sync and whole-page deletion are not supported.

Review the JSON and Markdown report under
`.mini-a-wiki-absorb/plans/<id>.{json,md}`. The ID is a SHA-256 checksum of the
versioned plan. Plans freeze source evidence, hashes, classification decisions,
section edits, exact page replacements, mappings, dependencies and model usage.
Do not edit a saved plan; change the specification/source and replan. The report
shows section-level before/after diffs, duplicate decisions and blocked pages.
Source content is evidence, never authorization to execute commands.

Planning changes no wiki pages, navigation indexes or ingestion state. For a
read-only destination, supply `wikiaccess=ro absorboutput=/outside/wiki/plans`.
Use the same `absorboutput` for show/apply/resume of that plan, and explicitly
supply `wikiaccess=rw` when applying. Artifact output cannot overlap a source.

## Repeat runs and ownership

After application, `.mini-a-wiki-absorb/baseline.json` stores many-to-many support
records, selected source snapshots, mappings and exact applied destination bytes.
Source metadata (upstream provenance) remains separate from absorption ownership.
Unchanged runs propose no content changes. Revisions may replace previously
applied sections; edits to a destination page since application conservatively
block that page. Unrelated original destination text and frontmatter are retained.

A complete source inventory with the same selection can establish a removed
source page or explicitly selected heading. Automatic removal is limited to uniquely identifiable appended
contributions supported exclusively by removed sources. Shared support, replaced
original sections, selection narrowing, missing roots and local edits protect
content. Whole-page removal is always blocked. Other removals become findings.
Blocked contributions retain their old baselines for a future plan.

For example, select deployment pages from two source wikis and plan their joint
addition to an existing `operations/deployment.md`. Review and apply the plan.
After one source changes, plan again using the same IDs. Review the revision diff
before applying. A local destination edit will produce a conflict for review.

## Recovery and limits

Application verifies plan integrity, canonical destination identity, safe paths,
source inventories, content hashes and the baseline. Stale plans need replanning;
apply never regenerates edits. Page-level findings block the entire affected page
and its dependents; independent pages can still apply. Partial and failed jobs
return a nonzero exit code.

Ingestion and absorption share `.mini-a-wiki-ingest/writer.lock`. Unfinished
journals block competing ingestion/absorption writers. This is a **single-writer**
workflow: arbitrary external editors are not locked out. Each page is rechecked
immediately before its atomic write. Avoid editing destination pages during apply.

The journal stores exact before/after bytes and provenance before page writes.
`resume` recognizes already-applied writes, refuses conflicting edits and retries
provenance/finalization. Restore conflicting edits or source snapshots deliberately
before resuming; do not delete a pending journal. Finalization regenerates indexes,
refreshes configured retrieval/structural graph artifacts, and runs link lint,
with semantic graph generation disabled. An unrelated existing broken link can
leave finalization pending and must be repaired before resume succeeds.

Outcomes distinguish complete, noop, partial, stale, blocked and recovery-required.
Receipts make repeated resume safe. Model proposals are source-referenced but
semantic accuracy still requires human review. Ambiguous link mappings and missing
context block affected pages and appear as proposed selection expansions; they
never silently broaden the selection. Skill pages whose links require rewriting
remain blocked to preserve the intact template.

## Development verification

```sh
ojob tests/wikiAbsorb.yaml
node tests/consolePaths.cjs
ojob tests/wiki.yaml
ojob tests/wikiIngest.yaml
ojob tests/dreams.yaml
```

The absorption suite uses temporary wikis and injected model responses. It covers
joint contributions, reruns, revisions, safe removals, source relocation, selections,
evidence validation, link rewriting, skill preservation, budgets, permissions,
stale snapshots, partial application, locks and interrupted recovery. Live model
semantic quality and provider behavior are separate from these deterministic tests.

Validation on 2026-09-25: 19 absorption scenario groups, 219 wiki tests, 47 dream
tests and console dispatch/completion checks passed. Ingestion passed 68 tests;
`IngestUsesOafpForStructuredSources` failed because its expected discovery probe
count was 1 and the observed count was 0. The same failure was reproduced by
loading the unmodified HEAD ingestion implementation in a separate process.
A disposable two-source plan/show/apply cycle and a source-update/apply cycle
passed through the standalone job; the next plan was a no-op. Those cycles used
injected planning responses and real deterministic finalization, not a live provider.
