# Virtual Skills

A **virtual skill** is a skill document stored and indexed like ordinary wiki
knowledge, but *consumed* like executable expertise: an agent searches a compact
index, inspects one candidate cheaply, reads only the section it needs, and only
then acts. The corpus can grow to 100k-1M documents without ever being loaded into
an LLM's context -- the wiki/Lucene/graph engine is the backing store, a small
fixed set of MCP tools (or the equivalent in-process calls) is the paging
interface, and the agent's context window is the working set. This mirrors how
virtual memory lets a program address far more data than fits in RAM: only the
pages actually touched get paged in.

```
huge skill corpus (100k-1M documents)
      |
wiki backends / mounts (fs, s3, s3fs, es, http)
      |
Lucene + graph + existing wiki retrieval
      |
small skill interface (~6 tools, regardless of corpus size)
      |
search -> inspect -> read one section -> use
```

This is deliberately a **facade** over the existing wiki engine
(`mini-a-wiki.js`, `MiniAWikiManager`) -- there is no second search/index/storage
implementation. Everything here reuses `search`/`searchSelected`, `open`,
`agenticRead`, `related`, `context`, wiki mounts, and the knowledge graph exactly
as `mcp-wiki.yaml` and `usewiki` do.

## Local skills vs. virtual (wiki) skills

| | Local skills (`SKILL.md` / `SKILL.yaml`) | Virtual skills (this doc) |
|---|---|---|
| Storage | Files under a skills root (e.g. `~/.openaf-mini-a/skills`) | Wiki pages (fs/s3/s3fs/es/http), any size |
| Discovery | Eagerly listed; every skill shows up in `/skills` | Never eagerly listed; discovered via search/recommend |
| Context cost | One slash-command per skill, all loaded up front | Zero, until a specific skill is searched/opened/read |
| Scale | Tens to low hundreds, comfortably | 100k-1M+ |
| Execution | `$name`/`/name` renders `{{args}}`/`{{argv}}`/`{{arg1}}` directly | Same rendering machinery, reached via `resolve()` (see below) -- never a second execution path |

Both can coexist. Nothing about local skills changes: `/skills`, `$skill`,
`extraskills`, and Agent Plugins behave exactly as before. Virtual skills are
reached through a different, explicitly-invoked surface (`/skills search ...`,
the `skillwiki` tool, or an MCP client talking to `mcp-skills.yaml`) so a 100k-page
skill library never floods the compact local skill list or gets injected into a
system prompt.

## Why demand-paged

Four hard rules, enforced throughout this feature:

- Never inject the full skill catalog into a prompt.
- Never expose one MCP tool per skill (the tool surface stays ~6 tools no matter
  the corpus size).
- Never return a full skill body from search -- only compact metadata.
- Never recursively preload every referenced/related skill.

The intended interaction shape (see `mini-a-mcp-skills.js` /
`mini-a-skills.js`):

```
Agent: skills-recommend(task="diagnose Kafka consumer pauses during rebalances")
MCP:   1. kafka-consumer-rebalance  2. kafka-cooperative-assignor  3. kafka-consumer-lag
Agent: skills-open(kafka-consumer-rebalance)
MCP:   metadata + headings (no body)
Agent: skills-read(ref=..., section="Diagnosis")
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

Every field except `type`/`name` is optional -- an ordinary knowledge page
without any of this front matter behaves exactly as it always has (`type`
defaults to `"concept"` at write time and is never required for existing pages).
`applies_to`/`appliesTo` and `intent`/`intents` are both accepted. `compatibility`
and `trust` accept arbitrary keys; nothing is hard-coded to a fixed vendor list.

References to supporting documents (`refs/jfr.md` above) are just normal
relative/`wiki:`-style links -- `open()` lists them cheaply via `links`, and
`read()`/`skills-read` can follow them through the same wiki mechanism as any
other page. They are never eagerly concatenated into the skill body.

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
step, not any caller. Multi-word queries are matched as an OR of significant
terms against `wm.search()`/`searchSelected()` (each term is still a real call
into the existing engine -- results are merged by path), since a literal
multi-word substring match is unreliable without a Lucene index built.

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
`toolPrefix` can namespace the tools if the client also has an unrelated
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
mini-a.sh useskillwiki=true usewiki=true wikiroot=./team-wiki goal="..."
```

This exposes a `skillwiki` tool to the LLM (operations: `context`, `search`,
`recommend`, `open`, `read`, `related`, `compose`, `resolve`) through the same in-process
`MiniUtilsTool` mechanism as the existing `wiki`/`graph` tools -- no MCP loopback
required. Consultation is bounded per agent run:

- `skillsmaxloaded` (default 3) -- distinct skills that may be `open()`-ed.
- `skillsmaxchars` (default 12000) -- total skill-body characters `read()` may return.
- `skillsautolimit` (default 5) -- max results per automatic search, once auto-consultation (`skillsautosearch`) is implemented against the planner in a later phase; today the tool itself is available to the LLM at any time and is bounded the same way whether the model reaches for it directly or a future planner hook does.

From the console:

```
/skills search postgres index tuning
/skills recommend diagnose slow postgres queries
/skills open wiki:postgres-index-review.md
/skills read wiki:postgres-index-review.md Diagnosis
/skills related wiki:postgres-index-review.md
/skills compose wiki:postgres-index-review.md
/skills context
```

These subcommands only activate when a skill library is actually configured
(`useskillwiki=true`, or an active agent with one already set up) -- otherwise
`/skills <word>` falls through unchanged to the original local-skill
prefix-filtered listing, so no existing user needs to change anything.

### Resolving a skill for execution

Discovery and execution are kept strictly separate (never treat a search result
as trusted instructions before it's explicitly selected). `skillwiki`'s
`resolve` operation (backed by `MiniAWikiSkillProvider.prototype.resolve`) turns
a chosen skill into the same shape `__miniALoadSkillTemplateDocument` produces
for a local `SKILL.md`/`SKILL.yaml` -- `bodyTemplate` plus `meta` -- so it can be
rendered with the existing `{{args}}`/`{{argv}}`/`{{arg1}}` machinery
(`__miniARenderSkillTemplate`) instead of a parallel remote-execution path.

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

## Scale

`skills-context`'s skill count and un-queried `search()` (tag/appliesTo-only
browsing) both rely on the wiki's per-page metadata cache (`_metaFor`), which is
itself sharded and mtime/size-invalidated -- cheap once warm, but a genuinely
cold multi-hundred-thousand-page corpus will take real wall-clock time on first
touch, same as `context()`'s existing `pages.length` count does today. A
Lucene-backed `wikiroot` (the default once a wiki has been searched/reindexed
once) keeps `search(query)` itself fast regardless of corpus size; only the
metadata-cache warm-up is O(pages).

`tests/skills.yaml` covers correctness at a handful of pages across two mounts.
Generating and measuring a synthetic 10k-100k page corpus (index time, index
size, search latency, MCP response size) is a good follow-up benchmark script,
not something this test suite runs in CI.

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
  ratings), dependency resolution, adaptive paging, signed skills.** The ranking
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
