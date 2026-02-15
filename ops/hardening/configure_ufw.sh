#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   sudo bash ops/hardening/configure_ufw.sh
#
# Optional env:
#   SSH_PORT=22
#   NETDATA_ALLOW_CIDR=203.0.113.10/32

SSH_PORT="${SSH_PORT:-22}"
NETDATA_ALLOW_CIDR="${NETDATA_ALLOW_CIDR:-}"

ufw --force reset
ufw default deny incoming
ufw default allow outgoing

ufw allow "${SSH_PORT}/tcp"
ufw allow 80/tcp
ufw allow 443/tcp

# Open Netdata only for explicit trusted CIDR.
if [[ -n "$NETDATA_ALLOW_CIDR" ]]; then
  ufw allow from "$NETDATA_ALLOW_CIDR" to any port 19999 proto tcp
else
  # Keep Netdata closed unless allowlist CIDR is explicitly configured.
  ufw deny 19999/tcp || true
fi

ufw --force enable
ufw status verbose
