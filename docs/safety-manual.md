# Safety and ENABLE

This chapter is the stop / enable contract. Jog, Play, and timelapse assume you already understand it.

SliderMoCo is a **browser remote**. It cannot see a person on the rail. You are the interlock.

---

## Before anyone stands near the cart

- ENABLE **off** until Control shows a live pose that matches the machine.
- Soft window and physical min/max known (see [Soft window](soft-window-manual.md)).
- First move is a short MOVE, not Timeline Play or LOOP.
- After Home (`MH`) the cart may travel the full rail. Clear the path.

Mock kinematics still paint moving numbers. If `hello.sim` is true (USB log: `mock MC`), the rail will not follow. Do not trust a mock session as a safety test.

---

## ENABLE (`SE`)

| Switch | Line | Meaning |
| --- | --- | --- |
| On | `SE 1` | Drives accept motion |
| Off | `SE 0` | Drives ignore jog, `MT`, paths, tasks |

Desktop: top-bar switch (on after load). Phone: Home tab.

**Off looks “dead”:** sticks, MOVE, Play, and ⏲ send lines; the MC does not move. SPEED sliders still write `SS`. That is not a broken UART.

The switch is **disabled** while status is driver error (`state` **E**) or `warn`. Fix the MC fault first; flipping ENABLE will not clear a DRV trip.

Two browsers each have a switch. **Last `SE` wins.** See [Two browsers](two-browsers-manual.md).

---

## Stop, Halt, Disable

Every red **⏹** and the top-bar **Stop** share the phone-style hold map (`sw_ui.js`). Desktop `bindButtons` also sends `MS` on press and cancels Timeline Play + A/B LOOP.

| Gesture | Line | What it does |
| --- | --- | --- |
| **Tap** | `MS` | Stop motion. Cancels a running **task** (any client `M…` line cancels `TSK_*`). Cancels Timeline Play and A/B LOOP in **this** browser |
| **Hold ~1 s** | `H` | Halt — SliderMC emergency stop (firmware-defined; stronger than `MS`) |
| **Hold ~2 s** | `SE 0` | Disable. ENABLE in the GUI will not match until you turn it on again |

Desktop **Space** and **Esc** are tap-Stop (`MS` + cancel Play/LOOP) even when Keyboard is off.

`MS` is also what the [watchdog](watchdog-manual.md) sends if the tab goes silent (~2.5 s) and no server task is running.

---

## What Stop does **not** do

- It does not restore session SPEED after A/B **▶▶** / LOOP left you at max.
- It does not clear soft limits or marks.
- It does not power-cycle SliderMC or the PSU.
- A tap in **browser A** cancels that tab’s Play/LOOP. Browser B may still think it is playing until status goes idle.

---

## Homing

**Home** (`MH`) is in [Config](config-manual.md) and on phone Home. Homing travel, sensors, and blocking are **SliderMC**, not this GUI. Treat it as an unattended full-rail move.

Do not Home with a camera cage or a person in the way. See [First power-on](first-power-on-manual.md).

---

## Related

- [Session](session-manual.md) — `SE` vs `SS` / `SA`.
- [Watchdog](watchdog-manual.md) — phone sleep.
- [Control](ctrl-panel-manual.md) — LIMIT and FAST.
