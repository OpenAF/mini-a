# Two-wiki Studio walkthrough

Use disposable data first. From the Mini-A checkout:

```sh
mkdir -p /private/tmp/studio-demo/wikis/alpha /private/tmp/studio-demo/wikis/beta
cp examples/wiki-studio/alpha.md /private/tmp/studio-demo/wikis/alpha/alpha.md
cp examples/wiki-studio/beta.md /private/tmp/studio-demo/wikis/beta/beta.md
ojob mini-a-wiki-studio.yaml studiohome=/private/tmp/studio-demo/state \
  studioallowroots='["/private/tmp/studio-demo/wikis"]' onport=8890
```

1. Open `http://127.0.0.1:8890`, enter the locally printed token and register
   `alpha` and `beta` at their absolute roots above, access `rw`.
2. Open Alpha → Pages, open `alpha.md`, edit and Save. Frontmatter comments stay
   intact. Beta's file remains independent. A second editor with an old revision
   receives a conflict instead of overwriting newer content.
3. Open Graph → Open graph. With no snapshot, the existing exporter shows Markdown
   links. Download offline HTML if the browser blocks sandboxed Blob frames.
   Queue a rebuild with semantic unchecked, then reopen after Jobs completes.
4. Sources → upload the `examples/wiki-studio/source` directory (or ZIP containing
   its Markdown file), source ID `lessons`. Review the staged inventory. Choose
   `raw` and Preview, then Apply. Inspect job logs and the created pages. Upload
   an updated revision using `lessons` again for incremental reconciliation.
5. Dreams → plan. Semantic remains unchecked. Confirm zero changed files in the
   completed job. This diagnoses maintenance, not future LLM reorganization.
6. Dreams → indexes to exercise a page-mutating maintenance operation without a
   model. Inspect the verified backup and actual changed-page comparison.
7. Create a manual snapshot, make another edit, then restore that snapshot from
   Dreams. Stop external processes first. Studio makes a pre-restore backup and
   keeps the replaced directory for recovery. Validate restored content/health.

Optional model workflow: restart Studio with a trusted `OAF_MODEL` environment
configuration, preserving `studiohome` and your stable `STUDIO_TOKEN` if configured.
Select reorg, enter guidance/step budget and explicitly acknowledge structural
changes. Keep semantic unchecked unless desired. The worker must verify its
pre-run backup before invoking the live agent. Inspect actual job changes and
restore on this disposable wiki if needed. For absorption, select Beta as Alpha's
source, generate and inspect a saved plan, then apply that plan explicitly; source
Beta remains unchanged. Neither workflow promises an exact future LLM diff or
invented cost/model usage.

See [full documentation](../../docs/WIKI-STUDIO.md) for capabilities, disabled
outbound adapters, local source allowlists, API, limits and recovery procedures.
