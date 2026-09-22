# Maker / builder manual

How to get SliderMoCo talking to motors. Operator UI is in the [user manual](user-manual.md).

You are building one of two boxes:

1. **PC or Raspberry Pi Zero** — CPython serves `www/` and opens a USB serial port to SliderMC (or a mock).
2. **Pico W / Pico 2 W / ESP32** — MicroPython on the board serves the same UI over Wi-Fi and opens UART to SliderMC.

Both speak the same UART text protocol at **115200 8N1**. Only **one** SliderMC is supported.

---

## What you need

| Item | PC host | Board host |
| --- | --- | --- |
| This repo | Yes | Yes (to pack files) |
| CPython 3 | Yes | On the build PC only |
| `pyserial` | For the COM dialog or `--port` | No |
| SliderMC + motors + PSU | For real motion | For real motion |
| USB cable to SliderMC | Yes (`COMx` / `/dev/tty…`) | Optional (debug) |
| Pico W / Pico 2 W or ESP32 + USB | No | Yes |
| MicroPython on that MCU | No | Yes |
| `mpremote` or Thonny | No | Yes |
| UART 3-wire (TX, RX, GND) | USB-serial already has this | You wire it |
| 2.4 GHz Wi-Fi phone/PC | Optional | Yes |

Optional Python extra (repo root):

```text
pip install -r requirements-host.txt
```

That file is only `pyserial`. The mock host runs with the stdlib.

---

## Safety on first power

- ENABLE off or Stop held until you see live positions that match the rail.
- Confirm **soft window** and **physical min/max** before Play or LOOP.
- Common ground between MCU / USB-UART and SliderMC. Do not float RX.
- SliderMC UART is **3.3 V**. Do not drive it from a 5 V USB-TTL adapter without a shifter.
- Crossed wires: **host TX → SliderMC RX**, **host RX ← SliderMC TX**.
- Shared PSU: the board waits **300 ms** after boot before it looks for the SliderMC banner (`SW_MC_POWER_DELAY_MS`).
- Camera trigger GPIO is **open-collector, active-low** (idle = pull-up; pulse = sink). Leave `PIN_CAMERA_CTRL` unused until the shutter cable is meant to fire.
- Bloop GPIO (`PIN_BLOOP`, GP14) is **push-pull**: idle LOW, HIGH for 100 ms when a timeline marker with Bloop fires.

---

## Path A — PC / Pi host (fastest bring-up)

From the **repo root** (the folder that contains `server/` and `www/`):

### Mock (no hardware)

```text
python -m server.host
```

Open http://127.0.0.1:8080/

`MockMC` pretends **3** packed axes by default (clamped 1–6). Count splits as **motors = min(3, N)** and **servos = N − motors** (so `--axes 6` is 3 motors + 3 servos). Useful for UI and Timeline without a cart:

```text
python -m server.host --axes 1
python -m server.host --axes 6
```

Verbose mock status is one `#` line with `|` groups, same shape as SliderMC (`#I 0.00 0.00 0.00 | …`). Trailing idle groups may be omitted on a real MC; the mock emits every live channel.

### Real SliderMC on USB

```text
python -m server.host
```

On a wide window the topbar **port** button (next to SliderMoCo) opens a dialog: pick a listed COM / tty, type one, or **Mock**. Omit `--port` and that dialog is the way in — the process does not start mock by itself. **Cancel** or **Mock** binds mock so the UI still runs.

`--port COM5` still links at process start (scripts / CI). You can switch sliders later from the same dialog without restarting the host. Last successful port is remembered in `data/last_serial.json` as a prefill only.

Linux / macOS: `--port /dev/ttyUSB0` or `/dev/ttyACM0`.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--port` | *(empty)* | Serial device. Omit = pick in the desktop COM dialog (mock if you cancel). |
| `--baud` | `115200` | Must match SliderMC. |
| `--http-port` | `8080` | Browser port. Port 80 in config is forced to 8080 on this host. |
| `--banner` | `5` | Seconds to wait for `# MC V1 -` plus `VP:1`. Timeout → **UNLINKED** (no silent mock). |
| `--settle-ms` | `300` | Delay after open before banner (USB CDC). |
| `--dtr` | off | Assert DTR (can reset a Pico). |
| `--mock-on-fail` | off | Use MockMC if identity fails. |
| `--axes` | `3` | Mock packed axis count only (clamped 1–6; 3 motors + remaining servos). Ignored when serial links. |

