#!/bin/sh
# Install the daemon as a service. Run ON THE PI, from the deployed directory:
#
#   cd /home/pi/limut-hub75 && sudo sh install.sh
#
# deploy.sh install does this for you.
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
REBOOT_NEEDED=0

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

# ---------------------------------------------------------------------------------------------
# The USB-C link. PROTOCOL.md §3.2, and draw/hub75/CLAUDE.md "Why the wall is jerky".
#
# WiFi delivers the 60 Hz uniform stream in bursts -- about two stalls of 100-200 ms per second --
# and §12.1's last-write-wins collapses each catch-up burst into one drawn frame. Measured, not
# guessed: the host sends 1015 of 1015 on time and the same stream is perfect over the Pi's own
# loopback. `eth0` cannot be the wired link because it belongs to the Colorlight card and has no
# IP, so the USB-C port becomes a second interface via gadget mode. Nothing above TCP changes.
# ---------------------------------------------------------------------------------------------

BOOTDIR=/boot/firmware
[ -d "$BOOTDIR" ] || BOOTDIR=/boot

# dwc2 in PERIPHERAL mode. Note the dwc2 lines already in config.txt sit under [cm4] and [cm5]
# filters and do not apply to a Pi 4B, so there is nothing to undo -- but appending our own [all]
# is what guarantees this one is unconditional whatever section the file happened to end in.
if ! grep -q '^dtoverlay=dwc2,dr_mode=peripheral' "$BOOTDIR/config.txt"; then
  cp -n "$BOOTDIR/config.txt" "$BOOTDIR/config.txt.pre-hub75usb" 2>/dev/null || true
  cat >> "$BOOTDIR/config.txt" <<'EOF'

# limut hub75: the USB-C port is the wired link to limut (PROTOCOL.md §3.2). Peripheral mode, so
# the Pi enumerates as a CDC ethernet device on the laptop. This stops it being a host port.
[all]
dtoverlay=dwc2,dr_mode=peripheral
EOF
  echo "config.txt: added dtoverlay=dwc2,dr_mode=peripheral"
  REBOOT_NEEDED=1
else
  echo "config.txt: dwc2 peripheral overlay already present"
fi

# dwc2 has to be loaded early enough for the gadget unit to find a UDC.
if ! grep -q 'modules-load=.*dwc2' "$BOOTDIR/cmdline.txt"; then
  cp -n "$BOOTDIR/cmdline.txt" "$BOOTDIR/cmdline.txt.pre-hub75usb" 2>/dev/null || true
  # One line, and it must stay one line -- a newline here makes the Pi unbootable.
  if grep -q 'modules-load=' "$BOOTDIR/cmdline.txt"; then
    sed -i 's/\(modules-load=[^ ]*\)/\1,dwc2/' "$BOOTDIR/cmdline.txt"
  else
    sed -i '1s/$/ modules-load=dwc2/' "$BOOTDIR/cmdline.txt"
  fi
  tr -d '\n' < "$BOOTDIR/cmdline.txt" > "$BOOTDIR/cmdline.txt.tmp"
  printf '\n' >> "$BOOTDIR/cmdline.txt.tmp"
  mv "$BOOTDIR/cmdline.txt.tmp" "$BOOTDIR/cmdline.txt"
  echo "cmdline.txt: added modules-load=dwc2"
  REBOOT_NEEDED=1
else
  echo "cmdline.txt: dwc2 already in modules-load"
fi

# The receiving card holds its own configuration in flash (set via LEDVISION, 2026-09-05). There
# is no boot-time card reconfiguration: colorlight-config remains as a manual tool only.

chmod +x "$DIR/usb-gadget.sh"
sed -e "s|^ExecStart=.*|ExecStart=$DIR/usb-gadget.sh start|" \
    -e "s|^ExecStop=.*|ExecStop=$DIR/usb-gadget.sh stop|" \
    "$DIR/limut-hub75-gadget.service" > /etc/systemd/system/limut-hub75-gadget.service

# Raspberry Pi OS ships /usr/lib/udev/rules.d/85-nm-unmanaged.rules, which marks USB gadget
# interfaces as NetworkManager-unmanaged -- it assumes the classic dhcpcd Pi Zero recipe. Without
# this override usb0 comes up DOWN and unmanaged, `nmcli device status` says "unmanaged (77: via
# udev rule)", and the hub75-usb connection never activates however correct it is.
cat > /etc/NetworkManager/conf.d/hub75-usb0-managed.conf <<'EOF'
# limut hub75: usb0 is our link to limut, so NetworkManager must manage it.
[device-hub75-usb0]
match-device=interface-name:usb0
managed=1
EOF

