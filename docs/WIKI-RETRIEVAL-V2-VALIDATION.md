# Wiki retrieval v2 validation

This is a working local passage implementation with incomplete requirements,
listed explicitly in [implementation and limitations](WIKI-RETRIEVAL-V2.md).
No external blocker explains the outstanding work. No push, deployment or live
provider validation was performed. Starting checkout and isolated baseline
reproduction are recorded in [baseline](WIKI-RETRIEVAL-V2-BASELINE.md).

## Runtime and commands

Measured with OpenAF 20260913, JVM 26.0.2, Lucene 10.5.0 and lucene oPack
20260805 on the same local macOS workspace. Tests use real Lucene and OpenAF;
Node syntax checks are supplementary only.

```sh
ojob tests/wikiRetrievalV2.yaml
oaf -f tests/wikiRetrievalRepeat.js
ojob tests/wiki.yaml
ojob tests/graph.yaml
ojob tests/dreams.yaml
ojob tests/wikiIngest.yaml
WIKI_COUNT_SUITE=wiki oaf -f tests/wikiRetrievalAssertions.js
WIKI_COUNT_SUITE=wikiRetrievalV2 oaf -f tests/wikiRetrievalAssertions.js
WIKI_COUNT_SUITE=wikiIngest oaf -f tests/wikiRetrievalAssertions.js
WIKI_EVAL_MODE=legacy oaf -f tests/wikiRetrievalQuality.js
WIKI_EVAL_MODE=v2 oaf -f tests/wikiRetrievalQuality.js
WIKI_EVAL_MODE=v2 WIKI_EVAL_SPLIT=development oaf -f tests/wikiRetrievalQuality.js
WIKI_BENCH_MODE=legacy WIKI_BENCH_PAGES=100 WIKI_BENCH_SAMPLES=10 oaf -f tests/wikiRetrievalPerformance.js
WIKI_BENCH_MODE=v2 WIKI_BENCH_PAGES=100 WIKI_BENCH_SAMPLES=10 oaf -f tests/wikiRetrievalPerformance.js
```

Use `WIKI_COUNT_SUITE=graph` or `dreams` for their assertion reports. The assertion
harness invokes every registered job function, including functions outside todo,
and counts actual `ow.test.assert` calls before first failure in each function.
Outer job SUCCESS and function PASS counts are not assertion counts. The focused
v2 module currently passes **993 assertions across 29 functions**; the full wiki
harness passes **1,724 assertions across 190 functions**, both with zero failures.
Contract fixtures pass 49 assertions. The latest 29-function repeat passes **1,986
assertions in one JVM**; the earlier 1,552-, 1,526-, 1,508-, 1,486-, 1,464-, 1,440-, 1,422-, 1,392-, 1,046-, 962- and 770-assertion repeats are historical.
`oaf -f tests/wikiRetrievalRepeat.js` discovers the test module exports dynamically.
Previously measured graph/ingestion/wiki-backed skills passed 37/218/61 assertions;
Dream currently passes 180 assertions across 47 functions, with zero failures;
the isolated baseline attempted 173 with three failing functions. The isolated original
wiki baseline attempted 645 assertions with seven failing functions. Those seven
wiki issues are repaired in the current source. Earlier counts below remain
historical snapshots. Machine-readable assertion records accompany the fixtures.

Historical wiki baseline failures: bootstrap AGENTS index link, orphan lint, heading hierarchy
lint, MCP move metadata, lexical search schema wording, search line metadata and
AGENTS template drift guard. Historical Dream failures: OAF_MODEL fallback, explicit
model precedence and semantic-default graph preview. These reproduce in the
isolated baseline archive; they are not hidden by job SUCCESS labels.

### Dream model scopes and model-free preview

The three historical Dream failures reproduce before this repair. The model tests
previously assigned `$llm` in their own module scope, without intercepting the
factory resolved in the loaded Dream scope. The instance `_createLlm` adapter
delegates to the existing OpenAF `$llm` in production; tests intercept that adapter
and verify the exact parsed configuration. Explicit `model=` still wins over
`OAF_MODEL`, and no external model service is needed for these tests.

The graph preview expectation is corrected to the existing zero-model dry-run
contract, with throwing factory/extractor stubs proving neither is invoked.
Additive `semanticRequested`, `semanticExecuted` and `semanticOmissionReason`
diagnostics distinguish a requested later extraction from executed structural
preview work. No semantic extraction or graph persistence is enabled by this fix.
The repaired assertion harness passes 180 assertions across all 47 registered
functions, with zero failures; the earlier 173-assertion records remain historical.
The standalone `ojob tests/dreams.yaml` reports 47 PASS with zero FAIL/ERROR.
The full wiki regression run retains 1,427 assertions across 189 functions with
zero failures. These results are local runtime checks with model stubs, not live
model/provider validation; the full v2 plan still has outstanding requirements.

### Deadline-aware cache synchronization

The guard's previous one-second lock wait did not account for shorter request
deadlines, and remote revision validation held that lock. Reader pinning and
cache access now pass the request deadline; source validation runs outside the
cache guard and a closed engine rejects later cache insertion/use. The registered
`testDeadlineAwareCacheGuard` uses actual Java threads, a lock holder and bounded
latches in one OpenAF JVM. It verifies an expired queued caller does not execute
its critical section, exits before the management wait, and a warm reader can be
acquired/released while another caller remains blocked in a simulated remote GET.
Both threads then terminate and the remote caller returns the exact revision.
The targeted fixture reports `DEADLINE_CACHE_GUARD_PASS`; existing real-Lucene
remote evidence validation reports `UNLOCKED_REMOTE_VALIDATION_PASS`.

No production thread pool or parallel scan is introduced. Cold generation
initialization, immutable-file I/O and provider calls cannot be preempted by this
guard; complete lifecycle/contention stress remains outstanding. These are
same-JVM threads with simulated remote blocking, not live-provider concurrency
validation or a hard wall-clock deadline guarantee.
The focused suite passes 787 assertions across 29 functions; full wiki passes
1,518 across 190, both with zero failures. Standalone focused oJob reports 29
PASS and zero FAIL/ERROR; repeating all 29 functions twice in one JVM passes
1,574 assertions. The remaining full-plan matrix is not inferred complete.

### Reader release under serving-lock contention

The registered deadline/cache fixture now closes the engine while a real Lucene
reader remains pinned, then holds the serving guard from another JVM thread.
Before the repair, request completion raises `retrieval-busy` after the management
wait and strands its release. Release now adds a per-snapshot atomic pending count
and attempts the serving lock without waiting; the owner drains it on completion.
A post-unlock recheck prevents an arrival during unlock from being stranded.
The fixture verifies prompt release, continued reader usability before the owner
finishes, zero managed references afterward, an empty shutdown reader pool and
Lucene's actual reader reference count of zero. All threads use bounded latches
and are joined. The targeted run reports `RELEASE_CONTENTION_PASS`.

The focused harness passes **798 assertions across 29 functions** and the full
wiki harness passes **1,529 assertions across 190 functions**, both with zero
failures. Standalone `ojob tests/wikiRetrievalV2.yaml` reports 29 PASS and zero
FAIL/ERROR. Repeating all 29 functions twice in one JVM passes **1,596 assertions**.
Machine-readable records are `v2-release-contention-assertions.json`,
`wiki-release-contention-assertions.json` and `release-contention-repeat.json`.
These runtime checks preserve the seven repaired baseline wiki functions.
No new benchmark or performance claim is made for this lifecycle repair.

This repair changes no artifact schema, lexical fingerprint or flag-off path.
Native reader closure and cold/provider I/O remain non-preemptible. The broader
reader-close failure and transport concurrency matrix is still outstanding; this
fixture is same-JVM local runtime evidence, not live-provider validation.

The same registered fixture additionally repeats construction/shutdown three
times in one JVM. Sixteen Java threads release sixteen genuine manager pins
while another thread holds the serving guard. It verifies all release threads
finish before the guard is released, every atomic pending count is retained,
no reader closes early, the queue and managed references drain to zero, the
reader closes exactly once and its actual Lucene reference count becomes zero.
The targeted run reports `SIMULTANEOUS_RELEASE_PASS`. Concurrent thread errors
are collected through a JVM concurrent queue; no production pool is introduced.
The expanded focused harness passes **879 assertions across 29 functions**, the
full wiki harness **1,610 across 190**, both with zero failures. Standalone oJob
passes all 29 functions with zero FAIL/ERROR. The twice-per-function same-JVM run
passes **1,758 assertions**. Records are `v2-simultaneous-release-assertions.json`,
`wiki-simultaneous-release-assertions.json` and `simultaneous-release-repeat.json`.

### Combined table context and header evidence (parser 4)

Parser 4 records explicit preceding table warnings/prerequisites separately from
column-header ranges. Shared context selection loads both with independent
request-local cache entries, truthful roles/ranges and one common query/candidate
budget. A complete header survives a failed warning lookup while the omission
and partial outcome remain explicit. The registered structural fixture checks
both supports on a late oversized table row, no full Markdown reads, exact
CRLF source positions/revisions, three charged queries and budget exhaustion.
It also rejects parser 3 artifacts as incompatible instead of silently migrating
read-only readers. The targeted real-Lucene fixture reports
`TABLE_WARNING_HEADER_PASS`. Implicit/nested associations and restricted support
presentation remain outstanding.

The earlier catalogue-sharing benchmark was measured with parser 3. The paired
`catalogue-sharing-runtime-snapshots.zip` retains the exact before/after runtime
files; their hashes match the measured JSON records. Use the selected snapshot
only in an isolated repository copy for reproduction, leaving the active parser 4
checkout untouched. The runtime-only sharing patch is a historical diff and does
not undo later parser changes or supply the complete measured snapshot by itself.
No new parser-4 benchmark speedup is inferred from the parser-3 measurements.
The focused suite passes 776 assertions across 28 functions; full wiki passes
1,507 across 189, both with zero failures. Standalone focused oJob reports 28
PASS and zero FAIL/ERROR; the same-JVM repeat passes 1,552 assertions. These
checks do not complete the outstanding full-plan acceptance requirements.

### Incremental catalogue record sharing

The incremental builder replaces `clone(old.catalog)` with a fork of the compact
maps. Unchanged page/passage records are shared by convention as immutable;
affected reverse-link and move postings use new arrays. The registered direct
postings fixture checks distinct map ownership, identical unchanged record
references, actual publication/deletion of a new inbound page and unchanged
serialized catalogues held by an old pinned reader. The targeted real-Lucene
fixture reports `SHARED_CATALOGUE_PASS`. Staged file checksums, semantic revision
validation and activation order are preserved.

Reproduction: run `WIKI_BENCH_PAGES=1000 WIKI_BENCH_SAMPLES=10
WIKI_BENCH_LABEL=shared-catalogue-records oaf -f tests/wikiRetrievalUpdates.js`.
The immediately preceding runtime, captured before the edit with the same
harness/configuration/machine and no concurrent tests, measures p50 592.09 ms;
the changed runtime measures 507.05 ms. p95/p99 are 860.36 → 653.45 ms,
with only ten samples (both tail estimates are the maximum). Full catalogue
serialization, parsed validation and immutable artifact copying remain
corpus-wide: both first updates copy 1,004 files. End-heap readings are not peak
memory measurements and uncontrolled GC prevents a memory-saving claim. Exact
source hashes, observations and work counters are retained in the paired JSON
records. The full plan remains active; this change reduces redundant work rather
than completing the broader publication architecture/performance requirements.
The focused suite passes 763 assertions across 28 functions; full wiki passes
1,494 across 189, both with zero failures. Standalone focused oJob reports 28
PASS and zero FAIL/ERROR; the same-JVM repeat passes 1,526 assertions.
`catalogue-sharing-runtime.patch` captures the exact runtime-only before/after
diff. Reverse-apply it only in an isolated copy for the before benchmark, using
`git apply --reverse tests/fixtures/wiki-retrieval-v2/catalogue-sharing-runtime.patch`,
then run the same harness. A reverse dry-run check passes, and reconstructing the
before file matches the recorded SHA-1 exactly. Do not reverse it in the active
worktree or run the newer helper-specific tests against the earlier runtime.

### Prerequisites for late code fragments and Portuguese retrieval

The adjacent-section rule initially used the selected fragment's first line,
causing an answer beyond the 64-line window in one oversized code block to lose
its prerequisites. A new real-Lucene fixture reproduced the missing support.
The runtime now uses the enclosing structure's start line for heading lookup and
the 64-line association window, preserving the same prerequisite range for all
fragments of that block without broadening the heading scope.

The registered structural fixture also builds a separate generation with
`wikilexical.language: portuguese`, retrieves a procedure under `Pré-requisitos`,
checks effective analyzer diagnostics, and verifies the supporting Unicode/CRLF
range and current revision. This supersedes the earlier parser-only Portuguese
smoke proof with actual indexed retrieval coverage. The targeted OpenAF test
reports `LATE_PORTUGUESE_PREREQUISITE_PASS`. Nested/implicit prerequisite discovery,
table-warning combinations, restricted support presentation and corpus-scaled
publication remain outstanding. No benchmark improvement is claimed.
The focused suite passes 754 assertions across 28 functions; full wiki passes
1,485 across 189, both with zero failures. Standalone focused oJob reports 28
PASS and zero FAIL/ERROR; repeating all 28 functions twice in one JVM passes
1,508 assertions.

### Adjacent prerequisite-section support

`testStructuralContext` now covers a manually maintained CRLF/Unicode procedure
with an explicit prerequisite section under a preceding sibling heading. The
runtime derives the supporting range from the already-validated outline and
ordered passage postings, without a schema change or full Markdown body fetch.
The real-Lucene fixture verifies complete prerequisite text, truthful role,
revision and raw character/line positions, plus no cross-heading association and
explicit incomplete evidence under an exhausted query budget. The targeted
fixture reports `PREREQUISITE_SECTION_PASS`. The rule is bounded to simple
adjacent sibling prerequisites within 64 raw lines; nested/implicit associations,
table-warning combinations and restricted supporting-context presentation remain
outstanding. No overall retrieval speedup is claimed from this change.
The focused suite passes 743 assertions across 28 functions; full wiki passes
1,474 across 189, both with zero failures. Standalone focused oJob reports 28
PASS and zero FAIL/ERROR; the same-JVM repeat passes 1,486 assertions. A separate
OpenAF parser-helper smoke check passes two Portuguese heading/range assertions
(`PORTUGUESE_PREREQUISITE_PASS`); it is supplemental to the registered suite and
does not claim Portuguese real-Lucene context retrieval validation.

### Shared search/context presentation accounting

Search packing and assembled-context presentation now run before the shared
request's telemetry record. `_packSearch` converges complete-envelope byte
accounting; `_presentContext` checks the final serialized bytes and estimated
tokens, and keeps request token usage consistent with the final context. Their
monotonic durations remain private as `envelopePacking`/`contextPresentation`.
No new public flag, required response field or artifact migration is introduced.

Delayed runtime fixtures verify actual private search/context durations, exact
final output bytes, selected chunk counts and a single request increment for
assembly. Successful legacy-shaped context envelopes without `ok` no longer
increment failure counts. Packing/presentation markers and durations are not
appended to the already-budgeted public output. The targeted OpenAF fixture
reports `PRESENTATION_TIMING_PASS`. Broader physical-I/O/protocol measurement,
complete transport stress and corpus-scaled publication work remain outstanding.
The focused suite passes 732 assertions across 28 functions; full wiki passes
1,463 across 189, both with zero failures. Standalone focused oJob reports 28
PASS and zero FAIL/ERROR. Repeating all 28 functions twice in one JVM passes
1,464 assertions. No benchmark speedup is claimed from this instrumentation.

### Final retrieval-envelope timing

The final retrieval packing pass is extracted into `_packEvidence` without changing
its clipping, support deduplication or byte/token accounting. Its monotonic
elapsed duration and execution count are persisted privately, including a slim
output-budget failure. Delayed successful/failing packing fixtures verify actual
elapsed time, retained evidence and unchanged public response limits. No private
packing duration or execution marker is appended to the returned envelope.
The targeted fixture reports `ENVELOPE_TIMING_PASS` under OpenAF.

A targeted test exposed an in-place `merge` that attached private measurements to
public output. The explicit private accounting record repairs that mutation and
preserves omitted public diagnostics. This change does not add a flag, artifact
format or a synthesis stage. Compact-search serialization and assembled-context
presentation timing remain outstanding; this metric specifically covers the
shared retrieval engine final packing pass.
The focused suite passes 720 assertions across 28 functions; the full wiki suite
passes 1,451 across 189, both with zero failures. The focused standalone oJob
reports 28 PASS with zero FAIL/ERROR. Repeating all 28 functions twice in one JVM
passes 1,440 assertions.

### Source-backend request accounting

The shared candidate/feedback/evidence paths pass one request usage object into
source permission checks and revision reads. Counts and monotonic durations are
charged in `finally`, including a source backend that throws. Complete returned
UTF-8 source bytes are distinct from quoted/output bytes. The remote bundle
fixture compares reported counts with actual simulated HEAD/GET calls, verifies
validation bytes with a warm immutable-block cache, and uses delayed successful
and failing reads to check actual elapsed duration and explicit partial outcomes.
The standalone real-Lucene remote-facade fixture reports `BACKEND_ACCOUNTING_PASS`.
Private telemetry tests verify all six counters are persisted separately from
knowledge authority. These are simulated remote calls, not live-provider checks.
Final-envelope timing and broader backend/protocol/physical-I/O instrumentation
remain outstanding; the new counters specifically cover source-backend methods.
The focused suite passes 711 assertions across 28 functions; the full wiki suite
passes 1,442 across 189, both with zero failures. The focused standalone oJob
reports 28 PASS with zero FAIL/ERROR, and its same-JVM repeat passes 1,422
assertions across two runs of all 28 functions.

Functional coverage includes raw Unicode/CRLF/frontmatter/Setext/repeated headings,
fenced and indented examples, tables and oversized fragments; late manual-page
answers; exact identifiers and actual language stemming; multiword synonyms;
whole-envelope byte caps and progressing fragment reads; complementary pages;
last-mounted relevance and identical relative paths; shared candidate budgets;
unknown scopes, missing artifacts and applicability filtering; source-chunk versus
wiki-evidence separation; pending-journal suppression on search/retrieve/context/
open/read; old generation preservation under injected activation failure; current
revision updates/deletion/stale continuations; immutable reader reuse, deferred
close/release, and analyzer closure; restricted opaque excerpt selection, cooldown,
first-use stale-reference rejection and sanitised output; aggregate telemetry
without authority writes; traversal rejection and model-free maintenance.

Not covered comprehensively: all transport operations/concurrent listener callers, live S3/ES/Falkor,
live-provider bundle hydration, cross-JVM simultaneous quota writers,
revocations through remote providers, interruption at every publication step,
real disk exhaustion, power-loss durability, complete restart matrix, arbitrary
move/ownership scenarios under v2 and every Markdown nesting construct. Existing
ingestion ownership/prune regression coverage still passes unchanged.

### Insufficient-space recovery increment

The registered `testInsufficientSpacePublicationRecovery` runs seven consecutive
injected filesystem-failure cases against real Lucene: immutable evidence write,
catalogue write, manifest write, pointer temporary-file write, immutable-block
copy, writer-open checkpoint and Lucene output creation through `FilterDirectory`.
Each requires an explicit uncommitted failure, unchanged activation pointer,
successful fresh read of the previous generation and successful subsequent
publication. Original pinned artifacts retain their checksums and their reader
remains usable. `LUCENE_SPACE_RECOVERY_PASS` confirms the standalone fixture.
This does not fill the physical volume or test storage power loss.
After the adapter caller repair, the focused suite passes 696 assertions across
28 functions and the full wiki suite passes 1,427 across 189, both with zero
failures. The actual focused oJob reports 28 PASS and zero FAIL/ERROR; repeating
all 28 focused functions twice in one JVM passes 1,392 assertions.

The new write adapter initially exposed empty receivers in bundle hydration and
legacy rebuild pointer activation. Both callers now use the helper's prototype
receiver; real remote-facade hydration, archive hydration and legacy publication
targeted regressions pass (`ATOMIC_ADAPTER_PASS`). These were transient failures
introduced by this increment, not the seven original wiki baseline failures.

