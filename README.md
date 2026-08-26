# KuKLA 2.1

KuKLA is a Linux-first search coordination platform with two clients:

- **Desktop**: Tauri + React for administrators, leaders and coordinators.
- **Mobile**: Flutter for field participants.
- **Server**: Fastify + PostgreSQL + Redis, containerized with Docker Compose.

There is no mandatory web UI. The server exposes an API consumed by the clients.

## Features in this build
- JWT authentication and server-side RBAC.
- Search lifecycle and operational dashboard.
- Search membership.
- Tasks and task status.
- Audit/event log.
- GPS point ingestion and track display.
- Desktop map using OpenStreetMap tiles.
- Mobile map and GPS transmission.
- Mobile SQLite cache and offline command queue.
- Snapshot endpoint for sync/bootstrap.
- Docker Compose deployment on Xubuntu/Linux.
- Database backup/restore scripts.
- Production hardening checklist.

## Quick start
See `docs/DEPLOYMENT.md`.

## Demo credentials
For development only:
- admin@kukla.local / admin12345
- leader@kukla.local / leader12345
- coordinator@kukla.local / coord12345
- searcher@kukla.local / searcher123

## Important
This is a complete functional development/MVP release, not a certified mission-critical rescue system. Before operational use, complete the production hardening checklist, independent security review, offline/background GPS validation, notification infrastructure, backup restore drills and field acceptance testing.
