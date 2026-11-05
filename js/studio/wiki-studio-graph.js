WikiStudioServer.prototype.graphHtml = function(w) {
  var c = this.config, manifest = WikiStudio.scan(w.root, false), graphFile = w.root + "/.mini-a-wiki-graph/graph.json"
  manifest["renderer"]={hash:WikiStudio.hash(java.nio.file.Files.readAllBytes(WikiStudio.path(c.base+"/utils/wikiGraph.yaml")))}
  if (io.fileExists(graphFile)) {
    WikiStudio.noLinks(graphFile)
    WikiStudio.assert(new java.io.File(graphFile).length() <= 8388608, 413, "graph_limit", "Graph snapshot exceeds the Studio embedding limit")
    var g = WikiStudio.json(graphFile)
    WikiStudio.assert(isMap(g.nodes) && Object.keys(g.nodes).length <= 5000 && isArray(g.edges) && g.edges.length <= 30000, 413, "graph_limit", "Graph is too large for the embedded renderer; use the offline utility")
    manifest["graph.json"] = { hash: WikiStudio.hash(java.nio.file.Files.readAllBytes(WikiStudio.path(graphFile))) }
  }
  WikiStudio.assert(Object.keys(manifest).length <= 5000, 413, "graph_limit", "Wiki is too large for the embedded graph")
  var cache = c.home + "/graph-cache/" + w.id
  WikiStudio.privateDir(cache)
  var path = cache + "/" + WikiStudio.fingerprint(manifest) + "-v1.html"
  if (!io.fileExists(path)) {
    var temp = cache + "/" + WikiStudio.id() + ".html", runner = new MiniAWikiOps({})
    var res = runner.utility("wikiGraph", { dir: w.root, output: temp, title: w.name, embed: true })
    WikiStudio.assert(res.ok, 422, "graph_export_failed", "Graph export failed; inspect wiki health")
    WikiStudio.assert(new java.io.File(temp).length() <= 8388608, 413, "graph_limit", "Generated graph is too large")
    java.nio.file.Files.move(WikiStudio.path(temp), WikiStudio.path(path), java.nio.file.StandardCopyOption.ATOMIC_MOVE)
    io.listFiles(cache).files.filter(function(f) { return /\.html$/.test(f.filename) && f.filepath !== path }).sort(function(a,b) { return Number(b.lastModified) - Number(a.lastModified) }).slice(2).forEach(function(f) { new java.io.File(f.filepath).delete() })
  }
  WikiStudio.noLinks(path)
  // Blob frames inherit the Studio CSP. A server nonce admits only this fixed
  // renderer's scripts/styles; raw Markdown never becomes HTML in this origin.
  return { studioHtml: io.readFileString(path).replace(/<script(?=[ >])/g,'<script nonce="'+c.graphNonce+'"').replace(/<style>/g,'<style nonce="'+c.graphNonce+'">') }
}
