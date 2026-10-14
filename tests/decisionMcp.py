#!/usr/bin/env python3
"""Exercise the real decision MCP against a local synthetic Ollama endpoint."""
import base64
import concurrent.futures
import json
import os
from pathlib import Path
import queue
import signal
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
IMAGE = base64.b64encode(b'fixture-image').decode()


class Provider(BaseHTTPRequestHandler):
    calls = []
    lock = threading.Lock()

    def log_message(self, *args):
        pass

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        with self.lock:
            self.calls.append(request)
        if self.path == '/api/chat':
            payload = {'model': request['model'], 'message': {'role': 'assistant',
                       'content': json.dumps({'action': 'final', 'answer': 'fixture ready'})},
                       'done': True, 'prompt_eval_count': 10, 'eval_count': 2}
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(payload).encode())
            return
        assert self.path == '/v1/systemone'
        state = request['state']
        if state == 'provider-error':
            self.send_response(429)
            self.end_headers()
            self.wfile.write(b'{"error":"SECRET-PROVIDER-PAYLOAD"}')
            return
        answers = {}
        for key, question in request['questions'].items():
            kind = question['type']
            if kind == 'noul':
                answers[key] = {'type': kind, 'noul': 0.75}
            elif kind == 'choice':
                keys = list(question['criteria'])
                answers[key] = {'type': kind, 'choice': keys[0],
                                'probabilities': {name: float(name == keys[0]) for name in keys}}
            else:
                levels = question['criteria']
                answers[key] = {'type': kind, 'score': 1,
                                'legend': {str(i): value for i, value in enumerate(levels)},
                                'probabilities': {str(i): float(i == 1) for i in range(len(levels))}}
        if state == 'invalid-response':
            answers = {}
        marker = state.get('marker', 10) if isinstance(state, dict) else 10
        payload = {'model': request['model'], 'answers': answers,
                   'usage': {'input_tokens': marker, 'output_tokens': 2}}
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode())


class Process:
    def __init__(self, args, env, stdio=False):
        self.log = tempfile.TemporaryFile()
        self.proc = subprocess.Popen(args, cwd=ROOT, env=env, start_new_session=True,
                                     stdin=subprocess.PIPE if stdio else subprocess.DEVNULL,
                                     stdout=subprocess.PIPE if stdio else self.log,
                                     stderr=self.log, text=True, bufsize=1)
        self.lines = queue.Queue()
        if stdio:
            def read():
                for line in self.proc.stdout:
                    self.lines.put(line)
            threading.Thread(target=read, daemon=True).start()

    def close(self):
        try:
            os.killpg(self.proc.pid, signal.SIGTERM)
            self.proc.wait(timeout=5)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(self.proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            self.proc.wait(timeout=5)
        self.log.close()

    def rpc(self, method, params=None):
        self.proc.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': 1,
                                         'method': method, 'params': params or {}}) + '\n')
        self.proc.stdin.flush()
        try:
            return json.loads(self.lines.get(timeout=20))
        except queue.Empty:
            self.log.seek(0)
            raise AssertionError('No STDIO response: ' + self.log.read().decode()[-2000:])


def content(response):
    result = response['result']
    assert not result.get('isError'), result
    return json.loads(result['content'][0]['text'])


def request(state=None):
    return {'state': state if state is not None else {'ticket': 'Charged twice'}, 'questions': {
        'route': {'type': 'choice', 'instructions': 'Select team',
                  'criteria': {'billing': 'Payments', 'technical': 'Software'}},
        'urgent': {'type': 'boolean', 'instructions': 'Urgent?'},
        'priority': {'type': 'score', 'instructions': 'Rate urgency',
                     'criteria': ['Routine', 'Soon', 'Urgent']}}}


def assert_decision(value, marker=10):
    assert value['response']['contractVersion'] == 1
    assert value['response']['answers']['route']['value'] == 'billing'
    assert value['response']['answers']['urgent']['value'] is True
    assert value['response']['answers']['priority']['level'] == 1
    assert value['stats']['tokens']['total'] == marker + 2
    assert value['response']['answers']['urgent']['probabilitySource'] == 'provider'


