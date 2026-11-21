# MoneyMan — private money tracker (PWA)

Live: https://carlosperez232310.github.io/moneyman/ — install on iPhone: Safari → Share → **Add to Home Screen**.

Static, client-side PWA for Carlos Perez, built on the same architecture as SYSTEM (static shell, service worker,
manifest, subsetted woff2 fonts, safe-area aware layout, Playwright layout tests) with a dark fintech UI:
**Home** (greeting, nudge, featured goal ring, quick tiles), **Goals** (data-driven goals with on-pace math),
**Week** (ONE Spending budget for the Wed–Tue week: eating out, groceries & snacks, fun, shopping and gas all count;
budget/spent/left, bar, per-day allowance, a breakdown by merchant category (informational only) and one purchase list;
"I spent cash" quick-add logs straight into Spending), **Bills** (weekly reserve, this month's bills as a checklist:
tap the circle to move a bill into **Paid**; bank payments auto-check; resets every month; cancelled subscriptions as a
small collapsible row) and **Activity** (transactions with All / Spending / Bills / Income / Transfers filters).

## Privacy model
- The repo and site are public, so **financial data is only ever published encrypted**: `data.enc.json` is
  AES-256-GCM, key = PBKDF2-SHA256(passcode, random 16-byte salt, 600,000 iterations), fresh 12-byte IV per update,
  AAD `moneyman-v1`. Decryption happens in the browser with WebCrypto.
- Passcode: three short words + 2 digits (EFF short wordlist, ~37.5 bits) stored in `.passcode` (chmod 600, gitignored).
  The app normalises input (case-insensitive; spaces or `_` become `-`), so `Apple Pear Plum 12` works the same as `apple-pear-plum-12`.
- "Remember on this device" stores only the derived AES key (not the passcode) in `localStorage` (`moneyman.key.v1`),
  tied to the salt. The salt is kept in `private/kdf.json`, so daily updates don't log the phone out.
  Menu → "Lock & forget this device" wipes it. To change the passcode: edit `.passcode`, run
  `tools/update_data.py private/data.json --rotate-salt`, publish.
- Never committed: `.passcode`, `private/` (plain JSON, salt file, CSV extracts), `*.csv`, `public/`, screenshots.
  `tools/publish-pages.sh` refuses to publish if the blob isn't an encrypted envelope, if any shipped file contains the
  passcode, or if any non-blob file contains plain data. `tools/update_data.py` rejects 6+ digit runs (account numbers);
  account masks must be last-4.
- Cash quick-add entries (`moneyman.cash.v1`, keyed by week, `cat: "spending"`; older `food`/`fun` entries are migrated in place on unlock and keep the old tag as `was`) and bill checkboxes (`moneyman.paid.v1`, keyed
  `<bill id>:<YYYY-MM>`, e.g. `verizon:2026-10`; only overrides of the automatic state are stored, ~4 months kept) live
  only in the phone's `localStorage` and work offline.

## Layout
- `src/` — source (index.html, css/app.css, js/app.js, sw.js, manifest.json, fonts/, icons/)
- `public/` — build output (`tools/build.sh` copies src, stamps `__VER__`, keeps `public/data.enc.json`)
- `tools/make_assets.py` — regenerates subsetted Inter/Sora woff2 fonts and the ring-"M" app icons
- `tools/finance_csv_to_tx.py` — Finance-connector CSV → cleaned `transactions` JSON (categories, last-4 only;
  overdraft-protection transfers, Klarna-as-Walmart BNPL, gas vs snacks at gas stations, fun merchants, refunds)
- `tools/ingest_finance.py --accounts <f> [--connections <f>] --tx <f> [<f>...]` — saves connector output to
  `private/accounts.json` (available + current, bank sync time) and `private/tx_latest.csv` (follows "Full text:" pointers)
