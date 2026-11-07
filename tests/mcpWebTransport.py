#!/usr/bin/env python3
"""Smoke-test the real web MCP over STDIO and HTTP using only a local fixture.

Run: python3 tests/mcpWebTransport.py
Requires OpenAF, oJob-common and Jsoup. Every MCP uses an isolated temporary cwd
so its .mcp-web.pid cannot affect an existing server.
"""
import json
import os
from pathlib import Path
import queue
import signal
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


DESCRIPTOR = Path(__file__).resolve().parents[1] / 'mcps' / 'mcp-web.yaml'
HTML = '<html><body><p>Olá &amp; 東京 <b>bold</b><script>REMOVE_SCRIPT</script></p></body></html>'
STYLES = (None, 'html', 'basic', 'text', 'map')


class Fixture(BaseHTTPRequestHandler):
    calls = []
    lock = threading.Lock()

    def log_message(self, *args):
        pass

    def do_GET(self):
        with self.lock:
            self.calls.append((self.headers['Host'], self.path))
        body = ('' if self.path.startswith('/empty?') else HTML).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    @classmethod
    def requests(cls):
        with cls.lock:
            return list(cls.calls)


class Server:
    def __init__(self, transport, readwrite):
        self.work = tempfile.TemporaryDirectory(prefix='mcp-web-' + transport + '-')
        self.log = tempfile.TemporaryFile()
        self.transport = transport
        self.counter = 0
        self.lines = queue.Queue()
        self.reader = None
        self.http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        args = ['ojob', str(DESCRIPTOR), 'readwrite=' + str(readwrite).lower()]
        if transport == 'http':
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0))
                port = probe.getsockname()[1]
            self.base = f'http://127.0.0.1:{port}'
            args += [f'onport={port}', 'host=127.0.0.1']
        env = {key: value for key, value in os.environ.items()
               if not key.startswith('OJOB_MCP_')}
        try:
            self.proc = subprocess.Popen(
                args, cwd=self.work.name, env=env, start_new_session=True,
                stdin=subprocess.PIPE if transport == 'stdio' else subprocess.DEVNULL,
                stdout=subprocess.PIPE if transport == 'stdio' else self.log,
                stderr=self.log, text=True, encoding='utf-8', bufsize=1)
        except BaseException:
            self.log.close()
            self.work.cleanup()
            raise
        if transport == 'stdio':
            def read():
                for line in self.proc.stdout:
                    self.lines.put(line)
                self.lines.put(None)
            self.reader = threading.Thread(target=read, daemon=True)
            self.reader.start()

    def diagnostics(self):
        self.log.seek(0)
        return self.log.read().decode('utf-8', errors='replace')[-4000:]

    def ready(self):
        if self.transport == 'stdio':
            return
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline and self.proc.poll() is None:
            try:
                with self.http.open(self.base + '/healthz', timeout=1) as response:
                    if response.status == 200:
                        return
            except (OSError, urllib.error.URLError):
                time.sleep(0.1)
        raise AssertionError('HTTP MCP did not start: ' + self.diagnostics())

    def rpc(self, method, params=None):
        self.counter += 1
        request = {'jsonrpc': '2.0', 'id': self.counter,
                   'method': method, 'params': params or {}}
        if self.transport == 'http':
            wire = urllib.request.Request(
                self.base + '/mcp', data=json.dumps(request).encode('utf-8'),
                headers={'Content-Type': 'application/json'})
            with self.http.open(wire, timeout=15) as response:
                result = json.load(response)
        else:
            self.proc.stdin.write(json.dumps(request) + '\n')
            self.proc.stdin.flush()
            try:
                line = self.lines.get(timeout=30)
            except queue.Empty:
                raise AssertionError('STDIO MCP timed out: ' + self.diagnostics())
            assert line is not None, 'STDIO MCP exited: ' + self.diagnostics()
            # STDOUT must contain only MCP responses.
            result = json.loads(line)
        assert result.get('id') == self.counter, result
        assert 'error' not in result, result
        return result['result']

    def close(self):
        try:
            if self.proc.poll() is None:
                os.killpg(self.proc.pid, signal.SIGTERM)
            self.proc.wait(timeout=5)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(self.proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            self.proc.wait(timeout=5)
        finally:
            if self.proc.stdin:
                self.proc.stdin.close()
            if self.reader:
                self.reader.join(timeout=2)
            if self.proc.stdout:
                self.proc.stdout.close()
            self.log.close()
            self.work.cleanup()


def tool_value(result):
    assert not result.get('isError'), result
    content = result['content']
    assert len(content) == 1 and content[0]['type'] == 'text', result
    value = content[0]['text']
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value


def check_output(value, style, empty):
    if style in (None, 'html'):
        # OpenAF $rest maps an empty HTTP body to {}; get-url preserves that result.
        assert value == ({} if empty else HTML), value
    elif style == 'basic':
        assert value == ('' if empty else '<p>Olá &amp; 東京 <b>bold</b></p>'), value
    elif style == 'text':
        assert value == ('' if empty else 'Olá &amp; 東京 <b>bold</b>'), value
    else:
        assert isinstance(value, list) and len(value) == 1, value
        html = value[0]
        assert html['tag'] == 'html' and html['childsSize'] == 2, value
        assert html['hasText'] is (not empty), value
        assert html['childs'][0] == [], value
        if empty:
            assert html['childs'][1] == [], value
        else:
            paragraph = html['childs'][1][0]
            assert paragraph['tag'] == 'p' and paragraph['text'] == 'Olá & 東京', value
            assert paragraph['childsSize'] == 1, value
        assert 'REMOVE_SCRIPT' not in json.dumps(value), value


def smoke(transport, fixture, readwrite):
    server = Server(transport, readwrite)
    try:
        server.ready()
        initialized = server.rpc('initialize', {
            'protocolVersion': '2024-11-05', 'capabilities': {},
            'clientInfo': {'name': 'mcp-web-smoke', 'version': '1'}})
        assert initialized['serverInfo']['name'] == 'mini-a-web', initialized
        tools = server.rpc('tools/list')['tools']
        get_url = next(tool for tool in tools if tool['name'] == 'get-url')
        assert get_url['inputSchema']['properties']['style']['default'] == 'html', get_url
        for empty in ([False, True] if readwrite else [False]):
            for style in STYLES:
                path = ('/empty' if empty else '/page') + '?style=' + (style or 'omitted') + '&entity=%26'
                host = f'127.0.0.1:{fixture.server_port}'
                arguments = {'url': 'http://' + host + path}
                if style is not None:
                    arguments['style'] = style
                before = len(Fixture.requests())
                value = tool_value(server.rpc('tools/call', {'name': 'get-url', 'arguments': arguments}))
                if readwrite:
                    try:
                        check_output(value, style, empty)
                    except AssertionError as error:
                        raise AssertionError(f'{transport} style={style} empty={empty}: {value!r}') from error
                    assert Fixture.requests()[before:] == [(host, path)], Fixture.requests()[before:]
                else:
                    assert value == '[ERROR] Read-only mode blocks localhost/private/non-http URLs', value
                    assert len(Fixture.requests()) == before, Fixture.requests()[before:]
        cases = 'all styles, empty bodies and one original-URL fetch per call' if readwrite else 'read-only policy blocks all styles with zero fetches'
        print(f'PASS {transport.upper()} discovery; {cases}', flush=True)
    finally:
        server.close()


def main():
    fixture = ThreadingHTTPServer(('127.0.0.1', 0), Fixture)
    thread = threading.Thread(target=fixture.serve_forever, daemon=True)
    thread.start()
    try:
        for transport in ('stdio', 'http'):
            # Only the fixture-fetching server opts into local URL access.
            smoke(transport, fixture, readwrite=True)
            smoke(transport, fixture, readwrite=False)
    finally:
        fixture.shutdown()
        fixture.server_close()
        thread.join(timeout=2)


if __name__ == '__main__':
    main()
