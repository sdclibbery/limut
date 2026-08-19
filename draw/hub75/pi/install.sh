#!/bin/sh
# Install the daemon as a service. Run ON THE PI, from the deployed directory:
#
#   cd /home/pi/limut-hub75 && sudo sh install.sh
#
# deploy.sh install does this for you.
set -e
DIR=$(cd "$(dirname "$0")" && pwd)

[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }

# Keep an existing config: the panel size is a property of the wall, not of this checkout.
if [ ! -f /etc/default/limut-hub75 ]; then
  install -m 644 "$DIR/limut-hub75.default" /etc/default/limut-hub75
  echo "wrote /etc/default/limut-hub75"
else
  echo "kept the existing /etc/default/limut-hub75"
fi

sed "s|^ExecStart=.*|ExecStart=$DIR/limut-hub75 \$HUB75_ARGS|" "$DIR/limut-hub75.service" \
  > /etc/systemd/system/limut-hub75.service

mkdir -p /etc/avahi/services
install -m 644 "$DIR/limut-hub75.avahi.service" /etc/avahi/services/limut-hub75.service
systemctl reload avahi-daemon 2>/dev/null || true

systemctl daemon-reload
systemctl enable limut-hub75
systemctl restart limut-hub75
sleep 1
systemctl --no-pager -l status limut-hub75 | head -12
