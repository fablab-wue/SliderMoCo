/* Resolve-style key / curve editor (Edit-page feel). */
(function (global) {
  "use strict";

  var COLORS = (global.SHLayout && global.SHLayout.AXIS_COLORS) ||
    ["#bd9eda", "#9edabd", "#dabd9f", "#9ebdda", "#bdda9f", "#da9ebd"];
  var COLORS_SEL = (global.SHLayout && global.SHLayout.AXIS_COLORS_SEL) ||
    ["#8b1ff0", "#1ff08b", "#ef8921", "#1f8bf0", "#89ef21", "#f01f8b"];

  function laneColor(id, selected) {
    if (global.SHLayout && typeof global.SHLayout.axisColor === "function") {
      return global.SHLayout.axisColor(id, selected);
    }
    var cols = selected ? COLORS_SEL : COLORS;
    var i = Number(id) - 1;
    if (!isFinite(i) || i < 0) i = 0;
    return cols[i % cols.length] || COLORS[0];
  }
  var MARKER_H = 18;
  var TIME_H = 22;
  var LABEL_GAP = 14;
  var YELLOW = "#e8c44a";
  var RED = "#e05050";
  var BLUE = "#3d7ee8";
  var GRID_MIN_PX = 8;
  var GRID_Y_LABEL_PX = 16;
  var GRID_X_LABEL_PX = 36;
  var GRID_Y_STEPS = [10, 50, 100];
  var GRID_X_STEPS = [1, 5, 10];
  var GRID_MINOR = { w: 0.6, c: "#151a20" };
  var GRID_THIN = { w: 1.2, c: "#1c2430" };
  var GRID_NORMAL = { w: 1.8, c: "#243044" };
  var GRID_ZERO = { w: 2.4, c: "#3a4a5c" };
  var GRID_LEVEL_STYLE = [GRID_MINOR, GRID_THIN, GRID_NORMAL];
  var SNAP_KEY_T = 0.15;
  var HIT_R = 12;
  var HIT_OVERLAP = 8;

  function f(v, d) {
    v = Number(v);
    return isNaN(v) ? (d == null ? 0 : d) : v;
  }

  function sortKeys(keys) {
    return (keys || []).slice().sort(function (a, b) { return f(a.t) - f(b.t); });
  }

  function easeU(u, kind) {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    if (kind === "ease_in") return u * u * u;
    if (kind === "ease_out") { var t = 1 - u; return 1 - t * t * t; }
    if (kind === "ease_inout" || kind === "ease_in_out") {
      if (u < 0.5) return 4 * u * u * u;
      t = -2 * u + 2;
      return 1 - (t * t * t) / 2;
    }
    return u;
  }

  function stickyInterp(kind) {
    kind = String(kind || "auto");
    if (kind === "smooth") return "auto";
    if (kind === "bezier") return "free";
    if (kind === "auto" || kind === "aligned" || kind === "free" || kind === "linear") return kind;
    if (kind === "ease_in" || kind === "ease_out" || kind === "ease_inout" || kind === "ease_in_out") return kind;
    return "auto";
  }

  function isEaseKind(kind) {
    return kind === "ease_in" || kind === "ease_out" || kind === "ease_inout" || kind === "ease_in_out";
  }

  function isComputedInterp(kind) {
    kind = stickyInterp(kind);
    return kind === "auto" || kind === "linear";
  }

  function bezierXY(u, p0, p1, p2, p3) {
    var mt = 1 - u, mt2 = mt * mt, mt3 = mt2 * mt, u2 = u * u, u3 = u2 * u;
    return {
      x: mt3 * p0[0] + 3 * mt2 * u * p1[0] + 3 * mt * u2 * p2[0] + u3 * p3[0],
      y: mt3 * p0[1] + 3 * mt2 * u * p1[1] + 3 * mt * u2 * p2[1] + u3 * p3[1]
    };
  }

  function bezierYAtT(t, p0, p1, p2, p3) {
    var lo = 0, hi = 1, y = p0[1], i, mid, p;
    for (i = 0; i < 22; i++) {
      mid = 0.5 * (lo + hi);
      p = bezierXY(mid, p0, p1, p2, p3);
      y = p.y;
      if (p.x < t) lo = mid; else hi = mid;
    }
    return y;
  }

  function evalAxis(keys, t) {
    keys = sortKeys(keys);
    if (!keys.length) return 0;
    if (t <= f(keys[0].t)) return f(keys[0].value);
    if (t >= f(keys[keys.length - 1].t)) return f(keys[keys.length - 1].value);
    var i = 0;
    while (i + 1 < keys.length && f(keys[i + 1].t) < t) i++;
    var a = keys[i], b = keys[i + 1];
    var t0 = f(a.t), t1 = f(b.t), v0 = f(a.value), v1 = f(b.value);
    var dt = t1 - t0;
    if (dt <= 1e-9) return v1;
    var u = (t - t0) / dt;
    var kind = stickyInterp(a.interp);
    if (kind === "linear") return v0 + (v1 - v0) * u;
    if (isEaseKind(kind)) return v0 + (v1 - v0) * easeU(u, kind);
    var odx = f(a.out && a.out.dx, dt / 3), ody = f(a.out && a.out.dy, 0);
    var idx = f(b.in && b.in.dx, -dt / 3), idy = f(b.in && b.in.dy, 0);
    var p0 = [t0, v0], p1 = [t0 + odx, v0 + ody], p2 = [t1 + idx, v1 + idy], p3 = [t1, v1];
    if (p1[0] < t0) p1[0] = t0;
    if (p2[0] > t1) p2[0] = t1;
    return bezierYAtT(t, p0, p1, p2, p3);
  }

  function firstAlnum(s) {
    s = String(s || "");
    var i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charAt(i);
      if ((c >= "0" && c <= "9") || (c >= "A" && c <= "Z") || (c >= "a" && c <= "z")) {
        return c.toUpperCase();
      }
    }
    return "";
  }

  function extLevel(v) {
    if (v == null || v === false || v === "") return null;
    if (v === true) return 1;
    var n = Number(v);
    if (n === 0) return 0;
    if (n === 1) return 1;
    return null;
  }

  function normalizeMarker(mk) {
    if (!mk || typeof mk !== "object") {
      return {
        t: 0, symbol: "B", beep: true, bloop: false,
        ext1: null, ext2: null, ext3: null, ext4: null, camera: false
      };
    }
    var kind = String(mk.kind || "").toLowerCase();
    var isLetterKind = kind === "letter" || (kind.length === 1 && kind >= "a" && kind <= "h");
    var isBeepKind = kind === "beep";
    var symbol = firstAlnum(mk.symbol || mk.letter || (isLetterKind ? kind : ""));
    if (!symbol) symbol = isBeepKind || !isLetterKind ? "B" : "A";
    var beep;
    if (mk.beep != null) beep = !!mk.beep;
    else beep = isBeepKind || (!kind && !isLetterKind);
    return {
      t: f(mk.t),
      symbol: symbol,
      beep: beep,
      bloop: !!mk.bloop,
      ext1: extLevel(mk.ext1),
      ext2: extLevel(mk.ext2),
      ext3: extLevel(mk.ext3),
      ext4: extLevel(mk.ext4),
      camera: !!mk.camera
    };
  }

  function nextMarkerSymbol(markers) {
    var used = {};
    (markers || []).forEach(function (mk) {
      var s = firstAlnum(mk && mk.symbol);
      if (s) used[s] = true;
    });
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    var i, c;
    for (i = 0; i < chars.length; i++) {
      c = chars.charAt(i);
      if (!used[c]) return c;
    }
    return "A";
  }

  function markerLetter(mk) {
    if (!mk) return "";
    var s = String(mk.symbol || mk.letter || "").toLowerCase();
    if (s.length && s.charAt(0) >= "a" && s.charAt(0) <= "h") return s.charAt(0);
    var k = String(mk.kind || "").toLowerCase();
    if (k.length === 1 && k >= "a" && k <= "h") return k;
    return "";
  }

  function duration(lanes) {
    var m = 0;
    (lanes || []).forEach(function (lane) {
      (lane.keys || []).forEach(function (k) { if (f(k.t) > m) m = f(k.t); });
    });
    return m;
  }

  function playDuration(lanes, markers) {
    var m = duration(lanes);
    (markers || []).forEach(function (mk) { if (f(mk.t) > m) m = f(mk.t); });
    return m;
  }

  function defaultHandles(dt) {
    return { in: { dx: -dt / 3, dy: 0 }, out: { dx: dt / 3, dy: 0 } };
  }

  function ensureHandles(k, dt) {
    dt = dt || 1;
    if (!k.in) k.in = { dx: -dt / 3, dy: 0 };
    if (!k.out) k.out = { dx: dt / 3, dy: 0 };
    return k;
  }

  function isHandleInterp(kind) {
    kind = stickyInterp(kind);
    return kind === "auto" || kind === "aligned" || kind === "free" || kind === "linear";
  }

  function handlesAligned(k) {
    var inH = k.in || {}, outH = k.out || {};
    var idx = f(inH.dx), idy = f(inH.dy), odx = f(outH.dx), ody = f(outH.dy);
    var is = Math.abs(idx) <= 1e-9 ? (Math.abs(idy) <= 1e-9 ? 0 : null) : idy / idx;
    var os = Math.abs(odx) <= 1e-9 ? (Math.abs(ody) <= 1e-9 ? 0 : null) : ody / odx;
    if (is == null || os == null) return false;
    return Math.abs(is - os) < 1e-4;
  }

  function isFlatHandle(h) {
    return Math.abs(f(h && h.dy)) < 1e-4;
  }

  function chordSlope(a, b) {
    var dt = f(b.t) - f(a.t);
    if (Math.abs(dt) <= 1e-9) return 0;
    return (f(b.value) - f(a.value)) / dt;
  }

  var HANDLE_DX_MIN = 1e-3;

  function hypot2(x, y) {
    return Math.sqrt(x * x + y * y);
  }

  function handleTimeSlope(h) {
    var dx = f(h && h.dx);
    if (Math.abs(dx) <= HANDLE_DX_MIN) return 0;
    return f(h && h.dy) / dx;
  }

  function keepHandleDx(dx, side, fallback) {
    dx = f(dx);
    var fb = fallback > HANDLE_DX_MIN ? fallback : 0.3;
    if (side === "out") {
      if (dx < HANDLE_DX_MIN) dx = fb;
      return dx;
    }
    if (dx > -HANDLE_DX_MIN) dx = -fb;
    return dx;
  }

  function makeAligned(k) {
    k.interp = "aligned";
    ensureHandles(k);
    var odx = keepHandleDx(k.out.dx, "out", 0.3);
    var idx = keepHandleDx(k.in.dx, "in", 0.3);
    var sOut = handleTimeSlope({ dx: odx, dy: f(k.out.dy) });
    var sIn = handleTimeSlope({ dx: idx, dy: f(k.in.dy) });
    var s = Math.abs(odx) >= Math.abs(idx) ? sOut : sIn;
    k.out = { dx: odx, dy: s * odx };
    k.in = { dx: idx, dy: s * idx };
  }

  function mirrorOpposite(k, side, equalLen) {
    ensureHandles(k);
    var src = side === "out" ? k.out : k.in;
    var dst = side === "out" ? "in" : "out";
    var sdx = f(src.dx), sdy = f(src.dy);
    var slope = Math.abs(sdx) <= HANDLE_DX_MIN ? 0 : sdy / sdx;
    var slenT = Math.abs(sdx);
    var odx;
    if (equalLen) odx = dst === "out" ? Math.max(slenT, HANDLE_DX_MIN) : -Math.max(slenT, HANDLE_DX_MIN);
    else odx = keepHandleDx(k[dst] && k[dst].dx, dst, slenT);
    k[dst] = { dx: odx, dy: slope * odx };
  }

  function solveTridiag(a, b, c, d) {
    var n = b.length, i, denom, cp = [], dp = [], x = [];
    denom = b[0];
    if (Math.abs(denom) < 1e-15) denom = 1e-15;
    cp[0] = c[0] / denom;
    dp[0] = d[0] / denom;
    for (i = 1; i < n; i++) {
      denom = b[i] - a[i] * cp[i - 1];
      if (Math.abs(denom) < 1e-15) denom = 1e-15;
      cp[i] = (c[i] || 0) / denom;
      dp[i] = (d[i] - a[i] * dp[i - 1]) / denom;
    }
    x[n - 1] = dp[n - 1];
    for (i = n - 2; i >= 0; i--) x[i] = dp[i] - cp[i] * x[i + 1];
    return x;
  }

  function bezierCalcHandleAdj(hx, hy, spanDx) {
    if (spanDx < 1e-12) return { adj: 0, hy: hy };
    var denom = hx + spanDx / 3;
    if (Math.abs(denom) < 1e-12) return { adj: 0, hy: hy };
    var fac = spanDx / denom;
    if (fac < 1) {
      hx *= fac;
      hy *= fac;
    }
    return { adj: 1 - 3 * hx / spanDx, hy: hy };
  }

  function bezierSmoothH(pts, lockFirst, lockLast) {
    var count = pts.length, i;
    var dx = [], dy = [], l = [];
    var a = [], b = [], c = [], d = [];
    for (i = 0; i < count; i++) {
      dx[i] = 1;
      dy[i] = 0;
      l[i] = 1;
      a[i] = 0;
      b[i] = 1;
      c[i] = 0;
      d[i] = 0;
    }
    for (i = 1; i < count; i++) {
      dx[i] = f(pts[i].t) - f(pts[i - 1].t);
      if (Math.abs(dx[i]) < 1e-12) dx[i] = 1e-12;
      dy[i] = f(pts[i].value) - f(pts[i - 1].value);
    }
    for (i = 1; i < count - 1; i++) {
      l[i] = dx[i + 1] / dx[i];
      if (Math.abs(l[i]) < 1e-12) l[i] = 1e-12;
    }
    var firstAdj = 0, lastAdj = 0;
    if (lockFirst) {
      var outH = pts[0].out || {};
      var adj0 = bezierCalcHandleAdj(f(outH.dx), f(outH.dy), dx[1]);
      firstAdj = adj0.adj;
      a[0] = 0;
      b[0] = 1;
      c[0] = 0;
      d[0] = adj0.hy;
    } else {
      a[0] = 0;
      b[0] = 2;
      c[0] = 1 / l[1];
      d[0] = dy[1];
    }
    if (lockLast) {
      var inH = pts[count - 1].in || {};
      var adjN = bezierCalcHandleAdj(-f(inH.dx), -f(inH.dy), dx[count - 1]);
      lastAdj = adjN.adj;
      a[count - 1] = 0;
      b[count - 1] = 1;
      c[count - 1] = 0;
      d[count - 1] = adjN.hy;
    } else {
      a[count - 1] = l[count - 1] * l[count - 1];
      b[count - 1] = 2 * l[count - 1];
      c[count - 1] = 0;
      d[count - 1] = dy[count - 1] * l[count - 1] * l[count - 1];
    }
    for (i = 1; i < count - 1; i++) {
      a[i] = l[i] * l[i];
      b[i] = 2 * (l[i] + 1);
      c[i] = 1 / l[i + 1];
      d[i] = dy[i] * l[i] * l[i] + dy[i + 1];
    }
    if (count > 2 || !lockLast) b[1] += l[1] * firstAdj;
    if (count > 2 || !lockFirst) b[count - 2] += lastAdj;
    return solveTridiag(a, b, c, d);
  }

  function autoTangentsForRun(keys, start, end) {
    var nAuto = end - start + 1, i, m = [];
    for (i = 0; i < nAuto; i++) m[i] = 0;
    var prev = keys[start - 1], next = keys[end + 1];
    var pts = [];
    if (prev) pts.push(prev);
    var auto0 = pts.length;
    for (i = start; i <= end; i++) pts.push(keys[i]);
    if (next) pts.push(next);
    var count = pts.length;
    if (count >= 2) {
      var h = bezierSmoothH(pts, !!prev, !!next);
      for (i = 0; i < nAuto; i++) {
        var k = auto0 + i;
        var dtOut = k + 1 < count ? f(pts[k + 1].t) - f(pts[k].t) : 0;
        var dtIn = k > 0 ? f(pts[k].t) - f(pts[k - 1].t) : 0;
        if (dtOut > 1e-12) m[i] = 3 * h[k] / dtOut;
        else if (dtIn > 1e-12) m[i] = 3 * h[k] / dtIn;
        else m[i] = 0;
      }
    }
    for (i = 0; i < nAuto; i++) {
      var gi = start + i;
      var pv = keys[gi - 1], nv = keys[gi + 1];
      if (pv && nv) {
        var v = f(keys[gi].value), vp = f(pv.value), vn = f(nv.value);
        if ((v >= vp && v >= vn) || (v <= vp && v <= vn)) m[i] = 0;
      }
    }
    return m;
  }

  function bakeLegacyLane(keys) {
    keys = sortKeys(keys);
    var i, a, b, dt, chord, kind;
    for (i = 0; i < keys.length - 1; i++) {
      a = keys[i];
      b = keys[i + 1];
      kind = a.interp || "bezier";
      dt = f(b.t) - f(a.t);
      if (dt <= 1e-9) continue;
      chord = (f(b.value) - f(a.value)) / dt;
      if (kind === "linear") {
        a.out = { dx: dt / 3, dy: chord * (dt / 3) };
        var bKind = b.interp || "bezier";
        if (bKind === "bezier" || bKind === "smooth" || bKind === "linear" || isEaseKind(bKind)) {
          b.in = { dx: -dt / 3, dy: chord * (-dt / 3) };
        }
      } else if (kind === "ease_in") {
        a.out = { dx: dt / 3, dy: 0 };
        b.in = { dx: -dt / 3, dy: 3 * chord * (-dt / 3) };
        if ((b.interp || "") === "linear") b.interp = "free";
      } else if (kind === "ease_out") {
        a.out = { dx: dt / 3, dy: 3 * chord * (dt / 3) };
        b.in = { dx: -dt / 3, dy: 0 };
        if ((b.interp || "") === "linear") b.interp = "free";
      } else if (kind === "ease_inout" || kind === "ease_in_out") {
        a.out = { dx: dt / 3, dy: 0 };
        b.in = { dx: -dt / 3, dy: 0 };
        if ((b.interp || "") === "linear") b.interp = "free";
      }
    }
    keys.forEach(function (k, ki) {
      kind = k.interp || "bezier";
      var dtIn = keys[ki - 1] ? Math.abs(f(k.t) - f(keys[ki - 1].t)) : 1;
      var dtOut = keys[ki + 1] ? Math.abs(f(keys[ki + 1].t) - f(k.t)) : 1;
      ensureHandles(k, Math.max(dtIn, dtOut, 0.3));
      if (kind === "smooth") k.interp = "auto";
      else if (kind === "bezier") k.interp = "free";
      else if (isEaseKind(kind)) k.interp = handlesAligned(k) ? "aligned" : "free";
      else if (kind === "linear") k.interp = "linear";
      else if (kind === "auto" || kind === "aligned" || kind === "free") k.interp = kind;
      else k.interp = "auto";
    });
    return keys;
  }

  function applyAutoLinearLane(keys) {
    keys = sortKeys(keys);
    keys.forEach(function (k, i) {
      if (stickyInterp(k.interp) !== "linear") return;
      k.interp = "linear";
      var prev = keys[i - 1], next = keys[i + 1];
      var t = f(k.t);
      if (next) {
        var outDt = (f(next.t) - t) / 3;
        var mOut = chordSlope(k, next);
        k.out = { dx: outDt, dy: mOut * outDt };
      } else k.out = k.out || { dx: 0.3, dy: 0 };
      if (prev) {
        var inDt = (f(prev.t) - t) / 3;
        var mIn = chordSlope(prev, k);
        k.in = { dx: inDt, dy: mIn * inDt };
      } else k.in = k.in || { dx: -0.3, dy: 0 };
    });
    var i = 0, j, r, m;
    while (i < keys.length) {
      if (stickyInterp(keys[i].interp) !== "auto") { i++; continue; }
      j = i;
      while (j + 1 < keys.length && stickyInterp(keys[j + 1].interp) === "auto") j++;
      m = autoTangentsForRun(keys, i, j);
      for (r = i; r <= j; r++) {
        keys[r].interp = "auto";
        var t = f(keys[r].t);
        var prev = keys[r - 1], next = keys[r + 1];
        var outDt = next ? (f(next.t) - t) / 3 : 0.3;
        var inDt = prev ? (f(prev.t) - t) / 3 : -0.3;
        var slope = m[r - i] || 0;
        keys[r].out = { dx: outDt, dy: slope * outDt };
        keys[r].in = { dx: inDt, dy: slope * inDt };
      }
      i = j + 1;
    }
    return keys;
  }

  function projectOnChord(dx, dy, chord) {
    var cx = f(chord.dx), cy = f(chord.dy);
    var cl = hypot2(cx, cy);
    if (cl < 1e-9) return { dx: dx < 0 ? Math.min(dx, 0) : Math.max(dx, 0), dy: 0 };
    var proj = (dx * cx + dy * cy) / (cl * cl);
    if (proj < 0) proj = 0;
    var maxP = 1;
    if (proj > maxP) proj = maxP;
    return { dx: proj * cx, dy: proj * cy };
  }

  function clampHandle(side, dx, dy, k, keys, i) {
    var tmax;
    if (side === "out") {
      if (dx < HANDLE_DX_MIN) dx = HANDLE_DX_MIN;
      tmax = keys[i + 1] ? f(keys[i + 1].t) - f(k.t) : 1e9;
      if (tmax < HANDLE_DX_MIN) tmax = HANDLE_DX_MIN;
      if (dx > tmax && dx > 1e-12) {
        dy *= tmax / dx;
        dx = tmax;
      }
    } else {
      if (dx > -HANDLE_DX_MIN) dx = -HANDLE_DX_MIN;
      tmax = keys[i - 1] ? f(keys[i - 1].t) - f(k.t) : -1e9;
      if (tmax > -HANDLE_DX_MIN) tmax = -HANDLE_DX_MIN;
      if (dx < tmax && dx < -1e-12) {
        dy *= tmax / dx;
        dx = tmax;
      }
    }
    return { dx: dx, dy: dy };
  }

  function fmtVal(v) {
    v = f(v);
    var a = Math.abs(v);
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1);
    return v.toFixed(2);
  }

  function fmtGridY(v) {
    if (Math.abs(v - Math.round(v)) < 1e-6) return String(Math.round(v));
    return fmtVal(v);
  }

  function shownGridSteps(pxPerMinor, steps) {
    var out = [];
    var i, px;
    for (i = 0; i < steps.length; i++) {
      px = pxPerMinor * (steps[i] / steps[0]);
      if (px >= GRID_MIN_PX) out.push(i);
    }
    return out;
  }

  function forTicks(lo, hi, step, fn) {
    if (!(step > 0) || !isFinite(step) || !isFinite(lo) || !isFinite(hi)) return;
    var a = Math.min(lo, hi), b = Math.max(lo, hi);
    var n0 = Math.ceil((a - 1e-9) / step);
    var n1 = Math.floor((b + 1e-9) / step);
    var n;
    for (n = n0; n <= n1; n++) fn(n * step);
  }

  function TimelineEditor(opts) {
    this.canvas = opts.canvas;
    this.tracksEl = opts.tracksEl;
    this.editEl = opts.editEl || null;
    this.onChange = opts.onChange || function () {};
    this.onPlayhead = opts.onPlayhead || function () {};
    this.onSelChange = opts.onSelChange || function () {};
    this.onLimitsChange = opts.onLimitsChange || function () {};
    this.onTracksChange = opts.onTracksChange || function () {};
    this.onMarkerEdit = opts.onMarkerEdit || function () {};
    this.lanes = [];
    this.markers = [];
    this.visible = {};
    this.locked = {};
    this.viewY = {};
    this.limits = {};
    this.playhead = 0;
    this.showHandles = true;
    this.playing = false;
    this.live = {};
    this.sel = null;
    this.activeId = null;
    this.view = { t0: -0.5, t1: 12 };
    this.playHz = 50;
    this.pathBuffer = 32000;
    this.maxT = this.pathBuffer / this.playHz;
    this._drag = null;
    this._limitDirty = true;
    this._limitAny = false;
    this._limitSegs = {};
    this._bind();
  }

  TimelineEditor.prototype.clampT = function (t) {
    t = f(t);
    if (t < 0) t = 0;
    if (t > this.maxT) t = this.maxT;
    return t;
  };

  TimelineEditor.prototype._refreshMaxT = function () {
    var hz = this.playHz || 50;
    if (hz < 1) hz = 1;
    this.maxT = (this.pathBuffer || 32000) / hz;
    this._clampView();
    this._limitDirty = true;
  };

  TimelineEditor.prototype.setPathBuffer = function (n) {
    n = Number(n);
    if (!n || n < 1) n = 32000;
    this.pathBuffer = n;
    this._refreshMaxT();
    this.draw();
  };

  TimelineEditor.prototype.setPlayHz = function (hz) {
    hz = Number(hz);
    if (isNaN(hz)) hz = 50;
    if (hz < 10) hz = 10;
    if (hz > 200) hz = 200;
    this.playHz = hz;
    this._refreshMaxT();
    this.draw();
    this.onLimitsChange(this.hasLimitViolation());
  };

  TimelineEditor.prototype.setLimits = function (lim) {
    this.limits = lim || {};
    this._limitDirty = true;
    this.draw();
    this.onLimitsChange(this.hasLimitViolation());
  };

  TimelineEditor.prototype.setMarkers = function (markers) {
    this.markers = (markers || []).map(normalizeMarker);
    this.draw();
  };

  TimelineEditor.prototype.setLanes = function (lanes) {
    this.lanes = lanes || [];
    this.lanes.forEach(function (ln) {
      if (this.visible[ln.id] == null) this.visible[ln.id] = true;
      if (this.locked[ln.id] == null) this.locked[ln.id] = false;
      if (!this.viewY[ln.id]) this._fitLaneY(ln.id, false);
    }, this);
    if (this.activeId == null && this.lanes.length) this.activeId = this.lanes[0].id;
    this.lanes.forEach(function (ln) {
      ln.keys = bakeLegacyLane(ln.keys);
    });
    this._limitDirty = true;
    this._tracks();
    this._smoothAll();
    this.draw();
  };

  TimelineEditor.prototype.poseAt = function (t) {
    var pose = {};
    this.lanes.forEach(function (ln) {
      pose[ln.id] = evalAxis(ln.keys, t);
    });
    return pose;
  };

  TimelineEditor.prototype.motionDuration = function () {
    return duration(this.lanes);
  };

  TimelineEditor.prototype.playDuration = function () {
    return playDuration(this.lanes, this.markers);
  };

  TimelineEditor.prototype.hasLimitViolation = function () {
    this._ensureLimits();
    return !!this._limitAny;
  };

  TimelineEditor.prototype._yRange = function (laneId) {
    var y = this.viewY[laneId];
    if (y && y.v1 !== y.v0) return y;
    return { v0: -20, v1: 220 };
  };

  TimelineEditor.prototype._fitLaneY = function (laneId, draw) {
    var ln = this._lane(laneId);
    var vmin = 0, vmax = 1, any = false;
    if (ln) {
      (ln.keys || []).forEach(function (k) {
        any = true;
        vmin = Math.min(vmin, f(k.value));
        vmax = Math.max(vmax, f(k.value));
      });
    }
    if (!any) { vmin = -10; vmax = 100; }
    var pad = (vmax - vmin) * 0.15 || 10;
    this.viewY[laneId] = { v0: vmin - pad, v1: vmax + pad };
    if (draw !== false) this.draw();
  };

  TimelineEditor.prototype._clampView = function () {
    var maxT = this.maxT || 1;
    var span = this.view.t1 - this.view.t0;
    if (span > maxT * 1.05) span = maxT * 1.05;
    if (span < 0.4) span = 0.4;
    if (this.view.t1 > maxT) this.view.t1 = maxT;
    this.view.t0 = this.view.t1 - span;
    var pad = span * 0.05;
    if (this.view.t0 < -pad) {
      this.view.t0 = -pad;
      this.view.t1 = this.view.t0 + span;
      if (this.view.t1 > maxT) this.view.t1 = maxT;
    }
  };

  TimelineEditor.prototype.fitX = function () {
    var dur = duration(this.lanes);
    var maxT = this.maxT || 12;
    var t1 = Math.min(Math.max(2, dur * 1.1), maxT);
    if (t1 < 2 && maxT >= 2) t1 = Math.min(2, maxT);
    var pad = t1 * 0.05;
    this.view.t0 = -pad;
    this.view.t1 = t1;
    this._clampView();
    this.draw();
  };

  TimelineEditor.prototype.fitY = function () {
    if (this.activeId != null) this._fitLaneY(this.activeId, true);
    else this.draw();
  };

  TimelineEditor.prototype.fit = function () {
    var dur = duration(this.lanes);
    var maxT = this.maxT || 12;
    var t1 = Math.min(Math.max(2, dur * 1.1), maxT);
    if (t1 < 2 && maxT >= 2) t1 = Math.min(2, maxT);
    var pad = t1 * 0.05;
    this.view.t0 = -pad;
    this.view.t1 = t1;
    this._clampView();
    if (this.activeId != null) this._fitLaneY(this.activeId, false);
    this.draw();
  };

  TimelineEditor.prototype._tracks = function () {
    var el = this.tracksEl;
    var self = this;
    if (!el) {
      this.onTracksChange();
      return;
    }
    el.innerHTML = "";
    this.lanes.forEach(function (ln) {
      var row = document.createElement("div");
      var on = !!self.visible[ln.id];
      var act = self.activeId === ln.id;
      row.className = "tl-track" + (on ? " on" : "") + (act ? " active" : "");
      row.style.setProperty("--swatch", COLORS[(ln.id - 1) % COLORS.length]);
      var eye = document.createElement("button");
      eye.type = "button";
      eye.className = "tl-eye";
      eye.title = on ? "Hide" : "Show";
      eye.textContent = on ? "◉" : "○";
      eye.onclick = function (ev) {
        ev.stopPropagation();
        self.visible[ln.id] = !self.visible[ln.id];
        self._tracks();
        self.draw();
      };
      var name = document.createElement("span");
      name.className = "tl-track-name";
      name.textContent = ln.name || ("Axis " + ln.id);
      row.appendChild(eye);
      var sw = document.createElement("span");
      sw.className = "swatch";
      sw.style.background = COLORS[(ln.id - 1) % COLORS.length];
      row.appendChild(sw);
      row.appendChild(name);
      row.onclick = function () {
        self.activeId = ln.id;
        self._tracks();
        self.draw();
      };
      el.appendChild(row);
    });
    this.onTracksChange();
  };

  TimelineEditor.prototype._plotH = function (h) {
    return Math.max(1, h - MARKER_H - TIME_H);
  };

  TimelineEditor.prototype._xy = function (t, v, laneId) {
    var r = this.canvas.getBoundingClientRect();
    var w = r.width, h = r.height;
    var plotH = this._plotH(h);
    var x = ((t - this.view.t0) / (this.view.t1 - this.view.t0)) * w;
    var yr = this._yRange(laneId != null ? laneId : this.activeId);
    var y = MARKER_H + (1 - (v - yr.v0) / (yr.v1 - yr.v0)) * plotH;
    return { x: x, y: y };
  };

  TimelineEditor.prototype._tv = function (px, py, laneId) {
    var r = this.canvas.getBoundingClientRect();
    var w = r.width, h = r.height;
    var plotH = this._plotH(h);
    var t = this.view.t0 + (px / w) * (this.view.t1 - this.view.t0);
    var yr = this._yRange(laneId != null ? laneId : this.activeId);
    var u = (plotH - (py - MARKER_H)) / plotH;
    var v = yr.v0 + u * (yr.v1 - yr.v0);
    return { t: t, v: v };
  };

  TimelineEditor.prototype._smoothAll = function () {
    var self = this;
    this.lanes.forEach(function (ln) {
      ln.keys = applyAutoLinearLane(ln.keys);
    });
  };

  TimelineEditor.prototype._ensureLimits = function () {
    if (!this._limitDirty) return;
    this._limitDirty = false;
    this._limitAny = false;
    this._limitSegs = {};
    var dt = 1 / (this.playHz || 50);
    var dur = duration(this.lanes);
    var self = this;
    this.lanes.forEach(function (ln) {
      if (!self.visible[ln.id]) return;
      var lim = self.limits[ln.id] || {};
      var maxSpd = f(lim.max_spd, 1e9);
      var maxAcc = f(lim.max_acc, 1e9);
      var hasMin = lim.min != null && isFinite(Number(lim.min));
      var hasMax = lim.max != null && isFinite(Number(lim.max));
      var pMin = hasMin ? Number(lim.min) : -1e9;
      var pMax = hasMax ? Number(lim.max) : 1e9;
      var yellow = [], red = [], blue = [];
      var prevV = evalAxis(ln.keys, 0);
      var prevSpd = 0;
      var prevT = 0;
      var n = Math.max(0, Math.ceil(dur / dt));
      var i, t, v, spd, acc, yRun = [], rRun = [], bRun = [];
      function flush(run, into) {
        if (run.length) { into.push(run.slice()); run.length = 0; }
      }
      for (i = 1; i <= n; i++) {
        t = i * dt;
        v = evalAxis(ln.keys, t);
        spd = (v - prevV) / dt;
        acc = i >= 2 ? (spd - prevSpd) / dt : 0;
        var ovS = Math.abs(spd) > maxSpd;
        var ovA = i >= 2 && Math.abs(acc) > maxAcc;
        var ovP = (hasMin || hasMax) && (v < pMin || v > pMax);
        if (ovS || ovA || ovP) self._limitAny = true;
        if (ovS) {
          if (!yRun.length) yRun.push({ t: prevT, v: prevV });
          yRun.push({ t: t, v: v });
        } else flush(yRun, yellow);
        if (ovA) {
          if (!rRun.length) rRun.push({ t: prevT, v: prevV });
          rRun.push({ t: t, v: v });
        } else flush(rRun, red);
        if (ovP) {
          if (!bRun.length) bRun.push({ t: prevT, v: prevV });
          bRun.push({ t: t, v: v });
        } else flush(bRun, blue);
        prevV = v;
        prevSpd = spd;
        prevT = t;
      }
      flush(yRun, yellow);
      flush(rRun, red);
      flush(bRun, blue);
      self._limitSegs[ln.id] = { yellow: yellow, red: red, blue: blue };
    });
  };

  TimelineEditor.prototype._strokeRuler = function (ctx, h, w) {
    var bandY = h - TIME_H + 4;
    var self = this;
    ctx.lineWidth = 4;
    ctx.lineCap = "butt";
    function strokeRuns(runs, color) {
      ctx.strokeStyle = color;
      (runs || []).forEach(function (run) {
        if (!run.length) return;
        ctx.beginPath();
        run.forEach(function (pt, i) {
          var x = self._xy(pt.t, 0, self.activeId).x;
          if (i === 0) ctx.moveTo(x, bandY);
          else ctx.lineTo(x, bandY);
        });
        ctx.stroke();
      });
    }
    this.lanes.forEach(function (ln) {
      if (!self.visible[ln.id]) return;
      var segs = self._limitSegs[ln.id] || { yellow: [], red: [], blue: [] };
      strokeRuns(segs.blue, BLUE);
      strokeRuns(segs.yellow, YELLOW);
      strokeRuns(segs.red, RED);
    });
  };

  TimelineEditor.prototype._strokeSegs = function (ctx, segs, laneId, color, width) {
    var self = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    (segs || []).forEach(function (run) {
      if (!run.length) return;
      ctx.beginPath();
      run.forEach(function (pt, i) {
        var p = self._xy(pt.t, pt.v, laneId);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    });
  };

  TimelineEditor.prototype._drawLane = function (ctx, ln, w, active) {
    var self = this;
    var col = laneColor(ln.id, active);
    var keys = sortKeys(ln.keys);
    var segs = this._limitSegs[ln.id] || { yellow: [], red: [], blue: [] };
    this._strokeSegs(ctx, segs.blue, ln.id, BLUE, 7);
    this._strokeSegs(ctx, segs.yellow, ln.id, YELLOW, 7);
    this._strokeSegs(ctx, segs.red, ln.id, RED, 7);
    ctx.globalAlpha = active ? 1 : 0.5;
    ctx.strokeStyle = col;
    ctx.lineWidth = active ? 1.8 : 1.2;
    ctx.beginPath();
    var first = true, i, tt, val, pt;
    var t0 = this.view.t0, t1 = this.view.t1;
    var n = Math.max(80, Math.floor(w));
    for (i = 0; i <= n; i++) {
      tt = t0 + (i / n) * (t1 - t0);
      val = evalAxis(keys, tt);
      pt = this._xy(tt, val, ln.id);
      if (first) { ctx.moveTo(pt.x, pt.y); first = false; }
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    var labels = [];
    keys.forEach(function (k, ki) {
      pt = self._xy(f(k.t), f(k.value), ln.id);
      var sel = self.sel && self.sel.kind === "key" && self.sel.lane === ln.id && self.sel.i === ki;
      if (self.showHandles && isHandleInterp(k.interp)) {
        var computed = isComputedInterp(k.interp);
        ctx.strokeStyle = col;
        ctx.globalAlpha = active ? 0.55 : 0.3;
        ctx.setLineDash(computed ? [3, 3] : []);
        if (k.out) {
          var o = self._xy(f(k.t) + f(k.out.dx), f(k.value) + f(k.out.dy), ln.id);
          ctx.beginPath(); ctx.moveTo(pt.x, pt.y); ctx.lineTo(o.x, o.y); ctx.stroke();
          if (!computed) {
            ctx.fillStyle = col;
            ctx.beginPath(); ctx.arc(o.x, o.y, 3.5, 0, Math.PI * 2); ctx.fill();
          }
        }
        if (k.in) {
          var inn = self._xy(f(k.t) + f(k.in.dx), f(k.value) + f(k.in.dy), ln.id);
          ctx.beginPath(); ctx.moveTo(pt.x, pt.y); ctx.lineTo(inn.x, inn.y); ctx.stroke();
          if (!computed) {
            ctx.fillStyle = col;
            ctx.beginPath(); ctx.arc(inn.x, inn.y, 3.5, 0, Math.PI * 2); ctx.fill();
          }
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      ctx.save();
      ctx.translate(pt.x, pt.y);
      self._drawKeyGlyph(ctx, k.interp, col, sel);
      ctx.restore();
      labels.push({ x: pt.x, y: pt.y, text: fmtVal(k.value), sel: sel, col: col });
    });
    var liveV = this.playing ? evalAxis(keys, this.playhead) : this.live[ln.id];
    if (liveV != null) {
      pt = this._xy(this.playhead, liveV, ln.id);
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    return labels;
  };

  TimelineEditor.prototype._drawKeyGlyph = function (ctx, kind, col, sel) {
    kind = stickyInterp(kind);
    ctx.lineWidth = sel ? 1.6 : 1.3;
    ctx.strokeStyle = sel ? "#fff" : col;
    ctx.fillStyle = col;
    if (kind === "auto") {
      ctx.beginPath();
      ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }
    if (kind === "linear") {
      ctx.save();
      ctx.rotate(Math.PI / 4);
      ctx.strokeRect(-5, -5, 10, 10);
      ctx.restore();
      return;
    }
    if (kind === "free") {
      ctx.fillRect(-5, -5, 10, 10);
      if (sel) ctx.strokeRect(-5, -5, 10, 10);
      return;
    }
    ctx.save();
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-5, -5, 10, 10);
    if (sel) ctx.strokeRect(-5, -5, 10, 10);
    ctx.restore();
  };

  TimelineEditor.prototype._drawPlotGrid = function (ctx, w, h, yr, plotH) {
    var ySpan = yr.v1 - yr.v0;
    var tSpan = this.view.t1 - this.view.t0;
    var pxPerY = ySpan ? plotH / ySpan : 0;
    var pxPerT = tSpan ? w / tSpan : 0;
    var yShown = shownGridSteps(pxPerY * GRID_Y_STEPS[0], GRID_Y_STEPS);
    var xShown = shownGridSteps(pxPerT * GRID_X_STEPS[0], GRID_X_STEPS);
    var y0 = MARKER_H;
    var y1 = h - TIME_H;
    var self = this;
    var i, st, style;

    function yAt(v) {
      return MARKER_H + (1 - (v - yr.v0) / (ySpan || 1)) * plotH;
    }
    function xAt(t) {
      return ((t - self.view.t0) / (tSpan || 1)) * w;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y0, w, Math.max(0, y1 - y0));
    ctx.clip();

    for (i = 0; i < yShown.length; i++) {
      st = GRID_Y_STEPS[yShown[i]];
      style = GRID_LEVEL_STYLE[yShown[i]] || GRID_THIN;
      ctx.strokeStyle = style.c;
      ctx.lineWidth = style.w;
      forTicks(yr.v0, yr.v1, st, function (v) {
        if (Math.abs(v) < 1e-9) return;
        var y = yAt(v);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      });
    }
    for (i = 0; i < xShown.length; i++) {
      st = GRID_X_STEPS[xShown[i]];
      style = GRID_LEVEL_STYLE[xShown[i]] || GRID_THIN;
      ctx.strokeStyle = style.c;
      ctx.lineWidth = style.w;
      forTicks(this.view.t0, this.view.t1, st, function (t) {
        if (Math.abs(t) < 1e-9) return;
        var x = xAt(t);
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
        ctx.stroke();
      });
    }
    ctx.strokeStyle = GRID_ZERO.c;
    ctx.lineWidth = GRID_ZERO.w;
    if (yr.v0 <= 0 && yr.v1 >= 0) {
      var zy = yAt(0);
      ctx.beginPath();
      ctx.moveTo(0, zy);
      ctx.lineTo(w, zy);
      ctx.stroke();
    }
    if (this.view.t0 <= 0 && this.view.t1 >= 0) {
      var zx = xAt(0);
      ctx.beginPath();
      ctx.moveTo(zx, y0);
      ctx.lineTo(zx, y1);
      ctx.stroke();
    }
    ctx.restore();

    ctx.font = "10px system-ui";
    ctx.fillStyle = "#6a8494";
    var yLabs = [];
    function addYLab(v) {
      if (v < yr.v0 - 1e-9 || v > yr.v1 + 1e-9) return;
      var y = yAt(v);
      if (y < y0 - 2 || y > y1 + 2) return;
      if (yLabs.some(function (q) { return Math.abs(q.y - y) < GRID_Y_LABEL_PX; })) return;
      yLabs.push({ v: v, y: y });
    }
    addYLab(0);
    [100, 50, 10].forEach(function (step) {
      forTicks(yr.v0, yr.v1, step, function (v) {
        if (Math.abs(v) < 1e-9) return;
        addYLab(v);
      });
    });
    yLabs.forEach(function (lab) {
      ctx.fillText(fmtGridY(lab.v), 3, lab.y - 2);
    });

    var xLabs = [];
    function addXLab(t) {
      if (t < self.view.t0 - 1e-9 || t > self.view.t1 + 1e-9) return;
      var x = xAt(t);
      if (x < -4 || x > w + 4) return;
      if (xLabs.some(function (q) { return Math.abs(q.x - x) < GRID_X_LABEL_PX; })) return;
      xLabs.push({ t: t, x: x });
    }
    addXLab(0);
    [10, 5, 1].forEach(function (step) {
      forTicks(self.view.t0, self.view.t1, step, function (t) {
        if (Math.abs(t) < 1e-9) return;
        addXLab(t);
      });
    });
    xLabs.forEach(function (lab) {
      var n = Math.abs(lab.t - Math.round(lab.t)) < 1e-6 ? String(Math.round(lab.t)) : lab.t.toFixed(1);
      ctx.fillText(n + "s", lab.x + 3, h - 4);
    });
  };

  TimelineEditor.prototype.draw = function () {
    var c = this.canvas;
    if (!c) return;
    var r = c.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.floor(r.width * dpr) || c.height !== Math.floor(r.height * dpr)) {
      c.width = Math.floor(r.width * dpr);
      c.height = Math.floor(r.height * dpr);
    }
    var ctx = c.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var w = r.width, h = r.height;
    ctx.fillStyle = "#0a0c10";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#12161c";
    ctx.fillRect(0, 0, w, MARKER_H);
    ctx.fillRect(0, h - TIME_H, w, TIME_H);
    this._ensureLimits();
    this._drawPlotGrid(ctx, w, h, this._yRange(this.activeId), this._plotH(h));
    this._strokeRuler(ctx, h, w);
    var self = this;
    var allLabels = [];
    this.lanes.forEach(function (ln) {
      if (!self.visible[ln.id] || ln.id === self.activeId) return;
      allLabels = allLabels.concat(self._drawLane(ctx, ln, w, false));
    });
    var act = this._lane(this.activeId);
    if (act && this.visible[act.id]) {
      allLabels = allLabels.concat(this._drawLane(ctx, act, w, true));
    }
    ctx.font = "9px system-ui";
    allLabels.forEach(function (lab) {
      var crowded = allLabels.some(function (q) {
        return q !== lab && Math.hypot(q.x - lab.x, q.y - lab.y) < LABEL_GAP;
      });
      if (crowded && !lab.sel) return;
      ctx.fillStyle = lab.col;
      ctx.fillText(lab.text, lab.x + 6, lab.y - 8);
    });
    this.markers.forEach(function (mk, mi) {
      var x = self._xy(f(mk.t), 0, self.activeId).x;
      var sel = self.sel && self.sel.kind === "marker" && self.sel.i === mi;
      var letter = firstAlnum(mk.symbol) || "·";
      ctx.fillStyle = sel ? "#fff" : "#d4782a";
      ctx.beginPath();
      ctx.arc(x, MARKER_H / 2, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0a0c10";
      ctx.font = "bold 9px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(letter, x, MARKER_H / 2 + 0.5);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    });
    var p = this._xy(this.playhead, 0, this.activeId);
    ctx.strokeStyle = "#ff4d6d";
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, h); ctx.stroke();
    var hudY = MARKER_H + 12;
    var pose = this.poseAt(this.playhead);
    this.lanes.forEach(function (ln) {
      if (!self.visible[ln.id]) return;
      var col = laneColor(ln.id, ln.id === self.activeId);
      var unit = ln.unit ? " " + ln.unit : "";
      var txt = (ln.name || ("A" + ln.id)) + " " + fmtVal(pose[ln.id]) + unit;
      ctx.font = "11px system-ui";
      ctx.fillStyle = "#0a0c10";
      var tw = ctx.measureText(txt).width;
      var hx = Math.min(w - tw - 8, Math.max(4, p.x + 6));
      ctx.fillRect(hx - 2, hudY - 10, tw + 6, 14);
      ctx.fillStyle = col;
      ctx.fillText(txt, hx, hudY);
      hudY += 14;
    });
  };

  TimelineEditor.prototype._hit = function (px, py) {
    var self = this, best = null, bestD = HIT_R;
    if (py <= MARKER_H) {
      this.markers.forEach(function (mk, mi) {
        var x = self._xy(f(mk.t), 0, self.activeId).x;
        var d = Math.abs(x - px);
        if (d < bestD) { bestD = d; best = { kind: "marker", i: mi }; }
      });
      if (best) return best;
    }
    var cands = [];
    function consider(d, hit) {
      if (d < HIT_R) cands.push({ d: d, hit: hit });
    }
    this.lanes.forEach(function (ln) {
      if (!self.visible[ln.id] || self.locked[ln.id]) return;
      sortKeys(ln.keys).forEach(function (k, ki) {
        var pt = self._xy(f(k.t), f(k.value), ln.id);
        consider(Math.hypot(pt.x - px, pt.y - py), { kind: "key", lane: ln.id, i: ki });
        if (self.showHandles && isHandleInterp(k.interp)) {
          if (k.out) {
            var o = self._xy(f(k.t) + f(k.out.dx), f(k.value) + f(k.out.dy), ln.id);
            consider(Math.hypot(o.x - px, o.y - py), { kind: "out", lane: ln.id, i: ki });
          }
          if (k.in) {
            var inn = self._xy(f(k.t) + f(k.in.dx), f(k.value) + f(k.in.dy), ln.id);
            consider(Math.hypot(inn.x - px, inn.y - py), { kind: "in", lane: ln.id, i: ki });
          }
        }
      });
    });
    if (!cands.length) return null;
    var minD = HIT_R;
    cands.forEach(function (c) { if (c.d < minD) minD = c.d; });
    var pick = null, pickD = HIT_R, pickAct = false;
    cands.forEach(function (c) {
      if (c.d > minD + HIT_OVERLAP) return;
      var act = c.hit.lane === self.activeId;
      if (!pick || (act && !pickAct) || (act === pickAct && c.d < pickD)) {
        pick = c.hit;
        pickD = c.d;
        pickAct = act;
      }
    });
    return pick;
  };

  TimelineEditor.prototype._lane = function (id) {
    for (var i = 0; i < this.lanes.length; i++) if (this.lanes[i].id === id) return this.lanes[i];
    return null;
  };

  TimelineEditor.prototype._setSel = function (sel) {
    this.sel = sel;
    this.onSelChange(sel, this.selectedKey());
  };

  TimelineEditor.prototype.selectedKey = function () {
    if (!this.sel || this.sel.kind !== "key") return null;
    var lane = this._lane(this.sel.lane);
    if (!lane) return null;
    return sortKeys(lane.keys)[this.sel.i] || null;
  };

  TimelineEditor.prototype.setSelectedTV = function (t, v) {
    var k = this.selectedKey();
    if (!k) return;
    if (f(k.t) > 1e-6 && t != null && !isNaN(t)) k.t = this.clampT(t);
    if (v != null && !isNaN(v)) k.value = v;
    var lane = this._lane(this.sel.lane);
    if (lane) {
      lane.keys = sortKeys(lane.keys);
      this._smoothAll();
    }
    this._limitDirty = true;
    this.onChange();
    this.draw();
    this.onLimitsChange(this.hasLimitViolation());
    this.onSelChange(this.sel, this.selectedKey());
  };

  TimelineEditor.prototype.deleteSelected = function () {
    if (!this.sel) return false;
    if (this.sel.kind === "marker") {
      this.markers.splice(this.sel.i, 1);
      this._setSel(null);
      this.onChange();
      this.draw();
      return true;
    }
    if (this.sel.kind !== "key") return false;
    var k = this.selectedKey();
    if (!k || f(k.t) <= 1e-6) return false;
    var lane = this._lane(this.sel.lane);
    var keys = sortKeys(lane.keys);
    keys.splice(this.sel.i, 1);
    lane.keys = keys;
    this._setSel(null);
    this._smoothAll();
    this._limitDirty = true;
    this.onChange();
    this.draw();
    this.onLimitsChange(this.hasLimitViolation());
    return true;
  };

  TimelineEditor.prototype.keyAtPlayhead = function (live, onlyId) {
    var t = this.clampT(this.playhead);
    var snap = 0.05;
    var self = this;
    this.lanes.forEach(function (ln) {
      if (onlyId != null && ln.id !== onlyId) return;
      if (self.locked[ln.id]) return;
      if (onlyId == null && !self.visible[ln.id]) return;
      var keys = sortKeys(ln.keys);
      var val = live && live[ln.id] != null ? live[ln.id] : evalAxis(keys, t);
      var prev = keys[0];
      var replaced = false;
      keys.forEach(function (k) {
        if (f(k.t) <= t) prev = k;
        if (Math.abs(f(k.t) - t) <= snap) {
          k.value = val;
          replaced = true;
        }
      });
      if (!replaced) {
        var h = defaultHandles(1);
        var interp = stickyInterp((prev && prev.interp) || "auto");
        if (isEaseKind(interp)) interp = "auto";
        keys.push({ t: t, value: val, interp: interp, in: h.in, out: h.out });
      }
      ln.keys = sortKeys(keys);
    });
    this._smoothAll();
    this._limitDirty = true;
    this.onChange();
    this.draw();
    this.onLimitsChange(this.hasLimitViolation());
  };

  TimelineEditor.prototype._timeChanged = function () {
    this._smoothAll();
    this._limitDirty = true;
    this.onChange();
    this.draw();
    this.onLimitsChange(this.hasLimitViolation());
  };

  TimelineEditor.prototype.scaleTime = function (s) {
    s = Number(s);
    if (!isFinite(s) || s <= 0) return false;
    var maxT = this.maxT || 1;
    var last = duration(this.lanes) * s;
    this.markers.forEach(function (mk) {
      var t = f(mk.t) * s;
      if (t > last) last = t;
    });
    if (last > maxT + 1e-9) return false;
    this.lanes.forEach(function (ln) {
      (ln.keys || []).forEach(function (k) {
        k.t = f(k.t) * s;
        if (k.in) k.in.dx = f(k.in.dx) * s;
        if (k.out) k.out.dx = f(k.out.dx) * s;
      });
      ln.keys = sortKeys(ln.keys);
    });
    this.markers.forEach(function (mk) { mk.t = f(mk.t) * s; });
    this.playhead = this.clampT(this.playhead * s);
    this._setSel(null);
    this._timeChanged();
    return true;
  };

  TimelineEditor.prototype.shiftTime = function (dt) {
    dt = Number(dt);
    if (!isFinite(dt) || Math.abs(dt) < 1e-9) return false;
    var maxT = this.maxT || 1;
    var eps = 1e-6;
    var plans = [], i, j, t;
    for (i = 0; i < this.lanes.length; i++) {
      var src = sortKeys(this.lanes[i].keys);
      var keep = [], atZero = false, dropped = false;
      for (j = 0; j < src.length; j++) {
        t = f(src[j].t) + dt;
        if (t < -eps) { dropped = true; continue; }
        if (t < eps) { t = 0; atZero = true; }
        if (t > maxT + 1e-9) return false;
        keep.push({ key: src[j], t: t });
      }
      if (dropped && !atZero) return false;
      plans.push({ lane: this.lanes[i], keep: keep, atZero: atZero });
    }
    for (i = 0; i < this.markers.length; i++) {
      t = f(this.markers[i].t) + dt;
      if (t < -eps || t > maxT + 1e-9) return false;
    }
    plans.forEach(function (p) {
      var keys = sortKeys(p.keep.map(function (e) {
        e.key.t = e.t;
        return e.key;
      }));
      if (keys.length && !p.atZero) {
        keys.unshift({
          t: 0,
          value: f(keys[0].value),
          interp: stickyInterp(keys[0].interp || "auto"),
          in: { dx: -0.3, dy: 0 },
          out: { dx: 0.3, dy: 0 }
        });
      }
      p.lane.keys = keys;
    });
    this.markers.forEach(function (mk) {
      var mt = f(mk.t) + dt;
      mk.t = Math.abs(mt) < eps ? 0 : mt;
    });
    this.markers.sort(function (a, b) { return f(a.t) - f(b.t); });
    this.playhead = this.clampT(this.playhead + dt);
    this._setSel(null);
    this._timeChanged();
    return true;
  };

  TimelineEditor.prototype.addMarkerAtPlayhead = function () {
    var mk = normalizeMarker({
      t: this.clampT(this.playhead),
      symbol: nextMarkerSymbol(this.markers),
      beep: true
    });
    this.markers.push(mk);
    this.markers.sort(function (a, b) { return f(a.t) - f(b.t); });
    this._setSel({ kind: "marker", i: this.markers.indexOf(mk) });
    this.onChange();
    this.draw();
    return mk;
  };

  TimelineEditor.prototype.addBeepAtPlayhead = function () {
    return this.addMarkerAtPlayhead();
  };

  TimelineEditor.prototype.removeMarker = function (mk) {
    var i = this.markers.indexOf(mk);
    if (i < 0) return false;
    this.markers.splice(i, 1);
    if (this.sel && this.sel.kind === "marker") this._setSel(null);
    this.onChange();
    this.draw();
    return true;
  };

  TimelineEditor.prototype.letterMarker = function (letter) {
    letter = String(letter || "").toLowerCase();
    var i, mk;
    for (i = 0; i < this.markers.length; i++) {
      mk = this.markers[i];
      if (markerLetter(mk) === letter) return mk;
    }
    return null;
  };

  TimelineEditor.prototype.setLetterAtPlayhead = function (letter) {
    letter = String(letter || "").toLowerCase();
    if (!letter) return;
    var t = this.clampT(this.playhead);
    var mk = this.letterMarker(letter);
    if (mk) mk.t = t;
    else this.markers.push(normalizeMarker({ t: t, kind: "letter", letter: letter }));
    this.markers.sort(function (a, b) { return f(a.t) - f(b.t); });
    this.onChange();
    this.draw();
  };

  TimelineEditor.prototype.clearLetter = function (letter) {
    letter = String(letter || "").toLowerCase();
    var next = [];
    var i, mk;
    for (i = 0; i < this.markers.length; i++) {
      mk = this.markers[i];
      if (markerLetter(mk) !== letter) next.push(mk);
    }
    if (next.length === this.markers.length) return;
    this.markers = next;
    if (this.sel && this.sel.kind === "marker") this._setSel(null);
    this.onChange();
    this.draw();
  };

  TimelineEditor.prototype._visibleKeyTimes = function () {
    var times = [];
    var self = this;
    this.lanes.forEach(function (ln) {
      if (!self.visible[ln.id]) return;
      (ln.keys || []).forEach(function (k) {
        times.push(f(k.t));
      });
    });
    times.sort(function (a, b) { return a - b; });
    var uniq = [];
    times.forEach(function (t) {
      if (!uniq.length || Math.abs(uniq[uniq.length - 1] - t) > 1e-6) uniq.push(t);
    });
    return uniq;
  };

  TimelineEditor.prototype._snapPlayhead = function (t, ev) {
    t = this.clampT(t);
    if (ev && ev.shiftKey) return t;
    var times = this._visibleKeyTimes();
    var best = null;
    var bestD = SNAP_KEY_T;
    var i, d;
    for (i = 0; i < times.length; i++) {
      d = Math.abs(times[i] - t);
      if (d <= bestD) {
        bestD = d;
        best = times[i];
      }
    }
    return best == null ? t : this.clampT(best);
  };

  TimelineEditor.prototype._snapKeyTime = function (t, ev) {
    t = this.clampT(t);
    if (ev && ev.shiftKey) return t;
    var targets = [0, this.playhead];
    var best = t;
    var bestD = SNAP_KEY_T;
    var i, d;
    for (i = 0; i < targets.length; i++) {
      d = Math.abs(targets[i] - t);
      if (d <= bestD) {
        bestD = d;
        best = this.clampT(targets[i]);
      }
    }
    return best;
  };

  TimelineEditor.prototype._clampLaneValue = function (laneId, v) {
    var lim = this.limits[laneId] || {};
    v = f(v);
    if (lim.min != null && isFinite(Number(lim.min))) v = Math.max(v, Number(lim.min));
    if (lim.max != null && isFinite(Number(lim.max))) v = Math.min(v, Number(lim.max));
    return v;
  };

  TimelineEditor.prototype._jumpToKeyTime = function (uniq, dir) {
    var ph = this.playhead;
    var eps = 1e-6;
    var t = null;
    var i;
    if (dir < 0) {
      for (i = uniq.length - 1; i >= 0; i--) {
        if (uniq[i] < ph - eps) { t = uniq[i]; break; }
      }
    } else {
      for (i = 0; i < uniq.length; i++) {
        if (uniq[i] > ph + eps) { t = uniq[i]; break; }
      }
    }
    if (t == null) return false;
    this.playhead = this.clampT(t);
    if (this.playhead < this.view.t0 || this.playhead > this.view.t1) {
      var span = this.view.t1 - this.view.t0;
      this.view.t0 = this.playhead - span * 0.25;
      this.view.t1 = this.view.t0 + span;
      this._clampView();
    }
    this.draw();
    return true;
  };

  TimelineEditor.prototype.jumpVisibleKey = function (dir) {
    return this._jumpToKeyTime(this._visibleKeyTimes(), dir);
  };

  TimelineEditor.prototype.jumpLaneKey = function (laneId, dir) {
    var ln = this._lane(laneId);
    if (!ln) return false;
    var times = [];
    (ln.keys || []).forEach(function (k) { times.push(f(k.t)); });
    times.sort(function (a, b) { return a - b; });
    var uniq = [];
    times.forEach(function (t) {
      if (!uniq.length || Math.abs(uniq[uniq.length - 1] - t) > 1e-6) uniq.push(t);
    });
    return this._jumpToKeyTime(uniq, dir);
  };

  TimelineEditor.prototype.closeEdit = function () {
    if (!this.editEl) return;
    this.editEl.classList.add("hidden");
    this.editEl.blur();
  };

  TimelineEditor.prototype._openEdit = function (k, laneId) {
    var el = this.editEl;
    if (!el || !k) return;
    var pt = this._xy(f(k.t), f(k.value), laneId);
    var wrap = this.canvas.parentNode;
    el.classList.remove("hidden");
    el.value = String(f(k.value));
    el.style.left = Math.max(0, pt.x - 20) + "px";
    el.style.top = Math.max(0, pt.y - 28) + "px";
    el.focus();
    el.select();
    var self = this;
    function commit() {
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("blur", commit);
      if (el.classList.contains("hidden")) return;
      var v = Number(el.value);
      if (!isNaN(v)) {
        k.value = v;
        self._smoothAll();
        self._limitDirty = true;
        self.onChange();
        self.onLimitsChange(self.hasLimitViolation());
      }
      self.closeEdit();
      self.draw();
      self.onSelChange(self.sel, self.selectedKey());
    }
    function onKey(ev) {
      if (ev.key === "Enter") { ev.preventDefault(); commit(); }
      if (ev.key === "Escape") {
        ev.preventDefault();
        el.removeEventListener("keydown", onKey);
        el.removeEventListener("blur", commit);
        self.closeEdit();
      }
    }
    el.addEventListener("keydown", onKey);
    el.addEventListener("blur", commit);
  };

  TimelineEditor.prototype._bind = function () {
    var c = this.canvas, self = this;
    function pos(ev) {
      var r = c.getBoundingClientRect();
      var src = ev.touches ? ev.touches[0] : ev;
      return { x: src.clientX - r.left, y: src.clientY - r.top };
    }
    function down(ev) {
      self.closeEdit();
      var button = ev.touches ? 0 : ev.button;
      var p = pos(ev);
      if (button === 1) {
        var ySnap = {};
        self.lanes.forEach(function (ln) {
          var yr = self._yRange(ln.id);
          ySnap[ln.id] = { v0: yr.v0, v1: yr.v1 };
        });
        self._drag = {
          hit: { kind: "pan" },
          x: p.x, y: p.y,
          t0: self.view.t0, t1: self.view.t1,
          ySnap: ySnap
        };
        ev.preventDefault();
        return;
      }
      var hit = self._hit(p.x, p.y);
      if (button === 2) {
        if (hit && hit.kind === "marker") {
          self._setSel(hit);
          self.draw();
          self.onMarkerEdit(self.markers[hit.i], hit.i);
          ev.preventDefault();
          return;
        }
        var tv = self._tv(p.x, p.y, self.activeId);
        self.playhead = self._snapPlayhead(tv.t, ev);
        self._drag = { hit: { kind: "play" }, commit: true };
        self.onPlayhead(self.playhead, true, true);
      } else if (hit && (hit.kind === "key" || hit.kind === "in" || hit.kind === "out")) {
        var lane = self._lane(hit.lane);
        var keys = sortKeys(lane.keys);
        var k0 = keys[hit.i];
        if ((hit.kind === "in" || hit.kind === "out") && k0 && isComputedInterp(k0.interp)) {
          if (ev.altKey) {
            k0.interp = "aligned";
            makeAligned(k0);
          } else {
            hit = { kind: "key", lane: hit.lane, i: hit.i };
          }
        }
        self._setSel(hit.kind === "in" || hit.kind === "out" ? { kind: "key", lane: hit.lane, i: hit.i } : hit);
        if (hit.kind === "key" || hit.kind === "in" || hit.kind === "out") self.activeId = hit.lane;
        self._tracks();
        var freezeDy = 0;
        var grabDv = 0;
        var grabDt = 0;
        if ((hit.kind === "out" || hit.kind === "in") && k0) {
          var hnd = hit.kind === "out" ? k0.out : k0.in;
          freezeDy = f(hnd && hnd.dy);
          var tvGrab = self._tv(p.x, p.y, hit.lane);
          grabDv = tvGrab.v - (f(k0.value) + freezeDy);
          grabDt = tvGrab.t - (f(k0.t) + f(hnd && hnd.dx));
        }
        self._drag = {
          hit: hit, key: k0, commit: false, freezeDy: freezeDy, startT: f(k0.t),
          grabDv: grabDv, grabDt: grabDt, lockY: !!ev.ctrlKey
        };
      } else if (hit && hit.kind === "marker") {
        self._setSel(hit);
        self._drag = { hit: hit, commit: false };
      } else {
        tv = self._tv(p.x, p.y, self.activeId);
        self.playhead = self._snapPlayhead(tv.t, ev);
        self._drag = { hit: { kind: "play" }, commit: false };
        self.onPlayhead(self.playhead, false);
      }
      self.draw();
      ev.preventDefault();
    }
    function move(ev) {
      if (!self._drag) return;
      var p = pos(ev);
      var hit = self._drag.hit;
      var r, span, plotH, yr, dv, id;
      if (hit.kind === "pan") {
        r = c.getBoundingClientRect();
        span = self._drag.t1 - self._drag.t0;
        self.view.t0 = self._drag.t0 - ((p.x - self._drag.x) / Math.max(1, r.width)) * span;
        self.view.t1 = self.view.t0 + span;
        self._clampView();
        plotH = self._plotH(r.height);
        self.lanes.forEach(function (ln) {
          if (!self.visible[ln.id]) return;
          var snap = self._drag.ySnap[ln.id];
          if (!snap) return;
          dv = ((p.y - self._drag.y) / plotH) * (snap.v1 - snap.v0);
          self.viewY[ln.id] = { v0: snap.v0 + dv, v1: snap.v1 + dv };
        });
        self.draw();
        ev.preventDefault();
        return;
      }
      if (hit.kind === "play") {
        var tv = self._tv(p.x, p.y, self.activeId);
        self.playhead = self._snapPlayhead(tv.t, ev);
        self.onPlayhead(self.playhead, !!self._drag.commit);
      } else if (hit.kind === "marker") {
        tv = self._tv(p.x, p.y, self.activeId);
        var mk = self.markers[hit.i];
        if (mk) mk.t = self.clampT(tv.t);
      } else {
        var lane = self._lane(hit.lane);
        if (!lane) return;
        var k = self._drag.key;
        if (!k) return;
        tv = self._tv(p.x, p.y, hit.lane);
        if (hit.kind === "key") {
          if (f(self._drag.startT) > 1e-6) k.t = self._snapKeyTime(tv.t, ev);
          k.value = self._clampLaneValue(hit.lane, tv.v);
        } else if (hit.kind === "out" || hit.kind === "in") {
          self._dragHandle(k, hit.kind, tv, ev, lane);
        }
        lane.keys = sortKeys(lane.keys);
        self._smoothAll();
        if (self.sel && self.sel.kind === "key" && self.sel.lane === hit.lane) {
          self.sel.i = lane.keys.indexOf(k);
        }
        self._limitDirty = true;
      }
      self.draw();
      if (hit.kind === "key") self.onSelChange(self.sel, self.selectedKey());
      ev.preventDefault();
    }
    function up() {
      if (!self._drag) return;
      var kind = self._drag.hit.kind;
      var commit = self._drag.commit;
      self._drag = null;
      if (kind === "play") {
        if (commit) self.onPlayhead(self.playhead, true, true);
      } else if (kind !== "pan") {
        self._smoothAll();
        self._limitDirty = true;
        self.onChange();
        self.onLimitsChange(self.hasLimitViolation());
      }
      self.draw();
    }
    c.addEventListener("mousedown", down);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    c.addEventListener("contextmenu", function (ev) { ev.preventDefault(); });
    c.addEventListener("auxclick", function (ev) { ev.preventDefault(); });
    c.addEventListener("dblclick", function (ev) {
      var p = pos(ev);
      var hit = self._hit(p.x, p.y);
      if (hit && hit.kind === "key") {
        var lane = self._lane(hit.lane);
        var k = sortKeys(lane.keys)[hit.i];
        self._setSel(hit);
        self._openEdit(k, hit.lane);
        ev.preventDefault();
        return;
      }
      var tv = self._tv(p.x, p.y, self.activeId);
      var lane2 = self._lane(self.activeId) || self.lanes.filter(function (ln) { return self.visible[ln.id]; })[0];
      if (!lane2) return;
      var keys = sortKeys(lane2.keys);
      var h = defaultHandles(1);
      keys.push({ t: self.clampT(tv.t), value: tv.v, interp: "auto", in: h.in, out: h.out });
      lane2.keys = sortKeys(keys);
      self._smoothAll();
      self._limitDirty = true;
      self.onChange();
      self.draw();
      self.onLimitsChange(self.hasLimitViolation());
    });
    c.addEventListener("wheel", function (ev) {
      ev.preventDefault();
      var r = c.getBoundingClientRect();
      if (ev.ctrlKey) {
        var id = self.activeId;
        var yr = self._yRange(id);
        var py = ev.clientY - r.top;
        var plotH = self._plotH(r.height);
        var u = (plotH - (py - MARKER_H)) / plotH;
        var span = yr.v1 - yr.v0;
        var anchor = yr.v0 + span * u;
        var s = ev.deltaY > 0 ? 1.08 : 0.92;
        var next = span * s;
        if (next < 1e-3) next = 1e-3;
        yr.v0 = anchor - next * u;
        yr.v1 = yr.v0 + next;
        self.viewY[id] = yr;
        self.draw();
        return;
      }
      var s = ev.deltaY > 0 ? 1.08 : 0.92;
      var u = (ev.clientX - r.left) / Math.max(1, r.width);
      var span = self.view.t1 - self.view.t0;
      var anchor = self.view.t0 + span * u;
      var next = span * s;
      if (next < 0.4) next = 0.4;
      var maxSpan = (self.maxT || 12) * 1.05;
      if (next > maxSpan) next = maxSpan;
      self.view.t0 = anchor - next * u;
      self.view.t1 = self.view.t0 + next;
      self._clampView();
      self.draw();
    }, { passive: false });
    window.addEventListener("keydown", function (ev) {
      if (ev.key !== "Delete" && ev.key !== "Backspace") return;
      var tag = ev.target && ev.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (self.deleteSelected()) ev.preventDefault();
    });
  };

  TimelineEditor.prototype._dragHandle = function (k, side, tv, ev, lane) {
    ensureHandles(k);
    var keys = sortKeys(lane.keys);
    var i = keys.indexOf(k);
    var dx = tv.t - f(this._drag.grabDt) - f(k.t);
    var dy = (ev.ctrlKey || this._drag.lockY) ? 0 : (tv.v - f(this._drag.grabDv) - f(k.value));
    if (!(ev.ctrlKey || this._drag.lockY) && ev.altKey) {
      var neighbor = side === "out" ? keys[i + 1] : keys[i - 1];
      var chord = neighbor
        ? { dx: f(neighbor.t) - f(k.t), dy: f(neighbor.value) - f(k.value) }
        : { dx: side === "out" ? 1 : -1, dy: 0 };
      var proj = projectOnChord(dx, dy, chord);
      dx = proj.dx;
      dy = proj.dy;
    }
    var clamped = clampHandle(side, dx, dy, k, keys, i);
    dx = clamped.dx;
    dy = clamped.dy;
    if (side === "out") k.out = { dx: dx, dy: dy };
    else k.in = { dx: dx, dy: dy };
    var kind = stickyInterp(k.interp);
    var shift = !!ev.shiftKey;
    if (kind === "aligned" || shift) mirrorOpposite(k, side, shift);
  };

  TimelineEditor.prototype.setInterp = function (kind) {
    if (!this.sel || this.sel.kind !== "key") return;
    var k = this.selectedKey();
    if (!k) return;
    kind = String(kind || "");
    if (isEaseKind(kind)) {
      this.applyEasePreset(kind);
      return;
    }
    kind = stickyInterp(kind);
    if (kind !== "auto" && kind !== "aligned" && kind !== "free" && kind !== "linear") return;
    k.interp = kind;
    if (kind === "aligned") makeAligned(k);
    this._smoothAll();
    this._limitDirty = true;
    this.onChange();
    this.draw();
    this.onLimitsChange(this.hasLimitViolation());
  };

  TimelineEditor.prototype.applyEasePreset = function (kind) {
    if (!this.sel || this.sel.kind !== "key") return;
    var k = this.selectedKey();
    if (!k) return;
    var lane = this._lane(this.sel.lane);
    var keys = sortKeys(lane.keys);
    var i = keys.indexOf(k);
    var prev = keys[i - 1], next = keys[i + 1];
    var dtIn = prev ? Math.abs(f(k.t) - f(prev.t)) : 1;
    var dtOut = next ? Math.abs(f(next.t) - f(k.t)) : 1;
    ensureHandles(k);
    if (kind === "ease_in" || kind === "ease_inout" || kind === "ease_in_out") {
      k.in = { dx: -dtIn / 3, dy: 0 };
    }
    if (kind === "ease_out" || kind === "ease_inout" || kind === "ease_in_out") {
      k.out = { dx: dtOut / 3, dy: 0 };
    }
    if (handlesAligned(k)) {
      k.interp = "aligned";
      makeAligned(k);
    } else k.interp = "free";
    this._smoothAll();
    this._limitDirty = true;
    this.onChange();
    this.draw();
    this.onLimitsChange(this.hasLimitViolation());
  };

  TimelineEditor.prototype.interpState = function () {
    var k = this.selectedKey();
    if (!k) return { kind: "", easeIn: false, easeOut: false, easeInOut: false };
    var kind = stickyInterp(k.interp);
    if (isEaseKind(kind)) kind = handlesAligned(k) ? "aligned" : "free";
    var ein = isFlatHandle(k.in);
    var eout = isFlatHandle(k.out);
    return { kind: kind, easeIn: ein, easeOut: eout, easeInOut: ein && eout };
  };

  TimelineEditor.COLORS = COLORS;
  TimelineEditor.evalAxis = evalAxis;
  TimelineEditor.duration = duration;
  TimelineEditor.playDuration = playDuration;
  TimelineEditor.markerLetter = markerLetter;
  TimelineEditor.normalizeMarker = normalizeMarker;
  TimelineEditor.stickyInterp = stickyInterp;
  TimelineEditor.bakeLegacyLane = bakeLegacyLane;
  global.TimelineEditor = TimelineEditor;
})(window);
