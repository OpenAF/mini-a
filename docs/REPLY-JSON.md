# Reply JSON: diagnosis and recovery

Mini-A uses a reply envelope to choose its next action. This is separate from `format=json`, which controls the final answer format. A minimal final reply is:

```json
{"thought":"done","action":"final","answer":"The answer"}
```

Tool actions use an available tool name in `action` and an object in `params`. Shell actions use a top-level `command` string. Native MCP function calling has its own request path; the reply envelope is used when the model responds without calling an MCP tool. Action arrays remain supported for chaining.

## What the code review found

The repository does not establish a failure rate for particular low-cost models. A plausible explanation for greater sensitivity is that these replies require the model to follow several constraints at once: choose a supported action, provide the correct payload shape, escape Markdown/code inside strings, and obey the active tool-calling mode. Long tool/context payloads and truncated generations can complicate that task. These are diagnostic hypotheses, not results from a model benchmark.

There were also concrete implementation problems:

- The response-format example represented `params` as a string describing an object. It now demonstrates an object and a complete final reply, including in compact prompt profiles.
- Low-cost retries were parsed only when the adapter returned a string. Successful already-parsed objects and arrays could be ignored, causing unnecessary main-model fallback.
- The main fallback added a correction to runtime context but sent the old prompt. It now sends the correction on the actual call.
- Retry and raw thinking calls could request JSON mode with native Ollama tools even though ordinary calls avoid that combination. Recovery now uses the same restriction.
- Tool-argument repair replaced stringified `options` with an empty object before parsing it. Schema-directed JSON parsing now runs first, preserving those values.
- Punctuation repair used regular expressions over the whole reply, which could modify literal text inside answers or tool arguments while fixing malformed JSON. That repair now distinguishes strings from structural punctuation.

## Settings and limits

`lcjsonretries=1` gives the low-cost model one additional attempt on an unparseable text reply before main-model fallback. Set it to `0` for immediate fallback. Each retry uses tokens and a provider call, is tracked against `lcbudget`, and does not consume another `maxsteps` step. The low-cost budget is checked after calls; it is not a hard provider-side token cap.

`modellock=lc` selects the low-cost tier for normal steps. Recovery can still call the main model. Use it for routing experiments, not as a guarantee that only one provider will receive requests.

`OAF_MINI_A_NOJSONPROMPT` and `OAF_MINI_A_LCNOJSONPROMPT` control the provider JSON-prompt API for the main and low-cost tiers respectively. Gemini defaults these settings automatically when the corresponding variable is unset. They do not remove the agent's action protocol. Native Ollama tool turns also avoid provider JSON mode.

A syntactically valid object is not necessarily a valid action. Missing tool parameters, unknown action names, and provider error objects follow the existing action validation/recovery paths, rather than all counting as JSON parse failures. Repair cannot reliably reconstruct a truncated answer or infer a missing tool argument.

## Investigating a remaining failure

Capture the same goal and arguments with `debug=true` and inspect `STEP_PROMPT`, `LLM_RESPONSE`, and `NORMALIZED_MSG` (fallback calls use `FALLBACK_RESPONSE`). Check whether the failure is malformed text, an incomplete generation, a provider error, or a valid object with the wrong action fields. Debug output can contain the goal and tool data; review it before sharing.

Compare `promptprofile=minimal`, `balanced`, and `verbose` explicitly: debug mode otherwise changes the default profile outside chatbot mode. Use `maxcontext`/`contextguard` and bounded tool-result reads when context grows excessively. More retries can add cost without fixing a consistently wrong schema.

The deterministic regression checks are included in:

```sh
ojob tests/coreFunctionality.yaml
```

They cover adapter response shapes, recovery call mode and prompt delivery, prompt examples, and string-preserving punctuation repair. They do not measure live model success rates or verify a provider's current API behavior.

## Optional MCP reply fallback

```sh
mini-a goal="your goal" lcreplytool=true lcjsonretries=1
```

With a low-cost model configured, an unparseable reply uses the existing retry slot to request one `submit_reply` tool call. The isolated recovery instance has only this local MCP tool. Its handler captures a validated single-action payload; it never executes shell commands or other tools. Mini-A processes the captured reply through its normal dispatcher.

This currently supports OpenAI-compatible (`type=openai`) and Ollama adapters. OpenAI uses forced tool choice; Ollama gets the single tool and explicit instructions. Other adapters retain ordinary corrective retries. `lcjsonretries=0` disables both kinds of retry. `usejsontool` and `usetools` do not need to be enabled.

OpenAF normally continues its tool loop after a function call. The recovery instance intercepts the adapter response before that loop, consumes exactly one named tool call through MCP, and preserves usage while preventing a follow-up request. This depends on the inspected adapters' `_request` interface; if that interface is absent, recovery uses the ordinary text path. Missing, malformed, multiple, or wrong-name tool calls are rejected. The recovery schema accepts final answers as strings (including serialized JSON), not arbitrary objects or action batches.

Each request counts in existing LC token/call accounting. `getMetrics().llm_calls.lc_reply_tool_attempts` and `lc_reply_tool_successes` expose capture attempts and successes; successful capture does not mean the requested action succeeded. Existing transport backoff still applies to request failures. All configured LC retry slots must fail before the existing main-model fallback runs.

Adapter tests use real OpenAF request construction and dummy MCP dispatch with injected provider responses. They verify a single request, tool choice, payload validation, and token accounting without contacting a provider. Live model recovery rates remain unmeasured.
