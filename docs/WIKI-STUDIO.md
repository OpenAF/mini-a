# Mini-A Wiki Studio

Wiki Studio is a separate, local, single-operator application. It does not change
the chat UI or the oPack's main command. Markdown and Mini-A's engine artifacts
remain authoritative; Studio keeps its registry, jobs and snapshots outside wikis.

This first implementation provides the local filesystem workflows below. It is
**not full acceptance of every feature in the original Studio specification**.
Unsupported adapters/backends are explicitly disabled, and verification limits are
listed at the end rather than represented as working integrations.

## Start without a model

Requirements: an OpenAF installation with oJob, the JVM `jdk.httpserver` module,
POSIX filesystem permissions/file locks, and a supported modern browser. Node is
used only by development tests. No model or Internet connection is needed to
start, register wikis, edit, search, export a graph or run maintenance plan.

Create a dedicated parent directory for allowed wiki roots, then run:

```sh
mkdir -p /private/tmp/studio-demo/wikis
ojob /path/to/mini-a/mini-a-wiki-studio.yaml \
  onport=8890 studiohome=/private/tmp/studio-demo/state \
  studioallowroots='["/private/tmp/studio-demo/wikis"]'
```

Use the absolute path to the installed oPack's job when launching outside its
directory. Libraries and assets are anchored to that job's bundle, even when a
different Mini-A version is installed. Updating the oPack requires restarting
Studio and reopening the browser; do not replace production files under workers.

Open `http://127.0.0.1:8890`. A fresh 256-bit bearer token is printed once at
startup and is valid for that process. For a stable token, configure the trusted
`STUDIO_TOKEN` environment variable with at least 32 high-entropy characters.
Do not put credentials in arguments, URLs or bookmarks. The browser retains the
token in memory only; reload requires signing in again. Tokens are not saved in
the registry/configuration. Securely manage any local terminal output yourself.

The listener binds an explicit `InetSocketAddress("127.0.0.1", port)` using the
JVM streaming HTTP server. OpenAF's own `httpd.start(port, host)` also supports an
explicit host; Studio uses the JVM interface to bound input while streaming.
Non-loopback binding is rejected. Host and Origin must match the local listener.
This release does **not** provide remote-origin/proxy trust configuration. Use a
local browser or a trusted local tunnel retaining the loopback origin; do not
expose it publicly or strip Origin checks to make a remote proxy work. A future
HTTPS proxy mode needs an explicit allowed public origin and proxy trust policy.

## Architecture and persistent state

```mermaid
flowchart LR
  UI[Static browser UI] -->|Bearer headers| API[Versioned HTTP adapter]
  API --> Registry[Atomic registry and capability guards]
  API --> Pages[Short-lived MiniAWikiManager readers and edits]
  API --> Queue[Durable jobs and events]
  Queue --> Worker[Fixed isolated oJob worker]
  Worker --> Engines[MiniAWikiOps / ingest / absorb / dreams]
  API --> Graph[Existing utils/wikiGraph.yaml exporter]
  Worker --> Backups[Verified ZIP snapshots and restore journal]
```

The cohesive modules are `wiki-studio-{common,config,registry,api,pages,graph,
sources,jobs,operations,backups,ingestion,bootstrap}.js`. Both YAML entrypoints and
all production assets are included in `.package.yaml`. The canonical entrypoint
is the oJob; no `wikistudio=true` console-parser change is introduced.

State under `studiohome` includes `config.json`, `registry.json`,
`sources/records/<wikiId>/<sourceId>.json`, `sources/uploads/`,
`jobs/<UUID>/{job.json,events.ndjson,result.json,before.json,after.json,changes.json}`,
`graph-cache/`, `backups/<wikiId>/<backupId>/`, `locks/` and daily `audit/` files.
Directories are owner-only. JSON is written to a private temporary file, fsynced,
then atomically renamed. This covers process crashes; parent-directory fsync and
power-loss durability have not been established on all filesystems.

When upgrading from flat `sources/<wikiId>--<sourceId>.json` records, **stop
admitting requests, drain all old workers, then stop Studio before installing and
restarting this version**. Wiki locks now use `wiki-<wikiId>` names; mixed old/new
workers must never run concurrently because their locks do not coordinate.
Before starting its scheduler, Studio atomically copies legacy registrations using
their embedded wiki/source identifiers. Valid records already in the new layout
win, and an interrupted migration can restart. Legacy files and uploaded revisions
are retained. IDs, upload revisions and engine `ingestsourceid` provenance remain
unchanged. Review `sources/records/migration-report.json` and startup warnings:
registrations already overwritten by a legacy filename collision cannot be
reconstructed from that filename. Restore a verified record or register a fresh
upload; Studio reports missing registrations identified by upload seals without
guessing their contents.

## Wiki lifecycle and capabilities

