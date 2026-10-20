// Crypto Calendar MVP: US macro + Fed + unlock + expiry + earnings + reaksi historis BTC.
// Node tanpa dependency. Jalanin: node server.js (port 4200).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4200;
const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const CACHE = path.join(ROOT, 'cache');
const PUB = path.join(ROOT, 'public');
try { fs.mkdirSync(CACHE, { recursive: true }); } catch {}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const HOUR = 3600e3, DAY = 24 * HOUR;
// fetch dengan batas waktu: API luar yang nge-hang jangan sampai bikin seluruh request timeout
const fetchT = (url, opt = {}, ms = 8000) => fetch(url, { ...opt, signal: AbortSignal.timeout(ms) });
const EARNINGS_WATCH = ['COIN', 'MSTR', 'HOOD', 'CRCL', 'GLXY', 'MARA', 'RIOT', 'CLSK', 'IREN', 'CORZ', 'BMNR', 'SBET', 'NVDA', 'TSLA'];

const readJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
// Di Vercel filesystem read-only: kalau gagal nulis cache, abaikan (cache tetap di memori)
const writeJson = (f, v) => { try { fs.writeFileSync(f, JSON.stringify(v)); } catch {} };
const BLS = readJson(path.join(DATA, 'bls_schedule.json'), { events: [] });
const FOMC = readJson(path.join(DATA, 'fomc.json'), { meetings: [] });
const HOL = readJson(path.join(DATA, 'holidays.json'), { holidays: [] });
const holidaySet = new Set(HOL.holidays.filter(h => !h.early).map(h => h.date));

// ---------- waktu ----------
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
function nthSunday(y, m, n) { const d = new Date(Date.UTC(y, m, 1)); const first = (7 - d.getUTCDay()) % 7 + 1; return first + (n - 1) * 7; }
function lastSunday(y, m) { const d = new Date(Date.UTC(y, m + 1, 0)); return d.getUTCDate() - d.getUTCDay(); }
// US Eastern: EDT dari Minggu ke-2 Maret 02:00 sampai Minggu ke-1 Nov 02:00
function etOffsetHours(y, m, d, h) {
  const start = Date.UTC(y, 2, nthSunday(y, 2, 2), 2), end = Date.UTC(y, 10, nthSunday(y, 10, 1), 2);
  const t = Date.UTC(y, m, d, h);
  return t >= start && t < end ? -4 : -5;
}
function etToUtc(s) { // "YYYY-MM-DDTHH:MM"
  const [date, time = '00:00'] = s.split('T');
  const [y, mo, d] = date.split('-').map(Number), [h, mi] = time.split(':').map(Number);
  return Date.UTC(y, mo - 1, d, h, mi) - etOffsetHours(y, mo - 1, d, h) * HOUR;
}
function londonToUtc(y, m, d, h) { // BST: Minggu terakhir Maret 01:00 UTC s/d Minggu terakhir Okt 01:00 UTC
  const t = Date.UTC(y, m, d, h);
  const bst = t >= Date.UTC(y, 2, lastSunday(y, 2), 1) && t < Date.UTC(y, 9, lastSunday(y, 9), 1);
  return t - (bst ? HOUR : 0);
}
function lastFriday(y, m) { const d = new Date(Date.UTC(y, m + 1, 0)); return d.getUTCDate() - ((d.getUTCDay() + 2) % 7); }

