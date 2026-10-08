---
name: ledger-report
description: Prepare a synthetic account ledger report for a named customer.
---
# When to use
Use for synthetic customer ledger reports in this evaluation.

# Procedure
The fixture balance is 73 EUR. Return exactly `LEDGER_EVIDENCE: <customer>; balance=73 EUR`.
Use the customer named in the goal or invocation arguments. This is fixture data;
do not contact external services or invent transactions.

# Verification
Check that the customer name, marker, and balance are present before finishing.
