# SliderMoCo user manual

This book is the operator index for SliderMoCo: a browser GUI that talks to one or more [SliderMC](https://github.com/fablab-wue/SliderMC) boards through either a PC / Raspberry Pi host or a Pico W / ESP32 on Wi-Fi. A wide window can run several controllers at once. A phone-width window still drives the first one only.

It does not replace the [maker / builder manual](builder-manual.md). That chapter is how to flash, wire UART, and get a server listening. This chapter is what you see after the page loads.

The physical keypad on [SliderCtrl](https://github.com/fablab-wue/SliderCtrl) is a sibling product. Same motion language (`SS`, `SA`, `ML` / `MR` / `MJ`, `MT`, `SE`, …). Different hardware.

---

## Read this first

1. **ENABLE** must be on (`SE 1`) or the motors will not take motion. On a wide window it is the switch in the top bar. On a phone it is on the Home tab. The switch is **disabled** while the host reports a driver error (`E` / `warn`).
2. **Stop** (red, top-right on desktop; big ⏹ on phone pads) is always live. Tap = stop motion (`MS`). Hold **1 s** = halt (`H`). Hold **2 s** = disable (`SE 0`). With **Link** off, Stop hits the selected controller. With **Link** on, Stop hits every linked controller. Jog and ENABLE stay on the selected one either way.
3. **Space** and **Esc** are Stop on a desktop window even when the Keyboard switch is off. See [Keyboard control](keyboard-control-manual.md).
4. A yellow **Link lost…** strip means the WebSocket dropped. The page reconnects by itself. Do not assume the motors stopped unless you hit Stop or the host watchdog fired.
5. Mock kinematics still move numbers on screen. The WebSocket `hello` has `sim: true` on that slot. On the desktop host, **+** in the MC row offers **Mock**. A right-click on an existing MC button does not. If the rail does not move, that slot is mock or unlinked.
6. On a wide window the MC row (right side of the top bar, before **MC Config**) is one radio button per controller, plus **+**. The label is that controller’s MC-config name, unless the name is **SliderMoCo**, **SliderMoCo mock**, or **Simulator** — then the button shows the slot number (1, 2, …). **+** opens the port dialog. **+** hides when the host is at its limit (8 on a PC / Pi, 2 on a Pico). Right-click a button to change its port, **Disconnect**, or **Remove**. A connect that fails in that dialog leaves the button **yellow** until a later connect works. A button turns **red** when a link that was up drops on its own (unplug, UART loss). Disconnect on purpose keeps the button and its curves, in the normal unlinked style. Phone UI has no MC row: commands go to the first slot.

---

## Architecture

```text
Phone / tablet / PC browser
        HTTP + /ws JSON  (hello, status.axes[])
Pico W / Pico 2 W / ESP32     or     PC / Raspberry Pi Zero
        UART or USB serial, 115200 (up to 2 on a Pico, up to 8 on a PC / Pi)
SliderMC  (one board per link)
```

Two ways to run the same `www/` UI:

| Host | How you start it | Typical URL |
| --- | --- | --- |
| PC / Pi | `python -m server.host` from the repo | http://127.0.0.1:8080/ |
| Pico W / ESP32 | MicroPython `main.py` after `tools/pack_board.py` | http://192.168.4.1/ (SoftAP) or `http://slider/` on your LAN |

The browser does **not** open the serial port. It sends JSON on `/ws`:

| Client → host | Meaning |
| --- | --- |
| `{"mc_id":2,"mc":"SS 40"}` | Forward one SliderMC line to that slot. Missing `mc_id` means slot 1 (phone and older clients). |
| `{"mc":"SS 100","silent":true}` | Forward, but do **not** rewrite the session sliders (temporary max for a seek). |
| `{"mc":"MS","all":true}` | Halt every linked slot. Desktop Stop sends this while **Link** is on. |
| `{"wdt":"alive"}` | Watchdog pet, about once a second. Missed for ~2.5 s → host sends `MS` to **every linked** slot, unless a **server task** (timelapse) is running. |
| `{"task":"TSK_TL_CONT …"}` / `TSK_TL_PATH_*` | Start a Pico/host-owned task. With **Link** on, the task carries `mc_ids` for every linked slot. Phone sleep does not abort it. |
| `{"path":{"cmd":"begin\|data\|go","mc_id":2}}` | Motion Path chunks for one slot (`PC` / `PS` / `PD`, then `PG` unless `go` is held). |
| `{"path":{"cmd":"go","sync":true,"mc_id":2}}` | Arm that slot and hold `PG`. |
| `{"path":{"cmd":"release","mc_ids":[1,2]}}` | Write `PG` to every armed slot in one tight loop, or to none if any of them failed to arm. |

Hello and status include `mcs[]` (id, name, port, linked, sim, lost, axes, session), plus `mc_limit` and `host` (`desktop` or `pico`). Axes inside a slot stay numbered 1–6. `mc_id` on an axis is the pool id. The panels still show the **selected** slot only.

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
- **MC** buttons and **+** (right side, before MC Config) — one selected controller; see [Read this first](#read-this-first)
- **MC Config** — firmware keys for the selected controller
- **Config** — project and rig dialog
- **Stop**

Switching the selected MC swaps its curves, axis rows, A/B marks, session SPEED / ACCEL / ENABLE, soft window, and lane show/lock. The playhead does not move. Shared across controllers: playhead, duration, frame rate, timeline markers, Follow / Handles, panel layout, the **Link** switch, and the Timelapse and Stop Motion dialog fields.

Default split (`layout_rev` 12): Timeline fills the workspace; Control is pinned along the bottom. Drag the **grey separator** to resize Timeline vs the rest of the window if you hide Control. Toggles **hide** a panel; they are not Config checkboxes.

Timeline, Keyboard, and Control exist only here.

### Phone (narrow)

The top bar and the splitter workspace are hidden. Tabs:

**Home · Move · Joy · Window · AB · Timelapse · CLI · Help · Config**

No Timeline editor. No Keyboard switch. No MC row and no Link switch — marks, timelapse, and jog still work, on slot 1. Full chapter: [Phone UI](phone-manual.md).

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
| **Project** | Host `data/projects/<name>.json` (Timeline / Control **Load**, **Save**, **Save as**) and a browser crash copy (`sh_project`) | Link, shared timeline, timelapse and stop-motion fields, and every MC (port or UART, curves, marks, session, axis show/lock) |
| **Selected MC** | Host `data/mc/<name>.json` (**Load selected**, **Save selected as**) | One controller: name, curves, marks, session, axis show/lock. No port, no Link, no other MCs, no shared timeline |
| **Rig** | Browser `localStorage` (`sh_rig`) + JSON download | Axis names, units, travel, `mc_id` / slot |
| **Connections** | `data/last_serial.json` | Port or UART list restored at host start |
| **Timeline JSON** | Timeline menu **Export Timeline** | Curves of the open editor (also inside the project) |
| **wifi.json** | On the Pico / ESP32 | STA SSID / password / hostname. There is **no** Wi-Fi form in the current GUI (`POST /api/wifi` only) |
| **SliderPins.py** | Device root | UART, LED, camera GPIO, bloop GPIO overlay |

**Load** / **Save** / **Save as** on the Timeline and Control menus write the whole project on the host. **Load selected** / **Save selected as** write one controller. The browser `sh_project` copy is only so a refresh does not depend on having pressed Save. Config → **Save project** is still a downloaded JSON of the open shot, not that host file.

A selected-MC file does not store the COM port. Loading it replaces curves and that controller’s settings on the slot that is selected now; the live link stays. Keys keep their saved times inside the current project duration.

Saving a project does not save the rig. A/B poses for each controller are inside the project and the selected-MC file. Saving a rig does not save keys.

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
| [Firmware pairing](firmware-pairing-manual.md) | SliderMC contract, 8 / 2 controller limits |
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
