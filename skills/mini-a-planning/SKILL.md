---
name: mini-a-planning
description: Keep a Mini-A todo plan accurate for multi-step goals using the todoList / todowrite tool.
requires:
  anyTools: [todoList, todowrite]
---
# Maintain the todo plan

Use for goals with three or more distinct steps or where progress must be visible. Skip for single-step requests.

1. Write the plan first with concrete, verifiable items; exactly one item in progress at a time.
2. The list is replaced on each write (`todoList` operation `write`; `todowrite` likewise): always send the complete current list, not a delta. Use `read` to recover it after context loss.
3. Update statuses immediately when an item finishes or becomes blocked; add items when new work is discovered instead of silently doing it.
4. Before the final answer, read the plan and reconcile it: every item completed, or explicitly reported as skipped/blocked with the reason.

Completion: the last plan state matches what was actually done.
