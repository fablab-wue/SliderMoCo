# A/B

A/B stores **pose marks** (A–H), sends the motors there, and can loop or ping-pong through the ones you enable.

On a **wide layout**, open it from Control **A / B …** (float `#winAb`). How many letters you see is **Marks** in [Config](config-manual.md) (2–8, default 4). Extra letters hide; their stored poses stay in memory until you overwrite them.

On a phone this is the **AB** tab — same controls, no Timeline.

This is not Timelapse (no shutter task) and not Timeline keys.

---

## Layout

Desktop float (no Stop on the dialog — use Control / top-bar ⏹):
2. **Mark bar** — one ▶X and one ▶▶X per letter, then an ETA (seconds) per letter
3. **USE_ALL** master switch (right of the empty spacer row)
4. **Blocks** — one card per letter
5. **LOOP** and **PING-PONG**
6. **Wait time [s]** + **SET** (session speed from time)

Each block:

| Control | Role |
| --- | --- |
| ▶X | Go to that mark at **session** `SS` / `SA` |
| ▶▶X | Go at **max** `SS` / `SA` (session sliders **stay at max**) |
| ⚑ SET | **Tap:** store live pose (axis 1 required; axis 2 if present). Enables USE. **Hold 3 s:** clear the mark and USE |
| USE switch | Include this mark in LOOP / PING-PONG / SET speed. Disabled until a pose exists |
| ETA | Time to this mark at current session speed (~green when within **1** unit on axis 1) |
| Wait time [s] | Pause at this mark during LOOP / PING-PONG (0–60). 0 = no wait |

The mark bar ▶ / ▶▶ buttons do the same moves as the block buttons.

---

## Setting marks

1. Jog or Timeline-seek to the pose.
2. Tap **⚑** on that letter.
3. USE turns on. ETA becomes a number.

Hold **⚑** 3 s to forget that letter.

Poses persist in the browser as `sw_marks`. They are **not** inside the project JSON (that file only stores how many letters to show).

Marks are poses, not soft limits. LIMIT ⍇ / ⍈ are a different store (`SL` / `SR`).

---

## Going to a mark

| Button | Session after the move |
| --- | --- |
| ▶A … ▶H | Unchanged cruise |
| ▶▶A … ▶▶H | **Max** speed and accel. Set SPEED / ACCEL again for slow work |

Keyboard: **Ctrl+letter** is ▶; **Ctrl+Shift+letter** is ▶▶. See [Keyboard](keyboard-control-manual.md).

If the mark has no pose, the button does nothing.

---

## USE_ALL

The master switch is off (and disabled) until at least one mark has a pose.

- Click: if every posed mark is used → turn **all** posed marks off; otherwise turn **all** posed marks on.
- Letters without a pose stay off.

LOOP and PING-PONG need **at least two** checked marks with poses. If fewer, the buttons do nothing.

---

## LOOP and PING-PONG

Both run at **max** `SS` / `SA` (same as ▶▶). Session sliders stay there until you move them.

| Mode | Order |
| --- | --- |
| **LOOP** | Checked marks in letter order, then wrap to the first |
| **PING-PONG** | Letter order, then reverse, and so on (ends are not visited twice in a row) |

At each mark:

1. If you are already there (axis 1 within ~1 unit, and axis 2 if that mark stored one) → **skip wait**, next mark at once.
2. Else `MT` (or the two-axis mark line) and wait until near.
3. Then wait that mark’s **Wait time** (if > 0).
4. Next mark.

**Stop** (any ⏹, Space, Esc) cancels the sequence. It does not restore cruise from max.

---

## SET speed from time

The field labelled **Wait time [s]** next to **SET** is **not** a mark wait. It is the cruise duration you want for the move to the **first checked** mark.

1. Check at least one mark that has a pose.
2. Enter 0.1–60 s.
3. Tap **SET**.

SliderMoCo solves a cruise `SS` from **axis-1 distance**, that time, and **session accel**, clamps to min/max speed, and writes session SPEED. ACCEL is not changed.

Use mark waits inside each block for LOOP pauses; use this SET to pick a one-shot travel time.

---

## Related

- [Config](config-manual.md) — how many letters.
- [Timelapse](timelapse-panel-manual.md) — uses the **same** mark poses for ⏲A / ⏲B / … destinations.
- [Timeline](timeline-panel-manual.md) — keyframes, not A–H.
