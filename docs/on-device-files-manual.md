# On-device `www` editor

The board HTTP API can **read and overwrite** files under `www/` on the Pico/ESP32. There is no editor in the GUI. A bad PUT can leave you with a blank page until you re-upload from a PC.

The PC host serves repo `www/` from disk; this API is aimed at the **flash** tree. `FILE_MAX_BYTES` default **49152**.

---

## List and read

```text
GET /api/files
```

Returns `{"files":["www/index.html", …]}`.

```text
GET /api/files?path=www/js/app.js
```

Returns `{"path":"www/js/app.js","text":"…"}`. Paths are forced under **`www/`**. `..` is rejected. A path without the prefix is prefixed (`app.js` → `www/app.js`).

---

## Write

```text
PUT /api/files
Content-Type: application/json

{"path":"www/index.html","text":"<!DOCTYPE html>…"}
```

Success: `{"ok":true,"path":"www/index.html"}`. Failures: 400 bad path, 413 too large, 500 write fail.

The running Microdot process will serve the new bytes on the **next** GET (`max_age=0`). You do not need a reboot for HTML/JS/CSS. You **cannot** fix a totally broken `index.html` from the same page — keep `mpremote` / Thonny ready.

---

## What you should not do

- PUT `main.py`, `SliderPins.py`, or anything outside `www/` (the API will not let you).
- Edit `app.js` over a flaky AP without a backup of `dist/pico/www`.
- Treat this as version control. Prefer `pack_board.py` + `mpremote fs cp`.

---

## Related

- [Builder](builder-manual.md)
- [Troubleshooting](troubleshooting-manual.md)
- [Wi-Fi](wifi-manual.md)
