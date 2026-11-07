#!/usr/bin/env python3
"""Real web routes with a deterministic local agent fixture; no model requests."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.request
import uuid
import socket

ROOT = Path(__file__).resolve().parents[1]


def request(base, route, data=None):
    payload = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(base + route, data=payload, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=10) as response:
        raw = response.read().decode()
        try:
            return json.loads(raw)
        except ValueError as error:
            raise AssertionError("Unexpected HTTP response for " + route + ": " + raw[:1000]) from error


def verify(streaming):
    with tempfile.TemporaryDirectory(prefix='mini-a-web-runs-') as directory:
        tmp = Path(directory)
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        options = dict(onport=port, usehistory=False, usestream=streaming, sessionprewarm=False,
                       useutils=False, usetools=False, useshell=False, webadvanced=False,
                       model='(type: openai, model: fixture, key: fixture)', historypath=str(tmp / 'history'))
        patch = '''
MiniA.prototype.prepareSession = function() {};
MiniA.prototype.init = function() {};
MiniA.prototype.start = function(args) {
  this._stopRequested = false; this.state = "running";
  if (/startup/.test(args.goal)) throw new Error("Fixture startup failure");
  this.fnI("user", args.goal);
  for (var i = 0; i < 20; i++) {
    if (this._stopRequested || this.state === "stop") return;
    if (i === 1) this.fnI("stream", "Provisional fixture answer");
    sleep(100);
  }
  if (/failure/.test(args.goal)) throw new Error("Fixture provider failure");
  return {answer:"Fixture answer"};
};
'''
        libraries = ['js/core/mini-a.js', 'js/web/mini-a-web-attachments.js', 'js/web/mini-a-web-session.js',
                     'js/web/mini-a-web-embed.js', 'js/artifacts/mini-a-artifact-policy.js', 'js/web/mini-a-web-artifacts.js']
        loader = 'loadLib(' + json.dumps(str(ROOT / 'js/mini-a-paths.js')) + '); __miniAPackageRoot = ' + json.dumps(str(ROOT)) + ';' + json.dumps(libraries) + '.forEach(function(p) { loadLib(__miniAPath(p), true) });' + patch
        script = '\n'.join([
            'var config = io.readFileYAML(' + json.dumps(str(ROOT / 'mini-a-web.yaml')) + ')',
            'config.jobs.filter(function(job) { return job.name === "Load web libraries" })[0].exec = ' + json.dumps(loader),
            'config.todo.forEach(function(job) { if (isMap(job) && isDef(job["(httpdStart     )"])) job["((host          ))"] = "127.0.0.1" })',
            'io.writeFileYAML(' + json.dumps(str(tmp / 'fixture.yaml')) + ', config)',
            'oJob(' + json.dumps(str(tmp / 'fixture.yaml')) + ', ' + json.dumps(options) + ')'
        ])
        (tmp / 'fixture.js').write_text(script)
        env = os.environ.copy()
        for name in ['OAF_MODEL', 'OAF_LC_MODEL', 'OAF_VAL_MODEL', 'OAF_VISUAL_MODEL', 'OAF_DECIDE_MODEL']:
            env[name] = options['model']
        with (tmp / 'server.log').open('w+') as log:
            proc = subprocess.Popen(['oaf', '-f', str(tmp / 'fixture.js')], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
            base = 'http://127.0.0.1:' + str(port) + '/'
            try:
                for _ in range(100):
                    try:
                        assert request(base, 'result', {'uuid':str(uuid.uuid4())})['status'] == 'processing'
                        break
                    except Exception:
                        if proc.poll() is not None:
                            raise AssertionError((tmp / 'server.log').read_text())
                        time.sleep(.1)
                else:
                    raise AssertionError('Fixture startup timed out: ' + (tmp / 'server.log').read_text())
                assert request(base, 'info')['usestream'] is streaming
                for goal, expected in [('startup', 'failure'), ('failure', 'failure'), ('cancel', 'cancelled'), ('success', 'success')]:
                    session = str(uuid.uuid4())
                    receipt = request(base, 'prompt', {'uuid': session, 'prompt': goal})
                    assert receipt.get('runId'), receipt
                    if goal == 'cancel':
                        request(base, 'result', {'uuid': session, 'request': 'stop'})
                    for _ in range(100):
                        result = request(base, 'result', {'uuid': session})
                        if result['status'] == 'finished':
                            break
                        time.sleep(.1)
                    else:
                        raise AssertionError('Run never became terminal: ' + str(result))
                    assert result['outcome'] == expected, result
                    assert result['runId'] == receipt['runId'], result
                    assert ('error' in result) == (expected != 'success'), result
                    revision = result['transcriptRevision']
                    unchanged = request(base, 'result', {'uuid': session, 'ifTranscriptRevision': revision})
                    assert unchanged['status'] == 'finished' and unchanged['outcome'] == expected
                    assert 'content' not in unchanged and 'history' not in unchanged
                    assert 'content' in request(base, 'result', {'uuid': session})
                    if streaming and goal == 'success':
                        with urllib.request.urlopen(base + 'stream?uuid=' + session, timeout=10) as response:
                            events = response.read().decode()
                        assert 'Provisional fixture answer' in events and 'done' in events, events
                print('PASS real web HTTP outcomes, revision polling and full snapshots; streaming=' + str(streaming), flush=True)
            except Exception:
                print((tmp / "server.log").read_text()[-8000:])
                raise
            finally:
                proc.terminate()
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    proc.kill(); proc.wait()


if __name__ == '__main__':
    verify(False)
    verify(True)
