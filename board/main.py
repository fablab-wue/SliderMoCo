# SliderWeb — Pico W / Pico 2 W WLAN UIC for SliderMC.
#
# Copy this tree onto the board with Thonny. main.py runs on boot.

try:
    import uasyncio as asyncio
except ImportError:
    import asyncio

if not hasattr(asyncio, "sleep_ms"):
    async def _sleep_ms(ms):
        await asyncio.sleep(ms / 1000.0)

    asyncio.sleep_ms = _sleep_ms

import gc

from dbg import dbg
from led_status import LedStatus
from wifi_portal import WifiPortal
import SW_config as cfg


async def main():
    dbg(3, "SliderMoCo boot")
    gc.collect()
    led = LedStatus()
    wifi = WifiPortal(led)
    await wifi.start()

    wifi_task = asyncio.create_task(wifi.run())
    led_task = asyncio.create_task(led.run())

    from panel_app import PanelApp
    from web_app import WebApp

    panel = PanelApp(None, led, sim=False)
    web = WebApp(panel, wifi)
    web_task = asyncio.create_task(web.run())
    panel_task = asyncio.create_task(panel.run())

    async def mc_start():
        """Link SliderMC at power-on (same supply as Pico) — do not wait for phone/DNS."""
        delay_ms = int(getattr(cfg, "SW_MC_POWER_DELAY_MS", 300))
        if delay_ms > 0:
            dbg(3, "UART power settle", delay_ms, "ms")
            await asyncio.sleep_ms(delay_ms)
        banner_s = float(getattr(cfg, "SW_MC_BANNER_S", 5.0))
        sim_ok = bool(getattr(cfg, "SW_MC_SIM", True))
        mocked = False
        mc = None
        try:
            from MC_client import MC_Client

            mc = MC_Client()
        except Exception as exc:
            dbg(1, "MC start fail", exc)
            mc = None
        while True:
            linked = False
            if mc is not None:
                try:
                    linked = bool(await mc.start(banner_timeout_s=banner_s))
                except Exception as exc:
                    dbg(1, "MC identify fail", exc)
                    linked = False
            if linked:
                panel.sim = False
                panel.bind_mc(mc)
                try:
                    await panel._fetch_session_live()
                except Exception as exc:
                    dbg(3, "hello GE fail", exc)
                dbg(3, "MC axes", mc.axis_count, "max_speed", mc.max_speed)
                while mc.linked and not getattr(mc, "_reboot_banner", False):
                    await asyncio.sleep_ms(250)
                dbg(2, "MC lost")
                panel.linked = False
                continue
            reason = getattr(mc, "link_reason", "") if mc is not None else "no uart"
            dbg(2, "UNLINKED", reason)
            if (not mocked) and sim_ok:
                mocked = True
                try:
                    from mock_mc import MockMC

                    mock = MockMC()
                    await mock.start()
                    panel.sim = True
                    panel.bind_mc(mock)
                    panel.linked = True
                    dbg(3, "MC mock on (kinematics, no UART)")
                except ImportError:
                    panel.sim = True
                    dbg(3, "MC sim on (dummy verbose, all zeros)")
            await asyncio.sleep_ms(1000)

    await asyncio.gather(
        wifi_task,
        led_task,
        panel_task,
        web_task,
        mc_start(),
    )


def run():
    asyncio.run(main())


if __name__ == "__main__":
    import sys

    if not getattr(sys, "sliderweb_hold_repl", False):
        run()
