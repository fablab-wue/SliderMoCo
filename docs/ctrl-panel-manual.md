# Control panel

The Control panel is the **desktop motion strip** under the Timeline: session ENABLE, jog, live pose, analog sticks, SPEED / ACCEL, and Timeline transport. It has no caption. It is pinned to the bottom of the workspace (`flex: 0 0 auto`).

It is **wide layout only**. On a phone-width window the Control panel is not shown.

This is not Timeline F-curve editing (that is the graph above) and not A/B / Timelapse / Stop Motion (those are floats opened from this panel).

---

## Layout

Left: toolbar, one **axis row** per live motor, then SPEED and ACCEL sliders.

Right: a 4× grid of play / seek / dialog buttons and the two OLED lines.

Axis rows come from `status.axes[]` (or the rig if status has not arrived). Colours are the same pastel map as the Timeline lanes.

---

## Toolbar

Left to right:

1. **Menu** (hamburger) — same import/export / Change Time list as the Timeline menu. Both buttons open the same actions. See [Import / export](import-export-manual.md).
2. **ENABLE** switch and the live MC **state letter** (I / M / …). Same `SE` as the top-bar ENABLE.
3. Playhead time (`s`) — follows the Timeline playhead. Ochre dashed number: click, type seconds, **Enter** to move the **red** playhead only (same as a graph left-click). **Escape** cancels. Does not move motors.
4. Red **⏹** — Stop. Tap `MS` (also cancels Timeline Play and an A/B loop). Hold ~1 s `H`. Hold ~2 s `SE 0`. Same hold map as the top-bar Stop.
5. **Eye / lock** (all lanes) — show or hide every Timeline lane; lock or unlock every lane’s keys.
6. **Prev / Key / Next** (all visible lanes) — jump the playhead to the previous or next visible key (left-click: playhead only; right-click: path or `MT`, same as a graph right-click). **Key** writes the live pose onto all visible lanes at the playhead.
7. **Gamepad** · **Keyboard** · **log** switches.

**Gamepad** is a placeholder (default off). It does not bind a controller yet.

**Keyboard** arms PC keys. Off after every load (not saved). See [Keyboard control](keyboard-control-manual.md).

**log** is the analog-stick curve (`K = 9` when on). Not saved. It does not arm the keyboard.

---

## Axis row

Left to right:

