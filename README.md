# Rankedin

Compare yourself and your friends across LinkedIn's daily games (Queens, Tango,
Zip, …) over **far more days than LinkedIn exposes** — with an IQ + ELO leaderboard
computed over a shared, ever-growing dataset that friends contribute to.

**Live:** https://rankedin.web.app  ·  **API:** Cloud Run `rankedin-api` (us-central1)
**GCP/Firebase project:** `YOUR_PROJECT_ID`

## Why it exists
LinkedIn only serves the **last 14 days** of other people's game scores, but each
person can see their **own full history**. So if every friend contributes their own
per-puzzle results, the server can **stitch a full historical leaderboard** for any
past day out of everyone's personal rows — going back as far as people have played.

## How a friend joins (no login, no passwords)
1. Open https://rankedin.web.app on a **computer** → an anonymous session is created
   silently (identity = their LinkedIn, read by the tool; never a password).
2. Drag the **🎮 Rankedin Sync** bookmarklet to the bookmarks bar.
3. Open linkedin.com (already logged in) and click the bookmarklet.
4. It pulls their own results in their own session and relays them (via
   `window.open` + `postMessage`, because LinkedIn's CSP blocks a direct upload) to
   the `/sync` page, which uploads to the API.
5. The dashboard unlocks once they've contributed (**give-to-get** gate).

The install screen shows an **animated demo** of exactly this.

## Resilience (interrupted syncs) & incremental re-sync
- Uploads are **idempotent** — deterministic Firestore doc ids, so re-uploading a
  batch overwrites rather than duplicates.
- The sync uploads in **small batches** as it goes, so a crash at 60% keeps the 60%.
- A re-sync **only downloads what it doesn't already have.** Two things are tracked
  per user: the **cursor** (puzzle numbers already stored) and the **scan range**
  `{lo, hi}` per game — every puzzle already *looked at*, including the days the user
  didn't play. The cursor alone isn't enough: days you skipped leave no row behind, so
  without the range a re-sync would re-fetch all ~460 puzzles of every game each time.
  With it, a same-day re-sync costs a couple of dozen requests instead of ~3,000.
- The range is **checkpointed every 60 puzzles** as the sweep descends, so an
  interrupted deep sync resumes at the frontier instead of starting over. A puzzle
  that failed on a **429/5xx is retried and never recorded as swept**, so throttling
  can't punch a permanent hole in the history.
- The newest **14 puzzles per game are always re-checked** — the puzzle number doesn't
  advance when you play today's game after syncing, and people fill in recent days
  from the archive. For a full deep re-scan, the install screen has
  **"Force a full deep re-scan"** (`POST /api/contrib/scan/reset`), which clears the
  ranges so the next run re-reads everything.
- The everyone-boards (last-14-day) pass always re-runs — that data changes daily.
- The gate unlocks automatically once enough results land, and the client also calls
  `/complete`; either path is enough.

## Architecture
```
Friend's browser (linkedin.com, logged in)
  └─ bookmarklet (web/js/collector.js) pulls own data, postMessage →
       /sync page (web/sync.html, same origin, anon Firebase token)
         └─ POST → Cloud Run API (backend/) ──→ Firestore (rk_* collections)
                                                   ▲
  rankedin.web.app dashboard (web/) ── GET /api/leaderboard ──┘  (IQ/ELO compute)
Auth: Firebase Anonymous  ·  Hosting: Firebase (site "rankedin")
```
Data lives in a Firestore database under **`rk_`-prefixed** collections so it can
share a project with other apps without colliding; Firestore **rules are not
deployed** from here (the API uses the Admin SDK, which bypasses rules), so any
existing app in the project is left untouched.

## Setup
```bash
cp web/config.example.js web/config.js     # then fill in your Firebase + Cloud Run values
cp .firebaserc.example .firebaserc          # set your Firebase project id
```
`web/config.js`, `.firebaserc`, and the built `web/bookmarklet.txt` are gitignored —
no keys, project ids, or URLs are committed to this repo.

## Layout
```
backend/     FastAPI on Cloud Run — main.py, auth.py, store.py, compute.py, Dockerfile
web/         Firebase Hosting — index.html, sync.html, config.js, css/, js/
  js/app.js          auth + routing + gate
  js/dashboard.js    IQ/ELO visualization
  js/collector.js    the bookmarklet source (built into web/bookmarklet.txt)
  js/installdemo.js  the animated install demo
  js/sync.js         the upload relay
scripts/build_bookmarklet.py   stamps collector with the sync URL → bookmarklet.txt
firebase.json, .firebaserc     hosting config (site "rankedin")
```

## Redeploy
```bash
# backend
gcloud run deploy rankedin-api --source backend --region us-central1 \
  --project YOUR_PROJECT_ID --allow-unauthenticated

# after changing the collector or config:
python3 scripts/build_bookmarklet.py

# web
firebase deploy --only hosting --project YOUR_PROJECT_ID
```
Config values (Firebase keys, API URL, sync URL) live in `web/config.js`.

## The IQ / ELO model
Per puzzle, each player's time becomes a z-score of log-time against that day's
field; a player's per-game skill is the mean daily z, shrunk `n/(n+3)`, mapped to
`IQ = 100 + 15·z` (relative to the group, mean 100 / SD 15). ELO is a Bradley-Terry
fit over all same-puzzle head-to-heads, scaled to a 1500 center. Only players with
**≥10 rounds** are ranked. Names are merged accent-insensitively so a person isn't
split across spelling variants.

## Notes / limits
- Everyone-boards past ~14 days can only be reconstructed where enough friends have
  contributed their personal rows for those puzzles.
- This relies on LinkedIn's internal API from each user's own session; it's a private
  tool where people share only their own data. Respect LinkedIn's terms.
