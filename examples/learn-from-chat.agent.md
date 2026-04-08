---
name: learn-from-chat
description: Agent profile starter aligned with learn-from-chat.yaml
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
  Starter context for learn-from-chat.
youare: |
  You are a specialized AI agent for learn-from-chat workflows.
---

# Notes
- Tune capabilities and tools for your scenario.
- Run with: mini-a agent=examples/learn-from-chat.agent.md goal="..."
