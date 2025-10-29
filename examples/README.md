# Examples for mini-a

This folder contains runnable examples that showcase how to use the mini-a (Mini Agent) with OpenAF oJob workflows.

## Prerequisites

All examples require:
- OpenAF installed: https://openaf.io
- Required opacks are installed automatically when running each job, or you can install them explicitly:

```sh
opack install mini-a
opack install Mermaid  # For summary.yaml
```

---

## Git Changelog Generator (changelog-generator.yaml)

Generates a formatted CHANGELOG.md file from git commit history with:
- Automatic commit type classification (features, fixes, docs, chores, etc.)
- Grouped and sorted commit entries
- Clean markdown formatting following conventional changelog patterns
- Configurable time range for commit history

### Required opacks
- mini-a

### How to run

```sh
ojob examples/changelog-generator.yaml
```

### Output
- `CHANGELOG.md` — Formatted changelog with commits grouped by type

### Notes
- The generator analyzes the last 50 commits or 6 months of history (whichever is more recent)
- Commit messages are parsed for conventional commit prefixes (feat:, fix:, docs:, etc.)
- Commits are grouped into: Breaking Changes, Features, Fixes, Documentation, Chores, and Other
- Each commit entry includes the short hash, cleaned message, date, and author
- Merge commits can be included or excluded based on the goal configuration
- The output follows standard changelog formatting conventions

---

## Folder Summary Report (summary.yaml)

Builds a concise report about the current folder (non-recursive) with:
- A markdown table of files (name, size in bytes, modified timestamp)
- A pie chart of file sizes rendered via Chart.js inside markdown
- An optional HTML version of the report

### Required opacks
- mini-a
- Mermaid

### How to run

```sh
ojob examples/summary.yaml
```

### Output
- `summary.md` — Markdown report with a file table and an embedded Chart.js pie chart
- `summary.html` — HTML version of the markdown report

### Notes
- The report excludes typical VCS/build folders (e.g., `.git`, `node_modules`, `dist`, `build`) and temporary/backup files
- File list is sorted by size (bytes) in descending order and includes a final total row
- The pie chart groups smaller files into an "Other" slice if there are more than 12 files
- To summarize a different folder, run the job from that folder or change to the desired directory before invoking the job

---

## Documentation Updater (document.yaml)

Updates markdown documentation files in the repository to ensure they accurately reflect the current implementation and any significant changes.

### Required opacks
- mini-a
- Mermaid

### How to run

```sh
ojob examples/document.yaml
```

### What it does
- Scans all markdown documentation files in the current folder and sub-folders (excluding `.git`)
- Analyzes all non-markdown files in the repository to identify relevant changes
- Updates each markdown file with accurate information about:
  - New features, functions, or APIs that have been added
  - Changed behavior, parameters, or configuration options
  - Deprecated or removed functionality
  - Updated examples or usage patterns
  - New dependencies or requirements

### Notes
- Only makes changes when they are relevant and significant
- Preserves the existing documentation structure and style
- Ensures all code examples in the documentation remain accurate and reflect the current implementation
- Useful for keeping documentation in sync with code changes after development

---

For more details about mini-a usage and capabilities, see the project README and USAGE guides in the repository root.