# SliderMoCo CPython server — mock or pyserial to one SliderMC.

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BOARD = ROOT / "board"
CORE = ROOT / "server" / "core"
HOST = Path(__file__).resolve().parent
sys.path.insert(0, str(CORE))
sys.path.insert(0, str(BOARD))
sys.path.insert(0, str(HOST))
os.chdir(str(ROOT))

try:
    import uasyncio as asyncio
except ImportError:
    import asyncio

if not hasattr(asyncio, "sleep_ms"):
    async def _sleep_ms(ms):
        await asyncio.sleep(ms / 1000.0)

    asyncio.sleep_ms = _sleep_ms

import SW_config as cfg

cfg.HTTP_PORT = int(getattr(cfg, "HTTP_PORT", 8080) or 8080)
if cfg.HTTP_PORT == 80:
    cfg.HTTP_PORT = 8080
cfg.DATA_DIR = str(ROOT / "data")
cfg.WWW_DIR = "www"
cfg.SW_BOOT_DELAY_S = 0

from dbg import dbg
from panel_app import PanelApp
from serial_broker import SerialBroker
from web_app import WebApp


class DummyWifi:
    def __init__(self):
        self._saw_http = False
        self.ap_ip = "127.0.0.1"

    def public_status(self):
        return {
            "mode": "host",
            "ip": "127.0.0.1",
            "ap_ssid": "SliderMoCo",
            "hostname": "localhost",
            "ssid": "",
            "has_password": False,
            "sta_configured": False,
        }

    async def apply_saved(self, ssid, password, hostname=None):
        return self.public_status()

    async def forget(self):
        return self.public_status()


async def _run(args):
    wifi = DummyWifi()
    panel = PanelApp(None, None, sim=False)
    broker = SerialBroker(panel, args)
    panel.serial = broker
    web = WebApp(panel, wifi)
    broker.web = web

    if args.port:
        result = await broker.connect(args.port)
        if (not result.get("ok")) and args.mock_on_fail:
            dbg(2, "serial identity fail — mock (--mock-on-fail)")
            await broker.connect("mock")
    else:
        dbg(3, "no --port — wait for COM dialog")

    cfg.HTTP_PORT = int(args.http_port)
    dbg(3, "host http", cfg.HTTP_PORT)
    await asyncio.gather(panel.run(), web.run())


def main(argv=None):
    p = argparse.ArgumentParser(description="SliderMoCo PC / Raspberry Pi server")
    p.add_argument("--port", default="", help="serial device (omit = pick in the GUI)")
    p.add_argument("--baud", type=int, default=115200)
    p.add_argument("--http-port", type=int, default=8080)
    p.add_argument("--banner", type=float, default=5.0)
    p.add_argument("--settle-ms", type=int, default=1000, help="delay after open before banner")
    p.add_argument("--no-dtr", action="store_true", help="leave DTR/RTS low (default is asserted, like a serial monitor)")
    p.add_argument("--mock-on-fail", action="store_true", help="use MockMC if identity fails")
    p.add_argument("--axes", type=int, default=3, help="mock axis count 1–6")
    args = p.parse_args(argv)
    if args.axes < 1:
        args.axes = 1
    if args.axes > 6:
        args.axes = 6
    asyncio.run(_run(args))


if __name__ == "__main__":
    main()
