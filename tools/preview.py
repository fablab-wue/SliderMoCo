#!/usr/bin/env python3
"""Back-compat: run the CPython host (mock + WebSocket)."""

import runpy
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.argv = [sys.argv[0]] + sys.argv[1:]
runpy.run_module("server.host", run_name="__main__")
