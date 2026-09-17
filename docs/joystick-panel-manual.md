# Joystick panel

The Joystick panel is **proportional jog**. Each axis has a horizontal track. The handle is `MJ` percent, not a cruise `ML` / `MR`.

On a phone, the Joy tab is the same sticks and **log** switch, plus a SPEED slider. The **Keyboard** switch is desktop-only.

This is not the Buttons FAST/MOVE pad and not Timeline scrub.

---

## Layout (desktop)

Top to bottom:

1. One **stick row** per axis: numeric percent on the left, track with tick marks, coloured handle.
2. **log** switch (label on the left), under the **last** stick.
3. Footer: **selected axis name** (or `—`) and the **Keyboard** switch (label on the left).

Phone Joy omits the footer / Keyboard.

---

## Sticks

| Action | Result |
| --- | --- |
| Drag the track | That axis is selected; `MJ` follows the handle while the pointer is down |
| Release | Jog stops (`MS` / centred `MJ`) |
| Click the row **outside** the track | Select that axis, or clear selection if it was already selected |
| Digit **1**–**6** | Select that axis id if it exists ([Keyboard](keyboard-control-manual.md); needs Keyboard **on** for most keys) |

Range is **−100 … +100**. SWAP DIR flips the sense the same way as Buttons.

Axis 2 uses the second `MJ` slot (`MJ 0 <pct>`), same as Buttons FAST/MOVE on that row.

---

## log

**Off** (default): handle position maps linearly to `MJ` percent.

**On**: a **log** curve (`K = 9`) — more resolution near centre, faster toward the ends. Tick marks redraw to match. `MJ` is sent about every **50 ms** while you drag.

The switch is **not** saved in the project. It does not arm the keyboard.

If you change log **while** a stick is held, the next `MJ` uses the new curve.

---

## Selected axis and Keyboard

The footer name is the axis Keyboard arrows will jog. After load it is **`—`**: arrows will not move anything until you pick an axis (click a row, drag a track, or press Digit 1–6 with Keyboard on).

Digit **0** clears the selection.

**Keyboard** is off after every load (not persisted). Off: only **Space** and **Esc** (Stop). On: the full map in [Keyboard control](keyboard-control-manual.md).

Turning Keyboard off mid-jog sends stop and restores session speed if that jog was FAST.

---

## SPEED (phone Joy only)

The Joy tab SPEED slider is the same session `SS` as Home / Move / Buttons. Desktop Joystick has no SPEED slider; use [Buttons](buttons-panel-manual.md) or the numpad.

---

## Related

- [Buttons](buttons-panel-manual.md) — digital jog and soft limits.
- [Keyboard](keyboard-control-manual.md) — arrows, numpad, Timeline, marks.
