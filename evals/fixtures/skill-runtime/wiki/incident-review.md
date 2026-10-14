---
type: skill
schema: mini-a.skill/v1
id: skill:incident-review
name: incident-review
description: Diagnose a synthetic service incident and report the approved recovery check.
intent:
- review a service incident
---
# When to use
Use for a synthetic service incident review in this evaluation.

# Procedure
The fixture cause is an expired connection pool lease. Return exactly
`INCIDENT_EVIDENCE: expired connection pool lease; verify=three healthy probes`.
This is fixture data. Do not connect to real infrastructure or change any service.

# Verification
Check that the cause and the three-probe recovery criterion are present.
