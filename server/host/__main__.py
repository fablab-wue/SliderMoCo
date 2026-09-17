# SliderMoCo CPython server — mock or pyserial to one SliderMC.

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BOARD = ROOT / "board"
CORE = ROOT / "server" / "core"
sys.path.insert(0, str(CORE))
sys.path.insert(0, str(BOARD))
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
from mock_mc import MockMC
from panel_app import PanelApp
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


class PyserialUart:
    def __init__(self, port, baud=115200, dtr=True):
        import serial

        self._serial = serial
        self.port = port
        self.baud = int(baud)
        self.dtr = bool(dtr)
        self.ser = None
        self.dead = False
        self.open()

    def open(self):
        if self.ser is not None:
            try:
                self.ser.close()
            except Exception:
                pass
            self.ser = None
        self.dead = False
        ser = self._serial.Serial(
            self.port,
            self.baud,
            timeout=0,
            write_timeout=1,
            dsrdtr=False,
            rtscts=False,
        )
        try:
            ser.dtr = bool(self.dtr)
            ser.rts = bool(self.dtr)
        except Exception:
            pass
        self.ser = ser

    async def pulse_reset(self):
        """Drop then raise DTR so Pico CDC reboots, then leave DTR asserted (monitor-style)."""
        if self.ser is None:
            return
        try:
            self.ser.dtr = False
            self.ser.rts = False
        except Exception:
            self.dead = True
            return
        await asyncio.sleep(0.15)
        try:
            self.ser.dtr = True
            self.ser.rts = True
        except Exception:
            self.dead = True

    def _touch(self):
        if self.ser is None:
            self.dead = True
            raise OSError("serial closed")

    def write(self, data):
        self._touch()
        if not isinstance(data, (bytes, bytearray)):
            data = str(data).encode("ascii")
        try:
            self.ser.write(data)
        except Exception:
            self.dead = True
            raise OSError("serial write")

    def any(self):
        self._touch()
        try:
            return int(self.ser.in_waiting or 0)
        except Exception:
            self.dead = True
            raise OSError("serial read")

    def read(self, n):
        self._touch()
        try:
            return self.ser.read(n) or b""
        except Exception:
            self.dead = True
            raise OSError("serial read")


async def _link_serial(panel, mc, banner_s, port_label):
    linked = bool(await mc.start(banner_timeout_s=banner_s))
    panel.sim = False
    panel.bind_mc(mc)
    if linked:
        panel.linked = True
        await panel._fetch_session_live()
        name = getattr(mc, "banner_name", "") or ""
        dbg(3, "serial MC", port_label, "axes", mc.axis_count, name)
        return True
    reason = getattr(mc, "link_reason", "timeout") or "timeout"
    dbg(1, "UNLINKED", reason)
    panel.linked = False
    return False


async def _serial_watch(panel, uart, mc, args):
    settle_s = max(0.0, float(args.settle_ms) / 1000.0)
    while True:
        reboot = bool(getattr(mc, "_reboot_banner", False))
        if mc.linked and not reboot:
            await asyncio.sleep(0.25)
            continue
        if reboot:
            mc._reboot_banner = False
            dbg(2, "MC reboot banner - re-identify")
            if await _link_serial(panel, mc, args.banner, args.port):
                continue
        if uart.dead or uart.ser is None:
            try:
                uart.open()
            except Exception as exc:
                dbg(2, "serial open fail", exc)
                panel.linked = False
                if getattr(mc, "linked", False):
                    mc.linked = False
                    mc.link_reason = "lost"
                await asyncio.sleep(1.0)
                continue
            if settle_s > 0:
                await asyncio.sleep(settle_s)
        if not await _link_serial(panel, mc, args.banner, args.port):
            await asyncio.sleep(1.0)


async def _run(args):
    wifi = DummyWifi()
    panel = PanelApp(None, None, sim=False)
    web = WebApp(panel, wifi)
    extra = []

    if args.port:
        try:
            from MC_client import MC_Client
            uart = PyserialUart(args.port, args.baud, dtr=not args.no_dtr)
        except ImportError:
            dbg(1, "pyserial missing — pip install pyserial")
            raise
        if args.settle_ms > 0:
            dbg(3, "UART settle", args.settle_ms, "ms")
            await asyncio.sleep(args.settle_ms / 1000.0)
        mc = MC_Client(uart=uart, baud=args.baud)
        linked = await _link_serial(panel, mc, args.banner, args.port)
        if not linked:
            dbg(2, "banner miss - pulse DTR reset")
            await uart.pulse_reset()
            if args.settle_ms > 0:
                await asyncio.sleep(args.settle_ms / 1000.0)
            linked = await _link_serial(panel, mc, args.banner, args.port)
        if (not linked) and args.mock_on_fail:
            dbg(2, "serial identity fail — mock (--mock-on-fail)")
            mc = MockMC()
            await mc.start()
            panel.sim = True
            panel.bind_mc(mc)
            panel.linked = True
        else:
            extra.append(_serial_watch(panel, uart, mc, args))
    else:
        mc = MockMC(axis_count=args.axes)
        await mc.start()
        panel.sim = True
        panel.bind_mc(mc)
        panel.linked = True
        dbg(3, "mock MC axes", mc.axis_count)

    cfg.HTTP_PORT = int(args.http_port)
    dbg(3, "host http", cfg.HTTP_PORT)
    await asyncio.gather(panel.run(), web.run(), *extra)


def main(argv=None):
    p = argparse.ArgumentParser(description="SliderMoCo PC / Raspberry Pi server")
    p.add_argument("--port", default="", help="serial device (omit = mock MC)")
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