If `pyserial` is missing, the COM dialog cannot open a port (`pip install pyserial`). `--port` at process start still exits if pyserial is missing.

The host can store JSON under `data/rigs/` and `data/projects/` (`/api/rigs`, `/api/projects`). The current browser UI **does not call those endpoints** — Config Save/Load is `localStorage` plus a downloaded file.

Tests (no motors):

```text
python tests/test_timeline.py
```

### USB checklist

1. SliderMC powered and showing its usual boot banner on a serial terminal at 115200.
2. Close that terminal — only one program owns the port.
3. Start the host (`--port` or the COM dialog).
4. Browser Info rows should populate; OLED should not stay empty if the MC sends lines.
5. ENABLE on, small MOVE, confirm direction. Use **SWAP DIR** on the phone Home tab if the rail is backwards (desktop swap is the same SWUi flags once you use phone or a future control).

If the banner never arrives, you are in mock and the cart will not move. Fix wiring/port, restart the host.

---

## Path B — Pico W / Pico 2 W

### 1. Flash MicroPython

Use the official Pico W or Pico 2 W UF2. Confirm the REPL in Thonny or `mpremote`.

### 2. Pack the device tree

On the PC, from the repo root:

```text
python tools/pack_board.py
```

That wipes and fills `dist/pico/` with:

- everything in `board/` **except** `board/www/`
- a fresh copy of repo `www/`
- `server/core/timeline.py` and `server/core/mock_mc.py`

Copy that tree onto the **device root** `/` (not into a subfolder):

```text
mpremote fs cp -r dist/pico/: /
```

Thonny: upload the *contents* of `dist/pico/` to `/`.

`boot.py` then waits **2 s** (`SW_BOOT_DELAY_S`) so you can Stop / Ctrl-C into a raw REPL before `main.py` takes the WLAN stack.

### 3. Pins (Pico)

Copy on the device:

```text
board/SliderPins.example.py  →  /SliderPins.py
```

Defaults match a JKSlider Pico:

| Role | GPIO | Wire |
| --- | --- | --- |
| UART0 TX | **16** | → SliderMC RX |
| UART0 RX | **17** | ← SliderMC TX |
| GND | — | Common with SliderMC |
| LED R / G / B | 2 / 3 / 4 | Status (active-high, common-cathode) |
| Camera pulse | **15** | Optional shutter (OC active-low; Exposure time) |
| Bloop pulse | **14** | Timeline marker pulse (push-pull; idle LOW, HIGH 100 ms) |

UART baud **115200**. `UART_ID` 0.

Edit `SliderPins.py` if your PCB differs. Missing keys keep `SW_config` / `MC_config` defaults.

### 4. Simulation vs UART

`SW_MC_SIM = True` (example file and `SW_config.py`): if the SliderMC banner is missing for `SW_MC_BANNER_S` (5 s), the board starts **MockMC**. The UI still works. Motors do not.

Set `SW_MC_SIM = False` on a field machine when you want a failed UART link to stay failed (no fake axes). Leave it `True` on the bench.

### 5. Wi-Fi first connect

On boot the board raises a SoftAP:

| | |
| --- | --- |
| SSID | `SMoCo-` plus the last two bytes of the MCU unique id (hex) |
| Password | `sliderweb` |
| AP IP | `192.168.4.1` |
| HTTP | port **80** |
| Hostname (STA later) | `slider` |

Join the AP, open http://192.168.4.1/

There is **no Wi-Fi form** in the current GUI. STA credentials are written with `POST /api/wifi` (JSON `ssid`, `password`, optional `hostname`) or by placing `wifi.json` on the device. After a successful STA join, try `http://slider/` if mDNS / your router allows it. SoftAP SSID also appears in status if a `#wifiHint` element is present (it is not in `index.html` today).

