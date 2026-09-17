# tests/test_timeline.py — run: python tests/test_timeline.py
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "server", "core"))

from timeline import (
    eval_axis_at,
    sample_path,
    path_pd_lines,
    duration_s,
    bake_legacy_keys,
    apply_auto_linear_lane,
)


def test_linear():
    keys = [
        {"t": 0, "value": 0, "interp": "linear"},
        {"t": 2, "value": 100, "interp": "linear"},
    ]
    assert abs(eval_axis_at(keys, 1.0) - 50.0) < 1e-6
    assert abs(eval_axis_at(keys, 0.0) - 0.0) < 1e-6
    assert abs(eval_axis_at(keys, 2.0) - 100.0) < 1e-6


def test_sample_deltas():
    lanes = [
        {
            "id": 1,
            "keys": [
                {"t": 0, "value": 0, "interp": "linear"},
                {"t": 1, "value": 10, "interp": "linear"},
            ],
        }
    ]
    out = sample_path(lanes, slice_us=100000)  # 0.1 s
    assert out["n"] >= 10
    total_um = sum(row[0] for row in out["samples"])
    assert abs(total_um - 10000) < 50  # 10 mm → 10000 µm
    lines = path_pd_lines(out["samples"], axis_count=1)
    assert lines[0].startswith("PD ")


def test_linear_handles_match_lerp():
    dt = 2.0
    chord = 50.0
    keys = [
        {
            "t": 0,
            "value": 0,
            "interp": "aligned",
            "out": {"dx": dt / 3, "dy": chord * (dt / 3)},
            "in": {"dx": -0.3, "dy": 0},
        },
        {
            "t": 2,
            "value": 100,
            "interp": "aligned",
            "in": {"dx": -dt / 3, "dy": chord * (-dt / 3)},
            "out": {"dx": 0.3, "dy": 0},
        },
    ]
    for t in (0.5, 1.0, 1.5):
        expect = 50.0 * t
        assert abs(eval_axis_at(keys, t) - expect) < 1e-3


def test_bake_ease_inout():
    keys = [
        {"t": 0, "value": 0, "interp": "ease_inout"},
        {"t": 6, "value": 45, "interp": "linear"},
    ]
    old_mid = eval_axis_at(keys, 3.0)
    baked = bake_legacy_keys([dict(k) for k in keys])
    assert baked[0]["interp"] in ("aligned", "free")
    assert baked[1]["interp"] != "linear" or abs(baked[1]["in"]["dy"]) < 1e-9
    assert abs(eval_axis_at(baked, 3.0) - old_mid) < 1e-3
    assert abs(baked[0]["out"]["dy"]) < 1e-9
    assert abs(baked[1]["in"]["dy"]) < 1e-9


def test_bake_smooth_and_bezier():
    keys = bake_legacy_keys(
        [
            {"t": 0, "value": 0, "interp": "smooth", "in": {"dx": -0.4, "dy": 0}, "out": {"dx": 0.8, "dy": 0}},
            {"t": 2, "value": 10, "interp": "bezier", "in": {"dx": -0.8, "dy": 1}, "out": {"dx": 0.4, "dy": 0}},
        ]
    )
    assert keys[0]["interp"] == "auto"
    assert keys[1]["interp"] == "free"


def test_duration():
    lanes = [{"id": 1, "keys": [{"t": 0, "value": 0}, {"t": 6.5, "value": 1}]}]
    assert abs(duration_s(lanes) - 6.5) < 1e-9


def test_auto_uses_neighbor_handles_not_slope_average():
    """Screenshot-shaped: horizontal ease-out neighbour, mid Auto, Free in-handle.

    Old Auto averaged neighbour *slopes at those keys* (flat). New Auto is C2 with
    the neighbour handles locked, so the Auto tangent is much steeper.
    """
    dt = 2.4
    keys = [
        {
            "t": 0,
            "value": 0,
            "interp": "free",
            "out": {"dx": dt / 3, "dy": 0.0},
            "in": {"dx": -0.3, "dy": 0.0},
        },
        {
            "t": 2.4,
            "value": 87.2,
            "interp": "auto",
            "in": {"dx": -dt / 3, "dy": 0.0},
            "out": {"dx": dt / 3, "dy": 0.0},
        },
        {
            "t": 4.8,
            "value": 127.0,
            "interp": "free",
            "in": {"dx": -dt / 3, "dy": 15.0},
            "out": {"dx": 0.8, "dy": 0.0},
        },
    ]
    out = apply_auto_linear_lane([dict(k) for k in keys])
    auto = out[1]
    slope_out = auto["out"]["dy"] / auto["out"]["dx"]
    slope_in = auto["in"]["dy"] / auto["in"]["dx"]
    assert abs(slope_out - slope_in) < 1e-6
    m_prev = 0.0
    m_next = 15.0 / (dt / 3.0)
    avg = 0.5 * (m_prev + m_next)
    assert abs(slope_out - avg) > 5.0
    assert abs(auto["out"]["dy"] - 35.5) < 1e-6
    assert abs(out[0]["out"]["dy"]) < 1e-9
    assert abs(out[2]["in"]["dy"] - 15.0) < 1e-9
    assert abs(eval_axis_at(out, 2.4) - 87.2) < 1e-3


def test_auto_extrema_flatten():
    keys = apply_auto_linear_lane(
        [
            {"t": 0, "value": 0, "interp": "auto"},
            {"t": 1, "value": 10, "interp": "auto"},
            {"t": 2, "value": 0, "interp": "auto"},
        ]
    )
    assert abs(keys[1]["out"]["dy"]) < 1e-9
    assert abs(keys[1]["in"]["dy"]) < 1e-9


if __name__ == "__main__":
    test_linear()
    test_sample_deltas()
    test_linear_handles_match_lerp()
    test_bake_ease_inout()
    test_bake_smooth_and_bezier()
    test_duration()
    test_auto_uses_neighbor_handles_not_slope_average()
    test_auto_extrema_flatten()
    print("ok")
