#!/usr/bin/env python3
"""Disposable real draw.io workspace; requires explicitly prepared local assets.

python3 tests/webDrawioHttp.py --editor /path/to/prepared/editor --browser chromium
Never changes production grants or downloads editor/browser dependencies.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--editor', type=Path, required=True)
parser.add_argument('--browser', choices=['chromium', 'firefox', 'webkit'], default='chromium')
args = parser.parse_args()
base = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('drawio_prepare', base / 'examples/web-extensions/drawio/prepare-editor.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)
editor = args.editor.resolve(strict=True)
mount_digest = prepare.inventory(editor)['sha256']
root = Path(tempfile.mkdtemp(prefix='mini-a-drawio-http-'))
token = 'fixture-' + uuid.uuid4().hex
with socket.socket() as listener:
    listener.bind(('127.0.0.1', 0))
    port = listener.getsockname()[1]
origin = f'http://127.0.0.1:{port}'
config = root / 'extensions.json'
settings = {
    'directories': [str(base / 'examples/web-extensions/drawio')],
    'publicOrigin': origin,
    'mounts': {'org.openaf.drawio': {'editor': {'path': str(editor), 'sha256': mount_digest}}}
}
config.write_text(json.dumps(settings))
env = os.environ.copy()
for key in list(env):
    if key.startswith('OAF_') and 'MODEL' in key:
        env.pop(key)
env.update(MINIA_TEST_URL=origin, MINIA_TEST_TOKEN=token, MINIA_DRAWIO_DIAGNOSTICS=str(root))
log_path = root / 'server.log'


def request(path, data=None):
    headers = {'x-mini-a-token': token, 'Content-Type': 'application/json'}
    query = urllib.request.Request(origin + path, data=None if data is None else json.dumps(data).encode(), headers=headers)
    try:
        with urllib.request.urlopen(query, timeout=120) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        raise AssertionError((error.code, error.read().decode())) from error


def launch(log):
    return subprocess.Popen([
        'ojob', str(base / 'mini-a-web.yaml'), f'onport={port}', f'webtoken={token}',
        'webextensions=true', 'webextensionsonly=true', f'webextensionsconfig={config}',
        f'homedir={root / "home"}', f'historypath={root / "history"}',
        'usehistory=false', 'sessionprewarm=false'
    ], cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)


def ready(process):
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise AssertionError(log_path.read_text(errors='replace')[-6000:].replace(token, '[token]'))
        try:
            info = request('/info')
            if info.get('webextensions', {}).get('enabled'):
                assert info['agentAvailable'] is False
                time.sleep(1)
                return
        except (OSError, urllib.error.URLError, AssertionError, ValueError):
            pass
        time.sleep(0.2)
    raise AssertionError('Startup timeout: ' + log_path.read_text(errors='replace')[-6000:].replace(token, '[token]'))


def stop(process):
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)


try:
    print('Starting disposable draw.io '+args.browser+' workspace: '+str(root), flush=True)
    with log_path.open('w') as log:
        process = launch(log)
        try:
            ready(process)
            print('Verifying default draw.io release gate', flush=True)
            registry = request('/web-extensions')
            extension = next((item for item in registry['extensions'] if item['id'] == 'org.openaf.drawio'), None)
            assert extension, registry
            assert extension['status'] == 'unavailable' and 'conformance' in extension['reason'].lower(), extension
            settings['conformance'] = {'org.openaf.drawio': {'digest': extension['digest'], 'gates': ['drawio-opaque-v1']}}
        finally:
            stop(process)
    # The conformance override exists ONLY in this disposable test server.
    config.write_text(json.dumps(settings))
    with log_path.open('a') as log:
        process = launch(log)
        try:
            ready(process)
            print('Testing local editor with temporary conformance record', flush=True)
            registry = request('/web-extensions')
            extension = next(item for item in registry['extensions'] if item['id'] == 'org.openaf.drawio')
            assert extension['status'] == 'disabled', extension
            request('/web-extensions', {'action': 'enable', 'extensionId': extension['id'], 'digest': extension['digest'], 'permissions': extension['manifest']['permissions']})
            subprocess.run(['node', str(base / 'tests/browser/drawioExtension.spec.cjs'), args.browser], cwd=base, env=env, check=True, timeout=480)
        finally:
            stop(process)
    print('PASS draw.io gate enforcement and disposable real-browser workspace')
finally:
    print('Draw.io test diagnostics: ' + str(root))