- `tools/mm_engine.py` — pure money engine (no I/O): Wed→Tue weeks, paycheck estimate (avg of last 6), learned bill
  posting days + auto-paid, rent set-aside, Steam transfer owed, **safe to spend** (min of checking cash-flow after bills,
  rent, Steam and a month-end cushion vs. Spending budget left), goal projection, subscriptions (charged-after-cancel),
  possible duplicates, insights, alerts. Rules live in `DEFAULT_CONFIG`.
- `tools/audit.py --before <old plain> --after <new plain> --out <md>` — accuracy audit report (kept in `private/`)
- `tools/update_data.py <plain.json>` — validate + encrypt → `public/data.enc.json`
- `tools/publish-pages.sh` — build + safety checks + force-push `public/` to `gh-pages`
- `tools/verify_live.py` — waits until Pages serves the new blob and confirms it decrypts
- `tools/daily_update.sh <plain.json>` — **the daily one-liner**: update_data → publish → verify
- `tests/test_engine.py` — synthetic-data tests for every engine rule (no real numbers in this repo).
- `tests/test_app.py` — Playwright at 390x844 and 430x932 (simulated iPhone safe areas): no horizontal overflow,
  no clipped text, tap targets ≥ 38px, tab bar pinned; wrong-passcode error, unlock, all tabs, one Spending row/bucket = engine + goal =
  savings balance, All/Spending/Bills/Income/Transfers filters, cash into Spending (no Food/Fun choice), old food/fun cash migrated, bill auto-paid / check → Paid / persists /
  uncheck / next-month reset, remember-device reload, lock & forget. Saves screenshots (deviceScaleFactor 2) to `screenshots/`.
  Also: menu/Home "Next update" line + bank note, pull-to-refresh toast ("This is the newest data …"); app safe-to-spend and
  week math = engine values; safe-to-spend and account sheets, transaction detail, search + filters, insights, week switcher,
  alert dismiss, stale banner (>14 h).
- `tests/offline.py` — service worker: network-first data (new blob shows on next load), menu → Refresh loads a newer
  blob in place ("Updated with data from …"), new build auto-installs and reloads the open app, Refresh finds a new
  build → "App updated · …", offline shell + last data, offline Refresh → "Offline, showing data from …", bill checkbox
  offline, manifest/apple-touch-icon.
- `tests/test_schedule.py` — next-update math (9:02 AM / 9:02 PM PT, DST changes, browser in another zone) and
  the exact Refresh messages.
  Run: `python3 -m http.server 8766 --directory public` then
  `python3 tests/test_schedule.py && python3 tests/test_app.py && python3 tests/offline.py`
  (pass `https://carlosperez232310.github.io/moneyman/` as an argument to run against the live site).

## Daily routine
1. Pull live data with the Finance connector, saving each result to a file (`write_to_file`): `finance_list_accounts`,
   `finance_list_connections`, and `finance_query_account_transactions` from ~75 days back to today (limit 200, page until done).
2. `python3 tools/ingest_finance.py --accounts <accounts file> --connections <connections file> --tx <tx file> [<more tx files>]`
3. `python3 private/build_data.py` — computes everything (weeks, bills, rent, safe-to-spend, goal) → `private/data.json`.
   No hand edits needed. (Fallback: if `accounts.json` is missing/older than 36 h, the `ACCOUNTS` constant in the script is used.)
4. `tools/daily_update.sh /home/box/moneyman-app/private/data.json`

Schedule (PT): the data routine republishes at **9:02 AM** and **9:02 PM** (the 4:14 PM check-in is paused, so the app
no longer promises it). Data older than 14 h shows an amber "These numbers are from …" banner on Home. The bank (OnPoint via Plaid) only syncs new transactions about once a day, late evening (~10:50 PM PT), so new
purchases can take until the next day to appear; the app says so on Home and in the menu, and shows "Next update ~<time> PT"
(computed in America/Los_Angeles, `SCHEDULE` in `src/js/app.js` — update it if the routine times change).

