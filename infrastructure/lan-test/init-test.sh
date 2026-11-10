#!/usr/bin/env bash
# Generate isolated test CA/server credentials. Never reuse for production.
set -euo pipefail
cd "$(dirname "$0")"
if [ "$#" -ne 1 ]; then echo "Usage: $0 <IPv4-address-of-Linux-VM>" >&2; exit 2; fi
ip="$1"
python3 - "$ip" <<'PY'
import ipaddress, sys
try:
    ip = ipaddress.IPv4Address(sys.argv[1])
    if not any(ip in ipaddress.ip_network(network) for network in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')):
        raise ValueError()
except ValueError:
    raise SystemExit('Use a private IPv4 address assigned to the VM, not the TrueNAS host or loopback.')
PY
if [ -e .env ] || [ -e private ]; then
  echo 'Existing test configuration found. Refusing to overwrite it.' >&2; exit 1
fi
umask 077
mkdir private
openssl req -x509 -newkey rsa:3072 -nodes -sha256 -days 30 \
  -keyout private/test-ca.key -out private/test-ca.crt \
  -subj '/CN=KuKLA local test CA' \
  -addext 'basicConstraints=critical,CA:TRUE,pathlen:0' \
  -addext 'keyUsage=critical,keyCertSign,cRLSign' >/dev/null 2>&1
openssl req -new -newkey rsa:2048 -nodes -sha256 \
  -keyout private/server.key -out private/server.csr \
  -subj '/CN=KuKLA local test server' >/dev/null 2>&1
printf 'subjectAltName=IP:%s\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' "$ip" > private/server.ext
openssl x509 -req -sha256 -days 30 -in private/server.csr \
  -CA private/test-ca.crt -CAkey private/test-ca.key -CAcreateserial \
  -extfile private/server.ext -out private/server.crt >/dev/null 2>&1
rm private/server.csr private/server.ext private/test-ca.srl
{
  printf 'KUKLA_LAN_IP=%s\n' "$ip"
  printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 32)"
  printf 'JWT_SECRET=%s\n' "$(openssl rand -hex 32)"
} > .env
printf '\nTest CA fingerprint (SHA-256):\n'
openssl x509 -in private/test-ca.crt -noout -fingerprint -sha256
printf 'Certificate file SHA-256 (compare after copying):\n'
sha256sum private/test-ca.crt
printf '\nCreated isolated test credentials. Copy ONLY private/test-ca.crt to the test Windows PC.\n'
printf 'Never copy private/test-ca.key, private/server.key or .env; never expose them to Git or the Internet.\n'
