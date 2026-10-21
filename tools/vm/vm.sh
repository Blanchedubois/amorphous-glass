#!/usr/bin/env bash
# vm.sh: a throwaway Arch Linux + GNOME VM to test install.sh as a new user would, and to film the
# login screen (docs/SHOWCASE_PLAN.md). Nothing here touches the host's GNOME, accounts or PAM.
#
#   vm.sh init            overlay disk on the Arch cloud image, a VM-only ssh key and test password
#   vm.sh start           boot it headless (KVM): ssh on localhost:2222, VNC on localhost:5905
#   vm.sh ssh [CMD..]     run a command in the VM as the 'tester' user
#   vm.sh session CMD..   run a command inside tester's GNOME session (its bus and Wayland display)
#   vm.sh shot FILE.png   the VM's screen, from QEMU (QMP screendump)
#   vm.sh click X Y | move X Y | key KEY..   pointer and keys through QEMU (never a password)
#   vm.sh stop | destroy
#
# VM_DIR (default ~/VMs/liquid-glass-test) holds the base image Arch-Linux-x86_64-cloudimg.qcow2
# (downloaded by hand: geo.mirror.pkgbuild.com/images/latest/), the disk, the key, the password file.
set -euo pipefail
VM_DIR="${VM_DIR:-$HOME/VMs/liquid-glass-test}"
BASE="$VM_DIR/Arch-Linux-x86_64-cloudimg.qcow2"
DISK="$VM_DIR/disk.qcow2"
KEY="$VM_DIR/id_vm"
QMP="$VM_DIR/qmp.sock"
SEED_PORT=8199
SSH=(ssh -i "$KEY" -p 2222 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=5 tester@127.0.0.1)
W=2560 H=1440

qmp() { # one QMP command (JSON) on the monitor socket
  python3 - "$QMP" "$1" <<'PY'
import json, socket, sys
s = socket.socket(socket.AF_UNIX); s.connect(sys.argv[1]); f = s.makefile('rw')
f.readline(); f.write(json.dumps({'execute': 'qmp_capabilities'}) + '\n'); f.flush(); f.readline()
f.write(sys.argv[2] + '\n'); f.flush()
while True:
    r = json.loads(f.readline())
    if 'return' in r or 'error' in r:
        print(json.dumps(r)); sys.exit(1 if 'error' in r else 0)
PY
}

