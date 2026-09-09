# History VM implementation review, 2026-09-09

Plan source: `../mini-a-VM-PLAN.md`. The implementation extends Phase 1; Phase 2
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