## Quality fixtures

Separate development (three questions) and held-out fixture files (six questions,
five answerable and one genuinely unanswerable) ship with supporting text checks.
The harness measures passage Recall@k, MRR, exact quoted character-range correctness,
duplicated evidence fraction and supporting characters per estimated content token.
These are deterministic curated fixtures, not a blinded large independent evaluation
or model-based assessment. Ranking weights are fixed in code; no learned tuning.

On held-out fixtures, flag-off Recall@k and MRR are both 0.40; v2 both 1.00.
Exact late parameter, required applicability version and last mounted answer are
missed by flag-off passage selection. Both paths return zero evidence for the
unanswerable identifier. Returned quote/range checks are 1.00 and duplicate fraction
0 in both paths: valid prefix citations can still have poor answer recall. Useful
content-token metrics are per fixture in `quality-held-out-*.json`; these exclude
presentation overhead and must not be mistaken for whole-response token efficiency.

A current rerun of this unchanged six-question fixture on runtime `20260914`
binds its fixture SHA-1 (`8928e58077bc8a55073778acb213b17a861909fc`) and source
SHA-1 values in the `QUALITY=` record. V2 remains Recall@k 1.00, MRR 1.00 and
strict citation-range correctness 1.00. Legacy remains Recall@k/MRR 0.40, but
strict citation-range correctness is 0.00 because its legacy evidence does not
carry revision-positioned citations. This supersedes any interpretation of older
legacy quality artifacts as strict-citation proof. The fixture remains too small
and curated to establish general quality or an independent large-corpus result.

## Local performance

The size parameter supports 1000 and 10000 or larger explicit runs. Measurements
below use 100 and 1000 pages, ten warm observations each, with flag-off and flag-on
runs sequentially on the same checkout/configuration/machine. This comparison
includes compatible contract fixes in both paths. The isolated original-baseline
zero-result microbenchmark is separately retained in `zero-result-*.json`.

First-call costs use a new read-only manager; JVM/OS caches are not forcibly flushed.
Warm calls reuse that manager and generation. Percentiles are nearest-rank: p95
and p99 both equal the maximum with ten samples. Reader/cache/body metrics include
the cold call. Source backend read/byte counters cover primary and attached managers;
serving metrics currently cover the primary engine only. Immutable block fetches
are separate from source Markdown reads. End heap is GC-sensitive, not peak memory
or a resource-leak proof. Update/build timings have one sample, not percentiles.
`fixtureDiskBytes` includes source content, legacy indexes and retained serving
generations; it is not solely active artifact size. The historical measurements in this section are local-only. Additional
simulated remote measurements appear below; no live-provider performance is claimed.

### 100 pages

| Operation | Legacy warm p50/p95 ms | V2 warm p50/p95 ms | Legacy/V2 cold ms | Source reads per warm query, legacy/v2 |
| --- | ---: | ---: | ---: | ---: |
| compactSearch | 10.20 / 11.68 | 4.79 / 6.04 | 55.11 / 85.77 | 0.0 / 0.0 |
| zeroSearch | 6.79 / 7.58 | 1.23 / 3.37 | 34.47 / 46.90 | 0.0 / 0.0 |
| retrieve | 10.69 / 12.56 | 4.02 / 5.88 | 33.20 / 53.18 | 2.0 / 0.0 |
| assembleContext | 11.07 / 12.16 | 4.04 / 6.98 | 27.43 / 46.13 | 20.0 / 0.0 |
| open | 0.56 / 1.86 | 0.22 / 0.43 | 8.79 / 26.59 | 1.0 / 0.0 |
| navigate | 0.40 / 0.82 | 0.25 / 0.44 | 2.14 / 28.74 | 1.0 / 0.0 |
| backlinks | 27.29 / 40.69 | 7.46 / 8.08 | 32.35 / 37.50 | 100.0 / 0.0 |
| federation | 12.23 / 15.41 | 3.59 / 5.03 | 48.48 / 57.56 | 3.0 / 0.0 |

Initial build: 1789.34 → 642.50 ms. Single page update: 35.47 → 199.52 ms (v2 parses one changed source page). Full publication: 1395.26 → 209.47 ms. End fixture disk: 132271 → 921598 bytes. End heap: 100978696 → 116485648 bytes.

### 1000 pages

| Operation | Legacy warm p50/p95 ms | V2 warm p50/p95 ms | Legacy/V2 cold ms | Source reads per warm query, legacy/v2 |
| --- | ---: | ---: | ---: | ---: |
| compactSearch | 11.97 / 14.91 | 4.63 / 9.42 | 61.07 / 180.81 | 0.0 / 0.0 |
| zeroSearch | 9.09 / 11.69 | 0.98 / 4.72 | 36.84 / 125.51 | 0.0 / 0.0 |
| retrieve | 13.83 / 29.45 | 4.31 / 5.63 | 52.44 / 137.15 | 2.0 / 0.0 |
| assembleContext | 11.91 / 15.03 | 4.17 / 5.11 | 33.07 / 128.87 | 20.0 / 0.0 |
| open | 0.71 / 0.96 | 0.21 / 0.29 | 7.19 / 108.37 | 1.0 / 0.0 |
| navigate | 0.37 / 0.50 | 0.23 / 0.43 | 1.50 / 103.93 | 1.0 / 0.0 |
| backlinks | 155.33 / 168.68 | 67.05 / 72.00 | 249.22 / 188.61 | 1000.0 / 0.0 |
| federation | 12.31 / 14.67 | 3.33 / 5.24 | 49.18 / 124.46 | 3.0 / 0.0 |

Initial build: 21782.80 → 1784.99 ms. Single page update: 57.58 → 794.21 ms (v2 parses one changed source page). Full publication: 14300.50 → 1199.72 ms. End fixture disk: 1059823 → 8923433 bytes. End heap: 165266088 → 110081504 bytes.

Warm bounded retrieval/search/outlines improve on these fixtures; cold generation
validation scales with artifact bytes and increases latency. Those measurements precede immutable-file reuse and direct incremental postings.
The later incremental benchmark below measures the new implementation; generation
staging, catalogue cloning and integrity validation still scale with the corpus. Retained generations increase disk use and compact catalogues increase memory.
Backlink time scales with incoming link degree; this star fixture has every page
linking to page-0. Legacy assembleContext returns no manual-page source chunks while
v2 returns exact manual-page evidence, so their output work is not equivalent.
The 10000-page measurements below are additional runs. Peak memory and concurrent
retrieval latency are not measured. Concurrent restricted shared-ledger consumption
is functionally exercised in one JVM, without a distributed-CAS claim.

## Phase status and rollout

Contract repairs, shared parser/local serving artifacts, shared evidence selection,
scoped federation, compact lookups/cache/readers, staged local publication and
cross-surface propagation have functioning tested vertical slices. They are not
complete phase acceptance: remaining items are enumerated in the implementation
document. Applicability is exact-match only. Maintenance offers bounded structural,
grounded derivative, explicit scalar-disagreement and opt-in repeated-question
proposals, plus approved derivative invalidation. Broader dependency-driven repair
remains outstanding. Restricted concurrent consumption is tested against the actual
shared channel in one JVM; concurrent replicas still require external coordination.

Upgrade example: writable Dream reindex with `wikiretrievalv2=true`, then launch
readers with the same lexical/configuration contract. Rollback example: disable
v2 to use the preserved legacy index, or restore a saved valid serving pointer and
UUID directory with managers stopped. Source revision checks remain mandatory.
No production/provider artifacts were published. The 100/1000-page JSON records,
quality fixtures and assertion reports are under `tests/fixtures/wiki-retrieval-v2/`.

## Incremental publication follow-up

The previous v2 module was reconstructed in an isolated `/tmp/mini-a-v2-copy-reference`
checkout by reversing only the immutable-file/postings edits. Its SHA-1 matches the
prior package manifest exactly. The working checkout was never reset. The identical
`tests/wikiRetrievalUpdates.js` harness runs in each checkout with v2 enabled.

```sh
WIKI_BENCH_LABEL=copy WIKI_BENCH_PAGES=1000 WIKI_BENCH_SAMPLES=10 oaf -f tests/wikiRetrievalUpdates.js
WIKI_BENCH_LINKS=true WIKI_BENCH_LABEL=reuse WIKI_BENCH_PAGES=1000 WIKI_BENCH_SAMPLES=10 oaf -f tests/wikiRetrievalUpdates.js
```

Run the first command in the isolated pre-change checkout and the second in the
current checkout. Each creates 1000 real Markdown pages, warms serving metadata,
then publishes ten distinct single-page changes and checks current evidence after
every publication. `UPDATES=` JSON reports p50/p95/p99, per-update parse/work counts,
retained generation file sizes and end heap. Unique file bytes deduplicate POSIX
file identity and use file lengths; they exclude allocation, metadata, compression
and filesystem copy-on-write effects. Apparent bytes double-count hard links. Neither
metric is a claim about physical storage allocation. Updates process one source page.

New tests hold a reader pinned across publication, verify checksums of every old
generation file, check real shared inodes, exercise unsupported-link copy fallback
and same-revision publication, and test shared-block deletion/reference counts.
Direct reverse postings preserve unrelated inbound links and process only the old/new
outgoing targets. Six injected pre-activation failure stages preserve the pointer
and are readable by a fresh manager: file reuse, analyzer setup, file manifest
collection, validation, searcher opening and activation. Corrupt immutable-block
checksums are unavailable explicitly. These injected failures are not real disk-full,
process-kill, power-loss or remote-provider tests; those remain unverified.

| 1000 pages, ten updates | p50 ms | p95/p99 ms | Apparent / unique file bytes |
| --- | ---: | ---: | ---: |
| copy | 633.85 | 877.27 | 39032124 / 39032124 |
| default | 548.62 | 1022.75 | 39637143 / 39637143 |
| reuse | 814.33 | 1031.31 | 39637277 / 25017850 |

The default improves p50 in this run but worsens the measured tail; no uniform
speedup is claimed. At this historical revision, hard links worsened local
update latency and were disabled by default. The 2026-09-16 update-path correction
below supersedes that default after generation-local block staging was removed.
Measure the intended filesystem when choosing the explicit copy override. The hard-link record was measured with the
same publication behavior before the option was added; the option changes only
which reuse branch is selected. End heap and all per-update work records remain
in the machine-readable JSON. This corpus has no outgoing links; functional
fixtures separately demonstrate bounded reverse-target work and shared-block
reference-count handling. Catalogue cloning and full checksum validation remain
corpus-scaled costs. No physical allocation or remote speedup is claimed.


## Passage-grounded derivative increment

Before this increment the focused v2 suite passed 164 assertions in nine functions.
Two additional OpenAF/real-Lucene fixtures now cover writable/dry registration,
exact support hashing/ranges, physical namespace checks, read-only disclosure,
prototype identifiers, stale support after modification/deletion, unchanged support
across unrelated publication, direct dependency postings, targeted bounded reports,
explicit approved/idempotent repair, legacy ungrounded summaries, malformed support,
corrupt support hashes and pending-journal fingerprint preservation. Existing ingest
invalidation is exercised directly with grounded facts and summaries alongside an
unrelated ungrounded record, including retirement of deleted-summary postings
without removing fact dependencies. Support registration proves positional provenance,
not semantic entailment or truth. Concurrent writer/journal coordination remains
unverified and unsupported.

The same-JVM repeat run exercises all eleven functions twice. Wiki and Dream still
have the baseline failing functions listed above; ingestion has no failures. Query
and report tests compare authority bytes before/after to prove no incidental writes.
No new performance or quality improvement is claimed for this increment; the earlier
measured results remain historical measurements of their recorded source revisions.

Current commands, assertion counts and runtime source hashes are recorded in
[derivative validation](../tests/fixtures/wiki-retrieval-v2/derivatives-validation.json).
The earlier `v2-assertions.json` and `wiki-v2-after.json` are historical pre-increment
records, retained for comparison.

## Completion increment: 10,000-page measurements

`performance-10000-completion-baseline.json` runs the original assessment archive;
`performance-10000-completion-v2.json` runs the implementation at the source hashes
recorded in that file. Five warm calls per operation were measured sequentially,
on the same generated corpus and machine. No other tests ran during measurement.
Later journal batching, remote permission checks and restricted line-window changes
postdate this measurement; local retrieval measured here already contains query
windows, marginal packing and the assembled-text merge correction.

The assessment version falls back to source scans with the installed Lucene/oPack
on several benchmark paths. Improvements therefore include contract repairs and
cannot all be attributed to passage architecture. A current flag-off comparison is
recorded separately when available. Cold calls use new managers without flushing
OS/JVM caches. With five samples, p95 and p99 equal the maximum; these are weak tail
estimates. Updates and publication have one observation each.

| Operation | Assessment / v2 warm p50 ms | Assessment / v2 warm p95 ms | Assessment / v2 cold ms | Body reads per warm call assessment / v2 |
| --- | ---: | ---: | ---: | ---: |
| Compact search | 678.02 / 7.57 | 693.39 / 9.32 | 866.73 / 1015.57 | 40 / 0 |
| Zero search | 727.12 / 1.32 | 745.61 / 1.63 | 761.44 / 934.10 | 1000 / 0 |
| Retrieve | 672.35 / 6.77 | 747.65 / 8.87 | 697.45 / 977.19 | 18 / 0 |
| Assemble | 666.28 / 5.77 | 674.38 / 6.54 | 695.96 / 929.63 | 60 / 0 |
| Open | 0.66 / 0.23 | 0.81 / 0.34 | 6.02 / 921.32 | 1 / 0 |
| Navigate | 0.34 / 0.25 | 0.38 / 0.39 | 1.51 / 981.44 | 1 / 0 |
| Backlinks | 1271.93 / 482.90 | 1348.81 / 642.77 | 1297.87 / 1534.52 | 10000 / 0 |
| Federation | 723.43 / 4.79 | 729.02 / 6.45 | 745.11 / 929.47 | 1000 / 0 |

Initial build: 137298.0 / 9964.2 ms; full publication: 139611.4 / 9919.2 ms.
A one-page update regresses from 38.10 to 7049.14 ms: v2 parses only one page but
copies 10004 immutable files and validates the complete generation. Initial fixture
disk grows from 10397804 to 33121470 bytes; end heap is 316611288 / 372529664 bytes.
Disk includes source files, legacy artifacts and retained generations, rather than
active serving artifacts alone. Heap is GC-sensitive and not a peak measurement.
The high-degree backlink fixture still takes roughly 483 ms despite zero body reads;
returning and validating 10000 incoming links remains proportional to degree.

Additional regression coverage includes real enhanced lexical read-only queries
while a writer lock is held; synonym/multiword synonym, shingle/ngram and exact
identifier results; actual shared-channel concurrent quotas; safe full archive
hydration, missing ZIP central directory and activation failures; revision-validated
simulated remote evidence; validated legacy reset publication with retained readers;
grounded applicability disagreements; explicit question sampling and retention;
query-centred exact citation windows; and journal batching/deferred bundle export.
No new live provider integration is claimed.

### Current flag-off 10,000-page comparison

The same harness/corpus/machine with the working flag-off contract repairs gives
warm p50 compact search 11.82 ms, zero search 11.21 ms, retrieve 12.14 ms, assembled
context 12.45 ms, open 0.52 ms, navigate 0.32 ms, backlinks 1302.61 ms and federation
13.74 ms. Both compact and zero searches read zero source bodies. Retrieve reads
two, assembled context twenty, open/navigation one, backlinks 10000 and federation
three bodies per warm call. Initial build takes 136532.1 ms, full reindex 137339.1 ms
and one update 48.55 ms. V2 warm retrieval is 6.77 ms in the preceding measured
implementation, but its one-page publication is 7049.14 ms. Source hashes and
percentiles are in `performance-10000-completion-current-off.json`. Contract repairs
account for most of the assessment-to-current search latency improvement.

### Standalone transport smoke

`python3 tests/wikiRetrievalTransport.py` builds a temporary wiki through real
OpenAF/Lucene, copies descriptors with isolated PID files, starts their actual
job handlers, and checks initialize, tools/list, search and read over STDIO and
localhost HTTP. The required `label` argument is supplied. All four trusted/safe
transport combinations pass. Safe tools are exactly search/read; safe metadata and
read content omit internal paths, generations and score diagnostics. HTTP binds
only 127.0.0.1. This machine required an approved unsandboxed test run for localhost
socket binding; no production or provider requests ran. Own child process groups
are terminated after testing. This is a smoke, not comprehensive transport stress,
identity authentication or live storage-provider proof. The OpenAF regression
module also compiles every runtime job body in all five wiki/skills descriptors;
it caught six missing commas in newly extended trusted wiki handlers.

### Simulated current-source latency

`WIKI_BENCH_REMOTE=true WIKI_BENCH_LATENCY_MS=1 WIKI_BENCH_PAGES=100
WIKI_BENCH_SAMPLES=5 WIKI_BENCH_MODE=v2 oaf -f tests/wikiRetrievalPerformance.js`
uses real local Lucene with a simulated HTTP source facade. The original baseline
uses the identical copied harness in the isolated assessment archive. Three runs
(original, current flag-off, v2) execute sequentially without other tests. Only body
reads receive the injected 1 ms delay; permission checks use local exists/stat with
no simulated network delay. This is simulated source latency, not a real HTTP
provider or comprehensive network/backend-request measurement.

Original / v2 warm p50 ms: compact search 111.97 / 4.99, zero search 121.79 / 1.28,
retrieve 55.48 / 9.61, assembled context 136.57 / 9.51, open 2.24 / 0.21, navigate
1.95 / 0.26, backlinks 184.24 / 4.34, federation 69.99 / 7.01. Compared with local
v2, current-source verification adds reads and latency on retrieval while compact
metadata/outlines remain body-free. Per-operation body requests, bytes, output size,
percentiles, reader/cache/permission checks and source hashes are recorded in
`performance-simulated-completion-{baseline,current-off,v2}.json`. Full artifact
publication remains local; the facade is applied only to read-only clients.

## Latest contract and lifecycle verification

The latest focused module passes 385 assertions across 23 functions, including six
actual pre-activation process-crash/restart checkpoints and explicit move identity
checks. The repeated run passes 770 assertions in one JVM. The registered wiki
assertion harness attempts 1,083 assertions with the same seven baseline failing
functions; `ojob tests/wiki.yaml` was also run. Ingestion (218), skills (61) and
graph (37) pass; Dream retains its three baseline failing functions among 173
attempted assertions. Restricted/trusted standalone search/read pass in all four
STDIO/local HTTP combinations. Long-line grep now has surrogate-safe fragment
continuations and logical-wiki cursor binding. Explicit field/Boolean queries do
not run synonym alternatives that could broaden their constraints.

The held-out six-question deterministic evaluation was rerun after these changes:
legacy Recall@k/MRR remain 0.4/0.4 and v2 remains 1.0/1.0. Five questions are
answerable; one is genuinely unanswerable. These small fixtures do not establish
general quality. Earlier performance files record their source hashes and predate
move identity, publication-reader retention and local indexed-span serving; their
measurements must not be attributed to the newer code without another run.

Latest sequential 1,000-page/ten-update measurements are saved in
`updates-1000-validated-reader.json`: p50 560.17 ms, p95/p99 860.13 ms, with one
page parsed per update and roughly 1,000 files copied. The earlier default-copy
run measured p50 548.62 ms; these measurements do not demonstrate an update
speedup. The current run includes additional move/provenance metadata and is
not an isolated reader-cache comparison. Ten observations provide weak tail
latency estimates. Retaining eleven generations uses 41,008,996 apparent bytes
on this fixture; garbage-collector-sensitive end heap is 138,542,784 bytes.

Latest sequential 1,000-page/ten-warm-sample measurements are saved in
`performance-1000-current-final.json`. Warm p50: compact search 5.08 ms, zero
search 1.08 ms, retrieve 5.50 ms, assembled context 5.17 ms, open 0.24 ms,
navigate 0.26 ms, backlinks 80.08 ms and federation 4.40 ms. All report zero
source-body reads; local retrieve/context also report zero immutable-page block
reads, using validated indexed passage text. Cold operations take approximately
107–239 ms on this fixture because generation checksums/catalogues are validated.
Initial build is 2,007.50 ms; full publication 1,235.07 ms; one update 635.82 ms.
These measurements predate subsequent grep/cursor and trusted MCP forwarding repairs;
the performance harness calls managers directly.

