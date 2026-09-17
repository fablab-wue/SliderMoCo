# tests/test_mc_identify.py — run: python tests/test_mc_identify.py
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "board"))

try:
    import uasyncio as asyncio
except ImportError:
    import asyncio

if not hasattr(asyncio, "sleep_ms"):
    async def _sleep_ms(ms):
        await asyncio.sleep(ms / 1000.0)

    asyncio.sleep_ms = _sleep_ms

from MC_client import MC_Client


class FakeUart:
    def __init__(self, banner="# MC V1 - Jochen\n", vp="1"):
        self.rx = bytearray()
        self.tx = b""
        self.banner = banner.encode("ascii")
        self.vp = str(vp)

    def write(self, data):
        if not isinstance(data, (bytes, bytearray)):
            data = str(data).encode("ascii")
        self.tx += data
        line = data.decode("ascii").strip() if data else ""
        if data == b"\n" or line == "VH":
            self.rx += self.banner
            return
        if line == "VP":
            self.rx += ("VP:%s\n" % self.vp).encode("ascii")
        elif line == "CG":
            self.rx += b"CG:axis=1\nCG:max_speed_1=100\n"
        elif line == "GL":
            self.rx += b"GL:0\n"
        elif line == "GR":
            self.rx += b"GR:600\n"

    def any(self):
        return len(self.rx)

    def read(self, n):
        chunk = bytes(self.rx[:n])
        del self.rx[:n]
        return chunk


async def _run_start(uart, timeout_s=1.0):
    mc = MC_Client(uart=uart)
    try:
        linked = await mc.start(banner_timeout_s=timeout_s)
        return mc, linked
    except Exception:
        await mc.stop_rx()
        raise


def _tx_has(mc, token):
    uart = mc._uart
    return token.encode("ascii") in uart.tx


async def test_good_banner_and_vp():
    uart = FakeUart()
    mc, linked = await _run_start(uart)
    try:
        assert linked is True
        assert mc.linked is True
        assert mc.banner_name.startswith("Jochen")
        assert mc.link_reason == "ok"
        assert _tx_has(mc, "SV 1")
        assert _tx_has(mc, "VP")
        assert _tx_has(mc, "CG")
    finally:
        await mc.stop_rx()


async def test_wrong_banner_no_sv():
    uart = FakeUart(banner="# hello\n")
    mc, linked = await _run_start(uart, timeout_s=0.4)
    try:
        assert linked is False
        assert mc.linked is False
        assert mc.link_reason == "timeout"
        assert b"SV" not in uart.tx
        assert b"CG" not in uart.tx
    finally:
        await mc.stop_rx()


async def test_vp_mismatch():
    uart = FakeUart(vp="3")
    mc, linked = await _run_start(uart, timeout_s=0.8)
    try:
        assert linked is False
        assert mc.linked is False
        assert mc.link_reason.startswith("protocol")
        assert b"SV" not in uart.tx
        assert b"CG" not in uart.tx
    finally:
        await mc.stop_rx()


def test_status_i_recovers_enabled():
    uart = FakeUart()
    mc = MC_Client(uart=uart)
    mc._enabled = False
    mc._handle_status("#I 0.00 0.00 0.00")
    assert mc._enabled is True
    mc._handle_status("#D 0.00 0.00 0.00")
    assert mc._enabled is False


def main():
    asyncio.run(test_good_banner_and_vp())
    asyncio.run(test_wrong_banner_no_sv())
    asyncio.run(test_vp_mismatch())
    test_status_i_recovers_enabled()
    print("ok")


if __name__ == "__main__":
    main()
