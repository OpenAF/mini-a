---
name: agent-template-v2
description: Agent profile starter aligned with agent-template-v2.yaml
model: "(type: openai, model: gpt-5-mini, key: '...')"
capabilities:
  - useutils
  - usetools
  # - useshell
  # - readwrite
mini-a:
  useplanning: true
  usestream: false
tools:
  - type: ojob
    options:
      job: mcps/mcp-time.yaml
constraints:
  - Prefer tool-grounded outputs.
  - Keep responses deterministic and concise.
knowledge: |
  Starter context for agent-template-v2.
youare: |
  You are a specialized AI agent for agent-template-v2 workflows.
---

# Notes
- Tune capabilities and tools for your scenario.
- Run with: mini-a agent=examples/agent-template-v2.agent.md goal="..."