Use **Add Wiki** to register an existing root or create a new directory. Roots must
be absolute, canonical, beneath an explicitly configured `studioallowroots`
directory, outside Studio state, and disjoint from registered roots. Registration
does not initialize existing content. Creation calls Mini-A's supported init.
Symlinks, hard-linked files, root identity changes and hidden page paths are
rejected. Use canonical paths on macOS (for example `/private/tmp`, not `/tmp`).

Next to **Absolute root**, **Browse…** opens a folder picker limited to the
configured `studioallowroots`. It shows only visible, non-linked sub-folders.
Folders already registered (or overlapping a registered wiki) are badged and
cannot be picked, and folders that already contain `index.md` are marked. **New
folder** only proposes a path: nothing is written until you click **Add wiki**,
which then creates the folder (and any missing parents) and initializes it, so
abandoned picks leave no empty directories. Studio decides between "register
existing" and "create" from whether the path exists. New folders require `rw`.
Choosing a folder fills an empty Stable ID and Display name from its name.
Before you add or re-point a wiki, the picker summarizes an existing folder by
name only: Markdown page and folder counts, and whether it already has
`index.md`, `AGENTS.md`, a search index or a graph. In the folder list,
Up/Down move, Right or Enter opens, Left or Backspace goes up a level, and
Home/End jump. The last browsed folder is remembered for the browser session
(`sessionStorage`) and used when the root field is empty.

**Change root** (in Settings, or on the dashboard when a wiki's folder is missing
or was replaced) re-points a registration at another existing folder beneath an
allowroot. Files are not moved or copied. Studio records the new filesystem
identity and keeps `previousRoot` in the registry entry. A wiki's own current
root never counts as an overlap, and new (virtual) folders are not offered.

### Search modes

The Pages view's **Search with** selector works for one wiki or all registered
wikis:

- **Index**: the full-text search index (`wiki.search`), as before.
- **Graph**: pages that the knowledge-graph snapshot links to matching concepts
  or page metadata (`graph.retrieve`). This needs graph enabled in Settings and a
  built snapshot (Maintenance → build graph). Otherwise coverage reports
  `unavailable` with the reason; the request does not fail.
- **Combined**: both rankings merged by reciprocal rank fusion keyed on page
  path. Each hit is tagged `index`, `graph` or `index + graph`, and its graph
  explanations appear on hover. Raw scores from the two engines are never
  compared.

Graph and combined modes rank at most the top 200 pages per wiki, so paging
stops there. Change root is refused (423) while the wiki has queued or running
jobs, because jobs record the root when they are submitted.

Settings supports display-name and ro/rw changes. Unregister removes only the
registry entry; it never deletes wiki data. Graph enabled/disabled is also
available through PATCH. Lexical configuration editing is not exposed yet.

| Backend | Browse/search | Edit | Graph HTML | Ingest/dream/absorb/restore |
| --- | --- | --- | --- | --- |
| Registered fs directory, rw | Yes | Yes | Yes | Yes, with operation gates |
| Registered fs directory, ro | Yes | No | Yes, cache outside wiki | No |
| Archive, HTTP, S3, ES, mounts | Disabled in Studio | No | No | No |

Mini-A's CLI/MCP readers still support their existing non-fs backends and mounts.
Studio does not accept connection credentials or promote mounts into rw roots.
`/session` and each wiki response expose the supported capabilities and reasons.
One v1 token maps to admin. Central guards already distinguish viewer, editor and
admin; per-wiki ro overrides mutation privileges. Separate role tokens are not
configured in this release.

## Pages and graph

Pages offers a bounded collapsible folder tree, paginated path list, search, raw editor, safe preview, frontmatter,
outgoing links and backlinks. The textarea is deliberately dependency-free; this
release does not bundle CodeMirror. HTML is rendered as text, images/media are
not embedded, and only HTTP(S) links or resolved local page buttons are active.
The small renderer supports headings, code blocks and wiki/Markdown links; it is
not a full CommonMark renderer. Mount links show an unavailable message.

GET page returns **complete** UTF-8 content, SHA-256 of raw bytes and metadata,
or a size error; it never disguises a bounded agentic read as a complete page.
Saves require the expected revision and return 409 on mismatch. Local edits are
retained for comparison/merge. Typing can continue during a save; repeated keyboard
saves join that request. A successful response advances the server revision while
keeping newer text dirty and editable. Save again to publish those newer edits. Frontmatter comments and newline style survive
Studio writes through the manager's opt-in `preserveRaw` option. Other manager
callers retain existing serialization behavior. Invalid frontmatter blocks save.
Move/delete use manager semantics and create a full snapshot first. Moves preserve
existing link/index handling. Source-managed metadata is displayed where present;
future ingestion may conflict with manual edits and must not silently overwrite
them. Search preserves the engine's partial-coverage warnings: no result does not
establish absence. All-wiki search coordinates up to 20 registered wikis and reports per-wiki coverage, namespaced results and omitted wikis. Page history is not provided.

