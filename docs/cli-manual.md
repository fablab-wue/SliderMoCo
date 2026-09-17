# CLI and raw MC lines

The phone **CLI** tab sends raw SliderMC ASCII through the same bridge as the buttons: `{"mc":"<line>"}`.

There is no CLI on the desktop layout. Use a serial terminal on the MC, or narrow the window.

This is not a shell. There is no undo.

---

## The pad

Five text fields, each with **SEND**. Enter in a field also sends (phone SWUi). The five strings persist as `sw_cli_cmds` in that browser.

A SPEED slider and **⏹** sit above the fields. Stop is the same hold map as everywhere else.

The bridge rejects non-printable ASCII and lines longer than **120** characters.

Any line that **starts with `M`** (`MS`, `MT`, `ML`, `MH`, …) **cancels a running server task** (timelapse).

---

## Lines the GUI already uses

Prefer the panels when you can. These are the ones you will type when debugging:

| Line | Typical use |
| --- | --- |
| `MS` | Stop |
| `H` | Halt |
| `SE 0` / `SE 1` | Disable / enable |
| `SS 20` / `SA 100` | Session (mirrored — sliders follow) |
| `MT 100` / `MT 100 45` | Go to pose |
| `ML` / `MR` / `MJ 0 50` | Jog (send `MS` yourself) |
| `SL 10` / `SR 500` / `SL none` | Soft window |
| `MH` | Home |
| `CG` | Dump MC config (host also does this at link) |
| `GL` / `GR` | Read soft limits |

Full command list: [SliderDoc protocol](https://github.com/fablab-wue/SliderDoc/blob/main/contract/protocol.md) (SliderMC UART contract). SliderMoCo does not version the WebSocket JSON.

---

## What is unsafe to type casually

- `SE 0` on a moving cart (or while someone is near the rail)
- `MT` past your mental soft window
- `SL` / `SR` that shrink the window onto the live pose (MOVE will grey)
- Path verbs `PC` / `PS` / `PD` / `PG` — Timeline owns those; a half path bricks motion until `MS`
- Anything you copied from an old firmware note without checking the contract

Do not paste binary, Unicode, or comments. One command per SEND.

---

## Silent

The CLI does **not** set `silent`. Every `SS` / `SA` / `SE` updates the host session cache and the sliders on the next status.

---

## Related

- [Phone](phone-manual.md#cli)
- [Session](session-manual.md)
- [Firmware pairing](firmware-pairing-manual.md)
