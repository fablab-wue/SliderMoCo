# Keyboard control

On a **wide (PC) layout**, the Joystick panel can take the PC keyboard so you jog, set session speed and accel, scrub the Timeline playhead, play a path, and hit A–H marks without the mouse.

Keyboard control is **desktop only**. On a phone-width window the Joystick panel and these bindings are not used.

This is not the physical keypad on SliderCtrl. It talks the same motion lines (`ML` / `MR` / `MJ` / `MS`, `SS` / `SA`, `MT`, `SE`) as the on-screen buttons.

---

## Arming

The **Keyboard** switch lives in the Control panel toolbar (left of **log**) and in the Joystick panel footer. It is **off** after every load (not saved in the project).

- **Off** — only **Space** and **Esc** still work (STOP). Nothing else is bound.
- **On** — the rest of this chapter applies.

The **log** switch (under the last stick) only changes the joystick curve. It does not arm the keyboard.

---

## When keys are ignored

Bindings do **not** fire while focus is in a text field: `INPUT` (number, text, …), `TEXTAREA`, `SELECT`, or a `contentEditable` box. Type in T / V, wait times, and Config as usual.

Checkboxes (ENABLE, Keyboard, log, MSM, Handles, …) are **not** treated as fields. After you click a switch it blurs, so **Space** is STOP, not “toggle that switch again.”

Range sliders still eat keys while they are focused — click the page or a panel chrome if arrows start moving a slider instead of the motors.

If the browser window loses focus, or the tab is hidden, a held Left/Right jog is stopped (`MS`) and session speed is restored if that jog was FAST.

---

## Selected axis

Left / Right jog the **selected** axis only. There is no selection after load (`—` in the footer). That is deliberate: arrows cannot start a move until you pick an axis.

| Action | Result |
| --- | --- |
| Main-row **1** … **6** | Select that axis id if it exists. The joystick row is outlined in the axis color; the Control panel axis row is selected; the Joystick footer shows the name. |
| Main-row **0** | Clear the keyboard selection. Footer shows `—`. Left / Right do nothing. The Control / Timeline active axis is left as it was. |
| Click a joystick row (value or empty chrome) | Select that axis. Click the **same** row again to clear. |
| Click a Control panel axis row | Select that axis for keyboard jog and for the Timeline. |
| Drag a joystick track | Select that axis (does not toggle off). |

**Numpad 0** is not “no axis.” It sets session speed to 100% of max (see below).

Left / Right jog the **selected** live axis (1–6).

Swap-dir on Home (`⟺ SWAP DIR` / **2nd**) is honored, same as the Buttons MOVE / FAST keys.

---

## STOP

These work on desktop even when **Keyboard** is **off**, as long as you are not typing in a field:

| Key | Result |
| --- | --- |
| **Space** | STOP: cancel Timeline Play / preroll, cancel A/B LOOP / PING-PONG, `MS`. If a FAST key-jog was held, session `SS` is restored. |
| **Esc** | Same as Space. |

---

## Jog (Left / Right)

Requires **Keyboard** on and an axis selected. **Ctrl is not used** on these keys.

| Key | Result |
| --- | --- |
| **Left** / **Right** (hold) | MOVE at **session** speed and accel (`ML` / `MR`, or `MJ` on axis 2). Release → `MS`. |
| **Shift+Left** / **Shift+Right** (hold) | FAST: temporary max `SS` (not written into the session sliders). Release → `MS` and restore session `SS`. |

Key auto-repeat is ignored so the controller is not flooded with MOVE lines. Hold the key; one command goes out until release.

---

## Session speed and accel (numpad)

Requires **Keyboard** on. These keys are the **numeric keypad**, not the number row above QWERTY.

Percent values are of **axis 1** `max_spd` or `max_accel` (`spdMax` / `accMax` from the rig / hello), then clamped to `spdMin`…`spdMax` or `accMin`…`accMax`. The SPEED / ACCEL sliders and the MC session (`SS` / `SA`) update together.