Graph uses `utils/wikiGraph.yaml`, not a second graph engine. Generated HTML is
cached outside the wiki under a content-and-graph fingerprint, with at most three
cached HTML exports per wiki. External changes invalidate the cache on export.
Persisted snapshots are labelled knowledge graph; without one the exporter scans
Markdown links. Snapshot presence alone does not establish freshness or semantic
extraction. Graph rebuild defaults to `semantic=false`.

HTML is fetched with an auth header, converted to a Blob and displayed in an
`allow-scripts allow-downloads` sandbox with no same-origin permission. Its CSP
denies network connections. Fixed renderer script/style nonces satisfy the parent
CSP inherited by Blob documents. Node events carry a versioned schema; the parent
checks source window, opaque origin, document ID and safe Markdown path before
opening the page. Concept nodes do not navigate. The standalone exporter remains
offline-compatible. **Download offline HTML** and the Pages list are alternatives
when a browser blocks sandboxed Blob frames. The in-app browser used during this
implementation did not render the Blob iframe; no visual graph success there is
claimed. Exporter and simulated DOM node-navigation tests pass.

## Sources, uploads and incremental hydration

Select the destination wiki first. Sources supports browser directory selection
and ZIP upload, staged file inventory, stable source IDs, immutable upload
revisions and bounded lineage. Reuse the source ID for a later uploaded revision.
Registrations are scoped to the selected wiki and verify their embedded ownership
on reads. Publication and run-status updates share a source lock; an older job
cannot replace the status or revision of a newer registration. Upload quota checks
traverse file metadata without re-reading previous uploads. Sealing and ingestion
still hash all source bytes.

The **Wiki folder** box in step 3 sets where imported pages go. It defaults to the
stable source ID (not the internal upload directory name). Type a folder path such as
`talks/2026`, or use **Choose folder…** to pick or create one in the wiki tree. An
empty field uses the source ID; the wiki root cannot be used. Below the field, Studio
lists the expected page paths for new pages. **Preview changes** confirms them.
Source layout (Advanced options) preserves uploaded folder paths beneath that folder;
flat layout puts every page directly in it. The source name is a display label only.

For **YouTube captions**, the optional **Markdown file name** sets the page name
(default `youtube-<video id>.md`). It is lower-cased with the same slug rules
ingestion uses for page names (`My Talk` → `my-talk.md`). `index`, `log` and
`AGENTS` are reserved. Existing pages are not moved automatically; to keep updating
an older import under `files` (or `expanded` for ZIPs), explicitly use that section.

Stage first, then choose Preview or Apply; filenames never select a destination.
Preview is the ingestion engine's dry run, not a guaranteed model-generated diff.
Auto/normalize/raw/distill, source/flat layout, section, include/exclude, prune and
explicit semantic settings map to the existing bounded engine. `maxfilesize` is
translated to HEAD's `ingestmaxfilekb`; selected file-count limits are checked by
Studio before dispatch. Raw mode is useful for the model-free walkthrough.

Uploads stream one file per request to disk. Limits: 8 MiB per Markdown/text/PDF,
20 MiB per ZIP, 2,000 entries, 64 MiB expanded batch, depth 16, expansion ratio 100.
ZIP preflight rejects encrypted/special/symlink entries, traversal, duplicate
case-folded paths, unsupported members, ZIP64 and multipart archives. Extraction
checks actual byte counts and CRC. Imported scripts are never executed. PDF
ingestion depends on the converters available to the existing engine; staging
acceptance does not promise successful conversion. ZIPs containing other file
types must be filtered before upload. Upload resume/TTL cleanup is not implemented.

For operator-allowlisted local folders or existing Git checkouts, add:

```text
studiosourcedirs='[{"id":"docs","path":"/data/source-checkout"}]'
```

Sources then offers that named directory. The browser supplies only its ID, never
an arbitrary source path. Intake snapshots visible `.md`, `.txt` and `.pdf` files;
hidden state/instructions and other formats are skipped. It does not execute Git
hooks, update the checkout or infer a remote commit. Refresh the checkout outside
Studio, then create a new source revision with the same source ID.

**Webpage and YouTube-caption adapters** fetch from the Studio server using
`js/studio/wiki-studio-outbound.js`, a bounded transport: only `http`/`https` on ports 80/443,
no URL credentials, the host is resolved once and every answer must be a public
address (loopback, link-local/metadata, private, CGNAT, multicast, documentation and
mapped ranges are refused), the socket connects to that resolved IP (no second DNS
lookup, so rebinding cannot swap it) while TLS still verifies the original host name,
redirects are followed manually (max 5) and re-validated per hop, responses are
capped at 5 MiB, and the whole request has a 30 s deadline. Any public host is
allowed; there is no operator host allowlist. Pages are converted with the installed
`mdconvert` oPack (HTML only; text/Markdown pass through) into one Markdown file with
`Source:` and `Retrieved:` lines. YouTube retrieves existing captions only (manual
preferred, then automatic; no speech-to-text) from fixed YouTube hosts, mirroring
the `ytTranscript.yaml` recipe. Both are staged as a normal source revision
(`type: web|youtube`, with `origin`), and ingested only after Preview/Apply.
API: `POST /sources {id,name,type:"web",url}` or `{type:"youtube",video,lang}`.
**Remote Git clones remain disabled**: a `git` subprocess cannot use the pinned
transport. Upload a reviewed checkout or ZIP, or use `studiosourcedirs`.