The service worker serves the app shell cache-first but `data.enc.json` network-first (no-store + cache-busting
query, which also beats GitHub Pages' `max-age=600`; offline, background loads fall back to the last good blob, marked
`X-MM-Source: cache`). **Menu → Refresh** (or tapping the "Updated" pill) re-fetches with `?t=<now>&fresh=1` + `no-store`
(the service worker never answers that with a cached copy), calls `registration.update()` and, if a new app version is
waiting/installing, activates it and reloads. Messages: newer data → "Updated with data from 9:02 AM PT"; nothing newer →
"This is the newest data (from 4:19 PM PT). Next update around 9:02 PM PT." (or "The 9:02 AM PT update should land in a
few minutes." within 30 min after a scheduled run that hasn't arrived); no network → "Offline, showing data from <time> PT.";
after a version update the message is prefixed "App updated · ". Every build stamps a new cache name (`moneyman-<VER>`); the app
checks for a new `sw.js` on launch/resume and reloads itself once when the new version takes over, so the installed
iPhone app picks up new shells automatically (versions before 2026-10-02 21:30 need one close + reopen). The app shows "Updated <time> PT" from `generated_at`
(amber dot if older than 36 h) and re-fetches when reopened after 5+ minutes.

## Plain JSON schema (`private/data.json`)
Money = numbers in dollars. Dates = ISO `YYYY-MM-DD` (Pacific). Unknown optional fields are ignored.

```jsonc
{
  "schema": 3,   // schema 3 adds safe, cashflow, rent, steam, holds, subscriptions, insights, alerts, weeks, savings_series, bank_synced_at (all optional; schema-2 fields kept)
  "generated_at": "2026-10-02T20:45:00-07:00",  // shown as "Updated 8:45 PM PT" (auto-filled if missing)
  "name": "Carlos",
  "headline": "Fun money is getting low — cook at home till payday",  // Home nudge
  "headline_detail": "About $70 left for 5 days. Payday is Wed.", // optional
  "accounts": [                                   // mask MUST be last-4 only
    {"id": "checking", "kind": "checking", "name": "Credit Union Checking", "mask": "1234", "available": 412.50, "current": 430.00},
    {"id": "savings",  "kind": "savings",  "name": "Member Savings",   "mask": "5678", "available": 95.00, "current": 100.00}
  ],
  "paycheck": {"employer": "Employer", "weekday": 3, "last_date": "2026-09-30", "last_amount": 650.00,
               "next_date": "2026-10-07", "typical_min": 590, "typical_max": 745},   // next_date advances weekly if stale
  "goals": [                                       // any number of goals; "featured" one is the Home ring
    {"id": "console", "name": "Game console", "icon": "gamepad", "color": "mint|pink|violet", "featured": true,
     "target": 600, "due": "2026-12-31",
     "saved": 100.00,                              // optional; defaults to the sum of sources (main goal = savings balance only)
     "sources": [{"label": "Member Savings ••5678", "amount": 100.00}],
     "per_payday": 50, "plan_note": "$50 every Wednesday payday"},
    {"id": "birthday", "name": "Birthday fund", "icon": "gift", "color": "pink", "target": 300, "due": "2026-11-04",
     "saved": 0, "per_payday": 60, "window": ["2026-09-30", "2026-10-28"],   // paydays counted inside the window
     "breakdown": [{"label": "Gifts", "amount": 150, "icon": "gift"}, {"label": "Dinner out", "amount": 150, "approx": true, "icon": "food"}]}
  ],
  "week": {"start": "2026-09-30", "end": "2026-10-06", "budget": 150,          // Wed–Tue spending money (food + fun)
           "split": {"food": 0.7, "fun": 0.3},     // Food = round(budget × food share), Fun = the rest (default 70/30)
           "budgets": {"food": 105, "fun": 45},    // optional explicit override of the split
           "budget_breakdown": [{"label": "Paycheck", "amount": 650.00}, {"label": "Savings goal", "amount": -50}],
           "purchases": [{"merchant": "Burger Spot", "amount": 12.50, "date": "2026-09-30", "category": "food"},
                         {"merchant": "Movie tickets", "amount": 30, "date": "2026-10-02", "category": "fun", "manual": true, "note": "Not in bank yet"}]},
                         // bucket = Food for food/groceries, Fun for fun/shopping (or set "bucket": "food"|"fun")
  "bills": {"weekly_reserve": 275, "reserve_note": "Set aside from every Wednesday paycheck",
            "items": [                              // bill definitions; the app builds the current month's instances
              {"id": "phone", "name": "Phone", "amount": 80, "approx": true, "due_day": 1, "icon": "phone",
               "match": {"merchant": "phoneco", "min": 50, "max": 120}},   // auto-paid if the bank shows a payment
                                                                            // from due−7 days to month end
              {"id": "rent", "name": "Rent", "amount": 650, "approx": true, "due_day": 31, "date_label": "End of month",
               "icon": "home", "tags": ["CASH"], "note": "Pay in cash"},
              {"id": "car-ins", "name": "Car insurance", "amount": 20, "due_day": 1, "tags": ["VARIES"],
               "paid": true, "paid_date": "2026-10-01", "paid_amount": 18.5, "paid_period": "2026-10"},  // data-side paid flag
              {"id": "vet", "name": "Vet visit", "amount": 120, "date": "2026-10-20"}   // one-off (period = its month)
            ],                                      // "upcoming" is still accepted as an alias of "items"
            "cancelled": [{"name": "Streaming+", "amount": 9.99, "icon": "tv", "via": "Apple"}]},
  "transactions": [                                // newest first; amount signed (+ in / − out)
    {"id": "a1b2c3d4e5", "date": "2026-09-30", "merchant": "Burger Spot", "amount": -12.50, "category": "food",
     "account": "1234", "pending": false, "manual": false, "note": "optional"}
  ]
}
```
Categories: `food, groceries, fun, subs, shopping, gas, bills, fees, income, transfer, cash, other`.
Weekly buckets: **Food** = `food` (restaurants, fast food, DoorDash) + `groceries` (grocery stores incl. Safeway/Fred Meyer,
convenience-store food); **Fun** = `fun` (games, movies, entertainment, digital purchases like Google/Play/Steam) +
`shopping` (other discretionary). `subs`/`bills`/`fees` show under the Bills filter. A small recurring storage subscription (e.g. a `G1SK…` card
descriptor) is renamed to `Google One storage` and categorized `subs`, so it matches its monthly bill instead of counting as Fun.
Icons: `gamepad, gift, food, home, phone, card, shield, wifi, book, music, tv, bag, sparkle, target, wallet` (+ category names).
Tags with styling: `CASH, BNPL, VARIES, SUB` (any other text renders neutral). Bill `id`s must be unique.
Goal math: remaining paydays = weekly from `paycheck.next_date` to `due` (or `window` end); projected =
saved + per_payday × remaining; status "On pace" if projected ≥ target, else "Short $X" with the needed per-payday amount.
Week math (per bucket): left = bucket budget − bucket purchases − this phone's cash entries for that bucket; per-day =
left ÷ days remaining (incl. today); bar turns orange above 80% and red when over; a tick marks today's pace.
Bills math: paid = this phone's checkbox override, else `paid` flag in the data for this period, else a matching bank
payment. Unpaid bills past their due date say "Not seen in bank yet · due Oct 1". New month = everything upcoming again.


## Rent rule
Rent (~$650 cash) is due on the 31st (month-end, clamped to the last day). Carlos funds it with ~$325 from each of the last two Wednesday paychecks of the month (Oct 2026: Oct 21 and Oct 28). Do not count rent in mid-month bills-due totals.
