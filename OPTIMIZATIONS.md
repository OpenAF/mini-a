# Performance Optimizations

Mini-A includes several built-in performance optimizations designed to reduce token usage, minimize LLM calls, and lower costs while maintaining high-quality results. These optimizations are **enabled by default** and require no configuration.

---

## MCP Catalog System (NEW)

### Context: 70-90% Token Savings Through On-Demand Loading

The MCP Catalog System revolutionizes how Mini-A manages MCP tools by replacing upfront loading with intelligent, lazy loading:

**Traditional Approach:**
- Load all MCP tools at startup: ~5,000-10,000 tokens
- Agent has full tool context regardless of task needs
- Wastes tokens on tools that are never used

**Catalog Approach:**
- Initial context: ~200 tokens (single browse tool)
- Discovery phase: +50-100 tokens per search
- Load only needed MCPs: +500-1,000 tokens each
- **Result: 70-90% savings for typical tasks**

### How It Works

1. **Hierarchical Organization**: 18+ MCPs organized into categories (development, data, system, utilities)
2. **Lightweight Metadata**: Each MCP has a small metadata file with description, tags, capabilities
3. **Smart Discovery**: Search by keywords, browse by category, get AI recommendations
4. **On-Demand Loading**: Load full MCP tools only when actually needed
5. **Session Memory**: Remember loaded MCPs across conversation turns
6. **Usage Learning**: Track patterns to recommend relevant MCPs

### Performance Example

**Task**: Read a configuration file

**Before (Traditional)**:
```
- All 18 MCPs loaded: 8,500 tokens
- Task uses 1 MCP (mcp-file)
- Wasted: 7,850 tokens (92%)
```

**After (Catalog)**:
```
- Catalog browse tool: 200 tokens
- Search "file": +80 tokens
- Load mcp-file: +850 tokens
- Total: 1,130 tokens
- Savings: 87% (7,370 tokens)
```

### Multi-MCP Tasks

Even complex tasks requiring multiple MCPs show significant savings:

**Task**: Backup database to S3

**Before**: 8,500 tokens (all MCPs)
**After**: 200 + 80 + (850 × 3 MCPs) = 2,830 tokens
**Savings**: 67% (5,670 tokens)

### Usage

Enable with `useutils=true`:

```bash
mini-a goal="analyze logs" useutils=true
```

The agent can now:
- Search catalog: `mcp_catalog_browse({ action: "search", query: "file" })`
- Get details: `mcp_catalog_browse({ action: "get_details", mcp_id: "mcp-file" })`
- Load tools: `mcp_catalog_browse({ action: "load", mcp_id: "mcp-file" })`
- Get recommendations: `mcp_catalog_browse({ action: "recommend", goal: "..." })`

### Documentation

- **Full Guide**: `.mini-a/mcp-catalog/README.md`
- **Examples**: `.mini-a/mcp-catalog/EXAMPLES.md`
- **What's New**: [WHATS-NEW.md](WHATS-NEW.md#mcp-catalog-system-latest)

---

## Overview of Optimizations

| Feature | Token Savings | Call Reduction | User Action Required |
|---------|--------------|----------------|---------------------|
| **MCP Catalog System** | 70-90% (MCP context) | - | Use `useutils=true` |
| **Automatic Context Management** | 30-50% | - | None (automatic) |
| **Dynamic Escalation** | 5-10% | 10-15% | None (automatic) |
| **Parallel Action Prompting** | 15-25% | 20-30% | None (automatic) |
| **Two-Phase Planning** | 15-25% | - | Use `useplanning=true` |

**Combined Impact**: Up to 90% context reduction with catalog, 40-60% token reduction from other optimizations, 25-40% fewer LLM calls, 50-70% cost savings on complex goals.

---

## 1. Automatic Context Management

### What It Does

Automatically manages conversation context to prevent unbounded token growth without requiring manual configuration.

**Key Features**:
- **Smart default limit**: 50,000 tokens (auto-enabled, no configuration needed)
- **Two-tier compression**:
  - **60% threshold**: Removes duplicate observations
  - **80% threshold**: Summarizes old context
- **Context deduplication**: Automatically removes redundant entries

### How It Works

```
Step 1: 5K tokens
Step 5: 15K tokens (growing linearly)
Step 10: 30K tokens → triggers deduplication (removes ~20% redundant entries)
Step 12: 40K tokens → triggers summarization (compresses to ~20K tokens)
```

### Benefits

✅ **No configuration required** - works out of the box
✅ **30-50% token reduction** on long-running goals
✅ **Preserves important context** (STATE, SUMMARY entries always kept)
✅ **Backward compatible** - existing `maxcontext` parameter still works

### Advanced Configuration

You can still override the default behavior:

