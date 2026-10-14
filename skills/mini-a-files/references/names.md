# Tool names by catalog

| Purpose | Legacy (`useutils=true`) | `usestdutils=true` |
|---|---|---|
| Read file / list dir / file info | `filesystemQuery` | `read` |
| Glob paths | `filesystemQuery` | `glob` |
| Search content | `filesystemQuery` | `grep` |
| Edit / write / delete | `filesystemModify` | `apply_patch` (plus `filesystemModify`) |
| Many operations at once | `filesystemBatch` | `filesystemBatch` |
| Markdown files | `markdownFiles` | `markdownFiles` |
| Non-text documents | `readDocument` | `readDocument` |

Use `utilsallow`/`utilsdeny` to see which of these are actually exposed in a run.
