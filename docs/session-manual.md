# Session model (`SS` / `SA` / `SE`)

Session is the **commanded cruise** the host remembers and the sliders show. Live **Spd** / **Acc** on the [Control](ctrl-panel-manual.md) axis rows are what the motors report now.

---

## The three lines

| Line | Meaning | Host cache | UI |
| --- | --- | --- | --- |
| `SS <speed>` | Cruise speed (axis-1 unit / s for most jogs) | `session.ss` | SPEED slider + clickable number |
| `SA <accel> [<decel>]` | Cruise accel / decel | `session.sa` / `session.decel` | ACCEL sliders + clickable `a / d` |
| `SE 0\|1` | Enable / disable | `session.enabled` | ENABLE switch |

The host updates that cache when it relays a line **unless** the browser sent `{"mc":"…","silent":true}`. Silent still goes out on UART.

Reconnect hello re-queries `GE` / `GS` / `GA` from the MC when linked. `GA` replies with two fields (`accel decel`).

Max line length the bridge accepts: **120** ASCII characters (`SW_MC_LINE_MAX`).

---

## Sliders

SPEED is **gamma 2**: `ss = min + (max−min) × t²` with `t` the 0–1 slider. More resolution at the slow end. ACCEL and DECEL are linear between `accMin` and `accMax`. Desktop Control sends `SA <accel> <decel>`. **sym** (default on) keeps both equal. One-arg `SA <a>` still sets both on the MC.

Drag is throttled (~80 ms) for `SS`. The number is commanded cruise, not live Spd. On desktop Control, click the SPEED or ACCEL ochre numbers to type `SS` / `SA` (same clamp as the sliders). **sym** on writes both accel and decel.

Phone SPEED sliders (Home, Move, Joy, CLI) and desktop Control SPEED share the same session.

---

## Silent vs mirrored

| Path | `silent` | Session sliders |
| --- | --- | --- |
| SPEED / ACCEL drag | No | Follow the command |
| Control FAST down | No (`SS` max) | May jump to max while held; release sends cruise `SS` again |
| Keyboard Shift+arrow FAST | Yes for the temporary `SS` | Sliders stay on cruise; restore on key up |
| Timeline seek / preroll (`seekAtMax`) | Yes | Restored when idle |
| A/B **▶▶**, LOOP, PING-PONG | No | **Left at max** |

If SPEED suddenly shows the axis maximum after ▶▶ or LOOP, that is intended. Drag SPEED or use the numpad.

---

## Who leaves you at max

| Action | After |
| --- | --- |
| Hold FAST (Control / phone Move), release | Cruise restored |
| Keyboard FAST, key up | Cruise restored (silent) |
| Timeline \|◀◀ / ▶▶\| / preroll seek | Cruise restored (silent) — see [Timeline errata](timeline-errata.md) |
| A/B ▶▶ / LOOP / PING-PONG | **Max stays** |
| Timelapse task | Uses `SS / FACTOR` on the **server**; sliders stay at your cruise |

---

## ENABLE vs SPEED

`SE 0` does not zero `SS`. You can still “set speed” on a disabled machine. Turn ENABLE on when you mean to move.

Driver **E** / `warn` locks the ENABLE switch. See [Safety](safety-manual.md).

---

## Related

- [Keyboard](keyboard-control-manual.md) — numpad % and √√2.
- [A/B](ab-panel-manual.md) — SET speed from time writes session `SS`.
- [Two browsers](two-browsers-manual.md) — last `SS` wins.
