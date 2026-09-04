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

# WiFi power save. The limut link is wlan0 (eth0 belongs to the Colorlight card and has no IP),
# and a dozing station has its downlink buffered at the AP until the next DTIM beacon -- about
# 100 ms here, or six frames of a 60 Hz uniform stream, delivered as one burst that
# last-write-wins then collapses to a single drawn frame.
#
# CLAUDE.md claimed this was disabled from the start. It never was: NetworkManager leaves
# 802-11-wireless.powersave at `default`, which is the driver's default of ON. A conf.d drop-in
# rather than `nmcli connection modify` so it survives the connection profile being
# re-provisioned. Measured effect on this wall is real but small -- see CLAUDE.md.
mkdir -p /etc/NetworkManager/conf.d
cat > /etc/NetworkManager/conf.d/wifi-powersave-off.conf <<'EOF'
[connection]
wifi.powersave = 2
EOF
systemctl reload NetworkManager 2>/dev/null || true
iw dev wlan0 set power_save off 2>/dev/null || true

mkdir -p /etc/avahi/services
install -m 644 "$DIR/limut-hub75.avahi.service" /etc/avahi/services/limut-hub75.service
systemctl reload avahi-daemon 2>/dev/null || true

systemctl daemon-reload
systemctl enable limut-hub75
systemctl restart limut-hub75
sleep 1
systemctl --no-pager -l status limut-hub75 | head -12
