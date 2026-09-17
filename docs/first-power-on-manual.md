# First power-on and homing

Do this once per machine (or after you change firmware / travel). Daily use is [Safety](safety-manual.md) + the panel chapters.

---

## Order

1. **Mechanics** — rail clear, couplings tight, end stops where you think they are.
2. **Power** — SliderMC and host on the **same** PSU if they share UART ground. The board waits **300 ms** (`SW_MC_POWER_DELAY_MS`) before it looks for a banner.
3. **UART** — TX/RX crossed, GND common, 115200. Confirm a `# MC V1 - …` welcome in a serial terminal, then **close** that terminal.
4. **Host** — PC: `python -m server.host --port COMx`. Board: pack, `SliderPins.py`, join `SMoCo-xxxx` / `sliderweb`, http://192.168.4.1/
5. **Link** — console must **not** say mock unless you wanted mock. `hello.sim === false`, `linked === true`.
6. **Info** — axis count, units, pose looks like the cart (not leftover mock zeros).
7. **ENABLE off** until you are ready. Then on, short MOVE, confirm direction (phone **SWAP DIR** if needed).
8. **Soft window** — Window SET or LIMIT 3 s at the ends you actually want. Do not skip this on a long rail.
9. **Home only if you need a reference** — Config / phone **Home** → `MH`. The cart may run to a sensor or a firmware end. Stand clear.

---

## What `MH` is

SliderMC homing. Sensors, direction, and whether motion is blocked until done are **firmware**. SliderMoCo only sends the line.

Home when:

- The MC pose is wrong after a crash or power loss without absolute encoders.
- The manual for your SliderMC build says to Home after boot.

Do **not** Home as a substitute for STOP.

After Home, re-check the soft window. Some firmwares leave `SL`/`SR` alone; some do not.

---

## `CG` at link

The host sends `CG` and stores `slider_min_1` / `slider_max_1`, speeds (`max_speed_1`), `axis`, units. Hello refresh (new WebSocket) does it again. You do not type `CG` for a normal start.

If travel in Info / Timeline bands is nonsense, the MC config is wrong — fix SliderMC, then reload the page. The [rig](rig-vs-mc-manual.md) file will not override live `CG` travel on a linked box.

---

## Related

- [Builder](builder-manual.md)
- [Mock vs real](mock-vs-real-manual.md)
- [Production checklist](production-checklist-manual.md)
