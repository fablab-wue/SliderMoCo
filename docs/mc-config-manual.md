# MC Config

MC Config is a **dialog** that reads and writes SliderMC persistent keys (`CG` / `CS`). It is not the [Project & rig](config-manual.md) dialog and not the browser rig JSON.

On desktop it is **MC Config** in the top bar (before Config). On a phone it is the gear tab, then **MC Config**.

Wire names stay firmware-canonical (`CS MOTOR_1_min 0`). The grid shows shorter labels; the real key is in the field tooltip and in the status line on error.

---

## Tabs

| Tab | What it is |
| --- | --- |
| **Common** | Machine-wide keys: name, motor/servo counts, path, ramps, buzzer, watchdog, extenders |
| **Motors** | STEP/DIR hardware (`MOTOR_N_*`, homing, driver and limit pins). Up to **3** columns |
| **Servos** | PWM channels (`SERVO_N_*`). Up to **3** columns |
| **Axis** | Six boxes per row: motors **1–3** then servos **1–3** (`AXIS_1`…`AXIS_3` / `MOTOR_*`, `AXIS_4`…`AXIS_6` / `SERVO_*`). **Read-only** |

Motors and Servos are the write path. Axis is a packed view of the same travel and speed after motors-then-servos mapping. `CS AXIS_*` and `CS axis` are rejected.

`EXT_1`…`EXT_4` stay on Common so their digits do not steal motor columns.

Unknown keys with a last digit 1–3 land as extra Motors rows; 4–6 as extra Servo rows.

---

## Set

One **Set** at the bottom of Common, Motors, and Servos. Axis has no Set. Only boxes you changed are sent (`CS key value`, values as strings).

Enter in a box runs that tab’s Set. Switching tabs does not send. Closing without Set discards the boxes.

The status line reports `set 4` or `set 3, failed MOTOR_1_max: …`. Later dirty keys still apply after a failure.

**Motor count** / **Servo count** live on Common. Timeline lanes and the rest of the UI pick up a new packed axis count **when you close** the dialog. After a successful count change, Motors / Servos / Axis columns rebuild while the dialog stays open.

`slider_*` keys are hidden. Session aliases `speed` / `accel` collapse onto `init_*`. Packed `max_speed_N` is used on Motors only when `MOTOR_N_max_speed` is missing.

Do not use this dialog for factory reset (`CR` is not exposed).

---

## Mock

Mock kinematics (`hello.sim`) can **list** the dump so you can open the dialog without hardware. Inputs and Set are disabled. Closing does not change mock axis count.

---

## Close

**X** or Esc dismisses the dialog. The host re-reads `CG` (real MC) and pushes a new hello so Info, jog, and Timeline lanes match.

---

## Related

- [Config](config-manual.md) — project, rig, Home
- [Rig vs MC](rig-vs-mc-manual.md)
- [CLI](cli-manual.md) — raw `CG` / `CS`
- [Firmware pairing](firmware-pairing-manual.md)
