"""Standalone OpenAF MCP STDIO smoke; temporary fixtures, no model or provider calls.
Run: python3 tests/wikiRetrievalTransport.py
"""
import json
import os
from pathlib import Path
import selectors
import signal
import socket
import urllib.request
import urllib.error
import subprocess
import tempfile
import time

REPO = Path(__file__).resolve().parents[1]


def run_server(descriptor, root, work, transport="stdio"):
    source = (REPO / 'mcps' / descriptor).read_text()
    if os.getenv('WIKI_TRANSPORT_DEBUG') == 'true':
        source = source.replace('logToConsole: false', 'logToConsole: true')
        source = source.replace('    loadLib("mini-a-mcp-wiki.js")', '    print("TRANSPORT_INIT"); loadLib("mini-a-mcp-wiki.js")')
    if os.getenv('WIKI_TRANSPORT_NO_UNIQUE') == 'true':
        source = source.replace('  unique      :\n    pidFile     : .mcp-wiki.pid\n    killPrevious: true\n', '').replace('  unique      :\n    pidFile     : .mcp-wiki-safe.pid\n    killPrevious: true\n', '')
    source = source.replace('pidFile     : .mcp-wiki.pid', 'pidFile     : ' + str(work / 'trusted.pid'))
    source = source.replace('pidFile     : .mcp-wiki-safe.pid', 'pidFile     : ' + str(work / 'safe.pid'))
    config = work / ("smoke-" + descriptor)
    config.write_text(source)
    extra = []
    if transport == "http":
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        extra = ["onport=" + str(port), "host=127.0.0.1"]
    process = subprocess.Popen(['ojob', str(config), 'wikiroot=' + str(root),
                                'wikiretrievalv2=true', 'label=Transport', 'wikirestrictprofile=relaxed']
                               + (['wikirestrictmaxreads=1'] if descriptor == 'mcp-wiki-safe.yaml' else []) + extra,
                               cwd=REPO, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True, bufsize=1,
                               start_new_session=True)
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    counter = 0
    diagnostics = []

    def request(method, params):
        nonlocal counter
        counter += 1
        if transport == "http":
            payload = json.dumps({'jsonrpc': '2.0', 'id': counter, 'method': method, 'params': params}).encode()
            until = time.monotonic() + 45
            while True:
                try:
                    wire = urllib.request.Request('http://127.0.0.1:' + str(port) + '/mcp', data=payload,
                                                  headers={'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'})
                    with urllib.request.urlopen(wire, timeout=10) as response:
                        body = response.read().decode()
                    value = json.loads(body) if not body.startswith('event:') and not body.startswith('data:') else next(
                        json.loads(line[5:].strip()) for line in body.splitlines() if line.startswith('data:'))
                    if 'error' in value:
                        raise RuntimeError(str(value['error']))
                    return value['result']
                except urllib.error.URLError:
                    if method != 'initialize' or time.monotonic() >= until:
                        raise
                    time.sleep(0.1)
        process.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': counter,
                                       'method': method, 'params': params}) + '\n')
        process.stdin.flush()
        until = time.monotonic() + 45
        while time.monotonic() < until:
            if process.poll() is not None:
                raise RuntimeError('MCP exited (' + str(process.returncode) + '): ' + process.stderr.read()[-2000:] + process.stdout.read()[-4000:] + ''.join(diagnostics)[-4000:])
            for key, _ in selector.select(min(1, max(0, until - time.monotonic()))):
                line = key.fileobj.readline()
                diagnostics.append(line[:4096]); del diagnostics[:-64]
                try:
                    value = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if value.get('id') == counter:
                    if 'error' in value:
                        raise RuntimeError(str(value['error']))
                    return value['result']
        raise TimeoutError('MCP response timeout for ' + method)

    try:
        request('initialize', {'protocolVersion': '2025-03-26', 'capabilities': {},
                               'clientInfo': {'name': 'wiki-v2-smoke', 'version': '1'}})
        tools = request('tools/list', {})['tools']
        names = {tool['name'] for tool in tools}
        assert {'search', 'read'} <= names, names
        safe = descriptor == 'mcp-wiki-safe.yaml'
        if safe:
            assert names == {'search', 'read'}, names
        found = request('tools/call', {'name': 'search', 'arguments': {'query': 'transportparameter'}})
        encoded = json.dumps(found)
        assert not found.get('isError'), found
        if safe:
            for forbidden in ['answer.md', str(root), 'passageId', 'generation', 'nativeScore']:
                assert forbidden not in encoded, (forbidden, found)
        else:
            assert 'answer.md' in encoded and 'rankScore' in encoded, found
        def references(value):
            if isinstance(value, dict):
                if isinstance(value.get('reference'), str):
                    yield value['reference']
                for child in value.values():
                    yield from references(child)
            elif isinstance(value, list):
                for child in value:
                    yield from references(child)
            elif isinstance(value, str):
                try:
                    yield from references(json.loads(value))
                except json.JSONDecodeError:
                    pass
        def tool_value(reply):
            if isinstance(reply.get('structuredContent'), dict):
                return reply['structuredContent']
            for item in reply.get('content', []):
                if isinstance(item.get('text'), str):
                    try:
                        return json.loads(item['text'])
                    except json.JSONDecodeError:
                        pass
            raise AssertionError(reply)
        path = next(references(found)) if safe else 'answer.md'
        arguments = {'path': path} if safe else {'path': path, 'section': 'Specific'}
        opened = request('tools/call', {'name': 'read', 'arguments': arguments})
        assert not opened.get('isError') and 'transportparameter' in json.dumps(opened), opened
        if safe:
            assert 'answer.md' not in json.dumps(opened), opened
            replay = tool_value(request('tools/call', {'name': 'read', 'arguments': arguments}))
            assert replay.get('error') == 'invalid-or-expired-reference', replay
            found_again = request('tools/call', {'name': 'search', 'arguments': {'query': 'transportparameter'}})
            next_ref = next(references(found_again))
            exhausted = tool_value(request('tools/call', {'name': 'read', 'arguments': {'reference': next_ref}}))
            assert exhausted.get('error') == 'restricted-budget-exhausted', exhausted
            assert 'answer.md' not in json.dumps(exhausted), exhausted
        record = {'descriptor': descriptor, 'transport': transport, 'tools': sorted(names),
                  'searchPassed': True, 'readPassed': True, 'liveProvider': False}
        if safe:
            record['singleUseAndCumulativeReadQuotaPassed'] = True
        if not safe:
            for tool, args in [('open', {'path': 'answer.md'}),
                               ('navigate', {'path': 'answer.md', 'section': 'Specific'}),
                               ('related', {'path': 'answer.md', 'limit': 2})]:
                tested = request('tools/call', {'name': tool, 'arguments': args})
                assert not tested.get('isError'), (tool, tested)
            arguments = {'path': 'answer.md', 'section': 'Specific', 'maxChars': 9}
            read_fragments = []
            for _ in range(40):
                result = tool_value(request('tools/call', {'name': 'read', 'arguments': arguments}))
                assert not result.get('error') and len(result['body']) <= 9, result
                read_fragments.append(result['body'])
                if not result.get('next'):
                    break
                arguments = result['next']
            assert ''.join(read_fragments).rstrip('\n') == '# Specific\ntransportparameter is the exact late answer.'
            record['readContinuationPassed'] = True
            record['navigationAndRelatedPassed'] = True
            arguments = {'path': 'answer.md', 'pattern': 'transportparameter',
                         'maxChars': 8, 'contextLines': 0, 'limit': 1}
            fragments, match_id = [], None
            for _ in range(40):
                result = tool_value(request('tools/call', {'name': 'grep', 'arguments': arguments}))
                assert not result.get('error'), result
                for match in result['matches']:
                    if match_id is None:
                        match_id = match['matchId']
                    assert match['matchId'] == match_id and len(match['text']) <= 8, result
                    fragments.append(match['text'])
                if not result.get('next'):
                    break
                arguments = result['next']
            assert ''.join(fragments) == 'transportparameter is the exact late answer.', fragments
            record['grepContinuationPassed'] = True
        return record
    finally:
        selector.close()
        try:
            process.stdin.close()
            process.wait(timeout=3)
        except (subprocess.TimeoutExpired, BrokenPipeError):
            if process.poll() is not None:
                return_code = process.returncode
            else:
                os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
        process.stdout.close()
        process.stderr.close()


with tempfile.TemporaryDirectory(prefix='wiki-v2-transport-') as temporary:
    work = Path(temporary)
    root = work / 'wiki'
    root.mkdir()
    (root / 'answer.md').write_text('# Introduction\n' + 'Background text.\n' * 100
                                  + '\n# Specific\ntransportparameter is the exact late answer.\n')
    script = work / 'build.js'
    script.write_text('load("mini-a-common.js");load("mini-a-wiki.js");var m=new MiniAWikiManager('
                      + json.dumps({'backend': 'fs', 'root': str(root), 'access': 'rw', 'wikiretrievalv2': True})
                      + ',function(){});try{var r=m.reindex();if(!r.ok)throw new Error(stringify(r))}finally{m.close()}')
    subprocess.run(['oaf', '-f', str(script)], cwd=REPO, check=True, capture_output=True, text=True)
    transports = os.getenv('WIKI_TRANSPORTS', 'stdio,http').split(',')
    records = [run_server(name, root, work, transport) for transport in transports
               for name in ['mcp-wiki.yaml', 'mcp-wiki-safe.yaml']]
    print('TRANSPORT=' + json.dumps({'results': records, 'liveProvider': False}))
