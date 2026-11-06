#!/usr/bin/env python3
"""Pack/extract the real oPack file list and run model-free HTTP from an unrelated cwd."""
from pathlib import Path
import hashlib
import re
import shutil
import subprocess
import tempfile
import zipfile

base = Path(__file__).resolve().parents[1]
text = (base / '.package.yaml').read_text()
section = text.split('\nfiles:\n', 1)[1].split('\nfilesHash:', 1)[0]
files = [line[2:].strip() for line in section.splitlines() if line.startswith('- ')]
hashes = dict(re.findall(r'^  ([^:]+): ([a-f0-9]+)$', text.split('\nfilesHash:', 1)[1], re.M))
required = [
    'js/web/mini-a-web-extensions.js', 'js/web/mini-a-web-documents.js',
    'js/web/mini-a-web-document-agent.js', 'js/artifacts/mini-a-document-tools.js',
    'js/skills/mini-a-plugin-paths.js'
]
for pattern in ['public/web-extension*', 'schemas/mini-a-web*', 'docs/WEB-EXTENSIONS*', 'examples/web-extensions/**/*']:
    required.extend(p.relative_to(base).as_posix() for p in base.glob(pattern) if p.is_file() and '__pycache__' not in p.parts)
assert len(files) == len(set(files)), 'Duplicate package member'
assert all(name in files for name in required), 'Missing extension package file'
for name in required:
    assert hashes.get(name) == hashlib.sha1((base / name).read_bytes()).hexdigest(), 'Stale package hash: ' + name
assert not any('/editor/' in name or '__pycache__' in name for name in files if name.startswith('examples/web-extensions/'))
with tempfile.TemporaryDirectory(prefix='mini-a-extensions-package-') as temporary:
    root = Path(temporary)
    package = root / 'package'
    package.mkdir()
    for name in files:
        source = base / name
        assert source.is_file(), 'Missing existing package file: ' + name
        target = package / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    packed = subprocess.run(['opack', 'pack', str(package)], cwd=root, capture_output=True, text=True, timeout=90)
    assert packed.returncode == 0, packed.stdout + packed.stderr
    installed = root / 'installed'
    with zipfile.ZipFile(next(root.glob('*.opack'))) as archive:
        assert all(not name.startswith('/') and '..' not in Path(name).parts for name in archive.namelist())
        archive.extractall(installed)
    result = subprocess.run(['python3', str(base / 'tests/webExtensionsHttp.py'), '--base', str(installed)], cwd=root, capture_output=True, text=True, timeout=180)
    print(result.stdout)
    assert result.returncode == 0, result.stderr
    print(f'PASS {len(required)} extension package files/hashes, real oPack extraction and unrelated-cwd HTTP round trip')
