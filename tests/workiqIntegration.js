exports.testWorkIQWire = function() {
  ow.loadServer(); ow.loadTest();
  var check = (a,b,msg) => ow.test.assert(a,b,msg);
  var root = String(new java.io.File('.').getCanonicalPath());
  var dir = io.createTempFile('workiq-wire-', '.tmp'); io.rm(dir); io.mkdir(dir);
  var port = findRandomOpenPort(), hs = ow.server.httpd.start(port, '127.0.0.1');
  var calls = [];
  ow.server.httpd.route(hs, {
    '/mcp': req => {
      var result;
      if (req.method === 'DELETE') return ow.server.httpd.reply('', 204, 'text/plain', {});
      var rpc = jsonParse(req.files && req.files.postData || req.data);
      if (isUnDef(rpc.id)) return ow.server.httpd.reply('', 202, 'text/plain', {});
      if (rpc.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: {tools:{}}, serverInfo: {name:'fixture',version:'1'} };
      else if (rpc.method === 'tools/list') result = { tools: [
        {name:'fetch',description:'Read data',inputSchema:{type:'object',properties:{entityUrls:{type:'array'}}}},
        {name:'create_entity',description:'Write data',inputSchema:{type:'object'}}
      ] };
      else if (rpc.method === 'tools/call') { calls.push(rpc.params); result={ content:[{type:'text',text:'fixture response'},{type:'image',data:'AA==',mimeType:'image/png'}], structuredContent:{ count:1 }, isError:rpc.params.arguments.fixtureFailure === true }; }
      else result = {};
      return ow.server.httpd.reply({jsonrpc:'2.0',id:rpc.id,result:result},200,'application/json',{});
    }
  });
  // Copy only the descriptor; inject a test job between client definition and init.
  // All production jobs run unchanged, without any Mini-A helper or package lookup.
  var descriptor = io.readFileYAML(root + '/mcps/mcp-workiq.yaml');
  descriptor.jobs.push({ name: 'WorkIQ Fixture', exec:
    'var Real=global.__workIQClient;'
    + 'global.__workIQClient=function(args){return new Real(args,{WORKIQ_ACCESS_TOKEN:"fixture"},function(cfg){cfg.url="http://127.0.0.1:' + port + '/mcp";return $mcp(cfg)})};'
    + 'var realGetOPackPath=getOPackPath;global.getOPackPath=function(name){if(name==="mini-a")throw new Error("Mini-A dependency forbidden");return realGetOPackPath(name)};'
  });
  descriptor.todo.splice(1, 0, 'WorkIQ Fixture');
  io.writeFileYAML(dir + '/mcp-workiq.yaml', descriptor);
  var runner = 'oJobRunFile("mcp-workiq.yaml",processExpr());';
  io.writeFileString(dir + '/serve.js', runner);
  var cmd = [ow.format.getJavaHome() + '/bin/java', '-jar', getOpenAFJar(), '-f', dir + '/serve.js', '-e', 'auth=token'];
  var clients = [];
  try {
    // Use raw STDIO to assert that every stdout line is a JSON-RPC response.
    var process = new java.lang.ProcessBuilder(java.util.Arrays.asList(cmd));
    process.directory(new java.io.File(dir)); process.redirectError(new java.io.File(dir + '/stdio.log'));
    var stdio = process.start();
    var reader = new java.io.BufferedReader(new java.io.InputStreamReader(stdio.getInputStream(), 'UTF-8'));
    var writer = new java.io.BufferedWriter(new java.io.OutputStreamWriter(stdio.getOutputStream(), 'UTF-8'));
    var nextId = 1;
    function rpc(method, params) {
      var id = nextId++;
      writer.write(stringify({jsonrpc:'2.0',id:id,method:method,params:params}, __, '') + '\n'); writer.flush();
      var deadline = now() + 20000;
      while (!reader.ready() && stdio.isAlive() && now() < deadline) sleep(20, true);
      check(reader.ready(),true,'STDIO response ready: ' + io.readFileString(dir + '/stdio.log'));
      var line = String(reader.readLine()), response = jsonParse(line);
      check(response.jsonrpc,'2.0','STDOUT contains only JSON-RPC'); check(response.id,id,'Response correlation');
      check(isUnDef(response.error),true,'No JSON-RPC error: ' + line);
      return response.result;
    }
    var c = {
      initialize: function() { return rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}}) },
      listTools: function() { return rpc('tools/list',{}) },
      callTool: function(name,args) { return rpc('tools/call',{name:name,arguments:args}) },
      destroy: function() { writer.close(); reader.close(); stdio.destroy(); stdio.waitFor(5,java.util.concurrent.TimeUnit.SECONDS); if(stdio.isAlive()) stdio.destroyForcibly() }
    };
    clients.push(c);
    c.initialize();
    check(c.listTools().tools[0].name,'workiq','Real descriptor exposes dispatcher');
    var result = c.callTool('workiq',{action:'list'}); check(result.structuredContent.tools.length,1,'Filtered catalog on wire');
    var call = c.callTool('workiq',{action:'call',tool:'fetch',arguments:{entityUrls:['/me/messages']}});
    check(call.structuredContent.count,1,'Structured content preserved on wire'); check(call.content[0].text,'fixture response','Content preserved on wire'); var denied=c.callTool('workiq',{action:'call',tool:'create_entity',arguments:{}}); check(denied.isError,true,'Policy error preserved on wire');
    check(call.content[1].type,'image','Non-text content preserved'); check(c.callTool('workiq',{action:'call',tool:'fetch',arguments:{fixtureFailure:true}}).isError,true,'Upstream error preserved'); check(calls.length,2,'Real upstream dispatcher was invoked');
    c.destroy(); clients=[];
    print('PASS STDIO wire integration');
    var httpPort = findRandomOpenPort();
    var proc = new java.lang.ProcessBuilder(ow.format.getJavaHome() + '/bin/java', '-jar', getOpenAFJar(), '-f', dir + '/serve.js', '-e', 'auth=token onport=' + httpPort);
    proc.directory(new java.io.File(dir)); proc.redirectErrorStream(true); proc.redirectOutput(new java.io.File(dir + '/http.log'));
    var child = proc.start();
    try {
      var deadline = now() + 20000, ready = false;
      while (now() < deadline && !ready) {
        try { var socket = new java.net.Socket('127.0.0.1', httpPort); socket.close(); ready = true; } catch(e) { sleep(100, true); }
      }
      check(ready,true,'HTTP server starts: ' + io.readFileString(dir + '/http.log'));
      c=$mcp({type:'remote',url:'http://127.0.0.1:'+httpPort+'/mcp',timeout:20000}); clients.push(c); c.initialize();
      var result=c.callTool('workiq',{action:'call',tool:'fetch',arguments:{entityUrls:['/me/messages']}});
      check(result.structuredContent.count,1,'HTTP structured content preserved');
      check(c.callTool('workiq',{action:'call',tool:'create_entity',arguments:{}}).isError,true,'HTTP policy error preserved');
      check(c.callTool('workiq',{action:'call',tool:'fetch',arguments:{fixtureFailure:true}}).isError,true,'HTTP upstream error preserved'); check(calls.length,4,'Only allowed STDIO/HTTP calls dispatched upstream');
      c.destroy(); clients=[];
      print('PASS HTTP wire integration');
    } finally { child.destroy(); child.waitFor(5,java.util.concurrent.TimeUnit.SECONDS); if(child.isAlive()) child.destroyForcibly(); }

  } finally { clients.forEach(c=>c.destroy()); ow.server.httpd.stop(hs); io.rm(dir); }


};
