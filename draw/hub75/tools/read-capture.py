#!/usr/bin/env python3
"""Read a Colorlight/LEDVISION capture: cabinet size, and the burst structure of a session.

    python3 tools/read-capture.py cabinet ../ledvision-config-20260905.pcap
    python3 tools/read-capture.py bursts ../ledvision-config-20260905.pcap

`cabinet` prints the cabinet dimensions out of every 0x08 discover reply. Note the timestamps:
a reading taken BEFORE a session's config write describes the card's OLD cabinet, which is what
made every archived capture report 1280x512 long after the cabinet was 192x64. See
../LEDVISION-CONFIG.md.

`bursts` groups config frames by type, which is how a `Send` (RAM) is told from a `Save` (flash)
and how a UI action is paired to the bytes it produced. A session that emits no config frames at
all wrote nothing to the card -- which is how "Screen Size and Count" was shown to be a
sender-side setting.

Framing follows the Colorlight convention used throughout draw/hub75: the type is the FIRST byte
of the ethertype field and data starts at the second, so d[n] = frame[13+n].
"""
import struct, sys, collections, datetime

NOISE = {0x01, 0x40}            # 60Hz latch and the keepalive poll
BURST_GAP = 2.0

def read_pcap(path):
    d = open(path, "rb").read()
    if len(d) < 24: return []
    magic, = struct.unpack("<I", d[:4])
    if   magic == 0xa1b2c3d4: end, div = "<", 1e6
    elif magic == 0xa1b23c4d: end, div = "<", 1e9
    elif magic == 0xd4c3b2a1: end, div = ">", 1e6
    else: sys.exit("not a classic pcap (magic %08x)" % magic)
    out, off = [], 24
    while off + 16 <= len(d):
        ts, tu, cap, orig = struct.unpack(end + "IIII", d[off:off+16])
        off += 16
        if off + cap > len(d): break
        out.append((ts + tu/div, d[off:off+cap]))
        off += cap
    return out

def rd16(f, i): return f[i] << 8 | f[i+1]
def hhmmss(t):  return datetime.datetime.fromtimestamp(t).strftime("%H:%M:%S")

def cabinets(pkts):
    """Every 0x08 discover reply, with the cabinet dimensions it reports."""
    for t, f in pkts:
        if len(f) > 40 and f[12] == 0x08:
            w, h = rd16(f, 34), rd16(f, 36)     # d[21:24]
            raw = " ".join("%02x" % b for b in f[34:38])
            yield t, w, h, raw

def bursts(pkts):
    """Group config frames into bursts, the way extract-config.py does."""
    cur, last, out = None, None, []
    for t, f in pkts:
        if len(f) < 14: continue
        ty = f[12]
        if ty in NOISE: continue
        if last is None or t - last > BURST_GAP:
            cur = {"t0": t, "types": collections.Counter(), "n": 0}
            out.append(cur)
        cur["types"][ty] += 1
        cur["n"] += 1
        cur["t1"] = t
        last = t
    return out

if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: read-capture.py cabinet|bursts <pcap>")
    mode, path = sys.argv[1], sys.argv[2]
    pkts = read_pcap(path)
    if mode == "cabinet":
        rows = list(cabinets(pkts))
        if not rows: sys.exit("no 0x08 replies in %s (%d frames)" % (path, len(pkts)))
        for t, w, h, raw in rows:
            print("%s  cabinet %4d x %-4d   d[21:24] = %s" % (hhmmss(t), w, h, raw))
    elif mode == "bursts":
        for i, b in enumerate(bursts(pkts)):
            mix = " ".join("0x%02x x%d" % (ty, n) for ty, n in sorted(b["types"].items()))
            print("%2d  %s -> %s  %4d frames   %s"
                  % (i, hhmmss(b["t0"]), hhmmss(b["t1"]), b["n"], mix))
    else:
        sys.exit("usage: read-capture.py cabinet|bursts <pcap>")