Apply snapshots the destination first and uses a stable namespaced
`ingestsourceid`. The engine retains conflicts, receipts, journals and incremental
ownership. A partially blocked import is reported partial. Prune is always opt-in;
empty-source destructive authorization is not exposed. No force-overwrite option
is exposed. Ingestion recovery list/resume/discard is available through the
ingestions endpoint with `action` and optional `recoveryId`; discard is not rollback.

## Absorption

Absorb selects other registered fs wikis and optional paths/tags/topic/exclusions.
Studio constructs the source roots; clients cannot send absorbspec roots. Plan,
show, status, apply, resume, delete and cancel use the existing saved-plan engine.
Inspect the plan/job result before apply. Applying/resuming requires explicit
confirmation, a Studio-generated completed plan and a verified destination
snapshot. Source identities are rechecked and source Studio locks held. The
engine enforces stale-plan checks, skill preservation and journal recovery.
Deleting/cancelling a saved plan never undoes pages already written. Plan may
need a configured model; apply reuses the saved plan rather than regenerating it.
Real-model synthesis was not tested by this implementation.

## Exporting a wiki

Maintenance → **Export** creates a ZIP of the wiki's pages plus the validated search index and graph for use on other Mini-A instances (for example, unzip it and upload everything to an S3 prefix; see [Exporting a wiki to a ZIP](WIKI.md#exporting-a-wiki-to-a-zip)). By default the index is one nested `mini-a-wiki-index.zip`; tick *Keep index folders loose* to store the index folders directly instead. Exports are admin-only, work on read-only wikis, never change the wiki, and need a published index (reindex first) and no pending ingestion.

The job writes to `<studio home>/exports/<wiki>/<job>/` and the UI downloads it through an authenticated streaming route. The five most recent exports per wiki are kept; others can be deleted from the same tab.

- `POST /api/v1/wikis/{id}/exports` body `{"nobundle":false}` (Idempotency-Key required) → job
- `GET /api/v1/wikis/{id}/exports`, `DELETE /api/v1/wikis/{id}/exports/{exportId}` with `{"confirmation":"{exportId}"}`
- `GET /api/v1/wikis/{id}/exports/{exportId}/download` → `application/zip` (bearer header; the token is never accepted in the URL)

## Dreams, backups and recovery

| Mode | Meaning | Studio safeguards |
| --- | --- | --- |
| plan | Model-free maintenance diagnostics | Read-only manager; full file-manifest equality checked; semantic rejected |
| auto | Existing diagnose/repair engine | Preview default; snapshot before mutating run |
| apply | Repair/navigation/index/graph maintenance | Snapshot; semantic off by default |
| repair | Existing lint repair | Snapshot |
| indexes | Regenerate directory index.md pages | Snapshot even though the utility default does not cover this mode |
| reindex | Rebuild search artifacts | Exclusive Studio lock |
| graph | Structural graph, optional semantics | Semantic off by default |
| reorg | Live LLM structural changes | Admin confirmation; verified snapshot; all existing reorg gates |

Reorg is not an immutable plan/apply contract. Maintenance plan must never be
described as its exact preview. Configure trusted `OAF_MODEL` in the server
environment only for model-dependent work; credentials are inherited by workers,
not persisted in jobs. Per-operation model presets/cost estimates are not offered;
the supported explicit model step budget is 1–100. No cost is invented.

Mutating batch dreams/imports/absorption/restore cannot start without a verified
backup. Mini-A's ZIP helper includes the full wiki, including hidden engine state;
Studio adopts the archive into its protected backup inventory only after
archive/member SHA-256 verification and unchanged-root checks. It does not produce
another automatic utility backup. The archive is a snapshot, never an editable
reorg plan. Before/after manifests report created/deleted/modified paths, hashes,
bounded unified replacement hunks and equal-hash move **candidates**. Large-file
diffs are explicitly truncated. Failed pre-finalization work may have no finalized
comparison; inspect the snapshot and engine journal locally.

Restore requires the selected wiki's backup ID, current full-tree fingerprint and
explicit offline confirmation. It creates a pre-restore snapshot, verifies and
extracts into a sibling directory, checks the extracted manifest, then renames
the live root aside and activates the validated tree. The former live tree remains
as `.studio-replaced-<jobId>` for local recovery; it is never silently deleted.
The registry inode is updated only after activation. Check search/graph health and
reopen all readers afterwards. File modes are not fully preserved; private
directories protect restored content. Snapshots cannot roll back external models,
services or remote data.

