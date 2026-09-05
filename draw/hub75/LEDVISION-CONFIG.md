# Configuring the Colorlight 5A-75B with LEDVISION

How the card was reconfigured off its factory setup (1280×512 canvas, 1/32 scan) onto the built
64×192 display, using LEDVISION in a Windows VM on a Mac-only setup — and what the config protocol
looks like on the wire, captured for the eventual goal of configuring a card *from the Pi* with no
Windows at all.

Companion artifacts in this folder:
- `ledvision-config-20260904.pcap` — a full discover → read → config-write capture of a working
  session (the format section below is derived from it).
- `ledvision-config-20260905.pcap` — the **persisting** configuration: a clean single-session
  capture (2 pushes + 2 commits), filtered to control traffic (no pixel flood), and the first to
  include the *Receiver Mapping -> Save to Devices* write. The better reference of the two.
- `baseline-card-20260903.txt` — the card's factory reply dump, before any changes.

See also `CLAUDE.md` (the offset convention `d[n]`, the pixel/discover/sync packet layouts) and
`tools/colorlight-probe.c` (reads the card's geometry at zero risk).

---

## 1. The environment (Mac-only, no Windows PC)

LEDVISION is Windows-only and its packet path needs an x86 kernel driver, so:

- **UTM 4.7.5**, **emulated x86** Windows 10 x64 (not virtualized ARM — the packet driver is x86).
  Runs in **Audit Mode**: boots straight to the desktop as the built-in Administrator; a Sysprep
  dialog appears each boot — **Cancel it, never OK into OOBE** (OOBE completing disables the only
  account and locks you out; recover with the Windows-RE `utilman.exe`→`cmd.exe` swap).
- **Network: Bridged (Advanced) on the USB-C gigabit dongle** (a Realtek RTL8153). The card speaks
  raw layer-2 with non-IP ethertypes — a direct cable, no switch, no IP.
- Files reach the guest as **mountable ISOs** (`hdiutil makehybrid -iso -joliet`), swapped via UTM's
  toolbar CD icon. No shared folders or guest tools needed.

**LEDVISION version matters.** LEDVISION **9.x and the standalone "LEDSetting" app both require a
Colorlight *sender* (sending card / controller)** on the wire and refuse to do anything without one —
they sit at "No Sender Detected". We drive the receiver *directly* from a NIC, so those are dead
ends. **LEDVISION 8.5** (`LEDVISION_Setup_8.5.39549.exe`, Jan 2022) has the classic *LED Screen
Settings* dialog with **"Select Sending Device: Net Card / Sender / Play Box"** — pick **Net Card**
and the PC's NIC becomes the sender. That's the controller-free mode this project needs.

**8.5 needs genuine WinPcap, not Npcap.** With only Npcap installed (even in WinPcap-compatible mode),
8.5's Net-Card adapter list is empty and it says "go to Help → Environment Detection to install
WinPcap". Npcap's compat shim is rejected, and 8.5's bundled WinPcap installer refuses to run while
Npcap is present. So: **uninstall Npcap, then Help → Environment Detection installs WinPcap.** (This
means no in-guest packet capture — capture from outside instead; see §5.)

---

## 2. The procedure that worked

1. **Baseline first.** From the Pi, `sudo ./colorlight-probe -i eth0 -f` — saves the card's current
   geometry so there's a known-good "before". Give a just-powered card ~1 minute; it ignores the
   first discovery.
2. **LED Screen Settings → Sending Device → Net Card**, pick the Ethernet adapter, **Detect Receiver
   Cards** → the 5A appears (version, run-time, "Normal Chip").
3. **Intelligent Setting** (the module wizard) — characterises one module by lighting patterns and
   asking what you see. For the P5 64×32 panels the answers are: module **64×32**, **Normal Chip**,
   **7258 decode**, and it auto-detects **1/16 scan** and the colour. The last page is a **pixel-route
   trace**: it flashes pixels and you click the matching cell of a 64×16 grid (16 = scan rows; the
   two data groups make the panel 32 physical). Trace in the module's **native (upright, per the
   back-of-panel text) landscape orientation**, watching the *front* face — a standard module fills
   the grid in near-neat order and the tool auto-extends. Finish. Scan Mode now reads **16 scan**.