The subsequent grep integration tests also exercise previously advertised but
unregistered trusted MCP jobs (open/navigate/grep/related), now wired to the shared
manager. Trusted STDIO and localhost HTTP verify those calls plus bounded read
and grep continuations. Restricted search/read still pass in both transports.
Utility-adapter regressions prevent fragment caps and cursor revisions/positions
from disappearing during OpenAF merges. Multi-page grep validates bounded prior
revision proofs; surrounding context cannot bypass the per-line fragment cap.

The final utility suite (`ojob tests/miniAUtils.yaml`) passes, and a separate
OpenAF assertion-counting run reports 350 assertions across 44 functions with no
failures. Final v2 repeat: 770 assertions; final registered wiki harness: 1,083
assertions, retaining exactly the seven baseline failing functions.

## Seven baseline wiki failures corrected

The historical seven-failure reports above describe earlier snapshots. Generated
AGENTS guidance now links to Wiki Home; template version 6 makes the managed
upgrade discoverable while retaining existing manual-edit protection. Heading
lint checks the first heading against the document root, as well as later level
transitions. An initial H3 now reports a hierarchy violation.

Five stale checks now exercise existing contracts: structural orphan diagnostics
identify missing parent-index links; the read-only trusted MCP excludes move,
which remains wired on the operations MCP; lexical descriptions describe keyword
retrieval and applicable legacy graph hints; explicit compact=false requests line
snippets; standalone launchers load the shared MCP initializer and core templates
instead of carrying duplicate template definitions. The seven focused functions
pass 35 assertions under OpenAF. No write tool was added to a read-only surface.

After these repairs, the full registered OpenAF wiki harness passes **1,099
assertions across 183 functions with zero failures**. `ojob tests/wiki.yaml` also
finishes with no failed tests. The prior seven-failure counts remain historical
baseline comparisons. Results are saved in `baseline-fixes-wiki.json`. The overall
v2 implementation still has the previously documented unfinished requirements.

## Enhanced lexical retrieval and telemetry increment

Real Lucene fixtures now cover shingle and character-ngram index fields,
query expansion and pseudo-relevance feedback, in addition to language, synonyms
and exact identifiers. Read-only queries succeed while the Lucene writer lock is
held. Feedback seeds and final candidates share the candidate ceiling, omitted
configured routes report partial coverage, and failures retain spent query and
candidate budgets. Superseded or inapplicable records cannot seed feedback.

The indexing fingerprint records the actual analyzer class, Lucene analysis
version, fields and effective indexing settings. Query-only synonym and feedback
changes remain compatible with an existing read-only generation. Older v2
generations without this complete contract require an explicit writable reindex;
readers do not migrate them. Contradictory manifests and missing indexed fields
are rejected.

The latest focused assertion harness passes **431 assertions across 24 functions
with zero failures**. Telemetry regression coverage includes simultaneous
persistence and warning-logger failures, authority preservation, serialized output
accounting, actual executed-stage counts and measured search/ranking durations.
Stage timings currently cover candidate discovery and ranking; evidence packing
and individual backend timings remain outstanding.

The subsequent full registered wiki assertion harness passes **1,145 assertions
across 184 functions with zero failures**, saved in
`wiki-enhanced-telemetry-assertions.json`. The standalone focused oJob registration
also completed all 24 functions without failures before the final timing additions;
the assertion harness exercised those final additions in the runs above.

`performance-1000-enhanced-lexical.json` records a separate real local-filesystem
run with 1,000 pages, ten warm samples and English shingles, ngrams and feedback
enabled. Warm p50 compact search/retrieve/assembleContext were 9.91/8.86/7.94 ms;
backlinks were 80.04 ms. No source Markdown or immutable full-page block reads
were recorded. Manager construction was measured separately at approximately
168–176 ms; first-query times ranged approximately 99–200 ms. Initial build took
1,925.59 ms, one incremental update 706.10 ms, and full publication 1,357.90 ms.
The enhanced zero-result query is recorded explicitly because ngrams can match
parts of the earlier benchmark's unknown identifier. This is an optional-feature
cost measurement, not a controlled speedup claim. The file records source hashes
and predates the subsequent telemetry changes; no live provider was exercised.

## Structural passage increment

Parser version 2 retains complete fenced/indented code and pipe-table structures
up to twice the soft target, keeps adjacent fenced examples separate and records
oversized structure bounds. Table-header support is exact revision-bound text
retrieved through direct page postings and charged exact index lookups. Supporting
text is included in the normal response ceiling and does not consume the answer's
top-level chunk slot. Exhausted context budgets preserve the answer with an
explicit omission. Structural continuations read the remaining raw range.

The intermediate focused run passes 465 assertions across 25 functions with zero
failures; the final adjacent-fence addition is covered by the subsequent registered
full run. During development, a non-reset `var` in the parser loop was corrected,
and only the two temporary test JVMs running that old code were interrupted.
Granularity was removed from reader compatibility checks: a read-only client's
local build target does not invalidate a structurally compatible published index.
The effective published target is exposed on trusted source diagnostics.

The final registered wiki assertion harness passes **1,180 assertions across 185
functions with zero failures**, including the adjacent-fence and structural-range
checks. `ojob tests/wikiRetrievalV2.yaml` passes all 25 registered functions with
no failures. Results are saved in `wiki-parser2-assertions.json`. These results
retain the seven repaired baseline functions and existing ingestion/MCP tests;
they do not constitute completion of the remaining plan acceptance matrix.

The held-out quality harness was rerun on the six existing held-out questions:
Recall@k and MRR remain 1.0, all returned evidence ranges are correct and duplicate
fractions remain zero. The genuinely unanswerable query returns `zero`. This small
set does not establish comprehensive quality or prerequisite handling. General
warning/prerequisite packing, complex nested Markdown and transport stress remain
outstanding. No provider or deployment was changed.

## Request support reuse and incremental checksum validation

Complementary table rows now reuse complete header records within one request.
The retained response emits identical support once and attaches exact
`contextReferences` to later rows, after output clipping has decided which support
survives. Cache identity includes manager, page, revision, selected wiki/path and
range. Each answer candidate still passes its current active/permission check.
No session/global "already seen" state is created. The focused structural fixture
passes 32 assertions, including shared two-query budgeting and an independent
request that performs its own lookup.

Incremental manifest construction reuses expected SHA-256 checksums from the
pinned generation for immutable copied/linked files. Full staged-byte checksum
validation remains mandatory before pointer activation. A same-size staged-copy
corruption test fails with `generation-integrity-failure`, leaves the pointer
unchanged and continues serving the previous valid evidence. The immutable-file
fixture passes 24 assertions, including hard-link fallback and unchanged-content
protection.

The same 1,000-page fixture and ten incremental updates were run sequentially on
this machine against an isolated copy of the pre-change working source and the
changed source. Commands: `WIKI_BENCH_PAGES=1000 WIKI_BENCH_SAMPLES=10
WIKI_BENCH_LABEL=before-checksum-reuse oaf -f tests/wikiRetrievalUpdates.js`, then
the same command in this checkout with label `after-checksum-reuse`. Saved results
are `updates-1000-before-checksum-reuse.json` and
`updates-1000-after-checksum-reuse.json`, with runtime/source hashes.

Observed p50 update latency was 562.86 ms before and 510.01 ms after (9.4% lower);
p95/p99 were 851.64 and 782.89 ms. Ten samples make the tail values sample maxima,
not a precise population-tail estimate. Each update parsed one page but still
staged approximately 1,000 files. The removed redundant hash pass covered roughly
1.45–1.47 MB per update. Disk usage was approximately 41.0 MB for retained
generations in both runs. End heap was 290.8/304.8 MB, GC-sensitive and not peak
memory; no memory improvement is established. Initial builds were 1,693.03 and
1,559.42 ms, but full builds do not use this optimization, so that difference is
not attributed to it. The larger update cost relative to the original legacy
baseline remains unresolved. No real remote provider was measured.

The final OpenAF focused assertion harness passes **481 assertions across 25
functions**, and the full registered wiki assertion harness passes **1,195
assertions across 185 functions**, both with zero failures. Machine-readable
results are `v2-context-checksum-assertions.json` and
`wiki-context-checksum-assertions.json`. The seven baseline wiki repairs remain
covered. The remaining full-plan acceptance work is not inferred complete from
these focused improvements.

The standalone `ojob tests/wiki.yaml` run passes all **185 scheduled functions**
without failures. A pre-existing selected-mount scope test was declared but absent
from `todo`; it is now scheduled, so the standalone job and assertion harness cover
the same main-suite functions.

The latest test module passes **962 assertions across two consecutive runs in one
JVM** (`oaf -f tests/wikiRetrievalRepeat.js`). The request-local support memo does
not persist across those calls or manager instances. These runs include managed
reader closure, pinned-generation release and repeated restricted shared-channel
quota coverage. They are local/runtime validation, not distributed-writer or live
provider proof.

## Page, passage and metadata generation bindings

Checksummed catalogues now undergo semantic validation against immutable raw
blocks. Validation checks revision-specific locators/content hashes, character
length, front matter, titles/descriptions, outlines, passage text hashes and exact
line/UTF-16/UTF-8 offsets. Page/wiki ownership and complete passage postings are
required. Indexed stored text is checked against the catalogue before ranking,
feedback and disclosure. A shared production position helper serves segmentation
and validation. Fresh readers retain one page's map at a time and validate once
per generation; warm requests perform no repeat semantic block reads.

In-process publication can reuse a pinned parent's proof only for identical page
and passage records whose staged block passed the parent's expected checksum.
Changed or unmatched records are fully validated; fresh/read-only readers never
receive this shortcut. Each measured 1,000-page incremental update checked one
changed block and reused 999 page proofs. File staging and SHA-256 validation
remain corpus-wide.

The focused assertion harness passes **501 assertions across 26 functions**;
the full wiki harness passes **1,215 assertions across 186 functions**, with zero
failures. The standalone focused oJob passes all 26 functions. Fixtures include
rechecksummed forged catalogue fields, a rechecksummed incorrect raw revision,
an injected indexed stored-text mismatch, ownership/unreferenced-record rejection,
and unchanged-page proof reuse. The latest earlier repeat remains 962 assertions;
the new 26-function module has not yet been repeated in one JVM.

Machine-readable 1,000-page/ten-sample local results are
`performance-1000-before-bindings.json`,
`performance-1000-bindings-full-validation.json` and
`performance-1000-bindings-proof-reuse.json`. The first used the isolated earlier
source; file hashes identify each version. First compact search increased from
205.05 ms before binding validation to 527.77 ms in the final run. Warm p50 compact
search/retrieve/assembleContext were 5.61/5.84/6.75 ms in the final run; their warm
semantic-validation block reads and source reads were zero. New cold/init block
counters measure semantic validation only, excluding checksum I/O. Manager
construction and mount attachment are separately timed in the final harness.

`updates-1000-binding-proof-reuse.json` records ten updates: p50 557.20 ms,
p95/p99 840.14 ms, compared with 510.01/782.89 ms for checksum reuse without the
stronger bindings. The earlier 562.86-ms pre-checksum result is historical, not a
claim that final updates became 9.4% faster. End heap was 228.6 MB and retained
fixture disk approximately 41.0 MB; heap is GC-sensitive and not a peak measure.
Cold validation and remaining corpus-scaled publication are explicit tradeoffs,
and no live provider was exercised.

## Monotonic duration and private request-work accounting

Stage and total retrieval durations now use `System.nanoTime`, reported as
milliseconds. A delayed backend failure that exceeds its requested deadline records
its actual elapsed duration rather than the deadline cap. Request-work aggregates
come from the shared request budget, so concurrent engine-wide counters are not
subtracted to guess a caller's work. A minimal public output-budget error still
records its privately charged query attempt without adding public diagnostic fields.
No raw query/content persistence is added and the authority manifest remains
unchanged. A 40-ms delayed failure fixture explicitly tests the non-preemptible
operation limitation; it is simulated failure injection, not provider validation.

The focused OpenAF harness passes **509 assertions across 26 functions** and the
full wiki harness passes **1,223 assertions across 186 functions**, with zero
failures. These results cover actual uncapped duration, monotonic diagnostics,
failed-attempt accounting, slim error adapters and authority preservation. Saved
records are `v2-monotonic-assertions.json` and `wiki-monotonic-assertions.json`.
Existing benchmark files identify their measured source hashes and predate this
timing change. Individual backend/stale-event metrics and remaining evidence-stage
timings are still unfinished.

## Post-activation recovery

The publication recovery fixture now abruptly halts a real child JVM at seven
checkpoints, including immediately after pointer activation. At the final
checkpoint it adds a page absent from the pinned previous generation; a fresh
recovery JVM and read-only manager both retrieve that new page. The old reader
remains open and excludes the new page. Earlier checkpoint failures retain the
previous pointer and working evidence.

Exception fixtures verify that a post-activation failure reports the actual active
generation and successful local publication, and that retention contention plus
a failing warning logger still leaves publication successful. Both recovery test
functions pass under OpenAF using `oaf -c` with `ow.loadTest()` initialisation.
The fresh focused harness passes **523 assertions across 26 functions** and the
full wiki harness passes **1,237 assertions across 186 functions**, both with zero
failures. Machine-readable records are `v2-postactivation-assertions.json` and
`wiki-postactivation-assertions.json`. These tests retain the seven repaired wiki
baseline functions. They do not establish completion of the full v2 plan.
The expanded 26-function module also passes twice consecutively in one JVM:
**1,046 assertions**, recorded in `repeat-postactivation-assertions.json`. This
checks repeated construction, publication, pinned readers and closure; it is not
a concurrent latency or peak-memory benchmark.
The standalone `ojob tests/wikiRetrievalV2.yaml` run also passes all 26 registered
functions with no failing functions. Its PASS labels supplement, rather than
replace, the assertion counts above.
This is process-crash validation, not power-loss, real ENOSPC or live-provider
validation; the rest of that acceptance matrix remains open.

## Evidence selection and citation durations

The shared retrieval engine measures the main selection pass and its nested range
clipping/reference/citation decoration with monotonic durations. Compact search
measures its source and inline-source decoration; assembled context retains the
same engine diagnostics. The selection duration is inclusive and overlaps its
nested citation calls; it excludes final envelope repacking. These durations must
not be added as exclusive stage costs. Zero-result retrieval has zero citation
duration and no advertised citation stage.

A delayed decoration fixture verifies actual measured work, separately persisted
aggregate durations, returned evidence, byte-budget compliance and unchanged
knowledge authority. Structural-context and evidence-packing smoke functions also
pass under OpenAF. Individual backend timing, final-envelope packing and explicit
stale-event metrics remain unfinished. Existing performance measurements predate
this change and do not establish its performance impact.
The first broader run exposed a new small-envelope regression in the existing
2,200-byte oversized-evidence fixture. It is repaired: optional public timings
are omitted explicitly before the only quote is lost, and private duration
accounting remains intact. The targeted budget/telemetry functions pass after
the repair; the earlier failed run is not represented as a baseline failure.
After the repair, the focused assertion harness passes **541 assertions across
26 functions** and the full wiki harness passes **1,255 assertions across 186
functions**, both with zero failures. Machine-readable records are
`v2-evidence-timing-assertions.json` and `wiki-evidence-timing-assertions.json`.
The earlier 1,046-assertion same-JVM repeat predates these timing changes; the
expanded module has not yet been repeated in one JVM after this increment.
The standalone `ojob tests/wikiRetrievalV2.yaml` run also passes all 26 registered
functions with no failing functions after the repair. These PASS labels supplement
the assertion counts; they do not establish full-plan completion.

## Bounded stale and generation events

Read revision and grep selection mismatch fixtures verify separately persisted
`stale_reference_restarts` without counting cursor restarts as searches. Injected
indexed-text mismatch and inactive-evidence fixtures verify one request-level
generation/rejection event each. Unknown rejection causes are not presented as
proven revision mismatches. Fixed event names reject arbitrary keys, share the
query telemetry retention window and contain no raw paths, revisions or queries.
Persistence and warning-logger failure cannot change stale-reference handling;
event telemetry leaves the knowledge-authority manifest unchanged. The targeted
OpenAF telemetry function passes. Generation/inactivity injection is simulated
failure coverage; it is not live-provider validation. Core cursor counters do not
include restricted reference-policy rejections that happen before the core read.
Event-only retention rollover is tested separately from query activity, and a
read-only manager with telemetry requested leaves the persisted file unchanged.
The focused assertion harness passes **558 assertions across 26 functions** and
the full wiki harness passes **1,272 assertions across 186 functions**, with no
failures. Machine-readable records are `v2-stale-event-assertions.json` and
`wiki-stale-event-assertions.json`. The seven repaired baseline wiki functions
remain covered. These results do not complete the remaining full-plan matrix.
The standalone `ojob tests/wikiRetrievalV2.yaml` run passes all 26 registered
functions without failing functions after this increment. The earlier same-JVM
repeat and performance records predate the event changes.

## Explicit instruction support, parser v3

The structural-context fixture adds CRLF code instructions preceded by an explicit
prerequisite list and blockquoted bold warning. Retrieved instructions retain both
as separately ranged `instruction-context` evidence, with exact raw substrings
and the same content revision. Direct context postings fetch no full page bodies;
exhausted query budgets report missing support explicitly. Unrelated headings and
warning-looking fenced examples do not supply context. A parser-v2 manifest is
rejected explicitly rather than migrated by a reader. This derived-parser change
requires a writable reindex; previous generation directories remain preserved.

The targeted structural-context function passes under OpenAF. Implicit prerequisite
inference, separate prerequisite-heading associations and table warnings combined
with headers remain unfinished. The supported lookback is 64 raw lines, bounded
to the same heading and preceding code boundary. Earlier performance and same-JVM
repeat measurements predate parser v3 and do not establish its tradeoffs.
The focused assertion harness passes **572 assertions across 26 functions** and
the full wiki harness passes **1,286 assertions across 186 functions**, with no
failures. Records are `v2-instruction-context-assertions.json` and
`wiki-instruction-context-assertions.json`. The seven repaired baseline wiki
functions remain covered; broader context associations and the remaining plan
acceptance work are not inferred complete from these results.
The standalone `ojob tests/wikiRetrievalV2.yaml` run also passes all 26 registered
functions with no failing functions after the parser-v3 change.

## Required support under output limits

A real indexed long-warning fixture reproduces output caps that retain the code
instruction while excluding its required context. Initial record packing and
final-envelope repacking now both report `partial` with the explicit support
omission, rather than `hits`. The final-envelope fixture derives its ceiling from
the actual evidence-record size so it specifically exercises envelope overhead.
Returned answers remain present and complete serialized output stays within the
ceiling. Assembled context preserves the incomplete-evidence status; a larger
budget includes exact warning support and returns `hits`. The targeted structural
function passes under OpenAF. This is a v2 result-contract repair without an
artifact-format change; parser-v3 artifacts remain compatible.
The focused harness passes **585 assertions across 26 functions** and the full
wiki harness passes **1,299 assertions across 186 functions**, with no failures.
Records are `v2-required-support-budget-assertions.json` and
`wiki-required-support-budget-assertions.json`. Existing performance and same-JVM
repeat records predate this result-contract fix; no new performance claim is made.
The standalone `ojob tests/wikiRetrievalV2.yaml` run passes all 26 registered
functions without failing functions after this repair.

## Bounded context posting lookup

`testBoundedContextPostings` is registered in both wiki suites. Boundary/EOF tests
cover 1, 16, 256 and 4,096 postings with logarithmic comparison bounds. A real
Lucene page with more than 512 preceding passages retrieves its late instruction
and exact warning without full candidate body reads. A rechecksummed catalogue
with reversed postings is rejected, preserving the raw-order invariant needed by
binary lookup. Context materialisation inspects no more than eight subsequent
postings and keeps the existing shared query/candidate/output limits.

An isolated microbenchmark compares preceding-posting enumeration with binary
lookup on postings produced by the production Markdown parser:

