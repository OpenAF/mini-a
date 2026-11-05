# Wiki Studio implementation record

Baseline: branch `feature/wiki-studio`, based on `startup-speed`, 2026-11-02.
Unrelated untracked `.mini-a-wiki-ingest/`, `PLAN-UI.md`, `tmp-contract.md` and
`tmp-contract.sh` are preserved. No existing wiki is selected implicitly.

Interfaces inspected: operation catalogue/permission gates, manager full `read`
versus bounded `agenticRead`, ingest source ownership/journals, saved absorption
plans, dream modes, graph renderer, wikiJobsLib, HTTP/session surfaces, MCP
descriptors and wiki/retrieval/absorb documentation. Optional personal recipes
were inspected locally; none of their implementation/content is distributed.

Baseline commands launched before changes:
`ojob tests/{wiki,wikiIngest,wikiAbsorb,dreams,graph,wikiUtilsJobs}.yaml`
(each command separately). Results are updated in the final validation record.

Adapter decisions:
- Keep manager operations and Markdown authoritative; no database or Node runtime.
- Manager `read(path)` returns full `raw`. Check byte budget before opening it.
- Manager full writes normally serialize metadata. Add an explicit `preserveRaw`
  option for editor writes while retaining index/provenance updates.
- Plan is maintenance diagnostics, never an immutable reorg proposal.
- Pass semantic false explicitly; snapshot before page-mutating batch operations.
- OpenAF `ow.server.httpd.start(port, host)` does bind a host (verified in source).
  Studio uses JDK HttpServer with an explicit InetSocketAddress instead, for
  streaming request limits; available in the tested OpenAF JVM.
- Studio OS locks exclude Studio readers/writers only. External processes must
  be stopped for offline maintenance. Never retry interrupted writes automatically.

Milestone and validation results are recorded in `docs/WIKI-STUDIO.md`.

## Validation record

Baseline suites, all model-free: wiki 260 passed; wikiIngest 102; wikiAbsorb 23;
dreams 75; graph 22; wikiUtilsJobs 9. The same established suites passed after the
core editor extension. Wiki-manager adds 19 passes and one failure:
`GraphStatsConsoleParity: ReferenceError: colorifyText is not defined`.
That failure was reproduced from an isolated archive of the unchanged
`startup-speed` starting branch, so no unrelated console fix is included.

New `tests/wikiStudio.yaml`: 12 passing groups cover registry/auth/path boundaries,
atomic state/locks, complete raw editing/conflicts, graph fallback/cache, persisted
jobs and interrupted event append, uploads/ZIP paths/local directory snapshots,
real raw hydration/rerun/manual conflicts, injected-model saved-plan absorption,
verified snapshots/corruption/restore and deterministic injected restructuring.
No live-provider reorg/absorption quality claim is made.

Existing Web checks: all 36 `tests/web*.cjs` scripts pass. Standalone exporter:
`python3 tests/wikiGraph.py` passes four tests. The extended
`node tests/wikiGraphUI.js <embedded export>` interaction test passes, including
the versioned document-node bridge. It uses DOM/canvas stubs, not a browser.
Browser login, registration, raw edit/save and inert HTML preview were verified.
The in-app browser did not load the sandboxed Blob graph; the UI has an explicit
readiness warning and offline HTML download, and this remains a browser QA limit.

Packaging checks found and fixed a missing pre-existing launcher dependency.
`js/core/mini-a-launcher.js` is now included alongside every Studio production file.
`tests/wikiStudioPackage.py` builds only explicit manifest files, generates an
actual `.opack`, extracts an isolated install layout and runs real-worker HTTP
flows from another cwd. It never modifies the existing OpenAF package registry.
The HTTP suite includes auth/origin/ro checks, two-wiki isolation, graph, unchanged
plan, raw source preview/apply, indexes backup, restore, ZIP attacks, SSE replay and
explicit crash/restart with no destructive replay. Final run results are reported
in the delivery response. The final packaged run passed 146 HTTP assertions and
verified all 209 manifest files through generated archive/extracted install layout.

Original acceptance limits are explicit in `docs/WIKI-STUDIO.md`: outbound
adapters, connected non-fs readers, role-token configuration, rich model budget
controls, automatic retention, full live/browser workflows and automatic recovery
from a crash between restore renames are not completed by this implementation.
