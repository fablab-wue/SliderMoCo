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


def load_last_ports():
    try:
        raw = LAST_SERIAL.read_text(encoding="utf-8")
        o = json.loads(raw) or {}
    except Exception:
        return []
    ports = o.get("ports")
    if isinstance(ports, list):
        out = []
        for p in ports:
            p = str(p or "").strip()
            if p:
                out.append(p)
        return out
    p = str(o.get("port") or "").strip()
    return [p] if p else []


def load_last_port():
    ports = load_last_ports()
    return ports[0] if ports else ""


def save_last_ports(ports):
    clean = []
    for p in ports or []:
        p = str(p or "").strip()
        if p and p not in clean:
            clean.append(p)
    try:
        LAST_SERIAL.parent.mkdir(parents=True, exist_ok=True)
        LAST_SERIAL.write_text(json.dumps({"ports": clean}), encoding="utf-8")
    except Exception as exc:
        dbg(2, "last serial save fail", exc)


def save_last_port(port):
    save_last_ports([port] if port else [])


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
    """Up to 8 USB serial SliderMC links on the desktop host."""

    def __init__(self, panel, args):
        self.panel = panel
        self.args = args
        self.web = None
        self.uart = None
        self.current = ""
        self._watch_task = None
        self._lock = asyncio.Lock()
        self._watches = {}

    def _persist(self):
        ports = []
        for slot in self.panel.slots:
            if slot.port:
                ports.append(slot.port)
        save_last_ports(ports)
        self.current = ports[0] if ports else ""

    def snapshot(self, extra=None):
        panel = self.panel
        slots = []
        for slot in panel.slots:
            mc = slot.mc
            slots.append({
                "id": slot.id,
                "port": slot.port,
                "linked": bool(slot.linked) or bool(slot.sim),
                "sim": bool(slot.sim),
                "lost": bool(slot.lost) and not (slot.linked or slot.sim),
                "failed": bool(slot.connect_fail) and not (slot.linked or slot.sim or slot.lost),
                "mc_name": str(getattr(mc, "banner_name", "") or "") if mc else "",
                "error": str(getattr(mc, "link_reason", "") or "") if mc else "",
            })
        prim = slots[0] if slots else {}
        out = {
            "ports": list_serial_ports(),
            "current": prim.get("port") or self.current,
            "last": load_last_port(),
            "linked": bool(prim.get("linked")),
            "sim": bool(prim.get("sim")),
            "error": prim.get("error") or "",
            "mc_name": prim.get("mc_name") or "",
            "slots": slots,
            "mc_limit": int(panel.mc_limit or 8),
            "host": panel.host_kind,
        }
        if extra:
            out.update(extra)
        return out

    async def connect(self, port, mc_id=None, action=None):
        async with self._lock:
            act = str(action or "connect").strip().lower()
            if act == "disconnect":
                return await self._disconnect(mc_id)
            if act == "remove":
                return await self._remove(mc_id)
            return await self._connect(port, mc_id)

    async def restore_last(self):
        for port in load_last_ports():
            await self.connect(port)

    def _port_taken(self, port, except_id=None):
        want = str(port or "").strip().lower()
        for slot in self.panel.slots:
            if except_id is not None and slot.id == except_id:
                continue
            if str(slot.port or "").strip().lower() == want and want:
                return True
        return False

    async def _connect(self, port, mc_id=None):
        port = str(port or "").strip()
        if not port:
            return self.snapshot({"ok": False, "error": "port required"})
        slot = self.panel.slot_by_id(mc_id) if mc_id not in (None, "") else None
        if mc_id not in (None, "") and slot is None:
            return self.snapshot({"ok": False, "error": "no such MC"})
        if self._port_taken(port, None if slot is None else slot.id):
            return self.snapshot({"ok": False, "error": "port in use"})
        fresh = slot is None
        if fresh and len(self.panel.slots) >= int(self.panel.mc_limit or 8):
            return self.snapshot({"ok": False, "error": "MC limit"})
        if fresh:
            slot = self.panel.add_slot(port)
            if slot is None:
                return self.snapshot({"ok": False, "error": "MC limit"})
        if _is_mock_token(port):
            ok, err = await self._bind_mock(slot)
        else:
            ok, err = await self._bind_serial(slot, port)
        if ok:
            self._persist()
            return self.snapshot({"ok": True, "mc_id": slot.id})
        await self._stop_watch(slot.id)
        self.panel.mark_connect_fail(slot)
        self._persist()
        return self.snapshot({"ok": False, "error": err or "connect fail", "mc_id": slot.id})

    async def _disconnect(self, mc_id):
        slot = self.panel.slot_by_id(mc_id)
        if slot is None:
            return self.snapshot({"ok": False, "error": "no such MC"})
        await self._stop_watch(slot.id)
        self._halt_slot(slot)
        await _discard_mc(slot.mc)
        uart = getattr(slot, "_uart", None)
        if uart is not None:
            try:
                uart.close()
            except Exception:
                pass
            slot._uart = None
        slot.user_hold = True
        slot.lost = False
        slot.sim = False
        slot.linked = False
        slot.mc = None
        self.panel.attach_mc(slot, None, sim=False, port=slot.port, linked=False)
        slot.user_hold = True
        slot.lost = False
        self._persist()
        return self.snapshot({"ok": True, "mc_id": slot.id})

    async def _remove(self, mc_id):
        slot = self.panel.slot_by_id(mc_id)
        if slot is None:
            return self.snapshot({"ok": False, "error": "no such MC"})
        await self._drop_slot(slot)
        self._persist()
        return self.snapshot({"ok": True})

    async def _drop_slot(self, slot):
        await self._stop_watch(slot.id)
        self._halt_slot(slot)
        uart = getattr(slot, "_uart", None)
        if uart is not None:
            try:
                uart.close()
            except Exception:
                pass
        await _discard_mc(slot.mc)
        self.panel.remove_slot(slot.id)

    def _halt_slot(self, slot):
        mc = slot.mc if slot is not None else None
        if mc is None:
            return
        try:
            mc._write_line("MS")
        except Exception:
            pass

    async def _stop_watch(self, sid):
        t = self._watches.pop(sid, None)
        if t is None:
            return
        t.cancel()
        try:
            await t
        except (asyncio.CancelledError, Exception):
            pass

    def _ensure_watch(self, slot):
        if slot is None or slot.sim or _is_mock_token(slot.port):
            return
        old = self._watches.get(slot.id)
        if old is not None and not getattr(old, "done", lambda: True)():
            return
        self._watches[slot.id] = asyncio.create_task(self._watch(slot.id))

    async def _bind_mock(self, slot):
        self._halt_slot(slot)
        await self._stop_watch(slot.id)
        uart = getattr(slot, "_uart", None)
        if uart is not None:
            try:
                uart.close()
            except Exception:
                pass
            slot._uart = None
        old = slot.mc
        n = int(getattr(self.args, "axes", 3) or 3)
        mc = MockMC(axis_count=n)
        await mc.start()
        self.panel.attach_mc(slot, mc, sim=True, port="mock", linked=True)
        await _discard_mc(old)
        dbg(3, "mock MC", slot.id, "axes", mc.axis_count)
        return True, ""

    async def _bind_serial(self, slot, port):
        self._halt_slot(slot)
        await self._stop_watch(slot.id)
        old = slot.mc
        old_uart = getattr(slot, "_uart", None)
        if old_uart is not None:
            try:
                old_uart.close()
            except Exception:
                pass
            slot._uart = None
        await _discard_mc(old)
        slot.mc = None
        args = self.args
        try:
            from MC_client import MC_Client
        except Exception as exc:
            dbg(1, "pyserial / MC_client missing", exc)
            return False, "pyserial missing"
        try:
            uart = PyserialUart(port, args.baud, dtr=not args.no_dtr)
        except Exception as exc:
            dbg(2, "serial open fail", exc)
            return False, str(exc) or "open fail"
        slot._uart = uart
        settle_s = max(0.0, float(args.settle_ms) / 1000.0)
        if settle_s > 0:
            dbg(3, "UART settle", args.settle_ms, "ms")
            await asyncio.sleep(settle_s)
        mc = MC_Client(uart=uart, baud=args.baud)
        linked = await self._link(slot, mc, port)
        if not linked:
            dbg(2, "banner miss - pulse DTR reset")
            await uart.pulse_reset()
            if settle_s > 0:
                await asyncio.sleep(settle_s)
            linked = await self._link(slot, mc, port)
        self._ensure_watch(slot)
        if linked:
            return True, ""
        reason = getattr(mc, "link_reason", "timeout") or "timeout"
        return False, reason

    async def _link(self, slot, mc, port_label):
        linked = bool(await mc.start(banner_timeout_s=self.args.banner))
        self.panel.attach_mc(slot, mc, sim=False, port=port_label, linked=linked)
        if linked:
            await self.panel.fetch_slot_session(slot)
            name = getattr(mc, "banner_name", "") or ""
            dbg(3, "serial MC", slot.id, port_label, "axes", mc.axis_count, name)
            return True
        reason = getattr(mc, "link_reason", "timeout") or "timeout"
        dbg(1, "UNLINKED", slot.id, reason)
        return False

    async def _watch(self, sid):
        args = self.args
        settle_s = max(0.0, float(args.settle_ms) / 1000.0)
        while True:
            slot = self.panel.slot_by_id(sid)
            if slot is None or slot.user_hold or slot.sim or _is_mock_token(slot.port):
                await asyncio.sleep(0.5)
                continue
            mc = slot.mc
            uart = getattr(slot, "_uart", None)
            if mc is None or uart is None:
                self.panel.mark_lost(slot)
                await asyncio.sleep(1.0)
                continue
            reboot = bool(getattr(mc, "_reboot_banner", False))
            if getattr(mc, "linked", False) and not reboot:
                await asyncio.sleep(0.25)
                continue
            if reboot:
                mc._reboot_banner = False
                dbg(2, "MC reboot banner - re-identify", sid)
                if await self._link(slot, mc, slot.port):
                    continue
            self.panel.mark_lost(slot)
            if uart.dead or uart.ser is None:
                try:
                    uart.open()
                except Exception as exc:
                    dbg(2, "serial open fail", exc)
                    mc.linked = False
                    mc.link_reason = "lost"
                    await asyncio.sleep(1.0)
                    continue
                if settle_s > 0:
                    await asyncio.sleep(settle_s)
            if not await self._link(slot, mc, slot.port):
                await asyncio.sleep(1.0)
