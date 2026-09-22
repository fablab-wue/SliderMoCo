# mock_mc.py — in-process SliderMC stand-in (no USB). Duck-typed like MC_Client.

try:
    import uasyncio as asyncio
except ImportError:
    import asyncio

if not hasattr(asyncio, "sleep_ms"):
    async def _sleep_ms(ms):
        await asyncio.sleep(ms / 1000.0)

    asyncio.sleep_ms = _sleep_ms

import time

if not hasattr(time, "ticks_ms"):
    time.ticks_ms = lambda: int(time.monotonic() * 1000)
    time.ticks_diff = lambda a, b: a - b
    time.ticks_add = lambda a, b: a + b

_UNBOUND = 1.0e9

# name, unit, min, max, max_spd, max_acc
_AXIS_META = (
    ("slide", "mm", 0.0, 600.0, 100.0, 500.0),
    ("pan", "deg", 0.0, 360.0, 80.0, 400.0),
    ("tilt", "deg", -90.0, 90.0, 60.0, 300.0),
    ("roll", "deg", -180.0, 180.0, 60.0, 300.0),
    ("focus", "mm", 0.0, 100.0, 40.0, 200.0),
    ("zoom", "mm", 0.0, 100.0, 40.0, 200.0),
)


def _f(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _clamp_n(n, default=3):
    try:
        n = int(n)
    except (TypeError, ValueError):
        n = default
    if n < 1:
        return 1
    if n > 6:
        return 6
    return n


def _fmt_num(v):
    if v is None:
        return "None"
    if isinstance(v, int) or (isinstance(v, float) and v == int(v)):
        return str(int(v))
    s = "%.2f" % float(v)
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return s


class MockMC:
    """Kinematics + Motion Path buffer. ``_write_line`` accepts real MC ASCII."""

    EXPECTED_PROTO = "1"

    def __init__(self, axis_count=3, motors=None, servos=None):
        self.linked = True
        self.link_reason = "ok"
        self.banner_name = ""
        self.banner_line = "# MC V1 - mock"
        n = _clamp_n(axis_count)
        if motors is None:
            motors = min(3, n)
        else:
            try:
                motors = int(motors)
            except (TypeError, ValueError):
                motors = min(3, n)
            if motors < 1:
                motors = 1
            if motors > 3:
                motors = 3
        if servos is None:
            servos = n - motors
        else:
            try:
                servos = int(servos)
            except (TypeError, ValueError):
                servos = 0
        if servos < 0:
            servos = 0
        if servos > 3:
            servos = 3
        self._motors = motors
        self._servos = servos
        self.motors = motors
        self.servos = servos
        self._axis = motors + servos
        if self._axis < 1:
            self._axis = 1
        if self._axis > 6:
            self._axis = 6
        n = self._axis
        self._pos = [0.0] * n
        self._spd = [0.0] * n
        self._acc = [0.0] * n
        self._tgt = [None] * n
        self._vel = [0.0] * n
        self._smin = [None] * n
        self._smax = [None] * n
        self._soft_min = [None] * n
        self._soft_max = [None] * n
        cfg = {
            "axis_count": n,
            "axis": n,
            "motors": self._motors,
            "servos": self._servos,
            "name": "SliderMoCo mock",
            "path_buffer_size": 32000,
            "init_path_slice_us": 10000,
            "init_speed": 40.0,
            "init_accel": 100.0,
        }
        i = 0
        while i < n:
            meta = _AXIS_META[i]
            lo, hi = meta[2], meta[3]
            self._smin[i] = lo
            self._smax[i] = hi
            self._soft_min[i] = lo
            self._soft_max[i] = hi
            cfg["name_%d" % (i + 1)] = meta[0]
            uk = "unit_name" if i == 0 else "unit_name_%d" % (i + 1)
            cfg[uk] = meta[1]
            cfg["max_speed_%d" % (i + 1)] = meta[4]
            cfg["max_accel_%d" % (i + 1)] = meta[5]
            cfg["slider_min_%d" % (i + 1)] = lo
            cfg["slider_max_%d" % (i + 1)] = hi
            cfg["axis_min_%d" % (i + 1)] = lo
            cfg["axis_max_%d" % (i + 1)] = hi
            cfg["soft_min_%d" % (i + 1)] = lo
            cfg["soft_max_%d" % (i + 1)] = hi
            cfg["AXIS_%d_name" % (i + 1)] = meta[0]
            cfg["AXIS_%d_unit_name" % (i + 1)] = meta[1]
            cfg["AXIS_%d_min" % (i + 1)] = lo
            cfg["AXIS_%d_max" % (i + 1)] = hi
            cfg["AXIS_%d_max_speed" % (i + 1)] = meta[4]
            cfg["AXIS_%d_max_accel" % (i + 1)] = meta[5]
            if i < self._motors:
                cfg["MOTOR_%d_min" % (i + 1)] = lo
                cfg["MOTOR_%d_max" % (i + 1)] = hi
                cfg["MOTOR_%d_max_speed" % (i + 1)] = meta[4]
                cfg["MOTOR_%d_max_accel" % (i + 1)] = meta[5]
                cfg["MOTOR_%d_steps_per_unit" % (i + 1)] = 320
            else:
                s = i - self._motors + 1
                cfg["SERVO_%d_min" % s] = lo
                cfg["SERVO_%d_max" % s] = hi
                cfg["SERVO_%d_max_speed" % s] = meta[4]
                cfg["SERVO_%d_max_accel" % s] = meta[5]
            i += 1
        cfg["slider_min"] = self._smin[0]
        cfg["slider_max"] = self._smax[0]
        cfg["max_speed"] = _AXIS_META[0][4]
        cfg["max_accel"] = _AXIS_META[0][5]
        cfg["max_speed_1"] = _AXIS_META[0][4]
        cfg["max_accel_1"] = _AXIS_META[0][5]
        cfg["unit_name"] = _AXIS_META[0][1]
        self.mc_config = cfg
        self.max_speed = _AXIS_META[0][4]
        self.max_accel = _AXIS_META[0][5]
        self.unit_name = _AXIS_META[0][1]
        self._speed_mm_s = 40.0
        self._accel_mm_s2 = 100.0
        self._decel_mm_s2 = 100.0
        self._enabled = True
        self._state = "I"
        self.last_status_line = ""
        self._axis_status_cb = None
        self._error_cb = None
        self._path = []
        self._path_i = 0
        self._path_on = False
        self._slice_us = 10000
        self._slice_carry = 0.0
        self._last_ms = time.ticks_ms()
        self._trig_until_ms = None
        self._sync_public()

    def _sync_public(self):
        n = self._axis
        i = 0
        while i < 6:
            if i == 0:
                self.slider_min = self._smin[0] if n > 0 else None
                self.slider_max = self._smax[0] if n > 0 else None
                self.soft_min = self._soft_min[0] if n > 0 else None
                self.soft_max = self._soft_max[0] if n > 0 else None
            suf = "" if i == 0 else "_%d" % (i + 1)
            if i == 0:
                setattr(self, "slider_min_1", self._smin[0] if n > 0 else None)
                setattr(self, "slider_max_1", self._smax[0] if n > 0 else None)
            if i >= 1:
                setattr(self, "slider_min%s" % suf, self._smin[i] if i < n else None)
                setattr(self, "slider_max%s" % suf, self._smax[i] if i < n else None)
                setattr(self, "soft_min%s" % suf, self._soft_min[i] if i < n else None)
                setattr(self, "soft_max%s" % suf, self._soft_max[i] if i < n else None)
            i += 1

    @property
    def axis_count(self):
        return self._axis

    def getAxisCount(self):
        return self._axis

    def getMotorCount(self):
        return self._motors

    def getServoCount(self):
        return self._servos

    def set_axis_status_callback(self, cb):
        self._axis_status_cb = cb

    def set_error_callback(self, cb):
        self._error_cb = cb

    def set_answer_callback(self, cb):
        pass

    def isDRVErrorActive(self):
        return False

    def isAtHardLimit(self):
        return False

    def isHoming(self):
        return self._state == "H"

    def isMoving(self):
        return self._state in ("M", "A", "B", "P", "H")

    def isAtSoftLimit(self):
        return False

    def isNearSoftLimit(self):
        return False

    def isDecelerating(self):
        return self._state == "B"

    def getPosition(self):
        return self._pos[0] if self._pos else 0.0

    def getPosition2(self):
        return self._pos[1] if self._axis >= 2 else 0.0

    def getPosition3(self):
        return self._pos[2] if self._axis >= 3 else 0.0

    def enable(self, on):
        self._enabled = bool(on)
        if not on:
            i = 0
            while i < self._axis:
                self._vel[i] = 0.0
                self._tgt[i] = None
                i += 1
            self._path_on = False
            self._state = "D"
        elif self._state == "D":
            self._state = "I"

    def setSpeed(self, v):
        self._speed_mm_s = abs(_f(v, 40.0))

    def setAcceleration(self, v, d=None):
        self._accel_mm_s2 = abs(_f(v, 100.0))
        if d is None:
            self._decel_mm_s2 = self._accel_mm_s2
        else:
            self._decel_mm_s2 = abs(_f(d, self._accel_mm_s2))

    def stop(self):
        self._path_on = False
        i = 0
        while i < self._axis:
            self._tgt[i] = None
            self._vel[i] = 0.0
            i += 1
        self._state = "I"

    def halt(self):
        self.stop()
        self._enabled = False
        self._state = "D"

    def _bound(self, lo, hi):
        a = -_UNBOUND if lo is None else float(lo)
        b = _UNBOUND if hi is None else float(hi)
        return a, b

    def _jog_or_seek(self, signed_mm_s, lo, hi):
        end = lo if signed_mm_s < 0 else hi
        if end is None:
            return None, signed_mm_s
        return end, 0.0

    def move(self, signed_mm_s, mask=1):
        """Axis-1 cruise (client ``MJ ±100``). Host UI sends multi-slot ``MJ`` via ``_write_line``."""
        if not self._enabled:
            return
        self._path_on = False
        mag = abs(_f(signed_mm_s))
        if mag < 1e-6:
            self.stop()
            return
        self._speed_mm_s = mag
        signed = -mag if signed_mm_s < 0 else mag
        i = 0
        while i < self._axis:
            self._tgt[i] = None
            self._vel[i] = 0.0
            i += 1
        t, v = self._jog_or_seek(signed, self._soft_min[0], self._soft_max[0])
        self._tgt[0] = t
        if t is None:
            self._vel[0] = v
        self._state = "M"

    async def start(self, banner_timeout_s=3.0):
        self.linked = True
        return True

    async def fetchConfig(self, settle_ms=150):
        return dict(self.mc_config)

    def _soft_dict(self):
        out = {
            "min": self.soft_min,
            "max": self.soft_max,
        }
        i = 2
        while i <= 6:
            out["min%d" % i] = getattr(self, "soft_min_%d" % i, None)
            out["max%d" % i] = getattr(self, "soft_max_%d" % i, None)
            i += 1
        return out

    async def fetchSoftLimits(self, timeout_s=0.5):
        return self._soft_dict()

    def _pipe_vals(self, seq):
        parts = []
        i = 0
        while i < self._axis:
            parts.append(_fmt_num(seq[i]))
            i += 1
        return " | ".join(parts)

    async def query(self, command, arg=None, timeout_s=1.0):
        cmd = str(command).strip().upper()
        if cmd == "GE":
            return "1" if self._enabled else "0"
        if cmd == "GS":
            return str(self._speed_mm_s)
        if cmd == "GA":
            return "%s %s" % (self._accel_mm_s2, getattr(self, "_decel_mm_s2", self._accel_mm_s2))
        if cmd == "VP":
            return "1"
        if cmd == "IA":
            return str(self._axis)
        if cmd == "IP":
            return self._pipe_vals(self._pos)
        if cmd == "GL":
            return self._pipe_vals(self._soft_min)
        if cmd == "GR":
            return self._pipe_vals(self._soft_max)
        if cmd == "IM":
            return "1" if self.isMoving() else "0"
        return None

    def _status_line(self):
        groups = []
        i = 0
        while i < self._axis:
            pos = self._pos[i]
            spd = self._spd[i]
            acc = self._acc[i]
            tgt = self._tgt[i]
            g = "%.2f %.2f %.2f" % (pos, spd, acc)
            if tgt is not None:
                g += " %.2f" % tgt
            groups.append(g)
            i += 1
        return "#" + self._state + " " + " | ".join(groups)

    def _emit(self):
        self.last_status_line = self._status_line()
        cb = self._axis_status_cb
        if not cb:
            return
        st = self._state
        i = self._axis
        while i >= 1:
            k = i - 1
            cb(i, st, self._pos[k], self._spd[k], self._acc[k], self._tgt[k])
            i -= 1

    def _slot(self, tok):
        t = str(tok).strip()
        if not t or t == "_" or t.lower() == "none" or t == "-":
            return None
        return _f(t)

    def _set_soft_i(self, side, i, tok):
        t = str(tok).strip()
        if t == "_":
            return
        if not t or t.lower() == "none" or t == "-":
            if side == "min":
                self._soft_min[i] = None
            else:
                self._soft_max[i] = None
            return
        v = _f(t)
        if side == "min":
            self._soft_min[i] = v
        else:
            self._soft_max[i] = v

    def _write_line(self, line):
        line = str(line or "").strip()
        if not line:
            return
        parts = line.split()
        cmd = parts[0].upper()
        args = parts[1:]
        n = self._axis
        if cmd == "SE":
            if args:
                self.enable(int(_f(args[0])) != 0)
            else:
                self.enable(not self._enabled)
        elif cmd == "SS":
            if args:
                self.setSpeed(args[0])
        elif cmd == "SA":
            if args:
                self.setAcceleration(args[0], args[1] if len(args) > 1 else None)
        elif cmd == "MS":
            self.stop()
        elif cmd in ("H", "HT", "HALT", "ME"):
            self.halt()
        elif cmd == "MT":
            self._path_on = False
            i = 0
            while i < n and i < len(args):
                v = self._slot(args[i])
                if v is not None:
                    self._tgt[i] = v
                i += 1
            self._state = "M"
        elif cmd == "MB":
            self._path_on = False
            i = 0
            while i < n and i < len(args):
                d = self._slot(args[i])
                if d is not None:
                    self._tgt[i] = self._pos[i] + d
                i += 1
            self._state = "M"
        elif cmd == "SP":
            i = 0
            while i < n and i < len(args):
                v = self._slot(args[i])
                if v is not None:
                    self._pos[i] = self._pos[i] - v
                i += 1
        elif cmd == "MH":
            ax = 1
            if args:
                ax = int(_f(args[0], 1))
            if ax < 1:
                ax = 1
            if ax > self._motors:
                return
            self._tgt[ax - 1] = 0.0
            self._state = "H"
        elif cmd == "MJ":
            i = 0
            while i < n:
                self._vel[i] = 0.0
                self._tgt[i] = None
                i += 1
            i = 0
            while i < n and i < len(args):
                pct = _f(args[i])
                self._vel[i] = (pct / 100.0) * self._speed_mm_s
                i += 1
            moving = 0.0
            i = 0
            while i < n:
                moving += abs(self._vel[i])
                i += 1
            self._state = "M" if moving > 0.01 else "I"
        elif cmd == "SL":
            i = 0
            while i < n and i < len(args):
                self._set_soft_i("min", i, args[i])
                i += 1
            self._sync_public()
        elif cmd == "SR":
            i = 0
            while i < n and i < len(args):
                self._set_soft_i("max", i, args[i])
                i += 1
            self._sync_public()
        elif cmd == "PC":
            self._path = []
            self._path_i = 0
            self._path_on = False
        elif cmd == "PS":
            if args:
                us = int(_f(args[0], 10000))
                if us >= 1000:
                    self._slice_us = us
        elif cmd == "PD":
            row = []
            i = 0
            while i < 6:
                row.append(int(_f(args[i])) if i < len(args) else 0)
                i += 1
            self._path.append(tuple(row[:n] if n else row[:1]))
        elif cmd == "PG":
            if self._path and self._enabled:
                self._path_i = 0
                self._path_on = True
                self._slice_carry = 0.0
                self._state = "P"
        elif cmd == "CT":
            ms = 100
            if args:
                ms = int(_f(args[0], 100))
            if ms < 1:
                ms = 1
            if ms > 60000:
                ms = 60000
            self._trig_until_ms = time.ticks_add(time.ticks_ms(), ms)
            self._state = "T"
            self._emit()
        elif cmd in ("CG", "SV", "PN"):
            pass

    def _overlay_trigger(self, now):
        if self._trig_until_ms is None:
            return
        if time.ticks_diff(self._trig_until_ms, now) > 0:
            self._state = "T"
        else:
            self._trig_until_ms = None

    def tick(self, dt_s=None):
        now = time.ticks_ms()
        if dt_s is None:
            dt_s = time.ticks_diff(now, self._last_ms) * 0.001
        self._last_ms = now
        if dt_s < 0:
            dt_s = 0.0
        if dt_s > 0.2:
            dt_s = 0.2
        if not self._enabled:
            self._state = "D"
            self._overlay_trigger(now)
            self._emit()
            return
        if self._path_on:
            self._tick_path(dt_s)
        else:
            self._tick_seek(dt_s)
        self._overlay_trigger(now)
        self._emit()

    def _tick_path(self, dt_s):
        slice_s = self._slice_us * 1e-6
        self._slice_carry += dt_s
        n = self._axis
        while self._path_on and self._slice_carry >= slice_s:
            self._slice_carry -= slice_s
            if self._path_i >= len(self._path):
                self._path_on = False
                i = 0
                while i < n:
                    self._vel[i] = 0.0
                    self._tgt[i] = None
                    i += 1
                self._state = "I"
                break
            row = self._path[self._path_i]
            self._path_i += 1
            i = 0
            while i < n:
                um = row[i] if i < len(row) else 0
                d = um * 0.001
                self._pos[i] += d
                self._spd[i] = d / slice_s if slice_s else 0.0
                self._acc[i] = 0.0
                i += 1
            self._state = "P"

    def _approach(self, pos, tgt, vel, dt, lo, hi):
        cruise = abs(self._speed_mm_s) or 40.0
        acc = abs(self._accel_mm_s2) or 100.0
        lo, hi = self._bound(lo, hi)
        if tgt is None:
            npos = pos + vel * dt
            nspd = vel
            if npos < lo:
                npos = lo
                nspd = 0.0
            if npos > hi:
                npos = hi
                nspd = 0.0
            return npos, nspd, None, abs(nspd) > 0.02
        err = tgt - pos
        if abs(err) < 0.05:
            return tgt, 0.0, None, False
        direction = 1.0 if err > 0 else -1.0
        dist = abs(err)
        v_stop = (2.0 * acc * dist) ** 0.5
        want = cruise if v_stop > cruise else v_stop
        nvel = vel + direction * acc * dt
        if abs(nvel) > want:
            nvel = direction * want
        npos = pos + nvel * dt
        if (direction > 0 and npos >= tgt) or (direction < 0 and npos <= tgt):
            return tgt, 0.0, None, False
        if npos < lo:
            return lo, 0.0, None, False
        if npos > hi:
            return hi, 0.0, None, False
        return npos, nvel, tgt, True

    def _tick_seek(self, dt_s):
        n = self._axis
        any_mov = False
        i = 0
        while i < n:
            p, v, t, mov = self._approach(
                self._pos[i],
                self._tgt[i],
                self._vel[i],
                dt_s,
                self._soft_min[i],
                self._soft_max[i],
            )
            self._pos[i], self._vel[i], self._tgt[i] = p, v, t
            self._spd[i] = abs(v)
            if mov:
                any_mov = True
            i += 1
        if self._state == "H" and not any_mov:
            self._state = "I"
        elif any_mov:
            cruise = abs(self._speed_mm_s) or 40.0
            pick = "M"
            i = 0
            while i < n:
                v = self._vel[i]
                t = self._tgt[i]
                p = self._pos[i]
                if t is None and abs(v) <= 0.02:
                    self._acc[i] = 0.0
                elif abs(v) >= cruise * 0.95:
                    self._acc[i] = 0.0
                    if pick != "B":
                        pick = "M"
                elif t is not None and abs(t - p) < 8:
                    self._acc[i] = abs(self._accel_mm_s2)
                    pick = "B"
                else:
                    self._acc[i] = abs(self._accel_mm_s2)
                    if pick != "B":
                        pick = "A"
                i += 1
            self._state = pick
        else:
            self._state = "I"
            i = 0
            while i < n:
                self._acc[i] = 0.0
                i += 1
