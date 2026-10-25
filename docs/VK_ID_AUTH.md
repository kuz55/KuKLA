# VK ID sign-in

The first integration target is the Tauri desktop client. The native Android
client needs its own package/signing configuration and is not enabled by this
server flow yet.

## Callback configuration

The optional `docker-compose.public-api.yml` starts a dedicated Tailscale node
and a small Nginx gateway. The gateway allows only the three VK ID endpoints;
all other paths return 404. The Tailscale sidecar shares the gateway's network
namespace and does not use TrueNAS host networking.

Create a one-use, non-ephemeral Tailscale auth key and place it in
`infrastructure/.env` as `TS_API_AUTHKEY`. Do not paste the key into chat or
commit it. From the `infrastructure` directory, start the optional services
with the existing TrueNAS Compose file plus `docker-compose.public-api.yml`:

```sh
sudo docker compose --env-file .env \
  -f docker-compose.truenas.yml \
  -f docker-compose.public-api.yml \
  --profile public-api up -d tailscale-api
```

Then configure Funnel from the sidecar:

```sh
sudo docker compose --env-file .env \
  -f docker-compose.truenas.yml \
  -f docker-compose.public-api.yml \
  --profile public-api exec tailscale-api tailscale funnel --bg 8080
```

This publishes the gateway over HTTPS; it does not publish the TrueNAS UI,
SSH, database, or general KuKLA API. Once the `kukla-api` device is connected,
revoke the one-use auth key and remove its value from `.env`; the persisted
Tailscale state volume keeps the device authenticated.

The resulting hostname is `kukla-api.<tailnet>.ts.net`. After Funnel reports
the public URL and HTTPS is ready, register this exact URL as the trusted Web
redirect in VK ID:

```text
https://kukla-api.<tailnet>.ts.net/api/v1/auth/vk/callback
```

Configure the server environment:

```dotenv
VK_ID_CLIENT_ID=<VK ID application ID>
VK_ID_REDIRECT_URI=https://kukla-api.<tailnet>.ts.net/api/v1/auth/vk/callback
```

The redirect URI must exactly match the value registered in the VK ID cabinet.
Do not put OAuth secrets into the desktop bundle or source control. This flow
uses server-held PKCE verifier/state and exchanges the code on the API server.

## Flow

1. Desktop calls `POST /api/v1/auth/vk/start` and receives a VK authorization
   URL plus a short-lived polling credential.
2. The user completes VK ID in the system browser. VK redirects to the HTTPS
   callback.
3. The API validates one-time state, exchanges the authorization code using
   PKCE, requests the VK ID profile over HTTPS, and maps its stable subject to a
   KuKLA identity.
4. First-time VK ID users receive the ordinary `SEARCHER` role. Existing
   accounts are never silently linked by matching email or phone.
5. Desktop polls `POST /api/v1/auth/vk/poll`; the one-time KuKLA session token is
   returned once and is not placed in the browser callback URL.

The callback should not be enabled until this branch is deployed and the VK ID
settings use the exact HTTPS callback URL. Do not expose the TrueNAS
administration interface, SMB, database ports, or general KuKLA API to the
Internet.
