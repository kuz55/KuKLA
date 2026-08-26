SHELL := /bin/bash

.PHONY: up down logs health server desktop mobile backup
up:
	cd infrastructure && docker compose up -d --build

down:
	cd infrastructure && docker compose down

logs:
	cd infrastructure && docker compose logs -f server

health:
	curl -fsS http://127.0.0.1:8080/health

server:
	cd server && npm install && npm run build

desktop:
	cd desktop && npm install && npm run build

mobile:
	cd mobile && flutter pub get && flutter analyze

backup:
	cd infrastructure && ./scripts/backup.sh
