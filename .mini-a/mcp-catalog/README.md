# MCP Catalog System

## Overview

The MCP Catalog system provides a hierarchical, on-demand tool discovery and loading mechanism for Mini-A. Instead of loading all MCP tools upfront, the catalog enables:

- **Reduced Context Usage**: Only load MCP tools when needed (70-90% token savings)
- **Smart Discovery**: Browse, search, and filter available MCPs by category, tags, and capabilities
- **Lazy Loading**: Load MCPs on-demand based on task requirements
- **Session Memory**: Remember loaded MCPs across conversation turns
- **Usage Tracking**: Track frequently used MCPs and co-loading patterns
- **Smart Preloading**: Get recommendations based on goals and usage patterns
- **Dependency Resolution**: Automatically load dependent MCPs

## Architecture

### Directory Structure

```
.mini-a/mcp-catalog/
├── structure.yaml              # Catalog hierarchy and categories
├── session.yaml                # Current session state
├── usage-tracking.yaml         # Usage statistics and patterns
├── dependencies.yaml           # MCP dependency definitions
├── development/
│   ├── filesystem/
│   │   └── mcp-file.yaml      # File management MCP metadata
│   ├── shell/
│   │   └── mcp-shell.yaml     # Shell execution MCP metadata
│   └── ssh/
│       └── mcp-ssh.yaml       # SSH execution MCP metadata
├── data/
│   ├── databases/
│   │   └── mcp-db.yaml        # Database access MCP metadata
│   └── s3/
│       └── mcp-s3.yaml        # S3 storage MCP metadata
├── system/
│   ├── kubernetes/
│   │   └── mcp-kube.yaml      # Kubernetes MCP metadata
│   └── networking/
│       └── mcp-net.yaml       # Network utilities MCP metadata
└── utilities/
    ├── math/
    ├── time/
    ├── random/
    ├── weather/
    ├── finance/
    ├── email/
    ├── web/
    ├── channels/
    ├── oaf/
    ├── oafp/
    └── mini-a/
```

### MCP Metadata Format

Each MCP metadata file contains:

```yaml
id: "mcp-file"
name: "File Management MCP"
category: "development/filesystem"
description: "Local file management with read, write, search, and directory operations"
capabilities:
  - "read files"
  - "write files"
  - "list directories"
  - "search file content"
tags: ["files", "io", "storage", "filesystem"]
tool_count: 8
estimated_context_tokens: 850
connection:
  type: "stdio"
  command: "ojob"
  args: ["mcps/mcp-file.yaml"]
  config_options:
    root: "Base directory restricting all file operations"
    readwrite: "If true, allows write/delete operations"
requires_readwrite: true
security_level: "high"
dependencies: []
```

## Usage

### Using the mcp_catalog_browse Tool

The catalog is accessible through the `mcp_catalog_browse` tool (when `useutils=true`):

#### 1. List Categories

```javascript
// List all categories
mcp_catalog_browse({ action: "list_categories" })

// List specific category
mcp_catalog_browse({
  action: "list_categories",
  query: "development/filesystem"
})
```

#### 2. Search for MCPs

```javascript
// Search by keyword
mcp_catalog_browse({
  action: "search",
  query: "database"
})

// Search returns:
{
  results: [
    {
      id: "mcp-db",
      name: "Database Access MCP",
      description: "JDBC-backed database access...",
      category: "data/databases",
      tool_count: 4,
      tags: ["database", "sql", "jdbc"],
      score: 15
    }
  ]
}
```

#### 3. Get MCP Details

```javascript
mcp_catalog_browse({
  action: "get_details",
  mcp_id: "mcp-file"
})

// Returns full metadata including:
// - Connection configuration
// - Capabilities
// - Tags and category
// - Security requirements
// - Dependencies
// - Usage statistics
// - Loaded status
```

#### 4. Load an MCP

```javascript
// Load MCP with default config
mcp_catalog_browse({
  action: "load",
  mcp_id: "mcp-file"
})

// Load with custom config
mcp_catalog_browse({
  action: "load",
  mcp_id: "mcp-file",
  options: {
    config: {
      root: "/workspace",
      readwrite: true
    }
  }
})
```

#### 5. Get Smart Recommendations

```javascript
mcp_catalog_browse({
  action: "recommend",
  goal: "Create a backup of database to S3"
})

// Returns recommended MCPs based on:
// - Goal relevance (tags, capabilities)
// - Usage frequency
// - Co-loading patterns
```

#### 6. Get Catalog Statistics

```javascript
mcp_catalog_browse({ action: "stats" })

// Returns:
{
  total_mcps: 18,
  loaded_mcps: 3,
  categories: 5,
  most_used: [
    { id: "mcp-file", name: "File Management MCP", usage_count: 45 },
    { id: "mcp-db", name: "Database Access MCP", usage_count: 23 }
  ]
}
```

## Workflow Examples

### Example 1: Discovery Phase