Without **Alt** the keys set **speed**. Hold **Alt** for **accel**.

| Numpad | Speed (no Alt) | Accel (Alt) |
| --- | --- | --- |
| **,** (decimal) | 5% of max | 5% of max accel |
| **1** … **9** | 10% … 90% of max | same % of max accel |
| **0** | 100% of max | 100% of max accel |
| **+** / **−** | ± 1% of max | ± 1% of max accel |
| **×** / **÷** | × √√2 / ÷ √√2 | same for accel |

√√2 is about **1.189**. Four **×** doubles the value; four **÷** halves it.

A laptop without a numpad cannot set these percentages from the keyboard. Use the SPEED / ACCEL sliders.

---

## Timeline playhead

Requires **Keyboard** on and a Timeline editor (wide layout). Times are clamped to `0` … max path duration.

**Up** moves later. **Down** moves earlier. **PageUp** is the **end** (last motion key). **PageDown** is the **start** (`0 s`).

| Key | Playhead | Motors |
| --- | --- | --- |
| **Up** / **Down** | ± **0.1 s** | No |
| **Shift+Up** / **Shift+Down** | ± **1 s** | No |
| **Ctrl+Up** / **Ctrl+Down** | ± 0.1 s | Yes — `SE 1` + `MT` to the pose at that time |
| **Ctrl+Shift+Up** / **Down** | ± 1 s | Yes |
| **PageDown** / **PageUp** | Start / end | No |
| **Ctrl+PageDown** / **Ctrl+PageUp** | Start / end | Yes |

Without Ctrl this is the same as a **left-click** on the graph (preview). With Ctrl it is the same as a **right-click** (retarget).

These do **not** use the Timeline **\|◀◀** / **▶▶\|** max-speed seek. They use the current session `SS` / `SA` when they send `MT`.

---

## Letters (always with Ctrl)

Requires **Keyboard** on. **Ctrl** must be down so a stray letter does not seek, play, or toggle enable. The handler calls `preventDefault`, so **Ctrl+A** does not Select All and **Ctrl+P** does not print.

| Key | Result |
| --- | --- |
| **Ctrl+A** … **Ctrl+H** | MOVE to mark A…H at session speed (`MT`), same as A/B **▶X**. No pose stored → nothing happens. |
| **Ctrl+Shift+A** … **H** | FAST to that mark (max session SS/SA, same as A/B **▶▶X**). |
| **Ctrl+Alt+A** … **H** | SET that mark from the live pose, same as **⚑**. |
| **Ctrl+P** | Timeline Play from the start (same as **▶**). Blocked if a visible lane is over a speed / accel / travel limit. |
| **Ctrl+R** | Timeline Play reverse (same as **◀**). Same limit rule. |
| **Ctrl+E** | Toggle ENABLE (`SE 1` / `SE 0`). |
| **Ctrl+K** | Timeline **Key**: write the **live** motor pose onto all **visible** lanes at the playhead. |

---

## Quick reference

**Always (desktop, not in a field)**

- Space, Esc — STOP

**Keyboard on**

- 0 — no axis · 1–6 — select axis
- Left / Right — MOVE · Shift+Left / Right — FAST
- Up / Down — playhead ±0.1 s · Shift — ±1 s · Ctrl — also `MT`
- PageDown / PageUp — playhead start / end · Ctrl — also `MT`
- Numpad `,` 1–9 0 + − × ÷ — session speed · Alt — session accel
- Ctrl+A–H — mark MOVE · Ctrl+Shift — FAST · Ctrl+Alt — SET
- Ctrl+P / Ctrl+R — play / reverse · Ctrl+E — enable · Ctrl+K — key

---

## Related

- Timeline panel: [timeline-panel-manual.md](timeline-panel-manual.md) (playhead, Key, Play, limits).
- A/B marks, LOOP / PING-PONG, and SET_SPEED stay on the A/B panel; the letter keys only MOVE / FAST / SET a stored pose.
