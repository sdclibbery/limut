/* colorlight-config.c - write a receiving-card configuration by replaying a captured one.
 *
 *   gcc -O2 -o colorlight-config colorlight-config.c
 *   sudo ./colorlight-config -i eth0 cfg.clcfg          # dry run: says what it would send
 *   sudo ./colorlight-config -i eth0 --write cfg.clcfg  # actually writes the card
 *
 * The configuration is never decoded. LEDVISION wrote the one we want once, in a captured
 * session; ../extract-config.py lifts those frames out of the pcap and this replays them byte
 * for byte, from the Pi, with no Windows anywhere. Our own MACs already match LEDVISION's
 * (see pi/output_colorlight.c), so what goes on the wire is indistinguishable from the original.
 *
 * Verifying a write, which is less obvious than it looks: replaying the configuration the card
 * ALREADY HOLDS changes nothing, so reading back "no change" is equally consistent with the write
 * having worked and with it having been ignored. That mistake cost a whole session here. To test
 * this tool rather than the card, write a DIFFERENT configuration and read a parameter back —
 * `reg 4c` moved 0x1f <-> 0x02 between the two saves in the reference capture, both ways.
 *
 * Safety, in the order it matters:
 *   - Writing a CONFIGURATION cannot brick the card; only LEDVISION's firmware upgrade can, and
 *     nothing here sends one. A wrong configuration is a garbage picture and a resend.
 *   - A wrong SCAN configuration can over-drive the panels, which is a heating problem for them.
 *     Configure with the panels dim or dark, and do not leave a garbled pattern running.
 *   - Nothing else may be driving the card while this runs: a 60Hz pixel stream interleaved with
 *     a configuration write is not what was captured. --write refuses if the link is down and
 *     warns if frames are already flowing.
 *
 * The file format is whatever extract-config.py writes: "CLCFG1\n\0", a u32 frame count, then
 * per frame a u32 length, a u32 microsecond delay from the previous frame, and the raw bytes.
 * The delays are the capture's own: LEDVISION paces the burst, and there is no reason to assume
 * the card tolerates it arriving faster.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#ifdef __linux__
#include <arpa/inet.h>
#include <linux/if_packet.h>
#include <net/if.h>
#include <netinet/ether.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <time.h>
#endif

#define MAGIC     "CLCFG1\n"
#define MAGIC_LEN 8
#define MAX_FRAME 2048

static const unsigned char CARD_MAC[6] = { 0x11, 0x22, 0x33, 0x44, 0x55, 0x66 };

typedef struct { unsigned len, delay; unsigned char *bytes; } cfgframe;

static const char *USAGE =
    "replay a captured Colorlight receiving-card configuration\n"
    "\n"
    "  colorlight-config [-i IFACE] [--write] [-q] FILE.clcfg\n"
    "\n"
    "  -i IFACE   interface the card is cabled to (default eth0)\n"
    "  --write    actually send. Without it this is a dry run that only reports\n"
    "  -q         one line per 25 frames instead of per frame\n"
    "\n"
    "Generate FILE.clcfg with extract-config.py from a LEDVISION capture.\n";

static int read_cfg(const char *path, cfgframe **out, unsigned *n) {
    unsigned char hdr[MAGIC_LEN + 4];
    unsigned i, count;
    cfgframe *f;
    FILE *fh = fopen(path, "rb");
    if (!fh) { fprintf(stderr, "🔴 %s: %s\n", path, strerror(errno)); return -1; }
    if (fread(hdr, 1, sizeof hdr, fh) != sizeof hdr ||
        memcmp(hdr, MAGIC, MAGIC_LEN - 1) != 0) {
        fprintf(stderr, "🔴 %s is not a .clcfg replay file\n", path);
        fclose(fh);
        return -1;
    }
    memcpy(&count, hdr + MAGIC_LEN, 4);
    if (count == 0 || count > 100000) {
        fprintf(stderr, "🔴 %s claims %u frames\n", path, count);
        fclose(fh);
        return -1;
    }
    f = (cfgframe *)calloc(count, sizeof *f);
    if (!f) { fclose(fh); return -1; }
    for (i = 0; i < count; i++) {
        unsigned hd[2];
        if (fread(hd, 4, 2, fh) != 2) goto trunc;
        f[i].len = hd[0]; f[i].delay = hd[1];
        if (f[i].len < 14 || f[i].len > MAX_FRAME) {
            fprintf(stderr, "🔴 frame %u has length %u\n", i, f[i].len);
            fclose(fh);
            return -1;
        }
        f[i].bytes = (unsigned char *)malloc(f[i].len);
        if (!f[i].bytes || fread(f[i].bytes, 1, f[i].len, fh) != f[i].len) goto trunc;
    }
    fclose(fh);
    *out = f; *n = count;
    return 0;
trunc:
    fprintf(stderr, "🔴 %s is truncated\n", path);
    fclose(fh);
    return -1;
}

/* A configuration is only meaningful to the card it was captured from, and only if it really is
 * a configuration. Both are cheap to check before anything is sent. */
static int describe(const cfgframe *f, unsigned n) {
    unsigned counts[256], i, bad = 0;
    double secs = 0;
    memset(counts, 0, sizeof counts);
    for (i = 0; i < n; i++) {
        counts[f[i].bytes[12]]++;
        secs += f[i].delay / 1e6;
        if (memcmp(f[i].bytes, CARD_MAC, 6) != 0) bad++;
    }
    printf("  %u frames, %.1f s as paced\n", n, secs);
    printf("  types ");
    for (i = 0; i < 256; i++) if (counts[i]) printf("%02x:%u ", i, counts[i]);
    printf("\n");
    if (bad) {
        fprintf(stderr, "🔴 %u frames are not addressed to the card MAC\n", bad);
        return -1;
    }
    /* 0x17 is the config header, 0x1b the per-module records, 0x19 the flash-commit tail. */
    if (!counts[0x17] || !counts[0x1b]) {
        fprintf(stderr, "🔴 no 0x17 header or 0x1b records — this is not a configuration\n");
        return -1;
    }
    if (!counts[0x19])
        fprintf(stderr, "🟡 no 0x19 tail: this looks like a RAM-only push, not a flash commit\n");
    return 0;
}

