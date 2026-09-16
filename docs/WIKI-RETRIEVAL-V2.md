# Wiki retrieval v2

`wikiretrievalv2=true` enables a shared deterministic passage engine. It is disabled
by default. Markdown remains authoritative; serving generations are rebuildable.
This implementation includes local serving, compatible published-bundle readers
and deterministic maintenance. Some acceptance items remain unverified or incomplete. See [validation](WIKI-RETRIEVAL-V2-VALIDATION.md)
and [baseline](WIKI-RETRIEVAL-V2-BASELINE.md).

## Enable and build

Use the supported unattended Dream maintenance entry point:

```sh
ojob mini-a.yaml dream=true usewiki=true wikiroot=/path/to/wiki wikiaccess=rw wikiretrievalv2=true dreamwikimode=reindex
```

Alternatively use the interactive
`/wiki reindex`, trusted operations MCP reindex, or `MiniAWikiManager.reindex()`.
Each builds compatible artifacts explicitly. Ingestion finalisation uses the
existing reindex/journal flow when configured with v2. Pending/corrupt journal
state and inactive source evidence are suppressed during retrieval.

Set the same flag on readers. Missing artifacts return `v2-build-required` in
trusted source status; they do not trigger a corpus scan or automatic migration.
Incompatible lexical/schema fingerprints are unavailable explicitly. Every
selected wiki needs its own compatible writable build. Read-only managers never
build. Local `fs` directories and `s3fs` filesystem views can build. HTTP/S3
readers hydrate compatible published artifacts with the existing bundle/cache options.
ZIP/OKT readers require an explicit writable `wikiindexdir` cache and an archive
containing compatible serving artifacts plus the original source Markdown. Native
ES storage can consume compatible locally hydrated artifacts; native ES/OpenSearch
search remains separate. Missing/incompatible artifacts never trigger a migration.

Direct configuration overrides environment defaults:
`OAF_MINI_A_WIKI_RETRIEVAL_V2` and `OAF_MINI_A_WIKI_RETRIEVAL_CONFIG`.
The flag, `wikiretrievalconfig` and `wikitelemetry` are propagated through agent,
console, web, Dream, ingestion, wiki MCP and wiki-backed skill launchers, including
dedicated skill libraries. Mounts inherit settings
unless explicitly configured otherwise. The advanced object accepts JSON/SLON
and rejects unknown keys, invalid booleans and non-positive/non-integer numeric values:

| Setting | Default | Bound/meaning |
| --- | ---: | --- |
| linkImmutableFiles | true | Reuse immutable index files through hard links; false forces copies; unsupported links fall back to copies |
| sharedBlockStore | false | Opt-in local immutable block store; reclamation uses retained-generation reachability |
| passageChars | 1400 | 64–16000 UTF-16 units; soft structural target |
| cacheBytes | 8388608 | FIFO immutable raw-block cache, at most 268435456 UTF-8 bytes per manager |
| maxArtifactBytes | 268435456 | Expanded generation cap, at most 2147483647 bytes |
| maxArtifactFiles | 100000 | Expanded generation cap, at most 1000000 files |
| maxMillis | 15000 | Request deadline, at most 120000 ms |
| telemetryFlushQueries | 16 | Aggregate flush batch, at most 1000 |
| telemetryRetentionDays | 30 | Rotate aggregate/sample windows during activity, at most 365 |
| telemetrySampleQueries | false | Explicit opt-in to at most 64 zero-result query samples, each at most 256 characters |
| bundlePath | unset | Optional trusted local ZIP destination for streaming export after publication |

## Retrieval and lexical capabilities

Search, retrieve and assembleContext use one scoped candidate/ranking pipeline.
Default scope and `*`, `primary`, mount names and subsets retain existing selector
semantics. Unknown/conflicting selectors fail. Sources receive bounded candidate
opportunities before final limits; native scores from different indexes are not
compared directly. Common exact phrase, query coverage, title and heading
agreement plus bounded reciprocal source-rank contributions determine final
ranking. Synonym expansion agreement is explicit. Editorial dates and retrieval
popularity do not establish authority or factual currency.

Real Lucene uses the installed oPack analyzer factory, with a separate Standard
exact field for technical names. English/Portuguese stemming and bounded
multiword synonym alternatives are tested. Up to eight deterministic alternatives
consume request query attempts and appear only in trusted diagnostics. Configured
shingles and character ngrams have distinct indexed fields using the installed
adapter's analyzer factories. Bounded Lucene MoreLikeThis query expansion and PRF
run over indexed query terms or stored wiki passage text without an IndexWriter.
Explicit graph expansion is unavailable.
No model, embeddings or external search service runs in this pipeline.

Trusted source diagnostics distinguish requested routes, executed routes and
routes omitted due to the query budget. Each synonym alternative, shingle/ngram
clause and feedback attempt consumes a request query attempt. Explicit Lucene
field/Boolean syntax preserves its constraints and skips natural-language
alternate routes. PRF takes at most five seed passages and reserves final candidate
capacity before reading their stored text; seed and final materialisation share
maxCandidates. Seed permissions, pending suppression and applicability are checked
before deriving feedback terms. When both expansion options are enabled, PRF takes
precedence, matching the installed adapter contract. Superseded page metadata
suppresses current-view evidence even without an applicability filter.

The effective index fingerprint now includes the actual primary analyzer class,
exact analyzer, Lucene analysis version, enhanced ASCII-folding setting and effective
shingle/ngram parameters. Published metadata must agree with that contract, and
nonempty staged indexes are checked for their required typed fields. Earlier v2
generations lacking this complete contract require an explicit writable reindex;
read-only readers report incompatibility and do not mutate or migrate them.
Parser version 6 and the schema-3 routed catalogue require an explicit writable
reindex for obsolete development-only generations. Read-only readers return
`reindex-required`; they do not migrate old serving formats. A reader's `passageChars` build target need not
match the published target: trusted source diagnostics report the generation's
effective `passageChars` without rebuilding it.
Query-only synonym/feedback settings can change without reindexing when the
effective indexed analyzer and fields remain compatible; they are deliberately
excluded from the indexing fingerprint.
Reindex retains the previous valid schema-3 generation for rollback and preserves
the feature-off artifacts supported by `main`. The Markdown source is unchanged.

Optional `applicability` request keys product/version/platform/environment match
exact strings or declared arrays; missing applicability is unknown and excluded
under an explicit constraint. `superseded: true` pages and pages with a nonempty
string `superseded_by` are excluded from current-view v2 answer candidates and
from support for grounded derivatives. The latter includes move-generated
retirement records. Replacement targets are not resolved or followed by this
filter, including targets in unselected mounts; an unresolved replacement still
expresses explicit retirement. Trusted navigation can inspect the retired page.
Explicit `status: withdrawn` and `status: rejected` also exclude answer evidence;
`status: review` remains descriptive.
No reverse retirement is inferred from `supersedes`, and no manual page is
rewritten or deleted to resolve a conflict. Feature-off retrieval remains
compatible. There is no
implicit semantic-version comparison or trust increment from an `updated` date.

`nativeScore` is a finite engine score; `rankScore` is the common final ranking
score, not a probability. `scoreComponents` lists implemented contributions.
The legacy `score` alias on ranked surfaces means final rank; old raw lexical
surfaces retain engine scores. Scan results have no manufactured native score.

The shared request budget covers selected sources. Defaults are 32 candidates,
16 query attempts, 32 inspected evidence pages, 16000 output bytes and the
configured deadline. Bounds are 512 candidates/pages, 64 attempts and 64000 bytes.
`maxInspected` counts unique immutable page-block fetches during selection;
`materializedPassages` reports bounded Lucene stored-passage materialisation
separately. This differs from the old page-inspection interpretation. `chunks`
limits selected evidence records; `tokens` is an estimate using ceil(UTF-16
length/4), including the complete presentation envelope. It is not tokenizer
measurement. Byte limits count UTF-8 envelope/citation overhead. Very small limits
produce an explicit output-budget error. Backend calls and generation validation
cannot be preempted; the deadline is checked between operations, not a hard I/O
cancellation guarantee. Graph budgets are unused because expansion is unavailable.