```sh
WIKI_POSTING_SIZES=100,1000,10000 WIKI_POSTING_SAMPLES=1000 oaf -f tests/wikiRetrievalPostingsBenchmark.js
```

It reports per-lookup p50/p95/p99, sample counts, parser cost, actual passage counts,
comparison counts, runtime and source hash. It alternates timing order after
warmup. Timed binary lookup excludes optional per-probe accounting; comparison
counts are measured separately. This harness does not execute Lucene queries,
backend operations or whole retrieval, and cannot establish an end-to-end speedup.
The focused harness passes **787 assertions across 29 functions** and the full
wiki harness passes **1,346 assertions across 187 functions**, with no failures.
Records are `v2-context-postings-assertions.json` and
`wiki-context-postings-assertions.json`. The previous 26-function same-JVM repeat
predates the new helper; the expanded module has not yet been repeated.

The isolated microbenchmark completed sequentially after the regression JVMs
exited on OpenAF 20260913/JVM 26.0.2, with 1,000 samples per algorithm and size.
`context-postings-microbenchmark.json` records the source hash and full percentiles.

| Parsed passages | Linear records visited | Binary comparisons | Linear p50 ms | Binary p50 ms |
|---:|---:|---:|---:|---:|
| 103 | 102 | 7 | 0.016042 | 0.004125 |
| 1,003 | 1,002 | 10 | 0.067084 | 0.003292 |
| 10,003 | 10,002 | 13 | 0.709875 | 0.001583 |

Parser preparation took 60.69/93.44/394.56 ms respectively and is outside the warm
lookup timings. These are measured narrow lookup improvements, with optional
binary accounting excluded from timing, not whole-search or publication speedups.
Cold generation validation, corpus-wide file staging/checksumming and broader
acceptance work remain unchanged by this helper.
The standalone `ojob tests/wikiRetrievalV2.yaml` run passes all 27 registered
functions with no failing functions, including the new posting-boundary test.

## Legacy source context and extension installation

`testLegacyContextProvenance` is registered in the ingestion and full wiki suites.
It runs complete-source ingestion with a simulated distiller whose wiki body
differs from the original source text. Legacy context retains source-input text
with explicit provenance/navigation labels and no fabricated wiki positions,
revision or citation; the original-source locator remains unverified. Invalid
search outcomes propagate through an empty-chunk failure envelope, while a healthy
zero remains empty successful context.

The fixture replaces the context method with the actual core placeholder before
calling the production installer, proving replacement by function identity across
module scopes. It also verifies preservation of a custom implementation. The
targeted OpenAF function passes. The distillation callback and query outcomes are
simulated fixture inputs, not provider/model validation. No source content is
changed by reads or extension installation, and no artifact migration is needed.
The ingestion harness passes **235 assertions across 59 functions** and the full
wiki harness passes **1,518 assertions across 190 functions**, with no failures.
Records are `ingest-legacy-provenance-assertions.json` and
`wiki-legacy-provenance-assertions.json`. The previous focused-module and same-JVM
repeat reports predate this legacy/installer increment. These results preserve the
seven repaired wiki baseline functions and do not complete remaining acceptance.
The standalone `ojob tests/wikiIngest.yaml` run passes all 59 registered functions
without failing functions, including the new provenance/installation fixture.

`ojob tests/wikiRetrievalV2.yaml` also completes all 26 scheduled functions with
zero failures for this increment. The delayed-attempt fixture does not assert a
hard deadline that the injected operation cannot enforce.


## Aggregate heap sampling and fresh 100-page comparison

The performance harness now samples aggregate JVM heap through MemoryMXBean every
10 ms on a daemon measurement thread, stopped and joined before reporting and
again on failure cleanup. It reports sample count and maximum sampled heap;
shorter peaks can be missed, native/non-heap memory is excluded, and GC is not
controlled. The old `memoryUsed` field remains a final observation for compatibility.
Profiling adds overhead equally to these two serial runs. No test JVM ran during
either benchmark. This is local FS, parser-v4, current flag-off versus current v2,
not a fresh run of the original assessment commit or a live-provider measurement.

```sh
WIKI_BENCH_MODE=v2 WIKI_BENCH_PAGES=100 WIKI_BENCH_SAMPLES=10 oaf -f tests/wikiRetrievalPerformance.js
WIKI_BENCH_MODE=legacy WIKI_BENCH_PAGES=100 WIKI_BENCH_SAMPLES=10 oaf -f tests/wikiRetrievalPerformance.js
```

| Operation | Flag-off warm p50 ms | V2 warm p50 ms | Flag-off cold ms | V2 cold ms |
|---|---:|---:|---:|---:|
| Compact search | 9.70 | 6.36 | 54.19 | 138.17 |
| Zero-result search | 8.13 | 1.95 | 35.30 | 72.21 |
| Retrieve | 9.08 | 6.79 | 34.65 | 77.93 |
| Assemble context | 12.66 | 5.98 | 27.44 | 61.86 |
| Open | 0.65 | 0.24 | 6.30 | 49.80 |
| Navigate | 0.40 | 0.29 | 1.72 | 56.69 |
| Backlinks | 29.02 | 8.62 | 34.75 | 55.79 |
| Federation | 12.35 | 5.19 | 48.49 | 62.83 |

Cold values are one first-operation observation per fresh manager, excluding its
construction/attachment costs, which are recorded separately. Warm p50/p95/p99
use ten samples; tail estimates are weak at this sample count. V2 warm source GETs
are zero for all operations. Flag-off warm retrieve/context/backlinks perform
20/200/1,000 source reads over ten calls. Metadata stat/checksum/index IO is not
included in those source-GET counts. The single incremental update is slower in
v2: 135.53 versus 36.57 ms. Initial builds are 612.77 versus 1,810.56 ms and single
full publications 219.80 versus 1,331.65 ms; these are individual observations,
not latency percentiles. Final fixture bytes are 983,779 versus 132,335, including
retained generations; they are not a minimal active-index-size comparison.

Maximum sampled heap is 271,207,024 bytes across 189 samples for v2 and
272,371,784 across 319 for flag-off. These do not establish a peak-memory saving.
Machine-readable `performance-100-heap-{v2,legacy}.json` include full percentiles,
work counters, timings, source and recorded harness hashes. Larger fresh corpus
runs, assessment-baseline reruns with this profiler, native/physical I/O and full
resource-leak profiling remain required; this small comparison does not close
the performance acceptance matrix.


## Exact-revision citation evaluation

`tests/wikiRetrievalEvidence.js` centralizes the evaluator's strict citation
check. A correct quote must have finite integer UTF16 character offsets within
the raw revision, exact quoted text, its SHA1 revision, raw 1-based inclusive
start/end lines (including front matter), and a matching nested passage reference
with mount-qualified path identity. Finding a string anywhere in a page is no
longer counted as citation correctness. Five negative/positive controls run in
the already registered `testParser`: exact CRLF/Unicode content, stale revision,
body-relative lines, lost mount identity and substring-clamped invalid offsets.
The focused helper check reports `EVIDENCE_VALIDATOR_PASS` under OpenAF.

Fresh current v2/flag-off held-out runs use the unchanged six-question fixture
(five answerable and one genuine zero), without ranking-weight changes. V2
Recall@k and MRR remain 1.0, compared with 0.4 for current flag-off. Every returned
v2 evidence record passes all strict citation checks, including both complementary
pages and the last mounted wiki's identical relative path. Flag-off evidence lacks
the required position/revision fields, giving strict citation correctness zero;
this means unverifiable under the new evaluator, not demonstrated incorrect text
or a claim that the legacy surface promised those additive fields. No evidence
for the unanswerable question produces a null citation metric.

`quality-strict-held-out-{v2,legacy}.json` records evaluation version 2, metric
conventions, source/fixture hashes and per-record rejection reasons. Historical
citation metrics used weaker text-only verification and are not directly
comparable to these stricter values. The held-out set remains small and has been
previously observed; this rerun is regression evidence, not new independent
quality-generalization evidence. A larger independent corpus remains required.

The strict-citation increment's focused harness passes **884 assertions across
29 functions**, and the full wiki harness **1,615 across 190**, both with zero
failures. Records are `v2-strict-citation-assertions.json` and
`wiki-strict-citation-assertions.json`. The separate three-question development
rerun retains Recall@k/MRR 1.0 and is recorded in
`quality-strict-development-v2.json`; it is not held-out evaluation. The latest
standalone and same-JVM repeat results predate these five new evaluator controls;
the production reader lifecycle is unchanged by this test-helper increment.


## Fresh 1,000- and 10,000-page comparisons

The same heap-sampled harness completed four serial runs after the 100-page
comparison, with no concurrent test or benchmark JVM. These compare current
flag-off with current parser-v4 v2, not a fresh assessment-commit baseline. Source
and harness hashes are included in `performance-{1000,10000}-heap-{legacy,v2}.json`.
Use the previous commands with `WIKI_BENCH_PAGES=1000` or `10000`; all use ten warm
samples per operation. Cold observations exclude construction and mount attachment,
which the JSON reports separately. Tail percentiles with ten samples are weak.
The sampler's 10 ms interval is nominal; JVM scheduling/GC can delay samples.

| Pages | Operation | Flag-off warm p50 ms | V2 warm p50 ms | Flag-off cold ms | V2 cold ms |
|---:|---|---:|---:|---:|---:|
| 1,000 | Compact search | 11.61 | 6.26 | 50.72 | 484.80 |
| 1,000 | Zero-result search | 10.44 | 1.71 | 39.53 | 403.84 |
| 1,000 | Retrieve | 11.89 | 5.88 | 38.71 | 343.97 |
| 1,000 | Assemble context | 12.87 | 6.37 | 30.64 | 326.94 |
| 1,000 | Open | 0.64 | 0.24 | 8.50 | 319.17 |
| 1,000 | Navigate | 0.39 | 0.25 | 2.11 | 300.43 |
| 1,000 | Backlinks | 175.69 | 79.85 | 217.10 | 392.51 |
| 1,000 | Federation | 14.08 | 5.14 | 52.07 | 311.67 |
| 10,000 | Compact search | 11.29 | 6.26 | 64.69 | 3477.50 |
| 10,000 | Zero-result search | 11.63 | 1.78 | 37.48 | 2911.64 |
| 10,000 | Retrieve | 12.06 | 6.43 | 43.23 | 2897.26 |
| 10,000 | Assemble context | 11.42 | 5.53 | 45.32 | 2897.47 |
| 10,000 | Open | 0.50 | 0.22 | 5.37 | 2896.00 |
| 10,000 | Navigate | 0.27 | 0.24 | 2.20 | 2882.78 |
| 10,000 | Backlinks | 1296.31 | 543.87 | 1367.61 | 3668.22 |
| 10,000 | Federation | 13.48 | 5.15 | 57.91 | 2920.92 |

V2 warm source GETs are zero for every operation at both sizes; this does not
count stat, checksum, catalogue, immutable-block or Lucene IO. Flag-off backlinks
reads 10,000/100,000 source bodies across ten calls at 1,000/10,000 pages. Backlink
output contains the whole high-degree incoming posting, so its work and output
still grow with that degree even without corpus body reads.

| Pages | Observation | Flag-off | V2 |
|---:|---|---:|---:|
| 1,000 | Initial build ms | 15057.27 | 2281.32 |
| 1,000 | Single incremental update ms | 39.93 | 603.26 |
| 1,000 | Single full publication ms | 13459.81 | 1463.61 |
| 1,000 | Final fixture bytes | 1,059,887 | 9,538,673 |
| 1,000 | Maximum sampled heap bytes | 292,021,872 | 821,408,384 |
| 1,000 | Heap sample count | 2,240 | 719 |
| 10,000 | Initial build ms | 133570.83 | 13664.99 |
| 10,000 | Single incremental update ms | 47.91 | 4799.41 |
| 10,000 | Single full publication ms | 138708.02 | 13188.20 |
| 10,000 | Final fixture bytes | 10,535,255 | 95,183,481 |
| 10,000 | Maximum sampled heap bytes | 1,074,519,792 | 1,299,511,568 |
| 10,000 | Heap sample count | 20,406 | 5,319 |

Build/update/publication values are individual observations, not percentiles.
Final fixture sizes include retained generations and exclude the mount; they are
not minimal active-index sizes. V2's 10,000-page small update still copies 10,004
files and serializes the catalogue despite parsing only one changed page.
Maximum sampled heap excludes native/non-heap allocations, can miss shorter peaks
and is GC-dependent. It demonstrates no peak-memory saving. Cold v2 validation
remains corpus-scaled and materially slower than flag-off; full generation
publication and warm evidence operations are faster in these runs. No overall
performance gate is inferred complete: incremental costs, independent fresh
assessment-baseline/profile comparisons, more samples, physical IO, concurrent
callers and native/resource-leak profiling remain outstanding.


## Current immutable-copy comparison and publication diagnostics

A fresh same-runtime 1,000-page/10-update local comparison of explicit portable
copies and immutable hard links measures p50 507.40 versus 741.82 ms and p95/p99
644.88 versus 807.05 ms. Hard links reduce unique file bytes from 41,011,542 to
26,393,213 (POSIX identity and file-length estimator, excluding allocation and
metadata), while apparent retained fixture bytes remain about 41 MB. This
reproduced the earlier latency regression, so portable copies remained the default
at that revision. The update-path correction below supersedes that choice; these
measurements include an older block-staging architecture.
Records are `updates-1000-current-{copies,links}.json`. The harness now accepts
both explicit `WIKI_BENCH_LINKS=false` and `true` and records the effective setting;
no setting is silently inferred from the benchmark label.

Publication now adds actual monotonic elapsed stage timings to trusted update
work, including completed stages on failures. The registered immutable-generation
fixture asserts all twelve incremental timings are finite nonnegative numbers
while preserving its pinned-reader, checksums, same-revision, corruption and
fallback controls. Its targeted OpenAF run reports `PUBLICATION_TIMING_PASS`.
These changes do not alter artifact schema/fingerprint, flag-off behaviour or
query ranking. They add measurements to guide removal of corpus-scaled work;
they do not themselves fix that work or claim a speedup. The before/after runtime
sources are retained in `publication-timing-runtime-snapshots.zip`; the before
source checksum is verified against both measured copy/link records. Use snapshots
only in an isolated repository copy, never over the current dirty worktree.

The publication-timing increment passes **896 assertions across 29 focused
functions**, **1,627 across 190 full wiki functions**, and **1,792 assertions**
from two focused runs in one JVM, all with zero failures. Standalone oJob reports
29 PASS and zero FAIL/ERROR. Records are `v2-publication-timing-assertions.json`,
`wiki-publication-timing-assertions.json` and `publication-timing-repeat.json`.

After all regression JVMs terminated, a serial 1,000-page/10-update portable-copy
profile recorded actual stage timings in `updates-1000-publication-stage-profile.json`.
Stage medians are separate statistics and must not be summed to infer the median
whole-operation latency. Timings exclude final cleanup and enclosing wiki-write
work. Observed per-stage medians:

| Stage | Median ms |
|---|---:|
| preparation | 0.30 |
| catalogueFork | 1.30 |
| fileStaging | 238.01 |
| writerInitialization | 2.76 |
| pageUpdates | 2.74 |
| writerCommitClose | 18.25 |
| catalogueWrite | 25.04 |
| manifestWrite | 51.48 |
| artifactValidation | 151.17 |
| searcherVerification | 3.02 |
| activation | 0.62 |
| readerRetentionExport | 0.47 |

Whole-write p50 is 515.34 ms and p95/p99 613.44 ms.
This is diagnostic evidence, not a proven speedup; the previous uninstrumented
comparison has different source hashes. Corpus-scaled publication remains unfinished.


## Stage blocks after reconciliation

The immutable-generation fixture now verifies an updated page's retired block is
never staged, its avoided bytes match the original manifest and it is absent from
the newly activated generation while the original pinned reader/files remain
intact. Two additional manual pages with identical raw content share one revision
block. Deleting one preserves the block and exact evidence for the other; deleting
the last removes the block from the new generation and yields zero evidence.
Existing same-revision, hard-link fallback, corruption, lexical and pinned-reader
controls remain. The additional completed `blockStaging` timing is validated.
Targeted OpenAF reports `RETAINED_BLOCK_STAGING_PASS` and
`SHARED_RETAINED_BLOCK_PASS`. This is a change to the local publication sequence,
not schema migration, source-prune authorization, live-provider proof or a claim
that unrelated retained blocks no longer require staging. No performance speedup
is claimed without a same-corpus before/after measurement.

The retained-block increment passes **909 assertions across 29 focused functions**,
**1,640 across 190 full wiki functions**, and **1,818 assertions** from two focused
runs in one JVM, with zero failures. Standalone oJob reports 29 PASS and zero
FAIL/ERROR. Records are `v2-retained-block-assertions.json`,
`wiki-retained-block-assertions.json` and `retained-block-repeat.json`.
`retained-block-runtime-snapshots.zip` preserves the exact before/after runtime;
the before SHA1 matches the previous publication-stage profile. Existing latency
and copied-file measurements predate this change and must not be presented as
new measurements of the retained-only staging path. No new latency speedup is
claimed. The broader corpus-wide staging and validation architecture remains open.


## Never-staged block cleanup and batch-retirement benchmark

Staging cleanup now avoids unlink syscalls for retired blocks that were never
created in the new directory. Blocks actually written in the current build still
receive required cleanup. The registered immutable-generation test checks the
avoided-unlink count, alongside retained/shared block and pinned-reader controls.
Targeted OpenAF reports `RETIRED_UNLINK_PASS`; focused/full/repeat runs pass
**910 assertions across 29 functions**, **1,641 across 190**, and **1,820 assertions**
respectively, with zero failures. Standalone oJob reports 29 PASS and zero
FAIL/ERROR. Records are `v2-retired-unlink-assertions.json`,
`wiki-retired-unlink-assertions.json` and `retired-unlink-repeat.json`.

`tests/wikiRetrievalRetirementBenchmark.js` creates a fresh equivalent local corpus
per sample, warms its real reader, removes a configured page subset outside the
timed interval and measures one batch derived publication. Each sample verifies
retired evidence is absent, surviving evidence remains and page counts match.
This is simulated backend removal with real filesystem/Lucene publication,
not a timed ingestion ownership/prune/journal flow or live remote provider.
The isolated reference uses the verified runtime before retained-only staging;
all other root runtime files and the benchmark harness match the current checkout.
No test or other benchmark runs concurrently with either measured run. Memory,
fixture construction, source-removal IO and cleanup are outside this timing.

```sh
WIKI_BENCH_PAGES=1000 WIKI_BENCH_RETIRED=500 WIKI_BENCH_SAMPLES=10 oaf -f tests/wikiRetrievalRetirementBenchmark.js
```

| Metric | Before | After |
|---|---:|---:|
| Publication p50 ms | 481.79 | 305.54 |
| Publication p95 ms | 609.94 | 425.98 |
| Publication p99 ms | 609.94 | 425.98 |
| First sample copied files | 1,004 | 504 |
| First sample copied bytes | 1,469,407 | 911,620 |

Measured p50 is 36.6% lower in this run. All ten samples in both
runtimes return 500 surviving pages, zero newly parsed pages and correct retired/
surviving evidence. Afterward, 500 retired blocks are never staged and 500 unlink
calls are avoided per sample. Ten-sample p95/p99 estimates remain weak.
Machine-readable `retirement-1000-500-{before,after}.json` includes source/harness
hashes, all samples and actual stage timings. Exact measured runtime sources are
preserved in `retirement-measured-runtime-snapshots.zip`, with both hashes verified
against the result records. Reproduce only in isolated copies, preserving this
worktree. These measurements establish this batch-case improvement, not a general
small-update speedup, ingestion latency, cold-start or peak-memory improvement.
Full catalogue serialization, retained-block staging and validation remain
corpus-scaled; the broader publication-performance architecture is unfinished.


## Same-revision immutable block reuse

The registered immutable-generation fixture installs a throwing block-write hook
for an existing unchanged source revision, then requires incremental publication
to succeed with one reused block and, under explicit hard-link mode, the same
immutable inode. Existing checksum, corruption, shared-reference and stale-current
controls remain. Targeted OpenAF reports `SAME_REVISION_REUSE_PASS`.
The first test attempt caught an incorrect SHA256-checksum/SHA1-revision comparison
in the new condition; it was repaired before accepting validation. Failed runs
of that attempt are not current passing evidence. Same-revision selection now
uses the validated revision locator, while artifact integrity still uses SHA256
and exact position/text checks before activation. No latency speedup is inferred
from this deterministic removed-write control.

