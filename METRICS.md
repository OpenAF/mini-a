# mini-a Metrics Reference

All metrics live on the global `__mini_a_metrics` object as `$atomic(0, "long")` counters.  
They accumulate across goals within a session and reset only when `/clear` is run.  
`getMetrics()` on a `MiniA` instance returns them grouped into sections; `/stats` in the console displays them.

---

## 1. LLM Calls (`llm_calls`)

| Key | Internal counter | Description |
|-----|-----------------|-------------|
| `normal` | `llm_normal_calls` | Calls made to the main LLM (full-cost model). |
| `low_cost` | `llm_lc_calls` | Calls made to the low-cost LLM (`lc_llm`). Includes complexity-screening calls and steps where the budget favours the cheaper model. |
| `total` | computed | `normal + low_cost + advisor_calls`. Advisor calls are included here but not in either per-tier counter. |
| `fallback_to_main` | `fallback_to_main_llm` | Times a low-cost LLM response failed JSON parsing and the agent retried with the main LLM instead. High values indicate the lc model is struggling to produce valid JSON. |

**Nuance:** `advisor_calls` is counted separately (see §7) and is folded into `total` at read-time. Neither `normal` nor `low_cost` includes advisor calls, so `normal + low_cost ≠ total` when the advisor has been used.

---

## 2. Goals (`goals`)

| Key | Internal counter | Description |
|-----|-----------------|-------------|
| `achieved` | `goals_achieved` | Goal loop exited via a `final` action. Also incremented on deep research "best-effort" fallback (the agent produced an answer even if not fully verified). |
| `failed` | `goals_failed` | Goal loop exited due to an unrecoverable error (exception during the main agent loop). |
| `stopped` | `goals_stopped` | Goal was explicitly interrupted — either by the user pressing stop or by the agent calling `stop()`. Also incremented on deep research when the agent stops and immediately produces a best-effort final. |

**Nuance:** A deep research session that ends by generating a best-effort answer increments both `goals_stopped` and `goals_achieved` in sequence (stop recorded first, then achievement on the synthesized answer).

---

## 3. Actions (`actions`)

| Key | Internal counter | Description |
|-----|-----------------|-------------|
| `thoughts_made` | `thoughts_made` | Number of JSON `"action":"think"` steps — lightweight planning turns where the agent narrates its next move without calling a tool. |
| `thinks_made` | `thinks_made` | Number of extended inner-think blocks rendered inside a step (separate from the `think` action). Used when a deeper scratchpad is emitted before deciding. |
| `finals_made` | `finals_made` | Number of `"action":"final"` responses, including those produced during deep research synthesis. |
| `mcp_actions_executed` | `mcp_actions_executed` | MCP tool calls that returned successfully. |
| `mcp_actions_failed` | `mcp_actions_failed` | MCP tool calls that returned an error or exception. Also incremented when a `final` action immediately fails during execution. |
| `shell_commands_executed` | `shell_commands_executed` | Shell commands that actually ran (approved automatically or by the user). |
| `shell_commands_blocked` | `shell_commands_blocked` | Shell commands blocked before execution — either because the command did not match the allow-list, or because the user denied the prompt. Subsumes `shell_commands_denied`. |
| `shell_commands_approved` | `shell_commands_approved` | Shell commands where the user explicitly approved an interactive prompt. Does **not** count auto-approved commands (those increment `executed` directly). |
| `shell_commands_denied` | `shell_commands_denied` | Shell commands the user explicitly rejected via the interactive confirmation prompt. These are a subset of `shell_commands_blocked`. |
| `unknown_actions` | `unknown_actions` | JSON responses whose `action` field was not `think`, `final`, `shell`, `wiki`, or any registered action name. Indicates a malformed or hallucinated action. |

**Nuance — blocked vs. denied:** `blocked` is the broad category (allow-list miss or user denial). `denied` is the narrow subset where the user was shown a prompt and said no. A command can be `blocked` without ever reaching the prompt.

**Nuance — approved vs. executed:** `approved` counts only interactive confirmations. A command cleared automatically (pre-approved pattern) skips the prompt and increments only `executed`.

