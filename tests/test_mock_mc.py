# tests/test_mock_mc.py — run: python tests/test_mock_mc.py
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "server", "core"))

from mock_mc import MockMC
from timeline import path_pd_lines


def test_default_three():
    mc = MockMC()
    assert mc.axis_count == 3
    assert mc.getMotorCount() == 3
    assert mc.getServoCount() == 0


def test_six_axes_split():
    mc = MockMC(axis_count=6)
    assert mc.axis_count == 6
    assert mc.getMotorCount() == 3
    assert mc.getServoCount() == 3
    assert mc.slider_min_4 == -180.0
    assert mc.slider_max_4 == 180.0


def test_mt_slot_four():
    mc = MockMC(axis_count=6)
    mc._write_line("MT _ _ _ 10")
    assert mc._tgt[3] == 10.0
    assert mc._tgt[0] is None
    mc.tick(0.25)
    assert mc._pos[3] > 1.0
    line = mc._status_line()
    assert line.startswith("#")
    assert line.count("|") == 5
    groups = line[1:].split("|")
    assert len(groups) == 6


def test_pd_six_tuple():
    mc = MockMC(axis_count=6)
    mc._write_line("PC")
    mc._write_line("PD 0 0 0 1000 0 0")
    mc._write_line("PG")
    before = mc._pos[3]
    mc.tick(0.05)
    assert mc._pos[3] > before
    lines = path_pd_lines([[1, 2, 3, 4, 5, 6]], axis_count=6)
    assert lines[0] == "PD 1 2 3 4 5 6"


def test_axis2_move_axis1_acc_zero():
    mc = MockMC()
    mc._write_line("MT _ 30")
    mc.tick(0.05)
    assert mc._tgt[0] is None
    assert mc._tgt[1] is not None
    assert mc._acc[0] == 0.0
    assert mc._acc[1] > 0.0


if __name__ == "__main__":
    test_default_three()
    test_six_axes_split()
    test_mt_slot_four()
    test_pd_six_tuple()
    test_axis2_move_axis1_acc_zero()
    print("ok")
