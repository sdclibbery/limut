/*
 * colorlight-probe.c - first contact with a Colorlight 5A-75B receiving card.
 *
 * Asks the card what it is and what panel geometry it currently believes it is driving, so that
 * "does this card need to be configured with LEDVISION at all?" can be answered before anything
 * is written to it.
 *
 * NOTHING HERE MODIFIES THE CARD. Discovery is a query: the card's flash, its configuration and
 * its firmware are untouched whatever this prints. Safe to run against a card in any state.
 *
 * OFFSET CONVENTION. The Colorlight protocol puts the packet type in the FIRST byte of the
 * ethertype field and treats the SECOND byte as the first byte of data. So what a packet sniffer
 * shows as "ethertype 0x0805" is really type 0x08, data[0] = 0x05. Every offset here is written
 * as `d[n]`, data-relative, where d = frame + 13 - the same convention the upstream reverse
 * engineering uses, so the two can be compared without an off-by-one.
 *
 *   host -> card   type 0x07, 284 byte frame, d[3] = receiver number     "receiver n, are you there?"
 *   card -> bcast  type 0x08, 1070 byte frame                            firmware, geometry, counters
 *
 * Receivers are enumerated by asking for 0, 1, 2 ... until one does not answer.
 *
 * The card has a FIXED MAC (11:22:33:44:55:66) and answers to broadcast, which is why only one
 * stock card can live on a segment, and why eth0 is configured unmanaged with no DHCP and no
 * address (see draw/hub75/CLAUDE.md). Keep the card on a point-to-point cable.
 *
 * THE FIELD OFFSETS ARE NOT OURS AND ARE NOT VERIFIED BY US. They come from the protocol notes at
 * the top of FPP's src/channeloutput/ColorLight-5a-75.cpp, cross-checked against Harald Kubota's
 * write-up (hkubota.wordpress.com, 2022-01-31). Those two disagree about where the receiver
 * number lives, and FPP's own notes doubt the geometry fields. That is why this hex-dumps the
 * whole reply as well as interpreting it: with a real card in hand, believe the dump and correct
 * the decode, not the other way round.
 *
 * Read for the wire format only; no code is taken from FPP, which is GPL where limut is CC BY-SA.
 *
 * Build: gcc -O2 -o colorlight-probe colorlight-probe.c
 * Run:   ./colorlight-probe [-i eth0] [-t ms] [-n count] [-f]
 *
 * Linux only - it needs AF_PACKET. Needs CAP_NET_RAW, so either run it with sudo or
 *   sudo setcap cap_net_raw+ep ./colorlight-probe
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <unistd.h>
#include <poll.h>
#include <time.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <net/if.h>
#include <netinet/in.h>
#include <linux/if_packet.h>
#include <linux/if_ether.h>

#define TYPE_DISCOVER   0x07
#define TYPE_REPLY      0x08
#define DISCOVER_FRAME  284    /* 13 header + 271 data */
#define REPLY_FRAME     1070   /* 13 header + 1057 data */
#define DATA_OFF        13     /* the type byte is at 12; data starts in the ethertype's low byte */
#define FRAME_CAP       2048
#define MAX_RECEIVERS   32

/* The stock card's fixed MAC, and the source MAC LEDVISION and FPP both use. */
static const unsigned char CARD_MAC[6] = { 0x11, 0x22, 0x33, 0x44, 0x55, 0x66 };
static const unsigned char HOST_MAC[6] = { 0x22, 0x22, 0x33, 0x44, 0x55, 0x66 };

static long now_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1000L + ts.tv_nsec / 1000000L;
}

/* Reads one line of /sys/class/net/<iface>/<attr>. NULL if it cannot be read. */
static const char *sysattr(const char *iface, const char *attr, char *buf, size_t cap) {
    char path[256];
    snprintf(path, sizeof path, "/sys/class/net/%s/%s", iface, attr);
    FILE *f = fopen(path, "r");
    if (!f) return NULL;
    if (!fgets(buf, (int)cap, f)) { fclose(f); return NULL; }
    fclose(f);
    buf[strcspn(buf, "\r\n")] = 0;
    return buf;
}

static void print_mac(const unsigned char *m) {
    printf("%02x:%02x:%02x:%02x:%02x:%02x", m[0], m[1], m[2], m[3], m[4], m[5]);
}

static void hexdump(const unsigned char *p, int n, int base) {
    for (int i = 0; i < n; i += 16) {
        printf("    %04x  ", base + i);
        for (int j = 0; j < 16; j++) {
            if (i + j < n) printf("%02x ", p[i + j]); else printf("   ");
            if (j == 7) printf(" ");
        }
        printf(" |");
        for (int j = 0; j < 16 && i + j < n; j++) {
            unsigned char c = p[i + j];
            putchar(c >= 32 && c < 127 ? c : '.');
        }
        printf("|\n");
    }
}

