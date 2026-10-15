# Deploy Mission Control ke VPS + akses publik

## 1. Siapkan VPS (Ubuntu)

```bash
# Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Ambil kode (atau copy folder mission-control)
git clone https://github.com/rohman031189-commits/AI-AGENT.git
cd AI-AGENT/mission-control
```

## 2. Jalankan dashboard

```bash
node server.js
# berjalan di 127.0.0.1:3001 — cek: curl http://127.0.0.1:3001/api/state
```

Agar tahan restart, mis. via systemd (`/etc/systemd/system/mission-control.service`):

```ini
[Unit]
Description=Mission Control Dashboard
After=network.target

[Service]
WorkingDirectory=/opt/AI-AGENT/mission-control
ExecStart=/usr/bin/node server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

## 3. Akses publik via bore

```bash
# install bore (sekali)
curl -sSL -o bore.tar.gz https://github.com/ekzhang/bore/releases/latest/download/bore-v0.6.0-x86_64-unknown-linux-musl.tar.gz
tar xzf bore.tar.gz --no-same-owner && chmod +x bore && sudo mv bore /usr/local/bin/

# jalankan tunnel (atau biarkan watchdog yang mengurus)
/usr/local/bin/bore local 3001 --to bore.pub
```

## 4. Watchdog (restart otomatis tiap 5 menit)

```bash
crontab -e
# tambah baris:
*/5 * * * * /opt/AI-AGENT/mission-control/watchdog.sh
```

Watchdog: memastikan `node server.js` hidup, memastikan tunnel bore hidup,
me-restart bila mati/URL berubah, update `PUBLIC_URL.txt`, dan mencatat semua
kejadian ke `data/watchdog-history.jsonl` (terlihat di dashboard → VPS Status).

**Selalu baca `PUBLIC_URL.txt` + live-check HTTP 200 sebelum membagikan link**
— URL bore bisa berganti sewaktu-waktu.

## 5. Hidupkan dashboard

Catat setiap delegasi agent ke `data/tasks.jsonl` (format di README.md).