The corrected same-revision implementation passes **912 assertions across 29
focused functions**, **1,643 across 190 full wiki functions**, and **1,824
assertions** from two focused runs in one JVM, with zero failures. Standalone
oJob reports 29 PASS and zero FAIL/ERROR. Records are
`v2-same-revision-assertions.json`, `wiki-same-revision-assertions.json` and
`same-revision-repeat.json`. The superseded introduced condition error is recorded
separately in `same-revision-initial-attempt-failures.json`; it is not a baseline
failure or a current unresolved failure. `same-revision-runtime-snapshots.zip`
preserves the exact prior and corrected runtime, with the prior SHA1 verified
against the latest measured retirement result. Existing performance records
predate this change; no same-revision latency speedup is claimed. The larger
corpus-scaled publication, durability and acceptance matrix remain unfinished.


## Managed close-failure recovery

The registered lifecycle fixture now wraps actual Lucene reader/directory handles
with controlled IOException close failures. Before the repair, reader failure
escapes from release and the directory is closed prematurely by `finally`.
The corrected cases verify completed releases do not throw, pin and pending counts
remain zero, failed handles stay in the managed pool, failed attempts are counted,
directories stay open until appropriate, later shutdown retries successfully,
and successfully closed components are never closed again. Native reader reference
counts and actual directory operations prove closure, rather than a mock boolean.
The warning logger also throws without changing release outcomes. Targeted OpenAF
reports `READER_CLOSE_FAILURE_PASS`. These are local failure-injection controls,
not live provider faults or complete native/internal-leaf cleanup proof.

The managed-close increment passes **939 assertions across 29 focused functions**,
**1,670 across 190 full wiki functions**, and **1,878 assertions** from two focused
runs in one JVM, with zero failures. Standalone oJob reports 29 PASS and zero
FAIL/ERROR. Records are `v2-managed-close-assertions.json`,
`wiki-managed-close-assertions.json` and `managed-close-repeat.json`.
The prior/current runtime is preserved in `managed-close-runtime-snapshots.zip`.
Artifact schema/fingerprint and flag-off paths are unchanged. Managed snapshots
marked for closing are excluded from cached serving acquisition; pending resource
cleanup retains bounded handles and later guarded operations retry. That revision counted
failed managed-drain attempts; the following eviction-counter increment expands
coverage to all failed shared-helper attempts, while direct initialization cleanup
remains outside the counter.
Unmanaged initialization/staged-reader cleanup and native leaf-close error handling
still need further fault-matrix coverage. Existing benchmarks predate this change;
no new latency or leak-free lifecycle claim is inferred from these controls.


## Eviction close failure and active-generation recovery

The registered lifecycle fixture holds the first generation, publishes a second,
and injects directory-close failure during retirement while publishing a third.
It verifies the closed-reader/pending-directory state remains bounded, persistent
cleanup failure yields no evidence and explicit incomplete/unavailable coverage,
no unbounded replacement readers open, and the other acquired reader stays open.
After clearing the failure, a new request closes the pending directory and serves
exact third-generation evidence. Actual native reference counts and directory
operations establish resource state. A throwing warning logger remains harmless.
The first diagnostic assertion reproduced an undercount: direct eviction close
failure was omitted while two subsequent drain failures were counted. The atomic
counter now increments in the shared close helper; an enumerable JSON metric
control verifies trusted serialization. Targeted OpenAF reports
`EVICTION_CLOSE_FAILURE_PASS`. Public federation preserves its established
`partial` outcome with source `unavailable` coverage rather than inventing a new
whole-request outcome. No schema/lexical/flag-off change or performance claim is
introduced. Initial native-handle cleanup outside the shared helper remains an
explicit separate lifecycle item.

The eviction-close increment passes **959 assertions across 29 focused functions**,
**1,690 across 190 full wiki functions**, and **1,918 assertions** from two focused
runs in one JVM, with zero failures. Standalone oJob reports 29 PASS and zero
FAIL/ERROR. Records are `v2-eviction-close-assertions.json`,
`wiki-eviction-close-assertions.json` and `eviction-close-repeat.json`.
Exact prior/current runtime sources are retained in
`eviction-close-runtime-snapshots.zip`. Existing performance measurements predate
this diagnostic/lifecycle regression increment; no speedup is inferred. Unmanaged
staged/failed-initialization cleanup and the full required acceptance matrix remain
unfinished, and this passing lifecycle case does not prove them complete.


## Staged/partial-initialization resource retention

The registered lifecycle fixture now creates controlled failed initialization
and staged-reader cleanup cases through real Lucene directory/reader handles.
Two failed unmanaged closures alongside a pinned serving snapshot consume all
three slots. A further attempt reports resource-budget exhaustion without opening
another reader. The valid serving generation continues returning evidence.
After failure removal, guarded cleanup closes both real readers/directories,
returns slots exactly once, and shutdown returns all three slots. New opens after
shutdown are rejected. Original index-count initialization errors are preserved
instead of being replaced by cleanup errors. Targeted OpenAF reports
`UNMANAGED_RESOURCE_RECOVERY_PASS`. These are local failure injections and tracked
native-handle controls, not a guarantee about arbitrary Lucene-internal leaf
failures or hard native IO deadlines. Exact prior/current runtime is retained in
`unmanaged-resource-runtime-snapshots.zip`; no source schema migration occurs.

The bounded-unmanaged-resource increment passes **993 assertions across 29 focused
functions**, **1,724 across 190 full wiki functions**, and **1,986 assertions** from
two focused runs in one JVM, with zero failures. Standalone oJob reports 29 PASS
and zero FAIL/ERROR. Records are `v2-unmanaged-resource-assertions.json`,
`wiki-unmanaged-resource-assertions.json` and `unmanaged-resource-repeat.json`.
Snapshot initialization now routes failed cleanup through the shared helper, so
its failures are counted too; prior counter-scope limitations above describe
older revisions. No new benchmark, live-provider or arbitrary internal-leaf
cleanup guarantee is inferred from these tests. The full required plan remains
unfinished, including broader fault/concurrency, durability, retrieval/context
and incremental-performance acceptance work.

## Concurrent cleanup of the same native resource

The registered lifecycle fixture now races a failed unmanaged reader's active
cleanup against queued cleanup in actual bounded JVM threads. A busy retry does
not close the native handle, count a new close failure, or return its resource
slot. An active failed retry requeues the handle; a successful retry closes each
component and returns the slot once. Both cases preserve the acquired serving
reader. Direct closure of an acquired snapshot is rejected before marking it for
retirement. These are real local Lucene handles with injected facade failures,
not arbitrary native-leaf recovery or distributed concurrency validation.

Current OpenAF results: **1,033 assertions across 29 focused functions**,
**1,764 across 190 full wiki functions**, and **2,066 assertions from two focused
runs in one JVM**, with zero failures. Standalone oJob reports 29 PASS and zero
FAIL/ERROR. Machine-readable records are
`v2-concurrent-resource-close-assertions.json`,
`wiki-concurrent-resource-close-assertions.json` and
`concurrent-resource-close-repeat.json`. No performance improvement is inferred;
the remaining full-plan requirements still apply.

## Parser-v5 heading-key compatibility

OpenAF reproduced two `Constructor` headings receiving the identical
`constructor` anchor. The counter now uses a prototype-free map and explicit
own-property checks, including the special `__proto__` setter name. Regression
fixtures verify repeated anchors and legacy section reads against raw CRLF
front-matter positions. The changed derived contract uses parser v5; validation
rejects both v3 and v4 manifests, without modifying them. Writable reindex is
required; previous runtime/generation pairs remain rollback artifacts.

The initial Constructor regression increment passed 1,036 focused assertions,
1,767 full-wiki assertions and 2,072 assertions in two same-JVM focused runs,
all with zero failures. Those runs preceded the additional `__proto__` fixture
and second old-parser rejection assertion; final-v5 validation is reported
separately rather than attributing these earlier counts to the later tests.
Existing performance measurements predate v5 and remain historical measurements.

Final parser-v5 OpenAF full-wiki validation passes **1769 assertions across 190 functions**, with zero failures. Targeted parser and structural-context checks report `PARSER_V5_TARGETED_PASS`. The final full suite includes both prototype-name fixtures and both old-parser rejection assertions. Its source-bound record is `wiki-parser-v5-assertions.json`; exact runtime/test sources are in `parser-v5-runtime-snapshot.zip`.

## Explicit validity applicability

The current engine evaluates declared ISO calendar-date validity against one
captured request time, shared across selected wikis and feedback candidates.
Leap-day, inclusive end-date, expired, missing and invalid-calendar-date fixtures
exercise real indexed wiki passages. Explicit `applicability.validAt` requires
known validity, retains current source revision checks and never opens a historical
view. Caller options remain unchanged; editorial timestamps do not become trust
or verification dates. Trusted evidence carries declared validity without changing
restricted disclosure. This extends existing metadata; schema/parser fingerprints
remain v5 because raw positions and index fields are unchanged.

Targeted OpenAF reports `VALIDITY_APPLICABILITY_PASS`. Registered suites pass
**1,047 assertions across 29 focused functions**, **1,778 across 190 full-wiki
functions**, and **2,094 assertions in two focused runs in one JVM**, with zero
failures. Source-bound records are `validity-focused-assertions.json`,
`validity-full-assertions.json` and `validity-repeat.json`; exact source is retained
in `validity-runtime-snapshot.zip`. These checks do not complete broader
supersession schemes, approved structural maintenance, cross-surface applicability
request schemas or the remaining full-plan acceptance matrix. No new performance
or live-provider claim is made.

## Trusted applicability adapters

The utility facade and trusted standalone MCP search schema/job now forward
the applicability object. The registered real-index fixture executes the actual
MCP job body and verifies applicable page identity, explicit invalid-date errors,
feature-off capability errors and refusal to silently discard filters on scan
paths. Restricted schemas are unchanged. Both core agent dispatch paths forward
applicability and wiki scope; retrieve dispatch also forwards query/time budgets.
Their error adapters preserve failed/partial empty searches. Core source parses
under OpenAF (`CORE_DISPATCH_COMPILES`); end-to-end model dispatch is not inferred
from that parse check.

Final registered OpenAF results: **1,054 assertions across 29 focused functions**
and **1,785 assertions across 190 full-wiki functions**, with zero failures.
The utility oJob suite has 44 PASS and zero FAIL/ERROR labels; its assertions were
not separately counted in this run. Targeted indexed/job checks report
`TRUSTED_APPLICABILITY_PASS`. Initial fixture job-name and job-body comma errors
were corrected before these final runs. The record is
`trusted-applicability-validation.json`. No new listener, provider or performance
validation is claimed, and the full-plan acceptance matrix remains incomplete.

## Scoped request budgets through core and trusted MCP

Registered runtime tests execute both current core search/retrieve option mappings
against real Lucene evidence. They verify exact release applicability, explicit
last-mount selection with mount-qualified identity, and query/candidate/byte
limits. Search previously dropped these caller budgets; both core dispatch paths
and the shared utility now preserve them. Trusted search schemas and the actual
standalone MCP job expose and forward the same existing five budgets. Restricted
schemas and quota ceilings are unchanged. An additional real-index job-body check
reports `STANDALONE_MCP_BUDGET_PASS` after four assertions covering answer identity
and query/candidate/byte limits. This is job execution, not listener validation.

Final OpenAF results pass **1,078 assertions across 29 focused functions**,
**1,809 across 190 full-wiki functions**, and **2,156 assertions in two focused
runs in one JVM**, with zero failures. Targeted checks report
`CORE_SCOPED_BUDGET_MAPPING_PASS`. Source-bound machine-readable evidence is
`core-scoped-budget-validation.json`. The mapping tests do not replace full
model-driven transport, concurrency, revocation or provider acceptance work.
No performance improvement is inferred from this adapter repair.

## Filesystem publication synchronization

The current publisher forces staged artifacts/manifest and directory entries
before activation, forces the temporary pointer and serving directory before
rename, and forces the serving directory after rename. Actual JVM directory
force succeeds on the development filesystem. Registered recovery tests inject
artifact-file, generation-directory, pointer-file and post-rename activation
directory synchronization failures. Each verifies actual failure injection,
explicit publication/activation status, usable current pointer, fresh-reader
evidence and a successful subsequent publisher. Post-rename failure reports the
new generation as locally published; it cannot claim an uncommitted update.
The separate preparation-hook failure retains the previous generation too.

OpenAF passes **1,109 focused assertions across 29 functions**, **1,840 full-wiki
assertions across 190 functions**, and **2,218 assertions in two focused runs in
one JVM**, with zero failures. Targeted recovery reports
`PUBLICATION_SYNCHRONIZATION_PASS`. These tests issue operating-system durability
requests and inject exceptions; they do not simulate physical power loss, prove
storage-controller behavior or validate network filesystems/live providers.
The remaining crash/fault/transport and full-plan acceptance matrix still applies.

Matched local-FS benchmarks use 1,000 identical pages, ten incremental updates,
portable copies, OpenAF 20260913 and JVM 26.0.2. Runs were serial after all tests
exited. The isolated before engine comes from `validity-runtime-snapshot.zip` and
matches the exact prior engine SHA1; other runtime files and harness are identical.
Update p50 increased from **503.46 ms to 566.97 ms**, approximately 12.6% in these
runs. p95/p99 increased from 657.56 ms to 670.79 ms; ten samples provide weak tail
evidence. Initial build was 2,060.20 ms before and 2,118.97 ms after (one observation
each). Added synchronization has measured cost and does not fix corpus-scaled
publication amplification. End heap observations are not peak memory.
Raw results: `updates-1000-publication-sync-{before,after}.json`. The source-bound
summary is `publication-sync-validation.json`; current runtime/harness are in
`publication-sync-runtime-snapshot.zip`, with prior source in the earlier snapshot.
Reproduce independently at each source version without concurrent workloads:

```sh
WIKI_BENCH_PAGES=1000 WIKI_BENCH_SAMPLES=10 WIKI_BENCH_LINKS=false oaf -f tests/wikiRetrievalUpdates.js
```

## Recovery across synchronization checkpoints

The registered abrupt-JVM fixture now covers twelve checkpoints. Five additional
points exercise generation synchronization, pointer creation and force, pointer
rename before final directory force, and completed activation-directory force.
Each starts an actual abruptly halted publisher and a fresh recovery JVM.
Before rename the original pointer remains; after rename recovery serves the new
page. The originally pinned reader retains the old generation and excludes that
new page. Three post-rename exception cases separately verify truthful activation
and local-publication status and fresh-reader availability. Process exit codes,
evidence and native pinned-reader state are asserted, not inferred from job labels.

OpenAF reports **1,141 focused assertions across 29 functions**, **1,872 full-wiki
assertions across 190 functions**, and **2,282 assertions across two focused runs
in one JVM**, with zero failures. Targeted reports are
`SYNCHRONIZED_PUBLICATION_CRASH_PASS` and `POST_RENAME_FAILURE_PASS`.
The source-bound record is `synchronized-crash-validation.json`; current runtime
and registered tests are retained in `synchronized-crash-runtime-snapshot.zip`.
Earlier synchronization benchmarks refer to their recorded prior source hashes;
this test-checkpoint addition makes no new performance claim. Hardware power loss,
network filesystems, live providers, and the remaining full-plan gates are not
proved by these process-crash checks. Markdown and ingestion-journal durability
contracts remain unchanged.

## Immutable prepared-catalogue validation

Publication binds its prepared catalogue to the verified SHA-256 of the exact
UTF-8 serialization written. Validated nested records are frozen; unchanged
page/passage identities from the pinned parent can reuse semantic binding proof
after staged block checksums pass. Changed records and fresh readers still receive
full evidence-binding checks. Reader artifacts carry no prepared-memory shortcut.
Schema/parser remain unchanged. Registered fixtures assert immutable metadata and
outlines, mutation rejection, preserved page/passage identity and rejection of a
mismatched prepared checksum. YAML Date metadata is normalized to published JSON
ISO strings, with warm/restarted type equality tested under OpenAF.

Targeted validation reports `CANONICAL_IMMUTABLE_CATALOGUE_PASS`. The initial
pre-normalization suites passed 1,148 focused assertions, 1,879 full-wiki assertions
and 2,296 repeated-JVM assertions; those results do not prove the later date
normalization fixture. Final results are recorded separately below.

Serial matched 1,000-page/ten-update local-FS runs preserve directory/file force
and portable copies. The isolated before runtime is the exact retained
`synchronized-crash-runtime-snapshot.zip` source; other runtime files and harness
are identical. Update p50 decreased from 566.28 ms to 526.31 ms (about 7.1% in these
runs), p95/p99 from 676.04 ms to 618.43 ms. Validation-stage p50 decreased from
138.19 ms to 95.61 ms. Initial build was 2,114.64 ms before and 2,141.16 ms after,
one observation each. Ten samples provide weak tail evidence; end heap is not peak
memory. A diagnostic JVM overlapped the first after setup attempt; that attempt
was discarded, and the recorded after run completed without concurrent workloads.
Raw results are `updates-1000-immutable-catalogue-{before,after}.json`.
The compact map fork, artifact copies, checksumming and catalogue serialization
remain corpus-scaled; this does not complete broader incremental publication.

A current local-FS 1,000-page/three-update portable-copy run on OpenAF `20260914`
and JVM `26.0.2` measured p50/p95 566.39/689.26 ms. Each one-page update parsed
one source page but copied 1,003–1,010 retained files (about 1.46 MB), cloned
3,998–4,000 catalogue keys and serialized 4,000–4,002 records. Retained-block
staging consumed 219.72–242.09 ms and artifact validation 131.10–161.01 ms.
The recorded retrieval source SHA-1 is
`e3ded49e52f5481995d11edbd7fc81359f7c97e0`. This is a diagnostic local run,
not a performance acceptance gate or a completed incremental-publication claim.

The opt-in shared-block-store variant linked 1,000 retained blocks per update and
reduced the POSIX identity-based unique-file estimate from about 15.6 MB to 12.3
MB. Its local p50/p95 were 838.03/974.71 ms, slower than portable copies on this
filesystem because linking remains corpus-sized metadata work and full catalogue,
manifest and validation stages still execute. The regression corrupts a stored
block and verifies publication fails without replacing the active pointer. This
is a bounded storage-reuse result, not a latency improvement or a completed
publication redesign.

## Source I/O audit boundary accounting

The registered `SourceIoAuditAccounting` fixture verifies that a filesystem source
read emits exactly the UTF-8 payload byte length (including non-ASCII text), an
explicit `read`/`file` boundary descriptor and nonnegative elapsed duration. A
missing source emits the corresponding failed zero-byte record. The fixture also
verifies a filesystem existence probe as a distinct zero-byte boundary operation.
The shared source audit implementation applies that record shape to archive, S3,
HTTP and ES reads/probes; HTTP adds response status and its probe is HEAD,
whereas the existing S3 probe uses GET. This is application-boundary observability
only, not evidence of complete physical/kernel/protocol accounting or live provider
telemetry.

The same fixture directly reads a validated immutable block and verifies the
separate `serving-block` audit event carries UTF-8 bytes, `read`/`file` semantics
and a monotonic duration. Normal passage retrieval can use stored Lucene text,
which is recorded as `serving-index-passage` instead; this distinction prevents
the report from inventing a filesystem block read. It also verifies explicit
`lucene-stored` and `memory` protocol events for stored passage materialization
and immutable-body cache hits, both with zero blocking duration.

## Remote source revocation boundary

`SourceRevocationBeforeMaterialization` uses a real indexed generation with an
external-source backend whose permission probe succeeds during candidate search
and fails immediately before evidence materialization. It verifies the second
probe occurs, no remote body read is made, no indexed/cached quotation is
returned, and the response is explicitly partial with
`stale-or-revoked-evidence`. This is an in-process deterministic boundary test;
it is not a live identity-provider, transport-race or distributed revocation
proof.

## GitHub-style warning support

