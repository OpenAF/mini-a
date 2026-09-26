# Virtual Skills

A **virtual skill** is a Markdown skill document stored in a wiki. Mini-A searches
for relevant skills, inspects their metadata and headings, then reads the sections
needed for the task. The full library stays out of the prompt, and adding a skill
does not add another tool or slash command.

Virtual skills reuse the existing wiki storage, search and graph engine. They can
share a wiki with ordinary knowledge pages or live in a separate library.

## Quick start

With OpenAF, the Mini-A oPack and `OAF_MODEL` configured, create a wiki directory
containing a Markdown page such as `./team-skills/review-change.md`:

```markdown
---
type: skill
name: review-change
description: Review a code change for correctness and missing validation.
tags: [code, review]
intent: [review a change, check a patch]
---
# When to use
Use when reviewing a proposed code change.

# Procedure
1. Read the diff and the surrounding implementation.
2. Identify concrete behavior changes and affected callers.
3. Check the available validation and report any remaining gaps.
```

Start the console with that directory as a dedicated library:

```bash
opack exec mini-a useskillwiki=true skillwikiroot="$(pwd)/team-skills"
```

Then verify discovery and read the procedure:

```text
/skills context
/skills search review change
/skills open wiki:review-change.md
/skills read wiki:review-change.md Procedure
```

`/skills context` should report `skillCount: 1` for this one-page library. For
other libraries, use the exact `ref` returned by search, including any mount
prefix. Plain `/skills` continues to list local skills.

For a goal that should consult the library, ask explicitly:

```bash
opack exec mini-a useskillwiki=true skillwikiroot="$(pwd)/team-skills" \
  goal="Use skillwiki to find and read the review-change procedure, then explain its review steps."
```