A process crash between the two renames can leave a restore journal requiring
manual recovery. Stop Studio and all external processes. Inspect
`jobs/<jobId>/restore.json` and the tracked pre-restore backup. If the original
root is absent and `replaced` exists, rename `replaced` back to the registered
root. If both exist before registry finalization, preserve the activated root at
another unused sibling path and put `replaced` back. This restores the original
root identity. Never overwrite/delete either tree to make the error disappear.
Validate the recovered content before restarting. Automated crash-interrupted
restore recovery is not implemented; successful restore and failed preflight are
tested, but crash-injection across every rename boundary is not.

## Jobs, locks, health and limits

Jobs are acknowledged only after persistent state/events. Two isolated workers
can progress across distinct wikis; each wiki has one exclusive Studio OS lock.
Short readers close their managers. Queued/running maintenance blocks Studio page
reads/edits; offline compaction/restore holds the lock for the whole operation.
Absorption also locks its sources. These locks do not stop arbitrary external
CLI processes. **Stop external readers/writers before compaction, restore and
structural operations.** Pending known ingest/absorb journals block manual saves.

State progresses through queued, acquiring-lock, preflight, backup, running,
refreshing and terminal completed/partial/failed/recovery-required. Server restart
marks nonterminal jobs interrupted; it never automatically replays them. An old
worker may still finish while holding its OS lock. Inspect engine recovery before
explicitly submitting a new job. Cancellation immediately cancels a queued job;
active engines lack safe abort checkpoints, so only a cancellation request is
recorded and they may complete with writes. There is no force-stop UI or claim of
undo. Child process stdout/stderr is discarded; structured engine callback logs
are retained/redacted. This is not a promise to capture every library print.

The processing banner offers **Cancel requests**, including while request details
are collapsed. Expand the details to cancel an individual request. Queued requests
are removed before sending; active requests and uploads stop waiting in the browser.
Server work already started may continue, and cancellation does not undo writes.
Check Activity before retrying a change whose response was cancelled. Background
jobs have a **Request cancellation** button beside **View activity** and in their
details; this uses the job cancellation behavior described above.

Events use authenticated finite SSE replay responses with cursor/Last-Event-ID
and a heartbeat comment; the UI fetches/reconnects and deduplicates sequences.
There is no EventSource URL token. Each event log is capped at 1 MiB, result at
approximately 1 MiB, browser event display at 100,000 characters. Terminal status
is calculated from the complete engine result before retention truncation; stored
summaries keep outcome fields, so partial and cancelled runs remain distinct and
recovery-dependent history remains protected. Job inventory
stops at 1,000 records. Wiki scans stop at 20,000 files/512 MiB/16 MiB per file;
editor pages at 1 MiB; embedded graphs at 5,000 nodes/30,000 edges/8 MiB output.
These are fixed v1 bounds, not a configurable quota/retention UI.

Overview/Health shows actual engine context/lint, published-index presence,
graph statistics/source, full revision fingerprint and known pending journals.
Missing freshness/semantic/model metrics remain unknown. Dreams provides manual
reindex, graph, directory-index regeneration and explicitly offline compaction.
Jobs/Sources/Backups show persistent history. No automatic health repair runs.

Audit covers authenticated mutation attempts without bodies/query secrets. Daily
audit files stop at 8 MiB. Graph cache evicts old exports; other jobs, backups and
staging are deliberately not automatically deleted, so recovery references cannot
expire silently. Stop workers and archive terminal job/staging/audit directories
locally after checking backup/journal references. Configurable retention, global
disk quotas, abandoned-upload cleanup and a reviewed cleanup UI remain follow-up
work. Secure state and backup locations like the wikis themselves.

## HTTP API examples

All data endpoints require `Authorization: Bearer <STUDIO_TOKEN>` and return JSON
UTF-8 or the documented HTML/SSE type. Errors use
`{error:{code,message,details?},requestId}` with status codes. Lists use bounded
offset/limit, normally at most 200. There is no shell or generic oJob endpoint.
Job creation requires an `Idempotency-Key`; same key/wiki/operation/payload returns
the original job, while a different payload conflicts. Registration/page creation
uses ID/path conflicts rather than persistent idempotency replay.

```sh
curl -H 'Authorization: Bearer <STUDIO_TOKEN>' http://127.0.0.1:8890/api/v1/wikis
curl -H 'Authorization: Bearer <STUDIO_TOKEN>' \
  'http://127.0.0.1:8890/api/v1/wikis/example/page?path=index.md'
curl -X POST -H 'Authorization: Bearer <STUDIO_TOKEN>' \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: example-plan-001' \
  -d '{"mode":"plan","options":{"semantic":false}}' \
  http://127.0.0.1:8890/api/v1/wikis/example/dreams
```

