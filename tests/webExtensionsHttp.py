#!/usr/bin/env python3
"""Real model-free web job, private state, and optional browser acceptance.

Run python3 tests/webExtensionsHttp.py [--browser chromium|firefox|webkit].
The browser harness uses an explicitly installed development-only Playwright.
"""
import argparse
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

parser = argparse.ArgumentParser()
parser.add_argument('--browser', choices=['chromium', 'firefox', 'webkit'])
parser.add_argument('--base', type=Path, help='Extracted package to execute; tests still come from this checkout')
options = parser.parse_args()
test_base = Path(__file__).resolve().parents[1]
base = (options.base or test_base).resolve()

with tempfile.TemporaryDirectory(prefix='mini-a-web-extensions-') as temporary:
    root = Path(temporary)
    token = 'fixture-' + uuid.uuid4().hex
    session = str(uuid.uuid4())
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    origin = f'http://127.0.0.1:{port}'
    config = root / 'extensions.json'
    config.write_text(json.dumps({'directories': [str(base / 'examples/web-extensions/text-editor')], 'publicOrigin': origin}))
    env = os.environ.copy()
    for key in list(env):
        if key.startswith('OAF_') and 'MODEL' in key:
            env.pop(key)
    env['MINIA_TEST_URL'] = origin
    env['MINIA_TEST_TOKEN'] = token
    env['MINIA_TEST_SESSION'] = session
    checks = 0

    def request(path, action=None, expected=200, auth=True, headers=None):
        global checks
        supplied = {'x-mini-a-token': token} if auth else {}
        supplied.update(headers or {})
        if action is not None:
            supplied['Content-Type'] = 'application/json'
        req = urllib.request.Request(origin + path, data=None if action is None else json.dumps(action).encode(), headers=supplied)
        try:
            response = urllib.request.urlopen(req, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        payload = response.read()
        assert response.status == expected, (path, response.status, payload[:500], log_path.read_text(errors='replace')[-3500:].replace(token, '[token]'))
        checks += 1
        if 'application/json' in response.headers.get('Content-Type', '') or payload[:1] in (b'{', b'['):
            return json.loads(payload)
        return payload

    def launch(log):
        return subprocess.Popen([
            'ojob', str(base / 'mini-a-web.yaml'), f'onport={port}', f'webtoken={token}',
            'webextensions=true', 'webextensionsonly=true', f'webextensionsconfig={config}',
            f'homedir={root / "home"}', f'historypath={root / "history"}',
            'usehistory=false', 'sessionprewarm=false'
        ], cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)

    def ready(process, log_path):
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise AssertionError(log_path.read_text(errors='replace')[-6000:].replace(token, '[token]'))
            try:
                info = request('/info')
                if isinstance(info, dict) and info.get('webextensions', {}).get('enabled'):
                    # /info precedes the legacy prompt/result route declarations in oJob.
                    time.sleep(1)
                    return info
            except (OSError, AssertionError, urllib.error.URLError):
                pass
            time.sleep(0.2)
        raise AssertionError('Server startup timeout: ' + log_path.read_text(errors='replace')[-6000:].replace(token, '[token]'))

    def stop(process):
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)

    log_path = root / 'server.log'
    with log_path.open('w') as log:
        process = launch(log)
        try:
            info = ready(process, log_path)
            assert info['agentAvailable'] is False
            request('/prompt', {'prompt': 'must not initialize a model', 'uuid': session}, expected=503)
            assert request('/prepare', {'uuid': session})['prepared'] is False
            request('/web-extensions?token=' + token, auth=False, expected=401)
            request('/web-extensions', {'action': 'refresh'}, headers={'Origin': 'null'}, expected=403)
            registry = request('/web-extensions')
            extension = next(item for item in registry['extensions'] if item['id'] == 'org.openaf.text-editor')
            request('/web-extensions', {'action': 'enable', 'extensionId': extension['id'], 'digest': extension['digest'], 'permissions': extension['manifest']['permissions']})
            binding = request('/web-extensions', {'action': 'bind', 'extensionId': extension['id'], 'digest': extension['digest'], 'uuid': session})
            saved = request('/web-documents', {'action': 'save', 'uuid': session, 'binding': binding['binding'], 'expectedRevision': 0, 'title': 'HTTP round trip', 'mimeType': 'text/plain', 'filename': 'roundtrip.txt', 'content': {'encoding': 'utf8', 'text': 'Olá — saved without an LLM'}})
            document = saved.get('artifact', saved)
            reopened = request('/web-documents', {'action': 'read', 'uuid': session, 'id': document['id']})
            assert reopened['artifact']['revision'] == 1
            request('/web-documents', {'action': 'save', 'uuid': session, 'binding': binding['binding'], 'id': document['id'], 'expectedRevision': 0, 'title': 'stale', 'mimeType': 'text/plain', 'filename': 'roundtrip.txt', 'content': {'encoding': 'utf8', 'text': 'stale'}}, expected=409)
            request('/web-documents', {'action': 'read', 'uuid': session, 'id': '../secret'}, expected=400)
            request('/web-extensions', {'action': 'release', 'binding': binding['binding']})
            if options.browser:
                subprocess.run(['node', str(test_base / 'tests/browser/webExtensions.spec.cjs'), options.browser], env=env, cwd=base, check=True, timeout=180)
        finally:
            stop(process)
    with log_path.open('a') as log:
        process = launch(log)
        try:
            ready(process, log_path)
            reopened = request('/web-documents', {'action': 'read', 'uuid': session, 'id': document['id']})
            assert reopened['artifact']['revision'] == 1
            assert request('/web-documents', {'action': 'download', 'uuid': session, 'id': document['id']}).decode() == 'Olá — saved without an LLM'
        finally:
            stop(process)
    print(f'PASS {checks} real HTTP checks, model-free startup, private save/reopen and restart')