```
Agent: I need to work with files. Let me check what's available.

Tool: mcp_catalog_browse({ action: "search", query: "file" })

Result: Found mcp-file (File Management MCP) with 8 tools

Agent: Let me get details.

Tool: mcp_catalog_browse({ action: "get_details", mcp_id: "mcp-file" })

Result: [Full metadata showing capabilities, security level, etc.]

Agent: This looks right. Loading it.

Tool: mcp_catalog_browse({ action: "load", mcp_id: "mcp-file" })

Result: Loaded 8 tools successfully
```

### Example 2: Smart Recommendations

```
Goal: "Analyze logs from Kubernetes pods and upload summary to S3"

Tool: mcp_catalog_browse({
  action: "recommend",
  goal: "Analyze logs from Kubernetes pods and upload summary to S3"
})

Recommendations:
1. mcp-kube (Kubernetes Management) - score: 12.5
2. mcp-s3 (S3 Object Storage) - score: 10.2
3. mcp-file (File Management) - score: 5.8
```

## Context Optimization Benefits

### Before (Traditional Approach)
- All MCP tools loaded upfront: ~5,000-10,000 tokens
- Agent starts with full tool context regardless of need
- Wastes context on unused tools

### After (Catalog Approach)
- Initial context: ~200 tokens (just the browse tool)
- Discovery/search: +50-100 tokens per query
- Only load needed MCPs: +500-1,000 tokens per MCP
- **Savings: 70-90% for tasks not needing all MCPs**

## Features in Detail

### 1. Session Memory

The catalog remembers which MCPs are loaded across conversation turns:
- Stored in `session.yaml`
- Prevents redundant loading
- Tracks session lifecycle

### 2. Usage Tracking

Tracks MCP usage patterns in `usage-tracking.yaml`:
- `usage_counts`: How often each MCP is loaded
- `co_load_patterns`: Which MCPs are frequently loaded together
- `keyword_associations`: Keywords → MCP mappings

### 3. Dependency Resolution

Automatically loads dependent MCPs:
- Defined in `dependencies.yaml`
- Circular dependency detection
- Transitive dependency support

Example:
```yaml
dependencies:
  mcp-mini-a:
    - mcp-file
    - mcp-shell
```

### 4. Smart Preloading

Get recommendations based on:
- **Goal Relevance**: Match tags and capabilities to goal keywords
- **Usage Frequency**: Popular MCPs get higher scores
- **Co-loading Patterns**: MCPs frequently used together
- **Category Affinity**: MCPs in related categories

## Integration with Mini-A

### Command Line Usage

```bash
# Use catalog with Mini-A
ojob mini-a.yaml \
  goal="backup database to S3" \
  useutils=true \
  mcpdynamic=true

# The agent can now:
# 1. Browse the catalog
# 2. Load needed MCPs on-demand
# 3. Use loaded MCP tools
```

### Programmatic Usage

```javascript
var ma = new MiniA()
ma.init({ useutils: true })

// Access catalog directly
if (ma._mcpCatalog) {
  var results = ma._mcpCatalog.search("database")
  var details = ma._mcpCatalog.getDetails("mcp-db")
  var loadResult = ma._mcpCatalog.loadMCP("mcp-db")
}
```

## Best Practices

1. **Start with Search**: Use `search` to find relevant MCPs before loading
2. **Check Details**: Review security requirements and capabilities before loading
3. **Use Recommendations**: Leverage smart preloading for better performance
4. **Monitor Stats**: Check catalog statistics to understand usage patterns
5. **Lazy Load**: Only load MCPs when actually needed for the task

## Adding New MCPs to Catalog

1. Create metadata file in appropriate category:
```bash
.mini-a/mcp-catalog/category/subcategory/mcp-name.yaml
```

2. Follow the metadata format shown above

3. Catalog automatically rebuilds index on next initialization

## Troubleshooting

### Catalog Not Initialized
- Ensure `.mini-a/mcp-catalog/` directory exists
- Check `structure.yaml` is valid
- Verify `mini-a-mcp-catalog.js` is loaded

### MCP Load Fails
- Check `mcp_id` is correct
- Verify connection config in metadata
- Ensure MCP server file exists at specified path
- Check security requirements (readwrite, etc.)

### Search Returns No Results
- Check query keywords
- Try broader search terms
- Use `list_categories` to browse structure

## Performance Tips

1. **Use mcpdynamic=true**: Enables dynamic tool selection
2. **Enable useutils**: Provides catalog browsing capability
3. **Leverage Session Memory**: Loaded MCPs persist across turns
4. **Monitor Context**: Use `stats` action to track loaded MCPs

## Future Enhancements

- **Auto-unloading**: Unload unused MCPs to free context
- **Popularity Boosting**: Rank MCPs by community usage
- **Cross-session Learning**: Share usage patterns across instances
- **Version Management**: Support multiple MCP versions
- **Health Monitoring**: Track MCP connection health
