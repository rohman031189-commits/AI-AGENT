'use strict';
/**
 * Mission Control — backend dashboard pemantau AI agent.
 * Node.js TANPA dependensi eksternal (http, fs, path, child_process saja).
 * Jalan di 127.0.0.1:3001
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const HOME = process.env.HOME || '/home/hatch';
const PORT = 3001;
const HOST = '127.0.0.1';

/* ------------------------------------------------------------------ */
/* Roster agent                                                        */
/* ------------------------------------------------------------------ */
const ROSTER = [
  { id: 'anca', name: 'Anca', role: 'Project Manager / General', color: '#7dd3fc',
    capabilities: ['Orkestrasi tugas', 'Delegasi ke sub-agent', 'Perencanaan & prioritas', 'Review hasil kerja'],
    trait: 'Robot default — ramping dengan visor biru' },
  { id: 'mu', name: 'Mu', role: 'Graphic Designer', color: '#c084fc',
    capabilities: ['Desain grafis & ilustrasi', 'Layout & tipografi', 'Aset visual & ikon', 'Moodboard'],
    trait: 'Baret ungu + stylus + drawing tablet' },
  { id: 'cipu', name: 'Cipu', role: 'Video Editor', color: '#f87171',
    capabilities: ['Editing video', 'Color grading', 'Motion & transisi', 'Audio mixing dasar'],
    trait: 'Headphone + tema merah REC' },
  { id: 'jaka', name: 'Jaka', role: 'QC Visual', color: '#fbbf24',
    capabilities: ['Quality control visual', 'Review detail & konsistensi', 'Uji tampilan multi-device', 'Laporan temuan'],
    trait: 'Mata kamera (lensa besar)' },
  { id: 'tono', name: 'Tono', role: 'Riset', color: '#34d399',
    capabilities: ['Riset web mendalam', 'Kompilasi sumber & sitasi', 'Analisis kompetitor', 'Ringkasan eksekutif'],
    trait: 'Kaca pembesar + antena pencari' },
  { id: 'dani', name: 'Dani', role: 'Coding', color: '#60a5fa',
    capabilities: ['Penulisan & debug kode', 'Bangun aplikasi & skrip', 'Review kode', 'Otomasi'],
    trait: 'Keyboard di depan dada' },
];
const AGENT_IDS = new Set(ROSTER.map(a => a.id));

/* ------------------------------------------------------------------ */
/* Util waktu (WIB) & format Indonesia                                 */
/* ------------------------------------------------------------------ */
const BULAN = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
const HARI  = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
const pad = n => String(n).padStart(2, '0');