The structural-context fixture now covers a `> [!WARNING]` blockquote immediately
before a fenced command. It verifies the code remains selected evidence and the
admonition marker/body return as exact revision-bound `instruction-context`
support. Existing bold `**Prerequisites:**` and `> **Warning:**` forms remain in
the same fixture, preventing an admonition grammar change from regressing the
established label syntax.

## Explicit retirement status

The supersession regression now verifies `status: retired` excludes a page from
new evidence requests without requiring a replacement path, while `status: review`
remains descriptive and eligible. This joins existing `superseded`,
`superseded_by` and `retired: true` retirement markers; retired trusted pages
remain navigable but cannot become current retrieval evidence.

## Serial filesystem enumeration and failure preservation

The registered direct-postings fixture creates a nested manual page and 250 fake
Markdown blocks beneath a retained derived directory. Actual v2 source listing
visits only three source directories, excludes derived blocks and preserves
prefix-local page paths. An injected failed enumeration makes full publication
fail explicitly and leaves the exact pointer unchanged. A real missing directory
returns a failed enumeration outcome; restoring enumeration permits reindex and
query-relevant retrieval of the manual page. Targeted OpenAF validation reports
`SOURCE_ENUMERATION_RECOVERY_PASS`. Final OpenAF runs pass **1,164 focused
assertions across 29 functions**, **1,895 full-wiki assertions across 190
functions**, and **2,328 assertions across two focused runs in one JVM**, with
zero failures. The earlier move failure did not recur; its cause remains unproved.
The source-bound record is `serial-enumeration-validation.json`.
No speedup or live provider claim follows from these work-count checks.

The final canonical immutable-catalogue attempt before this enumeration repair
reported 1,882 full-wiki assertions with zero failures and 2,302 repeated-JVM
assertions. Its focused attempt failed in the stable-section/move fixture with an
undefined page record. Isolated reproduction and ten consecutive same-JVM runs
passed. The failure's cause remains unproved; a new diagnostic assertion identifies
missing move targets and publication status if it recurs. These earlier results
do not verify the current filesystem changes.

## Source read failures and canonical alias scope

The registered direct-postings fixture now distinguishes actual JVM source
attributes (`present` and `missing`). Injected full and incremental read failures
for an existing manual page retain the exact serving pointer; a fresh read-only
manager retrieves its previous valid evidence. A confirmed incremental deletion
still publishes and removes retired evidence from newly started requests.
Actual JVM symbolic links exercise a source-directory cycle, duplicate page alias,
outside-root directory and differently named alias to hidden derived content.
Enumeration remains three source directory listings and excludes unauthorized and
derived content. Targeted validation reports `SOURCE_READ_SCOPE_RECOVERY_PASS`.
OpenAF assertion-counted runs pass **1,176 assertions across 29 focused functions**,
**1,907 across 190 full-wiki functions**, and **2,352 assertions across two focused
runs in one JVM**, with zero failures. The source-bound record is
`source-read-scope-validation.json`. These are local filesystem tests with injected
body-read failures, not live remote validation, concurrent source transactions or
measured performance improvement.

The normal registered launcher `ojob tests/wiki.yaml` also completes with 190
actual PASS entries and no FAIL, ERROR or assertion-error entries. Assertion
counts above come from the separate registered-function counting harness;
outer oJob SUCCESS labels are not counted as assertions.

## Streamed catalogue publication

Publication no longer builds one complete catalogue JSON string plus its UTF-8
checksum copy. A buffered native writer emits individual catalogue-map values
through a SHA-256 digest stream. Registered real-generation tests compare exact
on-disk JSON bytes with canonical serialization, including Unicode and normalized
date metadata, and verify the explicit buffer size, individual-record count and
largest temporary record size. Existing publication failure hooks remain active
for catalogue writes. Initial targeted validation reports
`STREAMED_CATALOGUE_TARGET_PASS`. Final OpenAF runs pass **1,180 focused assertions
across 29 functions**, **1,911 across 190 full-wiki functions**, and **2,360 across
two focused runs in one JVM**, with zero failures. One high-degree posting can remain large, and traversal/checksum/copy
costs still scale with the corpus. No speedup is inferred from this architecture.

Matched serial local-FS benchmarks use 1,000 pages and ten incremental updates,
portable copies, identical harness/runtime/configuration and an isolated exact
prior engine. All regression processes exited before benchmarking. Update p50
increased from 530.38 ms to 541.10 ms (about 2.0% in these runs), p95/p99 from
663.79 ms to 670.38 ms. Initial builds were 2,112.29 ms and 2,121.91 ms, one
observation each. Ten samples provide weak tail evidence. End heap was 233,965,472
and 51,135,184 bytes; garbage collection makes these unsuitable evidence of peak
memory savings. The first update serialized 4,002 values individually with largest
value 746 characters and a 65,536-character buffer. This avoids the explicit whole
catalogue string/hash copy but does not establish an end-to-end memory speedup.
Raw results are `updates-1000-streamed-catalogue-{before,after}.json`; the validation
record is `streamed-catalogue-validation.json`. The measured source predates the
mid-stream/close recovery increment below; its catalogue failure hooks fail before
the stream opens. This incremental repair does not complete broader publication.

The normal `ojob tests/wiki.yaml` launcher passes all 190 scheduled tests without
FAIL, ERROR or assertion-error entries. The retained
`streamed-catalogue-runtime-snapshot.zip` contains the measured current runtime,
registered tests/harness and exact prior engine under `before/`. To reproduce,
extract into an isolated directory, run the command below against the root engine,
then replace only that isolated engine with `before/mini-a-wiki-retrieval.js` and
repeat. Run serially without concurrent tests/diagnostics; do not overwrite the
working checkout or compare unrelated configurations.

```sh
WIKI_BENCH_PAGES=1000 WIKI_BENCH_SAMPLES=10 WIKI_BENCH_LINKS=false oaf -f tests/wikiRetrievalUpdates.js
```

## Catalogue stream failure recovery

A new registered OpenAF fixture uses real native buffered writers and file
streams with injected Java IOException failures at initialization, partial write,
closure before/after delegate closure, and write followed by closure failure.
Partial-write cases flush actual truncated staged bytes. Each asserts explicit
failure, exactly one constructed-writer close attempt, closed underlying native
output (subsequent writes fail), unchanged pointer, fresh-reader prior evidence
and successful subsequent publication. The primary write error survives a second
closure error, while close failures remain counted in publication work. The
original real Lucene reader stays pinned across all five failures and recoveries.
Targeted validation reports `CATALOGUE_STREAM_RECOVERY_PASS`. OpenAF reports
**1,234 focused assertions across 30 functions**, **1,965 full-wiki assertions
across 191 functions**, and **2,468 across two focused runs in one JVM**, with
zero failures. The source-bound record is `catalogue-stream-recovery-validation.json`;
runtime and registered tests are retained in `catalogue-stream-recovery-runtime-snapshot.zip`.
These are local exception injections, not live-provider, physical disk
exhaustion or hardware power-loss validation. Prior streamed-catalogue benchmarks
refer to their retained source archive and make no measurement claim for this
later cleanup change. Broader corpus-scaled publication remains unfinished.

The normal `ojob tests/wiki.yaml` launcher also passes all 191 scheduled tests,
including `CatalogueStreamRecovery`, with no FAIL, ERROR or assertion-error entries.
Counts above are actual assertions from the separate registered-function harness,
not outer job labels. No performance measurements were repeated for this cleanup
change; earlier measurements identify their exact retained source revision.

## Single-read evidence validation

Referenced evidence blocks are decoded and SHA-256 verified through one native
digest-input stream before semantic revision/range validation. Existing source
bytes, CRLF, Unicode and front-matter positions are preserved. Registered fixtures
verify exact raw equality, rejection of a wrong checksum and rejection of actual
malformed UTF-8 bytes even with their matching checksum. Real fresh validation
counts one combined block read and zero separate static block-digest calls.
Unchanged-record publication and unreferenced manifest blocks still receive
checksum checks. Targeted markers are `VERIFIED_BLOCK_READ_PASS` and
`VERIFIED_UTF8_BINDINGS_PASS`. OpenAF passes **1,239 focused assertions across 30
functions**, **1,970 full-wiki assertions across 191 functions**, and **2,478 across
two focused runs in one JVM**, with zero failures. The normal
`ojob tests/wiki.yaml` launcher passes 191 actual test entries with no FAIL, ERROR
or assertion-error entries.
This removes a duplicate block read, not corpus-wide cold validation or artifact
copying. Native filesystem reads are not live-provider requests or complete
physical/protocol I/O telemetry.

Serial matched local-FS performance runs use 1,000 pages, ten warm samples per
operation, identical harness/configuration/runtime and the exact prior engine
from `catalogue-stream-recovery-runtime-snapshot.zip`. All test processes exited
before benchmarking. Cold timings exclude manager construction and mount attach
and represent **one observation per operation**, not cold percentiles. Cold
compact search was 576.73 → 587.12 ms, zero search 512.86 → 430.46 ms, retrieve
404.00 → 375.60 ms, assemble 374.50 → 360.10 ms, open 364.57 → 347.23 ms,
navigate 342.86 → 340.03 ms, backlinks 435.79 → 409.82 ms and federation
332.04 → 317.25 ms. These mixed observations do not establish a general speedup.
Warm p50 assemble increased 6.05 → 6.18 ms and federation 4.91 → 5.15 ms;
warm compact search was 6.22 → 6.08 ms. Ten samples provide weak tail evidence.
Every warm operation had zero source-body and validation-block reads.
Sampled aggregate peak heap increased 843,437,216 → 882,358,608 bytes; samples
are every 10 ms and exclude native/non-heap memory. Fixed block-read buffers are
a remaining allocation optimization; no memory reduction is claimed.
Raw results are `performance-1000-single-read-{before,after}.json`. The source-bound
summary is `single-read-validation.json`, with current runtime/harness retained in
`single-read-runtime-snapshot.zip` and prior runtime in the earlier archive.
Reproduce separately at each retained source revision, serially without concurrent
tests/diagnostics:

```sh
WIKI_BENCH_MODE=v2 WIKI_BENCH_PAGES=1000 WIKI_BENCH_SAMPLES=10 oaf -f tests/wikiRetrievalPerformance.js
```

## Adaptive verified-reader allocation

The native verified reader sizes its character array to the block's declared
byte length, bounded to 1–65,536 characters. Registered functional tests use
actual empty, accented, emoji and large multi-buffer Unicode/CRLF files and
verify exact returned content and checksum agreement. Existing corruption,
malformed UTF-8 and fresh-validation single-read checks remain in the same fixture.
Targeted validation reports `ADAPTIVE_BLOCK_BUFFER_PASS`. OpenAF passes **1,243
focused assertions across 30 functions**, **1,974 full-wiki assertions across 191
functions**, and **2,486 across two focused runs in one JVM**, with zero failures.
The normal `ojob tests/wiki.yaml` launcher passes 191 actual test entries without
FAIL, ERROR or assertion-error entries. Decoder/string-builder allocations remain additional
storage; the character-array bound is not a process-memory ceiling. Cold
validation and publication still traverse corpus-sized artifacts.

Serial matched 1,000-page performance runs use the exact prior source from
`single-read-runtime-snapshot.zip`, identical harness/configuration/runtime and ten
warm samples per operation after all test processes exited. Cold timings are one
observation per operation, excluding constructor/attach. Cold compact search was
577.95 → 578.99 ms, retrieve 402.20 → 380.50 ms and assemble 374.08 → 342.72 ms.
Warm open p50 increased 0.253 → 0.262 ms, navigate 0.244 → 0.260 ms and federation
4.85 → 5.17 ms. Sampled aggregate peak heap increased 848,570,136 → 902,800,256
bytes (10 ms sampling; excludes native/non-heap). These mixed results do not
establish an end-to-end latency or peak-memory improvement. Warm operations still
perform zero source-body or validation-block reads; ten samples provide weak tails.
Raw results are `performance-1000-adaptive-buffer-{before,after}.json`.

The new focused native allocation harness measures 1,000 verified reads per case
after ten warmups, using current-thread ThreadMXBean allocated Java heap bytes.
For 25-byte blocks, allocated bytes/read fall 166,589.8 → 35,716.4; for 792-byte
Unicode blocks, 167,615.3 → 38,271.3. The 319,992-byte control remains effectively
unchanged at 1,549,394.6 → 1,549,543.3 bytes/read. Every iteration verifies exact
content/checksum; the control uses the same maximum array size in both engines.
Small-block p50 latency increased 0.0630 → 0.0657 ms. Allocated bytes include the
calling-thread harness and exclude other-thread/native/non-heap allocations;
they are not peak memory or end-to-end retrieval measurements. Raw reports are
`block-allocation-{before,after}.json`. The source-bound combined validation record
is `adaptive-buffer-validation.json`; the exact current runtime and functional
fixture are retained in `adaptive-buffer-runtime-snapshot.zip`.

Reproduce serially against each retained source version without concurrent loads:

```sh
WIKI_BENCH_MODE=v2 WIKI_BENCH_PAGES=1000 WIKI_BENCH_SAMPLES=10 oaf -f tests/wikiRetrievalPerformance.js
WIKI_BLOCK_SAMPLES=1000 oaf -f tests/wikiRetrievalBlockBenchmark.js
```

## Approved missing-heading repair

A registered OpenAF fixture uses a manual page absent from the ingestion source
manifest, with CRLF front matter, Unicode title and old editorial/verification
dates. Default proposal preserves the exact raw file; apply requires explicit
approval and the current revision. The applied bytes match the reviewed proposed
revision, dates/front matter remain verbatim, the shared outline contains the new
heading and retrieval cites the new exact revision. Old approval, protected
policy paths and approved read-only writes are rejected. The actual operations
MCP `Wiki maintain` job is evaluated under OpenAF and delegates its new
`repair_heading` action to the same manager method; feature-off returns an explicit
`v2-required` outcome. Targeted markers are `APPROVED_STRUCTURAL_REPAIR_PASS` and
`STRUCTURAL_REPAIR_MCP_PASS`. OpenAF passes **1,259 focused assertions across 31
functions**, **1,990 full-wiki assertions across 192 functions**, and **2,518 across
two focused runs in one JVM**, with zero failures. The normal
`ojob tests/wiki.yaml` launcher passes all 192 test entries without FAIL, ERROR
or assertion-error entries. The source-bound record is
`approved-structural-repair-validation.json`.
This validates local core/job delegation, not a live MCP listener or provider.
The repair invokes no model and does not manufacture verification from formatting.
Source CAS, broader approved structural repairs and corpus-scaled publication
remain unfinished.

## Explicit retirement and repair-accounting regression

The real indexed supersession fixture has conflicting guidance: the retired page
has a newer editorial date, while its `superseded_by` points to the active page.
Search, retrieve and assembled context exclude the retired page. Grounded
derivative registration rejects retired support. A replacement in an unselected
mount is not followed; trusted navigation can still inspect the retired page.
This implements explicit retirement, not semantic contradiction resolution or
automatic reverse interpretation of `supersedes`.

Repair write accounting is now local to each invocation. Previously, the `wrote`
declaration was misplaced in derivative registration, allowing a rejected repair
to reuse an earlier invocation's write state. Regression assertions verify zero
writes for protected and read-only requests following a successful repair.
The targeted runtime marker is `EXPLICIT_SUPERSESSION_PASS`; the focused OpenAF
suite passes **1,268 assertions across 32 functions**, with zero failures.
The full-wiki assertion runner passes **1,999 assertions across 193 functions**,
with zero failures.
Two focused runs in the same JVM pass **2,536 assertions**. The normal
`ojob tests/wiki.yaml` launcher reports 193 actual PASS entries, with no FAIL,
ERROR or exception entries. The source-bound record is
`explicit-supersession-validation.json`.
No new performance or live-provider validation is claimed for these changes.

## Nested procedure and table prerequisites

The shared serving-time prerequisite selector now climbs the enclosing heading
ancestry within a 64-entry/64-line bound. It supports a prerequisite section
containing nested headings and a nested instruction under the adjacent parent
procedure. It stops at intervening sibling procedures. Table fragments select
both prerequisite support and column headers instead of allowing either to
replace the other. No artifact schema or source-content migration is introduced.

The real Lucene structural fixture checks inherited Unicode/CRLF content against
its exact raw character range, rejects inheritance across an unrelated procedure,
and verifies that a late table fragment retains both prerequisites and headers.
The targeted marker is `NESTED_PREREQUISITE_PASS`. The focused OpenAF runner
passes **1,274 assertions across 32 functions**, with zero failures. The full
wiki runner passes **2,005 assertions across 193 functions**, with zero failures.
The source-bound record is `nested-prerequisite-validation.json`. These are
trusted shared-engine fixtures; implicit inference and restricted-interface
packing remain separate acceptance work. No performance improvement is claimed.

## Restricted support and character ceilings

Opaque passage reads use the same support-range selector as trusted retrieval.
The current serving catalogue must agree with the grant's physical wiki, page,
passage revision and selected character bounds. Complete support is included only
when it fits alongside the answer within the existing character/line ceilings.
Otherwise `incomplete: true` reports omission without topology or internal IDs.
Support and answer consume one read and the same cumulative character ledger;
there are no extra references, cooldown allowances or caller-controlled ranges.

The real indexed fixture verifies nested prerequisite inclusion, answer retention,
content-only fitting responses, character/line caps, exact cumulative character
charging and oversized-warning omission. The support-only full runner passed
2,014 assertions across 193 functions and the focused runner passed 1,283 across
32 functions, with zero failures, before the helper corrections below.

The existing truncation helper incorrectly used a code-point cap against the
UTF-16 quota ledger, and returned complete values for a zero allowance. It now
returns at most the configured UTF-16 units, avoids splitting surrogate pairs and
returns empty text for zero allowance. These are feature-independent corrections
shared with restricted skills. The targeted marker is
`RESTRICTED_SUPPORT_UTF16_PASS`. Broader concurrency/revocation/transport stress,
implicit context inference and the full plan remain unfinished. This fixture
does not establish live-provider or listener validation or new performance gains.
The corrected runtime passes **1,286 focused assertions across 32 functions**
and **2,017 full-wiki assertions across 193 functions**, with zero failures.
The source-bound record is `restricted-support-validation.json`.

## Graph-hint metadata allowance and public score guidance

The sanitized legacy graph-hint label previously bypassed the remaining
per-result metadata allowance. It now goes through the same bounded helper as
direct descriptions. A registered regression sets a six-unit metadata ceiling
and verifies that both direct and graph result title-plus-description values fit;
the fully allocated graph title leaves an empty description. Opaque references
and cumulative charging remain unchanged. This repair applies independently of
v2; it does not enable graph expansion in the v2 pipeline.

The targeted marker is `RESTRICTED_GRAPH_METADATA_CAP_PASS`. The full OpenAF wiki
runner passes **2,019 assertions across 193 functions**, with zero failures.
The source-bound record is `graph-metadata-cap-validation.json`.
`USAGE.md` and `docs/WIKI.md` now distinguish native engine relevance, final
ranking and surface-dependent compatibility scores, and explicitly describe the
unsupported v2 graph-expansion capability. No new benchmark or provider result
is inferred from these correctness and documentation repairs.

## Unchanged affected-page record reuse

Incremental requests now verify source bytes and stamps before changing derived
records. An unchanged revision with compatible passage granularity and no move
reconciliation retains its immutable records, avoiding segmentation, Lucene
delete/add and link-posting removal/reconstruction. A stamp-only source change
refreshes the page stamp while retaining the exact revision. Full staged checksum,
semantic binding, representative read and synchronization validation still apply.

The real immutable-generation fixture verifies no parser work for the unchanged
request, retains an actual incoming-link posting, changes filesystem modification
time without changing content, verifies the refreshed stored stamp and retrieves
the current evidence. The targeted marker is `UNCHANGED_RECORD_STAMP_PASS`.
The initial smaller fixture passed 1,289 focused and 2,022 full-wiki assertions
with zero failures before the stronger link/stamp assertions were added.
Corpus-sized catalogue copying, serialization, file staging and validation remain
unfinished architectural work; these work-count checks establish no latency or
memory improvement. Move, exclusion, missing-source and unavailable-source paths
retain their existing reconciliation/error behavior.
The strengthened fixture passes **1,295 focused assertions across 32 functions**
and **2,028 full-wiki assertions across 193 functions**, with zero failures.
The source-bound record is `unchanged-record-reuse-validation.json`.

