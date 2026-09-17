# timeline.py — cubic Bézier / Hermite F-curves → Motion Path µm deltas.
# Runs on CPython and MicroPython (no numpy).

import math

SLICE_US_DEFAULT = 10000
UM_MIN = -32768
UM_MAX = 32767
MAX_AXES = 6


def _f(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _clamp_um(n):
    n = int(round(n))
    if n < UM_MIN:
        return UM_MIN
    if n > UM_MAX:
        return UM_MAX
    return n


def _ease_u(u, kind):
    if u <= 0:
        return 0.0
    if u >= 1:
        return 1.0
    k = kind or "linear"
    if k == "ease_in":
        return u * u * u
    if k == "ease_out":
        t = 1.0 - u
        return 1.0 - t * t * t
    if k == "ease_inout" or k == "ease_in_out":
        if u < 0.5:
            return 4.0 * u * u * u
        t = -2.0 * u + 2.0
        return 1.0 - (t * t * t) / 2.0
    return u


def _bezier_xy(u, p0, p1, p2, p3):
    mt = 1.0 - u
    mt2 = mt * mt
    mt3 = mt2 * mt
    u2 = u * u
    u3 = u2 * u
    x = mt3 * p0[0] + 3 * mt2 * u * p1[0] + 3 * mt * u2 * p2[0] + u3 * p3[0]
    y = mt3 * p0[1] + 3 * mt2 * u * p1[1] + 3 * mt * u2 * p2[1] + u3 * p3[1]
    return x, y


def _bezier_y_at_t(t, p0, p1, p2, p3):
    """Solve cubic Bézier x(u)=t for y (binary search)."""
    lo = 0.0
    hi = 1.0
    y = p0[1]
    for _ in range(22):
        mid = 0.5 * (lo + hi)
        x, y = _bezier_xy(mid, p0, p1, p2, p3)
        if x < t:
            lo = mid
        else:
            hi = mid
    return y


def sort_keys(keys):
    out = []
    for k in keys or []:
        if not isinstance(k, dict):
            continue
        out.append(k)
    out.sort(key=lambda k: _f(k.get("t")))
    return out


def eval_axis_at(keys, t):
    """Value of one axis F-curve at time t (seconds)."""
    keys = sort_keys(keys)
    if not keys:
        return 0.0
    t = _f(t)
    if t <= _f(keys[0].get("t")):
        return _f(keys[0].get("value"))
    if t >= _f(keys[-1].get("t")):
        return _f(keys[-1].get("value"))
    i = 0
    while i + 1 < len(keys) and _f(keys[i + 1].get("t")) < t:
        i += 1
    a = keys[i]
    b = keys[i + 1]
    t0 = _f(a.get("t"))
    t1 = _f(b.get("t"))
    v0 = _f(a.get("value"))
    v1 = _f(b.get("value"))
    dt = t1 - t0
    if dt <= 1e-9:
        return v1
    u = (t - t0) / dt
    kind = str(a.get("interp") or "auto")
    if kind == "smooth":
        kind = "auto"
    if kind == "bezier":
        kind = "free"
    if kind == "linear":
        return v0 + (v1 - v0) * u
    if kind in ("ease_in", "ease_out", "ease_inout", "ease_in_out"):
        return v0 + (v1 - v0) * _ease_u(u, kind)
    # cubic Bézier / Hermite via handles (time, value) offsets
    outh = a.get("out") or {}
    inh = b.get("in") or {}
    odx = _f(outh.get("dx"), dt / 3.0)
    ody = _f(outh.get("dy"))
    idx = _f(inh.get("dx"), -dt / 3.0)
    idy = _f(inh.get("dy"))
    p0 = (t0, v0)
    p1 = (t0 + odx, v0 + ody)
    p2 = (t1 + idx, v1 + idy)
    p3 = (t1, v1)
    if p1[0] < t0:
        p1 = (t0, p1[1])
    if p2[0] > t1:
        p2 = (t1, p2[1])
    return _bezier_y_at_t(t, p0, p1, p2, p3)


def bake_legacy_keys(keys):
    """One-time bake of segment ease/linear into per-key handles. Version stays 1."""
    keys = sort_keys(keys)
    n = len(keys)
    i = 0
    while i + 1 < n:
        a = keys[i]
        b = keys[i + 1]
        kind = str(a.get("interp") or "bezier")
        t0 = _f(a.get("t"))
        t1 = _f(b.get("t"))
        v0 = _f(a.get("value"))
        v1 = _f(b.get("value"))
        dt = t1 - t0
        i += 1
        if dt <= 1e-9:
            continue
        chord = (v1 - v0) / dt
        if kind == "linear":
            a["out"] = {"dx": dt / 3.0, "dy": chord * (dt / 3.0)}
            b_kind = str(b.get("interp") or "bezier")
            if b_kind in ("bezier", "smooth", "linear", "ease_in", "ease_out", "ease_inout", "ease_in_out"):
                b["in"] = {"dx": -dt / 3.0, "dy": chord * (-dt / 3.0)}
        elif kind == "ease_in":
            a["out"] = {"dx": dt / 3.0, "dy": 0.0}
            b["in"] = {"dx": -dt / 3.0, "dy": 3.0 * chord * (-dt / 3.0)}
            if str(b.get("interp") or "") == "linear":
                b["interp"] = "free"
        elif kind == "ease_out":
            a["out"] = {"dx": dt / 3.0, "dy": 3.0 * chord * (dt / 3.0)}
            b["in"] = {"dx": -dt / 3.0, "dy": 0.0}
            if str(b.get("interp") or "") == "linear":
                b["interp"] = "free"
        elif kind in ("ease_inout", "ease_in_out"):
            a["out"] = {"dx": dt / 3.0, "dy": 0.0}
            b["in"] = {"dx": -dt / 3.0, "dy": 0.0}
            if str(b.get("interp") or "") == "linear":
                b["interp"] = "free"
    for k in keys:
        kind = str(k.get("interp") or "bezier")
        if kind == "smooth":
            k["interp"] = "auto"
        elif kind == "bezier":
            k["interp"] = "free"
        elif kind in ("ease_in", "ease_out", "ease_inout", "ease_in_out"):
            k["interp"] = "aligned"
        elif kind in ("auto", "aligned", "free", "linear"):
            pass
        else:
            k["interp"] = "auto"
        if not isinstance(k.get("in"), dict):
            k["in"] = {"dx": -0.3, "dy": 0.0}
        if not isinstance(k.get("out"), dict):
            k["out"] = {"dx": 0.3, "dy": 0.0}
    return keys


def _sticky_interp(kind):
    kind = str(kind or "auto")
    if kind == "smooth":
        return "auto"
    if kind == "bezier":
        return "free"
    if kind in ("auto", "aligned", "free", "linear"):
        return kind
    if kind in ("ease_in", "ease_out", "ease_inout", "ease_in_out"):
        return kind
    return "auto"


def _solve_tridiag(a, b, c, d):
    n = len(b)
    cp = [0.0] * n
    dp = [0.0] * n
    x = [0.0] * n
    denom = b[0]
    if abs(denom) < 1e-15:
        denom = 1e-15
    cp[0] = c[0] / denom
    dp[0] = d[0] / denom
    i = 1
    while i < n:
        denom = b[i] - a[i] * cp[i - 1]
        if abs(denom) < 1e-15:
            denom = 1e-15
        cp[i] = (c[i] if i < len(c) else 0.0) / denom
        dp[i] = (d[i] - a[i] * dp[i - 1]) / denom
        i += 1
    x[n - 1] = dp[n - 1]
    i = n - 2
    while i >= 0:
        x[i] = dp[i] - cp[i] * x[i + 1]
        i -= 1
    return x


def _bezier_calc_handle_adj(hx, hy, span_dx):
    if span_dx < 1e-12:
        return 0.0, hy
    denom = hx + span_dx / 3.0
    if abs(denom) < 1e-12:
        return 0.0, hy
    fac = span_dx / denom
    if fac < 1.0:
        hx *= fac
        hy *= fac
    return 1.0 - 3.0 * hx / span_dx, hy


def _bezier_smooth_h(pts, lock_first, lock_last):
    count = len(pts)
    dx = [1.0] * count
    dy = [0.0] * count
    l = [1.0] * count
    a = [0.0] * count
    b = [1.0] * count
    c = [0.0] * count
    d = [0.0] * count
    i = 1
    while i < count:
        dx[i] = _f(pts[i].get("t")) - _f(pts[i - 1].get("t"))
        if abs(dx[i]) < 1e-12:
            dx[i] = 1e-12
        dy[i] = _f(pts[i].get("value")) - _f(pts[i - 1].get("value"))
        i += 1
    i = 1
    while i < count - 1:
        l[i] = dx[i + 1] / dx[i]
        if abs(l[i]) < 1e-12:
            l[i] = 1e-12
        i += 1
    first_adj = 0.0
    last_adj = 0.0
    if lock_first:
        outh = pts[0].get("out") or {}
        first_adj, hy0 = _bezier_calc_handle_adj(_f(outh.get("dx")), _f(outh.get("dy")), dx[1])
        a[0] = 0.0
        b[0] = 1.0
        c[0] = 0.0
        d[0] = hy0
    else:
        a[0] = 0.0
        b[0] = 2.0
        c[0] = 1.0 / l[1]
        d[0] = dy[1]
    if lock_last:
        inh = pts[count - 1].get("in") or {}
        last_adj, hyn = _bezier_calc_handle_adj(-_f(inh.get("dx")), -_f(inh.get("dy")), dx[count - 1])
        a[count - 1] = 0.0
        b[count - 1] = 1.0
        c[count - 1] = 0.0
        d[count - 1] = hyn
    else:
        a[count - 1] = l[count - 1] * l[count - 1]
        b[count - 1] = 2.0 * l[count - 1]
        c[count - 1] = 0.0
        d[count - 1] = dy[count - 1] * l[count - 1] * l[count - 1]
    i = 1
    while i < count - 1:
        a[i] = l[i] * l[i]
        b[i] = 2.0 * (l[i] + 1.0)
        c[i] = 1.0 / l[i + 1]
        d[i] = dy[i] * l[i] * l[i] + dy[i + 1]
        i += 1
    if count > 2 or not lock_last:
        b[1] += l[1] * first_adj
    if count > 2 or not lock_first:
        b[count - 2] += last_adj
    return _solve_tridiag(a, b, c, d)


def _auto_tangents_for_run(keys, start, end):
    n_auto = end - start + 1
    m = [0.0] * n_auto
    prev = keys[start - 1] if start > 0 else None
    next_k = keys[end + 1] if end + 1 < len(keys) else None
    pts = []
    if prev is not None:
        pts.append(prev)
    auto0 = len(pts)
    i = start
    while i <= end:
        pts.append(keys[i])
        i += 1
    if next_k is not None:
        pts.append(next_k)
    count = len(pts)
    if count >= 2:
        h = _bezier_smooth_h(pts, prev is not None, next_k is not None)
        i = 0
        while i < n_auto:
            k = auto0 + i
            dt_out = _f(pts[k + 1].get("t")) - _f(pts[k].get("t")) if k + 1 < count else 0.0
            dt_in = _f(pts[k].get("t")) - _f(pts[k - 1].get("t")) if k > 0 else 0.0
            if dt_out > 1e-12:
                m[i] = 3.0 * h[k] / dt_out
            elif dt_in > 1e-12:
                m[i] = 3.0 * h[k] / dt_in
            else:
                m[i] = 0.0
            i += 1
    i = 0
    while i < n_auto:
        gi = start + i
        pv = keys[gi - 1] if gi > 0 else None
        nv = keys[gi + 1] if gi + 1 < len(keys) else None
        if pv is not None and nv is not None:
            v = _f(keys[gi].get("value"))
            vp = _f(pv.get("value"))
            vn = _f(nv.get("value"))
            if (v >= vp and v >= vn) or (v <= vp and v <= vn):
                m[i] = 0.0
        i += 1
    return m


def apply_auto_linear_lane(keys):
    """Rebuild Linear vector handles and Auto C2 handles (editor-side, lockstep with JS)."""
    keys = sort_keys(keys)
    i = 0
    n = len(keys)
    while i < n:
        k = keys[i]
        if _sticky_interp(k.get("interp")) != "linear":
            i += 1
            continue
        k["interp"] = "linear"
        prev = keys[i - 1] if i > 0 else None
        nxt = keys[i + 1] if i + 1 < n else None
        t = _f(k.get("t"))
        if nxt is not None:
            out_dt = (_f(nxt.get("t")) - t) / 3.0
            dt = _f(nxt.get("t")) - t
            m_out = (_f(nxt.get("value")) - _f(k.get("value"))) / dt if abs(dt) > 1e-9 else 0.0
            k["out"] = {"dx": out_dt, "dy": m_out * out_dt}
        elif not isinstance(k.get("out"), dict):
            k["out"] = {"dx": 0.3, "dy": 0.0}
        if prev is not None:
            in_dt = (_f(prev.get("t")) - t) / 3.0
            dt = t - _f(prev.get("t"))
            m_in = (_f(k.get("value")) - _f(prev.get("value"))) / dt if abs(dt) > 1e-9 else 0.0
            k["in"] = {"dx": in_dt, "dy": m_in * in_dt}
        elif not isinstance(k.get("in"), dict):
            k["in"] = {"dx": -0.3, "dy": 0.0}
        i += 1
    i = 0
    while i < n:
        if _sticky_interp(keys[i].get("interp")) != "auto":
            i += 1
            continue
        j = i
        while j + 1 < n and _sticky_interp(keys[j + 1].get("interp")) == "auto":
            j += 1
        m = _auto_tangents_for_run(keys, i, j)
        r = i
        while r <= j:
            keys[r]["interp"] = "auto"
            t = _f(keys[r].get("t"))
            prev = keys[r - 1] if r > 0 else None
            nxt = keys[r + 1] if r + 1 < n else None
            out_dt = (_f(nxt.get("t")) - t) / 3.0 if nxt is not None else 0.3
            in_dt = (_f(prev.get("t")) - t) / 3.0 if prev is not None else -0.3
            slope = m[r - i] if (r - i) < len(m) else 0.0
            keys[r]["out"] = {"dx": out_dt, "dy": slope * out_dt}
            keys[r]["in"] = {"dx": in_dt, "dy": slope * in_dt}
            r += 1
        i = j + 1
    return keys


def duration_s(lanes):
    t_max = 0.0
    for lane in lanes or []:
        keys = lane.get("keys") if isinstance(lane, dict) else None
        for k in keys or []:
            tt = _f(k.get("t") if isinstance(k, dict) else 0)
            if tt > t_max:
                t_max = tt
    return t_max


def eval_pose(lanes, t):
    """Return {axis_id: value} at t."""
    pose = {}
    for lane in lanes or []:
        if not isinstance(lane, dict):
            continue
        aid = int(lane.get("id") or 0)
        if aid < 1:
            continue
        pose[aid] = eval_axis_at(lane.get("keys") or [], t)
    return pose


def sample_path(lanes, slice_us=None, max_spd=None, max_acc=None):
    """Sample F-curves into Motion Path slices.

    Returns dict:
      slice_us, samples (list of [um1, um2, ...]), warnings (list of str),
      duration_s, n
    ``max_spd`` / ``max_acc`` are {axis_id: limit} in unit/s and unit/s².
    """
    if slice_us is None:
        slice_us = SLICE_US_DEFAULT
    slice_us = int(slice_us)
    if slice_us < 1000:
        slice_us = 1000
    dt = slice_us * 1e-6
    dur = duration_s(lanes)
    if dur <= 0:
        return {
            "slice_us": slice_us,
            "samples": [],
            "warnings": [],
            "duration_s": 0.0,
            "n": 0,
        }
    n = int(math.ceil(dur / dt))
    if n < 1:
        n = 1
    ids = []
    for lane in lanes or []:
        if isinstance(lane, dict):
            aid = int(lane.get("id") or 0)
            if aid >= 1 and aid not in ids:
                ids.append(aid)
    ids.sort()
    if not ids:
        ids = [1]
    prev = eval_pose(lanes, 0.0)
    prev_spd = {}
    samples = []
    warnings = []
    t = dt
    for i in range(n):
        pose = eval_pose(lanes, t)
        row = []
        for aid in ids:
            p0 = _f(prev.get(aid))
            p1 = _f(pose.get(aid))
            d_mm = p1 - p0
            um = _clamp_um(d_mm * 1000.0)
            row.append(um)
            spd = abs(d_mm) / dt if dt > 0 else 0.0
            if max_spd and aid in max_spd:
                cap = _f(max_spd.get(aid))
                if cap > 0 and spd > cap + 1e-6:
                    warnings.append(
                        "slice %d axis %d speed %.3f > max %.3f" % (i, aid, spd, cap)
                    )
            if max_acc and aid in max_acc and aid in prev_spd:
                acc = abs(spd - prev_spd[aid]) / dt
                cap_a = _f(max_acc.get(aid))
                if cap_a > 0 and acc > cap_a + 1e-3:
                    warnings.append(
                        "slice %d axis %d accel %.3f > max %.3f" % (i, aid, acc, cap_a)
                    )
            prev_spd[aid] = spd
        samples.append(row)
        prev = pose
        t += dt
    return {
        "slice_us": slice_us,
        "samples": samples,
        "warnings": warnings[:40],
        "duration_s": dur,
        "n": len(samples),
        "ids": ids,
    }


def path_pd_lines(samples, axis_count=3):
    """Turn sample rows into ``PD`` command lines (1–6 slots for one MC)."""
    lines = []
    try:
        ac = int(axis_count or 1)
    except (TypeError, ValueError):
        ac = 3
    if ac < 1:
        ac = 1
    if ac > 6:
        ac = 6
    for row in samples or []:
        toks = []
        i = 0
        while i < ac:
            toks.append(str(int(row[i]) if len(row) > i else 0))
            i += 1
        lines.append("PD " + " ".join(toks))
    return lines