Enabling the library makes the tool available; it does not guarantee that the
model will consult it for every goal. The examples use the default retrieval
mode. If you enable retrieval v2, [build its index first](#opt-in-passage-retrieval).

## Local skills vs. virtual (wiki) skills

| | Local skills (`SKILL.md` / `SKILL.yaml`) | Virtual skills (this doc) |
|---|---|---|
| Storage | Files under a skills root (e.g. `~/.openaf-mini-a/skills`) | Markdown wiki pages (fs/s3/s3fs/es/http) |
| Discovery | Eagerly listed; every skill shows up in `/skills` | Never eagerly listed; discovered via search/recommend |
| Context use | Console discovers templates; the local `skills` tool is controlled by `useskills` | Fixed tool schema, then metadata and requested text on demand |
| Invocation | `$name`/`/name` renders the local template | Search/open/read through `skillwiki`; `resolve()` returns a template for a caller to render |

Both can coexist. Nothing about local skills changes: `/skills`, `$skill`,
`extraskills`, and Agent Plugins behave exactly as before. Virtual skills are
reached through a different, explicitly-invoked surface (`/skills search ...`,
the `skillwiki` tool, or an MCP client talking to `mcp-skills.yaml`) so a 100k-page
skill library never floods the compact local skill list or gets injected into a
system prompt.

## Why demand-paged

Four hard rules, enforced throughout this feature:

- Never inject the full skill catalog into a prompt.
- Never expose one MCP tool per skill (the standard MCP surface stays at seven tools no matter
  the corpus size).
- Never return a full skill body from search -- only compact metadata.
- Never recursively preload every referenced/related skill.

The intended interaction shape (see `mini-a-mcp-skills.js` /
`mini-a-skills.js`):

```
Agent: recommend(task="diagnose Kafka consumer pauses during rebalances")
MCP:   1. kafka-consumer-rebalance  2. kafka-cooperative-assignor  3. kafka-consumer-lag
Agent: open(kafka-consumer-rebalance)
MCP:   metadata + headings (no body)
Agent: read(ref=..., section="Diagnosis")
MCP:   just that section
Agent: performs the task
```

## Authoring a skill

A virtual skill is an ordinary wiki page with front matter. The minimum is:

```markdown
---
type: skill
name: postgres-index-review
---
# Diagnosis
...
```

The fuller shape, matching the existing `mini-a.skill/v1` conventions from
[SKILLS-YAML-FORMAT.md](SKILLS-YAML-FORMAT.md) where reasonable:

```markdown
---
type: skill
id: skill:postgres-index-review
schema: mini-a.skill/v1
name: postgres-index-review
title: PostgreSQL Index Review
description: Analyze PostgreSQL workloads and identify missing, redundant, or ineffective indexes.
tags: [postgresql, database, performance]
intent:
  - diagnose slow query
  - review indexing strategy
  - optimize database
applies_to: [postgres]
inputs:
  repository:
    required: true
capabilities: [filesystem-read]
depends_on:
  - skill:inspect-repository
requires:
  tools: [shell]
  capabilities: [filesystem-read]
risk: low                     # low | medium | high -- informational today
trust:
  level: curated               # local | curated | verified | community | untrusted
  publisher: openaf
compatibility:
  mini-a: true
  codex: true
  claude-code: true
  opencode: true
  agy: true
version: 1
---
# When to use
...

# Diagnosis
...

# Remediation
...

Use the procedure in [JFR analysis](refs/jfr.md) for GC pauses.
```

Use `type: skill` and a non-empty `name` for new pages. The provider also recognizes
front matter with a `schema` beginning with `mini-a.skill/`. Other fields are optional -- an ordinary knowledge page
without any of this front matter behaves exactly as it always has (`type`
defaults to `"concept"` at write time and is never required for existing pages).
`applies_to`/`appliesTo` and `intent`/`intents` are both accepted. `compatibility`
and `trust` accept arbitrary keys; nothing is hard-coded to a fixed vendor list.

References to supporting documents (`refs/jfr.md` above) are just normal
relative/`wiki:`-style links -- `open()` lists them cheaply via `links`, and
`read()`/`skills-read` can follow them through the same wiki mechanism as any
other page. They are never eagerly concatenated into the skill body.

### Importing local skills

Copying a local `SKILL.yaml` into a wiki is not an import operation. Convert it to
a Markdown page with skill front matter and put the procedure in the Markdown
body. Keep supporting documents as linked wiki pages; embedded local `refs` are
not automatically expanded by the virtual provider.

### Relationships

Skill-to-skill relationships (`requires`, `related`, `supersedes`, `uses`,
`alternative`, ...) are expressed the same way any other wiki relationship is:
shared `tags`, `aliases`, `supersedes`, and explicit Markdown/`wiki:` links. There
is no second graph -- `related()`/`skills-related` calls straight into the
existing wiki graph (`mini-a-graph.js`) and its cross-wiki join machinery, so
`kubernetes-debug-pods` linking to `kubectl-basics` or sharing a `kubernetes` tag
with `kubernetes-dns-debug` in another mount is discoverable without any
skill-specific graph code.

`depends_on` (also accepted as `dependsOn` or `dependencies`) is the explicit,
ordered prerequisite list for a composed skill. Entries may be a stable
`skill:name` identifier, a `wiki:` reference, or an exact skill name. The
`compose()` operation returns only compact metadata for a bounded, one-level
set of these prerequisites. It never recursively expands them, reads their
bodies, invokes tools, or grants the `requires`/`capabilities` they declare.
Those operations remain under Mini-A's normal permissions and approval policy.

## The normalized skill model

Internally, every skill search/open/related result is shaped as (see
`mini-a-skills.js`):

```js
{
  schema: "mini-a.virtual-skill/v1",
  name: "postgres-index-review",
  title: "PostgreSQL Index Review",
  summary: "Analyze workloads and identify missing or ineffective indexes",
  type: "skill",
  tags: ["postgresql", "database", "performance"],
  intents: ["diagnose slow query", "review indexes", "optimize database"],
  appliesTo: ["postgresql"],
  requires: { tools: ["shell"], capabilities: ["filesystem-read"] },
  compatibility: { "mini-a": true, "codex": true },
  risk: "low",
  trust: {},
  version: "1",
  provider: "wiki",
  wiki: "database-skills",
  path: "postgres/index-review.md",
  ref: "wiki:@database-skills/postgres/index-review.md",
  score: 4.37
}
```

This shape is provider-agnostic by design (`provider: "wiki"` today) so a future
`LocalSkillProvider`/`PluginSkillProvider` could produce the same normalized
object without changing any caller.

## Indexing and caching notes

- Front matter is parsed generically (`af.fromYAML`) -- new fields always
  round-trip through `read()`/`open()`, no matter how old the wiki engine's own
  code is.
- `_buildPageRecord` (in `mini-a-wiki.js`) additionally lifts skill fields into
  the *cached* per-page metadata record used by `list(withMeta)` and the search
  decoration path. This cache is versioned (`__MINI_A_WIKI_META_RECORD_VERSION`):
  upgrading mini-a self-heals any existing cached wiki the first time each page
  is touched again -- no manual reindex step is required.
- There is intentionally **no** structured Lucene field for `type`/`tags`/etc.
  today -- filtering by them is a cheap post-filter over the already-cached
  per-page record after a normal lexical search, not a second index. This keeps
  `mcp-wiki.yaml` and plain wiki search completely unaffected.
- `skills-context`'s `skillCount` is a full scan of cached metadata records
  behind a short TTL (default 30s) -- cheap once the per-page cache is warm, but
  not instantaneous cold on a very large corpus. See "Scale" below.

## Ranking

One function, one weights table (`mini-a-skills.js`,
`__MINI_A_SKILL_RANK_WEIGHTS` / `__miniAComputeSkillScore`):

```
finalScore = lexical*lexicalScore + name*nameBoost + title*titleBoost
           + intent*intentBoost + tag*tagBoost + appliesTo*appliesToBoost
           + compatibility*compatibilityBoost + graph*graphBoost
```

No vector/embedding search yet -- `recommend()` builds a query from
`task + environment + capabilities` and reuses the same lexical `search()` path,
so a future semantic retriever only needs to replace that one query-construction
step, not any caller. In the default retrieval mode, multi-word queries are matched as an OR of significant
terms against `wm.search()`/`searchSelected()` (each term is still a real call
into the existing engine -- results are merged by path), since a literal
multi-word substring match is unreliable without a Lucene index built.

Retrieval v2 instead delegates the complete query to the shared passage engine.

Future signals (trust, quality, popularity, successful-use count, recency,
deprecation, maintainer authority) have an obvious home: add a boost term and a
weight, nothing else changes.

## Using it as an MCP server

```bash
ojob mcps/mcp-skills.yaml \
  onport=8890 \
  label="Engineering Skill Library" \
  wikibackend=fs \
  wikiroot=./skills \
  wikimounts="[{name:'security', label:'Security Skills', backend:'fs', root:'./security-skills'}]"
```

Tools exposed, regardless of corpus size: `context`, `search`, `recommend`,
`open`, `read`, `related`, `compose`. Every result is compact metadata; only `read()`
returns skill text, and only the bounded section/range asked for.

A generic MCP client (Claude Code, Codex, OpenCode, agy, or any other
MCP-capable agent) needs nothing beyond a normal MCP connection to this server --
`toolPrefix=skills-` can namespace the tools (for example, `skills-search`) if the client also has an unrelated
`search`/`context`/etc. tool from another server.

### Safe / public mode

`mcps/mcp-skills-safe.yaml` reuses the exact restricted-retrieval state machine
from `mcp-wiki-safe.yaml` (`MiniAMcpWikiRestriction` in `mini-a-mcp-wiki.js`):
opaque references, per-window search/read/char budgets, per-page cooldowns, and
an optional shared (e.g. Redis) channel for multi-replica deployments. It exposes
`search`, `open`, `read`, `related` -- never a raw path, never the full skill
body. Because `open()`/`related()` don't themselves disclose content, each
operation **consumes** the reference it's given and returns a **fresh** one-shot
reference for the next step in the chain (search -> ref -> open -> ref -> read).
A stale or reused reference always fails with `invalid-or-expired-reference`.

```bash
ojob mcps/mcp-skills-safe.yaml label="Public Skill Library" wikiroot=./skills wikirestrictprofile=moderate
```

Set `wikirestrictprofile=off` only for trusted clients that should see raw,
unbounded search/open/read/related -- this is the same escape hatch
`mcp-wiki-safe.yaml` offers, and it prints a warning on startup.

## Using it from mini-a itself

Opt in with `useskillwiki=true`. With no further config, it reuses the wiki
already configured via `usewiki` (a wiki can hold ordinary knowledge pages and
skill pages side by side). Point it at a separate skill-only library instead
with `skillwikibackend`/`skillwikiroot`/`skillwikimounts`.

```bash
opack exec mini-a useskillwiki=true usewiki=true wikiroot=/absolute/path/to/team-wiki goal="..."
```

This exposes a `skillwiki` tool to the LLM (operations: `context`, `search`,
`recommend`, `open`, `read`, `related`, `compose`, `resolve`) through the same in-process
`MiniUtilsTool` mechanism as the existing `wiki`/`graph` tools -- no MCP loopback
required. `useskills=true` enables the separate local `skills` tool; it neither
enables nor is required by `useskillwiki`.

### Configuration

| Parameter | Default | Purpose |
|---|---|---|
| `useskillwiki` | `false` | Enable the virtual skill library. |
| `skillwikiroot` | Unset | Filesystem root for a dedicated library; prefer an absolute path. |
| `skillwikibackend` | `fs` for a dedicated library | Select `fs`, `s3`, `s3fs`, `es`, or `http`. |
| `skillwikimounts` | Unset | SLON/JSON mounts for a dedicated library, using the `wikimounts` shape. |
| `skillsmaxloaded` | `3` | Distinct references opened through the agent's `skillwiki` tool per run. |
| `skillsmaxchars` | `12000` | Character budget used by the agent's `skillwiki` read operation per run. |
| `skillsautosearch` | `false` | Reserved for planner-level consultation; not implemented. |
| `skillsautolimit` | `5` | Reserved limit for that future automatic search. |

If any dedicated `skillwiki*` source setting is supplied, Mini-A creates a separate
manager instead of reusing `usewiki`. Its filesystem root defaults to `.` when
omitted, so set `skillwikiroot` explicitly. A dedicated filesystem library does
not require `usewiki=true`. To reuse an existing wiki and its mounts, enable
`usewiki=true useskillwiki=true` and omit the dedicated source settings.

The `skillwiki` interface provides retrieval operations only. It does not author
pages or grant the tools declared in a skill's metadata. Maintain pages and build
indexes through the normal writable wiki workflow.

### Check availability

The presence of `skillwiki` in the available tool catalog means that the virtual
skill library is enabled. It does not reveal the library contents or count. Status
questions must call `skillwiki` with `operation=context` and use the returned
`skillCount`; the ordinary local-skill prompt count belongs to the separate
`useskills` feature and must not be used as virtual-skill status.

These per-run budgets apply to the agent tool's `open` and `read` branches.
Console commands and standalone MCP servers use their own retrieval settings;
`resolve` calls the provider directly and does not use those two budget counters.
For public MCP access, use the separate restricted server described above.

From the console:

```
/skills search postgres index tuning
/skills recommend diagnose slow postgres queries
/skills open wiki:postgres-index-review.md
/skills read wiki:postgres-index-review.md Diagnosis
/skills related wiki:postgres-index-review.md
/skills context
```

These subcommands only activate when a skill library is actually configured
(`useskillwiki=true`, or an active agent with one already set up) -- otherwise
`/skills <word>` falls through unchanged to the original local-skill
prefix-filtered listing, so no existing user needs to change anything.

### Agent tool operations

These are JSON arguments to the `skillwiki` tool, not console commands:

```json
{"operation":"context"}
{"operation":"recommend","task":"diagnose slow postgres queries","limit":3}
{"operation":"search","query":"postgres index","wiki":"*","limit":5}
{"operation":"open","ref":"wiki:postgres-index-review.md"}
{"operation":"read","ref":"wiki:postgres-index-review.md","section":"Diagnosis","maxChars":2000}
{"operation":"compose","ref":"wiki:postgres-index-review.md","limit":4}
```

Call them individually and use returned references for subsequent calls. `compose`
is available through `skillwiki` and the standard MCP server, but there is no
`/skills compose` console command. `resolve` is available through `skillwiki` and
the provider API, but is not exposed by either skills MCP server.

### Resolving a skill for execution

Discovery and execution are kept strictly separate (never treat a search result
as trusted instructions before it's explicitly selected). `skillwiki`'s
`resolve` operation (backed by `MiniAWikiSkillProvider.prototype.resolve`) turns
a chosen skill into the same shape `__miniALoadSkillTemplateDocument` produces
for a local `SKILL.md`/`SKILL.yaml` -- `bodyTemplate` plus `meta` -- so it can be
rendered with the existing `{{args}}`/`{{argv}}`/`{{arg1}}` machinery
(`__miniARenderSkillTemplate`) instead of a parallel remote-execution path.

Calling `resolve` does not execute the skill, render its placeholders, install it,
or register a `/name` command. It returns a bounded template (default `maxChars: 32000`) and a `truncated` flag; callers should check that flag before using it.
Linked supporting pages remain separate (`virtualFiles` is empty).

## Multi-wiki / cross-wiki

Skill libraries use ordinary wiki mounts. `search`/`recommend`'s `wiki` parameter
accepts `"*"` (all), a single name, or an array, exactly like `mcp-wiki.yaml`'s
`wiki` selector; every result carries the source `wiki` name and mount-prefixed
`ref` (`wiki:@devops/...`). `related()` reuses the existing cross-wiki graph join
(`wikigraphcross`) so `coding/java-jfr` can surface a connection to
`devops/kubernetes-cpu-throttling` in a different mount without a second graph.

## Observability

`mini-a-skills.js` tracks counters only (`__miniASkillMetricsSnapshot()`):
searches, recommends, opens, reads, sections read, related calls, and characters
returned. Skill body content is never logged. Debug logging (when a `logFn` is
wired in, e.g. via `mcp-skills.yaml`'s `[mcp-skills]` prefix) looks like:

```
[skills] searched "postgres index performance" -> 1 candidate(s)
[skills] opened wiki:postgres-index-review.md (3 headings)
[skills] loaded section "Diagnosis" of wiki:postgres-index-review.md (79 chars)
```

## Troubleshooting

| Symptom | What to check |
|---|---|
| `/skills` is empty or the prompt reports `skills=0` | These describe local skills. Use `/skills context` or `skillwiki` with `operation: "context"` to inspect the virtual library. |
| `/skills search ...` behaves like a local prefix filter | The console has no configured virtual library. Start with `useskillwiki=true` and an explicit root, or reuse an enabled wiki. |
| `skillCount` is zero | Verify the root and mounts in the process/container that serves the request. Pages need skill front matter; local skill folders and YAML bundles are not automatically imported. |
| Count is positive but search has no matches | Check the query, selected wiki and metadata filters. A count confirms recognized pages, not successful indexed retrieval. |
| `skill-search-unavailable: ... v2-build-required` | Build the selected library's serving generation using a writable wiki manager. The read-only skill manager cannot build it. |
| `skill-search-unavailable: ... incompatible-generation` | Match the reader's retrieval and lexical settings to those used to build the index, or rebuild with the intended settings. Check each selected mount. |
| `skills-max-loaded-exceeded` or `skills-max-chars-exceeded` | Narrow the consultation or adjust `skillsmaxloaded`/`skillsmaxchars` for the next run. |
| Safe MCP reports `invalid-or-expired-reference` | Search again and pass the fresh reference returned by each operation to the next call. References are one-shot. |

Legacy skill counts are cached for 30 seconds by default; the provider disables
that count cache under retrieval v2. Tool catalogs and MCP proxy tool searches
show available operations, not the contents of the skill library.

## Scale

Search and recommendation return compact metadata, so library growth does not
require a growing tool catalog or loading every procedure into a prompt. Counts
and metadata-only browsing can still scan page records, and cold-cache cost grows
with the corpus. Retrieval mode and available indexes determine search behavior.

`tests/skills.yaml` covers a small corpus across multiple mounts. It does not
establish performance at 100k or 1M pages; benchmark index time, size and query
latency against your own corpus before sizing a deployment.

## What's intentionally deferred

- **Automatic planner-level consultation.** `skillwiki` is available to the LLM
  as a normal tool call today (bounded by `skillsmaxloaded`/`skillsmaxchars`).
  Wiring a planner heuristic that decides *for* the model when to search the
  skill library (`skillsautosearch`) is a natural next step once the above has
  seen real use.
- **Materialization/export** (`skills-materialize`, turning a selected remote
  skill into a portable local `SKILL.md`/`SKILL.yaml`, or a group of skills into
  an Agent Plugin pack) is future work. `resolve()` already produces the
  intermediate normalized shape a materializer would serialize.
- **Semantic/vector retrieval, skill quality signals (success/failure counts,
  ratings), recursive dependency execution, adaptive paging, signed skills.** The ranking
  function and normalized model are structured so each can be added without
  changing callers (see "Ranking" above).

## Files

| File | Role |
|---|---|
| `mini-a-wiki.js` | Extended `_buildPageRecord`/`_metaFor` to cache skill frontmatter fields (additive, versioned, backward compatible). |
| `mini-a-skills.js` | The facade: normalized model, ranking, context/search/recommend/open/read/related, `MiniAWikiSkillProvider`. |
| `mini-a-mcp-skills.js` | MCP bootstrap reusing `mini-a-mcp-wiki.js`'s init and restricted-retrieval engine. |
| `mcps/mcp-skills.yaml` | Unrestricted MCP server. |
| `mcps/mcp-skills-safe.yaml` | Restricted/opaque-reference MCP server. |
| `mini-a.js` | `_initSkillWiki`, `useskillwiki`/`skillwiki*`/`skillsauto*`/`skillsmax*` args. |
| `mini-a-utils.js` | `MiniUtilsTool.prototype.skillwiki` (the LLM-facing tool) with bounded consultation. |
| `mini-a-con.js` | `/skills search\|recommend\|open\|read\|related\|context` console subcommands. |
| `tests/skills.js`, `tests/skills.yaml` | Unit + multi-mount integration tests, including safe-mode opaque-reference behavior. |

## Opt-in passage retrieval

Build a filesystem library from the checkout with writable access, then start
its reader with the same retrieval and lexical settings:

```bash
ojob mini-a.yaml dream=true usewiki=true wikiroot=/absolute/path/to/team-skills \
  wikiaccess=rw wikiretrievalv2=true dreamwikimode=reindex \
  wikilexical="(language: english, ngrams: true)"

opack exec mini-a useskillwiki=true skillwikiroot=/absolute/path/to/team-skills \
  wikiretrievalv2=true wikilexical="(language: english, ngrams: true)"
```

Use the same Mini-A version for the builder and reader. With mounts, build each
selected library using its effective configuration.

`wikiretrievalv2=true` and `wikiretrievalconfig` reach the shared wiki manager.
CLI, console and web launchers also pass these settings to a dedicated
`useskillwiki=true skillwikiroot=...` manager. Build its serving generation
explicitly with a writable wiki manager before using that read-only skill
library; `wikitelemetry=true` records aggregate restricted outcomes in memory
for read-only MCP servers. Restricted calls consume quotas and one-shot
references, so their MCP schemas mark them non-idempotent.
For a dedicated remote skill backend, the normal `wiki*` connection and artifact
arguments supply its endpoint, credentials and cache; `skillwikibackend` selects
the backend and `skillwikimounts` supplies any additional read-only libraries.
An explicit writable reindex builds local serving generations; existing ingestion
journals, full-source reconstruction and protected pruning remain authoritative.
Original ingestion chunks and summaries do not become wiki-range quotations.
See [retrieval v2](WIKI-RETRIEVAL-V2.md) for effective capabilities, restricted
presentation policy, rollout and outstanding requirements.
