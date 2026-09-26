# Entry-point comparison

Reviewed 2026-09-26 against the console (`mini-a-con.js`), one-shot job
(`mini-a.yaml`) and HTTP job (`mini-a-web.yaml`), including recent console changes.
This is a source and local regression audit, not live provider or browser proof.

## Execution paths

| Behavior | Interactive console | `mini-a goal=...` / `ojob mini-a.yaml` | Web |
| --- | --- | --- | --- |
| Agent execution | New `MiniA` per goal | One `MiniA` per invocation | Reuses `MiniA` per session UUID |
| Core tools, routing, memory, wiki, planning | Shared `init` / `start` | Shared `init` / `start` | Shared `init` / `start`; refreshed turn context |
| Goal prefix | Shared prefix helper | Now uses shared prefix helper | Shared prefix helper on each new request |
| Final answer | Retained-answer fallback and terminal renderer | Now uses retained-answer fallback; single output for piped/streamed runs | Typed result handling, final transcript and SSE |
| Markdown fences | Shared fence helper | Shared core fence helper | Shared core and presentation fence helper |
| Hook files and execution | Shared loader/runner; interactive reload and listing | Same loader/runner | No automatic local hook loading |
| Input files | Local `@file`, slash commands, quoted paths | Explicit job arguments | Browser attachment payloads |
| Stop and resources | Esc; closes prior agent before next goal and on exit | `finally` closes agent resources | Request ownership, stop endpoint, idle clear/expiry disposal |

The installed console launcher dispatches `goal=` to `mini-a.yaml` and web startup
to `mini-a-web.yaml`. Fixes in `MiniA` already reach all three; console rendering,
keyboard and slash-command fixes need separate consideration. Recent JSON dispatch,
prompt refresh and tool-contract fixes are in the shared core. Console path quoting
and completion apply to its command grammar; shell wrappers already forward `"$@"`.

## Repairs and consolidation

- The one-shot job accepted `goalprefix` but never applied it. All three entry points
  now call `__miniAPrefixGoal` before initialization, without putting prefixing inside
  the core's repeated research/outer loops. Hook event context retains the original goal.
- The console retained an answer when OpenAF formatting returned `undefined`; the
  one-shot job printed `undefined`. Both now use `__miniAFinalResult`. `start()` clears
  the prior original answer so a reused agent cannot expose a previous turn's fallback.
- The console's extra unwrap pass removed visual fences preserved by the core. The
  core and console also treated multiple fenced blocks as one wrapper. A shared
  `__miniAUnwrapAnswer` preserves visual languages and documents with multiple blocks,
  supports CRLF and longer outer fences, and still unwraps structured output payloads.
- The web route called `.trim()` on any defined `answer`, including objects/numbers,
  and dereferenced missing results. It now retains structured results, handles string
  and wrapped answers, preserves raw strings, and reports a missing final result through
  its existing error/disposal path.
- Hook parsing and execution were duplicated. They now live in `mini-a-common.js`,
  retaining console hook metadata, validation warnings, filters, environment conversion,
  output limits, timeouts and blocking behavior. The one-shot path gains the console's
  invalid-event and empty-command warnings.

No new module load or dependency was added. This consolidation reduces duplicate
production code; it is not a measured startup or provider-latency optimization.

## Deliberate boundaries

Terminal layout, JLine completion, Esc handling, console debug traces, browser SSE,
attachment uploads and session reservation remain adapter-specific. Web prompts do
not expand server-local `@file` references or start loading shell hooks from the
server's home directory. The console still prefixes injected before-goal hook output
to its goal, while the job uses `hookcontext`; changing this prompt contract is outside
this repair. Web session reuse remains intentional and is covered by route tests.

## Verification

- `node tests/entryPointParity.cjs`: production launcher snippets, console argument
  building, fallback output, streaming/outfile behavior, prefixing, fence preservation,
  hook parsing, diagnostics, filters and failed/throwing hooks.
- `node tests/webSessions.cjs`: production route bodies with deterministic agents;
  session ownership, cleanup, repeated turns, result shapes and missing-result handling.
- `node tests/consolePaths.cjs`, `node tests/webActivity.cjs`,
  `node tests/webStreamCompletion.cjs`, `node tests/testRunners.cjs`: passed.
- OpenAF `testEntryPointFinalAnswerParity`: passed, exercising core final-answer
  processing and original-answer reset. Registered in `tests/coreFunctionality.yaml`.
- Full core run: 220 passed, 2 failed before adding the new passing parity test.
  Both failures also reproduce individually in an untouched `git archive HEAD` copy:
  `SubtaskWatchdogShutdown` (remote cancellation wait assertion) and
  `AutoAgentsRulesLoadNearestAgentsFile` (nearest-file content assertion).

No live model calls, browser UI session, installed-package update or deployment was
performed. The two pre-existing untracked wiki retrieval plans were left unchanged.
