# Raspberry Pi Zero as host

The Pi runs the **same** CPython entry as a Windows/Mac bench PC: `python -m server.host`. It is not the Pico tree. No MicroPython, no SoftAP from this process.

Use a Zero (or Zero 2 W) when you want Ethernet/Wi-Fi on the Pi and USB-serial (or UART) to one SliderMC.

---

## Install

1. Raspberry Pi OS Lite (64-bit on Zero 2 W). Enable SSH.
2. Clone this repo (or copy the tree).
3. CPython 3 + `pip install -r requirements-host.txt` (`pyserial`).
4. Plug SliderMC into USB, find the port (`/dev/ttyACM0` or `/dev/ttyUSB0`). Add the `pi` user to `dialout`.
5. Run:

```text
python3 -m server.host --port /dev/ttyACM0 --http-port 8080
```

6. From a phone on the same LAN: `http://<pi-ip>:8080/`

`systemd` user service is enough to start on boot. Do not also run Thonny on that ACM port.

---

## Network

- Give the Pi a **DHCP reservation** or a static IP. mDNS (`raspberrypi.local`) is optional; phones are uneven.
- There is no `SMoCo-xxxx` AP from this host. The Pi’s own `wlan0` / `usb0` is your portal.
- `--http-port 80` works on Linux if you bind as root or set `CAP_NET_BIND_SERVICE`. The code only **rewrites 80 → 8080** when board config said 80 at import; the CLI `--http-port` is what `main()` assigns. Prefer 8080 unless you know you need 80.

---

## UART on the header

You can use the Pi’s GPIO UART instead of USB if you disable Bluetooth overlay and wire 3.3 V TX/RX (still crossed) to SliderMC. `--port /dev/serial0 --baud 115200`. Same banner rules.

---

## What you do not get

- Camera GPIO from SliderMoCo (same as any PC host)
- `boot.py` REPL window
- On-device `/api/files` editing of a flash `www/` (the Pi serves repo `www/` from disk — edit there and reload)

`data/` on the Pi can hold `/api/projects` if you later wire the UI to it. Today the browser still uses localStorage on the **phone**.

---

## Related

- [Builder](builder-manual.md)
- [Wi-Fi](wifi-manual.md) — board AP is a different product shape
- [Production checklist](production-checklist-manual.md)
