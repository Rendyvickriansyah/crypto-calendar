# Crypto Calendar (MVP)

Kalender event yang ngegerakin crypto, semua jam WIB. Node tanpa dependency.

    node server.js        # http://localhost:4200

## Kategori & sumber
| Kategori | Sumber | Catatan |
|---|---|---|
| US Macro (CPI, NFP, PPI, JOLTS, ECI) | `data/bls_schedule.json` dari BLS.gov bls.ics | Jadwal resmi 2025 s/d Des 2026. Update: buka bls.gov/schedule/news_release/bls.ics di browser (curl diblok BLS) |
| US Macro minggu berjalan (+ forecast/previous) | ForexFactory `ff_calendar_thisweek.json` | Di-cache per minggu di `cache/ff_weeks.json`, jadi histori numpuk sendiri |
| Jobless Claims | Dihitung: tiap Kamis 08:30 ET | Estimasi |
| The Fed (FOMC + Minutes) | `data/fomc.json` dari federalreserve.gov | Minutes = keputusan + 21 hari |
| Options/Futures Expiry | Dihitung: Deribit Jumat terakhir 08:00 UTC, CME Jumat terakhir 16:00 London | |
| Earnings saham crypto | api.nasdaq.com earnings calendar | Watchlist di `EARNINGS_WATCH` (server.js) |
| Token Unlock | `data/unlocks.json` (SEED MANUAL) | Belum diverifikasi. Ganti ke API Tokenomist kalau udah punya key |
| US Market Libur | `data/holidays.json` (NYSE 2026) | |

## Reaksi historis BTC
`/api/reaction?kind=cpi` (juga nfp, ppi, jolts, eci, fomc, fomc_minutes, claims, expiry, expiry_q, cme).
Harga BTC/USDT 15m dari data-api.binance.vision tepat di jam rilis: gerak 1j, range 4j, gerak 24j.
Pembanding = rata-rata BTC di jam UTC yang sama, semua hari sejak 1 Jan 2024 (candle 1h). Cache di `cache/`.

Deep link: `http://localhost:4200/#kind=fomc` buka event FOMC terdekat.
