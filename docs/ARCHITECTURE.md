# KuKLA 2.1 Architecture

## Goal
Server-first search coordination system. Leaders/coordinators use the Tauri desktop client; field members use Flutter mobile. There is no mandatory browser UI.

## Components
- Fastify API: authentication, RBAC, searches, members, tasks, events, GPS.
- PostgreSQL: authoritative state.
- Redis: reserved for queues/cache/realtime expansion.
- Nginx: optional production reverse proxy/TLS termination.
- Tauri + React: desktop client.
- Flutter: mobile client with local SQLite queue and cached snapshots.

## Data flow
Mobile commands and GPS points can be queued locally when offline. The server remains authoritative. Desktop reads operational state and can create/update searches and tasks.

## Security
JWT is required for protected API calls. Role checks are performed on the server. Production deployment must use TLS, strong secrets, restricted network exposure and non-demo accounts.