## Restricted adapter telemetry

The existing search/read names now delegate through a shared observer when
v2 and telemetry are enabled. It records only fixed operation/outcome counters,
total elapsed milliseconds and output UTF-8 bytes in the separate telemetry
structure. It covers pre-core query rejection and quota exhaustion, invalid
references, unavailable backends, zero/success results and support omissions.
No query text, path, opaque reference, document content or caller identity is
passed to the aggregate recorder or added to restricted responses. Core query
counts and adapter outcome counts describe different stages and are not additive
request counts. Transport-before-job and skills-specific events remain outside
this observer's scope.

The registered real indexed fixture checks rejection, stale-reference, incomplete
and quota counters, absence of query/path strings, unchanged responses when the
recorder throws, and in-memory read-only counters with unchanged persisted
telemetry after shutdown. Targeted validation reports
`RESTRICTED_TELEMETRY_READONLY_PASS`. Writable persistence reuses existing
batching/retention; read-only observation does not create pending persisted work.
No backend physical/protocol I/O completeness, transport stress or performance
improvement is inferred from these aggregate adapter checks.
The initial focused runner passes **1,305 assertions across 32 functions**.
After the disabled-observer bypass was added, its direct runtime marker is
`DISABLED_RESTRICTED_OBSERVER_PASS` (two assertions), and a fresh full-wiki run
passes **2,038 assertions across 193 functions**, with zero failures.
The final source-bound record is `restricted-telemetry-validation.json`.

## Early exact-support budget deduplication

Inspection found the parser's current support ranges disjoint, with exact support
deduplication already performed after final packing. The missing step was budget
selection: a later candidate still paid for already-selected support text before
that final deduplication. The selector now replaces exact support duplicates with
references to earlier selected records before byte/token charging. The reference
wrapper remains charged. Wiki alias, page, raw revision and selected range are
part of identity, preserving distinct provenance.

The real structural fixture retrieves complementary table rows under the shared
two-query limit, emits the exact header once, verifies the retained header's
passage reference and now verifies early-reuse accounting. It also retains the
existing output-cap, structural continuation, warning/prerequisite and exhausted
context-budget checks. Targeted validation reports `EARLY_SUPPORT_DEDUP_PASS`.
The focused runner passes **1,306 assertions across 32 functions**, with zero
failures. This is exact support deduplication, not a general overlapping-range
merger. No latency improvement or independent quality gain is claimed.
The full-wiki runner passes **2,039 assertions across 193 functions**, with zero
failures. The source-bound record is `early-support-dedup-validation.json`.

## Pointer recovery and static HTTP serving regression

Serving publication now keeps one validated predecessor pointer. A reader whose
active pointer or selected generation fails validation can use that predecessor
without rewriting activation state; the regression corrupts `current.json` and a
referenced immutable block, then verifies only the prior validated generation is
served. Publication fault checkpoints retain their existing pre/post-activation
semantics.

The structural-support merger now unions only overlapping spans while preserving
the caller's priority for disjoint contexts, so a complete table header remains
available before a separately budgeted warning. Static HTTP bundle readers serve
their validated immutable passage text without inventing a per-page HTTP
permission endpoint; the same fixture separately exercises the dynamic backend
read/exists accounting path.

On 2026-09-15, the registered OpenAF assertion runners passed **1,320 assertions
across 33 v2 functions** and **2,047 assertions across 193 full-wiki functions**
with zero failures. These are local filesystem/simulated-backend results only;
they do not prove physical power-loss behavior, live S3 reader refresh or
authorization denial, network-filesystem durability, or provider performance.

## Exported predecessor recovery

Published v2 bundles now contain the active generation and, when present, one
fully validated predecessor generation with `previous.json`. Hydration validates
both generations before activation, and the static HTTP fixture corrupts the
hydrated active pointer to prove that a read-only consumer selects only the
predecessor without rewriting activation state. This extends local recovery to
the bundle transport; it is not live S3/provider validation.

On 2026-09-15, the registered runners passed **1,323 assertions across 33 v2
functions** and **2,050 assertions across 193 full-wiki functions**, with zero
failures.

## S3 bundle-reader lifecycle

The registered S3 fixture drives the manager's actual `_hydrateS3Artifacts()`
bundle path with an in-process S3 client: configured bucket/key selection,
metadata-gated no-op refresh, hydrated evidence serving, denied metadata refresh
with the prior pointer retained, and a changed ETag activating a complete
replacement generation. The fixture passes **1,343 assertions across 34 v2
functions** with zero failures. It validates Mini-A's reader lifecycle and failure
handling, but uses a simulated S3 client; live IAM, provider cache, network and
S3-compatible-server behavior remain separate verification obligations.

## Local live S3-compatible bundle reader

On 2026-09-15, a disposable local MinIO server at `127.0.0.1:19000` was used as
a live S3-compatible endpoint. Mini-A created bucket `mini-a-live`, uploaded the
Markdown source and `artifacts/mini-a-wiki-index.zip`, and a read-only `backend:s3`
manager hydrated and retrieved the indexed passage. A replacement source/bundle
produced a new active generation and served its new passage. Replacing the reader
client with an invalid secret made refresh fail while preserving the replacement
cache pointer. The bucket and container were removed after the run.

This proves Mini-A's S3-compatible reader/hydration/replacement/denial path
against a local live service. It does not prove a public-cloud IAM policy,
provider cache/network failure behavior, distributed writer coordination, or
physical durability.

## Area 5 application I/O and local durability boundary — 2026-09-16

The registered `SourceIoAuditAccounting` fixture now checks UTF-8 source
payloads, zero-byte probes, verified catalogue shard payloads and checksum
failures, immutable block reads, Lucene stored-passage materialization, cache
hits, and successful and failed `FileChannel.force` requests. The S3 bundle
fixture checks compressed/expanded byte accounting and a metadata-only refresh
with zero download bytes. A force event records elapsed time and target kind,
with zero physical bytes; an unchanged bundle probe cannot be mistaken for a
download. The audit callback remains best effort.

