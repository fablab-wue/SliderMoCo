# Info panel

The Info panel is **read-only telemetry**. It does not jog, enable, or save.

On a phone the **live** numbers are the **sticky footer**. Home’s INFO box is a **static** machine card (name, travel, max speed/accel from hello), not a copy of these rows. There is no separate Info tab.

This is not the Timeline HUD (that is curve values at the playhead) and not the OLED on the SliderMC PCB — though the two text lines are the same strings the controller would show.

---

## Layout

### Desktop

- One **row per axis**, aligned with the Buttons jog rows (same height and gap) so name / pose sit next to that axis’s MOVE buttons.
- Two **OLED** lines under the rows (`line1`, `line2` from status). Default `line1` is `Ready` until the host says otherwise.

### Each axis row

Left to right:

| Field | Source | Notes |
| --- | --- | --- |
| **Name** | `axes[].name` | Falls back to `A` + id |
| **Position** | `pos` | Live, plus the axis **unit** (`mm`, `deg`, …) |
| **Speed** | `spd` | Actual, unit **/s** — not the SPEED slider |
| **Accel** | `acc` | Actual, unit **/s²** — not the ACCEL slider |
| **State** | `state` | Letter from the MC / host. Phone footer may derive **M** (moving) vs **I** (idle). Faults stay **E** / **L** / **D** / **H**. **A** / **B** are accel / brake when the MC sends them |

The row’s accent colour is the axis colour (same map as Buttons / Joystick / Timeline).

### Phone footer

Two metric blocks when a second axis exists (Pos / Spd / Acc + letter, then Pos2 / …). OLED under that.

---

## How to read it

- If **position** does not change when you MOVE, you are on mock, ENABLE is off, or UART is not linked.
- **Spd** staying 0 while you hold MOVE usually means disable, limits, or a dead MC.
- State letters are SliderMC’s (`I` idle, motion letters as that firmware defines). SliderMoCo does not translate them.
- OLED lines are whatever the host / MC put in `line1` / `line2` (tasks like timelapse write “Moving to …”).

The GUI does not print a **Sim** badge. `hello.sim` is true when the host is on MockMC (no UART banner). Treat motion that never matches the rail as simulation; the USB log says `mock MC` or `MC mock on`.

ENABLE on the top bar / Home is **disabled** while status is driver error (`E`) or `warn`.

---

## Updates

Rows rebuild when the axis count changes (hello / first status). Values refresh on every `status` WebSocket frame.

**Link lost…** (page banner, not this panel) means those numbers are stale.

---

## Related

- [Buttons](buttons-panel-manual.md) — session SPEED / ACCEL vs these live columns.
- [Builder](builder-manual.md) — mock vs serial if the numbers look too perfect.
