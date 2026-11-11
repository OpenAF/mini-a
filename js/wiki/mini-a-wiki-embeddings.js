// Preserve the wiki cache entry point while sharing provider and cache behavior.
if (typeof MiniAEmbeddings === "undefined") {
  var __miniAEmbeddingSource = String(__loadedfrom)
  var __miniAEmbeddingDirectory = new java.io.File(__miniAEmbeddingSource).getCanonicalFile().getParentFile()
  loadLib(String(new java.io.File(__miniAEmbeddingDirectory, "../memory/mini-a-embeddings.js").getCanonicalPath()))
}
var MiniAWikiEmbeddings = MiniAEmbeddings
