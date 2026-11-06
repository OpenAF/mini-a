#!/usr/bin/env python3
"""Independent Draft 2020-12 contract validation; development-only jsonschema>=4 required."""
from copy import deepcopy
import json
from pathlib import Path
from jsonschema import Draft202012Validator

base = Path(__file__).resolve().parents[1]
manifest_schema = json.loads((base / 'schemas/mini-a-web-1.0.schema.json').read_text())
protocol_schema = json.loads((base / 'schemas/mini-a-web-protocol-1.0.schema.json').read_text())
for schema in (manifest_schema, protocol_schema):
    Draft202012Validator.check_schema(schema)
manifest = Draft202012Validator(manifest_schema)
protocol = Draft202012Validator(protocol_schema)
examples = [json.loads(path.read_text()) for path in (base / 'examples/web-extensions').glob('*/mini-a-web.json')]
assert len(examples) >= 2
for example in examples:
    manifest.validate(example)
for patch in [
    {'entry': '../index.html'}, {'entry': 'https://example.invalid/editor'},
    {'network': {'origins': ['https://example.invalid']}}, {'unknown': True},
    {'permissions': ['filesystem']}, {'apiVersions': []}
]:
    invalid = deepcopy(examples[0])
    invalid.update(patch)
    assert not manifest.is_valid(invalid), patch

envelope = {'protocol': 'mini-a:web-extension', 'version': '1.0', 'instanceId': 'instance-one'}
content = {'encoding': 'utf8', 'text': 'Olá 🌍'}
artifact = {'handle': 'document-one', 'revision': 1, 'title': 'Title', 'mimeType': 'text/plain', 'readOnly': False}
requests = {
    'initialize': {'apiVersion': '1.0', 'capabilities': ['render'], 'permissions': ['artifact.read'], 'limits': {'nativeBytes': 8388608, 'exportBytes': 16777216}},
    'open': {'artifact': artifact, 'content': content},
    'create': {'title': 'Title', 'mimeType': 'text/plain'},
    'update': {'artifact': artifact, 'content': content},
    'save': {}, 'export': {'mimeType': 'text/plain'}, 'inspect': {},
    'resize': {'width': 640, 'height': 480}, 'focus': {}, 'cancel': {'requestId': 'request-other'}, 'dispose': {}
}
for method, params in requests.items():
    protocol.validate({**envelope, 'kind': 'request', 'id': 'request-one', 'method': method, 'params': params})
results = [
    {'initialized': True}, {'opened': True, 'revision': 1}, {'opened': True, 'editSequence': 2}, {'created': True},
    {'content': content, 'mimeType': 'text/plain', 'editSequence': 2},
    {'content': {'encoding': 'base64', 'data': 'YQ=='}, 'mimeType': 'text/plain'},
    {'metadata': {'cells': 2}}, {'resized': True}, {'focused': True}, {'cancelled': True}, {'disposed': True}
]
for result in results:
    protocol.validate({**envelope, 'kind': 'response', 'id': 'request-one', 'result': result})
events = {
    'dirtyChanged': {'dirty': True, 'editSequence': 2}, 'selectionChanged': {'ids': ['cell-one']},
    'saveRequested': {}, 'closeRequested': {}, 'commit': {'revision': 2, 'editSequence': 2},
    'error': {'code': 'invalid_document', 'message': 'Invalid document'}
}
for event, params in events.items():
    protocol.validate({**envelope, 'kind': 'event', 'event': event, 'params': params})
for invalid in [
    {**envelope, 'kind': 'request', 'id': 'r', 'method': 'fetch', 'params': {}},
    {**envelope, 'kind': 'request', 'id': 'r', 'method': 'save', 'params': {'path': '/etc/passwd'}},
    {**envelope, 'kind': 'event', 'event': 'dirtyChanged', 'params': {'dirty': True, 'editSequence': -1}},
    {**envelope, 'kind': 'response', 'id': 'r', 'result': {}, 'error': {'code': 'e', 'message': 'e', 'retryable': False}}
]:
    assert not protocol.is_valid(invalid), invalid
print('PASS independent JSON Schema validation: shipped manifests, every protocol operation/event and invalid payloads')
