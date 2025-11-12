// Author: Nuno Aguiar
// MCP Catalog System for Mini-A
// Provides catalog-based tool registry with lazy loading, session memory, and smart preloading

/**
 * MCPCatalog - Manages the MCP catalog with discovery, loading, and tracking
 * @param {object} parent - Parent MiniA instance
 */
var MCPCatalog = function(parent) {
  this.parent = parent
  this.index = {}
  this.structure = {}
  this.session = {}
  this.usage = {}
  this.dependencies = {}
  this.loadedMCPs = new Set()
  this.initialized = false

  // Initialize catalog
  this._init()

  // Throw if initialization failed
  if (!this.initialized) {
    throw "MCP Catalog initialization failed"
  }
}

/**
 * Initialize the catalog by loading from YAML file
 */
MCPCatalog.prototype._init = function() {
  try {
    // Load catalog from single YAML file
    var catalogPath = getOPackPath("mini-a") + "/.mini-a/mcp-catalog.yaml"

    if (!io.fileExists(catalogPath)) {
      throw "Catalog file not found: " + catalogPath
    }

    var catalog = io.readFileYAML(catalogPath)

    // Load structure
    this.structure = catalog.structure || { categories: [] }

    // Initialize session data (in-memory)
    this.session = {
      session_id: null,
      started_at: null,
      loaded_mcps: [],
      last_updated: null
    }

    // Initialize usage tracking (in-memory)
    this.usage = {
      usage_counts: {},
      co_load_patterns: {},
      keyword_associations: {},
      last_updated: null
    }

    // Initialize dependencies (in-memory)
    this.dependencies = {
      dependencies: {},
      circular_check_enabled: true
    }

    // Build searchable index from metadata
    this._buildIndex(catalog.mcps || [])

    // Mark as successfully initialized
    this.initialized = true

  } catch(e) {
    this.initialized = false
    if (isDef(this.parent) && isDef(this.parent.fnI)) {
      this.parent.fnI("warn", "Failed to initialize MCP catalog: " + (e.message || e))
    }
    throw e
  }
}

/**
 * Build searchable index from MCP metadata array
 * @param {array} mcps - Array of MCP metadata objects
 */
MCPCatalog.prototype._buildIndex = function(mcps) {
  // Build index from metadata array
  for (var i = 0; i < mcps.length; i++) {
    var mcp = mcps[i]
    if (isDef(mcp.id)) {
      this.index[mcp.id] = mcp
    }
  }
}

/**
 * List categories or specific category details
 * @param {string} path - Optional category path (e.g., "development/filesystem")
 * @returns {object} Category structure or specific category details
 */
MCPCatalog.prototype.listCategories = function(path) {
  if (isUnDef(path) || path === "" || path === "/") {
    // Return all categories
    return {
      categories: this.structure.categories || [],
      total_mcps: Object.keys(this.index).length
    }
  }

  // Parse path and find specific category
  var parts = path.split("/")
  var category = null
  var subcategory = null

  if (isArray(this.structure.categories)) {
    category = this.structure.categories.filter(function(cat) {
      return cat.name === parts[0]
    })[0]

    if (isDef(category) && parts.length > 1 && isArray(category.subcategories)) {
      subcategory = category.subcategories.filter(function(subcat) {
        return (isString(subcat) && subcat === parts[1]) ||
               (isMap(subcat) && subcat.name === parts[1])
      })[0]
    }
  }

  // Find MCPs in this category
  var mcpsInCategory = Object.keys(this.index).filter(function(mcpId) {
    var mcp = this.index[mcpId]
    if (isUnDef(mcp.category)) return false
    return mcp.category.startsWith(path)
  }.bind(this))

  return {
    category: category,
    subcategory: subcategory,
    mcps: mcpsInCategory.map(function(mcpId) {
      var mcp = this.index[mcpId]
      return {
        id: mcp.id,
        name: mcp.name,
        description: mcp.description,
        tool_count: mcp.tool_count,
        tags: mcp.tags
      }
    }.bind(this))
  }
}

/**
 * Search MCPs by tags, description, capabilities, or keywords
 * @param {string} query - Search query
 * @returns {array} Array of matching MCP summaries
 */
