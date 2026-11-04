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

- The legacy Tauri/React client uses `VITE_API_URL`; the packaged default points to the local Compose API at `http://localhost:18080/api/v1`.
- The Flutter default is for the Android emulator (`http://10.0.2.2:18080/api/v1`). For a physical device or a production deployment, set `API_URL` explicitly. Use HTTPS for remote access.
- The Go/C GTK client is the target desktop client, but its current local workflow is not yet synchronized with the server.
- In the deprecated Tauri/React client, administrators can create/revoke invitations from **Люди**. Invitees can choose **Есть приглашение?** on the login screen to set a password. Copy and deliver the one-time token through a trusted channel; email/SMS delivery is not implemented.

Do not use demo credentials from old documentation. No demo users are seeded. See [SECURITY_BOOTSTRAP.md](SECURITY_BOOTSTRAP.md) for the one-time owner bootstrap model.

For remote/mobile production access, install valid certificates at `infrastructure/certs/fullchain.pem` and `infrastructure/certs/privkey.pem`, configure the domain and CORS origin, then start the `production` Compose profile. See [DEPLOYMENT.md](DEPLOYMENT.md).
