// Real H2 metadata plus a driver-extension fixture; no remote database.
ow.loadTest()
var source = io.readFileYAML('mcps/mcp-db.yaml')
var job = source.jobs.filter(function(item) { return item.name === 'Get client info' })[0]
var getInfo = new Function('args', job.exec)
var previous = global.db, failure
try {
  global.db = new DB('jdbc:h2:mem:mini_a_metadata_test;DB_CLOSE_DELAY=-1', 'sa', '')
  var result = getInfo({})
  ow.test.assert(isMap(result), true, 'H2 metadata should return an object')
  ow.test.assert(String(result.version), String(global.db.getConnect().getMetaData().getDatabaseProductVersion()), 'Version comes from JDBC metadata')
  ow.test.assert(result.protocolVersion, null, 'Unsupported protocol extension returns null')
  ow.test.assert(String(result.metadata.productName), 'H2', 'Database fields are retained')
  global.db.close()
  var values = result
  // A supported extension is independent of the standard product version.
  var metadata = { getDatabaseProductVersion: function() { return 'fixture version' } }
  Object.keys(result.metadata).forEach(function(key) {
    var name = ({productName:'getDatabaseProductName', productVersion:'getDatabaseProductVersion', userName:'getUserName', url:'getURL', isReadOnly:'isReadOnly', supportsTransactions:'supportsTransactions'})[key] || 'get' + key.charAt(0).toUpperCase() + key.substring(1)
    if (!metadata[name]) metadata[name] = function() { return values.metadata[key] }
  })
  global.db = { getConnect: function() { return {
    getMetaData: function() { return metadata }, getProtocolVersion: function() { return 3 },
    getAutoCommit: function() { return true }, getCatalog: function() { return null }, getClientInfo: function() { return new java.util.Properties() }
  } } }
  ow.test.assert(getInfo({}).protocolVersion, 3, 'Supported driver protocol is retained')
  print('JDBC H2 metadata and optional protocol checks passed')
} catch(error) { failure = error } finally {
  if (global.db && isFunction(global.db.close)) try { global.db.close() } catch(ignore) {}
  global.db = previous
}

if (failure) { printErr(failure); exit(1) }
