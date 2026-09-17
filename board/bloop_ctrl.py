# bloop_ctrl — PIN_BLOOP GPIO pulse (timeline markers).
# Push-pull, active-high: idle = OUTPUT LOW; pulse = HIGH for BLOOP_PULSE_MS.

import time

import SW_config as cfg
from dbg import dbg

try:
    from machine import Pin
except ImportError:
    Pin = None


class BloopCtrl:
    """Push-pull active-high pulse on PIN_BLOOP."""

    def __init__(self, pin=None, pulse_ms=None):
        if pin is None:
            pin = getattr(cfg, "PIN_BLOOP", None)
        if pulse_ms is None:
            pulse_ms = int(getattr(cfg, "BLOOP_PULSE_MS", 100))
        self.pulse_ms = max(1, int(pulse_ms))
        self._pin = None
        self._level = 0
        self._pulse_until_ms = 0
        if pin is None or Pin is None:
            dbg(3, "bloop_ctrl disabled (no pin / no machine.Pin)")
            return
        try:
            self._pin = Pin(int(pin), Pin.OUT)
            self._pin.value(0)
            dbg(3, "bloop_ctrl GP%s PP" % int(pin))
        except Exception as exc:
            dbg(1, "bloop_ctrl init fail", exc)
            self._pin = None

    def _now_ms(self):
        if hasattr(time, "ticks_ms"):
            return time.ticks_ms()
        return int(time.monotonic() * 1000)

    def _ticks_diff(self, end, start):
        if hasattr(time, "ticks_diff"):
            return time.ticks_diff(end, start)
        return end - start

    def _ticks_add(self, base, delta):
        if hasattr(time, "ticks_add"):
            return time.ticks_add(base, delta)
        return base + delta

    def _drive(self, high):
        pin = self._pin
        if pin is None:
            return
        try:
            pin.value(1 if high else 0)
        except Exception as exc:
            dbg(1, "bloop_ctrl drive fail", exc)

    def set(self, on):
        self._level = 1 if on else 0
        self._drive(bool(on))

    def off(self):
        self._pulse_until_ms = 0
        self.set(False)

    def is_active(self):
        return bool(self._level)

    def start_pulse_ms(self, ms=None):
        if ms is None:
            ms = self.pulse_ms
        ms = max(1, int(ms))
        self._pulse_until_ms = self._ticks_add(self._now_ms(), ms)
        self.set(True)

    def tick(self):
        if not self.is_active() or not self._pulse_until_ms:
            return
        if self._ticks_diff(self._pulse_until_ms, self._now_ms()) <= 0:
            self.off()
