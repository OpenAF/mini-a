# Mini-A Eval System

The eval system lets you measure agent quality by running the full LLM loop against defined test cases and judging answers automatically. It supports regression testing with golden files, LLM-based scoring, and tag-based filtering for CI workflows.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Running Evals](#running-evals)
- [Case File Format](#case-file-format)
- [Judge Modes](#judge-modes)
- [Golden Files](#golden-files)
- [Skills Evals](#skills-evals)
- [Skills `test` Operation](#skills-test-operation)
- [CI Integration](#ci-integration)
- [Report Format](#report-format)
- [Configuration Reference](#configuration-reference)

---

## Overview

```
evals/
├── evals.yaml              # Main eval ojob (general goals)
├── evals-skills.yaml       # Skills-specific eval ojob
├── cases/
│   ├── basic-tasks.yaml    # Example general cases
│   └── skills-cases.yaml   # Example skills cases
└── golden/                 # Auto-populated golden reference files
```

Two new source files power the framework:

| File | Purpose |
|---|---|
| `mini-a-eval.js` | `MiniAEval` class — runs agents, judges answers, manages golden files, writes JSON reports |
| `mini-a-utils.js` | Extended `skills()` with `test` operation for render-only or render+run skill testing |

---

## Quick Start

```bash
# Run built-in general eval cases (uses OAF_MODEL for both agent and judge)
ojob evals/evals.yaml

# Run with a dedicated cheap judge model
ojob evals/evals.yaml judgeModel=haiku

# Run only cases tagged 'math'
ojob evals/evals.yaml tags=math

# First-run golden capture (saves reference files, auto-passes all cases)
ojob evals/evals.yaml updateGolden=true

# Run skills evals
ojob evals/evals-skills.yaml
```

---

## Running Evals

### General evals

```bash
ojob evals/evals.yaml [options]
```

Each run:
1. Loads cases from `casesFile` (default: `evals/cases/basic-tasks.yaml`)
2. Optionally filters by `tags`
3. Runs a fresh `MiniA` agent per case (isolated state)
4. Judges the answer using the selected `judge` mode
5. Prints per-case PASS/FAIL with score
6. Writes a JSON report to `outputFile`
7. **Exits with code 1 if any case fails** (useful for CI)

### Skills evals

```bash
ojob evals/evals-skills.yaml [options]
```

Identical flow but defaults to `evals/cases/skills-cases.yaml` and `evals/skills-results.json`. Cases can use the `skill` field to render a skill template as the agent goal.

### Using a custom cases file

```bash
ojob evals/evals.yaml casesFile=my-evals/regression.yaml outputFile=my-evals/results.json
```

---

## Case File Format

Cases files are YAML with a top-level `cases` array:

```yaml
cases:
- id       : basic-math-multiply
  goal     : "What is 17 * 6? Answer only with the number."
  judge    : llm
  expected : "102"
  threshold: 0.9
  maxsteps : 5
  tags     : [basic, math]

- id       : describe-openaf
  goal     : "In one sentence, describe what OpenAF is."
  judge    : golden           # first run saves golden, subsequent runs compare
  threshold: 0.7
  tags     : [text, golden]

- id       : skill-step-plan
  skill    : plan             # render the 'plan' skill as the goal
  skillArgs: "migrate a PostgreSQL schema"
  judge    : both             # llm + golden, pass if min(both) >= threshold
  expected : "step by step plan"
  threshold: 0.75
  tags     : [skills, planning]
```

### Case fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Unique identifier; used as the golden file name |
| `goal` | string | one of | Prompt sent directly to the agent |
| `skill` | string | one of | Skill name to render (requires skill roots configured) |
| `skillArgs` | string | no | Args string for skill rendering (when `skill` is set) |
| `judge` | string | no | `llm` (default), `golden`, or `both` |
| `expected` | string | no | Reference answer for the LLM judge |
| `threshold` | number | no | Pass cutoff 0.0–1.0 (default: `0.7`) |
| `maxsteps` | number | no | Per-case agent step limit override |
| `agentArgs` | object | no | Extra args merged into the agent `init()` call |
| `tags` | string[] | no | Tags for `tags=` filtering |

---

## Judge Modes

### `llm` (default)

Sends the goal, actual answer, and optional `expected` text to the judge LLM. Returns a score 0.0–1.0 plus a one-sentence reasoning.

```yaml
judge   : llm
expected: "The answer should mention France"
threshold: 0.8
```

**Fallback**: if no `judgeModel` is configured, falls back to a substring match (actual contains expected). Useful for smoke tests without LLM costs.

### `golden`

Compares the agent's answer against a saved reference file in `evals/golden/<id>.txt`.

- **First run** (or `updateGolden=true`): saves the answer as the golden reference, auto-passes with score 1.0.
- **Subsequent runs**: passes the golden content to the LLM judge for comparison.

```yaml
judge    : golden
threshold: 0.7
```

### `both`

Runs both `llm` and `golden` judges and takes the minimum score. The case passes only if `min(llmScore, goldenScore) >= threshold`.

```yaml
judge    : both
expected : "plan with numbered steps"
threshold: 0.75
```

---

## Golden Files

Golden files are plain text files stored in `evals/golden/` (configurable via `goldenDir`). The file name is `<case-id>.txt`.

### Workflow

```bash
# 1. Capture golden files on a baseline you trust
ojob evals/evals.yaml updateGolden=true

# 2. Run normally in CI — any answer that diverges from golden will score low
ojob evals/evals.yaml

# 3. Refresh a single case's golden after an intentional change
ojob evals/evals.yaml updateGolden=true tags=my-tag
```

The golden directory is created automatically. Commit the `evals/golden/` directory to track regressions in version control.

---

## Skills Evals

When a case has a `skill` field, `MiniAEval` renders the skill template and uses the rendered text as the agent goal:

```yaml
- id        : plan-skill-db
  skill     : plan
  skillArgs : "migrate a database schema"
  judge     : golden
  threshold : 0.7
```

This tests the full pipeline: skill discovery → template rendering → agent execution → judging.

For skills that don't yet exist in your skill roots, use a direct `goal` instead and add the `skills` tag for organizational clarity.

---

## Skills `test` Operation

The `skills()` MiniUtils method gained a `test` operation for lightweight skill inspection and optional execution from code or the MCP tool interface:

### Render-only (no agent run)

```javascript
var ut = new MiniUtilsTool()
ut.init({ root: "." })
var result = ut.skills({
  operation: "test",
  name     : "plan",
  args     : "refactor authentication module"
})
// result.rendered  → the expanded prompt
// result.run       → false
```

### Render + run agent

```javascript
var result = ut.skills({
  operation: "test",
  name     : "plan",
  args     : "refactor authentication module",
  run      : true,
  maxsteps : 5,
  agentArgs: { silent: true }
})
// result.rendered  → the expanded prompt
// result.answer    → agent's final answer
// result.metrics   → agent.getMetrics() snapshot
// result.run       → true
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `name` | string | Skill name (required) |
| `args` | string | Raw arguments for template rendering |
| `argv` | array | Explicit argument list (overrides `args`) |
| `run` | boolean | `true` to also run a mini-a agent with the rendered goal |
| `maxsteps` | number | Agent step limit when `run=true` (default: 5) |
| `agentArgs` | object | Extra args merged into the agent `init()` call |

---

## CI Integration

The eval ojobs exit with code 1 when any case fails, making them drop-in CI steps:

```yaml
# GitHub Actions example
- name: Run Mini-A Evals
  run: ojob evals/evals.yaml judgeModel=$JUDGE_MODEL tags=ci
  env:
    OAF_MODEL: ${{ secrets.OAF_MODEL }}
    JUDGE_MODEL: ${{ secrets.JUDGE_MODEL }}
```

### Recommended CI workflow

```bash
# Smoke tests (no LLM judge, substring match)
ojob evals/evals.yaml tags=smoke

# Full regression with golden files
ojob evals/evals.yaml judgeModel=haiku tags=regression

# Skills regression
ojob evals/evals-skills.yaml judgeModel=haiku
```

### Tag strategy

```yaml
tags: [smoke]        # Fast, no LLM judge, run on every commit
tags: [regression]   # Golden comparison, run on PR merge
tags: [expensive]    # Full LLM judge, run nightly
```

---

## Report Format

`writeReport()` produces a JSON file (default: `evals/results.json`):

```json
{
  "timestamp": "2026-03-05T12:00:00.000Z",
  "summary": {
    "total": 7,
    "pass": 6,
    "fail": 1,
    "avgScore": 0.912
  },
  "results": [
    {
      "id": "basic-math-multiply",
      "goal": "What is 17 * 6? Answer only with the number.",
      "answer": "102",
      "score": 1.0,
      "reasoning": "Exact match.",
      "passed": true,
      "threshold": 0.9,
      "judgeMode": "llm",
      "durationMs": 2341,
      "metrics": { ... }
    }
  ]
}
```

Each result includes the case `id`, `goal`, agent `answer`, `score`, `reasoning`, `passed` bool, and a `metrics` snapshot from `agent.getMetrics()`.

---

## Configuration Reference

### `evals/evals.yaml` and `evals/evals-skills.yaml` parameters

| Parameter | Default | Description |
|---|---|---|
| `casesFile` | `evals/cases/basic-tasks.yaml` | Path to the cases YAML file |
| `judgeModel` | `""` | Judge LLM model id (empty = substring fallback) |
| `judgeProvider` | `""` | Provider prefix prepended as `provider/model` |
| `goldenDir` | `evals/golden` | Directory for golden `.txt` files |
| `updateGolden` | `false` | Overwrite golden files with current answers |
| `outputFile` | `evals/results.json` | JSON report output path |
| `tags` | `""` | Comma-separated tag filter (empty = run all) |
| `model` | _(OAF_MODEL)_ | Agent model override |
| `maxsteps` | `10` | Default agent step limit |

### `MiniAEval` API (programmatic use)

```javascript
load("mini-a-eval.js")

var runner = new MiniAEval()
runner.init({
  judgeModel   : "haiku",
  judgeProvider: "anthropic",   // optional; prepends as provider/model
  goldenDir    : "evals/golden",
  updateGolden : false,
  model        : getEnv("OAF_MODEL"),
  maxsteps     : 10
})

var result = runner.runCase({
  id       : "my-case",
  goal     : "What is 2 + 2?",
  judge    : "llm",
  expected : "4",
  threshold: 0.9
})

print(result.passed ? "PASS" : "FAIL")

var summary = runner.getSummary()   // { total, pass, fail, avgScore }
runner.writeReport("evals/my-results.json")
```
