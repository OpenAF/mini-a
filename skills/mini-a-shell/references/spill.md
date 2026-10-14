# Spilled results

Large tool or shell output is saved to a file and replaced by a notice with `resultFile`.
- Proxy mode: call `proxy-dispatch` with `{"action":"readresult","resultFile":"...","op":"stat"}`; do not nest it in `call`/`arguments`.
- `usestdutils=true`: use the `result_*` alias tools.
- Start with `stat`, then read ranges or search; do not re-run the original command just to see more output.