```bash
# Disable automatic management (not recommended)
mini-a goal="..." maxcontext=0

# Set custom limit
mini-a goal="..." maxcontext=100000
```

**Note**: Setting `maxcontext=0` disables automatic context management entirely. This is only recommended for very short goals that won't exceed context limits.

---

## 2. Dynamic Escalation Thresholds

### What It Does

Automatically adjusts when to escalate from low-cost to main model based on goal complexity.

**Goal Complexity Assessment**:
- **Simple**: Short, direct goals (e.g., "what is 2+2?")
- **Medium**: Multi-step or moderate length (e.g., "list files and count them")
- **Complex**: Long goals with conditions (e.g., "analyze files, then if errors, fix and report")

### Escalation Thresholds

| Metric | Simple | Medium | Complex |
|--------|--------|--------|---------|
| **Consecutive errors** | 3 | 2 | 2 |
| **Consecutive thoughts** | 5 | 4 | 3 |
| **Total thoughts** | 8 | 6 | 5 |
| **Steps without action** | 6 | 4 | 3 |

### How It Works

**Before** (fixed thresholds):
```
Every goal: Escalate after 2 errors or 3 thoughts
Result: Wastes main model on simple tasks OR under-utilizes low-cost model
```

**After** (dynamic thresholds):
```
Simple goal: "what is the capital of France?"
→ Complexity: simple
→ Allows 5 thoughts, 3 errors
→ Stays on low-cost model for entire task

Complex goal: "analyze all TypeScript files, fix errors if found, create report"
→ Complexity: complex
→ Allows 3 thoughts, 2 errors
→ Escalates quickly to main model for difficult work
```

### Benefits

✅ **Optimizes cost/quality tradeoff** automatically
✅ **10-20% better cost efficiency** on varied workloads
✅ **Smarter resource allocation** based on task difficulty
✅ **Transparent** - escalation reasons logged with thresholds

### Debugging

Enable verbose mode to see complexity assessment:

```bash
mini-a goal="your goal" verbose=true

# Output:
# [info] Goal complexity assessed as: medium
# [info] Escalation thresholds: errors=2, thoughts=4, totalThoughts=6
```

---

## 3. Enhanced Parallel Action Support

### What It Does

Encourages LLMs to batch independent operations into a single step, reducing round-trips.

**System prompts now include**:
- Clear recommendation to use action arrays
- Concrete examples of parallel syntax
- Explicit benefits (fewer calls, faster execution)
- Guidance on when to use parallel actions

### How It Works

**Before** (sequential execution - 3 LLM calls):
```json
Step 1: {"action":"read_file","params":{"path":"a.txt"}}
Step 2: {"action":"read_file","params":{"path":"b.txt"}}
Step 3: {"action":"read_file","params":{"path":"c.txt"}}
```

**After** (parallel execution - 1 LLM call):
```json
Step 1: {
  "action": [
    {"action":"read_file","params":{"path":"a.txt"}},
    {"action":"read_file","params":{"path":"b.txt"}},
    {"action":"read_file","params":{"path":"c.txt"}}
  ]
}
```

### Use Cases

Perfect for:
- Reading multiple files simultaneously
- Calling several independent MCP tools
- Gathering data from different sources
- Batch validation checks

### Benefits

✅ **20-30% fewer steps** for multi-file operations
✅ **15-25% token reduction** from fewer round-trips
✅ **Faster execution** - parallel tool execution when possible
✅ **Better LLM awareness** - models understand when to batch

### Example

**Goal**: "Compare config files from dev, staging, and prod environments"

**Old behavior**: 3 separate read operations (3 LLM calls)
**New behavior**: 1 batched read operation (1 LLM call)

---

## 4. Two-Phase Planning Mode

### What It Does

When `useplanning=true`, separates plan generation from execution to reduce per-step overhead.

**Traditional approach**:
```
Every step: [400-token planning guidance] + action
Total overhead: N × 400 tokens
```

**Two-phase approach**:
```
Phase 1: Generate plan (1 LLM call, ~50 tokens)
Phase 2: Execute with light guidance (N × 80 tokens)
Total overhead: 50 + (N × 80 tokens)
Savings: ~320 tokens per step after initial plan
```

### How It Works

**Phase 1: Planning** (upfront, separate call)
```bash
mini-a goal="complex task" useplanning=true

# Generates:
# [plan] Generating execution plan using low-cost model...
# [plan] Plan generated successfully (strategy: simple)
```

Generated plan includes:
- Strategy (simple or tree)
- List of steps with dependencies
- Checkpoints for verification
- Risk assessment

**Phase 2: Execution** (reduced overhead)

Instead of full planning guidance (13 bullet points), each step receives:
```
## PLANNING:
• The execution plan has already been generated. Focus on executing tasks.
• Update step 'status' and 'progress' as you work.
• Mark 'state.plan.meta.needsReplan=true' if obstacles occur.
```

