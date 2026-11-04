# KuKLA on Xubuntu

For supported Ubuntu LTS systems:

```bash
sudo apt update
sudo apt install -y git curl unzip openssl ca-certificates docker.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Log out and back in after joining the `docker` group. From the repository root, run:

```bash
./infrastructure/install.sh
```

The installer creates random database/JWT secrets when needed, starts the local Compose stack, waits for readiness and offers to bootstrap the first `SYSTEM_OWNER`. The API is bound to `127.0.0.1:18080`; no demo users are created.

For remote/mobile production use, configure DNS and certificates, then enable the HTTPS proxy profile. Follow the complete [deployment guide](DEPLOYMENT.md). Never expose the local HTTP port directly to the Internet.
