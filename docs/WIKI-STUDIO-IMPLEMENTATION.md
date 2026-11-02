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
