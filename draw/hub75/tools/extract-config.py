#!/usr/bin/env python3
"""Pull a Colorlight receiving-card configuration out of a LEDVISION capture.

The point of this is that the configuration never has to be *understood*. LEDVISION already
wrote the one we want; a capture of that session holds the exact bytes, and replaying them
byte for byte reproduces the result. See ../LEDVISION-CONFIG.md for what little is decoded.

    python3 extract-config.py ../ledvision-config-20260904.pcap --list
    python3 extract-config.py ../ledvision-config-20260904.pcap -o cfg.clcfg

Picking the burst: a session holds many pushes, because LEDVISION's `Send` (RAM, reversible) is
how you iterate. Only `Save to Receivers` commits to flash, and it is distinguishable on the
wire — it appends a tail block the plain pushes do not have (an extra 0x26 run, ~208 0x06
frames, then 12 0x19 per-module geometry records). --list shows every burst so the choice can
be checked; the default is the LAST save, which is the state the card was left in.
"""
import argparse, collections, struct, sys

MAGIC = b"CLCFG1\n\x00"
# Types that carry configuration, as decoded in ../LEDVISION-CONFIG.md section 6.
WRITE_TYPES = {0x17, 0x18, 0x19, 0x1b, 0x1f, 0x26, 0x32, 0x76}
# The 60Hz latch and the keepalive poll: session noise, never part of a configuration.
NOISE_TYPES = {0x01, 0x40}
BURST_GAP = 2.0


def read_pcap(path):
    d = open(path, "rb").read()
    magic, = struct.unpack("<I", d[:4])
    if magic == 0xa1b2c3d4:
        end, div = "<", 1e6
    elif magic == 0xa1b23c4d:
        end, div = "<", 1e9
    elif magic == 0xd4c3b2a1:
        end, div = ">", 1e6
    else:
        sys.exit("not a classic pcap (magic %08x); pcapng is not supported" % magic)
    link, = struct.unpack(end + "I", d[20:24])
    if link != 1:
        sys.exit("link type %d is not Ethernet" % link)
    off, out = 24, []
    while off + 16 <= len(d):
        ts, sub, incl, _orig = struct.unpack(end + "IIII", d[off:off + 16])
        off += 16
        f = d[off:off + incl]
        off += incl
        if len(f) >= 14:
            out.append((ts + sub / div, f))
    return out


def bursts_of(pkts):
    """Split control traffic into bursts on a 2 s idle gap."""
    ctl = [(t, f) for t, f in pkts if f[12] not in NOISE_TYPES]
    out, cur = [], []
    for t, f in ctl:
        if cur and t - cur[-1][0] > BURST_GAP:
            out.append(cur)
            cur = []
        cur.append((t, f))
    if cur:
        out.append(cur)
    return out


def is_push(b):
    """A configuration push: the 0x17 header plus the per-module 0x1b records."""
    c = collections.Counter(f[12] for _t, f in b)
    return c[0x17] >= 1 and c[0x1b] >= 1 and sum(c[k] for k in WRITE_TYPES) > 20


def saves(bs):
    """Pushes followed by the flash-commit tail: the 0x19 per-module geometry records, which a
    plain `Send` never emits. The tail lands in later bursts, so a save is a RANGE of bursts."""
    out = []
    for i, b in enumerate(bs):
        if not is_push(b):
            continue
        j = i
        for k in range(i + 1, min(i + 4, len(bs))):
            if is_push(bs[k]):
                break
            j = k
            if any(f[12] == 0x19 for _t, f in bs[k]):
                out.append((i, j))
                break
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pcap")
    ap.add_argument("-o", "--out", help="write the replay file here")
    ap.add_argument("--list", action="store_true", help="show every burst and exit")
    ap.add_argument("--save", type=int, default=-1,
                    help="which save to take, 0-based; default -1 = the last")
    ap.add_argument("--all", action="store_true",
                    help="replay the WHOLE session's control stream, not just one save: every "
                         "frame the PC sent, in order, including the discover, the parameter "
                         "reads and the 0x02/0x11 bursts. Use when a lone save is ignored, on "
                         "the theory that the card wants the session that led up to it")
    ap.add_argument("--max-gap", type=float, default=0.25,
                    help="with --all, cap idle gaps at this many seconds (default 0.25) so a "
                         "99 minute session replays in minutes. Gaps SHORTER than this are "
                         "kept as captured")
    a = ap.parse_args()

    pkts = read_pcap(a.pcap)
    t0 = pkts[0][0]
    bs = bursts_of(pkts)
    sv = saves(bs)

    if a.list:
        rng = {}
        for n, (i, j) in enumerate(sv):
            for k in range(i, j + 1):
                rng[k] = n
        print("%d frames over %.0f s, %d control bursts, %d save(s)"
              % (len(pkts), pkts[-1][0] - t0, len(bs), len(sv)))
        for i, b in enumerate(bs):
            c = collections.Counter(f[12] for _t, f in b)
            tag = ""
            if i in rng:
                tag = "  <== save %d" % rng[i]
            elif is_push(b):
                tag = "  <== push (RAM only)"
            print("%3d  t=%7.1f  n=%4d  %s%s"
                  % (i, b[0][0] - t0, len(b),
                     " ".join("%02x:%d" % (k, v) for k, v in sorted(c.items())), tag))
        return

    if a.all:
        # Everything the PC sent, minus the 60Hz latch. Note LEDVISION STOPS that latch while it
        # writes a configuration (1 frame in the 20 s of a save, against 11.5/s across the
        # session), so dropping it is faithful rather than convenient.
        card = None
        for _t, f in pkts:
            if f[12] == 0x08:
                card = f[6:12]
                break
        sel = [(t, f) for t, f in pkts
               if f[12] != 0x01 and (card is None or f[6:12] != card)]
        print("whole session: %d frames the PC sent, over %.0f s"
              % (len(sel), sel[-1][0] - sel[0][0]))
    else:
        if not sv:
            sys.exit("no flash-commit burst found; run with --list and pick one by hand")
        i, j = sv[a.save]
        sel = [p for b in bs[i:j + 1] for p in b]
        span = sel[-1][0] - sel[0][0]
        print("save %s of %d: bursts %d..%d, %d frames, %.1f s, t=%.1f"
              % (a.save if a.save >= 0 else len(sv) - 1, len(sv), i, j, len(sel), span,
                 sel[0][0] - t0))

    macs = {(f[0:6].hex(":"), f[6:12].hex(":")) for _t, f in sel}
    if len(macs) != 1:
        sys.exit("frames use more than one MAC pair: %s" % macs)
    dst, src = macs.pop()
    print("  %s -> %s" % (src, dst))
    c = collections.Counter(f[12] for _t, f in sel)
    print("  types " + " ".join("%02x:%d" % (k, v) for k, v in sorted(c.items())))

    if not a.out:
        return
    cap = a.max_gap if a.all else 2.0
    body, prev, total = bytearray(), None, 0.0
    for t, f in sel:
        delay = 0.0 if prev is None else min(max(t - prev, 0.0), cap)
        total += delay
        body += struct.pack("<II", len(f), int(delay * 1e6)) + f
        prev = t
    print("  replays in %.0f s (gaps capped at %.2f s)" % (total, cap))
    with open(a.out, "wb") as fh:
        fh.write(MAGIC + struct.pack("<I", len(sel)) + body)
    print("  wrote %s, %d bytes" % (a.out, len(MAGIC) + 4 + len(body)))


if __name__ == "__main__":
    main()