On this checkout, focused audit, S3 metadata and twelve-checkpoint abrupt-JVM
recovery runs passed. The v2 assertion runner passed 1,494 assertions across 45
functions with no failures. Registered v2 and wiki jobs passed 45 and 197
functions respectively, with no reported failures. The JVM recovery run checks a
fresh process at every checkpoint; existing publication fixtures also inject
file, directory and pointer synchronization errors. These results characterize
the local filesystem and OS-request boundary only. They do not measure Lucene
index-file traffic, checksum physical reads, kernel cache, TCP/TLS framing,
provider-side bytes, device writes, network-filesystem acknowledgements or
physical power-loss recovery. The [Area 5 measurement contract](../WIKI-RETRIEVE-PLAN.md#area-5-local-io-and-durability-characterization--2026-09-16)
specifies how to collect those environment counters and recovery observations.

## Area 6 cross-surface check — 2026-09-16

The governing plan and companion audit now record Area 6's local completion.
The current source forwards CLI telemetry and skill-library flags, accepts
v2/artifact and skill settings through the web launcher, and constructs dedicated agent/console skill managers
with v2, cache and telemetry settings. The OpenAF cross-surface fixture opens a
published generation from a dedicated skill manager and verifies aggregate
restricted skill rejection telemetry. `tests/wikiRetrievalTransport.py` exercises
trusted and restricted wiki/skills MCP tools over both STDIO and localhost HTTP,
including skill search/open/read, opaque references, and a malformed recognized
safe-skill query. Historical statements above about missing skills-specific
telemetry or corpus-wide cold binding validation describe older revisions.
The current v2 assertion runner passed 1,507 assertions across 46 functions
with no failures; the registered wiki and skills jobs and the eight local
transport/descriptor smoke combinations passed.

Local smoke does not measure broad concurrent transport load, a live provider,
or malformed frames rejected before a recognized MCP tool is dispatched.

## Area 1 update-path correction — 2026-09-16

Ordinary shared-store updates no longer run synchronous full-catalogue
reclamation. Full reindex or explicit maintenance retains the journalled sweep.
Default immutable index staging now uses hard links, with unsupported-link
fallback and an explicit `linkImmutableFiles:false` copy override.

`PublicationScopedValidation` now exercises the shared store and counts calls
across the complete update, including cleanup, so swallowed cleanup failures
cannot hide a full-catalogue scan. It also proves full reindex reclaims an
unreachable residue. `ImmutableIncrementalGenerations` checks default zero-copy
index staging, actual unsupported-index-link fallback, and pinned-generation
checksums. `DirectDerivedPostings` retains explicit-copy coverage.

The v2 assertion runner passed **1,530 assertions across 46 functions**, including
the twelve abrupt-JVM checkpoints, with no failures. `ojob tests/wiki.yaml`
passed **197 functions** with no reported failures.

The source-bound local-FS 1,000-page/three-update record is
[`updates-1000-deferred-reclamation-links.json`](../tests/fixtures/wiki-retrieval-v2/updates-1000-deferred-reclamation-links.json).
Each update parsed one page, copied zero catalogue keys, made six routed-key
lookups, performed zero full catalogue resolutions and zero reclamation calls,
and copied zero retained index bytes. Retained index links numbered 4, 8 and 11.
The observed p50 was 123.52 ms and p95/p99 198.68 ms; three samples under local
suite activity do not establish tail latency or a matched speedup. The benchmark
now records complete-update resolution and reclamation call counts itself.

Area 1 end-to-end scaling acceptance remains open. Metadata/force operations,
Lucene merges, copy fallback and configured full bundle export can still scale;
explicit maintenance and deferred disk retention require separate measurement.
No new provider, network-filesystem or physical power-loss proof is claimed.

Reproduction commands from the checkout root:

```sh
WIKI_COUNT_SUITE=wikiRetrievalV2 oaf -f tests/wikiRetrievalAssertions.js
ojob tests/wiki.yaml
WIKI_BENCH_PAGES=1000 WIKI_BENCH_SAMPLES=3 WIKI_BENCH_SHARED_BLOCKS=true oaf -f tests/wikiRetrievalUpdates.js
```

## Area 7 independent local evaluation and release audit — 2026-09-16

This is a fresh, source-bound local-FS assessment on `autonomy` at
`adb7b88c556b9ac7c66db532d013d9ca03dbd05a` plus the Area 7 harness changes.
The runtime reports OpenAF `20260914` and JVM `26.0.2` on Darwin 25.6.0 arm64.
Each JSON record carries source hashes; the performance records also carry the
unchanged benchmark-harness hash. V2 and flag-off runs used the same corpus,
configuration, runtime and host sequentially, with no concurrent benchmark or
test process. `main` is the compatibility baseline for released behavior;
unreleased v2 schemas and intermediate APIs were not benchmarked as migration
targets.

### Frozen quality set

[`acceptance.json`](../tests/fixtures/wiki-retrieval-v2/acceptance.json) was
frozen before its first retrieval run and no ranking weights or query expectations
were changed after observing results. It is separate from the three-question
development and six-question previously observed held-out sets. Its 30 local
pages and 31 questions include 12 exact identifiers, eight natural questions,
three complementary-page questions, two version-scoped questions, one last-mount
identity question and five genuinely unanswerable identifiers. Twelve long
parameter pages put the answer after repeated introductory text. Expected
support binds both text and mount-qualified page identity.

| Metric | Current flag-off | Current V2 |
| --- | ---: | ---: |
| Passage Recall@k, 26 answerable questions | 0.8846 | 1.0000 |
| MRR, 26 answerable questions | 0.8846 | 1.0000 |
| Exact-identifier success | 12/12 | 12/12 |
| Strict cited revision/range correctness | 0/35 verifiable | 37/37 correct |
| Duplicate fraction | 0 | 0 |
| Mean supporting characters per estimated content token | 0.403 | 2.204 |
| Unanswerable questions with no evidence | 5/5 | 5/5 |

Flag-off misses the two version-scoped questions and last-mount answer. Its
evidence does not expose V2's revision/position citation contract, so 0/35 means
unverifiable under the strict evaluator, not demonstrated incorrect source text.
V2 returned one `partial` outcome on a paired question even though both expected
passages were present; the other answerable results were `hits`, and all five
unanswerable outcomes were `zero`. The useful-character metric estimates content
tokens as `ceil(content characters / 4)` and excludes wrapper/prompt tokens.
These curated synthetic questions test deterministic evidence selection; they do
not establish real-world answer generalization or a model's final answer quality.
The [V2](../tests/fixtures/wiki-retrieval-v2/quality-acceptance-v2.json) and
[flag-off](../tests/fixtures/wiki-retrieval-v2/quality-acceptance-legacy.json)
records contain every query, cited path, strict citation check, outcome, fixture
hash and runtime source hash. `python3 tests/wikiRetrievalAcceptance.py` verifies
the frozen source binding and required quality results.

### Matched local-FS performance

[`tests/wikiRetrievalPerformance.js`](../tests/wikiRetrievalPerformance.js) ran
20 warm observations per operation at each size. Cold time is the first call
after constructing a read-only manager; construction and mount attach are separate
fields in the JSON. JVM and OS caches were not forcibly cleared between runs.
The p99 of 20 samples is the maximum, so it is a weak tail estimate. Initial
build, single update and full publication are one observation each, not latency
distributions. All times below are milliseconds.

| Pages | Mode | Warm search p50 | Warm zero p50 | Warm retrieve p50 | Warm backlinks p50 | Cold open | Build | Small update | Full publication | Max sampled heap MiB |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | flag-off | 8.86 | 8.02 | 8.67 | 25.39 | 12.98 | 1,853 | 32.27 | 1,402 | 102 |
| 100 | V2 | 14.33 | 1.47 | 14.39 | 8.39 | 194.82 | 985 | 127.59 | 600 | 259 |
| 1,000 | flag-off | 10.86 | 10.30 | 11.17 | 142.29 | 6.90 | 13,632 | 41.74 | 13,599 | 258 |
| 1,000 | V2 | 17.59 | 1.46 | 17.85 | 78.07 | 1,072.29 | 3,177 | 150.07 | 4,037 | 503 |
| 10,000 | flag-off | 11.13 | 10.59 | 10.78 | 1,396.24 | 8.31 | 139,029 | 49.15 | 140,368 | 708 |
| 10,000 | V2 | 23.40 | 1.41 | 23.90 | 609.42 | 9,128.18 | 17,063 | 264.58 | 83,089 | 2,648 |

The complete [100](../tests/fixtures/wiki-retrieval-v2/performance-area7-100-v2.json),
[1,000](../tests/fixtures/wiki-retrieval-v2/performance-area7-1000-v2.json)
and [10,000](../tests/fixtures/wiki-retrieval-v2/performance-area7-10000-v2.json)
V2 records and corresponding
[100](../tests/fixtures/wiki-retrieval-v2/performance-area7-100-legacy.json),
[1,000](../tests/fixtures/wiki-retrieval-v2/performance-area7-1000-legacy.json)
and [10,000](../tests/fixtures/wiki-retrieval-v2/performance-area7-10000-legacy.json)
flag-off records include warm p50/p95/p99, cold calls, manager construction,
source requests/bytes, output bytes, validation block reads, reader opens,
sampled heap, publication work and final fixture bytes. At 10,000 pages the
final V2 fixture occupied 74.1 MB versus 10.5 MB flag-off; V2 warm source-body
GETs were zero, while flag-off recorded 200,540 across the operation matrix,
mostly backlinks. These counters do not include Lucene index, metadata or
kernel/device I/O. The heap sampler observes aggregate Java heap every 10 ms;
it can miss shorter peaks and excludes native memory.

V2 improves zero-result search, backlinks, build and full publication on this
matrix. Warm compact search, retrieve and assemble context are slower, as are
cold operations and small updates. Cold open/navigation grow sharply with corpus
size. The matrix therefore does not justify an overall latency or memory win.
The large V2 full-publication observation also differs from older runs; it is
one observation under this exact source and machine, not a stable percentile.

The controllable-latency local facade is separately recorded for
[V2](../tests/fixtures/wiki-retrieval-v2/performance-area7-simulated-100-v2.json)
and [flag-off](../tests/fixtures/wiki-retrieval-v2/performance-area7-simulated-100-legacy.json):
100 pages, 20 warm samples and an injected 2 ms delay per source-body read.
Warm backlinks p50 was 3.60 ms V2 versus 325.87 ms flag-off, with zero versus
2,000 source-body reads. This is simulated backend latency, not a provider result.

### Complete shared-store update path

[`tests/wikiRetrievalUpdates.js`](../tests/wikiRetrievalUpdates.js) measured ten
one-page updates at 1,000 and 10,000 pages with `sharedBlockStore:true` and
default linked immutable files. It includes the complete update call, force
requests, deferred maintenance, disk retention, full reindex and a fresh
read-only reader after publication. Explicit copy mode was measured at 1,000
pages. All three records carry the exact harness/runtime hashes.

| Pages and mode | Update p50 / p95 ms | Force requests per update | Retained index copied per update | Explicit maintenance ms | Full reindex ms | Unique file bytes after ten updates |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 linked | 118.19 / 178.41 | 29–47 | 0 | 1,190.60 | 4,926.24 | 5,131,813 |
| 10,000 linked | 115.11 / 169.46 | 29–47 | 0 | 5,003.45 | 37,498.48 | 48,018,945 |
| 1,000 explicit copy | 107.77 / 169.43 | 29–47 | 352–379 KB | 1,215.83 | 5,049.43 | 8,745,466 |

The [1,000 linked](../tests/fixtures/wiki-retrieval-v2/updates-area7-1000-linked.json),
[10,000 linked](../tests/fixtures/wiki-retrieval-v2/updates-area7-10000-linked.json)
and [1,000 copy](../tests/fixtures/wiki-retrieval-v2/updates-area7-1000-copy.json)
records show six routed-key lookups and one binding-block read per update,
zero full catalogue resolutions and reclamation calls inside every update,
and no copied retained index bytes in linked mode. Linked-file *apparent*
bytes still grow with Lucene segments, but hard links do not copy those bytes.
The force count varied with Lucene files/merges, not corpus size in these two
runs. Explicit maintenance retained all 1,010/10,010 reachable blocks and did
not shrink disk immediately; full reindex increased unique bytes because a
previous generation remains retained. Copy mode's p50 being slightly lower in
one run is noise, not evidence that copying is faster. The measured ordinary
update remained flat between these two sizes, while maintenance, full reindex,
retained disk and post-publication manager construction grew with corpus size.
This supports a bounded *local ordinary update* claim, not corpus-independent
total lifecycle cost, device bytes or network-filesystem behavior.

### Concurrent readers and release decision

The [same-JVM local reader run](../tests/fixtures/wiki-retrieval-v2/concurrent-area7-1000.json)
used four callers with 30 `retrieve` calls each against one warm 1,000-page V2
generation. All 120 returned the expected evidence and all threads stopped;
latency p50/p95/p99 was 5.32/12.94/17.02 ms. This does not test multiple JVMs,
writers, remote providers or network transport pressure.

The governing plan's required-fixture and hard-gate audit is explicit here:

| Requirement group from plan §11 | Current local evidence | Audit outcome |
| --- | --- | --- |
| Late answer, exact identifier, complementary evidence, version conflict, last mount, same relative path and genuine zero | Frozen Area 7 acceptance fixture plus `testRetrievalAndPublication`, `testFederationAndBudgets`, `testFederatedAliasAndPermissionBoundary` | Passed on local real Lucene; five unanswerable queries remain zero. |
| Repeated/code headings, table/list context, CRLF/Unicode, oversized structures and exact citations | `testParser`, `testStructuralContext`, `testListStructuralSupport`, `testEvidenceWindowsAndRelevancePacking`, strict Area 7 citation checks | Passed on local fixtures. |
| Source/derived differences, manual content, modification/deletion/move/supersession, ownership, stale references | `testRetrievalAndPublication`, `testStableSectionAndMoveIdentities`, `testExplicitSupersession`, `testIngestBatchAndDeferredExport`, `testGroundedDerivatives` | Passed in registered fixture paths. |
| Missing/incompatible index, partial backend failure, read-only behavior and safe namespace quotas | `testLegacyReadOnlyLexicalFeatures`, `testPublicationFailureRecovery`, `testRestrictedPassages`, `testConcurrentRestrictedLedger`, `testSourceRevocationBeforeMaterialization` | Passed in local fixtures; live provider fault behavior remains Area 8. |
| Continuations, mount isolation, exact revision/ranges and actual lexical configuration | `testParser`, `testLexicalAndEvidenceBudget`, `testEnhancedPassageLexical`, `testFederatedAliasAndPermissionBoundary`, 37/37 strict acceptance citations | Passed on local real Lucene. |
| Healthy zero result, warm metadata/outline, backlink and direct passage lookup without corpus-body scanning | `testDirectDerivedPostings` and matched performance counters: zero V2 warm source-body GETs at 100/1,000/10,000 pages | Passed at the instrumented source-body boundary; Lucene/index/OS reads are separate. |
| Shared mount/query budgets, pruning, pointer-last failure recovery, telemetry separation | `testFederationAndBudgets`, `testFederatedRetryBudget`, `testExplicitSupersession`, `testPublicationFailureRecovery`, `testProcessCrashPublicationRecovery`, `testTargetedTelemetryRetention` | Passed for local single-writer fixture cases. |
| Safe-MCP quotas, read-only/archive non-mutation, feature-off behavior, current-format bundle and obsolete development-schema rejection | `testRestrictedPassages`, `testArchiveServingAndTruncatedBundle`, `testLegacyReadOnlyLexicalFeatures`, `testSchema3CatalogueDelta`, flag-off Area 7 quality/performance runs | Current-branch local paths passed. Stable `main` is the compatibility contract; no new stable-`main` parity run was made. Development-only schema-1/2 readers are deliberately not retained. |

This maps every §11 fixture class and hard gate to a current fixture or
measurement, but the table's local pass entries do not substitute for provider
or physical durability proof. The benchmark records contain no remote-provider
request accounting or device-write byte claims.

Fresh regression execution on this checkout: `WIKI_COUNT_SUITE=wikiRetrievalV2
oaf -f tests/wikiRetrievalAssertions.js` passed **1,530 assertions across 46
functions** with no failures; `ojob tests/wikiRetrievalV2.yaml` passed all 45
registered V2 jobs; `ojob tests/wiki.yaml` passed **197 functions** with no
reported failures. No production retrieval source was changed for this Area 7
evaluation. The new acceptance checker, concurrent benchmark and all
machine-readable benchmark runs also completed successfully.
`oaf -f tests/wikiRetrievalRepeat.js` passed two complete V2 passes in one JVM
with **3,070 assertions**. `ojob tests/skills.yaml` passed **21 functions**
with no reported failures. The repeat count includes assertions outside the
single-pass counter's scope; it is not used as a quality sample size.

The new evidence closes Area 7's **measurement and audit work** at the local
boundary. The quality/citation gate passes on the frozen set and registered
functional regressions remain the hard correctness gate. Performance release
acceptance is **not signed off**: cold calls, warm retrieval, small updates,
artifact size and sampled heap regress in this matrix. Area 1's architectural
ordinary-update boundary now has matched 1,000/10,000-page evidence, but
end-to-end lifecycle scaling remains qualified by explicit maintenance and full
publication. Area 8 still requires live provider, distributed coordination,
network-filesystem and physical-durability proof where deployed.

Reproduce serially from the checkout root (one command at a time):

```sh
WIKI_EVAL_SPLIT=acceptance WIKI_EVAL_MODE=v2 oaf -f tests/wikiRetrievalQuality.js
WIKI_EVAL_SPLIT=acceptance WIKI_EVAL_MODE=legacy oaf -f tests/wikiRetrievalQuality.js
python3 tests/wikiRetrievalAcceptance.py
WIKI_BENCH_MODE=v2 WIKI_BENCH_PAGES=1000 WIKI_BENCH_SAMPLES=20 oaf -f tests/wikiRetrievalPerformance.js
WIKI_BENCH_MODE=legacy WIKI_BENCH_PAGES=1000 WIKI_BENCH_SAMPLES=20 oaf -f tests/wikiRetrievalPerformance.js
WIKI_BENCH_PAGES=1000 WIKI_BENCH_SAMPLES=10 WIKI_BENCH_SHARED_BLOCKS=true WIKI_BENCH_LINKS=true oaf -f tests/wikiRetrievalUpdates.js
WIKI_BENCH_PAGES=1000 WIKI_BENCH_CALLERS=4 WIKI_BENCH_CALLS=30 oaf -f tests/wikiRetrievalConcurrentBenchmark.js
```

Repeat the performance commands with `WIKI_BENCH_PAGES=100` and `10000`, and
the update command with `WIKI_BENCH_PAGES=10000`; set
`WIKI_BENCH_LINKS=false` for the portable copy case. For simulated source
latency, add `WIKI_BENCH_REMOTE=true WIKI_BENCH_LATENCY_MS=2` at 100 pages.

## Targeted metadata and shard-cache follow-up — 2026-09-16

The Area 7 profile identified two avoidable serving costs: cold metadata calls
materialized and validated the entire catalogue through `snapshot.catalog`, and
warm selected-key lookups reread/checksummed/parsed the same catalogue shards.
The follow-up removes those paths for `open`, `navigate` and `backlinks`, caches
immutable verified shards under the existing shared payload budget, and retains
an immutable per-snapshot routing proof. Backlinks reuses a verified shard within
one request while checking activity for each incoming source. Selected-page
outline/frontmatter validation still checks the immutable block's revision and
semantic bindings; remote metadata does not fetch the source body.

The new registered regression covers targeted serving with full materialization
forced to fail, warm reuse, immutable records/routing, forged metadata, changed
cached shard checksums, full-validator cache bypass, eviction, generation refresh,
pinned predecessors, external source edits, remote metadata and shutdown cleanup.
The V2 assertion runner passed **1,556 assertions across 47 functions**, with no
failures (`assertions-cache-v2.json`). The unchanged 30-page/31-question acceptance
fixture passed against both current modes (`quality-cache-{v2,legacy}.json`): V2
Recall@k/MRR remain 1.000/1.000, strict citations 37/37 and unanswerables 5/5.
This is regression on the now-observed set, not a new independent held-out result.

Reproduction:

```sh
WIKI_COUNT_SUITE=wikiRetrievalV2 oaf -f tests/wikiRetrievalAssertions.js
WIKI_EVAL_SPLIT=acceptance WIKI_EVAL_MODE=v2 oaf -f tests/wikiRetrievalQuality.js
WIKI_EVAL_SPLIT=acceptance WIKI_EVAL_MODE=legacy oaf -f tests/wikiRetrievalQuality.js
python3 tests/wikiRetrievalAcceptance.py --prefix quality-cache
WIKI_BENCH_MODE=v2 WIKI_BENCH_PAGES=1000 WIKI_BENCH_SAMPLES=20 oaf -f tests/wikiRetrievalPerformance.js
WIKI_BENCH_MODE=v2 WIKI_BENCH_PAGES=10000 WIKI_BENCH_SAMPLES=20 oaf -f tests/wikiRetrievalPerformance.js
```

Performance uses the unchanged harness and workload, run sequentially without
other test jobs. Before values are the preserved same-host Area 7 source-bound
runs; after values are `performance-cache-{1000,10000}-v2.json`. These are separate
JVM runs with 20 warm samples per operation, not statistically controlled repeated
experiments. Cold operation timings exclude separately reported manager creation
and mount attachment. Cache accounting bounds serialized payload, not decoded
object heap overhead, request-local shard references or native memory. Full
validators bypass serving reuse; the local immutable-file contract assumes no
adversarial file rewrites preserving file identity, length and modification time.

| Pages | Operation | Cold before → after (ms) | Warm p50 before → after (ms) |
| ---: | --- | ---: | ---: |
| 1,000 | compactSearch | 158.70 → 161.99 | 17.59 → 10.92 |
| 1,000 | zeroSearch | 84.12 → 93.84 | 1.46 → 1.55 |
| 1,000 | retrieve | 113.85 → 125.33 | 17.85 → 8.48 |
| 1,000 | assembleContext | 99.00 → 118.74 | 16.82 → 8.32 |
| 1,000 | open | 1072.29 → 99.63 | 0.23 → 0.39 |
| 1,000 | navigate | 945.59 → 92.63 | 0.24 → 0.41 |
| 1,000 | backlinks | 1003.77 → 250.40 | 78.07 → 98.52 |
| 1,000 | federation | 106.41 → 111.28 | 13.56 → 6.51 |
| 10,000 | compactSearch | 594.65 → 587.69 | 23.40 → 9.13 |
| 10,000 | zeroSearch | 450.68 → 465.62 | 1.41 → 1.46 |
| 10,000 | retrieve | 486.94 → 501.00 | 23.90 → 8.10 |
| 10,000 | assembleContext | 475.16 → 506.69 | 23.11 → 7.56 |
| 10,000 | open | 9128.18 → 469.29 | 0.21 → 0.34 |
| 10,000 | navigate | 8497.47 → 459.69 | 0.23 → 0.37 |
| 10,000 | backlinks | 9170.31 → 1547.29 | 609.42 → 797.84 |
| 10,000 | federation | 481.25 → 503.13 | 21.72 → 6.79 |

At 10,000 pages, cold open is 19.5× faster and warm retrieval 2.95× faster.
Cold open validates one selected block instead of 10,000. Sampled peak heap
across the full benchmark fell from 527,124,712 to 387,261,632 bytes at 1,000
pages and from 2,776,356,240 to 1,406,630,920 bytes at 10,000 pages. GC and
sampling affect these observations; they are not retained-heap guarantees.

The remaining tradeoffs are visible: warm open/navigation gain sub-millisecond
file checks, and warm high-degree backlinks regress by 26–31% while cold
backlinks improve 4.0–5.9×. Backlinks must still inspect every incoming source;
selected-key routing and cache management add work compared with an already
materialized whole catalogue. Cold retrieval/search is broadly unchanged because
structural acquisition still scales with generation size. Full lifecycle cost,
retained artifact size, deep delta lineage and provider concurrency need separate
work. This closes the two selected serving optimizations, not every Area 7
performance concern; the opt-in boundary and qualified release decision remain.

The final four-caller same-JVM workload completed all 120 retrievals without
errors at 1,000 pages: p50 3.72 ms, p95 8.07 ms, p99 10.72 ms
(`concurrent-cache-1000.json`). This exercises shared-cache synchronization for
local readers; it is not distributed or live-provider concurrency proof.

```sh
WIKI_BENCH_PAGES=1000 oaf -f tests/wikiRetrievalConcurrentBenchmark.js
WIKI_COUNT_SUITE=wiki oaf -f tests/wikiRetrievalAssertions.js
```

The final full registered wiki assertion run passed **2,124 assertions across
199 functions**, with no failures (`assertions-cache-wiki.json`). Artifact source
hashes, frozen quality checks and `git diff --check` also passed.

## Backlink serving optimization — 2026-09-17

Following the 2026-09-16 serving-cache work, a 10,000-page profile found
9,459,905 bytes of reverse/page shard payload against the default 8 MiB budget.
Seven warm backlink calls reread 1,799 shards (65,654,568 bytes); a 16 MiB
allowance removed those rereads and lowered the median from 818 to 615 ms in
that separate diagnostic run. Inclusive instrumentation attributed roughly
400 ms of a 10,000-source call to source stamps and 238 ms to catalogue lookup
at the default allowance. Instrumentation changes timings and the diagnostic
run has seven samples, so the matched Area 7 harness below is the comparison.

The implementation reduces source-stamp filesystem operations and resolves the
canonical root once per backlink request. Reverse postings carry the source
stamp bound to each page; backlinks checks current source activity directly from
the compact posting and strips the stamp from public output. Incremental
same-content updates refresh affected postings when their source stamp changes.
Full validation compares every reverse posting with its page, including stamps.
The selected reverse key is resolved once per lineage level, so no per-incoming
source parent-manifest read remains. No new general-purpose lineage memo is
needed on this path. Old unreleased postings without stamps require reindexing.

The focused regression covers external content and stamp-only changes, delta
publication, full validation, symlink denial, public shape and bounded lineage
lookups. The earlier targeted metadata and direct-posting tests passed as well.
The matched local-FS performance run uses the unchanged 20-warm-sample harness,
with 1,000 and 10,000 pages, separately from the 2026-09-16 source-bound runs.
These are separate JVM runs, not a statistically controlled multi-run experiment.

| Pages | Backlinks cold before → after | Warm p50 before → after | Selected shard reads before → after | Catalogue lookups before → after |
| ---: | ---: | ---: | ---: | ---: |
| 1,000 | 250.40 → 144.74 ms | 98.52 → 48.28 ms | 253 → 1 | 21,021 → 21 |
| 10,000 | 1547.29 → 1055.97 ms | 797.84 → 377.60 ms | 5,397 → 1 | 210,021 → 21 |

At 10,000 pages warm backlinks are 2.11× faster than the previous serving-cache
revision, and cold backlinks are 1.47× faster. The result still scales with the
number of incoming sources because each current source is checked and each
returned link is serialized. The default cache holds the selected reverse shard
(2,096,801 bytes at 10,000 pages), so this workload has no serving-cache
thrashing. Initial fixture disk grew from 37,366,194 to 38,415,299 bytes at
10,000 pages because each reverse posting now records a source stamp. The same
run sampled a higher heap peak (1.91 versus 1.41 GB) and slower cold retrieval
(691 versus 501 ms), while warm retrieve was 9.57 versus 8.10 ms; these unrelated
operation measurements need a repeat before attributing their difference to the
posting change or GC. The original Area 7 V2 peak was 2.78 GB.

```sh
WIKI_BENCH_MODE=v2 WIKI_BENCH_PAGES=1000 WIKI_BENCH_SAMPLES=20 oaf -f tests/wikiRetrievalPerformance.js
WIKI_BENCH_MODE=v2 WIKI_BENCH_PAGES=10000 WIKI_BENCH_SAMPLES=20 oaf -f tests/wikiRetrievalPerformance.js
```

The final V2 runner passed **1,573 assertions across 48 functions** and the full
registered wiki runner passed **2,139 assertions across 200 functions**, both
with no failures (`assertions-backlinks-{v2,wiki}.json`). The unchanged frozen
30-page/31-question fixture passed against the current source: V2 answerable
Recall@k/MRR 1.000/1.000, strict citations 37/37, and five of five
unanswerables (`quality-backlinks-{v2,legacy}.json`). This is a regression
check on an observed synthetic set. Four same-JVM local callers completed 120
retrievals without errors, with p50/p95/p99 of 3.92/7.41/10.62 ms
(`concurrent-backlinks-1000.json`). It does not prove live-provider or
multi-process concurrency.

```sh
WIKI_COUNT_SUITE=wikiRetrievalV2 oaf -f tests/wikiRetrievalAssertions.js
WIKI_COUNT_SUITE=wiki oaf -f tests/wikiRetrievalAssertions.js
WIKI_EVAL_SPLIT=acceptance WIKI_EVAL_MODE=v2 oaf -f tests/wikiRetrievalQuality.js
WIKI_EVAL_SPLIT=acceptance WIKI_EVAL_MODE=legacy oaf -f tests/wikiRetrievalQuality.js
python3 tests/wikiRetrievalAcceptance.py --prefix quality-backlinks
WIKI_BENCH_PAGES=1000 oaf -f tests/wikiRetrievalConcurrentBenchmark.js
```

### Final-source recheck

A full second 10,000-page run on the first posting implementation measured
379.09 ms warm backlinks, 514.23 ms cold retrieve and 1,983,470,384 bytes sampled
peak heap. The full validator was then changed to compare each posting separately
instead of serializing a whole high-degree list twice. Focused positive and
forged-stamp validation passed. The final-source unchanged-harness measurements
are `performance-backlinks-final-{1000,10000}-v2.json`:

| Pages | Backlinks cold | Backlinks warm p50 | Selected shard reads, 21 calls | Sampled peak heap |
| ---: | ---: | ---: | ---: | ---: |
| 1,000 | 152.67 ms | 53.31 ms | 1 | 654,214,464 bytes |
| 10,000 | 1,041.91 ms | 379.90 ms | 1 | 1,874,296,376 bytes |

The final 10,000-page result is a 2.10× warm-backlink improvement over the
previous serving-cache revision (797.84 ms); cold backlinks improve 1.49×
(1,547.29 ms). Cold retrieve varied across the original, first backlink,
repeat backlink, and final-source runs (501, 691, 514, 576 ms); warm retrieve
varied 8.10, 9.57, 8.64, 10.06 ms. Sampled peak heap varied 1.41, 1.91, 1.98,
and 1.87 GB. These separate JVM runs do not isolate GC or attribute the larger
heap observations to a specific code path. The final initial fixture occupied
38,414,803 bytes at 10,000 pages versus 37,366,194 bytes before the compact
posting change. A release heap and broader lifecycle budget remains open.

Final-source verification after the bounded full-validator change repeated the
complete suites: **1,573 V2 assertions across 48 functions** and **2,139 wiki
assertions across 200 functions**, with no failures. The current-source frozen
acceptance fixture again passed at V2 Recall@k/MRR 1.000/1.000, 37/37 strict
citations and 5/5 unanswerables. Four same-JVM callers completed 120 retrievals
without errors (p50/p95/p99 3.46/9.54/14.26 ms). The source-bound files are
`assertions-backlinks-final-{v2,wiki}.json`,
`quality-backlinks-final-{v2,legacy}.json` and
`concurrent-backlinks-final-1000.json`.

## Area 8 environment evidence — 2026-09-17

The executable `tests/wikiRetrievalArea8S3.js` ran against a disposable
localhost `minio/minio:latest` container (image ID
`sha256:8f08aee614800a237906bd48114d733e5ac5bfac4ccdf731f141b0e880d7a253`).
It creates a unique object prefix in a pre-existing disposable bucket and
removes both objects afterward. Source commit, image ID and all eleven passed
checks are recorded in `tests/fixtures/wiki-retrieval-v2/area8-s3-compatible-live.json`.
The new check covers real S3 protocol metadata/download, unchanged ETag,
credential denial, corrupt replacement, pointer/evidence retention and valid
replacement with retired evidence omitted. It passed with exit code 0. The
test file and plan edits were uncommitted during the run.

To repeat against an authorized disposable S3-compatible endpoint, create an
empty bucket and set `WIKI_AREA8_S3_URL`, `WIKI_AREA8_S3_BUCKET`,
`WIKI_AREA8_S3_ACCESS_KEY` and `WIKI_AREA8_S3_SECRET_KEY`, then run
`oaf -f tests/wikiRetrievalArea8S3.js`. The account needs object put/get/head
and delete access under its temporary `area8/` prefix. The script intentionally
does not create or remove the bucket.

| Area 8 deployment gate | Current evidence | Evidence needed to close that gate |
| --- | --- | --- |
| Local S3-compatible bundle reader | Ten live MinIO checks passed on the recorded image | Repeat on each supported provider/configuration and exercise its network/cache/authorization failures. |
| Public-cloud IAM and remote revocation | No cloud endpoint reached; STS returned a connection error on this host | Temporary least-privilege cloud bucket/identity, allowed and denied principals, live permission change between candidate discovery and disclosure, provider request logs and fresh-reader result. |
| Network filesystem publication/recovery | No NFS/SMB/FUSE mount available in this checkout | Record mount protocol/options, shared writer/reader hosts, force acknowledgements, failure checkpoints and fresh-host old/new pointer plus evidence checks. Do not infer correctness from local file locks. |
| Physical power-loss durability | No controllable volume/power source | Disposable storage with actual power or storage-server interruption, acknowledged publication and force log at each checkpoint, fresh-host checksums and old/new evidence after restart, repeated by failure mode. |
| Distributed multi-JVM quotas and writers | Same-JVM quota and local file-lock tests only; remote multi-writer CAS is explicitly deferred | Either deploy one writer with external quota coordination and verify multi-JVM atomicity, or implement and test backend-wide CAS before supporting concurrent writers. |

The S3 run does not convert application-byte audits into wire/device accounting
and does not sign off the Area 7 release-performance regressions. The remaining
rows require the named environment and are unverified here.
