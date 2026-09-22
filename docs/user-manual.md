# SliderMoCo user manual

This book is the operator index for SliderMoCo: a browser GUI that talks to **one** [SliderMC](https://github.com/fablab-wue/SliderMC) through either a PC / Raspberry Pi host or a Pico W / ESP32 on Wi-Fi.

It does not replace the [maker / builder manual](builder-manual.md). That chapter is how to flash, wire UART, and get a server listening. This chapter is what you see after the page loads.

The physical keypad on [SliderCtrl](https://github.com/fablab-wue/SliderCtrl) is a sibling product. Same motion language (`SS`, `SA`, `ML` / `MR` / `MJ`, `MT`, `SE`, …). Different hardware.

---

## Read this first

1. **ENABLE** must be on (`SE 1`) or the motors will not take motion. On a wide window it is the switch in the top bar. On a phone it is on the Home tab. The switch is **disabled** while the host reports a driver error (`E` / `warn`).
2. **Stop** (red, top-right on desktop; big ⏹ on phone pads) is always live. Tap = stop motion (`MS`). Hold **1 s** = halt (`H`). Hold **2 s** = disable (`SE 0`).
3. **Space** and **Esc** are Stop on a desktop window even when the Keyboard switch is off. See [Keyboard control](keyboard-control-manual.md).
4. A yellow **Link lost…** strip means the WebSocket dropped. The page reconnects by itself. Do not assume the motors stopped unless you hit Stop or the host watchdog fired.
5. Mock kinematics (no USB, or a board with no SliderMC banner) still move numbers on screen. The WebSocket `hello` has `sim: true`. Desktop host: the topbar port button reads **mock**. The GUI does not otherwise badge it — if the rail does not move, you are not on a live MC.
6. On a PC / Pi host the topbar port button (next to SliderMoCo) picks or types the SliderMC COM / tty. If the orange **MC lost** strip is up, click it to choose other hardware. Phone UI and Pico AP have no COM picker.

---

## Architecture

```text
Phone / tablet / PC browser
        HTTP + /ws JSON  (hello, status.axes[])
Pico W / Pico 2 W / ESP32     or     PC / Raspberry Pi Zero
        UART text lines, 115200 (one SliderMC)
SliderMC  (steppers / servo)
```

Two ways to run the same `www/` UI:

| Host | How you start it | Typical URL |
| --- | --- | --- |
| PC / Pi | `python -m server.host` from the repo | http://127.0.0.1:8080/ |
| Pico W / ESP32 | MicroPython `main.py` after `tools/pack_board.py` | http://192.168.4.1/ (SoftAP) or `http://slider/` on your LAN |

The browser does **not** open the serial port. It sends JSON on `/ws`:

| Client → host | Meaning |
| --- | --- |
| `{"mc":"SS 40"}` | Forward one SliderMC line. Host may mirror session `SS` / `SA`. |
| `{"mc":"SS 100","silent":true}` | Forward, but do **not** rewrite the session sliders (temporary max for a seek). |
| `{"wdt":"alive"}` | Watchdog pet, about once a second. Missed for ~2.5 s → host sends `MS`, unless a **server task** (timelapse) is running. |
| `{"task":"TSK_TL_CONT …"}` / `TSK_TL_PATH_*` | Start a Pico/host-owned task. Phone sleep does not abort it. Desktop timeline timelapse uploads `{path:begin/data}` **without** `go`, then `TSK_TL_PATH_CONT` or `TSK_TL_PATH_MSM`. |
| `{"path":{"cmd":"begin\|data\|go"}}` | Timeline Motion Path chunks (`PC` / `PS` / `PD` / `PG` on the MC). |

Status comes back as `axes[]`: `id`, `name`, `pos`, `spd`, `acc`, `min` / `max`, `max_spd` / `max_acc`, `state`, plus OLED `line1` / `line2`. Up to **six** axes. There is no protocol version field.

One SliderMC only. A second controller is not wired in this tree.

---

## Session vs live

The SPEED and ACCEL sliders write **session** cruise (`SS`, `SA`). Control **Spd** / **Acc** columns are what the motors report now.

Some actions raise `SS` / `SA` to the axis maximum for the duration of a move:

| Action | Session sliders after |
| --- | --- |
| Hold **FAST** on Control / phone Move | Restored to your cruise on release |
| Keyboard Shift+arrow | Restored on key up |
| Timeline seek / preroll (`silent`) | Restored when idle |
| A/B **▶▶** mark, **LOOP**, **PING-PONG** | **Left at max** — set SPEED again if you need cruise |

ENABLE (`SE`) is not a slider. Off = no motion, even if you drag a stick.

---

## Two layouts

The same HTML serves both. The breakpoint is **800 px** wide.

### Desktop (wide)

Top bar, left to right:

- **SliderMoCo** brand
- **ENABLE**
- Panel toggles: Timeline, Ctrl
- **Config** — project and rig dialog
- **Stop**

Default split (`layout_rev` 12): Timeline fills the workspace; Control is pinned along the bottom. Drag the **grey separator** to resize Timeline vs the rest of the window if you hide Control. Toggles **hide** a panel; they are not Config checkboxes.

Timeline, Keyboard, and Control exist only here.

### Phone (narrow)

The top bar and the splitter workspace are hidden. Tabs:

**Home · Move · Joy · Window · AB · Timelapse · CLI · Help · Config**

No Timeline editor. No Keyboard switch. Marks, timelapse, and jog still work. Full chapter: [Phone UI](phone-manual.md).

---

## Panel chapters

Write these as standalone chapters. Open the one for the surface you are looking at.

| Chapter | Surface | Wide | Phone |
| --- | --- | --- | --- |
| [Control](ctrl-panel-manual.md) | Jog, LIMIT, telemetry, sticks, SPEED / ACCEL, Play | Panel | — |
| [Keyboard](keyboard-control-manual.md) | PC keys for jog, session, Timeline, marks | Control toolbar | — |
| [A/B](ab-panel-manual.md) | Marks A–H, loop / ping-pong | Float from Control | AB tab |
| [Timelapse](timelapse-panel-manual.md) | Interval / MSM server tasks | Float from Control | Timelapse tab |
| [Timeline](timeline-panel-manual.md) | F-curves and Motion Path | Panel | — |
| [Config](config-manual.md) | Project, rig, Home (`MH`) | Dialog | Config tab → same dialog |
| [MC Config](mc-config-manual.md) | SliderMC `CG` / `CS` keys | Dialog | Config tab → same dialog |
| [Phone](phone-manual.md) | Home, Move, Window, CLI, Help | — | Tabs |

Hardware bring-up: [Maker / builder manual](builder-manual.md).

---

## Files you will meet

| What | Where | What it stores |
| --- | --- | --- |
| **Project** | Browser `localStorage` (`sh_project`) + JSON download | Timeline lanes, markers, mark **count**, frame rate, path Hz, layout fractions, name |
| **Rig** | Browser `localStorage` (`sh_rig`) + JSON download | Axis names, units, travel, `mc_id` / slot |
| **A/B marks** | Browser `localStorage` (`sw_marks`) | Poses A–H. **Not** inside the project file |
| **Timeline JSON** | Timeline menu export | Curves only (also inside the project) |
| **wifi.json** | On the Pico / ESP32 | STA SSID / password / hostname. There is **no** Wi-Fi form in the current GUI (`POST /api/wifi` only) |
| **SliderPins.py** | Device root | UART, LED, camera GPIO, bloop GPIO overlay |

The PC host also exposes `/api/projects` and `/api/rigs` under `data/`. The browser **does not call them yet** — Save/Load is localStorage + a file picker.

Saving a project does not save the rig or A/B poses. Saving a rig does not save keys.

---

## Units and colour

Each axis has a unit from the rig (`mm`, `deg`, …). Numbers are that unit. SPEED is unit/s, ACCEL unit/s². A/B “near” checks use **1** of axis 1’s unit (treated as millimetres in the code constants).

Axis colours are pastels on the hue wheel, rotated **+30°** then every **60°**, assigned as 1 violet, 2 mint, 3 apricot, 4 sky, 5 spring, 6 rose. **Stop** stays red. Shared (all-axis) buttons stay ochre.

---

## Operator and builder chapters

| Chapter | Topic |
| --- | --- |
| [Safety and ENABLE](safety-manual.md) | Stop / Halt / Disable, ENABLE, rail |
| [Soft window](soft-window-manual.md) | `SL`/`SR` vs physical travel, LIMIT colours |
| [Session](session-manual.md) | `SS`/`SA`/`SE`, gamma, silent vs max |
| [CLI](cli-manual.md) | Phone SEND boxes and raw MC lines |
| [Camera trigger](camera-trigger-manual.md) | GPIO pulse vs Exposure / FACTOR |
| [Watchdog](watchdog-manual.md) | Phone sleep vs tasks vs Play |
| [Mock vs real](mock-vs-real-manual.md) | Banner timeout, `hello.sim` |
| [Wi-Fi](wifi-manual.md) | SoftAP, STA, `/api/wifi`, iPhone AP |
| [Troubleshooting](troubleshooting-manual.md) | COM, UART, Link lost, stale `www/` |
| [Firmware pairing](firmware-pairing-manual.md) | SliderMC contract, one-MC limit |
| [Two browsers](two-browsers-manual.md) | Last `SS` wins, shared WDT |
| [Import / export](import-export-manual.md) | Maya, CSV, Timeline JSON, fps vs Hz |
| [Help tab](help-tab-manual.md) | On-device Help copy |
| [Timeline errata](timeline-errata.md) | Silent seek restore |
| [First power-on](first-power-on-manual.md) | Banner, `CG`, when to Home |
| [Rig vs MC](rig-vs-mc-manual.md) | `sh_rig` vs `CG` |
| [MC Config](mc-config-manual.md) | Firmware keys, Motors / Servos / Axis |
| [Production checklist](production-checklist-manual.md) | Field box sign-off |
| [Raspberry Pi Zero](pi-zero-manual.md) | CPython host on a Pi |
| [On-device files](on-device-files-manual.md) | `PUT /api/files` |
