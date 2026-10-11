# HE80 Driver: technical reference

Everything needed to understand, maintain or rebuild this driver: what it does and doesn't do, how it talks to the
keyboard, the full protocol as far as it is known, and what was verified on real hardware.

**Status legend:** ✅ verified on a real HE80 · 📄 taken from the official Epomaker web driver code, not tested here ·
❌ tested, doesn't work on this keyboard.
Board used for every test: Epomaker HE80, wired, USB `0C45:8092`, productNum 4100, **firmware 1.08**.

---

## 1. Overview

The driver is a single-page web app (React 19, TypeScript, Vite, Tailwind v4) that talks to the keyboard over
**WebHID**, directly from the browser. There is no backend and nothing is installed; it works in Chromium browsers
(Chrome, Edge) on `localhost` or over HTTPS.

The HE80 has no on-board profiles: everything lives in a set of memory **regions** on the keyboard (settings, key map,
Fn layer, per-key travel, DKS slots, macros, lighting). The driver reads every region on connect, edits a copy, and
writes changed regions back.

### Code map (`web/src`)

| Path | What |
|---|---|
| `lib/hid.ts` | WebHID transport: packet framing, chunking, retries, one-command-at-a-time queue, **command allowlist** |
| `lib/protocol.ts` | Typed decode/encode of every region (read-modify-write: unknown bytes are kept) |
| `lib/keys.ts` | The 82-key layout and its index map; HID usage names |
| `lib/backup.ts` | Backup files (JSON), automatic backups in browser storage, verified writes, restore |
| `lib/advanced.ts` | Key map + DKS slots as one unit: rules that span keys (pairs, slots) and the safe save order |
| `lib/macros.ts` | Macro step rules, storage accounting, recording (browser key events → steps) |
| `lib/saver.ts` | Debounced "save the newest value" queue used for auto-save |
| `lib/diff.ts` | Human-readable diff between two backups (restore preview) |
| `lib/choices.ts`, `describe.ts`, `fnDefaults.ts` | Key picker catalogue, labels, the HE80's built-in Fn functions |
| `ui/` | React components: one editor per tab, the keyboard view, theme switch, backups window |

