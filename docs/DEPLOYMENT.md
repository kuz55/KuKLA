# Deployment on Xubuntu / Ubuntu LTS

## 1. Host prerequisites

```bash
sudo apt update
sudo apt install -y curl openssl ca-certificates docker.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Log out and back in after adding the account to the `docker` group. Keep the database and Redis ports private; the Compose file does not publish them.

## 2. Install the local stack

From the repository root:

```bash
./infrastructure/install.sh
```

The installer copies the project to `/opt/kukla`, generates `POSTGRES_PASSWORD` and `JWT_SECRET` if missing or still placeholders, sets restrictive permissions on `.env`, starts the local stack, waits for `/ready`, and offers to create the first `SYSTEM_OWNER` account. No default users or passwords are seeded.

The API is bound to `127.0.0.1:18080` by default. Verify it with:

```bash
curl -fsS http://127.0.0.1:18080/ready
cd /opt/kukla/infrastructure && docker compose ps
```

If owner creation was skipped, run:

```bash
cd /opt/kukla/infrastructure
./scripts/bootstrap-owner.sh
```

## 3. HTTPS and remote/mobile access

The local-only profile is not suitable for Internet access. For production:

1. Point a DNS name at the host and install a valid certificate and private key at `infrastructure/certs/fullchain.pem` and `infrastructure/certs/privkey.pem`. Do not put private keys in Git.
2. Set `CORS_ORIGIN` in `infrastructure/.env` to the exact desktop application origin. Keep public registration disabled.
3. Start the reverse proxy profile:

   ```bash
   cd /opt/kukla/infrastructure
   docker compose --profile production up -d --build
   ```

   HTTP on port 80 redirects to HTTPS on port 443. The proxy forwards WebSocket upgrades and client IP information to the API.
4. Build mobile clients with `--dart-define=API_URL=https://your-domain.example/api/v1`.

For a temporary LAN-only development test, use a firewall-restricted host and explicitly set `SERVER_BIND=0.0.0.0` in `.env`; do not use plain HTTP over the public Internet. Restore `SERVER_BIND=127.0.0.1` afterwards.

## 4. Legacy Tauri/React client

`desktop/` is deprecated and retained as a behavior reference. It currently includes a temporary invitation-management and acceptance UI, but is not the target desktop client and does not deliver tokens by email/SMS. On a workstation with Node.js 22+, Rust and the Tauri Linux dependencies:

```bash
cd desktop
npm ci
VITE_API_URL=http://localhost:18080/api/v1 npm run tauri build
```

The target desktop implementation is `rebuild/` (Go/C + GTK4), but it is not yet connected to the authoritative server API; do not treat the local prototype as a synchronized production client. Public registration is hidden in the legacy UI unless built with `VITE_ALLOW_PUBLIC_REGISTRATION=true`, and the server must also be explicitly configured with `ALLOW_PUBLIC_REGISTRATION=true`. Do not enable either setting in production.

## 5. Mobile build workstation

Install Flutter and the Android SDK:

```bash
cd mobile
flutter pub get
flutter build apk --dart-define=API_URL=https://your-domain.example/api/v1
```

Background GPS behavior, offline synchronization, device security and field acceptance still require implementation and testing before operational use.
