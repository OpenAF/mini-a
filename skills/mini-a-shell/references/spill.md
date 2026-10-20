# Spilled results

Large tool or shell output is saved to a file and replaced by a notice with `resultFile`.
- Proxy mode: call `proxy-dispatch` with `{"action":"readresult","resultFile":"...","op":"stat"}`; do not nest it in `call`/`arguments`.
- `usestdutils=true`: use the `result_*` alias tools.
- Start with `stat`, then use `head`/`tail` (first/last N lines), `grep` (regex search), `slice` (`fromChar`/`toChar`) or `read` (whole file, only when small). Follow any returned `next` arguments with the same file and pattern.
- Do not re-run the original command just to see more output.
