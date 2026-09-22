# CPython-only SliderMC serial broker — list ports and hot-swap UART / mock.

from __future__ import annotations

import json
from pathlib import Path

try:
    import uasyncio as asyncio
except ImportError:
    import asyncio

from dbg import dbg
from mock_mc import MockMC

ROOT = Path(__file__).resolve().parents[2]
LAST_SERIAL = Path(str(ROOT / "data" / "last_serial.json"))


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

    def close(self):
        self.dead = True
        ser = self.ser
        self.ser = None
        if ser is None:
            return
        try:
            ser.close()
        except Exception:
            pass

    async def pulse_reset(self):
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


def load_last_port():
    try:
        raw = LAST_SERIAL.read_text(encoding="utf-8")
        o = json.loads(raw)
        p = str((o or {}).get("port") or "").strip()
        return p
    except Exception:
        return ""


def save_last_port(port):
    port = str(port or "").strip()
    if not port:
        return
    try:
        LAST_SERIAL.parent.mkdir(parents=True, exist_ok=True)
        LAST_SERIAL.write_text(json.dumps({"port": port}), encoding="utf-8")
    except Exception as exc:
        dbg(2, "last serial save fail", exc)


def list_serial_ports():
    try:
        from serial.tools import list_ports
    except ImportError:
        return []
    out = []
    try:
        ports = list_ports.comports()
    except Exception:
        return []
    for p in ports:
        device = str(getattr(p, "device", "") or "")
        if not device:
            continue
        out.append({
            "device": device,
            "desc": str(getattr(p, "description", "") or ""),
            "hwid": str(getattr(p, "hwid", "") or ""),
        })
    return out


def _is_mock_token(port):
    p = str(port or "").strip().lower()
    return p in ("", "mock", "sim", "none")


async def _discard_mc(mc):
    if mc is None:
        return
    try:
        if hasattr(mc, "stop"):
            mc.stop()
    except Exception:
        pass
    task = getattr(mc, "_rx_task", None)
    if task is not None:
        try:
            task.cancel()
        except Exception:
            pass
        try:
            mc._rx_task = None
        except Exception:
            pass
        try:
            await asyncio.sleep(0)
        except Exception:
            pass