| Field | Role |
| --- | --- |
| **Name** | Rig / hello name. Click the row (not a button or stick) to select that axis for Keyboard jog and the Timeline. |
| **Pos / Spd / Acc** | Live telemetry (`pos`, `spd`, `acc`) plus unit. Spd and Acc are what the motors report, not the session sliders. **Pos** is ochre and dashed: click, type a target, **Enter** sends `SE 1` and `MT` for **that axis only** (other slots `_`). **Escape** cancels. Clamp to the axis min / max when the rig has them; otherwise the MC still applies the soft window. Session cruise speed, not a Timeline path; the red playhead does not move. |
| **Pose** | Timeline value of that lane at the playhead (same digits as the graph HUD). After a path seek or Play it should match **Pos**. |
| **Jog** | ⍇ FAST MOVE MOVE FAST ⍈ — see [Jog](#jog) and [LIMIT](#limit). |
| **Eye / lock** | This lane only. |
| **Prev / Key / Next** | This lane only. Same left/right-click rule as the toolbar. |
| **Stick** | Analog `MJ` for that axis. |

---

## Jog

| Button | Down | Release |
| --- | --- | --- |
| FAST_L ◀◀ | Session `SS` → axis **max**, then jog left | `MS`, restore session `SS` |
| MOVE_L ◀ | Jog left at session `SS` | See tap vs hold |
| MOVE_R ▶ | Jog right at session `SS` | See tap vs hold |
| FAST_R ▶▶ | Max `SS`, jog right | `MS`, restore session `SS` |

**Axis 1** (and any row that is not id 2) sends `ML` / `MR`.

**Axis 2** sends `MJ 0 ±100`, not `ML 2`.

**SWAP DIR** / **SWAP DIR 2nd** live only on the phone Home tab (saved in the browser). Desktop Control honors the same flags. They flip which side is min vs max for LIMIT colours and for the sign of the jog.

### Tap vs hold

| Gesture | MOVE | FAST |
| --- | --- | --- |
| **Hold longer than ~⅓ s**, then release | Jog while held, then `MS` | Max speed while held, then `MS` and cruise `SS` restored |
| **Short tap** | **Cruise** in that direction until you tap the same button again, tap Stop, or start another jog | Same cruise idea, but `SS` was raised to max — restore happens on release of FAST |

If MOVE / FAST on that side are **grey**, you are already on the soft or physical end.

---

## LIMIT

Each LIMIT button is a **soft window** end (`SL` left/min, `SR` right/max after SWAP DIR). Physical travel is separate. Full contract: [Soft window](soft-window-manual.md).

| Gesture | Result |
| --- | --- |
| **Tap** | `MT` to that soft end. No-op if the side has no soft value. |
| **Hold 3 s** | Set this side’s soft limit to the **live** pose. |
| **Hold 5 s** | Reset this side to the **physical** end (or `none` if the MC has no number). |

A hold suppresses the tap so you do not also `MT`.

| Paint | Meaning |
| --- | --- |
| **Green** | Live pose is on this soft end (within ~1 unit) and **not** on the physical end |
| **Red** | Live pose is on the **physical** min/max. Red wins over green |
| **Axis colour** | Soft value exists; you are not on it |
| **Grey** | No soft value on this side |

When LIMIT is green or red, the **same-side** MOVE and FAST go grey.

---

## Analog sticks

Drag the track: that axis is selected; `MJ` follows the handle while the pointer is down. Release stops (`MS` / centred `MJ`). Range **−100 … +100**. SWAP DIR flips the sense.

Click the stick chrome to select that axis (click again to clear). Drag does not toggle off.

**log** off (default): linear map. On: more resolution near centre. `MJ` is sent about every **50 ms** while you drag. Changing log mid-drag uses the new curve on the next send.

---

## SPEED and ACCEL

These are **session** cruise (`SS` / `SA`), not the live Spd / Acc columns.

- SPEED sends `SS` (gamma 2: more resolution at the slow end). Click the ochre number to type a cruise value; **Enter** clamps to SPEED min…max and sends `SS`.
- ACCEL has two sliders: **accel** (ramp up) and **decel** (ramp down). The two ochre numbers are `<accel> / <decel>` — click either to type. **sym** (center of the ACCEL label row, default **on**) keeps both sliders equal. Turn it on and decel snaps to accel. With **sym** on, either typed number writes both.
- Desktop always sends `SA <accel> <decel>`. One-arg `SA <a>` from the phone still sets both on the MC.

Keyboard numpad can change the same session values.

FAST (and some A/B / Timeline seeks) may raise `SS` / `SA` temporarily. After a Control FAST release, SPEED should show your cruise again. After A/B **▶▶** or LOOP it may show **max** — that is the [A/B](ab-panel-manual.md) chapter.

---

## Play cluster

| Button | Result |
| --- | --- |
| **◀** | Play the whole path backwards |
| **◁** | Play reverse from the playhead |
| **▷** | Play from the playhead to the end |
| **▶** | Play from 0 s to the end |
| **\|◀◀** | Jump the playhead to 0 s and seek the motors there at max `SS`/`SA` (`silent`). Session cruise is **restored** when idle |
| **▶▶\|** | Jump to the last motion key and seek the same way |
| **A / B …** | Open the A/B float |
| **Timelapse …** | Open the Timelapse float |
| **Stop Motion …** | Open the Stop Motion float |

Play samples Timeline F-curves at path frequency. **▶** / **▷** / **◀** are disabled if a visible lane is over a speed / accel / travel limit. Preroll, markers, and limit bands: [Timeline](timeline-panel-manual.md).

OLED (`line1` / `line2`) is the same host/MC status the controller would show. Default `Ready`.

---

## Related

- [Timeline](timeline-panel-manual.md) — F-curves, toolbar, markers.
- [Keyboard](keyboard-control-manual.md) — arrows, numpad, play, marks.
- [Session](session-manual.md) — `SS` / `SA` / `SE`.
- [A/B](ab-panel-manual.md) · [Timelapse](timelapse-panel-manual.md) — floats from this panel.
