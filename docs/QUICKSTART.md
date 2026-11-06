# Quickstart

## Local server

1. Run `./infrastructure/install.sh` from the repository root. The installer creates strong secrets, starts the Compose stack, waits for database readiness and offers to create the initial `SYSTEM_OWNER` account.
2. The local API is bound to loopback at `http://127.0.0.1:18080`. Check it with:

   ```bash
   curl -fsS http://127.0.0.1:18080/ready
   ```

3. If the stack was started manually instead, copy `infrastructure/.env.example` to `infrastructure/.env`, set both secrets, and then run `docker compose up -d --build` from `infrastructure/`.
4. Create the initial account with `cd infrastructure && ./scripts/bootstrap-owner.sh`. The database intentionally contains no default users or passwords.

## Clients

- The target desktop client is Tauri + React (`desktop/`), packaged as a native Windows/Linux application; macOS support is planned. Build with `cd desktop && npm ci && npm run tauri -- build`. Windows/Linux native bundles are checked in CI.
- The packaged desktop default points to the local Compose API at `http://localhost:18080/api/v1`; set `VITE_API_URL` when building against another server. Vite development uses a same-origin proxy.
- The Flutter default is for the Android emulator (`http://10.0.2.2:18080/api/v1`). For a physical device or a production deployment, set `API_URL` explicitly. Use HTTPS for remote access.
- `rebuild/` contains an experimental Go/C GTK local prototype that is not synchronized with the server and is not the target desktop client.
- In the Tauri client, administrators can create/revoke invitations from **Люди**. Invitees can choose **Есть приглашение?** on the login screen to set a password. Copy and deliver the one-time token through a trusted channel; email/SMS delivery is not implemented.

Do not use demo credentials from old documentation. No demo users are seeded. See [SECURITY_BOOTSTRAP.md](SECURITY_BOOTSTRAP.md) for the one-time owner bootstrap model.

For remote/mobile production access, install valid certificates at `infrastructure/certs/fullchain.pem` and `infrastructure/certs/privkey.pem`, configure the domain and CORS origin, then start the `production` Compose profile. See [DEPLOYMENT.md](DEPLOYMENT.md).
