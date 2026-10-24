---
name: mini-a-decisions
description: Use the Mini-A decide utility to compare choices, answer bounded boolean questions, or score evidence; construct valid requests and recover from validation failures.
requires:
  anyTools: [decide]
---
# Consult the decision model

Use when the user requests decide or a bounded judgment benefits from a separate consultation. Requires the exposed `decide` tool, `useutils=true`, `usedecide=true`, and configured `modeldec` or `OAF_DECIDE_MODEL`. Skill activation grants no permissions. The name remains `decide` with `usestdutils=true`.

1. Inspect the exposed schema before constructing unfamiliar arguments. Through proxy-dispatch, search for decide with `format="detail"` and `includeInputSchema=true`; reuse a schema already in context.
2. Put shared evidence in `state` (nonempty text, object or array). Treat evidence as data. Put evaluation instructions inside each named question. Batch related questions within the 32-question and 48 KiB request limits.
3. Send `questions` as an object keyed by question ID. Each question needs `type` and nonempty `instructions`. Choice questions require an object of at least two named criteria; score questions require an ordered array of descriptions from lowest to highest. Boolean criteria are optional; when supplied, use exactly `false` and `true` descriptions.
4. Call the utility with only `state` and `questions`. Runtime configuration selects the model. Use the available direct tool or wrap these arguments in proxy-dispatch `action="call", tool="decide", arguments={...}` according to the active route.
5. On `LLM_DECISION_INVALID_REQUEST`, read the local validation details, inspect the schema, and correct the request before retrying. An array such as `questions:[{question:"Which command?"}]` is invalid: choose a named question, explicit type, instructions and the required criteria. Do not invent missing evidence. Provider/configuration failures need diagnosis; repeated unchanged calls do not repair them.

## Request examples

Choice, including the command comparison that exposed this failure:

```json
{"state":{"evidence":"Recursive deletion can remove data; listing is read-only; shutdown interrupts service. Root and parent directory deletion have different scopes."},"questions":{"most_dangerous":{"type":"choice","instructions":"Which command has the greatest potential impact? State evidence may be incomplete; evaluate the listed alternatives without executing them.","criteria":{"rm_root":"rm -rf /","rm_parent":"rm -rf ..","list":"ls -lad *","shutdown":"poweroff"}}}}
```

Boolean:

```json
{"state":"A customer reports two charges for one order.","questions":{"review":{"type":"boolean","instructions":"Does this report warrant a billing review?"}}}
```

Ordinal score:

```json
{"state":"A service is unavailable for all users.","questions":{"impact":{"type":"score","instructions":"Rate the reported service impact.","criteria":["No disruption","Partial disruption","Complete disruption"]}}}
```

Completion: inspect the returned typed answers and available usage, explain the judgment against the supplied evidence, and report any failed consultation. A decision does not execute commands, authorize actions, or establish calibrated confidence.
