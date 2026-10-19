#!/usr/bin/env python3
"""Offline real OpenAF adapter/timeout checks; no model credentials required."""
import json
import os
from pathlib import Path
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Provider(BaseHTTPRequestHandler):
    calls = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.calls.append((self.path, request['model']))
        if request['model'] == 'slow':
            time.sleep(0.5)
        if self.path == '/v1/systemone':
            labels = request['questions']['inheritance']['criteria']
            payload = {'model': request['model'], 'answers': {'inheritance': {
                'type': 'choice', 'choice': 'memory',
                'probabilities': {key: float(key == 'memory') for key in labels}}},
                'usage': {'input_tokens': 11, 'output_tokens': 3}}
        else:
            assert self.path == '/v1/chat/completions', self.path
            payload = {'model': request['model'], 'choices': [{'finish_reason': 'stop', 'message': {
                'role': 'assistant', 'content': json.dumps({'inheritance': 'memory'})}}],
                'usage': {'prompt_tokens': 11, 'completion_tokens': 3, 'total_tokens': 14}}
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        try:
            self.wfile.write(json.dumps(payload).encode())
        except (BrokenPipeError, ConnectionResetError):
            pass  # The timeout fixture closes its real HTTP connection.


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        env = {key: value for key, value in os.environ.items() if not key.startswith('OAF_')}
        env['MINI_A_FORK_FIXTURE_URL'] = f'http://127.0.0.1:{server.server_port}'
        result = subprocess.run(['openaf', '-f', 'tests/forkPolicyTransport.js'],
                                cwd=Path(__file__).resolve().parents[1], env=env,
                                capture_output=True, text=True, timeout=30)
        assert result.returncode == 0, result.stdout + result.stderr
        assert result.stdout.count('PASS fork policy real') == 3, result.stdout + result.stderr
        assert len(Provider.calls) == 3, f'Unexpected provider retry: {Provider.calls}'
        print(result.stdout.strip())
        print('PASS one HTTP attempt per native, structured and timeout snapshot')
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
