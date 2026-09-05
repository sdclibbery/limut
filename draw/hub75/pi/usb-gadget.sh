#!/bin/sh
# The USB-C link to limut, as a CDC ethernet gadget. PROTOCOL.md §3.2.
#
#   sh usb-gadget.sh start | stop | status
#
# Driven by limut-hub75-gadget.service; run it by hand only when debugging.
#
# Why this exists: the wall is jerky over WiFi and it is the air, not our code -- see
# draw/hub75/CLAUDE.md "Why the wall is jerky". The fix is a wired link, and `eth0` cannot be it
# because that belongs to the Colorlight card as a raw layer-2 sender with no IP. So the Pi needs
# a SECOND ip-capable interface, and the USB-C port is the only one left. Nothing above TCP
# changes: same port, same discovery, same messages.
#
# Needs `dtoverlay=dwc2,dr_mode=peripheral` in config.txt and `modules-load=dwc2` in cmdline.txt,
# both of which install.sh writes. Without them /sys/class/udc is empty and this exits saying so.
set -e

# ECM rather than NCM deliberately. macOS supports both natively, but ECM is one ethernet frame
# per USB transfer while NCM aggregates several -- and aggregation is latency, which is the entire
# thing we are here to remove. NCM would win on throughput, which we do not need: the uniform
# stream is a few hundred bytes at 60 Hz. If a host ever refuses to enumerate ECM, this is the one
# word to change.
FUNC=${HUB75_GADGET_FUNC:-ecm}

G=/sys/kernel/config/usb_gadget/limut
IFACE=usb0

# Pinned, not random. A gadget that comes up with a fresh MAC every time makes macOS mint a NEW
# network service on every replug -- so any per-interface setting is lost and the service order
# fills with dead entries. Locally administered (02:), and 75 for hub75.
HOST_MAC=${HUB75_HOST_MAC:-02:75:10:00:00:01}   # the Mac's end of the link
DEV_MAC=${HUB75_DEV_MAC:-02:75:10:00:00:02}     # the Pi's end

start() {
    [ -d "$G" ] && { echo "gadget already up"; return 0; }

    modprobe libcomposite 2>/dev/null || true
    [ -d /sys/kernel/config ] || mount -t configfs none /sys/kernel/config

    UDC=$(ls /sys/class/udc 2>/dev/null | head -1)
    if [ -z "$UDC" ]; then
        echo "no UDC in /sys/class/udc: the USB-C port is not in peripheral mode." >&2
        echo "Check for 'dtoverlay=dwc2,dr_mode=peripheral' in /boot/firmware/config.txt and" >&2
        echo "'modules-load=dwc2' in /boot/firmware/cmdline.txt, then reboot." >&2
        return 1
    fi

    mkdir -p "$G"
    cd "$G"

    # Linux Foundation / Multifunction Composite Gadget. Not a vendor id we have any claim to, but
    # it is the one the kernel's own examples use and no host cares for a CDC class device.
    echo 0x1d6b > idVendor
    echo 0x0104 > idProduct
    echo 0x0100 > bcdDevice
    echo 0x0200 > bcdUSB

    mkdir -p strings/0x409
    echo "limut"                          > strings/0x409/manufacturer
    echo "hub75 display link"             > strings/0x409/product
    # The board serial, so two displays on one host are still distinguishable.
    (grep -m1 '^Serial' /proc/cpuinfo | awk '{print $3}' || echo 0000) > strings/0x409/serialnumber

    mkdir -p configs/c.1/strings/0x409
    echo "CDC $FUNC" > configs/c.1/strings/0x409/configuration
    # Self-powered, and asking for as little bus current as the descriptor allows. Both are true:
    # the Pi runs off 5V on GPIO pins 4 and 6, and takes essentially nothing from VBUS -- an
    # official 5.1V supply simply outvotes a hub port's 5.0V on the shared rail. Declaring it
    # matters, because the laptop-side hub here is BUS powered: a device that asked for 500 mA
    # could be refused outright, and a Pi 4B needs ~1 A running and 1.2-1.5 A at boot, which no
    # downstream port on such a hub can give. VBUS is wanted for one thing only -- letting the
    # gadget see that a host is attached.
    echo 0xc0 > configs/c.1/bmAttributes
    echo 100  > configs/c.1/MaxPower

    mkdir -p "functions/$FUNC.$IFACE"
    echo "$HOST_MAC" > "functions/$FUNC.$IFACE/host_addr"
    echo "$DEV_MAC"  > "functions/$FUNC.$IFACE/dev_addr"

    ln -s "functions/$FUNC.$IFACE" configs/c.1/

    echo "$UDC" > UDC

    # Bring the link up here rather than leaving it to whoever manages the interface. Raspberry Pi
    # OS ships a udev rule (85-nm-unmanaged.rules) that marks gadget interfaces NetworkManager
    # UNMANAGED, on the assumption of the classic dhcpcd Pi Zero setup -- so a fresh usb0 sits
    # DOWN with no carrier and NM never looks at it. install.sh overrides that with a conf.d
    # drop-in; this line means the interface is still usable if the override is ever lost.
    ip link set "$IFACE" up 2>/dev/null || true

    echo "gadget up: $FUNC on $UDC, dev $DEV_MAC / host $HOST_MAC"
}

stop() {
    [ -d "$G" ] || { echo "gadget not up"; return 0; }
    cd "$G"
    # Unbind first: removing anything still linked into a bound config gives EBUSY.
    echo "" > UDC 2>/dev/null || true
    rm -f "configs/c.1/$FUNC.$IFACE"
    rmdir configs/c.1/strings/0x409 2>/dev/null || true
    rmdir configs/c.1 2>/dev/null || true
    rmdir "functions/$FUNC.$IFACE" 2>/dev/null || true
    rmdir strings/0x409 2>/dev/null || true
    cd /
    rmdir "$G"
    echo "gadget down"
}

status() {
    echo "udc:     $(ls /sys/class/udc 2>/dev/null | tr '\n' ' ')"
    if [ -d "$G" ]; then
        echo "gadget:  up, bound to '$(cat "$G/UDC" 2>/dev/null)'"
    else
        echo "gadget:  not created"
    fi
    ip -br addr show "$IFACE" 2>/dev/null || echo "$IFACE:  no such interface"
}

case "${1:-start}" in
    start)  start ;;
    stop)   stop ;;
    status) status ;;
    *)      echo "usage: $0 start|stop|status" >&2; exit 2 ;;
esac
