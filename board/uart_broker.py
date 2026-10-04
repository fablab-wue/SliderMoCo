# Pico UART broker — up to two SliderMC links (UART0 + UART1).

try:
    import uasyncio as asyncio
except ImportError:
    import asyncio

import json

import MC_config as cfg
from dbg import dbg


def _uart_ports():
    return [
        {
            "device": "UART0",
            "uart_id": int(getattr(cfg, "UART_ID", 0)),
            "tx": int(getattr(cfg, "PIN_UART_TX", 16)),
            "rx": int(getattr(cfg, "PIN_UART_RX", 17)),
            "desc": "UART0",
        },
        {
            "device": "UART1",
            "uart_id": int(getattr(cfg, "UART1_ID", 1)),
            "tx": int(getattr(cfg, "PIN_UART1_TX", 8)),
            "rx": int(getattr(cfg, "PIN_UART1_RX", 9)),
            "desc": "UART1",
        },
    ]


def _find_port(name):
    want = str(name or "").strip().upper()
    for p in _uart_ports():
        if p["device"].upper() == want:
            return p
    return None


def _load_ports():
    try:
        with open("data/last_serial.json", "r") as f:
            o = json.loads(f.read()) or {}
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
    return []


def _save_ports(ports):
    clean = []
    for p in ports or []:
        p = str(p or "").strip()
        if p and p not in clean:
            clean.append(p)
    try:
        try:
            import os
            os.mkdir("data")
        except OSError:
            pass
        with open("data/last_serial.json", "w") as f:
            f.write(json.dumps({"ports": clean}))
    except Exception as exc:
        dbg(2, "uart list save fail", exc)


class UartBroker:
    def __init__(self, panel):
        self.panel = panel
        self.web = None
        self.current = ""

    def _persist(self):
        ports = []
        for slot in self.panel.slots:
            if slot.port and slot.port != "mock":
                ports.append(slot.port)
        _save_ports(ports)
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
                "failed": bool(getattr(slot, "connect_fail", False)) and not (slot.linked or slot.sim or slot.lost),
                "mc_name": str(getattr(mc, "banner_name", "") or "") if mc else "",
                "error": str(getattr(mc, "link_reason", "") or "") if mc else "",
            })
        prim = slots[0] if slots else {}
        out = {
            "ports": [{"device": p["device"], "desc": p["desc"], "hwid": ""} for p in _uart_ports()],
            "current": prim.get("port") or self.current,
            "last": "",
            "linked": bool(prim.get("linked")),
            "sim": bool(prim.get("sim")),
            "error": prim.get("error") or "",
            "mc_name": prim.get("mc_name") or "",
            "slots": slots,
            "mc_limit": int(panel.mc_limit or 2),
            "host": "pico",
        }
        if extra:
            out.update(extra)
        return out

    async def connect(self, port, mc_id=None, action=None):
        act = str(action or "connect").strip().lower()
        if act == "disconnect":
            return await self._disconnect(mc_id)
        if act == "remove":
            return await self._remove(mc_id)
        return await self._connect(port, mc_id)

    async def restore_or_uart0(self):
        saved = _load_ports()
        if not saved:
            saved = ["UART0"]
        for name in saved:
            await self.connect(name)
        if self.panel.slots:
            return
        await self._mock_slot()

    async def _connect(self, port, mc_id=None):
        spec = _find_port(port)
        if spec is None:
            return self.snapshot({"ok": False, "error": "unknown UART"})
        slot = self.panel.slot_by_id(mc_id) if mc_id not in (None, "") else None
        if mc_id not in (None, "") and slot is None:
            return self.snapshot({"ok": False, "error": "no such MC"})
        for other in self.panel.slots:
            if slot is not None and other.id == slot.id:
                continue
            if str(other.port).upper() == spec["device"]:
                return self.snapshot({"ok": False, "error": "port in use"})
        fresh = slot is None
        if fresh and len(self.panel.slots) >= int(self.panel.mc_limit or 2):
            return self.snapshot({"ok": False, "error": "MC limit"})
        if fresh:
            slot = self.panel.add_slot(spec["device"])
            if slot is None:
                return self.snapshot({"ok": False, "error": "MC limit"})
        ok, err = await self._bind(slot, spec)
        if ok:
            self._persist()
            return self.snapshot({"ok": True, "mc_id": slot.id})
        self.panel.mark_connect_fail(slot)
        self._persist()
        return self.snapshot({"ok": False, "error": err or "connect fail", "mc_id": slot.id})

    async def _bind(self, slot, spec):
        old = slot.mc
        if old is not None:
            try:
                old._write_line("MS")
            except Exception:
                pass
            try:
                if hasattr(old, "stop"):
                    old.stop()
            except Exception:
                pass
        try:
            from MC_client import MC_Client
            mc = MC_Client(uart_id=spec["uart_id"], tx=spec["tx"], rx=spec["rx"])
        except Exception as exc:
            dbg(1, "UART open fail", spec["device"], exc)
            return False, "UART open fail"
        banner_s = 5.0
        try:
            import SW_config as sw
            banner_s = float(getattr(sw, "SW_MC_BANNER_S", 5.0))
        except Exception:
            banner_s = 5.0
        try:
            linked = bool(await mc.start(banner_timeout_s=banner_s))
        except Exception as exc:
            dbg(1, "MC identify fail", exc)
            linked = False
        self.panel.attach_mc(slot, mc, sim=False, port=spec["device"], linked=linked)
        if linked:
            try:
                await self.panel.fetch_slot_session(slot)
            except Exception as exc:
                dbg(3, "hello GE fail", exc)
            dbg(3, "UART MC", slot.id, spec["device"], "axes", getattr(mc, "axis_count", "?"))
            return True, ""
        reason = getattr(mc, "link_reason", "timeout") or "timeout"
        dbg(1, "UNLINKED", spec["device"], reason)
        return False, reason

    async def _disconnect(self, mc_id):
        slot = self.panel.slot_by_id(mc_id)
        if slot is None:
            return self.snapshot({"ok": False, "error": "no such MC"})
        mc = slot.mc
        if mc is not None:
            try:
                mc._write_line("MS")
            except Exception:
                pass
        slot.user_hold = True
        slot.lost = False
        self.panel.attach_mc(slot, None, sim=False, port=slot.port, linked=False)
        slot.user_hold = True
        slot.lost = False
        self._persist()
        return self.snapshot({"ok": True, "mc_id": slot.id})

    async def _remove(self, mc_id):
        slot = self.panel.slot_by_id(mc_id)
        if slot is None:
            return self.snapshot({"ok": False, "error": "no such MC"})
        await self._disconnect(mc_id)
        self.panel.remove_slot(mc_id)
        self._persist()
        return self.snapshot({"ok": True})

    async def _mock_slot(self):
        try:
            import SW_config as sw
            if not bool(getattr(sw, "SW_MC_SIM", True)):
                return
            from mock_mc import MockMC
        except Exception as exc:
            dbg(2, "mock skip", exc)
            return
        slot = self.panel.add_slot("mock")
        if slot is None:
            return
        try:
            mc = MockMC()
            await mc.start()
        except Exception as exc:
            dbg(1, "mock fail", exc)
            self.panel.remove_slot(slot.id)
            return
        self.panel.attach_mc(slot, mc, sim=True, port="mock", linked=True)
        dbg(3, "MC mock on")
