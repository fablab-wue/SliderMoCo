# SliderPins.example.py — ESP32 overlay (copy to device SliderPins.py).

MC_config = {
    "UART_ID": 2,
    "PIN_UART_TX": 17,  # UART2 TX → SliderMC RX
    "PIN_UART_RX": 16,  # UART2 RX ← SliderMC TX
    "UART_BAUD": 115_200,
}

SW_config = {
    "PIN_LED_R": 25,
    "PIN_LED_G": 26,
    "PIN_LED_B": 27,
    "PIN_NEOPIXEL": None,
    "PIN_CAMERA_CTRL": 4,
    "CAMERA_PULSE_MS": 100,
    "PIN_BLOOP": 5,
    "BLOOP_PULSE_MS": 100,
    "LED_ACTIVE_HIGH": True,
    "AP_SSID_PREFIX": "SMoCo",
    "AP_PASSWORD": "sliderweb",
    "HOSTNAME": "slider",
    "HTTP_PORT": 80,
    "SW_MC_SIM": True,
    "DEBUG_LEVEL": 3,
    "SW_MC_POWER_DELAY_MS": 300,
    "SW_MC_BANNER_S": 5.0,
}
