# task_runner — Pico-owned long-running tasks.
#
# Phone: {"task":"TSK_PPM …"} / {"task":"TSK_TL_CONT …"} / {"task":"TSK_TL_MSM …"}
# Desktop timeline: {"task":"TSK_TL_PATH_CONT …"} / {"task":"TSK_TL_PATH_MSM …"}
# One active task; start replaces previous. Cancel on MC lines starting with M.

import time

import SW_config as cfg
from dbg import dbg

# name -> required arg count after the command token
_SPECS = {
    "TSK_PPM": 5,  # pos1 pos1_2 pos2 pos2_2 delay_s
    "TSK_TL_CONT": 6,  # pos pos2 speed accel trigger_time_s trigger_length_s
    "TSK_TL_MSM": 5,  # pos pos2 frames trigger_time_s trigger_length_s
    "TSK_TL_STEP": 6,  # dest1 dest2 step1 step2 trigger_time_s trigger_length_s
    "TSK_TL_PATH_CONT": 3,  # factor trigger_time_s trigger_length_s
    "TSK_TL_PATH_MSM": 2,  # trigger_time_s trigger_length_s
}

_IM_FIRST_MS = 300
_IM_EVERY_MS = 500
_TL_NEAR_MM = 1.0
_TRIG_TIME_MIN = 0.2
_TRIG_LEN_MIN = 0.01
_TRIG_LEN_MAX = 30.0
_CT_MS_MAX = 60000


def _parse_slot(s):
    t = str(s).strip()
    if not t or t == "_" or t.lower() == "none" or t == "-":
        return None
    try:
        return float(t)
    except ValueError:
        return None


def _fmt_pos(v):
    n = float(v)
    r = round(n, 1)
    if abs(r - int(r)) < 1e-6:
        return str(int(r))
    return "%s" % r


def _fmt_speed(v):
    return ("%.6f" % float(v)).rstrip("0").rstrip(".") or "0"


def _clamp_trig_time(v):
    try:
        t = float(v)
    except (TypeError, ValueError):
        t = _TRIG_TIME_MIN
    if t < _TRIG_TIME_MIN:
        t = _TRIG_TIME_MIN
    return t


def _clamp_trig_len(v):
    try:
        t = float(v)
    except (TypeError, ValueError):
        t = _TRIG_LEN_MIN
    if t < _TRIG_LEN_MIN:
        t = _TRIG_LEN_MIN
    if t > _TRIG_LEN_MAX:
        t = _TRIG_LEN_MAX
    return t


def _mt_packed(positions):
    if not positions:
        return None
    parts = []
    any_pos = False
    i = 0
    while i < len(positions) and i < 6:
        v = positions[i]
        if v is None:
            parts.append("_")
        else:
            parts.append(_fmt_pos(v))
            any_pos = True
        i += 1
    while parts and parts[-1] == "_":
        parts.pop()
    if not any_pos or not parts:
        return None
    return "MT " + " ".join(parts)


def _moving_phrase(p1, p2):
    if p1 is not None and p2 is not None:
        return "Moving to %s / %s" % (_fmt_pos(p1), _fmt_pos(p2))
    if p1 is not None:
        return "Moving to %s" % _fmt_pos(p1)
    if p2 is not None:
        return "Moving to %s" % _fmt_pos(p2)
    return "Moving"


def _mt_line(p1, p2):
    if p1 is None and p2 is None:
        return None
    if p2 is None:
        return "MT %s" % _fmt_pos(p1)
    if p1 is None:
        return "MT _ %s" % _fmt_pos(p2)
    return "MT %s %s" % (_fmt_pos(p1), _fmt_pos(p2))