def main():
    provider = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
    threading.Thread(target=provider.serve_forever, daemon=True).start()
    config = {'type': 'ollama', 'model': 'fixture',
              'url': f'http://127.0.0.1:{provider.server_port}', 'timeout': 3000,
              'key': 'fixture-secret'}
    env = {**os.environ, 'OAF_DECIDE_MODEL': json.dumps(config)}
    env.pop('OJOB_MCP_AUTH_TOKEN', None)
    stdio = Process(['ojob', 'mcps/mcp-decide.yaml'], env, stdio=True)
    http = None
    try:
        assert stdio.rpc('initialize')['result']['serverInfo']['name'] == 'mini-a-decide'
        tools = stdio.rpc('tools/list')['result']['tools']
        assert {tool['name'] for tool in tools} == {'decide', 'get-capabilities'}
        caps = content(stdio.rpc('tools/call', {'name': 'get-capabilities', 'arguments': {}}))
        assert caps['capabilities']['native']['contract'] == 'verified'
        assert len(Provider.calls) == 0, 'Capability discovery must not contact provider'
        assert 'fixture-secret' not in json.dumps(caps)
        value = content(stdio.rpc('tools/call', {'name': 'decide', 'arguments': request()}))
        assert_decision(value)
        images = request()
        images['options'] = {'images': [IMAGE], 'requireProbabilities': True,
                             'model': 'override', 'providerOptions': {'keepAlive': 0}}
        image_value = content(stdio.rpc('tools/call', {'name': 'decide', 'arguments': images}))
        assert image_value['response']['model'] == 'override'
        assert Provider.calls[-1]['images'] == [IMAGE]
        assert Provider.calls[-1]['keep_alive'] == 0
        before = len(Provider.calls)
        bad_requests = [
            ({'state': 123, 'questions': {}}, 'LLM_DECISION_INVALID_REQUEST'),
            ({**request(), 'url': 'http://untrusted'}, 'LLM_DECISION_INVALID_REQUEST'),
            ({**request(), 'options': {'providerOptions': {'url': 'http://untrusted'}}}, 'LLM_DECISION_INVALID_REQUEST'),
            ({**request(), 'options': {'images': ['/tmp/image.png']}}, 'LLM_DECISION_INVALID_REQUEST')]
        for arguments, code in bad_requests:
            result = stdio.rpc('tools/call', {'name': 'decide', 'arguments': arguments})['result']
            assert result['isError'] is True, result
            assert code in result['content'][0]['text'], result
        assert len(Provider.calls) == before, 'Invalid requests must not contact provider'
        for state, code in [('provider-error', 'LLM_DECISION_PROVIDER_ERROR'),
                            ('invalid-response', 'LLM_DECISION_INVALID_RESPONSE')]:
            result = stdio.rpc('tools/call', {'name': 'decide', 'arguments': request(state)})['result']
            assert result['isError'] is True and code in result['content'][0]['text'], result
            assert 'SECRET-PROVIDER-PAYLOAD' not in json.dumps(result)
        assert len(Provider.calls) == before + 2, 'Errors must not trigger retries'
        print('PASS STDIO discovery, decisions, images, options, validation and typed errors', flush=True)

        # Reserve an ephemeral MCP port; the synthetic provider remains separate.
        import socket
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        http_env = {**env, 'OJOB_MCP_AUTH_TOKEN': 'fixture-bearer'}
        http = Process(['ojob', 'mcps/mcp-decide.yaml', f'onport={port}'], http_env)
        base = f'http://127.0.0.1:{port}'
        deadline = time.monotonic() + 20
        while True:
            try:
                with urllib.request.urlopen(base + '/healthz', timeout=1) as res:
                    assert res.status == 200
                    break
            except (OSError, urllib.error.URLError):
                if time.monotonic() > deadline:
                    http.log.seek(0)
                    raise AssertionError('No HTTP readiness: ' + http.log.read().decode()[-2000:])
                time.sleep(0.2)

        def rpc(method, params=None, token='fixture-bearer'):
            headers = {'Content-Type': 'application/json'}
            if token:
                headers['Authorization'] = 'Bearer ' + token
            body = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method,
                               'params': params or {}}).encode()
            req = urllib.request.Request(base + '/mcp', data=body, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=10) as res:
                    return res.status, json.load(res)
            except urllib.error.HTTPError as error:
                return error.code, None

        assert rpc('initialize', token=None)[0] == 401
        assert rpc('initialize', token='wrong')[0] == 401
        assert rpc('initialize')[0] == 200
        listed = rpc('tools/list')[1]['result']['tools']
        assert {tool['name'] for tool in listed} == {'decide', 'get-capabilities'}
        first_response = rpc('tools/call', {'name': 'decide', 'arguments': request()})[1]
        assert_decision(content(first_response))
        error_result = rpc('tools/call', {'name': 'decide', 'arguments': request('provider-error')})[1]['result']
        assert error_result['isError'] is True, error_result
        assert 'LLM_DECISION_PROVIDER_ERROR' in error_result['content'][0]['text']
        assert 'SECRET-PROVIDER-PAYLOAD' not in json.dumps(error_result)
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            responses = list(pool.map(lambda marker: (marker, rpc('tools/call', {
                'name': 'decide', 'arguments': request({'marker': marker})})[1]), [11, 22, 33]))
        for marker, response in responses:
            assert_decision(content(response), marker)
        print('PASS HTTP discovery, bearer authentication, invocation, typed errors and concurrent usage isolation', flush=True)
        run_env = {**env, 'OAF_MODEL': json.dumps({**config, 'model': 'fixture-main'}),
                   'MINI_A_DECISION_FIXTURE': 'true'}
        for key in ['OAF_LC_MODEL', 'OAF_VAL_MODEL', 'OAF_REFLECT_MODEL']:
            run_env.pop(key, None)
        run = Process(['oaf', '-f', 'tests/decisionRun.js'], run_env)
        try:
            run.proc.wait(timeout=30)
            run.log.seek(0)
            output = run.log.read().decode()
            assert run.proc.returncode == 0 and 'PASS full Mini-A' in output, output[-4000:]
            print('PASS full Mini-A selection, complexity, escalation thresholds and usage totals', flush=True)
        finally:
            run.close()

    finally:
        stdio.close()
        if http:
            http.close()
        provider.shutdown()
        provider.server_close()


if __name__ == '__main__':
    main()
