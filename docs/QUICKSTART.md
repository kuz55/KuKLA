# Quickstart

1. Copy `infrastructure/.env.example` to `.env`.
2. Set secrets.
3. `docker compose up -d --build`.
4. Check `/health`.
5. Desktop uses `VITE_API_URL=http://localhost:8080/api/v1` by default.
6. Mobile uses `--dart-define=API_URL=http://SERVER_IP:8080/api/v1`.

Demo users:
- admin@kukla.local / admin12345
- leader@kukla.local / leader12345
- coordinator@kukla.local / coord12345
- searcher@kukla.local / searcher123

Change or remove demo users before production.