MCPCatalog.prototype.search = function(query) {
  var results = []

  if (isUnDef(query) || query === "") {
    return results
  }

  var queryLower = query.toLowerCase()

  Object.keys(this.index).forEach(function(mcpId) {
    var mcp = this.index[mcpId]
    var score = 0

    // Check tags
    if (isArray(mcp.tags)) {
      mcp.tags.forEach(function(tag) {
        if (tag.toLowerCase().indexOf(queryLower) >= 0) {
          score += 10
        }
      })
    }

    // Check description
    if (isString(mcp.description) && mcp.description.toLowerCase().indexOf(queryLower) >= 0) {
      score += 5
    }

    // Check name
    if (isString(mcp.name) && mcp.name.toLowerCase().indexOf(queryLower) >= 0) {
      score += 8
    }

    // Check capabilities
    if (isArray(mcp.capabilities)) {
      mcp.capabilities.forEach(function(cap) {
        if (cap.toLowerCase().indexOf(queryLower) >= 0) {
          score += 7
        }
      })
    }

    if (score > 0) {
      results.push({
        id: mcp.id,
        name: mcp.name,
        category: mcp.category,
        description: mcp.description,
        tags: mcp.tags,
        tool_count: mcp.tool_count,
        score: score
      })
    }
  }.bind(this))

  // Sort by score (highest first)
  results.sort(function(a, b) { return b.score - a.score })

  return results
}

/**
 * Get full metadata for a specific MCP
 * @param {string} mcpId - MCP identifier
 * @returns {object} Full MCP metadata or error
 */
MCPCatalog.prototype.getDetails = function(mcpId) {
  if (isUnDef(mcpId)) {
    return { error: "MCP ID is required" }
  }

  var mcp = this.index[mcpId]
  if (isUnDef(mcp)) {
    return { error: "MCP not found: " + mcpId }
  }

  return mcp
}

/**
 * Load an MCP and register its tools
 * @param {string} mcpId - MCP identifier
 * @param {object} options - Loading options (config overrides, etc.)
 * @returns {object} Result with loaded status and tool count
 */
MCPCatalog.prototype.loadMCP = function(mcpId, options) {
  options = _$(options, "options").isMap().default({})

  try {
    // Get MCP metadata
    var metadata = this.getDetails(mcpId)
    if (isDef(metadata.error)) {
      return metadata
    }

    // Check if already loaded
    if (this.loadedMCPs.has(mcpId)) {
      return {
        loaded: true,
        already_loaded: true,
        mcp_id: mcpId,
        message: "MCP already loaded in this session"
      }
    }

    // Resolve dependencies first
    var depResult = this._resolveDependencies(mcpId)
    if (!depResult.success && isArray(depResult.failed) && depResult.failed.length > 0) {
      return {
        loaded: false,
        error: "Failed to load dependencies: " + depResult.failed.join(", ")
      }
    }

    // Load MCP using parent's _loadMcpFromCatalog method
    if (isDef(this.parent) && isDef(this.parent._loadMcpFromCatalog)) {
      var loadResult = this.parent._loadMcpFromCatalog(metadata, options)

      if (loadResult.success) {
        // Mark as loaded
        this.loadedMCPs.add(mcpId)
        this.session.loaded_mcps.push(mcpId)
        this.session.last_updated = new Date().toISOString()

        // Track usage
        this._trackUsage(mcpId)

        return {
          loaded: true,
          mcp_id: mcpId,
          tool_count: loadResult.tool_count || metadata.tool_count,
          message: "MCP loaded successfully"
        }
      } else {
        return {
          loaded: false,
          mcp_id: mcpId,
          error: loadResult.error || "Failed to load MCP"
        }
      }
    } else {
      return {
        loaded: false,
        error: "Parent MiniA instance does not support catalog loading"
      }
    }

  } catch(e) {
    return {
      loaded: false,
      error: e.message || String(e)
    }
  }
}

/**
 * Get catalog statistics
 * @returns {object} Statistics about the catalog
 */
MCPCatalog.prototype.getStats = function() {
  return {
    total_mcps: Object.keys(this.index).length,
    loaded_mcps: this.loadedMCPs.size,
    categories: this.structure.categories ? this.structure.categories.length : 0,
    session_id: this.session.session_id,
    most_used: this._getMostUsed(5)
  }
}