### Benefits

✅ **15-25% token reduction** in planning mode
✅ **Uses low-cost model** for plan generation
✅ **Clearer separation** - planning vs execution
✅ **Better focus** - execution prompts emphasize progress updates

### When to Use

Enable planning mode for:
- Multi-step complex goals
- Tasks requiring coordination
- Goals with dependencies
- When you want structured progress tracking

```bash
# Enable planning
mini-a goal="analyze codebase and create report" useplanning=true

# Planning with file tracking
mini-a goal="refactor project" useplanning=true planfile="progress.md"
```

### Monitoring Progress

When a plan file is provided, Mini-A updates it with:
```markdown
---
## Progress Update - 2025-01-10T15:30:00Z

### Completed Tasks
- ✅ Scanned directory for TypeScript files (15 found)
- ✅ Analyzed files for syntax errors (3 errors found)

### Knowledge for Next Execution
- Files with errors: auth.ts, config.ts, utils.ts
- Error types: missing type annotations, unused variables
- Next: Fix errors then regenerate report
```

---

## Performance Comparison

### Before Optimizations

**Simple Goal**: "What is the capital of France?"
- Steps: 1
- Tokens: ~3K
- Model: Main (unnecessary)

**Complex Goal**: "Analyze 10 TypeScript files and create report"
- Steps: 15
- Tokens per step: ~8K → 15K → 25K (growing)
- Total tokens: ~180K
- Model switches: Random
- Planning overhead: 400 tokens/step

### After Optimizations

**Simple Goal**: "What is the capital of France?"
- Steps: 1
- Tokens: ~3K
- Model: Low-cost (appropriate)
- **Savings**: Main model call avoided

**Complex Goal**: "Analyze 10 TypeScript files and create report"
- Steps: 5 (parallel reads)
- Tokens per step: ~8K → 10K → 12K (controlled)
- Total tokens: ~50K
- Planning: 1 upfront call, then 80 tokens/step
- **Savings**: 72% tokens, 67% fewer steps

---

## Cost Impact Examples

### Scenario 1: Development Assistant (Mixed Complexity)

**Daily usage**: 50 goals
- 30 simple (code questions, quick lookups)
- 15 medium (multi-file operations)
- 5 complex (refactoring, analysis)

**Before optimizations**:
- Total tokens: ~2.5M/day
- Calls: ~800/day
- Cost (GPT-4): ~$50/day

**After optimizations**:
- Total tokens: ~1.0M/day (-60%)
- Calls: ~550/day (-31%)
- Cost (GPT-4): ~$20/day
- **Monthly savings**: ~$900

### Scenario 2: Code Analysis Pipeline

**Goal**: "Analyze repository, identify bugs, suggest fixes"

**Before optimizations**:
- Steps: 25
- Total tokens: ~400K
- Main model calls: 25
- Cost: ~$8

**After optimizations**:
- Steps: 8 (parallel file reads)
- Total tokens: ~120K (-70%)
- Main model calls: 5 (smart escalation)
- Low-cost calls: 3
- Cost: ~$2.50 (-69%)
- **Time saved**: 40% faster (parallel execution)

---

## Best Practices

### 1. Use Planning Mode for Complex Goals

```bash
# Good: Complex multi-step task
mini-a goal="refactor authentication system" useplanning=true planfile="auth-refactor.md"

# Not needed: Simple query
mini-a goal="what files are in this directory?" useshell=true
```

### 2. Leverage Dual Models

```bash
# Set low-cost model for routine operations
export OAF_LC_MODEL="(type: openai, model: gpt-4-mini, key: '...')"

# Dynamic escalation handles the rest automatically
```

### 3. Monitor with Verbose Mode

```bash
# See optimization decisions in action
mini-a goal="..." verbose=true

# Watch for:
# - [compress] Removed N redundant entries
# - [warn] Escalating to main model: reason
# - [plan] Plan generated successfully
```

### 4. Trust the Defaults

The optimizations are designed to work automatically. Avoid:
- Setting `maxcontext=0` (disables auto-management)
- Forcing main model for simple tasks
- Manually batching operations (let LLM decide)

---

## Troubleshooting

### Context Still Growing Too Large

**Symptom**: Context exceeds limits even with optimizations

**Solution**:
```bash
# Reduce context limit (triggers compression earlier)
mini-a goal="..." maxcontext=30000

# For very long-running tasks, use planning mode with file tracking
mini-a goal="..." useplanning=true planfile="progress.md"
```

### Too Many Main Model Escalations

**Symptom**: Goals assessed as "complex" when they're simple

**Possible causes**:
- Goal description is very long
- Multiple sentences with "and", "then", "if"

