---
name: mini-a-wiki-retrieval
description: Answer questions from configured Mini-A knowledge libraries using bounded, source-grounded wiki retrieval.
---
# Retrieve evidence from a wiki

Use this procedure for answering from configured knowledge libraries. Requires an enabled wiki tool or MCP connection and readable sources. Skill activation does not enable tools or grant access.

1. Use the tool names advertised by the connection, including any prefix. Start a specific lookup with `search`. When the relevant wiki or its terminology is unclear, call `context` and read that wiki's `guidePath` if present. Use its entry points and aliases to refine the search. For a request about how the wiki is organized, start with `browse` or a shallow `tree`. Keep the returned wiki selectors and paths.
2. Search for the question's terms, with a relevant source or path scope when known. Preserve the returned page references and status. No matches, an unavailable backend, and an incompatible or missing retrieval index are different outcomes. Report unavailable evidence and needed repair; do not write, compact, ingest, or reindex a wiki as part of answering.
3. Open promising page descriptors to inspect headings, then read only the relevant section or line range. Search snippets guide discovery; verify claims against the underlying text. Use returned source URLs as citations when present, otherwise identify the page and section.
4. Handle partial results before drawing conclusions. Follow returned continuation information with the same scope and query. For bounded page reads, use the returned line boundaries to request the next range. If a revision or cursor is invalid, reopen the descriptor and resume against the current revision. Follow relevant references when the first section leaves a gap.
5. Answer from the content actually returned, distinguishing evidence from inference. State any unresolved gap or truncation that limits the answer.

Completion: each material claim has a retrieved source; tool results establish which pages and ranges were read. Successful skill loading or a final claim of retrieval is insufficient evidence.

For tool parameters and continuation rules, read the relative file @references/retrieval.md.
