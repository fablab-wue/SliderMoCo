#!/usr/bin/env python3
"""Flatten board + www + core into dist/pico for mpremote / Thonny."""

from __future__ import annotations

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DST = ROOT / "dist" / "pico"


def main():
    if DST.exists():
        shutil.rmtree(DST)
    DST.mkdir(parents=True)
    for src in (ROOT / "board").iterdir():
        if src.name == "www":
            continue
        if src.name.startswith("."):
            continue
        dest = DST / src.name
        if src.is_dir():
            shutil.copytree(src, dest)
        else:
            shutil.copy2(src, dest)
    shutil.copytree(ROOT / "www", DST / "www")
    for name in ("timeline.py", "mock_mc.py"):
        shutil.copy2(ROOT / "server" / "core" / name, DST / name)
    print("packed", DST)


if __name__ == "__main__":
    main()