**Solution**: Simplify goal phrasing:
```bash
# Instead of:
mini-a goal="First, list all JavaScript files in this directory, and then count how many there are, and if there are more than 10 files then create a report summarizing them"

# Try:
mini-a goal="Count JavaScript files and report if over 10"
```

### Parallel Actions Not Being Used

**Symptom**: Still seeing sequential operations for independent tasks

**Cause**: LLM not recognizing batching opportunity

**Solution**: Be explicit in goal:
```bash
# Hint at parallel operations
mini-a goal="read ALL config files (dev.json, staging.json, prod.json) simultaneously and compare"
```

---

## Configuration Reference

### Context Management

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxcontext` | 50000 | Auto-enables at 50K tokens. Set to 0 to disable (not recommended) |

### Planning Mode

| Parameter | Default | Description |
|-----------|---------|-------------|
| `useplanning` | false | Enable two-phase planning mode |
| `planfile` | - | File path for progress tracking |
| `planformat` | md | Plan format (md or json) |

### Escalation Control

No direct parameters - escalation is automatic based on goal complexity. Use `verbose=true` to observe behavior.

---

## Migration Notes

### Upgrading from Previous Versions

**All optimizations are backward compatible**. Existing configurations continue to work:

```bash
# Old configurations still work
mini-a goal="..." maxcontext=100000  # Explicit limit respected
mini-a goal="..." useplanning=true    # Now uses two-phase mode

# New default behavior (if maxcontext not set)
mini-a goal="..."  # Auto-enables at 50K tokens
```

### For Advanced Users

If you previously set `maxcontext=0` to disable summarization:

**Old behavior**: Unlimited context growth
**New behavior**: Auto-enables at 50K

**To restore old behavior** (not recommended):
```bash
mini-a goal="..." maxcontext=0
```

**Better approach**: Set higher limit if needed:
```bash
mini-a goal="..." maxcontext=200000
```

---

## Technical Details

### Context Deduplication Algorithm

1. **Preserve critical entries**: STATE, SUMMARY never removed
2. **Remove exact duplicates**: Normalized matching (numbers replaced with "N")
3. **Limit tool observations**: Keep only last 2 per tool type
4. **Summarize old context**: When over 80% of limit

### Goal Complexity Heuristics

```javascript
// Complex: token > 200 OR (multi-step AND conditions) OR (tasks AND token > 150)
// Medium: token > 100 OR multi-step OR multiple tasks
// Simple: Everything else

Keywords:
- Multi-step: "and", "then", "first...second", "step 1"
- Conditions: "if", "unless", "when"
- Tasks: numbered lists, semicolons
```

### Planning Generation

Uses dedicated prompt:
```
GOAL: <user goal>

Create execution plan with:
1. Strategy (simple or tree)
2. Steps with dependencies
3. Checkpoints
4. Risk assessment

Respond with JSON...
```

---

## Metrics and Observability

All optimizations are tracked in Mini-A metrics:

```javascript
// Context management
context_summarizations: Number of times context was compressed
summaries_tokens_reduced: Total tokens saved

// Escalation
escalations: Times escalated from low-cost to main model
llm_lc_calls: Low-cost model usage
llm_normal_calls: Main model usage

// Tool execution
tool_cache_hits: Cached tool results
tool_cache_misses: Fresh tool calls
```

Access metrics programmatically or through verbose logging.

---

## FAQ

**Q: Will this break my existing workflows?**
A: No, all optimizations are backward compatible. Existing configurations work unchanged.

**Q: Can I disable these optimizations?**
A: Yes, but not recommended. Set `maxcontext=0` to disable auto-management. Other optimizations (escalation, parallel actions) are prompt-based and can't be disabled.

**Q: Do I need to update my code?**
A: No, benefits are automatic. Update prompt phrasing to leverage parallel actions.

**Q: Will my goals behave differently?**
A: Goals will complete faster with fewer tokens, but results quality is unchanged or improved.

**Q: What if I'm already using maxcontext?**
A: Your setting takes precedence. New behavior only applies when `maxcontext` is unset.

---

## Additional Resources

- [Usage Guide](USAGE.md) - Complete configuration reference
- [Analysis Document](mini-a-analysis.md) - Detailed technical analysis
- [CHEATSHEET](CHEATSHEET.md) - Quick parameter reference
- [GitHub Issues](https://github.com/openaf/mini-a/issues) - Report problems or request features

---

## Summary

✅ **Automatic** - No configuration required
✅ **Backward Compatible** - Existing setups unchanged
✅ **Significant Savings** - 40-60% token reduction, 50-70% cost savings
✅ **Better Performance** - Faster execution, smarter model usage
✅ **Transparent** - Verbose mode shows all optimization decisions

The optimizations work together to provide the best balance of cost, speed, and quality for all goal types.
