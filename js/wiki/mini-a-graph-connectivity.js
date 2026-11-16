// Measure document connectivity without materializing feature cliques.
var MiniAGraphConnectivity = function(state, options) {
  var opts = options || {}
  var nodes = state.nodes || {}
  var docs = Object.create(null)
  var features = Object.create(null)
  var parent = Object.create(null)
  var links = Object.create(null)
  var navigation = Object.create(null)
  var byType = Object.create(null)
  var byProvenance = Object.create(null)
  var byMethod = Object.create(null)
  var stale = 0
  var unverifiable = 0
  var dangling = 0
  var explicit = 0
  var physical = 0
  var paths = Array.isArray(opts.pages) ? opts.pages : null
  var actual = paths ? Object.create(null) : null
  if (actual) paths.forEach(function(path) { actual['doc:' + path] = true })

  // Snapshot-only reports identify indexed pages by their persisted hash.
  Object.keys(nodes).sort().forEach(function(id) {
    var node = nodes[id]
    if (node.type !== 'document') return
    physical++
    if (actual ? !actual[id] : !node.props || typeof node.props.hash !== 'string') return
    docs[id] = { features: [], tags: false, concepts: false }
    links[id] = Object.create(null)
    parent[id] = id
  })
  var ids = Object.keys(docs)
  var maxDf = Math.min(200, Math.max(2, Math.floor(ids.length * (opts.maxDf || 0.2))))
  var generic = /^(docs?|documentation|index|readme|overview|guide|reference|api|common|configuration|source|example|examples|notes|page|pages)$/i

  // Path compression keeps component aggregation linear in graph incidence.
  function root(id) {
    var at = id
    while (parent[at] !== at) at = parent[at]
    while (parent[id] !== id) {
      var next = parent[id]
      parent[id] = at
      id = next
    }
    return at
  }

  // Connect two actual documents without storing a projected feature edge.
  function union(a, b) {
    var left = root(a)
    var right = root(b)
    if (left !== right) parent[right] = left
  }

  // Index pages are navigation; their links remain physical graph edges.
  function isNavigation(id) {
    var path = String((nodes[id].props || {}).path || id.substring(4))
    return /(^|\/)(index|log|AGENTS)\.md$/i.test(path)
  }

  // Grounded assertions must still identify the revision that supplied the quote.
  function revisionCurrent(edge) {
    var p = edge.props || {}
    var owner = nodes['doc:' + p.page]
    var supportsCurrent = !Array.isArray(p.supports) || p.supports.every(function(support) {
      var peer = nodes['doc:' + support.path]
      return peer && peer.props && peer.props.revision === support.revision
    })
    return supportsCurrent && owner && owner.props &&
      owner.props.hash === p.sourceHash && (!p.revision || p.revision === owner.props.revision)
  }

  // Inferred assertions can be current without qualifying as grounded connectivity.
  function current(edge) {
    var p = edge.props || {}
    return p.evidenceLayer === 'grounded' && p.evidence && p.revision && revisionCurrent(edge)
  }

  // Model assertions can ground concepts through their owner without a MENTIONS edge.
  function addFeature(key, owner, kind) {
    if (!docs[owner] || !nodes[key]) return
    var node = nodes[key]
    var name = String((node.props || {}).name || key.split(':').pop())
    if (generic.test(name) || String(key).indexOf('concept:ambiguous:') === 0) return
    if (!features[key]) features[key] = { kind: kind, docs: Object.create(null) }
    features[key].docs[owner] = true
  }

  // Aggregate physical counters independently from meaningful relationships.
  ;(state.edges || []).forEach(function(edge) {
    if (!edge || edge._deleted) return
    var p = edge.props || {}
    byType[edge.type] = (byType[edge.type] || 0) + 1
    byProvenance[edge.provenance || 'AMBIGUOUS'] = (byProvenance[edge.provenance || 'AMBIGUOUS'] || 0) + 1
    byMethod[p.method || 'structural'] = (byMethod[p.method || 'structural'] || 0) + 1
    if (!nodes[edge.from] || !nodes[edge.to]) dangling++
    if (p.page && p.evidence) {
      if (!p.sourceHash || !p.revision) unverifiable++
      else if (!revisionCurrent(edge)) stale++
    }
    if ((edge.type === 'LINKS_TO' || edge.type === 'SUPERSEDES') && docs[edge.from] && docs[edge.to] && edge.from !== edge.to) {
      explicit++
      if (isNavigation(edge.from) || isNavigation(edge.to)) {
        navigation[edge.from] = true
        navigation[edge.to] = true
      } else {
        links[edge.from][edge.to] = true
        links[edge.to][edge.from] = true
        union(edge.from, edge.to)
      }
    }
    if (edge.type === 'HAS_TAG') addFeature(edge.to, edge.from, 'tags')
    if (current(edge)) {
      var owner = docs[edge.from] ? edge.from : 'doc:' + p.page
      ;[edge.from, edge.to].forEach(function(id) {
        if (String(id).indexOf('concept:') === 0) addFeature(id, owner, 'concepts')
      })
    }
  })

  // One representative per feature is sufficient for exact connected components.
  Object.keys(features).sort().forEach(function(key) {
    var feature = features[key]
    var members = Object.keys(feature.docs)
    if (members.length < 2 || members.length > maxDf) return
    members.forEach(function(id) {
      union(members[0], id)
      docs[id][feature.kind] = true
      docs[id].features.push(key)
    })
  })
  var sizes = Object.create(null)
  var degrees = []
  var visited = 0
  var budget = typeof opts.maxVisits === 'number' ? opts.maxVisits : 1000000
  var partial = false
  var isolated = 0
  var semanticIsolated = 0
  var tagDocs = 0
  var conceptDocs = 0
  var navOnly = 0

  // Distinct degrees use bounded per-document sets, never a global pair matrix.
  ids.forEach(function(id) {
    var component = root(id)
    sizes[component] = (sizes[component] || 0) + 1
    var doc = docs[id]
    var neighbors = Object.create(null)
    var meaningful = Object.keys(links[id]).length > 0 || doc.features.length > 0
    if (!meaningful) isolated++
    if (!doc.concepts) semanticIsolated++
    if (doc.tags) tagDocs++
    if (doc.concepts) conceptDocs++
    if (!meaningful && navigation[id]) navOnly++
    Object.keys(links[id]).forEach(function(other) {
      if (visited++ < budget) neighbors[other] = true
      else partial = true
    })
    doc.features.forEach(function(key) {
      if (visited >= budget) {
        partial = true
        return
      }
      Object.keys(features[key].docs).forEach(function(other) {
        if (visited++ >= budget) partial = true
        else if (other !== id) neighbors[other] = true
      })
    })
    degrees.push(Object.keys(neighbors).length)
  })
  degrees.sort(function(a, b) { return a - b })
  var distribution = Object.keys(sizes).map(function(key) { return sizes[key] }).sort(function(a, b) { return b - a })
  var average = degrees.length ? degrees.reduce(function(sum, n) { return sum + n }, 0) / degrees.length : 0
  var middle = Math.floor(degrees.length / 2)
  var median = degrees.length ? degrees.length % 2 ? degrees[middle] : (degrees[middle - 1] + degrees[middle]) / 2 : 0
  return {
    version: 1, authority: actual ? 'inventory' : 'snapshot', documentNodes: physical,
    actualPages: ids.length, placeholderDocuments: physical - ids.length,
    explicitDocumentEdges: explicit, documentsWithSharedTags: tagDocs,
    documentsWithGroundedConcepts: conceptDocs, navigationOnlyDocuments: navOnly,
    semanticallyIsolatedDocuments: semanticIsolated, meaningfullyIsolatedDocuments: isolated,
    components: distribution.length, componentSizes: distribution,
    largestComponentPercent: ids.length ? 100 * (distribution[0] || 0) / ids.length : 0,
    averageMeaningfulNeighbors: partial ? null : average, medianMeaningfulNeighbors: partial ? null : median,
    neighborLowerBounds: partial ? { average: average, median: median } : null,
    partial: partial, visits: Math.min(visited, budget), maxVisits: budget,
    edgesByType: byType, edgesByProvenance: byProvenance, edgesByMethod: byMethod,
    staleRelationships: stale, unverifiableRelationships: unverifiable, danglingRelationships: dangling,
    validationFailures: (state.reconciliation || {}).rejected || 0,
    enrichment: (state.reconciliation || {}).report || { status: 'not-run' }
  }
}