Trusted results include effective mode, generation vector, source status,
actual stages, budget usage, stop reasons and evidence citations. A generation
vector is independently pinned per wiki, not a simultaneous distributed snapshot.
Healthy indexed zero results do not scan. Explicit regex/literal/scoped/body-only
scan adapters remain independent operations. Source failures and budget omissions
are distinguished from complete searches with no evidence.

## Evidence, parser and references

Flag-off context assembly retains its legacy source-input selection, but labels
owned inputs `origin: "original-source"`, `evidenceRole: "ingestion-input"` and
`quotationStatus: "not-a-verbatim-wiki-quotation"`. Records without known ingestion
ownership are labelled `origin: "unknown"`. `sourceLocatorStatus: "unverified"`
does not authorise original-source quotation or imply verified citation mapping.
Legacy `path`/`anchor` and the additive `wikiPath` identify navigation to the
destination page, not positions occupied by source text. `scoreOrigin` identifies
the inherited parent-wiki-page score. No source chunk inherits a wiki revision,
line range or citation. Search/state failure envelopes remain objects with empty
`chunks` and an explicit error/outcome. These are compatible correctness repairs,
independent of the v2 flag or serving-artifact format.

The knowledge installer recognises the core context placeholder by its explicit
function identity and replaces it across module scopes. Existing custom context
implementations remain intact; installation does not inspect function source.

Evidence defaults to exact current authorised wiki-page text. Source ingestion
chunks and generated summaries never inherit wiki positions or become quotations.
Manual pages also receive passages. Stored Lucene passage text is a candidate
view; returned quotes are validated against immutable raw revision blocks and
current source stat/revocation checks. External edits with changed size, nanosecond mtime or filesystem identity invalidate the current-view
record until a writable rebuild. Restoring all stat attributes can evade external-edit detection; source content is not hashed on every warm metadata query. Ambiguous stat or content mismatch is unavailable.

One bounded parser preserves raw CRLF, Unicode and missing trailing newline,
frontmatter, ATX/Setext headings, repeated anchors, heading ancestry, fenced and
indented examples. Parser version 6 retains complete code blocks, pipe tables and
bounded Markdown lists up to twice the soft passage target. Larger structures
split at raw line boundaries
(or progressing UTF-16 fragments for an oversized line) with explicit structure
ranges and continuations. Late table fragments can include exact column-header
passages in `supportingContext`, each with its own raw range and revision.
Header lookups consume the existing query/candidate budget and their text and
reference wrappers count toward output limits. An incomplete header is omitted
explicitly; missing support does not displace the matching row. The assembled
context uses the same selector. Complete headers are reused only within the current
request, after each answer candidate's current permission/revision check. Repeated
headers are emitted once, with later rows' `contextReferences` pointing to the
support passage that survives output clipping. Different wiki identities, paths
and revisions keep separate support. Request-local reuse is recorded in
`budget.used.structuralContextCacheHits`; it never suppresses another caller's
evidence. No generated header is inserted into a quote.
Page passage postings are validated in nonoverlapping raw-position order.
Supporting-context lookup uses a binary lower bound and inspects at most eight
subsequent postings, rather than scanning every earlier passage on a long page.
`budget.used.structuralContextLookupProbes` counts catalogue comparisons/lookups;
it is separate from charged Lucene queries and candidate materialisation and is
aggregated in private request-work telemetry. Unsorted published postings are
rejected explicitly without reader migration. Existing parser-v4 builder output
already follows this order, so the lookup repair needs no artifact-format change.

Fenced and indented instructions, and long lists with an explicit preceding label,
can carry exact `instruction-context` support from preceding explicit
colon-labelled warning/prerequisite blocks.
Recognised labels are Warning, Caution, Prerequisite(s), Aviso, Atenção and
Pré-requisito(s), optionally bold or blockquoted. The bounded lookback is 64 raw
lines within the same heading, stopping at an intervening code block. Associated
lists and intervening explanatory text remain raw evidence, with their own ranges,
revision and output costs. Context lookup uses the same direct postings and shared
query/candidate limits as table headers. Missing or oversized support is reported
explicitly without replacing the selected instruction. Labels inside examples do
not create support. For code and table procedures, the
engine also retains an immediately preceding sibling section titled
`Prerequisite(s)` or `Pré-requisito(s)`. The headings must be adjacent at the
same level, with the enclosing structure starting within 64 raw lines of that
prerequisite heading. Later fragments of that same block retain the association,
even when the answer appears beyond line 64. Binary searches over revision-bound outlines and ordered page postings
locate exact supporting ranges, with no new artifact format or page body read.
Support is labelled `prerequisite-section` and consumes the existing shared
materialisation/query/output budgets. Nested steps can inherit from their parent
procedure, and nested headings within the prerequisite section remain included.
An intervening sibling procedure stops the association. This does not infer
implicit prerequisites or discover implicit table warnings. Explicit preceding labels now produce a
separate `table-context` range, retained alongside the exact column header. Each
range consumes the same request budget; a complete header is preserved when
warning lookup is unavailable, and the evidence outcome remains partial.

Support already emitted by an earlier selected passage is replaced by its exact
reference before charging a later evidence record. The reference wrapper still
counts toward byte/token estimates. Identity includes wiki alias, page, raw
revision and selected range; differing provenance is preserved. Earlier support
owners remain while later references survive because final clipping/removal
processes evidence from the end. Final packing retains its deduplication of any
remaining exact duplicates. `structuralSupportDuplicatesAvoided` counts early reuse;
this does not change lexical scores or advertise an unmeasured speedup.
Parser 4 fingerprints this changed derived contract. Parser 3 readers/artifacts
require their matching runtime for rollback or an explicit writable reindex for
upgrade; read-only encounters never migrate them.
If required support is lost to output limits, the result reports `partial` with
`contextOmitted: "structural-context-output-budget"`, whether the loss occurs
during initial record packing or final envelope repacking. The available answer
remains eligible; assembled context preserves the same incomplete-evidence
outcome. A fitting support set does not create a partial outcome by itself.
This is not full CommonMark: complex nested constructs, escaped-pipe table parsing
and prerequisite semantics are not comprehensively implemented. Source positions
never use normalised text.
Page identities include logical wiki identity and path; section identities are
deterministic ancestry/ordinal identities. Arbitrary edits and moves do not
promise stable identities; revision validation prevents reassignment of old ranges.

Lines are 1-based inclusive in the exact raw text, including frontmatter. Character
positions and continuation offsets are UTF-16, end-exclusive for charEnd; byte
positions are UTF-8. Copy the complete returned `next` object for trusted reads.
It binds revision and fixed selection; stale text returns `stale-reference` with
restart. Sections cannot spill into later sections. Long lines advance using a
character offset. Grep consumes its versioned cursor, binding pattern, scope,
ordering and current page revision; context may repeat but matching lines do not.
Previously visited pages are not revision-pinned by legacy multi-page grep.
Trusted cursors are validated positions, not authenticated access tokens.
Mount-qualified references and per-mount source URL/custom source field decoration
are retained. Inline source decoration occurs once.

## Serving generations, caching and updates

`.mini-a-wiki-serving/<UUID>/` contains a schema/lexical manifest, compact page and
passage catalogue, outlines, reverse links, Lucene index and immutable raw blocks.
`current.json` is the small activation pointer. Build stages close writers,
validate safe whitelisted paths/file and byte caps/checksums/schema/fingerprint,
open a searcher and verify representative evidence before atomically moving the
pointer. The previous generation is never deleted first. Atomic move support is
required; populated directories are never replaced as the activation mechanism.
Publication now requests file and directory synchronization through JVM
`FileChannel.force(true)` before activation and synchronizes the activation
directory after the atomic pointer rename. Filesystems must support directory
force as well as atomic move; unsupported synchronization fails explicitly.
This is an operating-system durability request, not measured hardware power-loss
proof. Distributed conditional publication is not provided. Publication has a
bounded filesystem single-writer lock.

