# MCP Catalog Usage Examples

## Interactive Catalog Browsing Session

This example shows a complete workflow of discovering, loading, and using MCPs through the catalog.

### Scenario: Working with Files and Databases

```javascript
// Agent receives goal: "Read config.json and update database with settings"

// Step 1: Agent doesn't know what tools are available
// It starts by searching the catalog

ACTION: mcp_catalog_browse({
  action: "search",
  query: "file"
})

RESULT: {
  results: [
    {
      id: "mcp-file",
      name: "File Management MCP",
      category: "development/filesystem",
      tool_count: 8,
      score: 15
    }
  ]
}

// Step 2: Get details about the file MCP

ACTION: mcp_catalog_browse({
  action: "get_details",
  mcp_id: "mcp-file"
})

RESULT: {
  id: "mcp-file",
  name: "File Management MCP",
  capabilities: ["read files", "write files", "list directories"],
  tool_count: 8,
  security_level: "high",
  requires_readwrite: true,
  loaded: false
}

// Step 3: Load the file MCP

ACTION: mcp_catalog_browse({
  action: "load",
  mcp_id: "mcp-file",
  options: {
    config: {
      root: ".",
      readwrite: false  // Read-only for safety
    }
  }
})

RESULT: {
  loaded: true,
  mcp_id: "mcp-file",
  tool_count: 8
}

// Step 4: Now search for database tools

ACTION: mcp_catalog_browse({
  action: "search",
  query: "database"
})

RESULT: {
  results: [
    {
      id: "mcp-db",
      name: "Database Access MCP",
      category: "data/databases",
      tool_count: 4,
      score: 18
    }
  ]
}

// Step 5: Load the database MCP

ACTION: mcp_catalog_browse({
  action: "load",
  mcp_id: "mcp-db",
  options: {
    config: {
      jdbc: "jdbc:postgresql://localhost:5432/mydb",
      user: "dbuser",
      rw: true
    }
  }
})

RESULT: {
  loaded: true,
  mcp_id: "mcp-db",
  tool_count: 4
}

// Step 6: Now the agent can use the loaded tools
// Available: read-file, list-directory, etc. (from mcp-file)
//           do-sql-query, do-sql-update, etc. (from mcp-db)

ACTION: read-file({ path: "config.json" })
RESULT: { content: "{\"setting1\": \"value1\"}" }

ACTION: do-sql-update({
  query: "UPDATE settings SET value = ? WHERE key = ?",
  params: ["value1", "setting1"]
})
RESULT: { rows_affected: 1 }
```

## Category Browsing Example

```javascript
// Explore the catalog structure

// List all top-level categories
ACTION: mcp_catalog_browse({
  action: "list_categories"
})

RESULT: {
  categories: [
    { name: "development", description: "Development and coding tools" },
    { name: "data", description: "Data processing and analysis" },
    { name: "system", description: "System utilities and monitoring" },
    { name: "utilities", description: "General purpose utilities" }
  ],
  total_mcps: 18
}

// Drill down into development category
ACTION: mcp_catalog_browse({
  action: "list_categories",
  query: "development"
})

RESULT: {
  category: {
    name: "development",
    description: "Development and coding tools",
    subcategories: ["filesystem", "shell", "ssh", "git", "docker"]
  },
  mcps: [
    { id: "mcp-file", name: "File Management MCP", tool_count: 8 },
    { id: "mcp-shell", name: "Shell Execution MCP", tool_count: 2 },
    { id: "mcp-ssh", name: "SSH Execution MCP", tool_count: 3 }
  ]
}

// Explore filesystem subcategory
ACTION: mcp_catalog_browse({
  action: "list_categories",
  query: "development/filesystem"
})

RESULT: {
  mcps: [
    {
      id: "mcp-file",
      name: "File Management MCP",
      description: "Local file management with read, write, search...",
      tool_count: 8,
      tags: ["files", "io", "storage", "filesystem"]
    }
  ]
}
```

## Smart Recommendations Example

```javascript
// Get recommendations based on a goal

ACTION: mcp_catalog_browse({
  action: "recommend",
  goal: "Deploy application to Kubernetes cluster and monitor logs"
})

RESULT: {
  recommendations: [
    {
      id: "mcp-kube",
      name: "Kubernetes Management MCP",
      score: 18.5,
      reason: "Relevant to goal and usage patterns"
    },
    {
      id: "mcp-file",
      name: "File Management MCP",
      score: 8.2,
      reason: "Relevant to goal and usage patterns"
    },
    {
      id: "mcp-shell",
      name: "Shell Execution MCP",
      score: 6.5,
      reason: "Relevant to goal and usage patterns"
    }
  ]
}

// Load recommended MCPs
ACTION: mcp_catalog_browse({
  action: "load",
  mcp_id: "mcp-kube",
  options: {
    config: {
      kubeconfig: "~/.kube/config",
      namespace: "production"
    }
  }
})
```

## Statistics and Monitoring Example

```javascript
// Check catalog stats

ACTION: mcp_catalog_browse({
  action: "stats"
})

RESULT: {
  total_mcps: 18,
  loaded_mcps: 3,
  categories: 5,
  most_used: [
    { id: "mcp-file", name: "File Management MCP", usage_count: 45 },
    { id: "mcp-db", name: "Database Access MCP", usage_count: 23 },
    { id: "mcp-shell", name: "Shell Execution MCP", usage_count: 18 },
    { id: "mcp-s3", name: "S3 Object Storage MCP", usage_count: 12 },
    { id: "mcp-kube", name: "Kubernetes Management MCP", usage_count: 8 }
  ]
}
```