Routes: `/health`, `/session`, `/wikis` (GET/POST), `/wikis/:id`
(GET/PATCH/DELETE unregister); under a wiki: `/overview`, `/tree`, `/pages`,
`/page`, `/pages/move`, `/folders` (POST, creates `<path>/index.md`), `/selection/{preview,move,delete}`, `/search`, `/backlinks`, `/lint`, `/graph/stats`,
`/graph/related`, `/graph/html`, `/graph/rebuild`, `/sources`, `/ingestions`,
`/absorptions`, `/dreams`, `/maintenance`, `/backups`, `/backups/:id/restore`,
`/changes?jobId=...`; globally `/uploads`, `/jobs`, `/jobs/:id`,
`/jobs/:id/events`, `/jobs/:id/cancel`, `/audit`. Methods match their read/write
purpose. Upload uses raw file bytes with `X-Upload-ID: <UUID>` and percent-encoded
relative `X-Upload-Path`, then a source registration seals the batch. This is a
streamed-file protocol, not multipart or resumable upload.

## Walkthrough and validation

Follow [the two-wiki walkthrough](../examples/wiki-studio/README.md). The default
walkthrough makes no model calls. Optional reorg requires your configured model,
explicit confirmation, stopped external processes and verified backup. Inspect
actual changes and exercise a restore on disposable data first.

Tests: `ojob tests/wikiStudio.yaml`, `python3 tests/wikiStudioHttp.py`,
`python3 tests/wikiStudioPackage.py`, `python3 tests/wikiGraph.py`, and existing wiki/ingest/absorb/dream/graph/utility
suites. The HTTP test creates disposable directories, clears model variables and
launches real child workers from an unrelated working directory. It accepts
`--base /path/to/extracted-opack` for package smoke testing. Unit tests include an
injected deterministic restructuring engine, not live-provider quality evidence.

Implemented milestones: M0 baseline; M1 authenticated server/registry; M2 pages;
M3 exporter bridge/cache; M4 jobs/staging; M5 local hydration/absorption adapters;
M6 verified snapshots/dream safeguards/restore; M7 local UI/docs/package tests.
Remaining original acceptance items include remote adapters, connected non-fs
readers, configurable model references and
budgets, richer freshness dashboards, automatic retention, seamless interrupted
restore recovery and full browser/provider absorption/reorg coverage. The in-app
browser Blob-frame limitation is reported above. CRDT, scheduling, a new database
and an exact LLM reorg pre-approval plan are intentional non-goals.

### Test a wiki in Mini-A Web

When Studio inherits a non-empty `OAF_MODEL`, the wiki Overview offers **Open wiki test in new tab**. **Enable Advanced view** is an explicit, unchecked opt-in for trusted console controls. The child server inherits model configuration and opens the selected wiki with `wikiaccess=ro`, retrieval v2 enabled, and `useshell=false`. Each wiki/view-mode pair reuses its running test server; child servers stop when the Studio process exits normally. Allow browser pop-ups for Studio. Startup reports an error if the server does not listen within 30 seconds.

**Build web command**, available on the wiki dashboard and Overview, opens a command-preview wizard even without a configured model. Select one or more registered wikis, choose a port and mode (`webini` by default), and optionally enable Advanced view. A single wiki uses `wikiroot`; multiple wikis use named read-only `wikimounts`. The copyable `ojob` command uses this installation's `mini-a-web.yaml` and quotes arguments for macOS/Linux shells. Run it in a terminal with `OAF_MODEL` configured. Generating or copying the command does not execute it.


## Task-oriented workspace

Opening a wiki starts in **Pages**. Expand folders in the Explorer-style sidebar,
select a file to read it, and choose **Edit** to change Markdown. Arrow keys,
Home/End, Enter and type-ahead navigate the tree. Folder contents load in pages of
100, including empty folders. Search results retain the tree and offer **Reveal
in tree**. The Graph viewer is available from the Pages toolbar.
Drag the divider between the tree and the page view to resize the sidebar (or
focus it and use Left/Right, Shift for larger steps, Home/End for min/max,
Enter or double-click to reset). The width is remembered per browser.

The main navigation groups existing capabilities into Overview, Pages, Import,
Maintenance, Activity and Settings. Overview shows counts and current activity;
Maintenance separates health findings, engine tasks, backups and recovery.
Technical records remain available in expandable details. Local Chart.js renders
category comparisons with equivalent data tables when charts are unavailable.

### Import workflow

```mermaid
flowchart LR
  A[Choose source method] --> B[Download or upload]
  B --> C[Prepare source revision]
  C --> D[Preview changes]
  D --> E[Review results]
  E --> F[Import into wiki]
  E --> G[Change options]
  G --> D
```

