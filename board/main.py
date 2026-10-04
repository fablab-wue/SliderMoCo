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

    if not getattr(cfg, "DATA_DIR", None):
        cfg.DATA_DIR = "data"
    panel = PanelApp(None, led, sim=False)
    panel.configure_host("pico", 2)
    web = WebApp(panel, wifi)
    web_task = asyncio.create_task(web.run())
    panel_task = asyncio.create_task(panel.run())

    async def mc_start():
        """Link UART0 at power-on so the phone still has one MC. UART1 is added from the UI."""
        delay_ms = int(getattr(cfg, "SW_MC_POWER_DELAY_MS", 300))
        if delay_ms > 0:
            dbg(3, "UART power settle", delay_ms, "ms")
            await asyncio.sleep_ms(delay_ms)
        from uart_broker import UartBroker

        broker = UartBroker(panel)
        panel.serial = broker
        try:
            await broker.restore_or_uart0()
        except Exception as exc:
            dbg(1, "UART broker fail", exc)
        while True:
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