#ifdef __linux__
static long read_stat(const char *iface, const char *stat) {
    char path[256], buf[64];
    long v = -1;
    FILE *fh;
    snprintf(path, sizeof path, "/sys/class/net/%s/%s", iface, stat);
    fh = fopen(path, "r");
    if (!fh) return -1;
    if (fgets(buf, sizeof buf, fh)) v = atol(buf);
    fclose(fh);
    return v;
}

static int send_all(const char *iface, cfgframe *f, unsigned n, int quiet) {
    struct sockaddr_ll to;
    struct ifreq ifr;
    unsigned i;
    int fd = socket(AF_PACKET, SOCK_RAW, htons(ETH_P_ALL));
    if (fd < 0) {
        fprintf(stderr, "🔴 socket(AF_PACKET): %s%s\n", strerror(errno),
                errno == EPERM ? " — run with sudo" : "");
        return -1;
    }
    memset(&ifr, 0, sizeof ifr);
    snprintf(ifr.ifr_name, IFNAMSIZ, "%s", iface);
    if (ioctl(fd, SIOCGIFINDEX, &ifr) < 0) {
        fprintf(stderr, "🔴 no interface '%s': %s\n", iface, strerror(errno));
        close(fd);
        return -1;
    }
    memset(&to, 0, sizeof to);
    to.sll_family   = AF_PACKET;
    to.sll_ifindex  = ifr.ifr_ifindex;
    to.sll_halen    = 6;
    memcpy(to.sll_addr, CARD_MAC, 6);

    for (i = 0; i < n; i++) {
        if (f[i].delay) {
            struct timespec ts;
            ts.tv_sec  = f[i].delay / 1000000;
            ts.tv_nsec = (long)(f[i].delay % 1000000) * 1000;
            nanosleep(&ts, NULL);
        }
        if (sendto(fd, f[i].bytes, f[i].len, 0, (struct sockaddr *)&to, sizeof to) < 0) {
            fprintf(stderr, "\n🔴 frame %u (type 0x%02x): %s\n", i, f[i].bytes[12],
                    strerror(errno));
            close(fd);
            return -1;
        }
        if (!quiet || i % 25 == 0 || i == n - 1) {
            printf("\r  sent %u/%u  (type 0x%02x)      ", i + 1, n, f[i].bytes[12]);
            fflush(stdout);
        }
    }
    printf("\n");
    close(fd);
    return 0;
}
#endif

int main(int argc, char **argv) {
    const char *iface = "eth0", *path = NULL;
    int write = 0, quiet = 0, i;
    cfgframe *f = NULL;
    unsigned n = 0;

    for (i = 1; i < argc; i++) {
        const char *k = argv[i];
        if (!strcmp(k, "-i") && i + 1 < argc) { iface = argv[++i]; }
        else if (!strcmp(k, "--write")) write = 1;
        else if (!strcmp(k, "-q")) quiet = 1;
        else if (!strcmp(k, "-h") || !strcmp(k, "--help")) { fputs(USAGE, stdout); return 0; }
        else if (k[0] != '-' && !path) path = k;
        else { fprintf(stderr, "🔴 unknown argument %s\n\n%s", k, USAGE); return 2; }
    }
    if (!path) { fputs(USAGE, stderr); return 2; }

    if (read_cfg(path, &f, &n) < 0) return 1;
    printf("colorlight-config: %s\n", path);
    if (describe(f, n) < 0) return 1;

#ifdef __linux__
    {
        long carrier = read_stat(iface, "carrier");
        long tx0, tx1;
        printf("  interface %s, link %s\n", iface,
               carrier == 1 ? "up" : carrier == 0 ? "DOWN" : "unknown");
        if (write && carrier == 0) {
            fprintf(stderr, "🔴 %s has no carrier; nothing would reach the card\n", iface);
            return 1;
        }
        /* A configuration write interleaved with someone else's 60Hz pixel stream is not what
         * was captured. Cheap to notice, and it is always a mistake. */
        tx0 = read_stat(iface, "statistics/tx_packets");
        usleep(300000);
        tx1 = read_stat(iface, "statistics/tx_packets");
        if (tx0 >= 0 && tx1 - tx0 > 30) {
            fprintf(stderr, "🔴 %ld packets/s are already going out of %s — stop the display "
                            "daemon first (sudo systemctl stop limut-hub75)\n",
                    (tx1 - tx0) * 3, iface);
            return 1;
        }
    }
    if (!write) {
        printf("\n  dry run — nothing sent. Add --write to configure the card.\n");
        return 0;
    }
    printf("\n  writing the card's configuration...\n");
    if (send_all(iface, f, n, quiet) < 0) return 1;
    printf("\n✅ replayed. Check it with: sudo ./colorlight-probe -i %s -t 5000\n", iface);
    printf("   Then drive the panels and look. Note the discover reply does NOT report the\n"
           "   configured geometry, and re-reading parameters proves nothing if this was the\n"
           "   configuration the card already held — that read is a no-op either way.\n");
    return 0;
#else
    (void)iface; (void)quiet;
    printf("\n  (not Linux: parsed and checked only, nothing can be sent from here)\n");
    return write ? 1 : 0;
#endif
}