static int all_zero(const unsigned char *p, int from, int n) {
    for (int i = from; i < n; i++) if (p[i]) return 0;
    return 1;
}

static unsigned rd16(const unsigned char *d, int off) { return (unsigned)d[off] << 8 | d[off + 1]; }
static unsigned long rd32(const unsigned char *d, int off) {
    return (unsigned long)d[off] << 24 | (unsigned long)d[off + 1] << 16 |
           (unsigned long)d[off + 2] << 8 | d[off + 3];
}

/* `d` points at data, i.e. frame byte 13. `len` is the data length. */
static void decode(const unsigned char *d, int len) {
    printf("\n  Decoded (offsets are data-relative and UNVERIFIED - check them against the dump):\n");
    if (len < 90) { printf("    only %d data bytes, too short to decode\n", len); return; }

    printf("    d[0]  card marker      0x%02x%s\n", d[0],
           d[0] == 0x05 ? "   (0x05 = 5A series)" : "   (expected 0x05 for a 5A)");
    printf("    d[1]                   0x%02x   (meaning unknown)\n", d[1]);
    printf("    d[2:3] firmware        %u.%u\n", d[2], d[3]);

    unsigned w = rd16(d, 21), h = rd16(d, 23);
    printf("    d[21:24] cabinet size  %u x %u pixels", w, h);
    if (w == 0 || h == 0)
        printf("   <-- ZERO: no usable panel configuration");
    else if (w > 4096 || h > 4096)
        printf("   <-- implausible: suspect the decode, not the card");
    printf("\n");

    printf("    d[38:41] packets rx    %lu\n", rd32(d, 38));
    printf("    d[46:49] uptime        %lu ms\n", rd32(d, 46));
    printf("    d[85] receiver number  %u\n", d[85]);
    printf("      (Harald's notes put the receiver number at d[63] = 0x%02x instead; whichever\n"
           "       tracks the number we asked for is the right one.)\n", d[63]);
}

static void usage(void) {
    fprintf(stderr,
        "usage: colorlight-probe [-i IFACE] [-t MS] [-n COUNT] [-f]\n"
        "  -i IFACE   interface the card is cabled to (default eth0)\n"
        "  -t MS      how long to wait for each reply (default 500)\n"
        "  -n COUNT   how many receiver numbers to try (default 4)\n"
        "  -f         dump all 1057 data bytes, not just the first 128\n");
}

