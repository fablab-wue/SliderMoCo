# Timelapse

Timelapse runs an **interval shoot as a server task**. The host (Pico or PC) owns the loop. You can lock the phone; the watchdog will **not** abort the task.

This is not Timeline **Play**. Play is a Motion Path sampled from F-curves and dies if the browser tab sleeps.

On a **wide layout**, open it from Control **Timelapse …** (float `#winTl`). There is no docked Timelapse panel.

---

## Desktop vs phone

| Layout | Motion | Start |
| --- | --- | --- |
| **Desktop** (wide) | Timeline F-curves from **t = 0** to the motion end | **⏲ Start** on the Timelapse float |
| **Phone** (≤800 px) | Axis-1 crawl toward an **A/B mark** (`sw_marks`) | **⏲A** … **⏲H** — unchanged |

Both layouts share **Timelapse FACTOR**, **Exposure time**, and the **MSM** switch.

---

## Desktop (timeline)

1. **⏲ Start** — preroll to the pose at t = 0, upload the Timeline as a path sampled at **Config → Frame rate**, then start a host task. No `path.go` (the task owns play). The rest of the UI Stop cancels the task (MC lines that start with `M` cancel a running task).
2. ETA **s** — `timeline duration × FACTOR` (wall-clock length of the shoot).
3. **Timelapse FACTOR** (integer 3–1000, default 10).
4. **Exposure time** (0.1–30 s, default 0.1) — shutter pulse width (GPIO and `CT`).
5. **MSM** switch. Saved in `localStorage` (`1` / `0`).

| MSM | Task | Motion |
| --- | --- | --- |
| **Off** | `TSK_TL_PATH_CONT` | Path play with `PS` = `(1e6 / fps) × FACTOR`, then `PG`. Camera pulses like CONT |
| **On** | `TSK_TL_PATH_MSM` | Each FPS sample is a hop: trigger, then `MT` to the accumulated pose |

Trigger **period** = `FACTOR / fps`, floored at **0.2 s**.

Start fails (on-screen error, no task) if there is no timeline, a limit-band violation, no motion on the curves, or the FPS raster would exceed the path buffer.

ENABLE must be on or the MC will ignore motion.

---

## Phone (marks)

You pick a **mark** (same A–H poses as [A/B](ab-panel-manual.md)). The task moves **axis 1** toward that pose. Axis 2 is sent as `_` (unused) in the current UI path.

| MSM switch | Task | Motion |
| --- | --- | --- |
| **Off** | `TSK_TL_CONT` | Continuous crawl at `session SPEED / FACTOR` (accel similarly scaled) |
| **On** | `TSK_TL_MSM` | Move-shoot-move: hop, settle, trigger, repeat. Frame count from distance, SPEED, and FACTOR |

`TSK_TL_STEP` (fixed hop distance) exists on the server and in leftover desktop bind code; the **visible** pad does not expose dest/step fields.

### Mark pad

| Button | Result |
| --- | --- |
| **⏲A** … | Start timelapse toward that mark (see [Start rules](#phone-start-rules)) |
| **▶▶A** … | Same as A/B **▶▶**: seek the mark at **max** session speed (not a timelapse) |
| ETA **s** / **m** | Travel time at *timelapse* speed (session SPEED / FACTOR), not cruise |

Set marks on the [A/B](ab-panel-manual.md) panel first. Empty mark → **Set marks first**.

The phone trigger clock still uses a **fixed 30 fps** in the UI (`TL_FPS_FIXED`). That is **not** Config → Frame rate.

MSM frame count: `ceil((distance / tlSpeed) * 30)`, at least 1.

### Phone start rules

All of these fail with an on-screen error and do not start a task:

| Check | Message |
| --- | --- |
| Mark has no axis-1 pose | Set marks first |
| No live position | No position |
| Already within ~1 mm of the mark | Already there |
| Session SPEED ≤ 0 | Set SPEED |
| MSM and computed frames < 1 | TL too close |

---

## FACTOR, exposure, trigger clock

| Value | Used as |
| --- | --- |
| **FACTOR** | Desktop: stretches path slice time (`PS × FACTOR`) and trigger period. Phone: `tlSpeed = SS / FACTOR`. Minimum 3 |
| **Exposure time** | `trigger_length` — pulse width on the host GPIO **and** SliderMC `CT` (0.1–30 s) |
| Trigger **period** | Desktop: `FACTOR / frame_rate`. Phone: `FACTOR / 30`. Floored at **0.2 s** |

Starting a task **replaces** any previous task. One task at a time.

---

## STOP and the watchdog

**⏹** stops motion and cancels the task.

Because the loop is a `{"task":…}` on the host, missing `{"wdt":"alive"}` (phone sleep, laptop lid) does **not** `MS` the cart mid-shoot. That protection is the reason this dialog exists.

Do not confuse that with Timeline Play — keep the desktop tab awake for F-curve playback. Desktop **⏲ Start** is a task, so it survives tab sleep after the path has been uploaded.

---

## Related

- [Builder](builder-manual.md) — `PIN_CAMERA_CTRL` (OC active-low), `CT`.
- [Camera trigger](camera-trigger-manual.md) — Exposure time vs GPIO / `CT`.
- [A/B](ab-panel-manual.md) — phone ⏲ destinations.
- [Timeline](timeline-panel-manual.md) — F-curves used by desktop Start.
