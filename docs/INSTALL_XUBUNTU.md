# KuKLA on Xubuntu: full installation

## Server machine

Recommended: Xubuntu 24.04 LTS or another supported Ubuntu LTS derivative, wired Ethernet, SSD for OS/database and a separate backup disk.

```bash
sudo apt update
sudo apt full-upgrade -y
sudo apt install -y git curl unzip openssl ca-certificates docker.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Log out and in. Verify:

```bash
docker run --rm hello-world
docker compose version
```

## Install KuKLA

```bash
sudo mkdir -p /opt/kukla
sudo chown -R "$USER":"$USER" /opt/kukla
unzip KuKLA-2.1.0.zip -d /tmp/kukla
cp -a /tmp/kukla/KuKLA-2-full/. /opt/kukla/
cd /opt/kukla/infrastructure
cp .env.example .env
sed -i "s/CHANGE_ME/$(openssl rand -hex 32)/" .env
```

Review `.env` before starting. For a LAN-only test this is sufficient. For Internet exposure use HTTPS and a firewall.

```bash
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:8080/health
```

## LAN access

The API is intentionally bound to localhost in the provided compose file. If mobile devices need to reach it over LAN, change:

```yaml
ports: ["127.0.0.1:8080:8080"]
```

to:

```yaml
ports: ["8080:8080"]
```

Then set the mobile build URL to:

```text
http://SERVER_LAN_IP:8080/api/v1
```

For production, put Nginx in front and use HTTPS instead of exposing plain HTTP.