Webpage and YouTube inputs each have their own adjacent download action. Source
name/ID are part of the selected method. Choose **Update source** in the library
to create another revision of an existing source, or **Delete** to remove it
from the library (`DELETE /api/v1/wikis/<id>/sources/<sourceId>` with
`{"confirmation": "<sourceId>"}`). Deletion removes the source record and all
its staged upload revisions; pages already imported stay in the wiki. It is
refused while an import of that source is queued or running. Tick **Ad-hoc
import** when adding a source to import it once without keeping it: it goes
through the same preview and import, and after a successful import its record
and staged files are discarded (API: `"adhoc": true` on `POST .../sources`).
A failed or abandoned ad-hoc source stays in the library, marked ad-hoc, until
it is imported or deleted. Preview estimates engine
changes; it is not a guarantee of identical future model output. Changing
options invalidates the preview. Application checks that the source revision is
still current. Advanced options retain modes, layout, filters, pruning and
semantic extraction. Import from another wiki retains saved Absorb plans and
all their lifecycle controls.

Submissions show background progress without replacing the current form. Open
activity details to inspect results, changed pages and processing logs. Import
forms remain in memory when moving between sections; credentials and form drafts
are not persisted to browser storage.

### History and snapshot cleanup

Activity supports individual, selected and all-eligible history deletion within
the current wiki. Confirmation lists the eligible count and protected exclusions.
Deleting history removes logs/results and frees the 1,000-job inventory limit;
it leaves wiki files, source revisions, saved plans, snapshots and audit logs.
Small receipts outside the live job inventory prevent an old request from
executing again and retain the authorization required to apply a saved Absorb
plan. A replay of a deleted request returns `410 job_history_deleted`.

Active jobs and unresolved recovery are protected. Resolve engine journals or
restore a snapshot, inspect the result, then **Mark recovery reviewed** in the job
details. This acknowledgment does not repair the wiki or delete engine journals;
the server refuses it while work or pending journals remain.

Backups lists manual/automatic origin separately from automatic verification at
creation. Both kinds can be deleted, except while active work or unresolved
recovery depends on them. Deleting the last verified backup requires an explicit
acknowledgment. Restore continues to verify the archive and create a pre-restore
backup. No automatic retention policy is enabled.

Additional HTTP interfaces (same authentication and path protections):

- `PATCH /api/v1/wikis/:id` with `{"root":"/abs/existing/folder"}`: Change root. This is the one request that skips the identity check, so a moved wiki can be repaired. `GET /api/v1/wikis` items carry `rootState` (`ok`, `missing`, `changed`, `unavailable`).
- `GET /api/v1/wikis/:id/search?q=&mode=index|graph|combined` and `GET /api/v1/search?q=&mode=...`: graph/combined hits carry `matchedBy`, `ranks`, `fused`, `explanations`. Per-engine `coverage` is included.
- `GET /api/v1/roots/browse?path=&for=<wikiId>`: `for` excludes that wiki's own root from overlap checks (Change root). `current.contents` summarizes an existing folder.
- `GET /api/v1/roots/browse?path=`: root picker. With no `path`, lists `allowRoots`. With a path beneath one, returns `current` plus up to 500 visible child directories (`items`), each with `exists`, `looksLikeWiki`, `registeredAs`, `selectable` and `reason`. Paths that do not exist are reported, never created.
- `GET /api/v1/wikis/:id/children?path=&limit=100&offset=0`: immediate folder/file entries, folders first.
- `DELETE /api/v1/jobs/:id`: `{wikiId, confirmation:"delete-history"}`.
- `DELETE /api/v1/jobs`: `{wikiId, ids:[...], confirmation:"delete-history"}`; exact IDs are confirmed, with eligibility rechecked under locks.
- `POST /api/v1/jobs/:id/review-recovery`: `{confirmation:"<job-id>"}`.
- `DELETE /api/v1/wikis/:id/backups/:backupId`: `{confirmation:"<backup-id>", acknowledgeLast:false}`; use `true` only after confirming last-backup deletion.

Job and snapshot listings include `deletion: {allowed, reason}`. Cleanup requires
an administrator. Snapshot deletion also requires an editable wiki. Existing
state needs no migration; receipts and origin metadata are written when history
is removed. A process interruption during deletion may leave disposable files
under `studiohome/deleted-history`, outside the scheduler inventory.

### Redesign verification

Run `node tests/wikiStudioUI.cjs` for tree keyboard/read/edit behavior, import
control grouping, draft retention, preview invalidation and chart fallback.
`ojob tests/wikiStudio.yaml` additionally covers cleanup permissions, recovery
protection, request replay, last-backup acknowledgment, folder pagination and
saved-plan application after deleting history. `python3 tests/wikiStudioHttp.py`
and `python3 tests/wikiStudioPackage.py` exercise real HTTP workers and packaged
assets. Browser acceptance should include dark/light themes, narrow layouts,
200% zoom, keyboard focus and external edit conflicts. Real model-driven
reorganization and live remote downloads require separate configured checks.

### Graph build controls