case "${1:-}" in
  init)
    [[ -f "$BASE" ]] || { echo "missing $BASE"; exit 1; }
    [[ -f "$DISK" ]] && { echo "$DISK exists (vm.sh destroy first)"; exit 1; }
    # a copy of the image (qemu-img is a separate package); start grows it to 40 GB through QMP
    cp --reflink=auto "$BASE" "$DISK"
    ssh-keygen -q -t ed25519 -N '' -C liquid-glass-vm -f "$KEY"
    ( umask 077; python3 -c 'import secrets; print(secrets.token_urlsafe(12))' > "$VM_DIR/tester-password" )
    mkdir -p "$VM_DIR/seed"
    printf 'instance-id: liquid-glass-test\nlocal-hostname: tahoe-vm\n' > "$VM_DIR/seed/meta-data"
    ( umask 077; cat > "$VM_DIR/seed/user-data" <<EOF
#cloud-config
users:
  - name: tester
    gecos: Liquid Glass Tester
    groups: [wheel]
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    lock_passwd: false
    plain_text_passwd: $(cat "$VM_DIR/tester-password")
    ssh_authorized_keys: [$(cat "$KEY.pub")]
growpart: {mode: auto, devices: ['/']}
EOF
    )
    echo "VM ready to start: $VM_DIR" ;;
  start)
    # the cloud-init seed over HTTP on the host side of QEMU's user network (no ISO tools needed)
    setsid -f python3 -m http.server --bind 127.0.0.1 --directory "$VM_DIR/seed" "$SEED_PORT" >/dev/null 2>&1
    sleep 0.5; pgrep -f "http.server --bind 127.0.0.1 --directory $VM_DIR/seed" > "$VM_DIR/seed.pid"
    qemu-system-x86_64 -enable-kvm -machine q35 -cpu host -smp 8 -m 8G \
      -drive file="$DISK",if=none,id=d0,cache=writeback -device virtio-blk-pci,drive=d0 \
      -netdev user,id=n0,hostfwd=tcp:127.0.0.1:2222-:22 -device virtio-net-pci,netdev=n0 \
      -smbios "type=1,serial=ds=nocloud;s=http://10.0.2.2:$SEED_PORT/" \
      -vga none -device bochs-display,xres=$W,yres=$H,vgamem=64M -display none -vnc 127.0.0.1:5 \
      -device virtio-tablet-pci -device virtio-keyboard-pci \
      -qmp unix:"$QMP",server=on,wait=off -daemonize -pidfile "$VM_DIR/qemu.pid" -S
    # paused until the disk is 40 GB (cloud-init's growpart then fills it at first boot)
    qmp '{"execute": "block_resize", "arguments": {"device": "d0", "size": 42949672960}}' >/dev/null
    qmp '{"execute": "cont"}' >/dev/null
    echo "booting; waiting for ssh"
    for _ in $(seq 120); do "${SSH[@]}" true 2>/dev/null && { echo "up"; exit 0; }; sleep 5; done
    echo "no ssh after 10 min"; exit 1 ;;
  ssh) shift; "${SSH[@]}" "$@" ;;
  session)
    shift
    "${SSH[@]}" "export XDG_RUNTIME_DIR=/run/user/\$(id -u) DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/\$(id -u)/bus \
      XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=GNOME WAYLAND_DISPLAY=wayland-0; $*" ;;
  shot) qmp "{\"execute\": \"screendump\", \"arguments\": {\"filename\": \"$(readlink -f "$2")\", \"format\": \"png\"}}" >/dev/null ;;
  move|click)
    # absolute pointer: QEMU's tablet takes 0..32767 on each axis
    ax=$(( $2 * 32767 / W )); ay=$(( $3 * 32767 / H ))
    qmp "{\"execute\": \"input-send-event\", \"arguments\": {\"events\": [{\"type\": \"abs\", \"data\": {\"axis\": \"x\", \"value\": $ax}}, {\"type\": \"abs\", \"data\": {\"axis\": \"y\", \"value\": $ay}}]}}" >/dev/null
    if [[ $1 == click ]]; then
      for down in true false; do
        qmp "{\"execute\": \"input-send-event\", \"arguments\": {\"events\": [{\"type\": \"btn\", \"data\": {\"down\": $down, \"button\": \"left\"}}]}}" >/dev/null
        sleep 0.08
      done
    fi ;;
  key)
    shift
    keys=$(printf '{"type": "qcode", "data": "%s"},' "$@"); keys="[${keys%,}]"
    qmp "{\"execute\": \"send-key\", \"arguments\": {\"keys\": $keys}}" >/dev/null ;;
  stop)
    "${SSH[@]}" sudo systemctl poweroff 2>/dev/null || true
    sleep 5; [[ -f "$VM_DIR/qemu.pid" ]] && kill "$(cat "$VM_DIR/qemu.pid")" 2>/dev/null || true
    [[ -f "$VM_DIR/seed.pid" ]] && kill "$(cat "$VM_DIR/seed.pid")" 2>/dev/null || true
    rm -f "$VM_DIR/qemu.pid" "$VM_DIR/seed.pid" ;;
  destroy) "$0" stop; rm -f "$DISK" "$KEY" "$KEY.pub" "$VM_DIR/tester-password"; rm -rf "$VM_DIR/seed" ;;
  *) sed -n '2,14p' "$0"; exit 1 ;;
esac
