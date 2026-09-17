# Config (project and rig)

Config is a **dialog**, not a docked panel. On desktop it is the **Config** button in the top bar. On a phone it is the gear tab, then **Project & rig**.

It does not hide or show panels (those are the top-bar toggles). It does not edit F-curves (Timeline menu) and does not set SPEED.

---

## Project

| Field | Range | What it is |
| --- | --- | --- |
| **Frame rate** | 1–120, default 30 | Used when you **Export Maya Camera**. It does not change Path frequency or playback |
| **Marks** | 2–8, default 4 | How many A–H slots [A/B](ab-panel-manual.md) and [Timelapse](timelapse-panel-manual.md) show. Changing this rebuilds those pads and **cancels** a running LOOP |
| **Path frequency (Hz)** | 10–200 | Timeline Motion Path sample rate (`play_hz`). Higher = denser `PD` chunks, shorter max duration for a given controller buffer |
| **Name** | text | Project title (`untitled`) |

### Save / Load project

**Save project** downloads JSON and stores a copy in the browser (`sh_project`). The host’s `/api/projects` folder is unused by this dialog.

**Load project** picks a `.json` file. Timeline lanes, markers, mark **count**, layout fractions, and the fields above come back. The **rig** does not. A/B **poses** live in `sw_marks` and are not in this file.

A project is the *shot*. Swap sliders without losing keys by keeping the project and loading a different rig — or the reverse.

---

## Rig (slider)

The rig is **this machine**: how many axes, names, units, travel, which SliderMC slot.

The list is filled from the last `hello` / status (what the MC actually has) plus any names you saved. Typical line:

`#id  name  min–max  unit  mc  slot`

You do not invent extra motors here if the controller only reports two.

| Button | Result |
| --- | --- |
| **Save rig** | Download + `localStorage` (`sh_rig`) — not the timeline, not `/api/rigs` yet |
| **Load rig** | Replace names, units, limits, `mc_id` / slot |

After load, Info names and Timeline lane labels follow the rig. Physical min/max still come from the MC when it reports them; the Timeline limit bands use the tighter of live status and rig.

---

## Home

The **Home** button sends **`MH`** (SliderMC home / reference). Same as the phone Home tab button.

It is not on the desktop Buttons panel.

Homing behaviour (which end, sensors, blocking) is **SliderMC firmware**, not this dialog. ENABLE should be on. Stand clear of the rail.

---

## Close

**Close** dismisses the dialog. Unsaved field edits that already wrote into the in-memory project (Marks, Hz, name, fps) stay in the session; use **Save project** if you want a file.

The separate **Change time** dialog (Timeline menu) is documented in [Timeline](timeline-panel-manual.md), not here.

---

## Related

- [User manual](user-manual.md) — project vs rig vs timeline.json.
- [Phone](phone-manual.md) — SWAP DIR and ENABLE live on Home, not in this dialog.
