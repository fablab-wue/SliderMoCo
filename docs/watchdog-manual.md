# Watchdog and phone sleep

The host will **stop the motors** if it thinks the operator’s browser went away — unless a **server task** (timelapse) is running.

That is why ⏲ survives a locked phone and Timeline Play does not.

---

## Pets

The browser sends `{"wdt":"alive"}` every **1 s** (`WDT_MS`). The host answers `{"t":"pong"}` (optional).

The host arms the watchdog on the **first** pet after connect. Until then, closing the tab will not `MS` from WDT (you may still have left the MC moving — hit Stop).

Timeout: **2500 ms** (`SW_WDT_TIMEOUT_MS`, floor 500). Then one `MS` and the trip latches until a new pet arrives.

---

## What is exempt

`task_runner` active (`TSK_TL_CONT`, `TSK_TL_MSM`, `TSK_TL_STEP`, `TSK_TL_PATH_CONT`, `TSK_TL_PATH_MSM`, `TSK_PPM`) → WDT does **not** send `MS`. The Pico/PC owns the loop.

Any client line that starts with **`M`** cancels that task. Then the WDT applies again.

Timeline Play is a **path** (`PC` / `PD` / `PG`) from the browser, not a task. If you sleep the laptop, pets stop, WDT sends `MS`, the path dies.

---

## Phone and laptop

| You do | Jog / Play / LOOP | Timelapse task |
| --- | --- | --- |
| Lock the phone after ~2.5 s | `MS` | Continues |
| Switch apps / lose Wi-Fi | `MS` (pets stop) | Continues if the **host** stays up |
| Close the last tab | Pets stop → `MS` unless a task is running | Continues |
| **Link lost…** on screen | Socket down; reconnects; hello refresh | Task may still be running on the host |

Two open tabs: **one** `last_client_ms` on the host. Either tab’s pet keeps the WDT happy. See [Two browsers](two-browsers-manual.md).

---

## PC host

Same WDT code (`panel_app.py`). Closing the only browser on `127.0.0.1` will `MS` a real MC after 2.5 s if no task is running.

---

## Related

- [Timelapse](timelapse-panel-manual.md)
- [Safety](safety-manual.md)
- [Two browsers](two-browsers-manual.md)
