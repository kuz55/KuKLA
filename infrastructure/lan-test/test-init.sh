#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp "$script_dir/init-test.sh" "$tmp/"
if "$tmp/init-test.sh" 8.8.8.8 >/dev/null 2>&1; then echo 'Public address accepted' >&2; exit 1; fi
if "$tmp/init-test.sh" 192.0.2.1 >/dev/null 2>&1; then echo 'Non-RFC1918 address accepted' >&2; exit 1; fi
"$tmp/init-test.sh" 192.168.77.10 >/dev/null
openssl verify -CAfile "$tmp/private/test-ca.crt" -verify_ip 192.168.77.10 "$tmp/private/server.crt" >/dev/null
if openssl verify -CAfile "$tmp/private/test-ca.crt" -verify_ip 192.168.77.11 "$tmp/private/server.crt" >/dev/null 2>&1; then echo 'Wrong address verified' >&2; exit 1; fi
if "$tmp/init-test.sh" 192.168.77.10 >/dev/null 2>&1; then echo 'Existing credentials overwritten' >&2; exit 1; fi
[ "$(stat -c %a "$tmp/.env")" = 600 ]
[ "$(stat -c %a "$tmp/private/test-ca.key")" = 600 ]
echo 'LAN certificate setup checks passed.'
