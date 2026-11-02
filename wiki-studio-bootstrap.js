// Pin libraries to the oPack containing this entrypoint, independently of cwd
// and other installed Mini-A versions. Engines remain lazily loaded in workers.
var wikiStudioLoad = function(base, names) {
  names.forEach(function(name) { loadLib(base + "/" + name); __loadedLibs[name.toLowerCase()] = true })
}
var wikiStudioBootstrap = function(base) {
  wikiStudioLoad(base,["mini-a-common.js","mini-a-wiki-maintenance.js","mini-a-wiki-retrieval.js","mini-a-graph.js","mini-a-wiki.js","mini-a-wiki-knowledge.js","mini-a-wikiops.js","wiki-studio-common.js","wiki-studio-registry.js","wiki-studio-api.js","wiki-studio-pages.js","wiki-studio-graph.js","wiki-studio-sources.js","wiki-studio-jobs.js","wiki-studio-operations.js","wiki-studio-backups.js","wiki-studio-ingestion.js"])
  MiniAWikiOps.basePath = function() { return base }
}
