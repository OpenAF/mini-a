"""Abrupt JVM ingestion recovery and disposable HTTP delivery checks.
Run: python3 tests/wikiIngestRecoveryProcess.py (OpenAF on PATH; no model needed).
"""
import functools
import argparse
import http.server
import json
from pathlib import Path
import subprocess
import tempfile
import threading

REPO = Path(__file__).resolve().parents[1]


def execute(work, name, source, expected=0):
    script = work / (name + '.js')
    script.write_text(source)
    result = subprocess.run(['oaf', '-f', str(script)], cwd=REPO,
                            capture_output=True, text=True, timeout=60)
    assert result.returncode == expected, (name, result.returncode, result.stdout, result.stderr)
    if expected:
        return None
    marker = next((line[7:] for line in result.stdout.splitlines() if line.startswith('RESULT ')), None)
    assert marker is not None, (name, result.stdout, result.stderr)
    return json.loads(marker)


def crash_checks(base):
    boundaries = ['transformation', 'prepared', 'pages-applied', 'finalization-pending',
                  'published', 'finalized', 'verified', 'exported', 'cleanup']
    for boundary in boundaries:
        work = base / boundary
        work.mkdir()
        source, wiki, calls = work / 'source', work / 'wiki', work / 'calls.txt'
        source.mkdir()
        wiki.mkdir()
        (source / 'a.md').write_text('# A\n\nprocessrecoveryneedle')
        options = dict(usewiki=True, wikiaccess='rw', wikiroot=str(wiki),
                       ingestsource=str(source), ingestsection='docs', ingestmode='distill',
                       wikiretrievalv2=True, wikiretrievalconfig=dict(bundlePath=str(work / 'bundle.zip')))
        setup = '''
          global.__mini_a_ingest_lib_mode=true; load('mini-a-ingest.js');
          var runner=new MiniAIngest(%s,function(){}), countPath=%s;
          runner._setLlm({promptJSONWithStats:function(prompt){
            var n=io.fileExists(countPath)?Number(io.readFileString(countPath)):0;
            io.writeFileString(countPath,String(n+1));
            return {response:{title:'A',description:'Recovery test',type:'reference',tags:[],body:'# A\\n\\nprocessrecoveryneedle'}};
          }});
        ''' % (json.dumps(options), json.dumps(str(calls)))
        inject = '''
          var atomic=runner._atomicJson, boundary=%s;
          runner._atomicJson=function(path,value){
            atomic.call(this,path,value); var c=value.checkpoints||{};
            var at=boundary==='transformation'?path.indexOf('/transforms/')>=0:
              /\\/journal\\.json$/.test(path)&&(boundary==='finalized'?c.finalized&&!c.serving:
              boundary==='verified'?c.serving&&!c.export:boundary==='exported'?c.export:value.phase===boundary);
            if(at)java.lang.Runtime.getRuntime().halt(73);
          };
          if(boundary==='published'){
            var finalize=runner._finalize;
            runner._finalize=function(wm){(wm._retrievalV2||wm._legacyRetrievalV2)._publicationFault=function(step){if(step==='pointer-activated')java.lang.Runtime.getRuntime().halt(73)};return finalize.apply(this,arguments)};
          }
          if(boundary==='cleanup'){
            var finish=runner._finishJournal;
            runner._finishJournal=function(){finish.apply(this,arguments);java.lang.Runtime.getRuntime().halt(73)};
          }
          runner.run();java.lang.System.exit(74);
        ''' % json.dumps(boundary)
        execute(work, 'interrupt', setup + inject, expected=73)
        activated_pointer = (wiki / '.mini-a-wiki-serving/current.json').read_text() if boundary == 'published' else None
        if boundary == 'prepared':
            (source / 'a.md').unlink()
            source.rmdir()
        result = execute(work, 'resume', setup + '''
          var result=runner.run();
          var wm=new MiniAWikiManager({root:%s,access:'ro',wikiretrievalv2:true},function(){});
          try{result.proof=wm.verifyServing();result.evidence=wm.retrieve('processrecoveryneedle').evidence.length;}
          finally{wm.close()}
          print('RESULT '+JSON.stringify(result));
        ''' % json.dumps(str(wiki)))
        assert result['ok'] and result['proof']['ok'] and result['evidence'] == 1, (boundary, result)
        if activated_pointer is not None:
            assert (wiki / '.mini-a-wiki-serving/current.json').read_text() == activated_pointer, 'already activated publication must be reused'
        assert calls.read_text() == '1', (boundary, calls.read_text())
        assert not (wiki / '.mini-a-wiki-ingest/journal.json').exists(), boundary
        assert (work / 'bundle.zip').is_file(), boundary
        print('PASS process interruption at ' + boundary, flush=True)
    return len(boundaries)