Country default in `SW_config.py` is `DE`, AP channel 6. Change those if your regulator or 2.4 GHz crowding requires it.

### 6. After UI changes on the PC

The board does **not** live-reload from `www/` on disk. Pack and copy again:

```text
python tools/pack_board.py
mpremote fs cp -r dist/pico/www/: /www/
```

(or copy the whole `dist/pico/` tree). The repo also keeps `board/www/` as a flash snapshot; `pack_board.py` **ignores** that folder and always ships repo `www/`.

---

## Path C — ESP32

Same MicroPython app (`main.py`, `web_app.py`, `panel_app.py`). Different pins.

Copy:

```text
server/board/esp32/SliderPins.example.py  →  device /SliderPins.py
```

| Role | ESP32 example |
| --- | --- |
| UART | UART **2**, TX **17** → MC RX, RX **16** ← MC TX, 115200 |
| LED R / G / B | 25 / 26 / 27 |
| Camera | GPIO **4** |
| AP prefix | `SMoCo` (same password `sliderweb`) |
| HTTP | 80 |

Pack and upload the same `dist/pico/` tree (name is historical). Then overlay `SliderPins.py`.

Confirm your module’s UART2 pins are free (some boards remap 16/17). `LED_ACTIVE_HIGH` must match your LED wiring.

---

## UART and SliderMC

The host (`MC_client`) waits for SliderMC’s boot **banner**, then counts axes and limits. No banner → mock (if sim is allowed) or an unlink.

Typical failures:

| Symptom | Likely cause |
| --- | --- |
| Mock axes, cart dead | Wrong COM port; RX/TX not crossed; GND missing; baud; banner timeout too short |
| Garbled banner | 5 V UART into 3.3 V RX; bad baud |
| Link then immediate Stop | Browser tab in background long enough to miss `wdt` (~2.5 s) and no timelapse task |
| Empty page / old UI | Stale `www/` on the Pico; pack again |
| REPL stolen | `boot.py` already finished; power-cycle and Stop in the 2 s window |

USB CDC echo (`SW_MC_USB_ECHO`): the Pico prints `MC> …` for forwarded lines. Useful with Thonny.

---

## Camera trigger (board only)

Timelapse tasks pulse `PIN_CAMERA_CTRL` **low** (open-collector) for **Exposure time** and send `CT` with the same duration in milliseconds. The **PC host has no GPIO** — `CT` still reaches SliderMC when the host is on UART.

Wire: GPIO → opto / remote shutter that expects a closed contact (active-low), same as SliderMC. Exposure **time** in the Timelapse dialog **is** the pulse width.

See [Timelapse](timelapse-panel-manual.md).

---

## Watchdog

The browser sends `{"wdt":"alive"}` every **1 s**. On the board, `SW_WDT_TIMEOUT_MS` is **2500**. If pets stop and no `TSK_*` is running, the host sends **`MS`**.

That is why Timelapse is a **server task** and Timeline Play is not: you can lock the phone after ⏲ starts; you should not lock the phone during a Timeline path.

---

## Repo map (builder)

```text
www/                   UI (edit here; pack copies it onto the device)
server/host/           python -m server.host
server/core/           timeline.py, mock_mc.py (CPython + packed onto board)
server/board/esp32/    ESP32 SliderPins example
board/                 Pico/ESP32 runtime (main.py, web, UART, tasks, Wi-Fi)
tools/pack_board.py    flatten → dist/pico/
data/                  PC host saved JSON
protocol/              example JSON frames
docs/                  this manual set
```

---

## Done when

- Browser opens, **Link lost** stays hidden.
- Info shows the axis count you expect.
- ENABLE on, MOVE jogs the real rail the correct way.
- Stop kills motion at once.
- (Board) SoftAP or STA URL reloads after a power cycle.
- (Timelapse) Camera GPIO only if you need it; otherwise leave the pin unused.

Then go to the [user manual](user-manual.md) and the panel chapters.
