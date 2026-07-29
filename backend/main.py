"""Rankedin API — Cloud Run (FastAPI).

Flow:
  1. Web app authenticates the user with Firebase (Google sign-in) and sends the
     ID token as `Authorization: Bearer <token>` on every call.
  2. The /sync page relays the user's own LinkedIn data (pulled client-side by the
     bookmarklet) here in idempotent batches.
  3. /api/leaderboard is gated: it 403s until the user has contributed their data.
"""
import os, time, threading
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

import store, compute
from auth import verify

app = FastAPI(title="Rankedin API")

ALLOWED_ORIGINS = [o for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o] or ["*"]
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS,
                   allow_methods=["*"], allow_headers=["*"])


# ---- models ----
class LinkBody(BaseModel):
    urn: str
    name: str

class Row(BaseModel):
    game: str
    pz: int
    sec: int
    rank: Optional[int] = None
    hint: Optional[int] = 0
    miss: Optional[int] = 0

class ObsRow(Row):
    name: str
    urn: Optional[str] = None

class ScanRow(BaseModel):
    """Checkpoint: "puzzles lo..hi of `game` have all been looked at". `mp` is the
    highest puzzle this user actually played."""
    game: str
    lo: int
    hi: int
    mp: Optional[int] = 0

class ContribBody(BaseModel):
    results: List[Row] = []
    observations: List[ObsRow] = []
    scan: Optional[ScanRow] = None


# ---- leaderboard cache (recompute at most every 60s) ----
_cache = {"at": 0, "data": None}
_lock = threading.Lock()

def _leaderboard_for(me_name, me_urn=None):
    with _lock:
        if _cache["data"] is None or time.time() - _cache["at"] > 60:
            results, observations = store.load_dataset()
            _cache["raw"] = (results, observations)
            _cache["at"] = time.time()
            _cache["data"] = True
        results, observations = _cache["raw"]
    # me differs per user, so compute the "me" flag fresh (cheap vs the DB read)
    return compute.compute_dashboard(results, observations, me_name, me_urn)


# ---- endpoints ----
@app.get("/api/health")
def health():
    return {"ok": True}

@app.get("/api/me")
def me(user=Depends(verify)):
    u = store.get_user(user["uid"]) or {}
    return {"uid": user["uid"], "email": user["email"],
            "linkedName": u.get("name"), "linkedinUrn": u.get("linkedinUrn"),
            "contributed": bool(u.get("contributed")), "resultCount": u.get("resultCount", 0),
            "syncCompletedAt": str(u.get("syncCompletedAt")) if u.get("syncCompletedAt") else None}

@app.post("/api/user/link")
def link(body: LinkBody, user=Depends(verify)):
    store.link_user(user["uid"], body.urn, body.name)
    return {"ok": True}

@app.get("/api/contrib/cursor")
def cursor(user=Depends(verify)):
    # `cursor` = puzzles already stored (played days); `scan` = puzzle ranges already
    # swept, played or not. The client needs both to skip everything it has. Both are
    # resolved by LinkedIn URN, so a fresh anonymous session doesn't re-sweep history
    # an earlier session already contributed.
    uid = user["uid"]
    urn = (store.get_user(uid) or {}).get("linkedinUrn")
    cur = store.get_cursor(uid, urn)
    doc = store.get_scan_doc(uid, urn)
    scan = store.scan_ranges(doc)
    if doc is None and cur:
        # synced before ranges existed → derive them instead of sweeping again.
        # Only when the doc is absent: an emptied doc is a deliberate full re-scan.
        scan = store.seed_scan(uid, urn, cur, store.swept_to_bottom(urn))
    return {"cursor": cur, "scan": scan}

@app.post("/api/contrib/scan/reset")
def scan_reset(user=Depends(verify)):
    """Arm a full deep re-scan: the next sync re-checks every puzzle from scratch."""
    u = store.get_user(user["uid"]) or {}
    store.reset_scan(user["uid"], u.get("linkedinUrn"))
    return {"ok": True}

@app.post("/api/contrib/results")
def contrib(body: ContribBody, user=Depends(verify)):
    u = store.get_user(user["uid"]) or {}
    name = u.get("name")
    if not name:
        raise HTTPException(status_code=400, detail="Call /api/user/link first")
    results = [r.dict() for r in body.results]
    observations = [o.dict() for o in body.observations]
    added = 0
    if results or observations:
        added = store.upsert_batch(user["uid"], name, u.get("linkedinUrn"), results, observations)
    if body.scan:
        store.merge_scan(user["uid"], body.scan.dict(), u.get("linkedinUrn"))
    # a scan-only checkpoint doesn't move the counter — don't spend a transaction on it
    contributed = (store.bump_and_maybe_unlock(user["uid"], added)
                   if (results or observations) else bool(u.get("contributed")))
    return {"ok": True, "written": added, "contributed": contributed}

@app.post("/api/contrib/complete")
def complete(user=Depends(verify)):
    store.mark_complete(user["uid"])
    return {"ok": True}

@app.get("/api/leaderboard")
def leaderboard(user=Depends(verify)):
    u = store.get_user(user["uid"]) or {}
    if not u.get("contributed"):
        raise HTTPException(status_code=403, detail="Sync your own data first")
    return _leaderboard_for(u.get("name"), u.get("linkedinUrn"))
