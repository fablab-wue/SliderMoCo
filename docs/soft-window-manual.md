# Soft window vs physical travel

Two different ends exist on every axis. Mixing them up is why LIMIT goes green, then red, and why MOVE greys out.

---

## Physical travel

SliderMC reports **hard** ends in the `CG` dump: `slider_min_1` / `slider_max_1` (and `_2` / `_3` for extra axes). The host treats those as **fixed for the life of the slider**. They are the rail, the hard stops, or the firmware travel you configured on the MC.

The [rig](rig-vs-mc-manual.md) JSON can store min/max for the Timeline bands and labels. Authoritative motion limits on a linked MC are still `CG` + live status.

You cannot “set” physical travel from LIMIT or Window. Hold-5 s LIMIT **writes the soft window to the physical number** (or `none` if the MC has no number).

---

## Soft window

Soft ends are `SL` (min) and `SR` (max). Axis 2 uses `SL _ <pos>` / `SR _ <pos>`. Clear with `none`.

The host reads them with `GL` / `GR` at link and on hello refresh.

Jog, `MT` to LIMIT, and Window SET write the soft window. Timeline Play still checks **physical** travel (and speed/accel) on visible lanes.

---

## SWAP DIR

Phone Home **SWAP DIR** / **2nd** (browser `sw_swap_dir`, `sw_swap_dir2`) flips which **button** is min vs max. The MC still stores SL = min, SR = max in machine coordinates.

After a swap, ⍇ is the other physical side. Set the window again if the colours look backwards.

Desktop has **no** swap switch. It honors the same flags if you set them on a phone (or in localStorage) on that browser.

---

## LIMIT colours (desktop Buttons)

| Paint | Meaning |
| --- | --- |
| Grey | No soft value on that side |
| Axis colour | Soft exists; live pose is not on it |
| **Green** | Live pose is on the **soft** end (~1 unit) and **not** on the physical end |
| **Red** | Live pose is on the **physical** end. Red wins |

When green or red, same-side MOVE / FAST go grey.

| Gesture | Command |
| --- | --- |
| Tap | `MT` to the soft value |
| Hold 3 s | Soft = live pose |
| Hold 5 s | Soft = physical end |

---

## Phone Window

| Button | Command |
| --- | --- |
| SET_W_L / R | Soft that side = live pose (axis 1; yellow pair = axis 2) |
| RESET_W_L / R | Clear that side for **both** axes |

There is no tap-to-`MT` LIMIT on the phone. Cruise toward the end, or ▶ a mark.

---

## Related

- [Buttons](buttons-panel-manual.md)
- [Phone](phone-manual.md#window)
- [Rig vs MC](rig-vs-mc-manual.md)