---

## 4. Planning (`planning`)

| Key | Internal counter | Description |
|-----|-----------------|-------------|
| `disabled_simple_goal` | `planning_disabled_simple_goal` | Times the planner determined the goal was simple enough to skip structured planning entirely. |
| `plans_generated` | `plans_generated` | Plans produced by the planning LLM call. |
| `plans_validated` | `plans_validated` | Validation LLM calls made against a generated plan. Each plan may be validated once; increments on every validation attempt regardless of outcome. |
| `plans_validation_failed` | `plans_validation_failed` | Subset of validation calls where the LLM flagged the plan as needing revision. |
| `plans_replanned` | `plans_replanned` | Times the agent scrapped the current plan and generated a new one (e.g. after validation failure or mid-task replanning). |

**Nuance:** `plans_validated` counts attempts; `plans_validation_failed` counts failures within those attempts. A plan that passes on the first try contributes 1 to `validated` and 0 to `validation_failed`.

---

## 5. Performance (`performance`)

### Step timing

| Key | Description |
|-----|-------------|
| `steps_taken` | Total agent loop iterations (one per LLM call + action cycle). |
| `total_session_time_ms` | Wall-clock milliseconds from session start to the last goal completion or stop. Updated on each goal end. |
| `avg_step_time_ms` | Rolling average step duration in ms, updated after every step using an incremental formula. |
| `step_prompt_build_ms_total` / `_avg` | Cumulative / per-step time spent constructing the prompt (serialising conversation, selecting context, building system prompt). |
| `step_llm_wait_ms_total` / `_avg` | Cumulative / per-step time blocked waiting for the LLM HTTP response. |
| `step_tool_exec_ms_total` / `_avg` | Cumulative / per-step time spent executing tool/action calls after the LLM responds. |
| `step_context_maintenance_ms_total` / `_avg` | Cumulative / per-step time spent on context pruning, summarisation, and budget enforcement. |

### Token accounting

| Key | Description |
|-----|-------------|
| `llm_estimated_tokens` | Sum of pre-send token estimates (cheap local count). Used for budget decisions before the LLM responds. |
| `llm_actual_tokens` | Sum of real tokens reported by the API across **all tiers** (main + lc + advisor). |
| `llm_normal_tokens` | Real tokens from main-LLM calls only. |
| `llm_lc_tokens` | Real tokens from low-cost LLM calls only. |
| `max_context_tokens` | High-water mark of context window tokens seen in a single step. Updated to `max(current, new)`. |

**Nuance — estimated vs. actual:** Estimated tokens are a fast local approximation used for budget gating; actual tokens come from the API response. The delta between them reflects how accurate the estimator is. Advisor tokens are in `llm_actual_tokens` but **not** broken out into `llm_normal_tokens` or `llm_lc_tokens`.

### Prompt context compression

| Key | Description |
|-----|-------------|
| `prompt_context_selections` | Times a selective context window was built (some messages chosen, others dropped). |
| `prompt_context_compressed` | Times a selected context was additionally compressed (token budget was tight). |
| `prompt_context_tokens_saved` | Tokens saved by prompt-level compression. |
| `goal_block_compressed` | Times the goal/instructions block was compressed. |
| `goal_block_tokens_saved` | Tokens saved by goal-block compression. |
| `hook_context_compressed` | Times the hook/system-context block was compressed. |
| `hook_context_tokens_saved` | Tokens saved by hook compression. |

### System prompt management

| Key | Description |
|-----|-------------|
| `system_prompt_builds` | Total system prompt constructions (one per step, sometimes more on retries). |
| `system_prompt_tokens_total` | Cumulative token cost of all system prompts built. |
| `system_prompt_tokens_last` | Token count of the most recently built system prompt. |
| `system_prompt_tokens_avg` | Computed at read-time: `tokens_total / builds`. |
| `system_prompt_budget_applied` | Times the system prompt was trimmed because a token budget was active. |
| `system_prompt_budget_tokens_saved` | Tokens saved across all budget trims (`initial - final` per trim). |
| `system_prompt_examples_dropped` | Times the examples section was dropped during a budget trim. |
| `system_prompt_skill_descriptions_dropped` | Times skill descriptions were dropped. |
| `system_prompt_tool_details_dropped` | Times tool detail expansions were dropped. |
| `system_prompt_planning_details_dropped` | Times planning detail sections were dropped. |
| `system_prompt_skills_trimmed` | Times skill content was partially trimmed (shortened rather than fully dropped). |

