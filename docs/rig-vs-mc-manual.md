# Rig vs SliderMC configuration

Two places describe “the machine.” Only one of them moves metal.

---

## SliderMC owns

From `CG` (and live status):

- Axis count (`axis` → 1, 2, or 3 live slots)
- Physical `slider_min_1` / `slider_max_1` (and `_2` / `_3`; Python fields `slider_min` / `slider_max`)
- `max_speed_1` / `max_accel_1` (and `_2` / `_3`; Python fields `max_speed` / `max_accel`)
- Units (`unit_name` / per-axis if the firmware sends them)
- Soft window after `GL`/`GR` / `SL`/`SR`
- Path buffer size (`path_buffer_size`, default 32000 in the UI if missing)
- Homing, hard limits, driver errors

Change these in **[MC Config](mc-config-manual.md)** (or the MC’s own CLI / flash). SliderMoCo **reads** them at link and again when that dialog closes.

---

## Rig JSON owns (`sh_rig`)

Operator labels and Timeline defaults when hello has not arrived yet:

```json
{
  "name": "default slider",
  "axes": [
    {
      "id": 1, "name": "slide", "unit": "mm",
      "min": 0, "max": 600, "max_spd": 100, "max_acc": 500,
      "mc_id": 1, "slot": 1
    }
  ]
}
```

| Field | UI use | Does not |
| --- | --- | --- |
| `name` / `unit` | Info, Timeline lane labels, Maya name matching | Change MC units |
| `min` / `max` | Timeline bands + pre-link jog paint | Override live `CG` travel once linked |
| `max_spd` / `max_acc` | Slider tops until hello | Raise the MC ceiling |
| `mc_id` / `slot` | Display; future multi-MC | Talk to a second UART today |

Save/Load rig in [Config](config-manual.md) is localStorage + a file. `/api/rigs` on the PC host is unused by the GUI.

---

## Project JSON is the shot

Keys, layout, mark **count**, Path Hz, Maya fps. Not the rail. Not A/B poses.

---

## Conflict

Timeline limit checks use the **tighter** of hello/status and rig when both exist (`pushEditorLimits`). If Play is blocked but the MC would allow the move, the rig max_spd/travel is stale — load a matching rig or fix the numbers.

Jog always goes to the live MC. A rig that says 600 mm does not stop `MT 800` if the firmware allows it. Set the **soft window** for that.

---

## Related

- [Config](config-manual.md)
- [MC Config](mc-config-manual.md)
- [Firmware pairing](firmware-pairing-manual.md)
- [Soft window](soft-window-manual.md)
