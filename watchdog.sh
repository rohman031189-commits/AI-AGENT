#!/usr/bin/env bash
# Watchdog tunnel bore untuk Mission Control.
# Dijalankan via cron tiap 5 menit. Tugas:
#   - pastikan proses bore untuk port 3001 hidup; kalau mati -> start ulang
#   - baca URL publik dari output bore; kalau berubah -> update PUBLIC_URL.txt
#   - catat setiap kejadian ke data/watchdog-history.jsonl (ts WIB, event, url)
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
DATA="$ROOT/data"
PUB="$ROOT/PUBLIC_URL.txt"
HIST="$DATA/watchdog-history.jsonl"
LOG="$ROOT/watchdog.log"
PORT=3001
mkdir -p "$DATA"
touch "$PUB" "$HIST"

ts_wib() { TZ=Asia/Jakarta date +%Y-%m-%dT%H:%M:%S+07:00; }
log_hist() { # $1=event $2=url
  printf '{"ts":"%s","event":"%s","url":"%s"}\n' "$(ts_wib)" "$1" "$2" >> "$HIST"
}
say() { echo "[$(ts_wib)] $*" >> "$LOG"; }

BORE_BIN="$(command -v bore || echo "$HOME/workspace/bin/bore")"
if [ ! -x "$BORE_BIN" ]; then
  say "bore tidak ditemukan, skip"
  exit 0
fi

# --- Supervisi server dashboard: pastikan node server.js hidup ---
if ! pgrep -f "node .*mission-control/server\.js" >/dev/null 2>&1; then
  say "server.js mati, start ulang"
  log_hist "server_restart" ""
  cd "$ROOT" && nohup node server.js >>"$ROOT/server.log" 2>&1 &
  disown 2>/dev/null
  sleep 3
fi

bore_alive() { pgrep -f "bore local $PORT" >/dev/null 2>&1; }

CURRENT_URL="$(head -n1 "$PUB" | tr -d ' \r\n')"

if bore_alive; then
  # tunnel hidup; verifikasi URL masih valid via live-check
  if [ -n "$CURRENT_URL" ]; then
    if curl -sf --max-time 8 "http://$CURRENT_URL/api/state" >/dev/null 2>&1; then
      log_hist "check_ok" "$CURRENT_URL"
      exit 0
    fi
    say "URL lama tidak merespons, restart bore"
    log_hist "url_dead" "$CURRENT_URL"
    pkill -f "bore local $PORT" 2>/dev/null
    sleep 2
  fi
else
  say "bore mati, start ulang"
  log_hist "tunnel_down" "$CURRENT_URL"
fi

# (re)start bore di background, tangkap URL dari output awal
nohup "$BORE_BIN" local "$PORT" --to bore.pub >"$ROOT/.bore.out" 2>&1 &
disown 2>/dev/null
for i in $(seq 1 20); do
  sleep 1
  # hanya dari baris non-error; JANGAN pernah anggap bore.pub:7835 (port kontrol) sebagai URL publik
  NEW_URL="$(grep -viE 'error|exception|warn|fail' "$ROOT/.bore.out" 2>/dev/null | grep -Eo 'bore\.pub:[0-9]+' | head -n1)"
  [ -z "$NEW_URL" ] && NEW_URL="$(grep -viE 'error|exception|warn|fail' "$ROOT/.bore.out" 2>/dev/null | grep -Eo 'https?://[^ ]*bore\.pub[^ ]*' | head -n1 | sed 's#^https\?://##')"
  [ "${NEW_URL##*:}" = "7835" ] && NEW_URL=""
  [ -n "$NEW_URL" ] && break
done

if [ -z "$NEW_URL" ]; then
  say "gagal mendapatkan URL bore baru"
  log_hist "restart_failed" ""
  exit 1
fi

if [ "$NEW_URL" != "$CURRENT_URL" ]; then
  printf '%s\n' "$NEW_URL" > "$PUB"
  say "URL berubah: $CURRENT_URL -> $NEW_URL"
  log_hist "url_changed" "$NEW_URL"
else
  log_hist "restart_ok" "$NEW_URL"
fi
exit 0