## Complex Multi-MCP Workflow

```javascript
// Scenario: "Fetch data from API, process it, store in database, and upload report to S3"

// Step 1: Get recommendations for this complex task
ACTION: mcp_catalog_browse({
  action: "recommend",
  goal: "Fetch data from API, process it, store in database, and upload report to S3"
})

RESULT: {
  recommendations: [
    { id: "mcp-web", name: "Web Operations MCP", score: 15.0 },
    { id: "mcp-db", name: "Database Access MCP", score: 12.5 },
    { id: "mcp-s3", name: "S3 Object Storage MCP", score: 11.8 },
    { id: "mcp-file", name: "File Management MCP", score: 8.5 },
    { id: "mcp-oafp", name: "OpenAF Processor MCP", score: 7.2 }
  ]
}

// Step 2: Load all recommended MCPs

// Load web MCP for API calls
mcp_catalog_browse({ action: "load", mcp_id: "mcp-web" })

// Load database MCP
mcp_catalog_browse({
  action: "load",
  mcp_id: "mcp-db",
  options: {
    config: {
      jdbc: "jdbc:postgresql://localhost:5432/analytics",
      rw: true
    }
  }
})

// Load S3 MCP
mcp_catalog_browse({
  action: "load",
  mcp_id: "mcp-s3",
  options: {
    config: {
      accessKey: "...",
      secretKey: "...",
      region: "us-east-1"
    }
  }
})

// Load file MCP for local processing
mcp_catalog_browse({
  action: "load",
  mcp_id: "mcp-file",
  options: { config: { readwrite: true } }
})

// Step 3: Execute the workflow using loaded tools
// 1. Fetch data: web-fetch
// 2. Process: oafp-transform (if loaded) or local processing
// 3. Store: do-sql-update
// 4. Upload: s3-upload-file
```

## Tag-based Discovery

```javascript
// Search by multiple concepts

// Search for time-related MCPs
ACTION: mcp_catalog_browse({
  action: "search",
  query: "time date timezone"
})

RESULT: {
  results: [
    {
      id: "mcp-time",
      name: "Time and Timezone MCP",
      tags: ["time", "date", "timezone", "formatting"],
      score: 18
    }
  ]
}

// Search for random data generation
ACTION: mcp_catalog_browse({
  action: "search",
  query: "random generate uuid"
})

RESULT: {
  results: [
    {
      id: "mcp-random",
      name: "Random Data Generation MCP",
      tags: ["random", "generation", "uuid", "mock"],
      score: 20
    }
  ]
}
```

## Incremental Loading Pattern

```javascript
// Start with minimal context, load as needed

// Initial state: No MCPs loaded
// Goal: "Analyze server logs and create visualization"

// Step 1: Agent starts, realizes it needs file access
mcp_catalog_browse({ action: "search", query: "file read" })
mcp_catalog_browse({ action: "load", mcp_id: "mcp-file" })

// Step 2: Agent reads log files, realizes it needs data processing
mcp_catalog_browse({ action: "search", query: "data process transform" })
mcp_catalog_browse({ action: "load", mcp_id: "mcp-oafp" })

// Step 3: Agent processes data, realizes it needs charting
mcp_catalog_browse({ action: "search", query: "visualization chart" })
// No specific MCP found, agent uses built-in knowledge

// Final state: Only loaded 2 MCPs instead of all 18
// Context savings: ~85%
```

## Error Handling Examples

```javascript
// Attempting to load non-existent MCP
ACTION: mcp_catalog_browse({
  action: "load",
  mcp_id: "mcp-does-not-exist"
})

RESULT: {
  error: "MCP not found: mcp-does-not-exist"
}

// Missing required parameter
ACTION: mcp_catalog_browse({
  action: "search"
  // Missing query parameter
})

RESULT: {
  error: "Search query required"
}

// Catalog not initialized (shouldn't happen in normal operation)
ACTION: mcp_catalog_browse({
  action: "stats"
})

RESULT: {
  error: "MCP Catalog not initialized"
}
```

## Performance Comparison

### Traditional Approach (Load All MCPs)

```
Initial Context: 8,500 tokens (all 18 MCPs)
Task: "Read a file"
Tools Used: 1 (read-file)
Wasted Context: 8,000+ tokens (17 unused MCPs)
```

### Catalog Approach (On-Demand Loading)

```
Initial Context: 200 tokens (catalog browse tool only)

Discovery: +80 tokens
  mcp_catalog_browse({ action: "search", query: "file" })

Loading: +850 tokens
  mcp_catalog_browse({ action: "load", mcp_id: "mcp-file" })

Total Context: 1,130 tokens
Savings: 87% (7,370 tokens saved)
```

### Multi-MCP Task

```
Traditional: 8,500 tokens (all MCPs)
Catalog (load 3 MCPs): 200 + 80 + (850 × 3) = 2,830 tokens
Savings: 67% (5,670 tokens saved)
```

## Integration with mcpdynamic

```javascript
// When using mcpdynamic=true, catalog enables even smarter selection

// Command line:
ojob mini-a.yaml \
  goal="backup database to S3" \
  useutils=true \
  mcpdynamic=true

// Mini-A behavior:
// 1. Analyzes goal: "backup database to S3"
// 2. Uses catalog to find relevant MCPs
// 3. Gets recommendations: mcp-db, mcp-s3
// 4. Loads only those 2 MCPs dynamically
// 5. Executes with minimal context overhead
```
