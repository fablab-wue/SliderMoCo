# Firmware pairing

SliderMoCo is a **thin bridge**. It expects SliderMC’s UART text contract. There is **no version field** on `/ws` JSON.

Canonical command list: [SliderDoc protocol](https://github.com/fablab-wue/SliderDoc/blob/main/contract/protocol.md).

`MC_client.py` is copied from SliderCtrl’s client (Pico UART0 GP16/17 @ 115200). Pin maps match JKSlider / SliderCtrl heritage. If you flash a random “stepper box,” the banner and `CG:key=value` dump will not parse.

---

## What this host needs from SliderMC

At link:

1. Welcome line starting with `# MC V1 -` (remainder may be a name)
2. `VP:1` (host requires this before any session lines)
3. `SV 1` (host sends)
4. `CG` dump including travel (`slider_min_1` / `slider_max_1`), speeds (`max_speed_1`), `axis`
5. `GL` / `GR` soft window
6. Status letters matching `McState`: **D I A M B H L E** (and path **P**)

In motion: `SS` `SA` `SE`, `ML`/`MR`/`MJ`, `MT`, `MS`, `H`, `MH`, `SL`/`SR`, Motion Path `PC` `PS` `PD` `PG`, beep `Z`.

If your firmware uses another banner or binary frames, do not expect this GUI to recover. Use mock for UI work only.

---

## Several MCs

Each linked board is its own slot: its own `MC_Client`, RX task, hello, and status. Axes inside a slot stay 1–6. `mc_id` on a command is the pool id. A missing `mc_id` still hits slot 1.

| Host | Links |
| --- | --- |
| PC / Pi | Up to 8 USB serial ports |
| Pico | UART0 (GP16/GP17) and UART1 (GP8/GP9 unless `SliderPins.py` overrides). GP4 is the blue LED |
| Phone layout | Slot 1 only. No MC row, no Link switch, no Timeline |

The desktop **Link** switch starts a path on every linked slot together (`PG` in one tight loop after each slot is armed). Jog, ENABLE, and A/B stay on the selected slot.

---

## Sibling repos

| Repo | Role |
| --- | --- |
| [SliderMC](https://github.com/fablab-wue/SliderMC) | Motors, path buffer, UART |
| [SliderCtrl](https://github.com/fablab-wue/SliderCtrl) | Physical keypad; same motion language |
| [SliderDoc](https://github.com/fablab-wue/SliderDoc) | Contract |
| This tree (SliderMoCo) | Browser + Pico/PC bridge |

Flash SliderMC first, confirm a banner in a serial terminal, then start SliderMoCo.

---

## Related

- [CLI](cli-manual.md)
- [Rig vs MC](rig-vs-mc-manual.md)
- [Builder](builder-manual.md)