Graph exposes structural/semantic extraction, off/automatic model assistance, incremental/full/resume strategy, force, presets, custom budgets, and shared saved defaults. See [Graph builds](GRAPH-BUILDS.md). Semantic extraction works without models. `GET /graph/settings` displays effective defaults; `PUT /graph/settings` saves them for a writable wiki. `POST /graph/rebuild` accepts the shared build options. Graph cancellation checkpoints completed work and stops scheduling calls; an in-flight request uses its configured timeout.

## Organizing pages and folders

The Pages explorer works like a file manager:

- **New folder** creates a section (`<folder>/index.md`), so it appears in tree and browse on every backend. Use the toolbar, the folder panel, the context menu or the picker's *New folder here…*.
- **Select** pages and folders with the checkboxes, Ctrl/Cmd-click (toggle), Shift-click (range), Space (toggle), Ctrl/Cmd+A (siblings) and Esc (clear). `index.md` pages are never selectable; selecting a folder covers its content. A selection bar offers **Move to…**, **Delete…** and **Clear**.
- **Move to…** opens a folder picker. You can also **drag** the focused or selected items onto a folder (or the *wiki root* strip that appears while dragging), or use **Move N selected here** in a folder panel.
- **Right-click**, Shift+F10, the Menu key or the `⋯` button open a context menu: Open, New page/folder here, Rename / move…, Move to…, Delete…. Rename / move, Move to folder… and Delete are also available while reading a page.
- A **single page** uses the page endpoints (any writable backend). **Several items, or anything containing a folder,** run one previewed selection job: `selection/preview` lists every `from → to`, the surviving incoming links and a revision; `selection/move` and `selection/delete` need that revision (deletion also needs the typed confirmation `delete N items`), take a verified recovery snapshot, rewrite links once and publish indexes once. Selection jobs need a local filesystem wiki and an administrator, like folder jobs.

## Recursive folder operations

Select a folder in **Pages** to use **Move/rename folder** or **Delete folder**.
These administrator actions support registered local writable filesystem wikis.
The preview lists the source, destination, page/file/folder counts and surviving
pages with incoming links. Every nested file, attachment and empty directory is
included. Review the preview, and type the exact source path for deletion.

A move requires an existing destination parent and an unused destination name;
folders are never merged or overwritten, and no redirect pages are created.
Moves rewrite internal links, incoming links, relative attachment references and
ingestion ownership. Deletion preserves links in surviving Markdown so **Lint**
can report them. Root paths, protected engine state, symlinks, mounts and
read-only or unsupported backends cannot be changed.

Studio queues one durable, deduplicated background job for each operation.
The worker rechecks the preview revision under the shared wiki writer lock,
creates verified recovery snapshots, changes the subtree and publishes the final
navigation/search/graph indexes. If another edit makes the preview stale, the job
fails without changing content; preview again. On success Explorer opens the
moved folder or selects the deleted folder's parent.

Use **Activity** for progress, errors, changes and the associated snapshot.
An interrupted write or failed index/graph publication requires recovery and
blocks new maintenance. Stop other readers and writers before restoring the
verified Studio snapshot. Snapshot restoration restores the entire wiki, not
just the selected folder. The engine also retains a verified directory snapshot
beside the wiki and a pending journal inside `.mini-a-wiki-folders`; Wiki Manager's
**Restore pending folder snapshot** can roll it back using the exact recovery ID.
Reopen readers after restoration. Do not delete pending recovery files; successful
engine directory snapshots are retained until an operator removes them.


### Advanced workflow options

Studio keeps technical tuning in **Advanced options**, closed when a task opens.
The ordinary workflow works with the existing defaults. Opening Advanced exposes
numeric limits, explanations, and explicit **Save defaults for this wiki**,
**Reset to saved defaults**, and **Restore built-in defaults** actions. Defaults
are isolated by wiki and workflow; submitted jobs keep their effective settings.

- Graph builds and Dream graph share call, estimated total-token and elapsed-time
  budgets, presets, model assistance and force extraction. Graph defaults remain
  managed by the existing graph settings.
- Imports expose file count/size, chunk characters, concurrency, force reprocessing,
  distillation calls per source, estimated operation tokens and prompt tokens.
  Calls include retries/synthesis: zero permits the initial call but disables split
  recovery. Operation tokens use -1 for unlimited and zero to defer model work.
  Prompt tokens use zero for automatic context-overflow handling. These are estimates,
  not provider billing guarantees. Force is a per-run choice.
- Absorption planning exposes maximum pages and estimated aggregate model-input
  tokens. Applying or resuming a saved plan retains that plan's original settings.
- Dream Auto exposes model steps; Reorganization also exposes context tokens,
  context guard, inline tool-result size and read-result match limits.
- Search exposes results per page; all-wiki searches still inspect at most 100 hits
  per wiki. Test launches and generated commands expose consecutive non-success
  steps and context tokens. Blank test limits inherit runtime defaults. Stop an
  existing test server before launching with changed limits.

Saved defaults contain tuning only, never source selectors, approvals or model
credentials. Restoring built-in values changes the form; use Save defaults to
persist them. Required confirmations remain visible outside Advanced.
