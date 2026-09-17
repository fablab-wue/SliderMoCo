# Buttons panel

The Buttons panel is the **desktop jog pad**: Stop, one row of limit / move / fast per axis, then session SPEED and ACCEL.

On a phone-width window this panel is not shown. The same jobs live on [Home](phone-manual.md#home), [Move](phone-manual.md#move), and [Window](phone-manual.md#window).

This is not the Joystick (analog `MJ`) and not A/B marks.

---

## Layout

Top to bottom:

1. Full-width red **⏹** (Stop).
2. One **jog row** per live axis, six equal buttons.
3. **SPEED** slider and numeric cruise.
4. **ACCEL** slider and numeric session accel.

Rows are created from `status.axes[]` (or the rig if status has not arrived). Axis 1 is cyan, axis 2 pink, then yellow / coral / green / lavender.

**ENABLE** is not on this panel. Use the desktop top bar (or phone Home).

**Home** (`MH`) is not on this panel. Use [Config](config-manual.md).

---

## Jog row

Left to right:

| Button | Label | Down | Release |
| --- | --- | --- | --- |
| LIMIT_L | ⍇ | See [Soft limits](#soft-limits-limit) | — |
| FAST_L | ◀◀ | Session `SS` → axis **max**, then jog left | `MS`, restore session `SS` |
| MOVE_L | ◀ | Jog left at session `SS` | See [Tap vs hold](#tap-vs-hold) |
| MOVE_R | ▶ | Jog right at session `SS` | See [Tap vs hold](#tap-vs-hold) |
| FAST_R | ▶▶ | Max `SS`, jog right | `MS`, restore session `SS` |
| LIMIT_R | ⍈ | See [Soft limits](#soft-limits-limit) | — |

**Axis 1** (and any row that is not id 2) sends `ML` / `MR`.

**Axis 2** sends `MJ 0 ±100` (joystick-style), not `ML 2`. That matches SliderMC’s second slot.

**SWAP DIR** / **SWAP DIR 2nd** live only on the [phone Home](phone-manual.md#home) tab (saved in the browser). Desktop Buttons reads the same flags — there is no desktop swap switch. They flip which side is min vs max for LIMIT colours and for the sign of the jog.

---

## Tap vs hold

Two handlers share the MOVE / FAST buttons (desktop bind + phone-style cruise). Practical result:

| Gesture | MOVE | FAST |
| --- | --- | --- |
| **Hold longer than ~⅓ s**, then release | Jog while held, then `MS` | Max speed while held, then `MS` and cruise `SS` restored |
| **Short tap** | **Cruise** in that direction until you tap the same button again, tap Stop, or start another jog | Same cruise idea, but `SS` was raised to max — restore happens on release of FAST |

If MOVE / FAST on that side are **grey**, you are already on the soft or physical end. They will not start a jog.

---

## Soft limits (LIMIT)

Each LIMIT button is a **soft window** end (`SL` left/min, `SR` right/max after SWAP DIR). Physical travel (`slider_min` / `slider_max` from the MC / rig) is separate.

| Gesture | Result |
| --- | --- |
| **Tap** | `MT` to that soft end. No-op if the side has no soft value. |
| **Hold 3 s** | Set this side’s soft limit to the **live** pose (`SL` / `SR` + position). |
| **Hold 5 s** | Reset this side to the **physical** end (or `none` if the MC has no number). |

A hold suppresses the tap so you do not also `MT`.

### Colours

| Paint | Meaning |
| --- | --- |
| **Green** | Live pose is on this soft end (within ~1 unit) and **not** on the physical end |
| **Red** | Live pose is on the **physical** min/max. Red wins over green |
| **Axis colour** | Soft value exists; you are not on it |
| **Grey** | No soft value on this side |

When LIMIT is green or red, the **same-side** MOVE and FAST go grey (blocked). The other side stays live.

---

## SPEED and ACCEL

These are **session** cruise, not live telemetry (that is [Info](info-panel-manual.md)).

- SPEED sends `SS` (slider is gamma-shaped: more resolution at the slow end).
- ACCEL sends `SA`.
- The number next to the slider is the commanded value.

Keyboard numpad can change the same session values; see [Keyboard control](keyboard-control-manual.md).

FAST (and some A/B / Timeline seeks) may raise `SS` / `SA` temporarily. After a Buttons FAST release, SPEED should show your cruise again. After A/B **▶▶** or LOOP it may show **max** — that is the A/B chapter, not a Buttons bug.

---

## Stop

Same control as the top-bar Stop and every other ⏹.

| Gesture | Line |
| --- | --- |
| Tap | `MS` — also cancels Timeline Play and an A/B loop |
| Hold ~1 s | `H` (halt) |
| Hold ~2 s | `SE 0` (disable). ENABLE on the top bar will look wrong until you turn it on again |

---

## Related

- Phone Window tab: set / reset the same soft window from live pose without the 3 s / 5 s hold.
- [Joystick](joystick-panel-manual.md) for proportional `MJ`.
- [A/B](ab-panel-manual.md) for stored poses, not travel limits.
