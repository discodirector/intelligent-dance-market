#!/usr/bin/env bash
# One-time setup of the stream box (Ubuntu 24.04, x86_64 or arm64). Run as root on the NEW stream server only.
# It does not touch the stream key: afterwards the owner writes it with
#   install -m 600 -o idm -g idm /dev/null /etc/idm-stream/url && nano /etc/idm-stream/url
set -euo pipefail
apt-get update
# python3-numpy / python3-pil: build.py station <key> for the Station+ loops (build-loops.mjs)
apt-get install -y ffmpeg curl ca-certificates python3 python3-numpy python3-pil
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
id idm >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/idm-stream --shell /usr/sbin/nologin idm
install -d -o idm -g idm /opt/idm-stream /etc/idm-stream
chmod 750 /etc/idm-stream
# files arrive via rsync from the dev machine: stream.mjs package.json dist/ loop-1080p24.mp4
cd /opt/idm-stream
sudo -u idm npm install --omit=dev
npx --yes playwright@1.64.1 install-deps chromium
sudo -u idm npx playwright install chromium
cp deploy/idm-stream.service /etc/systemd/system/idm-stream.service 2>/dev/null || true
# Station+ loops: the builder's files (loopbuild/, rsync'd) and the events file the bot's stations worker reads
install -d -o idm -g idm /opt/idm-stream/loops /opt/idm-stream/loopbuild /opt/swarm-sequencer/out/stream
cp deploy/idm-stream-loops.service deploy/idm-stream-loops.timer /etc/systemd/system/ 2>/dev/null || true
systemctl daemon-reload
echo "ready: write /etc/idm-stream/url, then: systemctl enable --now idm-stream && journalctl -fu idm-stream"
echo "Station+ loops: systemctl enable --now idm-stream-loops.timer && journalctl -fu idm-stream-loops"
