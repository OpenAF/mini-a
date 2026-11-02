#!/usr/bin/env python3
"""Build/extract the explicit oPack manifest and run isolated HTTP smoke checks.

Does not install into or modify the operator's existing OpenAF package registry.
"""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import zipfile

base = Path(__file__).resolve().parents[1]
manifest = (base / ".package.yaml").read_text()
section = manifest.split("\nfiles:\n", 1)[1].split("\nfilesHash:", 1)[0]
files = [line[2:].strip() for line in section.splitlines() if line.startswith("- ")]
assert len(files) == len(set(files)), "Duplicate package members"
required = [p.relative_to(base).as_posix() for p in base.glob("wiki-studio-*.js")]
required += ["mini-a-wiki-studio.yaml", "mini-a-wiki-studio-worker.yaml", "mini-a-launcher.js"]
required += [p.relative_to(base).as_posix() for p in (base / "public/studio").rglob("*") if p.is_file()]
assert all(name in files for name in required), "Production file missing from manifest"
temp = Path(tempfile.mkdtemp(prefix="wiki-studio-package-test-", dir="/private/tmp"))
try:
    package = temp / "package"
    package.mkdir()
    for name in files:
        source = base / name
        assert source.is_file(), "Missing package file: " + name
        target = package / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    result = subprocess.run(["opack", "pack", str(package)], cwd=temp, capture_output=True, text=True, timeout=90)
    assert result.returncode == 0, result.stdout + result.stderr
    archive = next(temp.glob("*.opack"))
    installed = temp / "installed"
    with zipfile.ZipFile(archive) as z:
        assert all(not n.startswith("/") and ".." not in Path(n).parts for n in z.namelist())
        z.extractall(installed)
    assert all((installed / name).is_file() for name in required)
    result = subprocess.run(["python3", str(base / "tests/wikiStudioHttp.py"), "--base", str(installed)], cwd=temp, capture_output=True, text=True, timeout=240)
    print(result.stdout)
    assert result.returncode == 0, result.stderr
    print(f"PASS: explicit manifest ({len(files)} files), generated oPack, extracted install layout and real-worker workflow")
finally:
    if os.environ.get("STUDIO_KEEP_TESTS"):
        print("Retained package fixture:", temp)
    else:
        shutil.rmtree(temp)