4. **Cabinet Setting** — the module's physical mounting rotation could **not** be expressed in
   LEDVISION 8.5, so the cabinet is defined in the modules' **native landscape** orientation and the
   90° rotation is left to limut (§4). For six 64×32 modules that is a standard **192 × 64** cabinet
   (3 wide × 2 tall), **Split Style: No Split**.
5. **Receiver Mapping (Look From Front)** — one receiver card, **Width 192, Height 64**. (The
   Layout-Set arrows there arrange *multiple* cards; with one card they do nothing.)
6. **Send** on **both** tabs (RAM, reversible) — *Receiver Parameters → Send* and *Receiver
   Mapping → Send* — then **Screen Test → Grid/White** → observe the panel. Iterate cabinet /
   cascade / cabling until all six modules show one coherent (landscape) image.
7. **Flash BOTH saves, on a gigabit link, or it will not persist.** Confirm `en5` is at
   `1000baseT` first (`ifconfig en5 | grep media`; a 100 Mb link can report a save OK and not
   commit it, §3), then *Receiver Parameters → Save to Receivers* **and** *Receiver Mapping →
   Save to Devices*. These are two separate flash writes — committing only the first (the mistake
   that cost the 09-04→09-05 gap) leaves the mapping in RAM only.
8. **Prove it: power-cycle the card, then Screen Test again without re-sending.** A coherent wall
   means it is genuinely in flash — the only real test. See "resolved 2026-09-05" below.

### Ports and cabling
The card drives the cabinet's two module-rows as **two data groups on consecutive ports** — groups
**1,2 → J1** and **3,4 → J2** — with the port order fixed by the cabinet, not freely assignable.
**Non-consecutive ports (e.g. J8) are not reachable without padding the run with ~12 "void groups"
in Data Group Swap** — wasteful and fiddly; use consecutive ports. Column left/right order and
top/bottom order are set by **swapping the two HUB75 cables at the card** and by cascade direction —
cheaper to fix physically than in config.

### Final config for *this* display
64×192 portrait wall = six 64×32 modules, each mounted **rotated 90°**, two side-by-side full-height
columns of three. On the card: **192×64 native landscape cabinet**, **16 scan**, Normal Chip, 7258,
BGR, No Split, four data groups on **J1 + J2**. The landscape→portrait 90° rotation is done in limut.

---

## 3. Wrong turns worth not repeating

- **A sub-gigabit link mimics config bugs.** The dongle↔card cable renegotiated 1000→100 Mb **twice**,
  just from being handled — and a 100 Mb link produced "top 4 panels black, bottom 2 lit", which
  reads exactly like a bad cabinet config. Reversing the cable end-for-end restored gigabit. Watch
  `ifconfig en5 | grep media` for `1000baseT`; **replace a cable that does this.**
- **`Send` is RAM, `Save to Receivers` is flash.** The card wouldn't display changes until flashed,
  and a persistent red "Click Save to Receivers" is the reminder. Iterate with Send; commit with Save.
- **Re-opening Intelligent Setting makes you re-trace.** Once Scan reads 16, don't reopen it — Cancel.
- **Module Size shows `64W×16H`, and that's correct** — it's the scan-height; the two data groups
  double it to 32 physical. Not a bug.
- **Don't touch the receiving-card *firmware upgrade*** — it's the only brick path. A wrong config is
  just a resend. (A wrong *scan* can over-drive panels, though — configure at low brightness.)

---

## 4. Why the rotation lives in limut, not the card

Card-side per-module 90° rotation could not be found in LEDVISION 8.5, so the cabinet is native
landscape and limut does the landscape→portrait remap. This costs **nothing** at runtime: it's a
coordinate transform in the shader (same pixel count, ~µs), or at worst a ~12k-entry lookup in the
output stage — far inside the Pi's measured 0.64 ms/frame budget. The card is a scan-out engine fed a
raw pixel buffer by the Pi, so any geometry the Pi bakes into that buffer is free.

**Done 2026-09-04.** Six `--panel SX,SY:DX,DY:64x32:90` entries, derived by reading the `cellid`
pattern off the wall, now drive the whole 64×192 portrait display at 60 fps. The map and the full
command are in `CLAUDE.md` → "The wall as driven, 2026-09-04". Two things that section records and
that this one got wrong:

- **Only the cabinet was reconfigured, not the screen.** The card's receiver window is now a
  192×64 cabinet at the origin at 1/16 scan, but its *screen* is still 1280×512 and it will not
  latch a frame until a whole screen has gone out. Sending a bare 192×64 canvas is **black**.
  `--trim-canvas` sends every row in order but only the 192 occupied columns, which is 514
  packets/frame, 18 MB/s and a solid 60 fps — so the bandwidth argument for reconfiguring the
  screen has evaporated.
- **The ports are J1 + J2**, and the cascade — not the port numbers — decides which module lands
  in which canvas cell. On this wall the canvas column runs bottom-to-top of the portrait wall and
  the canvas row runs left-to-right, which nobody would have guessed.

---

## 5. Capturing the session (the reusable route)

WinPcap in the guest rules out in-guest capture, and the card only forwards the *pixel* stream to its
output port (never the receiver-0 config packets), so **the Pi on the card's output port cannot see
the config write**. The capture has to be the guest's own transmit, taken on the **Mac host**:

- UTM bridged mode puts the guest on a host bridge `bridge100` whose members are `en5` and the vmnet
  tap **`vmenet0`**. `en5` and `bridge100` taps did **not** see the guest's frames; **`vmenet0` did.**
- ```sh
  sudo tcpdump -i vmenet0 -s0 -U -w /tmp/h.pcap \
    "not ether proto 0x5500 and not ether proto 0x0aff and not ip and not ip6 and not arp"
  ```
  `0x5500` (pixel) and `0x0aff` (brightness) are the 60 Hz flood — excluding them keeps only control
  traffic. Use `-U` (unbuffered) and a **short path** — a long `-w` path wraps in the pasted command
  and silently breaks `tcpdump`.

---

## 6. The config protocol on the wire

Framing follows the Colorlight convention already documented in `CLAUDE.md`: the **type is the first
byte of the "ethertype" field, and data starts at the second byte** (so what a sniffer prints as
"ethertype 0x1800" is type `0x18`, `d[0]=0x00`). All frames are broadcast from the PC's MAC to the
card. Everything below is **observed from the capture** — field *meanings* are inferred and labelled.

### Discovery & read-back (safe, read-only)
| type | len | what |
|---|---|---|
| `0x07` | 284 | **discover** — asks for a receiver by number (`d[3]`). Sent by the PC. |
| `0x08` | 1070 | **reply** — `d[0]=0x05` marks a 5A, `d[2:3]` firmware, `d[21:24]` cabinet size, `d[46:49]` uptime. Detailed in `CLAUDE.md`. |
| `0x09` (`0x0900/0x0901`) | 1070 | **read-back** of receiver parameters (what "Read" pulls). Large; carries the stored config. |
| `0x11` (`0x1122`) | 284…1308 | request/response pairs during **Detect / Read**; several sizes. |
| `0x19` | 140 | small geometry record — early bytes hold `0x40`=64 (module width) and neighbours; appears per-module. |
| `0x40` | 81 | frequent small poll/keepalive interleaved through a session. |

### The config-write burst (what "Send" / "Save to Receivers" emits)
One config push is a fixed block, repeated (once per push; we pushed several times):

```
0x18 ×1     1040 B   16-bit value table — pairs like 0d00 04cc / 0b00 0266; a gamma / brightness curve
0x17 ×1      785 B   config header — begins ff ff, a 0x30 marker
0x1b ×12     282 B   per-unit record ×12 (= 6 modules × 2 data groups); begins ff ff, small indices
0x26 ×12+    140/278 the pixel-route / scan-map table — the alignment data from the trace; most frequent type
0x1f ×2     1048 B   mostly-zero table — calibration coefficients (calibration disabled → zeros)
0x32 ×4     1048 B   index map — a clean incrementing run 2000 2001 2002 … ; one per data group (4)
0x76 ×1     1171 B   offset table — stride-4 run 0004 0008 000c 0010 … ; pixel/byte offsets
```
A final tail block swaps the `0x26` count and appends `0x19 ×12` (the per-module geometry).

