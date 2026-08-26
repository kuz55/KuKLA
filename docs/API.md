# API v1

Base: `/api/v1`

Auth: POST `/auth/login`, POST `/auth/register`, POST `/auth/logout`, GET `/me`.
Users: GET `/users`, PATCH `/users/:id`.
Searches: GET/POST `/searches`, GET/PATCH `/searches/:id`.
Members: GET `/searches/:id/members`, POST `/searches/:id/join`, DELETE `/searches/:id/members/:userId`.
Tasks: GET/POST `/searches/:id/tasks`, PATCH `/tasks/:id`.
Events: GET/POST `/searches/:id/events`.
GPS: GET/POST `/searches/:id/gps`.
Offline snapshot: GET `/searches/:id/snapshot`.
Health: GET `/health`, `/ready`.
WebSocket handshake endpoint: `/api/v1/ws`.
