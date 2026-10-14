# Supervised execution contracts

`modelstrategy=supervised` prepares a concrete contract with `OAF_MODEL` and executes it with `OAF_LC_MODEL` in the normal Mini-A loop. Both model roles are required. Existing defaults, `delegate`, permissions and tool availability are unchanged. `noagentsmd=true` retains its existing opt-out.

```sh
ojob mini-a.yaml goal="Verify the report." modelstrategy=supervised contractargs='"/project/report.json"'
```

## Options and precedence

| Option | Default | Behavior |
|---|---|---|
| `modelstrategy` | existing default | `supervised` enables this policy |
| `contractfile` | unset | Explicit existing CONTRACT.md; missing, malformed or unsupported files fail closed |
| `contractargs` | empty | Positional inputs using existing skill argument quoting and `{{arg1}}` bindings |
| `savecontract` | `false` | Publish a new immutable contract after accepted completion |
| `reusecontract` | `false` | Discover exact-goal contracts inside the current workspace scope |
| `usedecide` | existing default | Only explicit `true` enables selective decision review; otherwise generative review is mandatory |

`modelstrategy=auto` selects supervised when contract options are given, when resuming a supervised run, or for complex goals with a verification requirement and no conflicting option; see the USAGE.md `modelstrategy` entry.

Explicit `contractfile` wins over plan imports and discovery. An imported contract is checked like an explicit file; an ordinary imported plan becomes source material for main preparation. Otherwise automatic discovery is considered only with `reusecontract=true`. An explicit validated contract can be reused without enabling discovery. Edited or user-authored supported contracts require preparation/review and are never reported as validated hits.

Saving and discovery are independent. Files are stored under the normal Mini-A configuration home at `contracts/<workspace-sha256>/<id>/<revision>-<uuid>/CONTRACT.md`; existing `homedir` works as the override. Saving never updates the selected file, registers a skill, or overwrites user content. Publication uses a same-directory temporary file and atomic create-only hard linking; filesystems without this facility report save failure while preserving accepted execution.

`modellock=main|lc`, explicit `useplanning=false`, chatbot, outer-loop, deep-research, delegation, standalone plan-mode/conversion/validation and deep-research validation goals conflict with supervised execution and produce configuration errors. Contract options outside supervised mode are rejected. Unspecified planning is enabled. Streaming is disabled for supervised execution so every final passes acceptance. Existing `OAF_VAL_MODEL` performs generative reviews when configured; otherwise main performs them. Decision failures use the existing generative reviewer, with no new provider retry/fallback policy.

## Lifecycle and limits

1. Validate/resume or select an applicable contract. A cache hit skips initial main preparation and unconditional critique, resets progress, and starts a new evidence epoch.
2. On a miss, LC may request at most two read-only retrievals. Main receives the original goal, material configuration constraints, nearest AGENTS.md, current available input files, raw reconnaissance evidence and tool manifest. It chooses an approach, steps, checks and bounded recovery rules.
3. LC executes the bound Markdown instructions through existing tools. Contract requirements are host controlled; LC state updates can report step progress but cannot change checks or criteria.
4. Deterministic checks run first. Missing evidence requests collection; local failure allows bounded repair. Semantic checks use bounded evidence and an explicit rubric. With `usedecide=true`, supported decision verdicts may satisfy these checks; ambiguity/failure falls back to generative review. Otherwise generative review also verifies whole-goal coverage for deterministic tasks.
5. Repeated failure asks main the smallest unresolved question, with steps, attempts and evidence. Main can return guidance, revise affected instructions, request a two-turn execution segment, or identify a blocker. Revisions retain criterion IDs, requirement text and constraints, increment the revision, and trace old/new hashes.
6. Complete only when mandatory checks and required review pass against current artifact fingerprints. Save only after this acceptance. Timeout, exhausted budgets, missing evidence and blockers cannot promote a contract.

Host limits are 60 executor/LC maintenance calls (or a smaller positive `maxtotalsteps`), two local repair attempts per failure signature, eight supervised decision calls, three main/validation interventions and two executor turns per requested takeover. Existing rate, context, permission and error recovery limits still apply. Resume retains consumed execution, LC token, decision and intervention budgets; it restores the full contract outside the truncated legacy state serializer, retains progress as hints and the bounded takeover remainder, and collects fresh evidence. Explicit goal/input/requirements or contract overrides on resume fail closed.

If current artifact checks already satisfy every criterion, Mini-A requests synthesis and review without replaying mutations. Semantic/final-answer criteria still require fresh judgment. Final `outfile` cannot overwrite validated evidence; create task artifacts through tools before acceptance.

## Canonical format

