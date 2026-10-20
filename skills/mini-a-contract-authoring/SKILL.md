---
name: mini-a-contract-authoring
description: Create a Mini-A supervised execution CONTRACT.md when the user requests a Mini-A contract or a reusable supervised task contract.
---
# Create a Mini-A execution contract

Create a `mini-a.contract/v1` Markdown contract for the requested goal. This skill authors the contract; executing its task is a separate request. Use the offline starting template at @references/CONTRACT.md, adapting every task-specific field and instruction rather than retaining the report example.

1. Establish the exact execution goal, canonical absolute workspace, destination, constraints, available tools, inputs and observable success criteria from the request and available workspace evidence. Ask only for missing information that affects correctness. Inspect applicable AGENTS.md instructions. Write to the requested destination, or `CONTRACT.md` in the workspace; preserve an existing file unless its replacement was requested. If writing is unavailable, return the complete document for saving.
2. Put machine fields only in YAML frontmatter and execution instructions only in the Markdown body. Include `schema`, `id`, positive integer `revision`, `goal`, string-list `constraints`, `scope.workspace`, `inputs`, `capabilities`, `preconditions`, `assumptions`, `steps`, `criteria`, `checks` and `escalation.local_repairs`. Use an alphanumeric/hyphen/underscore contract ID (1–80 characters). Step, criterion, check, precondition and assumption IDs must be globally unique, start with a letter and contain only letters, digits, hyphens or underscores (up to 64 characters). Each step's `section` must match a `##` body heading.
3. Declare each input with a one-based integer `position`, `required` Boolean, `kind: file|value` and `variability: stable|variable`. Use literal positional bindings such as `{{arg1}}` in instructions and `source.input` in checks for variable files; do not hardcode their current paths. List only available capabilities, including `artifact-read` when host inspection is needed. Capabilities do not grant permissions. Preconditions use the deterministic check shape (`id`, `method`, `source`, `assertion` or `schema`) and may not be `semantic`; assumptions need a `statement` and may link to a precondition ID through `check`.
4. Give every criterion a concrete `requirement` and at least one mandatory check. Each check needs `id`, `criterion`, `method`, Boolean `mandatory` and nonempty `required_evidence` referencing input names, deterministic check IDs or `final_answer`. Choose the supported check shape:
   - `assertion` or `artifact`: `source` plus `assertion` using `equals`, `contains`, `notContains`, `matches`, `min` or `max`, optionally at a dotted `path` under `result` or `answer`.
   - `schema`: `source` plus a JSON Schema object in `schema`.
   - `tool-result`: exact `source.tool` and `source.params`, an `assertion`, and a nonempty `artifacts` list of `{input: name}` or `{path: permittedPath}` objects tying the observed tool result to current artifacts. Shell success checks should assert `result.exitcode`.
   - `semantic`: an explicit `rubric` and bounded `required_evidence`, never executable expressions.
   Sources may use `{input: name, format: json|yaml}`, `{path: permittedPath}`, `{answer: true}` or `{tool: name, params: {...}}`. Missing evidence and skipped checks cannot count as success.
5. Write concrete execution and evidence-collection instructions, preserving constraints and bounding recovery. Set `escalation.local_repairs` to an integer from 0 to 2; identify when to stop and report a blocker. Keep structured collections within 64 entries and the document within 64 KiB. Do not add secrets, invented fingerprints, runtime `requirements_hash` or acceptance `provenance`; Mini-A establishes these during preparation and accepted execution.
6. Check YAML parsing, required fields, unique IDs, heading links, input bindings and criterion coverage. If the checkout's OpenAF runtime is available, use `MiniASupervised.prototype.parse`/`validate` from `mini-a-supervised.js` for structural validation without starting execution or calling models. Report checks actually performed; structural validity does not prove acceptance or successful execution.

Deliver the contract path (or complete document), required positional inputs and a matching invocation, for example:

```sh
ojob mini-a.yaml modelstrategy=supervised goal="Verify the report." contractfile="/project/CONTRACT.md" contractargs='"/project/report.json"'
```

Match `goal` to the authored contract and order `contractargs` by input position. Execution requires both `OAF_MODEL` and `OAF_LC_MODEL`. User-authored contracts undergo preparation/review. `savecontract=true` publishes only after accepted execution; `reusecontract=true` separately enables exact-goal discovery. Neither option is needed merely to author a file. Supervised mode conflicts with `modellock=main|lc`, explicit `useplanning=false`, chatbot, outer-loop, deep-research, delegation and standalone plan/validation modes; avoid adding these to the suggested invocation.
