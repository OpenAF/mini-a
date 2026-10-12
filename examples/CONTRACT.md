---
schema: mini-a.contract/v1
id: report-check
revision: 1
goal: Verify the report.
constraints:
- Read only; do not change the report.
scope:
  workspace: /absolute/project
inputs:
  report:
    position: 1
    kind: file
    required: true
    variability: variable
capabilities:
- artifact-read
preconditions: []
assumptions: []
steps:
- id: S1
  section: Inspect the report
criteria:
- id: C1
  requirement: The current report contains a Boolean ok field equal to true.
checks:
- id: K1
  criterion: C1
  method: assertion
  source:
    input: report
    format: json
  assertion:
    path: result.ok
    equals: true
  required_evidence:
  - report
  mandatory: true
escalation:
  local_repairs: 0
---
# Verify a report

## Inspect the report

Read `{{arg1}}` as JSON. Inspect the current Boolean `ok` value rather than
inferring success from a previous report or from text elsewhere in the file.
Report the observed value and the input path. If it is missing or false, report
the blocker; do not edit evidence to make validation pass.
