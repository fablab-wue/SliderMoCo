# Timeline errata

Corrections to [timeline-panel-manual.md](timeline-panel-manual.md). The panel chapter is still the place to learn the editor. This page is only what drifted after later code.

The panel file’s **Playback → Buttons** lines for start/end seek are updated to match this page. Keep this errata if you are reading an older checkout.

---

## Start / end seek restores cruise

**Old text:** \|◀◀ and ▶▶\| seek at max speed and acceleration; **session speed stays at max**.

**Current code** (`seekAtMax` in `app.js`):

1. Send `SS` and `SA` at axis max with **`silent: true`** (host session cache and sliders do not jump).
2. `SE 1` and `MT` to the pose.
3. When the MC is idle, send silent `SS` / `SA` back to **session** cruise.

Preroll before Play uses the same helper. Keyboard FAST already did this.

**Still leaves session at max:** A/B **▶▶**, LOOP, PING-PONG (`abcApplyMaxSession` is not silent). Desktop Buttons FAST is mirrored while held, then restored on release **without** `silent`.

---

## Live dots during Play

The graph’s hollow live-pose circles (curve colour) follow the **curve at the playhead** while Play is running, and the real pose when idle. Older text mentioned a white filled dot from motors only.

---

## Smooth handles

**Auto** interpolation rebuilds C1/C2 handles from neighbours: a cubic spline over consecutive Auto keys that **locks the in/out Bézier handles of the adjacent non-Auto keys** (Blender Continuous Acceleration). It is not Catmull-Rom through key positions. Linear keys rebuild vector handles toward neighbours. Changing interpolation runs that pass. The panel chapter’s Auto / Linear paragraphs are the operator description.

**Aligned** keys share one slope (`dy/dx`), matching Blender F-curve 2D align (keep each handle’s time `|dx|`, set `dy` from the dragged / longer handle). That is **not** Blender 3D `HD_ALIGN` Euclidean length (mixed time/value hypot), which throws the opposite handle off-screen near slope 0. Handle `|dx|` has a small minimum so it cannot collapse onto the key (Blender F-curve #141029). Shift still copies `|dx|` to the other side.

---

## Related

- [Session](session-manual.md)
- [Timeline](timeline-panel-manual.md)
- [A/B](ab-panel-manual.md)
