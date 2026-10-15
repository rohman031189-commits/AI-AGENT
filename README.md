# Mission Control — AI Agent Dashboard

Pusat kendali real-time untuk memantau tim AI agent (Anca, Mu, Cipu, Jaka, Tono, Dani),
seperti mission control NASA tapi untuk AI.

## Menjalankan

Butuh Node.js saja, tanpa dependensi eksternal.

```bash
cd mission-control
# unduh Three.js r128 yang di-vendor (sekali saja)
mkdir -p vendor && curl -sSL -o vendor/three.min.js \
  https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js
node server.js
# buka http://127.0.0.1:3001
```

## Fitur

- **Virtual Office 3D** — ruangan Three.js (r128, di-vendor di `vendor/`): tiap agent
  tampil sebagai robot sesuai cirinya; yang bekerja duduk mengetik di meja,
  yang idle berdiri di belakang. Klik robot = pause/resume.
- **Agent Overview, Task Queue, System Metrics, VPS Status, Tugas Terjadwal,
  Token Status, Agent Fleet, Real-Time Log** — semua data nyata dari `/proc`,
  file JSONL, dan perintah sistem. Tanpa simulasi.
- Polling `GET /api/state` tiap 3 detik.

## Mencatat kerja agent (ledger)

Agar dashboard hidup, append event ke `data/tasks.jsonl` — satu JSON per baris:

```json
{"ts":"2026-10-16T02:19:00+07:00","task_id":"riset-gpu-bekas","agent":"tono","title":"Riset harga GPU bekas","status":"started","detail":"kumpulkan 5 sumber"}
```

Aturan: tiap delegasi → `started` (dengan `task_id` stabil); selesai/gagal →
`done`/`failed`. Field `agent` wajib salah satu:
`anca` · `mu` · `cipu` · `jaka` · `tono` · `dani`.

Quick task via API:

```bash
curl -X POST http://127.0.0.1:3001/api/queue \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Riset harga GPU bekas","agent":"tono"}'
```

## API

- `GET /api/state` → agents, queue, tasks, system, vps, schedules, token, log
- `POST /api/queue` → `{prompt, agent}` tambah antrean
- `POST /api/queue/done` → `{ts}` tandai antrean selesai
- `POST /api/dispatch` → `{paused:true|false}` jeda/lanjut semua, atau
  `{agent:"cipu", paused:true}` jeda satu agent

## Akses publik

Lihat `DEPLOY.md` — bore tunnel + `watchdog.sh` (cek tiap 5 menit via cron,
restart otomatis, catat ke `data/watchdog-history.jsonl`).
