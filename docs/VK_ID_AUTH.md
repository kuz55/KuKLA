# VK ID sign-in

The first integration target is the Tauri desktop client. The native Android
client needs its own package/signing configuration and is not enabled by this
server flow yet.

## Callback configuration

After a stable public HTTPS hostname is ready, register this exact URL as the
trusted Web redirect in VK ID:

```text
https://<public-host>/api/v1/auth/vk/callback
```

Configure the server environment:

```dotenv
VK_ID_CLIENT_ID=<VK ID application ID>
VK_ID_REDIRECT_URI=https://<public-host>/api/v1/auth/vk/callback
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

The callback should not be exposed publicly until this branch is deployed and
the VK ID settings use the exact HTTPS callback URL. Do not expose the TrueNAS
administration interface, SMB, or database ports to the Internet.