**Nuance:** The four `_dropped` metrics and `_trimmed` are set at most once per build (a section is dropped or it isn't). `budget_tokens_saved` accumulates the actual delta, so it is the true token-saving figure; the dropped/trimmed metrics count events, not magnitudes.

---

## 6. Behavior Patterns (`behavior_patterns`)

### Escalations

| Key | Description |
|-----|-------------|
| `escalations` | Total escalation interventions (advisor was consulted due to a concern). One escalation may have a single cause. |
| `escalation_consecutive_errors` | Escalations triggered by too many back-to-back errors. |
| `escalation_consecutive_thoughts` | Escalations triggered by too many consecutive `think` steps without an action. |
| `escalation_thought_loop` | Escalations triggered by detecting a repeating thought pattern. |
| `escalation_steps_without_action` | Escalations triggered by exceeding the max steps with no tool/shell/final action. |
| `escalation_similar_thoughts` | Escalations triggered by semantic similarity between recent thoughts (near-duplicate detection). |
| `escalation_context_window` | Escalations triggered by the context window approaching capacity. |

**Nuance:** `escalations` is the total count of escalation events. Each escalation has exactly one cause recorded in the corresponding `escalation_*` sub-counter. The sub-counters therefore sum to `escalations`.

### Error and loop tracking

| Key | Description |
|-----|-------------|
| `retries` | LLM call retries (including fallback-to-main retries). Accumulates; does not reset between goals. |
| `consecutive_errors` | **Live counter** — current number of back-to-back errors. Resets to 0 on any successful step. Not a historical total. |
| `consecutive_thoughts` | **Live counter** — current run of `think`-only steps. Resets on any real action or goal end. Not a historical total. |
| `json_parse_failures` | Cumulative LLM responses that failed JSON parsing. Incremented on both lc and main failures. |
| `action_loops_detected` | Times the action-repetition detector found the agent executing the same action sequence twice. |
| `thinking_loops_detected` | Times the loop detector found a repeated `think` pattern in recent history. |
| `similar_thoughts_detected` | Times a new thought was judged semantically similar to a recent one (but not identical — below the loop threshold). |

**Nuance — `consecutive_errors` and `consecutive_thoughts`:** These two are current-state gauges, not accumulators. Their value in `getMetrics()` reflects where the agent stands right now, not how many total errors or thoughts there have been. They are included mainly for debugging a live session.

---

## 7. Advisor (`advisor`)

| Key | Description |
|-----|-------------|
| `calls` | Advisor LLM calls that actually executed (decision was "consult"). |
| `tokens` | Real tokens consumed by all advisor calls. |
| `consultations_skipped` | Times the advisor was considered but the decision engine chose not to consult it (e.g. too cheap to warrant it). |
| `invalid_responses` | Advisor responses that could not be parsed into a usable decision object. |
| `helpful_escalations` | Advisor calls where the response included `escalate_to_main: true` — indicating the advisor recommended switching to the main LLM. |
| `declined_under_budget` | Times the advisor was skipped specifically because the interaction was flagged as low-value under budget pressure. |

**Nuance:** `consultations_skipped` + `calls` = total times the advisor trigger condition fired. `declined_under_budget` is a subset of `consultations_skipped` for the specific budget-pressure reason.

---

## 8. Guardrails (`guardrails`)

| Key | Description |
|-----|-------------|
| `hard_decision_checkpoints` | Times a "hard decision" gate was evaluated — points where the agent must pass an evidence check before taking an irreversible action. |
| `evidence_gate_rejections` | Times the evidence gate rejected the action (agent lacked sufficient evidence and was sent back to gather more). |

---

## 9. User Interaction (`user_interaction`)

| Key | Description |
|-----|-------------|
| `requests` | Times the agent requested human input (paused and asked the user a question). |
| `completed` | User input requests that received a response. |
| `failed` | User input requests that timed out or threw an error before a response arrived. |

---

## 10. Summarization (`summarization`)

| Key | Description |
|-----|-------------|
| `summaries_made` | Summarization LLM calls that completed and produced a summary. |
| `summaries_skipped` | Times a summarization was considered but skipped (e.g. context was within budget, or summarization was suppressed). |
| `summaries_forced` | Times summarization was forced regardless of budget (explicit `/summarize` command or hard over-limit). |
| `context_summarizations` | Times context maintenance triggered summarization as part of the pruning pipeline. |
| `summaries_tokens_reduced` | Cumulative tokens saved by summarization (`original - final` per run, clamped to ≥ 0). |
| `summaries_original_tokens` | Cumulative token count of context before each summarization. |
| `summaries_final_tokens` | Cumulative token count of context after each summarization. |

**Nuance — `summaries_made` vs `context_summarizations`:** `context_summarizations` counts the triggers from the context maintenance path only. `summaries_made` counts every completed summarization call regardless of origin (forced, scheduled, or triggered). A forced summary increments `summaries_made` and `summaries_forced` but not `context_summarizations`.

---

## 11. Memory (`memory`)

### State snapshot (live, not counters)

| Key | Description |
|-----|-------------|
| `enabled` | Whether working memory is active. |
| `scope` | Memory scope: `"session"`, `"global"`, or `"both"`. |
| `resolved_entries` | Entry count in the merged (resolved) working memory view. |
| `session_entries` | Entry count in the session-scoped memory store. |
| `global_entries` | Entry count in the global memory store. |
| `resolved_sections` / `session_sections` / `global_sections` | Per-section entry counts in each view. |

### Activity counters

| Key | Description |
|-----|-------------|
| `appends` | New entries added to working memory. |
| `dedup_hits` | Append attempts rejected because an identical entry already existed. |
| `updates` | Existing entries modified in-place. |
| `removes` | Entries explicitly deleted. |
| `status_marks` | Status annotations applied to entries (e.g. marking a hypothesis as confirmed). |
| `evidence_attached` | Evidence blocks attached to existing entries. |
| `promotions` | Promotion operations run (each operation may promote multiple entries). |
| `promoted_entries` | Total individual entries promoted across all promotion operations. |
| `refreshes` | Entries refreshed (timestamp/staleness reset) during a promotion sweep. |
| `stale_marked` | Entries marked stale during a sweep. |
| `session_clears` | Full session memory clears (e.g. `/clear` or programmatic reset). |
| `compactions` | Compaction operations run (consolidate and prune low-value entries). |
| `compaction_entries_dropped` | Total entries dropped across all compaction runs. |

### I/O counters

| Key | Description |
|-----|-------------|
| `global_reads` / `session_reads` | Successful file-system reads of the respective memory store. |
| `global_read_failures` / `session_read_failures` | Failed read attempts. |
| `global_writes` / `session_writes` | Successful file-system writes. |
| `global_write_failures` / `session_write_failures` | Failed write attempts. |

**Nuance — `promotions` vs `promoted_entries`:** `promotions` is the number of times the promotion routine ran; `promoted_entries` is the cumulative count of entries that were actually moved. If one promotion sweep moves 5 entries, `promotions += 1` and `promoted_entries += 5`.

**Nuance — `resolved_entries` vs `session_entries + global_entries`:** The resolved view merges session and global stores, applying deduplication and overrides. `resolved_entries` can be less than the sum of the other two when entries overlap.

---

## 12. Tool Selection (`tool_selection`)

These metrics track how the dynamic tool-selection pipeline chose which tools to offer the LLM per step.

| Key | Description |
|-----|-------------|
| `dynamic_used` | Total times the dynamic selection pipeline was invoked (as opposed to passing all tools). |
| `keyword` | Selections resolved by keyword matching against the goal/step (cheapest path). |
| `llm_lc` | Selections where the low-cost LLM was used to pick relevant tools. |
| `llm_main` | Selections where the main LLM was used (keyword and lc both insufficient). |
| `connection_chooser_lc` | Connection/MCP-server selections made via the lc LLM chooser. |
| `connection_chooser_main` | Connection/MCP-server selections made via the main LLM chooser. |
| `fallback_all` | Times selection failed entirely and all available tools were passed (safe fallback). |

**Nuance:** `dynamic_used` is the gate — it counts every invocation of the pipeline. The remaining counters are mutually exclusive paths within that pipeline, so they sum to `dynamic_used` (minus any steps that hit `fallback_all` without a clear path).

---

## 13. Tool Cache (`tool_cache`)

| Key | Description |
|-----|-------------|
| `hits` | Tool-list cache hits (reused a previously built tool list for this step). |
| `misses` | Cache misses (tool list had to be rebuilt). |
| `total_requests` | Computed: `hits + misses`. |
| `hit_rate` | Computed percentage: `hits / total_requests × 100`. |

---

## 14. MCP Resilience (`mcp_resilience`)

| Key | Description |
|-----|-------------|
| `circuit_breaker_trips` | Times an MCP tool's circuit breaker opened due to repeated failures. |
| `circuit_breaker_resets` | Times a tripped circuit breaker closed again (tool recovered). |
| `lazy_init_success` | Successful lazy MCP server initialisations (server started on first use). |
| `lazy_init_failed` | Failed lazy MCP server initialisations. |

**Nuance:** `circuit_breaker_trips` and `circuit_breaker_resets` come in pairs under normal recovery. A persistent `trips > resets` gap means one or more MCP tools are in a permanently open circuit.

---

## 15. Per-Tool Usage (`per_tool_usage`)

A map keyed by tool name. Each entry has:

| Key | Description |
|-----|-------------|
| `calls` | Total invocations of this tool. |
| `successes` | Invocations that returned without error. |
| `failures` | Invocations that returned an error or threw. |

`failures + successes = calls`. Populated only for tools that were actually called during the session.

---

## 16. Delegation (`delegation`)

Delegation metrics mirror the `SubtaskManager` internal counters, synced at `getMetrics()` call time via `_syncDelegationMetrics()`.

| Key | Description |
|-----|-------------|
| `total` | Total subtasks dispatched since the manager was created. |
| `running` | Subtasks currently in-flight. |
| `completed` | Subtasks that finished successfully. |
| `failed` | Subtasks that ended in a failure state. |
| `cancelled` | Subtasks explicitly cancelled (e.g. because the parent goal was stopped). |
| `timedout` | Subtasks that exceeded their deadline. |
| `retried` | Subtasks retried after a transient failure. |
| `worker_hint_used` | Subtask dispatches that carried a preferred-worker hint. |
| `worker_hint_matched` | Hint-carrying dispatches where the hinted worker was available and used. |
| `worker_hint_fallthrough` | Hint-carrying dispatches where the hinted worker was unavailable; fell back to normal selection. |
| `workers_total` | Live count of all registered workers (static + dynamic). |
| `workers_static` | Live count of statically configured workers. |
| `workers_dynamic` | Live count of dynamically registered workers. |
| `workers_healthy` | Live count of workers currently passing health probes. |

**Nuance — hint metrics:** `worker_hint_used` counts all dispatches with a hint. `worker_hint_matched + worker_hint_fallthrough = worker_hint_used`. A high `fallthrough` rate means the routing hints are not well-aligned with available worker capacity.

**Nuance — sync timing:** Delegation metrics are pulled from the `SubtaskManager` at `getMetrics()` call time, not in real-time. The values represent the state of the manager at that snapshot moment.

### Auto-delegation & Startup Scouts

These counters are tracked directly on `__mini_a_metrics` (not via SubtaskManager) and reset on `/clear`.

| Key | Internal counter | Description |
|-----|-----------------|-------------|
| `autodelegation_triggered` | `autodelegation_triggered` | Times a noisy tool result triggered an automatic summarization sub-agent (`autodelegation=true`). A high value relative to `mcp_actions_executed` indicates many tool results are exceeding the threshold. |
| `startup_subtasks_submitted` | `startup_subtasks_submitted` | Startup scout tasks submitted from `subtasks=` or `subtasksfile=` at init time. |
| `startup_subtasks_completed` | `startup_subtasks_completed` | Startup scouts that finished with a successful answer before the main agent returned its final answer. |
| `startup_subtasks_failed` | `startup_subtasks_failed` | Startup scouts that ended in a failed or timed-out state. |

**Nuance — autodelegation cost:** Each auto-delegation fires an LLM call in a child agent. Monitor `autodelegation_triggered` relative to `llm_normal_calls` or `llm_lc_calls` to assess the token overhead. If the ratio is high, consider raising `autodelegationthreshold` or lowering `autodelegationmaxperstep`.

**Nuance — startup scouts and final answer:** `startup_subtasks_completed` is incremented at harvest time (when `_processFinalAnswer` runs), not when the scout finishes. Scouts still running at that point are cancelled; their results are not harvested.

---

## 17. Deep Research (`deep_research`)

| Key | Description |
|-----|-------------|
| `sessions` | Total deep-research sessions started. |
| `cycles` | Total research cycles run across all sessions (each session may run multiple cycles). |
| `validations_passed` | Cycles where the validation LLM judged the research complete. |
| `validations_failed` | Cycles where validation failed (more research needed). |
| `early_success` | Sessions that passed validation before exhausting the maximum cycle count. |
| `max_cycles_reached` | Sessions that hit the cycle cap without passing validation (fell back to best-effort answer). |

**Nuance:** `early_success + max_cycles_reached = sessions` (every session ends one of two ways). `validations_passed` counts individual validation passes; `early_success` counts sessions that passed at least once. If a session runs 3 cycles and passes on cycle 2, it contributes 1 to `early_success` and 2 to `validations_failed` + 1 to `validations_passed`.

---

## 18. History (`history`)

| Key | Description |
|-----|-------------|
| `sessions_started` | New conversation history files created (fresh sessions). |
| `sessions_resumed` | Existing conversation history files loaded and resumed. |
| `files_kept` | History files evaluated by the pruner and retained. |
| `files_deleted` | Total history files pruned across all runs. |
| `files_deleted_by_period` | Files pruned because they were older than the configured retention period. |
| `files_deleted_by_count` | Files pruned because the total count exceeded the configured maximum. |

**Nuance:** `files_deleted_by_period` and `files_deleted_by_count` are independent pruning strategies; a file can be deleted by only one of them per pruning run. `files_deleted = files_deleted_by_period + files_deleted_by_count`.

---

## 19. Wiki (`wiki`)

| Key | Description |
|-----|-------------|
| `enabled` | Whether a `MiniAWikiManager` is attached to this agent. |
| `ops_list` | `list` operations invoked by the agent. |
| `ops_read` | `read` operations. |
| `ops_search` | `search` / `grep` operations. |
| `ops_write` | `write` operations. |
| `ops_delete` | `delete` operations. |
| `ops_lint` | `lint` operations. |
| `ops_errors` | Wiki operations that returned an `[ERROR]` prefix or threw an exception. |
| `ops_total` | Computed sum of all non-error op counters (`list + read + search + write + delete + lint`). |

**Nuance:** `ops_errors` counts the number of errored calls, not a separate op type. An errored write increments both `ops_write` and `ops_errors`. Therefore `ops_total + ops_errors` is not the total call count; `ops_total` already includes all calls (including those that errored).

---

## Metrics Channel (`metricsch`)

Beyond the in-memory counters, mini-a supports publishing metrics to an OpenAF channel via the `metricsch` startup argument. This uses `ow.metrics.startCollecting(channelName, period, some, noDate)` to periodically snapshot OpenAF system metrics (CPU, memory, GC, etc.) into a named channel. The channel is reference-counted — multiple `MiniA` instances sharing a channel name will not double-register it, and the channel is torn down only when the last instance releases it. This is orthogonal to the `__mini_a_metrics` counters above; it covers host-level observability rather than agent behaviour.
