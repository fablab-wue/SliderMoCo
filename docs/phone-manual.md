# Phone UI

Under **800 px** width, SliderMoCo hides the desktop top bar and the splitter workspace. You get **tabs** and a **telemetry footer**.

There is **no Timeline** editor and **no Keyboard** control. Marks, timelapse, jog, and Config still work.

Desktop panel chapters still apply where the same pad is reused (AB, Timelapse, Joy sticks). This chapter is what exists only on the phone chrome.

---

## Tabs

| Tab | Title | What it is |
| --- | --- | --- |
| ⌂⎆ | **Home** | ENABLE, SWAP DIR, HOME, ACCEL + SPEED, INFO |
| ▶ | **Move** | Digital jog, OPTION, axis chips, SPEED |
| ⎈⌖ | **Joy** | Analog sticks + log + SPEED — see [Joystick](joystick-panel-manual.md) |
| ⍈ | **Window** | Set / reset soft limits from live pose |
| AB | **Marks** | Full [A/B](ab-panel-manual.md) pad |
| ⏲ | **Timelapse** | Full [Timelapse](timelapse-panel-manual.md) pad |
| >_ | **CLI** | Five raw MC lines |
| 🕮 | **Help** | Short on-device tips — [Help tab](help-tab-manual.md) |
| ⚙ | **Config** | Opens the same [Config](config-manual.md) dialog |

Default tab on load is **Move**.

The footer (Pos / Spd / Acc / state, optional axis 2, OLED) stays on every tab. That is the live [Info](info-panel-manual.md). Home’s INFO box is the machine card, not a second telemetry table.

---

## Home

| Control | Line / effect |
| --- | --- |
| INFO box | **Static** rig summary from hello: name, slider min–max, max speed, max accel. Live pose is the **footer** |
| **ENABLE** | `SE 1` / `SE 0`. Off = no motion. Greyed out while the host reports driver error (`state` **E** or `warn`) |
| **SWAP DIR** | Flip axis 1 jog and LIMIT sense. Saved in the browser (`sw_swap_dir`) |
| **SWAP DIR 2nd** | Same for axis 2 (`sw_swap_dir2`). Hidden unless two axes |
| **HOME** | `MH` |
| ⏹ | Stop / hold Halt / hold Disable — see [Buttons](buttons-panel-manual.md#stop) |
| ACCEL slider | Session `SA` |
| SPEED slider | Session `SS` (gamma) |

SWAP DIR is how you fix a rail that jogs the wrong way without rewiring. It also swaps which LIMIT / Window button is min vs max.

---

## Move

Phone Move is the cruise pad from SliderWeb / SliderCtrl, not the desktop six-button LIMIT row.

| Control | Role |
| --- | --- |
| ETA L / R | Seconds to the current soft window end at session SPEED |
| ◀ / ▶ | Jog. **Tap** (~≤⅓ s): cruise stays on. **Hold** longer: runs while held, stops on release. Tap the same direction again to cancel cruise |
| ◀◀ / ▶▶ | FAST: same, but `SS` goes to max while held; cruise `SS` restored on release |
| **OPTION** | While held, a locked cruise uses **max** speed |
| Axis chips **1** / **2** / **both** | Which slots `ML` / `MJ` use (two-axis machines). Hidden for one axis |
| Extra yellow ◀ / ▶ | Axis-2-only jogs when two axes exist |
| SPEED | Session `SS` |
| ⏹ | Stop |

Desktop Buttons also have LIMIT ⍇ / ⍈ with 3 s / 5 s holds. On the phone those holds are the **Window** tab.

---

## Window

Soft travel window (`SL` / `SR`), same store as desktop LIMIT.

| Button | Result |
| --- | --- |
| ⍇ **SET_W_L** | Soft min (after SWAP DIR) = **live** pose, axis 1 |
| ⍈ **SET_W_R** | Soft max = live pose, axis 1 |
| Yellow pair | Same for axis 2 |
| ⍁ **RESET_W_L** / **RESET_W_R** | Clear that side for **both** axes |

The note on the pad: “set actual position as window.” Jog to the end you want, then tap SET.

ETA above the pad is time to the window, same idea as Move.

To **go** to a soft end on the phone, use Move cruise toward that side, or set a mark on AB and ▶ there. There is no tap-to-`MT` LIMIT button on the phone.

---

## CLI

Five text fields, each with **SEND**. The line is forwarded as `{"mc":"…"}` (SliderMC ASCII). The five strings persist in the browser (`sw_cli_cmds`).

There is a Stop button and a SPEED slider. Nothing here is validated. A typo can `SE 0`, clear limits, or run `MT` off your mental map.

Use this when you are following a SliderMC command list, not for daily jog.

Bindings do not treat these boxes as “desktop Keyboard” (Keyboard is off on phone anyway). You can type normally.

---

## Help

On-device copy is the short list in [Help tab](help-tab-manual.md). The full book starts at [user-manual.md](user-manual.md).

---

## Config tab

**Project & rig** opens the desktop Config dialog. Phone layout does not have panel-visibility checkboxes.

---

## What you lose vs desktop

- Timeline graph, Play, import/export, Change time
- Keyboard arrows / numpad / Ctrl+marks
- LIMIT 3 s set / 5 s reset on the jog row (use Window + AB instead)
- Side-by-side Info aligned with jog rows (footer instead)

What you keep: ENABLE, session SPEED/ACCEL, marks, LOOP, timelapse **tasks**, soft window, CLI.

---

## Related

- [Buttons](buttons-panel-manual.md) — desktop LIMIT gestures and FAST restore.
- [Builder](builder-manual.md) — join `SMoCo-xxxx` / `sliderweb`, open http://192.168.4.1/ .
