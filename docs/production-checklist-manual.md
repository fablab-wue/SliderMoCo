# Production checklist

Bench mock is fine. A paid move or a timelapse overnight is not. Work this list on the **real** host that will run the job.

---

## Board host (Pico W / ESP32)

- [ ] MicroPython UF2 for the correct chip
- [ ] `python tools/pack_board.py` and a **fresh** copy of `dist/pico/` to `/`
- [ ] `SliderPins.py` on the device (not the `.example` name) — UART, LED, camera pin
- [ ] **`SW_MC_SIM = False`**
- [ ] Banner on USB: `MC axes …` not `MC mock on`
- [ ] SoftAP password changed if the set leaves the shop (`AP_PASSWORD`)
- [ ] STA `wifi.json` or `POST /api/wifi` if you need LAN; confirm `GET /api/wifi` IP
- [ ] ENABLE off, Info pose matches the cart
- [ ] SWAP DIR correct; soft window set; short MOVE
- [ ] Stop tap / 1 s halt / 2 s disable once
- [ ] WDT: background the phone during a jog → cart stops ~2.5 s
- [ ] Timelapse: ⏲ with camera GPIO; confirm shutter; phone lock does **not** abort
- [ ] Timeline Play (desktop on LAN): preroll + Stop cancels; tab sleep **does** abort (expected)

---

## PC / Pi host

- [ ] `python -m server.host --port …` — no banner-timeout mock
- [ ] `pyserial` installed
- [ ] HTTP port reachable from the op laptop/phone
- [ ] No camera GPIO — intervalometer separate, or use a board host for ⏲
- [ ] Same ENABLE / window / MOVE / Stop / WDT checks

---

## Shot

- [ ] Project saved (download), rig saved, A/B marks ⚑ on **this** browser
- [ ] Path Hz vs duration fits the buffer
- [ ] One operator tab for Play / LOOP ([Two browsers](two-browsers-manual.md))
- [ ] PSU can hold ENABLE + camera + motors

---

## Related

- [First power-on](first-power-on-manual.md)
- [Mock vs real](mock-vs-real-manual.md)
- [Camera trigger](camera-trigger-manual.md)
- [Wi-Fi](wifi-manual.md)
