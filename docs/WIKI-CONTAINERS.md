# Serving wikis and skills from containers

This guide runs Mini-A's wiki and skill MCP servers as long-lived containers. One container serves several wikis through `wikimounts`, a second one serves a skill library, and an optional Mini-A agent container uses both. [WIKI.md](WIKI.md) and [VIRTUAL-SKILLS.md](VIRTUAL-SKILLS.md) are the reference for the settings used here.

## Layout

```text
/srv/wikis                      host folder, one sub-folder per wiki
├── platform/                   each one a normal Mini-A wiki (index.md, pages,
├── runbooks/                   .mini-a-wiki-lucene/, .mini-a-wiki-graph/, ...)
├── openaf/
└── skills/                     a wiki of skill documents
```

| Service | MCP job | Serves | Port |
| --- | --- | --- | --- |
| `mcp-wiki` | `mcps/mcp-wiki.yaml` | All wikis, each as a named mount | 12346 |
| `mcp-skills` | `mcps/mcp-skills.yaml` | The skill library | 12347 |
| `mini-a` *(optional)* | `mini-a` web UI | An agent using the same wikis and skills | 12345 |

## 1. Build indexes and graphs first

Both MCP containers mount the wiki folder read-only, and read-only wikis never build or update indexes ([WIKI.md](WIKI.md#backends-and-access)). Build the Lucene index, the Retrieval V2 passage index and the graph for every wiki **before** starting the containers. Without them a wiki still works, but slower and less precisely: search falls back with a `v2-build-required` warning and graph hints are missing.

From the host, for each wiki folder:

```sh
for w in /srv/wikis/*/; do
  ojob utils/wikiOps.yaml operation=wiki.reindex wikiroot="$w" wikiaccess=rw confirm=true \
    wikilexical="(ngrams: true, shingles: true, queryExpansion: true, pseudoRelevanceFeedback: true)"
  ojob utils/wikiOps.yaml operation=graph.build wikiroot="$w" wikiaccess=rw confirm=true \
    params="(extraction: structural)"
done
```

- Use the same `wikilexical` value at build time and in the containers. Read-only V2 readers adopt the published analysis by default (`wikiretrievalconfig` `readPolicy: auto`), but query-time options only help if the index was built to match.
- `extraction: structural` makes no model calls. Use `extraction: semantic` (with `OAF_MODEL` set) for `concept:` nodes, which also improve cross-wiki joins (`wikigraphcross`).
- `mini-a wikihydrate=true` and `mini-a wikidream=true` build the same artifacts as part of ingestion or reorganization ([WIKI-QUICKSTART.md](WIKI-QUICKSTART.md)).
- Stop the containers (or accept a brief inconsistency) while rebuilding. Then restart them so read-only processes drop their cached index generations and mount graphs.

A writable agent container that mounts the same folder (the `mini-a` service below) can do this maintenance instead of the host.

## 2. Compose file

```yaml
x-wiki-mounts: &wiki-mounts >-
  wikimounts=[(name: platform, label: 'Platform docs', root: /wikis/platform)|(name: runbooks, root: /wikis/runbooks)|(name: openaf, root: /wikis/openaf)]

x-wiki-lexical: &wiki-lexical >-
  wikilexical=(ngrams: true, shingles: true, queryExpansion: true, pseudoRelevanceFeedback: true)

services:
  mcp-wiki:
    image: openaf/ojobrt:edge-t8
    container_name: mcp-wiki
    restart: always
    command:
      - 'onport=12346'
      - 'label=Team wikis'
      - *wiki-mounts
      - 'usewikigraph=true'
      - 'wikigraphsearchhints=true'
      - 'wikigraphmounts=true'
      - 'wikigraphcross=true'
      - 'wikiretrievalv2=true'
      - *wiki-lexical
    ports:
      - "12346:12346"
    volumes:
      - /srv/wikis:/wikis:ro
    environment:
      OPACKS: mini-a,Lucene,oJob-common
      OJOB: /openaf/mini-a/mcps/mcp-wiki.yaml
      OJOB_MCP_MODERN: "true"
      OJOB_MCP_AUTH_TOKEN: ${WIKI_MCP_TOKEN:-}

  mcp-skills:
    image: openaf/ojobrt:edge-t8
    container_name: mcp-skills
    restart: always
    command:
      - 'onport=12347'
      - 'label=Team skills'
      - 'wikibackend=fs'
      - 'wikiroot=/wikis/skills'
      - 'usewikigraph=true'
      - 'wikiretrievalv2=true'
      - *wiki-lexical
    ports:
      - "12347:12347"
    volumes:
      - /srv/wikis/skills:/wikis/skills:ro
    environment:
      OPACKS: mini-a,Lucene,oJob-common
      OJOB: /openaf/mini-a/mcps/mcp-skills.yaml
      OJOB_MCP_MODERN: "true"
      OJOB_MCP_AUTH_TOKEN: ${SKILLS_MCP_TOKEN:-}
```

How it works:

- The `openaf/ojobrt` image installs the opacks listed in `OPACKS` at startup and runs the job named in `OJOB`. Each `command` entry is passed to that job as one `key=value` argument, so values containing spaces or SLON need no extra quoting.
- `mcp-wiki` has no `wikiroot`, so its primary wiki is a generated, read-only catalog whose `index.md` links to every mount ([WIKI.md](WIKI.md#core-operations)). Clients call `context()` to list the wikis, then pass `wiki: "<mount name>"`, a list of names, or `"*"` (the default, which searches all of them). See [MCP multi-wiki selection](WIKI.md#mcp-multi-wiki-selection).
- A mount without `backend` uses `fs`. Add `label`, `description` or a per-mount `wikisourceurl` to give clients better catalog entries and citation links.
- `wikigraphmounts` and `wikigraphcross` add related-page hints across wikis at query time only. Nothing is written back to any wiki ([WIKI.md](WIKI.md#cross-wiki-graph-connections)).
- `mcp-skills` serves one skill library. It also accepts `wikimounts` for several libraries, with a `wiki` selector on `search`/`recommend` ([VIRTUAL-SKILLS.md](VIRTUAL-SKILLS.md#using-it-as-an-mcp-server)). Use `mcps/mcp-skills-safe.yaml` or `mcps/mcp-wiki-safe.yaml` instead for untrusted clients.
- `OJOB_MCP_AUTH_TOKEN` turns on bearer-token auth when set; left empty, the server has no auth ([Authenticating HTTP MCP servers](../mcps/README.md#authenticating-http-mcp-servers)). Set it whenever the port is reachable from outside the host, and keep the tokens in an `.env` file rather than in the compose file.

Check that both are up:

```sh
oafp in=mcp data="(type: remote, url: 'http://localhost:12346/mcp', tool: context, params: ())"
oafp in=mcp data="(type: remote, url: 'http://localhost:12347/mcp', tool: context, params: ())"
```

With auth enabled, add `auth: (type: bearer, token: '...')` to the `data` map.

## 3. Use them from clients

Any MCP client connects over streamable HTTP, for example `http://localhost:12346/mcp` and `http://localhost:12347/mcp` from the host, or `http://mcp-wiki:12346/mcp` from another container on the same compose network. If a client already has generic `search`/`read` tools, pass `toolPrefix=wiki-` or `toolPrefix=skills-` to the server to keep the names apart.

A Mini-A agent can use the servers remotely:

```sh
mini-a goal="How do we rotate the platform certificates?" \
  mcp="[(type: remote, url: 'http://localhost:12346/mcp')|(type: remote, url: 'http://localhost:12347/mcp')]"
```

or open the same folders directly, as an agent container that also does maintenance:

```yaml
  mini-a:
    image: openaf/ojobrt:edge-t8
    container_name: mini-a
    restart: always
    command:
      - 'onport=12345'
      - 'usewiki=true'
      - *wiki-mounts
      - 'usewikigraph=true'
      - 'wikigraphmounts=true'
      - 'wikigraphcross=true'
      - 'wikiretrievalv2=true'
      - *wiki-lexical
      - 'useskillswiki=true'
      - 'skillwikiroot=/wikis/skills'
    ports:
      - "12345:12345"
    volumes:
      - /srv/wikis:/wikis
    environment:
      OPACKS: mini-a,Lucene,oJob-common
      OJOB: /openaf/mini-a/mini-a-web.yaml
      OAF_MODEL: ${OAF_MODEL}
```

- Keep the skill library out of `wikimounts` when it is already `skillwikiroot`. Otherwise skill pages also appear in ordinary wiki search results.
- This agent's volume is writable, so it can run `/wiki reindex` and graph builds, or dreams, for the wikis that the read-only MCP containers serve.
- Use `webtoken` (from an `.env` value) whenever the web UI port is reachable from outside the host.

## Troubleshooting

- **`v2-build-required` or no graph hints for one mount:** that wiki was never built or its build is outdated. Run step 1 for it, then restart the containers. `context(wiki: "<name>")` shows the retrieval status for that one wiki.
- **A mount is missing from `context()`:** check the container log for `mount failed for @<name>`. Invalid mount configuration is reported at startup. Mount paths are container paths (`/wikis/...`), not host paths.
- **Slow startup:** `OPACKS` are installed when a new container starts. Build an image with the opacks preinstalled when startup time matters.
- **Writes refused:** expected. `mcp-wiki.yaml` and `mcp-skills.yaml` are read-only and the generated catalog rejects writes. Use `mcps/mcp-wiki-ops.yaml` or a writable agent for maintenance.
