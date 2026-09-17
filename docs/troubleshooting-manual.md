# Troubleshooting

Work top-down: browser → host process → UART → SliderMC. Most “dead GUI” bugs are one of those four.

---

## Browser

| Symptom | Check |
| --- | --- |
| **Link lost…** stays up | Host not running; wrong IP/port; phone left the AP; mixed HTTP/HTTPS |
| Empty `axes[]` / no rows | Banner failed and sim off; or hello not arrived. See [Mock vs real](mock-vs-real-manual.md) |
| Old buttons / missing Keyboard | Stale `www/` on the Pico. `python tools/pack_board.py` and copy again |
| Sliders move, rail does not | ENABLE off; `SE 0`; mock; physical/soft end; driver **E** |
| Keys do nothing | Phone width; Keyboard off; focus in a number field — [Keyboard](keyboard-control-manual.md) |
| Play grey / blocked | Yellow/red/blue limit bands — [Timeline](timeline-panel-manual.md) |
| Two phones fight | [Two browsers](two-browsers-manual.md) |

Reconnect is automatic (~800 ms). Hello refresh re-reads `CG` / `GL` / `GR` / session.

---

## PC host / COM port

| Symptom | Check |
| --- | --- |
| `pyserial missing` | `pip install -r requirements-host.txt` |
| Banner timeout → mock | Wrong `COMx`; another app owns the port (Thonny, a terminal); MC off; baud ≠ 115200 |
| Garbled banner | 5 V USB-TTL into 3.3 V RX; bad baud |
| Port 80 surprise | Host **forces 8080** if config says 80 |
| `data/` empty | UI does not PUT `/api/projects` yet |

Windows: Device Manager → Ports. Close the serial monitor before `--port`.

---

## UART (board or USB-serial)

Host **TX → MC RX**, host **RX ← MC TX**, common GND.

| Symptom | Check |
| --- | --- |
| No banner | Wires not crossed; GND floating; 300 ms power settle too short (`SW_MC_POWER_DELAY_MS`); MC firmware not printing `# MC V1 - …` |
| ESP32 silent | You used UART0 (USB console). Use UART2 pins from the ESP32 `SliderPins` example |
| Works in a terminal, not in SliderMoCo | Terminal still open; or host already fell back to mock — **restart** after fixing wires |

Pico USB CDC: `SW_MC_USB_ECHO` prints `MC> …` for forwarded lines. `DEBUG_LEVEL` 3 is chatty. `boot.py` 2 s window: Stop/Ctrl-C to keep the REPL for upload.

---

## Wi-Fi

See [Wi-Fi](wifi-manual.md). No page on `192.168.4.1` → not on the AP, wrong password (`sliderweb`), or `main.py` never started (held in REPL).

---

## Motion / limits

| Symptom | Check |
| --- | --- |
| MOVE grey | On soft or physical end — [Soft window](soft-window-manual.md) |
| Wrong direction | Phone SWAP DIR |
| Stops after 2.5 s | [Watchdog](watchdog-manual.md) — tab backgrounded, no task |
| Timelapse no shutter | PC host has no GPIO; wrong `PIN_CAMERA_CTRL` |
| Path too long | Lower duration or Path Hz; buffer default 32000 samples |

---

## Related

- [Builder](builder-manual.md)
- [First power-on](first-power-on-manual.md)
- [Production checklist](production-checklist-manual.md)