function wibParts(date) {
  const t = new Date(date.getTime() + 7 * 3600 * 1000); // WIB = UTC+7
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(),
           h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds(),
           dow: t.getUTCDay() };
}
function nowWIBISO() {
  const p = wibParts(new Date());
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}+07:00`;
}
function fmtWIB(iso, withDay) {
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  const p = wibParts(d);
  const s = `${p.d} ${BULAN[p.mo - 1]} ${p.y}, ${pad(p.h)}:${pad(p.mi)}`;
  return withDay ? `${HARI[p.dow]}, ${s}` : s;
}
function fmtDur(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  if (d > 0) return `${d} hari ${h} jam`;
  if (h > 0) return `${h} jam ${m} mnt`;
  if (m > 0) return `${m} mnt ${s % 60} dtk`;
  return `${s} dtk`;
}
function fmtGB(bytes) { return (bytes / 1073741824).toFixed(2); }

/* Offset menit suatu zona waktu pada sebuah instant (tanpa library). */
function tzOffsetMinutes(tz, date) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const parts = {};
    for (const p of dtf.formatToParts(date)) parts[p.type] = p.value;
    const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day,
      (+parts.hour) % 24, +parts.minute, +parts.second);
    return Math.round((asUTC - date.getTime()) / 60000);
  } catch (e) { return 0; }
}
/* Ubah wall-time (tanpa offset) di suatu zona menjadi instant Date. */
function wallToInstant(tz, y, mo, d, h, mi, s) {
  let guess = Date.UTC(y, mo - 1, d, h, mi || 0, s || 0);
  for (let i = 0; i < 3; i++) {
    const off = tzOffsetMinutes(tz, new Date(guess));
    guess = Date.UTC(y, mo - 1, d, h, mi || 0, s || 0) - off * 60000;
  }
  return new Date(guess);
}
function parseWall(str) {
  // "2026-10-06T12:00:00" atau "11:05:00" atau "2026-10-06 12:00:00"
  const m = String(str).trim().match(
    /^(?:(\d{4})-(\d{2})-(\d{2})[T ])?(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  return { y: m[1] ? +m[1] : null, mo: m[2] ? +m[2] : null, d: m[3] ? +m[3] : null,
           h: +m[4], mi: +m[5], s: m[6] ? +m[6] : 0 };
}

/* ------------------------------------------------------------------ */
/* File data                                                           */
/* ------------------------------------------------------------------ */
function ensureData() {
  fs.mkdirSync(DATA, { recursive: true });
  for (const f of ['tasks.jsonl', 'queue.jsonl', 'watchdog-history.jsonl'])
    if (!fs.existsSync(path.join(DATA, f))) fs.writeFileSync(path.join(DATA, f), '');
  if (!fs.existsSync(path.join(DATA, 'dispatch.json')))
    fs.writeFileSync(path.join(DATA, 'dispatch.json'), JSON.stringify({ paused: false }, null, 2));
}
function readJSONL(file) {
  const out = [];
  try {
    const txt = fs.readFileSync(file, 'utf8');
    for (const line of txt.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try { out.push(JSON.parse(t)); } catch (e) { /* baris rusak: skip */ }
    }
  } catch (e) { /* file belum ada */ }
  return out;
}
function appendJSONL(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}
function loadDispatch() {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(DATA, 'dispatch.json'), 'utf8'));
    return { paused: !!d.paused, agent_paused: d.agent_paused || {} };
  } catch (e) { return { paused: false, agent_paused: {} }; }
}
function saveDispatch(d) {
  fs.writeFileSync(path.join(DATA, 'dispatch.json'), JSON.stringify(d, null, 2));
}

/* ------------------------------------------------------------------ */
/* Status agent dari ledger tasks.jsonl                                */
/* ------------------------------------------------------------------ */
function loadTasks() { return readJSONL(path.join(DATA, 'tasks.jsonl')); }

function computeAgents() {
  const dispatch = loadDispatch();
  const events = loadTasks();
  const latest = {}; // task_id -> event terakhir
  for (const e of events) {
    if (!e || !e.task_id) continue;
    if (!latest[e.task_id] || String(e.ts) >= String(latest[e.task_id].ts)) latest[e.task_id] = e;
  }
  const openByAgent = {}; // agent -> event open terbaru
  for (const id of Object.keys(latest)) {
    const e = latest[id];
    if ((e.status === 'started' || e.status === 'progress') && e.agent && AGENT_IDS.has(e.agent)) {
      const cur = openByAgent[e.agent];
      if (!cur || String(e.ts) > String(cur.ts)) openByAgent[e.agent] = e;
    }
  }
  return ROSTER.map(a => {
    const open = openByAgent[a.id] || null;
    const paused = dispatch.paused || !!dispatch.agent_paused[a.id];
    return {
      id: a.id, name: a.name, role: a.role, color: a.color,
      capabilities: a.capabilities, trait: a.trait,
      status: paused ? 'paused' : (open ? 'working' : 'idle'),
      paused_global: dispatch.paused, paused_self: !!dispatch.agent_paused[a.id],
      task: open ? { task_id: open.task_id, title: open.title || open.task_id,
                     detail: open.detail || '', status: open.status, ts: open.ts,
                     elapsed: fmtDur(Date.now() - new Date(open.ts).getTime()) } : null,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Metrik sistem dari /proc                                             */
/* ------------------------------------------------------------------ */
function readProc(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } }

function sysMetrics() {
  const load = readProc('/proc/loadavg').trim().split(/\s+/);
  const meminfo = {};
  for (const line of readProc('/proc/meminfo').split('\n')) {
    const m = line.match(/^(\w+):\s+(\d+)\s*kB/);
    if (m) meminfo[m[1]] = +m[2] * 1024;
  }
  const up = parseFloat(readProc('/proc/uptime').split(/\s+/)[0]) || 0;
  let cpus = 1;
  try { cpus = parseInt(execSync('nproc', { timeout: 3000 }).toString().trim(), 10) || 1; }
  catch (e) { cpus = (readProc('/proc/cpuinfo').match(/^processor\s*:/gm) || []).length || 1; }
  return {
    load1: parseFloat(load[0]) || 0, load5: parseFloat(load[1]) || 0, load15: parseFloat(load[2]) || 0,
    cpus,
    mem_total: meminfo.MemTotal || 0, mem_avail: meminfo.MemAvailable || 0,
    uptime_sec: Math.floor(up),
  };
}

let PAGE_SIZE = 4096;
try { PAGE_SIZE = parseInt(execSync('getconf PAGESIZE', { timeout: 3000 }).toString().trim(), 10) || 4096; }
catch (e) { /* pakai default */ }

/* Memory CONTAINER = jumlah RSS semua proses terlihat di /proc (bukan meminfo host). */
function containerMemory() {
  let pages = 0, procs = 0;
  let names = [];
  try { names = fs.readdirSync('/proc'); } catch (e) { return { bytes: 0, procs: 0 }; }
  for (const n of names) {
    if (!/^\d+$/.test(n)) continue;
    try {
      const f = readProc(`/proc/${n}/statm`).trim().split(/\s+/);
      const rss = parseInt(f[1], 10);
      if (Number.isFinite(rss) && rss >= 0) { pages += rss; procs++; }
    } catch (e) { /* proses hilang di tengah jalan */ }
  }
  return { bytes: pages * PAGE_SIZE, procs };
}

function diskInfo() {
  try {
    const out = execSync(`df -B1 --output=size,used,target ${ROOT}`, { timeout: 5000, encoding: 'utf8' });
    const line = out.trim().split('\n').pop().trim().split(/\s+/);
    const size = +line[0] || 0, used = +line[1] || 0;
    return { total: size, used, pct: size ? used / size * 100 : 0 };
  } catch (e) { return { total: 0, used: 0, pct: 0 }; }
}
function cpuModel() {
  const m = readProc('/proc/cpuinfo').match(/^model name\s*:\s*(.+)$/m);
  return m ? m[1].trim() : 'Unknown CPU';
}
function osPretty() {
  const m = readProc('/etc/os-release').match(/^PRETTY_NAME="(.+)"$/m);
  return m ? m[1] : (readProc('/etc/os-release').match(/^PRETTY_NAME=(.+)$/m) || [])[1] || 'Linux';
}

/* Tunnel: baca PUBLIC_URL.txt + live-check HTTP 200 (cache 60 dtk). */
let tunnelCache = { at: 0, online: null, url: '' };
function publicUrl() {
  const t = readProc(path.join(ROOT, 'PUBLIC_URL.txt')).trim().split('\n')[0] || '';
  return t;
}
function checkTunnel(url) {
  return new Promise(resolve => {
    if (!url) return resolve(false);
    const target = 'http://' + url.replace(/^https?:\/\//, '').replace(/\/$/, '') + '/api/state';
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    try {
      const req = http.get(target, res => { res.resume(); finish(res.statusCode === 200); });
      req.setTimeout(5000, () => { req.destroy(); finish(false); });
      req.on('error', () => finish(false));
    } catch (e) { finish(false); }
  });
}
async function tunnelInfo() {
  const url = publicUrl();
  if (!url) return { url: '', online: false, checked: false };
  if (Date.now() - tunnelCache.at < 60000 && tunnelCache.url === url)
    return { url, online: tunnelCache.online, checked: true, cached: true };
  const online = await checkTunnel(url);
  tunnelCache = { at: Date.now(), online, url };
  return { url, online, checked: true };
}

function watchdogInfo() {
  const rows = readJSONL(path.join(DATA, 'watchdog-history.jsonl'));
  const last = rows[rows.length - 1];
  if (!last) return { last_run: null, last_event: null, runs: 0 };
  return { last_run: last.ts || null, last_event: last.event || null, runs: rows.length };
}

/* ------------------------------------------------------------------ */
/* Token status — dari perintah `subscription-status status` (nyata).   */
/* ------------------------------------------------------------------ */
let tokenCache = { at: 0, data: null };
function parseSubStatus(out) {
  const d = { raw: out.trim() };
  d.has_subscription = !/does not have a subscription/i.test(out);
  const mu = out.match(/Usage:\s*(\d+(?:\.\d+)?)\s*%/i);
  d.usage_pct = mu ? parseFloat(mu[1]) : null;
  const ml = out.match(/of\s+(.+?)\s*\./i);
  d.limit_label = ml ? ml[1].trim() : null;
  const mr = out.match(/(?:resets?|reset)\s+(.+)/i);
  d.resets_at = mr ? mr[1].trim() : null;
  const ma = out.match(/Additional tokens:\s*(.+)/i);
  d.additional = ma ? ma[1].trim() : null;
  const mp = out.match(/plan[:\s]+(.+)/i);
  d.plan = d.has_subscription && mp ? mp[1].trim() : (d.has_subscription ? 'Aktif' : 'Tanpa langganan (gratis)');
  return d;
}
function tokenStatus() {
  if (tokenCache.data && Date.now() - tokenCache.at < 5 * 60 * 1000) return tokenCache.data;
  let d;
  try {
    const out = execSync('/opt/hatch/bin/subscription-status status', { timeout: 12000, encoding: 'utf8' });
    d = Object.assign({ connected: true }, parseSubStatus(out));
  } catch (e) {
    d = { connected: false, note: 'Perintah status langganan tidak tersedia saat ini.' };
  }
  tokenCache = { at: Date.now(), data: d };
  return d;
}

/* ------------------------------------------------------------------ */
/* Jadwal cron — parse markdown frontmatter YAML (tanpa library).       */
/* ------------------------------------------------------------------ */
const CRON_SCAN_DIRS = [
  path.join(HOME, 'workspace', 'cron.d'),
  path.join(HOME, 'workspace', 'goals'),
];

function parseScalar(v) {
  const t = v.trim();
  if (/^(true|yes|on)$/i.test(t)) return true;
  if (/^(false|no|off)$/i.test(t)) return false;
  if (/^(null|~)$/i.test(t)) return null;
  if (/^".*"$/.test(t) || /^'.*'$/.test(t)) return t.slice(1, -1);
  if (/^-?\d+\.\d+$/.test(t)) return parseFloat(t);
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  return t;
}
/* Parser YAML subset: mapping 1 level nested via indentasi. */
function parseFrontmatter(text) {
  const m = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const root = {};
  const stack = [{ obj: root, indent: -1 }];
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.replace(/\t/g, '  ');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = line.match(/^(\s*)([A-Za-z0-9_\-]+):\s*(.*)$/);
    if (!kv) continue;
    const indent = kv[1].length, key = kv[2], val = kv[3].trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    if (val === '') {
      const child = {};
      parent[key] = child;
      stack.push({ obj: child, indent });
    } else {
      parent[key] = parseScalar(val);
    }
  }
  return root;
}
function scanCronFiles() {
  const out = [];
  const walk = dir => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!e.name.startsWith('.')) walk(p); }
      else if (e.isFile() && e.name.endsWith('.md')) out.push(p);
    }
  };
  for (const d of CRON_SCAN_DIRS) walk(d);
  return out;
}
function prettifyId(id) {
  return String(id).split(/[-_]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
function parseEvery(str) {
  const m = String(str).trim().match(/^(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hour|hours|d|day|days)$/i);
  if (!m) return null;
  const n = parseFloat(m[1]), u = m[2].toLowerCase();
  const ms = u[0] === 's' ? n * 1000 : u[0] === 'm' ? n * 60000 : u[0] === 'h' ? n * 3600000 : n * 86400000;
  const unitId = u[0] === 's' ? 'detik' : u[0] === 'm' ? 'menit' : u[0] === 'h' ? 'jam' : 'hari';
  return { ms, label: `tiap ${m[1]} ${unitId}` };
}
function scheduleEntry(fm, file) {
  const s = fm.schedule || {};
  const kind = s.kind || 'unknown';
  const tz = s.timezone || 'Asia/Jakarta';
  const id = fm.id || path.basename(file, '.md');
  const entry = {
    id: String(id),
    title: fm.title ? String(fm.title) : prettifyId(id),
    enabled: fm.enabled !== false,
    owner: fm.owner ? String(fm.owner) : (fm.metadata && fm.metadata.created_by ? String(fm.metadata.created_by) : 'user'),
    mode: fm.mode ? String(fm.mode) : null,
    kind: String(kind), timezone: tz,
    label: String(kind), next_iso: null, next_approx: false,
    is_system: false, file,
  };
  entry.is_system = /^(system|heartbeat)/i.test(entry.owner) || entry.mode === 'heartbeat';
  try {
    if (kind === 'runonce' && s.at) {
      const w = parseWall(s.at);
      if (w && w.y) {
        const inst = wallToInstant(tz, w.y, w.mo, w.d, w.h, w.mi, w.s);
        entry.next_iso = inst.toISOString();
        entry.label = `sekali • ${fmtWIB(inst.toISOString())}`;
      }
    } else if (kind === 'interval' && s.every) {
      const ev = parseEvery(s.every);
      if (ev) {
        entry.label = ev.label;
        entry.next_iso = new Date(Date.now() + ev.ms).toISOString();
        entry.next_approx = true;
      }
    } else if (kind === 'daily') {
      const w = parseWall(s.time || s.at || '00:00');
      if (w) {
        entry.label = `harian • ${pad(w.h)}:${pad(w.mi)}`;
        const now = new Date();
        const off = tzOffsetMinutes(tz, now);
        const nowWall = new Date(now.getTime() + off * 60000);
        let cand = wallToInstant(tz, nowWall.getUTCFullYear(), nowWall.getUTCMonth() + 1,
                                 nowWall.getUTCDate(), w.h, w.mi, w.s || 0);
        if (cand.getTime() <= now.getTime())
          cand = wallToInstant(tz, nowWall.getUTCFullYear(), nowWall.getUTCMonth() + 1,
                               nowWall.getUTCDate() + 1, w.h, w.mi, w.s || 0);
        entry.next_iso = cand.toISOString();
      }
    } else if (kind === 'weekly') {
      const w = parseWall(s.time || s.at || '00:00');
      const wd = s.weekday != null ? parseInt(s.weekday, 10) : (s.day != null ? parseInt(s.day, 10) : null);
      const names = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
      if (w && wd != null && wd >= 0 && wd <= 6) {
        entry.label = `mingguan • ${names[wd]}, ${pad(w.h)}:${pad(w.mi)}`;
        const now = new Date();
        const off = tzOffsetMinutes(tz, now);
        const nowWall = new Date(now.getTime() + off * 60000);
        let add = (wd - nowWall.getUTCDay() + 7) % 7;
        let cand = wallToInstant(tz, nowWall.getUTCFullYear(), nowWall.getUTCMonth() + 1,
                                 nowWall.getUTCDate() + add, w.h, w.mi, w.s || 0);
        if (cand.getTime() <= now.getTime())
          cand = wallToInstant(tz, nowWall.getUTCFullYear(), nowWall.getUTCMonth() + 1,
                               nowWall.getUTCDate() + add + 7, w.h, w.mi, w.s || 0);
        entry.next_iso = cand.toISOString();
      } else if (w) {
        entry.label = `mingguan • ${pad(w.h)}:${pad(w.mi)}`;
      }
    } else if (kind === 'monthly') {
      const w = parseWall(s.time || s.at || '00:00');
      const dom = s.day != null ? parseInt(s.day, 10) : (s.date != null ? parseInt(s.date, 10) : 1);
      if (w) {
        entry.label = `bulanan • tanggal ${dom}, ${pad(w.h)}:${pad(w.mi)}`;
        const now = new Date();
        const off = tzOffsetMinutes(tz, now);
        const nowWall = new Date(now.getTime() + off * 60000);
        let y = nowWall.getUTCFullYear(), mo = nowWall.getUTCMonth() + 1;
        let cand = wallToInstant(tz, y, mo, Math.min(dom, 28), w.h, w.mi, w.s || 0);
        if (cand.getTime() <= now.getTime()) {
          mo++; if (mo > 12) { mo = 1; y++; }
          cand = wallToInstant(tz, y, mo, Math.min(dom, 28), w.h, w.mi, w.s || 0);
        }
        entry.next_iso = cand.toISOString();
      }
    }
  } catch (e) { /* jadwal rusak: label default, tanpa next */ }
  return entry;
}
let schedCache = { at: 0, data: [] };
function loadSchedules() {
  if (Date.now() - schedCache.at < 30000) return schedCache.data;
  const out = [];
  for (const f of scanCronFiles()) {
    try {
      const fm = parseFrontmatter(fs.readFileSync(f, 'utf8'));
      if (!fm) continue;
      out.push(scheduleEntry(fm, f));
    } catch (e) { /* file rusak: skip tanpa crash */ }
  }
  out.sort((a, b) => (a.is_system - b.is_system) || a.title.localeCompare(b.title));
  schedCache = { at: Date.now(), data: out };
  return out;
}

/* ------------------------------------------------------------------ */
/* Real-time log: gabungan tasks + queue + watchdog, urut waktu.        */
/* ------------------------------------------------------------------ */
function buildLog(limit) {
  const rows = [];
  for (const e of loadTasks())
    rows.push({ ts: e.ts || '', src: 'task',
      text: `[${e.status || '?'}] ${e.title || e.task_id} — ${e.agent || '?'}${e.detail ? ' · ' + e.detail : ''}` });
  for (const q of readJSONL(path.join(DATA, 'queue.jsonl')))
    rows.push({ ts: q.ts || '', src: 'queue',
      text: `Antrean (${q.status || 'queued'}): ${(q.prompt || '').slice(0, 120)} → ${q.agent || '?'}` });
  for (const w of readJSONL(path.join(DATA, 'watchdog-history.jsonl')))
    rows.push({ ts: w.ts || '', src: 'watchdog', text: `Watchdog: ${w.event || ''}${w.url ? ' → ' + w.url : ''}` });
  rows.sort((a, b) => String(a.ts) < String(b.ts) ? 1 : -1);
  return rows.slice(0, limit || 60);
}

/* ------------------------------------------------------------------ */
/* State lengkap untuk GET /api/state                                   */
/* ------------------------------------------------------------------ */
async function buildState() {
  const [tunnel, agents, queue] = [await tunnelInfo(), computeAgents(),
    readJSONL(path.join(DATA, 'queue.jsonl'))];
  const sys = sysMetrics();
  const cont = containerMemory();
  const disk = diskInfo();
  const wd = watchdogInfo();
  const dispatch = loadDispatch();
  return {
    ok: true,
    now: nowWIBISO(),
    agents,
    queue,
    queue_open: queue.filter(q => q.status === 'queued').length,
    tasks: loadTasks().slice(-200),
    dispatch_paused: dispatch.paused,
    system: sys,
    vps: {
      disk, cpu_model: cpuModel(), cpu_load: [sys.load1, sys.load5, sys.load15], cpus: sys.cpus,
      mem_container: cont,
      mem_host: { total: sys.mem_total, avail: sys.mem_avail },
      uptime_sec: sys.uptime_sec,
      tunnel, os: osPretty(), kernel: readProc('/proc/version').split(' ').slice(2, 3)[0] || '',
      watchdog: wd,
    },
    schedules: loadSchedules(),
    token: tokenStatus(),
    log: buildLog(60),
  };
}

/* ------------------------------------------------------------------ */
/* HTTP server                                                          */
/* ------------------------------------------------------------------ */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
};
function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => { buf += c; if (buf.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}
function serveStatic(req, res) {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch (e) { return send(res, 400, 'bad request', 'text/plain'); }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, 'index.html'))
    return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, data, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const st = await buildState();
      return send(res, 200, JSON.stringify(st));
    }
    if (req.method === 'POST' && url.pathname === '/api/queue') {
      const body = JSON.parse(await readBody(req) || '{}');
      const prompt = String(body.prompt || '').trim();
      if (!prompt) return send(res, 400, JSON.stringify({ ok: false, error: 'prompt kosong' }));
      const agent = AGENT_IDS.has(body.agent) ? body.agent : 'anca';
      const row = { ts: nowWIBISO(), prompt: prompt.slice(0, 500), agent, status: 'queued' };
      appendJSONL(path.join(DATA, 'queue.jsonl'), row);
      return send(res, 200, JSON.stringify({ ok: true, item: row }));
    }
    if (req.method === 'POST' && url.pathname === '/api/queue/done') {
      const body = JSON.parse(await readBody(req) || '{}');
      const file = path.join(DATA, 'queue.jsonl');
      const rows = readJSONL(file);
      let hit = false;
      for (const r of rows) if (!hit && r.ts === body.ts) { r.status = 'done'; hit = true; }
      fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
      return send(res, 200, JSON.stringify({ ok: hit }));
    }
    if (req.method === 'POST' && url.pathname === '/api/dispatch') {
      const body = JSON.parse(await readBody(req) || '{}');
      const d = loadDispatch();
      if (body.agent && AGENT_IDS.has(body.agent)) {
        if (body.paused) d.agent_paused[body.agent] = true;
        else delete d.agent_paused[body.agent];
      } else if (typeof body.paused === 'boolean') {
        d.paused = body.paused;
      } else {
        return send(res, 400, JSON.stringify({ ok: false, error: 'body tidak valid' }));
      }
      saveDispatch(d);
      return send(res, 200, JSON.stringify({ ok: true, dispatch: d }));
    }
    if (req.method === 'GET' && (url.pathname === '/' || !url.pathname.startsWith('/api/'))) {
      return serveStatic(req, res);
    }
    return send(res, 404, JSON.stringify({ ok: false, error: 'not found' }));
  } catch (e) {
    return send(res, 500, JSON.stringify({ ok: false, error: String(e.message || e) }));
  }
});

ensureData();
server.listen(PORT, HOST, () => {
  console.log(`Mission Control berjalan di http://${HOST}:${PORT}`);
});
