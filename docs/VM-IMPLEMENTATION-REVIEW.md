# History VM implementation review, 2026-09-09

The plan was found at `../mini-a-VM-PLAN.md`. Its September 7 claim that all
Phase 2A–2H work was complete is too broad. The module has substantial tested
foundations; end-to-end Knowledge OS integration and acceptance remain partial.

## Corrected in this review

- Rebuild each active projection from exact canonical backing, so a previously
  compressed message can be promoted when the task or budget changes.
- Feed the same goal and consumer into shadow and active projection. Shadow
  now reconstructs canonical input even when its baseline contains Phase 1
  references.
- Preserve unknown provider roles. Canonical materialization checks the source
  kind, active branch, original position and role before replacing a reference.
- Capture newly supplied user text that happens to begin with reference syntax.
- Do not add retrieval heat merely because assembly requests a representation.
- Bound L4 tool responses with exact code-point pagination. The internal L4 API
  continues to provide the original object for application callers.
- Reject semantic summaries larger than the deterministic representation used
  for scheduling, including the backing-reference overhead; reuse cached costs.
- Recheck branch scope after scheduler supersession redirects and during
  provider-object lookup.
- Expose `contextvirtualizationshadow` in console option metadata and strip
  inherited shadow configuration from child arguments.

## Required implementation still outstanding

| Plan requirement | Current evidence | Remaining work |
| --- | --- | --- |
| Generalized sources (§3–8, §33) | `registerContextObject` has no production callers outside the VM module; wiki has a separate assembler. | Register authorized wiki, memory, plan, skill and artifact sources using source identity/version contracts, and include selected non-history objects in actual requests. |
| Consumer/delegate integration (§23–24, Phase 2E) | Profiles exist in `_contextConsumerPolicy`; runtime calls use the executor default. `SubtaskManager` does not call the VM assembler. | Wire each supported invocation to its consumer view, pass bounded task projections to children, and store retrievable delegation episodes with provenance. |
| Full request budgeting (§17–19 and Phase 1 §5) | Active projection budgets a selection but emits a reference for every eligible unselected provider message. It does not account for all final wrappers, current prompt, schemas and output reserve as one request. | Add exact outgoing-request accounting, frozen omission with stable identity independent of array position, progressive shrink, and explicit protected-overflow behavior across retry paths. |
| Integration with Phase 1 policy | Active mode protects all user/tool-role entries and bypasses Phase 1 projection, including its synthetic step-prompt reduction. | Share eligibility/protocol policy and preserve the production incident fixes with representative ReAct and native tool-exchange tests. |
| Session hierarchy (§25) | Generic parent/child APIs exist; no production project/period/session rollup pipeline is wired. | Build and persist source-linked rollups while retaining exact sessions. Project episodic indexing in §26 remains optional and separate. |
| Local reuse and scale (§14–16, Phase 2F) | Representation cache and delta APIs exist; `serializeContext` has no production callers. Provider lookup scans objects; startup rebuilds from the journal. | Reuse assembled serialization at real consumers and establish incremental lookup/replay and cache-growth bounds with scale tests. |
| Evaluation and tuning (§38, Phase 2H) | Unit tests and variant plumbing exist. The checked-in provider replay has only five messages, all inside the active six-message protection window. | Add substantive long-history, large-result, code-revision, plan, delegation, wiki, skills and cross-session workloads; run baseline/shadow/active correctness and economics comparisons and tune policies. |

Provider-specific caching/delta APIs, automatic skill learning/publication and
automatic wiki promotion are optional or future work. They must not be counted
as prerequisites for the initial phase. The mandatory rows above are separate
from those deferrals.

## Validation of these fixes

`ojob tests/historyVM.yaml`: 31 passing tests, including promotion after prior
compression, reference-like user content, bounded L4 tool reads, unchanged heat,
canonical shadow comparison, and semantic summary budget rejection.

`ojob tests/eval.yaml`: 7 passing tests. The existing two child-argument stripping
and explicit-override tests also pass, including inherited shadow isolation.

These results cover deterministic application behavior. Live-provider quality,
whole-run token economics and the remaining integration rows are not established
by these tests. Phase 2 remains opt-in.
