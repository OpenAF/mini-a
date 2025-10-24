# Examples for mini-a

This folder contains runnable examples that showcase how to use the mini-a (Mini Agent) with OpenAF oJob workflows.

## Folder summary report (summary.yaml)

Builds a concise report about the current folder (non-recursive) with:
- A markdown table of files (name, size in bytes, modified timestamp)
- A pie chart of file sizes rendered via Chart.js inside markdown
- An optional HTML version of the report

The workflow is defined in `summary.yaml` and leverages the `mini-a` and `Mermaid` opacks.

### Prerequisites
- OpenAF installed: https://openaf.io
- Required opacks (installed automatically when running the job, or install explicitly):
  - mini-a
  - Mermaid

Optional explicit install:

```sh
opack install mini-a Mermaid
```

### How to run

```sh
ojob examples/summary.yaml
# or
ojob -f examples/summary.yaml
```

Outputs in the current working directory:
- `summary.md` — Markdown report with a file table and an embedded Chart.js pie chart
- `summary.html` — HTML version of the markdown report

### Notes
- The report excludes typical VCS/build folders (e.g., `.git`, `node_modules`, `dist`, `build`) and temporary/backup files.
- File list is sorted by size (bytes) in descending order and includes a final total row.
- The pie chart groups smaller files into an "Other" slice if there are more than 12 files.
- To summarize a different folder, run the job from that folder or change to the desired directory before invoking the job.

For more details about mini-a usage and capabilities, see the project README and USAGE guides in the repository root.