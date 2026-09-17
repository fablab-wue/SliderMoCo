# ESP32 board overlay for SliderMoCo

Same MicroPython firmware as Pico W (`board/main.py`, Microdot, `panel_app`). Copy `board/` + `www/` to the ESP32, then this file to **`SliderPins.py`** on the device root.

Typical ESP32 UART2 (avoid UART0 USB console):

```python
# SliderPins.py — ESP32

MC_config = {
    "UART_ID": 2,
    "PIN_UART_TX": 17,
    "PIN_UART_RX": 16,
    "UART_BAUD": 115_200,
}

SW_config = {
    "PIN_LED_R": 25,
    "PIN_LED_G": 26,
    "PIN_LED_B": 27,
    "PIN_NEOPIXEL": None,
    "PIN_CAMERA_CTRL": 4,
    "CAMERA_PULSE_MS": 100,
    "LED_ACTIVE_HIGH": True,
    "AP_SSID_PREFIX": "SMoCo",
    "AP_PASSWORD": "sliderweb",
    "HOSTNAME": "slider",
    "HTTP_PORT": 80,
    "SW_MC_SIM": True,
    "DEBUG_LEVEL": 3,
}
```

Wi-Fi uses `network.WLAN` (STA + SoftAP) already in `wifi_portal.py`. If RGB PWM pins differ on your module, edit only `SliderPins.py`.
