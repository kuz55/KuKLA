# Operations runbook

## Status
`docker compose ps`

## Logs
`docker compose logs -f server`

## Restart
`docker compose restart server`

## Backup
`./scripts/backup.sh`

## Restore
`./scripts/restore.sh backups/<file>.dump`

## Update
`git pull && docker compose up -d --build`

Never run a destructive database reset against production.