The optional trusted audit callback reports `serving-sync` for each file or
directory force request: `operation: "force"`, target kind, success/failure and
elapsed milliseconds. Its `bytes` value is zero because `FileChannel.force`
does not expose device-write bytes. Verified routed catalogue reads report
`serving-catalogue-shard` with the decoded UTF-8 payload size and elapsed
checksum/decode time. As with source, block, stored-passage and bundle audits,
these are application-boundary observations; Lucene index-file I/O, checksum
pass bytes, filesystem cache, protocol framing and physical writes are outside
their byte totals. The [Area 5 characterization](../WIKI-RETRIEVE-PLAN.md#area-5-local-io-and-durability-characterization--2026-09-16)
defines the measurement and durability evidence boundary.

Readers acquire/release managed read-only generation searchers. At most two
reader snapshots are retained per manager, with in-flight references protected
from close. A new manager does not share a process-global path-hash reader.
Detach, replacement, configure and close release owned resources. Failed staged
publication leaves the old pointer usable. Before each later activation, the
previous valid pointer is retained as `previous.json`. If `current.json` or its
generation fails validation, a reader may serve that validated predecessor without
rewriting either pointer; a writer/operator must still repair the active state.
This is one-generation read recovery, not an authorised historical-view API.

Warm search/open/navigate uses cached routed catalogue shards, without source
body reads solely for headings. Backlinks uses reverse postings, even without the
optional graph. Evidence blocks load lazily into the byte-bounded FIFO cache;
revision/stat and pending suppression are checked even on cache hits. Audit hooks
distinguish serving-block fetches from serving-cache hits. Parsed shard and block
caches are bounded by the configured artifact and cache budgets.

Structural instruction support recognizes plain/bold warning and prerequisite
labels, plus GitHub-style blockquote admonitions `> [!WARNING]`, `> [!CAUTION]`
and `> [!IMPORTANT]`. The parser retains exact raw ranges and treats an admonition
only as context for the immediately following bounded structure; it does not
infer support from warning-looking content inside fenced code.

New retrieval excludes pages explicitly retired by `retired: true`,
`status: retired`, `status: superseded`, `status: withdrawn`, `status: rejected`,
`superseded: true`, or non-empty `superseded_by`. Other declared statuses,
including `review`, remain descriptive
provenance and do not silently remove current evidence. Trusted navigation may
still inspect a retired page; it cannot ground new retrieval evidence or
derivatives.

Writes/deletes rebuild affected passage records only when a serving pointer exists.
Incremental publication reuses immutable Lucene segment/commit files through
hard links by default, with a portable copy fallback when links are unsupported.
Set `wikiretrievalconfig="(linkImmutableFiles: false)"` to force copies. Unchanged
revision blocks are referenced through their owner generation rather than staged
again. Linked artifacts are never overwritten, including same-revision updates.
This avoids retained-index byte copies where links work; it does not remove
per-file metadata/force operations, Lucene merge costs or fallback copying.
`wikiretrievalconfig="(sharedBlockStore: true)"` retains revision blocks in an
opt-in local content-addressed store. Reclamation marks current, previous and
pinned catalogue lineage under the publication lock and re-marks before unlink.
Reclamation runs after an explicit full reindex, or an explicit maintenance call
to the serving engine's `reclaimSharedBlocks()`. Ordinary incremental writes never
run the full reachability sweep. Unreachable blocks and abandoned generations
may therefore consume disk until maintenance; read-only readers do not reclaim.
Bundles materialize referenced blocks into a self-contained schema-3 base.
Incremental publication uses affected-key routed catalogue deltas; unchanged
bindings retain their validated immutable owner generation. Publication validates
new and changed bindings, while cold open checks the pointer, manifest, routing
lineage and lexical contract structurally. A selected shard/block is checked
before disclosure, and full lint/export validates the selected closure. Lucene
writer and explicit full-reindex work can still scale with corpus size. It does
not reread unrelated Markdown bodies or enumerate source chunks per hit. Same-size
corruption of selected or newly published evidence is rejected.
`_lastServingUpdate.updateWork` reports
`reusedChecksums` and `reusedChecksumBytes`, linked/copied files and bytes, reverse
targets visited and catalogue work. Source writes remain authoritative if derived publication fails; a warning
and `_lastServingUpdate` report the failure and stale candidates are suppressed.
Current, previous and pinned generations are retained. Explicit shared-block
reclamation only removes unreachable blocks after a fresh mark; malformed state
defers deletion. Mount aliases of equivalent content can deduplicate evidence;
independent page provenance remains distinguishable.

Generation validation also binds each content-block filename and hash to the page
revision, front matter, outline and raw character/line/UTF-8 passage positions.
Unowned or unreferenced passage records are rejected. Indexed stored passage text
must agree with its validated catalogue hash before ranking, feedback expansion
or disclosure. File checksums alone do not establish these cross-file bindings.
Cold readers validate structure and routing lineage without resolving the full
catalogue. Selected shards and blocks are checked on first use; full lint/export
materializes the selected closure. Incremental publication reuses immutable parent
binding proofs for unchanged pages. `updateWork.bindingBlockReads` and
`bindingReusedPages` distinguish fresh checks from proof reuse.
`validationBlockReads`/`validationBlockBytes` serving metrics count semantic block
validation separately from returned-evidence reads; they exclude the file-checksum
scan itself. No signature or authenticated-publisher guarantee is implied.

Telemetry is best-effort, aggregate, separately persisted in
`.mini-a-wiki-state/telemetry.json`, batched and flushed on close. Selected-record counts and serialized response bytes
include the response envelope. Executed-stage counts never imply synthesis.
Trusted results expose `timings.measured` for validation, generation acquisition,
indexed search (including configured expansion), passage ranking and candidate
ordering. These use monotonic `System.nanoTime` durations expressed in milliseconds;
total retrieval latency is not capped at the requested deadline. `evidenceSelection`
measures the main selection pass, including query novelty ordering, evidence
materialisation, structural-context lookup and initial budget packing.
`citationDecoration` measures range clipping, reference/citation decoration and
search inline-source decoration, including repeated clipping when output must
shrink. Selection includes its nested decoration calls; these durations overlap
and must not be summed as exclusive stage costs. The retrieval engine final-envelope pass is measured privately as
`stage_millis.envelopePacking`, with `stage_counts.envelopePacking` counting
executed passes, including output-budget failures. This covers final clipping,
support deduplication, serialization and complete-envelope budget accounting.
Its timer finishes after serialization, so its duration/execution marker is kept
out of the public response. Private accounting uses a separate explicit record
rather than merging into the returned object. Compact-search serialization now
uses the same private `envelopePacking` metric and converges byte accounting
before checking the complete response. Assembled-context presentation is measured
privately as `contextPresentation`; it runs inside the request before telemetry
records the final result. Its returned chunks, output bytes and estimated tokens
are counted once, instead of counting the intermediate retrieve response as an
additional search. Context responses keep their existing envelope without a
required `ok` field; only explicit `ok: false` or partial outcomes increment the
failure/partial counter. These private durations never grow the returned envelope
after its budget check.
Source-backend operation durations are now reported separately in request usage
as `backendReadMillis` and `backendExistsMillis`, measured with monotonic
`System.nanoTime`. `backendReadCalls`, `backendExistsCalls`, `backendReadBytes`
and `backendFailures` count actual calls, complete UTF-8 text returned by source
reads and thrown failures. False permission responses are rejections rather than
backend exceptions. Revision validation of remote content counts its full
returned source text even when a cached immutable serving block supplies the
quote. A static HTTP bundle is different: its validated immutable block is the
serving source, so it makes no nonexistent per-page GET/HEAD probe; artifact
authentication and refresh govern that view. These measurements overlap the
enclosing search/selection durations.
Absent counters mean no corresponding source-backend calls were made; these are
not totals for Lucene file I/O, checksums, filesystem stat calls or HTTP wire
bytes. The common request usage object preserves counts across selected wikis
and error/partial-result adapters; no manager-global counter subtraction is used.
They also accumulate in bounded private `request_work` telemetry when writable
telemetry is enabled. Read-only readers report usage without persisting telemetry.

Bundle hydration separately emits one best-effort audit event with backend
`http-artifact` or `s3-artifact`, operation `hydrate`, success/failure, compressed
download bytes, expanded bytes on success, and monotonic `metadataMillis`,
`downloadMillis` and `totalMillis`. This is transport observability for the
artifact operation, not a claim of complete kernel/filesystem I/O accounting.
Ordinary source reads emit the same best-effort boundary record for `fs`,
`archive`, `s3`, `http`, and `es`: UTF-8 payload `bytes`, `operation: "read"`,
protocol, success/failure and monotonic `totalMillis`; HTTP also records its
response status and S3/HTTP record `GET`. These are application-boundary timing
and payload measurements, not TCP/TLS framing, kernel page-cache, filesystem
metadata, Lucene, checksum or provider-side measurements.
Existence probes are recorded separately with `operation: "exists"` and zero
payload bytes: filesystem/archive probes use their local protocol, S3 uses its
existing GET probe, HTTP uses HEAD and records status, and ES uses its document
lookup. A failed probe is an observed failed boundary operation, not a claim
that the backend or provider is unavailable globally.
When a request genuinely needs an immutable generation block (rather than a
stored Lucene passage), `serving-block` emits the same `read`/`file` record with
UTF-8 bytes and monotonic duration, including an explicit zero-byte failure.
Stored passage materialization remains separately identified as
`serving-index-passage` with protocol `lucene-stored` and zero blocking duration;
the immutable body cache is `serving-cache`/`memory`. Neither must be misreported
as a filesystem block read.
Assembled context preserves the shared retrieval timings. Empty retrievals do not
advertise citation work, and source-suppressed compact searches do not run it.
When the response envelope cannot fit with useful evidence, optional public
timings are omitted with `timingsOmitted: "output-budget"`. Private request
accounting retains the actual measurements; timing fields do not displace the
only fitting quote or relax disclosure limits.
Aggregate stage durations are persisted separately from counts. Telemetry and
warning-logger failures cannot interrupt retrieval; failed persistence retains the
bounded aggregate for a later flush.
`request_work` aggregates the current request's charged queries, candidates,
inspected/materialised passages and structural-context reuse. It does not derive
request counts by subtracting shared engine counters. Slim public budget-error
responses retain this private accounting without disclosing extra caller metadata.
Telemetry contains no raw queries/content/query hashes by default and never rewrites the authority manifest.
`telemetrySampleQueries: true` explicitly permits bounded raw zero-result questions
for trusted maintenance review. These samples are private, potentially sensitive
data, not anonymous. Retention uses the same rolling aggregate window; disabling
sampling clears loaded samples on the next telemetry flush. Disabling telemetry
leaves any existing file until an operator deletes it. Restricted tools never
return telemetry or maintenance reports.
`knowledgeStats(true)` resets persisted and in-memory telemetry. Metrics include
latency, results/zero/partial counts, readers, cache hits and block reads/bytes;
Private `events` counters record `stale_reference_restarts` for rejected read/grep
cursors, `revision_mismatch_requests` for validated content-revision mismatches,
`generation_mismatch_requests` for known record/text/count/revision binding
inconsistencies, and `evidence_rejected_requests` for composite stale/pending or
revoked outcomes whose precise cause is unknown. Retrieval counters count once
per request for each event category, rather than once per rejected candidate.
Cursor events do not increment search counts. Event names are fixed, contain no
query text, paths or revisions, and use the same retention/batching as query
telemetry. Read-only managers do not persist them. Restricted reference-policy
rejections before a core read are not separately counted by these core counters.
Complete backend and final-envelope latency metrics remain outstanding.
Concurrent multi-process aggregation is not coordinated.

## Presentation and maintenance

Trusted tools retain their existing envelopes with additive diagnostics. Restricted
MCP retains only search/read and bounded title/description/opaque references. Its
private grant binds the server-selected passage, physical wiki identity and revision; callers cannot choose
internal passage IDs or override ranges. Read returns a bounded selected excerpt
and complete support when the same character/line caps permit it. The shared
selector supplies explicit warnings, prerequisites and table headers from the
same current raw revision. Support and answer consume one read and the same
cumulative character quota; support does not receive new references or cooldowns.
When required support cannot fit, the answer remains available and a sanitized
`incomplete: true` indicator reports the omission. No reason, path, range or
topology diagnostics accompany that indicator. There is no new continuation tool.
Restricted character ceilings and cumulative accounting use UTF-16 units
(`String.length`). Truncation preserves surrogate pairs while staying within that
unit cap. A zero remaining metadata allowance returns no description text.
These helper corrections also apply with v2 disabled and to restricted skills.
With `wikitelemetry=true`, the v2 adapter additionally records private aggregate
restricted search/read outcomes, including pre-core rejection, quota exhaustion,
invalid references and omitted support. Fixed operation/outcome counters, total
elapsed milliseconds and output UTF-8 bytes contain no query, reference, path,
content, namespace or user identity. They do not appear in restricted responses.
Writable managers reuse separate telemetry persistence, batching and retention;
read-only managers retain these aggregates in memory without persistence.
Telemetry exceptions never change retrieval or policy responses. Disabled
telemetry bypasses the adapter observation entirely. These counters describe
adapter outcomes, independently of core search counters; do not add them as
though both counted distinct searches. Restricted skill search/open/read/related
use the same aggregate adapter. Recognized restricted MCP calls with malformed
arguments reach the policy validator and record a rejection; unknown tools and
transport errors before tool dispatch are outside retrieval telemetry.
Page cooldowns cover physical aliases, and existing
expiry/single-use/cumulative quotas remain enforced. It does not reveal mount names,
source URLs, raw paths, generations or fusion explanations. Restricted wiki-backed skills also pin their private grants to source revisions;
their existing follow-up reference/cooldown behavior is retained and not redesigned.
Transport-authenticated
user binding is not claimed. One bounded Java lock protects quota charging,
reference consumption and cooldown issue across library scopes/instances in one
JVM. Shared channels now carry cumulative usage per logical namespace, and an
active window rejects mismatched policies. These are actual concurrent simple-channel
tests, not a distributed transaction: multiple writer JVMs still require external
coordination. Per-key Redis/Mongo operations alone do not establish that guarantee.
Persisted file ledgers reject a conflicting declared namespace; use a separate file
per wiki. Legacy unnamespaced ledgers retain conservative compatibility.

Dream plan adds bounded, model-free, no-write maintenance reports for missing
headings, oversized fragments, broken links and stale/ungrounded derivatives.
`wm._retrievalV2.maintenance({ paths: ["manual.md"], limit: 25 })` restricts both
structural inspection and derivative lookup to those local pages. Paths must be an
array; at most 100 are considered, with honest bounded status. Structural and
derivative reports each have their own bounded inspection/result count. A full
report enumerates compact catalogue/manifest keys; targeted reports use direct
page dependency postings. No retrieval-frequency ranking or LLM work is added.

### Passage-grounded facts and summaries

The existing knowledge manifest remains derivative authority. Optional
`passageSupports`, `derivativeRegistry.byPage` and `derivativeRegistry.byClaim`
extend its existing `facts` and page/section summary maps. Opt-in manager
construction installs the shared
knowledge methods even when OpenAF libraries have different constructor scopes.
No source chunk or legacy summary receives inferred wiki positions or provenance.

```javascript
var support = wm.retrieve("expiry parameter", { chunks: 1 }).evidence[0].passage
wm.knowledgeRecordDerivative("fact", "expiry-guidance",
  { text: "Reviewed expiry guidance." }, [support], { dryRun: true })
// Explicit writable registration after reviewing the proposed record:
wm.knowledgeRecordDerivative("fact", "expiry-guidance",
  { text: "Reviewed expiry guidance." }, [support])
wm.knowledgeGetDerivative("fact", "expiry-guidance")
wm.knowledgeReconcileDerivatives({ paths: [support.page] }) // dry run
wm.knowledgeReconcileDerivatives({ paths: [support.page], dryRun: false, approved: true })
```

Supported kinds are `fact`, `page-summary` and `section-summary`. Each registration
requires 1–16 current exact local passage references, including physical `wikiId`,
page/passage identity, revision and UTF-16 range. Cross-mount registration is explicitly
unsupported; identical paths/text cannot confer another wiki's identity. The
selected immutable text is verified and its hash recorded. A dry run validates
without writing; read-only managers cannot persist records. Registration does not
prove that a claim follows from its support or that the source is factually correct.

The getter and bounded maintenance report validate support identity, current
revision, applicability, policy/suppression, range and actual text hash before
disclosing a derived record. Changed/deleted support
returns `stale-support`; explicitly invalidated records return `invalidated`;
legacy records return `unknown-provenance`, without disclosing their claim text.
Summaries and claims retain `origin: derived` and are navigation aids, never
verbatim wiki-page evidence. Ordinary retrieval continues to quote wiki passages.
Unchanged support survives publication of unrelated pages.

Reports read only the selected supporting revision blocks to verify their exact
text hashes. Approved deterministic reconciliation rechecks candidates and marks
stale or structurally invalid records invalidated; it does not regenerate claims, delete
legacy summaries or modify Markdown. Dry run is the default and writes additionally
require `approved: true`. Registration/repair refuse pending or corrupt ingestion
journals, preserving finalisation fingerprints. Existing ingestion invalidation
recognises passage-supported records while retaining its established fact marking,
summary removal and unknown-ownership protection. Removed grounded summaries
retire only their own dependency postings.

These are trusted manager APIs; no new MCP tools or restricted topology output are
introduced. Dream plan reports them but does not automatically approve repairs.
Manifest parsing still scales with manifest size, and legacy ingestion invalidation
still scans legacy fact/summary maps. The existing atomic file replacement has no
multi-writer CAS; registration/repair assume a single writer, with no guarantee
against a journal starting concurrently after validation. Reviewable applicability
conflicts and question weaknesses are proposals only; they never select source truth
or approve an LLM repair. `knowledgeConflictCandidates()` compares explicitly
recorded scalar `claimKey`/`value` facts with current passage support. Different exact
version strings or disjoint declared version arrays produce version-guidance
divergence. Disjoint product, platform or environment scopes are not reported as
simultaneous disagreements, and incomplete applicability is reported unknown.
Reports carry supporting revision-bound locators. No semantic
claim extraction or confidence-based truth decision occurs. Explicit query sampling
adds repeated-zero-result questions for alias/coverage review; these cannot be
attributed to a page and are omitted from path-targeted reports.

## Cache synchronization and request deadlines

Page metadata can declare `validity: {from: "2024-02-29", until: "2024-03-01"}`.
Dates use the explicit ISO calendar-date scheme, with inclusive UTC days and
optional open-ended bounds. Invalid dates, reversed intervals and unsupported
validity keys exclude the record from v2 answer candidates. This metadata is
applicability, not verification; `updated` never supplies a validity bound.
The default query evaluates declared validity at one captured request time.
Missing validity remains unknown and does not exclude foundational content.
An explicit manager retrieval constraint `applicability: {validAt: "2024-02-29"}`
requires known validity; absent or empty intervals cannot confirm a match.
Other product/version/platform/environment constraints retain exact matching.
This selects applicable current revisions, never historical source revisions,
and superseded pages remain excluded even when an earlier date is requested.
Trusted evidence carries the declared `validity` object, or null when unknown;
when declared, its descriptive `provenance` also carries `reviewStatus`,
`authority`, `verificationDate`, `sourceRevision`, and `ingestedAt`. These fields
do not affect rank or applicability; `updated` is never a verification date and
an absent value remains unknown. Restricted references retain their existing
disclosure policy and do not expose provenance. No new MCP tool
or caller-controlled historical-view interface is introduced.
Trusted wiki search schemas and the shared utility facade accept the same
`applicability` object. Both internal agent dispatch paths forward it and explicit
wiki scope; retrieval dispatch also forwards the existing query/time budgets.
Without v2, an explicit applicability request returns
`applicability-requires-v2`. Combining it with a literal/regex/body/path scan
returns `applicability-indexed-search-required`; these scans do not claim to apply
indexed metadata filters. Restricted schemas gain no applicability field or
topology diagnostics. Their ordinary v2 searches still honor declared current
validity through the core engine.

Reader acquisition and evidence-cache lock waits use the remaining request time,
capped at the existing one-second management wait. Expired waiters do not enter
the critical section and return `request-deadline-exhausted` or `retrieval-busy`.
Shutdown calls without a request deadline retain their one-second cap. Reader
release queues an atomic count and attempts the serving lock without waiting.
The lock owner drains releases before and after its operation; a post-unlock
recheck covers releases arriving during unlock. Only that lock owner decrements
managed references or closes readers. Shutdown retains pinned readers and closes
them when their final queued release is drained. A contended release therefore
cannot fail with `retrieval-busy` and strand its pin. Native reader closure remains
non-preemptible; the nonblocking guarantee concerns lock acquisition.
Remote/archive permission and revision validation happens before entering the
cache critical section, so a blocked source GET does not hold the serving-reader
lock. Revision checks remain mandatory even for cached immutable blocks; they
are not coalesced across callers with potentially changed access. The cache still
serializes immutable block lookup/loading/eviction and rejects repopulation after
shutdown. Source backends and cold reader/artifact initialization remain
non-preemptible; this change does not establish a hard wall-clock deadline or
complete the broader lifecycle/concurrency fault matrix.

## Incremental catalogue copies

The following comparison measured an earlier unreleased autonomy-branch
catalogue implementation. Current schema-3 incremental publication uses routed
affected-key deltas, keeps `catalogueKeysCopied` at zero for the measured
single-page update, and does not serialize or validate a complete catalogue at
activation. Historical timings below are not current schema-3 acceptance data.

A same-machine local-FS 1,000-page/10-update comparison measures p50
592.09 → 507.05 ms (14.4% lower in this run) and p95/p99
860.36 → 653.45 ms. Both runs copy 1,004 files on the first update; the
new builder copies 4,000 map keys. Initial builds measure 2,054.22 and
2,042.22 ms, which does not establish a cold-build improvement. End-heap
samples are GC-dependent and do not prove peak-memory savings. Machine-readable
`updates-1000-catalogue-copy-{before,after}.json` records include exact source
hashes and runtime; no tests or other benchmark ran concurrently. This is a local
measurement, not live-provider validation or a completed incremental-performance
acceptance gate.

## Rollback, cleanup and remaining work

Prerequisite lookup also supports nested procedure steps: a step can inherit the
explicit prerequisite section immediately before its parent procedure, including
nested prerequisite headings. An intervening sibling procedure ends inheritance.
The lookup examines at most 64 outline entries within the existing 64-line
lookback, then uses direct page postings and budgeted exact passage lookups.
Table fragments can retain both column headers and the separate prerequisite
section; neither replaces the other. All support uses the current pinned raw
revision and shared output/request budgets. This is a serving-time extension;
it does not change the artifact schema or silently migrate published indexes.
Implicit prerequisite inference remains unsupported. Restricted reads use the
same support-range selector, with their independent disclosure ceilings.

V2 local filesystem source enumeration uses a serial JVM directory walk rather
than OpenAF's shared recursive-worker helper. It prunes Mini-A derived artifact
directories before descent, discovers nested manually maintained Markdown pages,
and canonicalizes paths to reject traversal outside the requested root or prefix.
Visited canonical directories prevent cycles; canonical page paths are deduplicated.
Hidden derived targets are excluded even when reached through a differently named
symlink. Symlinks outside the requested canonical root or prefix are excluded.
Feature-off listing retains the existing implementation. This does not change
archive or remote-source enumeration contracts.

Writable full v2 publication consumes an explicit local enumeration outcome.
A missing or unreadable source directory fails preparation with
`source-enumeration-failed`, preserving the previous serving pointer. The public
list adapter retains its array return type. Private last-list counters measure
directory listings and skipped derived entries for that call; they are not
request-wide or concurrent I/O telemetry. S3FS enumerates its local cache under
the existing bootstrap/synchronization contract; this is not live remote validation.

A failed Markdown body read aborts full publication with `source-read-failed`.
For an incremental affected-page update, a failed read removes the record only
when JVM file attributes explicitly confirm `NoSuchFileException`; existing,
unavailable and inaccessible files are not treated as deletions. Successful source
reads retain the existing before/after revision validation. This strengthens
publication failure handling without changing feature-off read/list envelopes.
Filesystem attribute checks are not physical/protocol I/O telemetry. External
edit/stat and single-writer limitations still apply; this is not a source-file
transaction or a globally simultaneous snapshot.

Disable v2 to use preserved legacy artifacts; opt-in reindex never removes the last
legacy-compatible index. To roll back v2 artifacts, stop writers/readers, restore a
saved valid `current.json` and its complete UUID directory, then reopen managers.
Current-view source revision checks still apply; rollback cannot make old content
current. No online rollback/cleanup command or authorised historical-view API is
provided. Remove only unreferenced old/failed UUID directories after all readers
stop, preserving current and intended rollback generations.
Obsolete development-only parser/schema generations require reindexing. The
current reader does not silently reinterpret them.

Remaining acceptance work covers physical device/network I/O instrumentation,
independent quality evaluation, broader concurrency, transport and
security-revocation tests. Trusted/safe STDIO and localhost HTTP search/read smoke
pass; twelve abrupt-JVM publication checkpoints and injected synchronization/space
failures have regression coverage. These do not prove physical power-loss behavior
or live-provider durability. Distributed restricted quota writes
and remote publication remain single-writer assumptions. Legacy resetLucene rebuilds also stage and validate immutable UUID directories,
then activate a small `.mini-a-wiki-legacy/current.json` pointer. Existing readers
retain their old directory. Ordinary compatible legacy updates still use Lucene
commits in place; artifact hydration preserves usable generations independently
of the v2 flag.
Embedding retrieval, LLM reranking/decomposition/routing, distributed multi-writer
CAS, OpenSearch adapters and learned weights remain deferred extension points.

An incremental affected-page request with unchanged raw revision and compatible
passage granularity reuses its immutable page/passages without segmentation,
Lucene delete/add or reverse-link posting churn. It still reads and hashes the
authoritative page, checks before/after source stamps and refreshes a changed
stamp in the page record. Explicit move reconciliation bypasses this reuse to
preserve identity decisions. Missing, unavailable and excluded sources retain
their existing removal/error policy. Newly written files and changed bindings,
representative reads and publication synchronization remain validated. This
reuse alone does not establish a speedup.

Publication checkpoints now include an abrupt JVM halt immediately after pointer
activation. Fresh JVMs then serve the newly activated evidence, while already
pinned readers retain the previous generation. If a post-activation operation
throws, the failure response includes `activationSucceeded: true`,
`localPublished: true` and the active `generation`; callers must not interpret
that failure as an uncommitted publication. Before activation, these booleans are
false and the previous pointer remains active. Reader-retention contention is
nonfatal even when the warning logger fails. These tests exercise process crashes
and injected exceptions. The current publisher separately forces artifact files,
directories and the pointer; operating-system force requests do not prove hardware
power-loss durability.

Insufficient-space regression coverage injects `FileSystemException` failures at
immutable-block, catalogue, manifest, activation-pointer temporary-file, unchanged
block copy and writer-open boundaries. A seventh case supplies a Lucene
`FilterDirectory` whose output creation fails while using the installed real
`IndexWriter`. Each case checks explicit uncommitted failure, an unchanged active
pointer, a fresh reader serving the previous generation, and a successful later
writer. The original pinned reader and artifact checksums survive all seven
consecutive failures. These are controlled filesystem failures, not a filled
physical volume, live-provider testing or power-loss durability validation.

## Changed implementation files

The buffered whole-catalogue writer and its
`catalogueSerializedRecords`/`catalogueLargestRecordChars` measurements below
describe an earlier unreleased development format. Schema-3 publication writes
affected routed shards and inherited immutable bindings instead. The older
measurements remain for comparison and are not current format guarantees.

Catalogue preparation closes each constructed writer once and independently
attempts underlying stream closure even if writer initialization, writing or
closure fails. The original preparation error remains primary; additional
writer/stream close failures increment `updateWork.catalogueCloseFailures`.
Checksum acceptance happens only after successful output and closure. Failed
preparation leaves the current pointer and previously pinned readers usable.
This is local exception handling, not a guarantee against hardware power loss.

Fresh generation validation hashes and decodes referenced evidence blocks in
one native UTF-8 read, then validates their exact revisions and passage positions.
Malformed UTF-8 is rejected rather than replaced silently. In the current
schema-3 format, unchanged immutable records retain their validated parent
binding, while newly written or selected evidence is verified before use.
Cold open validates structure and routing lineage; full lint/export materializes
the selected closure. File/byte budgets still apply.

The verified-reader character array scales to the declared block byte size,
with a one-character minimum and a 65,536-character ceiling. Empty and small
blocks no longer allocate the maximum array. UTF-8 decoder and string-builder
storage remain additional allocations; this array bound is not a whole-reader
or process-memory ceiling. Byte limits, checksum verification and exact Unicode
content remain unchanged.

Approved deterministic maintenance now supports `missing-heading` through
`manager.knowledgeRepairStructure({kind:"missing-heading",path,revision,...})`
and the existing operations MCP `maintain` tool's `repair_heading` action.
The default is a no-write proposal containing the original revision, UTF-16
insertion position, heading text and proposed revision. It requires an indexed
active page with no real Markdown headings and a bounded single-line front-matter
title. Apply only the reviewed revision with `dryRun:false, approved:true`.
Protected policy/index/log paths and mounted targets are rejected; read-only
access cannot be overridden by approval. No model runs and no title is invented.

The repair inserts a heading after front matter and preserves all other raw
content, line endings, editorial dates and verification metadata. It uses existing
page-index, derivative and audit update primitives. `writes` counts modified wiki
pages, not physical artifact/audit writes. Publication failure can therefore report
one changed page and a failed serving update; reindex/recovery remains necessary.
Revision checks run before proposal and immediately before writing. The manager
lock coordinates serving operations in one JVM, but source files do not have CAS:
uncoordinated editors or other source writers can still race. Existing single-writer
and pending-ingestion limitations apply. Broader structural repairs remain proposed.

Operations MCP client examples (v2 enabled on the server):

```json
{"op":"repair_heading","path":"guide.md","revision":"<current raw revision>","dryRun":true}
{"op":"repair_heading","path":"guide.md","revision":"<reviewed raw revision>","dryRun":false,"approved":true}
```

This adds no tools or structural enumeration to restricted wiki MCP or virtual
skills. Feature-off operations return `v2-required` for this new action.

- `mini-a-wiki-retrieval.js`: parser, local generation publication, managed readers, catalogue/cache, scoped ranking, evidence packing, applicability and maintenance report.
- `mini-a-wiki.js` and `mini-a-wiki-knowledge.js`: shared hooks, contract repairs, scores, continuations, incremental publication and separate telemetry.
- `mini-a-mcp-wiki.js`, `mini-a-mcp-skills.js`, `mini-a-utils.js`, `mini-a-skills.js`: trusted cursor adapters, restricted private grants and revision-aware wiki skill facade.
- `mini-a.js`, `mini-a-con.js`, `mini-a-dreams.js`, launch YAML and `mcps/` schemas: consistent opt-in configuration propagation.
- `tests/wikiRetrieval*.js`, suite registration and fixtures: runtime regression counts, repeat-run checks, deterministic quality and local performance harnesses.
- Wiki/ingestion/virtual-skills documentation and `.package.yaml`: migration, measured limits and runtime packaging; pre-existing package edits retained.


## Published artifacts and compatible legacy lexical reads

To stream a v2 serving bundle through the supported reindex entry point:

```sh
ojob mini-a.yaml dream=true usewiki=true wikiroot=/path/to/wiki wikiaccess=rw wikiretrievalv2=true dreamwikimode=reindex wikiretrievalconfig="(bundlePath: '/tmp/mini-a-wiki-index.zip')"
```

Alternatively call `wm._retrievalV2.exportBundle(path)` explicitly. It acquires a
validated generation and streams immutable files into a staged ZIP, then atomically
replaces the output file. It includes no ingestion journal, source-internal manifest,
query telemetry or runtime credentials. Front matter chosen by wiki authors remains
in exact immutable source blocks and ordinary serving metadata; publishing a bundle
is therefore a disclosure of the authorised wiki revision. It is not a secret filter.
When a local predecessor pointer exists, export validates and includes exactly that
one predecessor generation plus `previous.json`, so a hydrated HTTP/S3 reader has
the same bounded corrupt-active-pointer recovery path. It does not export an
unbounded generation history or create a historical-view interface.
Local activation precedes optional export: `localPublished: true` and `bundle.ok`
report those outcomes separately if export fails. Existing legacy artifacts remain
on disk; the v2 bundle is not promised usable by old readers.

Upload complete immutable generation/bundle objects before publishing the remote
bundle URL/key last. Existing `wikihttpindexurl`, `wikis3artifactprefix`,
`s3artifactbundle` and `wikiartifactrefreshsecs` drive readers; this implementation
does not upload to real providers or provide distributed CAS. Individual S3 artifact
collections are also staged/validated before local activation, without inferring a
collection revision from filenames. Publishers must keep objects immutable while a
single-writer publication is being read. The reader validates checksums before
activation and reads current authorised source text before quoting remote evidence;
changed/missing text yields stale/incomplete evidence. Within one request a verified
body is reused only within the same manager/policy instance. No hard backend deadline
is claimed for non-preemptible provider operations.

All hydration paths use immutable `.mini-a-wiki-bundles/<UUID>` directories and a
small atomic `current.json` pointer. Legacy Lucene and graph paths follow this same
pointer. Extraction checks central-directory completeness, duplicate/conflicting
entries, path/layout safety, file and expanded/compressed byte ceilings and real
Lucene readability. V2 additionally verifies schema/fingerprint/checksums. Graph
JSON is validated where present. Failed hydration retains previous activation and
staged files for diagnosis; explicit offline cleanup is required. No populated
directory is replaced or deleted before activation. Readers release old-generation
searchers normally. A changed checksum under the same cached generation identity is
rejected explicitly.

Compatible legacy indexes now use installed read-only lexical primitives for
synonyms, phrase/shingle/ngram fields and bounded Lucene query expansion/feedback,
without registering a writer-backed channel. `nativeScore` is the actual base
component score when present; `rankScore`/legacy `score` are fused contributions.
No native base score is invented for candidates found only by other components.
Missing/incompatible lexical manifests retain the documented ordinary-analysis
fallback and diagnostic warning. V2 supports those configured lexical options
through its typed passage query and shared request budget.
Corrected two-argument OpenAF `merge` calls preserve ranking, selected limits and
mount-qualified page results on compatible legacy surfaces as correctness fixes.

## Journal-scoped publication and bounded evidence windows

Ingestion collects affected page paths for one passage publication during its existing
finalization phase. The batch scope is restored on success and failure. Recovery
collects paths from the journal again, including already-applied operations. This
reduces repeated passage builds without replacing complete-source reconstruction.
Index-page regeneration, lint and optional legacy graph rebuilding still perform
global work during finalization; full dependency-only ingestion finalization remains
unimplemented. Ordinary wiki writes retain immediate publication.

While a journal is pending or corrupt, local builds may prepare a generation but
configured bundle export reports `deferred: true`; explicit export reports
`ingest-pending`. Ingestion records completion before exporting. Bundle delivery
errors are returned separately in `finalize.bundle`; a completed local transaction
is not undone. Retry an export explicitly after fixing its destination. No journal
or private authority manifest is exported to remote readers.

Evidence selection uses final rank plus bounded marginal query-term coverage, a
per-page repetition penalty and an identical-text penalty. This is deterministic
planning, not an optimisation guarantee. Final limits can prevent a planned
candidate from fitting. Highly relevant passages may come from the same page.
Oversized excerpts centre a bounded raw-character window on the literal query or
longest matching query term. Omitted prefixes have `before` locators and suffixes
have `next` locators; final raw positions and templated citations are recomputed.
Restricted private passage locators also centre the query within the existing line
cap before disclosure. Stemming-only or synonym-only matches can still fall back
to a passage prefix when the original terms do not appear literally.

Remote candidate discovery checks source access without fetching a complete body.
The request caches permission checks per candidate page only; checks are repeated
for later requests and evidence materialisation. These are additional backend
operations (`permissionChecks`), not body reads. Current raw content is fetched and
hash-validated before quoted evidence, including cache hits. Calls without a
preemptible backend API can exceed the cooperative request deadline.

Explicit supported Lucene field/Boolean syntax preserves its constraints and does not
run natural-language synonym alternatives. Expansions are reported only when executed.
Local filesystem evidence can use validated stored passage text directly after current
file stat/access checks; remote/archive evidence additionally validates the fetched raw
revision. Deliberate external edits preserving file identity, size and modification
time require explicit reindexing; stat checks cannot detect those edits.

Six pre-activation publication checkpoints have actual process-halt and fresh-JVM
restart regression coverage. These are process-crash tests, not power-loss durability
proof. Unique unchanged sections retain passage identities, and explicit page moves
retain page identity; ambiguous or changed sections invalidate uncertain identities.

Trusted grep fragments matching lines at maxChars (default 8,000, maximum 32,000
UTF-16 characters), with surrogate-safe textCharStart/textCharEnd offsets. Fragments
share matchId and subsequent fragments mark matchContinuation; context lines may
repeat and do not represent additional matches. Cursors bind backend identity as
well as pattern, scope, ordering, line revision and fragment cap. The final fragment
of the final line has no unnecessary continuation. Multi-page grep retains bounded revision proofs for already visited pages.
Local unchanged stat/access proofs avoid repeated body reads; other backends
validate prior raw revisions and charge reads to the explicit scan budget.
Exhausted validation returns cursor-validation-budget with restart required.
Changed filesystem stamps conservatively require restart even for identical bytes.
The same preserved-stat external-edit limitation applies to these local proofs.

Trusted standalone MCP dispatch now installs actual jobs for its existing open,
navigate, grep and related tools. Its read job forwards revision/range/character
continuations. The shared utility adapter forwards grep caps and read cursors with
OpenAF-compatible two-argument merge calls. These repair existing contracts
independently of v2. Restricted surfaces retain only search/read. Standalone STDIO
and localhost HTTP verify navigation/related calls and both read/grep continuations.


## Publication-stage diagnostics

Trusted writable build results add `updateWork.publicationTimingsMillis`. These
use System.nanoTime elapsed milliseconds between completed sequential stages:
preparation, catalogueFork and fileStaging (index files) for incremental builds,
writerInitialization, pageUpdates, writerCommitClose, blockStaging (retained blocks
for incremental builds), catalogueWrite,
manifestWrite, artifactValidation, searcherVerification, activation and
readerRetentionExport. Full builds omit incremental-only stages. Timings describe
actual work, not a probability, estimate or synthetic stage. Writer initialization
also includes prior-identity acquisition when required for a full build. Failure
results retain only the completed stages; interrupted work is not counted as a
completed stage. Timing intervals exclude final cleanup and enclosing wiki-write
work, so their sum is not the entire public write latency. Reader/export timing
includes only operations that actually execute, including an optional bundle
export or deferred-export check. No query telemetry or ingestion authority record
is rewritten to publish these diagnostics. Restricted read-only surfaces do not
expose writable build diagnostics.


## Retained-block staging

Incremental publication stages index files first, applies page changes and closes
its writer, then copies or links only old revision blocks still referenced by the
resulting catalogue. Newly written blocks are not copied again. Blocks whose
last page reference disappeared are never copied into the staged generation;
`retiredBlocksNotStaged` and `retiredBlockBytesNotStaged` report avoided old blocks
and their pinned-manifest byte lengths. A shared revision block remains staged
until its last active page reference disappears. Old generations remain intact
for pinned readers and rollback. Manifest checksum and position validation remain
mandatory before pointer activation. The additional `blockStaging` timing covers
completed retained-block work; this does not change schema/fingerprint or make
publication proportional only to the changed set. Unchanged blocks, catalogue
serialization and validation still scale with the retained corpus.


Batch-retirement performance can be measured with
`WIKI_BENCH_PAGES=1000 WIKI_BENCH_RETIRED=500 WIKI_BENCH_SAMPLES=10 oaf -f tests/wikiRetrievalRetirementBenchmark.js`.
It uses fresh identical Markdown fixtures per sample, warms a real Lucene reader,
removes source files outside the timed interval, and times one derived publication.
Post-publication checks require retired evidence to disappear and surviving
evidence to remain. This simulates backend removals; it does not validate ingest
ownership, prune authorization or journal execution. `retiredBlockUnlinksAvoided`
counts absent, never-staged blocks that require no unlink syscall in staging;
blocks actually written during the current build still undergo required cleanup.


Incremental same-revision updates select an existing block through its validated
`blocks/<revision>.md` locator instead of writing raw text into a duplicate block.
The retained-block phase copies or links that immutable file and reuses its
expected SHA256 checksum; full staged checksum and position validation still run.
Content revisions/locators use SHA1 and are not compared with SHA256 artifact
checksums. `sameRevisionBlocksReused` counts unique existing block locators
selected by the affected page set. No source read, permission/revision check,
parsing or required index update is skipped. New revisions and explicit full
rebuilds still materialize source content. The portable-copy default remains;
with explicit hard links, a same-revision update retains the old immutable inode.


## Managed resource-close failures

Managed snapshot closure tracks reader and directory completion separately. A
reader that still has native references keeps its directory open when close fails.
If Lucene reports an error after its native reference count reaches zero, the
reader is considered closed and directory cleanup may proceed. Successful
component closures are not repeated on retry. A managed closure failure retains
the snapshot's handle in the bounded two-generation pool. Failed attempts through the shared snapshot-close helper increment
`metrics.resourceCloseFailures`; a generic warning is best effort and logger
failure does not turn a completed release into an exception. Released pin counts
remain zero and are not requeued. Later guarded operations/shutdown retry pending
closures. Snapshots marked for closure cannot be returned as serving cached
readers. Persistent failures can exhaust the retained resource budget and prevent
refresh; no unbounded new reader pool is opened to bypass them.

Shutdown still rejects new acquisitions and clears evidence caches even if native
resource closure is deferred. Close/retry calls remain non-preemptible native IO;
there is no guarantee of a hard shutdown deadline or recovery of Lucene-internal
handles after a native close error. The bounded-staged-resource section below extends retention to failed
initialization and staging; these managed controls alone do not establish the
entire native lifecycle fault matrix.


The shared-helper close-failure counter uses an engine-local AtomicLong with an
enumerable numeric diagnostic getter. It counts failed snapshot-close attempts
from eviction and cleanup as well as managed-drain retries; the bounded-staged-resource update below routes snapshot initialization cleanup
through that helper as well. Other native resources outside this engine are not
covered by this metric. No reader retry
bypasses the two-generation managed pool. Persistent eviction cleanup failure
returns incomplete search with the serving source marked unavailable, not a
healthy zero-result claim. Clearing the failure permits a subsequent request to
retry cleanup and open the active generation while other pinned readers remain
open. These are additive trusted metrics, with no restricted topology output.


## Bounded staged and initialization resources

Each manager has three snapshot resource slots, including managed readers,
staging readers and failed partial initialization. The managed serving pool stays
at two generations. Slot acquisition never waits; exhaustion reports
`generation-resource-budget` before a new directory/reader opens. Snapshot close
uses a per-snapshot nonblocking lock, component progress and an atomic once-only
slot release. Failed unmanaged cleanup retains its handle in a concurrent queue
for later bounded retries (at most three queued entries per pass). Failed reader
initialization preserves the original initialization error while retaining any
failed cleanup handle. Guarded operations and subsequent initialization attempt
pending cleanup. A valid existing serving snapshot can still be acquired without
opening a new resource while staging slots are exhausted.

Native reader/directory opening uses the same Lucene read-only APIs; no writer is
introduced. Shutdown retries both unmanaged and managed pending cleanup and
prevents new snapshot opens. Persistent failures retain slots and may prevent
refresh until cleanup succeeds. The limit bounds tracked resource sets, not
Lucene's internal leaf handles, and does not guarantee recovery of internal
handles after native reference counts reach zero. Native open/close calls remain
non-preemptible. This changes lifecycle bookkeeping, not serving schema,
lexical fingerprint, source content or flag-off behaviour.

## Parser-v5 heading identity repair

Repeated headings named `Constructor` previously collided with an inherited
JavaScript object property and received identical anchors. The shared parser now
counts only its own properties; legacy section reads also use the repaired parser.
New serving generations use parser v5 and a new fingerprint. Readers reject v4
artifacts without mutation; use the supported writable reindex to build v5. Keep
the previous directory and compatible runtime for rollback. Raw evidence position
conventions are unchanged.

## Trusted caller budgets

Trusted search schemas and the shared utility now accept `maxQueries`,
`maxCandidates`, `maxInspected`, `maxMillis` and `maxBytes`. These existing v2
budgets reach both core agent search dispatch paths and the standalone MCP job.
Retrieval dispatch also preserves them. The engine validates and clamps limits;
the adapters do not reset them per mount. Omitted fields keep existing defaults.
Restricted search schemas and their independent quota ceilings are unchanged.
Legacy search does not gain v2 request-budget guarantees.

Runtime tests execute the current core search/retrieve option mappings against
real indexed content, including explicit mount selection and applicability.
These tests verify dispatch mappings and core retrieval behavior, not a complete
model-driven conversation or a new listener/transport stress run.

## Filesystem synchronization and activation failures

After staged-searcher verification, the publisher forces every manifest-bound
artifact and the manifest, then the index, block, generation, serving and parent
directories. It writes and forces a temporary activation pointer, probes serving
directory synchronization, atomically renames the pointer and forces the serving
directory again. File channels close after every force operation; no writer is
held between unrelated requests. Existing immutable generations remain retained.
The `generationSynchronization` publication timing records the added generation
work; pointer synchronization is included in `activation`.

A force failure before rename leaves the previous current pointer usable. A
failure after rename returns `activationSucceeded: true`, `localPublished: true`
and the actual new generation, with an explicit
`activation-directory-sync-failed` error. Such a failure does not undo the rename
or claim that durable activation completed. Retained generations allow an
operator-controlled restart/rollback. Telemetry's small atomic replacements do
not inherit this generation-publication force protocol.

Local tests exercise actual JVM force calls and injected synchronization failures.
Abrupt-JVM recovery fixtures cover twelve checkpoints, including generation force,
pointer creation/force, pointer rename and activation-directory force. Fresh JVMs
use the old pointer before rename and the new pointer after rename; readers pinned
before publication retain their prior generation. Exceptions after pointer rename
also preserve truthful local-publication status. These tests do not establish
hardware power-loss recovery. The force protocol covers derived serving artifacts
and their activation pointer; authoritative Markdown edits and ingestion journals
retain their existing write/recovery contracts and are not newly promised as
power-loss-durable transactions.

An earlier unreleased implementation serialized and validated a compact whole
catalogue at publication. Schema-3 routed deltas supersede that path. Changed
bindings receive evidence validation; unchanged identities retain their
immutable parent proof. Fresh readers validate the pointer, manifest and
routing lineage, then validate selected shards and blocks on first use.
No writer-only prepared proof is accepted as a reader shortcut.
Newly built and freshly validated metadata is normalized to its published JSON
representation before caching. YAML date values therefore remain ISO strings in
both warm and restarted catalogues, rather than mutable `Date` objects. This is
representation consistency, not a new verification or freshness signal.
Network filesystems, provider caches, storage-controller write caches and hardware
power loss remain unverified. Existing pre-synchronization benchmarks are
historical results; the added force operations can increase publication latency.
