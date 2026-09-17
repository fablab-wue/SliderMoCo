# Two browsers

One host, many WebSockets (`web.clients`). Status (~12 Hz) is **broadcast**. Commands are **not** locked to a tab.

This is unsupported as a two-operator console. It will not crash; it will surprise you.

---

## What is shared (the MC)

| Thing | Effect |
| --- | --- |
| `SS` / `SA` / `SE` | Last line wins. The other tab’s sliders catch up on the next mirrored status (unless a silent seek is in progress) |
| ENABLE | Two switches. Either can disable the other mid-move |
| Jog / `MT` / path | Interleaved on one UART. Two Plays at once corrupt the path buffer |
| Soft limits | One window. LIMIT hold in tab A changes colours in tab B |
| Server task | One `task_runner`. A new ⏲ replaces the old. Any `M…` from either tab cancels it |

---

## What is per-browser

| Thing | Stored where |
| --- | --- |
| Project / layout / Timeline keys | `localStorage` `sh_project` |
| Rig names | `sh_rig` |
| A/B poses | `sw_marks` |
| SWAP DIR, MSM, CLI lines | `sw_*` keys |
| Keyboard armed, log curve | Memory (Keyboard off on load) |
| Timeline Play / A/B LOOP state | That tab’s JS |

So: two phones can have **different marks** and **different curves** but they shove the **same** cart.

---

## Watchdog

One `last_client_ms` on the host. **Either** tab’s 1 s pet keeps the WDT from firing. Closing one phone does not `MS` if the other stays open.

If **both** sleep and no task is running → `MS` after ~2.5 s.

---

## Practical rule

One operator, one tab, for Play, LOOP, and FAST. A second tab is fine as a **read-only** Info view if nobody touches ENABLE or SPEED.

---

## Related

- [Session](session-manual.md)
- [Watchdog](watchdog-manual.md)
- [Safety](safety-manual.md)
