# limut HUB75 display daemon.
#
# Built natively on the Pi (see deploy.sh): C compiles in seconds even on a 1 GB 4B, the EGL/GBM
# headers are the exact ones on the target, and there is no sysroot to keep in sync.
#
# On a machine with no EGL/GBM — a Mac, say — the GLES half of render.c is compiled out and the
# daemon still runs, serving the whole protocol with no rendering. That is what makes it possible
# to develop and test against mock/selftest.js without touching the hardware.

CC      ?= cc
# gnu99, not c99: glibc hides clock_gettime, strdup, popen and memmem behind feature test macros,
# and -std=c99 turns every one of them into an implicit declaration on the Pi while compiling
# cleanly on macOS. A build that only breaks on the target is worse than no standard at all.
CFLAGS  ?= -O2 -Wall -Wextra -std=gnu99
LDLIBS  += -lm

UNAME   := $(shell uname -s)
ifeq ($(UNAME),Linux)
  GLES ?= 1
endif

ifeq ($(GLES),1)
  CFLAGS += -DHUB75_GLES
  LDLIBS += -lEGL -lGLESv2 -lgbm
endif

COMMON  = json.c sha1.c sha256.c base64.c codec.c glsl.c ws.c cache.c \
          output.c output_colorlight.c patterns.c render.c
DAEMON  = main.c net.c session.c
BIN     = limut-hub75

.PHONY: all clean test install

all: $(BIN)

$(BIN): $(DAEMON) $(COMMON) *.h
	$(CC) $(CFLAGS) -o $@ $(DAEMON) $(COMMON) $(LDLIBS)

selftest: selftest.c $(COMMON) *.h
	$(CC) $(CFLAGS) -o $@ selftest.c $(COMMON) $(LDLIBS)

test: selftest
	./selftest

# The GPU capability probe that established this board can run limut's shaders at all. Worth
# re-running after an OS upgrade; see ../CLAUDE.md.
egl-probe: ../tools/egl-probe.c
	$(CC) $(CFLAGS) -o $@ ../tools/egl-probe.c -lEGL -lGLESv2 -lgbm

# Read-only first contact with a Colorlight 5A-75B: what it is, and what geometry it is
# configured for. Linux only — it needs AF_PACKET. See ../CLAUDE.md and README.md.
colorlight-probe: ../tools/colorlight-probe.c
	$(CC) $(CFLAGS) -o $@ ../tools/colorlight-probe.c

# Writes a receiving-card configuration by replaying one captured from LEDVISION, so the card
# can be configured from the Pi with no Windows machine. Linux only. See ../LEDVISION-CONFIG.md.
colorlight-config: ../tools/colorlight-config.c
	$(CC) $(CFLAGS) -o $@ ../tools/colorlight-config.c

clean:
	rm -f $(BIN) selftest egl-probe colorlight-probe colorlight-config
