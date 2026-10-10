---
name: mini-a-runtime-diagnostics
description: Diagnose Mini-A skipped tools, failed goals, and unexpected answers using effective configuration, transcripts, and runtime evidence.
---
# Diagnose the running Mini-A agent

Use for skipped tools, failed goals, unexpected answers, or uncertainty about whether selected skills were followed. Requires access to relevant configuration and logs; collect only necessary evidence and redact credentials.

1. Record the entry point, invocation, working directory, installed package or checkout path, and symptom. Inspect effective options and environment model routing without printing keys. Consult @references/diagnostics.md for the boundaries that commonly explain surprises.
2. Trace the relevant lifecycle: goal and configuration, available tool schemas, skill discovery/selection/loading, actual tool requests, returned errors/results, and final output. Separate confirmed causes from hypotheses. Tool availability, skill activation, and successful loading do not prove execution or compliance.
3. Compare the source under inspection with the runtime actually launched. An installed oPack can differ from a checkout; a long-lived web server can still run older code. Verify paths and running process configuration before attributing behavior to an edit.
4. Reproduce with a small representative goal and `debug=true` when appropriate. Preserve existing state and avoid exposing sensitive prompt or log content. If a prerequisite is unavailable, report the precise boundary instead of inventing execution evidence.
5. Make corrective changes within the user's authorized scope. Treat configuration edits, rebuilding/repackaging, and restarting processes as separate actions; choose only the steps needed by the observed cause. Verify afterward against the same entry point and runtime that exhibited the problem.

Completion: report the cause and evidence, correction performed, reproduction/verification results, and remaining uncertainty. For skill adherence, inspect tool-call or output-artifact evidence beyond activation metrics.
