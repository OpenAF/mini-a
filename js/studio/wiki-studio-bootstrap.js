// Pin libraries to the oPack containing this entrypoint, independently of cwd
// and other installed Mini-A versions. Engines remain lazily loaded in workers.
var wikiStudioLoad = function(base, names) {
  names.forEach(function(name) { loadLib(base + "/" + name) })
}
var wikiStudioBootstrap = function(base) {
  loadLib(base + "/js/mini-a-paths.js")
  __miniAPackageRoot = __miniAResolvePackageRoot(base)
  wikiStudioLoad(base,["js/core/mini-a-common.js","js/wiki/mini-a-wiki-maintenance.js","js/wiki/mini-a-wiki-retrieval.js","js/wiki/mini-a-graph.js","js/wiki/mini-a-wiki.js","js/wiki/mini-a-wiki-knowledge.js","js/wiki/mini-a-wikiops.js","js/studio/wiki-studio-common.js","js/studio/wiki-studio-registry.js","js/studio/wiki-studio-api.js","js/studio/wiki-studio-pages.js","js/studio/wiki-studio-graph.js","js/studio/wiki-studio-outbound.js","js/studio/wiki-studio-sources.js","js/studio/wiki-studio-jobs.js","js/studio/wiki-studio-operations.js","js/studio/wiki-studio-backups.js","js/studio/wiki-studio-ingestion.js"])
  MiniAWikiOps.basePath = function() { return base }
}
