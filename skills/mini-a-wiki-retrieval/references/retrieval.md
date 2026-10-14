# Retrieval tool contract

Use the schema exposed by the active connection; some deployments expose fewer operations.

- `context`: inspect configured knowledge sources and access modes.
- `search`: supply `query`; `wiki` can select `primary`, a mount name, `*`, or an array of names. `path` scopes to one page. Retrieval v2 has request budgets such as `maxBytes`, `maxCandidates`, and `maxMillis`; an unavailable/incompatible index is not proof of no matching knowledge.
- `open`: supply the returned `path` to inspect headings and deterministic boundaries without fetching the body.
- `read`: supply `path` and `section`, or 1-based `startLine`/`endLine`. `countLines=true` inspects length first. Mounted paths use `@name/path.md`; an explicit `wiki` selector must agree with the path.
- `grep`: use a known page/folder `path`, `pattern`, and bounded `limit`/`contextLines`/`maxChars`. Copy the returned `next` object into `cursor`; it binds scope, pattern, ordering, and revision. Do not fabricate or increment opaque cursor fields.
- `navigate` and `related` can fill a structural/reference gap after lexical search.

A source URL returned with page content is its canonical citation source. Retain it in answers. Permission errors require an authorized source or a report of the limitation, not an alternate-path bypass.

If no wiki tool is available, report the missing prerequisite. Do not claim a search occurred. Reindexing is a separate maintenance task requiring the applicable write access and user scope.