def http_checks(base):
    work = base / 'http'
    work.mkdir()
    root, cache = work / 'publisher', work / 'cache'
    root.mkdir()
    cache.mkdir()
    execute(work, 'publish', '''
      global.__mini_a_ingest_lib_mode=true;load('mini-a-ingest.js');
      var source=%s;io.mkdir(source);io.writeFileString(source+'/a.md','# A\\n\\nhttprecoveryneedle');
      var r=new MiniAIngest({usewiki:true,wikiaccess:'rw',wikiroot:%s,ingestsource:source,
        ingestsection:'docs',ingestmode:'raw',wikiretrievalv2:true,
        wikiretrievalconfig:{bundlePath:%s}},function(){}).run();
      print('RESULT '+JSON.stringify(r));
    ''' % (json.dumps(str(work / 'source')), json.dumps(str(root)), json.dumps(str(root / 'mini-a-wiki-index.zip'))))

    class Handler(http.server.SimpleHTTPRequestHandler):
        downloads = 0

        def end_headers(self):
            self.send_header('ETag', '"fixed-recovery-test-etag"')
            super().end_headers()

        def do_GET(self):
            if self.path == '/mini-a-wiki-index.zip':
                type(self).downloads += 1
            super().do_GET()

        def log_message(self, *_):
            pass

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(root)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        url = 'http://127.0.0.1:' + str(server.server_port)
        result = execute(work, 'reader', '''
          load('mini-a-common.js');load('mini-a-wiki.js');
          var reader=new MiniAWikiManager({backend:'http',root:%s,indexdir:%s,access:'ro',wikiretrievalv2:true},function(){}), checks=[];
          function check(name,condition){if(!condition)throw new Error(name);checks.push(name)}
          try{
            check('initial live evidence',reader.retrieve('httprecoveryneedle').evidence.length===1);
            check('unchanged healthy cache',reader._hydrateHttpArtifacts()===false);
            var root=reader._activeBundleRoot()+'/.mini-a-wiki-serving', p=io.readFileJSON(root+'/current.json');
            io.writeFileString(root+'/'+p.generation+'/manifest.json','damaged local cache');
            check('unchanged ETag repair',reader._hydrateHttpArtifacts()===true);
            check('cache repair reported',reader._artifactStatus.status==='cache-repaired');
            check('repaired live evidence',reader.retrieve('httprecoveryneedle').evidence.length===1);
            print('RESULT '+JSON.stringify({ok:true,checks:checks}));
          }finally{reader.close()}
        ''' % (json.dumps(url), json.dumps(str(cache))))
        assert len(result['checks']) == 5 and Handler.downloads == 2, (result, Handler.downloads)
        print('PASS disposable HTTP delivery: 5 checks, exactly 2 downloads', flush=True)
        return 5
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--http-only', action='store_true')
    mode.add_argument('--process-only', action='store_true')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='mini-a-ingest-recovery-') as temporary:
        base = Path(temporary)
        count = (0 if args.http_only else crash_checks(base)) + (0 if args.process_only else http_checks(base))
        assert count == (5 if args.http_only else 9 if args.process_only else 14)
        print(json.dumps(dict(ok=True, checks=count, scope='http' if args.http_only else 'process' if args.process_only else 'all')))
