# tests/test_mc_pool.py — multi-MC slot pool, path release, stop-all.
import os
import sys
import asyncio

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "board"))
sys.path.insert(0, os.path.join(ROOT, "server", "core"))

from mock_mc import MockMC
from panel_app import PanelApp


def _log(mc):
    mc.lines = []
    orig = mc._write_line

    def wrapped(line):
        mc.lines.append(str(line).strip())
        return orig(line)

    mc._write_line = wrapped
    return mc


async def _two():
    panel = PanelApp(None, None, sim=False)
    panel.configure_host("desktop", 8)
    a = _log(MockMC(axis_count=2))
    b = _log(MockMC(axis_count=1))
    await a.start()
    await b.start()
    a.mc_config["name"] = "Slider"
    sa = panel.add_slot("COM1")
    sb = panel.add_slot("COM2")
    panel.attach_mc(sa, a, sim=True, port="COM1", linked=True)
    panel.attach_mc(sb, b, sim=True, port="COM2", linked=True)
    return panel, sa, sb, a, b


def test_limit_and_hello():
    panel = PanelApp(None, None, sim=False)
    panel.configure_host("desktop", 2)
    assert panel.add_slot("A") is not None
    assert panel.add_slot("B") is not None
    assert panel.add_slot("C") is None
    hello = panel.hello_dict()
    assert hello["host"] == "desktop"
    assert hello["mc_limit"] == 2
    assert len(hello["mcs"]) == 2
    assert hello["mcs"][0]["id"] == 1
    assert hello["mcs"][1]["port"] == "B"


def test_missing_mc_id_hits_primary():
    async def run():
        panel, sa, sb, a, b = await _two()
        a.lines.clear()
        b.lines.clear()
        assert panel.send_mc_line("MS")
        assert "MS" in a.lines
        assert "MS" not in b.lines
        a.lines.clear()
        panel.send_mc_line("MS", mc_id=sb.id)
        assert "MS" not in a.lines
        assert b.lines[-1] == "MS"

    asyncio.run(run())


def test_release_together_or_not_at_all():
    async def run():
        panel, sa, sb, a, b = await _two()
        panel._path_msg({"cmd": "begin", "mc_id": sa.id, "slice_us": 20000})
        panel._path_msg({"cmd": "data", "mc_id": sa.id, "samples": [[1, 0]]})
        panel._path_msg({"cmd": "go", "mc_id": sa.id, "sync": True})
        panel._path_msg({"cmd": "begin", "mc_id": sb.id, "slice_us": 20000})
        panel._path_msg({"cmd": "data", "mc_id": sb.id, "samples": [[2]]})
        panel._path_msg({"cmd": "go", "mc_id": sb.id, "sync": True})
        a.lines.clear()
        b.lines.clear()
        panel._path_msg({"cmd": "release", "mc_ids": [sa.id, sb.id]})
        assert a.lines[:2] == ["SE 1", "PG"]
        assert b.lines[:2] == ["SE 1", "PG"]
        a.lines.clear()
        b.lines.clear()
        panel._path_msg({"cmd": "begin", "mc_id": sa.id, "slice_us": 20000})
        panel._path_msg({"cmd": "go", "mc_id": sa.id, "sync": True})
        panel._path_msg({"cmd": "release", "mc_ids": [sa.id, sb.id]})
        assert "PG" not in a.lines
        assert "PG" not in b.lines

    asyncio.run(run())


def test_stop_all_and_lost():
    async def run():
        panel, sa, sb, a, b = await _two()
        a.lines.clear()
        b.lines.clear()
        panel.send_mc_all("MS")
        assert a.lines[-1] == "MS"
        assert b.lines[-1] == "MS"
        panel.attach_mc(sb, b, sim=False, port="COM2", linked=True)
        panel.mark_lost(sb)
        pub = panel.slot_public(sb)
        assert pub["lost"] is True
        assert pub["linked"] is False
        sb.user_hold = True
        sb.lost = False
        panel.mark_lost(sb)
        assert sb.lost is False
        panel.attach_mc(sb, b, sim=False, port="COM9", linked=False)
        panel.mark_connect_fail(sb)
        pub = panel.slot_public(sb)
        assert pub["failed"] is True
        assert pub["lost"] is False
        assert pub["linked"] is False
        panel.attach_mc(sb, b, sim=False, port="COM9", linked=True)
        pub = panel.slot_public(sb)
        assert pub["failed"] is False
        assert pub["linked"] is True

    asyncio.run(run())


if __name__ == "__main__":
    test_limit_and_hello()
    test_missing_mc_id_hits_primary()
    test_release_together_or_not_at_all()
    test_stop_all_and_lost()
    print("ok")