class SerialBroker:
    def __init__(self, panel, args):
        self.panel = panel
        self.args = args
        self.web = None
        self.uart = None
        self.current = ""
        self._watch_task = None
        self._lock = asyncio.Lock()

    def snapshot(self, extra=None):
        panel = self.panel
        mc = panel.mc
        reason = ""
        name = ""
        if mc is not None:
            reason = str(getattr(mc, "link_reason", "") or "")
            name = str(getattr(mc, "banner_name", "") or "")
        out = {
            "ports": list_serial_ports(),
            "current": self.current,
            "last": load_last_port(),
            "linked": bool(panel.linked) or bool(panel.sim),
            "sim": bool(panel.sim),
            "error": reason,
            "mc_name": name,
        }
        if extra:
            out.update(extra)
        return out

    async def connect(self, port):
        async with self._lock:
            return await self._connect(port)

    async def _connect(self, port):
        port = str(port or "").strip()
        if _is_mock_token(port):
            return await self._bind_mock()
        return await self._bind_serial(port)

    def _halt_motion(self):
        panel = self.panel
        try:
            if getattr(panel, "tasks", None) is not None:
                panel.tasks.cancel("serial")
        except Exception:
            pass
        try:
            panel.send_mc_line("MS", mirror=False)
        except Exception:
            try:
                panel._stop()
            except Exception:
                pass

    async def _cancel_watch(self):
        t = self._watch_task
        self._watch_task = None
        if t is None:
            return
        t.cancel()
        try:
            await t
        except (asyncio.CancelledError, Exception):
            pass

    def _ensure_watch(self):
        if self._watch_task is not None and not getattr(self._watch_task, "done", lambda: True)():
            return
        if self.uart is None or _is_mock_token(self.current):
            return
        self._watch_task = asyncio.create_task(self._watch())

    async def _bind_mock(self):
        self._halt_motion()
        await self._cancel_watch()
        old = self.panel.mc
        if self.uart is not None:
            try:
                self.uart.close()
            except Exception:
                pass
            self.uart = None
        n = int(getattr(self.args, "axes", 3) or 3)
        mc = MockMC(axis_count=n)
        await mc.start()
        self.panel.sim = True
        self.panel.bind_mc(mc)
        self.panel.linked = True
        self.current = "mock"
        save_last_port("mock")
        await _discard_mc(old)
        dbg(3, "mock MC axes", mc.axis_count)
        return self.snapshot({"ok": True})

    async def _bind_serial(self, port):
        self._halt_motion()
        await self._cancel_watch()
        old = self.panel.mc
        old_uart = self.uart
        if old_uart is not None:
            try:
                old_uart.close()
            except Exception:
                pass
            self.uart = None
        await _discard_mc(old)
        self.panel.sim = False
        self.panel.linked = False
        self.current = port
        args = self.args
        try:
            from MC_client import MC_Client
        except Exception as exc:
            dbg(1, "pyserial / MC_client missing", exc)
            self.panel.bind_mc(None)
            return self.snapshot({"ok": False, "error": "pyserial missing"})
        try:
            uart = PyserialUart(port, args.baud, dtr=not args.no_dtr)
        except Exception as exc:
            dbg(2, "serial open fail", exc)
            self.panel.bind_mc(None)
            return self.snapshot({"ok": False, "error": str(exc) or "open fail"})
        self.uart = uart
        settle_s = max(0.0, float(args.settle_ms) / 1000.0)
        if settle_s > 0:
            dbg(3, "UART settle", args.settle_ms, "ms")
            await asyncio.sleep(settle_s)
        mc = MC_Client(uart=uart, baud=args.baud)
        linked = await self._link(mc, port)
        if not linked:
            dbg(2, "banner miss - pulse DTR reset")
            await uart.pulse_reset()
            if settle_s > 0:
                await asyncio.sleep(settle_s)
            linked = await self._link(mc, port)
        self._ensure_watch()
        if linked:
            save_last_port(port)
            return self.snapshot({"ok": True})
        reason = getattr(mc, "link_reason", "timeout") or "timeout"
        return self.snapshot({"ok": False, "error": reason})

    async def _link(self, mc, port_label):
        linked = bool(await mc.start(banner_timeout_s=self.args.banner))
        self.panel.sim = False
        self.panel.bind_mc(mc)
        if linked:
            self.panel.linked = True
            await self.panel._fetch_session_live()
            name = getattr(mc, "banner_name", "") or ""
            dbg(3, "serial MC", port_label, "axes", mc.axis_count, name)
            return True
        reason = getattr(mc, "link_reason", "timeout") or "timeout"
        dbg(1, "UNLINKED", reason)
        self.panel.linked = False
        return False

    async def _watch(self):
        args = self.args
        settle_s = max(0.0, float(args.settle_ms) / 1000.0)
        while True:
            if _is_mock_token(self.current) or self.uart is None:
                await asyncio.sleep(0.5)
                continue
            mc = self.panel.mc
            uart = self.uart
            if mc is None:
                await asyncio.sleep(0.5)
                continue
            reboot = bool(getattr(mc, "_reboot_banner", False))
            if getattr(mc, "linked", False) and not reboot:
                await asyncio.sleep(0.25)
                continue
            if reboot:
                mc._reboot_banner = False
                dbg(2, "MC reboot banner - re-identify")
                if await self._link(mc, self.current):
                    continue
            if uart.dead or uart.ser is None:
                try:
                    uart.open()
                except Exception as exc:
                    dbg(2, "serial open fail", exc)
                    self.panel.linked = False
                    if getattr(mc, "linked", False):
                        mc.linked = False
                        mc.link_reason = "lost"
                    await asyncio.sleep(1.0)
                    continue
                if settle_s > 0:
                    await asyncio.sleep(settle_s)
            if not await self._link(mc, self.current):
                await asyncio.sleep(1.0)