`lib/` has no React in it and is covered by unit tests (`npm test`, Node's built-in test runner). Several tests run
against a real backup of the test keyboard (`web/test/`), so decoders and encoders are checked byte for byte.

---

## 2. What it can and can't do

| Feature | Status | Notes |
|---|---|---|
| Per-key actuation (0.10–3.30 mm) | ✅ | |
| Rapid trigger, separate press/release sensitivity (0.02–3.30 mm), full-travel RT | ✅ | Warning at ≤ 0.04 mm, as in the official driver |
| Key remapping (keys, media, mouse buttons/wheel) | ✅ | |
| Shortcut on one key (e.g. Win+E, Ctrl+C) | ✅ | Uses the modifier byte the official driver never sets |
| Fn layer remapping | ✅ | Fn key and Fn+F1–F12 are locked (read-only in the official driver too) |
| Tap/Hold, Toggle | ✅ | |
| SOCD (last input / key 1 / key 2 / neutral) | ✅ | |
| Rapid Switch | ✅ | Depth-based: the key pressed further down wins |
| DKS (4 keys × 4 stages) | ✅ | |
| Macros: editor, recording by typing, play N times / until pressed again | ✅ | 20 macros, 624 bytes shared |
| Settings: polling 1–8 kHz, stability mode, adaptive calibration | ✅ | |
| Reset to defaults (keys, Fn layer, travel, advanced keys, macros) | ✅ | Normal writes, never the factory-reset command |
| Backups (save/restore with a diff preview), automatic backups | ✅ | Backup files double as profiles |
| Macros on the Fn layer | ❌ | Firmware 1.08 doesn't play them (official driver neither) |
| Macro mode "while held" | ❌ | Keeps playing after release; the official HE80 profile doesn't offer it |
| Fn functions that send shortcuts (type 13, e.g. Win+E) | ❌ | Do nothing on 1.08; use a key with modifiers instead |
| Dead zones | ❌ | No visible effect; not offered (leftover values can be reset to 0) |
| Live key travel view | ❌ | No usable data source without calibration mode (§6.8) |
| Lighting | not offered | Out of scope; the region is read, kept, and documented (§6.7) |
| Calibration | not offered | Risky (can overwrite stored calibration); use the official hub |
| Firmware update / custom firmware | not offered | No firmware image available (§8) |

**Other limitations**
- Chromium only (WebHID). Over a network the page must be served with **HTTPS**; `localhost` works without.
- Only one app can talk to the keyboard at a time: close the official hub first.
- Only firmware 1.08 / productNum 4100 was tested. Other HE80 revisions (productNum 4864, 4364) are accepted but
  untested; a keyboard with a different travel precision (§6.1) is opened read-only.

---

## 3. Safety design

The keyboard can be bricked by the wrong commands (bootloader, flash), so the driver is built defensively:

- **Command allowlist** (`hid.ts`): reads `0x10–0x18`; writes `0x21` settings, `0x22` key map, `0x25` macros,
  `0x26` Fn layer, `0x27` per-key travel, `0x28` DKS. Everything else is refused in code. Never sent: `0x0F` factory
  reset, `0x4F` flash download, `0x64/0x65` calibration, ISP / bootloader commands.
- **Read-modify-write:** encoders patch known fields into the bytes that were read; unknown bytes go back unchanged.
- **Verified writes:** before writing a region the driver re-reads it and refuses if it changed since it was read
  (another app), then writes, then reads back and compares. Writes that wouldn't change anything are skipped.
- **Automatic backups:** every time the keyboard is read, a copy goes into browser storage (last 5, duplicates
  skipped). If that fails, writes are refused until the user saves a backup file.
- **Cross-key rules in one place** (`advanced.ts`): SOCD/RS pairs always hold the same entry on both keys, unused
  DKS slots are emptied, and the key map + DKS slots are saved in an order that never leaves a key pointing at an
  empty slot, even if a write fails halfway.
- **Locked keys:** the Fn key is never remapped (without it the Fn layer is unreachable); Fn+F1–F12 stay as built in.
- **Auto-save:** edits are written 400 ms after the last change (newest value only). Each editor reports its own save
  state, so an error in one region can't be hidden by another region's success.

---

## 4. USB device and transport

| Item | Value | |
|---|---|---|
| VID / PID | `0x0C45` (Sonix) / `0x8092` | ✅ |
| HID collection | usagePage `0xFF68`, usage `0x61` (the only one WebHID sees) | ✅ |
| Report ID | `0` | ✅ |
| Packet size | 64 bytes: 8-byte header + up to 56 payload bytes | ✅ |

**Request:** `AA cmd len offLo offHi 00 last 00` followed by the payload at byte 8.
**Reply:** `55 cmd len offLo offHi 00 last 00` + payload. Replies echo the length and offset; match on `55`, `cmd` and
offset. Every write packet is acknowledged the same way. ✅

A region is transferred in chunks of 56 bytes (`offset` = byte offset into the region, `last` = 1 on the final chunk).
Reads send an empty payload and the keyboard fills it in. The driver sends one command at a time (replies carry no
request id), waits up to 1 s per packet, and retries 3 times.

There is **no commit command**: writes are stored immediately and survive unplugging. ✅ (The old driver sent `0x00`
after every batch; it isn't needed.)

---

## 5. Command table

Write command = read command + `0x10`.

| Cmd | Region | Size | Status |
|---|---|---|---|
| `0x10` | device info | 56 | ✅ read |
| `0x11` / `0x21` | settings | 56 | ✅ read + write |
| `0x12` / `0x22` | key map | 512 (128 × 4) | ✅ read + write |
| `0x13` / `0x23` | lighting | 16 | ✅ read + write (not used by the driver) |
| `0x14` / `0x24` | per-key RGB | 512 (128 × 4) | ✅ read · 📄 write (not used) |
| `0x15` / `0x25` | macros | 1024 | ✅ read + write |
| `0x16` / `0x26` | Fn layer | 512 (128 × 4) | ✅ read + write |
| `0x17` / `0x27` | per-key travel (actuation / RT) | 1024 (128 × 8) | ✅ read + write |
| `0x18` / `0x28` | DKS slots | 1024 (64 × 16) | ✅ read + write |
| `0x1C` | default Fn matrix | 512 | ❌ no reply on the HE80 |
| `0x0F` | factory reset (`FF` = all, `05` = clear calibration) | | 📄 never sent |
| `0x4F` | flash download | | never send |
| `0x64` / `0x65` | calibration start / stop + save | | 📄 never sent |
| `0x66` / `0x67` | simulation (live travel) on / off | | ❌ acknowledged, no data |
| `0x68` | key status poll | | ❌ echoes the request |
| `0xAA42…`, `0xAA55…` | enter bootloader (ISP) | | never send |

Other numbers in the official code (`0x1B`, `0x1D`, `0x30–0x3D`, `0x40–0x42`, `0x50`, `0x51`, `0x69`, `0x6A`) belong
to other models (screens, side lights, calibration V2).

---

## 6. Regions

All multi-byte numbers are little-endian. Distances are in 0.01 mm unless noted.

### 6.1 Device info (`0x10`)

| Byte | Field | Test board |
|---|---|---|
| 4–5 | VID | `0x0C45` |
| 6–7 | PID | `0x8092` |
| 8–9 | firmware: `((b8 & 15) + (b8 >> 4) * 10 + b9 * 100) / 100` | 1.08 |
| 12–13 | manufacturer | 358 |
| 14–15 | **productNum**: 4100, 4864 and 4364 are all "Epomaker HE80" | 4100 |
| 29 | **rtPrecision**: 0 = travel values in 0.01 mm | 0 |

The official hub refuses unknown productNums; this driver opens them read-only, and also opens a keyboard with a
non-zero rtPrecision read-only (its travel units would differ).

### 6.2 Settings (`0x11` / `0x21`)

| Byte | Field | |
|---|---|---|
| 5 | polling rate: `3` 1000 Hz · `4` 2000 · `5` 4000 · `6` 8000 | ✅ |
| 8 / 9 | top / bottom dead zone, 0.01 mm (0–0.50; old hub only) | ❌ no visible effect |
| 11 | stability mode 0/1 | ✅ |
| 14 | adaptive (dynamic) calibration 0/1 | ✅ |
| 3, 4, 6, 7, 15 | sleep time, key delay, OS mode, screen time, single-key wake | not used |

The official hub rebuilds this buffer from scratch and zeroes bytes 6 and 15; this driver keeps every byte it doesn't edit.

### 6.3 Per-key travel (`0x17` / `0x27`)

128 entries × 8 bytes, key `k` at offset `8k`:

| Byte | Field |
|---|---|
| 0 | switch type (kept as read) |
| 1 | flags: bit 0 = full-travel RT ✅; bits 1–2 unresolved, kept as read |
| 2–3 | actuation point |
| 4–5 | RT press sensitivity (0 = RT off) |
| 6–7 | RT release sensitivity |

Default (what unused slots read): `00 00 78 00 00 00 00 00` = 1.20 mm, RT off. Limits: actuation 0.10–3.30 mm,
RT 0.02–3.30 mm (the official driver warns at ≤ 0.04 mm).

### 6.4 Key map (`0x12` / `0x22`) and Fn layer (`0x16` / `0x26`)

128 entries × 4 bytes, key `k` at offset `4k`. All zero = default (the key's own function; on the Fn layer, the
keyboard's built-in Fn function).

| Byte 0 | Type | Encoding | |
|---|---|---|---|
| 0 | default | `00 00 00 00` | ✅ |
| 1 | mouse | `[1, 1, button mask, 0]` (1 left, 2 right, 4 middle, 8 back, 16 forward) · `[1, 3, 1 up / 255 down, 0]` wheel | 📄 |
| 2 | key | `[2, modifiers, HID usage, 0]`; modifier bits: 0 Ctrl, 1 Shift, 2 Alt, 3 Win, 4–7 right-hand ones | ✅ |
| 3 | consumer (media) | `[3, usage lo, usage hi, 0]` | ✅ |
| 6 | macro | `[6, macro slot, mode, count]` (§6.6) | ✅ |
| 7 | combo | `[7, mod 1, mod 2, key]`; hidden on the HE80, not needed (type 2 does it) | 📄 |
| 8 | DKS | `[8, slot, 0, 0]` (§6.5) | ✅ |
| 9 | tap/hold | `[9, hold key, tap key, time / 10 ms]` (10–1000 ms) | ✅ |
| 10 | toggle | `[10, key, 0, 0]` | ✅ |
| 11 | SOCD | `[11, mode, key 1, key 2]` on **both** keys; mode 3 last input, 1 key 1 wins, 2 key 2 wins, 4 neutral | ✅ |
| 12 | Rapid Switch | `[12, 0, key 1, key 2]` on **both** keys | ✅ |
| 13 | Fn function | `[13, id >> 16, id >> 8, id]` | ✅ (see below) |
| 4, 5, 14, 15, `0x80+` | system, extra, END, MPT, FUNC_V2 | in the official encoder only; meaning unknown → kept as raw bytes | 📄 |

- Keys inside SOCD / Rapid Switch entries are the keys' own HID usages. Changing one key of a pair must update or
  clear the other.
- Fn function ids on the HE80: 1 factory reset (never offered), 8/9 Windows/Mac mode, 11–17 lighting, 18–21 and
  30, 33 shortcuts, 22 Win lock, 23/24 side lights (not on the HE80), 32 lighting direction.
  ❌ The shortcut ids (e.g. 19 = Win+E) do nothing on firmware 1.08, so the driver doesn't offer them.
- **Built-in Fn functions** aren't reported by the keyboard (`0x1C` doesn't answer); the official driver hard-codes
  them: F1–F12 = My Computer, Explorer, Calculator, Email, Media, Stop, Previous, Play/Pause, Next, Mute, Volume −,
  Volume +; Del → Insert, Home → End, I/O/P → Print Screen/Scroll Lock/Pause, Backspace → lights off,
  `[` `]` `\` → lighting direction/colour/effect, PgUp/PgDn → side-light effect/colour, A/S → Windows/Mac mode,
  Left Win → Win lock, ↑/↓ brightness, ←/→ light speed. F1–F12 are read-only in the official driver.
- Advanced keys (types 6, 8–12) are limited to 40 per key map.

### 6.5 Advanced keys: DKS slots (`0x18` / `0x28`)

64 slots × 16 bytes, slot `s` at offset `16s`; all zero = unused.

| Byte | Field |
|---|---|
| 0 | stage 0 point "start" (going down), 0.1 mm |
| 1 | stage 1 point "bottom", 0.1 mm |
| 2 | stage 2 point (lifting from bottom), 0.1 mm; the editor keeps it equal to byte 1 |
| 3 | stage 3 point (released past start), 0.1 mm; the editor keeps it equal to byte 0 |
| 4, 6, 8, 10 | 0 |
| 5, 7, 9, 11 | HID usage of bound key 1–4 (0 = none) |
| 12–15 | action mask for stage 0–3 |

**Mask:** for key `n` at stage `s`, bit `n` = tap (press and release at that stage), bit `n + 4` = held. A run of
"held" stages `s … e−1` presses the key at stage `s` and releases it at stage `e`. Stages: 0 press past start,
1 reach bottom, 2 lift from bottom, 3 release past start.

HE80 limits: points 0.1–3.0 mm; official defaults for a new slot 1.6 / 3.0 / 3.0 / 1.6 mm. 40 DKS keys max.
**Write order** (as the official driver): assign = write the slot, then the key entry `[8, slot, 0, 0]`; remove =
key entry first, then the zeroed slot. ✅

### 6.6 Macros (`0x15` / `0x25`)

```
0 … 399     100 × LE32 offsets of each macro into this region (0 = unused); the first macro starts at 400
macro:      LE16 (step count × 2), 00 00, then per step 4 bytes:
step:       LE16 wait in ms AFTER this step, HID usage (or mouse button mask), flags
flags:      B0 key press · 30 key release · 90 mouse press · 10 mouse release
```

- The last step's wait is always 0. The official minimum wait is 5 ms.
- Storage: 1024 − 400 = **624 bytes** for all macros, 4 per macro plus 4 per step (~150 steps in total).
- The official HE80 profile shows 20 macro slots (up to 511 steps each, storage permitting); the driver uses the same 20.
- Key entry: `[6, slot, mode, count]`. Modes: **1** = play `count` times (1–255; the official "once" is 1 × 1) ✅,
  **2** = until the key is pressed again ✅, 3 = while held ❌ (keeps playing on 1.08), 0 and 4 not used by the
  official HE80 profile.
- ❌ Macro entries on the **Fn layer** don't play on firmware 1.08 (several keys tested; the official driver behaves
  the same), so macros are offered on the main key map only.

### 6.7 Lighting (`0x13` / `0x23`, 16 bytes; not edited by this driver)

| Byte | Field |
|---|---|
| 0 | effect (0 off, 1 static … 0x13, 0x80 custom per-key; the test board uses `0x19`, name unknown) |
| 1–3 / 5–7 | primary / secondary RGB |
| 8 | colourful (rainbow) 0/1 |
| 9 / 10 | brightness / speed 1–5 |
| 11 | direction |
| 12 | mode |
| 14–15 | the official driver writes `AA 55`, the keyboard reads back `00 00` |

Per-key colours (`0x14` / `0x24`) are 128 × 4 bytes.

### 6.8 Calibration and live key travel (not used)

Calibration (`0x64` start, `0x65` stop **and save**) streams `55 FB` reports: byte 2 key index, 3 status
(1 = key done), 4–5 max ADC, 6–7 min ADC, 8–9 current ADC, 10–11 key stroke, 12–13 max stroke. Stopping with only
some keys pressed may overwrite stored calibration, so the driver never starts it.
❌ The "simulation" command `0x66` is acknowledged but sends no data on 1.08, and `0x68` echoes the request, so there
is no read-only way to show live key travel.

Device → host notifications documented in the official code (`55 FC 04/05/06` 2.4 GHz events, `55 FA` state) were
never seen on the wired HE80.

---

## 7. Key index map

Every per-key table (key map, Fn layer, travel, colours) uses these indices. 82 keys; Fn has no HID usage.
Format `index = key / HID usage`:

```
0=Esc/41 1=F1/58 2=F2/59 3=F3/60 4=F4/61 5=F5/62 6=F6/63 7=F7/64 8=F8/65 9=F9/66 10=F10/67 11=F11/68 12=F12/69 103=Insert/73 106=Delete/76
16=`/53 17=1/30 18=2/31 19=3/32 20=4/33 21=5/34 22=6/35 23=7/36 24=8/37 25=9/38 26=0/39 27=-/45 28==/46 92=Backspace/42 104=Home/74
32=Tab/43 33=Q/20 34=W/26 35=E/8 36=R/21 37=T/23 38=Y/28 39=U/24 40=I/12 41=O/18 42=P/19 43=[/47 44=]/48 60=\/49 105=PageUp/75
48=Caps/57 49=A/4 50=S/22 51=D/7 52=F/9 53=G/10 54=H/11 55=J/13 56=K/14 57=L/15 58=;/51 59='/52 76=Enter/40 108=PageDown/78
64=LShift/225 65=Z/29 66=X/27 67=C/6 68=V/25 69=B/5 70=N/17 71=M/16 72=,/54 73=./55 74=//56 75=RShift/229 90=Up/82
80=LCtrl/224 81=LWin/227 82=LAlt/226 83=Space/44 84=RAlt/230 85=Fn 87=RCtrl/228 88=Left/80 89=Down/81 91=Right/79
```

---

## 8. Firmware

Custom firmware was the original goal and is **blocked**:
- The MCU is a Sonix part (VID `0C45`); the official updater is the Sonix ISP library compiled to WebAssembly, talking
  to the bootloader over HID feature reports. Supported series: SN34F280, SN32F24xB, SN32F268, SN32F290. The exact
  chip, sensor wiring and debug pads are unknown (the board was not opened).
- "Enter bootloader" commands in the official app: `AA42895AFF7162CC` / `AA42895AFF7562CC` / `AA55A55AFF0033CC`
  depending on chip. **Never send these** without a verified recovery path.
- No HE80 firmware image is published anywhere official (update lists return nothing). Without an image or a dump
  (e.g. via SWD), there is no safe way forward.

Sections 4–7 are the contract a replacement firmware would have to keep for the official tools to keep working.

---

## 9. Hardware test log (firmware 1.08)

| What | Result |
|---|---|
| Read every region and compare with the official hub | ✅ all values match |
| Writes persist across unplugging without a commit command | ✅ |
| Remap (Insert → Scroll Lock), per-key actuation and RT, then exact restore | ✅ only the expected bytes changed |
| Settings: polling 4000 → 2000 → 4000 Hz, stability | ✅ |
| Fn layer: Fn+D → Play/Pause | ✅ |
| Shortcut keys: Win+E, Ctrl+C, Ctrl+V via the modifier byte | ✅ |
| Tap/Hold, Toggle, SOCD, Rapid Switch (depth-based), DKS | ✅ |
| Pair clean-up from the key map; DKS slot emptied when removed | ✅ |
| Macros: save and read back, play 3 times, until pressed again, delete resets keys | ✅ |
| Reset to defaults | ✅ |
| Fn-layer macros, macro mode 3, type-13 shortcut functions, dead zones, live travel `0x66` / `0x68` | ❌ |

---

## 10. Open questions

- Travel flags bits 1–2 (old driver: "bottom optimisation" / "rampage"; the HE80 profile says rampage is unsupported).
- Device info byte 3 (`0x92` on the test board); whether HE80 revisions 4864 / 4364 differ.
- Units of the `0xFB` stroke values (needs calibration mode).
- Lighting effect `0x19`.

---

## 11. How this was worked out (to replicate or extend it)

1. **Sources.** Epomaker no longer ships a desktop driver for the HE80; only web drivers support it. Both were read as
   plain JavaScript in the browser: the old web driver (`epomaker.driveall.cn/hub`) and the current EPOMAKER Hub
   (`hub.epomaker.com`, the "Huafenda" keyboard SDK, layout `huafenda-compact-84-he80`). Both use the same protocol
   family; where they differ, the newer one and hardware tests win.
2. **Read everything first.** A small test page with a strict command allowlist read every region and saved a full
   backup before anything was written. Decoded values were compared with what the official hub shows.
3. **One write at a time.** Each new write type was enabled separately, tested on one key with a visible effect,
   checked byte by byte (only the expected bytes may change), and restored exactly.
4. **Hidden features** were found by reading the official encoders (e.g. the modifier byte in key entries) and
   confirmed on the keyboard; features that the firmware ignores were removed rather than shipped.
5. **Never** send flash, bootloader, calibration or factory-reset commands while experimenting.

To support another keyboard of the same family, start from §4 (transport), check the device info and region sizes
against the official hub's configuration for that model, then re-run steps 2–3.
