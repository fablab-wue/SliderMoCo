# Import / export cookbook

Three download kinds live on the desktop Timeline **and Control** hamburgers (same menu). Project and rig files live in [Config](config-manual.md). None of this is on the phone editor (there is no Timeline).

---

## What each file is

| File | Menu / dialog | Contains | Does not contain |
| --- | --- | --- | --- |
| **Project** JSON | Config → Save project | Lanes, markers, `play_hz`, mark **count**, fps, name, layout | A/B poses (`sw_marks`), rig, `wifi.json` |
| **Rig** JSON | Config → Save rig | Axis names, units, travel, `mc_id` / slot | Keys |
| **Timeline** JSON | Export Timeline | `format: slidermoco-timeline`, lanes, markers, `play_hz` | Layout, fps, marks A–H |
| **CSV** | Export CSV | Sampled Time, Pos/Spd/Acc per lane | Handles, interpolation names |
| **Maya** `.ma` | Export Maya Camera | ASCII camera `sliderCam` + anim curves | Live motors |

Import Timeline accepts `format === "slidermoco-timeline"` (and older `"sliderhost-timeline"` files). It **replaces** the current curves after confirm.

---

## Frame rate vs Path Hz

| Field | Where | Used for |
| --- | --- | --- |
| **Frame rate** | Config, 1–120, default 30 | **Maya export** and Timeline **F** readout |
| **Path frequency** | Config, 10–200, default 50 | Motion Path sample rate **and** CSV `dt = 1/Hz` |
| Timelapse clock | Fixed **30** in JS | Not Config fps |

Changing fps does not change Play on the rail.

---

## Maya camera

- Scene is Maya ASCII 5.0, `currentUnit -l centimeter -a degree -t ntsc`.
- Node `sliderCam` / `sliderCamShape`, 35 mm film back.
- Lane **names** map to channels (first match wins):

| Lane name (lower) | Channel | Scale |
| --- | --- | --- |
| slide, dolly, track, x | translateX | × **0.1** (mm → cm) |
| height, lift, elev, y | translateY | × 0.1 |
| z | translateZ | × 0.1 |
| tilt, rx | rotateX | × 1 (deg) |
| pan, ry | rotateY | × 1 |
| roll, rz | rotateZ | × 1 |

Unmapped channels are zeros. Samples are one key per frame from `t = 0` to motion duration at Config fps. Interpolation in Maya is not your Bézier handles — it is dense keys (`tan` 9, unweighted).

Import the `.ma` into Maya; you do not Play it on SliderMC.

---

## CSV

Header: `Time,Pos1,Spd1,Acc1,Pos2,…` (lanes sorted by id). Time step is **Path Hz**, not fps. Speed/accel are finite differences of the sampled curve (first samples 0). Resolve / a spreadsheet can plot it; it is not a motion-path reload.

---

## Resolve-style round trip

1. Edit in Timeline (this app is the curve editor).
2. Export Timeline JSON to archive the handles.
3. Export CSV if you want a table in another tool.
4. Keep the **project** if you also care about layout and mark count.
5. Copy `sw_marks` only by using the same browser profile, or re-⚑ the poses.

There is no DaVinci `.drt` writer.

---

## Path too long

Import refuses a `play_hz` that would not fit `path_buffer_size / Hz` (default buffer 32000). Lower Hz or shorten the shot. Same clamp as Play.

---

## Related

- [Timeline](timeline-panel-manual.md)
- [Config](config-manual.md)
- [Two browsers](two-browsers-manual.md) — files are per-browser until you download.