So the shape of "configure a receiver" is: **a gamma table (`0x18`), a header (`0x17`), per-module
records (`0x1b`), the route/scan map (`0x26`, the bulk), a calibration table (`0x1f`), per-data-group
index and offset maps (`0x32`, `0x76`), and per-module geometry (`0x19`)** — then it's live in RAM;
`Save to Receivers` re-emits the same to commit to flash. `0x10`/`0x11` also appear (FPP's notes name
`0x10/0x11` as *save config*), consistent with a commit step.

**Sync/latch** during any streaming is type `0x01` (`0x0107`, 98-byte 802.3 frames at 60 Hz) — the
same latch used for pixel data; tcpdump renders it as `802.3, length 98` because `0x0107` < 1500.

### The 2026-09-05 capture: a clean two-save session

`ledvision-config-20260905.pcap` is the configuration that persists, and unlike the 12-push 09-04
capture it is a single clean session — exactly **two full pushes and two commits**
(`0x18`×2 gamma, `0x17`×2 header, `0x1b`×24 per-unit, `0x26`×49 route, `0x1f`×4, `0x32`×8, `0x76`×2,
`0x19`×14 geometry, `0x10`×2 commit). Those two pushes are *Save to Receivers* and *Save to Devices*,
and they emit the **same frame-type mix** — so the mapping/connection data the second one adds is
encoded **within** these types, not as a new type.