// ---------- generator event terjadwal (deterministik) ----------
const BLS_MAP = {
  'Consumer Price Index': { title: 'CPI (Inflasi US)', kind: 'cpi', impact: 'high' },
  'Employment Situation': { title: 'NFP + Unemployment', kind: 'nfp', impact: 'high' },
  'Producer Price Index': { title: 'PPI', kind: 'ppi', impact: 'medium' },
  'Job Openings and Labor Turnover Survey': { title: 'JOLTS', kind: 'jolts', impact: 'medium' },
  'Employment Cost Index': { title: 'Employment Cost Index', kind: 'eci', impact: 'low' },
};
function blsEvents() {
  return BLS.events.filter(e => BLS_MAP[e.release]).map(e => {
    const m = BLS_MAP[e.release];
    return { id: `bls-${m.kind}-${e.et}`, cat: 'macro', title: m.title, kind: m.kind, impact: m.impact, ts: etToUtc(e.et), source: 'BLS.gov (jadwal resmi)' };
  });
}
function fomcEvents() {
  const out = [];
  for (const mt of FOMC.meetings) {
    const ts = etToUtc(`${mt.date}T14:00`);
    out.push({ id: `fomc-${mt.date}`, cat: 'fed', kind: 'fomc', impact: 'high', ts,
      title: mt.sep ? 'FOMC Rate Decision + Dot Plot' : 'FOMC Rate Decision',
      detail: { note: `Statement 14:00 ET, konferensi pers Powell 14:30 ET.${mt.sep ? ' Ada Summary of Economic Projections (dot plot).' : ''}` },
      source: 'federalreserve.gov' });
    const md = ymd(new Date(Date.parse(mt.date + 'T12:00:00Z') + 21 * DAY));
    out.push({ id: `fomcmin-${md}`, cat: 'fed', kind: 'fomc_minutes', impact: 'medium', ts: etToUtc(`${md}T14:00`),
      title: 'FOMC Meeting Minutes', detail: { note: `Notulen rapat ${mt.date}. Dirilis 3 minggu setelah keputusan.` },
      source: 'federalreserve.gov (aturan 3 minggu)', estimated: true });
  }
  return out;
}
function claimsEvents(fromMs, toMs) {
  const out = [];
  const d = new Date(fromMs - 7 * DAY); d.setUTCHours(12, 0, 0, 0);
  while (d.getUTCDay() !== 4) d.setUTCDate(d.getUTCDate() + 1);
  for (; d.getTime() <= toMs + DAY; d.setUTCDate(d.getUTCDate() + 7)) {
    let day = ymd(d);
    if (holidaySet.has(day)) day = ymd(new Date(d.getTime() - DAY)); // libur Kamis -> maju ke Rabu
    out.push({ id: `claims-${day}`, cat: 'macro', kind: 'claims', impact: 'medium', ts: etToUtc(`${day}T08:30`),
      title: 'Jobless Claims', source: 'DOL (rutin tiap Kamis)', estimated: true });
  }
  return out;
}
function expiryEvents(fromMs, toMs) {
  const out = [];
  const a = new Date(fromMs - 31 * DAY), b = new Date(toMs + 31 * DAY);
  for (let y = a.getUTCFullYear(), m = a.getUTCMonth(); y < b.getUTCFullYear() || (y === b.getUTCFullYear() && m <= b.getUTCMonth()); m === 11 ? (y++, m = 0) : m++) {
    const d = lastFriday(y, m), q = m % 3 === 2, day = `${y}-${pad(m + 1)}-${pad(d)}`;
    out.push({ id: `deribit-${day}`, cat: 'expiry', kind: q ? 'expiry_q' : 'expiry', impact: q ? 'high' : 'medium',
      ts: Date.UTC(y, m, d, 8), title: q ? 'Options Expiry Kuartalan' : 'Options Expiry Bulanan',
      detail: { note: 'Deribit, Jumat terakhir tiap bulan 08:00 UTC. Expiry kuartalan biasanya notional paling besar. Cek max pain di Deribit/Laevitas sebelum expiry.' },
      source: 'Aturan expiry Deribit' });
    let cd = d; while (holidaySet.has(`${y}-${pad(m + 1)}-${pad(cd)}`)) cd--;
    out.push({ id: `cme-${y}-${m}`, cat: 'expiry', kind: 'cme', impact: 'low', ts: londonToUtc(y, m, cd, 16),
      title: 'CME BTC Futures Expiry', detail: { note: 'Jumat terakhir bulan kontrak, 16:00 London. Mundur ke hari kerja sebelumnya kalau libur.' },
      source: 'Aturan kontrak CME' });
  }
  return out;
}
function unlockEvents(fromMs, toMs) {
  const U = readJson(path.join(DATA, 'unlocks.json'), { unlocks: [] }); // dibaca ulang biar edit langsung kepake
  const out = [];
  for (const u of U.unlocks) {
    const mk = (y, m, d) => {
      const ts = Date.UTC(y, m, d, 0);
      if (ts < fromMs - DAY || ts > toMs + DAY) return;
      out.push({ id: `unlock-${u.symbol}-${y}-${m}-${d}`, cat: 'unlock', impact: 'medium', ts, symbol: u.symbol,
        title: `${u.symbol} Token Unlock`, detail: { amount: u.amount, note: u.note, name: u.name },
        source: 'Seed manual data/unlocks.json (belum diverifikasi)', estimated: true });
    };
    if (u.type === 'once') { const [y, m, d] = u.date.split('-').map(Number); mk(y, m - 1, d); continue; }
    const [uy, um] = u.until.split('-').map(Number);
    const a = new Date(fromMs - DAY);
    for (let y = a.getUTCFullYear(), m = a.getUTCMonth(); (y * 12 + m) <= (uy * 12 + um - 1) && Date.UTC(y, m, 1) <= toMs; m === 11 ? (y++, m = 0) : m++) mk(y, m, u.day);
  }
  return out;
}
function holidayEvents() {
  return HOL.holidays.map(h => ({ id: `hol-${h.date}`, cat: 'holiday', impact: 'low', allDay: true, date: h.date,
    ts: Date.UTC(...h.date.split('-').map((v, i) => i === 1 ? v - 1 : +v), 0) - 7 * HOUR,
    title: h.early ? `US Market Tutup Cepat: ${h.name}` : `US Market Libur: ${h.name}`,
    detail: { note: h.early ? 'Bursa US tutup 13:00 ET. ETF flow dan likuiditas biasanya tipis.' : 'Bursa US tutup. Tidak ada flow ETF spot BTC/ETH, likuiditas cenderung tipis.' },
    source: 'Jadwal NYSE' }));
}

