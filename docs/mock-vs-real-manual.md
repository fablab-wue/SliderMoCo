# Mock vs real MC

SliderMoCo can move **numbers** without SliderMC. That is MockMC (or a dummy that stays at zero).

---

## When you get mock

| Host | Condition |
| --- | --- |
| PC / Pi | No `--port`: COM dialog (mock only if you pick Mock or Cancel). With `--port`, identity fail stays **unlinked** unless `--mock-on-fail`. |
| Pico / ESP32 | UART banner missing for `SW_MC_BANNER_S` (5 s) **and** `SW_MC_SIM` is true |

Log lines: `mock MC axes …`, `UNLINKED …`, `serial identity fail — mock`, `MC mock on (kinematics, no UART)`.

If `SW_MC_SIM` is false on the board and the banner fails, you stay unlinked (`linked: false`, `sim: false`). The GUI may look empty. That is safer on a field box than fake motion.

---

## How to tell

The GUI does **not** draw a Sim badge. Check:

1. USB / console log at start.
2. WebSocket `hello.sim` (browser devtools on `/ws`, or `/api/hello`).
3. MOVE on ENABLE: rail vs Info only.
4. Unlinked + not sim: OLED / rows may stay blank; `linked === false && !sim` is a hard miss.

Mock still reports `axes[]`, SPEED, and Timeline Play (in-process kinematics). Soft limits and Home are simulated, not a real reference.

`--axes N` (1–6, default 3) is packed channels: up to 3 STEP/DIR motors, then servos. Status is the pipe verbose line (`#M pos spd acc dest | …`).

---

## Why wiring “does nothing”

Mock ignores UART. Fixing TX/RX while the process is already in mock does nothing until you pick a real port in the topbar COM dialog (or restart with `--port`).

PC: if pyserial opened the port but the banner never came, you stay **unlinked** (unless `--mock-on-fail`). Use the COM dialog to try another device.

---

## When mock is appropriate

- UI and Timeline work with no cart.
- CI: `python tests/test_timeline.py` and `python tests/test_mock_mc.py` do not need UART.

Not appropriate: focusing, end-stop tests, camera pulse, production sign-off. See [Production checklist](production-checklist-manual.md).

---

## Related

- [Builder](builder-manual.md)
- [Troubleshooting](troubleshooting-manual.md)
- [First power-on](first-power-on-manual.md)