The `0x19` frames read as **per-register writes**: `d[0..3]` a marker (`00 ff ff 85/86/87`), `d[7]`
a register address, and the bytes after it the value. The geometry lands at register `0x4d`:
`… 00 4d 00 00 00 0d 28 00 00 00 00 40 00 c0` — `0x0040`=64 and `0x00c0`=192, the cabinet
dimensions. Searching the whole write burst, **192/64 appear as real geometry and 1280/512 do not
appear as a field** — the two `0200 0500` hits are adjacent index/value pairs inside the `0x18`
gamma curve, not a screen dimension. (This is consistent with the empirical result that the screen
is still 1280×512: the screen size simply is not in this capture at all — see "What still needs
Windows".)

### Replaying it from the Pi — RAM only, a manual diagnostic

> **This is a RAM write and never persists** (see "resolved 2026-09-05" below), and there is no
> longer any boot service doing it — the card holds its own flash config now. It remains a useful
> manual tool for making the wall right on an already-running card, or for protocol work.

**Verified 2026-09-04: a 5A-75B can be configured from the Pi, over raw ethernet, with no Windows
machine in the loop.** Not by decoding the configuration but by replaying one, which is the whole
point — LEDVISION already wrote the configuration we want, so the captured bytes *are* the spec.

- `tools/extract-config.py` pulls a configuration out of this pcap. It tells a `Send` (RAM) from a
  `Save to Receivers` (flash) by the **tail block only a save emits** — an extra `0x26` run, ~208
  `0x06` frames, then 12 `0x19` per-module geometry records. This session holds **2 saves among 12
  pushes**; the last save is bursts 25–27.
- `tools/colorlight-config.c` replays one onto the card, dry-run by default, `--write` to commit.
- `colorlight-config-64x192.clcfg` is this wall's configuration, extracted and checked in.

```sh
python3 tools/extract-config.py ledvision-config-20260904.pcap --list
python3 tools/extract-config.py ledvision-config-20260904.pcap -o cfg.clcfg
sudo ./colorlight-config -i eth0 cfg.clcfg            # dry run
sudo ./colorlight-config -i eth0 --write cfg.clcfg    # commit
```

### The configuration DOES survive a power cycle — resolved 2026-09-05

**Superseding the earlier pessimism recorded here: the card now holds its 192×64 configuration in
flash and comes up correct from a cold boot with nothing replaying it.** Two independent proofs,
both 2026-09-05:

- **Card-only power cycle** — card on the Mac dongle, no Pi in the loop, no re-send. Power off, back
  on, and the wall returned coherent within seconds: the card booted its own flashed geometry.
- **Full cold boot with the boot-replay removed** — Pi and card both power-cycled, the `cardconfig`
  service gone (below), so nothing could reconfigure the card. The wall came up to a clean idle
  pattern on its own.

**What made the difference** (the first is proven; the second is the leading hypothesis):

1. **Both flash saves, not one.** LEDVISION flashes the receiver **parameters** and the **mapping**
   separately: *Receiver Parameters → Save to Receivers* (cabinet, scan, route) **and** *Receiver
   Mapping → Save to Devices* (connection/mapping). Only the first had ever been done. Doing both is
   what made it stick — see §2 steps 6–8.
2. **A solid gigabit link during the write.** The dongle↔card cable had been renegotiating to 100 Mb
   (§3), and a flash write over a marginal link can report success without committing. The 09-05
   saves were done with `en5` confirmed at `1000baseT`.

**The boot-time replay is removed, not fixed.** `pi/limut-hub75-cardconfig.service` used to replay a
capture every boot; it half-configured the card (idle Ls in the right corners with green lines
alongside) while the identical file replayed **by hand** was perfect every time — a boot-vs-by-hand
mystery that was never solved and no longer needs to be. The service, its `enable`, and the
renderer's `Wants=`/`After=` on it are all gone (repo and Pi, 2026-09-05). **A plausible reason it
half-configured, recorded but not proven:** it replayed `colorlight-full-session.clcfg` from the
**09-04** capture, which predates the *Save to Devices* mapping write — i.e. a structurally
incomplete configuration.

**Pi replay (`colorlight-config --write`) writes RAM, never flash.** That is why it was never a
persistence route: it fixes the wall immediately and is gone at the next power cut. It stays a
manual diagnostic.

**Two traps worth not re-learning:**

- **Replaying the card's own current configuration proves nothing** — it is a no-op, and "nothing
  changed" is equally consistent with the write working and with it being ignored. Test a write by
  writing a *different* config and reading it back: `reg 4c` was `0x1f` for the working config,
  `0x02` after writing save 0, `0x1f` again after restoring save 1, reproducible both ways. But
  `reg 4c` is a **same-power-cycle** readback — it proves a write reached live parameters, **not**
  that it persisted. Persistence is only ever proven by a power cycle.
- **A full-screen test pattern hides a half-configured card.** `bars`/`cellid`/`white` paint every
  pixel; use the idle pattern (20 lit pixels) so anything the card adds of its own shows.

Two facts measured from the captures, worth not re-deriving: LEDVISION **stops** its 60 Hz sync
stream while writing (1 frame in the 20 s of a save, vs 11.5/s across the session), and it needs
**no fresh handshake** — it detected the card at t=10 s and configured it from t=2391 s, 97 minutes
later.

### The read primitive

LEDVISION's `0x06` (memory, address at `d[4:8]`) and `0x19` (register, index at `d[8]`, count at
`d[12]`) requests are answered by the card with an `0x09`: `d[0]` status, `d[1]` count, `d[2..]`
the value — and **the rest of the 1070 byte frame is stale buffer from earlier replies**, which
reads convincingly as data and is not. Replaying those requests from the Pi reads the card's
stored parameters, stably and reproducibly, which is what makes a config write checkable without
anyone looking at the wall.

### What still needs Windows

Only **capturing a configuration that has never been captured** — applying one is a solved,
Windows-free operation. The one geometry still out of reach is the card's **screen size**, still
**1280×512**. *Save to Devices* persisted the 192×64 mapping but **not** the screen dimension:
re-confirmed empirically 2026-09-05 by driving a bare `--canvas 192x64` (no `--trim-canvas`) — the
wall went **black** (the card will not latch a sub-screen frame), 66 packets/frame vs 514 trimmed.
Changing it needs a LEDVISION session that sets the **screen/display size** itself (not the Receiver
Mapping), captured then replayable. It costs nothing now `--trim-canvas` gets the wall to 60 fps at
18 MB/s — see `CLAUDE.md`.

### To go further
The `0x26` route map and the `0x32`/`0x76` index/offset tables are the parts that encode *this*
panel's wiring, so reproducing a config from the Pi means diffing two captures (e.g. 16-scan vs
32-scan, or two cabinet sizes) to see which bytes carry scan, dimensions and port assignment. The
gamma (`0x18`) and calibration (`0x1f`) tables are panel-independent and can likely be copied verbatim.
A **click-by-click log alongside a fresh capture** is the missing piece for a full decode — the bytes
mean little without knowing which UI action produced each burst.