# An address on usb0, and DHCP so the laptop needs no configuration at all. `shared` is what
# gives both: 10.42.0.1/24 on this end, and NetworkManager's own dnsmasq on the wire.
if nmcli -t -f NAME con show 2>/dev/null | grep -qx hub75-usb; then
  echo "NetworkManager: kept the existing hub75-usb connection"
else
  # ipv6.method DISABLED, not `ignore`. `ignore` leaves IPv6 alone, so the kernel autogenerates a
  # link-local and avahi publishes it -- see the use-ipv6 note below for why that breaks Electron.
  nmcli con add type ethernet ifname usb0 con-name hub75-usb \
    ipv4.method shared ipv6.method disabled connection.autoconnect yes >/dev/null
  echo "NetworkManager: added the hub75-usb connection (10.42.0.1/24, shared)"
fi

# Not optional. `shared` would otherwise hand the laptop a default route and a DNS server, and
# macOS is happy to rank a freshly appeared WIRED service above WiFi -- at which point the whole
# laptop's internet is being routed through the Pi's WiFi, which is the link we are here to stop
# using. Empty options 3 and 6 say "no router, no DNS": address only.
mkdir -p /etc/NetworkManager/dnsmasq-shared.d
cat > /etc/NetworkManager/dnsmasq-shared.d/hub75-no-default.conf <<'EOF'
# limut hub75: address the laptop, but never become its route to the world.
dhcp-option=3
dhcp-option=6
EOF

# WiFi power save. The limut link is now usb0, but wlan0 stays associated as the way back in when
# the cable is out, so this is still worth setting -- and it was measured (small but real).
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

# ONE name, ONE path. Without this, once usb0 exists `hub75-01.local` resolves to both the USB and
# the WiFi address, and the browser is free to pick either -- so the wall could sit on the jittery
# link with the cable plugged in and nothing to show for it. Restricting the advertisement is what
# makes `display='hub75-01'` mean the USB link, with no change to limut or to any example.
#
# wlan0 stays UP, just unadvertised: ssh to its address is the way back in. Because the name no
# longer resolves over WiFi, give the Pi a DHCP reservation on the router, or a moved lease leaves
# the router's client list as the only way to find it.
#
# Applied only once usb0 actually exists. Doing it before the reboot that creates the interface
# would make the Pi unreachable BY NAME with nothing yet to replace it -- including for deploy.sh.
if ip link show usb0 >/dev/null 2>&1; then
  if grep -q '^allow-interfaces=' /etc/avahi/avahi-daemon.conf; then
    sed -i 's/^allow-interfaces=.*/allow-interfaces=usb0/' /etc/avahi/avahi-daemon.conf
  else
    sed -i 's/^\[server\]/[server]\nallow-interfaces=usb0/' /etc/avahi/avahi-daemon.conf
  fi
  # Publish the A record only. The ONLY IPv6 address on a point-to-point usb0 is a LINK LOCAL
  # one, and `fe80::...` is useless to a browser: a URL has nowhere to put the zone id (%en6)
  # that makes a link-local address routable. getaddrinfo returns the AAAA FIRST, so Electron
  # and Chrome resolve the name, get fe80::, and fail to connect -- while curl and ping still
  # work, because they fall back, which makes it look like the display is fine. Over WiFi this
  # never bit: that AAAA was a ULA (fdd8:...), globally scoped and perfectly usable.
  #
  # Note this line is NOT what fixes it, and is not sufficient on its own: `use-ipv6=no` stops
  # avahi USING the IPv6 transport, but it still logs "Registering new address record for
  # fe80::... on usb0.*" and answers with it over IPv4. What actually removes the record is
  # having no link-local to publish, i.e. ipv6.method=disabled on the connection above.
  sed -i 's/^use-ipv6=.*/use-ipv6=no/' /etc/avahi/avahi-daemon.conf
  systemctl restart avahi-daemon 2>/dev/null || true
  echo "avahi: publishing on usb0 only -- hub75-01.local is the USB link"
else
  echo "avahi: publishing on ALL interfaces (usb0 does not exist yet)."
  echo "       re-run this script once the gadget is up to pin the name to the USB link."
  systemctl reload avahi-daemon 2>/dev/null || true
fi

systemctl daemon-reload
systemctl enable limut-hub75-gadget
systemctl enable limut-hub75
if [ "$REBOOT_NEEDED" = 0 ]; then
  systemctl restart limut-hub75-gadget || true
fi
systemctl restart limut-hub75
sleep 1
systemctl --no-pager -l status limut-hub75 | head -12

if [ "$REBOOT_NEEDED" = 1 ]; then
  echo
  echo "================================================================"
  echo " REBOOT REQUIRED: the boot config changed, so there is no UDC"
  echo " yet and the gadget cannot come up until the Pi restarts."
  echo "   sudo reboot"
  echo " Then re-run this script to pin the mDNS name to the USB link."
  echo "================================================================"
fi