class TaskRunner:
    def __init__(self, panel=None):
        self.panel = panel
        self.active = None  # dict or None
        self._gen = 0
        self._idle = False
        self._im_last_ms = 0

    def status_dict(self):
        a = self.active
        if not a:
            return None
        out = {
            "name": a.get("name"),
            "state": a.get("state"),
            "detail": a.get("detail") or "",
            "args": list(a.get("args") or []),
            "id": a.get("id"),
        }
        if a.get("loop") is not None:
            out["loop"] = int(a["loop"])
        if a.get("frame") is not None and a.get("frames") is not None:
            out["frame"] = int(a["frame"])
            out["frames"] = int(a["frames"])
        return out

    def _write(self, line):
        p = self.panel
        if p is None:
            return False
        if hasattr(p, "write_mc"):
            return p.write_mc(line)
        return False

    def _camera(self):
        p = self.panel
        if p is None:
            return None
        return getattr(p, "camera", None)

    def _camera_off(self):
        cam = self._camera()
        if cam is not None:
            try:
                cam.off()
            except Exception:
                pass

    def _camera_tick(self):
        cam = self._camera()
        if cam is not None:
            try:
                cam.tick()
            except Exception:
                pass

    def _flash(self, msg):
        p = self.panel
        if p is not None and hasattr(p, "flash"):
            try:
                p.flash(msg)
            except Exception:
                pass

    def _axis_count(self):
        p = self.panel
        if p is not None and getattr(p, "mc", None) is not None:
            mc = p.mc
            if hasattr(mc, "getAxisCount"):
                try:
                    n = int(mc.getAxisCount() or 0)
                    if n > 0:
                        return n
                except (TypeError, ValueError):
                    pass
            if hasattr(mc, "getMotorCount"):
                return int(mc.getMotorCount() or 1)
            return int(getattr(mc, "axis_count", 1) or 1)
        if p is not None and getattr(p, "sim", False):
            return 2
        return 1

    def _path_samples(self):
        p = self.panel
        rows = getattr(p, "path_samples", None) if p is not None else None
        if not rows:
            return []
        return rows

    def _path_slice_us(self):
        p = self.panel
        if p is None:
            return 0
        try:
            return int(getattr(p, "path_slice_us", 0) or 0)
        except (TypeError, ValueError):
            return 0

    def _cur_pose_list(self):
        n = self._axis_count()
        if n < 1:
            n = 1
        if n > 6:
            n = 6
        p = self.panel
        act = getattr(p, "_act", None) or {} if p is not None else {}
        out = []
        i = 1
        while i <= n:
            suf = "" if i == 1 else str(i)
            v = act.get("pos" + suf)
            if v is None:
                out.append(0.0)
            else:
                try:
                    out.append(float(v))
                except (TypeError, ValueError):
                    out.append(0.0)
            i += 1
        return out

    def _shutter(self, trig_len):
        cam = self._camera()
        if cam is not None:
            try:
                cam.start_pulse_s(trig_len)
            except Exception:
                pass
        try:
            ms = int(float(trig_len) * 1000 + 0.5)
        except (TypeError, ValueError):
            ms = 100
        if ms < 1:
            ms = 1
        if ms > _CT_MS_MAX:
            ms = _CT_MS_MAX
        self._write("CT %d" % ms)

    def _shutter_busy(self):
        cam = self._camera()
        if cam is not None and cam.is_active():
            return True
        a = self.active
        if not a:
            return False
        until = a.get("pulse_until_ms")
        if not until:
            return False
        return time.ticks_diff(until, time.ticks_ms()) > 0

    def _cur_pos(self):
        p = self.panel
        if p is None:
            return None, None
        act = getattr(p, "_act", None) or {}
        return act.get("pos"), act.get("pos2")

    def cancel(self, reason="stop"):
        a = self.active
        if not a:
            return False
        dbg(3, "task cancel", a.get("name"), reason)
        self._camera_off()
        self.active = None
        self._idle = False
        self._write("MS")
        return True

    def _finish(self):
        self._camera_off()
        self.active = None
        self._idle = False

    def start(self, line):
        """Parse and latch a task line. Replaces any running task. Returns True/False."""
        line = str(line or "").strip()
        if not line:
            return False
        parts = line.split()
        name = parts[0].upper()
        need = _SPECS.get(name)
        if need is None:
            dbg(2, "task unknown", name)
            return False
        args = parts[1:]
        if len(args) < need:
            dbg(2, "task arity", name, len(args), "need", need)
            return False
        args = args[:need]
        if self.active:
            self.cancel("replace")
        self._gen = (self._gen + 1) & 0xFFFF
        if name == "TSK_PPM":
            return self._start_ppm(args)
        if name == "TSK_TL_CONT":
            return self._start_tl_cont(args)
        if name == "TSK_TL_MSM":
            return self._start_tl_msm(args)
        if name == "TSK_TL_STEP":
            return self._start_tl_step(args)
        if name == "TSK_TL_PATH_CONT":
            return self._start_tl_path_cont(args)
        if name == "TSK_TL_PATH_MSM":
            return self._start_tl_path_msm(args)
        dbg(2, "task unhandled", name)
        return False

    def _drop_axis2(self, p2):
        if self._axis_count() < 2:
            return None
        return p2

    def _near_mm(self, a, b, tol=_TL_NEAR_MM):
        if a is None or b is None:
            return False
        try:
            return abs(float(a) - float(b)) <= float(tol)
        except (TypeError, ValueError):
            return False

    def _start_ppm(self, args):
        p1 = _parse_slot(args[0])
        p1b = _parse_slot(args[1])
        p2 = _parse_slot(args[2])
        p2b = _parse_slot(args[3])
        try:
            delay_s = float(args[4])
        except ValueError:
            delay_s = 0.0
        if delay_s < 0:
            delay_s = 0.0
        if p1 is None and p1b is None and p2 is None and p2b is None:
            dbg(2, "task PPM no targets")
            return False
        if self._axis_count() < 2:
            p1b = None
            p2b = None
        self.active = {
            "name": "TSK_PPM",
            "args": list(args),
            "state": "move_1",
            "detail": "",
            "loop": 0,
            "pos_1": p1,
            "pos_1_2": p1b,
            "pos_2": p2,
            "pos_2_2": p2b,
            "delay_s": delay_s,
            "wait_until_ms": 0,
            "saw_motion": False,
            "mt_t0_ms": 0,
            "last_wait_tenth": -1,
            "t0_ms": time.ticks_ms(),
            "id": self._gen,
        }
        dbg(3, "task start TSK_PPM", args)
        self._assert_session_motion()
        self._begin_move(1)
        return True

    def _start_tl_cont(self, args):
        dest1 = _parse_slot(args[0])
        dest2 = self._drop_axis2(_parse_slot(args[1]))
        try:
            speed = float(args[2])
        except (TypeError, ValueError):
            speed = 0.0
        try:
            accel = float(args[3])
        except (TypeError, ValueError):
            accel = 0.0
        trig_time = _clamp_trig_time(args[4])
        trig_len = _clamp_trig_len(args[5])
        if dest1 is None and dest2 is None:
            dbg(2, "task TL_CONT no dest")
            self._flash("TL bad args")
            return False
        if speed <= 0:
            dbg(2, "task TL_CONT speed", speed)
            self._flash("TL bad speed")
            return False
        if accel < 0:
            accel = 0.0
        cur1, cur2 = self._cur_pos()
        near = True
        if dest1 is not None:
            if cur1 is None or not self._near_mm(cur1, dest1):
                near = False
        if dest2 is not None:
            if cur2 is None or not self._near_mm(cur2, dest2):
                near = False
        if near:
            dbg(2, "task TL_CONT at dest")
            self._flash("Already there")
            return False
        now = time.ticks_ms()
        self.active = {
            "name": "TSK_TL_CONT",
            "args": list(args),
            "state": "move",
            "detail": "",
            "dest_1": dest1,
            "dest_2": dest2,
            "speed": speed,
            "accel": accel,
            "trig_time_s": trig_time,
            "trig_len_s": trig_len,
            "next_trig_ms": now,
            "last_trig_ms": 0,
            "saw_motion": False,
            "mt_t0_ms": now,
            "wait_until_ms": 0,
            "last_wait_tenth": -1,
            "t0_ms": now,
            "id": self._gen,
        }
        dbg(3, "task start TSK_TL_CONT", args)
        self._write("SS %s" % _fmt_speed(speed))
        self._write("SA %s" % _fmt_speed(accel))
        line = _mt_line(dest1, dest2)
        a = self.active
        a["detail"] = _moving_phrase(dest1, dest2)
        self._idle = False
        self._im_last_ms = 0
        if line:
            self._write(line)
        else:
            a["saw_motion"] = True
            self._idle = True
        return True

    def _start_tl_msm(self, args):
        dest1 = _parse_slot(args[0])
        dest2 = self._drop_axis2(_parse_slot(args[1]))
        try:
            frames = int(float(args[2]))
        except (TypeError, ValueError):
            frames = 0
        trig_time = _clamp_trig_time(args[3])
        trig_len = _clamp_trig_len(args[4])
        if dest1 is None and dest2 is None:
            dbg(2, "task TL_MSM no dest")
            self._flash("TL bad args")
            return False
        if frames < 1:
            dbg(2, "task TL_MSM frames", frames)
            self._flash("TL bad frames")
            return False
        start1, start2 = self._cur_pos()
        if start1 is None and dest1 is not None:
            start1 = dest1
        if start2 is None and dest2 is not None:
            start2 = dest2
        d1 = 0.0
        d2 = 0.0
        if dest1 is not None and start1 is not None:
            d1 = float(dest1) - float(start1)
        if dest2 is not None and start2 is not None:
            d2 = float(dest2) - float(start2)
        ok_travel = False
        if dest1 is not None and abs(d1) >= _TL_NEAR_MM:
            ok_travel = True
        if dest2 is not None and abs(d2) >= _TL_NEAR_MM:
            ok_travel = True
        if not ok_travel:
            dbg(2, "task TL_MSM delta small", d1, d2)
            self._flash("TL too close")
            return False
        tl_spd = float(getattr(cfg, "SW_SPEED_TL_MM_S", 5.0))
        tl_acc = float(getattr(cfg, "SW_ACCEL_TL_MM_S2", 50.0))
        now = time.ticks_ms()
        self.active = {
            "name": "TSK_TL_MSM",
            "args": list(args),
            "state": "trigger",
            "detail": "frame 0/%d" % frames,
            "dest_1": dest1,
            "dest_2": dest2,
            "start_1": start1,
            "start_2": start2,
            "delta_1": d1,
            "delta_2": d2,
            "frames": frames,
            "frame": 0,
            "trig_time_s": trig_time,
            "trig_len_s": trig_len,
            "next_trig_ms": now,
            "wait_until_ms": 0,
            "last_wait_tenth": -1,
            "saw_motion": False,
            "mt_t0_ms": now,
            "t0_ms": now,
            "id": self._gen,
        }
        dbg(3, "task start TSK_TL_MSM", args)
        self._write("SS %s" % _fmt_speed(tl_spd))
        self._write("SA %s" % _fmt_speed(tl_acc))
        self._msm_begin_trigger()
        return True

    def _start_tl_step(self, args):
        """Fixed step distance hops (not F-curve). dest + step per axis."""
        dest1 = _parse_slot(args[0])
        dest2 = self._drop_axis2(_parse_slot(args[1]))
        step1 = _parse_slot(args[2])
        step2 = self._drop_axis2(_parse_slot(args[3]))
        trig_time = _clamp_trig_time(args[4])
        trig_len = _clamp_trig_len(args[5])
        start1, start2 = self._cur_pos()
        if dest1 is None and dest2 is None:
            self._flash("TL bad dest")
            return False
        frames = 0
        d1 = 0.0
        d2 = 0.0
        if dest1 is not None and start1 is not None:
            d1 = float(dest1) - float(start1)
            s1 = abs(float(step1 or 0))
            if s1 < 0.001:
                self._flash("TL bad step")
                return False
            n1 = int(abs(d1) / s1 + 0.999)
            if n1 > frames:
                frames = n1
            # signed step toward dest
            step1 = s1 if d1 >= 0 else -s1
        else:
            step1 = None
        if dest2 is not None and start2 is not None:
            d2 = float(dest2) - float(start2)
            s2 = abs(float(step2 or 0))
            if s2 < 0.001:
                self._flash("TL bad step")
                return False
            n2 = int(abs(d2) / s2 + 0.999)
            if n2 > frames:
                frames = n2
            step2 = s2 if d2 >= 0 else -s2
        else:
            step2 = None
        if frames < 1:
            self._flash("TL too close")
            return False
        # Reuse MSM machinery with equal hops of `step` (last hop clamps via dest).
        now = time.ticks_ms()
        tl_spd = float(getattr(cfg, "SW_SPEED_TL_MM_S", 5.0))
        tl_acc = float(getattr(cfg, "SW_ACCEL_TL_MM_S2", 50.0))
        self.active = {
            "name": "TSK_TL_STEP",
            "args": list(args),
            "state": "trigger",
            "detail": "frame 0/%d" % frames,
            "dest_1": dest1,
            "dest_2": dest2,
            "start_1": start1,
            "start_2": start2,
            "delta_1": (step1 * frames) if step1 is not None else 0.0,
            "delta_2": (step2 * frames) if step2 is not None else 0.0,
            "step_1": step1,
            "step_2": step2,
            "frames": frames,
            "frame": 0,
            "trig_time_s": trig_time,
            "trig_len_s": trig_len,
            "next_trig_ms": now,
            "wait_until_ms": 0,
            "last_wait_tenth": -1,
            "saw_motion": False,
            "mt_t0_ms": now,
            "t0_ms": now,
            "id": self._gen,
        }
        dbg(3, "task start TSK_TL_STEP", args)
        self._write("SS %s" % _fmt_speed(tl_spd))
        self._write("SA %s" % _fmt_speed(tl_acc))
        self._msm_begin_trigger()
        return True

    def _start_tl_path_cont(self, args):
        try:
            factor = float(args[0])
        except (TypeError, ValueError):
            factor = 0.0
        trig_time = _clamp_trig_time(args[1])
        trig_len = _clamp_trig_len(args[2])
        if factor < 1:
            dbg(2, "task TL_PATH_CONT factor", factor)
            self._flash("TL bad factor")
            return False
        samples = self._path_samples()
        slice_us = self._path_slice_us()
        if not samples or slice_us < 1:
            dbg(2, "task TL_PATH_CONT no path", len(samples), slice_us)
            self._flash("TL no path")
            return False
        ps = int(slice_us * factor + 0.5)
        if ps < 1:
            ps = 1
        now = time.ticks_ms()
        self.active = {
            "name": "TSK_TL_PATH_CONT",
            "args": list(args),
            "state": "move",
            "detail": "Path play",
            "trig_time_s": trig_time,
            "trig_len_s": trig_len,
            "next_trig_ms": now,
            "last_trig_ms": 0,
            "saw_motion": False,
            "mt_t0_ms": now,
            "wait_until_ms": 0,
            "last_wait_tenth": -1,
            "t0_ms": now,
            "id": self._gen,
        }
        dbg(3, "task start TSK_TL_PATH_CONT", args, "ps", ps, "n", len(samples))
        self._write("PS %d" % ps)
        self._write("SE 1")
        self._write("PG")
        return True

    def _start_tl_path_msm(self, args):
        trig_time = _clamp_trig_time(args[0])
        trig_len = _clamp_trig_len(args[1])
        samples = self._path_samples()
        frames = len(samples)
        if frames < 1:
            dbg(2, "task TL_PATH_MSM no path")
            self._flash("TL no path")
            return False
        copied = []
        i = 0
        while i < frames:
            row = samples[i]
            if isinstance(row, (list, tuple)):
                copied.append(list(row))
            else:
                copied.append([int(row)])
            i += 1
        start = self._cur_pose_list()
        tl_spd = float(getattr(cfg, "SW_SPEED_TL_MM_S", 5.0))
        tl_acc = float(getattr(cfg, "SW_ACCEL_TL_MM_S2", 50.0))
        now = time.ticks_ms()
        self.active = {
            "name": "TSK_TL_PATH_MSM",
            "args": list(args),
            "state": "trigger",
            "detail": "frame 0/%d" % frames,
            "start_pose": start,
            "samples": copied,
            "frames": frames,
            "frame": 0,
            "trig_time_s": trig_time,
            "trig_len_s": trig_len,
            "next_trig_ms": now,
            "wait_until_ms": 0,
            "last_wait_tenth": -1,
            "saw_motion": False,
            "mt_t0_ms": now,
            "t0_ms": now,
            "id": self._gen,
        }
        dbg(3, "task start TSK_TL_PATH_MSM", args, "n", frames)
        self._write("SS %s" % _fmt_speed(tl_spd))
        self._write("SA %s" % _fmt_speed(tl_acc))
        self._msm_begin_trigger()
        return True

    def _path_msm_pose(self, n):
        a = self.active
        if not a:
            return None
        start = list(a.get("start_pose") or [])
        samples = a.get("samples") or []
        hops = int(n)
        if hops < 0:
            hops = 0
        if hops > len(samples):
            hops = len(samples)
        i = 0
        while i < hops:
            row = samples[i]
            j = 0
            while j < len(start):
                d = 0
                if isinstance(row, (list, tuple)):
                    if j < len(row):
                        d = row[j]
                elif j == 0:
                    d = row
                try:
                    start[j] = float(start[j]) + float(d) / 1000.0
                except (TypeError, ValueError):
                    pass
                j += 1
            i += 1
        return start

    def _msm_target(self, n):
        a = self.active
        if not a:
            return None, None
        if a.get("name") == "TSK_TL_STEP":
            s1 = a.get("start_1")
            s2 = a.get("start_2")
            st1 = a.get("step_1")
            st2 = a.get("step_2")
            p1 = None
            p2 = None
            if a.get("dest_1") is not None and s1 is not None and st1 is not None:
                p1 = float(s1) + float(st1) * float(n)
                dest = float(a.get("dest_1"))
                if (st1 >= 0 and p1 > dest) or (st1 < 0 and p1 < dest):
                    p1 = dest
            elif a.get("dest_1") is not None:
                p1 = a.get("dest_1")
            if a.get("dest_2") is not None and s2 is not None and st2 is not None:
                p2 = float(s2) + float(st2) * float(n)
                dest = float(a.get("dest_2"))
                if (st2 >= 0 and p2 > dest) or (st2 < 0 and p2 < dest):
                    p2 = dest
            elif a.get("dest_2") is not None:
                p2 = a.get("dest_2")
            if self._axis_count() < 2:
                p2 = None
            return p1, p2
        frames = int(a.get("frames") or 1)
        if frames < 1:
            frames = 1
        frac = float(n) / float(frames)
        p1 = a.get("start_1")
        p2 = a.get("start_2")
        if a.get("dest_1") is not None and p1 is not None:
            p1 = float(p1) + float(a.get("delta_1") or 0) * frac
        elif a.get("dest_1") is not None:
            p1 = a.get("dest_1")
        if a.get("dest_2") is not None and p2 is not None:
            p2 = float(p2) + float(a.get("delta_2") or 0) * frac
        elif a.get("dest_2") is not None:
            p2 = a.get("dest_2")
        if self._axis_count() < 2:
            p2 = None
        return p1, p2

    def _msm_begin_trigger(self):
        a = self.active
        if not a:
            return
        cam = self._camera()
        if self._shutter_busy():
            return
        trig_len = float(a.get("trig_len_s") or _TRIG_LEN_MIN)
        self._shutter(trig_len)
        a["state"] = "pulse"
        a["pulse_until_ms"] = time.ticks_add(
            time.ticks_ms(), int(trig_len * 1000 + 0.5)
        )
        a["last_trig_ms"] = time.ticks_ms()
        self._update_pulse_detail()

    def _assert_session_motion(self):
        """One SS/SA from panel session so MC matches phone cache."""
        p = self.panel
        if p is None:
            return
        ss = getattr(p, "_cmd_spd", None)
        sa = getattr(p, "_cmd_acc", None)
        sd = getattr(p, "_cmd_dec", None)
        if ss is not None:
            try:
                self._write("SS %s" % _fmt_pos(abs(float(ss))))
            except (TypeError, ValueError):
                pass
        if sa is not None:
            try:
                acc = abs(float(sa))
                dec = abs(float(sd)) if sd is not None else acc
                self._write("SA %s %s" % (_fmt_pos(acc), _fmt_pos(dec)))
            except (TypeError, ValueError):
                pass

    def _begin_move(self, which):
        a = self.active
        if not a:
            return
        if which == 1:
            p1, p2 = a["pos_1"], a["pos_1_2"]
            a["state"] = "move_1"
        else:
            p1, p2 = a["pos_2"], a["pos_2_2"]
            a["state"] = "move_2"
        line = _mt_line(p1, p2)
        a["detail"] = _moving_phrase(p1, p2)
        a["saw_motion"] = False
        a["mt_t0_ms"] = time.ticks_ms()
        self._idle = False
        self._im_last_ms = 0
        if line:
            self._write(line)
        else:
            a["saw_motion"] = True
            self._idle = True

    def _begin_wait(self, which):
        a = self.active
        if not a:
            return
        delay_s = float(a.get("delay_s") or 0)
        if which == 1:
            a["state"] = "wait_1"
        else:
            a["state"] = "wait_2"
        if delay_s <= 0:
            a["wait_until_ms"] = time.ticks_ms()
            a["detail"] = "Waiting 0.0 s"
            a["last_wait_tenth"] = 0
            return
        a["wait_until_ms"] = time.ticks_add(time.ticks_ms(), int(delay_s * 1000))
        a["last_wait_tenth"] = -1
        self._update_wait_detail()

    def _update_wait_detail(self, prefix="Waiting"):
        a = self.active
        if not a:
            return
        rem_ms = time.ticks_diff(a["wait_until_ms"], time.ticks_ms())
        if rem_ms < 0:
            rem_ms = 0
        rem_s = rem_ms * 0.001
        if rem_s > 1.0:
            tenth = int((rem_ms + 50) // 100)
            if tenth == a.get("last_wait_tenth"):
                return
            a["last_wait_tenth"] = tenth
            a["detail"] = "%s %.1f s" % (prefix, tenth * 0.1)
        else:
            a["detail"] = "%s %.1f s" % (prefix, int(rem_s * 10 + 0.5) * 0.1)

    def _update_pulse_detail(self):
        a = self.active
        if not a:
            return
        trig_len = float(a.get("trig_len_s") or _TRIG_LEN_MIN)
        if trig_len <= 1.0:
            a["detail"] = "Trigger"
            return
        rem_ms = time.ticks_diff(a.get("pulse_until_ms", 0), time.ticks_ms())
        if rem_ms < 0:
            rem_ms = 0
        tenth = int((rem_ms + 50) // 100)
        if tenth == a.get("last_wait_tenth"):
            return
        a["last_wait_tenth"] = tenth
        a["detail"] = "Trigger %.1f s" % (tenth * 0.1)

    def _msm_set_frame_detail(self):
        a = self.active
        if not a:
            return
        k = int(a.get("frame") or 0)
        n = int(a.get("frames") or 0)
        a["detail"] = "frame %d/%d" % (k, n)

    def _is_idle_now(self):
        if self._idle:
            return True
        p = self.panel
        if p is None:
            return False
        if getattr(p, "sim", False) and self.active:
            if self.active.get("name") == "TSK_TL_PATH_CONT":
                mc = getattr(p, "mc", None)
                if mc is not None and getattr(mc, "_path_on", False):
                    return False
            elif time.ticks_diff(time.ticks_ms(), self.active.get("mt_t0_ms", 0)) >= 150:
                return True
        st = None
        if getattr(p, "_act", None):
            st = p._act.get("state")
        if st == "I":
            return True
        mc = getattr(p, "mc", None)
        if mc is not None:
            try:
                if not mc.isMoving() and not mc.isHoming():
                    if st in ("I", None, "?"):
                        return True
            except Exception:
                pass
            if getattr(mc, "_state", None) == "I":
                return True
        return False

    def _saw_or_assume_motion(self):
        a = self.active
        if not a or a.get("saw_motion"):
            return True
        p = self.panel
        st = None
        moving = False
        if p is not None and getattr(p, "_act", None):
            st = p._act.get("state")
        if st in ("M", "A", "B", "P"):
            moving = True
        mc = getattr(p, "mc", None) if p else None
        if mc is not None:
            try:
                if mc.isMoving():
                    moving = True
            except Exception:
                pass
        if getattr(p, "sim", False):
            moving = True
        if moving:
            a["saw_motion"] = True
            return True
        if time.ticks_diff(time.ticks_ms(), a.get("mt_t0_ms", 0)) >= _IM_FIRST_MS:
            a["saw_motion"] = True
            return True
        return False

    def _maybe_probe_im(self):
        now = time.ticks_ms()
        if self._im_last_ms and time.ticks_diff(now, self._im_last_ms) < _IM_EVERY_MS:
            return
        if not self._im_last_ms:
            if time.ticks_diff(now, self.active.get("mt_t0_ms", 0)) < _IM_FIRST_MS:
                return
        self._im_last_ms = now
        self._write("IM")

    def _try_cont_trigger(self):
        a = self.active
        if not a or a.get("state") != "move":
            return
        cam = self._camera()
        if self._shutter_busy():
            if float(a.get("trig_len_s") or 0) > 1.0:
                self._update_pulse_detail()
            return
        now = time.ticks_ms()
        if time.ticks_diff(now, a.get("next_trig_ms", 0)) < 0:
            return
        trig_len = float(a.get("trig_len_s") or _TRIG_LEN_MIN)
        trig_time = float(a.get("trig_time_s") or _TRIG_TIME_MIN)
        self._shutter(trig_len)
        a["next_trig_ms"] = time.ticks_add(now, int(trig_time * 1000))
        a["pulse_until_ms"] = time.ticks_add(now, int(trig_len * 1000 + 0.5))
        a["last_wait_tenth"] = -1
        if trig_len > 1.0:
            self._update_pulse_detail()

    def tick(self):
        a = self.active
        if not a:
            self._camera_tick()
            return
        self._camera_tick()
        name = a.get("name")
        if name == "TSK_PPM":
            self._tick_ppm()
        elif name in ("TSK_TL_CONT", "TSK_TL_PATH_CONT"):
            self._tick_tl_cont()
        elif name in ("TSK_TL_MSM", "TSK_TL_PATH_MSM", "TSK_TL_STEP"):
            self._tick_tl_msm()

    def _tick_ppm(self):
        a = self.active
        if not a:
            return
        phase = a.get("state")
        if phase in ("move_1", "move_2"):
            if not self._saw_or_assume_motion():
                return
            if self._is_idle_now():
                which = 1 if phase == "move_1" else 2
                self._begin_wait(which)
                if float(a.get("delay_s") or 0) <= 0:
                    self._tick_ppm()
                return
            self._maybe_probe_im()
            return
        if phase in ("wait_1", "wait_2"):
            self._update_wait_detail()
            if time.ticks_diff(a["wait_until_ms"], time.ticks_ms()) > 0:
                return
            if phase == "wait_1":
                self._begin_move(2)
            else:
                a["loop"] = int(a.get("loop") or 0) + 1
                self._begin_move(1)
            return

    def _tick_tl_cont(self):
        a = self.active
        if not a:
            return
        phase = a.get("state")
        if phase == "move":
            self._try_cont_trigger()
            if not self._saw_or_assume_motion():
                return
            if self._is_idle_now():
                self._finish()
                return
            self._maybe_probe_im()
            return

    def _tick_tl_msm(self):
        a = self.active
        if not a:
            return
        phase = a.get("state")
        frames = int(a.get("frames") or 1)
        if phase == "pulse":
            cam = self._camera()
            if self._shutter_busy():
                if float(a.get("trig_len_s") or 0) > 1.0:
                    self._update_pulse_detail()
                return
            k = int(a.get("frame") or 0) + 1
            a["frame"] = k
            self._msm_set_frame_detail()
            if a.get("name") == "TSK_TL_PATH_MSM":
                poses = self._path_msm_pose(k)
                line = _mt_packed(poses)
                p1 = poses[0] if poses else None
                p2 = poses[1] if poses and len(poses) > 1 else None
            else:
                p1, p2 = self._msm_target(k)
                line = _mt_line(p1, p2)
            a["state"] = "move"
            a["saw_motion"] = False
            a["mt_t0_ms"] = time.ticks_ms()
            self._idle = False
            self._im_last_ms = 0
            a["detail"] = _moving_phrase(p1, p2)
            if line:
                self._write(line)
            else:
                a["saw_motion"] = True
                self._idle = True
            return
        if phase == "trigger":
            self._msm_begin_trigger()
            return
        if phase == "move":
            if not self._saw_or_assume_motion():
                return
            if not self._is_idle_now():
                self._maybe_probe_im()
                return
            k = int(a.get("frame") or 0)
            if k >= frames:
                self._finish()
                return
            trig_time = float(a.get("trig_time_s") or _TRIG_TIME_MIN)
            a["state"] = "wait"
            a["wait_until_ms"] = time.ticks_add(
                time.ticks_ms(), int(trig_time * 1000)
            )
            a["last_wait_tenth"] = -1
            self._update_wait_detail()
            return
        if phase == "wait":
            self._update_wait_detail()
            if time.ticks_diff(a["wait_until_ms"], time.ticks_ms()) > 0:
                return
            a["state"] = "trigger"
            self._msm_begin_trigger()
            return

    def on_mc_state(self, state):
        """Cancel on hard limit / DRV error; latch idle for PPM waits."""
        if not self.active:
            return
        st = str(state or "")
        if st in ("L", "E"):
            self.cancel("error")
            return
        if st == "I":
            self._idle = True
        elif st in ("M", "A", "B", "H", "P"):
            self._idle = False