See [the illustrative contract](../examples/CONTRACT.md). YAML front matter is the only representation of machine fields; the Markdown body is the only representation of execution instructions. `steps[].section` references a body heading. Runtime adds `requirements_hash` from goal, rules, persona, hook context, execution permissions and nearest AGENTS.md. Main preparation establishes current scope and requirements.

Required fields: `schema`, `id`, integer `revision`, `goal`, `constraints`, `scope.workspace`, `inputs`, `capabilities`, `preconditions`, `assumptions`, `steps`, `criteria`, `checks`, `escalation.local_repairs`, and Markdown instructions. Each criterion must have a mandatory check. Limits: 64 entries per structured list, 64 KiB contract/text artifact reads and 24 KiB review evidence. Tool-result artifact associations and dependencies use existing OpenAF streaming SHA-256, so large/binary outputs can be fingerprinted without entering the model context. Large outputs should expose a bounded task artifact suitable for existing validation tools.

Inputs declare `position`, `required`, `kind: file|value`, and `variability: stable|variable`. Variable inputs bind again each run; hardcoded variable file paths in instructions or check sources are refused for saving/reuse (use positional bindings and `source.input`); stable inputs retain their validated fingerprint. Preconditions are deterministic checks; assumptions either reference a precondition via `check` or require applicability review. Optional `dependencies` are individual `{path, sha256}` entries. Capabilities name actual available tools, plus `artifact-read` for host inspection. No permissions are granted by these declarations.

Checks identify `id`, `criterion`, `method`, `required_evidence`, and `mandatory`. Methods:

- `assertion`/`artifact`: existing MiniAEval `equals`, `contains`, `notContains`, `matches`, `min`, or `max`, optionally at a dotted `path` under `result` or `answer`.
- `schema`: existing OpenAF JSON Schema validation with `schema`.
- `tool-result`: the same assertions against a tool result observed in this run, plus `artifacts` whose current fingerprints bind the result to its output version. `source.tool` and `source.params` identify the exact invocation. Cached results are excluded; shell checks should assert `result.exitcode`.
- `semantic`: an explicit `rubric` and bounded `required_evidence`, with no executable expression.

Sources are `{input: name, format: json|yaml}`, `{path: permittedPath}`, `{answer: true}`, or `{tool: name, params: {...}}`. Required evidence references input names, `final_answer`, or deterministic check IDs. Outcomes are `met`, `unmet`, or `insufficient_evidence`. A missing value, skipped check, parse failure or absent tool provenance cannot pass.

Saving adds `provenance`: exact meaningful-content SHA-256 (excluding provenance), accepted run/time, stable input and declared tool-schema/annotation fingerprints, per-check method/outcome, acceptance kind (`deterministic`, `semantic`, `mixed`), review and validation policy. No previous progress, tool transcript, input values or answer is promoted. Credential-bearing content is refused. Historical acceptance establishes a content association, not universal reliability or authenticity of an untrusted file.

Discovery preserves case, identifiers and quoted code: only outer whitespace and line endings normalize. It requires the same canonical workspace, goal/requirements coverage, supported structure, unchanged validated content, current bindings, capabilities, material dependencies and established assumptions. There is no fuzzy/embedding search, repository-wide hash or TTL validity. A disproved applicability condition creates a rejection receipt when automatic reuse is enabled; transient execution failures leave the procedure available. User edits are preserved and need review.

## Tests and evaluation

Run `ojob tests/supervised.yaml` and `ojob tests/eval.yaml`, plus the existing decision, advanced-planning, skill-runtime, utility and core suites. The deterministic full-loop fixture uses stub providers and does not establish real-provider quality.

`ojob mini-a.yaml eval=true evalfile=evals/supervised.yaml evalout=/tmp/supervised-eval.json` runs configured providers on identical isolated task fixtures. The matrix covers main, strictly LC-only, default/advisor, mandatory generative review, selective decision review, and cold/warm contracts. Warm attempts reset artifacts while preserving only the contract store; warmup is independently checked and reported separately and in combined cost.

Independent artifact assertions judge every variant; runtime decisions are never the sole judge. `audit_all: true` and the configured independent generative judge in the suite audit every accepted result; other suites default to a deterministic 20% goal sample. Inspect the recorded artifacts, traces and answers for those audits. Run held-out tasks beyond these fixtures before choosing deployment policy.

Telemetry records actual role dispatches, repairs, preparation/review/revision/takeover, decision fallbacks, cache events/reasons and whether generation was skipped. MiniAEval retains provider usage and latency; optional constructor `pricing` maps `type/model` to `{input_per_million, output_per_million}` for estimated cost. Missing usage or prices stay unknown. Task-execution cost per independently successful task includes failed attempts and warmup; evaluation-judge calls are separate from the task metrics. Skipped calls are not measured monetary savings. Cached-token billing is left unknown; these estimates do not replace invoices.
