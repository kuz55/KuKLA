# Deployment on Xubuntu

## 1. Install packages

```bash
sudo apt update
sudo apt install -y git curl unzip docker.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```
Log out/in once after adding yourself to the docker group.

## 2. Install project

```bash
sudo mkdir -p /opt/kukla
sudo chown -R "$USER":"$USER" /opt/kukla
unzip KuKLA-2.1.0.zip -d /opt
mv /opt/KuKLA-2-full/* /opt/kukla/
cd /opt/kukla/infrastructure
cp .env.example .env
```

Edit `.env` and set strong POSTGRES_PASSWORD and JWT_SECRET.

## 3. Start

```bash
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:8080/health
```

## 4. Desktop build workstation

Install Node.js 22+, Rust and Tauri Linux dependencies, then:

```bash
cd desktop
npm install
npm run build
npm run tauri build
```

## 5. Mobile build workstation

Install Flutter 3.24+ and Android SDK:

```bash
cd mobile
flutter pub get
flutter build apk --dart-define=API_URL=http://SERVER_IP:8080/api/v1
```

For a real deployment, put the API behind HTTPS and use `https://host/api/v1`.