int main(int argc, char **argv) {
    const char *iface = "eth0";
    int timeout = 500, want = 4, full = 0;

    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "-i") && i + 1 < argc) iface = argv[++i];
        else if (!strcmp(argv[i], "-t") && i + 1 < argc) timeout = atoi(argv[++i]);
        else if (!strcmp(argv[i], "-n") && i + 1 < argc) want = atoi(argv[++i]);
        else if (!strcmp(argv[i], "-f")) full = 1;
        else { usage(); return 2; }
    }
    if (want < 1) want = 1;
    if (want > MAX_RECEIVERS) want = MAX_RECEIVERS;

    printf("colorlight-probe: querying %s for receiving cards (nothing is written)\n\n", iface);

    int fd = socket(AF_PACKET, SOCK_RAW, htons(ETH_P_ALL));
    if (fd < 0) {
        fprintf(stderr, "socket(AF_PACKET): %s\n", strerror(errno));
        if (errno == EPERM)
            fprintf(stderr, "  raw sockets need CAP_NET_RAW - run with sudo, or\n"
                            "  sudo setcap cap_net_raw+ep %s\n", argv[0]);
        return 1;
    }

    struct ifreq ifr;
    memset(&ifr, 0, sizeof ifr);
    snprintf(ifr.ifr_name, IFNAMSIZ, "%s", iface);
    if (ioctl(fd, SIOCGIFINDEX, &ifr) < 0) {
        fprintf(stderr, "no such interface '%s': %s\n", iface, strerror(errno));
        close(fd);
        return 1;
    }
    int ifindex = ifr.ifr_ifindex;

    /* Link state first. An unplugged, unpowered or badly cabled card looks exactly like a card
     * that is not answering, and this separates the two before anything is sent. */
    char b1[64], b2[64], b3[64];
    const char *oper = sysattr(iface, "operstate", b1, sizeof b1);
    const char *carrier = sysattr(iface, "carrier", b2, sizeof b2);
    const char *speed = sysattr(iface, "speed", b3, sizeof b3);
    printf("  interface   %s (index %d)\n  link        %s", iface, ifindex, oper ? oper : "unknown");
    if (carrier && !strcmp(carrier, "0")) printf(", NO CARRIER (nothing on the other end)");
    if (speed) printf(", %s Mb/s", speed);
    printf("\n");
    if (oper && strcmp(oper, "up") != 0)
        printf("\n  %s is not up. Bring it up - it needs no IP address, the card does not\n"
               "  speak IP:   sudo ip link set %s up\n", iface, iface);

    struct sockaddr_ll bindaddr;
    memset(&bindaddr, 0, sizeof bindaddr);
    bindaddr.sll_family = AF_PACKET;
    bindaddr.sll_protocol = htons(ETH_P_ALL);
    bindaddr.sll_ifindex = ifindex;
    if (bind(fd, (struct sockaddr *)&bindaddr, sizeof bindaddr) < 0) {
        fprintf(stderr, "bind: %s\n", strerror(errno));
        close(fd);
        return 1;
    }

    struct sockaddr_ll to;
    memset(&to, 0, sizeof to);
    to.sll_family = AF_PACKET;
    to.sll_ifindex = ifindex;
    to.sll_halen = 6;
    memcpy(to.sll_addr, CARD_MAC, 6);

    int found = 0, nother = 0;

    for (int r = 0; r < want; r++) {
        unsigned char frame[DISCOVER_FRAME];
        memset(frame, 0, sizeof frame);
        memcpy(frame, CARD_MAC, 6);
        memcpy(frame + 6, HOST_MAC, 6);
        frame[12] = TYPE_DISCOVER;
        frame[DATA_OFF + 3] = (unsigned char)r;   /* d[3] = which receiver we are asking for */

        printf("\n  -> discover receiver %d (type 0x%02x, %d byte frame)\n",
               r, TYPE_DISCOVER, DISCOVER_FRAME);
        if (sendto(fd, frame, sizeof frame, 0, (struct sockaddr *)&to, sizeof to) < 0) {
            fprintf(stderr, "     sendto: %s\n", strerror(errno));
            close(fd);
            return 1;
        }

        int got = 0;
        long deadline = now_ms() + timeout;
        while (!got) {
            long left = deadline - now_ms();
            if (left <= 0) break;

            struct pollfd pfd = { .fd = fd, .events = POLLIN, .revents = 0 };
            int pr = poll(&pfd, 1, (int)left);
            if (pr < 0) { if (errno == EINTR) continue; break; }
            if (pr == 0) break;

            unsigned char rx[FRAME_CAP];
            ssize_t n = recv(fd, rx, sizeof rx, 0);
            if (n < DATA_OFF + 1) continue;

            /* A reply is type 0x08 from the card's fixed MAC. Match on those, not on the
             * ethertype as a whole - its low byte is data, not part of the type. */
            if (rx[12] != TYPE_REPLY || memcmp(rx + 6, CARD_MAC, 6) != 0) {
                if (memcmp(rx + 6, HOST_MAC, 6) != 0) nother++;
                continue;
            }

            got = 1;
            found++;
            int dlen = (int)n - DATA_OFF;
            printf("  <- reply from ");
            print_mac(rx + 6);
            printf(" to ");
            print_mac(rx);
            printf(", %d byte frame\n", (int)n);
            if (n != REPLY_FRAME)
                printf("     (expected %d; a different length means a different firmware)\n",
                       REPLY_FRAME);

            int show = full ? dlen : (dlen < 128 ? dlen : 128);
            printf("\n  Data (d[0] is frame byte %d):\n", DATA_OFF);
            hexdump(rx + DATA_OFF, show, 0);
            if (!full && show < dlen)
                printf("    ... %d more bytes%s, -f to see them\n", dlen - show,
                       all_zero(rx + DATA_OFF, show, dlen) ? ", all zero" : "");

            decode(rx + DATA_OFF, dlen);
        }

        if (!got) {
            printf("  <- no reply\n");
            break;   /* receivers are numbered contiguously: the first gap is the end */
        }
    }

    close(fd);
    printf("\n");

    if (found == 0) {
        printf("  No card answered.\n\n"
               "  In rough order of likelihood:\n"
               "    - the card is unpowered, or the link is down (see the link line above)\n"
               "    - it is cabled to a different interface than %s\n"
               "    - a switch or bridge in the path is eating the broadcast reply; the card\n"
               "      wants a point-to-point cable\n"
               "    - the firmware wants something this discover packet does not send\n", iface);
        if (nother)
            printf("    NOTE: %d frame(s) from other senders arrived on %s, so the interface is\n"
                   "      live but is not alone on the segment.\n", nother, iface);
        return 1;
    }

    printf("  %d receiver%s answered.\n", found, found == 1 ? "" : "s");
    return 0;
}
