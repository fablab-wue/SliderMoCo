# Wi-Fi (portal and operator)

This is items **8** and **15** from the old “further chapters” list: how the board gets on a network, and how you operate it. The PC host uses `DummyWifi` (`127.0.0.1`, mode `host`) and has no radio.

There is **no Wi-Fi form** in the current `index.html`. Status can fill a `#wifiHint` element if you add one.

---

## SoftAP (first connect)

On boot, if STA is not configured or fails, the board raises an access point.

| | Default |
| --- | --- |
| SSID | `SMoCo-` + last two bytes of MCU unique id (hex) |
| Password | `sliderweb` (`AP_OPEN` is false) |
| AP IP | `192.168.4.1` |
| HTTP | port **80** |
| Channel | 6 |
| Country | `DE` (`WIFI_COUNTRY`) |

Join the AP, open http://192.168.4.1/

Captive probes (`generate_204`, `hotspot-detect.html`, `captive.apple.com`, …) **redirect** to that portal IP. That is why a phone may show a “sign in” sheet — it is the SliderMoCo page, not a login form.

---

## iPhone / Android quirks

- Some iPhones drop an AP that has no “real” internet. If the page dies, set a **manual IPv4** on `192.168.4.x` / mask `255.255.255.0` / router `192.168.4.1`, or keep the “captive” sheet open.
- Android captive checks should redirect. If not, type the IP.
- Stay on 2.4 GHz. Pico W / typical ESP32 have no 5 GHz.

---

## STA (your LAN)

Persist `wifi.json` on the device:

```json
{"ssid":"YourNet","password":"secret","hostname":"slider"}
```

Or HTTP (from a machine that can already reach the board):

```text
POST /api/wifi
Content-Type: application/json

{"ssid":"YourNet","password":"secret","hostname":"slider"}
```

`GET /api/wifi` returns public status (mode, ip, ap_ssid, hostname, whether a password is stored — not the password).

`{"forget":true}` on POST clears STA and returns to AP (`wifi.forget()`).

STA connect budget is **12 s** (`STA_CONNECT_S`), then AP fallback. Short radio drops use `STA_GRACE_MS` (10 s) so the LED does not flap.

After STA is up, try `http://slider/` (hostname, default `slider`) if the router or mDNS plays along. Otherwise use the DHCP address from `GET /api/wifi`.

Changing hostname requires a save + reconnect. `apply_saved` is the **one** intentional radio change from the API.

---

## LED (board)

RGB encodes AP / STA wait / STA / grace (`led_status.py`). Use it when you cannot open a browser.

---

## Security

Default AP password is in the repo. Change `AP_PASSWORD` in `SliderPins.py` for anything that leaves the bench. `/api/wifi` is unauthenticated on the LAN.

---

## Related

- [Builder](builder-manual.md)
- [Troubleshooting](troubleshooting-manual.md)
- [On-device files](on-device-files-manual.md)