/**
 * Get most used MCPs
 * @param {number} limit - Number of results to return
 * @returns {array} Array of most used MCPs
 */
MCPCatalog.prototype._getMostUsed = function(limit) {
  var counts = this.usage.usage_counts || {}
  var sorted = Object.keys(counts).map(function(mcpId) {
    return { id: mcpId, count: counts[mcpId] }
  }).sort(function(a, b) { return b.count - a.count })

  return sorted.slice(0, limit || 5)
}

/**
 * Track MCP usage
 * @param {string} mcpId - MCP identifier
 */
MCPCatalog.prototype._trackUsage = function(mcpId) {
  // Update usage count
  if (isUnDef(this.usage.usage_counts[mcpId])) {
    this.usage.usage_counts[mcpId] = 0
  }
  this.usage.usage_counts[mcpId]++

  // Update co-loading patterns
  var currentlyLoaded = Array.from(this.loadedMCPs)
  currentlyLoaded.forEach(function(otherId) {
    if (otherId !== mcpId) {
      var key = [mcpId, otherId].sort().join(":")
      if (isUnDef(this.usage.co_load_patterns[key])) {
        this.usage.co_load_patterns[key] = 0
      }
      this.usage.co_load_patterns[key]++
    }
  }.bind(this))

  this.usage.last_updated = new Date().toISOString()
}

/**
 * Resolve and load dependencies for an MCP
 * @param {string} mcpId - MCP identifier
 * @param {array} visited - Array of visited MCPs (for circular detection)
 * @returns {object} Result with success status and loaded dependencies
 */
MCPCatalog.prototype._resolveDependencies = function(mcpId, visited) {
  visited = visited || []

  // Circular dependency detection
  if (visited.indexOf(mcpId) >= 0) {
    return {
      success: false,
      error: "Circular dependency detected",
      circular_path: visited.concat([mcpId])
    }
  }

  var newVisited = visited.concat([mcpId])
  var deps = (this.dependencies.dependencies || {})[mcpId] || []
  var loaded = []
  var failed = []

  for (var i = 0; i < deps.length; i++) {
    var depId = deps[i]

    // Skip if already loaded
    if (this.loadedMCPs.has(depId)) {
      continue
    }

    // Recursively resolve dependencies
    var depResult = this._resolveDependencies(depId, newVisited)
    if (!depResult.success) {
      failed.push(depId)
      continue
    }

    // Load the dependency
    var loadResult = this.loadMCP(depId, {})
    if (loadResult.loaded) {
      loaded.push(depId)
    } else {
      failed.push(depId)
    }
  }

  return {
    success: failed.length === 0,
    loaded: loaded,
    failed: failed
  }
}

/**
 * Get smart preload recommendations based on goal text
 * @param {string} goal - User's goal text
 * @returns {array} Array of recommended MCP IDs with scores
 */
MCPCatalog.prototype.getPreloadRecommendations = function(goal) {
  if (isUnDef(goal) || goal === "") {
    return []
  }

  var goalLower = goal.toLowerCase()
  var recommendations = []

  Object.keys(this.index).forEach(function(mcpId) {
    var mcp = this.index[mcpId]
    var score = 0

    // Tag matching
    if (isArray(mcp.tags)) {
      mcp.tags.forEach(function(tag) {
        if (goalLower.indexOf(tag.toLowerCase()) >= 0) {
          score += 10
        }
      })
    }

    // Capability matching
    if (isArray(mcp.capabilities)) {
      mcp.capabilities.forEach(function(cap) {
        var capWords = cap.toLowerCase().split(/\s+/)
        capWords.forEach(function(word) {
          if (goalLower.indexOf(word) >= 0 && word.length > 3) {
            score += 5
          }
        })
      })
    }

    // Usage frequency bonus
    var usageCount = (this.usage.usage_counts || {})[mcpId] || 0
    score += Math.min(usageCount * 2, 10)

    if (score > 0) {
      recommendations.push({
        mcp_id: mcpId,
        name: mcp.name,
        score: score,
        reason: "Goal relevance and usage patterns"
      })
    }
  }.bind(this))

  // Sort by score
  recommendations.sort(function(a, b) { return b.score - a.score })

  return recommendations.slice(0, 5)
}