// ---------- ForexFactory (minggu ini, di-cache per minggu biar histori numpuk) ----------
const FF_FILE = path.join(CACHE, 'ff_weeks.json');
let ffState = readJson(FF_FILE, { fetchedAt: 0, weeks: {} });
function ffKind(t) {
  if (/FOMC Meeting Minutes/i.test(t)) return 'fomc_minutes';
  if (/Federal Funds Rate|FOMC Statement|FOMC Press|FOMC Economic Projections/i.test(t)) return 'fomc';
  if (/CPI/.test(t)) return 'cpi';
  if (/Non-Farm|Unemployment Rate|Average Hourly/i.test(t)) return 'nfp';
  if (/PPI/.test(t)) return 'ppi';
  if (/JOLTS/.test(t)) return 'jolts';
  if (/Unemployment Claims/i.test(t)) return 'claims';
  return null;
}
async function refreshFF() {
  if (Date.now() - ffState.fetchedAt < HOUR) return;
  try {
    const r = await fetchT('https://nfs.faireconomy.media/ff_calendar_thisweek.json', { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error('FF ' + r.status);
    const rows = (await r.json()).filter(x => x.country === 'USD');
    if (!rows.length) return;
    const ts = rows.map(x => Date.parse(x.date));
    const start = Math.min(...ts), wk = ymd(new Date(start));
    ffState.weeks[wk] = { start: Date.parse(wk + 'T00:00:00Z') - DAY, end: Date.parse(wk + 'T00:00:00Z') + 7 * DAY, rows };
    ffState.fetchedAt = Date.now();
    writeJson(FF_FILE, ffState);
  } catch (e) { console.error('[ff]', e.message); ffState.fetchedAt = Date.now() - HOUR + 5 * 60e3; }
}
function ffEvents() {
  const out = [], covered = [];
  for (const w of Object.values(ffState.weeks)) {
    const ts = w.rows.map(x => Date.parse(x.date));
    covered.push([Math.min(...ts) - HOUR, Math.max(...ts) + HOUR]);
    for (const x of w.rows) {
      if (x.impact === 'Holiday') continue;
      const kind = ffKind(x.title);
      const fed = /FOMC|Fed |Powell|Federal Funds/i.test(x.title);
      out.push({ id: `ff-${x.date}-${x.title}`, cat: fed ? 'fed' : 'macro', title: x.title, kind,
        impact: (x.impact || 'low').toLowerCase(), ts: Date.parse(x.date),
        detail: { forecast: x.forecast || null, previous: x.previous || null, actual: x.actual || null },
        source: 'ForexFactory (minggu ini)' });
    }
  }
  return { out, covered };
}

// ---------- Earnings (Nasdaq calendar, cache per tanggal) ----------
const EARN_FILE = path.join(CACHE, 'earnings.json');
const earnCache = readJson(EARN_FILE, {});
let nasdaqDownUntil = 0; // kalau Nasdaq gagal/diblok, skip sementara biar kalender tetap cepat tampil
async function earningsForDay(day) {
  const c = earnCache[day], past = Date.parse(day) < Date.now() - 2 * DAY;
  if (c && (past || Date.now() - c.at < 12 * HOUR)) return c.rows;
  if (Date.now() < nasdaqDownUntil) return c ? c.rows : [];
  try {
    const r = await fetchT(`https://api.nasdaq.com/api/calendar/earnings?date=${day}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } }, 5000);
    const j = await r.json();
    const rows = (j?.data?.rows || []).filter(x => EARNINGS_WATCH.includes(x.symbol));
    earnCache[day] = { at: Date.now(), rows };
    return rows;
  } catch (e) { console.error('[earn]', day, e.message); nasdaqDownUntil = Date.now() + 10 * 60e3; return c ? c.rows : []; }
}
async function earningsEvents(fromMs, toMs) {
  const days = [];
  for (let t = fromMs - DAY; t <= toMs + DAY; t += DAY) { const d = new Date(t); if (d.getUTCDay() % 6) days.push(ymd(d)); }
  const out = [];
  for (let i = 0; i < days.length; i += 5) {
    const res = await Promise.all(days.slice(i, i + 5).map(d => earningsForDay(d).then(rows => [d, rows])));
    for (const [d, rows] of res) for (const x of rows) {
      const pre = x.time === 'time-pre-market', after = x.time === 'time-after-hours';
      out.push({ id: `earn-${x.symbol}-${d}`, cat: 'earnings', symbol: x.symbol, impact: ['COIN', 'MSTR', 'NVDA'].includes(x.symbol) ? 'high' : 'medium',
        ts: etToUtc(`${d}T${pre ? '07:00' : after ? '16:05' : '12:00'}`), title: `${x.symbol} Earnings`,
        detail: { name: x.name, session: pre ? 'Sebelum market buka (pre-market)' : after ? 'Setelah market tutup (after-hours)' : 'Jam belum diumumkan',
          epsForecast: x.epsForecast || null, lastYearEPS: x.lastYearEPS || null, marketCap: x.marketCap || null, quarter: x.fiscalQuarterEnding },
        source: 'Nasdaq earnings calendar', estimated: !pre && !after });
    }
  }
  writeJson(EARN_FILE, earnCache);
  return out;
}

// ---------- gabung ----------
async function getEvents(fromMs, toMs) {
  await refreshFF();
  const { out: ff, covered } = ffEvents();
  const inFF = ts => covered.some(([a, b]) => ts >= a && ts <= b);
  // di minggu yang ada data FF, macro & fed pakai FF (lebih lengkap: forecast, previous, Fed speaker)
  const sched = [...blsEvents(), ...fomcEvents(), ...claimsEvents(fromMs, toMs)].filter(e => !inFF(e.ts));
  const all = [...sched, ...ff, ...expiryEvents(fromMs, toMs), ...unlockEvents(fromMs, toMs), ...holidayEvents(), ...await earningsEvents(fromMs, toMs)];
  return all.filter(e => e.ts >= fromMs && e.ts <= toMs).sort((a, b) => a.ts - b.ts);
}

// ---------- reaksi historis BTC ----------
const KL_FILE = path.join(CACHE, 'klines.json');
const klCache = readJson(KL_FILE, {});
const BASE_FILE = path.join(CACHE, 'baseline.json');
const KIND_LABEL = { cpi: 'CPI', nfp: 'NFP', ppi: 'PPI', jolts: 'JOLTS', eci: 'ECI', fomc: 'FOMC Rate Decision', fomc_minutes: 'FOMC Minutes', claims: 'Jobless Claims', expiry: 'Options Expiry Bulanan', expiry_q: 'Options Expiry Kuartalan', cme: 'CME Futures Expiry' };
function pastOccurrences(kind) {
  const now = Date.now(), from = Date.UTC(2024, 0, 1);
  let src;
  if (['cpi', 'nfp', 'ppi', 'jolts', 'eci'].includes(kind)) src = blsEvents();
  else if (kind === 'fomc' || kind === 'fomc_minutes') src = fomcEvents();
  else if (kind === 'claims') src = claimsEvents(now - 40 * 7 * DAY, now);
  else if (kind.startsWith('expiry') || kind === 'cme') src = expiryEvents(Date.UTC(2024, 0, 1), now);
  else return [];
  return src.filter(e => e.kind === kind && e.ts < now - DAY && e.ts >= from).map(e => e.ts).sort((a, b) => b - a).slice(0, 26);
}
async function klinesAround(ts) {
  if (klCache[ts]) return klCache[ts];
  const start = ts - HOUR; // 4 candle sebelum event
  const r = await fetchT(`https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=15m&startTime=${start}&limit=101`);
  const k = await r.json();
  if (!Array.isArray(k) || k.length < 101) throw new Error('klines kurang');
  klCache[ts] = k.map(c => [c[0], +c[1], +c[2], +c[3], +c[4]]);
  return klCache[ts];
}
// Baseline adil: periode sama (2024 s/d sekarang) dan jam UTC yang sama, dari candle 1h.
async function baseline() {
  const b = readJson(BASE_FILE, null);
  if (b && b.v === 2 && Date.now() - b.at < 12 * HOUR) return b;
  const h1 = [];
  for (let t = Date.UTC(2024, 0, 1); t < Date.now(); ) {
    const k = await (await fetchT(`https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&startTime=${t}&limit=1000`)).json();
    if (!Array.isArray(k) || !k.length) break;
    for (const c of k) h1.push([c[0], +c[1], +c[2], +c[3], +c[4]]);
    t = k[k.length - 1][0] + HOUR;
    if (k.length < 1000) break;
  }
  const abs1h = Array(24).fill(0), range4h = Array(24).fill(0), abs24h = Array(24).fill(0), n = Array(24).fill(0);
  for (let i = 0; i + 24 < h1.length; i++) {
    const hr = new Date(h1[i][0]).getUTCHours(), p0 = h1[i][1], w = h1.slice(i, i + 4);
    abs1h[hr] += Math.abs(h1[i][4] / p0 - 1);
    range4h[hr] += (Math.max(...w.map(c => c[2])) - Math.min(...w.map(c => c[3]))) / p0;
    abs24h[hr] += Math.abs(h1[i + 23][4] / p0 - 1);
    n[hr]++;
  }
  const nb = { v: 2, at: Date.now(), candles: h1.length,
    abs1h: abs1h.map((v, i) => v / n[i]), range4h: range4h.map((v, i) => v / n[i]), abs24h: abs24h.map((v, i) => v / n[i]) };
  writeJson(BASE_FILE, nb);
  return nb;
}
async function reaction(kind) {
  const occ = pastOccurrences(kind);
  if (!occ.length) return { kind, n: 0 };
  const rows = [];
  for (let i = 0; i < occ.length; i += 6) {
    const res = await Promise.all(occ.slice(i, i + 6).map(ts => klinesAround(ts).then(k => [ts, k]).catch(() => null)));
    for (const x of res) if (x) {
      const [ts, k] = x, p0 = k[4][1]; // open candle tepat di jam rilis
      const win4 = k.slice(4, 20);
      rows.push({ ts, p0,
        r1h: k[7][4] / p0 - 1, r4h: k[19][4] / p0 - 1, r24h: k[99][4] / p0 - 1,
        range4h: (Math.max(...win4.map(c => c[2])) - Math.min(...win4.map(c => c[3]))) / p0 });
    }
  }
  writeJson(KL_FILE, klCache);
  const avg = f => rows.reduce((s, r) => s + f(r), 0) / rows.length;
  const base = await baseline().catch(() => null);
  return { kind, label: KIND_LABEL[kind] || kind, n: rows.length, rows,
    stats: { abs1h: avg(r => Math.abs(r.r1h)), range4h: avg(r => r.range4h), abs24h: avg(r => Math.abs(r.r24h)),
      up24h: rows.filter(r => r.r24h > 0).length, mean24h: avg(r => r.r24h) },
    baseline: base && (() => {
      const m = key => rows.reduce((s, r) => s + base[key][new Date(r.ts).getUTCHours()], 0) / rows.length;
      return { abs1h: m('abs1h'), range4h: m('range4h'), abs24h: m('abs24h'),
        note: `Pembanding: rata-rata BTC di jam yang sama (UTC) pada semua hari sejak 1 Jan 2024, dari ${base.candles.toLocaleString('id-ID')} candle 1 jam Binance.` };
    })() };
}

// ---------- server ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
async function handler(req, res) {
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname === '/api/events') {
      const from = Date.parse(u.searchParams.get('from')), to = Date.parse(u.searchParams.get('to'));
      if (!from || !to || to - from > 70 * DAY) return send(res, 400, { error: 'from/to tidak valid (maks 70 hari)' });
      return send(res, 200, { events: await getEvents(from, to), ffFetchedAt: ffState.fetchedAt });
    }
    if (u.pathname === '/api/reaction') {
      const kind = u.searchParams.get('kind') || '';
      if (!/^[a-z_]+$/.test(kind)) return send(res, 400, { error: 'kind tidak valid' });
      return send(res, 200, await reaction(kind));
    }
    let f = path.normalize(path.join(PUB, u.pathname === '/' ? 'index.html' : u.pathname));
    if (!f.startsWith(PUB) || !fs.existsSync(f)) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, fs.readFileSync(f), MIME[path.extname(f)] || 'application/octet-stream');
  } catch (e) { console.error(e); send(res, 500, { error: e.message }); }
}

// Lokal: node server.js. Di Vercel: handler dipakai lewat api/index.js
if (require.main === module) http.createServer(handler).listen(PORT, () => console.log(`Crypto Calendar jalan di http://localhost:${PORT}`));
module.exports = handler;
