# panel_app — thin WLAN↔UART bridge: {"mc":"SS 40"} + {"wdt":"alive"}.
# Panel business logic lives in www/js; Pico relays and WDT-stops.

try:
    import uasyncio as asyncio
except ImportError:
    import asyncio

if not hasattr(asyncio, "sleep_ms"):
    async def _sleep_ms(ms):
        await asyncio.sleep(ms / 1000.0)

    asyncio.sleep_ms = _sleep_ms

import time

import SW_config as cfg
from button_state import allow_move_out_of_soft_limit
from camera_ctrl import CameraCtrl
from bloop_ctrl import BloopCtrl
from dbg import dbg
from task_runner import TaskRunner
from virt_buttons import VirtualButton

_WARN = (
    "Hard limit",
    "Soft limit",
    "Halt",
    "Homing abort",
    "DRV error",
    "Set SPEED",
)


class PanelApp:
    def __init__(self, mc, led, sim=False):
        self.mc = mc
        self.led = led
        self.sim = bool(sim)
        self._sim_n = 0
        if led is not None:
            led.panel = self
        tap = int(getattr(cfg, "SW_MOVE_TAP_MS", 333))
        long_ms = int(getattr(cfg, "SW_LONG_PRESS_MS", 1000))
        halt_ms = int(getattr(cfg, "SW_STOP_HALT_MS", 1000))
        dis_ms = int(getattr(cfg, "SW_STOP_DISABLE_MS", 2000))
        self.tap_ms = tap
        self.halt_ms = halt_ms
        self.disable_ms = dis_ms
        self.move_l = VirtualButton(long_ms=tap)
        self.move_r = VirtualButton(long_ms=tap)
        self.fast_l = VirtualButton(long_ms=tap)
        self.fast_r = VirtualButton(long_ms=tap)
        self.stop_btn = VirtualButton(long_ms=halt_ms, extra_long_ms=dis_ms)
        self.axis_mask = 1
        self.cruise_dir = 0  # -1 / +1 / 0
        self.cruise_locked = False
        self.hold_to_run = False
        self.fast_dir = 0
        self.mode = "idle"  # idle|cruise|fast|homing
        self.line1 = "Ready"
        self.line2 = ""
        self._flash = None
        self._flash_until = 0
        self.last_client_ms = time.ticks_ms()
        self._wdt_armed = False
        self._wdt_tripped = False
        self._cmd_spd = float(getattr(cfg, "SW_SPEED_MIN_MM_S", 1.0))
        self._cmd_acc = None
        self._session_enabled = False
        self.linked = False
        self.tasks = TaskRunner(self)
        self.camera = CameraCtrl()
        self.bloop = BloopCtrl()
        self.path_samples = []
        self.path_slice_us = 0
        self._act = {"state": "?"}
        i = 1
        while i <= 6:
            suf = "" if i == 1 else str(i)
            self._act["pos" + suf] = None
            self._act["spd" + suf] = None
            self._act["acc" + suf] = None
            self._act["tgt" + suf] = None
            i += 1
        self.bind_mc(mc)

    def bind_mc(self, mc):
        self.mc = mc
        if mc is None:
            self.linked = False
            return
        self.linked = bool(getattr(mc, "linked", True))
        mc.set_axis_status_callback(self._on_axis_status)
        mc.set_error_callback(self._on_error)
        if getattr(mc, "_speed_mm_s", None) is not None:
            self._cmd_spd = float(mc._speed_mm_s)
        if getattr(mc, "_accel_mm_s2", None) is not None:
            self._cmd_acc = float(mc._accel_mm_s2)

    def _on_error(self, code, text):
        dbg(1, "MC !E", code, text)
        self.flash("DRV error")
        self.tasks.on_mc_state("E")

    def _on_axis_status(self, axis, state, pos, speed, accel, dest):
        self._act["state"] = state
        try:
            ax = int(axis)
        except (TypeError, ValueError):
            ax = 1
        if ax < 1:
            ax = 1
        if ax > 6:
            ax = 6
        suf = "" if ax == 1 else str(ax)
        self._act["pos" + suf] = pos
        self._act["spd" + suf] = speed
        self._act["acc" + suf] = accel
        self._act["tgt" + suf] = dest
        if ax != 1:
            return
        self.tasks.on_mc_state(state)
        if state == "H":
            self.mode = "homing"
        elif state == "L":
            self.flash("Hard limit")
            self._idle_motion()
        elif state == "D":
            if self.mode != "idle":
                self._idle_motion()
            self._session_enabled = False
        elif state in ("I", "M", "H", "A", "B", "P"):
            self._session_enabled = True
            if self.mode == "homing" and state == "I":
                self.mode = "idle"

    def flash(self, msg):
        self._flash = str(msg)
        self._flash_until = time.ticks_add(
            time.ticks_ms(), int(getattr(cfg, "SW_FLASH_MS", 1500))
        )

    def is_drv_error(self):
        mc = self.mc
        return bool(mc is not None and mc.isDRVErrorActive())

    def is_hard_limit(self):
        mc = self.mc
        return bool(mc is not None and mc.isAtHardLimit())

    def is_homing(self):
        mc = self.mc
        return bool(mc is not None and mc.isHoming())

    def is_moving_cruise(self):
        mc = self.mc
        if mc is None:
            return False
        return bool(mc.isMoving() and not mc.isHoming())

    def is_accel_decel(self):
        mc = self.mc
        if mc is None:
            return False
        return bool(mc.isDecelerating() or getattr(mc, "_accelerating", False))

    def is_enabled(self):
        mc = self.mc
        if mc is None:
            return bool(self._session_enabled) if self.sim else False
        en = getattr(mc, "_enabled", None)
        if en is None:
            return bool(self._session_enabled)
        return bool(en)

    def is_at_soft_limit(self):
        mc = self.mc
        return bool(mc is not None and mc.isAtSoftLimit())

    def is_near_soft_limit(self):
        mc = self.mc
        return bool(mc is not None and mc.isNearSoftLimit())

    def _signed_speed(self, positive, speed):
        left_neg = bool(getattr(cfg, "SW_LEFT_IS_NEGATIVE", True))
        mag = abs(float(speed))
        if positive:
            return mag if not left_neg else mag
        return -mag

    def _dir_speed(self, direction):
        """direction -1 left / +1 right → signed mm/s for mc.move()."""
        spd = self._cmd_spd
        left_neg = bool(getattr(cfg, "SW_LEFT_IS_NEGATIVE", True))
        if direction < 0:
            return -spd if left_neg else spd
        return spd if left_neg else -spd

    def _enable(self):
        mc = self.mc
        if mc is None:
            return
        if mc.isDRVErrorActive():
            return
        mc.enable(True)

    def _idle_motion(self):
        self.cruise_dir = 0
        self.cruise_locked = False
        self.hold_to_run = False
        self.fast_dir = 0
        if self.mode != "homing":
            self.mode = "idle"

    def _can_move(self, direction):
        mc = self.mc
        if mc is None:
            return True
        if mc.isDRVErrorActive():
            return False
        if not mc.isAtSoftLimit():
            return True
        return allow_move_out_of_soft_limit(
            mc.getPosition(),
            direction if getattr(cfg, "SW_LEFT_IS_NEGATIVE", True) else -direction,
            mc.slider_min,
            mc.slider_max,
        )

    def _jog(self, direction, speed=None, fast=False):
        if self.sim:
            return
        mc = self.mc
        if mc is None:
            self.flash("No MC")
            return
        if not self._can_move(direction):
            self.flash("Soft limit")
            return
        self._enable()
        if speed is None:
            speed = self._max_spd() if fast else self._cmd_spd
        signed = self._dir_speed(direction)
        # _dir_speed already signed; pass magnitude via move()
        mag = abs(float(speed))
        signed = mag if signed > 0 else -mag
        mc.move(signed, self.axis_mask)
        if fast:
            self.mode = "fast"
            self.fast_dir = direction
            self.cruise_dir = 0
            self.cruise_locked = False
        else:
            self.mode = "cruise"
            self.cruise_dir = direction
            self.fast_dir = 0

    def _stop(self):
        if self.sim:
            self._idle_motion()
            return
        mc = self.mc
        if mc is not None:
            mc.stop()
        self._idle_motion()

    def _halt(self):
        if self.sim:
            self._idle_motion()
            self.flash("Halt")
            return
        mc = self.mc
        if mc is not None:
            mc.halt()
        self._idle_motion()
        self.flash("Halt")

    def _disable(self):
        if self.sim:
            self._idle_motion()
            self.flash("Disabled")
            return
        mc = self.mc
        if mc is not None:
            mc.enable(False)
        self._idle_motion()
        self.flash("Disabled")

    def _max_spd(self):
        mc = self.mc
        cap = float(getattr(cfg, "SW_SPEED_MAX_MM_S", 100.0))
        if mc is not None and mc.max_speed is not None:
            try:
                cap = min(cap, float(mc.max_speed))
            except (TypeError, ValueError):
                pass
        return cap

    def _min_spd(self):
        return float(getattr(cfg, "SW_SPEED_MIN_MM_S", 1.0))

    def set_speed(self, mm_s):
        lo = self._min_spd()
        hi = self._max_spd()
        try:
            v = float(mm_s)
        except (TypeError, ValueError):
            return
        if v < lo:
            v = lo
        if v > hi:
            v = hi
        hyst = float(getattr(cfg, "SW_SS_HYST_MM_S", 0.05))
        if abs(v - self._cmd_spd) < hyst:
            return
        self._cmd_spd = v
        if self.sim:
            return
        mc = self.mc
        if mc is None:
            return
        mc.setSpeed(v)
        if self.cruise_dir != 0 and self.mode == "cruise":
            self._jog(self.cruise_dir, v, fast=False)

    def set_axis_mask(self, mask):
        try:
            m = int(mask)
        except (TypeError, ValueError):
            m = 1
        if m not in (0, 1, 2):
            m = 1
        self.axis_mask = m

    def _echo_mc(self, line):
        if not bool(getattr(cfg, "SW_MC_USB_ECHO", True)):
            return
        dbg(2, "MC>", line)

    def _mc_line_ok(self, line):
        """Allow printable ASCII command lines only (no CR/LF inside)."""
        if not line or len(line) > int(getattr(cfg, "SW_MC_LINE_MAX", 80)):
            return False
        for ch in line:
            o = ord(ch)
            if o < 32 or o > 126:
                return False
        return True

    def _mirror_session_line(self, line):
        """Update Pico session cache from SS / SA / SE without blocking UART."""
        parts = str(line).split()
        if not parts:
            return
        cmd = parts[0].upper()
        if cmd == "SS" and len(parts) > 1:
            try:
                self._cmd_spd = abs(float(parts[1]))
            except ValueError:
                pass
        elif cmd == "SA" and len(parts) > 1:
            try:
                self._cmd_acc = abs(float(parts[1]))
            except ValueError:
                pass
        elif cmd == "SE" and len(parts) > 1:
            try:
                self._session_enabled = int(float(parts[1])) != 0
            except ValueError:
                pass

    def write_mc(self, line):
        """UART write for task-owned lines (MT/MS/IM). No task-cancel, no session mirror."""
        line = str(line or "").strip()
        if not self._mc_line_ok(line):
            dbg(2, "mc reject", repr(line)[:40])
            return False
        self._echo_mc(line)
        mc = self.mc
        if mc is not None:
            try:
                mc._write_line(line)
                return True
            except Exception as exc:
                dbg(1, "mc write fail", exc)
                return False
        return bool(self.sim)

    def send_mc_line(self, line, mirror=True):
        """Relay one SliderMC command line (JS → UART). Returns True if sent.

        ``mirror=False`` still writes UART (e.g. temporary SS/SA for FAST) but
        does not update the panel session cache.
        """
        line = str(line or "").strip()
        if not self._mc_line_ok(line):
            dbg(2, "mc reject", repr(line)[:40])
            return False
        parts = line.split()
        cmd = parts[0].upper() if parts else ""
        # STOP / MOVE / FAST / HOME — all start with M — cancel Pico task first.
        if cmd.startswith("M") and self.tasks.active:
            self.tasks.cancel("move")
        if mirror:
            self._mirror_session_line(line)
        self._echo_mc(line)
        mc = self.mc
        if mc is not None:
            try:
                mc._write_line(line)
                return True
            except Exception as exc:
                dbg(1, "mc write fail", exc)
                return False
        return bool(self.sim)

    def _path_msg(self, obj):
        """Stream Motion Path: begin / data / go → PC, PS, PD, PG."""
        if not isinstance(obj, dict):
            return
        cmd = str(obj.get("cmd") or "").strip().lower()
        if cmd == "begin":
            self.path_samples = []
            self.path_slice_us = 0
            self.send_mc_line("PC")
            us = obj.get("slice_us")
            if us is not None:
                try:
                    self.path_slice_us = int(us)
                    self.send_mc_line("PS %d" % self.path_slice_us)
                except (TypeError, ValueError):
                    self.path_slice_us = 0
            return
        if cmd == "data":
            samples = obj.get("samples") or []
            store = self.path_samples
            for row in samples:
                if isinstance(row, (list, tuple)):
                    toks = []
                    stored = []
                    i = 0
                    while i < len(row) and i < 6:
                        try:
                            v = int(row[i])
                        except (TypeError, ValueError):
                            v = 0
                        toks.append(str(v))
                        stored.append(v)
                        i += 1
                    if not toks:
                        toks.append("0")
                        stored.append(0)
                    store.append(stored)
                    self.send_mc_line("PD " + " ".join(toks))
                else:
                    try:
                        v = int(row)
                    except (TypeError, ValueError):
                        continue
                    store.append([v])
                    self.send_mc_line("PD %d" % v)
            return
        if cmd == "go":
            self.send_mc_line("SE 1")
            self.send_mc_line("PG")

    def on_ws_msg(self, obj):
        """Bridge: ``{"wdt"}``, ``{"mc"}``, ``{"task"}``, ``{"path"}``, ``{"bloop"}``."""
        if not isinstance(obj, dict):
            return
        if "wdt" in obj:
            self.last_client_ms = time.ticks_ms()
            self._wdt_armed = True
            self._wdt_tripped = False
        if "ax" in obj:
            self.set_axis_mask(obj.get("ax"))
        if "path" in obj:
            self._path_msg(obj.get("path"))
        if "bloop" in obj:
            if obj.get("bloop"):
                try:
                    self.bloop.start_pulse_ms()
                except Exception:
                    pass
        if "task" in obj:
            line = obj.get("task")
            if isinstance(line, dict):
                line = line.get("cmd") or line.get("line") or ""
            self.tasks.start(line)
            return
        if "mc" in obj:
            self.send_mc_line(obj.get("mc"), mirror=not bool(obj.get("silent")))

    def watchdog_tick(self):
        """If WDT packets stop, send MS — unless a Pico task is running."""
        if not getattr(self, "_wdt_armed", False):
            return
        if getattr(self, "_wdt_tripped", False):
            return
        if self.tasks.active:
            return
        wd = int(getattr(cfg, "SW_WDT_TIMEOUT_MS", 2500))
        if wd < 500:
            wd = 500
        if time.ticks_diff(time.ticks_ms(), self.last_client_ms) < wd:
            return
        dbg(2, "wdt timeout — MS")
        self._wdt_tripped = True
        self.send_mc_line("MS")
        self._idle_motion()

    def _dispatch_btn(self, name, ev, ms):
        """Legacy panel buttons — unused after thin-bridge cut-over."""
        return

    def soft_dict(self):
        mc = self.mc
        out = {
            "min": None,
            "max": None,
            "min2": None,
            "max2": None,
            "min3": None,
            "max3": None,
            "min4": None,
            "max4": None,
            "min5": None,
            "max5": None,
            "min6": None,
            "max6": None,
        }
        if mc is None:
            if self.sim:
                out["min"] = 0.0
                out["max"] = 600.0
                out["min3"] = -90.0
                out["max3"] = 90.0
            return out
        out["min"] = self._n(getattr(mc, "soft_min", None))
        out["max"] = self._n(getattr(mc, "soft_max", None))
        i = 2
        while i <= 6:
            out["min%d" % i] = self._n(getattr(mc, "soft_min_%d" % i, None))
            out["max%d" % i] = self._n(getattr(mc, "soft_max_%d" % i, None))
            i += 1
        return out

    def session_dict(self):
        return {
            "enabled": self.is_enabled(),
            "ss": self._n(self._cmd_spd),
            "sa": self._n(self._cmd_acc),
        }

    def _link_fields(self):
        mc = self.mc
        name = ""
        reason = ""
        proto = None
        if mc is not None:
            name = str(getattr(mc, "banner_name", "") or "")
            reason = str(getattr(mc, "link_reason", "") or "")
            if bool(self.linked) or bool(self.sim):
                proto = str(getattr(mc, "EXPECTED_PROTO", "1"))
        return {
            "mc_name": name,
            "proto": proto,
            "link_reason": reason,
        }

    async def _fetch_session_live(self):
        """Query GE/GS/GA for live MC session (after CG/GL/GR)."""
        mc = self.mc
        if mc is None or self.sim:
            return
        if not getattr(mc, "linked", False):
            return
        try:
            ge = await mc.query("GE", timeout_s=0.5)
            if ge is not None:
                self._session_enabled = int(float(str(ge).strip())) != 0
                mc._enabled = self._session_enabled
        except Exception as exc:
            dbg(3, "hello GE fail", exc)
        try:
            gs = await mc.query("GS", timeout_s=0.5)
            if gs is not None:
                self._cmd_spd = abs(float(str(gs).strip()))
                mc._speed_mm_s = self._cmd_spd
        except Exception as exc:
            dbg(3, "hello GS fail", exc)
        try:
            ga = await mc.query("GA", timeout_s=0.5)
            if ga is not None:
                self._cmd_acc = abs(float(str(ga).strip()))
                mc._accel_mm_s2 = self._cmd_acc
        except Exception as exc:
            dbg(3, "hello GA fail", exc)

    async def refresh_hello(self):
        """Re-read CG + GL/GR + GE/GS/GA before hello (phone reconnect)."""
        mc = self.mc
        if mc is None or self.sim:
            return
        if not getattr(mc, "linked", False):
            return
        try:
            await mc.fetchConfig()
        except Exception as exc:
            dbg(2, "hello CG fail", exc)
        try:
            await mc.fetchSoftLimits()
        except Exception as exc:
            dbg(2, "hello GL/GR fail", exc)
        await self._fetch_session_live()

    def hello_dict(self):
        cfgd = self.config_dict()
        out = {
            "t": "hello",
            "linked": bool(self.linked) or bool(self.sim),
            "sim": bool(self.sim),
            "config": cfgd,
            "axes": self._axes_list(live=True),
            "soft": self.soft_dict(),
            "session": self.session_dict(),
            "task": self.tasks.status_dict(),
        }
        out.update(self._link_fields())
        return out

    def _refresh_lines(self):
        now = time.ticks_ms()
        if self._flash is not None and time.ticks_diff(self._flash_until, now) > 0:
            self.line1 = self._flash
        elif self.tasks.active:
            detail = self.tasks.active.get("detail") or ""
            if detail:
                self.line1 = detail
            else:
                short = str(self.tasks.active.get("name") or "TASK").replace("TSK_", "")
                self.line1 = "Task " + short
        elif self.sim:
            self.line1 = "Sim"
        elif self.is_drv_error():
            self.line1 = "DRV error"
        elif not (bool(self.linked) or bool(self.sim)):
            reason = ""
            if self.mc is not None:
                reason = str(getattr(self.mc, "link_reason", "") or "")
            if reason.startswith("protocol") or reason == "not an MC":
                self.line1 = "not an MC"
            else:
                self.line1 = "No MC"
        elif not self.is_enabled() and self._act.get("state") in ("D", None, "?"):
            if self._act.get("state") == "D":
                self.line1 = "Disabled"
            else:
                self.line1 = "Ready"
        elif self.is_homing():
            self.line1 = "Homing..."
        elif self.mode == "fast":
            self.line1 = "Fast L" if self.fast_dir < 0 else "Fast R"
        elif self.mode == "cruise":
            side = "L" if self.cruise_dir < 0 else "R"
            self.line1 = "Cruising " + side
        elif self._act.get("state") == "M":
            self.line1 = "Moving..."
        elif self._act.get("state") == "A":
            self.line1 = "Moving..."
        elif self._act.get("state") == "B":
            self.line1 = "Moving..."
        else:
            self.line1 = "Ready"

        extras = []
        if self.tasks.active:
            loop = self.tasks.active.get("loop")
            if loop is not None:
                extras.append("loop %d" % int(loop))
            elif self.tasks.active.get("frame") is not None and self.tasks.active.get(
                "frames"
            ) is not None:
                extras.append(
                    "frame %d/%d"
                    % (
                        int(self.tasks.active.get("frame") or 0),
                        int(self.tasks.active.get("frames") or 0),
                    )
                )
        if self.is_hard_limit():
            extras.append("Hard limit")
        elif self.is_at_soft_limit():
            extras.append("Soft limit")
        elif self.is_near_soft_limit():
            extras.append("Near limit")
        self.line2 = extras[0] if extras else ""

    def _n(self, v, nd=6):
        if v is None:
            return None
        t = str(v).strip().lower()
        if t == "" or t == "none" or t == "-":
            return None
        try:
            return round(float(v), nd)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _derive_axis_state(global_st, spd, acc, tgt):
        """Per-axis motion letter from MC global state + axis telemetry."""
        st = str(global_st or "?")
        if st in ("E", "L", "D", "H"):
            return st
        if st == "?":
            return "?"
        try:
            v = abs(float(spd)) if spd is not None else 0.0
        except (TypeError, ValueError):
            v = 0.0
        if v > 0.05:
            if st in ("A", "B"):
                return st
            return "M"
        if tgt is not None:
            try:
                float(tgt)
                return "M"
            except (TypeError, ValueError):
                pass
        return "I"

    def _axis_count(self):
        mc = self.mc
        if mc is not None:
            try:
                if hasattr(mc, "getAxisCount"):
                    n = int(mc.getAxisCount() or 1)
                else:
                    n = int(getattr(mc, "axis_count", 1) or 1)
            except (TypeError, ValueError):
                n = 1
            if n < 1:
                n = 1
            if n > 6:
                n = 6
            return n
        if self.sim:
            return 3
        return 1

    def _axes_list(self, live=True):
        """Build ``axes[]`` for hello/status (1–6 packed channels)."""
        n = self._axis_count()
        mc = self.mc
        cmap = {}
        if mc is not None and getattr(mc, "mc_config", None):
            cmap = mc.mc_config
        soft = self.soft_dict()
        st = self._act.get("state") or "?"
        if len(str(st)) != 1:
            st = "?"
        names = ("slide", "pan", "tilt", "roll", "focus", "zoom")
        units_def = ("mm", "deg", "deg", "deg", "mm", "mm")
        axes = []
        i = 1
        while i <= n:
            if i == 1:
                live_pos = self._act.get("pos")
                live_spd = self._act.get("spd")
                live_acc = self._act.get("acc")
                live_tgt = self._act.get("tgt")
            else:
                live_pos = self._act.get("pos%d" % i)
                live_spd = self._act.get("spd%d" % i)
                live_acc = self._act.get("acc%d" % i)
                live_tgt = self._act.get("tgt%d" % i)
            if i == 1:
                unit = (mc.unit_name if mc and mc.unit_name else None) or cmap.get(
                    "unit_name"
                ) or units_def[0]
                amin = self._n(getattr(mc, "slider_min", None) if mc else 0.0)
                amax = self._n(getattr(mc, "slider_max", None) if mc else 600.0)
                smin = soft.get("min")
                smax = soft.get("max")
                max_spd = self._n(
                    getattr(mc, "max_speed", None) if mc else cmap.get("max_speed")
                )
                max_acc = self._n(
                    getattr(mc, "max_accel", None) if mc else cmap.get("max_accel")
                )
                name = cmap.get("name_1") or names[0]
            else:
                uk = "unit_name_%d" % i
                unit = (cmap.get(uk) if cmap else None) or units_def[min(i - 1, 5)]
                amin = self._n(
                    getattr(mc, "slider_min_%d" % i, None) if mc else None
                )
                amax = self._n(
                    getattr(mc, "slider_max_%d" % i, None) if mc else None
                )
                smin = soft.get("min%d" % i)
                smax = soft.get("max%d" % i)
                max_spd = self._n(cmap.get("max_speed_%d" % i) if cmap else None)
                max_acc = self._n(cmap.get("max_accel_%d" % i) if cmap else None)
                if max_spd is None:
                    max_spd = 80.0 if i == 2 else 60.0
                if max_acc is None:
                    max_acc = 400.0 if i == 2 else 300.0
                name = (cmap.get("name_%d" % i) if cmap else None) or names[
                    min(i - 1, 5)
                ]
            if self.sim and mc is None:
                if i == 1:
                    amin, amax, unit = 0.0, 600.0, "mm"
                elif i == 2:
                    amin, amax, unit = None, None, "deg"
                else:
                    amin, amax, unit = -90.0, 90.0, "deg"
                smin = amin
                smax = amax
                max_spd = 100.0 if i == 1 else (80.0 if i == 2 else 60.0)
                max_acc = 500.0 if i == 1 else (400.0 if i == 2 else 300.0)
            ax = {
                "id": i,
                "name": name,
                "unit": unit,
                "mc_id": 1,
                "slot": i,
                "min": amin,
                "max": amax,
                "soft_min": smin,
                "soft_max": smax,
                "max_spd": max_spd,
                "max_acc": max_acc,
                "ss": self._n(self._cmd_spd),
                "sa": self._n(self._cmd_acc),
                "pos": self._n(live_pos) if live_pos is not None else 0.0,
                "spd": self._n(live_spd) if live_spd is not None else 0.0,
                "acc": self._n(live_acc) if live_acc is not None else 0.0,
                "tgt": self._n(live_tgt),
                "state": self._derive_axis_state(st, live_spd, live_acc, live_tgt)
                if live
                else (st if st in ("I", "D", "E", "L") else "I"),
            }
            axes.append(ax)
            i += 1
        return axes

    def status_dict(self):
        self._refresh_lines()
        st = self._act.get("state") or "?"
        if len(str(st)) != 1:
            st = "?"
        warn = self.line1 in _WARN or self.line2 in _WARN
        out = {
            "t": "status",
            "state": st,
            "axes": self._axes_list(live=True),
            "session": self.session_dict(),
            "task": self.tasks.status_dict(),
            "linked": bool(self.linked) or bool(self.sim),
            "line1": self.line1,
            "line2": self.line2,
            "warn": warn,
            "enabled": self.is_enabled(),
            "sim": bool(self.sim),
            "ax": self.axis_mask,
            "soft": self.soft_dict(),
        }
        out.update(self._link_fields())
        if self.sim:
            out["n"] = self._sim_n
        return out

    def config_dict(self):
        mc = self.mc
        name = "SliderMoCo"
        if mc is not None and getattr(mc, "mc_config", None):
            name = mc.mc_config.get("name") or name
        elif self.sim:
            name = "SliderMoCo mock"
        path_n = 32000
        if mc is not None and getattr(mc, "mc_config", None):
            try:
                path_n = int(mc.mc_config.get("path_buffer_size") or 32000)
            except (TypeError, ValueError):
                path_n = 32000
        out = {
            "name": name,
            "axes": self._axes_list(live=False),
            "speed_tl_mm_s": float(getattr(cfg, "SW_SPEED_TL_MM_S", 5.0)),
            "accel_tl_mm_s2": float(getattr(cfg, "SW_ACCEL_TL_MM_S2", 50.0)),
            "path_buffer_size": path_n,
            "axis_count": self._axis_count(),
            "motors": int(mc.getMotorCount())
            if mc is not None and hasattr(mc, "getMotorCount")
            else self._axis_count(),
        }
        if mc is not None and hasattr(mc, "getServoCount"):
            out["servos"] = int(mc.getServoCount() or 0)
        return out

    def _sim_push(self):
        """Dummy verbose as if `#I … | …` arrived (highest axis first)."""
        self._sim_n = (self._sim_n + 1) & 0xFFFF
        n = self._axis_count()
        i = n
        while i >= 1:
            self._on_axis_status(i, "I", 0.0, 0.0, 0.0, 0.0)
            i -= 1

    async def run(self):
        sim_hz = float(getattr(cfg, "SW_MC_SIM_HZ", 10))
        if sim_hz < 1:
            sim_hz = 1
        sim_ms = int(1000.0 / sim_hz)
        if sim_ms < 20:
            sim_ms = 20
        while True:
            self.watchdog_tick()
            self.tasks.tick()
            try:
                self.bloop.tick()
            except Exception:
                pass
            mc = self.mc
            if mc is not None:
                self.linked = bool(getattr(mc, "linked", False)) or bool(self.sim)
            if mc is not None and hasattr(mc, "tick"):
                try:
                    mc.tick()
                except Exception:
                    pass
            elif self.sim:
                self._sim_push()
            self._refresh_lines()
            await asyncio.sleep_ms(sim_ms if self.sim else 50)
