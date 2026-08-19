#!/bin/sh
# Copy this directory to the Pi and build it there.
#
# Building natively rather than cross compiling: C compiles in seconds even on a 1 GB 4B, the
# EGL/GBM headers are the exact ones on the target, and there is no sysroot to keep in sync.
#
#   sh deploy.sh              copy, build, run the selftest
#   sh deploy.sh run          the above, then run the daemon in the foreground
#   sh deploy.sh restart      the above, then restart the systemd service
#   sh deploy.sh install      the above, then install and start it as a systemd service
#
# Overridable: HUB75_HOST, HUB75_KEY, HUB75_DIR, HUB75_ARGS
set -e

HOST=${HUB75_HOST:-pi@hub75-01.local}
KEY=${HUB75_KEY:-$HOME/.ssh/id_ed25519_hub75}
DIR=${HUB75_DIR:-/home/pi/limut-hub75}
ARGS=${HUB75_ARGS:---name hub75-01 --size 128x64 --output raw}
SRC=$(cd "$(dirname "$0")" && pwd)

SSH="ssh -i $KEY -o ConnectTimeout=10"

echo "==> $HOST:$DIR"
$SSH "$HOST" "mkdir -p $DIR"
rsync -az --delete -e "$SSH" \
  --exclude 'limut-hub75' --exclude 'selftest' --exclude 'egl-probe' --exclude '*.o' \
  "$SRC/" "$HOST:$DIR/"
# ../tools/egl-probe.c is the board's known-good GPU baseline and the Makefile can build it
$SSH "$HOST" "mkdir -p $(dirname $DIR)/tools"
rsync -az -e "$SSH" "$SRC/../tools/" "$HOST:$(dirname $DIR)/tools/"

echo "==> building"
$SSH "$HOST" "cd $DIR && make -s clean && make -s all selftest"

echo "==> selftest"
$SSH "$HOST" "cd $DIR && ./selftest"

case "$1" in
  run)     echo "==> running"; $SSH -t "$HOST" "cd $DIR && ./limut-hub75 $ARGS" ;;
  install) echo "==> installing the service"; $SSH "$HOST" "cd $DIR && sudo sh install.sh" ;;
  restart) echo "==> restarting service"; $SSH "$HOST" "sudo systemctl restart limut-hub75 && sleep 1 && systemctl --no-pager -l status limut-hub75 | head -20" ;;
esac
