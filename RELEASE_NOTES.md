# Unreleased

- Outgoing delegation defaults to `forkpolicy=auto`, selecting bounded clean, memory, context, or full inheritance. Set `forkpolicy=legacy` to restore previous inheritance behavior. Capability enabling flags retain their existing defaults.
- Configured decision models can assist ambiguous inheritance automatically. `forkdecide=false` selects deterministic inheritance; `usedecide=false` disables this classifier alongside other decision integrations. Classification is bounded to one attempt per snapshot, eight run-local reservations, and a two-second transport timeout.
- Explicit task overrides retain precedence. Forced scopes fail when infeasible; explicit child state/conversation suppresses automatic inheritance and conflicts with an additional explicit inheritance request.
- Console delegation follows the session policy and now parses `fork`, `clean`, and `auto` modifiers. Escape literal goals with `/delegate -- <goal>`.
- Updated workers accept prepared context on both transports, enforce operator limits, and preserve idempotent submission. Parent decision credentials are not forwarded. Offline contract tests and evaluator fixtures are included; no live quality or monetary improvement is claimed.
