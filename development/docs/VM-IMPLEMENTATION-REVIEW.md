# History VM implementation review, 2026-09-09

Plan source: `mini-a-VM-PLAN.md` in the parent directory of this checkout (a local planning document, not a repository file). The implementation extends Phase 1; Phase 2
remains explicitly opt-in. This review supersedes the earlier claim that module
APIs alone established end-to-end completion.

## Runtime integration delivered

| Requirement | Implementation and verification |
| --- | --- |
| Generalized sources | Versioned source upserts capture active plans, selected memory, supplied knowledge and authorized wiki/skill/tool results. Unchanged content and metadata reuse identity; changes supersede earlier snapshots. Selected non-history sources enter actual requests as untrusted evidence. |
| Consumer views | Executor, planner, advisor, validator and summarizer invocation boundaries use the shared assembler. Auxiliary histories remain independently owned. Bounded task knowledge replaces inherited parent knowledge in delegates, and completed child results become provenance-bearing delegation episodes. Explicit fork-state requests remain supported. |
| Request budgeting | Final serialized conversation, prompt, tool-schema estimates, safety allowance and output reserve are charged together. Optional representations demote and freeze; protected overflow stops dispatch. Retries do not duplicate auxiliary excerpts. |
| Phase 1 policy | Real user constraints and unknown provider data remain exact. The shared synthetic-step predicate permits old runtime scaffolding to shrink. Completed parallel native tool groups are preserved or frozen together; in-flight groups remain protected. |
| Stable canonical history | An internal provider-view mapping restores omitted messages and maps newly appended provider replies to canonical indexes. Persistence restores exact originals, including after paging. Rejected projections do not replace the committed view. |
| Session hierarchy | Completion creates versioned session, monthly-period and conversation-project rollups referencing exact source objects. They survive restart. A separate cross-conversation project episodic store remains optional. |
| Local optimization | Constant-time provider/source lookup, representation reuse, bounded serialization cache, bounded derived representation cache, periodic index snapshots and journal-tail replay. Invalid snapshots rebuild from the canonical journal. |
| Evaluation | Long deterministic baseline/shadow/active comparisons exercise frozen paging and constraint retention. Additional tests cover native protocol groups, source versions, 270 indexed sources, restart/tail replay, invalid-cache recovery, auxiliary budgets and delegate projections. The provider fixture includes 128 historical messages, revised code, changed requirements, an active plan, a delegation episode, 128 wiki sources and 1,000 skills. |

Existing Phase 2 foundations remain: L0–L4 representations, structural and optional
cost-gated semantic compression, hierarchy/index/graph traversal, supersession,
bounded section/range/JSON reads, stable handles, skill discovery/composition,
working-set deltas and diagnostics. Knowledge does not bypass tool permissions,
and no automatic wiki promotion or learned-skill publication is enabled.

## Validation

- `ojob tests/historyVM.yaml`: 35 passing tests.
- `ojob tests/eval.yaml`: 7 passing tests.
- `ojob tests/skills.yaml`: 21 passing tests.
- `ojob tests/coreFunctionality.yaml`: 195 passes; the nearest-AGENTS-file
  loading test fails, also reproduced against pre-change `HEAD`. The reflection callback regression found during this
  implementation was corrected and now passes. The broader suite is not
  claimed fully green.

These are deterministic application checks, not model-quality measurements.
The provider-backed `evals/context-virtualization.yaml` matrix still needs to be
run with the intended provider/model before wider rollout. Evaluate correctness,
retrieval, stale-information use, latency, billed input/output and compression
overhead across Phase 1, shadow and active variants. Synthetic input estimates
must not be reported as billed savings or provider-cache hits.

Provider-internal tool rounds are outside the application's exposed paging
boundary. Independent standalone Dream operations retain their own memory/wiki
workflow; the assembler supports a dreamer profile without merging those stores.
Provider-specific delta transmission, automatic knowledge promotion, automatic
skill learning and an independent project episodic index remain optional/future
work, not silently enabled features.


## Status audit, 2026-09-17

Phase 1 and active Phase 2 are implemented and remain opt-in. The earlier
2026-09-07 plan wording about Phase 2 being only an internal projected view is
superseded by the runtime integration described above. This confirms implemented
behavior, not completion of provider acceptance or production tuning.

Current code was checked at `_initHistoryVm`, `_prepareHistoryVmProjection`,
`_prepareContextInvocation`, `_contextForDelegate`, the retrieval-tool factory,
canonical persistence, and the console/web cleanup paths. Modes are:

| Flags | Current behavior |
| --- | --- |
| `historyvm=false historyvmshadow=false` | Legacy history; no VM sidecar or retrieval tools. |
| `historyvmshadow=true` | Canonical capture and Phase 1 estimates without replacing provider context or registering VM retrieval tools. |
| `historyvm=true contextvirtualization=false` | Phase 1 references and `history_search`/`history_get`/`history_expand`. |
| `historyvm=true contextvirtualization=true` | Active Phase 2 projection and the additional `context_*` retrieval tools. |
| Above plus `contextvirtualizationshadow=true` | Phase 2 projection measurements while sending Phase 1 context. |

`historyvm=true` wins over `historyvmshadow=true`. Only `safe` policy is supported.
Storage remains local and conversation-owned; `historys3bucket` disables VM with
a warning. Legacy imports recover only the saved snapshot, not content discarded
before capture. `/clear` and explicit web deletion remove the sidecar;
`historykeep=true` protects stored history during automatic web expiry.

The semantic-compressor callback is implemented and tested at module level, but
`_initHistoryVm` does not configure it. Normal CLI/web runs therefore use
deterministic compression. Conversation-scoped rollups and runtime consumer
views are implemented; a separate project-wide episodic store and standalone
Dream integration remain outside this implementation. Provider-specific delta
transmission, automatic wiki promotion and learned-skill publication remain
future work.

Fresh local validation on 2026-09-17:

- `ojob tests/historyVM.yaml`: **35 passed**, exit 0.
- `ojob tests/eval.yaml`: **7 passed**, exit 0.

The 2026-09-09 skills/core results above are historical and were not rerun in
this audit. No live-provider matrix, browser lifecycle test, concurrent-writer
stress test or physical-durability test was run. The deterministic writer test
checks stale-writer detection; it does not establish a multi-writer storage
contract. The provider-backed acceptance matrix remains unverified here:

```bash
mini-a eval=true evalfile=evals/context-virtualization.yaml
```

Configure the intended model/provider before running it. Its presence and the
passing evaluator plumbing tests do not establish model quality, billed savings,
provider caching, or acceptance of wider defaults.


## Live-provider follow-up, 2026-09-17

The live matrix has now been run twice using the configured Ollama
`glm-5.3:cloud` model. This supersedes the audit's statement that no live-provider
matrix was run, within the narrow scope below. Evidence, answers and reported
usage are saved in [the live results](historyvm-live-2026-09-17.json).

The original fixture incorrectly supplied an array to scalar `expected.contains`;
the evaluator searched for the comma-joined string and rejected all three correct
answers. The fixture now uses separate assertions, including a check that the
superseded decision is distinguished. The corrected live run passed **3/3**:

| Variant | Provider input tokens | Provider output tokens | Scenario elapsed ms |
| --- | ---: | ---: | ---: |
| Phase 1 | 10,931 | 383 | 3,454 |
| Phase 2 shadow | 11,721 | 293 | 6,079 |
| Phase 2 active | 6,984 | 241 | 4,025 |

All variants made one main-model call, used one step, and performed zero history
rehydrations. Manual inspection confirms that each answer selects named
Redis-backed mounts with strict isolation and rejects the superseded shared
filesystem decision. This verifies this requirement-retention smoke scenario;
it does not establish broad model quality or live retrieval correctness.

Active input usage was **36.1% lower** than Phase 1; combined input/output token
counts were **36.1% lower** in the corrected run. The first run independently
reported 10,931 versus 6,985 input tokens (also 36.1% lower). These are observed
provider token counts, not projected VM estimates. They are **not verified billed
cost savings**: the evaluator leaves cost unset, and no invoice, tariff or
cache/reasoning billing breakdown was checked. The matrix is Phase 1 versus
Phase 2, not VM versus legacy history. Phase 2 also receives extra source fixtures
and tool schemas, so this is a comparison of the supplied modes, not an isolated
compression experiment. Shadow adds overhead and is not a savings mode.

Production tuning remains pending. Active scenario elapsed time exceeded Phase 1
in both runs; timings include setup/indexing and lack enough repeats for reliable
latency conclusions. No policy or default was changed. Before production tuning,
use representative multi-step workloads requiring exact rehydration, revised
requirements, native tool groups and auxiliary/delegate calls; repeat across
intended models and budgets, then compare quality, total usage, billing and tail
latency. The initial sandbox-network failure was excluded from these measurements.
