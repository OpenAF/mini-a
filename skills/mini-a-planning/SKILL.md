---
name: mini-a-planning
description: Keep a Mini-A todo plan accurate for multi-step goals using the todoList / todowrite tool.
requires:
  anyTools: [todoList, todowrite]
---
# Maintain the todo plan

Use for goals with three or more distinct steps or where progress must be visible. Skip for single-step requests.

1. Write the plan first with concrete, verifiable items; exactly one item in progress at a time.
2. Always send the complete current list, not a delta: `todoList` operation `write` replaces the list (unless `append: true`), and `todowrite` (under `usestdutils=true`, with `todos`) always replaces it. Both return the stored list. Recover it after context loss with `todoList` operation `read`; `todowrite` has no read, so rely on the list returned by your last write.
3. Update statuses immediately when an item finishes or becomes blocked; add items when new work is discovered instead of silently doing it.
4. Before the final answer, check the latest plan state and reconcile it: every item completed, or explicitly reported as skipped/blocked with the reason.

Completion: the last plan state matches what was actually done.
