# Camera trigger

Timelapse tasks pulse a shutter so a stills camera can fire without the phone staying awake.

On a **Pico / Pico W host** the task drives a local GPIO **and** sends SliderMC **`CT`**. The **PC / Pi host has no camera pin**; `python -m server.host` still sends `CT` so SliderMC `PIN_CAMERA_CTRL` can fire.

---

## Pin and pulse

| Board | Default GPIO | Drive |
| --- | --- | --- |
| Pico / Pico W / 2 W | **GP15** (`PIN_CAMERA_CTRL`) | Open-collector, **active-low** (same as SliderMC): idle = input pull-up; pulse = output LOW |
| ESP32 example | **GPIO 4** | same OC pattern |

Pulse **width** is **Exposure time** (0.1–30 s) on both the local pin and `CT <ms>`. `CAMERA_PULSE_MS` is not used for these task pulses.

`camera_ctrl.py` skips the pin if it is `None` or `machine.Pin` is missing (PC host). `CT` is still sent.

Set the pin in `SliderPins.py`. Keep it off UART (Pico 16/17) and the RGB LED (2/3/4).

---

## What the Timelapse dialog sends

| UI field | Task argument | Role |
| --- | --- | --- |
| **FACTOR** | Drives trigger **period** (`FACTOR / fps`, minimum **0.2 s**) | How often a trigger is scheduled |
| **Exposure time** | `trigger_length` (0.1–30 s) | How long the host GPIO sinks low **and** how long `CT` asks SliderMC to pulse |

MSM vs CONT: [Timelapse](timelapse-panel-manual.md).

---

## Cabling

Typical: GPIO → optocoupler or intervalometer “trigger” that expects a **closed contact** (active-low OC), same wiring as SliderMC `PIN_CAMERA_CTRL`.

- Confirm polarity. Do not feed 5 V back into the Pico/ESP32 pin.
- Test with an LED + resistor (LED from 3.3 V to the pin, with a resistor) before a paid shoot.
- PC host: rely on SliderMC `CT`, or run the board host for the extra GPIO.

---

## Related

- [Timelapse](timelapse-panel-manual.md)
- [Builder](builder-manual.md)
- [Production checklist](production-checklist-manual.md)
