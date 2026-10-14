---
name: mini-a-skill-authoring
description: Create or repair Mini-A local Markdown, self-contained YAML/JSON, or virtual wiki skills with working metadata and references.
---
# Author a Mini-A skill

Use when creating or repairing Mini-A skills. Requires access to the destination and its applicable read/write tools. Establish the intended trigger, format, inputs, desired output, and observable acceptance checks before writing. Preserve existing user instructions and unrelated files.

1. Inspect an existing nearby skill and the effective discovery roots or skill-wiki configuration. Choose the requested format; local files and virtual wiki pages have different metadata contracts.
2. Give the skill a precise name and compact discovery description. Put essential decisions, prerequisites, steps, failure handling, and completion evidence in the body. Move substantial conditional details into supporting references shipped with the skill.
3. Apply the format rules in @references/formats.md. Keep argument placeholders and reference paths literal. A reference must resolve within the selected local folder or the virtual provider's supported namespace; a link to an online manual alone does not supply offline instructions.
4. Validate through the same discovery and renderer used by the target runtime. Inspect rendered output with representative arguments, confirm references resolve, and test disabled/missing/denied resources without bypassing access restrictions. Check name collisions and source-qualified invocation.
5. Run a representative task and inspect actual calls or produced artifacts against acceptance checks. Distinguish deterministic rendering checks from model instruction adherence. If no model run is available, report that boundary explicitly.

Completion: report the skill's destination, format, trigger, invocation, rendering/reference checks, and any execution checks performed. Loading successfully does not prove the model followed the procedure.
